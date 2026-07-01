import jsPDF from "jspdf";
import { unzipSync } from "fflate";
import * as XLSX from "xlsx";
import { appendAoaSheet, appendDictionarySheet, appendRowsSheet, createWorkbook, saveWorkbook } from "@/lib/exportWorkbook";
import { PDF_THEME } from "@/lib/exportTheme";
import { formatDate } from "@/lib/format";

export const CALIDAD_OPTIONS = ["Excelente", "Bueno", "Regular", "Deficiente", "Pésimo"] as const;
export type CalidadEstado = typeof CALIDAD_OPTIONS[number];

export const DEFECTO_OPTIONS = [
  "Rameado",
  "Golpe",
  "Podrido",
  "Mancha",
  "Calibre irregular",
  "Color verde",
  "Piel blanda",
  "Deshidratado",
  "Plaga",
  "Otro",
] as const;
export type CalidadDefecto = typeof DEFECTO_OPTIONS[number];

export type CalidadInformeEstado = "borrador" | "generado" | "validado" | "reabierto";

export interface CalidadJornada {
  id: string;
  fecha: string;
  responsable: string;
  estado: "borrador" | "guardada" | "revisada";
  created_at?: string;
  updated_at?: string;
}

export interface CalidadProductor {
  id: string;
  nombre: string;
  created_at?: string;
  updated_at?: string;
}

export interface CalidadLote {
  id: string;
  jornada_id: string;
  user_id: string;
  fecha: string;
  numero_lote: string;
  productor_finca_id: string | null;
  productor_finca_nombre: string;
  producto: string;
  variedad: string;
  cantidad: string;
  hora: string | null;
  aerobotics_realizado: boolean;
  calidad: CalidadEstado;
  defectos: string[];
  defecto_otro: string;
  observacion: string;
  accion_recomendada: string;
  informe_estado: CalidadInformeEstado;
  informe_generado: string;
  ia_calidad: string | null;
  ia_defectos: string[];
  ia_resumen: string;
  ia_accion_recomendada: string;
  validado_at: string | null;
  validado_by: string | null;
  reabierto_at: string | null;
  reabierto_by: string | null;
  motivo_reapertura: string;
  created_at: string;
  updated_at: string;
}

export interface CalidadAdjunto {
  id: string;
  lote_id: string;
  file_name: string;
  file_path: string;
  mime_type: string | null;
  file_size: number | null;
  created_at?: string;
  signedUrl?: string;
}

export interface CalidadSummary {
  total: number;
  aerobotics: number;
  fotos: number;
  byQuality: Record<CalidadEstado, number>;
}

export function formatCalidadDate(value: string | Date) {
  return formatDate(value);
}

export function normalizeCalidadName(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

export function sameCalidadName(a: string, b: string) {
  return normalizeCalidadName(a).localeCompare(normalizeCalidadName(b), "es", { sensitivity: "accent" }) === 0;
}

function decodeXmlEntities(value: string) {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'");
}

function normalizeComentario(value: string) {
  return value
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

export function extractWordXmlText(xml: string) {
  const paragraphs = xml.match(/<w:p[\s\S]*?<\/w:p>/g) ?? [xml];
  const lines = paragraphs
    .map((paragraph) => {
      const textRuns = [...paragraph.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map((match) => decodeXmlEntities(match[1]));
      if (textRuns.length > 0) return textRuns.join("");
      return decodeXmlEntities(paragraph.replace(/<[^>]+>/g, " "));
    })
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  return lines.join("\n");
}

export function extractDocxText(bytes: Uint8Array) {
  const files = unzipSync(bytes);
  const decoder = new TextDecoder("utf-8");
  const xmlNames = Object.keys(files).filter((name) =>
    /^word\/(?:document|header\d*|footer\d*)\.xml$/i.test(name),
  );

  if (xmlNames.length === 0) throw new Error("No se pudo leer texto del Word. Usa un archivo .docx valido.");

  return normalizeComentario(xmlNames.map((name) => extractWordXmlText(decoder.decode(files[name]))).join("\n"));
}

export function buildComentarioCalidad(lote: Pick<CalidadLote, "observacion" | "accion_recomendada">) {
  const observacion = normalizeComentario(lote.observacion);
  const accion = normalizeComentario(lote.accion_recomendada);
  if (observacion && accion) return `${observacion}\n\nAccion recomendada: ${accion}`;
  if (accion) return `Accion recomendada: ${accion}`;
  return observacion;
}

function stripObservationLabel(value: string) {
  return value.replace(/^\s*observaci[oó]n\s*:\s*/i, "").trim();
}

export function splitComentarioCalidad(value: string) {
  const normalized = normalizeComentario(value);
  const actionMatch = normalized.match(/(?:^|\n)\s*(?:acci[oó]n recomendada|acci[oó]n|recomendaci[oó]n)\s*:\s*/i);

  if (!actionMatch || actionMatch.index == null) {
    return { observacion: stripObservationLabel(normalized), accion_recomendada: "" };
  }

  const actionStart = actionMatch.index;
  const actionContentStart = actionStart + actionMatch[0].length;
  return {
    observacion: stripObservationLabel(normalized.slice(0, actionStart)),
    accion_recomendada: normalized.slice(actionContentStart).trim(),
  };
}

export interface CalidadValidationResult {
  ok: boolean;
  reason?: string;
}

export function canValidateCalidadLote(lote: CalidadLote, photoCount: number): CalidadValidationResult {
  if (photoCount < 1) {
    return { ok: false, reason: "Se requiere al menos 1 foto para validar el informe." };
  }
  if ((lote.defectos ?? []).includes("Otro") && !(lote.defecto_otro ?? "").trim()) {
    return { ok: false, reason: "Seleccionaste Otro como defecto. Describe manualmente el defecto antes de validar." };
  }
  return { ok: true };
}

export function isCalidadLoteLocked(lote: CalidadLote): boolean {
  return lote.informe_estado === "validado";
}

export function validateCalidadLote(lote: CalidadLote, userId: string, isoDate: string): CalidadLote {
  return { ...lote, informe_estado: "validado", validado_at: isoDate, validado_by: userId };
}

export function reopenCalidadLote(lote: CalidadLote, userId: string, isoDate: string): CalidadLote {
  return {
    ...lote,
    informe_estado: "reabierto",
    reabierto_at: isoDate,
    reabierto_by: userId,
    validado_at: null,
    validado_by: null,
  };
}

export interface DraftReport {
  informe: string;
  accion_recomendada: string;
}

export function createCalidadDraftReport(lote: CalidadLote, photoCount: number, _history: CalidadLote[]): DraftReport {
  const trace = [
    lote.productor_finca_nombre || "productor/finca pendiente",
    lote.variedad || lote.producto || "variedad pendiente",
    lote.cantidad || "box pendiente",
    lote.hora ? `${lote.hora} h` : "hora pendiente",
  ].join(" - ");
  const defects = (lote.defectos ?? []).length > 0 ? ` Defectos marcados: ${(lote.defectos ?? []).join(", ")}.` : "";
  const photoText = photoCount === 1 ? "1 foto adjunta" : `${photoCount} fotos adjuntas`;
  const actionByQuality: Record<CalidadEstado, string> = {
    Excelente: "Mantener trazabilidad del lote y liberar si la inspeccion visual coincide con la calidad marcada.",
    Bueno: "Mantener trazabilidad del lote y liberar si la inspeccion visual coincide con la calidad marcada.",
    Regular: "Revisar en linea, controlar calibre/color y dejar seguimiento en el parte.",
    Deficiente: "Separar para seguimiento, reforzar control visual y avisar a produccion antes de mezclar.",
    Pésimo: "Bloquear el lote, documentar con fotos y escalar a responsable de calidad antes de procesar.",
  };

  return {
    informe: `Entrada ${lote.calidad.toLocaleLowerCase("es")} de ${trace}. ${photoText} como evidencia.${defects}`,
    accion_recomendada: actionByQuality[lote.calidad] || "Revisar lote antes de procesar.",
  };
}

export function findCalidadHistoricoSimilar(current: CalidadLote, history: CalidadLote[]) {
  return history
    .filter((lote) => lote.id !== current.id)
    .filter((lote) => {
      const sameProducer = current.productor_finca_nombre && sameCalidadName(current.productor_finca_nombre, lote.productor_finca_nombre);
      const sameVariety = current.variedad && sameCalidadName(current.variedad, lote.variedad);
      return sameProducer || sameVariety;
    })
    .sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)))
    .slice(0, 3);
}

export function buildCalidadComentarioSugerido(current: CalidadLote, history: CalidadLote[] = [], photoCount = 0) {
  const similar = findCalidadHistoricoSimilar(current, history);
  const trace = [
    current.productor_finca_nombre || "productor/finca pendiente",
    current.variedad || current.producto || "variedad pendiente",
    current.cantidad || "box pendiente",
    current.hora ? `${current.hora} h` : "hora pendiente",
  ].join(" - ");
  const defects = (current.defectos ?? []).length > 0 ? ` Defectos marcados: ${(current.defectos ?? []).join(", ")}.` : "";
  const photoText = photoCount === 1 ? "1 foto adjunta" : `${photoCount} fotos adjuntas`;
  const historyText = similar.length > 0
    ? ` Historico similar: ${similar.map((lote) => `${lote.fecha} ${lote.calidad}`).join("; ")}.`
    : " Sin historico similar registrado para comparar.";
  const actionByQuality: Record<CalidadEstado, string> = {
    Excelente: "Mantener trazabilidad del lote y liberar si la inspeccion visual coincide con la calidad marcada.",
    Bueno: "Mantener trazabilidad del lote y liberar si la inspeccion visual coincide con la calidad marcada.",
    Regular: "Revisar en linea, controlar calibre/color y dejar seguimiento en el parte.",
    Deficiente: "Separar para seguimiento, reforzar control visual y avisar a produccion antes de mezclar.",
    Pésimo: "Bloquear el lote, documentar con fotos y escalar a responsable de calidad antes de procesar.",
  };

  return normalizeComentario(
    `Entrada ${current.calidad.toLocaleLowerCase("es")} de ${trace}. ${photoText} como evidencia.${defects}${historyText}\n\nAccion recomendada: ${actionByQuality[current.calidad]}`,
  );
}

export function calidadSummary(lotes: CalidadLote[], attachmentCounts: Record<string, number> = {}): CalidadSummary {
  const byQuality = Object.fromEntries(CALIDAD_OPTIONS.map((quality) => [quality, 0])) as Record<CalidadEstado, number>;
  for (const lote of lotes) {
    // Solo se cuentan estados conocidos; un valor heredado fuera de CALIDAD_OPTIONS
    // dejaría el contador en NaN y contaminaría los porcentajes.
    if (lote.calidad in byQuality) byQuality[lote.calidad] += 1;
  }

  return {
    total: lotes.length,
    aerobotics: lotes.filter((lote) => lote.aerobotics_realizado).length,
    fotos: Object.values(attachmentCounts).reduce((total, count) => total + count, 0),
    byQuality,
  };
}

export function attachmentCountMap(adjuntos: CalidadAdjunto[]) {
  return adjuntos.reduce<Record<string, number>>((acc, adjunto) => {
    acc[adjunto.lote_id] = (acc[adjunto.lote_id] ?? 0) + 1;
    return acc;
  }, {});
}

  export function buildCalidadExcelRows(lotes: CalidadLote[], attachmentCounts: Record<string, number> = {}) {
  return lotes.map((lote) => ({
    Fecha: formatCalidadDate(lote.fecha),
    Lote: lote.numero_lote,
    "Productor/Finca": lote.productor_finca_nombre,
    Producto: lote.producto,
    Variedad: lote.variedad,
    Cantidad: lote.cantidad,
    Hora: lote.hora ?? "",
    "Aerobotics realizado": lote.aerobotics_realizado ? "Si" : "No",
    Calidad: lote.calidad,
    Defectos: (lote.defectos ?? []).join(", "),
    "Otro defecto": lote.defecto_otro,
    "Estado informe": lote.informe_estado,
    "Informe generado": lote.informe_generado,
    "IA calidad": lote.ia_calidad ?? "",
    "IA defectos": (lote.ia_defectos ?? []).join(", "),
    Observacion: lote.observacion,
    "Accion recomendada": lote.accion_recomendada,
    Validado: lote.validado_at ? `${lote.validado_at} por ${lote.validado_by ?? "-"}` : "",
    Reabierto: lote.reabierto_at ? `${lote.reabierto_at} por ${lote.reabierto_by ?? "-"}` : "",
    Fotos: attachmentCounts[lote.id] ?? 0,
  }));
}

export function buildCalidadIncidentRows(lotes: CalidadLote[], attachmentCounts: Record<string, number> = {}) {
  return lotes
    .filter((lote) => (lote.calidad !== "Excelente" && lote.calidad !== "Bueno") || (lote.defectos?.length ?? 0) > 0 || (lote.observacion ?? "").trim() || (lote.accion_recomendada ?? "").trim())
    .map((lote) => ({
      Prioridad: lote.calidad === "Pésimo" ? "Alta" : lote.calidad === "Deficiente" ? "Media" : "Seguimiento",
      Fecha: formatCalidadDate(lote.fecha),
      Lote: lote.numero_lote,
      "Productor/Finca": lote.productor_finca_nombre,
      Producto: lote.producto,
      Variedad: lote.variedad,
      Cantidad: lote.cantidad,
      Hora: lote.hora ?? "",
      Calidad: lote.calidad,
      Defectos: (lote.defectos ?? []).join(", "),
      "Otro defecto": lote.defecto_otro,
      "Estado informe": lote.informe_estado,
      "Informe generado": lote.informe_generado,
      Observacion: lote.observacion,
      "Accion recomendada": lote.accion_recomendada,
      Validado: lote.validado_at ? `${lote.validado_at} por ${lote.validado_by ?? "-"}` : "",
      Reabierto: lote.reabierto_at ? `${lote.reabierto_at} por ${lote.reabierto_by ?? "-"}` : "",
      Fotos: attachmentCounts[lote.id] ?? 0,
    }));
}

export function buildCalidadAttachmentRows(jornada: CalidadJornada, lotes: CalidadLote[], adjuntos: CalidadAdjunto[]) {
  return adjuntos.map((adjunto) => {
    const lote = lotes.find((item) => item.id === adjunto.lote_id);
    return {
      Fecha: lote ? formatCalidadDate(lote.fecha) : formatCalidadDate(jornada.fecha),
      Lote: lote?.numero_lote ?? "",
      "Productor/Finca": lote?.productor_finca_nombre ?? "",
      Calidad: lote?.calidad ?? "",
      Archivo: adjunto.file_name,
      Tipo: adjunto.mime_type ?? "",
      "Ruta storage": adjunto.file_path,
    };
  });
}

function safePdf(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7E]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const QUALITY_PDF_COLORS: Record<CalidadEstado, [number, number, number]> = {
  Excelente: PDF_THEME.success,
  Bueno: PDF_THEME.success,
  Regular: PDF_THEME.warning,
  Deficiente: PDF_THEME.primary,
  Pésimo: PDF_THEME.destructive,
};

const QUALITY_SOFT_COLORS: Record<CalidadEstado, [number, number, number]> = {
  Excelente: [232, 246, 237],
  Bueno: [232, 246, 237],
  Regular: [255, 246, 222],
  Deficiente: [255, 237, 221],
  Pésimo: [255, 235, 234],
};

function percentageLabel(value: number, total: number) {
  return total > 0 ? `${Math.round((value / total) * 100)}%` : "0%";
}

function setCellStyle(ws: XLSX.WorkSheet, address: string, style: Record<string, unknown>) {
  const cell = ws[address];
  if (cell) (cell as XLSX.CellObject & { s?: Record<string, unknown> }).s = style;
}

function styleRange(ws: XLSX.WorkSheet, range: string, style: Record<string, unknown>) {
  const decoded = XLSX.utils.decode_range(range);
  for (let row = decoded.s.r; row <= decoded.e.r; row += 1) {
    for (let col = decoded.s.c; col <= decoded.e.c; col += 1) {
      setCellStyle(ws, XLSX.utils.encode_cell({ r: row, c: col }), style);
    }
  }
}

function drawQualityPill(doc: jsPDF, x: number, y: number, label: string, color: [number, number, number], fill: [number, number, number], width = 24) {
  doc.setFillColor(...fill);
  doc.setDrawColor(...color);
  doc.setLineWidth(0.25);
  doc.roundedRect(x, y, width, 7, 3.5, 3.5, "FD");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(6.5);
  doc.setTextColor(...color);
  doc.text(safePdf(label), x + width / 2, y + 4.8, { align: "center" });
}

function drawCalidadFooter(doc: jsPDF, pageIndex: number) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  doc.setDrawColor(...PDF_THEME.border);
  doc.line(10, pageHeight - 10, pageWidth - 10, pageHeight - 10);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(6.5);
  doc.setTextColor(...PDF_THEME.muted);
  doc.text("Lasarte SAT - Informe de Calidad", 10, pageHeight - 5.8);
  doc.text(`Pag. ${pageIndex}`, pageWidth - 10, pageHeight - 5.8, { align: "right" });
}

function drawCalidadHeader(doc: jsPDF, jornada: CalidadJornada, summary: CalidadSummary, pageIndex: number) {
  const pageWidth = doc.internal.pageSize.getWidth();
  doc.setFillColor(...PDF_THEME.forest);
  doc.rect(0, 0, pageWidth, 18, "F");
  doc.setFillColor(...PDF_THEME.primary);
  doc.rect(0, 0, pageWidth, 3, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(...PDF_THEME.white);
  doc.text("LASARTE SAT", 10, 10);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.text("Departamento de Calidad", 10, 14.5);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.text(safePdf(formatCalidadDate(jornada.fecha)), pageWidth - 10, 10, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.text(safePdf(`${summary.total} lotes anotados`), pageWidth - 10, 14.5, { align: "right" });
  drawCalidadFooter(doc, pageIndex);
}

function drawMetricTile(doc: jsPDF, x: number, y: number, w: number, label: string, value: string, sub: string, accent: [number, number, number]) {
  doc.setFillColor(...PDF_THEME.white);
  doc.setDrawColor(...PDF_THEME.border);
  doc.roundedRect(x, y, w, 21, 2, 2, "FD");
  doc.setFillColor(...accent);
  doc.roundedRect(x, y, 3.2, 21, 1, 1, "F");
  doc.setFont("helvetica", "normal");
  doc.setFontSize(6.2);
  doc.setTextColor(...PDF_THEME.muted);
  doc.text(label, x + 6.5, y + 6);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(...PDF_THEME.text);
  doc.text(value, x + 6.5, y + 14);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(6.2);
  doc.setTextColor(...PDF_THEME.muted);
  doc.text(sub, x + 6.5, y + 18.5);
}

function addPdfPage(doc: jsPDF, jornada: CalidadJornada, summary: CalidadSummary, pageIndexRef: { value: number }) {
  doc.addPage();
  pageIndexRef.value += 1;
  drawCalidadHeader(doc, jornada, summary, pageIndexRef.value);
}

function ensurePdfSpace(doc: jsPDF, y: number, needed: number, jornada: CalidadJornada, summary: CalidadSummary, pageIndexRef: { value: number }) {
  const pageHeight = doc.internal.pageSize.getHeight();
  if (y + needed <= pageHeight - 14) return y;
  addPdfPage(doc, jornada, summary, pageIndexRef);
  return 25;
}

function drawLoteCard(doc: jsPDF, lote: CalidadLote, index: number, photoCount: number, x: number, y: number, w: number) {
  const qualityColor = QUALITY_PDF_COLORS[lote.calidad];
  const softColor = QUALITY_SOFT_COLORS[lote.calidad];
  const observations = doc.splitTextToSize(safePdf(lote.observacion || "Sin observacion registrada."), 128).slice(0, 4);
  const action = doc.splitTextToSize(safePdf(lote.accion_recomendada || "Sin accion recomendada."), 118).slice(0, 4);
  const detailHeight = Math.max(14, observations.length * 4.2 + 3, action.length * 4.2 + 3);
  const cardHeight = 31 + detailHeight + (lote.defectos.length > 0 ? 9 : 0);

  doc.setFillColor(...PDF_THEME.white);
  doc.setDrawColor(...PDF_THEME.border);
  doc.roundedRect(x, y, w, cardHeight, 2, 2, "FD");
  doc.setFillColor(...qualityColor);
  doc.roundedRect(x, y, 3, cardHeight, 1, 1, "F");

  doc.setFillColor(...softColor);
  doc.roundedRect(x + 5, y + 5, 16, 16, 8, 8, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(...qualityColor);
  doc.text(String(index + 1), x + 13, y + 15.4, { align: "center" });

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9.5);
  doc.setTextColor(...PDF_THEME.text);
  doc.text(safePdf(lote.productor_finca_nombre || "Sin productor/finca"), x + 25, y + 10);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(...PDF_THEME.muted);
  doc.text(safePdf(`Lote ${lote.numero_lote || "-"} - ${lote.producto || "-"} - ${lote.variedad || "-"}`), x + 25, y + 15.2);
  doc.text(safePdf(`Cantidad: ${lote.cantidad || "-"}   Hora: ${lote.hora || "-"}   Aerobotics: ${lote.aerobotics_realizado ? "Si" : "No"}   Fotos: ${photoCount}`), x + 25, y + 20.3);

  drawQualityPill(doc, x + w - 34, y + 7, lote.calidad, qualityColor, softColor, 27);

  const detailTop = y + 27;
  doc.setDrawColor(...PDF_THEME.border);
  doc.line(x + 8, detailTop - 3, x + w - 8, detailTop - 3);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(6.5);
  doc.setTextColor(...PDF_THEME.primaryDark);
  doc.text("OBSERVACION", x + 9, detailTop);
  doc.text("ACCION RECOMENDADA", x + 150, detailTop);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(...PDF_THEME.text);
  doc.text(observations, x + 9, detailTop + 5);
  doc.text(action, x + 150, detailTop + 5);

  if ((lote.defectos ?? []).length > 0) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(6.5);
    doc.setTextColor(...PDF_THEME.muted);
    doc.text("Defectos:", x + 9, y + cardHeight - 5);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...PDF_THEME.text);
    doc.text(safePdf((lote.defectos ?? []).join(", ")), x + 23, y + cardHeight - 5);
  }

  return cardHeight;
}

export function exportCalidadToExcel(jornada: CalidadJornada, lotes: CalidadLote[], adjuntos: CalidadAdjunto[]) {
  const counts = attachmentCountMap(adjuntos);
  const summary = calidadSummary(lotes, counts);
  const wb = createWorkbook("Lasarte SAT - Jornada de Calidad", "Notas de lotes y control de calidad");

  const resumen = appendAoaSheet(
    wb,
    "Resumen",
    [
      ["", "", "", "", ""],
      ["Jornada de Calidad", "", "", "", ""],
      ["Indicador", "Valor", "Lectura", "Calidad", "Lotes"],
      ["Fecha", formatCalidadDate(jornada.fecha), `Responsable: ${jornada.responsable || "-"}`, "Generado", new Date().toLocaleString("es-ES")],
      ["Lotes anotados", summary.total, "Total de entradas revisadas", "Bueno", summary.byQuality.Bueno],
      ["Aerobotics realizados", summary.aerobotics, percentageLabel(summary.aerobotics, summary.total), "Regular", summary.byQuality.Regular],
      ["Fotos adjuntas", summary.fotos, "Evidencias guardadas", "Deficiente", summary.byQuality.Deficiente],
      ["Lotes con incidencia", buildCalidadIncidentRows(lotes, counts).length, "Regular, deficiente, pesimo o con notas", "Pésimo", summary.byQuality.Pésimo],
      [],
      ["Uso del informe", "Abrir Lotes para filtrar todos los registros. Abrir Incidencias para revisar solo lo que necesita seguimiento.", "", "", ""],
    ],
    [24, 12, 48, 18, 12],
  );
  resumen["!merges"] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 3 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: 4 } },
    { s: { r: 9, c: 1 }, e: { r: 9, c: 4 } },
  ];
  styleRange(resumen, "A1:E2", {
    font: { bold: true, color: { rgb: "FFFFFF" } },
    fill: { fgColor: { rgb: "1F5039" } },
    alignment: { horizontal: "center", vertical: "center" },
  });
  styleRange(resumen, "A3:E3", {
    font: { bold: true, color: { rgb: "FFFFFF" } },
    fill: { fgColor: { rgb: "C96B21" } },
    alignment: { horizontal: "center" },
  });
  resumen["!rows"] = [{ hpt: 72 }, { hpt: 24 }, { hpt: 19 }];

  appendRowsSheet(wb, "Lotes", buildCalidadExcelRows(lotes, counts), [14, 16, 30, 18, 22, 16, 12, 20, 14, 34, 22, 16, 34, 22, 58, 50, 28, 28, 10], {
    freezeHeader: true,
  });

  appendRowsSheet(
    wb,
    "Incidencias",
    buildCalidadIncidentRows(lotes, counts),
    [16, 14, 16, 30, 18, 22, 16, 12, 14, 34, 22, 16, 34, 58, 50, 28, 28, 10],
    { freezeHeader: true },
  );

  appendRowsSheet(
    wb,
    "Adjuntos",
    buildCalidadAttachmentRows(jornada, lotes, adjuntos),
    [14, 16, 30, 14, 36, 22, 80],
    { freezeHeader: true },
  );

  appendDictionarySheet(wb, [
    { Hoja: "Resumen", Campo: "Indicador", Descripcion: "Lectura rapida del dia de calidad con KPIs y distribucion por estado.", Uso: "Informe diario." },
    { Hoja: "Lotes", Campo: "Una fila por lote", Descripcion: "Datos separados por columnas para filtrar y cruzar.", Uso: "Trabajo en Excel." },
    { Hoja: "Incidencias", Campo: "Prioridad", Descripcion: "Lotes que requieren seguimiento por calidad, defectos, observacion o accion.", Uso: "Revision de Calidad." },
    { Hoja: "Adjuntos", Campo: "Ruta storage", Descripcion: "Referencia de fotos y documentos guardados.", Uso: "Trazabilidad." },
  ]);

  saveWorkbook(wb, `calidad_${jornada.fecha}.xlsx`);
}

export function exportCalidadToPDF(
  jornada: CalidadJornada,
  lotes: CalidadLote[],
  adjuntos: CalidadAdjunto[],
  options: { mode?: "borrador" | "oficial" } = {},
) {
  const mode = options.mode ?? "borrador";
  const filteredLotes = mode === "oficial" ? lotes.filter((l) => l.informe_estado === "validado") : lotes;
  const counts = attachmentCountMap(adjuntos);
  const summary = calidadSummary(filteredLotes, counts);
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const pageRef = { value: 1 };
  drawCalidadHeader(doc, jornada, summary, pageRef.value);

  doc.setFillColor(...PDF_THEME.forest);
  doc.roundedRect(10, 25, 277, 34, 2, 2, "F");
  doc.setFillColor(...PDF_THEME.primary);
  doc.roundedRect(10, 25, 277, 3, 1, 1, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.setTextColor(...PDF_THEME.white);
  doc.text("Jornada de Calidad", 18, 40);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.text(safePdf("Notas de lotes, incidencias y trazabilidad diaria"), 18, 49);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text(safePdf(formatCalidadDate(jornada.fecha)), 278, 39, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.text(safePdf(`Responsable: ${jornada.responsable || "-"}`), 278, 47, { align: "right" });

  if (mode === "oficial") {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    doc.setTextColor(...PDF_THEME.success);
    doc.text("INFORME OFICIAL - VALIDADO", 278, 54, { align: "right" });
  }

  [
    { label: "LOTES", value: String(summary.total), sub: "anotados", color: PDF_THEME.forest },
    { label: "AEROBOTICS", value: String(summary.aerobotics), sub: percentageLabel(summary.aerobotics, summary.total), color: PDF_THEME.info },
    { label: "BUENO", value: String(summary.byQuality.Bueno), sub: percentageLabel(summary.byQuality.Bueno, summary.total), color: PDF_THEME.success },
    { label: "REVISAR", value: String(summary.byQuality.Regular + summary.byQuality.Deficiente + summary.byQuality.Pésimo), sub: "con seguimiento", color: PDF_THEME.warning },
    { label: "FOTOS", value: String(summary.fotos), sub: "adjuntas", color: PDF_THEME.primary },
  ].forEach((metric, index) => drawMetricTile(doc, 10 + index * 56.4, 66, 52, metric.label, metric.value, metric.sub, metric.color));

  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(...PDF_THEME.primaryDark);
  doc.text("Distribucion por calidad", 10, 97);
  let qualityX = 10;
  CALIDAD_OPTIONS.forEach((quality) => {
    const value = summary.byQuality[quality];
    drawQualityPill(doc, qualityX, 101, `${quality}: ${value}`, QUALITY_PDF_COLORS[quality], QUALITY_SOFT_COLORS[quality], 38);
    qualityX += 42;
  });

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(...PDF_THEME.text);
  doc.text("Detalle de lotes", 10, 119);

  let y = 124;
  filteredLotes.forEach((lote, index) => {
    const photoCount = counts[lote.id] ?? 0;
    const previewObs = doc.splitTextToSize(safePdf(lote.observacion || "Sin observacion registrada."), 128).slice(0, 4);
    const previewAction = doc.splitTextToSize(safePdf(lote.accion_recomendada || "Sin accion recomendada."), 118).slice(0, 4);
    const needed = 31 + Math.max(14, previewObs.length * 4.2 + 3, previewAction.length * 4.2 + 3) + (lote.defectos.length > 0 ? 9 : 0);
    y = ensurePdfSpace(doc, y, needed + 6, jornada, summary, pageRef);
    const height = drawLoteCard(doc, lote, index, photoCount, 10, y, 277);
    y += height + 6;
  });

  if (filteredLotes.length === 0) {
    doc.setFillColor(...PDF_THEME.cream);
    doc.roundedRect(10, y, 277, 24, 2, 2, "F");
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(...PDF_THEME.muted);
    doc.text("No hay lotes anotados para esta jornada.", 148.5, y + 14, { align: "center" });
  }

  if (mode === "borrador") {
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    for (let i = 1; i <= doc.getNumberOfPages(); i++) {
      doc.setPage(i);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(48);
      doc.setTextColor(200, 200, 200);
      doc.text("BORRADOR", pageWidth / 2, pageHeight / 2, { align: "center", angle: 45 });
    }
  }

  const suffix = mode === "oficial" ? "oficial" : "borrador";
  doc.save(`calidad_${jornada.fecha}_${suffix}.pdf`);
}

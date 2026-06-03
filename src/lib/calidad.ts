import jsPDF from "jspdf";
import * as XLSX from "xlsx";
import { appendAoaSheet, appendDictionarySheet, appendRowsSheet, createWorkbook, saveWorkbook } from "@/lib/exportWorkbook";
import { PDF_THEME } from "@/lib/exportTheme";
import { formatDate } from "@/lib/format";

export const CALIDAD_OPTIONS = ["Bueno", "Regular", "Deficiente", "Rechazado"] as const;
export type CalidadEstado = typeof CALIDAD_OPTIONS[number];

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
  observacion: string;
  accion_recomendada: string;
  created_at?: string;
  updated_at?: string;
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

export function calidadSummary(lotes: CalidadLote[], attachmentCounts: Record<string, number> = {}): CalidadSummary {
  const byQuality = Object.fromEntries(CALIDAD_OPTIONS.map((quality) => [quality, 0])) as Record<CalidadEstado, number>;
  for (const lote of lotes) {
    byQuality[lote.calidad] += 1;
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
    Defectos: lote.defectos.join(", "),
    Observacion: lote.observacion,
    "Accion recomendada": lote.accion_recomendada,
    Fotos: attachmentCounts[lote.id] ?? 0,
  }));
}

export function buildCalidadIncidentRows(lotes: CalidadLote[], attachmentCounts: Record<string, number> = {}) {
  return lotes
    .filter((lote) => lote.calidad !== "Bueno" || lote.defectos.length > 0 || lote.observacion.trim() || lote.accion_recomendada.trim())
    .map((lote) => ({
      Prioridad: lote.calidad === "Rechazado" ? "Alta" : lote.calidad === "Deficiente" ? "Media" : "Seguimiento",
      Fecha: formatCalidadDate(lote.fecha),
      Lote: lote.numero_lote,
      "Productor/Finca": lote.productor_finca_nombre,
      Producto: lote.producto,
      Variedad: lote.variedad,
      Cantidad: lote.cantidad,
      Hora: lote.hora ?? "",
      Calidad: lote.calidad,
      Defectos: lote.defectos.join(", "),
      Observacion: lote.observacion,
      "Accion recomendada": lote.accion_recomendada,
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
  Bueno: PDF_THEME.success,
  Regular: PDF_THEME.warning,
  Deficiente: PDF_THEME.primary,
  Rechazado: PDF_THEME.destructive,
};

const QUALITY_SOFT_COLORS: Record<CalidadEstado, [number, number, number]> = {
  Bueno: [232, 246, 237],
  Regular: [255, 246, 222],
  Deficiente: [255, 237, 221],
  Rechazado: [255, 235, 234],
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

function polishWorksheet(ws: XLSX.WorkSheet, headerRow = 0, widthHint?: number[]) {
  if (widthHint) ws["!cols"] = widthHint.map((wch) => ({ wch }));
  const range = ws["!ref"];
  if (!range) return;
  const decoded = XLSX.utils.decode_range(range);
  ws["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: headerRow, c: 0 }, e: decoded.e }) };
  ws["!freeze"] = { xSplit: 0, ySplit: headerRow + 1 };
  ws["!rows"] = Array.from({ length: decoded.e.r + 1 }, (_, row) => ({ hpt: row === headerRow ? 24 : 20 }));
  styleRange(ws, XLSX.utils.encode_range({ s: { r: headerRow, c: 0 }, e: { r: headerRow, c: decoded.e.c } }), {
    font: { bold: true, color: { rgb: "FFFFFF" } },
    fill: { fgColor: { rgb: "1F5039" } },
    alignment: { vertical: "center", horizontal: "center", wrapText: true },
  });
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

  if (lote.defectos.length > 0) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(6.5);
    doc.setTextColor(...PDF_THEME.muted);
    doc.text("Defectos:", x + 9, y + cardHeight - 5);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...PDF_THEME.text);
    doc.text(safePdf(lote.defectos.join(", ")), x + 23, y + cardHeight - 5);
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
      ["LASARTE SAT", "", "", "", ""],
      ["Jornada de Calidad", "", "", "", ""],
      [formatCalidadDate(jornada.fecha), "", `Responsable: ${jornada.responsable || "-"}`, "", `Generado: ${new Date().toLocaleString("es-ES")}`],
      [],
      ["Indicador", "Valor", "Lectura", "Calidad", "Lotes"],
      ["Lotes anotados", summary.total, "Total de entradas revisadas", "Bueno", summary.byQuality.Bueno],
      ["Aerobotics realizados", summary.aerobotics, percentageLabel(summary.aerobotics, summary.total), "Regular", summary.byQuality.Regular],
      ["Fotos adjuntas", summary.fotos, "Evidencias guardadas", "Deficiente", summary.byQuality.Deficiente],
      ["Lotes con incidencia", buildCalidadIncidentRows(lotes, counts).length, "Regular, deficiente, rechazado o con notas", "Rechazado", summary.byQuality.Rechazado],
      [],
      ["Uso del informe", "Abrir Lotes para filtrar todos los registros. Abrir Incidencias para revisar solo lo que necesita seguimiento.", "", "", ""],
    ],
    [24, 12, 48, 18, 12],
  );
  resumen["!merges"] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 4 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: 4 } },
    { s: { r: 10, c: 1 }, e: { r: 10, c: 4 } },
  ];
  styleRange(resumen, "A1:E2", {
    font: { bold: true, color: { rgb: "FFFFFF" } },
    fill: { fgColor: { rgb: "1F5039" } },
    alignment: { horizontal: "center", vertical: "center" },
  });
  styleRange(resumen, "A5:E5", {
    font: { bold: true, color: { rgb: "FFFFFF" } },
    fill: { fgColor: { rgb: "C96B21" } },
    alignment: { horizontal: "center" },
  });
  resumen["!rows"] = [{ hpt: 24 }, { hpt: 32 }, { hpt: 22 }, { hpt: 8 }, { hpt: 24 }];

  const lotesSheet = appendRowsSheet(wb, "Lotes", buildCalidadExcelRows(lotes, counts), [14, 16, 30, 18, 22, 16, 12, 20, 14, 34, 58, 50, 10], {
    freezeHeader: true,
  });
  polishWorksheet(lotesSheet, 0, [14, 16, 30, 18, 22, 16, 12, 20, 14, 34, 58, 50, 10]);

  const incidenciasSheet = appendRowsSheet(
    wb,
    "Incidencias",
    buildCalidadIncidentRows(lotes, counts),
    [16, 14, 16, 30, 18, 22, 16, 12, 14, 34, 58, 50, 10],
    { freezeHeader: true },
  );
  polishWorksheet(incidenciasSheet, 0, [16, 14, 16, 30, 18, 22, 16, 12, 14, 34, 58, 50, 10]);

  const adjuntosSheet = appendRowsSheet(
    wb,
    "Adjuntos",
    buildCalidadAttachmentRows(jornada, lotes, adjuntos),
    [14, 16, 30, 14, 36, 22, 80],
    { freezeHeader: true },
  );
  polishWorksheet(adjuntosSheet, 0, [14, 16, 30, 14, 36, 22, 80]);

  appendDictionarySheet(wb, [
    { Hoja: "Resumen", Campo: "Indicador", Descripcion: "Lectura rapida del dia de calidad con KPIs y distribucion por estado.", Uso: "Informe diario." },
    { Hoja: "Lotes", Campo: "Una fila por lote", Descripcion: "Datos separados por columnas para filtrar y cruzar.", Uso: "Trabajo en Excel." },
    { Hoja: "Incidencias", Campo: "Prioridad", Descripcion: "Lotes que requieren seguimiento por calidad, defectos, observacion o accion.", Uso: "Revision de Calidad." },
    { Hoja: "Adjuntos", Campo: "Ruta storage", Descripcion: "Referencia de fotos y documentos guardados.", Uso: "Trazabilidad." },
  ]);

  saveWorkbook(wb, `calidad_${jornada.fecha}.xlsx`);
}

export function exportCalidadToPDF(jornada: CalidadJornada, lotes: CalidadLote[], adjuntos: CalidadAdjunto[]) {
  const counts = attachmentCountMap(adjuntos);
  const summary = calidadSummary(lotes, counts);
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

  [
    { label: "LOTES", value: String(summary.total), sub: "anotados", color: PDF_THEME.forest },
    { label: "AEROBOTICS", value: String(summary.aerobotics), sub: percentageLabel(summary.aerobotics, summary.total), color: PDF_THEME.info },
    { label: "BUENO", value: String(summary.byQuality.Bueno), sub: percentageLabel(summary.byQuality.Bueno, summary.total), color: PDF_THEME.success },
    { label: "REVISAR", value: String(summary.byQuality.Regular + summary.byQuality.Deficiente + summary.byQuality.Rechazado), sub: "con seguimiento", color: PDF_THEME.warning },
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
  lotes.forEach((lote, index) => {
    const photoCount = counts[lote.id] ?? 0;
    const previewObs = doc.splitTextToSize(safePdf(lote.observacion || "Sin observacion registrada."), 128).slice(0, 4);
    const previewAction = doc.splitTextToSize(safePdf(lote.accion_recomendada || "Sin accion recomendada."), 118).slice(0, 4);
    const needed = 31 + Math.max(14, previewObs.length * 4.2 + 3, previewAction.length * 4.2 + 3) + (lote.defectos.length > 0 ? 9 : 0);
    y = ensurePdfSpace(doc, y, needed + 6, jornada, summary, pageRef);
    const height = drawLoteCard(doc, lote, index, photoCount, 10, y, 277);
    y += height + 6;
  });

  if (lotes.length === 0) {
    doc.setFillColor(...PDF_THEME.cream);
    doc.roundedRect(10, y, 277, 24, 2, 2, "F");
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(...PDF_THEME.muted);
    doc.text("No hay lotes anotados para esta jornada.", 148.5, y + 14, { align: "center" });
  }

  doc.save(`calidad_${jornada.fecha}.pdf`);
}

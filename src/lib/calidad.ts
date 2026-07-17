import jsPDF from "jspdf";
import type { Worksheet } from "exceljs";
import { unzipSync } from "fflate";
import { getISOWeek, getISOWeekYear } from "date-fns";
import {
  añadirHojaTabla,
  crearLibroLasarte,
  descargarLibro,
  FMT_INT,
  LASARTE_COLORS,
  type ColumnaTabla,
} from "@/lib/exportKit";
import { drawExportFooter, drawExportHeader, finalizeExportPageNumbers, PDF_THEME } from "@/lib/exportTheme";
import { buildLasarteFilename, ensureExportLogoLoaded } from "@/lib/reportKit";
import { formatDate } from "@/lib/format";
import { lineaExportInfo, safeText } from "@/lib/pdfKit";

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

// Las fotos son OPCIONALES para validar (peticion del dueño, jul 2026): se
// puede validar un informe sin adjuntos. El parametro _photoCount se conserva
// por compatibilidad de firma con los llamadores.
export function canValidateCalidadLote(lote: CalidadLote, _photoCount: number): CalidadValidationResult {
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
    lote.hora ? `${formatHoraCorta(lote.hora)} h` : "hora pendiente",
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
    current.hora ? `${formatHoraCorta(current.hora)} h` : "hora pendiente",
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

// ── Importar lotes del parte del día ────────────────────────────────────────

/** Fila mínima de `lotes_dia` necesaria para prellenar un lote de calidad. */
export interface LoteDiaImportable {
  lote_codigo: string | null;
  productor: string | null;
  producto: string | null;
  kg_peso_total: number | null;
  hora_inicio: string | null;
}

/** Formatea kg como "20.635 kg" (separador de miles es-ES) para el campo cantidad. */
export function formatKgCantidad(kg: number | null | undefined): string {
  if (!kg || kg <= 0) return "";
  return `${new Intl.NumberFormat("es-ES", { maximumFractionDigits: 0 }).format(Math.round(kg))} kg`;
}

/** Recorta un valor de hora (timestamp o HH:mm:ss) a "HH:mm". */
export function formatHoraCorta(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = value.match(/(\d{1,2}):(\d{2})/);
  if (!match) return null;
  return `${match[1].padStart(2, "0")}:${match[2]}`;
}

/**
 * Compara un `numero_lote` de calidad con un `lote_codigo` de producción:
 * mismo criterio de normalización (trim + case-insensitive es) usado para el
 * cruce calidad↔productor en la ficha de Productores.
 */
export function sameLoteCodigo(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = (a ?? "").trim();
  const nb = (b ?? "").trim();
  if (!na || !nb) return false;
  return na.localeCompare(nb, "es", { sensitivity: "accent" }) === 0;
}

/**
 * Construye los payloads de `calidad_lotes` a insertar a partir de los lotes
 * de producción del día (`lotes_dia`) que todavía no existan en la jornada de
 * calidad (comparando numero_lote vs lote_codigo). No incluye lotes sin código.
 */
export function buildLotesParaImportar(
  lotesDia: LoteDiaImportable[],
  lotesExistentes: Pick<CalidadLote, "numero_lote">[],
): Array<{ numero_lote: string; productor_finca_nombre: string; producto: string; cantidad: string; hora: string | null }> {
  const existentes = lotesExistentes.map((lote) => lote.numero_lote);
  const vistos = new Set<string>();
  const result: Array<{ numero_lote: string; productor_finca_nombre: string; producto: string; cantidad: string; hora: string | null }> = [];

  for (const lote of lotesDia) {
    const codigo = (lote.lote_codigo ?? "").trim();
    if (!codigo) continue;
    if (existentes.some((numero) => sameLoteCodigo(numero, codigo))) continue;
    if ([...vistos].some((v) => sameLoteCodigo(v, codigo))) continue;
    vistos.add(codigo);

    result.push({
      numero_lote: codigo,
      productor_finca_nombre: normalizeCalidadName(lote.productor ?? ""),
      producto: normalizeCalidadName(lote.producto ?? "") || "Naranja",
      cantidad: formatKgCantidad(lote.kg_peso_total),
      hora: formatHoraCorta(lote.hora_inicio),
    });
  }

  return result;
}

// ── Histórico (últimas semanas) ─────────────────────────────────────────────

/** Etiqueta de semana ISO ("2026-W27") a partir de una fecha "YYYY-MM-DD". */
export function isoWeekKey(fecha: string): string {
  const date = new Date(`${fecha}T12:00:00`);
  if (Number.isNaN(date.getTime())) return fecha;
  const year = getISOWeekYear(date);
  const week = getISOWeek(date);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

export interface CalidadHistoricoSemana {
  key: string;
  label: string;
  total: number;
  byQuality: Record<CalidadEstado, number>;
}

export interface CalidadHistoricoDefecto {
  defecto: string;
  count: number;
}

export interface CalidadHistoricoProductor {
  productor: string;
  notas: number;
  incidencias: number;
  pctIncidencias: number;
  ultimaFecha: string;
}

export interface CalidadHistoricoResumen {
  semanas: CalidadHistoricoSemana[];
  defectos: CalidadHistoricoDefecto[];
  productores: CalidadHistoricoProductor[];
}

/** Considera "incidencia" un lote Regular/Deficiente/Pésimo o con algún defecto marcado. */
export function esIncidenciaCalidad(lote: Pick<CalidadLote, "calidad" | "defectos">): boolean {
  return lote.calidad === "Regular" || lote.calidad === "Deficiente" || lote.calidad === "Pésimo" || (lote.defectos ?? []).length > 0;
}

/**
 * Agrega lotes de calidad de las últimas semanas en: distribución semanal por
 * estado, top defectos y ranking de productores con más incidencias. Pensado
 * para la pestaña "Histórico" (v1 informativa, sin drill-down).
 */
export function buildCalidadHistorico(lotes: CalidadLote[]): CalidadHistoricoResumen {
  const porSemana = new Map<string, CalidadHistoricoSemana>();
  for (const lote of lotes) {
    const key = isoWeekKey(lote.fecha);
    const entry = porSemana.get(key) ?? {
      key,
      label: key.replace("-W", " · Sem "),
      total: 0,
      byQuality: Object.fromEntries(CALIDAD_OPTIONS.map((q) => [q, 0])) as Record<CalidadEstado, number>,
    };
    entry.total += 1;
    if (lote.calidad in entry.byQuality) entry.byQuality[lote.calidad] += 1;
    porSemana.set(key, entry);
  }
  const semanas = Array.from(porSemana.values()).sort((a, b) => a.key.localeCompare(b.key));

  const defectosCount = new Map<string, number>();
  for (const lote of lotes) {
    for (const defecto of lote.defectos ?? []) {
      defectosCount.set(defecto, (defectosCount.get(defecto) ?? 0) + 1);
    }
  }
  const defectos = Array.from(defectosCount.entries())
    .map(([defecto, count]) => ({ defecto, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  const porProductor = new Map<string, { notas: number; incidencias: number; ultimaFecha: string }>();
  for (const lote of lotes) {
    const nombre = normalizeCalidadName(lote.productor_finca_nombre || "");
    if (!nombre) continue;
    const entry = porProductor.get(nombre) ?? { notas: 0, incidencias: 0, ultimaFecha: lote.fecha };
    entry.notas += 1;
    if (esIncidenciaCalidad(lote)) entry.incidencias += 1;
    if (lote.fecha > entry.ultimaFecha) entry.ultimaFecha = lote.fecha;
    porProductor.set(nombre, entry);
  }
  const productores = Array.from(porProductor.entries())
    .map(([productor, v]) => ({
      productor,
      notas: v.notas,
      incidencias: v.incidencias,
      pctIncidencias: v.notas > 0 ? (v.incidencias / v.notas) * 100 : 0,
      ultimaFecha: v.ultimaFecha,
    }))
    .filter((p) => p.incidencias > 0)
    .sort((a, b) => b.incidencias - a.incidencias || b.pctIncidencias - a.pctIncidencias);

  return { semanas, defectos, productores };
}

export function buildCalidadExcelRows(lotes: CalidadLote[], attachmentCounts: Record<string, number> = {}) {
  return lotes.map((lote) => ({
    Fecha: formatCalidadDate(lote.fecha),
    Lote: lote.numero_lote,
    "Productor/Finca": lote.productor_finca_nombre,
    Producto: lote.producto,
    Variedad: lote.variedad,
    Box: lote.cantidad,
    Hora: formatHoraCorta(lote.hora) ?? "",
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
      Box: lote.cantidad,
      Hora: formatHoraCorta(lote.hora) ?? "",
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

// safePdf() ELIMINABA tildes/e\u00f1es ("Com\u00fan" -> "Comun") \u2014 corregido: jsPDF con
// la fuente est\u00e1ndar "helvetica" SI las soporta (verificado con un PDF real).
// `safeText` (pdfKit.ts) solo recorta espacios/caracteres de control.
const safePdf = safeText;

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

// Nota de trazabilidad de calidad (spec §0.4 "Calidad/trazabilidad"): sustituye
// al texto legal generico de clasificacion "Interno" en el pie de cada pagina,
// porque este informe es control de produccion/trazabilidad agroalimentaria,
// no un documento interno cualquiera.
const CALIDAD_TRAZABILIDAD_NOTE =
  "Documento de control interno asociado a produccion, calidad y trazabilidad agroalimentaria.";

function drawCalidadFooterLegend(doc: jsPDF) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  doc.setFont("helvetica", "bold");
  doc.setFontSize(5.5);
  doc.setTextColor(...PDF_THEME.destructive);
  doc.text(CALIDAD_TRAZABILIDAD_NOTE, pageWidth / 2, pageHeight - 4, { align: "center", maxWidth: pageWidth - 16 });
}

// Cabecera/pie con marca comun LASARTE (spec §0.3/§0.4): usa el mismo motor que
// el resto de exports PDF ya migrados (drawExportHeader/drawExportFooter de
// exportTheme.ts) en vez de dibujar una banda propia; el pie legal usa la nota
// de trazabilidad de calidad en vez del texto generico de "Interno".
// Identificador de exportación del documento en curso (mismo id en el pie de
// todas las páginas, paridad con el pie del Excel). Se fija en exportCalidadToPDF.
let currentExportInfo: string | undefined;

function drawCalidadHeader(doc: jsPDF, jornada: CalidadJornada, summary: CalidadSummary, pageIndex: number) {
  drawExportHeader(
    doc,
    pageIndex,
    "Departamento de Calidad",
    safePdf(`${formatCalidadDate(jornada.fecha)} - ${summary.total} lotes anotados`),
  );
  drawExportFooter(doc, { exportInfo: currentExportInfo });
  drawCalidadFooterLegend(doc);
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

// Calcula el layout de texto de la ficha de un lote (observacion/accion, alto de
// tarjeta) una sola vez, compartido entre el calculo previo de espacio en pagina
// (ensurePdfSpace) y el dibujado real (drawLoteCard), para que ambos coincidan
// siempre. La accion recomendada solo se reserva/dibuja si tiene contenido
// (coherente con CalidadInformeDialog: sin placeholder "Sin accion..." en el PDF).
function computeLoteCardLayout(doc: jsPDF, lote: CalidadLote) {
  const hasAccion = !!(lote.accion_recomendada ?? "").trim();
  const observations = doc.splitTextToSize(safePdf(lote.observacion || "Sin observacion registrada."), hasAccion ? 128 : 258).slice(0, 4);
  const action = hasAccion ? doc.splitTextToSize(safePdf(lote.accion_recomendada), 118).slice(0, 4) : [];
  const detailHeight = Math.max(14, observations.length * 4.2 + 3, hasAccion ? action.length * 4.2 + 3 : 0);
  const cardHeight = 31 + detailHeight + (lote.defectos.length > 0 ? 9 : 0);
  return { hasAccion, observations, action, cardHeight };
}

function drawLoteCard(doc: jsPDF, lote: CalidadLote, index: number, photoCount: number, x: number, y: number, w: number) {
  const qualityColor = QUALITY_PDF_COLORS[lote.calidad];
  const softColor = QUALITY_SOFT_COLORS[lote.calidad];
  const { hasAccion, observations, action, cardHeight } = computeLoteCardLayout(doc, lote);

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
  doc.text(safePdf(`Box: ${lote.cantidad || "-"}   Hora: ${formatHoraCorta(lote.hora) || "-"}   Aerobotics: ${lote.aerobotics_realizado ? "Si" : "No"}   Fotos: ${photoCount}`), x + 25, y + 20.3);

  drawQualityPill(doc, x + w - 34, y + 7, lote.calidad, qualityColor, softColor, 27);

  const detailTop = y + 27;
  doc.setDrawColor(...PDF_THEME.border);
  doc.line(x + 8, detailTop - 3, x + w - 8, detailTop - 3);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(6.5);
  doc.setTextColor(...PDF_THEME.primaryDark);
  doc.text("OBSERVACION", x + 9, detailTop);
  if (hasAccion) doc.text("ACCION RECOMENDADA", x + 150, detailTop);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(...PDF_THEME.text);
  doc.text(observations, x + 9, detailTop + 5);
  if (hasAccion) doc.text(action, x + 150, detailTop + 5);

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

// Columnas de la hoja "Informe calidad" (spec §6 de docs/EXPORT_TEMPLATES_SPEC.md):
// una fila por lote, 20 columnas. Las claves coinciden EXACTAMENTE con las que ya
// devuelve buildCalidadExcelRows (no se toca esa funcion, solo se proyecta).
const COLUMNAS_INFORME_CALIDAD: ColumnaTabla[] = [
  { header: "Fecha", key: "Fecha", width: 13, align: "center" },
  { header: "Lote", key: "Lote", width: 16 },
  { header: "Productor/Finca", key: "Productor/Finca", width: 26 },
  { header: "Producto", key: "Producto", width: 16 },
  { header: "Variedad", key: "Variedad", width: 20 },
  { header: "Box", key: "Box", width: 14, align: "center" },
  { header: "Hora", key: "Hora", width: 9, align: "center" },
  { header: "Aerobotics realizado", key: "Aerobotics realizado", width: 16, align: "center" },
  { header: "Calidad", key: "Calidad", width: 14 },
  { header: "Defectos", key: "Defectos", width: 30 },
  { header: "Otro defecto", key: "Otro defecto", width: 22 },
  { header: "Estado informe", key: "Estado informe", width: 16 },
  { header: "Informe generado", key: "Informe generado", width: 50 },
  { header: "IA calidad", key: "IA calidad", width: 16 },
  { header: "IA defectos", key: "IA defectos", width: 26 },
  { header: "Observación", key: "Observacion", width: 44 },
  { header: "Acción recomendada", key: "Accion recomendada", width: 40 },
  { header: "Validado", key: "Validado", width: 26 },
  { header: "Reabierto", key: "Reabierto", width: 26 },
  { header: "Fotos", key: "Fotos", numFmt: FMT_INT, align: "right", width: 10 },
];

// Columnas de la hoja "Incidencias" (spec §7): subconjunto priorizado, misma
// fuente de filas (buildCalidadIncidentRows) que ya trae mas claves de las que
// se muestran aqui; añadirHojaTabla proyecta solo las columnas declaradas.
const COLUMNAS_INCIDENCIAS_CALIDAD: ColumnaTabla[] = [
  { header: "Prioridad", key: "Prioridad", width: 14 },
  { header: "Fecha", key: "Fecha", width: 13, align: "center" },
  { header: "Lote", key: "Lote", width: 16 },
  { header: "Productor/Finca", key: "Productor/Finca", width: 26 },
  { header: "Producto", key: "Producto", width: 16 },
  { header: "Variedad", key: "Variedad", width: 20 },
  { header: "Box", key: "Box", width: 14, align: "center" },
  { header: "Hora", key: "Hora", width: 9, align: "center" },
  { header: "Calidad", key: "Calidad", width: 14 },
  { header: "Defectos", key: "Defectos", width: 30 },
  { header: "Estado informe", key: "Estado informe", width: 16 },
  { header: "Observación", key: "Observacion", width: 46 },
  { header: "Acción recomendada", key: "Accion recomendada", width: 42 },
];

// Nota de trazabilidad de calidad (spec §0.4 "Calidad/trazabilidad"): se añade
// como linea de pie adicional bajo el pie legal generico que ya escribe
// añadirHojaTabla para clasificacion "Interno", porque calidad es control de
// produccion/trazabilidad agroalimentaria, no un documento interno generico.
const NOTA_TRAZABILIDAD_CALIDAD_XLSX =
  "Documento de control interno asociado a producción, calidad y trazabilidad agroalimentaria.";

function añadirNotaTrazabilidadCalidad(ws: Worksheet, totalCols: number) {
  const rowIndex = ws.rowCount + 1;
  const cols = Math.max(totalCols, 1);
  ws.mergeCells(rowIndex, 1, rowIndex, cols);
  const cell = ws.getRow(rowIndex).getCell(1);
  cell.value = NOTA_TRAZABILIDAD_CALIDAD_XLSX;
  cell.font = { name: "Calibri", size: 7.5, italic: true, color: { argb: `FF${LASARTE_COLORS.grisMedio}` } };
  cell.alignment = { vertical: "middle", horizontal: "left", wrapText: true };
}

export async function exportCalidadToExcel(jornada: CalidadJornada, lotes: CalidadLote[], adjuntos: CalidadAdjunto[]) {
  const counts = attachmentCountMap(adjuntos);
  const filasInforme = buildCalidadExcelRows(lotes, counts);
  const filasIncidencias = buildCalidadIncidentRows(lotes, counts);

  const ctx = crearLibroLasarte({
    titulo: "Informe de calidad",
    periodo: formatCalidadDate(jornada.fecha),
    usuario: jornada.responsable || undefined,
    clasificacion: "Interno",
  });

  const hojaInforme = añadirHojaTabla(ctx, {
    nombreHoja: "Informe calidad",
    columnas: COLUMNAS_INFORME_CALIDAD,
    filas: filasInforme,
  });
  añadirNotaTrazabilidadCalidad(hojaInforme, COLUMNAS_INFORME_CALIDAD.length);

  const hojaIncidencias = añadirHojaTabla(ctx, {
    nombreHoja: "Incidencias",
    titulo: "Incidencias de calidad",
    columnas: COLUMNAS_INCIDENCIAS_CALIDAD,
    filas: filasIncidencias,
  });
  añadirNotaTrazabilidadCalidad(hojaIncidencias, COLUMNAS_INCIDENCIAS_CALIDAD.length);

  await descargarLibro(ctx, buildLasarteFilename("Calidad", "xlsx", { from: jornada.fecha }));
}

export async function exportCalidadToPDF(
  jornada: CalidadJornada,
  lotes: CalidadLote[],
  adjuntos: CalidadAdjunto[],
  options: { mode?: "borrador" | "oficial" } = {},
) {
  await ensureExportLogoLoaded();
  currentExportInfo = lineaExportInfo();
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
    const { cardHeight: needed } = computeLoteCardLayout(doc, lote);
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

  finalizeExportPageNumbers(doc);
  const suffix = mode === "oficial" ? "Oficial" : "Borrador";
  doc.save(buildLasarteFilename(`Calidad-${suffix}`, "pdf", { from: jornada.fecha }));
}

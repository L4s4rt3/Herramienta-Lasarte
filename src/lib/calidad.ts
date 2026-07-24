import jsPDF from "jspdf";
import type { Worksheet } from "exceljs";
import { unzipSync } from "fflate";
import { getISOWeek, getISOWeekYear } from "date-fns";
import {
  añadirHojaTabla,
  crearLibroLasarte,
  descargarLibro,
  FMT_INT,
  generarExportId,
  LASARTE_COLORS,
  type ColumnaTabla,
} from "@/lib/exportKit";
import { PDF_THEME } from "@/lib/exportTheme";
import { buildLasarteFilename, ensureExportLogoLoaded } from "@/lib/reportKit";
import { formatDate } from "@/lib/format";
import {
  cabeceraDocumento,
  cierreAtestacion,
  crearNumeradorSecciones,
  finalizarPaginacionFormal,
  pieLegal,
  portadaFormal,
  safeText,
  tituloSeccionNumerada,
  type MetadatoItem,
} from "@/lib/pdfKit";

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

/**
 * true si el error de Supabase es la FK de calidad_lotes.productor_finca_id:
 * el lote apunta a un productor que ya no existe porque una fusión/limpieza
 * del catálogo lo borró mientras la página de Calidad seguía abierta con la
 * lista antigua en memoria. El guardado puede recuperarse re-resolviendo el
 * productor por nombre (ver useCalidadJornadaMutaciones).
 */
export function esErrorProductorFincaFk(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const { code, message } = error as { code?: unknown; message?: unknown };
  return code === "23503" && typeof message === "string" && message.includes("calidad_lotes_productor_finca_id_fkey");
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

// El informe se unifica con el comentario (misma narrativa completa) para que
// ambos textos sean coherentes; ya no necesita trace/evidence/fotos propios.
export function createCalidadDraftReport(lote: CalidadLote, _photoCount: number, _history: CalidadLote[]): DraftReport {
  return {
    informe: construirObservacionCalidad(lote),
    accion_recomendada: CALIDAD_DESTINO[lote.calidad],
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

// Concuerda con "la calidad" (femenino): "la calidad se valora como buena/pésima".
const CALIDAD_ADJETIVO: Record<CalidadEstado, string> = {
  Excelente: "excelente",
  Bueno: "buena",
  Regular: "regular",
  Deficiente: "deficiente",
  Pésimo: "pésima",
};

// Matiz característico y genérico de cada defecto — solo elaboración de tipo
// (nunca datos concretos del lote como origen o cantidades, que el generador
// no puede conocer).
const CALIDAD_DEFECTO_MATIZ: Record<string, string> = {
  Rameado: "de carácter superficial y habitual en la variedad a estas alturas de campaña",
  Golpe: "localizado en algunas piezas y atribuible a la manipulación",
  Podrido: "en piezas puntuales, que se retiran durante el control de envasado",
  Mancha: "de tipo superficial y repartido en un porcentaje de las piezas",
  "Calibre irregular": "con presencia de calibres dispares a lo largo del lote",
  "Color verde": "con pigmentación residual concentrada en la zona peduncular",
  "Piel blanda": "asociado a un punto de madurez algo avanzado",
  Deshidratado: "leve y superficial, detectado durante el control de envasado",
  Plaga: "en piezas puntuales, que se marcan para revisión",
};

// Efecto del/los defecto(s) sobre la aptitud comercial del lote, por calidad.
// Dos formas por concordancia de número: la frase de 1 defecto usa el singular
// ("El único defecto... que afecta...") y la de 2+ defectos el plural ("Los
// defectos... que afectan...").
const CALIDAD_APTITUD_SINGULAR: Record<CalidadEstado, string> = {
  Excelente: "sin que comprometa la aptitud comercial del lote",
  Bueno: "sin que comprometa la aptitud comercial del lote",
  Regular: "que conviene vigilar aunque no compromete la aptitud del lote",
  Deficiente: "que afecta a la aptitud comercial y obliga a reclasificar parte del lote",
  Pésimo: "que compromete seriamente la aptitud comercial del lote",
};
const CALIDAD_APTITUD_PLURAL: Record<CalidadEstado, string> = {
  Excelente: "sin que comprometan la aptitud comercial del lote",
  Bueno: "sin que comprometan la aptitud comercial del lote",
  Regular: "que conviene vigilar aunque no comprometen la aptitud del lote",
  Deficiente: "que afectan a la aptitud comercial y obligan a reclasificar parte del lote",
  Pésimo: "que comprometen seriamente la aptitud comercial del lote",
};

// Destino/acción del lote (párrafo "Accion recomendada:"), por calidad.
const CALIDAD_DESTINO: Record<CalidadEstado, string> = {
  Excelente: "Dado que Mercadona no establece restricciones en sus categorías habituales, el lote se considera apto para su destino sin necesidad de aplicar medidas correctoras adicionales.",
  Bueno: "Dado que Mercadona no establece restricciones en sus categorías habituales, el lote se considera apto para su destino sin necesidad de aplicar medidas correctoras adicionales.",
  Regular: "El lote se destina a las categorías habituales de Mercadona con seguimiento en línea del calibre y el color, y se anota para revisión de criterio con el jefe de producción.",
  Deficiente: "Se recorta la primera categoría destinada a Mercadona y la fruta se reclasifica a segunda categoría o uso industrial, notificando a responsable para el ajuste de la planificación.",
  Pésimo: "El lote se bloquea a la espera de valoración; se documenta con fotografías y se escala a responsable de calidad antes de procesar.",
};

/**
 * Descompone el texto libre de cantidad ("104 box + 2 box reciclaje",
 * "20.635 kg"...) en un total legible y el nº de boxes de reciclaje incluidos,
 * para la frase de recepción de construirObservacionCalidad. null si no hay
 * cantidad registrada.
 */
function describirCantidad(cantidad: string): { total: string; reciclaje: number } | null {
  const value = (cantidad ?? "").trim();
  if (!value) return null;

  const reciclajeMatch = value.match(/(\d+)\s*box(?:es)?\s+(?:de\s+)?reciclaje/i);
  const reciclaje = reciclajeMatch ? Number(reciclajeMatch[1]) : 0;

  const boxMatch = value.match(/(\d+)\s*box/i);
  if (boxMatch) {
    const n = Number(boxMatch[1]);
    return { total: `${n} ${n === 1 ? "box" : "boxes"}`, reciclaje };
  }

  const kgMatch = value.match(/[\d.,]+\s*kg/i);
  if (kgMatch) return { total: kgMatch[0], reciclaje: 0 };

  return { total: value, reciclaje: 0 };
}

/**
 * Observación narrativa completa (registro de referencia del dueño, jul-2026):
 * incluye la trazabilidad de recepción (hora, finca, lote, producto/variedad,
 * cantidad y boxes de reciclaje), la valoración de calidad/Aerobotics y los
 * defectos detectados con su matiz característico y su efecto en la aptitud
 * comercial — a partir únicamente de los campos estructurados del lote, sin
 * inventar datos que el generador no puede conocer. Compartida por
 * buildCalidadComentarioSugerido y createCalidadDraftReport para que ambos
 * textos sean coherentes entre sí.
 */
function construirObservacionCalidad(lote: CalidadLote): string {
  const hora = formatHoraCorta(lote.hora);
  const finca = normalizeCalidadName(lote.productor_finca_nombre || "");
  const procedencia = finca ? `procedente de la finca ${finca}` : "de origen no especificado";
  const loteClause = lote.numero_lote ? `lote ${lote.numero_lote}` : "";
  const productoLower = (lote.producto || "fruta").toLocaleLowerCase("es");
  const variedad = (lote.variedad || "").trim();
  const productoClause = variedad ? `correspondiente a ${productoLower} variedad ${variedad}` : `correspondiente a ${productoLower}`;
  const cantidad = describirCantidad(lote.cantidad);
  const cantClause = cantidad
    ? `con un total de ${cantidad.total}${cantidad.reciclaje > 0 ? `, a las cuales ${cantidad.reciclaje} ${cantidad.reciclaje === 1 ? "es" : "son"} de reciclaje ${cantidad.reciclaje === 1 ? "incorporada" : "incorporadas"} sin especificar procedencia` : ""}`
    : "";
  const recepcion = `Se ha recibido${hora ? ` a las ${hora} h` : ""} un volcado ${[procedencia, loteClause, productoClause, cantClause].filter(Boolean).join(", ")}.`;

  const calidad = `La calidad general del lote se valora como ${CALIDAD_ADJETIVO[lote.calidad]}${lote.aerobotics_realizado ? ", contando con soporte del sistema Aerobotics durante la inspección" : ""}.`;

  const defectosMarcados = (lote.defectos ?? []).filter((defecto) => defecto !== "Otro" || (lote.defecto_otro ?? "").trim());
  const nombres = defectosMarcados.map((defecto) => (defecto === "Otro" ? (lote.defecto_otro ?? "").trim() : defecto.toLocaleLowerCase("es")));

  let defectos: string;
  if (nombres.length === 0) {
    defectos = "No se detectan defectos reseñables durante la inspección.";
  } else if (nombres.length === 1) {
    const matiz = defectosMarcados[0] === "Otro" ? "" : (CALIDAD_DEFECTO_MATIZ[defectosMarcados[0]] ?? "");
    defectos = `El único defecto detectado es ${nombres[0]}${matiz ? `, ${matiz}` : ""}, ${CALIDAD_APTITUD_SINGULAR[lote.calidad]}.`;
  } else {
    const lista = `${nombres.slice(0, -1).join(", ")} y ${nombres[nombres.length - 1]}`;
    defectos = `Los defectos detectados son ${lista}, ${CALIDAD_APTITUD_PLURAL[lote.calidad]}.`;
  }

  return [recepcion, calidad, defectos].join(" ");
}

/**
 * Genera el comentario sugerido como informe narrativo completo (registro de
 * referencia del dueño): observación con trazabilidad + acción/destino.
 * Determinista, sin IA. `_history` y `_photoCount` ya no se usan en el texto
 * (se mantienen por compatibilidad de firma con el llamador en
 * CalidadJornada.tsx).
 */
export function buildCalidadComentarioSugerido(current: CalidadLote, _history: CalidadLote[] = [], _photoCount = 0) {
  return normalizeComentario(`${construirObservacionCalidad(current)}\n\nAccion recomendada: ${CALIDAD_DESTINO[current.calidad]}`);
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

// Nota de trazabilidad de calidad (spec §0.4 "Calidad/trazabilidad"): antes se
// dibujaba como una 4ª línea del pie de página; el pie legal del registro
// FORMAL (pieLegal, pdfKit.ts) tiene exactamente 3 líneas fijas (spec del PDF
// de muestra), así que esta nota se traslada al bloque de metadatos de la
// portada (ver `metadatosExtra` en `exportCalidadToPDF`) en vez de al pie.
const CALIDAD_TRAZABILIDAD_NOTE =
  "Documento de control interno asociado a producción, calidad y trazabilidad agroalimentaria.";

// Cabecera/pie del REGISTRO FORMAL (encargo jul-2026): "DOCUMENTO Nº" +
// "FECHA EMISIÓN" + razón social/CIF/dirección en TODAS las páginas
// (cabeceraDocumento, pdfKit.ts) y el pie legal de 3 líneas con la Ref.
// Identificador y fecha de emisión del documento en curso (mismos en TODAS
// las páginas: cabecera, pie y cierre de atestación). Se fijan en exportCalidadToPDF.
let currentExportId: string | undefined;
let currentGeneradoEn: Date | undefined;

function drawCalidadHeader(doc: jsPDF) {
  cabeceraDocumento(doc, { documentoNumero: currentExportId ?? "", fechaEmision: currentGeneradoEn });
  pieLegal(doc, { exportId: currentExportId ?? "" });
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

function addPdfPage(doc: jsPDF) {
  doc.addPage();
  drawCalidadHeader(doc);
}

function ensurePdfSpace(doc: jsPDF, y: number, needed: number) {
  const pageHeight = doc.internal.pageSize.getHeight();
  if (y + needed <= pageHeight - 14) return y;
  addPdfPage(doc);
  return 26;
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
  currentGeneradoEn = new Date();
  currentExportId = generarExportId(currentGeneradoEn);
  const mode = options.mode ?? "borrador";
  const filteredLotes = mode === "oficial" ? lotes.filter((l) => l.informe_estado === "validado") : lotes;
  const counts = attachmentCountMap(adjuntos);
  const summary = calidadSummary(filteredLotes, counts);
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  drawCalidadHeader(doc);

  // OBJETO/PERIODO del bloque de metadatos formales (portada) y del párrafo
  // de cierre/atestación (última página) — el MISMO texto en ambos sitios.
  // La nota de trazabilidad agroalimentaria y el responsable de la jornada
  // (antes en el pie/banner propios) se trasladan aquí como metadatos extra.
  const objeto = "las anotaciones de calidad y trazabilidad de la jornada de producción";
  const periodoTexto = `${formatCalidadDate(jornada.fecha)} · ${summary.total} lote(s) anotados`;
  const metadatosExtra: MetadatoItem[] = [
    { etiqueta: "RESPONSABLE", valor: jornada.responsable || "-" },
    { etiqueta: "TRAZABILIDAD", valor: CALIDAD_TRAZABILIDAD_NOTE },
  ];
  if (mode === "oficial") metadatosExtra.push({ etiqueta: "ESTADO", valor: "INFORME OFICIAL - VALIDADO" });
  const siguienteSeccion = crearNumeradorSecciones();

  let y = portadaFormal(doc, 26, { titulo: "Informe de calidad", objeto, periodo: periodoTexto, metadatosExtra });

  y = tituloSeccionNumerada(doc, y, siguienteSeccion(), "Indicadores principales", "Lotes anotados, Aerobotics y distribucion por calidad de la jornada");

  [
    { label: "LOTES", value: String(summary.total), sub: "anotados", color: PDF_THEME.forest },
    { label: "AEROBOTICS", value: String(summary.aerobotics), sub: percentageLabel(summary.aerobotics, summary.total), color: PDF_THEME.info },
    { label: "BUENO", value: String(summary.byQuality.Bueno), sub: percentageLabel(summary.byQuality.Bueno, summary.total), color: PDF_THEME.success },
    { label: "REVISAR", value: String(summary.byQuality.Regular + summary.byQuality.Deficiente + summary.byQuality.Pésimo), sub: "con seguimiento", color: PDF_THEME.warning },
    { label: "FOTOS", value: String(summary.fotos), sub: "adjuntas", color: PDF_THEME.primary },
  ].forEach((metric, index) => drawMetricTile(doc, 10 + index * 56.4, y, 52, metric.label, metric.value, metric.sub, metric.color));
  y += 25;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(...PDF_THEME.primaryDark);
  doc.text("Distribucion por calidad", 10, y);
  y += 4;
  let qualityX = 10;
  CALIDAD_OPTIONS.forEach((quality) => {
    const value = summary.byQuality[quality];
    drawQualityPill(doc, qualityX, y, `${quality}: ${value}`, QUALITY_PDF_COLORS[quality], QUALITY_SOFT_COLORS[quality], 38);
    qualityX += 42;
  });
  y += 14;

  y = tituloSeccionNumerada(doc, y, siguienteSeccion(), "Detalle de lotes", "Ficha por lote: observacion, accion recomendada y defectos");

  filteredLotes.forEach((lote, index) => {
    const photoCount = counts[lote.id] ?? 0;
    const { cardHeight: needed } = computeLoteCardLayout(doc, lote);
    y = ensurePdfSpace(doc, y, needed + 6);
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
    y += 24;
  }

  // CIERRE (última página): párrafo de atestación + línea de emisión
  // electrónica, con el MISMO objeto/periodo que la portada.
  let cierreY = y + 8;
  if (cierreY > 160) {
    addPdfPage(doc);
    cierreY = 30;
  }
  cierreAtestacion(doc, cierreY, { objeto, periodo: periodoTexto, generadoEn: currentGeneradoEn });

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

  finalizarPaginacionFormal(doc);
  const suffix = mode === "oficial" ? "Oficial" : "Borrador";
  doc.save(buildLasarteFilename(`Calidad-${suffix}`, "pdf", { from: jornada.fecha }));
}

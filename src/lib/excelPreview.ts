/**
 * excelPreview.ts — núcleo de parseo/presentación robusto para el visor de
 * Excel (src/components/excel-preview/*, ExcelViewerPage, ExcelViewerDialog,
 * PartFilePreviewDialog). Sustituye a la lógica que vivía suelta dentro de
 * ExcelViewerDialog.tsx (parseSheetToStructured) tras un diagnóstico con
 * archivos reales (informes de calibrador/báscula) que encontró fallos
 * concretos — ver el catálogo completo en el informe de la tarea, resumen
 * aquí porque cada fix referencia el fallo que arregla:
 *
 *  1) CELDAS COMBINADAS: los informes de calibrador (Informe PRODUCCION,
 *     PRODUCTO, TAMAÑOS) mezclan filas de cabecera Y de dato con celdas
 *     combinadas (verificado: 8.345 rangos de merge en un solo informe de
 *     campaña). sheet_to_json(header:1) solo pone el valor en la celda
 *     superior-izquierda del rango — el resto llega vacío. Antes, eso
 *     producía cabeceras "Col 2/Col 3..." donde debía decir el nombre real.
 *     `mergeFillGrid` propaga el valor del rango a todas las celdas que
 *     cubre ANTES de cualquier otra heurística.
 *
 *  2) NÚMEROS SIN FORMATO ES-ES / PRECISIÓN CRUDA: el pipeline antiguo
 *     convertía cada celda a texto con `String(value)` nada más leer el
 *     archivo (p.ej. "% Merma" → "0.03598484848484849", peso →
 *     "803.0617"), así que el formateador es-ES (`formatNumber` en
 *     excel-preview/formatters.ts) nunca llegaba a aplicarse: para cuando
 *     la tabla lo pintaba, el valor YA era un string y solo se recortaba
 *     (`.trim()`). Aquí las celdas guardan su valor CRUDO (number/Date/
 *     string) hasta el último momento y se formatean por TIPO de columna
 *     inferido (`inferColumnType` + `formatByType`).
 *
 *  3) FECHAS COMO SERIAL SIN CONVERTIR: un valor "46136" en una celda de
 *     texto suelta (p.ej. una métrica "Fecha de Lote: 46136") no pasaba por
 *     ningún detector de serial — solo los number puros con
 *     30000<x<60000 se convertían. `formatByType("date", ...)` detecta
 *     también STRINGS puramente numéricas en rango de serial de Excel.
 *
 *  4) FILAS DECORATIVAS/LEYENDA COLADAS COMO DATO: el pie de los informes
 *     de calibrador trae líneas tipo "- Packed Fruit" / "El segundo número
 *     se calcula sobre todas las Categorías Totalizadoras." que antes
 *     quedaban como últimas filas de la tabla de datos. El informe
 *     APROVECHAMIENTO_STOCK_LOTES trae una leyenda de 3 líneas al pie
 *     ("% de aprovechamiento calculado", "SIN DATOS...", "Lote marcado...")
 *     con el mismo problema. `classifyDataRow` las reconoce y las mueve a
 *     `notes` en vez de dejarlas en `rows`.
 *
 *  5) SUBTOTALES SIN CLAVE COLADOS COMO FILA: el mismo informe trae filas
 *     de agrupación por producto/agricultor con la columna clave (fecha/
 *     lote) en blanco (mismo patrón que ya resuelve
 *     src/lib/entradasBascula.ts→parseStockLotesRows). Se descartan (no se
 *     muestran como fila de dato) y se cuentan en `discarded`.
 *
 *  6) RENDIMIENTO: "palets 1sep 14 jul.xlsx" tiene 39.147 filas; el pipeline
 *     antiguo tardaba >5s SOLO en parsear (sin contar el render, que además
 *     tenía un `table.rows.indexOf(row)` por fila dentro del render — O(n²)
 *     con 39k filas). Aquí se expone `paginateRows` para que la UI pagine
 *     en vez de montar 39k filas de DOM, y las filas ya llevan su índice
 *     estable (no hace falta indexOf).
 */
import * as XLSX from "xlsx";
import { formatDate as formatDateEs, formatNumber as formatNumberEs } from "@/components/excel-preview/formatters";

// ─── Debug ───────────────────────────────────────────────────────────────
// Mismo mecanismo que el resto del repo (src/lib/parsers.ts, ExcelViewerDialog
// antiguo): silencioso salvo que la URL lleve ?debug.
const DEBUG = typeof window !== "undefined" && new URLSearchParams(window.location.search).has("debug");
function dlog(...args: unknown[]) {
  if (DEBUG) console.log("[excelPreview]", ...args);
}

// ─── Tipos ───────────────────────────────────────────────────────────────

export type ColumnType = "date" | "number" | "percent" | "text";

export interface ParsedColumn {
  index: number;
  header: string;
  type: ColumnType;
  /** true si la cabecera venía vacía en el archivo (se rellenó con "Col N"). */
  isPlaceholder: boolean;
}

export interface Metric {
  label: string;
  value: string | number;
  category?: string;
}

export interface KeyValueBlock {
  title?: string;
  pairs: Metric[];
}

export interface DiscardedRow {
  /** Índice de fila dentro de la hoja original (1-based, como lo ve el usuario en Excel). */
  rowNumber: number;
  reason: string;
  preview: string;
}

export interface DataTableRow {
  /** Índice estable dentro de `rows` de la tabla (identidad para selección/orden; NO recalcular con indexOf). */
  rowIndex: number;
  /** Valores ya formateados para mostrar, uno por columna. */
  cells: string[];
}

export interface ParsedTable {
  section: string;
  description?: string;
  columns: ParsedColumn[];
  rows: DataTableRow[];
  totalRow?: string[];
  discarded: DiscardedRow[];
}

export interface ParsedSheet {
  filename: string;
  sheetName: string;
  title?: string;
  subtitle?: string;
  metrics: Metric[];
  kvBlocks?: KeyValueBlock[];
  tables: ParsedTable[];
  summaryRows?: Metric[];
  notes?: string[];
  /** Métricas auto-calculadas (sumas de columnas numéricas), con el nombre de columna en la etiqueta. */
  autoMetrics?: Metric[];
  /** Rejilla cruda (tras el relleno de celdas combinadas, SIN ninguna otra heurística) para el modo "ver todo en bruto". */
  rawGrid: string[][];
}

export interface RawSheetGrid {
  name: string;
  /** Rejilla header:1 con valores crudos (number/Date/string/boolean), ya con las celdas combinadas rellenadas. */
  grid: unknown[][];
}

// ─── Paginación ──────────────────────────────────────────────────────────

export const DEFAULT_PAGE_SIZE = 150;

export function paginateRows<T>(rows: T[], page: number, pageSize: number = DEFAULT_PAGE_SIZE): T[] {
  if (pageSize <= 0) return rows;
  const start = Math.max(0, page) * pageSize;
  return rows.slice(start, start + pageSize);
}

export function totalPages(rowCount: number, pageSize: number = DEFAULT_PAGE_SIZE): number {
  if (pageSize <= 0) return 1;
  return Math.max(1, Math.ceil(rowCount / pageSize));
}

// ─── Celdas combinadas ───────────────────────────────────────────────────

export interface MergeRange {
  s: { r: number; c: number };
  e: { r: number; c: number };
}

/**
 * Propaga el valor de la celda superior-izquierda de cada rango combinado al
 * resto de celdas que cubre (si están vacías). `originR`/`originC` son el
 * offset del rango usado por la hoja (XLSX.utils.decode_range(ws['!ref']).s)
 * porque sheet_to_json(header:1) indexa la rejilla desde el inicio del rango
 * usado, mientras que `!merges` usa coordenadas absolutas desde A1.
 */
export function mergeFillGrid(
  grid: unknown[][],
  merges: MergeRange[] = [],
  originR = 0,
  originC = 0
): unknown[][] {
  if (merges.length === 0 || grid.length === 0) return grid;
  const filled = grid.map((row) => row.slice());
  const isEmpty = (v: unknown) => v === undefined || v === null || String(v).trim() === "";

  for (const m of merges) {
    const r0 = m.s.r - originR;
    const c0 = m.s.c - originC;
    const r1 = m.e.r - originR;
    const c1 = m.e.c - originC;
    if (r0 < 0 || c0 < 0 || r0 >= filled.length) continue;
    const master = filled[r0]?.[c0];
    if (isEmpty(master)) continue;
    for (let r = r0; r <= r1 && r < filled.length; r++) {
      const row = filled[r];
      if (!row) continue;
      for (let c = c0; c <= c1 && c < row.length; c++) {
        if (r === r0 && c === c0) continue;
        if (isEmpty(row[c])) row[c] = master;
      }
    }
  }
  return filled;
}

// ─── Parseo de números/fechas tolerante a formato ───────────────────────

const EXCEL_EPOCH_OFFSET_DIAS = 25569;

function excelSerialToDate(serial: number): Date {
  const utcDays = Math.floor(serial - EXCEL_EPOCH_OFFSET_DIAS);
  return new Date(utcDays * 86400 * 1000);
}

function looksLikeExcelDateSerial(n: number): boolean {
  return Number.isFinite(n) && n > 20000 && n < 60000;
}

const DMY_RE = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/;
const ISO_RE = /^(\d{4})-(\d{1,2})-(\d{1,2})/;
const BARE_SERIAL_RE = /^\d{5}(\.\d+)?$/;

/**
 * Un valor "fecha/inicio/creación/entrada/tiempo" en la etiqueta (cabecera de
 * columna o label de métrica) es la única señal fiable para interpretar un
 * NÚMERO ENTERO DE 5 CIFRAS suelto como serial de fecha de Excel en vez de
 * una cantidad (kg, importe...) que coincida por casualidad con ese rango
 * (20000–60000). Sin este filtro, una columna de peso/importe con un valor
 * como "35000" se clasificaría como fecha por pura coincidencia numérica.
 * Las fechas con separador (dd/mm/yyyy, yyyy-mm-dd) no necesitan esta
 * salvaguarda: su formato ya es inequívoco.
 */
const DATE_HEADER_HINT_RE = /fecha|creaci[oó]n|inicio|tiempo|entrada|vencimiento/i;

function isDateLikeString(s: string, header: string): boolean {
  if (DMY_RE.test(s) || ISO_RE.test(s)) return true;
  return BARE_SERIAL_RE.test(s) && looksLikeExcelDateSerial(Number(s)) && DATE_HEADER_HINT_RE.test(header);
}

/**
 * Formatea el VALOR de una métrica/par clave-valor detectado antes de la
 * tabla ("Fecha de Lote: 46136", "Creación | 46136"). Antes: esos valores se
 * guardaban tal cual (texto crudo "46136"); ahora, si la ETIQUETA sugiere
 * fecha y el valor es un serial suelto, se convierte a dd/mm/yyyy; si el
 * valor es puramente numérico, se formatea con las reglas es-ES.
 */
export function formatMetricValue(label: string, value: string): string {
  const trimmed = value.trim();
  if (DATE_HEADER_HINT_RE.test(label) && BARE_SERIAL_RE.test(trimmed) && looksLikeExcelDateSerial(Number(trimmed))) {
    return formatDateEs(excelSerialToDate(Number(trimmed)));
  }
  if (isNumericLikeString(trimmed) && !/^\d+$/.test(trimmed)) {
    // Solo reformatea si ya trae signos de número "de verdad" (decimales o
    // separadores); un entero corto suelto ("8", "96") se deja tal cual para
    // no convertir códigos/IDs en "8,00" o similar. `isNumericLikeString`
    // también reconoce el patrón anotado "N (N)*" (ver ANNOTATED_NUMBER_RE)
    // que `parseLooseNumber` NO puede parsear — en ese caso se deja el texto
    // tal cual en vez de colapsarlo a "0,00" (antes: `?? 0` perdía el valor).
    const n = parseLooseNumber(trimmed);
    if (n !== null) return formatNumberEs(n);
  }
  return trimmed;
}

/** Parsea un número tolerando formato es-ES (1.234,56) y en-US/crudo (1234.56, 1234). Null si no es numérico. */
export function parseLooseNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (value instanceof Date) return null;
  const t = String(value ?? "").trim();
  if (!t) return null;
  const cleaned = t.replace(/%$/, "").trim();
  if (!cleaned) return null;
  if (cleaned.includes(",") && cleaned.includes(".")) {
    // es-ES: punto de miles, coma decimal
    const n = Number(cleaned.replace(/\./g, "").replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }
  if (cleaned.includes(",")) {
    // Coma decimal si va seguida de 1-3 dígitos y nada más (patrón es-ES sin miles)
    if (/^-?\d+,\d{1,3}$/.test(cleaned)) {
      return Number(cleaned.replace(",", "."));
    }
    const n = Number(cleaned.replace(/,/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/**
 * Patrón "N (N)*"/"N (M)*" de los informes de calidad del calibrador
 * (p.ej. "216,84 (216,84)*", "1.035,58 (1.035,58)*"): un valor seguido del
 * mismo valor u otro relacionado entre paréntesis con un asterisco de nota al
 * pie ("* el primer número se calcula sobre las categorías totalizadoras...").
 * `parseLooseNumber` NO lo reconoce (el paréntesis rompe el parseo), así que
 * sin este patrón, filas enteras de pares etiqueta→valor con este tipo de
 * valor (ej. "Toneladas / Hora | 14,89 (14,89)* | Cartons | 1.655,49
 * (1.655,49)*") no se detectaban como fila kv y colaban como CABECERA DE
 * COLUMNA (bug real verificado en "Informe 26043013.xlsx"/"Informe
 * 26042912.xlsx": el visor mostraba columnas literalmente llamadas "14,89
 * (14,89)*" o "1.655,49 (1.655,49)*"). Solo se usa para CLASIFICAR (¿es esto
 * numérico?), nunca para reformatear el valor — no se toca `parseLooseNumber`
 * para no arriesgar perder el segundo número al mostrarlo.
 */
const ANNOTATED_NUMBER_RE = /^-?[\d.,]*\d\s*\([\d.,]*\d\)\*?$/;

function isNumericLikeString(s: string): boolean {
  if (!s) return false;
  if (parseLooseNumber(s) !== null && /\d/.test(s)) return true;
  return ANNOTATED_NUMBER_RE.test(s.trim());
}

// ─── Formateo por tipo (usa los formateadores es-ES existentes) ─────────

/** Convierte un valor crudo (number serial / Date / string) a fecha "dd/mm/yyyy" es-ES. */
export function formatDateValue(value: unknown): string {
  if (value === undefined || value === null || value === "") return "";
  if (value instanceof Date) return formatDateEs(value);
  if (typeof value === "number") {
    if (looksLikeExcelDateSerial(value)) return formatDateEs(excelSerialToDate(value));
    return String(value);
  }
  const s = String(value).trim();
  if (BARE_SERIAL_RE.test(s) && looksLikeExcelDateSerial(Number(s))) {
    return formatDateEs(excelSerialToDate(Number(s)));
  }
  return formatDateEs(s);
}

/** Formatea un número crudo con las reglas es-ES (punto de miles, coma decimal, ≤3 decimales). */
export function formatNumberValue(value: unknown): string {
  const n = parseLooseNumber(value);
  if (n === null) return typeof value === "string" ? value.trim() : "";
  return formatNumberEs(n);
}

/**
 * Formatea un valor que representa una fracción (0–1.5) o un porcentaje ya
 * escalado como "%". El origen de "% Merma"/"aprovechamiento" en los
 * informes reales es una fracción (0,036 = 3,6%), así que se multiplica por
 * 100 salvo que el valor ya esté en escala de porcentaje (>1.5).
 */
export function formatPercentValue(value: unknown): string {
  const n = parseLooseNumber(value);
  if (n === null) return typeof value === "string" ? value.trim() : "";
  const scaled = Math.abs(n) <= 1.5 ? n * 100 : n;
  return `${formatNumberEs(Math.round(scaled * 100) / 100)}%`;
}

export function formatByType(value: unknown, type: ColumnType): string {
  switch (type) {
    case "date":
      return formatDateValue(value);
    case "percent":
      return formatPercentValue(value);
    case "number":
      return formatNumberValue(value);
    default:
      if (value === undefined || value === null) return "";
      if (value instanceof Date) return formatDateEs(value);
      return String(value).trim();
  }
}

// ─── Inferencia de tipo de columna ───────────────────────────────────────

const PERCENT_HEADER_RE = /%|porcentaje|merma|aprovecham/i;

/**
 * Columnas de IDENTIFICADOR: aunque sus valores sean dígitos ("26042812" en
 * Lote, "356900" en NºPalet), son códigos, no cantidades — formatearlos con
 * separador de miles ("26.042.812") los corrompería visualmente. Cubre los
 * nombres reales de los exports de báscula/calibrador: Lote, NºPalet,
 * Código del Productor, Su Ref., DcmtoVta...
 */
const ID_HEADER_RE = /\blote\b|c[oó]digo|\bref\b|\brefer|n[ºo°]\s*palet|n[ºo°]palet|\bdcmto|\bdocumento\b|albar[aá]n/i;

/** Infiere el tipo de una columna muestreando sus valores no vacíos entre `fromRow` y el final de la rejilla. */
export function inferColumnType(grid: unknown[][], colIndex: number, fromRow: number, header: string): ColumnType {
  let dateCount = 0;
  let numberCount = 0;
  let fractionCount = 0;
  let total = 0;
  const maxSamples = 400;
  for (let r = fromRow; r < grid.length && total < maxSamples; r++) {
    const raw = grid[r]?.[colIndex];
    if (raw === undefined || raw === null) continue;
    const s = typeof raw === "string" ? raw.trim() : raw;
    if (s === "") continue;
    total++;
    if (raw instanceof Date) {
      dateCount++;
    } else if (typeof raw === "number") {
      if (looksLikeExcelDateSerial(raw) && /fecha|inicio|creaci[oó]n|entrada|lote(?!.*kg)/i.test(header)) dateCount++;
      else {
        numberCount++;
        if (Math.abs(raw) <= 1.5) fractionCount++;
      }
    } else {
      const str = String(raw).trim();
      if (isDateLikeString(str, header)) dateCount++;
      else if (isNumericLikeString(str)) {
        numberCount++;
        const n = parseLooseNumber(str);
        if (n !== null && Math.abs(n) <= 1.5) fractionCount++;
      }
    }
  }
  if (total === 0) return "text";
  if (dateCount / total > 0.6) return "date";
  if (numberCount / total > 0.6) {
    // Guardia de identificadores: una columna "Lote"/"NºPalet"/"Código..."
    // con valores todos-dígitos es un código, no una cantidad — se deja como
    // texto para no pintarle separador de miles.
    if (ID_HEADER_RE.test(header)) return "text";
    // percent SOLO si la cabecera lo sugiere Y los valores son fracciones
    // (0–1): "% Merma" = 0.036 → 3,6%. Sin la comprobación de escala, una
    // columna "Merma" en KG (760, 340...) se pintaría como "760%" (visto en
    // el archivo real "Merma fruta camaras.xlsx").
    if (PERCENT_HEADER_RE.test(header) && numberCount > 0 && fractionCount / numberCount >= 0.6) return "percent";
    return "number";
  }
  return "text";
}

// ─── Detección de cabecera por contenido/densidad ───────────────────────
// Reutiliza el criterio ya probado en ExcelViewerDialog.tsx (celdas cortas,
// mayoría texto, sin ":", no controles de UI de Excel) pero ahora corre
// SOBRE LA REJILLA YA RELLENADA por merge-fill, así que celdas de cabecera
// que antes llegaban vacías por estar combinadas ahora traen el nombre real.

const UI_CONTROL_RE = /filtros?|fecha de lote/i;
const MAX_HEADER_CELL_LEN = 30;
const MAX_FALLBACK_SCAN = 50;

/**
 * Vista "por tramos" de una fila: colapsa celdas NO vacías consecutivas e
 * idénticas en un único valor y descarta las vacías. Es la forma correcta de
 * clasificar filas tras mergeFillGrid: un título combinado a lo ancho de 27
 * columnas ("Resumen de la Producción" en el informe real del calibrador)
 * vuelve a ser UN valor (fila-título), no 27 celdas que parecen una cabecera.
 */
export function rowRuns(row: string[]): string[] {
  const runs: string[] = [];
  let prev: string | null = null;
  for (const cell of row) {
    const c = cell.trim();
    if (!c) {
      prev = null;
      continue;
    }
    if (c !== prev) runs.push(c);
    prev = c;
  }
  return runs;
}

function runsAsCells(runs: string[]): Array<{ c: string; i: number }> {
  return runs.map((c, i) => ({ c, i }));
}

function isTwoCellKvRow(cells: Array<{ c: string; i: number }>): { label: string; value: string } | null {
  if (cells.length !== 2) return null;
  const [a, b] = cells;
  if (isNumericLikeString(a.c)) return null;
  // Una fila de cabecera con un span de merge de exactamente 2 columnas
  // produce, tras mergeFillGrid, dos celdas IDÉNTICAS ("Nombre del Lote",
  // "Nombre del Lote") — no es un par etiqueta→valor real (un valor nunca
  // repite literalmente su etiqueta).
  if (a.c === b.c) return null;
  return { label: a.c, value: b.c };
}

function followingKvRatio(rows: string[][], from: number, count: number): number {
  let checked = 0;
  let kv = 0;
  for (let i = from; i < rows.length && checked < count; i++) {
    const cells = runsAsCells(rowRuns(rows[i]));
    if (cells.length === 0) continue;
    checked++;
    if (isTwoCellKvRow(cells)) kv++;
  }
  return checked > 0 ? kv / checked : 0;
}

/**
 * ¿Hay, en las próximas `count` filas con contenido, una fila MÁS ANCHA que
 * `minCells` celdas que también parezca cabecera (mayoría texto corto, sin
 * ":")? Se usa para no coronar como cabecera un par etiqueta→valor de 2
 * celdas cuando la cabecera real de la tabla está justo debajo.
 */
function widerHeaderCandidateNear(rows: string[][], from: number, count: number, minCells: number): boolean {
  let checked = 0;
  for (let i = from; i < rows.length && checked < count; i++) {
    const cells = rowRuns(rows[i]);
    if (cells.length === 0) continue;
    checked++;
    if (cells.length <= minCells) continue;
    if (cells.some((c) => c.includes(":") || UI_CONTROL_RE.test(c))) continue;
    const numericCount = cells.filter((c) => isNumericLikeString(c)).length;
    if (numericCount >= cells.length / 2) continue;
    if (cells.some((c) => c.length > MAX_HEADER_CELL_LEN)) continue;
    return true;
  }
  return false;
}

/** ¿La celda parece un VALOR de par etiqueta→valor (número, fecha u hora)? */
function looksLikeKvValue(s: string): boolean {
  return isNumericLikeString(s) || DMY_RE.test(s) || ISO_RE.test(s) || /^\d{1,2}:\d{2}(:\d{2})?$/.test(s);
}

function extractFourCellKvPairs(cells: Array<{ c: string; i: number }>): Array<{ label: string; value: string }> | null {
  if (cells.length !== 4) return null;
  const [a, b, c, d] = cells;
  if (isNumericLikeString(a.c) || isNumericLikeString(c.c)) return null;
  // Mismo caso que isTwoCellKvRow: dos spans de merge de 2 columnas seguidos
  // ("Nombre del Lote","Nombre del Lote","Código del Productor","Código del
  // Productor") no son dos pares etiqueta→valor reales.
  if (a.c === b.c || c.c === d.c) return null;
  // En un doble par real (informes GSTOCK) al menos uno de los dos valores es
  // numérico/fecha/hora; cuatro textos planos ("Lote|NºPalet|Código|Netos",
  // "Producto|Peso|Cartons|Estado") son una fila de CABECERA, no pares kv.
  if (!looksLikeKvValue(b.c) && !looksLikeKvValue(d.c)) return null;
  return [
    { label: a.c, value: b.c },
    { label: c.c.replace(/:$/, ""), value: d.c },
  ];
}

/** Localiza la fila de cabecera real en `rows` (strings, trim). Devuelve -1 si no encuentra ninguna. */
export function detectHeaderRowIndex(rows: string[][]): number {
  let headerIdx = -1;
  let fallbackIdx = -1;
  let fallbackScore = -1;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    // Clasificación por TRAMOS (rowRuns): tras mergeFillGrid, un título
    // combinado a lo ancho es un solo tramo, no N celdas.
    const cells = rowRuns(row);
    if (cells.length < 2) continue;
    if (cells.some((c) => UI_CONTROL_RE.test(c))) continue;
    if (cells.some((c) => c.includes(":"))) continue;

    const numericCount = cells.filter((c) => isNumericLikeString(c)).length;
    if (numericCount >= cells.length / 2) continue;

    const indexedCells = runsAsCells(cells);
    if (indexedCells.length === 2 && isTwoCellKvRow(indexedCells)) {
      // Un par etiqueta→valor suelto NO es cabecera si (a) le siguen más
      // pares (bloque kv), o (b) muy cerca hay una fila MÁS ANCHA que
      // también cualifica como cabecera (la cabecera real de la tabla:
      // patrón GSTOCK "Commodity | VALENCIA DELTA" justo encima de la
      // cabecera de columnas de verdad).
      if (followingKvRatio(rows, i + 1, 4) >= 0.5) continue;
      if (widerHeaderCandidateNear(rows, i + 1, 4, indexedCells.length)) continue;
    }
    if (indexedCells.length === 4 && extractFourCellKvPairs(indexedCells)) continue;

    const longCells = cells.filter((c) => c.length > MAX_HEADER_CELL_LEN).length;
    if (longCells > 0) {
      if (i < MAX_FALLBACK_SCAN) {
        const textCount = cells.length - numericCount;
        const shortCells = cells.filter((c) => c.length < 25).length;
        if (shortCells >= 2 && textCount > fallbackScore) {
          fallbackScore = textCount;
          fallbackIdx = i;
        }
      }
      continue;
    }
    headerIdx = i;
    break;
  }
  if (headerIdx === -1 && fallbackIdx >= 0) headerIdx = fallbackIdx;
  return headerIdx;
}

// ─── Clasificación de filas: nota / resumen / total / subtotal-sin-clave ─

const NOTE_RE = /^nota\s*[:;]?\s*/i;
const SUMMARY_ROW_RE = /\b(hemos vendido|hab[ií]a planificado|aumento( del)?|descenso( del)?|total(es)?\s+(vendid|planific))/i;
const FOOTNOTE_RE = /^-\s*(packed|packer|reject)/i;
const LONG_EXPLANATION_RE = /se calcula sobre|categor[ií]as totalizadoras|leyenda/i;
const LEGEND_RE = /^(sin datos|lote marcado en el archivo|%\s*de\s*aprovechamiento\s*calculado)/i;

function isNoteRow(cells: string[]): boolean {
  return cells.length > 0 && NOTE_RE.test(cells[0]);
}
function extractNoteText(cells: string[]): string {
  return cells.filter((c) => c.length > 0).join(" ").replace(NOTE_RE, "").trim();
}

/** Fila-pie decorativa (leyenda/explicación) que NO es un dato de tabla, aunque tenga varias celdas. */
function isFootnoteRow(row: string[]): boolean {
  const nonEmpty = row.filter((c) => c.length > 0);
  if (nonEmpty.length === 0) return false;
  const first = nonEmpty[0];
  if (FOOTNOTE_RE.test(first)) return true;
  if (LEGEND_RE.test(first)) return true;
  if (nonEmpty.some((c) => LONG_EXPLANATION_RE.test(c))) return true;
  return false;
}

/**
 * Fila de CAMBIO DE SECCIÓN incrustada a mitad de tabla ("Clase: (B) Extra 2
 * | Grupo de Clasificación: EXPORTACION"): caso real verificado en "Informe
 * 26043013.xlsx" — el informe de Tamaño/Clase/Producto agrupa sus filas de
 * tamaño en bloques por Clase, y cada bloque nuevo mete esta fila de
 * pares etiqueta→valor EN MEDIO de las filas de dato. `extractFourCellKvPairs`
 * no la reconoce como kv (sus "valores" — "(B) Extra 2", "EXPORTACION" — son
 * texto, no `looksLikeKvValue`), así que sin este detector colaba como fila
 * de dato garabateada ("Tamaño: Clase:, Piezas: (B) Extra 2..."). La señal
 * fiable aquí es posicional: tras colapsar por tramos (`rowRuns`), un número
 * PAR de tramos donde CADA tramo de posición par termina en ":" es
 * inequívocamente una fila de pares etiqueta→valor, sea cual sea el
 * contenido del valor.
 */
function isInlineSectionHeaderRow(row: string[]): boolean {
  const runs = rowRuns(row);
  if (runs.length < 2 || runs.length % 2 !== 0) return false;
  for (let i = 0; i < runs.length; i += 2) {
    if (!runs[i].trim().endsWith(":")) return false;
  }
  return true;
}

function matchSummaryRow(row: string[]): { label: string; value: string } | null {
  const nonEmpty = row.map((c, i) => ({ c, i })).filter((x) => x.c.length > 0);
  if (nonEmpty.length < 2) return null;
  const [first, ...rest] = nonEmpty;
  if (isNumericLikeString(first.c)) return null;
  if (!SUMMARY_ROW_RE.test(first.c)) return null;
  const valueCell = rest.find((x) => isNumericLikeString(x.c));
  if (!valueCell) return null;
  return { label: first.c.replace(/\s+$/, ""), value: valueCell.c };
}

function isTotalRow(row: string[], headerLen: number): boolean {
  const nonEmpty = row.filter((c) => c.length > 0);
  if (nonEmpty.length === 0) return false;
  const first = (row[0] ?? "").trim();
  if (/^total(es)?\b/i.test(first)) return true;
  if (first.length > 0) return false;
  const numericCount = nonEmpty.filter((c) => isNumericLikeString(c)).length;
  return numericCount >= 2 && numericCount === nonEmpty.length && nonEmpty.length >= Math.min(2, headerLen - 1);
}

const MAX_LABEL_WORDS = 8;
const MAX_LABEL_LEN = 55;
function looksLikeSentence(text: string): boolean {
  const words = text.trim().split(/\s+/).filter(Boolean);
  return words.length > MAX_LABEL_WORDS || text.length > MAX_LABEL_LEN;
}

function fillEmptyHeaders(headers: string[]): { headers: string[]; placeholders: boolean[] } {
  const placeholders: boolean[] = [];
  const filled = headers.map((h, i) => {
    const ok = Boolean(h && h.trim());
    placeholders.push(!ok);
    return ok ? h : `Col ${i + 1}`;
  });
  return { headers: filled, placeholders };
}

// ─── Parseo principal de una hoja ────────────────────────────────────────

/**
 * Convierte una rejilla cruda (ya rellenada por mergeFillGrid) en una
 * estructura por secciones: título/subtítulo → bloques clave-valor → tabla
 * (con fila de total, tipado de columnas y filas descartadas) → filas-resumen
 * → notas. Mismo criterio documental que el pipeline anterior, con las
 * correcciones descritas en la cabecera del archivo.
 */
export function parseSheet(grid: unknown[][], filename: string, sheetName: string): ParsedSheet {
  const toCell = (v: unknown): string => {
    if (v === undefined || v === null) return "";
    if (v instanceof Date) return formatDateEs(v);
    if (typeof v === "number") return String(v);
    return String(v).trim();
  };

  const stringGrid = grid.map((row) => row.map(toCell));
  const rawGrid: string[][] = stringGrid
    .map((row) => row.map((c) => c.trim()))
    .filter((row) => row.some((c) => c.length > 0));

  const result: ParsedSheet = {
    filename,
    sheetName,
    metrics: [],
    tables: [],
    rawGrid,
  };

  const cleanAll = stringGrid.map((r) => r.map((c) => c.trim())).filter((r) => r.some((c) => c.length > 0));
  if (cleanAll.length === 0) return result;

  // Notas sueltas ("NOTA; ...") en cualquier punto de la hoja.
  const notes: string[] = [];
  const clean = cleanAll.filter((row) => {
    if (isNoteRow(row)) {
      const text = extractNoteText(row);
      if (text) notes.push(text);
      return false;
    }
    return true;
  });
  if (notes.length > 0) result.notes = notes;
  if (clean.length === 0) return result;

  // 1) Localizar cabecera sobre TODA la rejilla (sin recortar columnas
  // todavía: recortar antes distorsionaba la detección de columnas usadas
  // con columnas que solo tienen contenido en el bloque decorativo previo).
  const headerIdx = detectHeaderRowIndex(clean);
  dlog(`header idx=${headerIdx} de ${clean.length} filas`);

  // 2) Columnas usadas: solo se consideran la fila de cabecera + filas de
  // datos posteriores (excluye el bloque decorativo previo al header, que
  // en los informes de calibrador tiene sus propias celdas de métricas en
  // columnas que luego están siempre vacías en cabecera/datos → antes
  // colaban como columnas fantasma "Col N").
  const scanFrom = headerIdx >= 0 ? headerIdx : 0;
  const scanRows = clean.slice(scanFrom);
  const maxCols = Math.max(...clean.map((r) => r.length));
  const usedCols: number[] = [];
  for (let c = 0; c < maxCols; c++) {
    if (scanRows.some((r) => r[c] && r[c].length > 0)) usedCols.push(c);
  }
  const rows = clean.map((r) => usedCols.map((c) => r[c] ?? ""));

  // 3) Clasificar filas previas al header en título/subtítulo/bloques kv.
  const preRows = headerIdx > 0 ? rows.slice(0, headerIdx) : headerIdx === -1 ? rows : [];
  const dataStartIdx = headerIdx >= 0 ? headerIdx + 1 : -1;
  const lastSingleCellText: string[] = [];
  const kvBlocks: KeyValueBlock[] = [];
  let currentKvPairs: Metric[] = [];
  let pendingBlockTitle: string | undefined;

  function flushKvBlock() {
    if (currentKvPairs.length > 0) {
      kvBlocks.push({ title: pendingBlockTitle, pairs: currentKvPairs });
      currentKvPairs = [];
      pendingBlockTitle = undefined;
    }
  }

  for (const row of preRows) {
    // Clasificación por TRAMOS (rowRuns): un título/métrica combinado a lo
    // ancho de la hoja vuelve a ser un único valor tras el merge-fill.
    const cells = rowRuns(row);
    if (cells.length === 0) continue;
    if (cells.some((c) => UI_CONTROL_RE.test(c))) continue;

    if (cells.length === 1 && cells[0].includes(":")) {
      const idx = cells[0].indexOf(":");
      const label = cells[0].slice(0, idx).trim();
      const value = cells[0].slice(idx + 1).trim();
      if (label && value) {
        const formatted = formatMetricValue(label, value);
        result.metrics.push({ label, value: formatted });
        currentKvPairs.push({ label, value: formatted });
      }
      continue;
    }

    const indexedCells = runsAsCells(cells);
    const fourCellPairs = indexedCells.length === 4 ? extractFourCellKvPairs(indexedCells) : null;
    if (fourCellPairs) {
      for (const p of fourCellPairs) {
        const formatted = { label: p.label, value: formatMetricValue(p.label, String(p.value)) };
        result.metrics.push(formatted);
        currentKvPairs.push(formatted);
      }
      continue;
    }

    const kv = isTwoCellKvRow(indexedCells);
    if (kv) {
      // Etiquetas tipo "Cantidad de Lotes:" (dos tramos: etiqueta con ":"
      // final + valor, patrón real del informe del calibrador): se limpia
      // el ":" para presentación.
      const label = kv.label.replace(/:$/, "").trim();
      const formatted = formatMetricValue(label, kv.value);
      result.metrics.push({ label, value: formatted });
      currentKvPairs.push({ label, value: formatted });
      continue;
    }

    if (cells.length === 1 && !isNumericLikeString(cells[0])) {
      flushKvBlock();
      pendingBlockTitle = cells[0];
      lastSingleCellText.push(cells[0]);
    }
  }
  flushKvBlock();

  function formatTitleText(text: string): string {
    if (BARE_SERIAL_RE.test(text) && looksLikeExcelDateSerial(Number(text))) {
      return formatDateEs(excelSerialToDate(Number(text)));
    }
    return text;
  }
  if (lastSingleCellText.length >= 1) result.title = formatTitleText(lastSingleCellText[0]);
  if (lastSingleCellText.length >= 2 && !looksLikeSentence(lastSingleCellText[1])) {
    result.subtitle = formatTitleText(lastSingleCellText[1]);
  }

  const finalKvBlocks = kvBlocks
    .map((block) => ({
      ...block,
      title: block.title && block.title !== result.title && block.title !== result.subtitle ? block.title : undefined,
    }))
    .filter((block) => block.pairs.length > 0);
  if (finalKvBlocks.length > 0) result.kvBlocks = finalKvBlocks;

  // 4) Tabla principal.
  let headers: string[];
  let placeholders: boolean[];
  let actualDataStartIdx: number;
  if (headerIdx >= 0) {
    const filled = fillEmptyHeaders(rows[headerIdx]);
    headers = filled.headers;
    placeholders = filled.placeholders;
    actualDataStartIdx = dataStartIdx;
  } else {
    const firstDataRowIdx = rows.findIndex((r) => r.some((c) => c.length > 0));
    if (firstDataRowIdx < 0) return result;
    const maxColsInData = Math.max(...rows.slice(firstDataRowIdx).map((r) => r.length));
    headers = Array.from({ length: maxColsInData }, (_, i) => `Col ${i + 1}`);
    placeholders = headers.map(() => true);
    actualDataStartIdx = firstDataRowIdx;
  }

  if (headers.length === 0) return result;

  // Colapsar columnas duplicadas ADYACENTES: un span de merge de N columnas
  // sobre la cabecera (p.ej. "Nombre del Lote" combinada en 5 columnas, caso
  // real de "Informe PRODUCCION") produce, tras mergeFillGrid, N cabeceras
  // idénticas seguidas — no son N columnas distintas, es UNA sola columna
  // repetida por el propio merge-fill. Sin este colapso, la tabla mostraría
  // columnas fantasma con el mismo nombre y casi siempre vacías.
  const originalIdx: number[] = [0];
  for (let i = 1; i < headers.length; i++) {
    const lastKept = originalIdx[originalIdx.length - 1];
    if (!placeholders[i] && headers[i] === headers[lastKept]) continue;
    originalIdx.push(i);
  }
  if (originalIdx.length < headers.length) {
    headers = originalIdx.map((i) => headers[i]);
    placeholders = originalIdx.map((i) => placeholders[i]);
  }
  const pickRow = (row: string[]): string[] => originalIdx.map((i) => row[i] ?? "");

  /**
   * ¿Esta fila de dato (ya reducida a las columnas usadas) es literalmente
   * una REPETICIÓN de la fila de cabecera? Caso real verificado en "Informe
   * 26043013.xlsx": el informe reimprime "Tamaño | Piezas | % Piezas | Peso
   * (kg)..." cada vez que empieza un nuevo bloque de Clase, colándose como
   * fila de dato garabateada en vez de descartarse.
   */
  function isRepeatedHeaderRow(pickedRow: string[]): boolean {
    let checked = 0;
    let matches = 0;
    for (let i = 0; i < headers.length; i++) {
      if (placeholders[i]) continue;
      const cell = (pickedRow[i] ?? "").trim();
      if (!cell) continue;
      checked++;
      if (cell === headers[i]) matches++;
    }
    return checked >= 2 && matches === checked;
  }

  const dataRowsRaw: Array<{ row: string[]; rowNumber: number }> = [];
  let totalRow: string[] | undefined;
  const summaryRows: Metric[] = [];
  const discarded: DiscardedRow[] = [];
  let tableClosed = false;

  // Columna CLAVE de la tabla: la primera columna poblada en la mayoría de
  // filas candidatas. En casi todos los informes reales es la col 0 (Lote,
  // Creación, Fecha...), pero el informe de TAMAÑOS del calibrador sangra
  // los datos: la col 0 solo tiene los "Total de Variedad:" y la clave real
  // es "Tamaño" (columna 4). Elegir col 0 a ciegas descartaba allí 175+
  // filas de datos reales como "subtotal sin clave".
  // Una fila con la clave vacía pero con valores numéricos en otras
  // columnas es una fila de AGRUPACIÓN/SUBTOTAL sin clave propia (mismo
  // patrón que ya filtra src/lib/entradasBascula.ts→parseStockLotesRows),
  // no una fila de dato: se descarta.
  let keyColIndex = 0;
  {
    let candidateCount = 0;
    const population = headers.length > 0 ? new Array<number>(rows[0]?.length ?? headers.length).fill(0) : [];
    for (let i = actualDataStartIdx; i < rows.length; i++) {
      const row = rows[i];
      if (row.every((c) => !c)) continue;
      candidateCount++;
      for (let c = 0; c < row.length; c++) {
        if (row[c] && row[c].trim()) population[c] = (population[c] ?? 0) + 1;
      }
    }
    if (candidateCount > 0) {
      const found = population.findIndex((p) => p >= candidateCount * 0.5);
      if (found >= 0) keyColIndex = found;
    }
  }

  for (let i = actualDataStartIdx; i < rows.length; i++) {
    const row = rows[i];
    const rowNumber = i + 1;
    if (row.every((c) => !c)) continue;

    if (isInlineSectionHeaderRow(row)) {
      const preview = rowRuns(row).join(" | ");
      discarded.push({ rowNumber, reason: "Cambio de sección (Clase/Grupo) incrustado en la tabla", preview: preview.slice(0, 80) });
      continue;
    }

    if (isRepeatedHeaderRow(pickRow(row))) {
      discarded.push({ rowNumber, reason: "Cabecera repetida a mitad de informe (nuevo bloque)", preview: rowRuns(row).join(" | ").slice(0, 80) });
      continue;
    }

    if (isFootnoteRow(row)) {
      // rowRuns (no `row.filter(...).join`) para no duplicar el texto: una
      // leyenda combinada a lo ancho de la hoja (caso real de "Informe
      // PRODUCCION"/"26043013": la nota "* El primer número se calcula..."
      // ocupa un merge de hasta 42 columnas) llega aquí ya rellenada por
      // mergeFillGrid en TODAS esas columnas — sin colapsar los tramos
      // idénticos, `join(" ")` repetía la misma frase decenas de veces
      // seguidas dentro de una sola nota.
      const text = rowRuns(row).join(" ");
      notes.push(text);
      discarded.push({ rowNumber, reason: "Leyenda/nota de pie de informe", preview: text.slice(0, 80) });
      continue;
    }

    if (tableClosed) {
      const summary = matchSummaryRow(row);
      if (summary) summaryRows.push(summary);
      continue;
    }

    const summary = matchSummaryRow(row);
    if (summary) {
      summaryRows.push(summary);
      tableClosed = true;
      continue;
    }

    if (!totalRow && isTotalRow(row, headers.length)) {
      totalRow = pickRow(row);
      continue;
    }

    const keyEmpty = !row[keyColIndex] || !row[keyColIndex].trim();
    const hasNumericElsewhere = row.some((c, ci) => ci !== keyColIndex && isNumericLikeString(c));
    if (keyEmpty && hasNumericElsewhere) {
      const preview = row.filter((c) => c.length > 0).slice(0, 4).join(" | ");
      discarded.push({ rowNumber, reason: "Fila de agrupación/subtotal sin clave en la primera columna", preview });
      continue;
    }

    dataRowsRaw.push({ row: pickRow(row), rowNumber });
  }

  if (notes.length > 0) result.notes = notes;
  else delete result.notes;

  let section = "";
  for (let i = lastSingleCellText.length - 1; i >= 0; i--) {
    const t = lastSingleCellText[i];
    if (t !== result.title && t !== result.subtitle && !looksLikeSentence(t)) {
      section = t;
      break;
    }
  }

  const filteredRaw = dataRowsRaw.filter(({ row }) => {
    const nonEmpty = row.filter((c) => c.length > 0);
    if (nonEmpty.length === 0) return false;
    const labelCount = nonEmpty.filter((c) => c.endsWith(":")).length;
    return labelCount / nonEmpty.length < 0.5;
  });

  // Tipo de cada columna, inferido SOLO sobre las filas de datos ya
  // clasificadas (sin decorativas, subtotales ni filas-resumen: una columna
  // "PORCENTAJE" de fracciones no debe contaminarse con los kilos de la
  // fila-resumen que va después de la tabla).
  const dataGridForTypes = filteredRaw.map((x) => x.row);
  const columnTypes: ColumnType[] = headers.map((h, ci) => inferColumnType(dataGridForTypes, ci, 0, h));

  // PASADA 2 — con los tipos ya inferidos se detectan dos familias de filas
  // que la primera pasada no puede distinguir:
  //  (a) la fila de TOTALES/RECUENTO del propio informe del calibrador
  //      ("963 | 96 | 95 | 6 | Σkg..."): números de RECUENTO en columnas que
  //      en el resto de filas son texto (productor, variedad). Colada como
  //      dato, DUPLICABA las sumas de las métricas automáticas.
  //  (b) leyendas al pie con la clave vacía y texto bajo columnas numéricas
  //      (la leyenda de colores del informe de stock de báscula).
  // Columnas "estrictamente texto": tipo text con <30% de valores numéricos
  // reales (excluye las columnas de identificador, que son texto forzado
  // pero llevan dígitos en todas las filas).
  const strictTextCols: number[] = [];
  for (let ci = 0; ci < headers.length; ci++) {
    if (columnTypes[ci] !== "text") continue;
    let nonEmpty = 0;
    let numeric = 0;
    for (const { row } of filteredRaw) {
      const cell = (row[ci] ?? "").trim();
      if (!cell) continue;
      nonEmpty++;
      if (isNumericLikeString(cell)) numeric++;
    }
    if (nonEmpty > 0 && numeric / nonEmpty < 0.3) strictTextCols.push(ci);
  }
  // Índice de la columna clave en el espacio de columnas ya colapsadas.
  const keyCollapsedIdx = Math.max(0, originalIdx.filter((i) => i <= keyColIndex).length - 1);
  const dataRows: typeof filteredRaw = [];
  for (const item of filteredRaw) {
    const { row, rowNumber } = item;
    const strictNonEmpty = strictTextCols.filter((ci) => (row[ci] ?? "").trim().length > 0);
    const strictNumeric = strictNonEmpty.filter((ci) => isNumericLikeString(row[ci]));
    if (strictNonEmpty.length >= 2 && strictNumeric.length / strictNonEmpty.length >= 0.6) {
      const preview = row.filter((c) => c.length > 0).slice(0, 5).join(" | ");
      discarded.push({ rowNumber, reason: "Fila de totales/recuento del propio informe", preview });
      continue;
    }
    const keyEmpty = !(row[keyCollapsedIdx] ?? "").trim();
    if (keyEmpty) {
      const nonEmptyIdx = row.map((c, ci) => ({ c: c.trim(), ci })).filter((x) => x.c.length > 0);
      const allText = nonEmptyIdx.every((x) => !isNumericLikeString(x.c));
      const textInNumericCol = nonEmptyIdx.some(
        (x) => !isNumericLikeString(x.c) && (columnTypes[x.ci] === "number" || columnTypes[x.ci] === "percent" || columnTypes[x.ci] === "date")
      );
      if (allText && (nonEmptyIdx.length === 1 || textInNumericCol)) {
        const preview = nonEmptyIdx.map((x) => x.c).slice(0, 5).join(" | ");
        discarded.push({ rowNumber, reason: "Fila decorativa/leyenda sin clave", preview });
        continue;
      }
    }
    dataRows.push(item);
  }

  let finalSection = section;
  if (!finalSection || finalSection === "Datos") {
    const match = filename.match(/informe.*\b(tamaños?|productos?|producciones?|palets?)\b/i);
    if (match) {
      finalSection = match[1].charAt(0).toUpperCase() + match[1].slice(1).toLowerCase();
    } else if (sheetName && !/^hoja\s*\d+$/i.test(sheetName)) {
      finalSection = sheetName;
    } else {
      finalSection = "Datos";
    }
  }

  const columns: ParsedColumn[] = headers.map((h, i) => ({
    index: i,
    header: h,
    type: columnTypes[i],
    isPlaceholder: placeholders[i] ?? false,
  }));

  const displayRows: DataTableRow[] = dataRows.map(({ row }, idx) => ({
    rowIndex: idx,
    cells: row.map((raw, ci) => formatByType(raw, columnTypes[ci])),
  }));

  const totalRowDisplay = totalRow ? totalRow.map((raw, ci) => formatByType(raw, columnTypes[ci])) : undefined;

  result.tables.push({
    section: finalSection,
    description: `${displayRows.length} fila${displayRows.length !== 1 ? "s" : ""} · ${headers.length} columna${
      headers.length !== 1 ? "s" : ""
    }${discarded.length > 0 ? ` · ${discarded.length} descartada${discarded.length !== 1 ? "s" : ""}` : ""}`,
    columns,
    rows: displayRows,
    totalRow: totalRowDisplay,
    discarded,
  });

  if (summaryRows.length > 0) result.summaryRows = summaryRows;

  result.autoMetrics = computeAutoMetrics(columns, dataRows.map((x) => x.row), columnTypes);

  return result;
}

// ─── Métricas automáticas (sumas por columna, con atribución) ───────────

/**
 * Columnas cuya CABECERA ya declara que su valor es un promedio por fila
 * ("Peso de Fruta Promedio (g)", "Conteo de Empaques Promedio", "Peso de
 * Empaque Promedio"...). Sumarlas across N filas no tiene sentido — el
 * resultado no es una cantidad real de nada (verificado en "Informe
 * PRODUCCION 1SEP14JUL.xlsx": Σ de "Peso de Fruta Promedio (g)" en 1.187
 * lotes daba "282.378,622", un número sin significado; lo útil es la MEDIA
 * de esas medias). Aquí se calcula la media en vez de la suma y se etiqueta
 * "Media X" en vez de "Σ X" para que quede claro que no es un total.
 */
const AVERAGE_HEADER_RE = /promedio|\bmedi[ao]\b|\baverage\b|\bavg\b/i;

/** Agrega columnas numéricas reales (excluye columnas placeholder): suma para cantidades, media para columnas "Promedio"; etiqueta cada métrica con su columna de origen. */
export function computeAutoMetrics(columns: ParsedColumn[], rawRows: string[][], columnTypes: ColumnType[]): Metric[] {
  const metrics: Metric[] = [];
  for (const col of columns) {
    if (col.isPlaceholder) continue;
    if (columnTypes[col.index] !== "number") continue;
    let sum = 0;
    let count = 0;
    for (const row of rawRows) {
      const n = parseLooseNumber(row[col.index]);
      if (n !== null) {
        sum += n;
        count++;
      }
    }
    if (count === 0) continue;
    if (AVERAGE_HEADER_RE.test(col.header)) {
      metrics.push({ label: `Media ${col.header}`, value: formatNumberEs(sum / count), category: "Auto" });
    } else {
      metrics.push({ label: `Σ ${col.header}`, value: formatNumberEs(sum), category: "Auto" });
    }
  }
  return metrics.slice(0, 8);
}

// ─── Lectura robusta de workbooks (movida de ExcelViewerDialog/Page) ────

export function formatSize(bytes: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Detecta y elimina cualquier prefijo basura antes del header ZIP, corrige
 * DEFLATE64 (método 9 → 8) y reconstruye el EOCD si falta (export GSTOCK sin
 * End Of Central Directory). Ver comentarios inline: lógica sin cambios
 * respecto al ExcelViewerDialog.tsx original, solo trasladada aquí.
 */
export function repairXlsx(bytes: Uint8Array): Uint8Array {
  let start = 0;
  const scanLimit = Math.min(bytes.length - 4, 64);
  for (let i = 0; i <= scanLimit; i++) {
    if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 0x03 && bytes[i + 3] === 0x04) {
      start = i;
      break;
    }
  }
  if (start > 0) {
    dlog(`repairXlsx: stripped ${start} garbage prefix bytes`);
    bytes = bytes.subarray(start);
  }

  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b || bytes[2] !== 0x03 || bytes[3] !== 0x04) {
    return bytes;
  }

  const buf = new Uint8Array(bytes);
  let needsRepair = false;

  for (let i = 0; i < buf.length - 30; i++) {
    if (buf[i] === 0x50 && buf[i + 1] === 0x4b && buf[i + 2] === 0x03 && buf[i + 3] === 0x04) {
      const method = buf[i + 8] | (buf[i + 9] << 8);
      if (method === 9) {
        needsRepair = true;
        buf[i + 8] = 8;
        buf[i + 9] = 0;
      }
      const fnLen = buf[i + 26] | (buf[i + 27] << 8);
      const exLen = buf[i + 28] | (buf[i + 29] << 8);
      i += 30 + fnLen + exLen - 1;
    }
  }

  if (needsRepair) {
    for (let i = 0; i < buf.length - 46; i++) {
      if (buf[i] === 0x50 && buf[i + 1] === 0x4b && buf[i + 2] === 0x01 && buf[i + 3] === 0x02) {
        const method = buf[i + 10] | (buf[i + 11] << 8);
        if (method === 9) {
          buf[i + 10] = 8;
          buf[i + 11] = 0;
        }
        const fnLen = buf[i + 28] | (buf[i + 29] << 8);
        const exLen = buf[i + 30] | (buf[i + 31] << 8);
        const cmLen = buf[i + 32] | (buf[i + 33] << 8);
        i += 46 + fnLen + exLen + cmLen - 1;
      }
    }
  }

  const eocdFixed = reconstructMissingEocd(buf);
  if (eocdFixed) return eocdFixed;
  return buf;
}

function findNextZipSignature(bytes: Uint8Array, start: number): number {
  for (let i = start; i < bytes.length - 3; i++) {
    const a = bytes[i],
      b = bytes[i + 1],
      c = bytes[i + 2],
      d = bytes[i + 3];
    if (a === 0x50 && b === 0x4b && (c === 0x03 || c === 0x01) && d === 0x04) return i;
  }
  return bytes.length;
}

function reconstructMissingEocd(bytes: Uint8Array): Uint8Array | null {
  const maxComment = 65535;
  const searchStart = Math.max(0, bytes.length - 22 - maxComment);
  let eocdStart = -1;
  for (let i = bytes.length - 22; i >= searchStart; i--) {
    if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 0x05 && bytes[i + 3] === 0x06) {
      const commentLen = bytes[i + 20] | (bytes[i + 21] << 8);
      if (i + 22 + commentLen !== bytes.length) continue;
      const cdEntries = bytes[i + 10] | (bytes[i + 11] << 8);
      if (cdEntries === 0) continue;
      const cdSize = (bytes[i + 12] | (bytes[i + 13] << 8) | (bytes[i + 14] << 16) | (bytes[i + 15] << 24)) >>> 0;
      const cdOffset = (bytes[i + 16] | (bytes[i + 17] << 8) | (bytes[i + 18] << 16) | (bytes[i + 19] << 24)) >>> 0;
      if (cdOffset === 0 || cdOffset + cdSize > bytes.length) continue;
      if (bytes[cdOffset] !== 0x50 || bytes[cdOffset + 1] !== 0x4b || bytes[cdOffset + 2] !== 0x01 || bytes[cdOffset + 3] !== 0x02)
        continue;
      eocdStart = i;
      break;
    }
  }
  if (eocdStart >= 0) return bytes;

  type LH = {
    offset: number;
    version: number;
    flags: number;
    method: number;
    modTime: number;
    modDate: number;
    crc32: number;
    compSize: number;
    uncompSize: number;
    filenameLen: number;
    extraLen: number;
    dataStart: number;
    dataSize: number;
  };
  const headers: LH[] = [];
  let i = 0;
  while (i < bytes.length - 30) {
    if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 0x03 && bytes[i + 3] === 0x04) {
      const flags = bytes[i + 6] | (bytes[i + 7] << 8);
      const compSize = bytes[i + 18] | (bytes[i + 19] << 8) | (bytes[i + 20] << 16) | (bytes[i + 21] << 24);
      const uncompSize = bytes[i + 22] | (bytes[i + 23] << 8) | (bytes[i + 24] << 16) | (bytes[i + 25] << 24);
      const filenameLen = bytes[i + 26] | (bytes[i + 27] << 8);
      const extraLen = bytes[i + 28] | (bytes[i + 29] << 8);
      const dataStart = i + 30 + filenameLen + extraLen;
      let dataSize = compSize;
      if (dataSize === 0 && (flags & 0x08) === 0) dataSize = uncompSize;
      if (dataSize === 0) {
        const nextSig = findNextZipSignature(bytes, dataStart);
        dataSize = nextSig - dataStart;
      }
      headers.push({
        offset: i,
        version: bytes[i + 4] | (bytes[i + 5] << 8),
        flags,
        method: bytes[i + 8] | (bytes[i + 9] << 8),
        modTime: bytes[i + 10] | (bytes[i + 11] << 8),
        modDate: bytes[i + 12] | (bytes[i + 13] << 8),
        crc32: (bytes[i + 14] | (bytes[i + 15] << 8) | (bytes[i + 16] << 16) | (bytes[i + 17] << 24)) >>> 0,
        compSize,
        uncompSize,
        filenameLen,
        extraLen,
        dataStart,
        dataSize,
      });
      i = dataStart + dataSize;
    } else {
      i++;
    }
  }
  if (headers.length === 0) return null;

  const cdEntries: Uint8Array[] = [];
  for (const h of headers) {
    const cd = new Uint8Array(46 + h.filenameLen);
    cd[0] = 0x50;
    cd[1] = 0x4b;
    cd[2] = 0x01;
    cd[3] = 0x02;
    cd[4] = 0x14;
    cd[5] = 0x00;
    cd[6] = h.version & 0xff;
    cd[7] = (h.version >> 8) & 0xff;
    cd[8] = h.flags & 0xff;
    cd[9] = (h.flags >> 8) & 0xff;
    cd[10] = h.method & 0xff;
    cd[11] = (h.method >> 8) & 0xff;
    cd[12] = h.modTime & 0xff;
    cd[13] = (h.modTime >> 8) & 0xff;
    cd[14] = h.modDate & 0xff;
    cd[15] = (h.modDate >> 8) & 0xff;
    cd[16] = h.crc32 & 0xff;
    cd[17] = (h.crc32 >> 8) & 0xff;
    cd[18] = (h.crc32 >> 16) & 0xff;
    cd[19] = (h.crc32 >> 24) & 0xff;
    cd[20] = h.compSize & 0xff;
    cd[21] = (h.compSize >> 8) & 0xff;
    cd[22] = (h.compSize >> 16) & 0xff;
    cd[23] = (h.compSize >> 24) & 0xff;
    cd[24] = h.uncompSize & 0xff;
    cd[25] = (h.uncompSize >> 8) & 0xff;
    cd[26] = (h.uncompSize >> 16) & 0xff;
    cd[27] = (h.uncompSize >> 24) & 0xff;
    cd[28] = h.filenameLen & 0xff;
    cd[29] = (h.filenameLen >> 8) & 0xff;
    cd[30] = 0;
    cd[31] = 0;
    cd[32] = 0;
    cd[33] = 0;
    cd[34] = 0;
    cd[35] = 0;
    cd[36] = 0;
    cd[37] = 0;
    cd[38] = 0;
    cd[39] = 0;
    cd[40] = 0;
    cd[41] = 0;
    cd[42] = h.offset & 0xff;
    cd[43] = (h.offset >> 8) & 0xff;
    cd[44] = (h.offset >> 16) & 0xff;
    cd[45] = (h.offset >> 24) & 0xff;
    cd.set(bytes.subarray(h.offset + 30, h.offset + 30 + h.filenameLen), 46);
    cdEntries.push(cd);
  }

  let cdOffset = 0;
  for (const h of headers) cdOffset += 30 + h.filenameLen + h.extraLen + h.dataSize;
  const cdSize = cdEntries.reduce((sum, cd) => sum + cd.length, 0);
  const cdCount = cdEntries.length;

  const eocd = new Uint8Array(22);
  eocd[0] = 0x50;
  eocd[1] = 0x4b;
  eocd[2] = 0x05;
  eocd[3] = 0x06;
  eocd[8] = cdCount & 0xff;
  eocd[9] = (cdCount >> 8) & 0xff;
  eocd[10] = cdCount & 0xff;
  eocd[11] = (cdCount >> 8) & 0xff;
  eocd[12] = cdSize & 0xff;
  eocd[13] = (cdSize >> 8) & 0xff;
  eocd[14] = (cdSize >> 16) & 0xff;
  eocd[15] = (cdSize >> 24) & 0xff;
  eocd[16] = cdOffset & 0xff;
  eocd[17] = (cdOffset >> 8) & 0xff;
  eocd[18] = (cdOffset >> 16) & 0xff;
  eocd[19] = (cdOffset >> 24) & 0xff;

  const totalSize = cdOffset + cdSize + 22;
  const out = new Uint8Array(totalSize);
  let pos = 0;
  for (const h of headers) {
    const localEnd = h.offset + 30 + h.filenameLen + h.extraLen;
    out.set(bytes.subarray(h.offset, localEnd), pos);
    pos += 30 + h.filenameLen + h.extraLen;
    out.set(bytes.subarray(h.dataStart, h.dataStart + h.dataSize), pos);
    pos += h.dataSize;
  }
  for (const cd of cdEntries) {
    out.set(cd, pos);
    pos += cd.length;
  }
  out.set(eocd, pos);
  dlog(`reconstructMissingEocd: ${headers.length} archivos, CD en ${cdOffset}, EOCD reconstruido`);
  return out;
}

function gridFromWorksheet(ws: XLSX.WorkSheet): unknown[][] {
  const json = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "", raw: true });
  const merges = (ws["!merges"] as MergeRange[] | undefined) ?? [];
  if (merges.length === 0) return json;
  const ref = ws["!ref"];
  const origin = ref ? XLSX.utils.decode_range(ref).s : { r: 0, c: 0 };
  return mergeFillGrid(json, merges, origin.r, origin.c);
}

function parseWorkbookToGrids(wb: XLSX.WorkBook): RawSheetGrid[] {
  return wb.SheetNames.map((name) => ({ name, grid: gridFromWorksheet(wb.Sheets[name]) }));
}

function isValidContent(grids: RawSheetGrid[]): boolean {
  if (grids.length === 0) return false;
  for (const sheet of grids) {
    let cellsWithContent = 0;
    let suspicious = 0;
    const check = (v: unknown) => {
      const t = v === undefined || v === null ? "" : String(v).trim();
      if (!t) return;
      cellsWithContent++;
      if (t.length > 80 || /^[A-F0-9]{16,}$/i.test(t) || /^[A-Za-z0-9+/=]{24,}$/.test(t)) suspicious++;
    };
    for (const row of sheet.grid) for (const cell of row) check(cell);
    if (cellsWithContent >= 3 && suspicious / cellsWithContent < 0.3) return true;
  }
  return false;
}

/**
 * Lee un .xlsx/.csv/.html-disfrazado-de-excel de forma robusta, probando
 * varias estrategias (igual que el ExcelViewerDialog/Page anteriores, ahora
 * consolidado en un único sitio para no duplicar ~150 líneas en cada punto
 * de entrada). Lanza un Error con pista de diagnóstico si ninguna funciona.
 */
export function parseWorkbookBytes(bytes: Uint8Array, filename: string): RawSheetGrid[] {
  const looksLikeCsvFile = /\.csv$/i.test(filename);
  let parsed: RawSheetGrid[] = [];

  if (looksLikeCsvFile) {
    try {
      const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
      const wb = XLSX.read(text, { type: "string", raw: true });
      const csvParsed = parseWorkbookToGrids(wb);
      if (isValidContent(csvParsed)) parsed = csvParsed;
    } catch {
      /* sigue a los intentos binarios */
    }
  }

  const cleanBytes = repairXlsx(bytes);

  const attempts: Array<[string, XLSX.ParsingOptions]> = [
    ["normal", { type: "array", cellDates: true }],
    ["cellDates+cellNF", { type: "array", cellDates: true, cellNF: false }],
    ["raw", { type: "array", raw: true }],
    ["dense", { type: "array", dense: true, cellDates: true, raw: true }],
  ];
  for (const [label, opts] of attempts) {
    if (isValidContent(parsed)) break;
    try {
      dlog(`intento: ${label}`);
      const wb = XLSX.read(cleanBytes, opts);
      const result = parseWorkbookToGrids(wb);
      if (isValidContent(result)) {
        parsed = result;
        dlog(`intento ${label} exitoso`);
      }
    } catch (e) {
      dlog(`intento ${label} fallo:`, e);
    }
  }

  if (!isValidContent(parsed)) {
    try {
      const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
      if (!text.trim().startsWith("<") && (text.includes(",") || text.includes(";") || text.includes("\t"))) {
        const sep = text.includes(";") ? ";" : text.includes("\t") ? "\t" : ",";
        const lines = text.split(/\r?\n/).filter((l) => l.trim());
        if (lines.length >= 2) {
          const rows = lines.map((l) => l.split(sep).map((c) => c.trim()));
          const csvParsed: RawSheetGrid[] = [{ name: "CSV", grid: rows }];
          if (isValidContent(csvParsed)) parsed = csvParsed;
        }
      }
    } catch {
      /* sigue */
    }
  }

  if (!isValidContent(parsed)) {
    try {
      const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
      if (text.includes("<table")) {
        const doc = new DOMParser().parseFromString(text, "text/html");
        const tables = doc.querySelectorAll("table");
        if (tables.length) {
          const htmlParsed: RawSheetGrid[] = Array.from(tables).map((table, idx) => {
            const trs = Array.from(table.querySelectorAll("tr"));
            const grid = trs.map((tr) =>
              Array.from(tr.querySelectorAll("th,td")).map((td) => td.textContent?.trim() ?? "")
            );
            return { name: `Tabla ${idx + 1}`, grid };
          });
          if (isValidContent(htmlParsed)) parsed = htmlParsed;
        }
      }
    } catch {
      /* sigue */
    }
  }

  if (!isValidContent(parsed)) {
    const looksLikeZip = cleanBytes[0] === 0x50 && cleanBytes[1] === 0x4b && cleanBytes[2] === 0x03 && cleanBytes[3] === 0x04;
    const text = new TextDecoder("utf-8", { fatal: false }).decode(cleanBytes.slice(0, 200));
    const looksLikeHtml = /<html|<table|<!DOCTYPE/i.test(text);
    let eocdFound = false;
    const searchStart = Math.max(0, cleanBytes.length - 64);
    for (let i = searchStart; i < cleanBytes.length - 3; i++) {
      if (cleanBytes[i] === 0x50 && cleanBytes[i + 1] === 0x4b && cleanBytes[i + 2] === 0x05 && cleanBytes[i + 3] === 0x06) {
        eocdFound = true;
        break;
      }
    }
    let hint = "";
    if (looksLikeZip && !eocdFound) {
      hint =
        " Detectado: el archivo ZIP no tiene un registro EOCD (End Of Central Directory) al final — el XLSX está estructuralmente corrupto. Solución: abre el archivo en Excel/LibreOffice y guárdalo de nuevo como .xlsx.";
    } else if (!looksLikeZip) {
      hint = ` Detectado: no es un archivo ZIP/XLSX válido${looksLikeHtml ? " (parece HTML)" : ""}.`;
    }
    throw new Error(`No se pudo parsear "${filename}".${hint} Si el problema persiste, descarga el archivo y verifica que sea un Excel válido.`);
  }

  return parsed;
}

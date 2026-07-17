// src/lib/pdfKit.ts
// Motor de PDF CON MARCA para Herramienta Lasarte — el ESPEJO de exportKit.ts
// (motor de Excel) para que "el export a pdf sea igual al export de excel"
// (encargo del dueño, jul-2026): misma cabecera con logo/razón social, misma
// paleta LASARTE_COLORS/PDF_THEME, y tablas construidas desde las MISMAS
// definiciones ColumnaTabla que usa el Excel (misma columna → misma cabecera,
// alineación y formato numérico es-ES) para paridad estructural GARANTIZADA:
// si Excel y PDF reciben las mismas `ColumnaTabla[]` + filas, no pueden
// mostrar cabeceras ni formatos distintos por definición, en vez de que cada
// generador PDF re-teclee su propia lista de cabeceras (riesgo real,
// verificado en exportPartes.ts: la tabla PDF de "Partes" mostraba "Prod.
// real"/"Palets ajust." mientras el Excel decía "Producción real"/"Palets
// ajustados" — mismo dato, texto distinto).
//
// La identidad visual (logo, colores, cabecera/pie de página, zebra de
// tabla) YA vivía en exportTheme.ts (PDF_THEME, drawExportHeader,
// drawExportFooter, pdfTableTheme, finalizeExportPageNumbers) desde antes de
// este archivo — aquí NO se duplica esa parte, se importa y se le añade la
// pieza que faltaba: el renderizador de TABLA genérico dirigido por
// `ColumnaTabla`, equivalente a `añadirHojaTabla` pero para jsPDF/autoTable.
//
// safeText(): jsPDF con la fuente estándar "helvetica" SI renderiza tildes/ñ
// correctamente (verificado con un PDF de prueba real: "Producción",
// "Código", "áéíóú ÁÉÍÓÚ ñÑ" salen perfectos) — el `safePdf()` que
// eliminaba acentos en varios generadores (exportPartes.ts, calidad.ts) era
// innecesario y activamente dañino para la paridad con Excel (que sí
// conserva las tildes). Aquí NO se eliminan acentos: solo se recortan
// espacios/control characters.
import autoTable, { type CellHookData, type Styles } from "jspdf-autotable";
import type jsPDF from "jspdf";
// NO se usa src/lib/format.ts aquí: su `formatNumber`/`formatDate` no tienen
// el fallback de agrupación de miles para entornos con datos ICU reducidos
// (Node sin full-icu devuelve "1234,50" en vez de "1.234,50" — verificado con
// un test real) y `formatDate` usa un estilo "15 jul 2026", no el dd/mm/yyyy
// de los numFmt de Excel. `@/components/excel-preview/formatters` (mismo
// módulo que ya usa excelPreview.ts) sí resuelve ambos casos.
import { formatDate as formatDateRobusto } from "@/components/excel-preview/formatters";
import {
  FMT_EUR,
  FMT_EUR_KG,
  FMT_FECHA,
  FMT_FECHA_HORA,
  FMT_INT,
  FMT_KG,
  FMT_KWH,
  FMT_L,
  FMT_LKG,
  FMT_MLKG,
  FMT_PCT,
  FMT_TH,
  formatearFechaHoraExportacion,
  generarExportId,
  resolverAlineacion,
  resolverNumFmt,
  type ColumnaAlineacion,
  type ColumnaTabla,
} from "./exportKit";
import { PDF_THEME, pdfTableTheme } from "./exportTheme";

// ─── Texto seguro para jsPDF (sin eliminar tildes/ñ — ver nota de cabecera) ──

/** Recorta espacios y quita caracteres de control; PRESERVA tildes/ñ/€/¿¡ (jsPDF los soporta con la fuente estándar). */
export function safeText(value: unknown): string {
  return String(value ?? "")
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ─── Formato de celda equivalente a Excel (numFmt es-ES → texto) ──────────

type FmtFormatter = (n: number) => string;

// ─── Número es-ES con separador de miles GARANTIZADO (fallback ICU-reducido) ─
// `formatNumberRobusto` (excel-preview/formatters.ts) ya resuelve el fallback
// de agrupación pero solo recorta a 3 decimales SIN fijarlos (p.ej. 1234.50
// -> "1.234,5", perdiendo el cero final); los numFmt de Excel (FMT_KG, FMT_EUR_KG...)
// exigen un Nº FIJO de decimales ("1.234,50 kg" siempre con 2). Se replica
// aquí el mismo fallback de agrupación manual sobre un Intl.NumberFormat con
// decimales fijos.
const esFormattersPorDigitos = new Map<number, Intl.NumberFormat>();
function esNumberFormatter(digits: number): Intl.NumberFormat {
  let f = esFormattersPorDigitos.get(digits);
  if (!f) {
    f = new Intl.NumberFormat("es-ES", { minimumFractionDigits: digits, maximumFractionDigits: digits });
    esFormattersPorDigitos.set(digits, f);
  }
  return f;
}
function groupThousands(intPart: string): string {
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}
/** Número es-ES con N decimales fijos y separador de miles garantizado (mismo fallback ICU que excelPreview.ts). */
function formatNumeroEsFijo(value: number, digits: number): string {
  const formatted = esNumberFormatter(digits).format(value);
  const needsManualGrouping = Math.abs(value) >= 1000 && !formatted.includes(".");
  if (!needsManualGrouping) return formatted;
  const [intPart, decPart] = formatted.split(",");
  const sign = intPart.startsWith("-") ? "-" : "";
  const grouped = `${sign}${groupThousands(sign ? intPart.slice(1) : intPart)}`;
  return decPart ? `${grouped},${decPart}` : grouped;
}

/**
 * Traduce cada código de formato Excel de exportKit.ts (FMT_KG, FMT_PCT...)
 * a su equivalente es-ES en texto plano, con los MISMOS decimales/reglas que
 * Excel renderiza vía numFmt.
 */
const FMT_FORMATTERS: Record<string, FmtFormatter> = {
  [FMT_KG]: (n) => `${formatNumeroEsFijo(n, 2)} kg`,
  [FMT_TH]: (n) => `${formatNumeroEsFijo(n, 2)} T/h`,
  [FMT_L]: (n) => `${formatNumeroEsFijo(n, 2)} L`,
  [FMT_LKG]: (n) => `${formatNumeroEsFijo(n, 3)} L/kg`,
  [FMT_MLKG]: (n) => `${formatNumeroEsFijo(n, 3)} mL/kg`,
  [FMT_KWH]: (n) => `${formatNumeroEsFijo(n, 2)} kWh`,
  [FMT_EUR]: (n) => `${formatNumeroEsFijo(n, 2)} €`,
  [FMT_EUR_KG]: (n) => `${formatNumeroEsFijo(n, 4)} €/kg`,
  [FMT_PCT]: (n) => `${formatNumeroEsFijo(n, 2)} %`,
  [FMT_INT]: (n) => formatNumeroEsFijo(n, 0),
};

/**
 * Fallback para códigos de formato Excel "sueltos" (no una constante FMT_*
 * de exportKit, p.ej. "0.0" usado en exportEficiencia.ts para "Media
 * personas/día"): extrae el sufijo entre comillas (si lo hay) y cuenta los
 * decimales del patrón numérico, en vez de asumir 0 y perder precisión.
 */
function formatNumFmtGenerico(n: number, numFmt: string): string {
  const sufijo = numFmt.match(/"([^"]*)"\s*$/)?.[1]?.trim() ?? "";
  const decimales = numFmt.match(/\.([0#]+)/)?.[1]?.length ?? 0;
  const base = formatNumeroEsFijo(n, decimales);
  return sufijo ? `${base} ${sufijo}` : base;
}

/**
 * Formatea un valor crudo (number/Date/string) para mostrarlo en una celda
 * PDF con las MISMAS reglas es-ES que Excel aplicaría vía `columna.numFmt`
 * (o el tipo por defecto de `resolverNumFmt`/`resolverAlineacion`). Es la
 * pieza central de la paridad: un valor `1234.5` en una columna `FMT_KG`
 * sale "1.234,50 kg" tanto en Excel como en PDF.
 */
export function formatCeldaPdf(valor: unknown, columna: ColumnaTabla): string {
  if (valor === null || valor === undefined || valor === "") return "";

  const numFmt = resolverNumFmt(columna);

  if (numFmt === FMT_FECHA || numFmt === FMT_FECHA_HORA) {
    // `formatDateRobusto` ya distingue fecha sola vs fecha+hora según el
    // propio valor (dd/mm/yyyy, o dd/mm/yyyy hh:mm si trae hora no-medianoche).
    return valor instanceof Date || typeof valor === "string" ? safeText(formatDateRobusto(valor)) : safeText(valor);
  }

  if (numFmt) {
    const n = typeof valor === "number" ? valor : Number(valor);
    if (Number.isFinite(n)) {
      const formatter = FMT_FORMATTERS[numFmt];
      return formatter ? formatter(n) : formatNumFmtGenerico(n, numFmt);
    }
  }

  if (typeof valor === "number") return formatNumeroEsFijo(valor, 2);
  if (valor instanceof Date) return safeText(formatDateRobusto(valor));
  return safeText(valor);
}

// ─── Alineación (mismo mapeo que Excel, "left" no necesita halign explícito) ─

function halignDe(columna: ColumnaTabla): ColumnaAlineacion | undefined {
  const align = resolverAlineacion(columna);
  return align === "left" ? undefined : align;
}

// ─── Identificador de exportación para el pie (paridad con el pie de Excel) ─

/**
 * Línea "Exportación: LST-AAAAMMDDHHMMSS-NNN · dd/mm/aaaa hh:mm" para el pie
 * de página PDF — el MISMO id/fecha que `construirLineasPie` (exportKit) pone
 * en el pie de todas las hojas Excel. Generar el id UNA vez por documento y
 * pasar la línea resultante a `drawExportFooter(doc, { exportInfo })` en cada
 * página (así todas las páginas del mismo PDF llevan el mismo id).
 */
export function lineaExportInfo(generadoEn = new Date(), exportId = generarExportId(generadoEn)): string {
  return `Exportación: ${exportId} · ${formatearFechaHoraExportacion(generadoEn)}`;
}

// ─── Márgenes / helpers de paginación compartidos (antes duplicados por archivo) ─

/** Margen de tabla por defecto (antes duplicado en exportPartes.ts/calidad.ts como `PDF_TABLE_MARGIN`). */
export const PDF_TABLE_MARGIN = { top: 30, bottom: 18, left: 8, right: 8 };

/** Y final de la última autoTable dibujada, o `fallback` si aún no se dibujó ninguna. */
export function lastAutoTableY(doc: jsPDF, fallback: number): number {
  return (doc as jsPDF & { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? fallback;
}

// ─── Tabla genérica dirigida por ColumnaTabla (el equivalente PDF de añadirHojaTabla) ─

export interface PdfTablaOptions {
  columnas: ColumnaTabla[];
  filas: Record<string, unknown>[];
  /** Valores por columna (por `key`) para la fila de totales; se omite si no se pasa (igual que en Excel). */
  totales?: Record<string, unknown>;
  startY: number;
  margin?: { top?: number; bottom?: number; left?: number; right?: number };
  /** Reenviado a autoTable tal cual (p.ej. para redibujar cabecera/pie en cada página nueva). */
  didDrawPage?: (data: Parameters<NonNullable<Parameters<typeof autoTable>[1]["didDrawPage"]>>[0]) => void;
  /** Estilos de tabla adicionales por índice de columna (se fusiona con la alineación resuelta de cada `ColumnaTabla`). */
  columnStyles?: Record<number, Partial<Styles>>;
}

/**
 * Tabla PDF construida directamente desde `ColumnaTabla[]`: cabecera, formato
 * numérico y alineación salen de la MISMA definición que usa `añadirHojaTabla`
 * (Excel) para esas columnas — no de un `head: [...]` re-tecleado a mano. La
 * fila de totales (si se pasa) se pinta en negrita con fondo verde muy claro
 * y borde superior verde, igual que la fila de totales del motor Excel.
 */
export function pdfTablaDesdeColumnas(doc: jsPDF, opts: PdfTablaOptions): number {
  const head = [opts.columnas.map((c) => safeText(c.header))];
  const body = opts.filas.map((fila) => opts.columnas.map((c) => formatCeldaPdf(fila[c.key], c)));
  const totalRowIndex = opts.totales ? body.length : -1;
  if (opts.totales) {
    const totales = opts.totales;
    body.push(opts.columnas.map((c) => (c.key in totales ? formatCeldaPdf(totales[c.key], c) : "")));
  }

  const columnStyles: Record<number, Partial<Styles>> = {};
  opts.columnas.forEach((c, i) => {
    const halign = halignDe(c);
    columnStyles[i] = {
      ...(halign ? { halign } : {}),
      ...(opts.columnStyles?.[i] ?? {}),
    };
  });

  const theme = pdfTableTheme();
  autoTable(doc, {
    startY: opts.startY,
    head,
    body,
    margin: opts.margin ?? PDF_TABLE_MARGIN,
    ...theme,
    columnStyles,
    didParseCell: (data: CellHookData) => {
      if (totalRowIndex >= 0 && data.section === "body" && data.row.index === totalRowIndex) {
        data.cell.styles.fontStyle = "bold";
        data.cell.styles.fillColor = PDF_THEME.creamStrong;
      }
    },
    didDrawPage: opts.didDrawPage,
  });

  return lastAutoTableY(doc, opts.startY);
}

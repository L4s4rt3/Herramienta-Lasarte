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
  LASARTE_FISCAL,
  resolverAlineacion,
  resolverNumFmt,
  type ColumnaAlineacion,
  type ColumnaTabla,
} from "./exportKit";
import { drawKpiCard, drawLogoOrFallback, logoImagenDisponible, PDF_THEME, pdfTableTheme } from "./exportTheme";
import { REPORT_BRAND, reportToneColor, type ReportKpi } from "./reportKit";

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

// ─── Registro FORMAL/LEGAL de documento (encargo jul-2026) ─────────────────
// El dueño aportó un PDF de muestra "muy profesional y ordenado y legal" y
// pidió replicar su estructura EXACTA (adaptada a la marca Lasarte) en los
// informes PDF: cabecera con razón social + "DOCUMENTO Nº" + "FECHA EMISIÓN"
// en TODAS las páginas, portada con título espaciado + metadatos formales
// OBJETO/PERIODO/FUENTE, secciones numeradas, pie legal de 3 líneas, y un
// párrafo de cierre/atestación en la última página. Estas piezas son
// COMPONIBLES (no un único "documentoFormal" monolítico) para que cada
// informe (exportPartes.ts, exportConsumo.ts, exportEficiencia.ts,
// calidad.ts) decida sus propias secciones sin perder la estructura común.
// El CONTENIDO/DATOS de cada informe NO cambia — solo se reorganiza bajo
// este esqueleto — y las tablas siguen usando pdfTablaDesdeColumnas/
// pdfTableTheme ya existentes (cabecera azul corporativa, zebra, alineación
// desde ColumnaTabla).

/** Fecha "dd/mm/aaaa" sin hora, para "FECHA EMISIÓN" en la cabecera formal (a diferencia de `formatearFechaHoraExportacion`, que sí lleva hora). */
export function formatearFechaEmision(fecha: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(fecha.getDate())}/${pad(fecha.getMonth() + 1)}/${fecha.getFullYear()}`;
}

export interface CabeceraDocumentoOptions {
  /** Número único del documento (usar `generarExportId()`, p.ej. "LST-20260717...-001"). El MISMO número en todas las páginas. */
  documentoNumero: string;
  /** Subtítulo pequeño bajo la razón social; por defecto el nombre genérico de la herramienta (`REPORT_BRAND.tool`). */
  subtitulo?: string;
  /** Fecha de emisión mostrada en la cabecera; por defecto `new Date()`. Fijar UNA vez por documento (misma fecha en todas las páginas). */
  fechaEmision?: Date;
}

/**
 * Cabecera FORMAL (spec del PDF de muestra): razón social grande + logo a la
 * izquierda con el subtítulo de la herramienta debajo; a la derecha
 * "DOCUMENTO Nº" (etiqueta pequeña) + el número único, y "FECHA EMISIÓN
 * dd/mm/aaaa" debajo; línea con CIF + dirección fiscal; separador fino. Debe
 * dibujarse en TODAS las páginas del documento (portada incluida) para que
 * el número de documento sea visible siempre, como en el PDF de muestra.
 * Devuelve el Y a partir del cual puede empezar el contenido de la página.
 */
export function cabeceraDocumento(doc: jsPDF, opts: CabeceraDocumentoOptions): number {
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 10;
  const fechaEmision = opts.fechaEmision ?? new Date();

  // Footprint deliberadamente compacto (banda de 24mm, contenido útil a
  // partir de 26mm): el mismo hueco que ya reservaban `drawExportHeader` +
  // `PDF_TABLE_MARGIN.top` (22mm de banda + separador en 22, contenido desde
  // ~26) para que exportPartes.ts/exportConsumo.ts/exportEficiencia.ts/
  // calidad.ts puedan sustituir su cabecera SIN tener que re-calcular todas
  // las coordenadas fijas de sus páginas de detalle.
  doc.setFillColor(...PDF_THEME.white);
  doc.rect(0, 0, pageWidth, 24, "F");

  // `drawLogoOrFallback` YA escribe la razón social como texto cuando el logo
  // no está disponible (fallback silencioso); su valor de retorno es el ancho
  // ocupado en AMBOS casos (imagen o texto). Si se vuelve a escribir la razón
  // social aparte SIEMPRE que el ancho sea >0 (como antes), sale duplicada
  // cuando cae al fallback — "Lasarte Cítricos S.L. Lasarte Cítricos S.L.",
  // verificado generando un PDF real sin logo cacheado. `logoImagenDisponible()`
  // distingue ambos casos: solo se re-escribe la razón social cuando SÍ hay
  // imagen de logo (el fallback de texto ya la puso por su cuenta).
  const conLogoImagen = logoImagenDisponible();
  const logoWidth = drawLogoOrFallback(doc, margin, 3, 10, {
    x: margin,
    yBaseline: 9.5,
    fontSize: 10.5,
    color: PDF_THEME.primaryDark,
  });
  const textX = margin + logoWidth + 4;

  if (conLogoImagen) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10.5);
    doc.setTextColor(...PDF_THEME.primaryDark);
    doc.text(safeText(LASARTE_FISCAL.nombre), textX, 9.5);
  }
  doc.setFont("helvetica", "normal");
  doc.setFontSize(6.5);
  doc.setTextColor(...PDF_THEME.muted);
  doc.text(safeText(opts.subtitulo ?? REPORT_BRAND.tool), textX, 13.5);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(6);
  doc.setTextColor(...PDF_THEME.muted);
  doc.text("DOCUMENTO Nº", pageWidth - margin, 6, { align: "right" });
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  doc.setTextColor(...PDF_THEME.primaryDark);
  doc.text(safeText(opts.documentoNumero), pageWidth - margin, 10.5, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(6);
  doc.setTextColor(...PDF_THEME.muted);
  doc.text(`FECHA EMISIÓN ${formatearFechaEmision(fechaEmision)}`, pageWidth - margin, 14.5, { align: "right" });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(6);
  doc.setTextColor(...PDF_THEME.muted);
  doc.text(safeText(`CIF ${LASARTE_FISCAL.cif} · ${LASARTE_FISCAL.direccion}`), margin, 19);

  doc.setDrawColor(...PDF_THEME.border);
  doc.setLineWidth(0.3);
  doc.line(margin, 21.5, pageWidth - margin, 21.5);

  return 26;
}

// ─── Título de portada espaciado ("I N F O R M E   D E   P A R T E S") ────

/** "informe de partes" -> "I N F O R M E   D E   P A R T E S" (letras espaciadas, palabras separadas por 3 espacios), igual que el título de portada del PDF de muestra. Función pura y testeable sin jsPDF. */
export function tituloPortadaEspaciado(titulo: string): string {
  return titulo
    .toUpperCase()
    .split(" ")
    .filter((palabra) => palabra.length > 0)
    .map((palabra) => palabra.split("").join(" "))
    .join("   ");
}

// ─── Metadatos formales OBJETO / PERIODO / FUENTE ──────────────────────────

export interface MetadatoItem {
  etiqueta: string;
  valor: string;
}

/** Texto de FUENTE por defecto para el bloque de metadatos (spec del PDF de muestra: "Registros gestionados en la herramienta de [razón social]"). */
// Sin punto final propio: `LASARTE_FISCAL.nombre` ya termina en "S.L." (que
// incluye su propio punto), así que añadir otro dejaría "S.L.." (verificado
// generando un PDF real).
export const FUENTE_INFORME_DEFECTO = `Registros gestionados en la herramienta de ${LASARTE_FISCAL.nombre}`;

/**
 * Construye el bloque de metadatos formales OBJETO/PERIODO/FUENTE (y, si se
 * pasa, un cuarto ítem opcional p.ej. CLASIFICACIÓN) como lista de pares
 * etiqueta->valor. Función PURA (sin jsPDF) para poder testear la
 * composición de textos de objeto/periodo de forma aislada.
 */
export function construirMetadatosInforme(
  objeto: string,
  periodo: string,
  opts: { fuente?: string; extra?: MetadatoItem[] } = {},
): MetadatoItem[] {
  return [
    { etiqueta: "OBJETO", valor: objeto },
    { etiqueta: "PERIODO", valor: periodo },
    { etiqueta: "FUENTE", valor: opts.fuente ?? FUENTE_INFORME_DEFECTO },
    ...(opts.extra ?? []),
  ];
}

/** Caja con los metadatos formales a dos columnas etiqueta->valor. Devuelve el Y donde puede continuar el contenido. */
export function bloqueMetadatos(doc: jsPDF, y: number, items: MetadatoItem[]): number {
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 10;
  const width = pageWidth - margin * 2;
  const labelWidth = 34;
  const valueWidth = width - labelWidth - 10;
  const lineHeight = 4.6;

  const wrapped = items.map((item) => ({
    item,
    lines: doc.splitTextToSize(safeText(item.valor), valueWidth) as string[],
  }));
  const contentHeight = wrapped.reduce((sum, w) => sum + Math.max(1, w.lines.length) * lineHeight, 0);
  const boxHeight = contentHeight + 8;

  doc.setFillColor(...PDF_THEME.creamStrong);
  doc.setDrawColor(...PDF_THEME.border);
  doc.setLineWidth(0.25);
  doc.roundedRect(margin, y, width, boxHeight, 1.5, 1.5, "FD");

  let rowY = y + 6.5;
  wrapped.forEach(({ item, lines }) => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    doc.setTextColor(...PDF_THEME.primaryDark);
    doc.text(safeText(item.etiqueta), margin + 5, rowY);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...PDF_THEME.text);
    doc.text(lines, margin + 5 + labelWidth, rowY);
    rowY += Math.max(1, lines.length) * lineHeight;
  });

  return y + boxHeight + 6;
}

export interface PortadaFormalOptions {
  /** Título del informe, p.ej. "Informe de partes diarios" — se espacia automáticamente (`tituloPortadaEspaciado`). */
  titulo: string;
  objeto: string;
  periodo: string;
  fuente?: string;
  /** Metadatos adicionales (p.ej. CLASIFICACIÓN para RRHH) tras FUENTE. */
  metadatosExtra?: MetadatoItem[];
}

/** Portada formal: título espaciado centrado + razón social + bloque de metadatos OBJETO/PERIODO/FUENTE. Se dibuja DESPUÉS de `cabeceraDocumento` en la primera página. Devuelve el Y donde debe empezar la primera sección numerada. */
export function portadaFormal(doc: jsPDF, y: number, opts: PortadaFormalOptions): number {
  const pageWidth = doc.internal.pageSize.getWidth();
  const centerX = pageWidth / 2;
  let currentY = y + 7;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.setTextColor(...PDF_THEME.primaryDark);
  doc.text(tituloPortadaEspaciado(opts.titulo), centerX, currentY, { align: "center" });
  currentY += 7;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...PDF_THEME.muted);
  doc.text(safeText(LASARTE_FISCAL.nombre), centerX, currentY, { align: "center" });
  currentY += 8;

  return bloqueMetadatos(
    doc,
    currentY,
    construirMetadatosInforme(opts.objeto, opts.periodo, { fuente: opts.fuente, extra: opts.metadatosExtra }),
  );
}

// ─── Secciones numeradas ("1. INDICADORES PRINCIPALES") ────────────────────

/** "Indicadores principales" -> "1. INDICADORES PRINCIPALES". Función pura y testeable sin jsPDF. */
export function textoSeccionNumerada(numero: number, titulo: string): string {
  return `${numero}. ${titulo.toUpperCase()}`;
}

/** Contador de secciones simple (1, 2, 3...) para no repartir números a mano en cada informe. Cada llamada devuelve el SIGUIENTE número; `inicio` por defecto 1. */
export function crearNumeradorSecciones(inicio = 1): () => number {
  let n = inicio - 1;
  return () => {
    n += 1;
    return n;
  };
}

/** Título de sección numerada con barra de acento + línea separadora. Devuelve el Y donde puede empezar el contenido de la sección. */
export function tituloSeccionNumerada(doc: jsPDF, y: number, numero: number, titulo: string, subtitulo?: string): number {
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 10;

  doc.setFillColor(...PDF_THEME.primaryDark);
  doc.rect(margin, y, 3, 6, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10.5);
  doc.setTextColor(...PDF_THEME.primaryDark);
  doc.text(textoSeccionNumerada(numero, titulo), margin + 6, y + 5);

  let bottom = y + 9;
  if (subtitulo) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...PDF_THEME.muted);
    doc.text(safeText(subtitulo), margin + 6, bottom);
    bottom += 4;
  }
  doc.setDrawColor(...PDF_THEME.border);
  doc.setLineWidth(0.2);
  doc.line(margin, bottom, pageWidth - margin, bottom);
  return bottom + 4;
}

// ─── Grid de KPIs bajo una sección numerada (antes solo dentro de drawReportCover) ─
// Misma composición visual que `drawReportCover` (reportKit.ts) usaba para sus
// tarjetas de KPI, extraída aquí para poder colocarla bajo "1. INDICADORES
// PRINCIPALES" en vez de dentro de la banda de portada propia (ahora
// sustituida por `portadaFormal`). Reutiliza `drawKpiCard`/`reportToneColor`
// tal cual — NINGÚN cambio visual en la tarjeta individual, solo en dónde se
// coloca el grid.
export function dibujarKpisEnGrid(doc: jsPDF, y: number, kpis: ReportKpi[], columnasMax = 5): number {
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 10;
  const usableWidth = pageWidth - margin * 2;
  const totalKpis = Math.min(kpis.length, columnasMax * 2);
  const columns = Math.min(Math.max(totalKpis, 1), columnasMax);
  const gap = 3;
  const cardW = (usableWidth - gap * (columns - 1)) / columns;
  const rows = Math.ceil(totalKpis / columns);

  kpis.slice(0, totalKpis).forEach((kpi, index) => {
    const col = index % columns;
    const row = Math.floor(index / columns);
    const x = margin + col * (cardW + gap);
    const cardY = y + row * 24;
    drawKpiCard(doc, x, cardY, cardW, kpi.label, String(kpi.value), kpi.sub);
    doc.setFillColor(...reportToneColor(kpi.tone));
    doc.roundedRect(x, cardY, cardW, 2.6, 1, 1, "F");
  });

  return y + rows * 24 + 6;
}

// ─── Pie legal (3 líneas, en TODAS las páginas) ────────────────────────────

/** "Lasarte Cítricos S.L. · Documento de uso interno    Ref.: LST-...". Función pura y testeable sin jsPDF. */
export function textoPieRef(exportId: string): string {
  return `${LASARTE_FISCAL.nombre} · Documento de uso interno    Ref.: ${exportId}`;
}

/** Segunda línea fija del pie legal (validez sin firma manuscrita + uso interno). */
export const PIE_LEGAL_LINEA_2 =
  "Documento generado electrónicamente. Su contenido es válido sin firma manuscrita.    USO INTERNO";

export interface PieLegalOptions {
  /** Número único del documento (el MISMO que en `cabeceraDocumento`). */
  exportId: string;
}

/**
 * Pie legal de 3 líneas pequeñas (spec del PDF de muestra): razón social +
 * "Documento de uso interno" + Ref.; aviso de validez sin firma + "USO
 * INTERNO"; y "Página X de Y" (esta última la rellena `finalizarPaginacionFormal`
 * al final, cuando ya se conoce el total de páginas — igual que
 * `finalizeExportPageNumbers` en exportTheme.ts). Dibujar en TODAS las páginas.
 */
export function pieLegal(doc: jsPDF, opts: PieLegalOptions): void {
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const centerX = pageWidth / 2;

  doc.setDrawColor(...PDF_THEME.border);
  doc.setLineWidth(0.2);
  doc.line(10, pageHeight - 14, pageWidth - 10, pageHeight - 14);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(6);
  doc.setTextColor(...PDF_THEME.muted);
  doc.text(safeText(textoPieRef(opts.exportId)), centerX, pageHeight - 10.5, { align: "center" });
  doc.text(safeText(PIE_LEGAL_LINEA_2), centerX, pageHeight - 7.5, { align: "center" });
}

/**
 * Recorre TODAS las páginas ya generadas y escribe la 3ª línea del pie legal
 * ("Página X de Y", centrada) una vez conocido el total — mismo patrón que
 * `finalizeExportPageNumbers` (exportTheme.ts): debe llamarse UNA sola vez al
 * final de cada export, justo antes de `doc.save(...)`.
 */
export function finalizarPaginacionFormal(doc: jsPDF): void {
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const total = doc.getNumberOfPages();
  for (let i = 1; i <= total; i += 1) {
    doc.setPage(i);
    doc.setFillColor(...PDF_THEME.white);
    doc.rect(pageWidth / 2 - 30, pageHeight - 6.5, 60, 3.6, "F");
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6);
    doc.setTextColor(...PDF_THEME.muted);
    doc.text(`Página ${i} de ${total}`, pageWidth / 2, pageHeight - 4, { align: "center" });
  }
}

// ─── Cierre / atestación (última página) ───────────────────────────────────

/** Párrafo de atestación: "El presente informe resume [objeto] del periodo [periodo]...". Función pura y testeable sin jsPDF. */
export function textoAtestacion(objeto: string, periodo: string): string {
  // Un solo punto entre la razón social y "Y para que conste": `LASARTE_FISCAL.nombre`
  // ya termina en "S.L." (con su propio punto), así que NO se añade otro
  // (antes: "S.L.. Y para que conste...", verificado generando un PDF real).
  return `El presente informe resume ${objeto} del periodo ${periodo}, elaborado a partir de los registros gestionados en la herramienta de ${LASARTE_FISCAL.nombre} Y para que conste a los efectos oportunos, se emite el presente informe.`;
}

/** "Emitido electrónicamente por la herramienta de [razón social] el dd/mm/aaaa, HH:mm.". Función pura y testeable sin jsPDF. */
export function textoEmisionElectronica(generadoEn: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const fecha = formatearFechaEmision(generadoEn);
  const hora = `${pad(generadoEn.getHours())}:${pad(generadoEn.getMinutes())}`;
  return `Emitido electrónicamente por la herramienta de ${LASARTE_FISCAL.nombre} el ${fecha}, ${hora}.`;
}

export interface CierreAtestacionOptions {
  objeto: string;
  periodo: string;
  /** Fecha/hora de emisión mostrada en la última línea; por defecto `new Date()` (usar la MISMA que `cabeceraDocumento`/`generarExportId` del documento). */
  generadoEn?: Date;
}

/** Bloque de cierre (última página): párrafo de atestación + línea de emisión electrónica. Devuelve el Y final tras el bloque. */
export function cierreAtestacion(doc: jsPDF, y: number, opts: CierreAtestacionOptions): number {
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 10;
  const width = pageWidth - margin * 2;
  const generadoEn = opts.generadoEn ?? new Date();

  doc.setDrawColor(...PDF_THEME.border);
  doc.setLineWidth(0.2);
  doc.line(margin, y, pageWidth - margin, y);

  let currentY = y + 8;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(...PDF_THEME.text);
  const parrafo = doc.splitTextToSize(safeText(textoAtestacion(opts.objeto, opts.periodo)), width);
  doc.text(parrafo, margin, currentY);
  currentY += parrafo.length * 4.4 + 8;

  doc.setFont("helvetica", "italic");
  doc.setFontSize(7.5);
  doc.setTextColor(...PDF_THEME.muted);
  doc.text(safeText(textoEmisionElectronica(generadoEn)), margin, currentY);

  return currentY + 6;
}

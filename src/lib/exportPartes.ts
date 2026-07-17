import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { computeCascade, CascadeInput, CascadeResult } from "./cascade";
import { formatDate, formatKg } from "./format";
import { PDF_THEME, drawKpiCard, pdfTableTheme } from "./exportTheme";
import { appendDictionarySheet, appendRowsSheet, createWorkbook, excelText, splitExcelText } from "./exportWorkbook";
import {
  añadirHojaTabla,
  crearLibroLasarte,
  descargarLibro,
  FMT_INT,
  FMT_KG,
  FMT_PCT,
  generarExportId,
  type ColumnaTabla,
  type ExcelWorkbookCtx,
} from "./exportKit";
import {
  cabeceraDocumento,
  cierreAtestacion,
  crearNumeradorSecciones,
  dibujarKpisEnGrid,
  finalizarPaginacionFormal,
  lastAutoTableY,
  PDF_TABLE_MARGIN,
  pieLegal,
  portadaFormal,
  safeText,
  tituloSeccionNumerada,
} from "./pdfKit";
import {
  appendReportCoverSheet,
  buildLasarteFilename,
  drawReportInsights,
  drawReportSectionTitle,
  ensureExportLogoLoaded,
  type ReportInsight,
  type ReportKpi,
  type ReportMeta,
} from "./reportKit";

interface ProductoDetalleIA extends Record<string, unknown> {
  linea?: unknown;
  producto?: unknown;
  formato_caja?: unknown;
  empaque?: unknown;
  grupo_destino?: unknown;
  kg?: unknown;
  n_cajas?: unknown;
  cajas?: unknown;
}

interface PaletDetalleIA extends Record<string, unknown> {
  palet_id?: unknown;
  producto?: unknown;
  cliente?: unknown;
  destino?: unknown;
  situacion?: unknown;
  kg_neto?: unknown;
  n_cajas?: unknown;
}

interface ResumenIA extends Record<string, unknown> {
  producto_detalle?: unknown;
  palets_detalle?: unknown;
  analisis?: unknown;
}

export interface ParteRow {
  id: string;
  date: string;
  estado: string;
  kg_produccion_calibrador?: number | null;
  kg_mujeres_calibrador?: number | null;
  kg_palets_brutos?: number | null;
  kg_palets_egipto?: number | null;
  kg_palets_campo?: number | null;
  kg_podrido_calibrador_auto?: number | null;
  kg_industria_manual?: number | null;
  kg_reciclado_malla_z1?: number | null;
  kg_reciclado_malla_z2?: number | null;
  kg_inventario_sin_alta?: number | null;
  kg_podrido_bolsa_basura?: number | null;
  kg_inventario_anterior_sin_alta?: number | null;
  notas_generales?: string | null;
  notas_inventario?: string | null;
  resumen_ia?: ResumenIA | null;
}

function n(value: unknown): number {
  return Number(value) || 0;
}

function buildCascade(p: ParteRow): CascadeResult {
  const input: CascadeInput = {
    kg_produccion_calibrador: n(p.kg_produccion_calibrador),
    kg_mujeres_calibrador: n(p.kg_mujeres_calibrador),
    kg_palets_brutos: n(p.kg_palets_brutos) - n(p.kg_palets_egipto),
    kg_podrido_calibrador: n(p.kg_podrido_calibrador_auto),
    kg_industria_manual: n(p.kg_industria_manual),
    kg_reciclado_malla_z1: n(p.kg_reciclado_malla_z1),
    kg_reciclado_malla_z2: n(p.kg_reciclado_malla_z2),
    kg_inventario_sin_alta: n(p.kg_inventario_sin_alta),
    kg_podrido_bolsa_basura: n(p.kg_podrido_bolsa_basura),
    kg_inventario_anterior_sin_alta: n(p.kg_inventario_anterior_sin_alta),
  };
  return computeCascade(input);
}

function pct(part: number, total: number, digits = 1) {
  return total > 0 ? +((part / total) * 100).toFixed(digits) : 0;
}

function kg(value: number, digits = 0) {
  return +value.toFixed(digits);
}

// safePdf() ELIMINABA tildes/e\u00f1es ("Producci\u00f3n" -> "Produccion") \u2014 corregido:
// jsPDF con la fuente est\u00e1ndar "helvetica" SI las soporta (verificado con un
// PDF real: "Producci\u00f3n", "\u00e1\u00e9\u00ed\u00f3\u00fa \u00c1\u00c9\u00cd\u00d3\u00da \u00f1\u00d1" salen perfectos), as\u00ed que quitarlas
// solo romp\u00eda la paridad visual con Excel (que las conserva). `safeText`
// (pdfKit.ts) solo recorta espacios/caracteres de control.
const safePdf = safeText;

function pdfDate(value: string | Date) {
  return safePdf(formatDate(value));
}

function reportDate(value: string | Date) {
  const date = typeof value === "string" ? new Date(value) : value;
  return date.toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function pdfKg(value: number, digits = 0) {
  return safePdf(formatKg(value, digits));
}

/** Porcentaje con signo y coma decimal es-ES ("+2,37%") — antes `toFixed` dejaba el punto anglosajón ("+2.37%"), inconsistente con el resto de números del documento. */
function pdfPct(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2).replace(".", ",")}%`;
}

function semLabel(s: "verde" | "amarillo" | "rojo"): string {
  return s === "verde" ? "[OK] <= 3%" : s === "amarillo" ? "[!] 3-5%" : "[X] > 5%";
}

function semColor(s: "verde" | "amarillo" | "rojo"): [number, number, number] {
  return s === "verde" ? PDF_THEME.success : s === "amarillo" ? PDF_THEME.warning : PDF_THEME.destructive;
}

function flattenProducto(partes: ParteRow[]) {
  return partes.flatMap((p) => {
    const rows = p.resumen_ia?.producto_detalle;
    if (!Array.isArray(rows)) return [];
    return rows.map((r: ProductoDetalleIA) => ({
      Fecha: formatDate(p.date),
      Linea: String(r.linea ?? ""),
      Producto: String(r.producto ?? ""),
      "Formato caja": String(r.formato_caja ?? r.empaque ?? ""),
      "Grupo destino": String(r.grupo_destino ?? ""),
      "Kg": n(r.kg),
      "Cajas": n(r.n_cajas ?? r.cajas),
    }));
  });
}

function flattenPalets(partes: ParteRow[]) {
  return partes.flatMap((p) => {
    const rows = p.resumen_ia?.palets_detalle;
    if (!Array.isArray(rows)) return [];
    return rows.map((r: PaletDetalleIA) => ({
      Fecha: formatDate(p.date),
      Palet: String(r.palet_id ?? ""),
      Producto: String(r.producto ?? ""),
      Cliente: String(r.cliente ?? ""),
      Destino: String(r.destino ?? ""),
      Situacion: String(r.situacion ?? ""),
      "Kg neto": n(r.kg_neto),
      "Cajas": n(r.n_cajas),
    }));
  });
}

export interface PartesReportSummary {
  meta: ReportMeta;
  kpis: ReportKpi[];
  insights: ReportInsight[];
  totals: {
    totalProd: number;
    totalPalets: number;
    totalDsj: number;
    totalMermas: number;
    dsjPctGlobal: number;
  };
  counts: {
    nOk: number;
    nWarn: number;
    nCrit: number;
  };
  worst: { p: ParteRow; c: CascadeResult } | null;
}

export function buildPartesReportSummary(partes: ParteRow[], from: string, to: string): PartesReportSummary {
  const enriched = partes.map((p) => ({ p, c: buildCascade(p) }));
  const totalProd = enriched.reduce((s, { c }) => s + c.produccion_real, 0);
  const totalPalets = enriched.reduce((s, { c }) => s + c.palets_ajustados, 0);
  const totalDsj = enriched.reduce((s, { c }) => s + c.dsj, 0);
  const totalMermas = enriched.reduce((s, { c }) => s + c.mermas_totales, 0);
  const dsjPctGlobal = totalProd > 0 ? (totalDsj / totalProd) * 100 : 0;
  const nOk = enriched.filter(({ c }) => Math.abs(c.dsj_pct) <= 3).length;
  const nWarn = enriched.filter(({ c }) => Math.abs(c.dsj_pct) > 3 && Math.abs(c.dsj_pct) <= 5).length;
  const nCrit = enriched.filter(({ c }) => Math.abs(c.dsj_pct) > 5).length;
  const worst = enriched.reduce<typeof enriched[number] | null>(
    (acc, row) => (!acc || Math.abs(row.c.dsj_pct) > Math.abs(acc.c.dsj_pct) ? row : acc),
    null,
  );

  const insights: ReportInsight[] = [
    {
      label: "Lectura",
      value: "El semaforo usa el valor absoluto de DJPMN %: OK hasta 3%, revisar hasta 5% y critico por encima.",
      tone: "info",
    },
    {
      label: "Trazabilidad",
      value: "Documento de control interno asociado a produccion, calidad y trazabilidad agroalimentaria (Reg. 178/2002).",
      tone: "info",
    },
  ];
  if (worst) {
    insights.push({
      label: "Dia a revisar",
      value: `${formatDate(worst.p.date)} · ${pdfPct(worst.c.dsj_pct)} DJPMN`,
      tone: Math.abs(worst.c.dsj_pct) > 5 ? "danger" : Math.abs(worst.c.dsj_pct) > 3 ? "warning" : "success",
    });
  }

  return {
    meta: {
      title: "Informe de partes diarios",
      subtitle: "Produccion, cascada DJPMN y trazabilidad",
      periodLabel: `${reportDate(from)} - ${reportDate(to)} · ${partes.length} parte(s)`,
    },
    kpis: [
      { label: "Produccion real", value: formatKg(totalProd, 0), sub: `${partes.length} parte(s)`, tone: "info" },
      { label: "Palets ajustados", value: formatKg(totalPalets, 0), sub: "alta neta", tone: "neutral" },
      { label: "DJPMN total", value: formatKg(totalDsj, 0), sub: `${pdfPct(dsjPctGlobal)} global`, tone: Math.abs(dsjPctGlobal) > 5 ? "danger" : Math.abs(dsjPctGlobal) > 3 ? "warning" : "success" },
      { label: "Mermas totales", value: formatKg(totalMermas, 0), sub: "podrido manual", tone: "neutral" },
      { label: "Dias OK", value: nOk, sub: "<= 3%", tone: "success" },
      { label: "Dias criticos", value: nCrit, sub: "> 5%", tone: nCrit > 0 ? "danger" : "success" },
    ],
    insights,
    totals: {
      totalProd,
      totalPalets,
      totalDsj,
      totalMermas,
      dsjPctGlobal,
    },
    counts: {
      nOk,
      nWarn,
      nCrit,
    },
    worst,
  };
}

export function buildPartesWorkbook(partes: ParteRow[], from: string, to: string) {
  const enriched = partes.map((p) => ({ p, c: buildCascade(p) }));
  const wb = createWorkbook("Lasarte Cítricos S.L. - Informe de partes", "Control de produccion y DJPMN");
  const summary = buildPartesReportSummary(partes, from, to);

  appendReportCoverSheet(wb, summary.meta, summary.kpis);

  const appendPartesSheet = (name: string, rows: Record<string, unknown>[], cols: number[]) =>
    appendRowsSheet(wb, name, rows, cols, { freezeHeader: true, overflowSheetName: "IA fragmentos" });

  const detalleRows = enriched.map(({ p, c }) => ({
    Fecha: formatDate(p.date),
    Estado: p.estado,
    Semaforo: semLabel(c.semaforo),
    "Produccion real kg": kg(c.produccion_real, 2),
    "Palets ajustados kg": kg(c.palets_ajustados, 2),
    "Inventario final kg": kg(c.inventario_final, 2),
    "Diferencia bruta kg": kg(c.diferencia_bruta, 2),
    "Podrido manual kg": kg(c.podrido_manual, 2),
    "Mermas totales kg": kg(c.mermas_totales, 2),
    "DJPMN kg": kg(c.dsj, 2),
    "DJPMN %": +c.dsj_pct.toFixed(3),
    "Mermas % prod": +c.mermas_pct.toFixed(3),
    "Produccion vs palets kg": kg(c.produccion_real - c.palets_ajustados, 2),
    "Produccion vs palets %": +pct(c.produccion_real - c.palets_ajustados, c.produccion_real, 3).toFixed(3),
    "Abs DJPMN %": +Math.abs(c.dsj_pct).toFixed(3),
    "Notas generales": p.notas_generales ?? "",
  }));
  appendPartesSheet("Detalle diario", detalleRows, [14, 16, 14, 18, 18, 18, 18, 18, 18, 14, 12, 14, 20, 18, 14, 45]);

  const cascadeRows = enriched.flatMap(({ p, c }) => [
    { Fecha: formatDate(p.date), Bloque: "Produccion real", Concepto: "Calibrador", Op: "=", "Kg": kg(c.produccion_calibrador, 2), "Resultado": "" },
    { Fecha: formatDate(p.date), Bloque: "Produccion real", Concepto: "Mujeres clase L", Op: "-", "Kg": kg(c.mujeres, 2), "Resultado": "" },
    { Fecha: formatDate(p.date), Bloque: "Produccion real", Concepto: "Reciclado malla Z1", Op: "-", "Kg": kg(c.reciclado_z1, 2), "Resultado": "" },
    { Fecha: formatDate(p.date), Bloque: "Produccion real", Concepto: "Reciclado malla Z2", Op: "-", "Kg": kg(c.reciclado_z2, 2), "Resultado": kg(c.produccion_real, 2) },
    { Fecha: formatDate(p.date), Bloque: "Palets e inventario", Concepto: "Palets alta bruto", Op: "=", "Kg": kg(c.palets_brutos, 2), "Resultado": "" },
    { Fecha: formatDate(p.date), Bloque: "Palets e inventario", Concepto: "Inventario dia anterior", Op: "-", "Kg": kg(c.inventario_anterior, 2), "Resultado": kg(c.palets_ajustados, 2) },
    { Fecha: formatDate(p.date), Bloque: "Mermas y DJPMN", Concepto: "Produccion real", Op: "=", "Kg": kg(c.produccion_real, 2), "Resultado": "" },
    { Fecha: formatDate(p.date), Bloque: "Mermas y DJPMN", Concepto: "Palets alta ajustados", Op: "-", "Kg": kg(c.palets_ajustados, 2), "Resultado": "" },
    { Fecha: formatDate(p.date), Bloque: "Mermas y DJPMN", Concepto: "Inventario final sin alta", Op: "-", "Kg": kg(c.inventario_final, 2), "Resultado": kg(c.diferencia_bruta, 2) },
    { Fecha: formatDate(p.date), Bloque: "Mermas y DJPMN", Concepto: "Podrido manual", Op: "-", "Kg": kg(c.podrido_manual, 2), "Resultado": kg(c.mermas_totales, 2) },
    { Fecha: formatDate(p.date), Bloque: "Resultado", Concepto: "DJPMN", Op: "=", "Kg": kg(c.dsj, 2), "Resultado": `${c.dsj_pct.toFixed(3)}%` },
  ]);
  appendPartesSheet("Cascada DJPMN", cascadeRows, [14, 22, 28, 8, 14, 16]);

  const rawRows = enriched.map(({ p }) => ({
    Fecha: formatDate(p.date),
    "Calibrador kg": n(p.kg_produccion_calibrador),
    "Industria manual kg": n(p.kg_industria_manual),
    "Mujeres L kg": n(p.kg_mujeres_calibrador),
    "Reciclado Z1 kg": n(p.kg_reciclado_malla_z1),
    "Reciclado Z2 kg": n(p.kg_reciclado_malla_z2),
    "Palets brutos kg": n(p.kg_palets_brutos),
    "Palets Egipto kg": n(p.kg_palets_egipto),
    "Palets campo kg": n(p.kg_palets_campo),
    "Inventario anterior kg": n(p.kg_inventario_anterior_sin_alta),
    "Inventario final kg": n(p.kg_inventario_sin_alta),
    "Podrido calibrador kg": n(p.kg_podrido_calibrador_auto),
    "Podrido manual kg": n(p.kg_podrido_bolsa_basura),
  }));
  appendPartesSheet("Datos entrada", rawRows, [14, 16, 18, 14, 16, 16, 16, 16, 16, 20, 18, 20, 18]);

  const productoRows = flattenProducto(partes);
  appendPartesSheet("Producto", productoRows, [14, 14, 36, 18, 18, 14, 12]);

  const paletsRows = flattenPalets(partes);
  appendPartesSheet("Palets", paletsRows, [14, 16, 36, 24, 18, 18, 14, 12]);

  const notasRows = partes.map((p) => ({
    Fecha: formatDate(p.date),
    Estado: p.estado,
    "Notas generales": p.notas_generales ?? "",
    "Notas inventario": p.notas_inventario ?? "",
    "Analisis IA": p.resumen_ia?.analisis ? String(p.resumen_ia.analisis) : "",
    "Resumen IA completo": p.resumen_ia ? excelText(JSON.stringify(p.resumen_ia)) : "",
  }));
  appendPartesSheet("Notas e IA", notasRows, [14, 16, 55, 55, 70, 55]);

  const iaFragmentRows = partes.flatMap((p) => {
    const raw = p.resumen_ia ? JSON.stringify(p.resumen_ia, null, 2) : "";
    return splitExcelText(raw).map((fragmento, index, arr) => ({
      Fecha: formatDate(p.date),
      Campo: "resumen_ia",
      Fragmento: `${index + 1}/${arr.length}`,
      Texto: fragmento,
    }));
  });
  if (iaFragmentRows.length > 0) {
    appendPartesSheet("IA fragmentos", iaFragmentRows, [14, 18, 12, 100]);
  }

  appendDictionarySheet(wb, [
    { Hoja: "Portada", Campo: "Lectura ejecutiva", Descripcion: "KPIs globales del rango exportado.", Uso: "Revision rapida de direccion." },
    { Hoja: "Detalle diario", Campo: "Una fila por parte", Descripcion: "Tabla principal para filtros, ordenaciones y tablas dinamicas.", Uso: "Trabajar con KPIs diarios." },
    { Hoja: "Detalle diario", Campo: "Abs DJPMN %", Descripcion: "Valor absoluto del descuadre porcentual.", Uso: "Ordenar por gravedad sin importar signo." },
    { Hoja: "Cascada DJPMN", Campo: "Bloque / Concepto / Op / Kg", Descripcion: "Cascada normalizada en formato largo.", Uso: "Crear pivots o auditar formula por parte." },
    { Hoja: "Datos entrada", Campo: "Campos brutos", Descripcion: "Datos originales usados para calcular la cascada.", Uso: "Auditoria y trazabilidad." },
    { Hoja: "Producto", Campo: "Producto, linea, grupo destino", Descripcion: "Detalle de producto cuando lo aporta el analisis.", Uso: "Cruzar produccion por producto y destino." },
    { Hoja: "Palets", Campo: "Palet, cliente, destino, kg neto", Descripcion: "Detalle de palets cuando lo aporta el analisis.", Uso: "Analisis de altas y salidas." },
    { Hoja: "Notas e IA", Campo: "Notas y resumen IA", Descripcion: "Texto operativo del parte. Los textos largos se fragmentan.", Uso: "Contexto de revision." },
  ]);

  return wb;
}

// ─── Excel con marca (motor exceljs de exportKit.ts) ───────────────────────────
// buildPartesWorkbook (arriba) usa el motor SheetJS antiguo (exportWorkbook.ts,
// sin estilos) y se mantiene tal cual únicamente porque exportReports.test.ts
// verifica su estructura de celdas. El export real de Partes usa desde aquí el
// motor con marca (crearLibroLasarte / añadirHojaTabla / descargarLibro), según
// docs/EXPORT_TEMPLATES_SPEC.md §1: hojas Resumen, Partes, Cascada DJPMN,
// Producto y Palets.

const PARTES_COLUMNAS: ColumnaTabla[] = [
  { header: "Fecha", key: "fecha", width: 14, align: "center" },
  { header: "Producción real", key: "produccionReal", width: 18, numFmt: FMT_KG, align: "right" },
  { header: "Palets ajustados", key: "paletsAjustados", width: 18, numFmt: FMT_KG, align: "right" },
  { header: "Inventario final", key: "inventarioFinal", width: 18, numFmt: FMT_KG, align: "right" },
  { header: "Diferencia bruta", key: "diferenciaBruta", width: 18, numFmt: FMT_KG, align: "right" },
  { header: "Podrido manual", key: "podridoManual", width: 16, numFmt: FMT_KG, align: "right" },
  { header: "Mermas totales", key: "mermasTotales", width: 16, numFmt: FMT_KG, align: "right" },
  { header: "Producción vs palets", key: "prodVsPalets", width: 18, numFmt: FMT_KG, align: "right" },
  { header: "% DJPMN", key: "pctDjpmn", width: 12, numFmt: FMT_PCT, align: "right" },
  { header: "Notas", key: "notas", width: 45 },
];

const CASCADA_COLUMNAS: ColumnaTabla[] = [
  { header: "Fecha", key: "fecha", width: 14, align: "center" },
  { header: "Bloque", key: "bloque", width: 22 },
  { header: "Concepto", key: "concepto", width: 28 },
  { header: "Operación", key: "operacion", width: 10, align: "center" },
  { header: "Kg", key: "kg", width: 16, numFmt: FMT_KG, align: "right" },
  { header: "Resultado", key: "resultado", width: 22, numFmt: FMT_KG, align: "right" },
];

const PRODUCTO_COLUMNAS: ColumnaTabla[] = [
  { header: "Producto", key: "producto", width: 32 },
  { header: "Formato caja", key: "formatoCaja", width: 18 },
  { header: "Grupo destino", key: "grupoDestino", width: 18 },
  { header: "Kg", key: "kg", width: 14, numFmt: FMT_KG, align: "right" },
  { header: "Cajas", key: "cajas", width: 12, numFmt: FMT_INT, align: "right" },
];

const PALETS_COLUMNAS: ColumnaTabla[] = [
  { header: "Producto", key: "producto", width: 32 },
  { header: "Cliente", key: "cliente", width: 22 },
  { header: "Destino", key: "destino", width: 18 },
  { header: "Kg neto", key: "kgNeto", width: 14, numFmt: FMT_KG, align: "right" },
  { header: "Cajas", key: "cajas", width: 12, numFmt: FMT_INT, align: "right" },
  { header: "Situación", key: "situacion", width: 16 },
];

const RESUMEN_COLUMNAS: ColumnaTabla[] = [
  { header: "Indicador", key: "indicador", width: 26 },
  { header: "Valor", key: "valor", width: 20, align: "right" },
  { header: "Detalle", key: "detalle", width: 40 },
];

export function buildPartesWorkbookLasarte(partes: ParteRow[], from: string, to: string): ExcelWorkbookCtx {
  const enriched = partes.map((p) => ({ p, c: buildCascade(p) }));
  const summary = buildPartesReportSummary(partes, from, to);
  const { totalProd, totalPalets, totalDsj, totalMermas, dsjPctGlobal } = summary.totals;
  const totalInventarioFinal = enriched.reduce((s, { c }) => s + c.inventario_final, 0);
  const totalDiferenciaBruta = enriched.reduce((s, { c }) => s + c.diferencia_bruta, 0);
  const totalPodridoManual = enriched.reduce((s, { c }) => s + c.podrido_manual, 0);

  const ctx = crearLibroLasarte({
    titulo: "Partes diarios de producción",
    periodo: `${reportDate(from)} - ${reportDate(to)}`,
    filtros: `${partes.length} parte(s)`,
    clasificacion: "Interno",
  });

  añadirHojaTabla(ctx, {
    nombreHoja: "Resumen",
    titulo: "Resumen ejecutivo del periodo",
    columnas: RESUMEN_COLUMNAS,
    filas: [
      { indicador: "Producción real", valor: formatKg(totalProd, 2), detalle: `${partes.length} parte(s) del rango exportado` },
      { indicador: "Palets ajustados", valor: formatKg(totalPalets, 2), detalle: "Alta neta de palets" },
      { indicador: "Diferencia bruta", valor: formatKg(totalDiferenciaBruta, 2), detalle: "Producción real - palets ajustados - inventario final" },
      {
        indicador: "% DJPMN",
        valor: `${dsjPctGlobal >= 0 ? "+" : ""}${dsjPctGlobal.toFixed(2)} %`,
        detalle: `${totalDsj >= 0 ? "+" : ""}${formatKg(totalDsj, 2)} global · mermas totales ${formatKg(totalMermas, 2)}`,
      },
    ],
    freeze: false,
    autofilter: false,
  });

  añadirHojaTabla(ctx, {
    nombreHoja: "Partes",
    columnas: PARTES_COLUMNAS,
    filas: enriched.map(({ p, c }) => ({
      fecha: formatDate(p.date),
      produccionReal: kg(c.produccion_real, 2),
      paletsAjustados: kg(c.palets_ajustados, 2),
      inventarioFinal: kg(c.inventario_final, 2),
      diferenciaBruta: kg(c.diferencia_bruta, 2),
      podridoManual: kg(c.podrido_manual, 2),
      mermasTotales: kg(c.mermas_totales, 2),
      prodVsPalets: kg(c.produccion_real - c.palets_ajustados, 2),
      pctDjpmn: +c.dsj_pct.toFixed(2),
      notas: p.notas_generales ?? "",
    })),
    totales: {
      fecha: "TOTAL",
      produccionReal: kg(totalProd, 2),
      paletsAjustados: kg(totalPalets, 2),
      inventarioFinal: kg(totalInventarioFinal, 2),
      diferenciaBruta: kg(totalDiferenciaBruta, 2),
      podridoManual: kg(totalPodridoManual, 2),
      mermasTotales: kg(totalMermas, 2),
      prodVsPalets: kg(totalProd - totalPalets, 2),
      pctDjpmn: +dsjPctGlobal.toFixed(2),
      notas: `${partes.length} parte(s)`,
    },
  });

  const cascadeRows = enriched.flatMap(({ p, c }) => [
    { fecha: formatDate(p.date), bloque: "Producción real", concepto: "Calibrador", operacion: "=", kg: kg(c.produccion_calibrador, 2), resultado: "" },
    { fecha: formatDate(p.date), bloque: "Producción real", concepto: "Mujeres clase L", operacion: "-", kg: kg(c.mujeres, 2), resultado: "" },
    { fecha: formatDate(p.date), bloque: "Producción real", concepto: "Reciclado malla Z1", operacion: "-", kg: kg(c.reciclado_z1, 2), resultado: "" },
    { fecha: formatDate(p.date), bloque: "Producción real", concepto: "Reciclado malla Z2", operacion: "-", kg: kg(c.reciclado_z2, 2), resultado: kg(c.produccion_real, 2) },
    { fecha: formatDate(p.date), bloque: "Palets e inventario", concepto: "Palets alta bruto", operacion: "=", kg: kg(c.palets_brutos, 2), resultado: "" },
    { fecha: formatDate(p.date), bloque: "Palets e inventario", concepto: "Inventario día anterior", operacion: "-", kg: kg(c.inventario_anterior, 2), resultado: kg(c.palets_ajustados, 2) },
    { fecha: formatDate(p.date), bloque: "Mermas y DJPMN", concepto: "Producción real", operacion: "=", kg: kg(c.produccion_real, 2), resultado: "" },
    { fecha: formatDate(p.date), bloque: "Mermas y DJPMN", concepto: "Palets alta ajustados", operacion: "-", kg: kg(c.palets_ajustados, 2), resultado: "" },
    { fecha: formatDate(p.date), bloque: "Mermas y DJPMN", concepto: "Inventario final sin alta", operacion: "-", kg: kg(c.inventario_final, 2), resultado: kg(c.diferencia_bruta, 2) },
    { fecha: formatDate(p.date), bloque: "Mermas y DJPMN", concepto: "Podrido manual", operacion: "-", kg: kg(c.podrido_manual, 2), resultado: kg(c.mermas_totales, 2) },
    {
      fecha: formatDate(p.date),
      bloque: "Resultado",
      concepto: "DJPMN",
      operacion: "=",
      kg: kg(c.dsj, 2),
      resultado: `${c.dsj_pct >= 0 ? "+" : ""}${c.dsj_pct.toFixed(2)} %`,
    },
  ]);
  añadirHojaTabla(ctx, { nombreHoja: "Cascada DJPMN", columnas: CASCADA_COLUMNAS, filas: cascadeRows });

  const productoRows = flattenProducto(partes).map((r) => ({
    producto: r.Producto,
    formatoCaja: r["Formato caja"],
    grupoDestino: r["Grupo destino"],
    kg: r.Kg,
    cajas: r.Cajas,
  }));
  añadirHojaTabla(ctx, { nombreHoja: "Producto", columnas: PRODUCTO_COLUMNAS, filas: productoRows });

  const paletsRows = flattenPalets(partes).map((r) => ({
    producto: r.Producto,
    cliente: r.Cliente,
    destino: r.Destino,
    kgNeto: r["Kg neto"],
    cajas: r.Cajas,
    situacion: r.Situacion,
  }));
  añadirHojaTabla(ctx, { nombreHoja: "Palets", columnas: PALETS_COLUMNAS, filas: paletsRows });

  return ctx;
}

export async function exportPartesToExcel(partes: ParteRow[], from: string, to: string) {
  const ctx = buildPartesWorkbookLasarte(partes, from, to);
  await descargarLibro(ctx, buildLasarteFilename("Partes", "xlsx", { from, to }));
}

// Cabecera/pie del REGISTRO FORMAL (encargo jul-2026): "DOCUMENTO Nº" +
// "FECHA EMISIÓN" + razón social/CIF/dirección en TODAS las páginas
// (cabeceraDocumento, pdfKit.ts) y el pie legal de 3 líneas con la Ref.
// (pieLegal). Sustituye a drawExportHeader/drawExportFooter para este
// informe — el footprint de cabeceraDocumento (24mm, contenido desde y=26)
// es deliberadamente compatible con las coordenadas fijas ya usadas más
// abajo (26, 35, 46, 70...), así que no hace falta re-maquetar la página de
// detalle por parte.
function drawHeader(doc: jsPDF) {
  cabeceraDocumento(doc, { documentoNumero: currentExportId ?? "", fechaEmision: currentGeneradoEn });
}

// Identificador y fecha de emisión del documento PDF en curso (mismos en
// TODAS las páginas: cabecera, pie y cierre de atestación). Se fijan una vez
// al principio de exportPartesToPDF.
let currentExportId: string | undefined;
let currentGeneradoEn: Date | undefined;

function drawFooter(doc: jsPDF) {
  pieLegal(doc, { exportId: currentExportId ?? "" });
}

// PDF_TABLE_MARGIN se importa de pdfKit.ts (antes duplicado aquí con el
// mismo valor exacto: {top:30, bottom:18, left:8, right:8}).

function addAutoTablePageHeader(doc: jsPDF, pageIndexRef: { value: number }) {
  const pages = doc.getNumberOfPages();
  if (pages > pageIndexRef.value) {
    pageIndexRef.value = pages;
    drawHeader(doc);
    drawFooter(doc);
  }
}

export async function exportPartesToPDF(partes: ParteRow[], from: string, to: string) {
  await ensureExportLogoLoaded();
  currentGeneradoEn = new Date();
  currentExportId = generarExportId(currentGeneradoEn);
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const enriched = partes.map((p) => ({ p, c: buildCascade(p) }));
  const pageIndex = { value: 1 };
  const summary = buildPartesReportSummary(partes, from, to);
  const {
    totalProd,
    totalPalets,
    totalDsj,
    totalMermas,
    dsjPctGlobal,
  } = summary.totals;
  const { nOk, nWarn, nCrit } = summary.counts;

  // OBJETO/PERIODO del bloque de metadatos formales (portada) y del párrafo
  // de cierre/atestación (última página) — el MISMO texto en ambos sitios.
  const objeto = "la producción diaria y el control de descuadre (DJPMN) del periodo exportado";
  const periodoTexto = `${pdfDate(from)} - ${pdfDate(to)} · ${partes.length} parte(s)`;
  const siguienteSeccion = crearNumeradorSecciones();

  drawHeader(doc);
  let y = portadaFormal(doc, 26, { titulo: summary.meta.title, objeto, periodo: periodoTexto });

  y = tituloSeccionNumerada(doc, y, siguienteSeccion(), "Indicadores principales", "KPIs globales del periodo exportado");
  y = dibujarKpisEnGrid(doc, y, summary.kpis);
  y = drawReportInsights(doc, summary.insights, 8, y, 281) + 4;
  y = tituloSeccionNumerada(doc, y, siguienteSeccion(), "Resumen del periodo", "Detalle diario con semaforo y totales del rango exportado");

  const barY = y;
  const totalSem = nOk + nWarn + nCrit;
  let x = 8;
  [
    { label: "OK", n: nOk, color: PDF_THEME.success },
    { label: "Revisar", n: nWarn, color: PDF_THEME.warning },
    { label: "Critico", n: nCrit, color: PDF_THEME.destructive },
  ].forEach((item) => {
    const width = totalSem > 0 && item.n > 0 ? Math.max(22, (item.n / totalSem) * 281) : 0;
    if (width <= 0) return;
    doc.setFillColor(...item.color);
    doc.roundedRect(x, barY, width, 14, 1.5, 1.5, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(...PDF_THEME.white);
    doc.text(`${item.label} ${Math.round((item.n / totalSem) * 100)}%`, x + width / 2, barY + 9, { align: "center" });
    x += width + 1;
  });

  autoTable(doc, {
    startY: barY + 20,
    head: [["Fecha", "Estado", "Prod. real", "Palets ajust.", "Diferencia", "Mermas", "DJPMN", "% DJPMN", "Semaforo"]],
    body: [
      ...enriched.map(({ p, c }) => [
        pdfDate(p.date),
        safePdf(p.estado),
        pdfKg(c.produccion_real),
        pdfKg(c.palets_ajustados),
        pdfKg(c.diferencia_bruta),
        pdfKg(c.mermas_totales),
        pdfKg(c.dsj),
        pdfPct(c.dsj_pct),
        semLabel(c.semaforo),
      ]),
      ["TOTAL", `${partes.length} partes`, pdfKg(totalProd), pdfKg(totalPalets), "", pdfKg(totalMermas), pdfKg(totalDsj), pdfPct(dsjPctGlobal), ""],
    ],
    margin: PDF_TABLE_MARGIN,
    ...pdfTableTheme(),
    styles: { ...pdfTableTheme().styles, fontSize: 7, cellPadding: 2 },
    headStyles: { ...pdfTableTheme().headStyles, fontSize: 6.8 },
    columnStyles: {
      0: { cellWidth: 22 },
      8: { halign: "right" },
    },
    didParseCell: (data) => {
      if (data.column.index === 8 && data.section === "body") {
        const value = String((data.row.raw as string[])[8] ?? "");
        if (value.startsWith("[OK]")) data.cell.styles.textColor = PDF_THEME.success;
        if (value.startsWith("[!]")) data.cell.styles.textColor = PDF_THEME.warning;
        if (value.startsWith("[X]")) data.cell.styles.textColor = PDF_THEME.destructive;
      }
      if (data.row.index === enriched.length && data.section === "body") {
        data.cell.styles.fontStyle = "bold";
        data.cell.styles.fillColor = PDF_THEME.creamStrong;
      }
    },
    didDrawPage: () => addAutoTablePageHeader(doc, pageIndex),
  });

  drawFooter(doc);

  // Y del último contenido dibujado en la última página del bucle, para
  // poder colocar el cierre/atestación (última página) justo debajo sin
  // solaparlo — o en página nueva si no queda hueco.
  let lastContentY = 0;

  enriched.forEach(({ p, c }) => {
    doc.addPage();
    pageIndex.value = doc.getNumberOfPages();
    drawHeader(doc);

    const sc = semColor(c.semaforo);
    doc.setFillColor(...PDF_THEME.cream);
    doc.roundedRect(8, 26, 281, 14, 2, 2, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(...PDF_THEME.primaryDark);
    doc.text(`Detalle por parte - ${pdfDate(p.date)}`, 14, 35);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...PDF_THEME.muted);
    doc.text(`Estado: ${safePdf(p.estado)}`, 112, 35);
    doc.setFillColor(...sc);
    doc.roundedRect(232, 26, 57, 14, 2, 2, "F");
    doc.setTextColor(...PDF_THEME.white);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.text(pdfPct(c.dsj_pct), 260.5, 34, { align: "center" });
    doc.setFontSize(6.5);
    doc.text("DJPMN", 260.5, 38, { align: "center" });

    [
      { label: "PROD. REAL", val: pdfKg(c.produccion_real), sub: "Calibrador - ajustes" },
      { label: "PALETS AJUST.", val: pdfKg(c.palets_ajustados), sub: "Alta neta" },
      { label: "MERMAS", val: pdfKg(c.mermas_totales), sub: "Podrido manual" },
      { label: "DJPMN", val: pdfKg(c.dsj), sub: semLabel(c.semaforo) },
    ].forEach((card, i) => drawKpiCard(doc, 8 + i * 70.5, 46, 68, card.label, card.val, card.sub));

    const cascadeSectionY = drawReportSectionTitle(doc, "Cascada DJPMN", 70, "De la produccion bruta al descuadre final, paso a paso");

    const cascadeRows = [
      ["Produccion real", "Calibrador", "=", pdfKg(c.produccion_calibrador)],
      ["Produccion real", "Mujeres clase L", "-", pdfKg(c.mujeres)],
      ["Produccion real", "Reciclado malla Z1", "-", pdfKg(c.reciclado_z1)],
      ["Produccion real", "Reciclado malla Z2", "-", pdfKg(c.reciclado_z2)],
      ["Produccion real", "Produccion real", "=", pdfKg(c.produccion_real)],
      ["Palets e inventario", "Palets alta bruto", "=", pdfKg(c.palets_brutos)],
      ["Palets e inventario", "Inv. dia anterior", "-", pdfKg(c.inventario_anterior)],
      ["Palets e inventario", "Palets alta ajustados", "=", pdfKg(c.palets_ajustados)],
      ["Mermas y DJPMN", "Produccion real", "=", pdfKg(c.produccion_real)],
      ["Mermas y DJPMN", "Palets alta ajustados", "-", pdfKg(c.palets_ajustados)],
      ["Mermas y DJPMN", "Inventario final sin alta", "-", pdfKg(c.inventario_final)],
      ["Mermas y DJPMN", "Diferencia bruta", "=", pdfKg(c.diferencia_bruta)],
      ["Mermas y DJPMN", "Podrido manual", "-", pdfKg(c.podrido_manual)],
      ["Mermas y DJPMN", "Mermas totales", "=", pdfKg(c.mermas_totales)],
      ["Resultado", "DJPMN", "=", `${pdfKg(c.dsj)} (${pdfPct(c.dsj_pct)})`],
    ];

    autoTable(doc, {
      startY: cascadeSectionY,
      head: [["Bloque", "Concepto", "Op.", "Valor"]],
      body: cascadeRows,
      margin: PDF_TABLE_MARGIN,
      ...pdfTableTheme(),
      styles: { ...pdfTableTheme().styles, fontSize: 7.2, cellPadding: 2.1 },
      headStyles: { ...pdfTableTheme().headStyles, fontSize: 6.8 },
      // Los 4 anchos deben sumar el ancho util de la tabla (281mm = 297mm A4
      // landscape - 8mm de margen a cada lado): al fijar cellWidth en todas las
      // columnas ninguna queda "resizable" para autoTable, así que si la suma no
      // llena el ancho util, la librería no puede repartir el sobrante y avisa
      // "N units width could not fit page" (aunque en realidad sobre espacio).
      columnStyles: {
        0: { cellWidth: 50 },
        1: { cellWidth: 164 },
        2: { cellWidth: 12, halign: "center" },
        3: { cellWidth: 55, halign: "right", fontStyle: "bold" },
      },
      didParseCell: (data) => {
        if (data.section !== "body") return;
        const raw = data.row.raw as string[];
        if (["Produccion real", "Palets alta ajustados", "Diferencia bruta", "Mermas totales", "DJPMN"].includes(raw[1])) {
          data.cell.styles.fontStyle = "bold";
          data.cell.styles.fillColor = raw[1] === "DJPMN" ? sc : PDF_THEME.creamStrong;
          if (raw[1] === "DJPMN") data.cell.styles.textColor = PDF_THEME.white;
        }
      },
      didDrawPage: () => addAutoTablePageHeader(doc, pageIndex),
    });

    const rawStartY = lastAutoTableY(doc, 72) + 6;
    const rawRows = [
      ["Calibrador", pdfKg(n(p.kg_produccion_calibrador)), "Base de produccion"],
      ["Industria manual", pdfKg(n(p.kg_industria_manual)), "Dato bruto registrado"],
      ["Mujeres clase L", pdfKg(n(p.kg_mujeres_calibrador)), "Resta en produccion real"],
      ["Reciclado malla Z1", pdfKg(n(p.kg_reciclado_malla_z1)), "Resta en produccion real"],
      ["Reciclado malla Z2", pdfKg(n(p.kg_reciclado_malla_z2)), "Resta en produccion real"],
      ["Palets brutos", pdfKg(n(p.kg_palets_brutos)), "Alta bruta"],
      ["Palets Egipto", pdfKg(n(p.kg_palets_egipto)), "Descontado del bruto"],
      ["Inv. dia anterior", pdfKg(n(p.kg_inventario_anterior_sin_alta)), "Ajuste de palets"],
      ["Inv. final sin alta", pdfKg(n(p.kg_inventario_sin_alta)), "Resta en diferencia bruta"],
      ["Podrido calibrador", pdfKg(n(p.kg_podrido_calibrador_auto)), "Dato informativo"],
      ["Podrido manual", pdfKg(n(p.kg_podrido_bolsa_basura)), "Merma usada en DJPMN"],
    ];

    autoTable(doc, {
      startY: rawStartY,
      head: [["Datos de entrada", "Valor", "Uso"]],
      body: rawRows,
      margin: PDF_TABLE_MARGIN,
      ...pdfTableTheme(),
      styles: { ...pdfTableTheme().styles, fontSize: 6.8, cellPadding: 1.8 },
      headStyles: { ...pdfTableTheme().headStyles, fontSize: 6.5 },
      // Igual que en la tabla de cascada: los 3 anchos deben sumar 281mm (ancho
      // util) para que autoTable no reporte una tabla "que no cabe" cuando en
      // realidad sobra espacio sin repartir.
      columnStyles: {
        0: { cellWidth: 75 },
        1: { cellWidth: 50, halign: "right", fontStyle: "bold" },
        2: { cellWidth: 156 },
      },
      didDrawPage: () => addAutoTablePageHeader(doc, pageIndex),
    });

    let noteY = lastAutoTableY(doc, rawStartY) + 8;
    const noteBlocks = [
      { title: "Notas generales", text: p.notas_generales },
      { title: "Notas inventario", text: p.notas_inventario },
      { title: "Analisis IA", text: p.resumen_ia?.analisis ? String(p.resumen_ia.analisis) : "" },
    ].filter((block) => block.text);

    if (noteBlocks.length > 0) {
      if (noteY > 172) {
        doc.addPage();
        pageIndex.value = doc.getNumberOfPages();
        drawHeader(doc);
        noteY = 28;
      }
      noteY = drawReportSectionTitle(doc, "Notas", noteY, "Notas operativas y analisis IA del parte");
    }

    for (const block of noteBlocks) {
      if (noteY > 178) {
        doc.addPage();
        pageIndex.value = doc.getNumberOfPages();
        drawHeader(doc);
        noteY = 28;
      }
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7.5);
      doc.setTextColor(...PDF_THEME.primaryDark);
      doc.text(safePdf(block.title), 8, noteY);
      noteY += 4;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7);
      doc.setTextColor(...PDF_THEME.muted);
      const lines = doc.splitTextToSize(safePdf(block.text), 281);
      doc.text(lines, 8, noteY);
      noteY += lines.length * 3.4 + 4;
    }

    lastContentY = noteBlocks.length > 0 ? noteY : lastAutoTableY(doc, rawStartY);
    drawFooter(doc);
  });

  // CIERRE (última página): párrafo de atestación + línea de emisión
  // electrónica, con el MISMO objeto/periodo que la portada. En página
  // nueva si no queda hueco tras el último contenido dibujado.
  let cierreY = lastContentY + 8;
  if (cierreY > 160) {
    doc.addPage();
    pageIndex.value = doc.getNumberOfPages();
    drawHeader(doc);
    cierreY = 30;
  }
  cierreAtestacion(doc, cierreY, { objeto, periodo: periodoTexto, generadoEn: currentGeneradoEn });
  drawFooter(doc);

  finalizarPaginacionFormal(doc);
  doc.save(buildLasarteFilename("Partes", "pdf", { from, to }));
}

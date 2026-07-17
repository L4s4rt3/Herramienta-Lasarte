import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { formatDate, formatNumber } from "./format";
import { type ConsumoPeriodoRow } from "./consumosFisicos";
import { SesionConsumoRow, ConsumoMaquinaRow, MaquinaRow, ConsumoFisicoRow, ConsumoBaseKgRow } from "./types";
import { pdfTableTheme } from "./exportTheme";
import {
  añadirHojaTabla,
  crearLibroLasarte,
  descargarLibro,
  FMT_KG,
  FMT_KWH,
  FMT_L,
  FMT_LKG,
  FMT_MLKG,
  FMT_PCT,
  generarExportId,
  type ColumnaTabla,
} from "./exportKit";
import {
  cabeceraDocumento,
  cierreAtestacion,
  crearNumeradorSecciones,
  dibujarKpisEnGrid,
  finalizarPaginacionFormal,
  lastAutoTableY,
  pdfTablaDesdeColumnas,
  pieLegal,
  portadaFormal,
  tituloSeccionNumerada,
} from "./pdfKit";
import {
  buildLasarteFilename,
  drawReportInsights,
  ensureExportLogoLoaded,
  type ReportInsight,
  type ReportKpi,
  type ReportMeta,
} from "./reportKit";

// Formatos numéricos españoles específicos de este export, no cubiertos por las
// constantes FMT_* de exportKit.ts (que solo define hasta kWh "a secas").
const FMT_KWHKG = '#,##0.0000" kWh/kg"';
const FMT_KWHKG5 = '#,##0.00000" kWh/kg"';
const FMT_LT = '#,##0.00" L/t"';
const FMT_RATIO = "#,##0.0000";

export interface ExportData {
  sesiones: SesionConsumoRow[];
  maquinas: MaquinaRow[];
  consumosMaquinas: ConsumoMaquinaRow[];
  consumosFisicos?: ConsumoFisicoRow[];
  basesKg?: ConsumoBaseKgRow[];
  periodos?: ConsumoPeriodoRow[];
}

function n(value: unknown): number {
  return Number(value) || 0;
}

function ratio(num: number, den: number, digits = 3) {
  return den > 0 ? +(num / den).toFixed(digits) : 0;
}

// Fecha "YYYY-MM-DD" anclada al mediodía local (evita el desplazamiento de zona
// horaria de `new Date("YYYY-MM-DD")`, que en España cae en UTC medianoche).
// Devuelve `null` para valores que no son una fecha pura (p.ej. etiquetas de
// periodo tipo "S28" o "2026-2027"), de forma que la celda quede en blanco en
// vez de mostrar una fecha incorrecta.
function parseFechaISO(value: string | null | undefined): Date | null {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0);
  return null;
}

const confianzaLabel: Record<ConsumoPeriodoRow["confianza"], string> = {
  real: "Real",
  estimado: "Estimado",
  mixto: "Mixto",
  incompleto: "Incompleto",
};

export interface ConsumoReportSummary {
  meta: ReportMeta;
  kpis: ReportKpi[];
  insights: ReportInsight[];
  periodos: ConsumoPeriodoRow[];
  hasPeriodos: boolean;
  totals: {
    totalKg: number;
    totalAguaLinea: number;
    totalAguaDrencher: number;
    totalAguaFisica: number;
    totalQuimicos: number;
    totalGasoil: number;
    totalElectricidad: number;
    issueCount: number;
  };
}

export function buildConsumoReportSummary(data: ExportData): ConsumoReportSummary {
  const periodos = data.periodos ?? [];
  const hasPeriodos = periodos.length > 0;
  const totalKg = hasPeriodos
    ? periodos.reduce((s, r) => s + n(r.kgBase), 0)
    : data.sesiones.reduce((s, r) => s + n(r.kg_procesados), 0);
  const totalAguaLinea = hasPeriodos ? 0 : data.sesiones.reduce((s, r) => s + n(r.agua_linea_l), 0);
  const totalAguaDrencher = hasPeriodos ? 0 : data.sesiones.reduce((s, r) => s + n(r.agua_drencher_l), 0);
  const totalAgua = totalAguaLinea + totalAguaDrencher;
  const totalAguaFisica = hasPeriodos ? periodos.reduce((s, r) => s + n(r.aguaL), 0) : totalAgua;
  const totalQuimicos = hasPeriodos
    ? periodos.reduce((s, r) => s + n(r.quimicosL), 0)
    : data.sesiones.reduce((s, r) => s + n(r.quimicos_drencher_l), 0);
  const totalGasoil = hasPeriodos
    ? periodos.reduce((s, r) => s + n(r.gasoilL), 0)
    : data.sesiones.reduce((s, r) => s + n(r.gasoil_l), 0);
  const totalElectricidad = hasPeriodos
    ? periodos.reduce((s, r) => s + n(r.electricidadKwh), 0)
    : data.sesiones.reduce((s, r) => s + n(r.electricidad_total_kwh), 0);
  const issueCount = periodos.reduce((s, r) => s + r.issues.length, 0);
  const rowLabel = hasPeriodos ? `${periodos.length} periodo(s)` : `${data.sesiones.length} sesion(es)`;

  return {
    meta: {
      title: "Informe de consumos fisicos",
      subtitle: "Recursos, ratios y validacion operativa",
      periodLabel: rowLabel,
    },
    kpis: [
      { label: hasPeriodos ? "Kg base" : "Kg procesados", value: formatNumber(totalKg, 0), sub: "total", tone: "info" },
      { label: "Agua total", value: `${formatNumber(totalAguaFisica, 0)} L`, sub: `${formatNumber(ratio(totalAguaFisica, totalKg, 3), 3)} L/kg`, tone: "info" },
      { label: "Electricidad", value: `${formatNumber(totalElectricidad, 0)} kWh`, sub: `${formatNumber(ratio(totalElectricidad, totalKg, 4), 4)} kWh/kg`, tone: "neutral" },
      { label: "Gasoil", value: `${formatNumber(totalGasoil, 0)} L`, sub: `${formatNumber(totalKg > 0 ? (totalGasoil * 1000) / totalKg : 0, 2)} mL/kg`, tone: "warning" },
      { label: "Quimicos", value: `${formatNumber(totalQuimicos, 0)} L`, sub: `${formatNumber(totalKg > 0 ? (totalQuimicos * 1000) / totalKg : 0, 2)} mL/kg`, tone: "neutral" },
      { label: "Validacion", value: issueCount, sub: issueCount === 0 ? "sin incidencias" : "observaciones", tone: issueCount === 0 ? "success" : "danger" },
    ],
    insights: [
      {
        label: "Base",
        value: hasPeriodos
          ? "Informe construido desde periodos de consumo con kg base y confianza por periodo."
          : "Informe construido desde sesiones de consumo registradas.",
        tone: "info",
      },
      {
        label: "Validacion",
        value: issueCount === 0 ? "No hay incidencias de validacion en el rango." : `${issueCount} observacion(es) requieren revision.`,
        tone: issueCount === 0 ? "success" : "danger",
      },
    ],
    periodos,
    hasPeriodos,
    totals: {
      totalKg,
      totalAguaLinea,
      totalAguaDrencher,
      totalAguaFisica,
      totalQuimicos,
      totalGasoil,
      totalElectricidad,
      issueCount,
    },
  };
}

function consumoDateRange(data: ExportData): { from?: string; to?: string } {
  const dates: string[] = [];
  for (const s of data.sesiones) {
    if (s.fecha_inicio) dates.push(s.fecha_inicio);
    if (s.fecha_fin) dates.push(s.fecha_fin);
  }
  for (const p of data.periodos ?? []) {
    if (p.fechaInicio) dates.push(p.fechaInicio);
    if (p.fechaFin) dates.push(p.fechaFin);
  }
  if (dates.length === 0) return {};
  dates.sort();
  return { from: dates[0], to: dates[dates.length - 1] };
}

export async function exportConsumoToExcel(data: ExportData): Promise<void> {
  const summary = buildConsumoReportSummary(data);
  const { periodos, hasPeriodos } = summary;
  const {
    totalKg,
    totalAguaLinea,
    totalAguaDrencher,
    totalAguaFisica,
    totalQuimicos,
    totalGasoil,
    totalElectricidad,
  } = summary.totals;

  const range = consumoDateRange(data);
  const periodoLabel = range.from && range.to ? `${formatDate(range.from)} - ${formatDate(range.to)}` : undefined;

  const ctx = crearLibroLasarte({
    titulo: "Control de recursos por producción",
    periodo: periodoLabel,
    clasificacion: "Interno",
  });

  // ─── KPIs (portada como tabla) ────────────────────────────────────────────
  const kpiColumnas: ColumnaTabla[] = [
    { header: "Kg procesados", key: "kg", tipo: "numero", numFmt: FMT_KG, width: 16 },
    { header: "Agua L/kg", key: "aguaLkg", tipo: "numero", numFmt: FMT_LKG, width: 14 },
    { header: "Químicos mL/kg", key: "quimicosMlkg", tipo: "numero", numFmt: FMT_MLKG, width: 16 },
    { header: "Gasoil mL/kg", key: "gasoilMlkg", tipo: "numero", numFmt: FMT_MLKG, width: 14 },
    { header: "Electricidad kWh/kg", key: "electricidadKwhkg", tipo: "numero", numFmt: FMT_KWHKG, width: 18 },
  ];
  añadirHojaTabla(ctx, {
    nombreHoja: "KPIs",
    titulo: "Indicadores clave de recursos",
    columnas: kpiColumnas,
    filas: [
      {
        kg: totalKg,
        aguaLkg: ratio(totalAguaFisica, totalKg, 3),
        quimicosMlkg: totalKg > 0 ? +((totalQuimicos * 1000) / totalKg).toFixed(2) : 0,
        gasoilMlkg: totalKg > 0 ? +((totalGasoil * 1000) / totalKg).toFixed(2) : 0,
        electricidadKwhkg: ratio(totalElectricidad, totalKg, 4),
      },
    ],
    freeze: false,
    autofilter: false,
  });

  // ─── Sesiones ──────────────────────────────────────────────────────────────
  const sesionesColumnas: ColumnaTabla[] = [
    { header: "Fecha inicio", key: "fechaInicio", tipo: "fecha", width: 14 },
    { header: "Fecha fin", key: "fechaFin", tipo: "fecha", width: 14 },
    { header: "Kg procesados", key: "kg", tipo: "numero", numFmt: FMT_KG, width: 16 },
    { header: "Agua línea L", key: "aguaLinea", tipo: "numero", numFmt: FMT_L, width: 14 },
    { header: "Agua drencher L", key: "aguaDrencher", tipo: "numero", numFmt: FMT_L, width: 16 },
    { header: "Agua total L", key: "aguaTotal", tipo: "numero", numFmt: FMT_L, width: 14 },
    { header: "Agua L/kg", key: "aguaLkg", tipo: "numero", numFmt: FMT_LKG, width: 14 },
    { header: "Químicos L", key: "quimicos", tipo: "numero", numFmt: FMT_L, width: 14 },
    { header: "Químicos mL/kg", key: "quimicosMlkg", tipo: "numero", numFmt: FMT_MLKG, width: 16 },
    { header: "Gasoil L", key: "gasoil", tipo: "numero", numFmt: FMT_L, width: 14 },
    { header: "Gasoil mL/kg", key: "gasoilMlkg", tipo: "numero", numFmt: FMT_MLKG, width: 14 },
    { header: "Electricidad kWh", key: "electricidad", tipo: "numero", numFmt: FMT_KWH, width: 16 },
    { header: "kWh/kg", key: "electricidadKwhkg", tipo: "numero", numFmt: FMT_KWHKG, width: 14 },
    { header: "Notas", key: "notas", width: 40 },
  ];

  const sesionesRows = data.sesiones.map((s) => {
    const kg = n(s.kg_procesados);
    const aguaLinea = n(s.agua_linea_l);
    const aguaDrencher = n(s.agua_drencher_l);
    const aguaTotal = aguaLinea + aguaDrencher;
    const quimicos = n(s.quimicos_drencher_l);
    const gasoil = n(s.gasoil_l);
    const electricidad = n(s.electricidad_total_kwh);
    return {
      fechaInicio: parseFechaISO(s.fecha_inicio),
      fechaFin: parseFechaISO(s.fecha_fin),
      kg,
      aguaLinea,
      aguaDrencher,
      aguaTotal,
      aguaLkg: ratio(aguaTotal, kg, 3),
      quimicos,
      quimicosMlkg: kg > 0 ? +((quimicos * 1000) / kg).toFixed(2) : 0,
      gasoil,
      gasoilMlkg: kg > 0 ? +((gasoil * 1000) / kg).toFixed(2) : 0,
      electricidad,
      electricidadKwhkg: ratio(electricidad, kg, 4),
      notas: s.notas ?? "",
    };
  });

  const sesionesTotales = sesionesRows.length > 0
    ? {
      fechaInicio: "TOTAL",
      kg: sesionesRows.reduce((s, r) => s + r.kg, 0),
      aguaLinea: sesionesRows.reduce((s, r) => s + r.aguaLinea, 0),
      aguaDrencher: sesionesRows.reduce((s, r) => s + r.aguaDrencher, 0),
      aguaTotal: sesionesRows.reduce((s, r) => s + r.aguaTotal, 0),
      quimicos: sesionesRows.reduce((s, r) => s + r.quimicos, 0),
      gasoil: sesionesRows.reduce((s, r) => s + r.gasoil, 0),
      electricidad: sesionesRows.reduce((s, r) => s + r.electricidad, 0),
    }
    : undefined;

  añadirHojaTabla(ctx, {
    nombreHoja: "Sesiones",
    titulo: "Sesiones de consumo",
    columnas: sesionesColumnas,
    filas: sesionesRows,
    totales: sesionesTotales,
  });

  // ─── Resumen recursos ──────────────────────────────────────────────────────
  const recursosColumnas: ColumnaTabla[] = [
    { header: "Recurso", key: "recurso", width: 20 },
    { header: "Unidad", key: "unidad", width: 12 },
    { header: "Total", key: "total", tipo: "numero", numFmt: "#,##0", width: 14 },
    { header: "Por kg", key: "porKg", tipo: "numero", numFmt: FMT_RATIO, width: 14 },
    { header: "Unidad ratio", key: "unidadRatio", width: 14 },
  ];

  const recursosRows = hasPeriodos
    ? [
      { recurso: "Agua total", unidad: "L", total: Math.round(totalAguaFisica), porKg: ratio(totalAguaFisica, totalKg, 3), unidadRatio: "L/kg" },
      { recurso: "Químicos", unidad: "L", total: Math.round(totalQuimicos), porKg: totalKg > 0 ? +((totalQuimicos * 1000) / totalKg).toFixed(2) : 0, unidadRatio: "mL/kg" },
      { recurso: "Gasoil", unidad: "L", total: Math.round(totalGasoil), porKg: totalKg > 0 ? +((totalGasoil * 1000) / totalKg).toFixed(2) : 0, unidadRatio: "mL/kg" },
      { recurso: "Electricidad", unidad: "kWh", total: Math.round(totalElectricidad), porKg: ratio(totalElectricidad, totalKg, 4), unidadRatio: "kWh/kg" },
    ]
    : [
      { recurso: "Agua línea", unidad: "L", total: Math.round(totalAguaLinea), porKg: ratio(totalAguaLinea, totalKg, 3), unidadRatio: "L/kg" },
      { recurso: "Agua drencher", unidad: "L", total: Math.round(totalAguaDrencher), porKg: ratio(totalAguaDrencher, totalKg, 3), unidadRatio: "L/kg" },
      { recurso: "Agua total", unidad: "L", total: Math.round(totalAguaFisica), porKg: ratio(totalAguaFisica, totalKg, 3), unidadRatio: "L/kg" },
      { recurso: "Químicos", unidad: "L", total: Math.round(totalQuimicos), porKg: totalKg > 0 ? +((totalQuimicos * 1000) / totalKg).toFixed(2) : 0, unidadRatio: "mL/kg" },
      { recurso: "Gasoil", unidad: "L", total: Math.round(totalGasoil), porKg: totalKg > 0 ? +((totalGasoil * 1000) / totalKg).toFixed(2) : 0, unidadRatio: "mL/kg" },
      { recurso: "Electricidad", unidad: "kWh", total: Math.round(totalElectricidad), porKg: ratio(totalElectricidad, totalKg, 4), unidadRatio: "kWh/kg" },
    ];

  añadirHojaTabla(ctx, {
    nombreHoja: "Resumen recursos",
    titulo: "Resumen de recursos",
    columnas: recursosColumnas,
    filas: recursosRows,
    autofilter: false,
  });

  // ─── Consumos por periodo (+ Validacion) ───────────────────────────────────
  if (hasPeriodos) {
    const periodosColumnas: ColumnaTabla[] = [
      { header: "Periodo", key: "periodo", width: 16 },
      { header: "Fecha inicio", key: "fechaInicio", tipo: "fecha", width: 14 },
      { header: "Fecha fin", key: "fechaFin", tipo: "fecha", width: 14 },
      { header: "Confianza", key: "confianza", width: 14 },
      { header: "Kg partes", key: "kgPartes", tipo: "numero", numFmt: FMT_KG, width: 16 },
      { header: "Kg palets", key: "kgPalets", tipo: "numero", numFmt: FMT_KG, width: 16 },
      { header: "Kg ventas", key: "kgVentas", tipo: "numero", numFmt: FMT_KG, width: 16 },
      { header: "Kg manual", key: "kgManual", tipo: "numero", numFmt: FMT_KG, width: 16 },
      { header: "Kg base", key: "kgBase", tipo: "numero", numFmt: FMT_KG, width: 16 },
      { header: "Agua total L", key: "aguaL", tipo: "numero", numFmt: FMT_L, width: 14 },
      { header: "Agua L/kg", key: "aguaLKg", tipo: "numero", numFmt: FMT_LKG, width: 14 },
      { header: "Electricidad kWh", key: "electricidadKwh", tipo: "numero", numFmt: FMT_KWH, width: 16 },
      { header: "kWh/kg", key: "electricidadKwhKg", tipo: "numero", numFmt: FMT_KWHKG, width: 14 },
      { header: "Gasoil L", key: "gasoilL", tipo: "numero", numFmt: FMT_L, width: 14 },
      { header: "Gasoil mL/kg", key: "gasoilMlKg", tipo: "numero", numFmt: FMT_MLKG, width: 14 },
      { header: "Gasoil L/t", key: "gasoilLT", tipo: "numero", numFmt: FMT_LT, width: 14 },
      { header: "Químicos L", key: "quimicosL", tipo: "numero", numFmt: FMT_L, width: 14 },
      { header: "Químicos mL/kg", key: "quimicosMlKg", tipo: "numero", numFmt: FMT_MLKG, width: 16 },
      { header: "Observaciones", key: "observaciones", width: 42 },
    ];

    const periodosRows = periodos.map((row) => ({
      periodo: row.periodo,
      fechaInicio: parseFechaISO(row.fechaInicio),
      fechaFin: parseFechaISO(row.fechaFin),
      confianza: confianzaLabel[row.confianza],
      kgPartes: row.kgPartes,
      kgPalets: row.kgPalets,
      kgVentas: row.kgVentas,
      kgManual: row.kgManual,
      kgBase: row.kgBase,
      aguaL: row.aguaL,
      aguaLKg: row.aguaLKg,
      electricidadKwh: row.electricidadKwh,
      electricidadKwhKg: row.electricidadKwhKg,
      gasoilL: row.gasoilL,
      gasoilMlKg: row.gasoilMlKg,
      gasoilLT: row.gasoilLT,
      quimicosL: row.quimicosL,
      quimicosMlKg: row.quimicosMlKg,
      observaciones: row.issues.join(" | "),
    }));

    añadirHojaTabla(ctx, {
      nombreHoja: "Consumos por periodo",
      titulo: "Consumos por periodo",
      columnas: periodosColumnas,
      filas: periodosRows,
      totales: {
        periodo: "TOTAL",
        kgPartes: periodos.reduce((s, r) => s + n(r.kgPartes), 0),
        kgPalets: periodos.reduce((s, r) => s + n(r.kgPalets), 0),
        kgVentas: periodos.reduce((s, r) => s + n(r.kgVentas), 0),
        kgManual: periodos.reduce((s, r) => s + n(r.kgManual), 0),
        kgBase: totalKg,
        aguaL: totalAguaFisica,
        electricidadKwh: totalElectricidad,
        gasoilL: totalGasoil,
        quimicosL: totalQuimicos,
      },
    });

    const validacionColumnas: ColumnaTabla[] = [
      { header: "Periodo", key: "periodo", width: 16 },
      { header: "Confianza", key: "confianza", width: 14 },
      { header: "Observaciones", key: "observaciones", width: 60 },
    ];
    añadirHojaTabla(ctx, {
      nombreHoja: "Validacion consumos",
      titulo: "Validación de consumos",
      columnas: validacionColumnas,
      filas: periodos
        .filter((row) => row.issues.length > 0)
        .map((row) => ({
          periodo: row.periodo,
          confianza: confianzaLabel[row.confianza],
          observaciones: row.issues.join(" | "),
        })),
    });
  }

  // ─── Registros consumo ──────────────────────────────────────────────────────
  if (data.consumosFisicos?.length) {
    const registrosColumnas: ColumnaTabla[] = [
      { header: "Recurso", key: "recurso", width: 14 },
      { header: "Fecha inicio", key: "fechaInicio", tipo: "fecha", width: 14 },
      { header: "Fecha fin", key: "fechaFin", tipo: "fecha", width: 14 },
      { header: "Cantidad", key: "cantidad", tipo: "numero", numFmt: "#,##0.00", width: 12 },
      { header: "Unidad", key: "unidad", width: 10 },
      { header: "Fuente", key: "fuente", width: 20 },
      { header: "Referencia", key: "referencia", width: 24 },
      { header: "Notas", key: "notas", width: 40 },
    ];
    añadirHojaTabla(ctx, {
      nombreHoja: "Registros consumo",
      titulo: "Registros de consumo físico",
      columnas: registrosColumnas,
      filas: data.consumosFisicos.map((row) => ({
        recurso: row.recurso,
        fechaInicio: parseFechaISO(row.fecha_inicio),
        fechaFin: parseFechaISO(row.fecha_fin),
        cantidad: row.cantidad,
        unidad: row.unidad,
        fuente: row.fuente,
        referencia: row.referencia ?? "",
        notas: row.notas ?? "",
      })),
    });
  }

  // ─── Bases kg ────────────────────────────────────────────────────────────────
  if (data.basesKg?.length) {
    const basesColumnas: ColumnaTabla[] = [
      { header: "Tipo", key: "tipo", width: 14 },
      { header: "Fecha inicio", key: "fechaInicio", tipo: "fecha", width: 14 },
      { header: "Fecha fin", key: "fechaFin", tipo: "fecha", width: 14 },
      { header: "Kg", key: "kg", tipo: "numero", numFmt: FMT_KG, width: 14 },
      { header: "Referencia", key: "referencia", width: 24 },
      { header: "Notas", key: "notas", width: 40 },
    ];
    añadirHojaTabla(ctx, {
      nombreHoja: "Bases kg",
      titulo: "Bases de kg utilizadas",
      columnas: basesColumnas,
      filas: data.basesKg.map((row) => ({
        tipo: row.tipo_base,
        fechaInicio: parseFechaISO(row.fecha_inicio),
        fechaFin: parseFechaISO(row.fecha_fin),
        kg: row.kg,
        referencia: row.referencia ?? "",
        notas: row.notas ?? "",
      })),
    });
  }

  // ─── Máquinas ────────────────────────────────────────────────────────────────
  const machineName = new Map(data.maquinas.map((m) => [m.id, m]));
  const detalleColumnas: ColumnaTabla[] = [
    { header: "Sesión ID", key: "sesionId", width: 34 },
    { header: "Máquina", key: "maquina", width: 24 },
    { header: "Zona", key: "zona", width: 16 },
    { header: "kWh", key: "kwh", tipo: "numero", numFmt: FMT_KWH, width: 12 },
    { header: "kWh/kg global", key: "kwhKg", tipo: "numero", numFmt: FMT_KWHKG5, width: 16 },
  ];
  añadirHojaTabla(ctx, {
    nombreHoja: "Detalle maquinas",
    titulo: "Detalle de consumo por máquina",
    columnas: detalleColumnas,
    filas: data.consumosMaquinas.map((cm) => {
      const maquina = machineName.get(cm.maquina_id);
      return {
        sesionId: cm.sesion_id,
        maquina: maquina?.nombre ?? cm.maquina_id,
        zona: maquina?.zona ?? "",
        kwh: n(cm.kwh),
        kwhKg: ratio(n(cm.kwh), totalKg, 5),
      };
    }),
  });

  const resumenMaquinasColumnas: ColumnaTabla[] = [
    { header: "Máquina", key: "maquina", width: 24 },
    { header: "Zona", key: "zona", width: 16 },
    { header: "kWh total", key: "kwhTotal", tipo: "numero", numFmt: FMT_KWH, width: 14 },
    { header: "% electricidad", key: "pctElectricidad", tipo: "numero", numFmt: FMT_PCT, width: 16 },
    { header: "kWh/kg global", key: "kwhKg", tipo: "numero", numFmt: FMT_KWHKG5, width: 16 },
  ];
  añadirHojaTabla(ctx, {
    nombreHoja: "Resumen maquinas",
    titulo: "Resumen de consumo por máquina",
    columnas: resumenMaquinasColumnas,
    filas: data.maquinas.map((m) => {
      const totalKwh = data.consumosMaquinas
        .filter((cm) => cm.maquina_id === m.id)
        .reduce((s, cm) => s + n(cm.kwh), 0);
      return {
        maquina: m.nombre,
        zona: m.zona,
        kwhTotal: +totalKwh.toFixed(2),
        pctElectricidad: totalElectricidad > 0 ? +((totalKwh / totalElectricidad) * 100).toFixed(2) : 0,
        kwhKg: ratio(totalKwh, totalKg, 5),
      };
    }),
  });

  // ─── Diccionario ─────────────────────────────────────────────────────────────
  const diccionarioColumnas: ColumnaTabla[] = [
    { header: "Hoja", key: "hoja", width: 22 },
    { header: "Campo", key: "campo", width: 28 },
    { header: "Descripción", key: "descripcion", width: 64 },
    { header: "Uso", key: "uso", width: 36 },
  ];
  añadirHojaTabla(ctx, {
    nombreHoja: "Diccionario",
    titulo: "Diccionario de datos",
    columnas: diccionarioColumnas,
    filas: [
      { hoja: "KPIs", campo: "Indicadores por kg", descripcion: "Ratios normalizados de todo el rango exportado.", uso: "Lectura rápida antes de entrar al detalle." },
      { hoja: "Sesiones", campo: "Una fila por sesión", descripcion: "Datos completos de cada rango de consumo.", uso: "Filtrar por fecha y comparar ratios." },
      { hoja: "Resumen recursos", campo: "Por kg", descripcion: "Consumo normalizado por kg procesado.", uso: "Comparar eficiencia independientemente del volumen." },
      { hoja: "Consumos por periodo", campo: "Confianza", descripcion: "Real usa partes, estimado usa ventas/manual, mixto prioriza partes.", uso: "Auditar la calidad del KPI mensual." },
      { hoja: "Validacion consumos", campo: "Observaciones", descripcion: "Meses con consumo o kg base incompletos.", uso: "Completar datos pendientes." },
      { hoja: "Registros consumo", campo: "Fuente", descripcion: "Origen de cada registro físico capturado.", uso: "Trazabilidad de facturas, albaranes o contadores." },
      { hoja: "Bases kg", campo: "Tipo", descripcion: "Kg de ventas o ajustes manuales usados como proxy.", uso: "Revisar la base antes de tener partes." },
      { hoja: "Detalle maquinas", campo: "kWh por máquina y sesión", descripcion: "Consumo eléctrico granular.", uso: "Análisis de máquinas." },
      { hoja: "Resumen maquinas", campo: "% electricidad", descripcion: "Peso de cada máquina sobre el consumo eléctrico total.", uso: "Priorizar mejoras." },
    ],
    autofilter: false,
    freeze: false,
  });

  await descargarLibro(ctx, buildLasarteFilename("Consumos", "xlsx", range));
}

// Cabecera/pie del REGISTRO FORMAL (encargo jul-2026): "DOCUMENTO Nº" +
// "FECHA EMISIÓN" + razón social/CIF/dirección en TODAS las páginas
// (cabeceraDocumento, pdfKit.ts) y el pie legal de 3 líneas con la Ref.
function drawHeader(doc: jsPDF) {
  cabeceraDocumento(doc, { documentoNumero: currentExportId ?? "", fechaEmision: currentGeneradoEn });
}

// Identificador y fecha de emisión del documento en curso (mismos en TODAS
// las páginas: cabecera, pie y cierre de atestación). Se fijan en exportConsumoToPDF.
let currentExportId: string | undefined;
let currentGeneradoEn: Date | undefined;

function drawFooter(doc: jsPDF) {
  pieLegal(doc, { exportId: currentExportId ?? "" });
}

// ─── Columnas PDF de la tabla principal (subconjunto de las columnas Excel) ──
// Vista condensada a proposito (19 columnas de la hoja "Consumos por
// periodo" no caben legibles en una pagina PDF), pero cada campo que SI se
// muestra usa el MISMO numFmt que su columna homonima en `periodosColumnas`
// (Excel) — antes el PDF recalculaba estos mismos ratios con
// `formatNumber(x, 2)` suelto (2 decimales, sin sufijo de unidad), mientras
// el Excel muestra 3-4 decimales + " L/kg"/"kWh/kg" via numFmt (FMT_LKG,
// FMT_KWHKG): mismo dato, precision y unidad distintas entre ambos exports.
const PERIODOS_PDF_COLUMNAS: ColumnaTabla[] = [
  { header: "Periodo", key: "periodo", width: 24 },
  { header: "Confianza", key: "confianza", width: 20 },
  { header: "Kg base", key: "kgBase", numFmt: FMT_KG, align: "right", width: 24 },
  { header: "Kg palets", key: "kgPalets", numFmt: FMT_KG, align: "right", width: 24 },
  { header: "Agua L/kg", key: "aguaLKg", numFmt: FMT_LKG, align: "right", width: 20 },
  { header: "kWh/kg", key: "electricidadKwhKg", numFmt: FMT_KWHKG, align: "right", width: 20 },
  { header: "Gasoil mL/kg", key: "gasoilMlKg", numFmt: FMT_MLKG, align: "right", width: 22 },
  { header: "Químicos mL/kg", key: "quimicosMlKg", numFmt: FMT_MLKG, align: "right", width: 24 },
];

const SESIONES_PDF_COLUMNAS: ColumnaTabla[] = [
  { header: "Periodo", key: "periodo", width: 46 },
  { header: "Kg", key: "kg", numFmt: FMT_KG, align: "right", width: 24 },
  { header: "Agua L/kg", key: "aguaLKg", numFmt: FMT_LKG, align: "right", width: 22 },
  { header: "kWh/kg", key: "electricidadKwhKg", numFmt: FMT_KWHKG, align: "right", width: 20 },
  { header: "Gasoil mL/kg", key: "gasoilMlKg", numFmt: FMT_MLKG, align: "right", width: 24 },
  { header: "Químicos mL/kg", key: "quimicosMlKg", numFmt: FMT_MLKG, align: "right", width: 24 },
];

export async function exportConsumoToPDF(data: ExportData) {
  await ensureExportLogoLoaded();
  currentGeneradoEn = new Date();
  currentExportId = generarExportId(currentGeneradoEn);
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const pageIndex = 1;
  const summary = buildConsumoReportSummary(data);
  const { periodos, hasPeriodos } = summary;
  const { totalKg } = summary.totals;

  // OBJETO/PERIODO del bloque de metadatos formales (portada) y del párrafo
  // de cierre/atestación (última página) — el MISMO texto en ambos sitios.
  // `summary.meta.periodLabel` por sí solo es solo el recuento ("2 sesion(es)");
  // se le antepone el rango de fechas real (`consumoDateRange`) para que el
  // PERIODO sea un rango legible, como pide el registro formal.
  const objeto = "los consumos físicos de recursos (agua, electricidad, gasoil y químicos) del periodo exportado";
  const rangoConsumo = consumoDateRange(data);
  const periodoTexto = rangoConsumo.from && rangoConsumo.to
    ? `${formatDate(rangoConsumo.from)} - ${formatDate(rangoConsumo.to)} · ${summary.meta.periodLabel}`
    : summary.meta.periodLabel ?? "Periodo exportado";
  const siguienteSeccion = crearNumeradorSecciones();

  drawHeader(doc);
  let y = portadaFormal(doc, 26, { titulo: summary.meta.title, objeto, periodo: periodoTexto });

  y = tituloSeccionNumerada(doc, y, siguienteSeccion(), "Indicadores principales", "KPIs globales del periodo exportado");
  y = dibujarKpisEnGrid(doc, y, summary.kpis);
  y = drawReportInsights(doc, summary.insights, 8, y, 281) + 4;
  y = tituloSeccionNumerada(
    doc,
    y,
    siguienteSeccion(),
    hasPeriodos ? "Consumos fisicos por periodo" : "Consumos de recursos por sesion",
    hasPeriodos ? "Ratios normalizados por kg base y confianza del periodo" : "Ratios normalizados por kg procesado en cada sesion",
  );

  // Filas + ColumnaTabla (numFmt FMT_KG/FMT_LKG/FMT_KWHKG/FMT_MLKG, las
  // MISMAS constantes que usa la hoja Excel "Consumos por periodo" para los
  // mismos campos): mismo dato, misma precisión y misma unidad en PDF y Excel.
  const filasPeriodos = periodos.map((row) => ({
    periodo: row.periodo,
    confianza: confianzaLabel[row.confianza],
    kgBase: row.kgBase,
    kgPalets: row.kgPalets,
    aguaLKg: row.aguaLKg,
    electricidadKwhKg: row.electricidadKwhKg,
    gasoilMlKg: row.gasoilMlKg,
    quimicosMlKg: row.quimicosMlKg,
  }));
  const filasSesiones = data.sesiones.map((s) => {
    const kg = s.kg_procesados || 0;
    const aguaTotal = (s.agua_linea_l || 0) + (s.agua_drencher_l || 0);
    return {
      periodo: s.fecha_inicio === s.fecha_fin ? formatDate(s.fecha_inicio) : `${formatDate(s.fecha_inicio)} - ${formatDate(s.fecha_fin)}`,
      kg,
      aguaLKg: kg > 0 ? aguaTotal / kg : null,
      electricidadKwhKg: kg > 0 ? (s.electricidad_total_kwh || 0) / kg : null,
      gasoilMlKg: kg > 0 ? ((s.gasoil_l || 0) * 1000) / kg : null,
      quimicosMlKg: kg > 0 ? ((s.quimicos_drencher_l || 0) * 1000) / kg : null,
    };
  });

  const pageIndexRef = { value: pageIndex };
  const onDrawPage = () => {
    const pages = doc.getNumberOfPages();
    if (pages > pageIndexRef.value) {
      pageIndexRef.value = pages;
      drawHeader(doc);
      drawFooter(doc);
    }
  };

  pdfTablaDesdeColumnas(doc, {
    columnas: hasPeriodos ? PERIODOS_PDF_COLUMNAS : SESIONES_PDF_COLUMNAS,
    filas: hasPeriodos ? filasPeriodos : filasSesiones,
    startY: y,
    didDrawPage: onDrawPage,
  });

  // Y del último contenido dibujado, para colocar el cierre/atestación
  // (última página) justo debajo — se va actualizando con cada bloque.
  let lastContentY = lastAutoTableY(doc,y);
  drawFooter(doc);

  if (hasPeriodos) {
    doc.addPage();
    pageIndexRef.value = doc.getNumberOfPages();
    drawHeader(doc);
    const validationY = tituloSeccionNumerada(doc, 26, siguienteSeccion(), "Validacion de consumos", "Observaciones detectadas en los periodos");
    const validationRows = periodos
      .filter((row) => row.issues.length > 0)
      .map((row) => [row.periodo, confianzaLabel[row.confianza], row.issues.join(" | ")]);

    autoTable(doc, {
      startY: validationY,
      head: [["Periodo", "Confianza", "Observaciones"]],
      body: validationRows.length > 0
        ? validationRows
        : [["Todos", "OK", "Sin incidencias de validacion"]],
      ...pdfTableTheme(),
      didDrawPage: onDrawPage,
    });

    lastContentY = lastAutoTableY(doc,validationY);
    drawFooter(doc);
  }

  if (data.maquinas.length > 0) {
    doc.addPage();
    pageIndexRef.value = doc.getNumberOfPages();
    drawHeader(doc);
    const machinesY = tituloSeccionNumerada(doc, 26, siguienteSeccion(), "Desglose de consumos por maquina", "Consumo electrico granular por equipo");

    const maqBody = data.maquinas.map((m) => {
      const totalKwh = data.consumosMaquinas
        .filter((cm) => cm.maquina_id === m.id)
        .reduce((s, cm) => s + (cm.kwh || 0), 0);
      return [m.nombre, m.zona, formatNumber(totalKwh, 1), totalKg > 0 ? formatNumber(totalKwh / totalKg, 4) : "-"];
    });

    autoTable(doc, {
      startY: machinesY,
      head: [["Maquina", "Zona", "kWh total", "kWh/kg"]],
      body: maqBody,
      ...pdfTableTheme(),
      didDrawPage: onDrawPage,
    });

    lastContentY = lastAutoTableY(doc,machinesY);
    drawFooter(doc);
  }

  // CIERRE (última página): párrafo de atestación + línea de emisión
  // electrónica, con el MISMO objeto/periodo que la portada.
  let cierreY = lastContentY + 8;
  if (cierreY > 160) {
    doc.addPage();
    pageIndexRef.value = doc.getNumberOfPages();
    drawHeader(doc);
    cierreY = 30;
  }
  cierreAtestacion(doc, cierreY, { objeto, periodo: periodoTexto, generadoEn: currentGeneradoEn });
  drawFooter(doc);

  finalizarPaginacionFormal(doc);
  doc.save(buildLasarteFilename("Consumos", "pdf", consumoDateRange(data)));
}

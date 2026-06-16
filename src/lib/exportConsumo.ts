import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { formatDate, formatNumber } from "./format";
import { type ConsumoPeriodoRow } from "./consumosFisicos";
import { SesionConsumoRow, ConsumoMaquinaRow, MaquinaRow, ConsumoFisicoRow, ConsumoBaseKgRow } from "./types";
import { drawExportHeader, drawExportFooter, pdfTableTheme } from "./exportTheme";
import { appendDictionarySheet, appendRowsSheet, createWorkbook, saveWorkbook } from "./exportWorkbook";
import {
  appendReportCoverSheet,
  buildReportFilename,
  drawReportCover,
  drawReportInsights,
  drawReportSectionTitle,
  type ReportInsight,
  type ReportKpi,
  type ReportMeta,
} from "./reportKit";

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

function periodo(s: SesionConsumoRow) {
  return s.fecha_inicio === s.fecha_fin ? s.fecha_inicio : `${s.fecha_inicio} - ${s.fecha_fin}`;
}

const confianzaLabel: Record<ConsumoPeriodoRow["confianza"], string> = {
  real: "Real",
  estimado: "Estimado",
  mixto: "Mixto",
  incompleto: "Incompleto",
};

function blankIfNull(value: number | null) {
  return value == null ? "" : value;
}

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

export function exportConsumoToExcel(data: ExportData) {
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

  const wb = createWorkbook("Lasarte SAT - Consumos fisicos", "Control de recursos por produccion");
  appendReportCoverSheet(wb, summary.meta, summary.kpis);

  const sesionesRows = data.sesiones.map((s) => {
    const kg = n(s.kg_procesados);
    const aguaTotal = n(s.agua_linea_l) + n(s.agua_drencher_l);
    return {
      Periodo: periodo(s),
      "Fecha inicio": s.fecha_inicio,
      "Fecha fin": s.fecha_fin,
      "Kg procesados": kg,
      "Agua linea L": n(s.agua_linea_l),
      "Agua drencher L": n(s.agua_drencher_l),
      "Agua total L": aguaTotal,
      "Agua L/kg": ratio(aguaTotal, kg, 3),
      "Quimicos L": n(s.quimicos_drencher_l),
      "Quimicos mL/kg": kg > 0 ? +((n(s.quimicos_drencher_l) * 1000) / kg).toFixed(2) : 0,
      "Gasoil L": n(s.gasoil_l),
      "Gasoil mL/kg": kg > 0 ? +((n(s.gasoil_l) * 1000) / kg).toFixed(2) : 0,
      "Electricidad kWh": n(s.electricidad_total_kwh),
      "kWh/kg": ratio(n(s.electricidad_total_kwh), kg, 4),
      Notas: s.notas ?? "",
    };
  });
  appendRowsSheet(wb, "Sesiones", sesionesRows, [22, 14, 14, 14, 14, 16, 14, 12, 12, 15, 12, 15, 16, 12, 40], { freezeHeader: true });

  const recursosRows = hasPeriodos
    ? [
      { Recurso: "Agua total", Unidad: "L", Total: Math.round(totalAguaFisica), "Por kg": ratio(totalAguaFisica, totalKg, 3), "Unidad ratio": "L/kg" },
      { Recurso: "Quimicos", Unidad: "L", Total: Math.round(totalQuimicos), "Por kg": totalKg > 0 ? +((totalQuimicos * 1000) / totalKg).toFixed(2) : 0, "Unidad ratio": "mL/kg" },
      { Recurso: "Gasoil", Unidad: "L", Total: Math.round(totalGasoil), "Por kg": totalKg > 0 ? +((totalGasoil * 1000) / totalKg).toFixed(2) : 0, "Unidad ratio": "mL/kg" },
      { Recurso: "Electricidad", Unidad: "kWh", Total: Math.round(totalElectricidad), "Por kg": ratio(totalElectricidad, totalKg, 4), "Unidad ratio": "kWh/kg" },
    ]
    : [
      { Recurso: "Agua linea", Unidad: "L", Total: Math.round(totalAguaLinea), "Por kg": ratio(totalAguaLinea, totalKg, 3), "Unidad ratio": "L/kg" },
      { Recurso: "Agua drencher", Unidad: "L", Total: Math.round(totalAguaDrencher), "Por kg": ratio(totalAguaDrencher, totalKg, 3), "Unidad ratio": "L/kg" },
      { Recurso: "Agua total", Unidad: "L", Total: Math.round(totalAguaFisica), "Por kg": ratio(totalAguaFisica, totalKg, 3), "Unidad ratio": "L/kg" },
      { Recurso: "Quimicos", Unidad: "L", Total: Math.round(totalQuimicos), "Por kg": totalKg > 0 ? +((totalQuimicos * 1000) / totalKg).toFixed(2) : 0, "Unidad ratio": "mL/kg" },
      { Recurso: "Gasoil", Unidad: "L", Total: Math.round(totalGasoil), "Por kg": totalKg > 0 ? +((totalGasoil * 1000) / totalKg).toFixed(2) : 0, "Unidad ratio": "mL/kg" },
      { Recurso: "Electricidad", Unidad: "kWh", Total: Math.round(totalElectricidad), "Por kg": ratio(totalElectricidad, totalKg, 4), "Unidad ratio": "kWh/kg" },
    ];
  appendRowsSheet(wb, "Resumen recursos", recursosRows, [20, 12, 14, 14, 14], { freezeHeader: true });

  if (hasPeriodos) {
    appendRowsSheet(wb, "Consumos por periodo", periodos.map((row) => ({
      Periodo: row.periodo,
      "Fecha inicio": row.fechaInicio,
      "Fecha fin": row.fechaFin,
      Confianza: confianzaLabel[row.confianza],
      "Kg partes": row.kgPartes,
      "Kg ventas": row.kgVentas,
      "Kg manual": row.kgManual,
      "Kg base": row.kgBase,
      "Agua L": row.aguaL,
      "Agua L/kg": blankIfNull(row.aguaLKg),
      "Electricidad kWh": row.electricidadKwh,
      "kWh/kg": blankIfNull(row.electricidadKwhKg),
      "Gasoil L": row.gasoilL,
      "Gasoil mL/kg": blankIfNull(row.gasoilMlKg),
      "Gasoil L/t": blankIfNull(row.gasoilLT),
      "Quimicos L": row.quimicosL,
      "Quimicos mL/kg": blankIfNull(row.quimicosMlKg),
      Observaciones: row.issues.join(" | "),
    })), [14, 14, 14, 14, 14, 14, 14, 14, 12, 12, 16, 12, 12, 14, 12, 12, 14, 42], { freezeHeader: true });

    appendRowsSheet(wb, "Validacion consumos", periodos
      .filter((row) => row.issues.length > 0)
      .map((row) => ({
        Periodo: row.periodo,
        Confianza: confianzaLabel[row.confianza],
        Observaciones: row.issues.join(" | "),
      })), [14, 14, 60], { freezeHeader: true });
  }

  if (data.consumosFisicos?.length) {
    appendRowsSheet(wb, "Registros consumo", data.consumosFisicos.map((row) => ({
      Recurso: row.recurso,
      "Fecha inicio": row.fecha_inicio,
      "Fecha fin": row.fecha_fin,
      Cantidad: row.cantidad,
      Unidad: row.unidad,
      Fuente: row.fuente,
      Referencia: row.referencia ?? "",
      Notas: row.notas ?? "",
    })), [14, 14, 14, 14, 10, 18, 24, 42], { freezeHeader: true });
  }

  if (data.basesKg?.length) {
    appendRowsSheet(wb, "Bases kg", data.basesKg.map((row) => ({
      Tipo: row.tipo_base,
      "Fecha inicio": row.fecha_inicio,
      "Fecha fin": row.fecha_fin,
      Kg: row.kg,
      Referencia: row.referencia ?? "",
      Notas: row.notas ?? "",
    })), [14, 14, 14, 14, 24, 42], { freezeHeader: true });
  }

  const machineName = new Map(data.maquinas.map((m) => [m.id, m]));
  const maquinaDetalleRows = data.consumosMaquinas.map((cm) => {
    const maquina = machineName.get(cm.maquina_id);
    return {
      "Sesion ID": cm.sesion_id,
      Maquina: maquina?.nombre ?? cm.maquina_id,
      Zona: maquina?.zona ?? "",
      "kWh": n(cm.kwh),
      "kWh/kg global": ratio(n(cm.kwh), totalKg, 5),
    };
  });
  appendRowsSheet(wb, "Detalle maquinas", maquinaDetalleRows, [34, 24, 18, 12, 14], { freezeHeader: true });

  const maquinaRows = data.maquinas.map((m) => {
    const totalKwh = data.consumosMaquinas
      .filter((cm) => cm.maquina_id === m.id)
      .reduce((s, cm) => s + n(cm.kwh), 0);
    return {
      Maquina: m.nombre,
      Zona: m.zona,
      "kWh total": +totalKwh.toFixed(2),
      "% electricidad": totalElectricidad > 0 ? +((totalKwh / totalElectricidad) * 100).toFixed(2) : 0,
      "kWh/kg global": ratio(totalKwh, totalKg, 5),
    };
  });
  appendRowsSheet(wb, "Resumen maquinas", maquinaRows, [24, 18, 14, 16, 16], { freezeHeader: true });

  appendDictionarySheet(wb, [
    { Hoja: "Sesiones", Campo: "Una fila por sesion", Descripcion: "Datos completos de cada rango de consumo.", Uso: "Filtrar por fecha y comparar ratios." },
    { Hoja: "Resumen recursos", Campo: "Por kg", Descripcion: "Consumo normalizado por kg procesado.", Uso: "Comparar eficiencia independientemente del volumen." },
    { Hoja: "Consumos por periodo", Campo: "Confianza", Descripcion: "Real usa partes, estimado usa ventas/manual, mixto prioriza partes.", Uso: "Auditar la calidad del KPI mensual." },
    { Hoja: "Validacion consumos", Campo: "Observaciones", Descripcion: "Meses con consumo o kg base incompletos.", Uso: "Completar datos pendientes." },
    { Hoja: "Registros consumo", Campo: "Fuente", Descripcion: "Origen de cada registro fisico capturado.", Uso: "Trazabilidad de facturas, albaranes o contadores." },
    { Hoja: "Bases kg", Campo: "Tipo", Descripcion: "Kg de ventas o ajustes manuales usados como proxy.", Uso: "Revisar la base antes de tener partes." },
    { Hoja: "Detalle maquinas", Campo: "kWh por maquina y sesion", Descripcion: "Consumo electrico granular.", Uso: "Analisis de maquinas." },
    { Hoja: "Resumen maquinas", Campo: "% electricidad", Descripcion: "Peso de cada maquina sobre el consumo electrico total.", Uso: "Priorizar mejoras." },
  ]);

  saveWorkbook(wb, buildReportFilename("informe-consumos-fisicos", "xlsx"));
}

function drawHeader(doc: jsPDF, pageIndex: number, subtitle?: string) {
  drawExportHeader(doc, pageIndex, "Consumos fisicos", subtitle);
}

function drawFooter(doc: jsPDF) {
  drawExportFooter(doc);
}

export function exportConsumoToPDF(data: ExportData) {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  let pageIndex = 1;
  const summary = buildConsumoReportSummary(data);
  const { periodos, hasPeriodos } = summary;
  const { totalKg } = summary.totals;

  let y = drawReportCover(doc, summary.meta, summary.kpis);
  y = drawReportInsights(doc, summary.insights, 8, y, 281) + 4;
  y = drawReportSectionTitle(
    doc,
    hasPeriodos ? "Consumos fisicos por periodo" : "Consumos de recursos por sesion",
    y,
    hasPeriodos ? "Ratios normalizados por kg base y confianza del periodo" : "Ratios normalizados por kg procesado en cada sesion",
  );

  const body = hasPeriodos
    ? periodos.map((row) => [
      row.periodo,
      confianzaLabel[row.confianza],
      formatNumber(row.kgBase, 0),
      row.aguaLKg == null ? "-" : formatNumber(row.aguaLKg, 2),
      row.electricidadKwhKg == null ? "-" : formatNumber(row.electricidadKwhKg, 3),
      row.gasoilMlKg == null ? "-" : formatNumber(row.gasoilMlKg, 1),
      row.quimicosMlKg == null ? "-" : formatNumber(row.quimicosMlKg, 1),
    ])
    : data.sesiones.map((s) => {
      const kg = s.kg_procesados || 0;
      const aguaTotal = (s.agua_linea_l || 0) + (s.agua_drencher_l || 0);
      return [
        s.fecha_inicio === s.fecha_fin ? formatDate(s.fecha_inicio) : `${formatDate(s.fecha_inicio)} - ${formatDate(s.fecha_fin)}`,
        formatNumber(kg, 0),
        kg > 0 ? formatNumber(aguaTotal / kg, 2) : "-",
        kg > 0 ? formatNumber((s.electricidad_total_kwh || 0) / kg, 3) : "-",
        kg > 0 ? formatNumber(((s.gasoil_l || 0) * 1000) / kg, 1) : "-",
        kg > 0 ? formatNumber(((s.quimicos_drencher_l || 0) * 1000) / kg, 1) : "-",
      ];
    });

  autoTable(doc, {
    startY: y,
    head: hasPeriodos
      ? [["Periodo", "Confianza", "Kg base", "Agua L/kg", "kWh/kg", "Gasoil mL/kg", "Quimicos mL/kg"]]
      : [["Periodo", "Kg", "Agua L/kg", "kWh/kg", "Gasoil mL/kg", "Quimicos mL/kg"]],
    body,
    ...pdfTableTheme(),
    didDrawPage: () => {
      const pages = doc.getNumberOfPages();
      if (pages > pageIndex) {
        pageIndex++;
        drawHeader(doc, pageIndex);
      }
    },
  });

  drawFooter(doc);

  if (hasPeriodos) {
    doc.addPage();
    pageIndex++;
    drawHeader(doc, pageIndex, "Validacion");
    const validationY = drawReportSectionTitle(doc, "Validacion de consumos", 24, "Observaciones detectadas en los periodos");
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
    });

    drawFooter(doc);
  }

  if (data.maquinas.length > 0) {
    doc.addPage();
    pageIndex++;
    drawHeader(doc, pageIndex, "Maquinas");
    const machinesY = drawReportSectionTitle(doc, "Desglose de consumos por maquina", 24, "Consumo electrico granular por equipo");

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
    });

    drawFooter(doc);
  }

  doc.save(buildReportFilename("informe-consumos-fisicos", "pdf"));
}

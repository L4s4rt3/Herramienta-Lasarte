import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { formatDate, formatNumber } from "./format";
import { SesionConsumoRow, ConsumoMaquinaRow, MaquinaRow } from "./types";
import { PDF_THEME, drawExportHeader, drawExportFooter, drawKpiCard, pdfTableTheme } from "./exportTheme";
import { appendAoaSheet, appendDictionarySheet, appendRowsSheet, createWorkbook, saveWorkbook } from "./exportWorkbook";

export interface ExportData {
  sesiones: SesionConsumoRow[];
  maquinas: MaquinaRow[];
  consumosMaquinas: ConsumoMaquinaRow[];
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

export function exportConsumoToExcel(data: ExportData) {
  const totalKg = data.sesiones.reduce((s, r) => s + n(r.kg_procesados), 0);
  const totalAguaLinea = data.sesiones.reduce((s, r) => s + n(r.agua_linea_l), 0);
  const totalAguaDrencher = data.sesiones.reduce((s, r) => s + n(r.agua_drencher_l), 0);
  const totalAgua = totalAguaLinea + totalAguaDrencher;
  const totalQuimicos = data.sesiones.reduce((s, r) => s + n(r.quimicos_drencher_l), 0);
  const totalGasoil = data.sesiones.reduce((s, r) => s + n(r.gasoil_l), 0);
  const totalElectricidad = data.sesiones.reduce((s, r) => s + n(r.electricidad_total_kwh), 0);

  const wb = createWorkbook("Lasarte SAT - Consumos fisicos", "Control de recursos por produccion");
  appendAoaSheet(wb, "Portada", [
    ["Lasarte SAT - Informe de consumos fisicos"],
    [`Generado: ${new Date().toLocaleString("es-ES")}`],
    [],
    ["Indicador", "Valor"],
    ["Sesiones", data.sesiones.length],
    ["Kg procesados", Math.round(totalKg)],
    ["Agua total L", Math.round(totalAgua)],
    ["Agua L/kg", ratio(totalAgua, totalKg, 3)],
    ["Electricidad kWh", Math.round(totalElectricidad)],
    ["kWh/kg", ratio(totalElectricidad, totalKg, 4)],
    ["Gasoil L", Math.round(totalGasoil)],
    ["Gasoil mL/kg", totalKg > 0 ? +((totalGasoil * 1000) / totalKg).toFixed(2) : 0],
    ["Quimicos L", Math.round(totalQuimicos)],
    ["Quimicos mL/kg", totalKg > 0 ? +((totalQuimicos * 1000) / totalKg).toFixed(2) : 0],
  ], [34, 24]);

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

  const recursosRows = [
    { Recurso: "Agua linea", Unidad: "L", Total: Math.round(totalAguaLinea), "Por kg": ratio(totalAguaLinea, totalKg, 3), "Unidad ratio": "L/kg" },
    { Recurso: "Agua drencher", Unidad: "L", Total: Math.round(totalAguaDrencher), "Por kg": ratio(totalAguaDrencher, totalKg, 3), "Unidad ratio": "L/kg" },
    { Recurso: "Agua total", Unidad: "L", Total: Math.round(totalAgua), "Por kg": ratio(totalAgua, totalKg, 3), "Unidad ratio": "L/kg" },
    { Recurso: "Quimicos", Unidad: "L", Total: Math.round(totalQuimicos), "Por kg": totalKg > 0 ? +((totalQuimicos * 1000) / totalKg).toFixed(2) : 0, "Unidad ratio": "mL/kg" },
    { Recurso: "Gasoil", Unidad: "L", Total: Math.round(totalGasoil), "Por kg": totalKg > 0 ? +((totalGasoil * 1000) / totalKg).toFixed(2) : 0, "Unidad ratio": "mL/kg" },
    { Recurso: "Electricidad", Unidad: "kWh", Total: Math.round(totalElectricidad), "Por kg": ratio(totalElectricidad, totalKg, 4), "Unidad ratio": "kWh/kg" },
  ];
  appendRowsSheet(wb, "Resumen recursos", recursosRows, [20, 12, 14, 14, 14], { freezeHeader: true });

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
    { Hoja: "Detalle maquinas", Campo: "kWh por maquina y sesion", Descripcion: "Consumo electrico granular.", Uso: "Analisis de maquinas." },
    { Hoja: "Resumen maquinas", Campo: "% electricidad", Descripcion: "Peso de cada maquina sobre el consumo electrico total.", Uso: "Priorizar mejoras." },
  ]);

  saveWorkbook(wb, "consumos_fisicos.xlsx");
}

function drawHeader(doc: jsPDF, pageIndex: number, subtitle?: string) {
  drawExportHeader(doc, pageIndex, "Consumos fisicos", subtitle);
}

function drawFooter(doc: jsPDF) {
  drawExportFooter(doc);
}

export function exportConsumoToPDF(data: ExportData) {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  let pageIndex = 0;

  pageIndex++;
  drawHeader(doc, pageIndex);

  doc.setFillColor(...PDF_THEME.cream);
  doc.roundedRect(8, 26, 281, 16, 2, 2, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.setTextColor(...PDF_THEME.primaryDark);
  doc.text("Consumos de recursos por sesion", 148.5, 35, { align: "center" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...PDF_THEME.muted);
  doc.text(`${data.sesiones.length} sesion(es)`, 148.5, 40, { align: "center" });

  const totalKg = data.sesiones.reduce((s, r) => s + (r.kg_procesados || 0), 0);
  const totalAgua = data.sesiones.reduce((s, r) => s + (r.agua_linea_l || 0) + (r.agua_drencher_l || 0), 0);
  const totalElec = data.sesiones.reduce((s, r) => s + (r.electricidad_total_kwh || 0), 0);
  const totalGasoil = data.sesiones.reduce((s, r) => s + (r.gasoil_l || 0), 0);

  [
    { label: "KG PROCESADOS", val: formatNumber(totalKg, 0), sub: "total" },
    { label: "AGUA TOTAL", val: `${formatNumber(totalAgua, 0)} L`, sub: totalKg > 0 ? `${formatNumber(totalAgua / totalKg, 2)} L/kg` : "" },
    { label: "ELECTRICIDAD", val: `${formatNumber(totalElec, 0)} kWh`, sub: totalKg > 0 ? `${formatNumber(totalElec / totalKg, 3)} kWh/kg` : "" },
    { label: "GASOIL", val: `${formatNumber(totalGasoil, 0)} L`, sub: totalKg > 0 ? `${formatNumber((totalGasoil * 1000) / totalKg, 1)} mL/kg` : "" },
    { label: "SESIONES", val: `${data.sesiones.length}`, sub: "registradas" },
  ].forEach((k, i) => drawKpiCard(doc, 8 + i * 57, 48, 55, k.label, k.val, k.sub));

  const body = data.sesiones.map((s) => {
    const kg = s.kg_procesados || 1;
    const aguaTotal = (s.agua_linea_l || 0) + (s.agua_drencher_l || 0);
    return [
      s.fecha_inicio === s.fecha_fin ? formatDate(s.fecha_inicio) : `${formatDate(s.fecha_inicio)} - ${formatDate(s.fecha_fin)}`,
      formatNumber(kg, 0),
      formatNumber(aguaTotal / kg, 2),
      formatNumber((s.electricidad_total_kwh || 0) / kg, 3),
      formatNumber(((s.gasoil_l || 0) * 1000) / kg, 1),
      formatNumber(((s.quimicos_drencher_l || 0) * 1000) / kg, 1),
    ];
  });

  autoTable(doc, {
    startY: 74,
    head: [["Periodo", "Kg", "Agua L/kg", "kWh/kg", "Gasoil mL/kg", "Quimicos mL/kg"]],
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

  if (data.maquinas.length > 0) {
    doc.addPage();
    pageIndex++;
    drawHeader(doc, pageIndex, "Maquinas");

    doc.setFillColor(...PDF_THEME.cream);
    doc.roundedRect(8, 16, 281, 14, 2, 2, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(...PDF_THEME.primaryDark);
    doc.text("Desglose de consumos por maquina", 148.5, 24, { align: "center" });

    const maqBody = data.maquinas.map((m) => {
      const totalKwh = data.consumosMaquinas
        .filter((cm) => cm.maquina_id === m.id)
        .reduce((s, cm) => s + (cm.kwh || 0), 0);
      return [m.nombre, m.zona, formatNumber(totalKwh, 1), totalKg > 0 ? formatNumber(totalKwh / totalKg, 4) : "-"];
    });

    autoTable(doc, {
      startY: 34,
      head: [["Maquina", "Zona", "kWh total", "kWh/kg"]],
      body: maqBody,
      ...pdfTableTheme(),
    });

    drawFooter(doc);
  }

  doc.save("consumos_fisicos.pdf");
}

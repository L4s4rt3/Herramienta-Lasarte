import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { formatDate, formatNumber } from "./format";
import { SesionConsumoRow, ConsumoMaquinaRow, MaquinaRow } from "./types";
import { PDF_THEME, drawExportHeader, drawExportFooter, drawKpiCard, pdfTableTheme } from "./exportTheme";

export interface ExportData {
  sesiones: SesionConsumoRow[];
  maquinas: MaquinaRow[];
  consumosMaquinas: ConsumoMaquinaRow[];
}

export function exportConsumoToExcel(data: ExportData) {
  const wb = XLSX.utils.book_new();
  wb.Props = {
    Title: "Lasarte SAT - Consumos fisicos",
    Subject: "Control de produccion",
    Author: "Herramienta Lasarte SAT",
  };

  const rows = data.sesiones.map((s) => {
    const kg = s.kg_procesados || 1;
    const aguaTotal = (s.agua_linea_l || 0) + (s.agua_drencher_l || 0);
    return {
      Período: s.fecha_inicio === s.fecha_fin ? s.fecha_inicio : `${s.fecha_inicio} — ${s.fecha_fin}`,
      "Kg procesados": s.kg_procesados || 0,
      "Agua línea (L)": s.agua_linea_l || 0,
      "Agua drencher (L)": s.agua_drencher_l || 0,
      "Agua total (L)": aguaTotal,
      "Agua L/kg": +(aguaTotal / kg).toFixed(2),
      "Químicos (L)": s.quimicos_drencher_l || 0,
      "Químicos mL/kg": +(((s.quimicos_drencher_l || 0) * 1000) / kg).toFixed(1),
      "Gasoil (L)": s.gasoil_l || 0,
      "Gasoil mL/kg": +(((s.gasoil_l || 0) * 1000) / kg).toFixed(1),
      "Electricidad (kWh)": s.electricidad_total_kwh || 0,
      "kWh/kg": +((s.electricidad_total_kwh || 0) / kg).toFixed(3),
      Notas: s.notas ?? "",
    };
  });

  const wsSesiones = XLSX.utils.json_to_sheet(rows);
  wsSesiones["!cols"] = [
    { wch: 24 }, { wch: 14 }, { wch: 14 }, { wch: 16 },
    { wch: 14 }, { wch: 12 }, { wch: 12 }, { wch: 14 },
    { wch: 14 }, { wch: 14 }, { wch: 18 }, { wch: 12 },
    { wch: 30 },
  ];
  wsSesiones["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length, c: 12 } }) };
  XLSX.utils.book_append_sheet(wb, wsSesiones, "Sesiones");

  if (data.maquinas.length > 0) {
    const totalKg = data.sesiones.reduce((s, r) => s + (r.kg_procesados || 0), 0);
    const maqRows = data.maquinas.map((m) => {
      const totalKwh = data.consumosMaquinas
        .filter((cm) => cm.maquina_id === m.id)
        .reduce((s, cm) => s + (cm.kwh || 0), 0);
      return { Máquina: m.nombre, Zona: m.zona, "kWh total": totalKwh, "kWh/kg": totalKg > 0 ? +(totalKwh / totalKg).toFixed(4) : 0 };
    });
    const wsMaquinas = XLSX.utils.json_to_sheet(maqRows);
    wsMaquinas["!cols"] = [{ wch: 20 }, { wch: 20 }, { wch: 14 }, { wch: 12 }];
    wsMaquinas["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: maqRows.length, c: 3 } }) };
    XLSX.utils.book_append_sheet(wb, wsMaquinas, "Máquinas");
  }

  XLSX.writeFile(wb, `consumos_fisicos.xlsx`, { bookType: "xlsx", compression: true });
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

  // KPI row
  const totalKg = data.sesiones.reduce((s, r) => s + (r.kg_procesados || 0), 0);
  const totalAgua = data.sesiones.reduce((s, r) => s + (r.agua_linea_l || 0) + (r.agua_drencher_l || 0), 0);
  const totalElec = data.sesiones.reduce((s, r) => s + (r.electricidad_total_kwh || 0), 0);
  const totalGasoil = data.sesiones.reduce((s, r) => s + (r.gasoil_l || 0), 0);

  const kpis = [
    { label: "KG PROCESADOS", val: formatNumber(totalKg, 0), sub: "total" },
    { label: "AGUA TOTAL", val: `${formatNumber(totalAgua, 0)} L`, sub: totalKg > 0 ? `${formatNumber(totalAgua / totalKg, 2)} L/kg` : "" },
    { label: "ELECTRICIDAD", val: `${formatNumber(totalElec, 0)} kWh`, sub: totalKg > 0 ? `${formatNumber(totalElec / totalKg, 3)} kWh/kg` : "" },
    { label: "GASOIL", val: `${formatNumber(totalGasoil, 0)} L`, sub: totalKg > 0 ? `${formatNumber((totalGasoil * 1000) / totalKg, 1)} mL/kg` : "" },
    { label: "SESIONES", val: `${data.sesiones.length}`, sub: "registradas" },
  ];

  kpis.forEach((k, i) => {
    const x = 8 + i * 57;
    drawKpiCard(doc, x, 48, 55, k.label, k.val, k.sub);
  });

  const body = data.sesiones.map((s) => {
    const kg = s.kg_procesados || 1;
    const aguaTotal = (s.agua_linea_l || 0) + (s.agua_drencher_l || 0);
    return [
      s.fecha_inicio === s.fecha_fin
        ? formatDate(s.fecha_inicio)
        : `${formatDate(s.fecha_inicio)} — ${formatDate(s.fecha_fin)}`,
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

  // ── Máquinas page ────────────────────────────────────────────────────────
  if (data.maquinas.length > 0) {
    doc.addPage();
    pageIndex++;
    drawHeader(doc, pageIndex, "Máquinas");

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
      return [m.nombre, m.zona, formatNumber(totalKwh, 1), totalKg > 0 ? formatNumber(totalKwh / totalKg, 4) : "—"];
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

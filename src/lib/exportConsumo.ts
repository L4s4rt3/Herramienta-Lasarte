import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { formatDate, formatNumber } from "./format";
import { SesionConsumoRow, ConsumoMaquinaRow, MaquinaRow } from "./types";

interface ExportData {
  sesiones: SesionConsumoRow[];
  maquinas: MaquinaRow[];
  consumosMaquinas: ConsumoMaquinaRow[];
}

export function exportConsumoToExcel(data: ExportData) {
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

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "Sesiones");

  if (data.maquinas.length > 0) {
    const maqRows = data.maquinas.map((m) => {
      const totalKwh = data.consumosMaquinas
        .filter((cm) => cm.maquina_id === m.id)
        .reduce((s, cm) => s + (cm.kwh || 0), 0);
      const totalKg = data.sesiones.reduce((s, r) => s + (r.kg_procesados || 0), 0);
      return {
        Máquina: m.nombre,
        Zona: m.zona,
        "kWh total": totalKwh,
        "kWh/kg": totalKg > 0 ? +(totalKwh / totalKg).toFixed(4) : 0,
      };
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(maqRows), "Máquinas");
  }

  XLSX.writeFile(wb, `consumos_fisicos.xlsx`);
}

export function exportConsumoToPDF(data: ExportData) {
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  doc.setFontSize(14);
  doc.text("Consumos físicos — Lasarte SAT", 40, 40);

  const body = data.sesiones.map((s) => {
    const kg = s.kg_procesados || 1;
    const aguaTotal = (s.agua_linea_l || 0) + (s.agua_drencher_l || 0);
    return [
      s.fecha_inicio === s.fecha_fin ? formatDate(s.fecha_inicio) : `${formatDate(s.fecha_inicio)} — ${formatDate(s.fecha_fin)}`,
      formatNumber(kg, 0),
      formatNumber(aguaTotal / kg, 2),
      formatNumber((s.electricidad_total_kwh || 0) / kg, 3),
      formatNumber(((s.gasoil_l || 0) * 1000) / kg, 1),
      formatNumber(((s.quimicos_drencher_l || 0) * 1000) / kg, 1),
    ];
  });

  autoTable(doc, {
    startY: 60,
    head: [["Período", "Kg", "Agua L/kg", "kWh/kg", "Gasoil mL/kg", "Químicos mL/kg"]],
    body,
    styles: { fontSize: 9, cellPadding: 4 },
    headStyles: { fillColor: [26, 76, 60] },
  });

  doc.save("consumos_fisicos.pdf");
}

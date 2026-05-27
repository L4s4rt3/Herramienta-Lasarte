import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { PDF_THEME, drawExportHeader, drawExportFooter, drawKpiCard, pdfTableTheme } from "./exportTheme";

interface DiaData {
  date: string;
  workers: number;
  kg: number;
  kgPorPersona: number;
}

interface SemanaData {
  weekStart: string;
  label: string;
  days: Record<string, DiaData>;
}

const DAYS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
const DAY_KEYS = ["Lun", "Mar", "Mie", "Jue", "Vie", "Sab", "Dom"];

export function exportEficienciaToExcel(data: SemanaData[], _optimo: string) {
  const resumenRows = data.map((sem) => {
    const semKg = Object.values(sem.days).reduce((a, d) => a + d.kg, 0);
    const semWorkers = Object.values(sem.days).reduce((a, d) => a + d.workers, 0);
    const dias = Object.values(sem.days).length;
    const row: Record<string, any> = {
      Semana: `Semana del ${sem.label}`,
      "Kg total": Math.round(semKg),
      "Personas acumuladas": semWorkers,
      "Dias con datos": dias,
      "Personas/dia": dias > 0 ? +(semWorkers / dias).toFixed(1) : "",
      "Kg/dia": dias > 0 ? Math.round(semKg / dias) : "",
    };
    for (let i = 0; i < DAY_KEYS.length; i++) {
      const dia = sem.days[DAY_KEYS[i]];
      row[DAYS[i]] = dia ? Math.round(dia.kgPorPersona) : "";
    }
    row["Kg/persona semana"] = semWorkers > 0 ? Math.round(semKg / semWorkers) : "";
    return row;
  });

  const detalleRows = data.flatMap((sem) =>
    DAY_KEYS.map((key, i) => {
      const dia = sem.days[key];
      if (!dia) return null;
      return {
        Semana: `Semana del ${sem.label}`,
        Dia: DAYS[i],
        Fecha: dia.date,
        "Kg producidos": Math.round(dia.kg),
        Personas: dia.workers,
        "Kg/persona": Math.round(dia.kgPorPersona),
      };
    }).filter(Boolean)
  );

  const allDias = data.flatMap((sem) => Object.values(sem.days));
  const totalKg = allDias.reduce((s, d) => s + d.kg, 0);
  const totalWorkers = allDias.reduce((s, d) => s + d.workers, 0);
  const bestDay = allDias.reduce<DiaData | null>((best, d) => (!best || d.kgPorPersona > best.kgPorPersona ? d : best), null);

  const wb = XLSX.utils.book_new();
  wb.Props = {
    Title: "Lasarte SAT - Comparativa semanal",
    Subject: "Rendimiento de produccion por asistencia",
    Author: "Herramienta Lasarte SAT",
  };

  const wsIndicadores = XLSX.utils.aoa_to_sheet([
    ["Lasarte SAT - Comparativa semanal de asistencia y produccion"],
    [`Generado: ${new Date().toLocaleString("es-ES")}`],
    [],
    ["Indicador", "Valor"],
    ["Semanas con datos", data.length],
    ["Dias con datos", allDias.length],
    ["Kg producidos", Math.round(totalKg)],
    ["Personas acumuladas", totalWorkers],
    ["Kg/persona global", totalWorkers > 0 ? Math.round(totalKg / totalWorkers) : 0],
    ["Mejor dia", bestDay ? `${bestDay.date} (${Math.round(bestDay.kgPorPersona)} kg/persona)` : ""],
  ]);
  wsIndicadores["!cols"] = [{ wch: 42 }, { wch: 30 }];
  XLSX.utils.book_append_sheet(wb, wsIndicadores, "Indicadores");

  const ws = XLSX.utils.json_to_sheet(resumenRows);
  ws["!cols"] = [
    { wch: 22 }, { wch: 14 }, { wch: 20 }, { wch: 14 }, { wch: 14 }, { wch: 14 },
    ...DAYS.map(() => ({ wch: 10 })),
    { wch: 18 },
  ];
  ws["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: resumenRows.length, c: 13 } }) };
  XLSX.utils.book_append_sheet(wb, ws, "Resumen semanal");

  const wsDetalle = XLSX.utils.json_to_sheet(detalleRows);
  wsDetalle["!cols"] = [{ wch: 22 }, { wch: 10 }, { wch: 12 }, { wch: 14 }, { wch: 12 }, { wch: 14 }];
  wsDetalle["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: detalleRows.length, c: 5 } }) };
  XLSX.utils.book_append_sheet(wb, wsDetalle, "Detalle diario");

  XLSX.writeFile(wb, `comparativa_semanal.xlsx`, { bookType: "xlsx", compression: true });
}

function drawHeader(doc: jsPDF, pageIndex: number) {
  drawExportHeader(doc, pageIndex, "Comparativa semanal", "Kg/persona por dia");
}

function drawFooter(doc: jsPDF) {
  drawExportFooter(doc);
}

export function exportEficienciaToPDF(data: SemanaData[], _optimo: string) {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  let pageIndex = 0;

  pageIndex++;
  drawHeader(doc, pageIndex);

  doc.setFillColor(...PDF_THEME.cream);
  doc.roundedRect(8, 26, 281, 16, 2, 2, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.setTextColor(...PDF_THEME.primaryDark);
  doc.text("Comparativa semanal - Kg/persona por dia", 148.5, 35, { align: "center" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...PDF_THEME.muted);
  doc.text(`${data.length} semana(s) de datos`, 148.5, 40, { align: "center" });

  // Compute aggregate stats to fill space
  const allDias = data.flatMap((sem) => Object.values(sem.days));
  const totalKg = allDias.reduce((s, d) => s + d.kg, 0);
  const totalWorkers = allDias.reduce((s, d) => s + d.workers, 0);
  const globalEfic = totalWorkers > 0 ? Math.round(totalKg / totalWorkers) : 0;

  // KPI cards row
  const kpis = [
    { label: "TOTAL KG", val: `${totalKg.toLocaleString("es-ES")} kg`, sub: `${allDias.length} día(s)` },
    { label: "TOTAL TRABAJADORES", val: `${totalWorkers}`, sub: "suma diaria" },
    { label: "KG/PERSONA GLOBAL", val: `${globalEfic.toLocaleString("es-ES")}`, sub: "media global" },
    { label: "SEMANAS", val: `${data.length}`, sub: "en período" },
    { label: "DÍAS CON DATOS", val: `${allDias.length}`, sub: "de 7 posibles/sem" },
  ];

  kpis.forEach((k, i) => {
    const x = 8 + i * 57;
    drawKpiCard(doc, x, 48, 55, k.label, k.val, k.sub);
  });

  const head = ["Semana", "Kg total", "Personas", "Dias", ...DAYS, "Kg/persona"];
  const body = data.map((sem) => {
    const semKg = Object.values(sem.days).reduce((a, d) => a + d.kg, 0);
    const semWorkers = Object.values(sem.days).reduce((a, d) => a + d.workers, 0);
    const semEfic = semWorkers > 0 ? Math.round(semKg / semWorkers) : 0;
    const cells = [
      `Semana del ${sem.label}`,
      new Intl.NumberFormat("es-ES").format(Math.round(semKg)),
      new Intl.NumberFormat("es-ES").format(semWorkers),
      String(Object.keys(sem.days).length),
    ];
    for (const dk of DAY_KEYS) {
      const dia = sem.days[dk];
      cells.push(dia ? new Intl.NumberFormat("es-ES").format(Math.round(dia.kgPorPersona)) : "—");
    }
    cells.push(new Intl.NumberFormat("es-ES").format(semEfic));
    return cells;
  });

  autoTable(doc, {
    startY: 74,
    head: [head],
    body,
    ...pdfTableTheme(),
    columnStyles: {
      0: { cellWidth: 42 },
      1: { halign: "right" },
      2: { halign: "right" },
      3: { halign: "right" },
      11: { halign: "right", fontStyle: "bold" },
    },
    didDrawPage: () => {
      const pages = doc.getNumberOfPages();
      if (pages > pageIndex) {
        pageIndex++;
        drawHeader(doc, pageIndex);
      }
    },
  });

  drawFooter(doc);
  doc.save("comparativa_semanal.pdf");
}

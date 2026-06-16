import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { PDF_THEME, drawExportHeader, drawExportFooter, drawKpiCard, pdfTableTheme } from "./exportTheme";
import { appendAoaSheet, appendDictionarySheet, appendRowsSheet, createWorkbook, saveWorkbook } from "./exportWorkbook";

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

const DAYS = ["Lun", "Mar", "Mie", "Jue", "Vie", "Sab", "Dom"];
const DAY_KEYS = ["Lun", "Mar", "Mie", "Jue", "Vie", "Sab", "Dom"];
type ExportCell = string | number;

function kgPersonaDesdeMedias(kgDia: number, personasDia: number) {
  return personasDia > 0 ? kgDia / personasDia : 0;
}

function weekStats(sem: SemanaData) {
  const days = Object.values(sem.days);
  const kg = days.reduce((s, d) => s + d.kg, 0);
  const workers = days.reduce((s, d) => s + d.workers, 0);
  const dias = days.length;
  const personasDia = dias > 0 ? workers / dias : 0;
  const kgDia = dias > 0 ? kg / dias : 0;
  return {
    kg,
    workers,
    dias,
    personasDia,
    kgDia,
    kgPersona: kgPersonaDesdeMedias(kgDia, personasDia),
  };
}

export function exportEficienciaToExcel(data: SemanaData[], _optimo: string) {
  const resumenRows = data.map((sem) => {
    const stats = weekStats(sem);
    const row: Record<string, ExportCell> = {
      Semana: `Semana del ${sem.label}`,
      "Inicio semana": sem.weekStart,
      "Kg total": Math.round(stats.kg),
      "Media personas/dia": +stats.personasDia.toFixed(1),
      "Dias con datos": stats.dias,
      "Kg/dia": Math.round(stats.kgDia),
    };
    for (let i = 0; i < DAY_KEYS.length; i++) {
      const dia = sem.days[DAY_KEYS[i]];
      row[DAYS[i]] = dia ? Math.round(dia.kgPorPersona) : "";
    }
    row["Kg/persona semana"] = Math.round(stats.kgPersona);
    return row;
  });

  const detalleRows = data.flatMap((sem) =>
    DAY_KEYS.map((key, i) => {
      const dia = sem.days[key];
      if (!dia) return null;
      return {
        Semana: `Semana del ${sem.label}`,
        "Inicio semana": sem.weekStart,
        Dia: DAYS[i],
        Fecha: dia.date,
        "Kg producidos": Math.round(dia.kg),
        Personas: dia.workers,
        "Kg/persona": Math.round(dia.kgPorPersona),
      };
    }).filter(Boolean) as Record<string, ExportCell>[]
  );

  const allDias = data.flatMap((sem) => Object.values(sem.days));
  const totalKg = allDias.reduce((s, d) => s + d.kg, 0);
  const totalWorkers = allDias.reduce((s, d) => s + d.workers, 0);
  const mediaPersonasDia = allDias.length > 0 ? totalWorkers / allDias.length : 0;
  const mediaKgDia = allDias.length > 0 ? totalKg / allDias.length : 0;
  const kgPersonaGlobal = kgPersonaDesdeMedias(mediaKgDia, mediaPersonasDia);
  const bestDay = allDias.reduce<DiaData | null>((best, d) => (!best || d.kgPorPersona > best.kgPorPersona ? d : best), null);
  const comparativaRows = data.map((sem, index) => {
    const current = weekStats(sem);
    const prev = index > 0 ? weekStats(data[index - 1]) : null;
    return {
      Semana: `Semana del ${sem.label}`,
      "Kg/persona": Math.round(current.kgPersona),
      "Kg/persona semana previa": prev ? Math.round(prev.kgPersona) : "",
      "Dif kg/persona": prev ? Math.round(current.kgPersona - prev.kgPersona) : "",
      "Dif kg/persona %": prev && prev.kgPersona > 0 ? +(((current.kgPersona - prev.kgPersona) / prev.kgPersona) * 100).toFixed(2) : "",
      "Kg total": Math.round(current.kg),
      "Dif kg total": prev ? Math.round(current.kg - prev.kg) : "",
      "Personas/dia": +current.personasDia.toFixed(1),
      "Dias con datos": current.dias,
    };
  });

  const wb = createWorkbook("Lasarte SAT - Comparativa semanal", "Rendimiento de produccion por asistencia");
  appendAoaSheet(wb, "Portada", [
    ["Lasarte SAT - Comparativa semanal de asistencia y produccion"],
    [`Generado: ${new Date().toLocaleString("es-ES")}`],
    [],
    ["Indicador", "Valor"],
    ["Semanas con datos", data.length],
    ["Dias con datos", allDias.length],
    ["Kg producidos", Math.round(totalKg)],
    ["Media personas/dia", +mediaPersonasDia.toFixed(1)],
    ["Kg/persona global", Math.round(kgPersonaGlobal)],
    ["Mejor dia", bestDay ? `${bestDay.date} (${Math.round(bestDay.kgPorPersona)} kg/persona)` : ""],
  ], [46, 34]);

  appendRowsSheet(wb, "Resumen semanal", resumenRows, [22, 14, 14, 20, 14, 14, ...DAYS.map(() => 10), 18], { freezeHeader: true });
  appendRowsSheet(wb, "Comparativa", comparativaRows, [22, 14, 24, 16, 16, 14, 14, 14, 14], { freezeHeader: true });
  appendRowsSheet(wb, "Detalle diario", detalleRows, [22, 14, 10, 12, 14, 12, 14], { freezeHeader: true });
  appendDictionarySheet(wb, [
    { Hoja: "Resumen semanal", Campo: "Media personas/dia", Descripcion: "Promedio de asistencias diarias con datos en la semana.", Uso: "Dimensionar la asistencia sin usar acumulados." },
    { Hoja: "Resumen semanal", Campo: "Kg/persona semana", Descripcion: "Kg medio/dia dividido entre media personas/dia de la semana.", Uso: "KPI principal de rendimiento coherente con la asistencia media." },
    { Hoja: "Comparativa", Campo: "Dif kg/persona", Descripcion: "Diferencia contra la semana anterior.", Uso: "Detectar mejora o caida semanal." },
    { Hoja: "Detalle diario", Campo: "Kg/persona", Descripcion: "Kg producidos en el dia entre trabajadores presentes.", Uso: "Analisis por dia de la semana." },
  ]);

  saveWorkbook(wb, "comparativa_semanal.xlsx");
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

  const allDias = data.flatMap((sem) => Object.values(sem.days));
  const totalKg = allDias.reduce((s, d) => s + d.kg, 0);
  const totalWorkers = allDias.reduce((s, d) => s + d.workers, 0);
  const mediaPersonasDia = allDias.length > 0 ? totalWorkers / allDias.length : 0;
  const mediaKgDia = allDias.length > 0 ? totalKg / allDias.length : 0;
  const globalEfic = Math.round(kgPersonaDesdeMedias(mediaKgDia, mediaPersonasDia));

  [
    { label: "TOTAL KG", val: `${totalKg.toLocaleString("es-ES")} kg`, sub: `${allDias.length} dia(s)` },
    { label: "ASISTENCIA MEDIA", val: `${mediaPersonasDia.toLocaleString("es-ES", { maximumFractionDigits: 1, minimumFractionDigits: 1 })}`, sub: "personas/dia" },
    { label: "KG/PERSONA GLOBAL", val: `${globalEfic.toLocaleString("es-ES")}`, sub: "media global" },
    { label: "SEMANAS", val: `${data.length}`, sub: "en periodo" },
    { label: "DIAS CON DATOS", val: `${allDias.length}`, sub: "de 7 posibles/sem" },
  ].forEach((k, i) => drawKpiCard(doc, 8 + i * 57, 48, 55, k.label, k.val, k.sub));

  const head = ["Semana", "Kg total", "Media pers/dia", "Dias", ...DAYS, "Kg/persona"];
  const body = data.map((sem) => {
    const stats = weekStats(sem);
    const cells = [
      `Semana del ${sem.label}`,
      new Intl.NumberFormat("es-ES").format(Math.round(stats.kg)),
      new Intl.NumberFormat("es-ES", { maximumFractionDigits: 1, minimumFractionDigits: 1 }).format(stats.personasDia),
      String(stats.dias),
    ];
    for (const dk of DAY_KEYS) {
      const dia = sem.days[dk];
      cells.push(dia ? new Intl.NumberFormat("es-ES").format(Math.round(dia.kgPorPersona)) : "-");
    }
    cells.push(new Intl.NumberFormat("es-ES").format(Math.round(stats.kgPersona)));
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

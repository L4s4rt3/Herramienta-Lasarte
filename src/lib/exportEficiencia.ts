import jsPDF from "jspdf";
import { drawExportHeader, drawExportFooter, finalizeExportPageNumbers } from "./exportTheme";
import { formatDate } from "./format";
import {
  añadirHojaTabla,
  crearLibroLasarte,
  descargarLibro,
  FMT_INT,
  FMT_KG,
  FMT_PCT,
  type ColumnaTabla,
} from "./exportKit";
import { lineaExportInfo, pdfTablaDesdeColumnas } from "./pdfKit";
import {
  buildLasarteFilename,
  drawReportCover,
  drawReportInsights,
  drawReportSectionTitle,
  ensureExportLogoLoaded,
  type ReportMeta,
} from "./reportKit";

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

/** Última fecha con datos de la semana (para "Fin semana"); si no hay días, cae al inicio. */
function finSemanaDesdeDias(sem: SemanaData): string {
  const fechas = Object.values(sem.days).map((d) => d.date).sort();
  return fechas.length > 0 ? fechas[fechas.length - 1] : sem.weekStart;
}

// ─── Columnas (RRHH · Informe semanal asistencia/operativo, spec §11) ─────────

const RESUMEN_COLUMNAS: ColumnaTabla[] = [
  { header: "Indicador", key: "indicador", width: 26 },
  { header: "Valor", key: "valor", width: 20, align: "right" },
  { header: "Detalle", key: "detalle", width: 40 },
];

const RESUMEN_SEMANAL_COLUMNAS: ColumnaTabla[] = [
  { header: "Semana", key: "semana", width: 22 },
  { header: "Inicio semana", key: "inicioSemana", width: 14, align: "center" },
  { header: "Fin semana", key: "finSemana", width: 14, align: "center" },
  { header: "Kg total", key: "kgTotal", numFmt: FMT_KG, align: "right", width: 16 },
  { header: "Media personas/día", key: "mediaPersonasDia", numFmt: "0.0", align: "right", width: 17 },
  { header: "Días con datos", key: "diasConDatos", numFmt: FMT_INT, align: "right", width: 14 },
  { header: "Kg/día", key: "kgDia", numFmt: FMT_KG, align: "right", width: 14 },
  ...DAYS.map((dia): ColumnaTabla => ({ header: dia, key: dia, numFmt: FMT_KG, align: "right", width: 11 })),
  { header: "Kg/persona semana", key: "kgPersonaSemana", numFmt: FMT_KG, align: "right", width: 18 },
];

const COMPARATIVA_COLUMNAS: ColumnaTabla[] = [
  { header: "Semana", key: "semana", width: 22 },
  { header: "Kg/persona", key: "kgPersona", numFmt: FMT_KG, align: "right", width: 14 },
  { header: "Kg/persona semana previa", key: "kgPersonaPrevia", numFmt: FMT_KG, align: "right", width: 20 },
  { header: "Diferencia", key: "diferencia", numFmt: FMT_KG, align: "right", width: 14 },
  { header: "Diferencia %", key: "diferenciaPct", numFmt: FMT_PCT, align: "right", width: 14 },
  { header: "Kg total", key: "kgTotal", numFmt: FMT_KG, align: "right", width: 16 },
  { header: "Dif kg total", key: "difKgTotal", numFmt: FMT_KG, align: "right", width: 16 },
  { header: "Personas/día", key: "personasDia", numFmt: "0.0", align: "right", width: 12 },
  { header: "Días con datos", key: "diasConDatos", numFmt: FMT_INT, align: "right", width: 14 },
];

const DETALLE_DIARIO_COLUMNAS: ColumnaTabla[] = [
  { header: "Semana", key: "semana", width: 22 },
  { header: "Inicio semana", key: "inicioSemana", width: 14, align: "center" },
  { header: "Día", key: "dia", width: 10, align: "center" },
  { header: "Fecha", key: "fecha", width: 13, align: "center" },
  { header: "Kg producidos", key: "kgProducidos", numFmt: FMT_KG, align: "right", width: 16 },
  { header: "Personas", key: "personas", numFmt: FMT_INT, align: "right", width: 12 },
  { header: "Kg/persona", key: "kgPersona", numFmt: FMT_KG, align: "right", width: 14 },
];

/**
 * Filas de la hoja/tabla "Resumen semanal": fuente ÚNICA compartida por
 * Excel (`añadirHojaTabla` + RESUMEN_SEMANAL_COLUMNAS) y PDF
 * (`pdfTablaDesdeColumnas` + las MISMAS RESUMEN_SEMANAL_COLUMNAS) — antes el
 * PDF recalculaba estos mismos números con su propio `head`/`body` manual
 * (Intl.NumberFormat suelto, cabeceras abreviadas distintas de las del
 * Excel: "Media pers/dia" vs "Media personas/día"), con riesgo real de que
 * ambos exports mostrasen cifras o cabeceras ligeramente distintas para el
 * mismo periodo.
 */
function buildResumenSemanalRows(data: SemanaData[]): Record<string, ExportCell>[] {
  return data.map((sem) => {
    const stats = weekStats(sem);
    const row: Record<string, ExportCell> = {
      semana: `Semana del ${sem.label}`,
      inicioSemana: formatDate(sem.weekStart),
      finSemana: formatDate(finSemanaDesdeDias(sem)),
      kgTotal: Math.round(stats.kg),
      mediaPersonasDia: +stats.personasDia.toFixed(1),
      diasConDatos: stats.dias,
      kgDia: Math.round(stats.kgDia),
      kgPersonaSemana: Math.round(stats.kgPersona),
    };
    for (let i = 0; i < DAY_KEYS.length; i++) {
      const dia = sem.days[DAY_KEYS[i]];
      row[DAYS[i]] = dia ? Math.round(dia.kgPorPersona) : "";
    }
    return row;
  });
}

export async function exportEficienciaToExcel(data: SemanaData[], _optimo: string) {
  const resumenSemanalRows = buildResumenSemanalRows(data);

  const detalleRows = data.flatMap((sem) =>
    DAY_KEYS.map((key, i) => {
      const dia = sem.days[key];
      if (!dia) return null;
      return {
        semana: `Semana del ${sem.label}`,
        inicioSemana: formatDate(sem.weekStart),
        dia: DAYS[i],
        fecha: formatDate(dia.date),
        kgProducidos: Math.round(dia.kg),
        personas: dia.workers,
        kgPersona: Math.round(dia.kgPorPersona),
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
  const periodLabel = `${data.length} semana(s) · ${allDias.length} dia(s) con datos`;

  const resumenRows: Record<string, ExportCell>[] = [
    {
      indicador: "Kg producidos",
      valor: `${Math.round(totalKg).toLocaleString("es-ES")} kg`,
      detalle: periodLabel,
    },
    {
      indicador: "Media personas/día",
      valor: mediaPersonasDia.toLocaleString("es-ES", { maximumFractionDigits: 1, minimumFractionDigits: 1 }),
      detalle: "Asistencia media diaria del periodo",
    },
    {
      indicador: "Kg/persona global",
      valor: `${Math.round(kgPersonaGlobal).toLocaleString("es-ES")} kg`,
      detalle: "Media global del periodo",
    },
    {
      indicador: "Mejor día",
      valor: bestDay ? `${Math.round(bestDay.kgPorPersona).toLocaleString("es-ES")} kg` : "Sin datos suficientes",
      detalle: bestDay?.date ?? "",
    },
  ];

  const ctx = crearLibroLasarte({
    titulo: "Informe semanal operativo",
    periodo: periodLabel,
    clasificacion: "RRHH",
  });

  añadirHojaTabla(ctx, {
    nombreHoja: "Resumen",
    columnas: RESUMEN_COLUMNAS,
    filas: resumenRows,
    freeze: false,
    autofilter: false,
  });
  añadirHojaTabla(ctx, { nombreHoja: "Resumen semanal", columnas: RESUMEN_SEMANAL_COLUMNAS, filas: resumenSemanalRows });
  añadirHojaTabla(ctx, { nombreHoja: "Comparativa", columnas: COMPARATIVA_COLUMNAS, filas: comparativaRowsOf(data) });
  añadirHojaTabla(ctx, { nombreHoja: "Detalle diario", columnas: DETALLE_DIARIO_COLUMNAS, filas: detalleRows });

  await descargarLibro(ctx, buildLasarteFilename("Eficiencia", "xlsx", eficienciaDateRange(data)));
}

function comparativaRowsOf(data: SemanaData[]): Record<string, ExportCell>[] {
  return data.map((sem, index) => {
    const current = weekStats(sem);
    const prev = index > 0 ? weekStats(data[index - 1]) : null;
    return {
      semana: `Semana del ${sem.label}`,
      kgPersona: Math.round(current.kgPersona),
      kgPersonaPrevia: prev ? Math.round(prev.kgPersona) : "",
      diferencia: prev ? Math.round(current.kgPersona - prev.kgPersona) : "",
      diferenciaPct: prev && prev.kgPersona > 0 ? +(((current.kgPersona - prev.kgPersona) / prev.kgPersona) * 100).toFixed(2) : "",
      kgTotal: Math.round(current.kg),
      difKgTotal: prev ? Math.round(current.kg - prev.kg) : "",
      personasDia: +current.personasDia.toFixed(1),
      diasConDatos: current.dias,
    };
  });
}

function eficienciaDateRange(data: SemanaData[]): { from?: string; to?: string } {
  const dates = data.flatMap((sem) => Object.values(sem.days).map((d) => d.date));
  if (dates.length === 0) return {};
  dates.sort();
  return { from: dates[0], to: dates[dates.length - 1] };
}

function drawHeader(doc: jsPDF, pageIndex: number) {
  drawExportHeader(doc, pageIndex, "Comparativa semanal", "Kg/persona por dia");
}

// Identificador de exportación del documento en curso (mismo id en el pie de
// todas las páginas, paridad con el pie del Excel). Se fija en exportEficienciaToPDF.
let currentExportInfo: string | undefined;

function drawFooter(doc: jsPDF) {
  drawExportFooter(doc, { clasificacion: "RRHH", exportInfo: currentExportInfo });
}

export async function exportEficienciaToPDF(data: SemanaData[], _optimo: string) {
  await ensureExportLogoLoaded();
  currentExportInfo = lineaExportInfo();
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  let pageIndex = 0;

  pageIndex++;
  const allDias = data.flatMap((sem) => Object.values(sem.days));
  const totalKg = allDias.reduce((s, d) => s + d.kg, 0);
  const totalWorkers = allDias.reduce((s, d) => s + d.workers, 0);
  const mediaPersonasDia = allDias.length > 0 ? totalWorkers / allDias.length : 0;
  const mediaKgDia = allDias.length > 0 ? totalKg / allDias.length : 0;
  const globalEfic = Math.round(kgPersonaDesdeMedias(mediaKgDia, mediaPersonasDia));
  const bestDay = allDias.reduce<DiaData | null>((best, d) => (!best || d.kgPorPersona > best.kgPorPersona ? d : best), null);
  const reportMeta: ReportMeta = {
    title: "Informe semanal operativo",
    subtitle: "Produccion y asistencia",
    periodLabel: `${data.length} semana(s) · ${allDias.length} dia(s) con datos`,
  };

  let y = drawReportCover(doc, reportMeta, [
    { label: "TOTAL KG", value: `${totalKg.toLocaleString("es-ES")} kg`, sub: `${allDias.length} dia(s)`, tone: "info" },
    { label: "ASISTENCIA MEDIA", value: mediaPersonasDia.toLocaleString("es-ES", { maximumFractionDigits: 1, minimumFractionDigits: 1 }), sub: "personas/dia" },
    { label: "KG/PERSONA GLOBAL", value: globalEfic.toLocaleString("es-ES"), sub: "media global", tone: "success" },
    { label: "SEMANAS", value: data.length, sub: "en periodo" },
    { label: "DIAS CON DATOS", value: allDias.length, sub: "de 7 posibles/sem" },
  ]);

  y = drawReportInsights(doc, [
    { label: "Mejor dia", value: bestDay ? `${bestDay.date} · ${Math.round(bestDay.kgPorPersona).toLocaleString("es-ES")} kg/persona` : "Sin datos suficientes", tone: "success" },
    { label: "Lectura", value: "Kg/persona semanal calculado desde kg medio/dia dividido entre media personas/dia.", tone: "info" },
  ], 8, y, 281) + 4;

  y = drawReportSectionTitle(doc, "Detalle semanal", y, "Kg/persona por dia y resumen de asistencia media");

  // Misma ColumnaTabla[] (RESUMEN_SEMANAL_COLUMNAS) y las mismas filas
  // (buildResumenSemanalRows) que usa la hoja "Resumen semanal" del Excel:
  // cabeceras, alineación y formato numérico es-ES quedan garantizados
  // idénticos entre PDF y Excel para esta tabla (antes: cabeceras
  // abreviadas distintas y formateo manual con Intl.NumberFormat suelto).
  pdfTablaDesdeColumnas(doc, {
    columnas: RESUMEN_SEMANAL_COLUMNAS,
    filas: buildResumenSemanalRows(data),
    startY: y,
    columnStyles: { 0: { cellWidth: 42 } },
    didDrawPage: () => {
      const pages = doc.getNumberOfPages();
      if (pages > pageIndex) {
        pageIndex++;
        drawHeader(doc, pageIndex);
        drawFooter(doc);
      }
    },
  });

  drawFooter(doc);
  finalizeExportPageNumbers(doc);
  doc.save(buildLasarteFilename("Eficiencia", "pdf", eficienciaDateRange(data)));
}

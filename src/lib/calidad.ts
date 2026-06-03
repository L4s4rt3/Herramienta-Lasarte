import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { appendAoaSheet, appendDictionarySheet, appendRowsSheet, createWorkbook, saveWorkbook } from "@/lib/exportWorkbook";
import { PDF_THEME, drawExportFooter, drawExportHeader, drawKpiCard, pdfTableTheme } from "@/lib/exportTheme";
import { formatDate } from "@/lib/format";

export const CALIDAD_OPTIONS = ["Bueno", "Regular", "Deficiente", "Rechazado"] as const;
export type CalidadEstado = typeof CALIDAD_OPTIONS[number];

export interface CalidadJornada {
  id: string;
  fecha: string;
  responsable: string;
  estado: "borrador" | "guardada" | "revisada";
  created_at?: string;
  updated_at?: string;
}

export interface CalidadProductor {
  id: string;
  nombre: string;
  created_at?: string;
  updated_at?: string;
}

export interface CalidadLote {
  id: string;
  jornada_id: string;
  fecha: string;
  numero_lote: string;
  productor_finca_id: string | null;
  productor_finca_nombre: string;
  producto: string;
  variedad: string;
  cantidad: string;
  hora: string | null;
  aerobotics_realizado: boolean;
  calidad: CalidadEstado;
  defectos: string[];
  observacion: string;
  accion_recomendada: string;
  created_at?: string;
  updated_at?: string;
}

export interface CalidadAdjunto {
  id: string;
  lote_id: string;
  file_name: string;
  file_path: string;
  mime_type: string | null;
  file_size: number | null;
  created_at?: string;
  signedUrl?: string;
}

export interface CalidadSummary {
  total: number;
  aerobotics: number;
  fotos: number;
  byQuality: Record<CalidadEstado, number>;
}

export function formatCalidadDate(value: string | Date) {
  return formatDate(value);
}

export function normalizeCalidadName(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

export function sameCalidadName(a: string, b: string) {
  return normalizeCalidadName(a).localeCompare(normalizeCalidadName(b), "es", { sensitivity: "accent" }) === 0;
}

export function calidadSummary(lotes: CalidadLote[], attachmentCounts: Record<string, number> = {}): CalidadSummary {
  const byQuality = Object.fromEntries(CALIDAD_OPTIONS.map((quality) => [quality, 0])) as Record<CalidadEstado, number>;
  for (const lote of lotes) {
    byQuality[lote.calidad] += 1;
  }

  return {
    total: lotes.length,
    aerobotics: lotes.filter((lote) => lote.aerobotics_realizado).length,
    fotos: Object.values(attachmentCounts).reduce((total, count) => total + count, 0),
    byQuality,
  };
}

export function attachmentCountMap(adjuntos: CalidadAdjunto[]) {
  return adjuntos.reduce<Record<string, number>>((acc, adjunto) => {
    acc[adjunto.lote_id] = (acc[adjunto.lote_id] ?? 0) + 1;
    return acc;
  }, {});
}

export function buildCalidadExcelRows(lotes: CalidadLote[], attachmentCounts: Record<string, number> = {}) {
  return lotes.map((lote) => ({
    Fecha: formatCalidadDate(lote.fecha),
    Lote: lote.numero_lote,
    "Productor/Finca": lote.productor_finca_nombre,
    Producto: lote.producto,
    Variedad: lote.variedad,
    Cantidad: lote.cantidad,
    Hora: lote.hora ?? "",
    "Aerobotics realizado": lote.aerobotics_realizado ? "Si" : "No",
    Calidad: lote.calidad,
    Defectos: lote.defectos.join(", "),
    Observacion: lote.observacion,
    "Accion recomendada": lote.accion_recomendada,
    Fotos: attachmentCounts[lote.id] ?? 0,
  }));
}

function safePdf(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7E]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function exportCalidadToExcel(jornada: CalidadJornada, lotes: CalidadLote[], adjuntos: CalidadAdjunto[]) {
  const counts = attachmentCountMap(adjuntos);
  const summary = calidadSummary(lotes, counts);
  const wb = createWorkbook("Lasarte SAT - Jornada de Calidad", "Notas de lotes y control de calidad");

  appendAoaSheet(
    wb,
    "Resumen",
    [
      ["Lasarte SAT - Jornada de Calidad"],
      [`Fecha: ${formatCalidadDate(jornada.fecha)}`],
      [`Responsable: ${jornada.responsable || "-"}`],
      [`Generado: ${new Date().toLocaleString("es-ES")}`],
      [],
      ["Indicador", "Valor"],
      ["Lotes anotados", summary.total],
      ["Aerobotics realizados", summary.aerobotics],
      ["Fotos adjuntas", summary.fotos],
      ["Bueno", summary.byQuality.Bueno],
      ["Regular", summary.byQuality.Regular],
      ["Deficiente", summary.byQuality.Deficiente],
      ["Rechazado", summary.byQuality.Rechazado],
    ],
    [32, 42],
  );

  appendRowsSheet(wb, "Lotes", buildCalidadExcelRows(lotes, counts), [14, 16, 26, 18, 22, 16, 12, 20, 14, 34, 56, 48, 10], {
    freezeHeader: true,
  });

  appendRowsSheet(
    wb,
    "Adjuntos",
    adjuntos.map((adjunto) => {
      const lote = lotes.find((item) => item.id === adjunto.lote_id);
      return {
        Fecha: lote ? formatCalidadDate(lote.fecha) : formatCalidadDate(jornada.fecha),
        Lote: lote?.numero_lote ?? "",
        "Productor/Finca": lote?.productor_finca_nombre ?? "",
        Archivo: adjunto.file_name,
        Tipo: adjunto.mime_type ?? "",
        "Ruta storage": adjunto.file_path,
      };
    }),
    [14, 16, 26, 36, 22, 80],
    { freezeHeader: true },
  );

  appendDictionarySheet(wb, [
    { Hoja: "Resumen", Campo: "Indicador", Descripcion: "Lectura rapida del dia de calidad.", Uso: "Informe diario." },
    { Hoja: "Lotes", Campo: "Una fila por lote", Descripcion: "Datos separados por columnas para filtrar y cruzar.", Uso: "Trabajo en Excel." },
    { Hoja: "Adjuntos", Campo: "Ruta storage", Descripcion: "Referencia de fotos y documentos guardados.", Uso: "Trazabilidad." },
  ]);

  saveWorkbook(wb, `calidad_${jornada.fecha}.xlsx`);
}

export function exportCalidadToPDF(jornada: CalidadJornada, lotes: CalidadLote[], adjuntos: CalidadAdjunto[]) {
  const counts = attachmentCountMap(adjuntos);
  const summary = calidadSummary(lotes, counts);
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const title = `Jornada de Calidad - ${safePdf(formatCalidadDate(jornada.fecha))}`;

  drawExportHeader(doc, 1, "Calidad", title);
  doc.setFillColor(...PDF_THEME.cream);
  doc.roundedRect(8, 26, 281, 16, 2, 2, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.setTextColor(...PDF_THEME.primaryDark);
  doc.text(title, 148.5, 35, { align: "center" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...PDF_THEME.muted);
  doc.text(safePdf(`Responsable: ${jornada.responsable || "-"} - ${summary.total} lote(s)`), 148.5, 40, { align: "center" });

  [
    { label: "LOTES", val: String(summary.total), sub: "anotados" },
    { label: "AEROBOTICS", val: String(summary.aerobotics), sub: "realizados" },
    { label: "BUENO", val: String(summary.byQuality.Bueno), sub: "sin incidencia" },
    { label: "REVISAR", val: String(summary.byQuality.Regular + summary.byQuality.Deficiente), sub: "regular/deficiente" },
    { label: "FOTOS", val: String(summary.fotos), sub: "adjuntas" },
  ].forEach((card, index) => drawKpiCard(doc, 8 + index * 57, 48, 55, card.label, card.val, card.sub));

  autoTable(doc, {
    startY: 76,
    head: [["Lote", "Productor/Finca", "Producto", "Variedad", "Cantidad", "Hora", "Aerobotics", "Calidad", "Defectos", "Observacion", "Accion", "Fotos"]],
    body: lotes.map((lote) => [
      safePdf(lote.numero_lote),
      safePdf(lote.productor_finca_nombre),
      safePdf(lote.producto),
      safePdf(lote.variedad),
      safePdf(lote.cantidad),
      safePdf(lote.hora ?? ""),
      lote.aerobotics_realizado ? "Si" : "No",
      safePdf(lote.calidad),
      safePdf(lote.defectos.join(", ")),
      safePdf(lote.observacion),
      safePdf(lote.accion_recomendada),
      String(counts[lote.id] ?? 0),
    ]),
    margin: { top: 30, bottom: 18, left: 8, right: 8 },
    ...pdfTableTheme(),
    styles: { ...pdfTableTheme().styles, fontSize: 6.2, cellPadding: 1.7 },
    headStyles: { ...pdfTableTheme().headStyles, fontSize: 5.8 },
    columnStyles: {
      0: { cellWidth: 18 },
      1: { cellWidth: 34 },
      8: { cellWidth: 32 },
      9: { cellWidth: 54 },
      10: { cellWidth: 42 },
    },
    didDrawPage: () => {
      const page = doc.getNumberOfPages();
      drawExportHeader(doc, page, "Calidad", title);
      drawExportFooter(doc);
    },
  });

  drawExportFooter(doc);
  doc.save(`calidad_${jornada.fecha}.pdf`);
}

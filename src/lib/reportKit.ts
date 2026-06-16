import type jsPDF from "jspdf";
import type * as XLSX from "xlsx";
import { appendAoaSheet } from "./exportWorkbook";
import { drawKpiCard, PDF_THEME } from "./exportTheme";

export type ReportTone = "neutral" | "success" | "warning" | "danger" | "info";

export interface ReportMeta {
  title: string;
  subtitle?: string;
  periodLabel?: string;
  generatedAt?: Date;
}

export interface ReportKpi {
  label: string;
  value: string | number;
  sub?: string;
  tone?: ReportTone;
}

export interface ReportInsight {
  label: string;
  value: string;
  tone?: ReportTone;
}

export const REPORT_BRAND = {
  name: "LASARTE SAT",
  tool: "Herramienta de control operativo",
};

export function formatReportDate(date = new Date()) {
  return date.toLocaleString("es-ES", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function buildReportFilename(prefix: string, extension: "pdf" | "xlsx", date = new Date()) {
  const stamp = date.toISOString().slice(0, 10);
  const safePrefix = prefix
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  return `${safePrefix}-${stamp}.${extension}`;
}

export function reportToneColor(tone: ReportTone = "neutral") {
  if (tone === "success") return PDF_THEME.success;
  if (tone === "warning") return PDF_THEME.warning;
  if (tone === "danger") return PDF_THEME.destructive;
  if (tone === "info") return PDF_THEME.info;
  return PDF_THEME.primaryDark;
}

export function buildReportCoverRows(meta: ReportMeta, kpis: ReportKpi[] = []) {
  const generatedAt = meta.generatedAt ?? new Date();
  const rows: (string | number | boolean | null)[][] = [
    [REPORT_BRAND.name],
    [meta.title],
    [meta.subtitle ?? ""],
    [meta.periodLabel ?? ""],
    [`Generado: ${formatReportDate(generatedAt)}`],
    [],
    ["Indicador", "Valor", "Detalle"],
  ];

  for (const kpi of kpis) {
    rows.push([kpi.label, String(kpi.value), kpi.sub ?? ""]);
  }

  return rows;
}

export function appendReportCoverSheet(wb: XLSX.WorkBook, meta: ReportMeta, kpis: ReportKpi[]) {
  const ws = appendAoaSheet(wb, "Portada", buildReportCoverRows(meta, kpis), [34, 28, 42]);
  ws["!freeze"] = { xSplit: 0, ySplit: 7 };
  return ws;
}

export function drawReportCover(doc: jsPDF, meta: ReportMeta, kpis: ReportKpi[] = []) {
  const pageWidth = doc.internal.pageSize.getWidth();

  doc.setFillColor(...PDF_THEME.cream);
  doc.rect(0, 0, pageWidth, 54, "F");
  doc.setFillColor(...PDF_THEME.primary);
  doc.rect(0, 0, pageWidth, 4, "F");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(...PDF_THEME.primaryDark);
  doc.text(REPORT_BRAND.name, 12, 16);

  doc.setFontSize(19);
  doc.setTextColor(...PDF_THEME.text);
  doc.text(meta.title, 12, 29);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...PDF_THEME.muted);
  if (meta.subtitle) doc.text(meta.subtitle, 12, 38);
  if (meta.periodLabel) doc.text(meta.periodLabel, 12, 45);
  doc.text(`Generado: ${formatReportDate(meta.generatedAt ?? new Date())}`, pageWidth - 12, 16, { align: "right" });

  const usableWidth = pageWidth - 24;
  const columns = Math.min(Math.max(kpis.length, 1), 5);
  const gap = 3;
  const cardW = (usableWidth - gap * (columns - 1)) / columns;
  let y = 62;

  kpis.slice(0, 10).forEach((kpi, index) => {
    const col = index % columns;
    const row = Math.floor(index / columns);
    const x = 12 + col * (cardW + gap);
    const cardY = y + row * 24;
    drawKpiCard(doc, x, cardY, cardW, kpi.label, String(kpi.value), kpi.sub);

    const color = reportToneColor(kpi.tone);
    doc.setFillColor(...color);
    doc.roundedRect(x, cardY, cardW, 2.6, 1, 1, "F");
  });

  y += Math.ceil(Math.min(kpis.length, 10) / columns) * 24 + 8;
  return y;
}

export function drawReportSectionTitle(doc: jsPDF, title: string, y: number, subtitle?: string) {
  const pageWidth = doc.internal.pageSize.getWidth();
  doc.setDrawColor(...PDF_THEME.border);
  doc.line(12, y, pageWidth - 12, y);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(...PDF_THEME.primaryDark);
  doc.text(title, 12, y + 7);
  if (subtitle) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...PDF_THEME.muted);
    doc.text(subtitle, 12, y + 12);
    return y + 16;
  }
  return y + 11;
}

export function drawReportInsights(doc: jsPDF, insights: ReportInsight[], x: number, y: number, width: number) {
  if (insights.length === 0) return y;

  doc.setFillColor(...PDF_THEME.white);
  doc.setDrawColor(...PDF_THEME.border);
  doc.roundedRect(x, y, width, 8 + insights.length * 7, 2, 2, "FD");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(...PDF_THEME.primaryDark);
  doc.text("Lectura rapida", x + 4, y + 6);

  insights.forEach((insight, index) => {
    const itemY = y + 13 + index * 7;
    doc.setFillColor(...reportToneColor(insight.tone));
    doc.circle(x + 5, itemY - 1.4, 1.2, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    doc.setTextColor(...PDF_THEME.text);
    doc.text(`${insight.label}:`, x + 9, itemY);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...PDF_THEME.muted);
    doc.text(insight.value, x + 36, itemY, { maxWidth: width - 40 });
  });

  return y + 10 + insights.length * 7;
}

import type jsPDF from "jspdf";

export const PDF_THEME = {
  primary: [242, 107, 33] as [number, number, number],
  primaryDark: [124, 68, 33] as [number, number, number],
  forest: [32, 80, 57] as [number, number, number],
  cream: [252, 248, 238] as [number, number, number],
  creamStrong: [246, 235, 214] as [number, number, number],
  white: [255, 255, 255] as [number, number, number],
  text: [38, 47, 38] as [number, number, number],
  muted: [106, 111, 98] as [number, number, number],
  border: [224, 205, 171] as [number, number, number],
  success: [46, 139, 87] as [number, number, number],
  warning: [201, 135, 22] as [number, number, number],
  destructive: [188, 60, 55] as [number, number, number],
  info: [45, 128, 170] as [number, number, number],
};

export function drawExportHeader(doc: jsPDF, pageIndex: number, title: string, subtitle?: string) {
  const pageWidth = doc.internal.pageSize.getWidth();
  doc.setFillColor(...PDF_THEME.cream);
  doc.rect(0, 0, pageWidth, 22, "F");
  doc.setFillColor(...PDF_THEME.primary);
  doc.rect(0, 0, pageWidth, 3, "F");
  doc.setDrawColor(...PDF_THEME.border);
  doc.line(8, 22, pageWidth - 8, 22);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(...PDF_THEME.primaryDark);
  doc.text("Lasarte SAT", 8, 10);

  doc.setFontSize(8);
  doc.setTextColor(...PDF_THEME.text);
  doc.text(title, 8, 16);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(...PDF_THEME.muted);
  if (subtitle) doc.text(subtitle, pageWidth / 2, 16, { align: "center" });
  doc.text(`Pag. ${pageIndex}`, pageWidth - 8, 10, { align: "right" });
  doc.text(new Date().toLocaleDateString("es-ES"), pageWidth - 8, 16, { align: "right" });
}

export function drawExportFooter(doc: jsPDF) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  doc.setDrawColor(...PDF_THEME.border);
  doc.line(8, pageHeight - 12, pageWidth - 8, pageHeight - 12);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(6);
  doc.setTextColor(...PDF_THEME.muted);
  doc.text("Herramienta de control de produccion Lasarte SAT", pageWidth / 2, pageHeight - 7, { align: "center" });
}

export function pdfTableTheme() {
  return {
    styles: {
      fontSize: 8,
      cellPadding: 3,
      textColor: PDF_THEME.text,
      lineColor: PDF_THEME.border,
      lineWidth: 0.1,
    },
    headStyles: {
      fillColor: PDF_THEME.primaryDark,
      textColor: PDF_THEME.white,
      fontStyle: "bold" as const,
      fontSize: 7.5,
    },
    alternateRowStyles: {
      fillColor: PDF_THEME.cream,
    },
  };
}

export function drawKpiCard(doc: jsPDF, x: number, y: number, w: number, label: string, value: string, sub?: string) {
  doc.setFillColor(...PDF_THEME.white);
  doc.setDrawColor(...PDF_THEME.border);
  doc.setLineWidth(0.25);
  doc.roundedRect(x, y, w, 20, 2, 2, "FD");
  doc.setFillColor(...PDF_THEME.primary);
  doc.roundedRect(x, y, w, 2.6, 1, 1, "F");

  doc.setFont("helvetica", "normal");
  doc.setFontSize(6);
  doc.setTextColor(...PDF_THEME.muted);
  doc.text(label, x + w / 2, y + 7, { align: "center" });
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(...PDF_THEME.primaryDark);
  doc.text(value, x + w / 2, y + 14, { align: "center" });
  if (sub) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6);
    doc.setTextColor(...PDF_THEME.muted);
    doc.text(sub, x + w / 2, y + 18, { align: "center" });
  }
}

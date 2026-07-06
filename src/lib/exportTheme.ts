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

export const EXPORT_FOOTER_TEXT = "Lasarte SAT · Herramienta de control operativo";

const LASARTE_LOGO_PATH = "/branding/lasarte-sat-logo.jpeg";
// Relacion de aspecto real del logo (aprox. 1200x233 px en el jpeg fuente).
const LASARTE_LOGO_ASPECT = 1200 / 233;

let logoDataUrlPromise: Promise<string | null> | null = null;

// Carga el logo corporativo UNA sola vez por sesion de módulo y lo cachea como
// dataURL para poder llamarlo de forma sincrona (jsPDF.addImage no es async)
// en cada pagina/portada. Si falla (offline, entorno sin fetch, etc.) se
// devuelve null y quien llama debe hacer fallback silencioso a texto.
export function preloadExportLogo(): Promise<string | null> {
  if (!logoDataUrlPromise) {
    logoDataUrlPromise = (async () => {
      if (typeof fetch !== "function") return null;
      try {
        const response = await fetch(LASARTE_LOGO_PATH);
        if (!response.ok) return null;
        const blob = await response.blob();
        return await new Promise<string | null>((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : null);
          reader.onerror = () => resolve(null);
          reader.readAsDataURL(blob);
        });
      } catch {
        return null;
      }
    })();
  }
  return logoDataUrlPromise;
}

function getCachedLogoDataUrl(): string | null {
  // Si ya se resolvio la promesa antes (p.ej. tras preloadExportLogo en el
  // arranque del export), esto devuelve el valor sin esperar. Si no se ha
  // llamado a preloadExportLogo, no bloqueamos el dibujo sincrono del PDF:
  // se dispara la carga en background para la proxima pagina y se hace
  // fallback a texto en esta.
  let cached: string | null = null;
  preloadExportLogo().then((url) => {
    cached = url;
  });
  return cached;
}

/**
 * Dibuja el logo Lasarte SAT anclado por su esquina superior-izquierda
 * (x, yTop) si ya esta cacheado, y devuelve el ancho ocupado en mm. Si el
 * logo aun no esta disponible (no se ha precargado o fallo la carga), dibuja
 * el texto "Lasarte SAT" como fallback silencioso y devuelve 0 (no reserva
 * hueco, el llamante decide donde colocar el resto de textos).
 */
export function drawLogoOrFallback(
  doc: jsPDF,
  x: number,
  yTop: number,
  height: number,
  fallback: { x: number; yBaseline: number; fontSize: number; color?: [number, number, number] },
): number {
  const dataUrl = getCachedLogoDataUrl();
  if (dataUrl) {
    try {
      const width = height * LASARTE_LOGO_ASPECT;
      doc.addImage(dataUrl, "JPEG", x, yTop, width, height);
      return width;
    } catch {
      // sigue al fallback de texto
    }
  }
  doc.setFont("helvetica", "bold");
  doc.setFontSize(fallback.fontSize);
  doc.setTextColor(...(fallback.color ?? PDF_THEME.primaryDark));
  doc.text("Lasarte SAT", fallback.x, fallback.yBaseline);
  return 0;
}

export function drawExportHeader(doc: jsPDF, pageIndex: number, title: string, subtitle?: string) {
  const pageWidth = doc.internal.pageSize.getWidth();
  doc.setFillColor(...PDF_THEME.cream);
  doc.rect(0, 0, pageWidth, 22, "F");
  doc.setFillColor(...PDF_THEME.primary);
  doc.rect(0, 0, pageWidth, 3, "F");
  doc.setDrawColor(...PDF_THEME.border);
  doc.line(8, 22, pageWidth - 8, 22);

  drawLogoOrFallback(doc, 8, 5, 6, { x: 8, yBaseline: 10, fontSize: 10 });

  doc.setFont("helvetica", "normal");
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
  doc.text(EXPORT_FOOTER_TEXT, pageWidth / 2, pageHeight - 7, { align: "center" });
}

/**
 * Recorre TODAS las paginas del documento ya generado y añade/actualiza la
 * numeracion "Pagina X de Y" en la esquina inferior derecha, encima del pie
 * ya dibujado por drawExportFooter. Debe llamarse una unica vez, al final de
 * cada export, cuando ya se conoce el numero total de paginas.
 */
export function finalizeExportPageNumbers(doc: jsPDF) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const total = doc.getNumberOfPages();
  for (let i = 1; i <= total; i += 1) {
    doc.setPage(i);
    doc.setFillColor(...PDF_THEME.cream);
    doc.rect(pageWidth - 34, pageHeight - 11.5, 26, 4.5, "F");
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6);
    doc.setTextColor(...PDF_THEME.muted);
    doc.text(`Pagina ${i} de ${total}`, pageWidth - 8, pageHeight - 8, { align: "right" });
  }
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

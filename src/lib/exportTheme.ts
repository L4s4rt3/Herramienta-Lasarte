import type jsPDF from "jspdf";

// Paleta alineada al sistema de diseño común LASARTE (docs/EXPORT_TEMPLATES_SPEC.md
// §0.1). Se mantienen las MISMAS claves que antes (primary, primaryDark, forest,
// cream, creamStrong, ...) para no romper a quien ya las usa (calidad.ts, cmrPdf.ts,
// exportPartes.ts, exportConsumo.ts, exportEficiencia.ts, reportKit.ts) — solo
// cambia el valor hex hacia el de la especificación, eligiendo el más afín al rol
// que esa clave ya cumplía:
//  - primary      -> Naranja acento  #F28C00 (avisos, KPIs destacados, variaciones;
//                     ya se usaba como tono cálido de acento/aviso)
//  - primaryDark  -> Azul principal  #253A70 (cabeceras, tablas, títulos destacados)
//  - forest       -> Azul principal  #253A70 (banda de cabecera de módulos con
//                     banda propia, p.ej. Calidad; unifica con el resto en azul)
//  - cream        -> Gris fondo      #F7F8FA (filas alternas / zonas de lectura)
//  - creamStrong  -> Azul claro fondo#EEF3FA (cajas de metadatos / resaltados)
//  - success      -> Verde acento    #97C428 (indicadores positivos, separadores,
//                     acentos — incluida la línea verde de la cabecera común)
//  - destructive  -> Rojo alerta     #B42318 (incidencias, faltas, bloqueos)
//  - warning/info -> se mantienen (no cubiertos por la paleta de marca del spec;
//                     son tonos semánticos de estado, no de identidad corporativa)
export const PDF_THEME = {
  primary: [242, 140, 0] as [number, number, number],
  primaryDark: [37, 58, 112] as [number, number, number],
  forest: [37, 58, 112] as [number, number, number],
  cream: [247, 248, 250] as [number, number, number],
  creamStrong: [238, 243, 250] as [number, number, number],
  white: [255, 255, 255] as [number, number, number],
  text: [46, 46, 46] as [number, number, number],
  muted: [107, 114, 128] as [number, number, number],
  border: [217, 222, 232] as [number, number, number],
  success: [151, 196, 40] as [number, number, number],
  warning: [201, 135, 22] as [number, number, number],
  destructive: [180, 35, 24] as [number, number, number],
  info: [45, 128, 170] as [number, number, number],
};

export const EXPORT_FOOTER_TEXT = "Lasarte Cítricos S.L. · CIF B14800304";

// Clasificación del documento (spec §0.4/Campos técnicos). Textos legales por
// clasificación — mismos que usa el motor Excel (src/lib/exportKit.ts); se
// duplican aquí (en vez de importar) para no acoplar el módulo de tema PDF al
// motor de Excel, que vive en una capa distinta.
export type ExportClasificacion = "Interno" | "Confidencial" | "Dirección" | "RRHH";

export const CLASIFICACION_TEXTO_PDF: Record<ExportClasificacion, string> = {
  Interno: "Documento de uso interno de Lasarte Cítricos S.L.",
  Confidencial: "Documento confidencial. Uso restringido a personal autorizado.",
  Dirección: "Documento interno de dirección. No distribuir sin autorización.",
  RRHH: "Documento confidencial. Contiene datos personales. Uso limitado a personal autorizado conforme RGPD/LOPDGDD.",
};

// Nota sobre formatos numéricos españoles: exportTheme.ts es solo el tema visual
// (colores/cabecera/pie); el formateo de números para las tablas PDF ya vive en
// src/lib/format.ts (formatKg/formatPct/formatNumber, locale "es-ES"), consistente
// con las constantes FMT_* del motor Excel en src/lib/exportKit.ts.

const LASARTE_LOGO_PATH = "/branding/lasarte-logo-horizontal.jpg";
// Relacion de aspecto real del logo horizontal nuevo (900x357 px en el jpg fuente).
const LASARTE_LOGO_ASPECT = 900 / 357;

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
  const marca = "Lasarte Cítricos S.L.";
  doc.text(marca, fallback.x, fallback.yBaseline);
  // Devuelve el ancho real del texto de marca para que el llamante desplace el
  // título y NO se solape con la marca cuando no hay logo.
  return doc.getTextWidth(marca);
}

export function drawExportHeader(doc: jsPDF, pageIndex: number, title: string, subtitle?: string) {
  const pageWidth = doc.internal.pageSize.getWidth();
  // Cabecera común (spec §0.3): fondo blanco + banda azul 3-5 mm + línea verde
  // fina 1 mm (antes: fondo color crema + una única banda naranja de 3 mm).
  doc.setFillColor(...PDF_THEME.white);
  doc.rect(0, 0, pageWidth, 22, "F");
  doc.setFillColor(...PDF_THEME.primaryDark);
  doc.rect(0, 0, pageWidth, 4, "F");
  doc.setFillColor(...PDF_THEME.success);
  doc.rect(0, 4, pageWidth, 1, "F");
  doc.setDrawColor(...PDF_THEME.border);
  doc.line(8, 22, pageWidth - 8, 22);

  const logoWidth = drawLogoOrFallback(doc, 8, 6, 11, { x: 8, yBaseline: 12, fontSize: 9 });
  const titleX = 8 + logoWidth + (logoWidth > 0 ? 4 : 3);

  // Título arriba y subtítulo debajo, ambos alineados a la izquierda tras el
  // logo/marca; la columna derecha (página + fecha) va aparte. Así ningún texto
  // se solapa aunque el título o el subtítulo sean largos (bug anterior: título,
  // subtítulo centrado y fecha compartían la misma línea y=17).
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(...PDF_THEME.primaryDark);
  doc.text(title, titleX, 12);

  if (subtitle) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(...PDF_THEME.muted);
    doc.text(subtitle, titleX, 18);
  }

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(...PDF_THEME.muted);
  doc.text(`Pág. ${pageIndex}`, pageWidth - 8, 11, { align: "right" });
  doc.text(new Date().toLocaleDateString("es-ES"), pageWidth - 8, 16, { align: "right" });
}

/**
 * Pie común (spec §0.4). `clasificacion` es OPCIONAL y retrocompatible: quien ya
 * llama a `drawExportFooter(doc)` sin ese argumento sigue viendo exactamente el
 * mismo pie de siempre; los exports que se migren pueden pasar la clasificación
 * del documento para añadir el texto legal correspondiente (RGPD, dirección, etc.).
 */
export function drawExportFooter(doc: jsPDF, options: { clasificacion?: ExportClasificacion } = {}) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  doc.setDrawColor(...PDF_THEME.border);
  doc.line(8, pageHeight - 12, pageWidth - 8, pageHeight - 12);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(6);
  doc.setTextColor(...PDF_THEME.muted);
  doc.text(EXPORT_FOOTER_TEXT, pageWidth / 2, pageHeight - 7, { align: "center" });
  if (options.clasificacion) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(5.5);
    doc.setTextColor(...PDF_THEME.destructive);
    doc.text(CLASIFICACION_TEXTO_PDF[options.clasificacion], pageWidth / 2, pageHeight - 4, {
      align: "center",
      maxWidth: pageWidth - 16,
    });
  }
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

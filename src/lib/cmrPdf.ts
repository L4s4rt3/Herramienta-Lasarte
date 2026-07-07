// src/lib/cmrPdf.ts
// Generación de PDF para la pestaña "Generar" de CMR y Hojas de ruta.
// Reutiliza el mismo motor (jsPDF + jspdf-autotable) y la misma paleta/logo
// que src/lib/exportPartes.ts, vía exportTheme.ts / reportKit.ts, para que
// estos documentos encajen visualmente con el resto de exports de la app.
//
// generarCmrPdf: layout de carta de porte internacional (CMR) con las
// casillas numeradas habituales del impreso oficial, sin pretender ser una
// réplica exacta (no hace falta), pero sí con todas las casillas relevantes
// bien organizadas en una rejilla con bordes.
//
// generarHojaRutaPdf: documento sencillo de cabecera + tabla de paradas +
// totales + firma.
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { drawExportFooter, drawLogoOrFallback, finalizeExportPageNumbers, PDF_THEME, pdfTableTheme } from "./exportTheme";
import { ensureExportLogoLoaded, formatReportDate } from "./reportKit";
import { formatDate } from "./format";

// jsPDF no soporta acentos/ñ con la fuente helvetica estandar sin incrustar
// una fuente propia: igual que exportPartes.ts, se normaliza el texto a ASCII
// antes de escribirlo para evitar caracteres corruptos en el PDF.
function safePdf(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\x20-\x7E]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const PAGE_W = 210;
const PAGE_H = 297;
const MARGIN = 10;
const CONTENT_W = PAGE_W - MARGIN * 2;

function drawDocHeader(doc: jsPDF, tituloDocumento: string, numero?: string | null) {
  doc.setFillColor(...PDF_THEME.cream);
  doc.rect(0, 0, PAGE_W, 26, "F");
  doc.setFillColor(...PDF_THEME.primary);
  doc.rect(0, 0, PAGE_W, 3, "F");

  const logoWidth = drawLogoOrFallback(doc, MARGIN, 7, 13, { x: MARGIN, yBaseline: 16, fontSize: 12 });
  const textX = logoWidth > 0 ? MARGIN + logoWidth + 5 : MARGIN;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(...PDF_THEME.text);
  doc.text(safePdf(tituloDocumento), textX, 16);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(...PDF_THEME.muted);
  doc.text(`Generado: ${formatReportDate()}`, textX, 21.5);

  if (numero) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(...PDF_THEME.primaryDark);
    doc.text(safePdf(`Nº ${numero}`), PAGE_W - MARGIN, 12, { align: "right" });
  }
  doc.setDrawColor(...PDF_THEME.border);
  doc.line(MARGIN, 26, PAGE_W - MARGIN, 26);
}

/** Dibuja una casilla numerada (borde + etiqueta pequeña + valor) en una rejilla de coordenadas mm. */
function drawCasilla(
  doc: jsPDF,
  x: number,
  y: number,
  w: number,
  h: number,
  numero: string,
  etiqueta: string,
  valor?: string | string[],
) {
  doc.setDrawColor(...PDF_THEME.border);
  doc.setLineWidth(0.2);
  doc.rect(x, y, w, h);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(6);
  doc.setTextColor(...PDF_THEME.primaryDark);
  doc.text(`${numero}. ${safePdf(etiqueta)}`, x + 1.5, y + 3.5);

  if (valor) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...PDF_THEME.text);
    const lines = Array.isArray(valor) ? valor.map(safePdf) : doc.splitTextToSize(safePdf(valor), w - 3);
    doc.text(lines, x + 1.5, y + 7.5);
  }
}

export interface CmrDatos {
  numero?: string | null;
  fecha?: string | null;
  remitente?: string; // casilla 1 — por defecto "LASARTE SAT"
  consignatario?: string; // casilla 2
  lugarEntrega?: string; // casilla 3
  lugarFechaCarga?: string; // casilla 4
  documentosAnexos?: string; // casilla 5
  marcasNumeros?: string; // casilla 6
  numeroBultos?: string; // casilla 7
  modoEmbalaje?: string; // casilla 8
  naturalezaMercancia?: string; // casilla 9
  pesoBrutoKg?: string; // casilla 11
  instruccionesRemitente?: string; // casilla 13
  transportista?: string; // casilla 16
  porteadoresSucesivos?: string; // casilla 17
  formalizadoLugar?: string; // casilla 21 (lugar)
  formalizadoFecha?: string; // casilla 21 (fecha)
  matricula?: string;
  notas?: string;
}

/**
 * PDF A4 vertical con el layout de una carta de porte internacional (CMR):
 * casillas numeradas 1-24 organizadas en una rejilla con bordes, tipografia
 * pequeña, numero de CMR arriba a la derecha. No es una replica exacta del
 * impreso oficial pero cubre todas las casillas relevantes solicitadas.
 */
export async function generarCmrPdf(datos: CmrDatos): Promise<jsPDF> {
  await ensureExportLogoLoaded();
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });

  drawDocHeader(doc, "Carta de porte internacional (CMR)", datos.numero);

  let y = 30;
  const remitente = datos.remitente?.trim() || "LASARTE SAT";

  // Fila 1: Remitente (1) | Consignatario (2)
  const colW = CONTENT_W / 2;
  drawCasilla(doc, MARGIN, y, colW, 22, "1", "Remitente", remitente);
  drawCasilla(doc, MARGIN + colW, y, colW, 22, "2", "Consignatario", datos.consignatario || "");
  y += 22;

  // Fila 2: Lugar de entrega (3) | Lugar y fecha de carga (4)
  drawCasilla(doc, MARGIN, y, colW, 16, "3", "Lugar previsto para la entrega de la mercancia", datos.lugarEntrega || "");
  drawCasilla(doc, MARGIN + colW, y, colW, 16, "4", "Lugar y fecha de carga de la mercancia", datos.lugarFechaCarga || "");
  y += 16;

  // Fila 3: Documentos anexos (5) — ancho completo
  drawCasilla(doc, MARGIN, y, CONTENT_W, 14, "5", "Documentos anexos", datos.documentosAnexos || "");
  y += 14;

  // Fila 4: Marcas y numeros (6) | Nº bultos (7) | Embalaje (8) | Naturaleza mercancia (9)
  const c4 = CONTENT_W / 4;
  drawCasilla(doc, MARGIN, y, c4, 20, "6", "Marcas y numeros", datos.marcasNumeros || "");
  drawCasilla(doc, MARGIN + c4, y, c4, 20, "7", "Nº de bultos", datos.numeroBultos || "");
  drawCasilla(doc, MARGIN + c4 * 2, y, c4, 20, "8", "Modo de embalaje", datos.modoEmbalaje || "");
  drawCasilla(doc, MARGIN + c4 * 3, y, c4, 20, "9", "Naturaleza de la mercancia", datos.naturalezaMercancia || "");
  y += 20;

  // Fila 5: Peso bruto kg (11) — ancho completo, destacado
  drawCasilla(doc, MARGIN, y, CONTENT_W, 12, "11", "Peso bruto (kg)", datos.pesoBrutoKg || "");
  y += 12;

  // Fila 6: Instrucciones del remitente (13)
  drawCasilla(doc, MARGIN, y, CONTENT_W, 18, "13", "Instrucciones del remitente", datos.instruccionesRemitente || "");
  y += 18;

  // Fila 7: Transportista (16) | Porteadores sucesivos (17)
  drawCasilla(doc, MARGIN, y, colW, 20, "16", "Transportista", datos.transportista || "");
  drawCasilla(doc, MARGIN + colW, y, colW, 20, "17", "Porteadores sucesivos", datos.porteadoresSucesivos || "");
  y += 20;

  // Fila 8: Matricula | Formalizado en (lugar, fecha) (21)
  drawCasilla(doc, MARGIN, y, colW, 14, "M", "Matricula del vehiculo", datos.matricula || "");
  const lugarFecha = [datos.formalizadoLugar, datos.formalizadoFecha ? formatDate(datos.formalizadoFecha) : datos.fecha ? formatDate(datos.fecha) : ""]
    .filter(Boolean)
    .join(" · ");
  drawCasilla(doc, MARGIN + colW, y, colW, 14, "21", "Formalizado en (lugar, fecha)", lugarFecha || "");
  y += 14;

  if (datos.notas?.trim()) {
    drawCasilla(doc, MARGIN, y, CONTENT_W, 16, "—", "Notas", datos.notas);
    y += 16;
  }

  // Firmas: 22 remitente / 23 transportista / 24 consignatario
  const firmaY = Math.max(y + 4, PAGE_H - 60);
  const c3 = CONTENT_W / 3;
  [
    { n: "22", label: "Firma del remitente" },
    { n: "23", label: "Firma del transportista" },
    { n: "24", label: "Firma del consignatario" },
  ].forEach((item, i) => {
    drawCasilla(doc, MARGIN + c3 * i, firmaY, c3, 30, item.n, item.label);
  });

  drawExportFooter(doc);
  finalizeExportPageNumbers(doc);
  return doc;
}

export interface HojaRutaParada {
  orden: number;
  cliente: string;
  destino: string;
  bultos?: string;
  kg?: string;
  observaciones?: string;
}

export interface HojaRutaDatos {
  numero?: string | null;
  fecha?: string | null;
  transportista?: string;
  matricula?: string;
  conductor?: string;
  paradas: HojaRutaParada[];
  notas?: string;
}

/** PDF A4 vertical sencillo: cabecera + tabla de paradas + totales + firma. */
export async function generarHojaRutaPdf(datos: HojaRutaDatos): Promise<jsPDF> {
  await ensureExportLogoLoaded();
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });

  drawDocHeader(doc, "Hoja de ruta", datos.numero);

  let y = 32;
  doc.setFillColor(...PDF_THEME.creamStrong);
  doc.roundedRect(MARGIN, y, CONTENT_W, 20, 2, 2, "F");
  const cabecera = [
    { label: "Fecha", value: datos.fecha ? formatDate(datos.fecha) : "" },
    { label: "Transportista", value: datos.transportista || "" },
    { label: "Matricula", value: datos.matricula || "" },
    { label: "Conductor", value: datos.conductor || "" },
  ];
  const cw = CONTENT_W / cabecera.length;
  cabecera.forEach((item, i) => {
    const x = MARGIN + cw * i + 3;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.5);
    doc.setTextColor(...PDF_THEME.muted);
    doc.text(safePdf(item.label).toUpperCase(), x, y + 6);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(...PDF_THEME.primaryDark);
    doc.text(safePdf(item.value) || "-", x, y + 14);
  });
  y += 26;

  const totalBultos = datos.paradas.reduce((sum, p) => sum + (Number(p.bultos) || 0), 0);
  const totalKg = datos.paradas.reduce((sum, p) => sum + (Number(p.kg) || 0), 0);

  autoTable(doc, {
    startY: y,
    head: [["#", "Cliente", "Destino / direccion", "Bultos/palets", "Kg", "Observaciones"]],
    body: [
      ...datos.paradas.map((p) => [
        String(p.orden),
        safePdf(p.cliente),
        safePdf(p.destino),
        safePdf(p.bultos ?? ""),
        safePdf(p.kg ?? ""),
        safePdf(p.observaciones ?? ""),
      ]),
      ["", "TOTAL", "", totalBultos ? String(totalBultos) : "", totalKg ? String(totalKg) : "", ""],
    ],
    margin: { top: 30, bottom: 18, left: MARGIN, right: MARGIN },
    ...pdfTableTheme(),
    columnStyles: {
      0: { cellWidth: 8, halign: "center" },
      1: { cellWidth: 38 },
      2: { cellWidth: 58 },
      3: { cellWidth: 22, halign: "right" },
      4: { cellWidth: 18, halign: "right" },
      5: { cellWidth: "auto" },
    },
    didParseCell: (data) => {
      if (data.row.index === datos.paradas.length && data.section === "body") {
        data.cell.styles.fontStyle = "bold";
        data.cell.styles.fillColor = PDF_THEME.creamStrong;
      }
    },
    didDrawPage: () => {
      const pages = doc.getNumberOfPages();
      if (pages > 1) drawDocHeader(doc, "Hoja de ruta", datos.numero);
    },
  });

  const finalY = (doc as jsPDF & { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? y;
  let noteY = finalY + 8;

  if (datos.notas?.trim()) {
    if (noteY > 250) {
      doc.addPage();
      drawDocHeader(doc, "Hoja de ruta", datos.numero);
      noteY = 32;
    }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(...PDF_THEME.primaryDark);
    doc.text("Notas", MARGIN, noteY);
    noteY += 4;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...PDF_THEME.muted);
    const lines = doc.splitTextToSize(safePdf(datos.notas), CONTENT_W);
    doc.text(lines, MARGIN, noteY);
    noteY += lines.length * 3.6 + 6;
  }

  const firmaY = Math.max(noteY + 6, PAGE_H - 40);
  if (firmaY > PAGE_H - 20) {
    doc.addPage();
    drawDocHeader(doc, "Hoja de ruta", datos.numero);
  }
  const signY = firmaY > PAGE_H - 20 ? 60 : firmaY;
  doc.setDrawColor(...PDF_THEME.border);
  doc.line(MARGIN, signY + 20, MARGIN + 70, signY + 20);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(...PDF_THEME.muted);
  doc.text("Firma del conductor", MARGIN, signY + 24);

  drawExportFooter(doc);
  finalizeExportPageNumbers(doc);
  return doc;
}

// buildLasarteFilename (reportKit.ts) sanea el "modulo" a solo alfanumericos
// (pensado para nombres de una palabra tipo "Partes"), lo que pegaria el
// numero de CMR/hoja de ruta al nombre del modulo sin separador legible
// (p.ej. "Lasarte_CMR10305_..."). Por eso aqui se construye el nombre a mano,
// reusando el mismo formato de fecha que buildLasarteFilename pero
// preservando el guion bajo entre modulo y numero.
function fechaStamp(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function numeroSeguro(numero: string) {
  return numero
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9-]+/g, "")
    .trim();
}

export function cmrPdfFilename(numero?: string | null) {
  const sufijo = numero?.trim() ? `_${numeroSeguro(numero.trim())}` : "";
  return `Lasarte_CMR${sufijo}_${fechaStamp()}.pdf`;
}

export function hojaRutaPdfFilename(numero?: string | null) {
  const sufijo = numero?.trim() ? `_${numeroSeguro(numero.trim())}` : "";
  return `Lasarte_HojaRuta${sufijo}_${fechaStamp()}.pdf`;
}

/** Devuelve los bytes del PDF (Uint8Array) para subirlos a Storage sin pasar por doc.save(). */
export function pdfToBytes(doc: jsPDF): Uint8Array {
  return new Uint8Array(doc.output("arraybuffer") as ArrayBuffer);
}

// src/lib/cmrPdf.ts
// Generación de documentos para la pestaña "Generar" de CMR y Hojas de ruta.
//
// generarCmrPdf: RELLENA el formulario (AcroForm) de la plantilla real
// public/plantillas/plantilla-cmr.pdf (un PDF con 46 PDFTextField, sin
// dibujar nada por nuestra cuenta) usando pdf-lib. Así "Generar" produce
// exactamente la misma plantilla que la que se ve/descarga en la pestaña
// Archivo, solo que ya rellena. El mapeo de casillas -> nombre de campo está
// documentado junto a `buildCmrFieldValues`.
//
// generarHojaRutaPdf: sigue usando jsPDF + jspdf-autotable (motor compartido
// con exportPartes.ts vía exportTheme.ts/reportKit.ts) para dibujar una
// réplica del formato de public/plantillas/plantilla-hoja-ruta.xlsx
// ("DOCUMENTO DE CONTROL DE MERCANCÍAS", Orden FOM 238/2003).
import { PDFDocument } from "pdf-lib";
import jsPDF from "jspdf";
import { drawExportFooter, drawLogoOrFallback, finalizeExportPageNumbers, PDF_THEME } from "./exportTheme";
import { ensureExportLogoLoaded, formatReportDate } from "./reportKit";
import { formatDate } from "./format";

// jsPDF no soporta acentos/ñ con la fuente helvetica estandar sin incrustar
// una fuente propia: igual que exportPartes.ts, se normaliza el texto a ASCII
// antes de escribirlo para evitar caracteres corruptos en el PDF. Esto SOLO
// aplica al motor jsPDF (Hoja de ruta); el CMR se rellena con pdf-lib sobre
// la plantilla real, que sí soporta acentos (WinAnsiEncoding) sin problema.
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

/** Datos fiscales reales de la empresa cargadora, usados como remitente/origen por defecto. */
export const LASARTE_EMPRESA = {
  nombre: "Lasarte Cítricos S.L.",
  cif: "B14800304",
  direccion: "Ctra. Madrid-Cádiz km 461",
  poblacion: "41400 Écija (Sevilla)",
};

export const LASARTE_REMITENTE_DEFECTO =
  `${LASARTE_EMPRESA.nombre}\nCIF ${LASARTE_EMPRESA.cif}\n${LASARTE_EMPRESA.direccion}\n${LASARTE_EMPRESA.poblacion}`;

/** Origen por defecto de expedición (todas las salidas de mercancía parten de Écija). */
export const ORIGEN_DEFECTO = "ÉCIJA";

function drawDocHeader(doc: jsPDF, tituloDocumento: string, numero?: string | null, subLinea?: string) {
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
  doc.text(safePdf(subLinea) || `Generado: ${formatReportDate()}`, textX, 21.5);

  if (numero) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(...PDF_THEME.primaryDark);
    doc.text(safePdf(`Nº ${numero}`), PAGE_W - MARGIN, 12, { align: "right" });
  }
  doc.setDrawColor(...PDF_THEME.border);
  doc.line(MARGIN, 26, PAGE_W - MARGIN, 26);
}

/** Dibuja una casilla (borde + etiqueta pequeña + valor) en una rejilla de coordenadas mm. */
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
  const label = numero ? `${numero}. ${safePdf(etiqueta)}` : safePdf(etiqueta);
  doc.text(label, x + 1.5, y + 3.5);

  if (valor) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...PDF_THEME.text);
    const lines = Array.isArray(valor) ? valor.map(safePdf) : doc.splitTextToSize(safePdf(valor), w - 3);
    doc.text(lines, x + 1.5, y + 7.5);
  }
}

// ─── Parte A: CMR — relleno de la plantilla real (AcroForm) ───────────────

/** Una línea de mercancía de las 7 disponibles en la plantilla (casillas 010/014/015). */
export interface CmrLineaMercancia {
  /** Columna 010_NN (ancha, campo libre: nº estadístico / descripción de la línea). */
  numeroEstadistico?: string;
  /** Columna 014_NN (peso bruto en kg de esa línea). */
  pesoBrutoKg?: string;
  /** Columna 015_NN (volumen en m3 de esa línea). */
  volumenM3?: string;
}

export interface CmrDatos {
  /** Casilla "NumCarta": número de carta de porte. */
  numCarta?: string | null;
  /** Casilla "001": remitente. Por defecto los datos fiscales de Lasarte. */
  remitente?: string;
  /** Casilla "002": consignatario / cliente. */
  consignatario?: string;
  /** Casillas "003_1..3": lugar previsto para la entrega (hasta 3 líneas). */
  lugarEntrega?: string | string[];
  /** Casillas "004_1..2": lugar y fecha de carga (hasta 2 líneas). */
  lugarFechaCarga?: string | string[];
  /** Casilla "005": documentos anexos. */
  docsAnexos?: string;
  /** Casilla "006": marcas y números. */
  marcas?: string;
  /** Casillas "007_1..4": número de bultos (hasta 4 líneas). */
  bultos?: string | string[];
  /** Casillas "008_01..02": modo de embalaje (hasta 2 líneas). */
  embalaje?: string | string[];
  /** Casilla "009": naturaleza de la mercancía. */
  naturaleza?: string;
  /**
   * Peso bruto total en kg. Si no se aportan `lineas`, este valor se usa
   * como atajo rápido y se coloca en la primera línea de mercancía
   * (columna 014_01), que es la casilla numérica pensada para el peso.
   */
  pesoBrutoKg?: string;
  /** Casilla "016": transportista. */
  transportista?: string;
  /** Casillas "021_01..03": formalizado en (lugar / fecha / …), hasta 3 líneas. */
  formalizadoEn?: string | string[];
  /** Casilla "TRACTORA": matrícula de la cabeza tractora. */
  matriculaTractora?: string;
  /** Casilla "REMOLQUE": matrícula del remolque. */
  matriculaRemolque?: string;
  /** Casilla "022": firma del remitente (texto, p.ej. nombre de quien firma). */
  firmaRemitente?: string;
  /** Casilla "023": firma del transportista (texto). */
  firmaTransportista?: string;
  /**
   * Hasta 7 líneas de mercancía (casillas 010/014/015 de la plantilla). Si se
   * omite y hay `pesoBrutoKg`, se genera automáticamente una única línea con
   * ese peso — ver comentario de `pesoBrutoKg`.
   */
  lineas?: CmrLineaMercancia[];
}

const CMR_PLANTILLA_URL = "/plantillas/plantilla-cmr.pdf";

/** Separa un valor en hasta `max` líneas no vacías (por saltos de línea si es string). */
function toLines(value: string | string[] | undefined, max: number): string[] {
  if (!value) return [];
  const arr = Array.isArray(value) ? value : value.split(/\r?\n/);
  return arr
    .map((v) => String(v ?? "").trim())
    .filter(Boolean)
    .slice(0, max);
}

/**
 * Mapeo puro datos -> { nombreDeCampo: valor } para la plantilla-cmr.pdf.
 * No toca pdf-lib ni fetch: es la parte testable en Node/vitest del relleno
 * del CMR. Solo incluye claves con valor no vacío (para no pisar el resto
 * de casillas de la plantilla con cadenas vacías al rellenarla).
 *
 * TODO calibrar columnas 010/014/015 si el usuario ve descuadre en el peso o
 * el volumen por línea de mercancía: la plantilla no rotula estas 3 columnas
 * al 100%, así que el mapeo (010=nº estadístico/descripción, 014=peso kg,
 * 015=volumen m3) es una interpretación conservadora basada en el ancho de
 * cada campo (010 es la columna ancha, 014/015 son las dos columnas
 * numéricas estrechas de la derecha).
 */
export function buildCmrFieldValues(datos: CmrDatos): Record<string, string> {
  const out: Record<string, string> = {};
  const put = (name: string, value: unknown) => {
    const v = typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
    if (v) out[name] = v;
  };

  put("NumCarta", datos.numCarta);
  put("001", datos.remitente?.trim() || LASARTE_REMITENTE_DEFECTO);
  put("002", datos.consignatario);

  toLines(datos.lugarEntrega, 3).forEach((line, i) => put(`003_${i + 1}`, line));
  toLines(datos.lugarFechaCarga, 2).forEach((line, i) => put(`004_${i + 1}`, line));

  put("005", datos.docsAnexos);
  put("006", datos.marcas);

  toLines(datos.bultos, 4).forEach((line, i) => put(`007_${i + 1}`, line));
  toLines(datos.embalaje, 2).forEach((line, i) => put(`008_${String(i + 1).padStart(2, "0")}`, line));

  put("009", datos.naturaleza);

  const lineas: CmrLineaMercancia[] =
    datos.lineas && datos.lineas.length > 0
      ? datos.lineas
      : datos.pesoBrutoKg
        ? [{ pesoBrutoKg: datos.pesoBrutoKg }]
        : [];
  lineas.slice(0, 7).forEach((linea, i) => {
    const n = String(i + 1).padStart(2, "0");
    put(`010_${n}`, linea.numeroEstadistico);
    put(`014_${n}`, linea.pesoBrutoKg);
    put(`015_${n}`, linea.volumenM3);
  });

  put("016", datos.transportista);

  toLines(datos.formalizadoEn, 3).forEach((line, i) => put(`021_${String(i + 1).padStart(2, "0")}`, line));

  put("TRACTORA", datos.matriculaTractora);
  put("REMOLQUE", datos.matriculaRemolque);
  put("022", datos.firmaRemitente);
  put("023", datos.firmaTransportista);

  return out;
}

/**
 * Rellena la plantilla real (public/plantillas/plantilla-cmr.pdf, un AcroForm
 * con 46 PDFTextField) con `datos` y la aplana (`form.flatten()`) para que el
 * resultado sea un PDF plano, ya no editable, idéntico visualmente a la
 * plantilla oficial. Devuelve los bytes del PDF listos para descargar o subir
 * a Storage.
 *
 * No se testea en Node/vitest (requiere `fetch` de un asset servido por
 * Vite/el navegador) — lo testable es `buildCmrFieldValues` de más arriba.
 */
export async function generarCmrPdf(datos: CmrDatos): Promise<Uint8Array> {
  const response = await fetch(CMR_PLANTILLA_URL);
  if (!response.ok) {
    throw new Error(`No se pudo cargar la plantilla de CMR (${CMR_PLANTILLA_URL}).`);
  }
  const templateBytes = new Uint8Array(await response.arrayBuffer());
  const pdfDoc = await PDFDocument.load(templateBytes);
  const form = pdfDoc.getForm();

  const valores = buildCmrFieldValues(datos);
  for (const [nombre, valor] of Object.entries(valores)) {
    try {
      form.getTextField(nombre).setText(valor);
    } catch {
      // Campo inexistente o de otro tipo en la plantilla: se ignora de forma
      // defensiva para no romper la generación completa por un nombre suelto.
    }
  }

  form.flatten();
  return pdfDoc.save();
}

// ─── Parte B: Hoja de ruta (Documento de control de mercancías) ───────────

export interface HojaRutaDatos {
  /** Número interno de hoja de ruta (no forma parte del impreso FOM, solo de nuestro archivo). */
  numero?: string | null;
  /** "Nombre Transportista". */
  transportista?: string;
  /** "Destinatario". */
  destinatario?: string;
  /** "Matrícula del Vehículo" — Tractora. */
  matriculaTractora?: string;
  /** "Matrícula del Vehículo" — Remolque. */
  matriculaRemolque?: string;
  /** "Datos Expedición" — Origen. Por defecto ÉCIJA (sede de Lasarte). */
  origen?: string;
  /** "Datos Expedición" — Destino. */
  destino?: string;
  /** "Mercancía" — Fecha Carga. */
  fechaCarga?: string | null;
  /** "Mercancía" — Fecha Descarga. */
  fechaDescarga?: string | null;
  /** "Mercancía" — Descripción. */
  descripcionMercancia?: string;
  /** "Mercancía" — Peso Kg. */
  pesoKg?: string;
  /** "Observaciones". */
  observaciones?: string;
}

/**
 * PDF A4 vertical que replica el formato de
 * public/plantillas/plantilla-hoja-ruta.xlsx ("DOCUMENTO DE CONTROL DE
 * MERCANCÍAS", Orden FOM 238/2003): un único envío (no una lista de paradas),
 * con bloque de empresa cargadora / operador de transporte, matrícula y
 * expedición, mercancía y observaciones, y pie con 3 firmas.
 */
export async function generarHojaRutaPdf(datos: HojaRutaDatos): Promise<jsPDF> {
  await ensureExportLogoLoaded();
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });

  drawDocHeader(
    doc,
    "Documento de control de mercancías",
    datos.numero,
    "Orden FOM 238/2003 - BOE núm. 38 de 13 de febrero de 2003",
  );

  const colW = CONTENT_W / 2;
  let y = 32;

  // EMPRESA CARGADORA | OPERADOR DE TRANSPORTE
  drawCasilla(doc, MARGIN, y, colW, 26, "", "Empresa cargadora", [
    LASARTE_EMPRESA.nombre,
    `CIF: ${LASARTE_EMPRESA.cif}`,
    LASARTE_EMPRESA.direccion,
    LASARTE_EMPRESA.poblacion,
  ]);
  drawCasilla(doc, MARGIN + colW, y, colW, 26, "", "Operador de transporte", datos.transportista || "");
  y += 26;

  // Nombre Transportista | Destinatario
  drawCasilla(doc, MARGIN, y, colW, 16, "", "Nombre transportista", datos.transportista || "");
  drawCasilla(doc, MARGIN + colW, y, colW, 16, "", "Destinatario", datos.destinatario || "");
  y += 16;

  // Matrícula del vehículo (tractora/remolque) | Datos expedición (origen/destino)
  const matricula = [
    datos.matriculaTractora ? `Tractora: ${datos.matriculaTractora}` : "",
    datos.matriculaRemolque ? `Remolque: ${datos.matriculaRemolque}` : "",
  ].filter(Boolean);
  drawCasilla(doc, MARGIN, y, colW, 18, "", "Matrícula del vehículo", matricula.length ? matricula : "");

  const expedicion = [
    `Origen: ${datos.origen?.trim() || ORIGEN_DEFECTO}`,
    `Destino: ${datos.destino?.trim() || ""}`,
  ];
  drawCasilla(doc, MARGIN + colW, y, colW, 18, "", "Datos de expedición", expedicion);
  y += 22;

  // Mercancía: título de sección + Fecha carga | Fecha descarga
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(...PDF_THEME.primaryDark);
  doc.text("MERCANCÍA", MARGIN, y);
  y += 3;

  drawCasilla(doc, MARGIN, y, colW, 14, "", "Fecha de carga", datos.fechaCarga ? formatDate(datos.fechaCarga) : "");
  drawCasilla(doc, MARGIN + colW, y, colW, 14, "", "Fecha de descarga", datos.fechaDescarga ? formatDate(datos.fechaDescarga) : "");
  y += 14;

  // Descripción (2/3) | Peso Kg (1/3)
  const descW = CONTENT_W * 0.65;
  const pesoW = CONTENT_W - descW;
  drawCasilla(doc, MARGIN, y, descW, 30, "", "Descripción de la mercancía", datos.descripcionMercancia || "");
  drawCasilla(doc, MARGIN + descW, y, pesoW, 30, "", "Peso (kg)", datos.pesoKg || "");
  y += 34;

  // Observaciones
  drawCasilla(doc, MARGIN, y, CONTENT_W, 24, "", "Observaciones", datos.observaciones || "");
  y += 24;

  // Firmas: 3 columnas
  const firmaY = Math.max(y + 8, PAGE_H - 46);
  const c3 = CONTENT_W / 3;
  ["Firma del cargador", "Firma del transportista", "Firma del destinatario"].forEach((label, i) => {
    drawCasilla(doc, MARGIN + c3 * i, firmaY, c3, 32, "", label);
  });

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

/** Dispara la descarga de un PDF ya en bytes (p.ej. el resultado de generarCmrPdf). */
export function downloadPdfBytes(bytes: Uint8Array, filename: string) {
  if (typeof document === "undefined") return;
  const blob = new Blob([bytes], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

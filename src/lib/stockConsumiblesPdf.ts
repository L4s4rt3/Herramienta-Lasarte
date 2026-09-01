// PDFs del stock de consumibles: la lista completa (para archivar o repasar en
// papel) y los CARTELES por artículo (un A4 apaisado por consumible, con el
// nombre y el stock a tamaño gigante, para pegarlo físicamente en la estantería).
// Usa las piezas formales de pdfKit (cabecera con logo + nº de documento, pie
// legal, tabla dirigida por ColumnaTabla) para que salga con la misma marca que
// el resto de informes de la herramienta.
import { jsPDF } from "jspdf";
import { generarExportId, type ColumnaTabla } from "./exportKit";
import {
  cabeceraDocumento,
  finalizarPaginacionFormal,
  formatearFechaEmision,
  pdfTablaDesdeColumnas,
  pieLegal,
  safeText,
} from "./pdfKit";
import { PDF_THEME } from "./exportTheme";
import { esPendiente, formatEuros, formatStock, valorItem, type StockConsumible } from "./stockConsumibles";

const PDF_MIME = "application/pdf";

/** Mismo criterio que entregarDocx (useCalidadImport): en iPhone/Android la
 * hoja de compartir nativa (imprimir por AirPrint, Mail, WhatsApp); en
 * escritorio, descarga clásica. La descarga de blobs en una PWA instalada en
 * iOS falla en silencio, por eso el share es el camino fiable en móvil. */
async function entregarPdf(blob: Blob, filename: string): Promise<"compartido" | "descargado" | "cancelado"> {
  const esMovil = typeof navigator !== "undefined" && /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
  const file = new File([blob], filename, { type: PDF_MIME });
  if (esMovil && typeof navigator.canShare === "function" && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename });
      return "compartido";
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return "cancelado";
    }
  }
  const url = URL.createObjectURL(new Blob([blob], { type: PDF_MIME }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return "descargado";
}

function fechaArchivo(fecha: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${fecha.getFullYear()}-${pad(fecha.getMonth() + 1)}-${pad(fecha.getDate())}`;
}

// ─── Lista de stock ──────────────────────────────────────────────────────────

export async function generarListaStockPdf(
  items: StockConsumible[],
  opts: { conValor: boolean },
): Promise<string | null> {
  const generadoEn = new Date();
  const exportId = generarExportId(generadoEn);
  const doc = new jsPDF({ unit: "mm", format: "a4" });

  const chrome = () => {
    cabeceraDocumento(doc, { documentoNumero: exportId, subtitulo: "Stock de consumibles", fechaEmision: generadoEn });
    pieLegal(doc, { exportId });
  };
  chrome();

  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(...PDF_THEME.primaryDark);
  doc.text("Stock de consumibles", 10, 31);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...PDF_THEME.muted);
  const pendientes = items.filter(esPendiente).length;
  doc.text(
    safeText(
      `Inventario a ${formatearFechaEmision(generadoEn)} · ${items.length} artículos` +
        (pendientes > 0 ? ` · ${pendientes} con aviso pendiente` : ""),
    ),
    10,
    36,
  );

  const columnas: ColumnaTabla[] = [
    { header: "Artículo", key: "nombre" },
    { header: "Familia", key: "familia" },
    { header: "Stock", key: "stock", align: "right" },
    { header: "Ud.", key: "unidad", align: "center" },
    ...(opts.conValor ? ([{ header: "Valor", key: "valor", align: "right" }] as ColumnaTabla[]) : []),
    { header: "Notas", key: "nota" },
  ];
  const filas = items.map((item) => {
    const valor = valorItem(item);
    return {
      nombre: item.nombre + (item.almacen === "exterior" ? " — ALMACÉN EXTERIOR" : ""),
      familia: item.familia,
      stock: formatStock(item.stock),
      unidad: item.unidad,
      ...(opts.conValor ? { valor: valor === null ? "" : formatEuros(valor) } : {}),
      nota: item.nota ?? "",
    };
  });
  const totalValor = items.reduce((suma, item) => suma + (valorItem(item) ?? 0), 0);
  const totales = opts.conValor ? { nombre: "TOTAL", valor: formatEuros(totalValor) } : undefined;

  pdfTablaDesdeColumnas(doc, {
    columnas,
    filas,
    totales,
    startY: 40,
    didDrawPage: (data) => {
      if (data.pageNumber > 1) chrome();
    },
  });

  finalizarPaginacionFormal(doc);
  const filename = `stock-consumibles-${fechaArchivo(generadoEn)}.pdf`;
  const via = await entregarPdf(doc.output("blob"), filename);
  return via === "cancelado" ? null : filename;
}

// ─── Carteles por artículo (A4 apaisado, uno por página) ────────────────────

export async function generarCartelesPdf(items: StockConsumible[]): Promise<string | null> {
  if (items.length === 0) return null;
  const generadoEn = new Date();
  const exportId = generarExportId(generadoEn);
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });

  items.forEach((item, indice) => {
    if (indice > 0) doc.addPage("a4", "landscape");
    cabeceraDocumento(doc, { documentoNumero: exportId, subtitulo: "Cartel de stock", fechaEmision: generadoEn });

    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const centerX = pageWidth / 2;

    // Familia arriba, como localizador de estantería.
    doc.setFont("helvetica", "bold");
    doc.setFontSize(15);
    doc.setTextColor(...PDF_THEME.muted);
    doc.text(safeText(item.familia.toUpperCase()), centerX, 50, { align: "center" });

    // Nombre del artículo, grande y envuelto (hasta 3 líneas).
    doc.setFontSize(32);
    doc.setTextColor(...PDF_THEME.primaryDark);
    const lineas = (doc.splitTextToSize(safeText(item.nombre), pageWidth - 40) as string[]).slice(0, 3);
    doc.text(lineas, centerX, 68, { align: "center" });

    // El stock, a tamaño de cartel.
    const yStock = 68 + lineas.length * 13 + 38;
    doc.setFontSize(76);
    doc.setTextColor(...PDF_THEME.text);
    doc.text(safeText(`${formatStock(item.stock)} ${item.unidad}`), centerX, yStock, { align: "center" });

    if (item.almacen === "exterior") {
      doc.setFontSize(14);
      doc.setTextColor(...PDF_THEME.muted);
      doc.text("ALMACÉN EXTERIOR", centerX, yStock + 14, { align: "center" });
    }

    // Fecha del recuento al pie: un cartel sin fecha engaña a los tres meses.
    doc.setDrawColor(...PDF_THEME.border);
    doc.setLineWidth(0.3);
    doc.line(60, pageHeight - 22, pageWidth - 60, pageHeight - 22);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    doc.setTextColor(...PDF_THEME.muted);
    doc.text(safeText(`Recuento del ${formatearFechaEmision(generadoEn)}`), centerX, pageHeight - 14, {
      align: "center",
    });
  });

  const filename =
    items.length === 1
      ? `cartel-${items[0].nombre.toLowerCase().replace(/[^a-z0-9]+/gi, "-").slice(0, 40)}-${fechaArchivo(generadoEn)}.pdf`
      : `carteles-stock-${items.length}-${fechaArchivo(generadoEn)}.pdf`;
  const via = await entregarPdf(doc.output("blob"), filename);
  return via === "cancelado" ? null : filename;
}

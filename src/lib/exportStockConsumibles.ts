// Export del stock de consumibles: el Excel con marca (exportKit) y las piezas
// que COMPARTE con el PDF (stockConsumiblesPdf.ts) — columnas ColumnaTabla,
// filas y entrega del archivo — para que las dos salidas enseñen las mismas
// cabeceras y los mismos formatos por definición (el encargo de paridad
// Excel↔PDF de pdfKit.ts).
import {
  añadirHojaTabla,
  corregirComaColgante,
  crearLibroLasarte,
  FMT_EUR,
  type ColumnaTabla,
} from "./exportKit";
import { formatearFechaEmision } from "./pdfKit";
import { valorItem, type StockConsumible } from "./stockConsumibles";

/** Hasta 2 decimales y solo si hacen falta: "1.500" y "10,5", nunca "1.500,00". */
export const FMT_STOCK = "#,##0.##";
/** Precios unitarios de consumibles: llegan a fracciones de céntimo (0,0004 €/grapa). */
export const FMT_PRECIO_UNITARIO = '#,##0.00####" €"';

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export interface OpcionesColumnasStock {
  /** Columna de valor en € (solo admin). */
  conValor: boolean;
  /** Columna de precio unitario (solo tiene sentido en el Excel, el PDF va justo de ancho). */
  conPrecio?: boolean;
}

export function columnasStock(opts: OpcionesColumnasStock): ColumnaTabla[] {
  return [
    { header: "Artículo", key: "nombre", width: 44 },
    { header: "Familia", key: "familia", width: 15 },
    { header: "Almacén", key: "almacen", align: "center", width: 11 },
    { header: "Stock", key: "stock", tipo: "numero", numFmt: FMT_STOCK, width: 12 },
    { header: "Ud.", key: "unidad", align: "center", width: 9 },
    ...(opts.conPrecio
      ? ([{ header: "Precio ud.", key: "precio", tipo: "numero", numFmt: FMT_PRECIO_UNITARIO, width: 13 }] as ColumnaTabla[])
      : []),
    ...(opts.conValor
      ? ([{ header: "Valor", key: "valor", tipo: "numero", numFmt: FMT_EUR, width: 13 }] as ColumnaTabla[])
      : []),
    { header: "Notas", key: "nota", width: 60 },
  ];
}

export function filasStock(items: StockConsumible[]): Record<string, unknown>[] {
  return items.map((item) => ({
    nombre: item.nombre,
    familia: item.familia,
    almacen: item.almacen === "exterior" ? "Exterior" : "Central",
    stock: item.stock,
    unidad: item.unidad,
    precio: item.precio_unitario === null ? null : Number(item.precio_unitario),
    valor: valorItem(item),
    nota: item.nota ?? "",
  }));
}

export function totalesStock(items: StockConsumible[]): Record<string, unknown> {
  return {
    nombre: "TOTAL",
    valor: items.reduce((suma, item) => suma + (valorItem(item) ?? 0), 0),
  };
}

export function nombreFicheroStock(extension: "pdf" | "xlsx", generadoEn: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `stock-consumibles-${generadoEn.getFullYear()}-${pad(generadoEn.getMonth() + 1)}-${pad(generadoEn.getDate())}.${extension}`;
}

/** Mismo criterio que entregarDocx (useCalidadImport): en iPhone/Android la
 * hoja de compartir nativa (imprimir por AirPrint, Mail, WhatsApp); en
 * escritorio, descarga clásica. La descarga de blobs en una PWA instalada en
 * iOS falla en silencio, por eso el share es el camino fiable en móvil. */
export async function entregarArchivo(
  blob: Blob,
  filename: string,
  mime: string,
): Promise<"compartido" | "descargado" | "cancelado"> {
  const esMovil = typeof navigator !== "undefined" && /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
  const file = new File([blob], filename, { type: mime });
  if (esMovil && typeof navigator.canShare === "function" && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename });
      return "compartido";
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return "cancelado";
    }
  }
  const url = URL.createObjectURL(new Blob([blob], { type: mime }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return "descargado";
}

/** Excel de la lista de stock con la marca Lasarte (misma tabla que el PDF,
 * más el precio unitario si el usuario ve euros). Devuelve el nombre del
 * archivo, o null si se canceló la hoja de compartir. */
export async function generarListaStockExcel(
  items: StockConsumible[],
  opts: { conValor: boolean },
): Promise<string | null> {
  const generadoEn = new Date();
  const ctx = crearLibroLasarte({
    titulo: "Stock de consumibles",
    periodo: `Inventario a ${formatearFechaEmision(generadoEn)}`,
    clasificacion: "Interno",
    generadoEn,
  });

  const hoja = añadirHojaTabla(ctx, {
    nombreHoja: "Stock",
    columnas: columnasStock({ conValor: opts.conValor, conPrecio: opts.conValor }),
    filas: filasStock(items),
    totales: opts.conValor ? totalesStock(items) : undefined,
  });
  // Sin coma colgante en los stocks enteros ("4.918," → "4.918").
  corregirComaColgante(hoja, "stock", FMT_STOCK);

  const buffer = await ctx.workbook.xlsx.writeBuffer();
  const filename = nombreFicheroStock("xlsx", generadoEn);
  const via = await entregarArchivo(new Blob([buffer], { type: XLSX_MIME }), filename, XLSX_MIME);
  return via === "cancelado" ? null : filename;
}

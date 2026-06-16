import type { ConsumoBaseKgRow, ConsumoFisicoRow } from "@/lib/types";

export const FACTURAS_CAMPANA_2025_2026_RANGE = {
  id: "2025-2026",
  label: "Campana 2025/2026",
  fechaInicio: "2025-09-01",
  fechaFin: "2026-08-31",
} as const;

interface FacturaGasoilCampana2025_2026 {
  fecha: string;
  factura: string;
  albaran: string;
  articulo: string;
  litros: number;
  precio: number;
  importe: number;
}

interface FacturaAguaCampana2025_2026 {
  factura: string;
  documento: string;
  facturacion: string;
  fechaEmision: string;
  fechaInicio: string;
  fechaFin: string;
  lecturaAnterior: number;
  lecturaActual: number;
  dias: number;
  m3: number;
  fuenteImagen: string;
}

interface FacturaElectricidadCampana2025_2026 {
  factura: string;
  fechaFactura: string;
  fechaInicio: string;
  fechaFin: string;
  kwh: number;
  periodos: Partial<Record<"P1" | "P2" | "P3" | "P4" | "P5" | "P6", number>>;
  fuenteImagen: string;
}

interface Campana2025_2026VentasKg {
  periodo: string;
  fechaInicio: string;
  fechaFin: string;
  kgPositivos: number;
  kgNegativos: number;
  kgNetos: number;
}

export const FACTURAS_CAMPANA_2025_2026_CONSUMOS: FacturaGasoilCampana2025_2026[] = [
  { fecha: "2025-10-10", factura: "25 1747", albaran: "09 91779", articulo: "GASOIL AGRODIESEL E+10 GOB", litros: 1001, precio: 0.750, importe: 750.75 },
  { fecha: "2025-11-13", factura: "25 2002", albaran: "02250318", articulo: "GASOIL AGRODIESEL E+10 GOB", litros: 870, precio: 0.815, importe: 709.05 },
  { fecha: "2025-11-20", factura: "25 2002", albaran: "02250341", articulo: "GASOIL AGRODIESEL E+10 GOB", litros: 720, precio: 0.815, importe: 586.80 },
  { fecha: "2025-11-27", factura: "25 2002", albaran: "02250378", articulo: "GASOIL AGRODIESEL E+10 GOB", litros: 962, precio: 0.790, importe: 759.98 },
  { fecha: "2025-12-02", factura: "25 2276", albaran: "02250413", articulo: "GASOIL AGRODIESEL E+10 GOB", litros: 810, precio: 0.760, importe: 615.60 },
  { fecha: "2025-12-12", factura: "25 2276", albaran: "02250454", articulo: "GASOIL AGRODIESEL E+10 GOB", litros: 890, precio: 0.750, importe: 667.50 },
  { fecha: "2025-12-18", factura: "25 2276", albaran: "02250475", articulo: "GASOIL AGRODIESEL E+10 GOB", litros: 720, precio: 0.715, importe: 514.80 },
  { fecha: "2025-12-26", factura: "25 2276", albaran: "09 92097", articulo: "GASOIL AGRODIESEL E+10 GOB", litros: 1000, precio: 0.715, importe: 715.00 },
  { fecha: "2026-01-02", factura: "26 131", albaran: "09 90004", articulo: "GASOIL AGRODIESEL E+10 GOB", litros: 951, precio: 0.730, importe: 694.23 },
  { fecha: "2026-01-09", factura: "26 131", albaran: "02260020", articulo: "GASOIL AGRODIESEL E+10 GOB", litros: 950, precio: 0.720, importe: 684.00 },
  { fecha: "2026-01-15", factura: "26 131", albaran: "02260046", articulo: "GASOIL AGRODIESEL E+10 GOB", litros: 900, precio: 0.738, importe: 664.20 },
  { fecha: "2026-01-21", factura: "26 131", albaran: "02260070", articulo: "GASOIL AGRODIESEL E+10 GOB", litros: 971, precio: 0.758, importe: 736.02 },
  { fecha: "2026-01-27", factura: "26 131", albaran: "09 90105", articulo: "GASOIL AGRODIESEL E+10 GOB", litros: 1000, precio: 0.750, importe: 750.00 },
  { fecha: "2026-02-02", factura: "26 288", albaran: "09 90120", articulo: "GASOIL AGRODIESEL E+10 GOB", litros: 800, precio: 0.759, importe: 607.20 },
  { fecha: "2026-02-06", factura: "26 288", albaran: "09 90135", articulo: "GASOIL AGRODIESEL E+10 GOB", litros: 851, precio: 0.760, importe: 646.76 },
  { fecha: "2026-02-12", factura: "26 288", albaran: "09 90158", articulo: "GASOIL AGRODIESEL E+10 GOB", litros: 1000, precio: 0.758, importe: 758.00 },
  { fecha: "2026-02-18", factura: "26 288", albaran: "09 90175", articulo: "GASOIL AGRODIESEL E+10 GOB", litros: 1050, precio: 0.750, importe: 787.50 },
  { fecha: "2026-02-24", factura: "26 288", albaran: "02260104", articulo: "GASOIL AGRODIESEL E+10 GOB", litros: 1100, precio: 0.795, importe: 874.50 },
  { fecha: "2026-03-02", factura: "26 504", albaran: "09 90245", articulo: "GASOIL AGRODIESEL E+10 GOB", litros: 1000, precio: 0.790, importe: 790.00 },
  { fecha: "2026-03-06", factura: "26 504", albaran: "09 90300", articulo: "GASOIL AGRODIESEL E+10 GOB", litros: 950, precio: 1.070, importe: 1016.50 },
  { fecha: "2026-03-12", factura: "26 504", albaran: "02260195", articulo: "GASOIL AGRODIESEL E+10 GOB", litros: 1050, precio: 1.195, importe: 1254.75 },
  { fecha: "2026-03-18", factura: "26 504", albaran: "02260220", articulo: "GASOIL AGRODIESEL E+10 GOB", litros: 949, precio: 1.210, importe: 1148.29 },
  { fecha: "2026-03-24", factura: "26 622", albaran: "02260251", articulo: "GASOIL AGRODIESEL E+10 GOB", litros: 1136, precio: 1.250, importe: 1420.00 },
  { fecha: "2026-03-27", factura: "26 622", albaran: "09 90409", articulo: "GASOIL AGRODIESEL E+10 GOB", litros: 700, precio: 1.220, importe: 854.00 },
  { fecha: "2026-04-06", factura: "26 817", albaran: "02260269", articulo: "GASOIL AGRODIESEL E+10 GOB", litros: 1150, precio: 1.250, importe: 1437.50 },
  { fecha: "2026-04-10", factura: "26 817", albaran: "02260300", articulo: "GASOIL AGRODIESEL E+10 GOB", litros: 860, precio: 1.327, importe: 1141.22 },
  { fecha: "2026-04-16", factura: "26 817", albaran: "09 90498", articulo: "GASOIL AGRODIESEL E+10 GOB", litros: 1150, precio: 1.178, importe: 1354.70 },
  { fecha: "2026-04-22", factura: "26 817", albaran: "09 90551", articulo: "GASOIL AGRODIESEL E+10 GOB", litros: 602, precio: 1.152, importe: 693.50 },
  { fecha: "2026-04-28", factura: "26 817", albaran: "02260317", articulo: "GASOIL AGRODIESEL E+10 GOB", litros: 400, precio: 1.150, importe: 460.00 },
  { fecha: "2026-05-07", factura: "26 1042", albaran: "09 90652", articulo: "GASOIL AGRODIESEL E+10 GOB", litros: 800, precio: 1.160, importe: 928.00 },
  { fecha: "2026-05-18", factura: "26 1042", albaran: "09 90695", articulo: "GASOIL AGRODIESEL E+10 GOB", litros: 770, precio: 1.180, importe: 908.60 },
  { fecha: "2026-05-28", factura: "26 1042", albaran: "09 90743", articulo: "GASOIL AGRODIESEL E+10 GOB", litros: 866, precio: 1.098, importe: 950.87 },
];

export const FACTURAS_CAMPANA_2025_2026_AGUA_CONSUMOS: FacturaAguaCampana2025_2026[] = [
  {
    factura: "17782501P0013377",
    documento: "17782501P0092613",
    facturacion: "Septiembre-Octubre/2025",
    fechaEmision: "2025-10-24",
    fechaInicio: "2025-08-19",
    fechaFin: "2025-10-20",
    lecturaAnterior: 37193,
    lecturaActual: 37383,
    dias: 62,
    m3: 190,
    fuenteImagen: "10-FCBDCEEF-C68E-48EF-9FC1-180ACD5D4A02.png",
  },
  {
    factura: "17782501P0017129",
    documento: "17782501P0111661",
    facturacion: "Noviembre-Diciembre/2025",
    fechaEmision: "2025-12-19",
    fechaInicio: "2025-10-20",
    fechaFin: "2025-12-16",
    lecturaAnterior: 37383,
    lecturaActual: 37814,
    dias: 57,
    m3: 431,
    fuenteImagen: "08-4B4AF055-FBC3-450B-9C42-2FA3713B97BD.png",
  },
  {
    factura: "17782601P0002729",
    documento: "17782601P0018958",
    facturacion: "Enero-Febrero/2026",
    fechaEmision: "2026-02-25",
    fechaInicio: "2025-12-16",
    fechaFin: "2026-02-19",
    lecturaAnterior: 37814,
    lecturaActual: 38239,
    dias: 65,
    m3: 425,
    fuenteImagen: "06-48F8DA86-E025-4BEF-994F-5B78EF3B3D3C.png",
  },
  {
    factura: "17782601P0005464",
    documento: "17782601P0037883",
    facturacion: "Marzo-Abril/2026",
    fechaEmision: "2026-04-28",
    fechaInicio: "2026-02-19",
    fechaFin: "2026-04-23",
    lecturaAnterior: 38239,
    lecturaActual: 38659,
    dias: 63,
    m3: 420,
    fuenteImagen: "04-C22124CB-A5F0-4714-8F2D-686402818600.png",
  },
];

export const FACTURAS_CAMPANA_2025_2026_ELECTRICIDAD_CONSUMOS: FacturaElectricidadCampana2025_2026[] = [
  {
    factura: "P25CON047349745",
    fechaFactura: "2025-10-10",
    fechaInicio: "2025-09-01",
    fechaFin: "2025-09-30",
    kwh: 8363,
    periodos: { P3: 2852, P4: 2122, P6: 3389 },
    fuenteImagen: "37-D60FC135-2764-4A98-ABC1-5CA0F827DFD0.png",
  },
  {
    factura: "P25CON050745477",
    fechaFactura: "2025-11-04",
    fechaInicio: "2025-10-01",
    fechaFin: "2025-10-31",
    kwh: 20026,
    periodos: { P4: 7919, P5: 5222, P6: 6885 },
    fuenteImagen: "35-7B1B3340-0EE1-4ADA-A2F8-2027049FD2B0.png",
  },
  {
    factura: "P25CON055761481",
    fechaFactura: "2025-12-04",
    fechaInicio: "2025-11-01",
    fechaFin: "2025-11-30",
    kwh: 56960,
    periodos: { P2: 21413, P3: 12488, P6: 23059 },
    fuenteImagen: "33-7F1A4355-1D36-4BFC-86BD-37EDEE3935F6.png",
  },
  {
    factura: "P26CON000079840",
    fechaFactura: "2026-01-03",
    fechaInicio: "2025-12-01",
    fechaFin: "2025-12-31",
    kwh: 69880,
    periodos: { P1: 26496, P2: 16103, P6: 27281 },
    fuenteImagen: "31-110E1053-39EE-4868-B04D-35A4DEA5B72D.png",
  },
  {
    factura: "P26CON005639246",
    fechaFactura: "2026-02-07",
    fechaInicio: "2026-01-01",
    fechaFin: "2026-01-31",
    kwh: 55086,
    periodos: { P1: 20678, P2: 11933, P6: 22475 },
    fuenteImagen: "29-291BF214-2480-4B4E-BEA5-27321145DAF7.png",
  },
  {
    factura: "P26CON011289148",
    fechaFactura: "2026-03-12",
    fechaInicio: "2026-02-01",
    fechaFin: "2026-02-28",
    kwh: 74563,
    periodos: { P1: 28307, P2: 21172, P6: 25084 },
    fuenteImagen: "27-59522726-981E-4F4E-8CC6-9C5ABD864E29.png",
  },
  {
    factura: "P26CON014259182",
    fechaFactura: "2026-04-02",
    fechaInicio: "2026-03-01",
    fechaFin: "2026-03-31",
    kwh: 87560,
    periodos: { P2: 32262, P3: 24825, P6: 30473 },
    fuenteImagen: "25-E5A0DA99-9DB4-4D13-B11F-863B4D3692B6.png",
  },
  {
    factura: "P26CON018813639",
    fechaFactura: "2026-05-05",
    fechaInicio: "2026-04-01",
    fechaFin: "2026-04-30",
    kwh: 72050,
    periodos: { P4: 27891, P5: 19778, P6: 24381 },
    fuenteImagen: "23-3FFA103F-2C14-4287-8E57-CDF95C82ED19.png",
  },
  {
    factura: "P26CON023691600",
    fechaFactura: "2026-06-03",
    fechaInicio: "2026-05-01",
    fechaFin: "2026-05-31",
    kwh: 82311,
    periodos: { P4: 30191, P5: 20820, P6: 31300 },
    fuenteImagen: "21-2DEE4559-E2A2-44B0-8071-B69284C91A40.png",
  },
];

export const CAMPANA_2025_2026_VENTAS_KG: Campana2025_2026VentasKg[] = [
  { periodo: "2025-09", fechaInicio: "2025-09-01", fechaFin: "2025-09-30", kgPositivos: 78332, kgNegativos: 0, kgNetos: 78332 },
  { periodo: "2025-10", fechaInicio: "2025-10-01", fechaFin: "2025-10-31", kgPositivos: 44609, kgNegativos: 0, kgNetos: 44609 },
  { periodo: "2025-11", fechaInicio: "2025-11-01", fechaFin: "2025-11-30", kgPositivos: 1527734, kgNegativos: 0, kgNetos: 1527734 },
  { periodo: "2025-12", fechaInicio: "2025-12-01", fechaFin: "2025-12-31", kgPositivos: 1976216, kgNegativos: -1008, kgNetos: 1975208 },
  { periodo: "2026-01", fechaInicio: "2026-01-01", fechaFin: "2026-01-31", kgPositivos: 2210574, kgNegativos: -17268, kgNetos: 2193306 },
  { periodo: "2026-02", fechaInicio: "2026-02-01", fechaFin: "2026-02-28", kgPositivos: 2614130, kgNegativos: -3964, kgNetos: 2610166 },
  { periodo: "2026-03", fechaInicio: "2026-03-01", fechaFin: "2026-03-31", kgPositivos: 2692303, kgNegativos: -26605, kgNetos: 2665698 },
  { periodo: "2026-04", fechaInicio: "2026-04-01", fechaFin: "2026-04-30", kgPositivos: 2223991, kgNegativos: -12.27, kgNetos: 2223978.73 },
  { periodo: "2026-05", fechaInicio: "2026-05-01", fechaFin: "2026-05-31", kgPositivos: 1956048, kgNegativos: 0, kgNetos: 1956048 },
  { periodo: "2026-06", fechaInicio: "2026-06-01", fechaFin: "2026-06-30", kgPositivos: 933625, kgNegativos: -3700, kgNetos: 929925 },
];

export function buildFacturasCampana2025_2026Rows(userId: string): ConsumoFisicoRow[] {
  const gasoilRows = FACTURAS_CAMPANA_2025_2026_CONSUMOS.map((row) => ({
    id: `factura-2025-2026-gasoil-${row.fecha}-${slug(row.factura)}-${slug(row.albaran)}`,
    user_id: userId,
    recurso: "gasoil",
    fecha_inicio: row.fecha,
    fecha_fin: row.fecha,
    cantidad: row.litros,
    unidad: "l",
    fuente: "factura_detallada",
    referencia: `${row.factura} / ${row.albaran}`,
    notas: `Campana 2025/2026. Importado de facturas 2526. Articulo: ${row.articulo}. Precio: ${row.precio.toFixed(3)}. Importe: ${row.importe.toFixed(2)}.`,
    created_at: "2026-06-12T00:00:00.000Z",
  } satisfies ConsumoFisicoRow));
  const aguaRows = FACTURAS_CAMPANA_2025_2026_AGUA_CONSUMOS.map((row) => ({
    id: `factura-2025-2026-agua-${slug(row.factura)}`,
    user_id: userId,
    recurso: "agua",
    fecha_inicio: row.fechaInicio,
    fecha_fin: row.fechaFin,
    cantidad: row.m3,
    unidad: "m3",
    fuente: "factura_detallada",
    referencia: row.factura,
    notas: `Campana 2025/2026. Aqua Campina ${row.facturacion}. Documento: ${row.documento}. Lecturas: ${row.lecturaAnterior} -> ${row.lecturaActual}. Dias: ${row.dias}. Fuente: ${row.fuenteImagen}.`,
    created_at: "2026-06-12T00:00:00.000Z",
  } satisfies ConsumoFisicoRow));
  const electricidadRows = FACTURAS_CAMPANA_2025_2026_ELECTRICIDAD_CONSUMOS.map((row) => ({
    id: `factura-2025-2026-electricidad-${slug(row.factura)}`,
    user_id: userId,
    recurso: "electricidad",
    fecha_inicio: row.fechaInicio,
    fecha_fin: row.fechaFin,
    cantidad: row.kwh,
    unidad: "kwh",
    fuente: "factura_detallada",
    referencia: row.factura,
    notas: `Campana 2025/2026. Endesa. Fecha factura: ${row.fechaFactura}. Energia activa: ${formatPeriodos(row.periodos)}. Fuente: ${row.fuenteImagen}.`,
    created_at: "2026-06-12T00:00:00.000Z",
  } satisfies ConsumoFisicoRow));

  return [...gasoilRows, ...aguaRows, ...electricidadRows];
}

export function mergeFacturasCampana2025_2026Consumos(
  userId: string,
  existing: ConsumoFisicoRow[],
): ConsumoFisicoRow[] {
  const shippedRows = buildFacturasCampana2025_2026Rows(userId);
  const newRows = shippedRows.filter((shippedRow) => (
    !existing.some((existingRow) => equivalentConsumo(existingRow, shippedRow))
  ));

  return [...existing, ...newRows];
}

export function buildCampana2025_2026BasesKgRows(userId: string): ConsumoBaseKgRow[] {
  return CAMPANA_2025_2026_VENTAS_KG.map((row) => ({
    id: `campana-2025-2026-ventas-${row.periodo}`,
    user_id: userId,
    tipo_base: "ventas",
    fecha_inicio: row.fechaInicio,
    fecha_fin: row.fechaFin,
    kg: row.kgNetos,
    referencia: `ventas campana 2526.xlsx:${row.periodo}`,
    notas: `Campana 2025/2026. Kg vendidos netos desde ventas campana 2526.xlsx. Positivos: ${row.kgPositivos} kg. Devoluciones/rectificativas: ${row.kgNegativos} kg.`,
    created_at: "2026-06-12T00:00:00.000Z",
  }));
}

export function mergeCampana2025_2026BasesKg(
  userId: string,
  existing: ConsumoBaseKgRow[],
): ConsumoBaseKgRow[] {
  const shippedRows = buildCampana2025_2026BasesKgRows(userId);
  const newRows = shippedRows.filter((shippedRow) => (
    !existing.some((existingRow) => equivalentBaseKg(existingRow, shippedRow))
  ));

  return [...existing, ...newRows];
}

function equivalentConsumo(a: ConsumoFisicoRow, b: ConsumoFisicoRow): boolean {
  return (
    a.recurso === b.recurso
    && a.fecha_inicio === b.fecha_inicio
    && a.fecha_fin === b.fecha_fin
    && a.unidad === b.unidad
    && Math.abs(Number(a.cantidad) - Number(b.cantidad)) < 0.0001
    && normalizeReference(a.referencia) === normalizeReference(b.referencia)
  );
}

function equivalentBaseKg(a: ConsumoBaseKgRow, b: ConsumoBaseKgRow): boolean {
  return (
    a.tipo_base === b.tipo_base
    && a.fecha_inicio === b.fecha_inicio
    && a.fecha_fin === b.fecha_fin
    && Math.abs(Number(a.kg) - Number(b.kg)) < 0.0001
    && normalizeReference(a.referencia) === normalizeReference(b.referencia)
  );
}

function normalizeReference(value: string | null): string {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function slug(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function formatPeriodos(periodos: FacturaElectricidadCampana2025_2026["periodos"]): string {
  return Object.entries(periodos)
    .map(([periodo, kwh]) => `${periodo} ${kwh} kWh`)
    .join(", ");
}

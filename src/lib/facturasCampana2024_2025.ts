import type { ConsumoBaseKgRow, ConsumoFisicoRow } from "@/lib/types";

export const FACTURAS_CAMPANA_2024_2025_RANGE = {
  id: "2024-2025",
  label: "Campana 2024/2025",
  fechaInicio: "2024-09-01",
  fechaFin: "2025-08-31",
} as const;

interface FacturaGasoilCampana2024_2025 {
  fecha: string;
  factura: string;
  albaran: string;
  articulo: string;
  litros: number;
  precio: number;
  importe: number;
}

interface FacturaAguaCampana2024_2025 {
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

interface FacturaElectricidadCampana2024_2025 {
  factura: string;
  fechaFactura: string;
  fechaInicio: string;
  fechaFin: string;
  kwh: number;
  periodos: Partial<Record<"P1" | "P2" | "P3" | "P4" | "P5" | "P6", number>>;
  fuenteImagen: string;
}

interface Campana2024_2025VentasKg {
  periodo: string;
  fechaInicio: string;
  fechaFin: string;
  kgPositivos: number;
  kgNegativos: number;
  kgNetos: number;
}

export type FacturaContableCampana2024_2025Recurso = "agua" | "electricidad";

export interface FacturaContableCampana2024_2025 {
  recurso: FacturaContableCampana2024_2025Recurso;
  archivo: string;
  fecha: string;
  concepto: string;
  importe: number;
  referencia: string | null;
  motivo: string;
}

export const FACTURAS_CAMPANA_2024_2025_CONSUMOS: FacturaGasoilCampana2024_2025[] = [
  { fecha: "2024-11-07", factura: "24 1923", albaran: "03 91827", articulo: "GASOIL AGRODIESEL E+10 GOB", litros: 801, precio: 0.785, importe: 628.79 },
  { fecha: "2024-11-15", factura: "24 1923", albaran: "03 91890", articulo: "GASOIL AGRODIESEL E+10 GOB", litros: 700, precio: 0.772, importe: 540.40 },
  { fecha: "2024-11-25", factura: "24 1923", albaran: "03 91951", articulo: "GASOIL AGRODIESEL E+10 GOB", litros: 900, precio: 0.810, importe: 729.00 },
  { fecha: "2024-12-04", factura: "24 2173", albaran: "2240299", articulo: "GASOIL AGRODIESEL E+10 GOB", litros: 730, precio: 0.810, importe: 591.30 },
  { fecha: "2024-12-16", factura: "24 2173", albaran: "92089", articulo: "GASOIL AGRODIESEL E+10 GOB", litros: 1350, precio: 0.810, importe: 1093.50 },
  { fecha: "2024-12-20", factura: "24 2173", albaran: "92144", articulo: "GASOIL AGRODIESEL E+10 GOB", litros: 600, precio: 0.810, importe: 486.00 },
  { fecha: "2024-12-27", factura: "24 2173", albaran: "92186", articulo: "GASOIL AGRODIESEL E+10 GOB", litros: 900, precio: 0.810, importe: 729.00 },
  { fecha: "2025-01-07", factura: "25 125", albaran: "02250008", articulo: "GASOIL AGRODIESEL E+10 GOB", litros: 1100, precio: 0.825, importe: 907.50 },
  { fecha: "2025-01-13", factura: "25 125", albaran: "09 90041", articulo: "GASOIL AGRODIESEL E+10 GOB", litros: 900, precio: 0.820, importe: 738.00 },
  { fecha: "2025-01-17", factura: "25 125", albaran: "09 90076", articulo: "GASOIL AGRODIESEL E+10 GOB", litros: 800, precio: 0.869, importe: 695.20 },
  { fecha: "2025-01-23", factura: "25 125", albaran: "09 90108", articulo: "GASOIL AGRODIESEL E+10 GOB", litros: 850, precio: 0.875, importe: 743.75 },
  { fecha: "2025-01-30", factura: "25 125", albaran: "02250042", articulo: "GASOIL AGRODIESEL E+10 GOB", litros: 900, precio: 0.835, importe: 751.50 },
  { fecha: "2025-02-06", factura: "25 295", albaran: "2250055", articulo: "GASOIL AGRODIESEL E+10 GOB", litros: 950, precio: 0.845, importe: 802.75 },
  { fecha: "2025-02-13", factura: "25 295", albaran: "90208", articulo: "GASOIL AGRODIESEL E+10 GOB", litros: 850, precio: 0.842, importe: 715.70 },
  { fecha: "2025-02-20", factura: "25 295", albaran: "90260", articulo: "GASOIL AGRODIESEL E+10 GOB", litros: 1000, precio: 0.840, importe: 840.00 },
  { fecha: "2025-02-27", factura: "25 295", albaran: "90308", articulo: "GASOIL AGRODIESEL E+10 GOB", litros: 900, precio: 0.835, importe: 751.50 },
  { fecha: "2025-03-06", factura: "25 459", albaran: "90339", articulo: "GASOIL AGRODIESEL E+10 GOB", litros: 850, precio: 0.815, importe: 692.75 },
  { fecha: "2025-03-12", factura: "25 459", albaran: "90362", articulo: "GASOIL AGRODIESEL E+10 GOB", litros: 800, precio: 0.785, importe: 628.00 },
  { fecha: "2025-03-19", factura: "25 459", albaran: "2250090", articulo: "GASOIL AGRODIESEL E+10 GOB", litros: 800, precio: 0.775, importe: 620.00 },
  { fecha: "2025-03-26", factura: "25 459", albaran: "90418", articulo: "GASOIL AGRODIESEL E+10 GOB", litros: 800, precio: 0.765, importe: 612.00 },
  { fecha: "2025-04-02", factura: "25 634", albaran: "91470", articulo: "GASOIL AGRODIESEL E+10 GOB", litros: 700, precio: 0.778, importe: 544.60 },
  { fecha: "2025-04-10", factura: "25 634", albaran: "250096", articulo: "GASOIL AGRODIESEL E+10 GOB", litros: 660, precio: 0.730, importe: 481.80 },
  { fecha: "2025-04-21", factura: "25 634", albaran: "90568", articulo: "GASOIL AGRODIESEL E+10 GOB", litros: 851, precio: 0.720, importe: 612.72 },
  { fecha: "2025-04-28", factura: "25 634", albaran: "90636", articulo: "GASOIL AGRODIESEL E+10 GOB", litros: 600, precio: 0.730, importe: 438.00 },
  { fecha: "2025-05-06", factura: "25 818", albaran: "90664", articulo: "GASOIL AGRODIESEL E+10 GOB", litros: 550, precio: 0.718, importe: 394.90 },
  { fecha: "2025-05-15", factura: "25 818", albaran: "90727", articulo: "GASOIL AGRODIESEL E+10 GOB", litros: 750, precio: 0.730, importe: 547.50 },
  { fecha: "2025-05-27", factura: "25 818", albaran: "250140", articulo: "GASOIL AGRODIESEL E+10 GOB", litros: 730, precio: 0.707, importe: 516.11 },
  { fecha: "2025-06-05", factura: "25 1044", albaran: "90855", articulo: "GASOIL AGRODIESEL E+10 GOB", litros: 700, precio: 0.725, importe: 507.50 },
  { fecha: "2025-06-18", factura: "25 1044", albaran: "2250206", articulo: "GASOIL AGRODIESEL E+10 GOB", litros: 400, precio: 0.765, importe: 306.00 },
  { fecha: "2025-07-18", factura: "25 1232", albaran: "91134", articulo: "GASOIL AGRODIESEL E+10 GOB", litros: 1050, precio: 0.785, importe: 824.25 },
  { fecha: "2025-08-25", factura: "25 1378", albaran: "91360", articulo: "GASOIL AGRODIESEL E+10 GOB", litros: 300, precio: 0.740, importe: 222.00 },
];

export const FACTURAS_CAMPANA_2024_2025_AGUA_CONSUMOS: FacturaAguaCampana2024_2025[] = [
  {
    factura: "1778240IP0013217",
    documento: "1778240IP0093278",
    facturacion: "Septiembre-Octubre/2024",
    fechaEmision: "2024-10-25",
    fechaInicio: "2024-08-20",
    fechaFin: "2024-10-21",
    lecturaAnterior: 34188,
    lecturaActual: 34367,
    dias: 62,
    m3: 179,
    fuenteImagen: "11-14DF0CD4-AEAF-4339-90D1-C1380108E0A4.png",
  },
  {
    factura: "1778240IP0015849",
    documento: "1778240IP0111787",
    facturacion: "Noviembre-Diciembre/2024",
    fechaEmision: "2024-12-23",
    fechaInicio: "2024-10-21",
    fechaFin: "2024-12-17",
    lecturaAnterior: 34367,
    lecturaActual: 34668,
    dias: 57,
    m3: 301,
    fuenteImagen: "09-9237F854-4B46-485A-AC7D-7761FFBA64F5.png",
  },
  {
    factura: "1778250IP0002660",
    documento: "1778250IP0018534",
    facturacion: "Enero-Febrero/2025",
    fechaEmision: "2025-02-24",
    fechaInicio: "2024-12-17",
    fechaFin: "2025-02-18",
    lecturaAnterior: 34668,
    lecturaActual: 35122,
    dias: 63,
    m3: 454,
    fuenteImagen: "07-1C7DC3E8-1B1A-4119-89ED-F586B4B415D6.png",
  },
  {
    factura: "1778250IP0005285",
    documento: "1778250IP0037051",
    facturacion: "Marzo-Abril/2025",
    fechaEmision: "2025-04-23",
    fechaInicio: "2025-02-18",
    fechaFin: "2025-04-15",
    lecturaAnterior: 35122,
    lecturaActual: 36069,
    dias: 56,
    m3: 947,
    fuenteImagen: "05-7451243E-E428-4CD3-B60C-0C62720EE4E8.png",
  },
  {
    factura: "1778250IP0007948",
    documento: "1778250IP0055189",
    facturacion: "Mayo-Junio/2025",
    fechaEmision: "2025-06-24",
    fechaInicio: "2025-04-15",
    fechaFin: "2025-06-17",
    lecturaAnterior: 36069,
    lecturaActual: 36577,
    dias: 63,
    m3: 508,
    fuenteImagen: "03-5CE25ABF-E82F-4DEE-982B-C5FA6B1807B8.png",
  },
  {
    factura: "1778250IP0010647",
    documento: "1778250IP0073875",
    facturacion: "Julio-Agosto/2025",
    fechaEmision: "2025-08-25",
    fechaInicio: "2025-06-17",
    fechaFin: "2025-08-19",
    lecturaAnterior: 36577,
    lecturaActual: 37193,
    dias: 63,
    m3: 616,
    fuenteImagen: "01-06DDA5FC-EDEE-4157-9BDD-66CE37FAEECC.png",
  },
];

export const FACTURAS_CAMPANA_2024_2025_ELECTRICIDAD_CONSUMOS: FacturaElectricidadCampana2024_2025[] = [
  {
    factura: "P24CON039897073",
    fechaFactura: "2024-10-04",
    fechaInicio: "2024-09-01",
    fechaFin: "2024-09-30",
    kwh: 23893,
    periodos: { P3: 7575, P4: 5389, P6: 10929 },
    fuenteImagen: "50-FEE704C1-EA0D-4F4C-B897-FD0147211017.png",
  },
  {
    factura: "P24CON046421872",
    fechaFactura: "2024-11-13",
    fechaInicio: "2024-10-01",
    fechaFin: "2024-10-31",
    kwh: 15031,
    periodos: { P4: 5876, P5: 3742, P6: 5413 },
    fuenteImagen: "48-253337C8-C634-4A94-9022-3947D8E771D2.png",
  },
  {
    factura: "P24CON050096552",
    fechaFactura: "2024-12-05",
    fechaInicio: "2024-11-01",
    fechaFin: "2024-11-06",
    kwh: 7680,
    periodos: { P2: 2450, P3: 1822, P6: 3408 },
    fuenteImagen: "46-F2456744-09EC-4807-A47B-ED6FF68B9463.png",
  },
  {
    factura: "P24CON050347223",
    fechaFactura: "2024-12-07",
    fechaInicio: "2024-11-07",
    fechaFin: "2024-11-30",
    kwh: 42559,
    periodos: { P2: 15879, P3: 10750, P6: 15930 },
    fuenteImagen: "44-5CE52511-9972-4149-A46B-127FE7447D2C.png",
  },
  {
    factura: "P25CON000179203",
    fechaFactura: "2025-01-05",
    fechaInicio: "2024-12-01",
    fechaFin: "2024-12-31",
    kwh: 66527,
    periodos: { P1: 22945, P2: 17317, P6: 26265 },
    fuenteImagen: "42-55B47AE2-0D34-40C4-AEF2-B4E166D04005.png",
  },
  {
    factura: "P25CON007000738",
    fechaFactura: "2025-02-13",
    fechaInicio: "2025-01-01",
    fechaFin: "2025-01-31",
    kwh: 58513,
    periodos: { P1: 21655, P2: 15719, P6: 21139 },
    fuenteImagen: "40-28A2EB7D-C8C9-4D95-93C4-8B6A019EC048.png",
  },
  {
    factura: "P25CON010437866",
    fechaFactura: "2025-03-06",
    fechaInicio: "2025-02-01",
    fechaFin: "2025-02-28",
    kwh: 62091,
    periodos: { P1: 23968, P2: 17728, P6: 20395 },
    fuenteImagen: "37-2D66B8DB-A727-48A0-9AD9-CF7DE00A630D.png",
  },
  {
    factura: "P25CON015361044",
    fechaFactura: "2025-04-04",
    fechaInicio: "2025-03-01",
    fechaFin: "2025-03-31",
    kwh: 58489,
    periodos: { P2: 22280, P3: 15912, P6: 20297 },
    fuenteImagen: "36-CD60D00E-2148-4B21-A7D0-749A3E7C07A6.png",
  },
  {
    factura: "P25CON022824878",
    fechaFactura: "2025-05-13",
    fechaInicio: "2025-04-01",
    fechaFin: "2025-04-30",
    kwh: 70621,
    periodos: { P4: 26780, P5: 19167, P6: 24674 },
    fuenteImagen: "34-8F4D89C0-67FB-4565-8BA3-58F2A045104F.png",
  },
  {
    factura: "P25CON026558753",
    fechaFactura: "2025-06-05",
    fechaInicio: "2025-05-01",
    fechaFin: "2025-05-31",
    kwh: 88825,
    periodos: { P4: 31799, P5: 22645, P6: 34381 },
    fuenteImagen: "32-DA9A6235-E5F4-4EBC-92FC-3F00375CB2D6.png",
  },
  {
    factura: "P25CON031632319",
    fechaFactura: "2025-07-05",
    fechaInicio: "2025-06-01",
    fechaFin: "2025-06-30",
    kwh: 98020,
    periodos: { P3: 31643, P4: 22668, P6: 43709 },
    fuenteImagen: "29-B593D9C6-FACD-4744-8ECF-6BE4955142EB.png",
  },
  {
    factura: "P25CON036846520",
    fechaFactura: "2025-08-07",
    fechaInicio: "2025-07-01",
    fechaFin: "2025-07-14",
    kwh: 41015,
    periodos: { P1: 13022, P2: 8748, P6: 19245 },
    fuenteImagen: "27-A9911DC4-75B2-4495-A63A-7AEA51D3B2AB.png",
  },
  {
    factura: "P25CON037143251",
    fechaFactura: "2025-08-08",
    fechaInicio: "2025-07-15",
    fechaFin: "2025-07-31",
    kwh: 45319,
    periodos: { P1: 15228, P2: 11011, P6: 19080 },
    fuenteImagen: "25-A5930D3C-5C2F-4E19-92DB-8D0B0D7CF2F1.png",
  },
  {
    factura: "P25CON041019915",
    fechaFactura: "2025-09-02",
    fechaInicio: "2025-08-01",
    fechaFin: "2025-08-31",
    kwh: 61285,
    periodos: { P3: 17846, P4: 12369, P6: 31070 },
    fuenteImagen: "23-4A3B71BF-F76D-47D6-8C48-FB5AD5D4EE60.png",
  },
];

export const CAMPANA_2024_2025_VENTAS_KG: Campana2024_2025VentasKg[] = [
  { periodo: "2024-09", fechaInicio: "2024-09-01", fechaFin: "2024-09-30", kgPositivos: 213813, kgNegativos: 0, kgNetos: 213813 },
  { periodo: "2024-10", fechaInicio: "2024-10-01", fechaFin: "2024-10-31", kgPositivos: 69464, kgNegativos: 0, kgNetos: 69464 },
  { periodo: "2024-11", fechaInicio: "2024-11-01", fechaFin: "2024-11-30", kgPositivos: 2063608, kgNegativos: -131324, kgNetos: 1932284 },
  { periodo: "2024-12", fechaInicio: "2024-12-01", fechaFin: "2024-12-31", kgPositivos: 2857405, kgNegativos: -51230, kgNetos: 2806175 },
  { periodo: "2025-01", fechaInicio: "2025-01-01", fechaFin: "2025-01-31", kgPositivos: 2813148, kgNegativos: 0, kgNetos: 2813148 },
  { periodo: "2025-02", fechaInicio: "2025-02-01", fechaFin: "2025-02-28", kgPositivos: 2727218, kgNegativos: 0, kgNetos: 2727218 },
  { periodo: "2025-03", fechaInicio: "2025-03-01", fechaFin: "2025-03-31", kgPositivos: 2862926, kgNegativos: 0, kgNetos: 2862926 },
  { periodo: "2025-04", fechaInicio: "2025-04-01", fechaFin: "2025-04-30", kgPositivos: 2596633, kgNegativos: 0, kgNetos: 2596633 },
  { periodo: "2025-05", fechaInicio: "2025-05-01", fechaFin: "2025-05-31", kgPositivos: 2331033, kgNegativos: 0, kgNetos: 2331033 },
  { periodo: "2025-06", fechaInicio: "2025-06-01", fechaFin: "2025-06-30", kgPositivos: 1953513, kgNegativos: 0, kgNetos: 1953513 },
  { periodo: "2025-07", fechaInicio: "2025-07-01", fechaFin: "2025-07-31", kgPositivos: 1683357, kgNegativos: -41, kgNetos: 1683316 },
  { periodo: "2025-08", fechaInicio: "2025-08-01", fechaFin: "2025-08-31", kgPositivos: 1362874, kgNegativos: -135800, kgNetos: 1227074 },
];

export const FACTURAS_CAMPANA_2024_2025_FACTURAS_CONTABLES: FacturaContableCampana2024_2025[] = [
  { recurso: "agua", archivo: "2024-2025-AGUA.xls", fecha: "2024-10-31", concepto: "S/FRA. P0093278", importe: 552.77, referencia: "P0093278", motivo: "Extracto contable con importes; no incluye litros ni m3." },
  { recurso: "agua", archivo: "2024-2025-AGUA.xls", fecha: "2024-12-31", concepto: "S/FRA. P0111787", importe: 931.08, referencia: "P0111787", motivo: "Extracto contable con importes; no incluye litros ni m3." },
  { recurso: "agua", archivo: "2024-2025-AGUA.xls", fecha: "2025-02-24", concepto: "FRA. 18534 AQUA CAMPIÑA", importe: 1398.95, referencia: "18534", motivo: "Extracto contable con importes; no incluye litros ni m3." },
  { recurso: "agua", archivo: "2024-2025-AGUA.xls", fecha: "2025-04-30", concepto: "S/FRA. P0037051", importe: 2998.03, referencia: "P0037051", motivo: "Extracto contable con importes; no incluye litros ni m3." },
  { recurso: "agua", archivo: "2024-2025-AGUA.xls", fecha: "2025-06-30", concepto: "S/FRA. P0055189", importe: 1607.28, referencia: "P0055189", motivo: "Extracto contable con importes; no incluye litros ni m3." },
  { recurso: "agua", archivo: "2024-2025-AGUA.xls", fecha: "2025-08-31", concepto: "FRA. 73875 AQUA CAMPIÑA", importe: 1951.96, referencia: "73875", motivo: "Extracto contable con importes; no incluye litros ni m3." },
  { recurso: "electricidad", archivo: "2024-2025-ELECTRICIDAD.xls", fecha: "2024-09-30", concepto: "CONSUMO SEPTIEMBRE ENDESA", importe: 3195.09, referencia: null, motivo: "Extracto contable con importes; no incluye kWh." },
  { recurso: "electricidad", archivo: "2024-2025-ELECTRICIDAD.xls", fecha: "2024-10-31", concepto: "CONSUMO OCTUBRE", importe: 2366.48, referencia: null, motivo: "Extracto contable con importes; no incluye kWh." },
  { recurso: "electricidad", archivo: "2024-2025-ELECTRICIDAD.xls", fecha: "2024-11-30", concepto: "CONSUMO NOVIEMBRE", importe: 979.80, referencia: null, motivo: "Extracto contable con importes; no incluye kWh." },
  { recurso: "electricidad", archivo: "2024-2025-ELECTRICIDAD.xls", fecha: "2024-11-30", concepto: "CONSUMO NOVIEMBRE", importe: 5151.29, referencia: null, motivo: "Extracto contable con importes; no incluye kWh." },
  { recurso: "electricidad", archivo: "2024-2025-ELECTRICIDAD.xls", fecha: "2024-12-31", concepto: "CONSUMO DICIEMBRE", importe: 9084.09, referencia: null, motivo: "Extracto contable con importes; no incluye kWh." },
  { recurso: "electricidad", archivo: "2024-2025-ELECTRICIDAD.xls", fecha: "2025-01-31", concepto: "CONSUMO ENERO", importe: 8402.17, referencia: null, motivo: "Extracto contable con importes; no incluye kWh." },
  { recurso: "electricidad", archivo: "2024-2025-ELECTRICIDAD.xls", fecha: "2025-02-28", concepto: "CONSUMO FEBRERO", importe: 9118.55, referencia: null, motivo: "Extracto contable con importes; no incluye kWh." },
  { recurso: "electricidad", archivo: "2024-2025-ELECTRICIDAD.xls", fecha: "2025-02-28", concepto: "FRA. 29734 ENDESA", importe: 93.02, referencia: "29734", motivo: "Extracto contable con importes; no incluye kWh." },
  { recurso: "electricidad", archivo: "2024-2025-ELECTRICIDAD.xls", fecha: "2025-03-31", concepto: "CONSUMO MARZO", importe: 7071.39, referencia: null, motivo: "Extracto contable con importes; no incluye kWh." },
  { recurso: "electricidad", archivo: "2024-2025-ELECTRICIDAD.xls", fecha: "2025-04-30", concepto: "CONSUMO ABRIL", importe: 6458.96, referencia: null, motivo: "Extracto contable con importes; no incluye kWh." },
  { recurso: "electricidad", archivo: "2024-2025-ELECTRICIDAD.xls", fecha: "2025-05-31", concepto: "FRA. 58753 ENDESA", importe: 7907.63, referencia: "58753", motivo: "Extracto contable con importes; no incluye kWh." },
  { recurso: "electricidad", archivo: "2024-2025-ELECTRICIDAD.xls", fecha: "2025-06-30", concepto: "FRA. ENDESA 31632319", importe: 9522.05, referencia: "31632319", motivo: "Extracto contable con importes; no incluye kWh." },
  { recurso: "electricidad", archivo: "2024-2025-ELECTRICIDAD.xls", fecha: "2025-07-31", concepto: "FRA. 56520 ENDESA", importe: 7781.89, referencia: "56520", motivo: "Extracto contable con importes; no incluye kWh." },
  { recurso: "electricidad", archivo: "2024-2025-ELECTRICIDAD.xls", fecha: "2025-07-31", concepto: "FRA. 43251 ENDESA", importe: 6884.65, referencia: "43251", motivo: "Extracto contable con importes; no incluye kWh." },
  { recurso: "electricidad", archivo: "2024-2025-ELECTRICIDAD.xls", fecha: "2025-08-31", concepto: "FRA. ENDESA 19915", importe: 7408.22, referencia: "19915", motivo: "Extracto contable con importes; no incluye kWh." },
];

export function totalFacturaContablePorRecurso(recurso: FacturaContableCampana2024_2025Recurso): number {
  return FACTURAS_CAMPANA_2024_2025_FACTURAS_CONTABLES
    .filter((row) => row.recurso === recurso)
    .reduce((total, row) => total + row.importe, 0);
}

export function buildFacturasCampana2024_2025Rows(userId: string): ConsumoFisicoRow[] {
  const gasoilRows = FACTURAS_CAMPANA_2024_2025_CONSUMOS.map((row) => ({
    id: `factura-2024-2025-gasoil-${row.fecha}-${slug(row.factura)}-${slug(row.albaran)}`,
    user_id: userId,
    recurso: "gasoil",
    fecha_inicio: row.fecha,
    fecha_fin: row.fecha,
    cantidad: row.litros,
    unidad: "l",
    fuente: "factura_detallada",
    referencia: `${row.factura} / ${row.albaran}`,
    notas: `Campana 2024/2025. Importado de 2024-2025-GASOIL.xls. Articulo: ${row.articulo}. Precio: ${row.precio.toFixed(3)}. Importe: ${row.importe.toFixed(2)}.`,
    created_at: "2026-06-12T00:00:00.000Z",
  }));
  const aguaRows = FACTURAS_CAMPANA_2024_2025_AGUA_CONSUMOS.map((row) => {
    const periodoFacturado = facturacionToRange(row.facturacion);

    return {
      id: `factura-2024-2025-agua-${slug(row.factura)}`,
      user_id: userId,
      recurso: "agua",
      fecha_inicio: periodoFacturado.fechaInicio,
      fecha_fin: periodoFacturado.fechaFin,
      cantidad: row.m3,
      unidad: "m3",
      fuente: "factura_detallada",
      referencia: row.factura,
      notas: `Campana 2024/2025. Aqua Campina ${row.facturacion}. Documento: ${row.documento}. Lecturas: ${row.lecturaAnterior} -> ${row.lecturaActual}. Rango lectura: ${row.fechaInicio} -> ${row.fechaFin}. Dias: ${row.dias}. Fuente: ${row.fuenteImagen}.`,
      created_at: "2026-06-12T00:00:00.000Z",
    } satisfies ConsumoFisicoRow;
  });
  const electricidadRows = FACTURAS_CAMPANA_2024_2025_ELECTRICIDAD_CONSUMOS.map((row) => ({
    id: `factura-2024-2025-electricidad-${slug(row.factura)}`,
    user_id: userId,
    recurso: "electricidad",
    fecha_inicio: row.fechaInicio,
    fecha_fin: row.fechaFin,
    cantidad: row.kwh,
    unidad: "kwh",
    fuente: "factura_detallada",
    referencia: row.factura,
    notas: `Campana 2024/2025. Endesa. Fecha factura: ${row.fechaFactura}. Energia activa: ${formatPeriodos(row.periodos)}. Fuente: ${row.fuenteImagen}.`,
    created_at: "2026-06-12T00:00:00.000Z",
  } satisfies ConsumoFisicoRow));

  return [...gasoilRows, ...aguaRows, ...electricidadRows];
}

export function mergeFacturasCampana2024_2025Consumos(
  userId: string,
  existing: ConsumoFisicoRow[],
): ConsumoFisicoRow[] {
  const shippedRows = buildFacturasCampana2024_2025Rows(userId);
  const externalRows = existing.filter((existingRow) => (
    !shippedRows.some((shippedRow) => equivalentConsumo(existingRow, shippedRow))
  ));

  return [...externalRows, ...shippedRows];
}

export function buildCampana2024_2025BasesKgRows(userId: string): ConsumoBaseKgRow[] {
  return CAMPANA_2024_2025_VENTAS_KG.map((row) => ({
    id: `campana-2024-2025-ventas-${row.periodo}`,
    user_id: userId,
    tipo_base: "ventas",
    fecha_inicio: row.fechaInicio,
    fecha_fin: row.fechaFin,
    kg: row.kgNetos,
    referencia: `campana2425.xlsx:${row.periodo}`,
    notas: `Campana 2024/2025. Kg vendidos netos desde campana2425.xlsx. Positivos: ${row.kgPositivos} kg. Devoluciones/rectificativas: ${row.kgNegativos} kg.`,
    created_at: "2026-06-12T00:00:00.000Z",
  }));
}

export function mergeCampana2024_2025BasesKg(
  userId: string,
  existing: ConsumoBaseKgRow[],
): ConsumoBaseKgRow[] {
  const shippedRows = buildCampana2024_2025BasesKgRows(userId);
  const externalRows = existing.filter((existingRow) => (
    !shippedRows.some((shippedRow) => equivalentBaseKg(existingRow, shippedRow))
  ));

  return [...externalRows, ...shippedRows];
}

function equivalentConsumo(a: ConsumoFisicoRow, b: ConsumoFisicoRow): boolean {
  if (
    relatedReference(a, b)
    && a.recurso === b.recurso
    && a.unidad === b.unidad
    && Math.abs(Number(a.cantidad) - Number(b.cantidad)) < 0.0001
  ) {
    return true;
  }

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
  if (a.tipo_base !== b.tipo_base || Math.abs(Number(a.kg) - Number(b.kg)) >= 0.0001) {
    return false;
  }

  if (normalizeReference(a.referencia) && normalizeReference(a.referencia) === normalizeReference(b.referencia)) {
    return true;
  }

  return (
    a.fecha_inicio === b.fecha_inicio
    && a.fecha_fin === b.fecha_fin
  );
}

function relatedReference(a: ConsumoFisicoRow, b: ConsumoFisicoRow): boolean {
  const aRef = normalizeReference(a.referencia);
  const bRef = normalizeReference(b.referencia);

  if (!aRef || !bRef) {
    return false;
  }

  if (aRef === bRef) {
    return true;
  }

  const aText = normalizeReference(`${a.referencia ?? ""} ${a.notas ?? ""}`);
  const bText = normalizeReference(`${b.referencia ?? ""} ${b.notas ?? ""}`);

  return aText.includes(bRef) || bText.includes(aRef);
}

function normalizeReference(value: string | null): string {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function slug(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function facturacionToRange(facturacion: string): { fechaInicio: string; fechaFin: string } {
  const [meses, yearText] = facturacion.split("/");
  const [primerMes, segundoMes] = meses.split("-").map((value) => monthNumber(value));
  const year = Number(yearText);

  return {
    fechaInicio: `${year}-${pad2(primerMes)}-01`,
    fechaFin: `${year}-${pad2(segundoMes)}-${pad2(daysInMonth(year, segundoMes))}`,
  };
}

function monthNumber(value: string): number {
  const normalized = value.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const months: Record<string, number> = {
    enero: 1,
    febrero: 2,
    marzo: 3,
    abril: 4,
    mayo: 5,
    junio: 6,
    julio: 7,
    agosto: 8,
    septiembre: 9,
    octubre: 10,
    noviembre: 11,
    diciembre: 12,
  };

  return months[normalized] ?? 1;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function formatPeriodos(periodos: FacturaElectricidadCampana2024_2025["periodos"]): string {
  return Object.entries(periodos)
    .map(([periodo, kwh]) => `${periodo} ${kwh} kWh`)
    .join(", ");
}

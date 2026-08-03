import { describe, expect, it } from "vitest";
import { clasificarArchivoBandeja, TIPO_BANDEJA_LABEL, type EntradaBandeja } from "./importBandeja";

// ─── Helpers de fixture ──────────────────────────────────────────────────────

/** Fila dispersa: pares [columna, valor] (como sheet_to_json con defval:null, huecos = undefined). */
function sparseRow(entries: Array<[number, unknown]>): unknown[] {
  const row: unknown[] = [];
  for (const [i, v] of entries) row[i] = v;
  return row;
}

function entrada(fileName: string, sheets: Record<string, unknown[][]> | null, anio = 2026): EntradaBandeja {
  return { fileName, sheets, anio };
}

// ── Fixture "Informe LOTE" (calibrador, un lote): cabecera en pares +
// Producto:/Calidad:/Clase: + mini-tabla Tamaño/Peso (kg), igual estructura
// que informeLote.test.ts pero minimizada. ──────────────────────────────────
function filasInformeLote(lote = "26043013"): unknown[][] {
  return [
    ["Nombre del Lote", lote],
    ["Commodity", "VALENCIA DELTA"],
    ["Productor / Código", "INVERMARMELO / 71"],
    ["Fecha y Hora de Comienzo", 46218.4694534375],
    ["Toneladas / Hora", "14,89 (14,89)*"],
    ["Peso de Fruta Promedio (g)", "216,84"],
    ["Tiempo Lote", "18:30:10"],
    [],
    ["Producto:", "MDNA 3KG D-PACK CAL 4/5"],
    ["Calidad:", "1"],
    ["Clase:", "(A) Extra 1", "Grupo de Clasificación:", "EXPORTACION"],
    ["Tamaño", "Piezas", "% Piezas", "Peso (kg)", "% Peso", "Cartons", "% Cartons"],
    ["(13) 1/36", 2, 0.0001, 10.5, 0.001, 1, 0.001],
    ["(14) 2/42", 22, 0.001, 20.3, 0.002, 2, 0.002],
  ];
}

/** Fixture de "pasada vacía": cabecera de lote válida pero sin ninguna sección Producto/Clase. */
function filasInformeLoteVacio(lote = "26060101"): unknown[][] {
  return [
    ["Nombre del Lote", lote],
    ["Commodity", "VALENCIA DELTA"],
  ];
}

// ── Fixture "Informe de tamaños/clase por PRODUCTOR" (calidadReferencias). ──
function filasInformeProductor(): unknown[][] {
  return [
    [],
    sparseRow([[15, "Nombre del Productor es  'MORATALLA'\nFecha de Lote es entre lunes, 1 de enero de 2026 y martes, 1 de julio de 2026"]]),
    [],
    sparseRow([[1, "Variedad:"], [14, "PRINCIPIO CAMPAÑA"]]),
    [],
    sparseRow([[7, "(A) Extra 1"]]),
    [],
    sparseRow([[4, "Tamaño"], [13, "Piezas"], [28, "Peso (kg)"]]),
    sparseRow([[4, "(01) CITRICA"], [28, 100]]),
    sparseRow([[4, "(02) 9/130"], [28, 50]]),
    [],
  ];
}

// ── Fixture "Informe PRODUCCIÓN" (historicoProduccion): cabecera con celdas
// combinadas (texto solo en la primera celda del rango), igual que el export real.
const HEADER_PRODUCCION: unknown[] = [
  "Nombre del Lote", "", "", "", "", "Código del Productor", "", "", "Nombre del Productor", "", "", "", "",
  "Variedad", "Bins", "", "Tiempo de Inicio", "", "", "", "", "Hora de la Máquina", "Peso (kg)", "", "",
  "Toneladas / Hora", "", "Peso de Fruta Promedio (g)",
];

function filasInformeProduccion(): unknown[][] {
  const fila = sparseRow([
    [0, "25101601"],
    [5, "8"],
    [8, "ESTACADA LARGA"],
    [13, "PRINCIPIO CAMPAÑA"],
    [16, new Date(2025, 9, 24, 5, 47, 29)],
    [21, "03:57:22"],
    [22, 12093.3578],
    [25, 3.05],
  ]);
  return [HEADER_PRODUCCION, fila];
}

// ── Fixture "Histórico de PALETS" (historicoPalets). ────────────────────────
const HEADER_PALETS = [
  "TipoPalet", "NºPalet", "Fecha", "Denominación Producto", "Lote", "DcmtoVta",
  "Fecha", "Cliente", "Cajas", "TipoCaja", "Netos", "Fact.", "Sit",
];
const FILA_PALET = [
  "PALET FRUTERO BLANCO 100X120", 356904, "24/10/2025", "NAR NAVELINA CAL4", "01251024",
  "Alb.C 15830", "25/10/2025", "MORA FRERES S.A.", 96, "CAJA MADERA 10 KG 500X300X150 LASARTE PREMIUM", 1046, 1046, "F",
];

// ── Fixture "Entradas de báscula" (entradasBascula). ────────────────────────
const HEADER_BASCULA = [
  "Fecha", "Entrada", "Finca", "Parcela", "Lote", "Agricultor", "Artículo", "Tipo de Envase",
  "Envases", "Kg Entrada", "Recol / kg", "Coste Recolec", "Importe Tte.", "Prec.Compra",
  "Importe Comp.", "Comis / kg", "Imp.Comisión", "Importe Total", "C?", "Certificado GGN",
];
const FILA_BASCULA = [
  "06/04/2026", " 16428", "El Carrascal", "El Carrascal Navel Powell", "26040604",
  "LASARTE EXPORT S.L.", "NARANJA NAVEL POWEL",
  "BOX PLASTICO 35 KG 1200X1000X780", 63, 22500, 0.085, 1935, 440, 0.4195, 9438.75, 0, 0, 11813.75, "0", "",
];

// ── Fixture "Stock de lotes" (entradasBascula: parseStockLotesRows). ────────
const HEADER_STOCK = ["Creación", "Lote", "Producto", "Agricultor", "Kgr.Exist.", "Envases"];
const FILA_STOCK = ["28/04/2026", "26042812", "NARANJA NAVEL", "INVERMARMELO", 20860, 100];

// ── Fixture "Cámara externa" (camarasExternas). ─────────────────────────────
const HEADER_CAMARAS = [
  "Fecha", "S/Ref", "Proveedor", "Finca", "Variedad", "Envases", "Kg.", "Nt/Ref",
  "Entrada1", "Entrada2", "Envases1", "Envases2", "Tte. A lst", "Tte. A Guadex",
];
const FILA_CAMARA = [
  new Date(2026, 4, 13), "S26/100224", "Invermarmelo", "Invermarmelo 3", "Valencia", 104, 20320, "26051307",
  null, null, null, null, null, "Guadex",
];

// ── Fixture "Merma de cámara" (mermaCamaraImport). ──────────────────────────
const HEADER_MERMA = [
  "Fecha almacenamiento", "Procedencia", "Su Ref.", "Agricultor", "Finca", "Variedad",
  "Fecha entrada LST", "Días almacén", "Peso inicial", "Peso final", "Merma", "% Merma",
];
const FILA_MERMA = [
  new Date(2026, 3, 28), "Guadex", "S26/100148", "Frubezar", "Dehesilla", "Valencia",
  new Date(2026, 6, 7), 70, 21580, 20760, 820, 0.038,
];

// ── Fixture "Mercadona semanal real" (mercadonaVentas). ─────────────────────
const HEADER_MERCADONA = ["Método", "Descripción", "Líneas", "KILOS", "CAJAS", "PALETS", "Base Iva"];
const FILA_AJUSTES_MERCADONA = ["", "", 4, 0, "", "", -100];
const FILA_METODO_MERCADONA = ["MA12KGC", "Descripción", 10, 500, 20, 5, 1000];

// ── Contenido benigno: no coincide con ningún parser de contenido. ──────────
const CONTENIDO_BENIGNO: unknown[][] = [["columna a", "columna b"], ["valor 1", "valor 2"]];

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("clasificarArchivoBandeja — un caso positivo por tipo", () => {
  it("informe-lote", () => {
    const r = clasificarArchivoBandeja(entrada("Informe 26043013.xlsx", { Hoja1: filasInformeLote() }));
    expect(r.tipo).toBe("informe-lote");
    expect(r.n).toBe(2);
    expect(r.motivo).toBeTruthy();
  });

  it("informe-productor", () => {
    const r = clasificarArchivoBandeja(entrada("MORATALLA.xlsx", { Hoja1: filasInformeProductor() }));
    expect(r.tipo).toBe("informe-productor");
    expect(r.n).toBe(1); // 1 variedad
  });

  it("informe-produccion", () => {
    const r = clasificarArchivoBandeja(entrada("Informe Produccion.xlsx", { Hoja1: filasInformeProduccion() }));
    expect(r.tipo).toBe("informe-produccion");
    expect(r.n).toBe(1);
  });

  it("palets-campana", () => {
    const r = clasificarArchivoBandeja(entrada("palets 1sep 14 jul.xlsx", { "Sheet 1": [HEADER_PALETS, FILA_PALET] }));
    expect(r.tipo).toBe("palets-campana");
    expect(r.n).toBe(1);
  });

  it("bascula-entradas", () => {
    const r = clasificarArchivoBandeja(entrada("entrada 2604.xlsx", { Hoja1: [HEADER_BASCULA, FILA_BASCULA] }));
    expect(r.tipo).toBe("bascula-entradas");
    expect(r.n).toBe(1);
  });

  it("stock-lotes", () => {
    const r = clasificarArchivoBandeja(entrada("APROVECHAMIENTO STOCK LOTES.xlsx", { Hoja1: [HEADER_STOCK, FILA_STOCK] }));
    expect(r.tipo).toBe("stock-lotes");
    expect(r.n).toBe(1);
    expect(r.motivo).toMatch(/sembrar|conciliar/i);
  });

  it("camaras-externas", () => {
    const r = clasificarArchivoBandeja(entrada("Registro_Control_Guadex.xlsx", { "Entradas total": [HEADER_CAMARAS, FILA_CAMARA] }));
    expect(r.tipo).toBe("camaras-externas");
    expect(r.n).toBe(1);
  });

  it("merma-camara", () => {
    const r = clasificarArchivoBandeja(entrada("Merma fruta camaras.xlsx", { Hoja1: [HEADER_MERMA, FILA_MERMA] }));
    expect(r.tipo).toBe("merma-camara");
    expect(r.n).toBe(1);
  });

  it("mercadona-semanal", () => {
    const r = clasificarArchivoBandeja(entrada("mercadona s27.xlsx", { "Sheet 1": [HEADER_MERCADONA, FILA_AJUSTES_MERCADONA, FILA_METODO_MERCADONA] }));
    expect(r.tipo).toBe("mercadona-semanal");
    expect(r.n).toBe(1); // 1 semana detectada
  });

  it("ventas-lineas (por nombre, sin contenido reconocible)", () => {
    const r = clasificarArchivoBandeja(entrada("Ventas junio 2026 lineas detallado.xlsx", { Hoja1: CONTENIDO_BENIGNO }));
    expect(r.tipo).toBe("ventas-lineas");
  });

  it("ventas-metodos-catalogo (por nombre, sin contenido reconocible)", () => {
    const r = clasificarArchivoBandeja(entrada("Ventas junio 2026 metodos de confeccion.xlsx", { Hoja1: CONTENIDO_BENIGNO }));
    expect(r.tipo).toBe("ventas-metodos-catalogo");
  });

  it("ventas-metodo (por nombre, sin contenido reconocible)", () => {
    const r = clasificarArchivoBandeja(entrada("LN211.xlsx", { Hoja1: CONTENIDO_BENIGNO }));
    expect(r.tipo).toBe("ventas-metodo");
    expect(r.codigoMetodo).toBe("LN211");
  });
});

describe("clasificarArchivoBandeja — solapamientos", () => {
  it("un informe de productor NO sale como informe-lote", () => {
    const r = clasificarArchivoBandeja(entrada("MORATALLA.xlsx", { Hoja1: filasInformeProductor() }));
    expect(r.tipo).toBe("informe-productor");
    expect(r.tipo).not.toBe("informe-lote");
  });

  it("un informe LOTE NO sale como informe-productor", () => {
    const r = clasificarArchivoBandeja(entrada("Informe 26043013.xlsx", { Hoja1: filasInformeLote() }));
    expect(r.tipo).toBe("informe-lote");
    expect(r.tipo).not.toBe("informe-productor");
  });

  it("un Excel de LOTE con nombre alfanumérico puro ('26042010.xlsx', como un método de ventas) sale informe-lote: el contenido gana al nombre", () => {
    const r = clasificarArchivoBandeja(entrada("26042010.xlsx", { Hoja1: filasInformeLote("26042010") }));
    expect(r.tipo).toBe("informe-lote");
    expect(r.tipo).not.toBe("ventas-metodo");
  });

  it("un 'LN211.xlsx' con contenido no reconocible sale ventas-metodo con codigoMetodo LN211", () => {
    const r = clasificarArchivoBandeja(entrada("LN211.xlsx", { Hoja1: CONTENIDO_BENIGNO }));
    expect(r.tipo).toBe("ventas-metodo");
    expect(r.codigoMetodo).toBe("LN211");
  });
});

describe("clasificarArchivoBandeja — extensiones no soportadas y casos borde", () => {
  it(".docx (diario de calidad viejo) -> no-soportado", () => {
    const r = clasificarArchivoBandeja(entrada("Diario Calidad 01-07.docx", null));
    expect(r.tipo).toBe("no-soportado");
    expect(r.motivo).toMatch(/Calidad/);
  });

  it(".doc -> no-soportado", () => {
    const r = clasificarArchivoBandeja(entrada("Diario Calidad 01-07.doc", null));
    expect(r.tipo).toBe("no-soportado");
  });

  it("sheets null (Excel no legible, aunque la extensión sea .xlsx) -> no-soportado", () => {
    const r = clasificarArchivoBandeja(entrada("roto.xlsx", null));
    expect(r.tipo).toBe("no-soportado");
  });

  it(".pdf -> no-soportado", () => {
    const r = clasificarArchivoBandeja(entrada("informe.pdf", null));
    expect(r.tipo).toBe("no-soportado");
  });

  it("grid vacío -> desconocido", () => {
    // Nombre con espacio a propósito: un nombre alfanumérico puro ("vacio.xlsx")
    // SÍ cae en "ventas-metodo" por nombre (comportamiento correcto, ver el
    // solapamiento de más arriba); aquí se prueba el grid vacío en sí, con un
    // nombre que no matchea ningún patrón de archivo conocido.
    const r = clasificarArchivoBandeja(entrada("archivo vacio.xlsx", { Hoja1: [] }));
    expect(r.tipo).toBe("desconocido");
    expect(r.n).toBe(0);
  });

  it("pasada vacía del calibrador (Informe LOTE sin filas de clasificación) -> informe-lote, n=0, se descartará", () => {
    const r = clasificarArchivoBandeja(entrada("Informe 26060101.xlsx", { Hoja1: filasInformeLoteVacio() }));
    expect(r.tipo).toBe("informe-lote");
    expect(r.n).toBe(0);
    expect(r.motivo).toMatch(/se descartará/i);
  });
});

describe("TIPO_BANDEJA_LABEL", () => {
  it("tiene una etiqueta humana para cada tipo clasificable", () => {
    for (const tipo of Object.keys(TIPO_BANDEJA_LABEL) as Array<keyof typeof TIPO_BANDEJA_LABEL>) {
      expect(TIPO_BANDEJA_LABEL[tipo]).toBeTruthy();
    }
  });
});

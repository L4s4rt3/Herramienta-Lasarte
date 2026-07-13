import { describe, expect, it } from "vitest";
import {
  buildEntradasDesdeStock,
  buildStockEntradas,
  normalizarLoteCodigo,
  parseEntradasBasculaRows,
  parseFechaBascula,
  parseStockLotesRows,
} from "./entradasBascula";

// Cabecera real del export del programa de báscula ("entrada 2604.xlsx").
const HEADER = [
  "Fecha", "Entrada", "Finca", "Parcela", "Lote", "Agricultor", "Artículo", "Tipo de Envase",
  "Envases", "Kg Entrada", "Recol / kg", "Coste Recolec", "Importe Tte.", "Prec.Compra",
  "Importe Comp.", "Comis / kg", "Imp.Comisión", "Importe Total", "C?", "Certificado GGN",
];

const FILA_REAL = [
  "06/04/2026", " 16428", "El Carrascal", "El Carrascal Navel Powell", "26040604",
  "LASARTE EXPORT S.L. Agricultura y Ecologia El Carrascal", "NARANJA NAVEL POWEL",
  "BOX PLASTICO 35 KG 1200X1000X780", 63, 22500, 0.085, 1935, 440, 0.4195, 9438.75, 0, 0, 11813.75, "0", "",
];

describe("parseEntradasBasculaRows", () => {
  it("parsea la fila real del export con todos los campos", () => {
    const { entradas, descartadas } = parseEntradasBasculaRows([HEADER, FILA_REAL]);

    expect(descartadas).toHaveLength(0);
    expect(entradas).toHaveLength(1);
    const e = entradas[0];
    expect(e.fecha).toBe("2026-04-06");
    expect(e.num_entrada).toBe("16428");
    expect(e.finca).toBe("El Carrascal");
    expect(e.lote).toBe("26040604");
    expect(e.articulo).toBe("NARANJA NAVEL POWEL");
    expect(e.envases).toBe(63);
    expect(e.kg_entrada).toBe(22500);
    expect(e.recol_kg).toBe(0.085);
    expect(e.coste_recoleccion).toBe(1935);
    expect(e.importe_transporte).toBe(440);
    expect(e.precio_compra_kg).toBe(0.4195);
    expect(e.importe_compra).toBe(9438.75);
    expect(e.importe_total).toBe(11813.75);
    expect(e.certificada).toBe(false);
    expect(e.certificado_ggn).toBeNull();
  });

  it("marca certificada y GGN cuando vienen informados", () => {
    const fila = [...FILA_REAL];
    fila[18] = "1";
    fila[19] = "4063061610911";
    const { entradas } = parseEntradasBasculaRows([HEADER, fila]);
    expect(entradas[0].certificada).toBe(true);
    expect(entradas[0].certificado_ggn).toBe("4063061610911");
  });

  it("descarta filas sin fecha, sin lote o sin kg, indicando el motivo", () => {
    const sinFecha = [...FILA_REAL]; sinFecha[0] = "";
    const sinLote = [...FILA_REAL]; sinLote[4] = "";
    const sinKg = [...FILA_REAL]; sinKg[9] = 0;
    const { entradas, descartadas } = parseEntradasBasculaRows([HEADER, sinFecha, sinLote, sinKg, FILA_REAL]);
    expect(entradas).toHaveLength(1);
    expect(descartadas).toHaveLength(3);
  });

  it("avisa si el archivo no tiene la cabecera esperada", () => {
    const { entradas, descartadas } = parseEntradasBasculaRows([["cualquier", "cosa"], [1, 2]]);
    expect(entradas).toHaveLength(0);
    expect(descartadas[0].motivo).toContain("cabecera");
  });
});

describe("parseFechaBascula", () => {
  it("acepta DD/MM/YYYY, ISO y Date", () => {
    expect(parseFechaBascula("06/04/2026")).toBe("2026-04-06");
    expect(parseFechaBascula("2026-04-06")).toBe("2026-04-06");
    expect(parseFechaBascula(new Date(2026, 3, 6))).toBe("2026-04-06");
    expect(parseFechaBascula("sin fecha")).toBeNull();
  });
});

describe("parseStockLotesRows — informe APROVECHAMIENTO STOCK LOTES", () => {
  // Estructura real: fila de título, cabecera, filas de agrupación por
  // producto/agricultor (sin fecha ni lote) y leyenda final de colores.
  const ROWS: unknown[][] = [
    ["APROVECHAMIENTO STOCK LOTES", null, null, null, null, null, null, null, null, null],
    ["Creación", "Lote", "Producto", "Agricultor", "Kgr.Exist.", "Envses", "APROVECHAMIENTO", "ACIDEZ", "KG MDNA", null],
    [null, null, "NARANJA BARBERINA", "LASARTE EXPORT S.L. Carlos", 24100, 120, "SIN DATOS", null, null, null],
    ["28/04/2026", "26042812", "NARANJA BARBERINA", "LASARTE EXPORT S.L. Carlos", 20960, 104, "SIN DATOS", null, null, null],
    [new Date(2026, 3, 29, 0, 0, 44), "26042911", "NARANJA BARBERINA", "LASARTE EXPORT S.L. Carlos", 3140, 16, "SIN DATOS", null, null, null],
    ["Colores originales del archivo (fila completa / % aprovechamiento):", null, null, null, null, null, null, null, null, null],
    [null, "% de aprovechamiento calculado", null, null, null, null, null, null, null, null],
  ];

  it("extrae solo las filas de detalle con lote de 8 dígitos", () => {
    const { lotes, descartadas } = parseStockLotesRows(ROWS);
    expect(lotes).toHaveLength(2);
    expect(lotes[0]).toMatchObject({ fecha: "2026-04-28", lote: "26042812", kg_existentes: 20960, envases: 104 });
    expect(lotes[1]).toMatchObject({ fecha: "2026-04-29", lote: "26042911", kg_existentes: 3140 });
    // La leyenda "% de aprovechamiento calculado" (con texto en la col. lote) se descarta con motivo.
    expect(descartadas.some((d) => d.motivo.includes("no reconocible"))).toBe(true);
  });

  it("avisa si no encuentra la cabecera", () => {
    const { lotes, descartadas } = parseStockLotesRows([["otra", "cosa"]]);
    expect(lotes).toHaveLength(0);
    expect(descartadas[0].motivo).toContain("cabecera");
  });
});

describe("buildEntradasDesdeStock — sembrado del arranque", () => {
  it("reconstruye kg_entrada = stock actual + kg ya procesados del lote", () => {
    const lotes = [
      { fecha: "2026-04-28", lote: "26042812", articulo: "BARBERINA", agricultor: "Carlos", kg_existentes: 20960, envases: 104 },
      { fecha: "2026-05-08", lote: "26050801", articulo: "MIDKNIGHT", agricultor: "Covidesa", kg_existentes: 14045, envases: 45 },
    ];
    const procesados = [
      { lote_codigo: "26042812 + 2 BOX", kg_peso_total: 4040, date: "2026-06-01" },
    ];

    const entradas = buildEntradasDesdeStock(lotes, procesados);

    expect(entradas[0]).toMatchObject({ lote: "26042812", kg_entrada: 25000, origen: "stock_inicial" });
    expect(entradas[1]).toMatchObject({ lote: "26050801", kg_entrada: 14045 });

    // La cuenta cierra: el stock calculado devuelve exactamente el del informe.
    const stock = buildStockEntradas(entradas, procesados, "2026-07-13");
    expect(stock.filas.find((f) => f.lote === "26042812")?.kg_en_camara).toBe(20960);
    expect(stock.filas.find((f) => f.lote === "26050801")?.kg_en_camara).toBe(14045);
  });
});

describe("normalizarLoteCodigo", () => {
  it("extrae los 8 dígitos aunque el calibrador pegue texto al código", () => {
    expect(normalizarLoteCodigo("26042712 + 7 BOX DE RECICLAJE+ PREC -3K MDNA")).toBe("26042712");
    expect(normalizarLoteCodigo("26040604")).toBe("26040604");
    expect(normalizarLoteCodigo("sin lote")).toBeNull();
  });
});

describe("buildStockEntradas", () => {
  const entradas = [
    { lote: "26040604", fecha: "2026-04-06", kg_entrada: 22500, finca: "El Carrascal", articulo: "NAVEL", agricultor: null },
    { lote: "26040704", fecha: "2026-04-07", kg_entrada: 25180, finca: "El Carrascal", articulo: "NAVEL", agricultor: null },
    { lote: "26041004", fecha: "2026-04-10", kg_entrada: 25680, finca: "El Carrascal", articulo: "NAVEL", agricultor: null },
  ];
  const procesados = [
    // Lote 26040604 procesado del todo (98% de la entrada), con texto pegado.
    { lote_codigo: "26040604 + 2 BOX DE RECICLAJE", kg_peso_total: 22100, date: "2026-05-02" },
    // Lote 26040704 procesado a medias en dos tandas.
    { lote_codigo: "26040704", kg_peso_total: 8000, date: "2026-05-03" },
    { lote_codigo: "26040704", kg_peso_total: 4000, date: "2026-05-04" },
  ];

  it("clasifica procesado / parcial / pendiente y calcula el stock en cámara", () => {
    const stock = buildStockEntradas(entradas, procesados, "2026-04-20");

    const porLote = new Map(stock.filas.map((f) => [f.lote, f]));
    expect(porLote.get("26040604")?.estado).toBe("procesado");
    expect(porLote.get("26040604")?.kg_en_camara).toBe(0);
    expect(porLote.get("26040704")?.estado).toBe("parcial");
    expect(porLote.get("26040704")?.kg_procesado).toBe(12000);
    expect(porLote.get("26040704")?.kg_en_camara).toBe(25180 - 12000);
    expect(porLote.get("26041004")?.estado).toBe("pendiente");
    expect(porLote.get("26041004")?.kg_en_camara).toBe(25680);

    expect(stock.kgEnCamara).toBe(25180 - 12000 + 25680);
    expect(stock.lotesPendientes).toBe(1);
    expect(stock.lotesParciales).toBe(1);
    // El más antiguo activo es el parcial del día 7 → 13 días a fecha del 20.
    expect(stock.antiguedadMaxDias).toBe(13);
  });

  it("en los lotes procesados los días en cámara se cuentan hasta el último procesado, no hasta hoy", () => {
    const stock = buildStockEntradas(entradas, procesados, "2026-07-01");
    const procesado = stock.filas.find((f) => f.lote === "26040604");
    // Entró el 6 de abril y terminó de procesarse el 2 de mayo → 26 días.
    expect(procesado?.dias_en_camara).toBe(26);
  });

  it("kg_ajuste_stock concilia el procesado anterior a los registros (informe de báscula)", () => {
    const conAjuste = [
      // Lote fuera del informe de stock: ajuste = todo su stock calculado → 0 en cámara.
      { lote: "26040604", fecha: "2026-04-06", kg_entrada: 22500, kg_ajuste_stock: 22500, finca: null, articulo: null, agricultor: null },
      // Lote del informe: el ajuste deja el stock exactamente en los kg del informe (20000).
      { lote: "26040704", fecha: "2026-04-07", kg_entrada: 25180, kg_ajuste_stock: 5180, finca: null, articulo: null, agricultor: null },
    ];

    const stock = buildStockEntradas(conAjuste, [], "2026-04-20");
    const porLote = new Map(stock.filas.map((f) => [f.lote, f]));
    expect(porLote.get("26040604")?.estado).toBe("procesado");
    expect(porLote.get("26040604")?.kg_en_camara).toBe(0);
    expect(porLote.get("26040704")?.estado).toBe("parcial");
    expect(porLote.get("26040704")?.kg_en_camara).toBe(20000);
    expect(stock.kgEnCamara).toBe(20000);
  });
});

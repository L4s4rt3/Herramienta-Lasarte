import { describe, expect, it } from "vitest";
import {
  buildEntradasDesdeStock,
  buildStockEntradas,
  conciliarStockConInforme,
  criterioCierreModo,
  DIAS_SIN_ACTIVIDAD_TERMINADO,
  estadoLotePorProcesado,
  normalizarLoteCodigo,
  parseEntradasBasculaRows,
  parseFechaBascula,
  parseInformeAprovechamientoStock,
  parseStockLotesRows,
  pasadasPosterioresAlCierre,
  UMBRAL_CIERRE_CON_ANALISIS,
  UMBRAL_PROBABLE_TERMINADO,
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

  it("acepta el serial numérico de Excel (celdas con formato de fecha real, no texto)", () => {
    // Caso real del informe APROVECHAMIENTO STOCK LOTES: algunas filas de
    // "Creación" vienen como número de serie de Excel en vez de texto
    // "dd/mm/yyyy" (4 de los 117 lotes reales se perdían por esto).
    expect(parseFechaBascula(46136)).toBe("2026-04-24");
    expect(parseFechaBascula(46140)).toBe("2026-04-28");
    expect(parseFechaBascula(46153)).toBe("2026-05-11");
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

describe("parseInformeAprovechamientoStock — conciliación con el informe de cámara", () => {
  // Fixture calcada de la estructura real del archivo de referencia: título,
  // cabecera, subtotal (Creación/Lote en blanco), una fila con fecha en texto
  // y otra con fecha como serial numérico de Excel (bug real corregido en
  // parseFechaBascula), y la leyenda de colores al final.
  const ROWS: unknown[][] = [
    ["APROVECHAMIENTO STOCK LOTES", null, null, null, null, null, null, null, null, null],
    ["Creación", "Lote", "Producto", "Agricultor", "Kgr.Exist.", "Envses", "APROVECHAMIENTO", "ACIDEZ", "KG MDNA", null],
    [null, null, "NARANJA BARBERINA", "LASARTE EXPORT S.L. Carlos", 44060, 224, "SIN DATOS", null, null, null],
    ["28/04/2026", "26042812", "NARANJA BARBERINA", "LASARTE EXPORT S.L. Carlos", 20960, 104, "SIN DATOS", null, null, null],
    [46136, 26042408, "NARANJA BARBERINA", "LASARTE EXPORT S.L. Carlos", 20520, 104, "SIN DATOS", null, null, null],
    ["Leyenda de colores por producto:", null, null, null, null, null, null, null, null, null],
    [null, "NAR VAL DELTA SEEDLESS", null, null, "NARANJA BARBERINA", null, null, "NARANJA VALENCIA LATE", null, null],
    [null, "% de aprovechamiento calculado", null, null, null, null, null, null, null, null],
  ];

  it("extrae solo los lotes de detalle, aceptando lote como número y fecha como serial de Excel", () => {
    const { lotes, descartadas } = parseInformeAprovechamientoStock(ROWS);
    expect(lotes).toHaveLength(2);
    expect(lotes[0]).toEqual({
      lote: "26042812", kgExistencia: 20960, producto: "NARANJA BARBERINA", agricultor: "LASARTE EXPORT S.L. Carlos", fechaCreacion: "2026-04-28",
    });
    expect(lotes[1]).toMatchObject({ lote: "26042408", kgExistencia: 20520, fechaCreacion: "2026-04-24" });
    // Subtotal (sin fecha ni lote) y leyenda: descartados en silencio (sin motivo) salvo
    // la fila con texto en la columna Lote ("% de aprovechamiento calculado").
    expect(descartadas.some((d) => d.motivo.includes("no reconocible"))).toBe(true);
  });
});

describe("conciliarStockConInforme — cuadre contra el informe real de cámara (2026-07-16)", () => {
  // Construye StockLoteRow reales vía buildStockEntradas en vez de a mano,
  // para que los 3 grupos se prueben sobre datos coherentes con el resto del
  // módulo (mismo criterio de estado/cierre que usa la UI).
  const entradas = [
    { lote: "26060101", fecha: "2026-06-01", kg_entrada: 10000, finca: null, articulo: "NAVEL", agricultor: "Agricultor A" }, // activo, en informe
    { lote: "26060102", fecha: "2026-06-02", kg_entrada: 5000, finca: null, articulo: "NAVEL", agricultor: "Agricultor B" }, // activo, NO en informe
    {
      lote: "26060103", fecha: "2026-05-01", kg_entrada: 8000, finca: null, articulo: "NAVEL", agricultor: "Agricultor C",
      cerrado_at: "2026-07-15T00:00:00Z", cierre_modo: "con_analisis" as const,
    }, // cerrado a mano, en informe → candidato a reabrir
    { lote: "26060104", fecha: "2026-06-10", kg_entrada: 6000, finca: null, articulo: "NAVEL", agricultor: "Agricultor D" }, // procesado por kg (calibrador), SIN cierre manual, en informe → conflicto
  ];
  const procesados = [
    { lote_codigo: "26060103", kg_peso_total: 7000, date: "2026-06-05" }, // 87.5%, no llegaría a "procesado" sin el cierre manual
    { lote_codigo: "26060104", kg_peso_total: 6000, date: "2026-07-16" }, // 100%, procesado DESPUÉS de la foto del informe
  ];
  const stock = buildStockEntradas(entradas, procesados, "2026-07-16");

  const informeLotes = [
    { lote: "26060101", kgExistencia: 9800, producto: "NAVEL", agricultor: "Agricultor A", fechaCreacion: "2026-06-01" },
    { lote: "26060103", kgExistencia: 900, producto: "NAVEL", agricultor: "Agricultor C", fechaCreacion: "2026-05-01" },
    { lote: "26060104", kgExistencia: 6000, producto: "NAVEL", agricultor: "Agricultor D", fechaCreacion: "2026-06-10" },
    { lote: "26060105", kgExistencia: 3000, producto: "LIMON", agricultor: "Agricultor E", fechaCreacion: "2026-06-15" }, // no existe en absoluto en la herramienta
  ];

  const resultado = conciliarStockConInforme(stock.filas, informeLotes);

  it("cuadran: activos presentes en el informe, con el delta kg informativo", () => {
    expect(resultado.cuadran).toHaveLength(1);
    expect(resultado.cuadran[0]).toMatchObject({ lote: "26060101", kgHerramienta: 10000, kgInforme: 9800, deltaKg: 200 });
  });

  it("sobranEnHerramienta: activos SIN entrada en el informe → candidatos a cerrar con su modo sugerido", () => {
    expect(resultado.sobranEnHerramienta).toHaveLength(1);
    expect(resultado.sobranEnHerramienta[0]).toMatchObject({ lote: "26060102", kgEntrada: 5000, kgProcesado: 0, modoSugerido: "sin_registro" });
  });

  it("faltanEnHerramienta.reabrir: cerrados a mano que SÍ están en el informe", () => {
    expect(resultado.faltanEnHerramienta.reabrir).toHaveLength(1);
    expect(resultado.faltanEnHerramienta.reabrir[0]).toMatchObject({
      lote: "26060103", kgEntrada: 8000, kgHuecoNatural: 1000, kgInforme: 900, cierreModo: "con_analisis",
    });
  });

  it("faltanEnHerramienta.conflicto: procesado por kg SIN cierre manual (lote procesado después de la foto del informe) — solo informativo, nunca se reabre solo", () => {
    expect(resultado.faltanEnHerramienta.conflicto).toHaveLength(1);
    expect(resultado.faltanEnHerramienta.conflicto[0]).toMatchObject({ lote: "26060104", kgEntrada: 6000, kgProcesado: 6000, kgInforme: 6000 });
    // Ninguno de los dos grupos de acción se lleva este lote.
    expect(resultado.faltanEnHerramienta.reabrir.some((r) => r.lote === "26060104")).toBe(false);
    expect(resultado.sobranEnHerramienta.some((r) => r.lote === "26060104")).toBe(false);
  });

  it("faltanEnHerramienta.sinEntrada: lote del informe sin ninguna fila en la herramienta — solo informativo", () => {
    expect(resultado.faltanEnHerramienta.sinEntrada).toHaveLength(1);
    expect(resultado.faltanEnHerramienta.sinEntrada[0]).toMatchObject({ lote: "26060105", kgInforme: 3000, producto: "LIMON" });
  });

  it("no se cuelan lotes de precalibrado/campo-cit por accidente: si no vienen en stockFilas (excluidos aguas arriba en useEntradasBascula), caen en sinEntrada", () => {
    // Documenta la garantía: useEntradasBascula filtra esEntradaPrecalibrado/esEntradaCampoCit
    // ANTES de construir buildStockEntradas, así que conciliarStockConInforme nunca los ve
    // como filas activas/cerradas — si el informe trajera uno, es indistinguible de un lote
    // que simplemente no existe en la BD, y por eso cae en sinEntrada (nunca en reabrir).
    const soloInforme = [{ lote: "99999999", kgExistencia: 1000, producto: "PRECALIBRADO", agricultor: null, fechaCreacion: "2026-06-01" }];
    const r = conciliarStockConInforme(stock.filas, soloInforme);
    expect(r.faltanEnHerramienta.sinEntrada).toHaveLength(1);
    expect(r.faltanEnHerramienta.reabrir).toHaveLength(0);
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

  it("cerrado_at fuerza estado 'procesado' y kg_en_camara 0, aunque el pct sea bajo, y lo excluye de los KPI de stock", () => {
    // Caso real de referencia: 26061203, entrada 24.900 kg, calibrador 23.360
    // kg (93,8%) -> sin cerrar sería "parcial" eterno.
    const conCierre = [
      { lote: "26061203", fecha: "2026-06-12", kg_entrada: 24900, finca: null, articulo: null, agricultor: null, cerrado_at: "2026-07-15T00:00:00Z" },
      { lote: "26041004", fecha: "2026-04-10", kg_entrada: 25680, finca: null, articulo: null, agricultor: null }, // sin cerrar, de control
    ];
    const procesadosCierre = [{ lote_codigo: "26061203", kg_peso_total: 23360, date: "2026-07-12" }];
    const stock = buildStockEntradas(conCierre, procesadosCierre, "2026-07-15");
    const porLote = new Map(stock.filas.map((f) => [f.lote, f]));

    const cerrado = porLote.get("26061203")!;
    expect(cerrado.estado).toBe("procesado");
    expect(cerrado.kg_en_camara).toBe(0);
    expect(cerrado.cerrado_at).toBe("2026-07-15T00:00:00Z");

    const control = porLote.get("26041004")!;
    expect(control.estado).toBe("pendiente");
    expect(control.cerrado_at).toBeNull();

    // El cerrado no cuenta en los KPI de stock (kgEnCamara, lotesPendientes/Parciales).
    expect(stock.kgEnCamara).toBe(control.kg_en_camara);
    expect(stock.lotesPendientes).toBe(1);
    expect(stock.lotesParciales).toBe(0);
  });

  it("reabrir (cerrado_at null) vuelve al estado calculado por el pct normal", () => {
    const reabierto = [
      { lote: "26061203", fecha: "2026-06-12", kg_entrada: 24900, finca: null, articulo: null, agricultor: null, cerrado_at: null },
    ];
    const procesadosCierre = [{ lote_codigo: "26061203", kg_peso_total: 23360, date: "2026-07-12" }];
    const stock = buildStockEntradas(reabierto, procesadosCierre, "2026-07-15");
    const fila = stock.filas[0];
    expect(fila.estado).toBe("parcial"); // 93.8% < 97%, sin cierre manual
    expect(fila.kg_en_camara).toBe(24900 - 23360);
  });
});

describe("estadoLotePorProcesado — cerradoManualmente", () => {
  it("fuerza 'procesado' aunque el pct sea 0 o bajo", () => {
    expect(estadoLotePorProcesado(1000, 0, true)).toBe("procesado");
    expect(estadoLotePorProcesado(1000, 500, true)).toBe("procesado");
  });

  it("sin cerradoManualmente (por defecto false) mantiene el criterio normal por umbral", () => {
    expect(estadoLotePorProcesado(1000, 0)).toBe("pendiente");
    expect(estadoLotePorProcesado(1000, 500)).toBe("parcial");
    expect(estadoLotePorProcesado(1000, 980)).toBe("procesado");
  });
});

describe("criterioCierreModo — umbral del 85% para sugerir el modo de cierre", () => {
  it("sugiere 'con_analisis' con 85% o más procesado", () => {
    expect(criterioCierreModo(1000, 850)).toBe("con_analisis"); // exactamente el umbral
    expect(criterioCierreModo(1000, 900)).toBe("con_analisis");
    expect(criterioCierreModo(1000, 1000)).toBe("con_analisis");
  });

  it("sugiere 'sin_registro' por debajo del 85% procesado", () => {
    expect(criterioCierreModo(1000, 849)).toBe("sin_registro");
    expect(criterioCierreModo(1000, 500)).toBe("sin_registro");
    expect(criterioCierreModo(1000, 0)).toBe("sin_registro");
  });

  it("kgEntrada <= 0 no divide por 0: cae a 'sin_registro' (pct tratado como 0)", () => {
    expect(criterioCierreModo(0, 0)).toBe("sin_registro");
    expect(criterioCierreModo(-10, 5)).toBe("sin_registro");
  });

  it("usa exactamente UMBRAL_CIERRE_CON_ANALISIS como frontera (>=, no >)", () => {
    const kgEntrada = 24900;
    const enElUmbral = kgEntrada * UMBRAL_CIERRE_CON_ANALISIS;
    expect(criterioCierreModo(kgEntrada, enElUmbral)).toBe("con_analisis");
    expect(criterioCierreModo(kgEntrada, enElUmbral - 1)).toBe("sin_registro");
  });

  it("caso real: 121 lotes con procesado bajo (p.ej. 0%, código compuesto que acredita a otro lote) sugieren sin_registro", () => {
    // Ejemplo real motivador de esta distinción: un lote con 24.900 kg de
    // entrada y 0 kg de procesado bajo su propio código (pasó bajo un
    // compuesto que acreditó a otro lote) no debe sugerir "con_analisis".
    expect(criterioCierreModo(24900, 0)).toBe("sin_registro");
  });

  it("caso real: 53 lotes con procesado parcial alto (93.8%) sugieren con_analisis", () => {
    expect(criterioCierreModo(24900, 23360)).toBe("con_analisis"); // 93.8%
  });
});

describe("buildStockEntradas — probablementeTerminado (aviso derivado, sin cierre automático)", () => {
  // Parámetros vigentes (ajustados por análisis de clasificación sobre la
  // campaña completa, ver la cabecera de UMBRAL_PROBABLE_TERMINADO en
  // entradasBascula.ts): 80% procesado + 7 días sin actividad del calibrador.
  const entradaBase = { lote: "26060501", fecha: "2026-06-05", kg_entrada: 10000, finca: null, articulo: "NAVEL", agricultor: null };

  it("80%+ procesado y ≥7 días sin actividad -> true", () => {
    const procesados = [{ lote_codigo: "26060501", kg_peso_total: 8600, date: "2026-06-08" }]; // 86%, última pasada 8-jun
    const stock = buildStockEntradas([entradaBase], procesados, "2026-06-15"); // 7 días desde la última pasada
    const fila = stock.filas[0];
    expect(fila.estado).toBe("parcial");
    expect(fila.probablementeTerminado).toBe(true);
    expect(stock.lotesProbablementeTerminados).toBe(1);
    expect(stock.kgProbablementeTerminados).toBe(fila.kg_en_camara);
    expect(stock.kgEnCamaraFirme).toBe(0);
  });

  it("pasada reciente (< 7 días) -> false aunque el % ya esté por encima del umbral", () => {
    const procesados = [{ lote_codigo: "26060501", kg_peso_total: 8600, date: "2026-06-13" }]; // 86%, hace 2 días
    const stock = buildStockEntradas([entradaBase], procesados, "2026-06-15");
    const fila = stock.filas[0];
    expect(fila.estado).toBe("parcial");
    expect(fila.probablementeTerminado).toBe(false);
    expect(stock.lotesProbablementeTerminados).toBe(0);
    expect(stock.kgEnCamaraFirme).toBe(fila.kg_en_camara);
    expect(stock.kgProbablementeTerminados).toBe(0);
  });

  it("una pasada nueva desmarca el aviso (estado derivado, no persistido)", () => {
    const procesados = [
      { lote_codigo: "26060501", kg_peso_total: 8600, date: "2026-06-08" }, // 86%, marcaría a los 7 días
      { lote_codigo: "26060501", kg_peso_total: 100, date: "2026-06-14" }, // pasada nueva: reinicia el contador de días
    ];
    const stock = buildStockEntradas([entradaBase], procesados, "2026-06-15");
    const fila = stock.filas[0];
    expect(fila.probablementeTerminado).toBe(false); // solo 1 día desde la última pasada
  });

  it("un lote cerrado a mano nunca se marca (ya es 'procesado', no 'parcial')", () => {
    const cerrado = { ...entradaBase, cerrado_at: "2026-06-09T00:00:00Z" };
    const procesados = [{ lote_codigo: "26060501", kg_peso_total: 8600, date: "2026-06-08" }];
    const stock = buildStockEntradas([cerrado], procesados, "2026-06-20");
    const fila = stock.filas[0];
    expect(fila.estado).toBe("procesado");
    expect(fila.probablementeTerminado).toBe(false);
  });

  it("por debajo del umbral (80%) no se marca aunque lleve muchos días sin actividad", () => {
    const procesados = [{ lote_codigo: "26060501", kg_peso_total: 7900, date: "2026-06-05" }]; // 79%
    const stock = buildStockEntradas([entradaBase], procesados, "2026-07-01");
    expect(stock.filas[0].probablementeTerminado).toBe(false);
  });

  it("usa exactamente UMBRAL_PROBABLE_TERMINADO y DIAS_SIN_ACTIVIDAD_TERMINADO como frontera (>=, no >)", () => {
    const kgEnElUmbral = entradaBase.kg_entrada * UMBRAL_PROBABLE_TERMINADO;
    const hoy = "2026-06-15";
    const fechaEnElUmbralDias = "2026-06-08"; // exactamente 7 días antes de hoy

    const enElUmbral = buildStockEntradas(
      [entradaBase],
      [{ lote_codigo: "26060501", kg_peso_total: kgEnElUmbral, date: fechaEnElUmbralDias }],
      hoy,
    );
    expect(enElUmbral.filas[0].probablementeTerminado).toBe(true);

    const debajoDelUmbralPct = buildStockEntradas(
      [entradaBase],
      [{ lote_codigo: "26060501", kg_peso_total: kgEnElUmbral - 1, date: fechaEnElUmbralDias }],
      hoy,
    );
    expect(debajoDelUmbralPct.filas[0].probablementeTerminado).toBe(false);

    const menosDiasQueElUmbral = buildStockEntradas(
      [entradaBase],
      [{ lote_codigo: "26060501", kg_peso_total: kgEnElUmbral, date: "2026-06-09" }], // 6 días
      hoy,
    );
    expect(menosDiasQueElUmbral.filas[0].probablementeTerminado).toBe(false);
  });

  it("la partición kgEnCamaraFirme + kgProbablementeTerminados suma exactamente kgEnCamara", () => {
    const entradas = [
      entradaBase, // 86%, 7 días -> probable
      { lote: "26060502", fecha: "2026-06-06", kg_entrada: 12000, finca: null, articulo: "NAVEL", agricultor: null }, // pendiente -> firme
      { lote: "26060503", fecha: "2026-06-07", kg_entrada: 9000, finca: null, articulo: "NAVEL", agricultor: null }, // parcial reciente -> firme
    ];
    const procesados = [
      { lote_codigo: "26060501", kg_peso_total: 8600, date: "2026-06-08" },
      { lote_codigo: "26060503", kg_peso_total: 3000, date: "2026-06-14" },
    ];
    const stock = buildStockEntradas(entradas, procesados, "2026-06-15");
    expect(stock.kgEnCamaraFirme + stock.kgProbablementeTerminados).toBe(stock.kgEnCamara);
    expect(stock.lotesProbablementeTerminados).toBe(1);
  });
});

describe("pasadasPosterioresAlCierre — guardia inversa (cerrado con actividad posterior)", () => {
  it("true si hay pasada posterior a la fecha de cierre", () => {
    expect(pasadasPosterioresAlCierre("2026-06-10T00:00:00Z", "2026-06-12")).toBe(true);
  });

  it("false si la última pasada es anterior o igual a la fecha de cierre", () => {
    expect(pasadasPosterioresAlCierre("2026-06-10T00:00:00Z", "2026-06-09")).toBe(false);
    expect(pasadasPosterioresAlCierre("2026-06-10T00:00:00Z", "2026-06-10")).toBe(false);
  });

  it("false si el lote no está cerrado o no hay ninguna pasada registrada", () => {
    expect(pasadasPosterioresAlCierre(null, "2026-06-12")).toBe(false);
    expect(pasadasPosterioresAlCierre("2026-06-10T00:00:00Z", null)).toBe(false);
    expect(pasadasPosterioresAlCierre(null, null)).toBe(false);
  });

  it("buildStockEntradas expone la guardia por fila y el conteo agregado", () => {
    const entradas = [
      { lote: "26060601", fecha: "2026-06-01", kg_entrada: 10000, finca: null, articulo: null, agricultor: null, cerrado_at: "2026-06-10T00:00:00Z" },
      { lote: "26060602", fecha: "2026-06-02", kg_entrada: 8000, finca: null, articulo: null, agricultor: null, cerrado_at: "2026-06-10T00:00:00Z" },
    ];
    const procesados = [
      { lote_codigo: "26060601", kg_peso_total: 9000, date: "2026-06-15" }, // posterior al cierre -> guardia
      { lote_codigo: "26060602", kg_peso_total: 7000, date: "2026-06-05" }, // anterior al cierre -> sin problema
    ];
    const stock = buildStockEntradas(entradas, procesados, "2026-06-20");
    const porLote = new Map(stock.filas.map((f) => [f.lote, f]));
    expect(porLote.get("26060601")?.cerradoConActividadPosterior).toBe(true);
    expect(porLote.get("26060602")?.cerradoConActividadPosterior).toBe(false);
    expect(stock.lotesCerradosConActividadPosterior).toHaveLength(1);
    expect(stock.lotesCerradosConActividadPosterior[0].lote).toBe("26060601");
  });
});

describe("DIAS_SIN_ACTIVIDAD_TERMINADO — documentación del margen frente al gap real observado", () => {
  it("se queda por debajo del gap máximo observado de reanudación (12 días) a propósito", () => {
    expect(DIAS_SIN_ACTIVIDAD_TERMINADO).toBeLessThan(12);
    expect(DIAS_SIN_ACTIVIDAD_TERMINADO).toBe(7);
  });

  it("UMBRAL_PROBABLE_TERMINADO es 0.80 (ajustado por análisis de clasificación sobre la campaña, no reutiliza UMBRAL_CIERRE_CON_ANALISIS)", () => {
    expect(UMBRAL_PROBABLE_TERMINADO).toBe(0.80);
  });
});

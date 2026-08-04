import { describe, expect, it } from "vitest";
import {
  buildEntradasDesdeStock,
  buildStockEntradas,
  conciliarStockConInforme,
  criterioCierreModo,
  DIAS_SIN_ACTIVIDAD_AUTOCIERRE,
  DIAS_SIN_ACTIVIDAD_TERMINADO,
  esCandidatoCierreAutomatico,
  esCandidatoCierreCompuesto,
  estadoLotePorProcesado,
  normalizarLoteCodigo,
  parseEntradasBasculaRows,
  parseFechaBascula,
  parseInformeAprovechamientoStock,
  parseStockLotesRows,
  pasadasPosterioresAlCierre,
  UMBRAL_CIERRE_CON_ANALISIS,
  UMBRAL_COMPLETO_MINIMO,
  UMBRAL_LOTE_COMPLETO,
  UMBRAL_PROBABLE_TERMINADO,
  UMBRAL_PROCESADO,
  umbralCompletoPorEdad,
} from "./entradasBascula";
import { camaraConfirmadaVigentePorLote, type EntradaConCamaraConfirmada } from "./camaraConfirmada";

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

describe("UMBRAL_LOTE_COMPLETO — alias de UMBRAL_PROCESADO para el estado COMPLETO", () => {
  it("es exactamente UMBRAL_PROCESADO (0.97), nunca diverge", () => {
    expect(UMBRAL_LOTE_COMPLETO).toBe(UMBRAL_PROCESADO);
    expect(UMBRAL_LOTE_COMPLETO).toBe(0.97);
  });
});

describe("umbralCompletoPorEdad / estadoLotePorProcesado con umbral dinámico (ground truth del dueño 04-08-2026: 3 lotes de Guadex ~90 días, 87-95% procesado, confirmados FÍSICAMENTE vacíos en cámara)", () => {
  it("sin fraccionEsperadaPorEdad (o sin dias): se comporta EXACTAMENTE como antes, siempre UMBRAL_PROCESADO", () => {
    expect(umbralCompletoPorEdad(90)).toBe(UMBRAL_PROCESADO);
    expect(umbralCompletoPorEdad(200)).toBe(UMBRAL_PROCESADO);
    // estadoLotePorProcesado sin los 2 parámetros nuevos: comportamiento histórico intacto.
    expect(estadoLotePorProcesado(10000, 9600)).toBe("parcial"); // 96% < 97%
  });

  it("lote de 90 días al 93% -> COMPLETO (el umbral se relaja por edad)", () => {
    const umbral90dias = umbralCompletoPorEdad(90, (dias) => (1 - Math.min(0.15, 0.000513 * dias)) * (1 - 0.03));
    expect(umbral90dias).toBeLessThan(UMBRAL_PROCESADO);
    expect(estadoLotePorProcesado(10000, 9300, false, 90, (dias) => (1 - Math.min(0.15, 0.000513 * dias)) * (1 - 0.03))).toBe("procesado");
  });

  it("lote de 10 días al 93% -> NO completo (a esa edad el umbral sigue cerca del 97% plano)", () => {
    const fraccion = (dias: number) => (1 - Math.min(0.15, 0.000513 * dias)) * (1 - 0.03);
    expect(estadoLotePorProcesado(10000, 9300, false, 10, fraccion)).toBe("parcial");
  });

  it("UMBRAL_COMPLETO_MINIMO (85%): nunca se considera completo por debajo, por muy viejo que sea el lote", () => {
    // Un lote MUY viejo (400 días) con la fracción esperada muy baja no debe
    // arrastrar el umbral por debajo del suelo de seguridad del 85%.
    const fraccionMuyBaja = () => 0.5; // simula un lote extremo
    expect(umbralCompletoPorEdad(400, fraccionMuyBaja)).toBe(UMBRAL_COMPLETO_MINIMO);
    expect(estadoLotePorProcesado(10000, 8400, false, 400, fraccionMuyBaja)).toBe("parcial"); // 84% < 85%
    expect(estadoLotePorProcesado(10000, 8500, false, 400, fraccionMuyBaja)).toBe("procesado"); // 85% justo
  });

  it("caso real Guadex: lote de 90 días al 92,76% procesado (26050609) -> COMPLETO con capacidadFraccionEstimada real de conciliacionKg.ts", () => {
    // Réplica exacta de capacidadFraccionEstimada (conciliacionKg.ts) para no
    // importarla aquí (evitaría el ciclo de imports) — mismos números. A 90
    // días el umbral dinámico es ≈92,52%: este lote real (92,76%) lo supera
    // por poco, justo el caso que el umbral plano del 97% dejaba "parcial"
    // para siempre pese a estar confirmado vacío en cámara.
    const capacidadFraccionEstimada = (dias: number) => (1 - Math.min(0.15, 0.000513 * dias)) * (1 - 0.03);
    const entrada = { lote: "26050609", fecha: "2026-05-06", kg_entrada: 22100, finca: "La Torrecilla", articulo: "NAR VAL DELTA SEEDLESS", agricultor: null };
    const procesados = [{ lote_codigo: "26050609", kg_peso_total: 20500, date: "2026-06-01" }]; // 92,76%
    const stock = buildStockEntradas([entrada], procesados, "2026-08-04", undefined, capacidadFraccionEstimada); // 90 días
    expect(stock.filas[0].estado).toBe("procesado");
    expect(stock.filas[0].kg_en_camara).toBe(0);
  });

  it("buildStockEntradas: sin fraccionEsperadaPorEdad, el mismo lote de 90 días al 92,76% se queda 'parcial' (comportamiento histórico)", () => {
    const entrada = { lote: "26050609", fecha: "2026-05-06", kg_entrada: 22100, finca: "La Torrecilla", articulo: "NAR VAL DELTA SEEDLESS", agricultor: null };
    const procesados = [{ lote_codigo: "26050609", kg_peso_total: 20500, date: "2026-06-01" }];
    const stock = buildStockEntradas([entrada], procesados, "2026-08-04");
    expect(stock.filas[0].estado).toBe("parcial");
  });

  it("caso real Guadex 26050508 (91 días, 89,96%): el umbral por edad AYUDA pero no llega a cubrirlo — sigue 'parcial' y visible en la cola manual", () => {
    // Documenta honestamente el límite del modelo (ground truth del dueño:
    // cámara confirmada vacía) — no se fuerza el número para que "cuadre":
    // 89,96% queda por debajo incluso del umbral relajado (~92,47% a 91
    // días). Sigue "parcial", así que sigue en la lista para cierre MANUAL
    // (probablementeTerminado ya lo señala con "¿terminado?"), en vez de
    // cerrarse solo con un umbral inventado a medida de un caso.
    const capacidadFraccionEstimada = (dias: number) => (1 - Math.min(0.15, 0.000513 * dias)) * (1 - 0.03);
    const entrada = { lote: "26050508", fecha: "2026-05-05", kg_entrada: 22900, finca: "La Torrecilla", articulo: "NAR VAL DELTA SEEDLESS", agricultor: null };
    const procesados = [{ lote_codigo: "26050508", kg_peso_total: 20600, date: "2026-06-01" }]; // 89,96%
    const stock = buildStockEntradas([entrada], procesados, "2026-08-04", undefined, capacidadFraccionEstimada);
    expect(stock.filas[0].estado).toBe("parcial");
    expect(stock.filas[0].probablementeTerminado).toBe(true);
  });
});

describe("esCandidatoCierreAutomatico — selección del cierre automático persistido (refuerzo 2026-08-03)", () => {
  it("DIAS_SIN_ACTIVIDAD_AUTOCIERRE es 2 (mucho más corto que el de la cola manual, ver cabecera del archivo)", () => {
    expect(DIAS_SIN_ACTIVIDAD_AUTOCIERRE).toBe(2);
    expect(DIAS_SIN_ACTIVIDAD_AUTOCIERRE).toBeLessThan(DIAS_SIN_ACTIVIDAD_TERMINADO);
  });

  const entradaBase = { lote: "26070101", fecha: "2026-07-01", kg_entrada: 10000, finca: null, articulo: "NAVEL", agricultor: null };

  it("COMPLETO (≥97%) y ≥2 días sin pasadas nuevas -> true", () => {
    const procesados = [{ lote_codigo: "26070101", kg_peso_total: 9800, date: "2026-07-10" }]; // 98%, hace 2 días
    const stock = buildStockEntradas([entradaBase], procesados, "2026-07-12");
    const fila = stock.filas[0];
    expect(fila.estado).toBe("procesado");
    expect(esCandidatoCierreAutomatico(fila, "2026-07-12")).toBe(true);
  });

  it("COMPLETO pero con una pasada de ayer (1 día) -> false: se espera a que se asiente", () => {
    const procesados = [{ lote_codigo: "26070101", kg_peso_total: 9800, date: "2026-07-11" }]; // 98%, hace 1 día
    const stock = buildStockEntradas([entradaBase], procesados, "2026-07-12");
    const fila = stock.filas[0];
    expect(fila.estado).toBe("procesado");
    expect(esCandidatoCierreAutomatico(fila, "2026-07-12")).toBe(false);
  });

  it("96% (parcial, no COMPLETO) -> false aunque lleve muchos días sin actividad", () => {
    const procesados = [{ lote_codigo: "26070101", kg_peso_total: 9600, date: "2026-07-01" }]; // 96%
    const stock = buildStockEntradas([entradaBase], procesados, "2026-07-20");
    const fila = stock.filas[0];
    expect(fila.estado).toBe("parcial");
    expect(esCandidatoCierreAutomatico(fila, "2026-07-20")).toBe(false);
  });

  it("ya cerrado (cerrado_at relleno) -> false: no hay nada que cerrar de nuevo", () => {
    const cerrado = { ...entradaBase, cerrado_at: "2026-07-05T00:00:00Z" };
    const procesados = [{ lote_codigo: "26070101", kg_peso_total: 9800, date: "2026-07-01" }];
    const stock = buildStockEntradas([cerrado], procesados, "2026-07-20");
    const fila = stock.filas[0];
    expect(fila.estado).toBe("procesado");
    expect(esCandidatoCierreAutomatico(fila, "2026-07-20")).toBe(false);
  });

  it("sin ultima_fecha_procesado conocida (llegó al umbral solo por kg_ajuste_stock) -> false: no se puede demostrar inactividad reciente", () => {
    const conAjuste = { ...entradaBase, kg_ajuste_stock: 10000 }; // 100% solo por ajuste, sin ninguna pasada de lotes_dia
    const stock = buildStockEntradas([conAjuste], [], "2026-07-20");
    const fila = stock.filas[0];
    expect(fila.estado).toBe("procesado");
    expect(fila.ultima_fecha_procesado).toBeNull();
    expect(esCandidatoCierreAutomatico(fila, "2026-07-20")).toBe(false);
  });

  it("calibradorSuperaEntrada (>100% procesado) y ≥2 días -> true: un lote inflado por un reparto también cierra", () => {
    const procesados = [{ lote_codigo: "26070101", kg_peso_total: 12000, date: "2026-07-10" }]; // 120%
    const stock = buildStockEntradas([entradaBase], procesados, "2026-07-12");
    const fila = stock.filas[0];
    expect(fila.estado).toBe("procesado");
    expect(esCandidatoCierreAutomatico(fila, "2026-07-12")).toBe(true);
  });

  it("usa exactamente DIAS_SIN_ACTIVIDAD_AUTOCIERRE como frontera (>=, no >)", () => {
    const procesados = [{ lote_codigo: "26070101", kg_peso_total: 9800, date: "2026-07-10" }];
    const enElUmbral = buildStockEntradas([entradaBase], procesados, "2026-07-12").filas[0]; // exactamente 2 días
    const debajoDelUmbral = buildStockEntradas([entradaBase], procesados, "2026-07-11").filas[0]; // 1 día
    expect(esCandidatoCierreAutomatico(enElUmbral, "2026-07-12")).toBe(true);
    expect(esCandidatoCierreAutomatico(debajoDelUmbral, "2026-07-11")).toBe(false);
  });

  it("no candidato si NO está en estado 'procesado' (pendiente o parcial)", () => {
    const pendiente = buildStockEntradas([entradaBase], [], "2026-07-20").filas[0];
    expect(esCandidatoCierreAutomatico(pendiente, "2026-07-20")).toBe(false);
  });
});

describe("enCamaraConfirmada — protección simétrica en los candidatos (ground truth del dueño 04-08-2026 nº2, PRIORIDAD MÁXIMA)", () => {
  // Casos de control reales: 26050809/26051106/26052207/26052506 (todos
  // Invermarmelo/Guadex), revertidos en BD por el dueño tras confirmar que
  // siguen físicamente en cámara. Antes de esta protección, un derrame o un
  // kg_ajuste_stock erróneo los habría dejado "procesado" y el auto-cierre
  // los habría cerrado "con_analisis" — físicamente imposible.
  const codigosGuadex = ["26050809", "26051106", "26052207", "26052506"];

  it.each(codigosGuadex)("%s: aunque algo le dé el 100%% de kg (derrame, ajuste de stock…), nunca es candidato a cierre COMPLETO", (lote) => {
    const entradaGuadex = { lote, fecha: "2026-05-08", kg_entrada: 20000, finca: "INVERMARMELO - GG", articulo: "NAR VAL DELTA SEEDLESS", agricultor: null };
    const procesados = [{ lote_codigo: lote, kg_peso_total: 20000, date: "2026-05-10" }]; // 100%, 2+ días
    const stock = buildStockEntradas([entradaGuadex], procesados, "2026-08-04", undefined, undefined, new Set([lote]));
    const fila = stock.filas[0];
    expect(fila.estado).toBe("procesado"); // el cálculo de pct no cambia...
    expect(fila.enCamaraConfirmada).toBe(true);
    expect(esCandidatoCierreAutomatico(fila, "2026-08-04")).toBe(false); // ...pero NUNCA cierra solo
  });

  it.each(codigosGuadex)("%s: tampoco es candidato a cierre COMPUESTO aunque tenga evidencia de pasada compuesta", (lote) => {
    const entradaGuadex = { lote, fecha: "2026-05-08", kg_entrada: 20000, finca: "INVERMARMELO - GG", articulo: "NAR VAL DELTA SEEDLESS", agricultor: null };
    const huerfanos = new Map([[lote, { primeros: ["26050501"], ultimaFecha: "2026-05-10" }]]);
    const stock = buildStockEntradas([entradaGuadex], [], "2026-08-04", huerfanos, undefined, new Set([lote]));
    const fila = stock.filas[0];
    expect(fila.enCamaraConfirmada).toBe(true);
    expect(esCandidatoCierreCompuesto(fila, "2026-08-04")).toBe(false);
  });

  it("sin la señal (Set ausente o sin el lote), el comportamiento es el de siempre — no rompe nada existente", () => {
    const entradaNormal = { lote: "26080101", fecha: "2026-08-01", kg_entrada: 10000, finca: "DEHESILLA", articulo: "NAVEL", agricultor: "X" };
    const procesados = [{ lote_codigo: "26080101", kg_peso_total: 9800, date: "2026-08-01" }];
    const stock = buildStockEntradas([entradaNormal], procesados, "2026-08-04");
    expect(stock.filas[0].enCamaraConfirmada).toBe(false);
    expect(esCandidatoCierreAutomatico(stock.filas[0], "2026-08-04")).toBe(true);
  });

  it("esCandidatoCierreAutomatico/esCandidatoCierreCompuesto: enCamaraConfirmada manda incluso si el resto de condiciones serían candidatas", () => {
    expect(esCandidatoCierreAutomatico(
      { estado: "procesado", cerrado_at: null, ultima_fecha_procesado: "2026-08-01", enCamaraConfirmada: true, completoConEvidencia: true },
      "2026-08-04",
    )).toBe(false);
    expect(esCandidatoCierreCompuesto(
      { cerrado_at: null, procesadoEnCompuesto: { primeros: ["X"], ultimaFecha: "2026-08-01" }, enCamaraConfirmada: true },
      "2026-08-04",
    )).toBe(false);
  });

  it("la UNIÓN también protege por la señal de CONFIRMACIÓN FÍSICA (camara_confirmada_nombre/fecha), no solo por cámara externa: mismo Set, misma protección", () => {
    // Caso real: uno de los 26 lotes de la cámara 5 confirmados por el dueño
    // el 04-08-2026 (fixture del encargo). No viene de camarasExternas.ts, es
    // la unión que useEntradasBascula.ts construye con camaraConfirmada.ts.
    const entradaCamara5 = { lote: "26051408", fecha: "2026-05-14", kg_entrada: 18500, finca: "LA HOYA", articulo: "NAVEL", agricultor: null };
    const procesados = [{ lote_codigo: "26051408", kg_peso_total: 18500, date: "2026-05-16" }]; // 100%, 2+ días
    const stock = buildStockEntradas([entradaCamara5], procesados, "2026-08-04", undefined, undefined, new Set(["26051408"]));
    const fila = stock.filas[0];
    expect(fila.estado).toBe("procesado");
    expect(fila.enCamaraConfirmada).toBe(true);
    expect(esCandidatoCierreAutomatico(fila, "2026-08-04")).toBe(false);
  });

  it("(b) confirmacionCamaraPorLote alimenta StockLoteRow.confirmacionCamara (nombre + fecha) para el badge, construido end-to-end con camaraConfirmadaVigentePorLote", () => {
    const entradaConfirmada: EntradaConCamaraConfirmada = { lote: "26051906", camara_confirmada_nombre: "Cámara 5", camara_confirmada_fecha: "2026-08-04" };
    const vigentes = camaraConfirmadaVigentePorLote([entradaConfirmada], []); // sin pasadas: nada que caducar
    const entradaLote = { lote: "26051906", fecha: "2026-05-19", kg_entrada: 15000, finca: "LA HOYA", articulo: "NAVEL", agricultor: null };
    const stock = buildStockEntradas([entradaLote], [], "2026-08-04", undefined, undefined, new Set(vigentes.keys()), vigentes);
    const fila = stock.filas[0];
    expect(fila.enCamaraConfirmada).toBe(true);
    expect(fila.confirmacionCamara).toEqual({ nombre: "Cámara 5", fecha: "2026-08-04" });
    expect(esCandidatoCierreAutomatico(fila, "2026-08-04")).toBe(false);
  });

  it("(c) señal CADUCADA (pasada propia posterior a la confirmación): el lote vuelve al ciclo normal — candidato a cierre como cualquier otro", () => {
    const entradaConfirmada: EntradaConCamaraConfirmada = { lote: "26052602", camara_confirmada_nombre: "Cámara 5", camara_confirmada_fecha: "2026-08-04" };
    // Pasada propia el 06-08 (posterior a la confirmación 04-08): la fruta
    // empezó a salir de verdad, la señal caduca sola.
    const pasadaPosterior = [{ lote_codigo: "26052602", kg_peso_total: 12000, date: "2026-08-06" }];
    const vigentes = camaraConfirmadaVigentePorLote([entradaConfirmada], pasadaPosterior);
    expect(vigentes.size).toBe(0); // caducada: no sale en el mapa

    const entradaLote = { lote: "26052602", fecha: "2026-05-26", kg_entrada: 12000, finca: "LA HOYA", articulo: "NAVEL", agricultor: null };
    const stock = buildStockEntradas([entradaLote], pasadaPosterior, "2026-08-08", undefined, undefined, new Set(vigentes.keys()), vigentes);
    const fila = stock.filas[0];
    expect(fila.enCamaraConfirmada).toBe(false); // ya no protegido
    expect(fila.confirmacionCamara).toBeNull();
    expect(fila.estado).toBe("procesado"); // 100% procesado por su propia pasada
    expect(esCandidatoCierreAutomatico(fila, "2026-08-08")).toBe(true); // candidato normal, sin excepción
  });
});

describe("procesadoEnCompuesto / esCandidatoCierreCompuesto — huérfanos de pasada compuesta (refuerzo 04-08-2026, AJUSTADO tras validación en real del commit ae30f5a)", () => {
  const activo = { lote: "26080101", fecha: "2026-08-01", kg_entrada: 10000, finca: "DEHESILLA", articulo: "NAVEL", agricultor: "X" };
  // Réplica exacta de capacidadFraccionEstimada (conciliacionKg.ts) para no
  // importarla aquí (evitaría el ciclo de imports) — mismos números.
  const fraccionEsperadaPorEdad = (dias: number) => (1 - Math.min(0.15, 0.000513 * dias)) * (1 - 0.03);

  it("CAUSA RAÍZ confirmada contra la BD real: 0 kg EXACTOS bajo su propio código casi nunca ocurre — sin la relajación por edad, un pendiente grande NO se marca (documenta el bug que reportó el dueño)", () => {
    const huerfanos = new Map([["26080101", { primeros: ["26080001"], ultimaFecha: "2026-08-05" }]]);
    // Sin fraccionEsperadaPorEdad: el hueco explicable es 0, así que un
    // pendiente de 10000 (0 kg conciliados) no cabe -> no se marca. Esto es
    // justo lo que pasaba en producción: candidatosCierreCompuesto salía
    // vacío porque la fase 1 (o kg_ajuste_stock) casi nunca deja el
    // pendiente en 0 exacto.
    const stock = buildStockEntradas([activo], [], "2026-08-06", huerfanos);
    expect(stock.filas[0].procesadoEnCompuesto).toBeNull();
    expect(stock.filas[0].estado).toBe("pendiente");
  });

  it("pendiente DENTRO del hueco esperado por edad (con fraccionEsperadaPorEdad inyectada) -> procesado en compuesto", () => {
    const huerfanos = new Map([["26080101", { primeros: ["26080001"], ultimaFecha: "2026-08-05" }]]);
    // A 90 días el hueco explicable es kg_entrada×(1−0,9252)≈748 kg. Con un
    // pendiente de 700 kg (kgProcesado 9300, 93%) el hueco SÍ lo cubre.
    const viejo = { ...activo, fecha: "2026-05-08" }; // ~90 días hasta 2026-08-06
    const procesados = [{ lote_codigo: "26080101", kg_peso_total: 9300, date: "2026-06-01" }];
    const stock = buildStockEntradas([viejo], procesados, "2026-08-06", huerfanos, fraccionEsperadaPorEdad);
    const fila = stock.filas[0];
    expect(fila.estado).toBe("procesado");
    expect(fila.kg_en_camara).toBe(0);
    expect(fila.procesadoEnCompuesto).toEqual({ primeros: ["26080001"], ultimaFecha: "2026-08-05" });
    expect(stock.kgEnCamara).toBe(0);
  });

  it("pendiente POR ENCIMA del hueco esperado por edad -> se queda 'parcial', NO se cierra ni se marca (el reparto por fase 1 dejó demasiado sin explicar)", () => {
    const huerfanos = new Map([["26080101", { primeros: ["26080001"], ultimaFecha: "2026-08-05" }]]);
    const viejo = { ...activo, fecha: "2026-05-08" }; // ~90 días, hueco esperado ≈748 kg
    // Pendiente real de 2000 kg (80% procesado): supera el hueco esperado.
    const procesados = [{ lote_codigo: "26080101", kg_peso_total: 8000, date: "2026-06-01" }];
    const stock = buildStockEntradas([viejo], procesados, "2026-08-06", huerfanos, fraccionEsperadaPorEdad);
    const fila = stock.filas[0];
    expect(fila.estado).toBe("parcial");
    expect(fila.procesadoEnCompuesto).toBeNull();
    expect(fila.kg_en_camara).toBe(2000);
  });

  it("CASO DE CONTROL real (26042109, nombrado en '26042010- 26042109', cámara física vacía confirmada por el dueño): kg_ajuste_stock cubre el 100% -> pendiente 0 -> SIEMPRE candidato, incluso sin fraccionEsperadaPorEdad", () => {
    const entrada26042109 = {
      lote: "26042109", fecha: "2026-04-21", kg_entrada: 21280, finca: "Melendez - GG", articulo: "NAR VAL DELTA SEEDLESS", agricultor: null,
      kg_ajuste_stock: 21280, // confirmado en BD: ajuste de stock cubre la entrada entera
    };
    const huerfanos = new Map([["26042109", { primeros: ["26042010"], ultimaFecha: "2026-06-26" }]]);
    const stock = buildStockEntradas([entrada26042109], [], "2026-08-04", huerfanos); // sin fraccionEsperadaPorEdad: da igual, pendiente ya es 0
    const fila = stock.filas[0];
    expect(fila.estado).toBe("procesado");
    expect(fila.procesadoEnCompuesto).toEqual({ primeros: ["26042010"], ultimaFecha: "2026-06-26" });
    expect(esCandidatoCierreCompuesto(fila, "2026-08-04")).toBe(true); // 39 días desde la mención, sobra margen
  });

  it("sin evidencia de compuesta (no está en el mapa) -> se queda 'pendiente' de siempre, sin tocar", () => {
    const stock = buildStockEntradas([activo], [], "2026-08-06", new Map());
    expect(stock.filas[0].estado).toBe("pendiente");
    expect(stock.filas[0].procesadoEnCompuesto).toBeNull();
  });

  it("lote YA cerrado a mano -> el mapa de huérfanos se ignora (cerrado_at manda, no se pisa)", () => {
    const cerrado = { ...activo, cerrado_at: "2026-08-02T00:00:00Z" };
    const huerfanos = new Map([["26080101", { primeros: ["26080001"], ultimaFecha: "2026-08-05" }]]);
    const stock = buildStockEntradas([cerrado], [], "2026-08-06", huerfanos);
    expect(stock.filas[0].procesadoEnCompuesto).toBeNull();
  });

  it("esCandidatoCierreCompuesto: true con ≥2 días desde la ÚLTIMA pasada compuesta que lo menciona", () => {
    const filaListo = { cerrado_at: null, procesadoEnCompuesto: { primeros: ["X"], ultimaFecha: "2026-08-01" }, enCamaraConfirmada: false };
    expect(esCandidatoCierreCompuesto(filaListo, "2026-08-03")).toBe(true); // exactamente 2 días
    expect(esCandidatoCierreCompuesto(filaListo, "2026-08-02")).toBe(false); // 1 día: se espera a que se asiente
  });

  it("esCandidatoCierreCompuesto: false sin evidencia, ya cerrado, o evidencia sin fecha (nunca se demuestra el margen a ciegas)", () => {
    expect(esCandidatoCierreCompuesto({ cerrado_at: null, procesadoEnCompuesto: null, enCamaraConfirmada: false }, "2026-08-10")).toBe(false);
    expect(esCandidatoCierreCompuesto(
      { cerrado_at: "2026-08-01T00:00:00Z", procesadoEnCompuesto: { primeros: ["X"], ultimaFecha: "2026-07-01" }, enCamaraConfirmada: false },
      "2026-08-10",
    )).toBe(false);
    expect(esCandidatoCierreCompuesto(
      { cerrado_at: null, procesadoEnCompuesto: { primeros: ["X"], ultimaFecha: null }, enCamaraConfirmada: false },
      "2026-08-10",
    )).toBe(false);
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

// ─── REGLA DE ORO (refundación, fase 2 puente): el derrame no cierra lotes ──
// Aprobada por el dueño el 04-08-2026 (docs/TRAZABILIDAD_REFUNDACION.md).
// Caso real que la motiva: 18 lotes intactos de la Cámara 5 con 310 t
// atribuidas por derrame; 8 se cerraron solos como "con_analisis".
describe("regla de oro: kg de derrame no puntúan para el cierre automático", () => {
  // 26051509 (caso real): 20.220 kg de entrada, CERO pasadas propias, todo su
  // "procesado" viene de derrame de la conciliación.
  const entrada = { lote: "26051509", fecha: "2026-05-15", kg_entrada: 20220, finca: "INVERMARMELO - GG", articulo: "NAR VAL DELTA SEEDLESS", agricultor: null };
  // buildStockEntradas recibe los procesados YA conciliados (derrame incluido):
  // se simula la fila conciliada que el hook le pasa de verdad.
  const procesadosConciliados = [{ lote_codigo: "26051509", kg_peso_total: 19613, date: "2026-05-20" }];

  it("un lote 'completo' SOLO por derrame no es candidato (completoConEvidencia=false), aunque su estado derivado pinte procesado", () => {
    const stock = buildStockEntradas(
      [entrada], procesadosConciliados, "2026-08-04",
      undefined,
      (dias) => (dias >= 80 ? 0.93 : 1), // umbral por edad, como lo inyecta el hook (81 días)
      undefined, undefined,
      new Map([["26051509", 19613]]), // todo lo suyo era derrame
    );
    const fila = stock.filas[0];
    expect(fila.estado).toBe("procesado"); // la vista derivada no cambia (sigue siendo útil para investigar)
    expect(fila.completoConEvidencia).toBe(false);
    expect(esCandidatoCierreAutomatico(fila, "2026-08-04")).toBe(false);
  });

  it("con evidencia real (pasadas propias) y solo un pico de derrame, sigue siendo candidato: la regla no castiga a los legítimos", () => {
    const stock = buildStockEntradas(
      [entrada], procesadosConciliados, "2026-08-04", undefined, undefined, undefined, undefined,
      new Map([["26051509", 500]]), // derrame marginal: 19.113 kg propios ≥ umbral por edad
      // sin fraccionEsperadaPorEdad el umbral es el 97% plano: 19.113/20.220 = 94,5% < 97% → no completo…
    );
    // …así que este caso usa el umbral por edad real (misma inyección que el hook):
    const stockConEdad = buildStockEntradas(
      [entrada], procesadosConciliados, "2026-08-04", undefined,
      (dias) => (dias >= 80 ? 0.93 : 1), // a 81 días la edad ya explica un 7% de hueco
      undefined, undefined,
      new Map([["26051509", 500]]),
    );
    expect(stock.filas[0].completoConEvidencia).toBe(false); // plano: honesto, no llega
    expect(stockConEdad.filas[0].completoConEvidencia).toBe(true);
    expect(esCandidatoCierreAutomatico(stockConEdad.filas[0], "2026-08-04")).toBe(true);
  });

  it("sin el mapa inyectado (llamadas/tests antiguos) nada cambia: compatibilidad total", () => {
    const stock = buildStockEntradas([entrada], procesadosConciliados, "2026-08-04", undefined, (dias) => (dias >= 80 ? 0.93 : 1));
    expect(stock.filas[0].completoConEvidencia).toBe(true);
    expect(esCandidatoCierreAutomatico(stock.filas[0], "2026-08-04")).toBe(true);
  });

  it("el candidato COMPUESTO tampoco se deja explicar el pendiente por derrame: sin el descuento sería candidato, con él no", () => {
    const huerfanos = new Map([["26051509", { primeros: ["26051401"], ultimaFecha: "2026-05-20" }]]);
    const fraccion = (dias: number) => (dias >= 80 ? 0.95 : 1); // la edad explica un 5% (1.011 kg)
    // Con derrame contando (mapa ausente): pendiente = 20.220 − 19.613 = 607 ≤ 1.011 → candidato.
    const sinRegla = buildStockEntradas([entrada], procesadosConciliados, "2026-08-04", huerfanos, fraccion);
    expect(sinRegla.filas[0].procesadoEnCompuesto).not.toBeNull();
    // Con la regla de oro: pendiente real = 20.220 − 0 = 20.220 > 1.011 → nada de candidato.
    const conRegla = buildStockEntradas(
      [entrada], procesadosConciliados, "2026-08-04", huerfanos, fraccion, undefined, undefined,
      new Map([["26051509", 19613]]),
    );
    expect(conRegla.filas[0].procesadoEnCompuesto).toBeNull();
    expect(esCandidatoCierreCompuesto(conRegla.filas[0], "2026-08-04")).toBe(false);
  });
});

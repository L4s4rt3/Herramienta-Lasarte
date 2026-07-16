import { describe, expect, it } from "vitest";
import {
  agruparForfait,
  computeForfaitLote,
  computeForfaitLotes,
  forfaitProyectado,
  PCT_PODRIDO_NO_PESADO_DEFECTO,
  perdidaSimulada,
  precioMaxCompra,
  type ItemForfaitAgrupable,
} from "./forfait";
import {
  computeMermaLotes,
  type ClasificacionLoteInput,
  type EntradaLoteInput,
  type LoteDiaKgInput,
  type MermaLote,
  type ParteMermaInput,
} from "./mermaLote";

// Entrada mínima con solo lo necesario para el caso dado.
function entrada(overrides: Partial<EntradaLoteInput> & { lote: string; kg_entrada: number }): EntradaLoteInput {
  return {
    fecha: "2026-05-01",
    kg_ajuste_stock: 0,
    importe_compra: null,
    coste_recoleccion: null,
    importe_transporte: null,
    importe_comision: null,
    importe_total: null,
    ...overrides,
  };
}

// Construye un único MermaLote real (vía computeMermaLotes) a partir de
// parámetros simples, para que los tests de forfait.ts trabajen sobre datos
// internamente consistentes (mismas invariantes que produce el pipeline real:
// estado "procesado" exige kgCalibrador >= 97% de kgEntrada, ver
// UMBRAL_PROCESADO en entradasBascula.ts) en vez de objetos MermaLote
// fabricados a mano que podrían violar esa invariante sin darse cuenta.
function loteMerma(params: {
  lote: string;
  kgEntrada: number;
  kgCalibrador: number;
  podridoCalibradorKg?: number;
  podridoManualKg?: number;
  importeTotal: number;
  clasificacionPodrido?: number; // si se pasa, genera Informe LOTE real con este valor
}): MermaLote {
  const {
    lote, kgEntrada, kgCalibrador, podridoCalibradorKg = 0, podridoManualKg = 0, importeTotal, clasificacionPodrido,
  } = params;
  const entradas = [entrada({ lote, kg_entrada: kgEntrada, importe_total: importeTotal })];
  const lotesDia: LoteDiaKgInput[] = [{ lote_codigo: lote, kg_peso_total: kgCalibrador, part_id: "p1" }];
  const partes: ParteMermaInput[] = [
    { part_id: "p1", kg_podrido_calibrador_auto: podridoCalibradorKg, kg_podrido_bolsa_basura: podridoManualKg },
  ];
  const clasificacion: ClasificacionLoteInput[] = clasificacionPodrido != null
    ? [{ lote_codigo: lote, clase: "(J) Podrido", peso_kg: clasificacionPodrido }]
    : [];
  const [resultado] = computeMermaLotes(entradas, lotesDia, clasificacion, partes);
  return resultado;
}

describe("computeForfaitLote — fórmulas básicas", () => {
  it("kgAprovechable, forfait, nominal y sobrecoste con un caso simple", () => {
    // 1000 kg entrada, 980 al calibrador (98%, "procesado"; merma natural 20,
    // fuera de kgAprovechable por definición). Del calibrador se descartan
    // 30 (calibrador) + 10 (manual).
    const lote = loteMerma({
      lote: "26050101", kgEntrada: 1000, kgCalibrador: 980, podridoCalibradorKg: 30, podridoManualKg: 10, importeTotal: 475, // 0.475 €/kg nominal
    });
    expect(lote.estado).toBe("procesado");
    const forfait = computeForfaitLote(lote)!;

    expect(forfait.kgAprovechable).toBeCloseTo(980 - 30 - 10); // 940
    expect(forfait.sinForfait).toBe(false);
    expect(forfait.eurKgNominal).toBeCloseTo(475 / 1000); // 0.475
    expect(forfait.forfaitEurKg).toBeCloseTo(475 / 940);
    expect(forfait.sobrecosteEurKg).toBeCloseTo(475 / 940 - 475 / 1000);
    expect(forfait.sobrecosteEurKg!).toBeGreaterThan(0); // el forfait siempre >= nominal (aprovechable <= entrada)
    expect(forfait.pctPerdidaTotal).toBeCloseTo((1000 - 940) / 1000); // 0.06
  });

  it("un lote sin ninguna pérdida (podrido 0, calibrador = entrada): forfait === nominal", () => {
    const lote = loteMerma({ lote: "26050102", kgEntrada: 1000, kgCalibrador: 1000, importeTotal: 500 });
    const forfait = computeForfaitLote(lote)!;
    expect(forfait.kgAprovechable).toBe(1000);
    expect(forfait.forfaitEurKg).toBeCloseTo(0.5);
    expect(forfait.eurKgNominal).toBeCloseTo(0.5);
    expect(forfait.sobrecosteEurKg).toBeCloseTo(0);
    expect(forfait.pctPerdidaTotal).toBeCloseTo(0);
  });
});

describe("computeForfaitLote — guards", () => {
  it("kgAprovechable exactamente 0: sinForfait=true, forfaitEurKg null (no Infinity)", () => {
    // kgCalibrador 971 (97,1%, sigue "procesado"); podrido calibrador+manual
    // suma exactamente 971 -> no queda nada aprovechable.
    const lote = loteMerma({
      lote: "26050103", kgEntrada: 1000, kgCalibrador: 971, podridoCalibradorKg: 600, podridoManualKg: 371, importeTotal: 200,
    });
    expect(lote.estado).toBe("procesado");
    const forfait = computeForfaitLote(lote)!;
    expect(forfait.kgAprovechable).toBe(0);
    expect(forfait.sinForfait).toBe(true);
    expect(forfait.forfaitEurKg).toBeNull();
    expect(forfait.sobrecosteEurKg).toBeNull();
    // el resto de cifras se calcula igual: no es un objeto todo-null.
    expect(forfait.eurKgNominal).toBeCloseTo(0.2);
    expect(forfait.pctPerdidaTotal).toBeCloseTo(1); // 100% perdido
  });

  it("kgAprovechable negativo (podrido declarado mayor que lo pesado, dato a revisar): mismo guard", () => {
    const lote = loteMerma({
      lote: "26050104", kgEntrada: 1000, kgCalibrador: 971, podridoCalibradorKg: 600, podridoManualKg: 401, importeTotal: 200,
    });
    const forfait = computeForfaitLote(lote)!;
    expect(forfait.kgAprovechable).toBeCloseTo(-30);
    expect(forfait.sinForfait).toBe(true);
    expect(forfait.forfaitEurKg).toBeNull();
  });

  it("lote sin coste (sinCoste=true): computeForfaitLote devuelve null", () => {
    const lote = loteMerma({ lote: "26050105", kgEntrada: 1000, kgCalibrador: 1000, importeTotal: 0 });
    expect(lote.sinCoste).toBe(true);
    expect(computeForfaitLote(lote)).toBeNull();
  });

  it("lote no procesado (parcial): computeForfaitLote devuelve null aunque tenga importe", () => {
    const entradas = [entrada({ lote: "26050106", kg_entrada: 1000, importe_total: 500 })];
    const lotesDia: LoteDiaKgInput[] = [{ lote_codigo: "26050106", kg_peso_total: 500, part_id: "p1" }]; // 50% -> parcial
    const [lote] = computeMermaLotes(entradas, lotesDia, [], [{ part_id: "p1", kg_podrido_calibrador_auto: 0, kg_podrido_bolsa_basura: 0 }]);
    expect(lote.estado).toBe("parcial");
    expect(computeForfaitLote(lote)).toBeNull();
  });

  it("computeForfaitLotes descarta los null y conserva el resto", () => {
    const procesado = loteMerma({ lote: "26050107", kgEntrada: 1000, kgCalibrador: 1000, importeTotal: 500 });
    const sinCoste = loteMerma({ lote: "26050108", kgEntrada: 1000, kgCalibrador: 1000, importeTotal: 0 });
    const resultado = computeForfaitLotes([procesado, sinCoste]);
    expect(resultado).toHaveLength(1);
    expect(resultado[0].lote).toBe("26050107");
  });

  it("lote cerrado sin_registro (procesado no consta bajo su código): computeForfaitLote devuelve null aunque esté 'procesado' y tenga coste", () => {
    // Caso real: 24.900 kg de entrada, 0 kg de procesado bajo su propio
    // código, cerrado con cierre_modo "sin_registro". Sin este guard,
    // kgAprovechable saldría ≈ 0 - 0 - 0 = 0 (kgCalibrador real, no un dato
    // fiable) y el lote contaminaría el forfait del productor con un
    // "aprovechable 0" ficticio.
    const entradas = [entrada({
      lote: "26061203", kg_entrada: 24900, importe_total: 10000,
      cerrado_at: "2026-07-16T10:00:00Z", cierre_modo: "sin_registro",
    })];
    const [lote] = computeMermaLotes(entradas, [], [], []);
    expect(lote.estado).toBe("procesado");
    expect(lote.sinCoste).toBe(false);
    expect(lote.cerradoSinRegistro).toBe(true);
    expect(computeForfaitLote(lote)).toBeNull();
  });
});

describe("computeForfaitLote — coherencia de pctPerdidaTotal con el desglose merma+podrido", () => {
  it("(kgEntrada-kgAprovechable)/kgEntrada === (mermaNaturalKg + podridoCalibrador + podridoManual)/kgEntrada, sin ajuste de stock ni calibradorSuperaEntrada", () => {
    const lote = loteMerma({
      lote: "26050109", kgEntrada: 2000, kgCalibrador: 1950, podridoCalibradorKg: 40, podridoManualKg: 20, importeTotal: 1000,
    });
    expect(lote.estado).toBe("procesado");
    expect(lote.calibradorSuperaEntrada).toBe(false);
    const forfait = computeForfaitLote(lote)!;

    const perdidaViaDesglose = (
      Math.max(0, lote.mermaNaturalKg ?? 0) + (lote.podridoCalibradorKg ?? 0) + (lote.podridoManualKg ?? 0)
    ) / lote.kgEntrada;

    expect(forfait.pctPerdidaTotal).toBeCloseTo(perdidaViaDesglose, 9);
    expect(forfait.pctPerdidaTotal).toBeCloseTo(0.055); // (50 + 40 + 20) / 2000
  });
});

describe("agruparForfait — ponderación (Σcoste/Σaprovechable, NO media de forfaits)", () => {
  it("dos lotes con forfaits muy distintos: el forfait del grupo es la media ponderada, no la aritmética", () => {
    // Lote A: barato y limpio -> forfait bajo, mucho volumen.
    const loteA = loteMerma({ lote: "26050110", kgEntrada: 9000, kgCalibrador: 9000, importeTotal: 4500 }); // forfait 0.5, aprovechable 9000
    // Lote B: caro y con mucho podrido -> forfait alto, poco volumen.
    const loteB = loteMerma({
      lote: "26050111", kgEntrada: 1000, kgCalibrador: 1000, podridoCalibradorKg: 500, importeTotal: 500,
    }); // aprovechable 500, forfait 500/500 = 1.0

    const items: ItemForfaitAgrupable[] = [
      { lote: loteA, groupKey: "id:1", groupLabel: "Productor 1" },
      { lote: loteB, groupKey: "id:1", groupLabel: "Productor 1" },
    ];
    const { grupos } = agruparForfait(items);
    expect(grupos).toHaveLength(1);
    const grupo = grupos[0];

    const forfaitA = computeForfaitLote(loteA)!.forfaitEurKg!;
    const forfaitB = computeForfaitLote(loteB)!.forfaitEurKg!;
    const mediaAritmetica = (forfaitA + forfaitB) / 2; // 0.75
    const mediaPonderada = (4500 + 500) / (9000 + 500); // Σcoste / Σaprovechable

    expect(grupo.kgAprovechable).toBeCloseTo(9500);
    expect(grupo.costeTotalEur).toBeCloseTo(5000);
    expect(grupo.forfaitEurKg).toBeCloseTo(mediaPonderada);
    expect(grupo.forfaitEurKg).not.toBeCloseTo(mediaAritmetica, 2); // distinta de la media simple (0.75)
    expect(grupo.nLotes).toBe(2);
  });

  it("excluye lotes sin coste / no procesados y los cuenta aparte en nLotesExcluidos", () => {
    const bueno = loteMerma({ lote: "26050112", kgEntrada: 1000, kgCalibrador: 1000, importeTotal: 500 });
    const sinCoste = loteMerma({ lote: "26050113", kgEntrada: 1000, kgCalibrador: 1000, importeTotal: 0 });

    const entradasParcial = [entrada({ lote: "26050114", kg_entrada: 1000, importe_total: 500 })];
    const [parcial] = computeMermaLotes(entradasParcial, [{ lote_codigo: "26050114", kg_peso_total: 100, part_id: "p1" }], [], [
      { part_id: "p1", kg_podrido_calibrador_auto: 0, kg_podrido_bolsa_basura: 0 },
    ]);
    expect(parcial.estado).toBe("parcial");

    const items: ItemForfaitAgrupable[] = [
      { lote: bueno, groupKey: "id:1", groupLabel: "Productor 1" },
      { lote: sinCoste, groupKey: "id:1", groupLabel: "Productor 1" },
      { lote: parcial, groupKey: "id:1", groupLabel: "Productor 1" },
    ];
    const { grupos, nLotesExcluidos } = agruparForfait(items);
    expect(nLotesExcluidos).toBe(2);
    expect(grupos).toHaveLength(1);
    expect(grupos[0].nLotes).toBe(1);
  });

  it("agrupa por clave separada (dos productores distintos no se mezclan)", () => {
    const loteA = loteMerma({ lote: "26050115", kgEntrada: 1000, kgCalibrador: 1000, importeTotal: 500 });
    const loteB = loteMerma({ lote: "26050116", kgEntrada: 2000, kgCalibrador: 2000, importeTotal: 1200 });
    const items: ItemForfaitAgrupable[] = [
      { lote: loteA, groupKey: "id:1", groupLabel: "Productor 1" },
      { lote: loteB, groupKey: "id:2", groupLabel: "Productor 2" },
    ];
    const { grupos } = agruparForfait(items);
    expect(grupos).toHaveLength(2);
    const p1 = grupos.find((g) => g.key === "id:1")!;
    const p2 = grupos.find((g) => g.key === "id:2")!;
    expect(p1.forfaitEurKg).toBeCloseTo(0.5);
    expect(p2.forfaitEurKg).toBeCloseTo(0.6);
  });

  it("Σaprovechable <= 0 en TODO el grupo: forfaitEurKg del grupo es null", () => {
    const loteMalo = loteMerma({
      lote: "26050117", kgEntrada: 1000, kgCalibrador: 971, podridoCalibradorKg: 600, podridoManualKg: 371, importeTotal: 200,
    });
    const { grupos } = agruparForfait([{ lote: loteMalo, groupKey: "id:1", groupLabel: "Productor 1" }]);
    expect(grupos[0].kgAprovechable).toBe(0);
    expect(grupos[0].forfaitEurKg).toBeNull();
    expect(grupos[0].eurKgNominal).toBeCloseTo(0.2); // el nominal sigue siendo válido
  });

  it("pctPodridoReal: % de lotes del grupo con Informe LOTE real (no prorrateo)", () => {
    const conInforme = loteMerma({
      lote: "26050118", kgEntrada: 1000, kgCalibrador: 1000, podridoCalibradorKg: 50, importeTotal: 500, clasificacionPodrido: 20,
    });
    expect(conInforme.podridoCalibradorFuente).toBe("real");
    const sinInforme = loteMerma({ lote: "26050119", kgEntrada: 1000, kgCalibrador: 1000, podridoCalibradorKg: 50, importeTotal: 500 });
    expect(sinInforme.podridoCalibradorFuente).toBe("prorrateo");

    const { grupos } = agruparForfait([
      { lote: conInforme, groupKey: "id:1", groupLabel: "Productor 1" },
      { lote: sinInforme, groupKey: "id:1", groupLabel: "Productor 1" },
    ]);
    expect(grupos[0].nLotesPodridoReal).toBe(1);
    expect(grupos[0].pctPodridoReal).toBeCloseTo(50);
  });
});

describe("agruparForfait — pctPerdidaTotal del grupo es ponderado (suma de kg), no media de porcentajes", () => {
  it("un lote grande con poca pérdida + uno pequeño con mucha pérdida: el % del grupo se acerca al del lote grande", () => {
    const grande = loteMerma({ lote: "26050120", kgEntrada: 9000, kgCalibrador: 8900, importeTotal: 4500 }); // (9000-8900)/9000 ≈ 1.11% pérdida
    const pequeño = loteMerma({
      lote: "26050121", kgEntrada: 1000, kgCalibrador: 1000, podridoCalibradorKg: 500, importeTotal: 500,
    }); // (1000-500)/1000 = 50% pérdida (todo podrido de calibrador, kgAprovechable=500)

    const { grupos } = agruparForfait([
      { lote: grande, groupKey: "id:1", groupLabel: "P" },
      { lote: pequeño, groupKey: "id:1", groupLabel: "P" },
    ]);
    const grupo = grupos[0];
    const pctEsperado = (10000 - (8900 + 500)) / 10000; // (ΣkgEntrada - Σaprovechable)/ΣkgEntrada = 0.06
    expect(grupo.pctPerdidaTotal).toBeCloseTo(pctEsperado);

    const pctIndividualGrande = (9000 - 8900) / 9000;
    const pctIndividualPequeño = (1000 - 500) / 1000;
    const mediaAritmeticaSimple = (pctIndividualGrande + pctIndividualPequeño) / 2; // ≈ 0.2556, muy por encima
    expect(grupo.pctPerdidaTotal!).toBeLessThan(mediaAritmeticaSimple / 2); // el ponderado queda mucho más cerca del lote grande
  });
});

describe("forfaitProyectado", () => {
  it("precio / (1 - pctPerdida)", () => {
    expect(forfaitProyectado(0.4, 0.2)).toBeCloseTo(0.5); // 0.4 / 0.8
    expect(forfaitProyectado(1, 0)).toBeCloseTo(1); // sin pérdida, forfait = precio
  });

  it("null si pctPerdida >= 1 (100% o más de pérdida): no hay forfait finito", () => {
    expect(forfaitProyectado(0.5, 1)).toBeNull();
    expect(forfaitProyectado(0.5, 1.2)).toBeNull();
  });

  it("pctPerdida negativa (caso raro, calibradorSuperaEntrada) no rompe la fórmula", () => {
    expect(forfaitProyectado(0.5, -0.1)).toBeCloseTo(0.5 / 1.1);
  });
});

describe("precioMaxCompra", () => {
  it("objetivo × (1 - pctPerdida)", () => {
    expect(precioMaxCompra(0.5, 0.2)).toBeCloseTo(0.4);
    expect(precioMaxCompra(1, 0)).toBeCloseTo(1);
  });

  it("pctPerdida >= 1 da un precio <= 0 (ningún precio de compra sería rentable), no se oculta ni se lanza error", () => {
    expect(precioMaxCompra(0.5, 1)).toBeCloseTo(0);
    expect(precioMaxCompra(0.5, 1.5)).toBeCloseTo(-0.25);
  });
});

// ─── Podrido DESCONOCIDO (import histórico de campaña, jul 2026) ────────────

describe("computeForfaitLote — podrido desconocido (kgAprovechable solo con lo conocido)", () => {
  it("lote con podrido totalmente desconocido: kgAprovechable = kgCalibrador (nada se resta) y podridoDesconocido=true", () => {
    const entradas = [entrada({ lote: "25101601", kg_entrada: 1000, importe_total: 500 })];
    const lotesDia: LoteDiaKgInput[] = [{ lote_codigo: "25101601", kg_peso_total: 1000, part_id: "p-historico" }];
    const partes: ParteMermaInput[] = [
      { part_id: "p-historico", kg_podrido_calibrador_auto: null, kg_podrido_bolsa_basura: null },
    ];
    const [lote] = computeMermaLotes(entradas, lotesDia, [], partes);
    expect(lote.podridoCalibradorKg).toBeNull();
    expect(lote.podridoDesconocido).toBe(true);

    const forfait = computeForfaitLote(lote)!;
    expect(forfait.kgAprovechable).toBe(1000); // 1000 - 0 - 0, no null: "solo con lo conocido"
    expect(forfait.podridoDesconocido).toBe(true);
    expect(forfait.forfaitEurKg).toBeCloseTo(0.5);
  });

  it("agruparForfait cuenta nLotesPodridoDesconocido en el grupo", () => {
    const entradas = [entrada({ lote: "25101601", kg_entrada: 1000, importe_total: 500 })];
    const lotesDia: LoteDiaKgInput[] = [{ lote_codigo: "25101601", kg_peso_total: 1000, part_id: "p-historico" }];
    const partes: ParteMermaInput[] = [
      { part_id: "p-historico", kg_podrido_calibrador_auto: null, kg_podrido_bolsa_basura: null },
    ];
    const [loteDesconocido] = computeMermaLotes(entradas, lotesDia, [], partes);
    const loteNormal = loteMerma({ lote: "26050101", kgEntrada: 1000, kgCalibrador: 1000, importeTotal: 500 });

    const { grupos } = agruparForfait([
      { lote: loteDesconocido, groupKey: "id:1", groupLabel: "Productor 1" },
      { lote: loteNormal, groupKey: "id:1", groupLabel: "Productor 1" },
    ]);
    expect(grupos[0].nLotes).toBe(2);
    expect(grupos[0].nLotesPodridoDesconocido).toBe(1);
  });
});

describe("PCT_PODRIDO_NO_PESADO_DEFECTO", () => {
  it("es la asunción del dueño (jul 2026): 3%", () => {
    expect(PCT_PODRIDO_NO_PESADO_DEFECTO).toBe(0.03);
  });
});

describe("perdidaSimulada — composición ADITIVA (no multiplicativa) de los 3 componentes", () => {
  it("suma los 3 componentes sobre la entrada, sin componer probabilidades", () => {
    const total = perdidaSimulada({ pctPodridoReferencia: 0.02, pctMermaNatural: 0.01, pctPodridoNoPesado: 0.03 });
    expect(total).toBeCloseTo(0.06); // 0.02 + 0.01 + 0.03, NO 1-(0.98*0.99*0.97)
  });

  it("pctPodridoReferencia null se trata como 0 (componente sin dato, no se inventa)", () => {
    const total = perdidaSimulada({ pctPodridoReferencia: null, pctMermaNatural: 0.012, pctPodridoNoPesado: PCT_PODRIDO_NO_PESADO_DEFECTO });
    expect(total).toBeCloseTo(0.012 + 0.03);
  });

  it("con los 3 componentes a 0 el resultado es 0 (sin pérdida simulada)", () => {
    expect(perdidaSimulada({ pctPodridoReferencia: 0, pctMermaNatural: 0, pctPodridoNoPesado: 0 })).toBe(0);
  });

  it("consistente con el criterio real: alimentando forfaitProyectado da el mismo resultado que sumar las fracciones a mano", () => {
    const pct = perdidaSimulada({ pctPodridoReferencia: 0.04382, pctMermaNatural: 24 * 0.000553, pctPodridoNoPesado: 0.03 });
    // TASA_MERMA_NATURAL_DIA (0,0553%/día) × 24 días ≈ 1,327% — mismo cálculo que mermaNaturalEstimadaKg en mermaLote.ts.
    expect(pct).toBeCloseTo(0.04382 + 0.013272 + 0.03, 6);
    expect(forfaitProyectado(0.5, pct)).toBeCloseTo(0.5 / (1 - pct));
  });

  it("puede superar 1 si los componentes son grandes (sin clamp), igual que pctPerdidaTotal real; forfaitProyectado ya lo trata como null", () => {
    const pct = perdidaSimulada({ pctPodridoReferencia: 0.6, pctMermaNatural: 0.3, pctPodridoNoPesado: 0.2 });
    expect(pct).toBeCloseTo(1.1);
    expect(forfaitProyectado(0.5, pct)).toBeNull();
  });
});

describe("simulador — ida y vuelta (forfaitProyectado ∘ precioMaxCompra = identidad)", () => {
  it("para varios objetivos y pérdidas en [0,1): precioMaxCompra seguido de forfaitProyectado devuelve el objetivo original", () => {
    const casos: Array<{ objetivo: number; pctPerdida: number }> = [
      { objetivo: 0.5, pctPerdida: 0.1 },
      { objetivo: 1.2345, pctPerdida: 0.35 },
      { objetivo: 0.8, pctPerdida: 0 },
      { objetivo: 2, pctPerdida: 0.999 },
    ];
    for (const { objetivo, pctPerdida } of casos) {
      const precioMax = precioMaxCompra(objetivo, pctPerdida);
      const proyectado = forfaitProyectado(precioMax, pctPerdida);
      expect(proyectado).not.toBeNull();
      expect(proyectado!).toBeCloseTo(objetivo, 9);
    }
  });
});

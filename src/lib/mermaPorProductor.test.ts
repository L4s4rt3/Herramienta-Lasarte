import { describe, expect, it } from "vitest";
import {
  computeMermaLotes,
  type EntradaLoteInput,
  type LoteDiaKgInput,
  type ParteMermaInput,
} from "./mermaLote";
import {
  agregarMermaPorProductor,
  separarLotesPendientesComprobacionFisica,
  type ItemMermaAgrupable,
} from "./mermaPorProductor";
import type { LoteCiclo } from "./cicloVidaLote";

// Entrada mínima con solo lo necesario para el test dado (mismo helper que mermaLote.test.ts).
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

describe("agregarMermaPorProductor — ponderación", () => {
  it("pondera por kg de entrada (Σ merma / Σ entrada), NO la media simple de los % de cada lote", () => {
    // Ambos lotes deben quedar "procesado" (calibrador >= 97% de la entrada,
    // ver UMBRAL_PROCESADO en entradasBascula.ts) para que su merma cuente.
    const entradas = [
      entrada({ lote: "26050101", kg_entrada: 1000 }), // merma 20 -> 2% (calibrador 98%)
      entrada({ lote: "26050102", kg_entrada: 9000 }), // merma 90 -> 1% (calibrador 99%)
    ];
    const lotesDia: LoteDiaKgInput[] = [
      { lote_codigo: "26050101", kg_peso_total: 980, part_id: "p1" },
      { lote_codigo: "26050102", kg_peso_total: 8910, part_id: "p1" },
    ];
    const partes: ParteMermaInput[] = [{ part_id: "p1", kg_podrido_calibrador_auto: 0, kg_podrido_bolsa_basura: 0 }];
    const lotes = computeMermaLotes(entradas, lotesDia, [], partes);
    expect(lotes.every((l) => l.estado === "procesado")).toBe(true); // guard: confirma la premisa del test

    const items: ItemMermaAgrupable[] = lotes.map((l) => ({ lote: l, productorKey: "id:mismo-productor" }));
    const porProductor = agregarMermaPorProductor(items);

    const agregado = porProductor.get("id:mismo-productor")!;
    // Media simple de los dos % sería (2+1)/2 = 1.5%; la ponderada real es
    // (20+90)/(1000+9000) = 1.1%.
    expect(agregado.mermaMediaPonderadaPct).toBeCloseTo(1.1, 5);
    expect(agregado.kgEntradaProcesados).toBe(10000);
    expect(agregado.nProcesados).toBe(2);
  });

  it("separa dos productores distintos en agregados independientes", () => {
    const entradas = [
      entrada({ lote: "26050201", kg_entrada: 1000 }),
      entrada({ lote: "26050202", kg_entrada: 1000 }),
    ];
    const lotesDia: LoteDiaKgInput[] = [
      { lote_codigo: "26050201", kg_peso_total: 970, part_id: "p1" }, // merma 30 -> 3% (calibrador 97%)
      { lote_codigo: "26050202", kg_peso_total: 990, part_id: "p1" }, // merma 10 -> 1% (calibrador 99%)
    ];
    const partes: ParteMermaInput[] = [{ part_id: "p1", kg_podrido_calibrador_auto: 0, kg_podrido_bolsa_basura: 0 }];
    const lotes = computeMermaLotes(entradas, lotesDia, [], partes);

    const items: ItemMermaAgrupable[] = [
      { lote: lotes[0], productorKey: "id:a" },
      { lote: lotes[1], productorKey: "id:b" },
    ];
    const porProductor = agregarMermaPorProductor(items);

    expect(porProductor.get("id:a")!.mermaMediaPonderadaPct).toBeCloseTo(3, 5);
    expect(porProductor.get("id:b")!.mermaMediaPonderadaPct).toBeCloseTo(1, 5);
  });
});

describe("agregarMermaPorProductor — exclusión de cerrados sin registro", () => {
  it("un lote cerrado sin registro no diluye la media ni el kg de entrada del productor, y se cuenta aparte", () => {
    const entradas = [
      entrada({ lote: "26050301", kg_entrada: 1000 }), // procesado normal, merma 3% (calibrador 97%)
      entrada({
        lote: "26050302",
        kg_entrada: 5000, // cerrado sin registro: NO debe entrar en la media ni en kgEntradaProcesados
        cerrado_at: "2026-06-01T00:00:00Z",
        cierre_modo: "sin_registro",
      }),
    ];
    const lotesDia: LoteDiaKgInput[] = [
      { lote_codigo: "26050301", kg_peso_total: 970, part_id: "p1" },
    ];
    const partes: ParteMermaInput[] = [{ part_id: "p1", kg_podrido_calibrador_auto: 0, kg_podrido_bolsa_basura: 0 }];
    const lotes = computeMermaLotes(entradas, lotesDia, [], partes);

    const items: ItemMermaAgrupable[] = lotes.map((l) => ({ lote: l, productorKey: "id:mismo-productor" }));
    const agregado = agregarMermaPorProductor(items).get("id:mismo-productor")!;

    expect(agregado.nProcesados).toBe(1);
    expect(agregado.kgEntradaProcesados).toBe(1000);
    expect(agregado.mermaMediaPonderadaPct).toBeCloseTo(3, 5);
    expect(agregado.nLotesCerradosSinRegistro).toBe(1);
    expect(agregado.kgCerradosSinRegistro).toBe(5000);
  });
});

describe("agregarMermaPorProductor — sin datos", () => {
  it("un productorKey que no aparece en ningún item queda ausente del mapa (undefined, no un agregado a 0)", () => {
    const entradas = [entrada({ lote: "26050401", kg_entrada: 1000 })];
    const lotesDia: LoteDiaKgInput[] = [{ lote_codigo: "26050401", kg_peso_total: 950, part_id: "p1" }];
    const partes: ParteMermaInput[] = [{ part_id: "p1", kg_podrido_calibrador_auto: 0, kg_podrido_bolsa_basura: 0 }];
    const lotes = computeMermaLotes(entradas, lotesDia, [], partes);

    const items: ItemMermaAgrupable[] = lotes.map((l) => ({ lote: l, productorKey: "id:con-datos" }));
    const porProductor = agregarMermaPorProductor(items);

    expect(porProductor.has("id:con-datos")).toBe(true);
    expect(porProductor.get("id:sin-lotes-procesados")).toBeUndefined();
  });

  it("un productor cuyos lotes están todos pendientes/parciales tiene entrada en el mapa pero con % null (no calculable, no 0)", () => {
    const entradas = [entrada({ lote: "26050501", kg_entrada: 1000 })];
    // Solo 100 de 1000 kg pasaron por el calibrador: lote "pendiente", no "procesado".
    const lotesDia: LoteDiaKgInput[] = [{ lote_codigo: "26050501", kg_peso_total: 100, part_id: "p1" }];
    const partes: ParteMermaInput[] = [{ part_id: "p1", kg_podrido_calibrador_auto: 0, kg_podrido_bolsa_basura: 0 }];
    const lotes = computeMermaLotes(entradas, lotesDia, [], partes);
    expect(lotes[0].estado).not.toBe("procesado"); // guard: confirma la premisa del test

    const items: ItemMermaAgrupable[] = lotes.map((l) => ({ lote: l, productorKey: "id:solo-pendientes" }));
    const agregado = agregarMermaPorProductor(items).get("id:solo-pendientes")!;

    expect(agregado.nProcesados).toBe(0);
    expect(agregado.mermaMediaPonderadaPct).toBeNull();
  });

  it("items sin productorKey (lote sin productor atribuible) se descartan sin lanzar", () => {
    const entradas = [entrada({ lote: "26050601", kg_entrada: 1000 })];
    const lotesDia: LoteDiaKgInput[] = [{ lote_codigo: "26050601", kg_peso_total: 950, part_id: "p1" }];
    const partes: ParteMermaInput[] = [{ part_id: "p1", kg_podrido_calibrador_auto: 0, kg_podrido_bolsa_basura: 0 }];
    const lotes = computeMermaLotes(entradas, lotesDia, [], partes);

    const items: ItemMermaAgrupable[] = lotes.map((l) => ({ lote: l, productorKey: null }));
    const porProductor = agregarMermaPorProductor(items);

    expect(porProductor.size).toBe(0);
  });
});

// ─── separarLotesPendientesComprobacionFisica — corolario de la REGLA DE ────
// ORO (decisión del dueño 05-08-2026, FASE 3d): los lotes con la
// contradicción "pasada_vs_foto_stock" del motor nuevo (cicloVidaLote.ts)
// VIGENTE no pueden repartir su merma/€ por productor en silencio. Fixture:
// los 9 códigos REALES de la campaña 2026 con esa contradicción abierta (ver
// destinos_auditados.json / cicloVidaLote.golden.test.ts — "las 9
// CONTRADICCIÓN pasada↔foto de stock del banco quedan señaladas con el
// flag"), para que este test hable de los mismos lotes que el banco dorado.
const LOTES_CONTRADICCION_REALES = [
  "26042209", "26042313", "26042712", "26042810", "26042813",
  "26042914", "26051108", "26051109", "26052704",
];

/** LoteCiclo mínimo con la contradicción "pasada_vs_foto_stock" ya marcada — el resto de campos no le importa a `separarLotesPendientesComprobacionFisica` (solo lee `.contradicciones`), pero se rellenan con valores plausibles para que el objeto sea un LoteCiclo válido. */
function cicloConContradiccionPasadaVsFotoStock(lote: string, kgEntrada: number): LoteCiclo {
  return {
    lote,
    fechaEntrada: "2026-04-20",
    kgEntrada,
    esPrecalibrado: false,
    esCampoCit: false,
    estado: "parcial",
    kgPorClase: { nombrado: kgEntrada * 0.9, anotado: 0, medido: -(kgEntrada * 0.6), derivado: 0, sinRastro: kgEntrada * 0.7 },
    pctConEvidenciaDura: 0.9,
    destino: "A medias — cola pendiente",
    contradicciones: [{
      tipo: "pasada_vs_foto_stock",
      kgAjusteStock: -(kgEntrada * 0.6),
      detalle: "fixture de test: foto de stock contradice la pasada propia",
    }],
    diasEnCamara: 15,
  };
}

describe("separarLotesPendientesComprobacionFisica", () => {
  it("los 9 lotes reales con contradicción pasada↔foto de stock van a `pendientes`, nunca a `normales`", () => {
    const entradas = [
      ...LOTES_CONTRADICCION_REALES.map((lote) => entrada({ lote, kg_entrada: 5000 })),
      entrada({ lote: "26050701", kg_entrada: 1000 }), // lote limpio, sin contradicción
      entrada({ lote: "26050702", kg_entrada: 2000 }), // lote limpio, sin contradicción
    ];
    const lotes = computeMermaLotes(entradas, [], [], []);

    const cicloPorLote = new Map<string, LoteCiclo>(
      LOTES_CONTRADICCION_REALES.map((lote) => [lote, cicloConContradiccionPasadaVsFotoStock(lote, 5000)]),
    );

    const { normales, pendientes } = separarLotesPendientesComprobacionFisica(lotes, cicloPorLote);

    expect(pendientes.map((p) => p.lote).sort()).toEqual([...LOTES_CONTRADICCION_REALES].sort());
    expect(pendientes.every((p) => p.kgEntrada === 5000)).toBe(true);
    expect(normales.map((l) => l.lote).sort()).toEqual(["26050701", "26050702"]);
  });

  it("sin cicloPorLote (null o vacío) no excluye nada — no bloquea mientras el motor nuevo aún no ha cargado", () => {
    const entradas = [entrada({ lote: "26050801", kg_entrada: 1000 })];
    const lotes = computeMermaLotes(entradas, [], [], []);

    expect(separarLotesPendientesComprobacionFisica(lotes, null).normales).toHaveLength(1);
    expect(separarLotesPendientesComprobacionFisica(lotes, undefined).normales).toHaveLength(1);
    expect(separarLotesPendientesComprobacionFisica(lotes, new Map()).normales).toHaveLength(1);
    expect(separarLotesPendientesComprobacionFisica(lotes, new Map()).pendientes).toHaveLength(0);
  });

  it("un lote con OTRA contradicción (exceso_sin_dueno) no se excluye: solo pasada_vs_foto_stock lo hace", () => {
    const entradas = [entrada({ lote: "26050901", kg_entrada: 1000 })];
    const lotes = computeMermaLotes(entradas, [], [], []);
    const cicloPorLote = new Map<string, LoteCiclo>([
      ["26050901", {
        lote: "26050901",
        fechaEntrada: "2026-04-20",
        kgEntrada: 1000,
        esPrecalibrado: false,
        esCampoCit: false,
        estado: "sin_evidencia_suficiente",
        kgPorClase: { nombrado: 0, anotado: 0, medido: 0, derivado: 1000, sinRastro: 0 },
        pctConEvidenciaDura: 0,
        destino: "Sin evidencia suficiente (solo derrame — regla de oro)",
        contradicciones: [{ tipo: "exceso_sin_dueno", kgDerivado: 1000, detalle: "fixture" }],
        diasEnCamara: 10,
      }],
    ]);

    const { normales, pendientes } = separarLotesPendientesComprobacionFisica(lotes, cicloPorLote);
    expect(pendientes).toHaveLength(0);
    expect(normales).toHaveLength(1);
  });
});

describe("agregarMermaPorProductor — regresión: excluir contradicciones no cambia a los DEMÁS productores", () => {
  it("un productor sin ningún lote en contradicción da EXACTAMENTE el mismo agregado, con o sin la exclusión aplicada", () => {
    // Productor A: dos lotes limpios. Productor B: un lote limpio + uno de
    // los 9 códigos reales con contradicción abierta.
    const entradas = [
      entrada({ lote: "26051001", kg_entrada: 1000 }), // A
      entrada({ lote: "26051002", kg_entrada: 2000 }), // A
      entrada({ lote: "26051003", kg_entrada: 3000 }), // B, limpio
      entrada({ lote: "26042313", kg_entrada: 4000 }), // B, contradicción (código real)
    ];
    const lotesDia: LoteDiaKgInput[] = entradas.map((e) => ({ lote_codigo: e.lote, kg_peso_total: e.kg_entrada * 0.98, part_id: "p1" }));
    const partes: ParteMermaInput[] = [{ part_id: "p1", kg_podrido_calibrador_auto: 0, kg_podrido_bolsa_basura: 0 }];
    const lotes = computeMermaLotes(entradas, lotesDia, [], partes);

    const cicloPorLote = new Map<string, LoteCiclo>([
      ["26042313", cicloConContradiccionPasadaVsFotoStock("26042313", 4000)],
    ]);

    const productorPorLote = new Map<string, string>([
      ["26051001", "id:a"], ["26051002", "id:a"],
      ["26051003", "id:b"], ["26042313", "id:b"],
    ]);

    // "Antes" (sin la exclusión, comportamiento previo a esta tarea): todos los
    // lotes entran en el agregado por productor.
    const itemsAntes: ItemMermaAgrupable[] = lotes.map((l) => ({ lote: l, productorKey: productorPorLote.get(l.lote)! }));
    const agregadoAntes = agregarMermaPorProductor(itemsAntes);

    // "Después": se separan los pendientes ANTES de construir los items (mismo
    // orden que Productores.tsx/EconomicoCostes.tsx tras esta tarea).
    const { normales } = separarLotesPendientesComprobacionFisica(lotes, cicloPorLote);
    const itemsDespues: ItemMermaAgrupable[] = normales.map((l) => ({ lote: l, productorKey: productorPorLote.get(l.lote)! }));
    const agregadoDespues = agregarMermaPorProductor(itemsDespues);

    // Productor A (ningún lote en contradicción): IDÉNTICO antes y después.
    expect(agregadoDespues.get("id:a")).toEqual(agregadoAntes.get("id:a"));

    // Productor B (tiene el lote 26042313 en contradicción): SÍ cambia — pierde
    // exactamente los 4000 kg de ese lote de su denominador.
    expect(agregadoAntes.get("id:b")!.kgEntradaProcesados).toBe(7000); // 3000 + 4000
    expect(agregadoDespues.get("id:b")!.kgEntradaProcesados).toBe(3000); // solo el limpio
  });
});

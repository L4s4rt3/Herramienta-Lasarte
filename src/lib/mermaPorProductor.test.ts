import { describe, expect, it } from "vitest";
import {
  computeMermaLotes,
  type EntradaLoteInput,
  type LoteDiaKgInput,
  type ParteMermaInput,
} from "./mermaLote";
import { agregarMermaPorProductor, type ItemMermaAgrupable } from "./mermaPorProductor";

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

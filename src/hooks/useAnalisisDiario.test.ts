import { describe, expect, it } from "vitest";
import { buildProductoresResumen, type LoteResumen } from "./useAnalisisDiario";

function lote(over: Partial<LoteResumen> & { productor: string; kg_peso_total: number }): LoteResumen {
  return {
    fecha: "2026-07-20",
    lote_codigo: "26072001",
    producto: "NARANJA VALENCIA",
    toneladas_hora: null,
    duracion_min: null,
    peso_fruta_promedio_g: null,
    produccion_real_part: null,
    ...over,
  };
}

describe("buildProductoresResumen — resolución canónica opcional (unificación con /productores, 2026-07-28)", () => {
  it("sin resolver agrupa por texto crudo (comportamiento original)", () => {
    const res = buildProductoresResumen([
      lote({ productor: "INVERMARMELO", kg_peso_total: 100 }),
      lote({ productor: "Invermarmelo-FRUBEZAR", kg_peso_total: 200 }),
    ]);
    expect(res).toHaveLength(2);
  });

  it("con resolver, los alias del calibrador colapsan en UN productor con el nombre canónico y los kg sumados", () => {
    const res = buildProductoresResumen(
      [
        lote({ productor: "INVERMARMELO", kg_peso_total: 100, fecha: "2026-07-20" }),
        lote({ productor: "Invermarmelo-FRUBEZAR", kg_peso_total: 200, fecha: "2026-07-21" }),
        lote({ productor: "Camba", kg_peso_total: 50 }),
      ],
      (l) => l.productor.toLowerCase().includes("invermarmelo")
        ? { key: "id:inver", label: "Invermarmelo" }
        : { key: `nombre:${l.productor}`, label: l.productor },
    );
    expect(res).toHaveLength(2);
    const inver = res.find((p) => p.productor === "Invermarmelo")!;
    expect(inver.kg_total).toBe(300);
    expect(inver.n_lotes).toBe(2);
    expect(inver.ultimo_dia).toBe("2026-07-21");
  });

  it("resolver que devuelve null EXCLUYE el lote de la agregación (precalibrado no es un productor)", () => {
    const res = buildProductoresResumen(
      [
        lote({ productor: "PRECALIBRADO", kg_peso_total: 500 }),
        lote({ productor: "Camba", kg_peso_total: 50 }),
      ],
      (l) => (l.productor === "PRECALIBRADO" ? null : { key: l.productor, label: l.productor }),
    );
    expect(res).toHaveLength(1);
    expect(res[0].productor).toBe("Camba");
  });

  it("la T/h media sigue ponderada por duración también con resolver (mismo criterio que /productores)", () => {
    const res = buildProductoresResumen(
      [
        lote({ productor: "A", kg_peso_total: 100, toneladas_hora: 10, duracion_min: 60 }),
        lote({ productor: "A alias", kg_peso_total: 100, toneladas_hora: 20, duracion_min: 180 }),
      ],
      () => ({ key: "id:a", label: "A" }),
    );
    expect(res[0].tph_promedio).toBeCloseTo((10 * 60 + 20 * 180) / 240);
  });
});

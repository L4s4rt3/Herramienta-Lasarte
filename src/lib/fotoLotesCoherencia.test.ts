import { describe, expect, it } from "vitest";

import {
  parseVisionKg,
  revisarCoherenciaFoto,
  type ParLoteFoto,
} from "../../supabase/functions/_shared/fotoLotesCoherencia";

function par(
  id: string,
  lote: string,
  techo: number | null,
  item: Record<string, unknown>,
): ParLoteFoto {
  return { fila: { id, lote_codigo: lote, kg_peso_total: techo }, item };
}

describe("parseVisionKg", () => {
  it("trata el punto manuscrito como separador de miles", () => {
    expect(parseVisionKg("2.566 kg")).toBe(2566);
    expect(parseVisionKg("12.200")).toBe(12200);
    expect(parseVisionKg(2.566)).toBe(2566);
  });

  it("descarta lo que no es un kilo positivo", () => {
    expect(parseVisionKg(0)).toBe(0);
    expect(parseVisionKg(-40)).toBe(0);
    expect(parseVisionKg("")).toBe(0);
    expect(parseVisionKg("PREC")).toBe(0);
    expect(parseVisionKg(null)).toBe(0);
  });
});

describe("revisarCoherenciaFoto", () => {
  it("acepta los kilos que caben en el lote", () => {
    const revision = revisarCoherenciaFoto([
      par("l1", "26071601", 18500, { kg_industria: 2400, kg_prec1: 1200 }),
    ]);
    const lote = revision.porLote.get("l1")!;
    expect(lote.kg).toEqual({ kg_industria: 2400, kg_precalibrado_z1: 1200 });
    expect(lote.retenido).toBe(false);
    expect(lote.banderas).toEqual([]);
    expect(revision.banderas).toEqual([]);
  });

  it("retiene el dígito de más y sugiere la décima parte", () => {
    const revision = revisarCoherenciaFoto([
      par("l1", "26071601", 2800, { kg_industria: 24000, kg_prec1: 400 }),
    ]);
    const lote = revision.porLote.get("l1")!;
    // El valor imposible no se escribe; el que cabe, sí.
    expect(lote.kg).toEqual({ kg_precalibrado_z1: 400 });
    expect(lote.retenido).toBe(true);
    expect(lote.banderas[0]).toContain("supera los 2800 kg");
    expect(lote.banderas[0]).toContain("¿Serían 2400 kg?");
  });

  it("no sugiere corrección cuando la décima parte tampoco cabe", () => {
    const revision = revisarCoherenciaFoto([
      par("l1", "26071601", 500, { kg_industria: 90000 }),
    ]);
    const lote = revision.porLote.get("l1")!;
    expect(lote.kg).toEqual({});
    expect(lote.banderas[0]).not.toContain("¿Serían");
  });

  it("retiene los dos conceptos cuando su suma pasa del calibrador", () => {
    // Industria y precalibrado salen los dos de la pasada: si juntos superan el
    // peso del calibrador uno está mal leído, y no se sabe cuál.
    const revision = revisarCoherenciaFoto([
      par("l1", "26071601", 3000, { kg_industria: 2000, kg_prec1: 1500 }),
    ]);
    const lote = revision.porLote.get("l1")!;
    expect(lote.kg).toEqual({});
    expect(lote.retenido).toBe(true);
    expect(lote.banderas[0]).toContain("suman 3500 kg");
    expect(lote.banderas[0]).toContain("no se aplican");
  });

  it("tolera el redondeo del papel contra el informe del calibrador", () => {
    // 1% de margen: el techo viene de un informe y las cifras de un bolígrafo.
    const revision = revisarCoherenciaFoto([
      par("l1", "26071601", 3000, { kg_industria: 2000, kg_prec1: 1020 }),
    ]);
    const lote = revision.porLote.get("l1")!;
    expect(lote.kg).toEqual({ kg_industria: 2000, kg_precalibrado_z1: 1020 });
    expect(lote.banderas).toEqual([]);
  });

  it("no retiene un único valor que roza el techo por redondeo", () => {
    const revision = revisarCoherenciaFoto([
      par("l1", "26071601", 3000, { kg_industria: 3020 }),
    ]);
    expect(revision.porLote.get("l1")!.kg).toEqual({ kg_industria: 3020 });
  });

  it("no aplica kilos de un lote leído dos veces", () => {
    const revision = revisarCoherenciaFoto([
      par("l1", "26071601", 18500, { kg_industria: 2400 }),
      par("l1", "26071601", 18500, { kg_prec1: 900 }),
    ]);
    const lote = revision.porLote.get("l1")!;
    expect(lote.kg).toEqual({});
    expect(lote.retenido).toBe(true);
    expect(lote.banderas.some((b) => b.includes("más de una vez"))).toBe(true);
  });

  it("cuenta los lotes sin peso de calibrador como no verificables", () => {
    const revision = revisarCoherenciaFoto([
      par("l1", "26071601", null, { kg_industria: 2400 }),
      par("l2", "26071602", 0, { kg_prec1: 800 }),
      par("l3", "26071603", 9000, { kg_industria: 300 }),
    ]);
    expect(revision.sinReferencia).toBe(2);
    // Sin techo no hay con qué cruzar: se escriben, pero constan como tales.
    expect(revision.porLote.get("l1")!.kg).toEqual({ kg_industria: 2400 });
    expect(revision.porLote.get("l1")!.banderas).toEqual([]);
  });

  it("caza el movimiento de box cuyo total no cuadra", () => {
    const revision = revisarCoherenciaFoto([
      par("l1", "26071601", 18500, {
        movimientos_box: [
          { boxes: 43, peso_por_box_kg: 4, kg_total: 172 },
          { boxes: 43, peso_por_box_kg: 4, kg_total: 430 },
        ],
      }),
    ]);
    const lote = revision.porLote.get("l1")!;
    expect(lote.banderas).toHaveLength(1);
    expect(lote.banderas[0]).toContain("no los 430 kg anotados");
  });

  it("descarta el kg por box imposible cuando no viene el peso", () => {
    const revision = revisarCoherenciaFoto([
      par("l1", "26071601", 18500, {
        movimientos_box: [
          { boxes: 12, kg_total: 3780 },
          { boxes: 12, kg_total: 24000 },
        ],
      }),
    ]);
    const lote = revision.porLote.get("l1")!;
    // 3780/12 = 315 kg/box (box grande) pasa; 24000/12 = 2000 no.
    expect(lote.banderas).toHaveLength(1);
    expect(lote.banderas[0]).toContain("2000 kg por box");
  });

  it("avisa cuando la foto suma más que la producción del parte", () => {
    const revision = revisarCoherenciaFoto(
      [
        par("l1", "26071601", 40000, { kg_industria: 12000 }),
        par("l2", "26071602", 40000, { kg_industria: 15000 }),
      ],
      { kgProduccionParte: 20000 },
    );
    expect(revision.banderas).toHaveLength(1);
    expect(revision.banderas[0]).toContain("más que los 20000 kg de producción");
  });

  it("no avisa cuando la producción del parte da de sobra", () => {
    const revision = revisarCoherenciaFoto(
      [par("l1", "26071601", 40000, { kg_industria: 12000 })],
      { kgProduccionParte: 90000 },
    );
    expect(revision.banderas).toEqual([]);
  });
});

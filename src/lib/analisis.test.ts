import { describe, expect, it } from "vitest";
import { computeAnalisis } from "./analisis";
import type { LoteProduccion, ParsedProduccion } from "./parsers";

function lote(overrides: Partial<LoteProduccion>): LoteProduccion {
  return {
    id_lote: null,
    nombre_lote: null,
    codigo_productor: null,
    nombre_productor: null,
    variedad: null,
    tiempo_inicio: null,
    hora_maquina: null,
    kg_peso_total: 0,
    toneladas_hora: null,
    peso_fruta_promedio_g: null,
    lote_codigo: null,
    productor: null,
    producto: null,
    hora_inicio: null,
    duracion_min: null,
    ...overrides,
  };
}

describe("computeAnalisis", () => {
  it("calculates the general day T/h using exactly 8 hours per day", () => {
    const produccion: ParsedProduccion = {
      tipo: "produccion",
      kg_total: 80000,
      tph_promedio: 20,
      lotes: [
        lote({ productor: "Productor A", kg_peso_total: 40000, toneladas_hora: 20, duracion_min: 30, fecha: "2024-01-01" }),
        lote({ productor: "Productor B", kg_peso_total: 40000, toneladas_hora: 5, duracion_min: 30, fecha: "2024-01-01" }),
      ],
    };

    const result = computeAnalisis(produccion, null, null, null);

    // 80 toneladas / (1 día × 8h) = 10 T/h
    expect(result.kpis.tph_promedio).toBe(10);
    expect(result.productores.find((p) => p.productor === "Productor A")?.tph_avg).toBe(20);
    expect(result.productores.find((p) => p.productor === "Productor B")?.tph_avg).toBe(5);
  });
});

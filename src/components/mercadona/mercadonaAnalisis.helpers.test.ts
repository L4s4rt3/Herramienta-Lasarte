import { describe, expect, it } from "vitest";
import {
  buildCumplimientoSerie,
  buildComparativaSemanas,
  buildMixSerie,
  metodoLabel,
  resumenCumplimiento,
  tendenciasMetodos,
} from "./mercadonaAnalisis.helpers";
import type { MercadonaMetodoRow, MercadonaSemanaConMetodos } from "@/hooks/useMercadonaVentas";

function metodo(overrides: Partial<MercadonaMetodoRow> & { metodo: string }): MercadonaMetodoRow {
  return {
    id: `${overrides.metodo}-${Math.random()}`,
    semana_id: "semana-x",
    descripcion: null,
    pct: null,
    kilos: 0,
    palets: 0,
    cajas: 0,
    comparativa_anterior_pct: null,
    ...overrides,
  };
}

function semana(overrides: Partial<MercadonaSemanaConMetodos> & { id: string; anio: number; semana: number }): MercadonaSemanaConMetodos {
  return {
    user_id: "user-x",
    rango_planificacion: null,
    planificado_quincena_kg: null,
    planificado_semana_kg: null,
    vendido_kg: null,
    diferencia_pct: null,
    notas: [],
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    metodos: [],
    ...overrides,
  };
}

describe("buildCumplimientoSerie", () => {
  it("excluye semanas con planificado 0 o nulo (evita division por cero)", () => {
    const semanas = [
      semana({ id: "1", anio: 2026, semana: 1, planificado_semana_kg: 0, vendido_kg: 100 }),
      semana({ id: "2", anio: 2026, semana: 2, planificado_semana_kg: null, vendido_kg: 100 }),
      semana({ id: "3", anio: 2026, semana: 3, planificado_semana_kg: 200, vendido_kg: 190 }),
    ];
    const serie = buildCumplimientoSerie(semanas);
    expect(serie).toHaveLength(1);
    expect(serie[0].id).toBe("3");
    expect(serie[0].pct).toBeCloseTo(95, 6);
  });

  it("devuelve array vacio si no hay semanas con planificado > 0", () => {
    const semanas = [semana({ id: "1", anio: 2026, semana: 1, planificado_semana_kg: 0 })];
    expect(buildCumplimientoSerie(semanas)).toEqual([]);
  });
});

describe("resumenCumplimiento", () => {
  it("calcula media, mejor y peor semana", () => {
    const serie = [
      { id: "1", anio: 2026, semana: 1, label: "S1", pct: 90 },
      { id: "2", anio: 2026, semana: 2, label: "S2", pct: 110 },
      { id: "3", anio: 2026, semana: 3, label: "S3", pct: 70 },
    ];
    const resumen = resumenCumplimiento(serie);
    expect(resumen.media).toBeCloseTo(90, 6);
    expect(resumen.mejor?.id).toBe("2");
    expect(resumen.peor?.id).toBe("3");
  });

  it("caso <2 semanas: array vacio devuelve media 0 y mejor/peor null", () => {
    expect(resumenCumplimiento([])).toEqual({ media: 0, mejor: null, peor: null });
  });

  it("caso de una sola semana: mejor y peor son la misma", () => {
    const serie = [{ id: "1", anio: 2026, semana: 1, label: "S1", pct: 85 }];
    const resumen = resumenCumplimiento(serie);
    expect(resumen.media).toBe(85);
    expect(resumen.mejor?.id).toBe("1");
    expect(resumen.peor?.id).toBe("1");
  });
});

describe("metodoLabel", () => {
  it("mapea metodos conocidos a nombres cortos", () => {
    expect(metodoLabel("MA12KGC")).toBe("Granel 12 kg");
    expect(metodoLabel("ma3kgc")).toBe("Pack 3 kg");
  });

  it("devuelve el propio metodo si no esta mapeado", () => {
    expect(metodoLabel("OTRO")).toBe("OTRO");
  });
});

describe("buildMixSerie", () => {
  it("construye un punto por semana con kg por metodo conocido", () => {
    const semanas = [
      semana({
        id: "1", anio: 2026, semana: 1,
        metodos: [metodo({ metodo: "MA12KGC", kilos: 1000 }), metodo({ metodo: "MA3KGC", kilos: 500 })],
      }),
    ];
    const serie = buildMixSerie(semanas);
    expect(serie).toHaveLength(1);
    expect(serie[0].label).toBe("S1");
    expect(serie[0].MA12KGC).toBe(1000);
    expect(serie[0].MA3KGC).toBe(500);
    expect(serie[0].MA4KGC).toBe(0);
    expect(serie[0].MA5KGC).toBe(0);
  });
});

describe("tendenciasMetodos", () => {
  it("devuelve null si hay menos de 4 semanas", () => {
    const semanas = [
      semana({ id: "1", anio: 2026, semana: 1 }),
      semana({ id: "2", anio: 2026, semana: 2 }),
      semana({ id: "3", anio: 2026, semana: 3 }),
    ];
    expect(tendenciasMetodos(semanas)).toBeNull();
  });

  it("compara media de las ultimas 2 semanas vs las 2 anteriores", () => {
    const semanas = [
      semana({ id: "1", anio: 2026, semana: 1, metodos: [metodo({ metodo: "MA12KGC", kilos: 100 })] }),
      semana({ id: "2", anio: 2026, semana: 2, metodos: [metodo({ metodo: "MA12KGC", kilos: 100 })] }),
      semana({ id: "3", anio: 2026, semana: 3, metodos: [metodo({ metodo: "MA12KGC", kilos: 200 })] }),
      semana({ id: "4", anio: 2026, semana: 4, metodos: [metodo({ metodo: "MA12KGC", kilos: 200 })] }),
    ];
    const tendencias = tendenciasMetodos(semanas);
    expect(tendencias).not.toBeNull();
    const ma12 = tendencias!.find((t) => t.metodo === "MA12KGC")!;
    expect(ma12.mediaPrevia).toBeCloseTo(100, 6);
    expect(ma12.mediaReciente).toBeCloseTo(200, 6);
    expect(ma12.variacionPct).toBeCloseTo(100, 6);
    expect(ma12.direccion).toBe("up");
  });

  it("division por cero: mediaPrevia 0 da variacionPct null y direccion flat", () => {
    const semanas = [
      semana({ id: "1", anio: 2026, semana: 1, metodos: [] }),
      semana({ id: "2", anio: 2026, semana: 2, metodos: [] }),
      semana({ id: "3", anio: 2026, semana: 3, metodos: [metodo({ metodo: "MA12KGC", kilos: 200 })] }),
      semana({ id: "4", anio: 2026, semana: 4, metodos: [metodo({ metodo: "MA12KGC", kilos: 200 })] }),
    ];
    const tendencias = tendenciasMetodos(semanas);
    const ma12 = tendencias!.find((t) => t.metodo === "MA12KGC")!;
    expect(ma12.mediaPrevia).toBe(0);
    expect(ma12.variacionPct).toBeNull();
    expect(ma12.direccion).toBe("flat");
  });
});

describe("buildComparativaSemanas", () => {
  it("calcula deltas metodo a metodo y fila total", () => {
    const actual = semana({
      id: "2", anio: 2026, semana: 2,
      metodos: [
        metodo({ metodo: "MA12KGC", kilos: 150, palets: 10, cajas: 100 }),
        metodo({ metodo: "MA3KGC", kilos: 50, palets: 5, cajas: 50 }),
      ],
    });
    const anterior = semana({
      id: "1", anio: 2026, semana: 1,
      metodos: [metodo({ metodo: "MA12KGC", kilos: 100, palets: 8, cajas: 80 })],
    });
    const { filas, total } = buildComparativaSemanas(actual, anterior);

    const ma12 = filas.find((f) => f.metodo === "MA12KGC")!;
    expect(ma12.kgActual).toBe(150);
    expect(ma12.kgAnterior).toBe(100);
    expect(ma12.deltaKg).toBe(50);
    expect(ma12.deltaPct).toBeCloseTo(50, 6);
    expect(ma12.palets).toBe(10);
    expect(ma12.cajas).toBe(100);

    const ma3 = filas.find((f) => f.metodo === "MA3KGC")!;
    expect(ma3.kgAnterior).toBe(0);
    expect(ma3.deltaPct).toBeNull(); // division por cero -> null, no Infinity

    expect(total.kgActual).toBe(200);
    expect(total.kgAnterior).toBe(100);
    expect(total.deltaKg).toBe(100);
    expect(total.deltaPct).toBeCloseTo(100, 6);
  });

  it("sin semana anterior (primera semana importada): todo kgAnterior 0 y deltaPct null", () => {
    const actual = semana({
      id: "1", anio: 2026, semana: 1,
      metodos: [metodo({ metodo: "MA12KGC", kilos: 100 })],
    });
    const { filas, total } = buildComparativaSemanas(actual, null);
    expect(filas.every((f) => f.kgAnterior === 0)).toBe(true);
    expect(filas.find((f) => f.metodo === "MA12KGC")!.deltaPct).toBeNull();
    expect(total.deltaPct).toBeNull();
  });
});

import { describe, it, expect } from "vitest";
import {
  groupLotesByDay,
  calcularSubtotalesDia,
  detectarLotesLentos,
  calcularTphPonderado,
  buildWeekRange,
} from "./analisisDiarioView";
import type { LoteResumen } from "@/hooks/useAnalisisDiario";

const mockLotes: LoteResumen[] = [
  { fecha: "2026-06-16", lote_codigo: "A-01", productor: "Finca Los Olivos", producto: "Navelina", kg_peso_total: 1600, toneladas_hora: 16.0, duracion_min: 60, peso_fruta_promedio_g: 180 },
  { fecha: "2026-06-16", lote_codigo: "A-02", productor: "Finca Los Olivos", producto: "Navelina", kg_peso_total: 1500, toneladas_hora: 15.0, duracion_min: 58, peso_fruta_promedio_g: 175 },
  { fecha: "2026-06-17", lote_codigo: "B-01", productor: "Huerto El Valle", producto: "Lane Late", kg_peso_total: 2100, toneladas_hora: 12.5, duracion_min: 72, peso_fruta_promedio_g: 190 },
];

describe("groupLotesByDay", () => {
  it("agrupa lotes por fecha", () => {
    const result = groupLotesByDay(mockLotes);
    expect(result.size).toBe(2);
    expect(result.get("2026-06-16")).toHaveLength(2);
    expect(result.get("2026-06-17")).toHaveLength(1);
  });

  it("devuelve mapa vacio si no hay lotes", () => {
    const result = groupLotesByDay([]);
    expect(result.size).toBe(0);
  });
});

describe("calcularSubtotalesDia", () => {
  it("calcula kg total, avg tph ponderado y conteo lotes", () => {
    const lotes = mockLotes.filter((l) => l.fecha === "2026-06-16");
    const sub = calcularSubtotalesDia(lotes);
    expect(sub.kg).toBe(3100);
    expect(sub.nLotes).toBe(2);
    expect(sub.nLentes).toBe(0);
    expect(sub.avgTph).toBeGreaterThan(0);
  });

  it("cuenta lotes lentos (tph < 12)", () => {
    const lotesLentos: LoteResumen[] = [
      { fecha: "2026-06-17", lote_codigo: "C-01", productor: "A", producto: "B", kg_peso_total: 1000, toneladas_hora: 10, duracion_min: 60, peso_fruta_promedio_g: 150 },
      { fecha: "2026-06-17", lote_codigo: "C-02", productor: "A", producto: "B", kg_peso_total: 1000, toneladas_hora: 11, duracion_min: 55, peso_fruta_promedio_g: 155 },
    ];
    const sub = calcularSubtotalesDia(lotesLentos);
    expect(sub.nLentes).toBe(2);
  });
});

describe("detectarLotesLentos", () => {
  it("devuelve true si hay lotes con tph < 12", () => {
    expect(detectarLotesLentos(mockLotes)).toBe(false);
    expect(detectarLotesLentos([{ ...mockLotes[0], toneladas_hora: 10 }])).toBe(true);
  });
});

describe("calcularTphPonderado", () => {
  it("calcula promedio ponderado por kg", () => {
    const result = calcularTphPonderado(mockLotes);
    expect(result).toBeGreaterThan(0);
  });

  it("devuelve null si no hay datos", () => {
    expect(calcularTphPonderado([])).toBeNull();
  });
});

describe("buildWeekRange", () => {
  it("devuelve lunes a domingo para la semana actual", () => {
    const { start, end } = buildWeekRange("esta_semana");
    const startDay = new Date(start).getDay();
    const endDay = new Date(end).getDay();
    expect(startDay).toBe(1); // lunes
    expect(endDay).toBe(0); // domingo
  });
});
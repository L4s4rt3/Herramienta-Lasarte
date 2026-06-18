import { describe, it, expect } from "vitest";
import {
  groupLotesByDay,
  calcularSubtotalesDia,
  detectarLotesLentos,
  calcularTphPonderado,
  buildWeekRange,
  getDiaSemana,
  formatFechaCorta,
  getIntensityColor,
  getTphBadge,
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

  it("devuelve la semana anterior", () => {
    const actual = buildWeekRange("esta_semana");
    const anterior = buildWeekRange("anterior");
    const diffMs = new Date(actual.start).getTime() - new Date(anterior.end).getTime();
    expect(diffMs).toBe(86400000); // 1 day gap between sunday and next monday
    expect(anterior.label).toBe("Semana anterior");
  });

  it("devuelve rango de 4 semanas", () => {
    const result = buildWeekRange("ultimas_4");
    const start = new Date(result.start);
    const end = new Date(result.end);
    const diffDays = (end.getTime() - start.getTime()) / 86400000;
    expect(diffDays).toBe(27); // 4 weeks - 1
    expect(result.label).toBe("Ultimas 4 semanas");
  });
});

describe("getDiaSemana", () => {
  it("devuelve nombre corto del dia", () => {
    expect(getDiaSemana("2026-06-15")).toBe("Lun"); // monday
    expect(getDiaSemana("2026-06-16")).toBe("Mar");
    expect(getDiaSemana("2026-06-17")).toBe("Mie");
    expect(getDiaSemana("2026-06-18")).toBe("Jue");
    expect(getDiaSemana("2026-06-19")).toBe("Vie");
    expect(getDiaSemana("2026-06-20")).toBe("Sab");
    expect(getDiaSemana("2026-06-21")).toBe("Dom");
  });
});

describe("formatFechaCorta", () => {
  it("devuelve formato dd/mm", () => {
    expect(formatFechaCorta("2026-06-15")).toBe("15/06");
    expect(formatFechaCorta("2026-01-05")).toBe("05/01");
  });
});

describe("getIntensityColor", () => {
  it("devuelve color segun ratio", () => {
    expect(getIntensityColor(100, 0)).toBe("bg-transparent");
    expect(getIntensityColor(100, 100)).toBe("bg-primary/20");  // ratio 1.0
    expect(getIntensityColor(80, 100)).toBe("bg-primary/20");   // ratio 0.8
    expect(getIntensityColor(60, 100)).toBe("bg-primary/12");   // ratio 0.6
    expect(getIntensityColor(30, 100)).toBe("bg-primary/6");    // ratio 0.3
    expect(getIntensityColor(10, 100)).toBe("bg-transparent");  // ratio 0.1
  });
});

describe("getTphBadge", () => {
  it("devuelve null si tph es null", () => {
    expect(getTphBadge(null)).toBeNull();
  });

  it("devuelve success si tph >= 16", () => {
    expect(getTphBadge(16)).toBe("success");
    expect(getTphBadge(20)).toBe("success");
  });

  it("devuelve warning si 12 <= tph < 16", () => {
    expect(getTphBadge(12)).toBe("warning");
    expect(getTphBadge(15)).toBe("warning");
  });

  it("devuelve destructive si tph < 12", () => {
    expect(getTphBadge(10)).toBe("destructive");
    expect(getTphBadge(0)).toBe("destructive");
  });
});
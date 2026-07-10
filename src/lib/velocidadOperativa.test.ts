import { describe, expect, it } from "vitest";
import { calcularTphOperativa, horasOperativasDia } from "./velocidadOperativa";

describe("horasOperativasDia", () => {
  it("8 h hasta el 1 de julio de 2026, 7 h desde el 2 de julio", () => {
    expect(horasOperativasDia("2026-06-30")).toBe(8);
    expect(horasOperativasDia("2026-07-01")).toBe(8);
    expect(horasOperativasDia("2026-07-02")).toBe(7);
    expect(horasOperativasDia("2026-08-15")).toBe(7);
  });

  it("sin fecha usa las 8 h legacy", () => {
    expect(horasOperativasDia(null)).toBe(8);
    expect(horasOperativasDia(undefined)).toBe(8);
  });
});

describe("calcularTphOperativa", () => {
  it("con fechas anteriores al cambio usa 8 h/día", () => {
    // 80 toneladas / (1 día × 8h) = 10 T/h
    expect(calcularTphOperativa(80000, "2026-06-15")).toBe(10);
    // 160 toneladas / (2 días × 8h) = 10 T/h
    expect(calcularTphOperativa(160000, ["2026-06-15", "2026-06-16"])).toBe(10);
  });

  it("con fechas desde el 2 de julio de 2026 usa 7 h/día", () => {
    // 70 toneladas / (1 día × 7h) = 10 T/h
    expect(calcularTphOperativa(70000, "2026-07-02")).toBe(10);
    // 140 toneladas / (2 días × 7h) = 10 T/h
    expect(calcularTphOperativa(140000, ["2026-07-06", "2026-07-07"])).toBe(10);
  });

  it("una semana que cruza el 2 de julio mezcla 8 h y 7 h", () => {
    // 29 jun (8h) + 1 jul (8h) + 2 jul (7h) + 3 jul (7h) = 30 horas
    expect(calcularTphOperativa(300000, ["2026-06-29", "2026-07-01", "2026-07-02", "2026-07-03"])).toBe(10);
  });

  it("modo legacy numérico: días × 8 h fijas (rutas sin fecha)", () => {
    expect(calcularTphOperativa(80000, 1)).toBe(10);
    expect(calcularTphOperativa(160000, 2)).toBe(10);
    expect(calcularTphOperativa(80000)).toBe(10);
    expect(calcularTphOperativa(4000, 0.5)).toBe(1);
  });

  it("returns null when there is no production or no days", () => {
    expect(calcularTphOperativa(0, "2026-07-02")).toBeNull();
    expect(calcularTphOperativa(80000, [])).toBeNull();
    expect(calcularTphOperativa(80000, 0)).toBeNull();
  });
});

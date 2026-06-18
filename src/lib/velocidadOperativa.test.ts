import { describe, expect, it } from "vitest";
import { calcularTphOperativa } from "./velocidadOperativa";

describe("calcularTphOperativa", () => {
  it("calculates T/h using real hours (toneladas / horas)", () => {
    // 80 toneladas / 8 horas = 10 T/h
    expect(calcularTphOperativa(80000, 8)).toBe(10);
    // 160 toneladas / 16 horas = 10 T/h
    expect(calcularTphOperativa(160000, 16)).toBe(10);
    // Default parameter (8 horas)
    expect(calcularTphOperativa(80000)).toBe(10);
  });

  it("returns null when there is no production or no hours", () => {
    expect(calcularTphOperativa(0, 8)).toBeNull();
    expect(calcularTphOperativa(80000, 0)).toBeNull();
  });

  it("handles edge cases", () => {
    // Default parameter (1 hour)
    expect(calcularTphOperativa(5000, 1)).toBe(5);
    // Fractional hours
    expect(calcularTphOperativa(4000, 0.5)).toBe(8);
  });
});

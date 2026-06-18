import { describe, expect, it } from "vitest";
import { calcularTphOperativa } from "./velocidadOperativa";

describe("calcularTphOperativa", () => {
  it("calculates T/h using 8 operational hours per day", () => {
    // 80 toneladas / (1 día × 8h) = 10 T/h
    expect(calcularTphOperativa(80000, 1)).toBe(10);
    // 160 toneladas / (2 días × 8h) = 10 T/h
    expect(calcularTphOperativa(160000, 2)).toBe(10);
    // Default parameter (1 día)
    expect(calcularTphOperativa(80000)).toBe(10);
  });

  it("returns null when there is no production or no days", () => {
    expect(calcularTphOperativa(0, 1)).toBeNull();
    expect(calcularTphOperativa(80000, 0)).toBeNull();
  });

  it("handles edge cases", () => {
    // 5 toneladas / (1 día × 8h) = 0.625 T/h
    expect(calcularTphOperativa(5000, 1)).toBe(0.625);
    // 4 toneladas / (0.5 días × 8h) = 1 T/h
    expect(calcularTphOperativa(4000, 0.5)).toBe(1);
  });
});

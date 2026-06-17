import { describe, expect, it } from "vitest";
import { calcularTphOperativa } from "./velocidadOperativa";

describe("calcularTphOperativa", () => {
  it("uses 8 operational hours per day for the general daily speed", () => {
    expect(calcularTphOperativa(80000)).toBe(10);
    expect(calcularTphOperativa(160000, 2)).toBe(10);
  });

  it("returns null when there is no production or no operational day", () => {
    expect(calcularTphOperativa(0)).toBeNull();
    expect(calcularTphOperativa(80000, 0)).toBeNull();
  });
});

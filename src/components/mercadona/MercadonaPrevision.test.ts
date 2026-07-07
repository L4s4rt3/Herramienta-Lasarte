import { describe, expect, it } from "vitest";
import { deltaPrevistoReal, siguienteSemanaMercadona, superaCapacidad } from "./MercadonaPrevision";

describe("siguienteSemanaMercadona", () => {
  it("sugiere semana 1 del año en curso si no hay semanas importadas", () => {
    const hoy = new Date(2026, 6, 6, 12, 0, 0);
    expect(siguienteSemanaMercadona([], hoy)).toEqual({ anio: 2026, semana: 1 });
  });

  it("suma 1 a la última semana importada dentro del mismo año", () => {
    const semanas = [{ anio: 2026, semana: 20 }, { anio: 2026, semana: 21 }];
    expect(siguienteSemanaMercadona(semanas)).toEqual({ anio: 2026, semana: 22 });
  });

  it("no depende del orden de entrada: usa la última por (anio, semana)", () => {
    const semanas = [{ anio: 2026, semana: 21 }, { anio: 2025, semana: 52 }, { anio: 2026, semana: 20 }];
    expect(siguienteSemanaMercadona(semanas)).toEqual({ anio: 2026, semana: 22 });
  });

  it("salta al año siguiente (semana 1) al llegar a la última semana ISO del año", () => {
    // 2026 tiene 53 semanas ISO.
    const semanas = [{ anio: 2026, semana: 53 }];
    expect(siguienteSemanaMercadona(semanas)).toEqual({ anio: 2027, semana: 1 });
  });

  it("salta al año siguiente en un año de 52 semanas ISO", () => {
    // 2025 tiene 52 semanas ISO.
    const semanas = [{ anio: 2025, semana: 52 }];
    expect(siguienteSemanaMercadona(semanas)).toEqual({ anio: 2026, semana: 1 });
  });
});

describe("superaCapacidad", () => {
  it("es falso si la capacidad de referencia es 0 o negativa (sin datos)", () => {
    expect(superaCapacidad(50000, 0)).toBe(false);
    expect(superaCapacidad(50000, -10)).toBe(false);
  });

  it("es falso si el previsto está dentro del margen del 10%", () => {
    expect(superaCapacidad(10000, 10000)).toBe(false);
    expect(superaCapacidad(11000, 10000)).toBe(false);
  });

  it("es verdadero si el previsto supera la capacidad en más del 10%", () => {
    expect(superaCapacidad(11001, 10000)).toBe(true);
    expect(superaCapacidad(15000, 10000)).toBe(true);
  });
});

describe("deltaPrevistoReal", () => {
  it("calcula delta positivo cuando se vendió más de lo previsto", () => {
    const { deltaKg, deltaPct } = deltaPrevistoReal(10000, 11000);
    expect(deltaKg).toBe(1000);
    expect(deltaPct).toBeCloseTo(10, 5);
  });

  it("calcula delta negativo cuando se vendió menos de lo previsto", () => {
    const { deltaKg, deltaPct } = deltaPrevistoReal(10000, 9000);
    expect(deltaKg).toBe(-1000);
    expect(deltaPct).toBeCloseTo(-10, 5);
  });

  it("deltaPct es 0 si kgPrevistos es 0 (evita división por cero)", () => {
    const { deltaKg, deltaPct } = deltaPrevistoReal(0, 5000);
    expect(deltaKg).toBe(5000);
    expect(deltaPct).toBe(0);
  });
});

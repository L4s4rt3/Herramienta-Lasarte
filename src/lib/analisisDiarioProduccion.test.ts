import { describe, expect, it } from "vitest";
import {
  calcularProduccionRealParteAnalisis,
  calcularProduccionRealPartesAnalisis,
} from "./analisisDiarioProduccion";

describe("analisisDiarioProduccion", () => {
  it("uses stored cascade production when available", () => {
    expect(calcularProduccionRealParteAnalisis({
      resumen_ia: { cascada: { produccion_real: 86750 } },
      kg_produccion_calibrador: 100000,
      kg_mujeres_calibrador: 5000,
      kg_reciclado_malla_z1: 3000,
      kg_reciclado_malla_z2: 2000,
    })).toBe(86750);
  });

  it("falls back to real part fields when there is no stored cascade", () => {
    expect(calcularProduccionRealParteAnalisis({
      kg_produccion_calibrador: 100000,
      kg_mujeres_calibrador: 5000,
      kg_reciclado_malla_z1: 3000,
      kg_reciclado_malla_z2: 2000,
    })).toBe(90000);
  });

  it("sums real production across parts", () => {
    expect(calcularProduccionRealPartesAnalisis([
      {
        kg_produccion_calibrador: 100000,
        kg_mujeres_calibrador: 5000,
        kg_reciclado_malla_z1: 3000,
        kg_reciclado_malla_z2: 2000,
      },
      {
        resumen_ia: { cascada: { produccion_real: 50000 } },
      },
    ])).toBe(140000);
  });
});

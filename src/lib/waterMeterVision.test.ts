import { describe, expect, it } from "vitest";
import { normalizeWaterMeterVisionResult } from "./waterMeterVision";

describe("normalizeWaterMeterVisionResult", () => {
  it("normaliza una lectura válida del contador general", () => {
    expect(normalizeWaterMeterVisionResult({
      lectura_m3: 39079.26,
      lectura_texto: "39079.26",
      confianza: 0.97,
      dudas: [],
      modelo: "vision-free",
    })).toEqual({
      lectura_m3: 39079.26,
      lectura_texto: "39079.26",
      confianza: 0.97,
      dudas: [],
      modelo: "vision-free",
    });
  });

  it("limita la confianza al intervalo válido", () => {
    expect(normalizeWaterMeterVisionResult({
      lectura_m3: 39160,
      confianza: 2,
      dudas: ["rodillo en transición"],
    }).confianza).toBe(1);
  });

  it.each([null, {}, { lectura_m3: 39.079 }, { lectura_m3: 999 }])(
    "rechaza una lectura fuera de rango: %o",
    (value) => {
      expect(() => normalizeWaterMeterVisionResult(value)).toThrow();
    },
  );
});

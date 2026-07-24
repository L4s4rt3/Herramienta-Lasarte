import { describe, expect, it } from "vitest";
import {
  derivePartManualFields,
  normalizePartManualVisionResult,
  type PartManualVisionRaw,
} from "./partManualVision";

function raw(overrides: Partial<PartManualVisionRaw> = {}): PartManualVisionRaw {
  return {
    fecha: "2026-07-21",
    citrica_kg_brutos: null,
    citrica_box: null,
    citrica_podrido_kg_brutos: null,
    citrica_podrido_box: null,
    podrido_kg_brutos: null,
    podrido_box: null,
    malla_z1_kg_brutos: null,
    malla_z1_box: null,
    malla_z2_kg_brutos: null,
    malla_z2_box: null,
    palets_punta_kg: null,
    ...overrides,
  };
}

describe("derivePartManualFields", () => {
  it("aplica las reglas confirmadas del papel del 21 de julio", () => {
    expect(derivePartManualFields(raw({
      citrica_podrido_kg_brutos: 299,
      podrido_kg_brutos: 387,
      malla_z1_kg_brutos: 354,
      malla_z1_box: 1.5,
      malla_z2_kg_brutos: 354,
      malla_z2_box: 1.5,
      palets_punta_kg: 3748,
    }))).toEqual({
      kg_industria_manual: null,
      kg_reciclado_malla_z1: 294,
      kg_reciclado_malla_z2: 294,
      kg_inventario_sin_alta: 3748,
      kg_podrido_bolsa_basura: 626,
      box_reciclaje: 4,
    });
  });

  it("asume un box por cada línea de podrido cuando no aparece cantidad", () => {
    expect(derivePartManualFields(raw({
      citrica_podrido_kg_brutos: 311,
    })).kg_podrido_bolsa_basura).toBe(281);
    expect(derivePartManualFields(raw({
      citrica_podrido_kg_brutos: 253,
      podrido_kg_brutos: 203,
    })).kg_podrido_bolsa_basura).toBe(396);
  });

  it("guarda Cítrica como industria bruta y conserva nulos no detectados", () => {
    expect(derivePartManualFields(raw({
      citrica_kg_brutos: 734,
      citrica_box: 2,
    }))).toEqual({
      kg_industria_manual: 734,
      kg_reciclado_malla_z1: null,
      kg_reciclado_malla_z2: null,
      kg_inventario_sin_alta: null,
      kg_podrido_bolsa_basura: null,
      box_reciclaje: null,
    });
  });
});

describe("normalizePartManualVisionResult", () => {
  it("normaliza fecha española, decimales y confianza", () => {
    const result = normalizePartManualVisionResult({
      raw: {
        fecha: "21/07/26",
        malla_z1_kg_brutos: "354",
        malla_z1_box: "1,5",
        malla_z2_kg_brutos: "354",
        malla_z2_box: "1,5",
      },
      confianza: 1.4,
      dudas: ["Revisar un dígito"],
      modelo: "vision-free",
    });
    expect(result.raw.fecha).toBe("2026-07-21");
    expect(result.fields.box_reciclaje).toBe(4);
    expect(result.fields.kg_reciclado_malla_z1).toBe(294);
    expect(result.fields.kg_reciclado_malla_z2).toBe(294);
    expect(result.confianza).toBe(1);
    expect(result.dudas).toEqual(["Revisar un dígito"]);
  });

  it("rechaza una respuesta vacía", () => {
    expect(() => normalizePartManualVisionResult(null)).toThrow();
  });
});

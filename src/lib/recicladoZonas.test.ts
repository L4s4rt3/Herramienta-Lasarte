import { describe, expect, it } from "vitest";
import { netoRecicladoZona, TARA_BOX_KG } from "./recicladoZonas";

describe("netoRecicladoZona — tara de box por zona (regla del dueño 2026-07-29)", () => {
  it("el ejemplo del dueño: 3 box en Z1 → se quitan 90 kg del bruto", () => {
    expect(netoRecicladoZona(700, 3)).toBe(700 - 3 * TARA_BOX_KG); // 610
  });

  it("sin box (null o 0) el bruto queda tal cual — compatible con partes antiguos que ya traen el neto", () => {
    expect(netoRecicladoZona(610, null)).toBe(610);
    expect(netoRecicladoZona(610, 0)).toBe(610);
  });

  it("una fracción de box ocupa un box completo (mismo criterio que el OCR)", () => {
    expect(netoRecicladoZona(700, 2.2)).toBe(700 - 3 * TARA_BOX_KG);
  });

  it("un bruto menor que su tara es error de papel: clamp a 0, nunca fruta negativa", () => {
    expect(netoRecicladoZona(50, 3)).toBe(0);
  });
});

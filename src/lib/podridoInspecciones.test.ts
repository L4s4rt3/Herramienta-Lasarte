import { describe, expect, it } from "vitest";
import { computeInspeccionPodrido, parsePodridasPorBox } from "./podridoInspecciones";

describe("computeInspeccionPodrido", () => {
  it("caso real 26050508 (27-jul-2026): 176,11 g/naranja, 196 kg/box, 7 box → 1113 naranjas/box, 12,66% podrido", () => {
    const r = computeInspeccionPodrido({
      pesoNaranjaG: 176.11,
      kgPorBox: 196,
      podridasPorBox: [119, 136, 128, 144, 157, 150, 152],
    });
    expect(r).not.toBeNull();
    expect(r!.naranjasPorBox).toBe(1113);
    expect(r!.nBox).toBe(7);
    expect(r!.naranjasInspeccionadas).toBe(7791);
    expect(r!.naranjasPodridas).toBe(986);
    expect(r!.pctPodrido * 100).toBeCloseTo(12.66, 2);
    expect(r!.porBox[0].pct * 100).toBeCloseTo(10.69, 2);
    expect(r!.porBox[4].pct * 100).toBeCloseTo(14.11, 2);
  });

  it("sin peso de naranja, sin kg por box o sin boxes → null (no se adivina)", () => {
    expect(computeInspeccionPodrido({ pesoNaranjaG: 0, kgPorBox: 196, podridasPorBox: [1] })).toBeNull();
    expect(computeInspeccionPodrido({ pesoNaranjaG: 176, kgPorBox: 0, podridasPorBox: [1] })).toBeNull();
    expect(computeInspeccionPodrido({ pesoNaranjaG: 176, kgPorBox: 196, podridasPorBox: [] })).toBeNull();
  });

  it("más podridas que naranjas en un box = error de registro → null", () => {
    expect(computeInspeccionPodrido({ pesoNaranjaG: 176.11, kgPorBox: 196, podridasPorBox: [2000] })).toBeNull();
  });
});

describe("parsePodridasPorBox", () => {
  it("acepta comas, espacios y punto y coma", () => {
    expect(parsePodridasPorBox("119, 136 128;144")).toEqual([119, 136, 128, 144]);
  });
  it("rechaza no-enteros y negativos", () => {
    expect(parsePodridasPorBox("119, doce")).toBeNull();
    expect(parsePodridasPorBox("119, -3")).toBeNull();
    expect(parsePodridasPorBox("  ")).toBeNull();
  });
});

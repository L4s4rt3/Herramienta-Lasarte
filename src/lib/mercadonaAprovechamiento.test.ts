import { describe, expect, it } from "vitest";
import { esPaletMercadona, kgMercadonaEstimado } from "./mercadonaAprovechamiento";

describe("esPaletMercadona", () => {
  it("cuenta siempre los palets con cliente Mercadona, pesen lo que pesen", () => {
    expect(esPaletMercadona({ cliente: "MERCADONA S.A.", producto: "NAR VALENCIA LATE CAL6/8", kg_neto: 282 })).toBe(true);
    expect(esPaletMercadona({ cliente: "MERCADONA S.A.", producto: "NAR VALENCIA LATE CAL6/8", kg_neto: 900 })).toBe(true);
  });

  it("descarta los palets de otros clientes aunque sean ligeros", () => {
    expect(esPaletMercadona({ cliente: "INDIGO FOOD S.L.", producto: "NAR VALENCIA MIDKNIGHT CAL4/5", kg_neto: 300 })).toBe(false);
  });

  it("recupera los palets sin cliente con perfil Mercadona (ligeros)", () => {
    expect(esPaletMercadona({ cliente: "", producto: "NAR VALENCIA LATE CAL5/6", kg_neto: 242 })).toBe(true);
    expect(esPaletMercadona({ cliente: null, producto: "NAR VALENCIA MIDKNIGHT CAL1/2", kg_neto: 283 })).toBe(true);
  });

  it("descarta los palets sin cliente pesados (perfil mayorista)", () => {
    expect(esPaletMercadona({ cliente: "", producto: "NAR VALENCIA MIDKNIGHT CAL6/7", kg_neto: 854 })).toBe(false);
  });

  it("descarta categoría II, precalibrado y granel CITRICAS aunque no tengan cliente", () => {
    expect(esPaletMercadona({ cliente: "", producto: "NAR VALENCIA MIDKNIGHT CATII CAL6/7", kg_neto: 250 })).toBe(false);
    expect(esPaletMercadona({ cliente: "", producto: "NAR VAL DELTA SEEDLESS PRE1", kg_neto: 250 })).toBe(false);
    expect(esPaletMercadona({ cliente: "", producto: "NAR VALENCIA MIDKNIGHT PREC1", kg_neto: 250 })).toBe(false);
    expect(esPaletMercadona({ cliente: "", producto: "NAR VALENCIA MIDKNIGHT CITRICAS", kg_neto: 250 })).toBe(false);
  });

  it("descarta palets sin kg", () => {
    expect(esPaletMercadona({ cliente: "", producto: "NAR VALENCIA LATE CAL5/6", kg_neto: 0 })).toBe(false);
    expect(esPaletMercadona({ cliente: "", producto: "NAR VALENCIA LATE CAL5/6", kg_neto: null })).toBe(false);
  });
});

describe("kgMercadonaEstimado", () => {
  it("suma solo los palets que pasan la regla", () => {
    const palets = [
      { cliente: "MERCADONA S.A.", producto: "NAR VALENCIA LATE CAL6/8", kg_neto: 282 },
      { cliente: "", producto: "NAR VALENCIA LATE CAL5/6", kg_neto: 242 },
      { cliente: "", producto: "NAR VALENCIA MIDKNIGHT CATII CAL6/7", kg_neto: 250 },
      { cliente: "INDIGO FOOD S.L.", producto: "NAR VALENCIA MIDKNIGHT CAL4/5", kg_neto: 300 },
    ];
    expect(kgMercadonaEstimado(palets)).toBe(282 + 242);
  });
});

import { describe, expect, it } from "vitest";
import { formatEuro, formatEurKg, normalizarTexto } from "./format";

describe("formatEuro", () => {
  // Valores < 1000 a propósito: Node sin full-icu no aplica el separador de
  // miles es-ES en este entorno de test (ver comentario en src/lib/pdfKit.ts) —
  // no es lo que este test quiere fijar, solo el comportamiento de formatEuro.
  it("formatea con 2 decimales por defecto", () => {
    expect(formatEuro(123.5)).toBe("123,50 €");
  });

  it("respeta un digits explicito (p.ej. DireccionDashboard con digits=0)", () => {
    expect(formatEuro(123.6, 0)).toBe("124 €");
  });

  it("da — para null/undefined/NaN, no 0,00 EUR", () => {
    expect(formatEuro(null)).toBe("—");
    expect(formatEuro(undefined)).toBe("—");
    expect(formatEuro(NaN)).toBe("—");
  });
});

describe("formatEurKg", () => {
  it("formatea con 3 decimales por defecto", () => {
    expect(formatEurKg(0.1234)).toBe("0,123 €/kg");
  });

  it("da — para null/undefined/NaN", () => {
    expect(formatEurKg(null)).toBe("—");
    expect(formatEurKg(undefined)).toBe("—");
  });
});

describe("normalizarTexto", () => {
  it("quita tildes y diacríticos", () => {
    expect(normalizarTexto("Málaga")).toBe("malaga");
    expect(normalizarTexto("Peñón")).toBe("penon");
    expect(normalizarTexto("NAVEL POWELL")).toBe("navel powell");
  });

  it("pasa a minúsculas", () => {
    expect(normalizarTexto("EL CARRASCAL")).toBe("el carrascal");
  });

  it("no recorta espacios de borde por defecto (comportamiento usado para búsquedas .includes())", () => {
    expect(normalizarTexto("  Juan Pérez  ")).toBe("  juan perez  ");
  });

  it("con { trim: true } sí recorta espacios de borde (usado como clave de igualdad)", () => {
    expect(normalizarTexto("  Juan Pérez  ", { trim: true })).toBe("juan perez");
  });

  it("trata null/undefined como cadena vacía", () => {
    expect(normalizarTexto(null)).toBe("");
    expect(normalizarTexto(undefined)).toBe("");
    expect(normalizarTexto(null, { trim: true })).toBe("");
  });

  it("sin trim no colapsa espacios internos múltiples (solo quita tildes/mayúsculas)", () => {
    expect(normalizarTexto("Juan   Pérez")).toBe("juan   perez");
  });

  it("con trim colapsa espacios internos, igual que normalizar_nombre_productor en SQL", () => {
    expect(normalizarTexto("Juan   Pérez", { trim: true })).toBe("juan perez");
    expect(normalizarTexto("  FCO.  DE ASÍS  ", { trim: true })).toBe("fco. de asis");
  });
});

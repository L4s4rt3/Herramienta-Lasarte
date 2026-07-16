import { describe, expect, it } from "vitest";
import { normalizarTexto } from "./format";

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

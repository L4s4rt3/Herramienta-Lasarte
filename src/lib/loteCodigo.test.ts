import { describe, expect, it } from "vitest";
import { normalizarLoteCodigo, prefijoNumericoLote } from "./loteCodigo";

describe("normalizarLoteCodigo (convención A: primer grupo de 8 dígitos)", () => {
  it("extrae el código limpio cuando ya son solo 8 dígitos", () => {
    expect(normalizarLoteCodigo("26040604")).toBe("26040604");
  });

  it("extrae los 8 dígitos aunque haya texto pegado detrás", () => {
    expect(normalizarLoteCodigo("26042712 + 7 BOX DE RECICLAJE")).toBe("26042712");
  });

  it("encuentra el grupo de 8 dígitos en cualquier posición del texto", () => {
    expect(normalizarLoteCodigo("LOTE 26042712 REVISADO")).toBe("26042712");
  });

  it("devuelve null si no hay ningún grupo de 8 dígitos", () => {
    expect(normalizarLoteCodigo("2604271")).toBeNull(); // 7 dígitos
    expect(normalizarLoteCodigo("sin numeros")).toBeNull();
    expect(normalizarLoteCodigo(null)).toBeNull();
    expect(normalizarLoteCodigo(undefined)).toBeNull();
  });

  it("con más de 8 dígitos seguidos, se queda con los 8 primeros de ese grupo", () => {
    expect(normalizarLoteCodigo("260427123")).toBe("26042712");
  });
});

describe("prefijoNumericoLote (convención B: dígitos iniciales, sin longitud fija)", () => {
  it("extrae el prefijo numérico del inicio", () => {
    expect(prefijoNumericoLote("26040604")).toBe("26040604");
  });

  it("extrae solo los dígitos iniciales aunque el texto siga", () => {
    expect(prefijoNumericoLote("26042712 + 7 BOX DE RECICLAJE")).toBe("26042712");
  });

  it("no exige 8 dígitos: un prefijo más corto es válido", () => {
    expect(prefijoNumericoLote("2604 texto")).toBe("2604");
  });

  it("un prefijo más largo de 8 dígitos se conserva entero (a diferencia de la convención A)", () => {
    expect(prefijoNumericoLote("260427123 resto")).toBe("260427123");
  });

  it("no encuentra dígitos si no están al principio del texto", () => {
    expect(prefijoNumericoLote("LOTE 26042712")).toBeNull();
  });

  it("devuelve null para valores vacíos o nulos", () => {
    expect(prefijoNumericoLote("")).toBeNull();
    expect(prefijoNumericoLote(null)).toBeNull();
    expect(prefijoNumericoLote(undefined)).toBeNull();
  });
});

describe("las dos convenciones divergen quando corresponde", () => {
  it("código con menos de 8 dígitos: A no encuentra nada, B sí", () => {
    const value = "2604 fruta";
    expect(normalizarLoteCodigo(value)).toBeNull();
    expect(prefijoNumericoLote(value)).toBe("2604");
  });

  it("prefijo de más de 8 dígitos: A recorta a 8, B conserva todos", () => {
    const value = "260427123456";
    expect(normalizarLoteCodigo(value)).toBe("26042712");
    expect(prefijoNumericoLote(value)).toBe("260427123456");
  });

  it("dígitos no iniciales: A los encuentra buscando en cualquier posición, B no (exige inicio)", () => {
    const value = "LOTE 26042712";
    expect(normalizarLoteCodigo(value)).toBe("26042712");
    expect(prefijoNumericoLote(value)).toBeNull();
  });

  it("coinciden cuando el texto es exactamente 8 dígitos limpios", () => {
    const value = "26040604";
    expect(normalizarLoteCodigo(value)).toBe(prefijoNumericoLote(value));
  });
});

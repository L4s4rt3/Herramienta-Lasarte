import { describe, expect, it } from "vitest";
import { filtrarArchivos, parseArchivoNombre, sanearNombreArchivo } from "./cmrArchivo";

describe("parseArchivoNombre", () => {
  it("extrae numero de CMR y etiqueta legible de un nombre tipico", () => {
    const result = parseArchivoNombre("a1b2c3d4e5f6-PACO-CMR-10305-COFRULY-LYON-ANTONIO-CANO.pdf");
    expect(result.numero).toBe("10305");
    expect(result.etiqueta).toBe("PACO CMR 10305 COFRULY LYON ANTONIO CANO");
    expect(result.extension).toBe("pdf");
  });

  it("extrae numero de CMR mas corto sin cambiar el resto", () => {
    const result = parseArchivoNombre("a1b2c3d4e5f6-PACO-CMR-7495-DELTA-BLAU-SOCAFNA.pdf");
    expect(result.numero).toBe("7495");
    expect(result.etiqueta).toBe("PACO CMR 7495 DELTA BLAU SOCAFNA");
  });

  it("devuelve numero null cuando el nombre no trae el patron CMR-<digitos>", () => {
    const result = parseArchivoNombre("a1b2c3d4e5f6-2020-2021-KOLLAGMBH-PASCAL-LOGISTIC.pdf");
    expect(result.numero).toBeNull();
    expect(result.etiqueta).toBe("2020 2021 KOLLAGMBH PASCAL LOGISTIC");
    expect(result.extension).toBe("pdf");
  });

  it("parsea nombres de hoja de ruta (.xls) sin numero de CMR", () => {
    const result = parseArchivoNombre("a1b2c3d4e5f6-URIA-BILBAO-GENARO.xls");
    expect(result.numero).toBeNull();
    expect(result.etiqueta).toBe("URIA BILBAO GENARO");
    expect(result.extension).toBe("xls");
  });

  it("es tolerante con nombres sin hash inicial", () => {
    const result = parseArchivoNombre("DHL-TRAIL-FRUITS.xls");
    expect(result.etiqueta).toBe("DHL TRAIL FRUITS");
    expect(result.extension).toBe("xls");
  });

  it("nunca lanza con entradas vacias o raras", () => {
    expect(() => parseArchivoNombre("")).not.toThrow();
    expect(() => parseArchivoNombre(null as unknown as string)).not.toThrow();
    expect(() => parseArchivoNombre(undefined as unknown as string)).not.toThrow();
    expect(parseArchivoNombre("").etiqueta).toBe("");
  });

  it("maneja nombres sin extension", () => {
    const result = parseArchivoNombre("a1b2c3d4e5f6-SIN-EXTENSION");
    expect(result.extension).toBe("");
    expect(result.etiqueta).toBe("SIN EXTENSION");
  });
});

describe("filtrarArchivos", () => {
  const archivos = [
    { name: "a1b2c3d4e5f6-PACO-CMR-10305-COFRULY-LYON-ANTONIO-CANO.pdf" },
    { name: "a1b2c3d4e5f6-PACO-CMR-7495-DELTA-BLAU-SOCAFNA.pdf" },
    { name: "a1b2c3d4e5f6-URIA-BILBAO-GENARO.xls" },
  ];

  it("devuelve todo si la busqueda esta vacia", () => {
    expect(filtrarArchivos(archivos, "")).toHaveLength(3);
    expect(filtrarArchivos(archivos, "   ")).toHaveLength(3);
  });

  it("filtra por numero de CMR", () => {
    const result = filtrarArchivos(archivos, "10305");
    expect(result).toHaveLength(1);
    expect(result[0].name).toContain("10305");
  });

  it("filtra por texto de la etiqueta, sin distinguir mayusculas", () => {
    const result = filtrarArchivos(archivos, "bilbao");
    expect(result).toHaveLength(1);
    expect(result[0].name).toContain("URIA-BILBAO-GENARO");
  });

  it("no rompe con archivos que no matchean nada", () => {
    expect(filtrarArchivos(archivos, "no-existe-en-ningun-lado")).toHaveLength(0);
  });
});

describe("sanearNombreArchivo", () => {
  it("reemplaza espacios y acentos por guiones bajos/ascii", () => {
    expect(sanearNombreArchivo("informe día 1.pdf")).toBe("informe_dia_1.pdf");
  });

  it("mantiene caracteres seguros", () => {
    expect(sanearNombreArchivo("archivo-valido_123.pdf")).toBe("archivo-valido_123.pdf");
  });
});

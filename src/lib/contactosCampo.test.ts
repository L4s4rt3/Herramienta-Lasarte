import { describe, expect, it } from "vitest";
import {
  esEmailValido,
  normalizarEmail,
  parseContactosCampoRows,
  parseEmailsManuales,
  parseTipoContacto,
} from "./contactosCampo";

describe("esEmailValido", () => {
  it("acepta emails normales", () => {
    expect(esEmailValido("jesus@lasartesat.es")).toBe(true);
    expect(esEmailValido("  con.espacios@dominio.com  ")).toBe(true);
  });

  it("rechaza valores sin pinta de email", () => {
    expect(esEmailValido("")).toBe(false);
    expect(esEmailValido(null)).toBe(false);
    expect(esEmailValido("sin-arroba.com")).toBe(false);
    expect(esEmailValido("dos@arrobas@x.com")).toBe(false);
    expect(esEmailValido("sin@tld")).toBe(false);
  });
});

describe("normalizarEmail", () => {
  it("trim + minúsculas", () => {
    expect(normalizarEmail("  Jesus@LasarteSAT.es ")).toBe("jesus@lasartesat.es");
  });
});

describe("parseEmailsManuales", () => {
  it("acepta comas, puntos y comas, espacios y saltos de línea", () => {
    const { validos, invalidos } = parseEmailsManuales("a@b.com, c@d.com; e@f.com\ng@h.com  i@j.com");
    expect(validos).toEqual(["a@b.com", "c@d.com", "e@f.com", "g@h.com", "i@j.com"]);
    expect(invalidos).toEqual([]);
  });

  it("separa válidos de inválidos y deduplica ignorando mayúsculas", () => {
    const { validos, invalidos } = parseEmailsManuales("a@b.com, no-es-email, A@B.COM");
    expect(validos).toEqual(["a@b.com"]);
    expect(invalidos).toEqual(["no-es-email"]);
  });

  it("texto vacío no produce nada", () => {
    expect(parseEmailsManuales("")).toEqual({ validos: [], invalidos: [] });
    expect(parseEmailsManuales("  \n ")).toEqual({ validos: [], invalidos: [] });
  });
});

describe("parseTipoContacto", () => {
  it("reconoce variantes de agricultor y proveedor (con acentos y mayúsculas)", () => {
    expect(parseTipoContacto("Agricultor")).toBe("agricultor");
    expect(parseTipoContacto("AGRÍCOLA")).toBe("agricultor");
    expect(parseTipoContacto("productor")).toBe("agricultor");
    expect(parseTipoContacto("Proveedor")).toBe("proveedor");
    expect(parseTipoContacto("  proveedores  ")).toBe("proveedor");
  });

  it("null si no reconoce el valor", () => {
    expect(parseTipoContacto("")).toBeNull();
    expect(parseTipoContacto("cliente")).toBeNull();
    expect(parseTipoContacto(null)).toBeNull();
  });
});

describe("parseContactosCampoRows", () => {
  it("localiza columnas por cabecera (con acentos y orden arbitrario)", () => {
    const rows = [
      ["Tipo", "Correo electrónico", "NOMBRE ", "Observaciones"],
      ["Agricultor", "paco@campo.es", "Paco Pérez", "Finca La Vega"],
      ["Proveedor", "envases@sumin.com", "Suministros SL", ""],
    ];
    const { contactos, descartados } = parseContactosCampoRows(rows);
    expect(descartados).toEqual([]);
    expect(contactos).toEqual([
      { nombre: "Paco Pérez", email: "paco@campo.es", tipo: "agricultor", notas: "Finca La Vega" },
      { nombre: "Suministros SL", email: "envases@sumin.com", tipo: "proveedor", notas: null },
    ]);
  });

  it("descarta filas sin email válido con su motivo y número de fila (1-based)", () => {
    const rows = [
      ["Nombre", "Email"],
      ["Sin correo", ""],
      ["Correo roto", "no-es-un-email"],
      ["Bien", "ok@x.com"],
    ];
    const { contactos, descartados } = parseContactosCampoRows(rows);
    expect(contactos).toHaveLength(1);
    expect(contactos[0].email).toBe("ok@x.com");
    expect(descartados).toEqual([
      { fila: 2, motivo: "Sin email." },
      { fila: 3, motivo: 'Email no válido: "no-es-un-email".' },
    ]);
  });

  it("deduplica emails repetidos dentro del fichero (se queda la primera aparición)", () => {
    const rows = [
      ["nombre", "email"],
      ["Primero", "dup@x.com"],
      ["Segundo", "DUP@X.COM"],
    ];
    const { contactos, descartados } = parseContactosCampoRows(rows);
    expect(contactos).toHaveLength(1);
    expect(contactos[0].nombre).toBe("Primero");
    expect(descartados).toEqual([{ fila: 3, motivo: "Email repetido en el fichero: dup@x.com." }]);
  });

  it("sin columna de tipo aplica el tipo por defecto elegido", () => {
    const rows = [
      ["Nombre", "Email"],
      ["Uno", "uno@x.com"],
    ];
    expect(parseContactosCampoRows(rows).contactos[0].tipo).toBe("agricultor");
    expect(parseContactosCampoRows(rows, "proveedor").contactos[0].tipo).toBe("proveedor");
  });

  it("valor de tipo no reconocible cae al tipo por defecto", () => {
    const rows = [
      ["Nombre", "Email", "Tipo"],
      ["Uno", "uno@x.com", "cliente"],
    ];
    expect(parseContactosCampoRows(rows, "proveedor").contactos[0].tipo).toBe("proveedor");
  });

  it("sin cabecera detecta la columna de email por contenido y usa la otra columna como nombre", () => {
    const rows = [
      ["Paco Pérez", "paco@campo.es"],
      ["María López", "maria@campo.es"],
    ];
    const { contactos, descartados } = parseContactosCampoRows(rows);
    expect(descartados).toEqual([]);
    expect(contactos).toEqual([
      { nombre: "Paco Pérez", email: "paco@campo.es", tipo: "agricultor", notas: null },
      { nombre: "María López", email: "maria@campo.es", tipo: "agricultor", notas: null },
    ]);
  });

  it("fila sin nombre usa la parte local del email", () => {
    const rows = [
      ["Nombre", "Email"],
      ["", "riegos.sur@x.com"],
    ];
    expect(parseContactosCampoRows(rows).contactos[0].nombre).toBe("riegos.sur");
  });

  it("normaliza el email a minúsculas y con trim", () => {
    const rows = [
      ["Nombre", "Email"],
      ["Uno", "  Uno.Mayus@X.COM "],
    ];
    expect(parseContactosCampoRows(rows).contactos[0].email).toBe("uno.mayus@x.com");
  });

  it("ignora filas totalmente vacías sin declararlas descartadas", () => {
    const rows = [
      ["Nombre", "Email"],
      ["", ""],
      [null, null],
      ["Bien", "ok@x.com"],
    ];
    const { contactos, descartados } = parseContactosCampoRows(rows);
    expect(contactos).toHaveLength(1);
    expect(descartados).toEqual([]);
  });

  it("hoja sin ninguna columna de email devuelve el motivo global", () => {
    const rows = [
      ["Nombre", "Teléfono"],
      ["Paco", "600123123"],
    ];
    const { contactos, descartados } = parseContactosCampoRows(rows);
    expect(contactos).toEqual([]);
    expect(descartados).toEqual([{ fila: 1, motivo: "No se encontró ninguna columna de email en la hoja." }]);
  });

  it("hoja vacía no rompe", () => {
    expect(parseContactosCampoRows([])).toEqual({ contactos: [], descartados: [] });
  });
});

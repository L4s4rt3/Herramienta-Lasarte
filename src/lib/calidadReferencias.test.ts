import { describe, expect, it } from "vitest";
import { parseInformeTamanosClases, pctPodridoVariedad } from "./calidadReferencias";

// Construye una hoja mínima (filas de celdas) que reproduce la estructura
// REAL del informe "Totales de Tamaños, Clase y Calidad por Variedad"
// (verificada con los 2 archivos del dueño, MORATALLA/INVERMARMELO, jul
// 2026 — ver el script de validación del scratchpad): cabecera "Filtros",
// "Variedad:", secciones de Clase "(X) Nombre" con su cabecera de columnas
// ("Tamaño"/"Peso (kg)") a unas filas de distancia y filas de Tamaño
// "(NN) código" con el peso en una columna cualquiera (deliberadamente
// distinta entre secciones, para probar que el parser no depende de
// columnas fijas).
function filaClase(codigo: string, nombre: string, colLabel = 7): unknown[] {
  const row: unknown[] = [];
  row[colLabel] = `(${codigo}) ${nombre}`;
  return row;
}

function filaCabecera(tamanoCol: number, pesoCol: number): unknown[] {
  const row: unknown[] = [];
  row[tamanoCol] = "Tamaño";
  row[tamanoCol + 9] = "Piezas";
  row[pesoCol] = "Peso (kg)";
  return row;
}

function filaTamano(tamanoCol: number, pesoCol: number, codigo: string, etiqueta: string, kg: number): unknown[] {
  const row: unknown[] = [];
  row[tamanoCol] = `(${codigo}) ${etiqueta}`;
  row[pesoCol] = kg;
  return row;
}

function filaVariedad(nombre: string, colLabel = 1, colValor = 14): unknown[] {
  const row: unknown[] = [];
  row[colLabel] = "Variedad:";
  row[colValor] = nombre;
  return row;
}

function filaFiltros(productor: string): unknown[] {
  const row: unknown[] = [];
  row[15] = `Nombre del Productor es  '${productor}'\nFecha de Lote es entre lunes, 1 de enero de 2026 y martes, 1 de julio de 2026`;
  return row;
}

describe("parseInformeTamanosClases — caso mínimo, 1 variedad y 2 clases", () => {
  const rows: unknown[][] = [
    [],
    filaFiltros("MORATALLA"),
    [],
    filaVariedad("PRINCIPIO CAMPAÑA"),
    [],
    filaClase("A", "Extra 1"),
    [],
    filaCabecera(4, 28), // mismas columnas que el archivo real
    filaTamano(4, 28, "01", "CITRICA", 100),
    filaTamano(4, 28, "02", "9/130", 50),
    [], // fila de totales de la clase (blanco en la col de tamaño): fin de la sección
    [],
    filaClase("J", "Podrido"),
    [],
    filaCabecera(4, 28),
    filaTamano(4, 28, "01", "CITRICA", 5),
    filaTamano(4, 28, "02", "9/130", 3),
    [],
  ];

  const informe = parseInformeTamanosClases(rows);

  it("extrae el productor del texto libre de la fila de Filtros", () => {
    expect(informe.productor).toBe("MORATALLA");
  });

  it("agrupa en una sola variedad con sus 2 clases", () => {
    expect(informe.variedades).toHaveLength(1);
    const v = informe.variedades[0];
    expect(v.variedad).toBe("PRINCIPIO CAMPAÑA");
    expect(v.kgPorClase.size).toBe(2);
    expect(v.kgPorClase.get("A")).toEqual({ codigo: "A", nombre: "Extra 1", kg: 150 });
    expect(v.kgPorClase.get("J")).toEqual({ codigo: "J", nombre: "Podrido", kg: 8 });
  });

  it("kgTotal es la suma de todas las clases, kgPodrido solo la(s) que contienen 'podrido'", () => {
    const v = informe.variedades[0];
    expect(v.kgTotal).toBeCloseTo(158); // 150 + 8
    expect(v.kgPodrido).toBeCloseTo(8);
    expect(informe.kgTotal).toBeCloseTo(158);
    expect(informe.kgPodrido).toBeCloseTo(8);
  });

  it("pctPodridoVariedad calcula el % sobre el total", () => {
    const v = informe.variedades[0];
    expect(pctPodridoVariedad(v)).toBeCloseTo((8 / 158) * 100);
  });

  it("no hay avisos: la estructura mínima se reconoce entera", () => {
    expect(informe.descartadas).toEqual([]);
  });
});

describe("parseInformeTamanosClases — distingue clase '(X) letra' de tamaño '(NN) dígitos'", () => {
  it("una fila de tamaño con código de 2 dígitos nunca se confunde con el inicio de una clase", () => {
    const rows: unknown[][] = [
      filaFiltros("TEST"),
      filaVariedad("UNICA"),
      filaClase("A", "Extra 1"),
      filaCabecera(4, 28),
      filaTamano(4, 28, "01", "CITRICA", 10),
      filaTamano(4, 28, "15", "GORDAS", 20),
      [],
    ];
    const informe = parseInformeTamanosClases(rows);
    expect(informe.variedades[0].kgPorClase.size).toBe(1);
    expect(informe.variedades[0].kgPorClase.get("A")!.kg).toBeCloseTo(30);
  });
});

describe("parseInformeTamanosClases — no depende de columnas fijas", () => {
  it("cada sección de clase puede tener sus columnas de Tamaño/Peso en índices distintos", () => {
    const rows: unknown[][] = [
      filaFiltros("TEST"),
      filaVariedad("UNICA"),
      filaClase("A", "Extra 1"),
      filaCabecera(4, 28),
      filaTamano(4, 28, "01", "CITRICA", 10),
      [],
      filaClase("B", "Extra 2"),
      filaCabecera(6, 40), // columnas distintas de la sección anterior
      filaTamano(6, 40, "01", "CITRICA", 25),
      [],
    ];
    const informe = parseInformeTamanosClases(rows);
    expect(informe.variedades[0].kgPorClase.get("A")!.kg).toBeCloseTo(10);
    expect(informe.variedades[0].kgPorClase.get("B")!.kg).toBeCloseTo(25);
  });
});

describe("parseInformeTamanosClases — varias variedades", () => {
  it("cada 'Variedad:' abre un nuevo grupo con sus propias clases", () => {
    const rows: unknown[][] = [
      filaFiltros("TEST"),
      filaVariedad("NAVELINA"),
      filaClase("A", "Extra 1"),
      filaCabecera(4, 28),
      filaTamano(4, 28, "01", "CITRICA", 100),
      [],
      filaVariedad("VALENCIA LATE"),
      filaClase("J", "Podrido"),
      filaCabecera(4, 28),
      filaTamano(4, 28, "01", "CITRICA", 9),
      [],
    ];
    const informe = parseInformeTamanosClases(rows);
    expect(informe.variedades).toHaveLength(2);
    expect(informe.variedades[0].variedad).toBe("NAVELINA");
    expect(informe.variedades[0].kgPodrido).toBe(0);
    expect(informe.variedades[1].variedad).toBe("VALENCIA LATE");
    expect(informe.variedades[1].kgPodrido).toBeCloseTo(9);
    expect(informe.kgTotal).toBeCloseTo(109);
    expect(informe.kgPodrido).toBeCloseTo(9);
  });
});

describe("parseInformeTamanosClases — casos degradados (se avisa, no se rompe)", () => {
  it("sin fila de Filtros reconocible: productor null + aviso", () => {
    const rows: unknown[][] = [
      filaVariedad("UNICA"),
      filaClase("A", "Extra 1"),
      filaCabecera(4, 28),
      filaTamano(4, 28, "01", "CITRICA", 10),
    ];
    const informe = parseInformeTamanosClases(rows);
    expect(informe.productor).toBeNull();
    expect(informe.descartadas.some((d) => d.includes("Nombre del Productor"))).toBe(true);
  });

  it("clase sin cabecera 'Tamaño'/'Peso (kg)' cercana: se descarta con aviso, no rompe el resto", () => {
    const rows: unknown[][] = [
      filaFiltros("TEST"),
      filaVariedad("UNICA"),
      filaClase("A", "Extra 1"),
      // Sin cabecera en absoluto (se acaba el informe): la clase se descarta.
    ];
    const informe = parseInformeTamanosClases(rows);
    expect(informe.variedades[0].kgPorClase.size).toBe(0);
    expect(informe.descartadas.some((d) => d.includes("sin cabecera"))).toBe(true);
  });

  it("clase encontrada antes de cualquier 'Variedad:': se descarta con aviso", () => {
    const rows: unknown[][] = [
      filaFiltros("TEST"),
      filaClase("A", "Extra 1"),
      filaCabecera(4, 28),
      filaTamano(4, 28, "01", "CITRICA", 10),
    ];
    const informe = parseInformeTamanosClases(rows);
    expect(informe.variedades).toHaveLength(0);
    expect(informe.descartadas.some((d) => d.includes("antes de cualquier"))).toBe(true);
  });

  it("'Variedad:' sin ningún valor a la derecha: se descarta con aviso y no abre grupo", () => {
    const rows: unknown[][] = [
      filaFiltros("TEST"),
      (() => { const r: unknown[] = []; r[1] = "Variedad:"; return r; })(),
      filaClase("A", "Extra 1"),
      filaCabecera(4, 28),
      filaTamano(4, 28, "01", "CITRICA", 10),
    ];
    const informe = parseInformeTamanosClases(rows);
    expect(informe.variedades).toHaveLength(0);
    expect(informe.descartadas.some((d) => d.includes("'Variedad:' sin valor"))).toBe(true);
  });
});

describe("parseInformeTamanosClases — detección de 'Podrido' sin distinguir acentos/mayúsculas", () => {
  it("una clase llamada 'PODRIDO' (mayúsculas) también cuenta como podrido", () => {
    const rows: unknown[][] = [
      filaFiltros("TEST"),
      filaVariedad("UNICA"),
      filaClase("J", "PODRIDO"),
      filaCabecera(4, 28),
      filaTamano(4, 28, "01", "CITRICA", 7),
      [],
    ];
    const informe = parseInformeTamanosClases(rows);
    expect(informe.variedades[0].kgPodrido).toBeCloseTo(7);
  });
});

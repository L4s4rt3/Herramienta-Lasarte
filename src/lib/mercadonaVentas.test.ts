import { describe, expect, it } from "vitest";
import {
  buildSemanaExportRows,
  detectarCabeceraSemanalReal,
  formatMercadonaWeekRangeLabel,
  isMetodoConocido,
  isoWeekDateRange,
  mercadonaWeekDateRange,
  parseMercadonaWorkbook,
  parseNombreArchivoSemana,
  parseNombreHojaSemana,
  parseNumeroVentas,
  parseNumeroVentasOrZero,
  parseSemanaSheet,
  parseSemanaSheetSemanalReal,
  type SheetRows,
} from "./mercadonaVentas";

describe("parseNumeroVentas", () => {
  it("parsea numeros con coma como separador de miles", () => {
    expect(parseNumeroVentas("215,260")).toBe(215260);
  });

  it("parsea numeros con espacios alrededor y como separador de miles", () => {
    expect(parseNumeroVentas(" 40,703 ")).toBe(40703);
  });

  it("parsea numeros con formato es (punto miles, coma decimal)", () => {
    expect(parseNumeroVentas("1.234,56")).toBeCloseTo(1234.56, 6);
  });

  it("parsea porcentajes positivos y negativos", () => {
    expect(parseNumeroVentas("19%")).toBe(19);
    expect(parseNumeroVentas("-2%")).toBe(-2);
  });

  it("parsea numeros ya numericos tal cual", () => {
    expect(parseNumeroVentas(1234)).toBe(1234);
  });

  it("devuelve null para vacio, null o undefined", () => {
    expect(parseNumeroVentas("")).toBeNull();
    expect(parseNumeroVentas(null)).toBeNull();
    expect(parseNumeroVentas(undefined)).toBeNull();
  });

  it("devuelve null para texto no numerico", () => {
    expect(parseNumeroVentas("NOTA; texto libre")).toBeNull();
  });

  it("parseNumeroVentasOrZero fuerza 0 en vez de null", () => {
    expect(parseNumeroVentasOrZero(null)).toBe(0);
    expect(parseNumeroVentasOrZero("")).toBe(0);
    expect(parseNumeroVentasOrZero("215,260")).toBe(215260);
  });
});

describe("parseNombreHojaSemana", () => {
  it("extrae el numero de 'SEMANA 21'", () => {
    expect(parseNombreHojaSemana("SEMANA 21")).toBe(21);
  });

  it("es case-insensitive y tolera espacios extra", () => {
    expect(parseNombreHojaSemana("semana  27")).toBe(27);
  });

  it("devuelve null para hojas que no son de semana", () => {
    expect(parseNombreHojaSemana("Resumen")).toBeNull();
    expect(parseNombreHojaSemana("Portada")).toBeNull();
  });
});

describe("isMetodoConocido", () => {
  it("reconoce los 4 metodos de Mercadona", () => {
    expect(isMetodoConocido("MA12KGC")).toBe(true);
    expect(isMetodoConocido("ma3kgc")).toBe(true);
    expect(isMetodoConocido("MA4KGC")).toBe(true);
    expect(isMetodoConocido("MA5KGC")).toBe(true);
  });

  it("rechaza metodos desconocidos", () => {
    expect(isMetodoConocido("XX99")).toBe(false);
  });
});

// ─── Fixtures basadas en la estructura real verificada del Excel ─────────────
// (una hoja "SEMANA N" por semana, filas 0-15 fijas + notas variables).

function buildRealSheet(options: {
  withComparativa?: boolean;
  garbageCells?: boolean;
} = {}): SheetRows {
  const { withComparativa = true, garbageCells = false } = options;

  const header = withComparativa
    ? ["Método", "Descripción", "PORCENTAJE", "KILOS", "PALETS", "CAJAS", "COMPARATIVA SEMANA ANTERIOR"]
    : ["Método", "Descripción", "PORCENTAJE", "KILOS", "PALETS", "CAJAS"];

  const metodoRow = (metodo: string, desc: string, pct: string, kilos: string, palets: string, cajas: string, comp?: string): SheetRows[number] =>
    withComparativa ? [metodo, desc, pct, kilos, palets, cajas, comp ?? ""] : [metodo, desc, pct, kilos, palets, cajas];

  const rows: SheetRows = [
    ["PLANIFICACION VENTAS RECIBIDA DE MERCADONA"],
    ["NARANJAS TOTALES", "18 May - 31 May"],
    ["ANTEQUERA II", "120,000"],
    ["ANTEQUERA VERDURA", "95,260"],
    ["Total general", "215,260"],
    [null, "107,630"],
    ["EL TOTAL GENERAL SE DIVIDE ENTRE 2 YA QUE LA PLANIFICACION LLEGA POR QUINCENAS"],
    header,
    metodoRow("MA12KGC", "GENERICA GRANEL 12 KG", "19%", "40,703", "85", "3392", "-2%"),
    metodoRow("MA3KGC", "HACENDADO D-PACK 4X3KG", "35%", "75,000", "150", "6250", "5%"),
    metodoRow("MA4KGC", "GENERICA GIRSAC 3X4KG", "28%", "60,000", "120", "5000", "1%"),
    metodoRow("MA5KGC", "HACENDADO D-PACK 2X5KG", "18%", "38,557", "77", "3213", "-1%"),
    [null, "TOTAL", null, "214,260", "432", "17855"],
    ["SEMANA 21 HEMOS VENDIDO", "214,260"],
    ["SEMANA 21 HABIA PLANIFICADO", "107,630"],
    ["AUMENTO DEL", "99%", "106,630"],
    ["NOTA; Semana con alta demanda por campaña de verano."],
    ["NOTA; Se ha ajustado el reparto de palets por incidencia logistica."],
  ];

  if (garbageCells) {
    // Celdas numericas sueltas en columnas altas que deben ignorarse.
    rows[8] = [...rows[8], null, null, null, 42];
    rows[9] = [...rows[9], 7];
  }

  return rows;
}

describe("parseSemanaSheet — hoja con columna comparativa (semana 22+)", () => {
  const rows = buildRealSheet({ withComparativa: true });
  const parsed = parseSemanaSheet(rows, 22, 2026);

  it("extrae el rango de planificacion quincenal", () => {
    expect(parsed.rangoPlanificacion).toBe("18 May - 31 May");
  });

  it("extrae planificado quincenal y semanal", () => {
    expect(parsed.planificadoQuincenaKg).toBe(215260);
    expect(parsed.planificadoSemanaKg).toBe(107630);
  });

  it("extrae los 4 metodos con pct/kilos/palets/cajas/comparativa", () => {
    expect(parsed.metodos).toHaveLength(4);
    const [ma12] = parsed.metodos;
    expect(ma12.metodo).toBe("MA12KGC");
    expect(ma12.descripcion).toBe("GENERICA GRANEL 12 KG");
    expect(ma12.pct).toBe(19);
    expect(ma12.kilos).toBe(40703);
    expect(ma12.palets).toBe(85);
    expect(ma12.cajas).toBe(3392);
    expect(ma12.comparativaAnteriorPct).toBe(-2);
  });

  it("extrae los totales de la tabla de metodos", () => {
    expect(parsed.totales).toEqual({ kilos: 214260, palets: 432, cajas: 17855 });
  });

  it("extrae vendido, planificado (redundante) y diferencia", () => {
    expect(parsed.vendidoKg).toBe(214260);
    expect(parsed.diferenciaPct).toBe(99);
  });

  it("extrae las notas de texto libre", () => {
    expect(parsed.notas).toHaveLength(2);
    expect(parsed.notas[0]).toContain("alta demanda");
    expect(parsed.notas[1]).toContain("incidencia logistica");
  });

  it("anio y semana vienen del parametro, no del contenido", () => {
    expect(parsed.anio).toBe(2026);
    expect(parsed.semana).toBe(22);
  });
});

describe("parseSemanaSheet — hoja SIN columna comparativa (semana 21)", () => {
  const rows = buildRealSheet({ withComparativa: false });
  const parsed = parseSemanaSheet(rows, 21, 2026);

  it("sigue extrayendo pct/kilos/palets/cajas sin romper", () => {
    expect(parsed.metodos).toHaveLength(4);
    expect(parsed.metodos[0].kilos).toBe(40703);
    expect(parsed.metodos[0].cajas).toBe(3392);
  });

  it("comparativaAnteriorPct es null cuando la columna no existe", () => {
    expect(parsed.metodos.every((m) => m.comparativaAnteriorPct === null)).toBe(true);
  });
});

describe("parseSemanaSheet — celdas basura numericas sueltas en columnas altas", () => {
  it("ignora columnas fuera de rango y no contamina pct/kilos/palets/cajas", () => {
    const rows = buildRealSheet({ withComparativa: true, garbageCells: true });
    const parsed = parseSemanaSheet(rows, 22, 2026);
    expect(parsed.metodos[0].comparativaAnteriorPct).toBe(-2);
    expect(parsed.metodos[1].comparativaAnteriorPct).toBe(5);
  });
});

describe("parseSemanaSheet — numeros con espacios como separador de miles", () => {
  it("parsea ' 40,703 ' correctamente dentro de una fila de metodo", () => {
    const rows = buildRealSheet({ withComparativa: true });
    rows[8] = ["MA12KGC", "GENERICA GRANEL 12 KG", "19%", " 40,703 ", "85", "3392", "-2%"];
    const parsed = parseSemanaSheet(rows, 22, 2026);
    expect(parsed.metodos[0].kilos).toBe(40703);
  });
});

describe("parseMercadonaWorkbook", () => {
  it("parsea todas las hojas 'SEMANA N' y ordena por numero de semana", () => {
    const sheets: Record<string, SheetRows> = {
      "SEMANA 22": buildRealSheet({ withComparativa: true }),
      "SEMANA 21": buildRealSheet({ withComparativa: false }),
      Portada: [["Portada del informe"]],
    };
    const result = parseMercadonaWorkbook(sheets, 2026);
    expect(result.semanas.map((s) => s.semana)).toEqual([21, 22]);
    expect(result.hojasIgnoradas).toEqual(["Portada"]);
  });

  it("propaga el mismo anio a todas las semanas parseadas", () => {
    const sheets: Record<string, SheetRows> = {
      "SEMANA 21": buildRealSheet(),
    };
    const result = parseMercadonaWorkbook(sheets, 2026);
    expect(result.semanas[0].anio).toBe(2026);
  });
});

describe("isoWeekDateRange", () => {
  it("devuelve lunes a domingo de la semana ISO dada", () => {
    const { desde, hasta } = isoWeekDateRange(2026, 21);
    expect(desde).toBe("2026-05-18");
    expect(hasta).toBe("2026-05-24");
  });

  it("es coherente con el rango de planificacion real '18 May - 31 May' (quincena = semanas 21+22)", () => {
    const semana21 = isoWeekDateRange(2026, 21);
    const semana22 = isoWeekDateRange(2026, 22);
    expect(semana21.desde).toBe("2026-05-18");
    expect(semana22.hasta).toBe("2026-05-31");
  });
});

describe("mercadonaWeekDateRange", () => {
  it("devuelve lunes a SABADO (6 dias, sin domingo)", () => {
    const { desde, hasta } = mercadonaWeekDateRange(2026, 21);
    expect(desde).toBe("2026-05-18"); // lunes
    expect(hasta).toBe("2026-05-23"); // sabado (isoWeekDateRange daria 2026-05-24, domingo)
  });

  it("recorta exactamente 1 dia respecto al rango ISO completo", () => {
    const iso = isoWeekDateRange(2026, 27);
    const mercadona = mercadonaWeekDateRange(2026, 27);
    expect(mercadona.desde).toBe(iso.desde);
    expect(mercadona.hasta).not.toBe(iso.hasta);
  });
});

describe("formatMercadonaWeekRangeLabel", () => {
  it("etiqueta el rango L-S sin año y sin ceros iniciales", () => {
    // Semana 27 de 2026: lunes 29 jun - sabado 4 jul.
    const label = formatMercadonaWeekRangeLabel(2026, 27);
    expect(label).toMatch(/^\d{1,2} jun – \d{1,2} jul \(L-S\)$/);
    expect(label).not.toMatch(/\d{4}/);
  });
});

// ─── Formato SEMANAL REAL (fixture basada en las filas reales de "mercadona s27.xlsx") ─

function buildSemanalRealSheet(): SheetRows {
  return [
    ["Método", "Descripción", "Líneas", "KILOS", "UNID", "LITROS", "Base Iva"],
    [null, null, 4, 0, null, null, -6327.47],
    ["MA12KGC", "GENERICA GRANEL 12 KG", 120, 19690, null, null, 4789.92],
    ["MA3KGC", "HACENDADO D-PACK 4X3KG", 95, 15200, null, null, 3820.15],
    ["MA4KGC", "GENERICA GIRSAC 3X4KG", 80, 12400, null, null, 3105.6],
    ["MA5KGC", "HACENDADO D-PACK 2X5KG", 60, 9800, null, null, 2450.3],
  ];
}

describe("parseNombreArchivoSemana", () => {
  it("infiere el numero de semana de 'mercadona s27.xlsx'", () => {
    expect(parseNombreArchivoSemana("mercadona s27.xlsx")).toBe(27);
  });

  it("es case-insensitive y tolera espacio entre 's' y el numero", () => {
    expect(parseNombreArchivoSemana("MERCADONA S 5.xlsx")).toBe(5);
    expect(parseNombreArchivoSemana("Mercadona_S09_2026.xlsx")).toBe(9);
  });

  it("devuelve null si no hay patron 's<numero>' reconocible", () => {
    expect(parseNombreArchivoSemana("ventas.xlsx")).toBeNull();
  });
});

describe("detectarCabeceraSemanalReal", () => {
  it("detecta la cabecera Método/Descripción/Líneas/KILOS en la fila 0", () => {
    expect(detectarCabeceraSemanalReal(buildSemanalRealSheet())).toBe(0);
  });

  it("devuelve null para una hoja de formato historico (SEMANA N)", () => {
    const rows = buildRealSheet({ withComparativa: true });
    expect(detectarCabeceraSemanalReal(rows)).toBeNull();
  });
});

describe("parseSemanaSheetSemanalReal", () => {
  const rows = buildSemanalRealSheet();
  const parsed = parseSemanaSheetSemanalReal(rows, 27, 2026);

  it("marca el origen como semanal_real y no trae planificacion", () => {
    expect(parsed.origen).toBe("semanal_real");
    expect(parsed.planificadoQuincenaKg).toBeNull();
    expect(parsed.planificadoSemanaKg).toBeNull();
    expect(parsed.rangoPlanificacion).toBeNull();
  });

  it("extrae la fila de ajustes/abonos (metodo vacio, 0 kg, base iva negativa) por separado", () => {
    expect(parsed.ajustesBaseIva).toBeCloseTo(-6327.47, 2);
    expect(parsed.ajustesLineas).toBe(4);
  });

  it("extrae los 4 metodos con lineas, kilos y base_iva, sin contaminarse con la fila de ajustes", () => {
    expect(parsed.metodos).toHaveLength(4);
    const [ma12] = parsed.metodos;
    expect(ma12.metodo).toBe("MA12KGC");
    expect(ma12.descripcion).toBe("GENERICA GRANEL 12 KG");
    expect(ma12.lineas).toBe(120);
    expect(ma12.kilos).toBe(19690);
    expect(ma12.baseIva).toBeCloseTo(4789.92, 2);
    // Campos que no aplican a este formato quedan neutros.
    expect(ma12.pct).toBeNull();
    expect(ma12.palets).toBe(0);
    expect(ma12.cajas).toBe(0);
  });

  it("vendidoKg es la suma de kilos de los metodos (sin contar la fila de ajustes)", () => {
    const sumaEsperada = 19690 + 15200 + 12400 + 9800;
    expect(parsed.vendidoKg).toBe(sumaEsperada);
  });

  it("anio y semana vienen del parametro (inferido del nombre de archivo fuera de esta funcion)", () => {
    expect(parsed.anio).toBe(2026);
    expect(parsed.semana).toBe(27);
  });
});

describe("parseMercadonaWorkbook — autodeteccion de formato", () => {
  it("detecta el formato semanal real en una hoja unica e infiere la semana del nombre de archivo", () => {
    const sheets: Record<string, SheetRows> = { "Sheet 1": buildSemanalRealSheet() };
    const result = parseMercadonaWorkbook(sheets, 2026, "mercadona s27.xlsx");
    expect(result.semanas).toHaveLength(1);
    expect(result.hojasIgnoradas).toEqual([]);
    const [semana] = result.semanas;
    expect(semana.semana).toBe(27);
    expect(semana.origen).toBe("semanal_real");
    expect(semana.vendidoKg).toBe(19690 + 15200 + 12400 + 9800);
    expect(semana.ajustesBaseIva).toBeCloseTo(-6327.47, 2);
  });

  it("sigue detectando el formato historico cuando las hojas se llaman 'SEMANA N'", () => {
    const sheets: Record<string, SheetRows> = {
      "SEMANA 21": buildRealSheet({ withComparativa: false }),
    };
    const result = parseMercadonaWorkbook(sheets, 2026, "VENTAS SEMANA 21 PLATAFORMA ANTEQUERA.xlsx");
    expect(result.semanas).toHaveLength(1);
    expect(result.semanas[0].origen).toBe("historico");
    expect(result.semanas[0].semana).toBe(21);
  });

  it("sin fileNameHint, cae a 0 si la hoja semanal real no trae numero de semana en su nombre", () => {
    const sheets: Record<string, SheetRows> = { "Sheet 1": buildSemanalRealSheet() };
    const result = parseMercadonaWorkbook(sheets, 2026);
    expect(result.semanas[0].semana).toBe(0);
  });
});

describe("buildSemanaExportRows", () => {
  it("reconstruye filas con la disposicion del excel original", () => {
    const rows = buildSemanaExportRows({
      anio: 2026,
      semana: 21,
      rangoPlanificacion: "18 May - 31 May",
      planificadoQuincenaKg: 215260,
      planificadoSemanaKg: 107630,
      vendidoKg: 214260,
      diferenciaPct: 99,
      notas: ["NOTA; Semana con alta demanda."],
      metodos: [
        { metodo: "MA12KGC", descripcion: "GENERICA GRANEL 12 KG", pct: 19, kilos: 40703, palets: 85, cajas: 3392, comparativaAnteriorPct: -2 },
        { metodo: "MA3KGC", descripcion: "HACENDADO D-PACK 4X3KG", pct: 35, kilos: 75000, palets: 150, cajas: 6250, comparativaAnteriorPct: 5 },
        { metodo: "MA4KGC", descripcion: "GENERICA GIRSAC 3X4KG", pct: 28, kilos: 60000, palets: 120, cajas: 5000, comparativaAnteriorPct: 1 },
        { metodo: "MA5KGC", descripcion: "HACENDADO D-PACK 2X5KG", pct: 18, kilos: 38557, palets: 77, cajas: 3213, comparativaAnteriorPct: -1 },
      ],
    });

    // La disposición clona el original: se localizan las filas por etiqueta
    // (los índices exactos dependen de las filas en blanco intermedias).
    const findRow = (label: string) =>
      rows.find((r) => typeof r[0] === "string" && (r[0] as string).toUpperCase().includes(label));

    expect(rows[0]).toEqual(["PLANIFICACION VENTAS RECIBIDA DE MERCADONA"]);
    expect(rows[1]).toEqual([]); // fila en blanco tras el título, como el original
    expect(findRow("NARANJAS TOTALES")).toEqual(["NARANJAS TOTALES", "18 May - 31 May"]);
    expect(findRow("TOTAL GENERAL")?.[1]).toBe(215260);
    expect(findRow("HEMOS VENDIDO")?.slice(0, 3)).toContain(214260);
    expect(findRow("HABIA PLANIFICADO")?.slice(0, 3)).toContain(107630);
    expect(findRow("AUMENTO")).toBeDefined();
    expect(findRow("NOTA;")).toEqual(["NOTA; Semana con alta demanda."]);

    const metodoRow = rows.find((r) => r[0] === "MA12KGC");
    expect(metodoRow?.[1]).toBe("GENERICA GRANEL 12 KG");
    expect(metodoRow?.[3]).toBe(40703);
    expect(rows.filter((r) => typeof r[0] === "string" && (r[0] as string).startsWith("MA"))).toHaveLength(4);
  });

  it("usa DESCENSO DEL cuando la diferencia es negativa", () => {
    const rows = buildSemanaExportRows({
      anio: 2026,
      semana: 23,
      rangoPlanificacion: null,
      planificadoQuincenaKg: null,
      planificadoSemanaKg: 100000,
      vendidoKg: 90000,
      diferenciaPct: -10,
      notas: [],
      metodos: [],
    });
    const descensoRow = rows.find((r) => typeof r[0] === "string" && r[0].includes("DESCENSO"));
    expect(descensoRow).toBeDefined();
  });
});

// ─── Regresión: hoja HISTÓRICA con la disposición REAL del archivo del dueño ──
// (filas en blanco intercaladas que rompían el parser basado en índices fijos:
// tomaba "Total general" como planificado semanal, "ANTEQUERA II" como
// planificado y la cabecera "Método" como si fuera un método más).
describe("parseSemanaSheet con la disposición real del Excel histórico", () => {
  const rowsRealesS21 = [
    ["PLANIFICACION VENTAS RECIBIDA DE MERCADONA", "", ""],
    ["", "", ""],
    ["NARANJAS TOTALES", "18 May - 31 May", ""],
    ["ANTEQUERA II", "16,329", ""],
    ["ANTEQUERA VERDURA", "400,879", ""],
    ["Total general", "417,208", ""],
    ["", " 208,604 ", ""],
    ["EL TOTAL GENERAL SE DIVIDE ENTRE 2, PUES SON DOS SEMANAS", "", ""],
    ["", "", ""],
    ["Método", "Descripción", "PORCENTAJE", " KILOS ", "PALETS", "CAJAS"],
    ["MA12KGC", "GENERICA GRANEL 12 KG PLASTICO", "19%", " 40,703 ", "141", "3316"],
    ["MA3KGC", "HACENDADO D-PACK 4 X 3 KG PLASTICO", "23%", " 49,306 ", "175", "4107"],
    ["MA4KGC", "GENERICA GIRSAC 3 X 4 KG PLASTICO", "22%", " 46,851 ", "160", "3775"],
    ["MA5KGC", "HACENDADO D-PACK 2 X 5 KG PLASTICO", "36%", " 78,400 ", "329", "7840"],
    ["", "", "", " 215,260 ", "805", "19038"],
    ["SEMANA 21 HEMOS VENDIDO ", "", " 215,260 "],
    ["SEMANA 21 HABIA PLANIFICADO", "", " 208,604 "],
    ["AUMENTO DEL", "3.2%", " 6,656 "],
    ["NOTA; LA INFORMACION DE LA PLANIFICACION LA SACO DEL EMAIL RECIBIDO EL DIA 24/12/2025", "", ""],
  ];

  it("extrae todos los datos guiándose por etiquetas, no por índices", () => {
    const s = parseSemanaSheet(rowsRealesS21, 21, 2026);
    expect(s.planificadoQuincenaKg).toBe(417208);
    expect(s.planificadoSemanaKg).toBe(208604);
    expect(s.vendidoKg).toBe(215260);
    expect(s.diferenciaPct).toBe(3.2);
    expect(s.rangoPlanificacion).toBe("18 May - 31 May");
    expect(s.metodos).toHaveLength(4);
    expect(s.metodos.map((m) => m.metodo)).toEqual(["MA12KGC", "MA3KGC", "MA4KGC", "MA5KGC"]);
    expect(s.metodos.reduce((a, m) => a + m.kilos, 0)).toBe(215260);
    expect(s.totales).toEqual({ kilos: 215260, palets: 805, cajas: 19038 });
    expect(s.notas).toHaveLength(1);
  });

  it("la nota 'EL TOTAL GENERAL SE DIVIDE...' no machaca el total quincenal", () => {
    const s = parseSemanaSheet(rowsRealesS21, 21, 2026);
    expect(s.planificadoQuincenaKg).toBe(417208);
  });
});

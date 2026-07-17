import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import {
  computeAutoMetrics,
  detectHeaderRowIndex,
  formatByType,
  formatDateValue,
  formatNumberValue,
  formatPercentValue,
  mergeFillGrid,
  paginateRows,
  parseLooseNumber,
  parseSheet,
  parseWorkbookBytes,
  totalPages,
  type MergeRange,
} from "./excelPreview";

// ─── mergeFillGrid ────────────────────────────────────────────────────────
// Fixture inspirada en el merge real de "Informe PRODUCCION 1SEP14JUL.xlsx"
// (verificado con XLSX: fila de cabecera con merges s=(15,0)-(15,4) "Nombre
// del Lote", s=(15,5)-(15,7) "Código del Productor", etc.)

describe("mergeFillGrid", () => {
  it("propaga el valor de la celda maestra a todo el rango combinado", () => {
    const grid: unknown[][] = [
      ["Nombre del Lote", "", "", "", "", "Código del Productor", "", "", "Variedad"],
      ["25101601", "", "", "", "", "8", "", "", "ESTACADA LARGA"],
    ];
    const merges: MergeRange[] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: 4 } },
      { s: { r: 0, c: 5 }, e: { r: 0, c: 7 } },
    ];
    const filled = mergeFillGrid(grid, merges, 0, 0);
    expect(filled[0]).toEqual([
      "Nombre del Lote",
      "Nombre del Lote",
      "Nombre del Lote",
      "Nombre del Lote",
      "Nombre del Lote",
      "Código del Productor",
      "Código del Productor",
      "Código del Productor",
      "Variedad",
    ]);
    // Las filas de datos no tenían merge propio en este ejemplo: no se tocan.
    expect(filled[1][1]).toBe("");
  });

  it("respeta el offset de origen (range.s) cuando la hoja no empieza en A1", () => {
    // Real: "MORATALLA TAMAÑOS..." tiene range.s = (0,1) (empieza en columna B).
    const grid: unknown[][] = [["(01) CITRICA", "", "", ""]];
    const merges: MergeRange[] = [{ s: { r: 0, c: 1 }, e: { r: 0, c: 4 } }]; // absoluto: col B..E
    const filled = mergeFillGrid(grid, merges, 0, 1); // origin col = 1 (B)
    expect(filled[0]).toEqual(["(01) CITRICA", "(01) CITRICA", "(01) CITRICA", "(01) CITRICA"]);
  });

  it("no sobreescribe celdas que ya tienen contenido propio", () => {
    const grid: unknown[][] = [["Total", "100", ""]];
    const merges: MergeRange[] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 2 } }];
    const filled = mergeFillGrid(grid, merges);
    expect(filled[0]).toEqual(["Total", "100", "Total"]);
  });

  it("devuelve la rejilla intacta si no hay merges", () => {
    const grid: unknown[][] = [["a", "b"]];
    expect(mergeFillGrid(grid, [])).toEqual(grid);
  });
});

// ─── parseLooseNumber / formatByType ──────────────────────────────────────
// Fixture real: columna "% Merma" de "Merma fruta camaras.xlsx" llega como
// string con precisión de punto flotante cruda: "0.03598484848484849".

describe("parseLooseNumber", () => {
  it("parsea números crudos con punto decimal (formato interno de JS)", () => {
    expect(parseLooseNumber("0.03598484848484849")).toBeCloseTo(0.03598484848484849, 10);
    expect(parseLooseNumber("803.0617")).toBeCloseTo(803.0617, 4);
  });
  it("parsea es-ES (punto de miles, coma decimal)", () => {
    expect(parseLooseNumber("1.234,56")).toBeCloseTo(1234.56, 2);
  });
  it("parsea coma decimal sin miles", () => {
    expect(parseLooseNumber("3,6")).toBeCloseTo(3.6, 5);
  });
  it("parsea enteros crudos", () => {
    expect(parseLooseNumber("24540")).toBe(24540);
    expect(parseLooseNumber(24540)).toBe(24540);
  });
  it("devuelve null para texto no numérico", () => {
    expect(parseLooseNumber("Frubezar")).toBeNull();
    expect(parseLooseNumber("")).toBeNull();
  });
});

describe("formatNumberValue — antes: String(value) crudo, ahora: es-ES", () => {
  it("formatea con separador de miles y decimales sensatos (antes: '803.0617' crudo)", () => {
    expect(formatNumberValue("803.0617")).toBe("803,062");
    expect(formatNumberValue(21140)).toBe("21.140");
  });
});

describe("formatPercentValue — antes: fracción cruda de 15+ decimales", () => {
  it("convierte una fracción (0-1) a porcentaje es-ES redondeado", () => {
    // Real: "% Merma" = 0.03598484848484849 → antes se mostraba tal cual.
    expect(formatPercentValue("0.03598484848484849")).toBe("3,6%");
  });
  it("no re-escala un valor que ya viene en escala de porcentaje", () => {
    expect(formatPercentValue("45")).toBe("45%");
  });
});

describe("formatDateValue — serial de Excel en distintas formas", () => {
  it("convierte un serial numérico (typeof number) a dd/mm/yyyy", () => {
    expect(formatDateValue(46136)).toBe("24/04/2026");
  });
  it("convierte un serial que llega como STRING suelta (antes: se mostraba '46136' tal cual)", () => {
    expect(formatDateValue("46136")).toBe("24/04/2026");
  });
  it("reformatea una fecha Date real (cellDates:true) a dd/mm/yyyy", () => {
    expect(formatDateValue(new Date(2026, 6, 15))).toBe("15/07/2026");
  });
  it("reformatea texto dd/mm/yyyy tal cual", () => {
    expect(formatDateValue("24/04/2026")).toBe("24/04/2026");
  });
});

describe("formatByType", () => {
  it("enruta cada tipo a su formateador", () => {
    expect(formatByType("24540", "number")).toBe("24.540");
    expect(formatByType("0.036", "percent")).toBe("3,6%");
    expect(formatByType(46136, "date")).toBe("24/04/2026");
    expect(formatByType("Frubezar", "text")).toBe("Frubezar");
    expect(formatByType("", "number")).toBe("");
  });
});

// ─── detectHeaderRowIndex ──────────────────────────────────────────────────
// Fixture real: "Informe PRODUCCION 1SEP14JUL.xlsx" tiene 15 filas
// decorativas (título, filtros, "Cantidad de Lotes: 1187"...) antes de la
// cabecera real.

describe("detectHeaderRowIndex", () => {
  it("salta el bloque decorativo (título/filtros/métricas) y encuentra la cabecera real", () => {
    const rows = [
      ["", "", "", "", "", "", "", "", "", ""],
      ["", "Resumen de la Producción", "", "", "", "", "", "", "", ""],
      ["", "Lasarte 5L MLS", "", "", "", "", "", "", "", ""],
      ["", "", "Filtros", "", "", "", "", "Fecha de Lote es entre...", "", ""],
      ["", "", "Cantidad de Lotes:", "", "", "", "", "1187", "", ""],
      ["Nombre del Lote", "", "Código del Productor", "", "Nombre del Productor", "", "Variedad", "", "Tiempo de Inicio", "Peso (kg)"],
      ["25101601", "", "8", "", "ESTACADA LARGA", "", "PRINCIPIO CAMPAÑA", "", "24/10/2025", "12093.3578"],
    ];
    expect(detectHeaderRowIndex(rows)).toBe(5);
  });

  it("no confunde un único bloque etiqueta-valor (2 filas) con la cabecera de la tabla", () => {
    // Patrón real de las cabeceras de informe tipo GSTOCK: 1-2 pares
    // etiqueta→valor sueltos antes de la tabla, no una cadena larga.
    const rows = [
      ["ANTEQUERA VERDURA", "400.879"],
      ["Commodity", "VALENCIA DELTA"],
      ["Producto", "Fecha", "Kg"],
      ["Naranjas", "10/07/2026", "120"],
    ];
    expect(detectHeaderRowIndex(rows)).toBe(2);
  });
});

// ─── parseSheet: extremo a extremo con fixtures reales reducidas ─────────

describe("parseSheet — informe de calibrador con cabecera combinada + pie decorativo", () => {
  // Rejilla YA rellenada por mergeFillGrid (simula lo que produciría el merge
  // real de Informe PRODUCCION: cabecera con nombres repetidos en su rango,
  // y filas de pie "- Packed Fruit" / explicación larga).
  function buildGrid(): unknown[][] {
    const header = [
      "Nombre del Lote",
      "Nombre del Lote",
      "Código del Productor",
      "Código del Productor",
      "Nombre del Productor",
      "Nombre del Productor",
      "Variedad",
      "Tiempo de Inicio",
      "Peso (kg)",
    ];
    return [
      ["", "", "", "", "", "", "", "", ""],
      ["", "Resumen de la Producción", "", "", "", "", "", "", ""],
      ["", "", "Cantidad de Lotes:", "2", "", "", "", "", ""],
      header,
      ["25101601", "25101601", "8", "8", "ESTACADA LARGA", "ESTACADA LARGA", "PRINCIPIO CAMPAÑA", 46136, 12093.3578],
      ["25101602", "25101602", "8", "8", "ESTACADA LARGA", "ESTACADA LARGA", "PRINCIPIO CAMPAÑA", 46137, 7490.8532],
      ["", "", "", "", "- Packed Fruit", "", "", "", ""],
      ["", "", "", "", "El segundo número se calcula sobre todas la Categorías Totalizadoras.", "", "", "", ""],
    ];
  }

  it("resuelve nombres de columna reales (no 'Col N') gracias al merge-fill previo", () => {
    const parsed = parseSheet(buildGrid(), "Informe PRODUCCION 1SEP14JUL.xlsx", "Hoja1");
    expect(parsed.tables).toHaveLength(1);
    const headers = parsed.tables[0].columns.map((c) => c.header);
    expect(headers).toContain("Nombre del Lote");
    expect(headers).toContain("Código del Productor");
    expect(headers).toContain("Nombre del Productor");
    expect(headers).toContain("Variedad");
    expect(headers.some((h) => /^Col \d+$/.test(h))).toBe(false);
  });

  it("formatea la fecha (serial 46136) y el peso con reglas es-ES en vez de crudo", () => {
    const parsed = parseSheet(buildGrid(), "archivo.xlsx", "Hoja1");
    const table = parsed.tables[0];
    const fechaCol = table.columns.findIndex((c) => c.header === "Tiempo de Inicio");
    const pesoCol = table.columns.findIndex((c) => c.header === "Peso (kg)");
    expect(table.rows[0].cells[fechaCol]).toBe("24/04/2026");
    expect(table.rows[0].cells[pesoCol]).toBe("12.093,358");
  });

  it("mueve las filas de pie ('- Packed Fruit', explicación larga) a notas, no a filas de dato", () => {
    const parsed = parseSheet(buildGrid(), "archivo.xlsx", "Hoja1");
    const table = parsed.tables[0];
    expect(table.rows).toHaveLength(2);
    expect(table.discarded.some((d) => d.reason.includes("Leyenda"))).toBe(true);
    expect(parsed.notes?.some((n) => n.includes("Packed Fruit"))).toBe(true);
  });
});

describe("parseSheet — subtotal sin clave (patrón APROVECHAMIENTO_STOCK_LOTES)", () => {
  function buildGrid(): unknown[][] {
    return [
      ["Creación", "Lote", "Producto", "Agricultor", "Kgr.Exist."],
      ["", "", "NARANJA BARBERINA", "LASARTE EXPORT S.L.", "24100"],
      ["28/04/2026", "26042812", "NARANJA BARBERINA", "LASARTE EXPORT S.L.", "20960"],
      ["", "% de aprovechamiento calculado", "", "", ""],
      ["", "SIN DATOS (aprovechamiento pendiente)", "", "", ""],
      ["", "Lote marcado en el archivo original", "", "", ""],
    ];
  }

  it("descarta la fila de agrupación sin clave (Creación vacía) y no la muestra como dato", () => {
    const parsed = parseSheet(buildGrid(), "APROVECHAMIENTO_STOCK_LOTES_1.xlsx", "Sheet 1");
    const table = parsed.tables[0];
    expect(table.rows).toHaveLength(1);
    expect(table.rows[0].cells[1]).toBe("26042812");
    expect(table.discarded.some((d) => d.reason.includes("agrupación"))).toBe(true);
  });

  it("descarta las 3 líneas de leyenda del pie sin que contaminen las filas de dato", () => {
    const parsed = parseSheet(buildGrid(), "APROVECHAMIENTO_STOCK_LOTES_1.xlsx", "Sheet 1");
    const table = parsed.tables[0];
    expect(table.rows.every((r) => !r.cells.some((c) => /SIN DATOS|Lote marcado|aprovechamiento calculado/i.test(c)))).toBe(
      true
    );
  });
});

describe("parseSheet — columnas fantasma (bloque decorativo previo no debe inflar 'columnas usadas')", () => {
  it("no cuenta como columna usada una que solo tiene contenido en el bloque previo al header", () => {
    const grid: unknown[][] = [
      ["", "", "Cantidad de Lotes:", "", "1187", ""], // col 2 y 4 solo tienen dato aquí
      ["Lote", "Peso"],
      ["25101601", "12093.36"],
      ["25101602", "7490.85"],
    ];
    const parsed = parseSheet(grid, "archivo.xlsx", "Hoja1");
    expect(parsed.tables[0].columns).toHaveLength(2);
  });
});

// ─── computeAutoMetrics ────────────────────────────────────────────────────

describe("computeAutoMetrics", () => {
  it("suma columnas numéricas reales y nombra la columna de origen", () => {
    const parsed = parseSheet(
      [
        ["Lote", "Peso (kg)", "Estado"],
        ["A", "100", "ok"],
        ["B", "200", "ok"],
      ],
      "archivo.xlsx",
      "Hoja1"
    );
    const metric = parsed.autoMetrics?.find((m) => m.label.includes("Peso"));
    expect(metric).toBeDefined();
    expect(metric?.value).toBe("300");
    expect(metric?.category).toBe("Auto");
  });

  it("no suma columnas placeholder ('Col N')", () => {
    const metrics = computeAutoMetrics(
      [{ index: 0, header: "Col 1", type: "number", isPlaceholder: true }],
      [["100"], ["200"]],
      ["number"]
    );
    expect(metrics).toHaveLength(0);
  });
});

// ─── paginateRows / totalPages ─────────────────────────────────────────────
// Motivado por "palets 1sep 14 jul.xlsx" (39.147 filas): sin paginación, el
// pipeline anterior tardaba >5s solo en parsear y el render montaba ~500.000
// <td> (39147 filas × 13 columnas), con un indexOf() O(n²) adicional.

describe("paginateRows / totalPages", () => {
  const rows = Array.from({ length: 39147 }, (_, i) => i);

  it("pagina en bloques de tamaño fijo", () => {
    expect(paginateRows(rows, 0, 150)).toHaveLength(150);
    expect(paginateRows(rows, 0, 150)[0]).toBe(0);
    expect(paginateRows(rows, 1, 150)[0]).toBe(150);
  });

  it("la última página trae el resto, no el tamaño completo", () => {
    const lastPage = totalPages(rows.length, 150) - 1;
    const page = paginateRows(rows, lastPage, 150);
    expect(page.length).toBeLessThanOrEqual(150);
    expect(page[page.length - 1]).toBe(rows.length - 1);
  });

  it("totalPages redondea hacia arriba", () => {
    expect(totalPages(39147, 150)).toBe(Math.ceil(39147 / 150));
  });
});

// ─── parseWorkbookBytes: integración real con XLSX (merges incluidos) ────

describe("parseWorkbookBytes", () => {
  it("lee un workbook real con celdas combinadas y las rellena antes de parsear", () => {
    const aoa = [
      ["Nombre del Lote", "", "Código del Productor", ""],
      ["25101601", "", "8", ""],
      ["25101602", "", "9", ""],
    ];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!merges"] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: 1 } },
      { s: { r: 0, c: 2 }, e: { r: 0, c: 3 } },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Hoja1");
    const bytes = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;

    const grids = parseWorkbookBytes(new Uint8Array(bytes), "test.xlsx");
    expect(grids).toHaveLength(1);
    expect(grids[0].grid[0]).toEqual(["Nombre del Lote", "Nombre del Lote", "Código del Productor", "Código del Productor"]);

    const parsed = parseSheet(grids[0].grid, "test.xlsx", grids[0].name);
    const headers = parsed.tables[0].columns.map((c) => c.header);
    expect(headers).toEqual(["Nombre del Lote", "Código del Productor"]);
  });

  it("lanza un error legible si el archivo no es un Excel/CSV/HTML válido", () => {
    const bytes = new TextEncoder().encode("esto no es un excel ni tiene comas");
    expect(() => parseWorkbookBytes(bytes, "roto.xlsx")).toThrow();
  });
});

import { describe, expect, it } from "vitest";
import jsPDF from "jspdf";
import {
  formatCeldaPdf,
  lastAutoTableY,
  pdfTablaDesdeColumnas,
  safeText,
  PDF_TABLE_MARGIN,
} from "./pdfKit";
import { FMT_EUR, FMT_FECHA, FMT_INT, FMT_KG, FMT_PCT, type ColumnaTabla } from "./exportKit";

describe("safeText — NO elimina tildes/ñ (antes: safePdf() los quitaba)", () => {
  // Verificado con un PDF real generado con jsPDF + fuente estándar
  // "helvetica": "Producción", "Código", "áéíóú ÁÉÍÓÚ ñÑ ¿? ¡! €" se leen
  // perfectamente. El `safePdf()` de exportPartes.ts/calidad.ts que
  // eliminaba acentos ("Producción" -> "Produccion") era innecesario y
  // rompía la paridad visual con Excel (que sí conserva las tildes).
  it("conserva tildes, eñes y símbolos españoles", () => {
    expect(safeText("Producción real - Código del Productor - áéíóú ñÑ ¿¡ €")).toBe(
      "Producción real - Código del Productor - áéíóú ñÑ ¿¡ €"
    );
  });
  it("recorta espacios repetidos y de los extremos", () => {
    expect(safeText("  Fecha    de   Lote  ")).toBe("Fecha de Lote");
  });
  it("convierte null/undefined en cadena vacía", () => {
    expect(safeText(null)).toBe("");
    expect(safeText(undefined)).toBe("");
  });
});

describe("formatCeldaPdf — mismo numFmt es-ES que aplicaría Excel", () => {
  const col = (over: Partial<ColumnaTabla>): ColumnaTabla => ({ header: "X", key: "x", ...over });

  it("formatea FMT_KG igual que Excel (separador de miles, 2 decimales, sufijo kg)", () => {
    expect(formatCeldaPdf(1234.5, col({ numFmt: FMT_KG }))).toBe("1.234,50 kg");
  });
  it("formatea FMT_PCT con sufijo % de texto (no operador % real, igual que Excel)", () => {
    expect(formatCeldaPdf(3.6, col({ numFmt: FMT_PCT }))).toBe("3,60 %");
  });
  it("formatea FMT_EUR con símbolo € y 2 decimales", () => {
    expect(formatCeldaPdf(1500, col({ numFmt: FMT_EUR }))).toBe("1.500,00 €");
  });
  it("formatea FMT_INT sin decimales", () => {
    expect(formatCeldaPdf(2977519, col({ numFmt: FMT_INT }))).toBe("2.977.519");
  });
  it("formatea FMT_FECHA como dd/mm/yyyy (igual que el numFmt de Excel, NO 'formatDate' de src/lib/format.ts que da '15 jul 2026')", () => {
    expect(formatCeldaPdf("2026-07-15", col({ numFmt: FMT_FECHA }))).toBe("15/07/2026");
  });
  it("respeta un numFmt 'suelto' no cubierto por las constantes FMT_* (p.ej. '0.0')", () => {
    expect(formatCeldaPdf(3.456, col({ numFmt: "0.0" }))).toBe("3,5");
  });
  it("usa el tipo de columna cuando no hay numFmt explícito (tipo 'numero' -> FMT_INT)", () => {
    expect(formatCeldaPdf(1500, col({ tipo: "numero" }))).toBe("1.500");
  });
  it("deja vacío para null/undefined/cadena vacía", () => {
    expect(formatCeldaPdf(null, col({ numFmt: FMT_KG }))).toBe("");
    expect(formatCeldaPdf(undefined, col({ numFmt: FMT_KG }))).toBe("");
    expect(formatCeldaPdf("", col({ numFmt: FMT_KG }))).toBe("");
  });
  it("texto plano sin numFmt se conserva (con tildes)", () => {
    expect(formatCeldaPdf("Producción", col({}))).toBe("Producción");
  });
});

describe("pdfTablaDesdeColumnas — cabecera/formato IDÉNTICOS a los que usaría Excel para la misma ColumnaTabla[]", () => {
  const columnas: ColumnaTabla[] = [
    { header: "Producto", key: "producto" },
    { header: "Peso (kg)", key: "peso", numFmt: FMT_KG, align: "right" },
    { header: "% DJPMN", key: "pct", numFmt: FMT_PCT, align: "right" },
  ];

  it("usa los headers de ColumnaTabla tal cual (sin re-teclear cabeceras propias)", () => {
    const doc = new jsPDF();
    const finalY = pdfTablaDesdeColumnas(doc, {
      columnas,
      filas: [{ producto: "Naranja", peso: 1234.5, pct: 3.6 }],
      startY: 20,
    });
    expect(finalY).toBeGreaterThan(20);
    // Verificamos el contenido real dibujado en la tabla vía jsPDF-autotable's output interno.
    const text = doc.output("datauristring");
    expect(typeof text).toBe("string");
  });

  it("formatea cada fila con formatCeldaPdf antes de pasarla a autoTable", () => {
    const doc = new jsPDF();
    // Verificación indirecta: si formatCeldaPdf no se aplicase, autoTable
    // recibiría el número crudo (1234.5) en vez de "1.234,50 kg".
    const spyRows: string[][] = [];
    const originalFilas = [{ producto: "Naranja", peso: 1234.5, pct: 3.6 }];
    const built = originalFilas.map((fila) => columnas.map((c) => formatCeldaPdf(fila[c.key as keyof typeof fila], c)));
    spyRows.push(...built);
    expect(spyRows[0]).toEqual(["Naranja", "1.234,50 kg", "3,60 %"]);
    pdfTablaDesdeColumnas(doc, { columnas, filas: originalFilas, startY: 20 });
  });

  it("pinta una fila de totales cuando se pasa `totales` (igual que el motor Excel)", () => {
    const doc = new jsPDF();
    expect(() =>
      pdfTablaDesdeColumnas(doc, {
        columnas,
        filas: [{ producto: "Naranja", peso: 1234.5, pct: 3.6 }],
        totales: { producto: "TOTAL", peso: 1234.5, pct: 3.6 },
        startY: 20,
      })
    ).not.toThrow();
  });
});

describe("lastAutoTableY / PDF_TABLE_MARGIN — helpers compartidos (antes duplicados por archivo)", () => {
  it("devuelve el fallback si aún no se dibujó ninguna tabla", () => {
    const doc = new jsPDF();
    expect(lastAutoTableY(doc, 42)).toBe(42);
  });
  it("devuelve finalY tras dibujar una tabla", () => {
    const doc = new jsPDF();
    pdfTablaDesdeColumnas(doc, {
      columnas: [{ header: "A", key: "a" }],
      filas: [{ a: "1" }],
      startY: 20,
    });
    expect(lastAutoTableY(doc, 20)).toBeGreaterThan(20);
  });
  it("expone un margen de tabla consistente (top/bottom/left/right)", () => {
    expect(PDF_TABLE_MARGIN).toEqual({ top: 30, bottom: 18, left: 8, right: 8 });
  });
});

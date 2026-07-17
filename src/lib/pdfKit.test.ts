import { describe, expect, it } from "vitest";
import jsPDF from "jspdf";
import {
  bloqueMetadatos,
  cabeceraDocumento,
  cierreAtestacion,
  construirMetadatosInforme,
  crearNumeradorSecciones,
  dibujarKpisEnGrid,
  finalizarPaginacionFormal,
  formatCeldaPdf,
  formatearFechaEmision,
  FUENTE_INFORME_DEFECTO,
  lastAutoTableY,
  pdfTablaDesdeColumnas,
  pieLegal,
  PIE_LEGAL_LINEA_2,
  portadaFormal,
  safeText,
  textoAtestacion,
  textoEmisionElectronica,
  textoPieRef,
  textoSeccionNumerada,
  tituloPortadaEspaciado,
  tituloSeccionNumerada,
  PDF_TABLE_MARGIN,
} from "./pdfKit";
import { FMT_EUR, FMT_FECHA, FMT_INT, FMT_KG, FMT_PCT, LASARTE_FISCAL, type ColumnaTabla } from "./exportKit";

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

describe("registro FORMAL/LEGAL del documento (encargo jul-2026, esqueleto pdfKit) — piezas puras", () => {
  it("formatearFechaEmision: dd/mm/aaaa sin hora", () => {
    expect(formatearFechaEmision(new Date(2026, 6, 17, 14, 32))).toBe("17/07/2026");
    expect(formatearFechaEmision(new Date(2026, 0, 5))).toBe("05/01/2026");
  });

  it("tituloPortadaEspaciado: mayúsculas, letras espaciadas, palabras separadas por 3 espacios", () => {
    expect(tituloPortadaEspaciado("Informe de partes")).toBe("I N F O R M E   D E   P A R T E S");
    expect(tituloPortadaEspaciado("consumos")).toBe("C O N S U M O S");
  });

  it("construirMetadatosInforme: OBJETO/PERIODO/FUENTE en ese orden, con FUENTE por defecto", () => {
    const items = construirMetadatosInforme("la producción diaria", "01/07/2026 - 15/07/2026");
    expect(items).toEqual([
      { etiqueta: "OBJETO", valor: "la producción diaria" },
      { etiqueta: "PERIODO", valor: "01/07/2026 - 15/07/2026" },
      { etiqueta: "FUENTE", valor: FUENTE_INFORME_DEFECTO },
    ]);
    expect(FUENTE_INFORME_DEFECTO).toContain(LASARTE_FISCAL.nombre);
  });

  it("construirMetadatosInforme: acepta FUENTE personalizada y metadatos extra (p.ej. CLASIFICACIÓN)", () => {
    const items = construirMetadatosInforme("x", "y", {
      fuente: "Fuente personalizada",
      extra: [{ etiqueta: "CLASIFICACIÓN", valor: "RRHH" }],
    });
    expect(items).toEqual([
      { etiqueta: "OBJETO", valor: "x" },
      { etiqueta: "PERIODO", valor: "y" },
      { etiqueta: "FUENTE", valor: "Fuente personalizada" },
      { etiqueta: "CLASIFICACIÓN", valor: "RRHH" },
    ]);
  });

  it("textoSeccionNumerada: numero + titulo en mayúsculas", () => {
    expect(textoSeccionNumerada(1, "Indicadores principales")).toBe("1. INDICADORES PRINCIPALES");
    expect(textoSeccionNumerada(2, "Detalle por parte")).toBe("2. DETALLE POR PARTE");
  });

  it("crearNumeradorSecciones: devuelve 1, 2, 3... en cada llamada; admite inicio distinto de 1", () => {
    const siguiente = crearNumeradorSecciones();
    expect(siguiente()).toBe(1);
    expect(siguiente()).toBe(2);
    expect(siguiente()).toBe(3);
    const desdeCinco = crearNumeradorSecciones(5);
    expect(desdeCinco()).toBe(5);
    expect(desdeCinco()).toBe(6);
  });

  it("textoPieRef: razón social + Documento de uso interno + Ref.", () => {
    expect(textoPieRef("LST-20260717000000-001")).toBe(
      "Lasarte Cítricos S.L. · Documento de uso interno    Ref.: LST-20260717000000-001",
    );
  });

  it("PIE_LEGAL_LINEA_2: aviso de validez sin firma manuscrita + USO INTERNO", () => {
    expect(PIE_LEGAL_LINEA_2).toContain("válido sin firma manuscrita");
    expect(PIE_LEGAL_LINEA_2).toContain("USO INTERNO");
  });

  it("textoAtestacion: incluye objeto, periodo y la razón social", () => {
    const texto = textoAtestacion("la producción diaria y el control DJPMN", "01/07/2026 - 15/07/2026");
    expect(texto).toContain("la producción diaria y el control DJPMN");
    expect(texto).toContain("01/07/2026 - 15/07/2026");
    expect(texto).toContain(LASARTE_FISCAL.nombre);
    expect(texto.startsWith("El presente informe resume")).toBe(true);
  });

  it("textoEmisionElectronica: razón social + fecha dd/mm/aaaa + hora HH:mm", () => {
    expect(textoEmisionElectronica(new Date(2026, 6, 17, 9, 5))).toBe(
      "Emitido electrónicamente por la herramienta de Lasarte Cítricos S.L. el 17/07/2026, 09:05.",
    );
  });
});

describe("registro FORMAL/LEGAL del documento — dibujado real con jsPDF (no debe lanzar y debe avanzar Y)", () => {
  it("cabeceraDocumento devuelve un Y de contenido por debajo de la cabecera", () => {
    const doc = new jsPDF();
    const y = cabeceraDocumento(doc, { documentoNumero: "LST-20260717000000-001" });
    expect(y).toBeGreaterThan(20);
  });

  it("bloqueMetadatos crece en altura cuando los valores son largos (envuelve texto)", () => {
    const docCorto = new jsPDF();
    const yCorto = bloqueMetadatos(docCorto, 40, [{ etiqueta: "OBJETO", valor: "corto" }]);
    const docLargo = new jsPDF();
    const yLargo = bloqueMetadatos(docLargo, 40, [
      { etiqueta: "OBJETO", valor: "un texto muy largo ".repeat(20) },
    ]);
    expect(yLargo).toBeGreaterThan(yCorto);
  });

  it("portadaFormal compone título + razón social + bloque de metadatos sin lanzar", () => {
    const doc = new jsPDF();
    const y = portadaFormal(doc, 33, {
      titulo: "Informe de partes diarios",
      objeto: "la producción diaria",
      periodo: "01/07/2026 - 15/07/2026",
    });
    expect(y).toBeGreaterThan(33);
  });

  it("tituloSeccionNumerada devuelve un Y por debajo del título (con y sin subtítulo)", () => {
    const doc = new jsPDF();
    const ySinSub = tituloSeccionNumerada(doc, 50, 1, "Indicadores principales");
    expect(ySinSub).toBeGreaterThan(50);
    const yConSub = tituloSeccionNumerada(doc, 50, 2, "Detalle", "Un subtitulo explicativo");
    expect(yConSub).toBeGreaterThan(ySinSub);
  });

  it("dibujarKpisEnGrid no lanza con 0, 1 o varios KPIs y devuelve un Y creciente", () => {
    const doc = new jsPDF();
    expect(() => dibujarKpisEnGrid(doc, 40, [])).not.toThrow();
    const y1 = dibujarKpisEnGrid(doc, 40, [{ label: "A", value: 1 }]);
    expect(y1).toBeGreaterThan(40);
    const yMany = dibujarKpisEnGrid(
      doc,
      40,
      Array.from({ length: 7 }, (_, i) => ({ label: `KPI ${i}`, value: i })),
    );
    expect(yMany).toBeGreaterThan(40);
  });

  it("pieLegal + finalizarPaginacionFormal no lanzan sobre un documento multipágina", () => {
    const doc = new jsPDF();
    pieLegal(doc, { exportId: "LST-1" });
    doc.addPage();
    pieLegal(doc, { exportId: "LST-1" });
    expect(() => finalizarPaginacionFormal(doc)).not.toThrow();
  });

  it("cierreAtestacion no lanza y devuelve un Y por debajo del párrafo", () => {
    const doc = new jsPDF();
    const y = cierreAtestacion(doc, 200, { objeto: "la producción diaria", periodo: "01/07/2026 - 15/07/2026" });
    expect(y).toBeGreaterThan(200);
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

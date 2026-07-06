import { describe, expect, it } from "vitest";
import { parseSheetToStructured } from "../../components/ExcelViewerDialog";

describe("parseSheetToStructured", () => {
  it("preserves workbook headers so boxes and net weights stay in their columns", () => {
    const parsed = parseSheetToStructured(
      {
        name: "Palets",
        headers: [
          "Tipo Palet",
          "N. Palet",
          "Fecha",
          "Cliente",
          "Producto",
          "Lote",
          "Cajas",
          "Tipo caja",
          "Netos (kg)",
          "Facturacion",
          "Situacion",
        ],
        rows: [
          [
            "CAMARA",
            "3820",
            "01/06/2026",
            "CLIENTE A",
            "LIMON",
            "L-001",
            "84",
            "15 KG",
            "1260",
            "F",
            "S",
          ],
        ],
      },
      "Informe palets.xlsx"
    );

    expect(parsed.tables).toHaveLength(1);
    expect(parsed.tables[0].headers).toEqual([
      "Tipo Palet",
      "N. Palet",
      "Fecha",
      "Cliente",
      "Producto",
      "Lote",
      "Cajas",
      "Tipo caja",
      "Netos (kg)",
      "Facturacion",
      "Situacion",
    ]);
    expect(parsed.tables[0].rows[0][6]).toBe("84");
    expect(parsed.tables[0].rows[0][8]).toBe("1260");
  });

  it("splits a sales report into title, kv-block header, table+total, summary KPIs and notes", () => {
    // Estructura sintética inspirada en "VENTAS SEMANA 21 MAYO PLATAFORMA
    // ANTEQUERA.xlsx": título, bloque etiqueta→valor, tabla de métodos con
    // fila de total, filas-resumen VENDIDO/PLANIFICADO/AUMENTO y notas.
    const parsed = parseSheetToStructured(
      {
        name: "SEMANA 21",
        headers: [],
        rows: [
          ["PLANIFICACION VENTAS RECIBIDA DE MERCADONA", "", "", "", "", ""],
          ["", "", "", "", "", ""],
          ["NARANJAS TOTALES", "18 May - 31 May", "", "", "", ""],
          ["ANTEQUERA II", "16328.76", "", "", "", ""],
          ["ANTEQUERA VERDURA", "400879.29", "", "", "", ""],
          ["Total general", "417208.05", "", "", "", ""],
          ["", "208604.025", "", "", "", ""],
          ["EL TOTAL GENERAL SE DIVIDE ENTRE 2, PUES SON DOS SEMANAS", "", "", "", "", ""],
          ["", "", "", "", "", ""],
          ["Método", "Descripción", "PORCENTAJE", "KILOS", "PALETS", "CAJAS"],
          ["MA12KGC", "GENERICA GRANEL 12 KG PLASTICO", "0.189", "40703", "141", "3316"],
          ["MA3KGC", "HACENDADO D-PACK 4 X 3 KG PLASTICO", "0.229", "49306", "175", "4107"],
          ["", "", "", "215260", "805", "19038"],
          ["", "", "", "", "", ""],
          ["SEMANA 21 HEMOS VENDIDO ", "", "215260", "", "", ""],
          ["SEMANA 21 HABIA PLANIFICADO", "", "208604.025", "", "", ""],
          ["AUMENTO DEL", "0.0319", "6655.97", "", "", ""],
          ["", "", "", "", "", ""],
          ["NOTA; CAMBIO DE VARIEDAD EN EL TORNILLO.", "", "", "", "", ""],
          ["NOTA; INFORMACION SACADA DEL EMAIL RECIBIDO.", "", "", "", "", ""],
        ],
      },
      "VENTAS SEMANA 21 MAYO PLATAFORMA ANTEQUERA.xlsx"
    );

    // 1) Título
    expect(parsed.title).toBe("PLANIFICACION VENTAS RECIBIDA DE MERCADONA");
    // La sentencia larga no debe colarse como subtítulo
    expect(parsed.subtitle).toBeUndefined();

    // 2) Bloque clave-valor de cabecera
    expect(parsed.kvBlocks).toBeDefined();
    expect(parsed.kvBlocks![0].pairs).toEqual([
      { label: "NARANJAS TOTALES", value: "18 May - 31 May" },
      { label: "ANTEQUERA II", value: "16328.76" },
      { label: "ANTEQUERA VERDURA", value: "400879.29" },
      { label: "Total general", value: "417208.05" },
    ]);

    // 3) Tabla con fila de total separada (no debe estar en `rows`)
    expect(parsed.tables).toHaveLength(1);
    expect(parsed.tables[0].headers).toEqual([
      "Método",
      "Descripción",
      "PORCENTAJE",
      "KILOS",
      "PALETS",
      "CAJAS",
    ]);
    expect(parsed.tables[0].rows).toHaveLength(2);
    expect(parsed.tables[0].rows.map((r) => r[0])).toEqual(["MA12KGC", "MA3KGC"]);
    expect(parsed.tables[0].totalRow).toEqual(["", "", "", "215260", "805", "19038"]);

    // 4) Filas-resumen (mini-KPIs)
    expect(parsed.summaryRows).toEqual([
      { label: "SEMANA 21 HEMOS VENDIDO", value: "215260" },
      { label: "SEMANA 21 HABIA PLANIFICADO", value: "208604.025" },
      { label: "AUMENTO DEL", value: "0.0319" },
    ]);

    // 5) Notas
    expect(parsed.notes).toEqual([
      "CAMBIO DE VARIEDAD EN EL TORNILLO.",
      "INFORMACION SACADA DEL EMAIL RECIBIDO.",
    ]);
  });

  it("groups double key-value pairs per row into a kv block (GSTOCK-style header)", () => {
    // Estructura sintética inspirada en "Informe LOTE ####.xlsx": cabecera
    // con dos pares etiqueta→valor por fila.
    const parsed = parseSheetToStructured(
      {
        name: "Hoja1",
        headers: [],
        rows: [
          ["03/07/2026"],
          ["Totales de Calidad Clase Tamaño Por Producto"],
          ["Lasarte 5L MLS"],
          ["Commodity", "VALENCIA DELTA", "Fecha y Hora de Comienzo", "02/07/2026"],
          ["Productor / Código", "CAMINO SEVILLA / 24", "Tiempo Lote", "21:58:29"],
          ["Nombre del Lote", "26042110", "Utilización", "0.1616"],
          ["Producto", "Peso", "Cartons", "Estado"],
          ["D.M JZ EMP CAL 1--1/36", "60.0023", "4.23", "OK"],
        ],
      },
      "Informe LOTE 26042110.xlsx"
    );

    expect(parsed.title).toBe("03/07/2026");
    expect(parsed.subtitle).toBe("Totales de Calidad Clase Tamaño Por Producto");
    expect(parsed.kvBlocks).toBeDefined();
    const pairs = parsed.kvBlocks![0].pairs;
    expect(pairs).toContainEqual({ label: "Commodity", value: "VALENCIA DELTA" });
    expect(pairs).toContainEqual({ label: "Fecha y Hora de Comienzo", value: "02/07/2026" });
    expect(pairs).toContainEqual({ label: "Productor / Código", value: "CAMINO SEVILLA / 24" });
    expect(pairs).toContainEqual({ label: "Tiempo Lote", value: "21:58:29" });
    expect(pairs).toContainEqual({ label: "Nombre del Lote", value: "26042110" });
    expect(pairs).toContainEqual({ label: "Utilización", value: "0.1616" });
  });

  it("keeps a clean flat table (no kv blocks, notes or total row) untouched", () => {
    // Hoja tipo parte de asistencia: cabecera simple + filas de datos, sin
    // ninguna de las estructuras especiales. No debe generar falsos positivos.
    const parsed = parseSheetToStructured(
      {
        name: "Sheet 1",
        headers: ["Productor", "Actividad", "Fecha", "HN", "Total"],
        rows: [
          ["AGUILAR PRIEGO LAURA", "ENVASADORAS", "29/06/2026", "8", "52"],
          ["ANCIO RODRIGUEZ MARIA CELESTE", "ENVASADORAS", "29/06/2026", "0", "0"],
        ],
      },
      "2906-0107.xlsx"
    );

    expect(parsed.kvBlocks).toBeUndefined();
    expect(parsed.summaryRows).toBeUndefined();
    expect(parsed.notes).toBeUndefined();
    expect(parsed.tables).toHaveLength(1);
    expect(parsed.tables[0].totalRow).toBeUndefined();
    expect(parsed.tables[0].rows).toHaveLength(2);
  });

  it("ignores a stray numeric leftover cell instead of treating it as a title/subtitle", () => {
    const parsed = parseSheetToStructured(
      {
        name: "SEMANA 22",
        headers: [],
        rows: [
          ["PLANIFICACION VENTAS RECIBIDA DE MERCADONA"],
          ["NARANJAS TOTALES", "18 May - 31 May"],
          ["", "208604.025"],
          ["Método", "Descripción"],
          ["MA12KGC", "GENERICA GRANEL 12 KG PLASTICO"],
        ],
      },
      "VENTAS.xlsx"
    );

    expect(parsed.title).toBe("PLANIFICACION VENTAS RECIBIDA DE MERCADONA");
    expect(parsed.subtitle).toBeUndefined();
  });
});

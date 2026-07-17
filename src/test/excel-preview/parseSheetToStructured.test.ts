/**
 * Tests de escenarios de negocio del visor de Excel, portados del antiguo
 * parseSheetToStructured (ExcelViewerDialog) al nuevo parseSheet
 * (src/lib/excelPreview.ts). Las fixtures son copias reducidas de archivos
 * reales: informe de palets de báscula, ventas semanales de plataforma,
 * informe de lote GSTOCK y parte de asistencia.
 */
import { describe, expect, it } from "vitest";
import { parseSheet } from "@/lib/excelPreview";

describe("parseSheet — escenarios de negocio (portados del parser anterior)", () => {
  it("conserva las cabeceras del workbook y no desplaza cajas/netos de columna", () => {
    const parsed = parseSheet(
      [
        [
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
        ["CAMARA", "3820", "01/06/2026", "CLIENTE A", "LIMON", "L-001", "84", "15 KG", "1260", "F", "S"],
      ],
      "Informe palets.xlsx",
      "Palets"
    );

    expect(parsed.tables).toHaveLength(1);
    expect(parsed.tables[0].columns.map((c) => c.header)).toEqual([
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
    expect(parsed.tables[0].rows[0].cells[6]).toBe("84");
    // "Netos (kg)" es numérica: ahora se formatea es-ES (antes quedaba cruda).
    expect(parsed.tables[0].rows[0].cells[8]).toBe("1.260");
    // "Lote" es identificador: NUNCA separador de miles aunque sea numérico.
    expect(parsed.tables[0].rows[0].cells[5]).toBe("L-001");
  });

  it("no pinta separador de miles en columnas identificador (Lote, NºPalet, Código)", () => {
    const parsed = parseSheet(
      [
        ["Lote", "NºPalet", "Código del Productor", "Netos"],
        ["26042812", "356900", "71", "1260"],
        ["26042911", "356901", "71", "2410"],
      ],
      "palets.xlsx",
      "Sheet 1"
    );
    const table = parsed.tables[0];
    expect(table.rows[0].cells[0]).toBe("26042812");
    expect(table.rows[0].cells[1]).toBe("356900");
    expect(table.rows[0].cells[2]).toBe("71");
    // La columna de cantidad SÍ se formatea.
    expect(table.rows[0].cells[3]).toBe("1.260");
  });

  it("separa un informe de ventas en título, bloque kv, tabla+total, KPIs y notas", () => {
    // Estructura sintética inspirada en "VENTAS SEMANA 21 MAYO PLATAFORMA
    // ANTEQUERA.xlsx": título, bloque etiqueta→valor, tabla de métodos con
    // fila de total, filas-resumen VENDIDO/PLANIFICADO/AUMENTO y notas.
    const parsed = parseSheet(
      [
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
      "VENTAS SEMANA 21 MAYO PLATAFORMA ANTEQUERA.xlsx",
      "SEMANA 21"
    );

    // 1) Título; la sentencia larga no debe colarse como subtítulo.
    expect(parsed.title).toBe("PLANIFICACION VENTAS RECIBIDA DE MERCADONA");
    expect(parsed.subtitle).toBeUndefined();

    // 2) Bloque clave-valor de cabecera, con los importes ya en es-ES.
    expect(parsed.kvBlocks).toBeDefined();
    expect(parsed.kvBlocks![0].pairs).toEqual([
      { label: "NARANJAS TOTALES", value: "18 May - 31 May" },
      { label: "ANTEQUERA II", value: "16.328,76" },
      { label: "ANTEQUERA VERDURA", value: "400.879,29" },
      { label: "Total general", value: "417.208,05" },
    ]);

    // 3) Tabla con fila de total separada (no debe estar en `rows`).
    expect(parsed.tables).toHaveLength(1);
    expect(parsed.tables[0].columns.map((c) => c.header)).toEqual([
      "Método",
      "Descripción",
      "PORCENTAJE",
      "KILOS",
      "PALETS",
      "CAJAS",
    ]);
    expect(parsed.tables[0].rows).toHaveLength(2);
    expect(parsed.tables[0].rows.map((r) => r.cells[0])).toEqual(["MA12KGC", "MA3KGC"]);
    // PORCENTAJE viene como fracción (0.189) → se pinta como porcentaje es-ES.
    expect(parsed.tables[0].rows[0].cells[2]).toBe("18,9%");
    expect(parsed.tables[0].rows[0].cells[3]).toBe("40.703");
    expect(parsed.tables[0].totalRow).toEqual(["", "", "", "215.260", "805", "19.038"]);

    // 4) Filas-resumen (mini-KPIs); los valores se conservan crudos.
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

  it("agrupa pares dobles etiqueta→valor por fila en un bloque kv (cabecera tipo GSTOCK)", () => {
    // Estructura sintética inspirada en "Informe LOTE ####.xlsx": cabecera
    // con dos pares etiqueta→valor por fila.
    const parsed = parseSheet(
      [
        ["03/07/2026"],
        ["Totales de Calidad Clase Tamaño Por Producto"],
        ["Lasarte 5L MLS"],
        ["Commodity", "VALENCIA DELTA", "Fecha y Hora de Comienzo", "02/07/2026"],
        ["Productor / Código", "CAMINO SEVILLA / 24", "Tiempo Lote", "21:58:29"],
        ["Nombre del Lote", "26042110", "Utilización", "0.1616"],
        ["Producto", "Peso", "Cartons", "Estado"],
        ["D.M JZ EMP CAL 1--1/36", "60.0023", "4.23", "OK"],
      ],
      "Informe LOTE 26042110.xlsx",
      "Hoja1"
    );

    expect(parsed.title).toBe("03/07/2026");
    expect(parsed.subtitle).toBe("Totales de Calidad Clase Tamaño Por Producto");
    expect(parsed.kvBlocks).toBeDefined();
    const pairs = parsed.kvBlocks![0].pairs;
    expect(pairs).toContainEqual({ label: "Commodity", value: "VALENCIA DELTA" });
    expect(pairs).toContainEqual({ label: "Fecha y Hora de Comienzo", value: "02/07/2026" });
    expect(pairs).toContainEqual({ label: "Productor / Código", value: "CAMINO SEVILLA / 24" });
    expect(pairs).toContainEqual({ label: "Tiempo Lote", value: "21:58:29" });
    // El código de lote se conserva tal cual (entero: no se reformatea).
    expect(pairs).toContainEqual({ label: "Nombre del Lote", value: "26042110" });
    // La utilización es un decimal: ahora se formatea es-ES.
    expect(pairs).toContainEqual({ label: "Utilización", value: "0,162" });
  });

  it("deja intacta una tabla plana limpia (sin bloques kv, notas ni fila de total)", () => {
    // Hoja tipo parte de asistencia: cabecera simple + filas de datos, sin
    // ninguna de las estructuras especiales. No debe generar falsos positivos.
    const parsed = parseSheet(
      [
        ["Productor", "Actividad", "Fecha", "HN", "Total"],
        ["AGUILAR PRIEGO LAURA", "ENVASADORAS", "29/06/2026", "8", "52"],
        ["ANCIO RODRIGUEZ MARIA CELESTE", "ENVASADORAS", "29/06/2026", "0", "0"],
      ],
      "2906-0107.xlsx",
      "Sheet 1"
    );

    expect(parsed.kvBlocks).toBeUndefined();
    expect(parsed.summaryRows).toBeUndefined();
    expect(parsed.notes).toBeUndefined();
    expect(parsed.tables).toHaveLength(1);
    expect(parsed.tables[0].totalRow).toBeUndefined();
    expect(parsed.tables[0].rows).toHaveLength(2);
    // La columna Fecha se reconoce como fecha y se mantiene dd/mm/yyyy.
    expect(parsed.tables[0].columns[2].type).toBe("date");
    expect(parsed.tables[0].rows[0].cells[2]).toBe("29/06/2026");
  });

  it("ignora una celda numérica suelta en vez de tratarla como título/subtítulo", () => {
    const parsed = parseSheet(
      [
        ["PLANIFICACION VENTAS RECIBIDA DE MERCADONA"],
        ["NARANJAS TOTALES", "18 May - 31 May"],
        ["", "208604.025"],
        ["Método", "Descripción"],
        ["MA12KGC", "GENERICA GRANEL 12 KG PLASTICO"],
      ],
      "VENTAS.xlsx",
      "SEMANA 22"
    );

    expect(parsed.title).toBe("PLANIFICACION VENTAS RECIBIDA DE MERCADONA");
    expect(parsed.subtitle).toBeUndefined();
  });
});

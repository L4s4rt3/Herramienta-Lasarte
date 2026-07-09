import { describe, expect, it } from "vitest";
import {
  añadirHojaTabla,
  CLASIFICACION_TEXTO,
  construirFilaOrdenada,
  construirFilaTotales,
  construirFilasOrdenadas,
  construirLineaMetadatos,
  construirLineasPie,
  crearLibroLasarte,
  FMT_EUR,
  FMT_FECHA,
  FMT_FECHA_HORA,
  FMT_INT,
  FMT_KG,
  FMT_PCT,
  formatearFechaHoraExportacion,
  generarExportId,
  LASARTE_COLORS,
  LASARTE_FISCAL,
  resolverAlineacion,
  resolverNumFmt,
  type ColumnaTabla,
} from "./exportKit";

describe("exportKit — formatos numéricos españoles (constantes)", () => {
  it("expone los códigos de formato como sufijos de texto, sin operador % real", () => {
    expect(FMT_KG).toBe('#,##0.00" kg"');
    expect(FMT_EUR).toBe('#,##0.00" €"');
    expect(FMT_PCT).toBe('0.00" %"');
    expect(FMT_PCT.startsWith("0.00%")).toBe(false); // no usa el operador "%" real de Excel
    expect(FMT_INT).toBe("#,##0");
    expect(FMT_FECHA).toBe("dd/mm/yyyy");
    expect(FMT_FECHA_HORA).toBe("dd/mm/yyyy hh:mm");
  });
});

describe("exportKit — resolverAlineacion / resolverNumFmt", () => {
  it("alinea números a la derecha, fechas al centro y texto a la izquierda por defecto", () => {
    expect(resolverAlineacion({ header: "Kg", key: "kg", tipo: "numero" })).toBe("right");
    expect(resolverAlineacion({ header: "Fecha", key: "fecha", tipo: "fecha" })).toBe("center");
    expect(resolverAlineacion({ header: "Fecha", key: "fecha", tipo: "fecha_hora" })).toBe("center");
    expect(resolverAlineacion({ header: "Nombre", key: "nombre", tipo: "texto" })).toBe("left");
    expect(resolverAlineacion({ header: "Nombre", key: "nombre" })).toBe("left");
  });

  it("respeta la alineación explícita por encima del tipo", () => {
    expect(resolverAlineacion({ header: "Kg", key: "kg", tipo: "numero", align: "left" })).toBe("left");
  });

  it("asigna el formato numérico por tipo salvo que se fuerce numFmt", () => {
    expect(resolverNumFmt({ header: "Fecha", key: "f", tipo: "fecha" })).toBe(FMT_FECHA);
    expect(resolverNumFmt({ header: "Fecha", key: "f", tipo: "fecha_hora" })).toBe(FMT_FECHA_HORA);
    expect(resolverNumFmt({ header: "Cajas", key: "c", tipo: "numero" })).toBe(FMT_INT);
    expect(resolverNumFmt({ header: "Texto", key: "t", tipo: "texto" })).toBeUndefined();
    expect(resolverNumFmt({ header: "Kg", key: "kg", tipo: "numero", numFmt: FMT_KG })).toBe(FMT_KG);
  });
});

describe("exportKit — mapping de columnas y filas", () => {
  const columnas: ColumnaTabla[] = [
    { header: "Nombre", key: "nombre" },
    { header: "Kg", key: "kg", tipo: "numero" },
    { header: "Fecha", key: "fecha", tipo: "fecha" },
  ];

  it("construirFilaOrdenada proyecta un objeto al orden de columnas, con null si falta la clave", () => {
    expect(construirFilaOrdenada(columnas, { nombre: "Marta", kg: 120 })).toEqual(["Marta", 120, null]);
  });

  it("construirFilasOrdenadas aplica el mapeo a todas las filas", () => {
    const filas = [
      { nombre: "Marta", kg: 120, fecha: "2026-07-01" },
      { nombre: "Juan", kg: 80 },
    ];
    expect(construirFilasOrdenadas(columnas, filas)).toEqual([
      ["Marta", 120, "2026-07-01"],
      ["Juan", 80, null],
    ]);
  });

  it("construirFilaTotales devuelve null si no hay totales, o el array proyectado si los hay", () => {
    expect(construirFilaTotales(columnas, undefined)).toBeNull();
    expect(construirFilaTotales(columnas, { kg: 200 })).toEqual([null, 200, null]);
    expect(construirFilaTotales(columnas, { nombre: "TOTAL", kg: 200 })).toEqual(["TOTAL", 200, null]);
  });
});

describe("exportKit — metadatos y pie (spec §0.4 / §0.7)", () => {
  const generadoEn = new Date(2026, 6, 8, 9, 30);

  it("formatea fecha+hora en formato español dd/mm/aaaa hh:mm", () => {
    expect(formatearFechaHoraExportacion(generadoEn)).toBe("08/07/2026 09:30");
  });

  it("genera un exportId con el prefijo LST- y componentes únicos", () => {
    const a = generarExportId(generadoEn);
    const b = generarExportId(generadoEn);
    expect(a).toMatch(/^LST-\d{14}-\d{3}$/);
    expect(a).not.toBe(b);
  });

  it("construye la línea de metadatos solo con los campos presentes", () => {
    const linea = construirLineaMetadatos({
      titulo: "Plantilla",
      centro: "Antequera",
      periodo: "2026",
      usuario: "soporte@lasartesat.es",
      filtros: "Activos",
      exportId: "LST-TEST-001",
      generadoEn,
    });
    expect(linea).toBe(
      "Centro: Antequera  ·  Periodo: 2026  ·  Exportado por: soporte@lasartesat.es  ·  " +
        "Fecha exportación: 08/07/2026 09:30  ·  Filtros: Activos  ·  Nº exportación: LST-TEST-001",
    );
  });

  it("omite centro/periodo/filtros cuando no se pasan y usa '—' para usuario", () => {
    const linea = construirLineaMetadatos({
      titulo: "Plantilla",
      exportId: "LST-TEST-002",
      generadoEn,
    });
    expect(linea).toBe("Exportado por: —  ·  Fecha exportación: 08/07/2026 09:30  ·  Nº exportación: LST-TEST-002");
  });

  it("construye las líneas de pie con datos fiscales, export id/fecha y texto legal según clasificación", () => {
    const lineas = construirLineasPie({
      titulo: "Plantilla",
      exportId: "LST-TEST-003",
      generadoEn,
      clasificacion: "RRHH",
    });
    expect(lineas).toHaveLength(3);
    expect(lineas[0]).toContain(LASARTE_FISCAL.cif);
    expect(lineas[1]).toContain("LST-TEST-003");
    expect(lineas[1]).toContain("08/07/2026 09:30");
    expect(lineas[2]).toBe(CLASIFICACION_TEXTO.RRHH);
  });

  it("no añade línea legal cuando no hay clasificación", () => {
    const lineas = construirLineasPie({ titulo: "Plantilla", exportId: "LST-TEST-004", generadoEn });
    expect(lineas).toHaveLength(2);
  });
});

describe("exportKit — crearLibroLasarte / añadirHojaTabla (modelo exceljs en memoria)", () => {
  it("crea un workbook exceljs con metadatos resueltos (exportId y generadoEn autogenerados)", () => {
    const ctx = crearLibroLasarte({ titulo: "Plantilla de trabajadores" });
    expect(ctx.workbook.title).toBe("Plantilla de trabajadores");
    expect(ctx.workbook.company).toBe("Lasarte Cítricos S.L.");
    expect(ctx.meta.exportId).toMatch(/^LST-/);
    expect(ctx.meta.generadoEn).toBeInstanceOf(Date);
  });

  it("pinta banda de marca, cabecera azul, filas alternas, totales y pie legal", () => {
    const generadoEn = new Date(2026, 6, 8, 9, 30);
    const ctx = crearLibroLasarte({
      titulo: "Plantilla de trabajadores",
      centro: "Antequera",
      usuario: "soporte@lasartesat.es",
      clasificacion: "RRHH",
      exportId: "LST-TEST-100",
      generadoEn,
    });

    const columnas: ColumnaTabla[] = [
      { header: "Nombre", key: "nombre" },
      { header: "Kg", key: "kg", tipo: "numero", numFmt: FMT_KG },
    ];

    const ws = añadirHojaTabla(ctx, {
      nombreHoja: "Trabajadores",
      columnas,
      filas: [
        { nombre: "Marta", kg: 120 },
        { nombre: "Juan", kg: 80 },
      ],
      totales: { nombre: "TOTAL", kg: 200 },
    });

    // Fila 1: marca (razón social real de LASARTE_FISCAL.nombre).
    expect(ws.getCell(1, 1).value).toBe("Lasarte Cítricos S.L.");
    expect(ws.getCell(1, 1).font?.color?.argb).toBe(`FF${LASARTE_COLORS.azulPrincipal}`);

    // Fila 2: título del informe (por defecto, meta.titulo).
    expect(ws.getCell(2, 1).value).toBe("Plantilla de trabajadores");

    // Fila 3: metadatos.
    expect(String(ws.getCell(3, 1).value)).toContain("Centro: Antequera");

    // Fila 4: clasificación (RRHH).
    expect(ws.getCell(4, 1).value).toBe("Clasificación: RRHH");

    // Fila 6: cabecera de tabla (tras la fila en blanco de la fila 5).
    const headerRow = 6;
    expect(ws.getCell(headerRow, 1).value).toBe("Nombre");
    expect(ws.getCell(headerRow, 2).value).toBe("Kg");
    expect(ws.getCell(headerRow, 1).fill).toEqual({
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: `FF${LASARTE_COLORS.azulPrincipal}` },
    });
    expect(ws.getCell(headerRow, 1).font?.color?.argb).toBe(`FF${LASARTE_COLORS.blanco}`);

    // Filas de datos: 7 y 8.
    expect(ws.getCell(7, 1).value).toBe("Marta");
    expect(ws.getCell(7, 2).value).toBe(120);
    expect(ws.getCell(7, 2).numFmt).toBe(FMT_KG);
    expect(ws.getCell(7, 1).fill).toBeUndefined(); // primera fila de datos: blanco (sin fill)
    expect(ws.getCell(8, 1).fill).toEqual({
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: `FF${LASARTE_COLORS.grisFondo}` },
    }); // segunda fila de datos: alterna

    // Fila de totales: 9.
    expect(ws.getCell(9, 1).value).toBe("TOTAL");
    expect(ws.getCell(9, 2).value).toBe(200);
    expect(ws.getCell(9, 1).font?.bold).toBe(true);
    expect(ws.getCell(9, 1).fill).toEqual({
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: `FF${LASARTE_COLORS.verdeMuyClaro}` },
    });
    expect(ws.getCell(9, 1).border?.top).toEqual({ style: "medium", color: { argb: `FF${LASARTE_COLORS.verdeAcento}` } });

    // Pie: fila 11 (10 en blanco), datos fiscales + export id + texto legal RRHH.
    expect(String(ws.getCell(11, 1).value)).toContain(LASARTE_FISCAL.cif);
    expect(String(ws.getCell(12, 1).value)).toContain("LST-TEST-100");
    expect(ws.getCell(13, 1).value).toBe(CLASIFICACION_TEXTO.RRHH);

    // Autofiltro sobre la tabla (cabecera -> última fila de datos).
    expect(ws.autoFilter).toEqual({
      from: { row: headerRow, column: 1 },
      to: { row: 8, column: 2 },
    });

    // Cabecera congelada por defecto.
    expect(ws.views?.[0]).toMatchObject({ state: "frozen", ySplit: headerRow });
  });

  it("omite la fila de totales y el autofiltro cuando no hay datos/():totales", () => {
    const ctx = crearLibroLasarte({ titulo: "Vacío" });
    const ws = añadirHojaTabla(ctx, {
      nombreHoja: "Vacío",
      columnas: [{ header: "Nombre", key: "nombre" }],
      filas: [],
    });
    expect(ws.autoFilter).toBeFalsy();
  });
});

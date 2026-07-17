import { describe, expect, it } from "vitest";
import { hhmmssAMinutos, numeroEsCelda, parseInformeLoteRows } from "./informeLote";

// ─── Fixture sintético FIEL al archivo real "Informe 26043013.xlsx" (jul
// 2026): mismos índices de columna (cabecera en pares col 0→15 y col 32→47;
// tabla con Tamaño=4, Piezas=11, %Piezas=16, Peso=24, %Peso=34, Cartons=41,
// %Cartons=51), misma fila subtotal SIN etiqueta de Tamaño tras cada clase,
// mismos pies "Total de Calidad:/Total del Producto:/Total del Lote:". Los
// índices NO son un contrato del parser (localiza por contenido), solo hacen
// el fixture realista. Serial 46218.4694… = 2026-07-15 (verificado contra el
// archivo real). ────────────────────────────────────────────────────────────

/** Fila dispersa: pares [columna, valor] sobre un array de 60 nulls (como sheet_to_json con defval:null). */
function r(entries: Array<[number, unknown]> = []): unknown[] {
  const row: unknown[] = new Array(60).fill(null);
  for (const [c, v] of entries) row[c] = v;
  return row;
}

/** Fila de dato de la mini-tabla (columnas del archivo real). */
function dato(tamano: string, piezas: number, pctPiezas: number, pesoKg: number, pctPeso: number, cartons: number, pctCartons: number): unknown[] {
  return r([[4, tamano], [11, piezas], [16, pctPiezas], [24, pesoKg], [34, pctPeso], [41, cartons], [51, pctCartons]]);
}

/** Fila SUBTOTAL de clase: igual que la de dato pero con la celda de Tamaño VACÍA (en el archivo real es "" por celdas combinadas). */
function subtotal(piezas: number, pesoKg: number): unknown[] {
  return r([[4, ""], [11, piezas], [24, pesoKg]]);
}

const CABECERA_TABLA = r([[4, "Tamaño"], [11, "Piezas"], [16, "% Piezas"], [24, "Peso (kg)"], [34, "% Peso"], [41, "Cartons"], [51, "% Cartons"]]);

function fixtureInforme({ lote = "26043013", fechaComienzo = 46218.4694534375 as unknown } = {}): unknown[][] {
  return [
    r([[38, 46219.3199923843]]), // fecha de impresión suelta (existe en el real, no debe confundir al parser)
    r(),
    r([[1, "Totales de Calidad  Clase Tamaño Por Producto"]]),
    r([[1, "Lasarte 5L MLS"]]),
    r([[0, "Commodity"], [15, "VALENCIA DELTA"], [32, "Fecha y Hora de Comienzo"], [47, fechaComienzo]]),
    r([[0, "Variedad totalizadora / Código"], [15, "Default"], [32, "Tiempo Máquina"], [47, "01:35:55"]]),
    r([[0, "Productor / Código"], [15, "INVERMARMELO / 71"], [32, "Tiempo Lote"], [47, "18:30:10"]]),
    r([[0, "Nombre del Lote"], [15, lote], [32, "Utilización"], [47, 0.0863984386728719]]),
    r([[0, "Peso de Fruta Promedio (g)"], [15, "216,84 (216,84)*"], [32, "Bins / Hora"], [47, 65.0564726324935]]),
    r([[0, "Toneladas / Hora"], [15, "14,89 (14,89)*"], [32, "Cartons"], [47, "1.655,49 (1.655,49)*"]]),
    r([[0, "Porcentaje de Rechazo"], [15, 0]]),
    r(),
    // ── Producto 1, calidad 1, dos clases ──
    r([[1, "Producto:"], [12, "MDNA 3KG D-PACK CAL 4/5 (73/92M)"]]),
    r([[2, "Calidad:"], [8, "1"]]),
    r([[4, "Clase:"], [9, "(A) Extra 1 "], [33, "Grupo de Clasificación:"], [40, "EXPORTACION"]]),
    CABECERA_TABLA,
    dato("(13) 1/36", 2, 0.0000182, 0.713, 0.00003, 0.054, 0.0000326),
    dato("(14) 2/42", 22, 0.0002, 8.096, 0.00034, 0.594, 0.00036),
    subtotal(24, 8.809), // suma de las dos de arriba: NO debe capturarse
    r(),
    r([[4, "Clase:"], [9, "(C) Cat1 A"], [33, "Grupo de Clasificación:"], [40, "EXPORTACION"]]),
    CABECERA_TABLA,
    dato("(13) 1/36", 108, 0.00098, 40.0738, 0.00168, 2.918, 0.00176),
    subtotal(108, 40.0738),
    r([[4, "Total de Calidad:"], [13, 132], [28, 48.8828]]), // pie: no es dato
    r([[2, "Total del Producto:"], [13, 132], [28, 48.8828]]),
    r(),
    // ── Producto 2: el PODRIDO ──
    r([[1, "Producto:"], [12, "PODRIDO"]]),
    r([[2, "Calidad:"], [8, "1"]]),
    r([[4, "Clase:"], [9, "(J) Podrido"], [33, "Grupo de Clasificación:"], [40, "DESTRIO"]]),
    CABECERA_TABLA,
    dato("(01) CITRICA", 900, 0.008, 200.5, 0.0084, 0, 0),
    dato("(02) 9/130", 260, 0.002, 56.23, 0.0023, 0, 0),
    subtotal(1160, 256.73),
    r([[4, "Total de Calidad:"], [13, 1160], [28, 256.73]]),
    r([[2, "Total del Producto:"], [13, 1160], [28, 256.73]]),
    r(),
    r([[1, "Total del Lote:"], [13, 1292], [28, 305.6], [37, 1]]),
    r([[5, "* El primer número se calcula de las siguientes Categorías Totalizadoras:"]]),
  ];
}

describe("parseInformeLoteRows — cabecera (pares etiqueta→valor por contenido)", () => {
  it("extrae lote, productor/código, variedad, fecha (serial Excel), t/h, peso promedio y Tiempo Lote", () => {
    const { informe, descartadas } = parseInformeLoteRows(fixtureInforme());
    expect(informe).not.toBeNull();
    expect(descartadas).toHaveLength(0);
    expect(informe!.loteCodigo).toBe("26043013");
    expect(informe!.loteCodigoNormalizado).toBe("26043013");
    expect(informe!.productorNombre).toBe("INVERMARMELO");
    expect(informe!.productorCodigo).toBe("71");
    expect(informe!.variedad).toBe("VALENCIA DELTA");
    expect(informe!.fechaComienzo).toBe("2026-07-15"); // serial 46218.469… (verificado contra el archivo real)
    expect(informe!.toneladasHora).toBeCloseTo(14.89);
    expect(informe!.pesoFrutaPromedioG).toBeCloseTo(216.84);
    expect(informe!.duracionLoteMin).toBeCloseTo(18 * 60 + 30 + 10 / 60); // "18:30:10"
  });

  it("acepta la fecha como Date (workbook leído con cellDates:true)", () => {
    const { informe } = parseInformeLoteRows(fixtureInforme({ fechaComienzo: new Date(2026, 6, 15, 11, 16) }));
    expect(informe!.fechaComienzo).toBe("2026-07-15");
  });

  it("lote COMPUESTO 'A+B': el crudo se conserva y el normalizado es el PRIMER código de 8 dígitos (limitación conocida, convención A del repo)", () => {
    const { informe } = parseInformeLoteRows(fixtureInforme({ lote: "26042912+26042911" }));
    expect(informe!.loteCodigo).toBe("26042912+26042911");
    expect(informe!.loteCodigoNormalizado).toBe("26042912");
  });

  it("sin 'Nombre del Lote' devuelve informe null con motivo claro (así se distingue de la variante por-productor u otro Excel)", () => {
    const rows = fixtureInforme().filter((row) => !(row as unknown[]).includes("Nombre del Lote"));
    const { informe, descartadas } = parseInformeLoteRows(rows);
    expect(informe).toBeNull();
    expect(descartadas[0]).toMatch(/Nombre del Lote/);
  });

  it("sin fecha legible el informe se devuelve igualmente pero con aviso (el plan del import lo descartará)", () => {
    const { informe, descartadas } = parseInformeLoteRows(fixtureInforme({ fechaComienzo: "no es una fecha" }));
    expect(informe).not.toBeNull();
    expect(informe!.fechaComienzo).toBeNull();
    expect(descartadas.some((d) => /Fecha y Hora de Comienzo/.test(d))).toBe(true);
  });
});

describe("parseInformeLoteRows — tabla Producto/Calidad/Clase/Tamaño", () => {
  it("captura las filas de Tamaño con su contexto y salta subtotales y pies de sección", () => {
    const { informe } = parseInformeLoteRows(fixtureInforme());
    // 2 (A) + 1 (C) + 2 (J) = 5 filas de dato; los 3 subtotales y los pies "Total…" NO cuentan.
    expect(informe!.clasificacion).toHaveLength(5);

    const primera = informe!.clasificacion[0];
    expect(primera).toMatchObject({
      producto: "MDNA 3KG D-PACK CAL 4/5 (73/92M)",
      calidad: "1",
      clase: "(A) Extra 1",
      grupoDestino: "EXPORTACION",
      tamano: "(13) 1/36",
      piezas: 2,
      pesoKg: 0.713,
    });
    // Los % vienen como FRACCIONES y se guardan tal cual (convención de lote_clasificacion).
    expect(primera.pctPeso).toBeCloseTo(0.00003);

    const podrido = informe!.clasificacion.filter((f) => f.clase === "(J) Podrido");
    expect(podrido).toHaveLength(2);
    expect(podrido[0]).toMatchObject({ producto: "PODRIDO", grupoDestino: "DESTRIO" });
  });

  it("kgTotal = Σ Peso(kg) de las filas de dato (NO hay total fiable en cabecera) y kgPodrido = Σ de las clases 'podrido'", () => {
    const { informe } = parseInformeLoteRows(fixtureInforme());
    expect(informe!.kgTotal).toBeCloseTo(0.713 + 8.096 + 40.0738 + 200.5 + 56.23);
    expect(informe!.kgPodrido).toBeCloseTo(256.73);
  });

  it("una fila de Tamaño sin Peso numérico se descarta con motivo, sin tumbar el resto del informe", () => {
    const rows = fixtureInforme();
    rows.splice(17, 0, r([[4, "(99) ROTA"], [11, 1], [24, "n/a"]]));
    const { informe, descartadas } = parseInformeLoteRows(rows);
    expect(informe!.clasificacion).toHaveLength(5); // la rota no entra
    expect(descartadas.some((d) => /\(99\) ROTA/.test(d))).toBe(true);
  });

  it("texto desconocido en la columna de Tamaño genera aviso (estructura no reconocida nunca se oculta)", () => {
    const rows = fixtureInforme();
    rows.splice(17, 0, r([[4, "ALGO RARO"]]));
    const { descartadas } = parseInformeLoteRows(rows);
    expect(descartadas.some((d) => /ALGO RARO/.test(d))).toBe(true);
  });

  it("informe sin ninguna fila de dato: informe no-null pero con aviso (el plan lo descartará por kg<=0)", () => {
    const soloCabecera = fixtureInforme().slice(0, 12);
    const { informe, descartadas } = parseInformeLoteRows(soloCabecera);
    expect(informe).not.toBeNull();
    expect(informe!.kgTotal).toBe(0);
    expect(descartadas.some((d) => /ninguna fila de Tamaño/.test(d))).toBe(true);
  });
});

describe("numeroEsCelda / hhmmssAMinutos", () => {
  it("parsea texto es-ES con decoración '(x)*' y números crudos", () => {
    expect(numeroEsCelda("14,89 (14,89)*")).toBeCloseTo(14.89);
    expect(numeroEsCelda("1.655,49 (1.655,49)*")).toBeCloseTo(1655.49);
    expect(numeroEsCelda("216,84")).toBeCloseTo(216.84);
    expect(numeroEsCelda(0.0863984386728719)).toBeCloseTo(0.0863984386728719);
    expect(numeroEsCelda("texto")).toBeNull();
    expect(numeroEsCelda(null)).toBeNull();
  });

  it("HH:MM:SS a minutos, con horas > 24 permitidas ('18:30:10')", () => {
    expect(hhmmssAMinutos("18:30:10")).toBeCloseTo(18 * 60 + 30 + 10 / 60);
    expect(hhmmssAMinutos("01:35:55")).toBeCloseTo(95 + 55 / 60);
    expect(hhmmssAMinutos("no es hora")).toBeNull();
  });
});

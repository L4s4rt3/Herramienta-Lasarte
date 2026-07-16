import { describe, expect, it } from "vitest";
import {
  extraerResumenDeclaradoInforme,
  parseDuracionMinutos,
  parseInformeProduccionRows,
  resumirInformeProduccion,
} from "./historicoProduccion";

// Cabecera real del informe (celdas combinadas: el texto solo en la primera
// celda de cada rango, el resto "" — igual que devuelve sheet_to_json con
// defval:"" para las celdas combinadas vacías del export real).
const HEADER: unknown[] = [
  "Nombre del Lote", "", "", "", "", "Código del Productor", "", "", "Nombre del Productor", "", "", "", "",
  "Variedad", "Bins", "", "Tiempo de Inicio", "", "", "", "", "Hora de la Máquina", "Peso (kg)", "", "",
  "Toneladas / Hora", "", "Peso de Fruta Promedio (g)",
];

// Construye una fila de detalle con los mismos índices que el export real.
function fila(overrides: {
  lote: unknown;
  productorCodigo?: string;
  productorNombre?: string;
  variedad?: unknown;
  tiempoInicio: unknown;
  horaMaquina?: unknown;
  pesoKg: unknown;
  toneladasHora?: unknown;
}): unknown[] {
  const row = new Array(28).fill("");
  row[0] = overrides.lote;
  row[5] = overrides.productorCodigo ?? "8";
  row[8] = overrides.productorNombre ?? "ESTACADA LARGA";
  row[13] = overrides.variedad ?? "PRINCIPIO CAMPAÑA";
  row[14] = 0;
  row[16] = overrides.tiempoInicio;
  row[21] = overrides.horaMaquina ?? "03:57:22";
  row[22] = overrides.pesoKg;
  row[25] = overrides.toneladasHora ?? 3.05;
  row[27] = 224.86;
  return row;
}

function filaTotales(): unknown[] {
  const row = new Array(28).fill("");
  row[0] = 963; // recuento de lotes distintos: NÚMERO, no texto
  row[5] = 96;
  row[8] = 95;
  row[13] = 6;
  row[21] = "58d 09:34:09";
  row[22] = 20255407.6854001;
  return row;
}

describe("parseInformeProduccionRows — localiza la cabecera por texto", () => {
  it("mapea columnas aunque haya filas decorativas antes de la cabecera", () => {
    const rows: unknown[][] = [
      [null, "Resumen de la Producción"],
      [null, null, "Cantidad de Lotes:", null, null, null, null, 1187],
      HEADER,
      fila({ lote: "25101601", tiempoInicio: new Date(2025, 9, 24, 5, 47, 29), pesoKg: 12093.3578 }),
    ];
    const { filas, descartadas } = parseInformeProduccionRows(rows);
    expect(descartadas).toHaveLength(0);
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({
      lote_codigo: "25101601",
      fecha: "2025-10-24",
      productor: "ESTACADA LARGA",
      productor_codigo: "8",
      producto: "PRINCIPIO CAMPAÑA",
      kg: 12093.3578,
    });
  });

  it("descartadas con motivo si no se encuentra la cabecera", () => {
    const { filas, descartadas } = parseInformeProduccionRows([["algo", "que", "no es", "la cabecera"]]);
    expect(filas).toHaveLength(0);
    expect(descartadas).toHaveLength(1);
    expect(descartadas[0].motivo).toMatch(/cabecera/i);
  });
});

describe("parseInformeProduccionRows — nombres de lote sucios reales", () => {
  const casosLoteSucio = [
    "25101601",
    "251016012", // 9 dígitos
    "25110707+25110606", // compuesto
    "25103101 PREC DIA 31/10/25",
    "25111001+PREC",
    "26042712+7 BOX DE RECICLAJE",
  ];

  it.each(casosLoteSucio)("conserva el código crudo '%s' tal cual, sin normalizar", (loteCrudo) => {
    const rows: unknown[][] = [
      HEADER,
      fila({ lote: loteCrudo, tiempoInicio: new Date(2026, 3, 20, 10, 0, 0), pesoKg: 5000 }),
    ];
    const { filas, descartadas } = parseInformeProduccionRows(rows);
    expect(descartadas).toHaveLength(0);
    expect(filas[0].lote_codigo).toBe(loteCrudo);
  });

  it("'PREC DIA 08/11/25' (sin código de lote) se conserva como código crudo, no se descarta", () => {
    // El propio "nombre de lote" es un texto sin código: sigue siendo el
    // identificador que trae el calibrador, se guarda tal cual (lote_codigo
    // crudo); no hay 8 dígitos que normalizar pero el parser no exige eso.
    const rows: unknown[][] = [
      HEADER,
      fila({ lote: "PREC DIA 08/11/25", productorCodigo: "65", productorNombre: "PRECALIBRADO", tiempoInicio: new Date(2025, 10, 8, 10, 0, 0), pesoKg: 1868.2412 }),
    ];
    const { filas, descartadas } = parseInformeProduccionRows(rows);
    expect(descartadas).toHaveLength(0);
    expect(filas[0].lote_codigo).toBe("PREC DIA 08/11/25");
  });
});

describe("parseInformeProduccionRows — fila de totales/resumen final", () => {
  it("se descarta en silencio (no cuenta como fila inválida)", () => {
    const rows: unknown[][] = [
      HEADER,
      fila({ lote: "25101601", tiempoInicio: new Date(2025, 9, 24), pesoKg: 100 }),
      filaTotales(),
    ];
    const { filas, descartadas } = parseInformeProduccionRows(rows);
    expect(filas).toHaveLength(1);
    expect(descartadas).toHaveLength(0);
  });
});

describe("parseInformeProduccionRows — descartes", () => {
  it("sin fecha reconocible", () => {
    const rows: unknown[][] = [HEADER, fila({ lote: "25101601", tiempoInicio: null, pesoKg: 100 })];
    const { filas, descartadas } = parseInformeProduccionRows(rows);
    expect(filas).toHaveLength(0);
    expect(descartadas[0].motivo).toMatch(/fecha/i);
  });

  it("sin kg (null, 0 o negativo)", () => {
    const base = { lote: "25101601", tiempoInicio: new Date(2026, 0, 1) };
    for (const pesoKg of [null, 0, -5]) {
      const { filas, descartadas } = parseInformeProduccionRows([HEADER, fila({ ...base, pesoKg })]);
      expect(filas).toHaveLength(0);
      expect(descartadas[0].motivo).toMatch(/kg/i);
    }
  });

  it("fila totalmente vacía se ignora sin generar descarte", () => {
    const rows: unknown[][] = [HEADER, new Array(28).fill(""), new Array(28).fill(null)];
    const { filas, descartadas } = parseInformeProduccionRows(rows);
    expect(filas).toHaveLength(0);
    expect(descartadas).toHaveLength(0);
  });
});

describe("parseInformeProduccionRows — un lote con varias filas (varias pasadas, incluso en días distintos)", () => {
  it("cada pasada es su propia fila, con su propia fecha", () => {
    const rows: unknown[][] = [
      HEADER,
      fila({ lote: "25101601", tiempoInicio: new Date(2025, 9, 24), pesoKg: 12093.3578 }),
      fila({ lote: "25101601", tiempoInicio: new Date(2025, 9, 27), pesoKg: 0.0403 }), // segunda pasada, día distinto
    ];
    const { filas } = parseInformeProduccionRows(rows);
    expect(filas).toHaveLength(2);
    expect(filas.map((f) => f.fecha)).toEqual(["2025-10-24", "2025-10-27"]);
    expect(filas.every((f) => f.lote_codigo === "25101601")).toBe(true);
  });
});

describe("parseDuracionMinutos", () => {
  it("'HH:MM:SS' a minutos", () => {
    expect(parseDuracionMinutos("03:57:22")).toBeCloseTo(237 + 22 / 60);
    expect(parseDuracionMinutos("00:29:30")).toBeCloseTo(29.5);
  });

  it("fracción de día (número) a minutos", () => {
    expect(parseDuracionMinutos(0.5)).toBeCloseTo(720); // medio día = 12h
  });

  it("null si no reconocible", () => {
    expect(parseDuracionMinutos("")).toBeNull();
    expect(parseDuracionMinutos(null)).toBeNull();
    expect(parseDuracionMinutos("58d 09:34:09")).toBeNull(); // formato de la fila de TOTALES, no de detalle
  });
});

describe("resumirInformeProduccion", () => {
  it("agrega filas válidas, kg, lotes distintos, rango de fechas y descartes por motivo", () => {
    const rows: unknown[][] = [
      HEADER,
      fila({ lote: "25101601", tiempoInicio: new Date(2025, 9, 24), pesoKg: 1000 }),
      fila({ lote: "25101601", tiempoInicio: new Date(2025, 9, 27), pesoKg: 500 }), // misma lote, otro día
      fila({ lote: "25101701", tiempoInicio: new Date(2025, 9, 28), pesoKg: 2000 }),
      fila({ lote: "25101801", tiempoInicio: null, pesoKg: 300 }), // se descarta: sin fecha
    ];
    const resumen = resumirInformeProduccion(parseInformeProduccionRows(rows));
    expect(resumen.filasValidas).toBe(3);
    expect(resumen.filasDescartadas).toBe(1);
    expect(resumen.descartadasPorMotivo["Sin fecha reconocible (Tiempo de Inicio)"]).toBe(1);
    expect(resumen.kgTotal).toBe(3500);
    expect(resumen.lotesDistintos).toBe(2); // "25101601" cuenta una vez aunque tenga 2 filas
    expect(resumen.fechaDesde).toBe("2025-10-24");
    expect(resumen.fechaHasta).toBe("2025-10-28");
    expect(resumen.fechasDistintas).toBe(3);
  });
});

describe("extraerResumenDeclaradoInforme", () => {
  it("extrae 'Cantidad de Lotes:' y 'Peso (kg):' de la cabecera decorativa real", () => {
    const rows: unknown[][] = [
      [null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null],
      [null, "Resumen de la Producción"],
      [null, null, "Cantidad de Lotes:", null, null, null, null, 1187, null, null, null, null, null, null, null, null, null, null, null, "Peso (kg):", null, null, null, null, "20.255.407,69 (20.255.407,69)*", null, null, null],
    ];
    const resumen = extraerResumenDeclaradoInforme(rows);
    expect(resumen.lotesDeclarados).toBe(1187);
    expect(resumen.kgDeclarados).toBeCloseTo(20255407.69);
  });

  it("null en ambos si no aparecen las etiquetas (no bloquea nada)", () => {
    const resumen = extraerResumenDeclaradoInforme([["algo", "distinto"]]);
    expect(resumen.lotesDeclarados).toBeNull();
    expect(resumen.kgDeclarados).toBeNull();
  });
});

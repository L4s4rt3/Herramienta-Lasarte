import { describe, expect, it } from "vitest";
import {
  buildAnnualConsumptionRows,
  buildDailyConsumptionRows,
  buildDailyWaterMeterConsumoFromReading,
  buildDrencherWaterMeterConsumoFromReading,
  buildJabonWaterMeterConsumoFromReading,
  buildMonthlyConsumptionRows,
  buildTratamientoWaterMeterConsumoFromReading,
  extractFotoFecha,
  findNextWaterMeterReading,
  findPreviousWaterMeterReading,
  kgVendidosDerivados,
  parseWaterMeterReading,
  subtractOneDayLocal,
  waterBreakdownForRange,
  type ConsumoFisicoInput,
  type ParteKgInput,
} from "./consumosFisicos";
import { mercadonaWeekDateRange } from "./mercadonaVentas";

const RANGE_START = "2025-09-01";
const RANGE_END = "2025-11-30";

const consumos: ConsumoFisicoInput[] = [
  { id: "1", recurso: "agua", fecha_inicio: "2025-09-05", fecha_fin: "2025-09-05", cantidad: 5000, unidad: "l", fuente: "contador", referencia: "agua-contador-general" },
  { id: "2", recurso: "agua", fecha_inicio: "2025-10-10", fecha_fin: "2025-10-10", cantidad: 7000, unidad: "l", fuente: "contador", referencia: "agua-contador-general" },
  { id: "3", recurso: "agua", fecha_inicio: "2025-11-15", fecha_fin: "2025-11-15", cantidad: 3000, unidad: "l", fuente: "contador", referencia: "agua-contador-general" },
  { id: "4", recurso: "electricidad", fecha_inicio: "2025-09-01", fecha_fin: "2025-09-30", cantidad: 1200, unidad: "kwh", fuente: "factura_detallada" },
];

const partes: ParteKgInput[] = [
  { date: "2025-09-05", kg_produccion_calibrador: 10000, kg_mujeres_calibrador: 0, kg_reciclado_malla_z1: 0, kg_reciclado_malla_z2: 0 },
  { date: "2025-10-10", kg_produccion_calibrador: 12000, kg_mujeres_calibrador: 0, kg_reciclado_malla_z1: 0, kg_reciclado_malla_z2: 0 },
  { date: "2025-11-15", kg_produccion_calibrador: 8000, kg_mujeres_calibrador: 0, kg_reciclado_malla_z1: 0, kg_reciclado_malla_z2: 0 },
];

describe("buildAnnualConsumptionRows", () => {
  it("devuelve un único periodo con la etiqueta de campaña sep-ago", () => {
    const rows = buildAnnualConsumptionRows({ rangeStart: RANGE_START, rangeEnd: RANGE_END, consumos, basesKg: [], partes });
    expect(rows).toHaveLength(1);
    expect(rows[0].periodo).toBe("2025-2026");
    expect(rows[0].fechaInicio).toBe(RANGE_START);
    expect(rows[0].fechaFin).toBe(RANGE_END);
  });

  it("etiqueta la campaña anterior cuando el rango empieza antes de septiembre", () => {
    const rows = buildAnnualConsumptionRows({
      rangeStart: "2025-01-01", rangeEnd: "2025-08-31", consumos: [], basesKg: [], partes: [],
    });
    expect(rows[0].periodo).toBe("2024-2025");
  });

  it("los totales anuales coinciden con la suma de los totales mensuales del mismo rango", () => {
    const annual = buildAnnualConsumptionRows({ rangeStart: RANGE_START, rangeEnd: RANGE_END, consumos, basesKg: [], partes });
    const monthly = buildMonthlyConsumptionRows({ rangeStart: RANGE_START, rangeEnd: RANGE_END, consumos, basesKg: [], partes });

    const sumMonthly = monthly.reduce(
      (acc, row) => ({
        kgBase: acc.kgBase + row.kgBase,
        aguaL: acc.aguaL + row.aguaL,
        electricidadKwh: acc.electricidadKwh + row.electricidadKwh,
      }),
      { kgBase: 0, aguaL: 0, electricidadKwh: 0 },
    );

    expect(annual[0].kgBase).toBeCloseTo(sumMonthly.kgBase, 6);
    expect(annual[0].aguaL).toBeCloseTo(sumMonthly.aguaL, 6);
    expect(annual[0].electricidadKwh).toBeCloseTo(sumMonthly.electricidadKwh, 6);
  });

  it("no revienta con un rango vacío", () => {
    const rows = buildAnnualConsumptionRows({ rangeStart: "2025-09-05", rangeEnd: "2025-09-01", consumos: [], basesKg: [], partes: [] });
    expect(rows).toEqual([]);
  });
});

describe("subtractOneDayLocal", () => {
  it("resta un dia sin desplazamiento de zona horaria", () => {
    expect(subtractOneDayLocal("2026-07-06")).toBe("2026-07-05");
  });

  it("cruza el limite de mes correctamente", () => {
    expect(subtractOneDayLocal("2026-08-01")).toBe("2026-07-31");
  });

  it("cruza el limite de año correctamente", () => {
    expect(subtractOneDayLocal("2026-01-01")).toBe("2025-12-31");
  });
});

describe("buildDailyWaterMeterConsumoFromReading — REGLA 1 (atribucion al dia anterior)", () => {
  it("con lectura diaria (foto consecutiva) atribuye el consumo al dia anterior a la foto", () => {
    // Foto del 6 jul con lectura anterior del 5 jul -> el delta es el consumo del dia 5.
    const consumo = buildDailyWaterMeterConsumoFromReading({
      fecha: "2026-07-06",
      lecturaContadorM3: 100,
      lecturaAnteriorM3: 95,
      fechaLecturaAnterior: "2026-07-05",
    });

    expect(consumo.fecha_inicio).toBe("2026-07-05");
    expect(consumo.fecha_fin).toBe("2026-07-05");
    expect(consumo.cantidad).toBe(5000);
    expect(consumo.notas).toContain("foto del 2026-07-06");
  });

  it("con hueco de varios dias (fin de semana) el rango cubre desde la lectura anterior hasta el dia previo a la foto", () => {
    // Foto el viernes 3 jul; siguiente foto el lunes 6 jul -> el delta cubre 3, 4 y 5 jul (nunca el 6).
    const consumo = buildDailyWaterMeterConsumoFromReading({
      fecha: "2026-07-06",
      lecturaContadorM3: 130,
      lecturaAnteriorM3: 100,
      fechaLecturaAnterior: "2026-07-03",
    });

    expect(consumo.fecha_inicio).toBe("2026-07-03");
    expect(consumo.fecha_fin).toBe("2026-07-05");
    expect(consumo.cantidad).toBe(30000);
  });

  it("sin lectura anterior (primera vez) usa [fecha-1, fecha-1] y consumo cero", () => {
    const consumo = buildDailyWaterMeterConsumoFromReading({
      fecha: "2026-06-17",
      lecturaContadorM3: 500,
      lecturaAnteriorM3: null,
      fechaLecturaAnterior: null,
    });

    expect(consumo.fecha_inicio).toBe("2026-06-16");
    expect(consumo.fecha_fin).toBe("2026-06-16");
    expect(consumo.cantidad).toBe(0);
  });

  it("sin lectura anterior y foto de LUNES, el rango cubre el finde completo [viernes, domingo]", () => {
    // 2026-07-06 es lunes: sin lectura anterior no sabemos que paso el finde, pero
    // el fallback asume que la foto anterior fue el viernes (patron habitual L-V).
    const consumo = buildDailyWaterMeterConsumoFromReading({
      fecha: "2026-07-06",
      lecturaContadorM3: 500,
      lecturaAnteriorM3: null,
      fechaLecturaAnterior: null,
    });

    expect(consumo.fecha_inicio).toBe("2026-07-03");
    expect(consumo.fecha_fin).toBe("2026-07-05");
    expect(consumo.cantidad).toBe(0);
  });

  it("sin lectura anterior y foto de MARTES (no lunes), el rango sigue siendo [fecha-1, fecha-1]", () => {
    // 2026-07-07 es martes: no hay hueco de finde que cubrir, solo el dia previo (lunes).
    const consumo = buildDailyWaterMeterConsumoFromReading({
      fecha: "2026-07-07",
      lecturaContadorM3: 500,
      lecturaAnteriorM3: null,
      fechaLecturaAnterior: null,
    });

    expect(consumo.fecha_inicio).toBe("2026-07-06");
    expect(consumo.fecha_fin).toBe("2026-07-06");
    expect(consumo.cantidad).toBe(0);
  });
});

describe("buildTratamientoWaterMeterConsumoFromReading / buildJabonWaterMeterConsumoFromReading — fallback de lunes sin lectura anterior", () => {
  it("tratamiento: foto de lunes sin lectura anterior cubre [viernes, domingo]", () => {
    const consumo = buildTratamientoWaterMeterConsumoFromReading({
      fecha: "2026-07-06",
      lecturaContadorM3: 50,
      lecturaAnteriorM3: null,
      fechaLecturaAnterior: null,
    });

    expect(consumo.fecha_inicio).toBe("2026-07-03");
    expect(consumo.fecha_fin).toBe("2026-07-05");
  });

  it("jabon: foto de lunes sin lectura anterior cubre [viernes, domingo]", () => {
    const consumo = buildJabonWaterMeterConsumoFromReading({
      fecha: "2026-07-06",
      lecturaContadorL: 50,
      lecturaAnteriorL: null,
      fechaLecturaAnterior: null,
    });

    expect(consumo.fecha_inicio).toBe("2026-07-03");
    expect(consumo.fecha_fin).toBe("2026-07-05");
  });
});

describe("extractFotoFecha — fallback sin anotacion de foto", () => {
  it("sin (foto del ...) en notas, usa fecha_fin + 1 dia (la foto real es el dia siguiente al fin del rango)", () => {
    const fecha = extractFotoFecha({ notas: "Sin anotacion de foto.", fecha_fin: "2026-07-05" });
    expect(fecha).toBe("2026-07-06");
  });

  it("factura_detallada sin anotacion tambien usa fecha_fin + 1 (la siguiente lectura empieza justo despues)", () => {
    const fecha = extractFotoFecha({ notas: null, fecha_fin: "2026-04-23" });
    expect(fecha).toBe("2026-04-24");
  });

  it("con anotacion (foto del ...) usa la fecha real anotada, no fecha_fin + 1", () => {
    const fecha = extractFotoFecha({ notas: "Lectura contador: 100 m3 (foto del 2026-07-06).", fecha_fin: "2026-07-05" });
    expect(fecha).toBe("2026-07-06");
  });
});

describe("cadena viernes -> lunes -> martes: los rangos encadenados no se solapan y cubren cada dia una vez", () => {
  it("con las 3 fotos anotadas normalmente, los rangos son contiguos y no se solapan", () => {
    // Foto viernes 3 jul (sin lectura anterior, dia laboral normal: cubre solo el jueves 2).
    const friday = buildDailyWaterMeterConsumoFromReading({
      fecha: "2026-07-03",
      lecturaContadorM3: 100,
      lecturaAnteriorM3: null,
      fechaLecturaAnterior: null,
    });
    expect(friday.fecha_inicio).toBe("2026-07-02");
    expect(friday.fecha_fin).toBe("2026-07-02");

    let historico: ConsumoFisicoInput[] = [{ id: "fri", ...friday }];

    // Foto lunes 6 jul, encadenada con la lectura anterior encontrada (la del viernes).
    const prevForMonday = findPreviousWaterMeterReading(historico, "2026-07-06", "agua-contador-general");
    expect(prevForMonday?.fecha).toBe("2026-07-03");

    const monday = buildDailyWaterMeterConsumoFromReading({
      fecha: "2026-07-06",
      lecturaContadorM3: 130,
      lecturaAnteriorM3: prevForMonday?.lecturaM3,
      fechaLecturaAnterior: prevForMonday?.fecha,
    });
    expect(monday.fecha_inicio).toBe("2026-07-03");
    expect(monday.fecha_fin).toBe("2026-07-05");

    historico = [...historico, { id: "mon", ...monday }];

    // Foto martes 7 jul, encadenada con la lectura anterior encontrada (la del lunes).
    const prevForTuesday = findPreviousWaterMeterReading(historico, "2026-07-07", "agua-contador-general");
    expect(prevForTuesday?.fecha).toBe("2026-07-06");

    const tuesday = buildDailyWaterMeterConsumoFromReading({
      fecha: "2026-07-07",
      lecturaContadorM3: 140,
      lecturaAnteriorM3: prevForTuesday?.lecturaM3,
      fechaLecturaAnterior: prevForTuesday?.fecha,
    });
    expect(tuesday.fecha_inicio).toBe("2026-07-06");
    expect(tuesday.fecha_fin).toBe("2026-07-06");

    // Cobertura exacta, sin huecos ni solapes: 07-02, 07-03..07-05, 07-06.
    const allDays = [friday, monday, tuesday].flatMap((row) => {
      const days: string[] = [];
      let current = row.fecha_inicio;
      while (current <= row.fecha_fin) {
        days.push(current);
        const [y, m, d] = current.split("-").map(Number);
        const next = new Date(y, m - 1, d, 12, 0, 0);
        next.setDate(next.getDate() + 1);
        current = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}-${String(next.getDate()).padStart(2, "0")}`;
      }
      return days;
    });

    expect(allDays).toEqual(["2026-07-02", "2026-07-03", "2026-07-04", "2026-07-05", "2026-07-06"]);
    expect(new Set(allDays).size).toBe(allDays.length);
  });

  it("con una fila intermedia SIN anotacion (foto del...) en notas, la siguiente lectura ancla en fecha_fin+1 y no duplica dias", () => {
    // Fila antigua/manual que simula un registro sin la anotacion de foto: guardada
    // como si REGLA 1 ya se hubiese aplicado (fecha_fin = dia anterior a la foto real),
    // pero sin la nota "(foto del ...)". La foto real fue el viernes 3 jul, por lo que
    // fecha_fin debe ser el jueves 2 jul (dia previo a la foto), igual que el caso con anotacion.
    const legacyFriday: ConsumoFisicoInput = {
      id: "legacy-fri",
      recurso: "agua",
      fecha_inicio: "2026-07-02",
      fecha_fin: "2026-07-02",
      cantidad: 100000,
      unidad: "l",
      fuente: "contador",
      referencia: "agua-contador-general",
      notas: "Lectura contador: 100 m3. Consumo calculado: 100000 L.",
    };

    // extractFotoFecha debe anclar en fecha_fin + 1 = 2026-07-03 (la foto real), no en
    // fecha_fin (2026-07-02), que duplicaria ese dia en el reparto de la lectura siguiente.
    expect(extractFotoFecha(legacyFriday)).toBe("2026-07-03");

    const historico: ConsumoFisicoInput[] = [legacyFriday];
    const prevForMonday = findPreviousWaterMeterReading(historico, "2026-07-06", "agua-contador-general");
    expect(prevForMonday?.fecha).toBe("2026-07-03");

    const monday = buildDailyWaterMeterConsumoFromReading({
      fecha: "2026-07-06",
      lecturaContadorM3: 130,
      lecturaAnteriorM3: prevForMonday?.lecturaM3,
      fechaLecturaAnterior: prevForMonday?.fecha,
    });

    // El lunes debe empezar en fecha_fin+1 de la fila legacy (07-03), no en 07-02
    // (que ya esta cubierto por la fila legacy y se duplicaria si se contara dos veces).
    expect(monday.fecha_inicio).toBe("2026-07-03");
    expect(monday.fecha_fin).toBe("2026-07-05");
  });
});

describe("findPreviousWaterMeterReading — compatibilidad con filas desplazadas al dia anterior", () => {
  it("encuentra la ultima lectura por la fecha REAL de la foto (guardada en notas), no por fecha_fin", () => {
    const previousConsumo = buildDailyWaterMeterConsumoFromReading({
      fecha: "2026-07-05",
      lecturaContadorM3: 95,
      lecturaAnteriorM3: 90,
      fechaLecturaAnterior: "2026-07-04",
    });

    const historico: ConsumoFisicoInput[] = [
      { id: "prev", ...previousConsumo },
    ];

    // La fila "prev" tiene fecha_fin=2026-07-04 (dia anterior a su foto del 05), pero
    // la proxima foto es el 06 y debe encontrarla como la ultima lectura disponible.
    const found = findPreviousWaterMeterReading(historico, "2026-07-06", "agua-contador-general");

    expect(found).not.toBeNull();
    expect(found?.lecturaM3).toBe(95);
    expect(found?.fecha).toBe("2026-07-05");
  });
});

describe("REGLA 2 — subcontadores de tratamiento no duplican el total de agua", () => {
  const consumosConSubcontadores: ConsumoFisicoInput[] = [
    { id: "g1", recurso: "agua", fecha_inicio: "2026-07-05", fecha_fin: "2026-07-05", cantidad: 10000, unidad: "l", fuente: "contador", referencia: "agua-contador-general" },
    { id: "t1", recurso: "agua", fecha_inicio: "2026-07-05", fecha_fin: "2026-07-05", cantidad: 3000, unidad: "l", fuente: "contador", referencia: "agua-contador-tratamiento" },
    { id: "j1", recurso: "agua", fecha_inicio: "2026-07-05", fecha_fin: "2026-07-05", cantidad: 500, unidad: "l", fuente: "contador", referencia: "agua-contador-tratamiento-jabon" },
    { id: "d1", recurso: "agua", fecha_inicio: "2026-07-05", fecha_fin: "2026-07-05", cantidad: 800, unidad: "l", fuente: "contador", referencia: "agua-contador-drencher" },
  ];

  it("el total diario de agua es solo el del contador general (no suma los subcontadores)", () => {
    const rows = buildDailyConsumptionRows({
      rangeStart: "2026-07-05",
      rangeEnd: "2026-07-05",
      consumos: consumosConSubcontadores,
      basesKg: [],
      partes: [],
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].aguaL).toBe(10000);
  });

  it("el subcontador de tratamiento tambien queda excluido cuando cae en un tramo repartido por kg (multi-dia)", () => {
    const consumosConRepartoMultiDia: ConsumoFisicoInput[] = [
      { id: "g1", recurso: "agua", fecha_inicio: "2026-07-03", fecha_fin: "2026-07-05", cantidad: 9000, unidad: "l", fuente: "contador", referencia: "agua-contador-general" },
      { id: "t1", recurso: "agua", fecha_inicio: "2026-07-03", fecha_fin: "2026-07-05", cantidad: 2000, unidad: "l", fuente: "contador", referencia: "agua-contador-tratamiento" },
    ];
    const partesMultiDia: ParteKgInput[] = [
      { date: "2026-07-03", kg_produccion_calibrador: 1000, kg_mujeres_calibrador: 0, kg_reciclado_malla_z1: 0, kg_reciclado_malla_z2: 0 },
      { date: "2026-07-04", kg_produccion_calibrador: 1000, kg_mujeres_calibrador: 0, kg_reciclado_malla_z1: 0, kg_reciclado_malla_z2: 0 },
      { date: "2026-07-05", kg_produccion_calibrador: 1000, kg_mujeres_calibrador: 0, kg_reciclado_malla_z1: 0, kg_reciclado_malla_z2: 0 },
    ];

    const rows = buildDailyConsumptionRows({
      rangeStart: "2026-07-03",
      rangeEnd: "2026-07-05",
      consumos: consumosConRepartoMultiDia,
      basesKg: [],
      partes: partesMultiDia,
    });

    const totalAgua = rows.reduce((sum, row) => sum + row.aguaL, 0);
    expect(totalAgua).toBeCloseTo(9000, 6);
  });
});

describe("waterBreakdownForRange", () => {
  const consumosConSubcontadores: ConsumoFisicoInput[] = [
    { id: "g1", recurso: "agua", fecha_inicio: "2026-07-05", fecha_fin: "2026-07-05", cantidad: 10000, unidad: "l", fuente: "contador", referencia: "agua-contador-general" },
    { id: "t1", recurso: "agua", fecha_inicio: "2026-07-05", fecha_fin: "2026-07-05", cantidad: 3000, unidad: "l", fuente: "contador", referencia: "agua-contador-tratamiento" },
    { id: "j1", recurso: "agua", fecha_inicio: "2026-07-05", fecha_fin: "2026-07-05", cantidad: 500, unidad: "l", fuente: "contador", referencia: "agua-contador-tratamiento-jabon" },
    { id: "d1", recurso: "agua", fecha_inicio: "2026-07-05", fecha_fin: "2026-07-05", cantidad: 800, unidad: "l", fuente: "contador", referencia: "agua-contador-drencher" },
  ];

  it("devuelve los litros de cada subcontador para el rango dado", () => {
    const breakdown = waterBreakdownForRange(consumosConSubcontadores, "2026-07-05", "2026-07-05");
    expect(breakdown.tratamientoL).toBe(3000);
    expect(breakdown.tratamientoJabonL).toBe(500);
    expect(breakdown.drencherL).toBe(800);
  });

  it("devuelve ceros cuando no hay consumos de subcontador en el rango", () => {
    const breakdown = waterBreakdownForRange(consumosConSubcontadores, "2026-08-01", "2026-08-05");
    expect(breakdown.tratamientoL).toBe(0);
    expect(breakdown.tratamientoJabonL).toBe(0);
    expect(breakdown.drencherL).toBe(0);
  });

  it("prorratea por solape cuando el consumo del subcontador cubre varios dias", () => {
    const consumosMultiDia: ConsumoFisicoInput[] = [
      { id: "t1", recurso: "agua", fecha_inicio: "2026-07-03", fecha_fin: "2026-07-05", cantidad: 3000, unidad: "l", fuente: "contador", referencia: "agua-contador-tratamiento" },
    ];
    // Rango de 3 dias completo -> los 3000 L completos.
    const full = waterBreakdownForRange(consumosMultiDia, "2026-07-03", "2026-07-05");
    expect(full.tratamientoL).toBe(3000);

    // Rango de 1 de los 3 dias -> tercio proporcional.
    const partial = waterBreakdownForRange(consumosMultiDia, "2026-07-03", "2026-07-03");
    expect(partial.tratamientoL).toBeCloseTo(1000, 6);
  });
});

describe("buildTratamientoWaterMeterConsumoFromReading — REGLA 1 aplicada tambien al subcontador", () => {
  it("atribuye el consumo del subcontador al dia anterior a la foto", () => {
    const consumo = buildTratamientoWaterMeterConsumoFromReading({
      fecha: "2026-07-06",
      lecturaContadorM3: 50,
      lecturaAnteriorM3: 48,
      fechaLecturaAnterior: "2026-07-05",
    });

    expect(consumo.fecha_inicio).toBe("2026-07-05");
    expect(consumo.fecha_fin).toBe("2026-07-05");
    expect(consumo.cantidad).toBe(2000);
    expect(consumo.referencia).toBe("agua-contador-tratamiento");
  });
});

describe("buildDrencherWaterMeterConsumoFromReading — cuarto contador del registro", () => {
  it("calcula el delta en litros y atribuye el consumo al dia anterior a la foto", () => {
    const consumo = buildDrencherWaterMeterConsumoFromReading({
      fecha: "2026-07-06",
      lecturaContadorL: 5400,
      lecturaAnteriorL: 5000,
      fechaLecturaAnterior: "2026-07-05",
    });

    expect(consumo.fecha_inicio).toBe("2026-07-05");
    expect(consumo.fecha_fin).toBe("2026-07-05");
    expect(consumo.cantidad).toBe(400);
    expect(consumo.unidad).toBe("l");
    expect(consumo.referencia).toBe("agua-contador-drencher");
  });

  it("sin lectura anterior es referencia inicial (consumo 0) y su lectura se recupera de las notas", () => {
    const consumo = buildDrencherWaterMeterConsumoFromReading({
      fecha: "2026-07-06",
      lecturaContadorL: 5400,
      lecturaAnteriorL: null,
    });

    expect(consumo.cantidad).toBe(0);
    const parsed = parseWaterMeterReading(consumo);
    expect(parsed.lecturaL).toBe(5400);
    expect(parsed.lecturaM3).toBeNull();
  });
});

describe("findNextWaterMeterReading — para recalcular la cadena al corregir una lectura", () => {
  const historico: ConsumoFisicoInput[] = [
    { id: "a", ...buildDrencherWaterMeterConsumoFromReading({ fecha: "2026-07-01", lecturaContadorL: 4000, lecturaAnteriorL: null }) },
    { id: "b", ...buildDrencherWaterMeterConsumoFromReading({ fecha: "2026-07-03", lecturaContadorL: 4500, lecturaAnteriorL: 4000, fechaLecturaAnterior: "2026-07-01" }) },
    { id: "c", ...buildDrencherWaterMeterConsumoFromReading({ fecha: "2026-07-06", lecturaContadorL: 5000, lecturaAnteriorL: 4500, fechaLecturaAnterior: "2026-07-03" }) },
    { id: "otro", ...buildTratamientoWaterMeterConsumoFromReading({ fecha: "2026-07-04", lecturaContadorM3: 60, lecturaAnteriorM3: 58, fechaLecturaAnterior: "2026-07-03" }) },
  ];

  it("encuentra la siguiente lectura del MISMO contador por fecha de foto", () => {
    const next = findNextWaterMeterReading(historico, "2026-07-03", "agua-contador-drencher");
    expect(next?.id).toBe("c");
    expect(next?.fecha).toBe("2026-07-06");
    expect(next?.lecturaL).toBe(5000);
  });

  it("devuelve null cuando la lectura editada es la ultima del contador", () => {
    expect(findNextWaterMeterReading(historico, "2026-07-06", "agua-contador-drencher")).toBeNull();
  });
});

describe("kgVendidosDerivados — kg vendidos derivados de Mercadona + categoría segunda", () => {
  it("semana de Mercadona ENTERA dentro del rango: factor 1, kg = vendidoKg sin prorratear", () => {
    const { desde, hasta } = mercadonaWeekDateRange(2026, 10);

    const resultado = kgVendidosDerivados(
      { fechaInicio: desde, fechaFin: hasta },
      [{ anio: 2026, semana: 10, vendidoKg: 6000 }],
      [],
    );

    expect(resultado.semanas).toHaveLength(1);
    expect(resultado.semanas[0].factor).toBe(1);
    expect(resultado.mercadonaKg).toBe(6000);
    expect(resultado.segundaKg).toBe(0);
    expect(resultado.totalKg).toBe(6000);
    expect(resultado.tieneDatos).toBe(true);
  });

  it("semana de Mercadona PARTIDA por el rango: prorratea vendidoKg por dias solapados / 6", () => {
    const { desde } = mercadonaWeekDateRange(2026, 10);
    // La semana de Mercadona es lunes-sabado (6 dias). El rango solo cubre los
    // 3 primeros dias (lunes-miercoles) -> factor 3/6 = 0.5.
    const rangoFin = addDaysIso(desde, 2);

    const resultado = kgVendidosDerivados(
      { fechaInicio: desde, fechaFin: rangoFin },
      [{ anio: 2026, semana: 10, vendidoKg: 6000 }],
      [],
    );

    expect(resultado.semanas).toHaveLength(1);
    expect(resultado.semanas[0].factor).toBeCloseTo(0.5, 6);
    expect(resultado.mercadonaKg).toBeCloseTo(3000, 6);
    expect(resultado.totalKg).toBeCloseTo(3000, 6);
  });

  it("mes de categoria segunda ENTERO dentro del rango: factor 1, kg = kilos sin prorratear", () => {
    const resultado = kgVendidosDerivados(
      { fechaInicio: "2026-02-01", fechaFin: "2026-02-28" },
      [],
      [{ mes: "2026-02", kilos: 4000 }],
    );

    expect(resultado.meses).toHaveLength(1);
    expect(resultado.meses[0].factor).toBe(1);
    expect(resultado.segundaKg).toBe(4000);
    expect(resultado.mercadonaKg).toBe(0);
    expect(resultado.totalKg).toBe(4000);
  });

  it("mes de categoria segunda PARTIDO por el rango: prorratea kilos por dias solapados / dias del mes", () => {
    // Febrero 2026 (no bisiesto) tiene 28 dias; el rango solo cubre los primeros 14.
    const resultado = kgVendidosDerivados(
      { fechaInicio: "2026-02-01", fechaFin: "2026-02-14" },
      [],
      [{ mes: "2026-02", kilos: 4000 }],
    );

    expect(resultado.meses).toHaveLength(1);
    expect(resultado.meses[0].factor).toBeCloseTo(0.5, 6);
    expect(resultado.segundaKg).toBeCloseTo(2000, 6);
    expect(resultado.totalKg).toBeCloseTo(2000, 6);
  });

  it("suma varias filas de categoria segunda del MISMO mes (una por cliente) antes de prorratear", () => {
    const resultado = kgVendidosDerivados(
      { fechaInicio: "2026-02-01", fechaFin: "2026-02-28" },
      [],
      [
        { mes: "2026-02", kilos: 1000 },
        { mes: "2026-02", kilos: 500 },
      ],
    );

    expect(resultado.meses).toHaveLength(1);
    expect(resultado.segundaKg).toBe(1500);
  });

  it("combina Mercadona (semanal) y categoria segunda (mensual) en el mismo rango", () => {
    const { desde, hasta } = mercadonaWeekDateRange(2026, 6);

    const resultado = kgVendidosDerivados(
      { fechaInicio: desde, fechaFin: hasta },
      [{ anio: 2026, semana: 6, vendidoKg: 5000 }],
      [{ mes: desde.slice(0, 7), kilos: 2000 }],
    );

    expect(resultado.mercadonaKg).toBeGreaterThan(0);
    expect(resultado.segundaKg).toBeGreaterThan(0);
    expect(resultado.totalKg).toBeCloseTo(resultado.mercadonaKg + resultado.segundaKg, 6);
  });

  it("rango sin datos que solapen: no revienta, devuelve todo a 0 y tieneDatos false", () => {
    const resultado = kgVendidosDerivados(
      { fechaInicio: "2025-01-01", fechaFin: "2025-01-31" },
      [{ anio: 2026, semana: 10, vendidoKg: 6000 }],
      [{ mes: "2026-02", kilos: 4000 }],
    );

    expect(resultado.semanas).toEqual([]);
    expect(resultado.meses).toEqual([]);
    expect(resultado.mercadonaKg).toBe(0);
    expect(resultado.segundaKg).toBe(0);
    expect(resultado.totalKg).toBe(0);
    expect(resultado.tieneDatos).toBe(false);
  });

  it("rango sin ninguna fuente pasada (arrays vacios): tieneDatos false", () => {
    const resultado = kgVendidosDerivados({ fechaInicio: "2026-02-01", fechaFin: "2026-02-28" }, [], []);
    expect(resultado.tieneDatos).toBe(false);
    expect(resultado.totalKg).toBe(0);
  });

  it("ignora semanas/meses con kg/kilos nulos, negativos o cero", () => {
    const resultado = kgVendidosDerivados(
      { fechaInicio: "2026-02-01", fechaFin: "2026-02-28" },
      [
        { anio: 2026, semana: 6, vendidoKg: null },
        { anio: 2026, semana: 7, vendidoKg: 0 },
        { anio: 2026, semana: 8, vendidoKg: -100 },
      ],
      [{ mes: "2026-02", kilos: null }, { mes: "2026-03", kilos: 0 }],
    );

    expect(resultado.semanas).toEqual([]);
    expect(resultado.meses).toEqual([]);
    expect(resultado.tieneDatos).toBe(false);
  });

  it("ignora filas de categoria segunda sin mes", () => {
    const resultado = kgVendidosDerivados(
      { fechaInicio: "2026-02-01", fechaFin: "2026-02-28" },
      [],
      [{ mes: null, kilos: 4000 }],
    );

    expect(resultado.meses).toEqual([]);
    expect(resultado.tieneDatos).toBe(false);
  });
});

/** Suma dias en formato "YYYY-MM-DD" (rango de prueba corto, sin cruzar cambio de horario). */
function addDaysIso(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const d = new Date(year, month - 1, day, 12, 0, 0);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

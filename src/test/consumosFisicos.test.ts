import { describe, expect, it } from "vitest";
import {
  buildDailyWaterMeterConsumo,
  buildDailyWaterMeterConsumoFromReading,
  buildDailyConsumptionRows,
  findPreviousWaterMeterReading,
  buildMonthlyConsumptionRows,
  buildWeeklyConsumptionRows,
  kgProducidosParte,
  normalizeConsumoCantidad,
  parseWaterMeterReadingM3,
  parseConsumoNumber,
} from "@/lib/consumosFisicos";
import {
  FACTURAS_CAMPANA_2024_2025_RANGE,
  buildCampana2024_2025BasesKgRows,
  buildFacturasCampana2024_2025Rows,
} from "@/lib/facturasCampana2024_2025";
import {
  FACTURAS_CAMPANA_2025_2026_RANGE,
  buildCampana2025_2026BasesKgRows,
  buildFacturasCampana2025_2026Rows,
} from "@/lib/facturasCampana2025_2026";
import { buildPaletsDesdeCampana2024BasesKgRows } from "@/lib/paletsDesdeCampana2024";

describe("consumos fisicos helpers", () => {
  it("normalizes physical units", () => {
    expect(normalizeConsumoCantidad({ recurso: "agua", cantidad: 3, unidad: "m3" })).toEqual({
      cantidadBase: 3000,
      unidadBase: "l",
    });
    expect(normalizeConsumoCantidad({ recurso: "electricidad", cantidad: 125, unidad: "kwh" })).toEqual({
      cantidadBase: 125,
      unidadBase: "kwh",
    });
  });

  it("parses water liter inputs written with Spanish decimal separators", () => {
    expect(parseConsumoNumber("1234")).toBe(1234);
    expect(parseConsumoNumber("1.234,5")).toBe(1234.5);
    expect(parseConsumoNumber("1,5")).toBe(1.5);
    expect(parseConsumoNumber("1 234,5")).toBe(1234.5);
    expect(parseConsumoNumber("")).toBe(0);
  });

  it("builds a daily water meter consumption from general, treatment line and drencher readings", () => {
    expect(buildDailyWaterMeterConsumo({
      fecha: "2026-06-19",
      contadorGeneralL: 1234.5,
      lineaTratamientoL: 200,
      drencherL: 35,
    })).toEqual({
      recurso: "agua",
      fecha_inicio: "2026-06-19",
      fecha_fin: "2026-06-19",
      cantidad: 1234.5,
      unidad: "l",
      fuente: "contador",
      referencia: "agua-contador-general",
      notas: "Contador general: 1234.5 L. Linea tratamiento: 200 L. Drencher: 35 L.",
    });
  });

  it("builds daily water consumption from cumulative meter readings", () => {
    expect(buildDailyWaterMeterConsumoFromReading({
      fecha: "2026-06-20",
      lecturaContadorM3: 38662.5,
      lecturaAnteriorM3: 38659,
      fechaLecturaAnterior: "2026-06-19",
      lineaTratamientoL: 120,
      drencherL: 30,
    })).toEqual({
      recurso: "agua",
      // El delta entre la foto del 19 y la del 20 es el consumo del día 19.
      fecha_inicio: "2026-06-19",
      fecha_fin: "2026-06-19",
      cantidad: 3500,
      unidad: "l",
      fuente: "contador",
      referencia: "agua-contador-general",
      notas: "Lectura contador: 38662.5 m3 (foto del 2026-06-20). Lectura anterior: 38659 m3 (2026-06-19). Consumo calculado: 3500 L. Linea tratamiento: 120 L. Drencher: 30 L.",
    });
  });

  it("stores the first cumulative water meter reading as a zero-consumption baseline", () => {
    const consumo = buildDailyWaterMeterConsumoFromReading({
      fecha: "2026-06-19",
      lecturaContadorM3: 38659,
    });

    expect(consumo.cantidad).toBe(0);
    expect(consumo.notas).toContain("Lectura anterior: sin referencia.");
    expect(parseWaterMeterReadingM3(consumo)).toBe(38659);
  });

  it("finds the previous cumulative water meter reading before a date", () => {
    const consumos = [
      buildDailyWaterMeterConsumoFromReading({
        fecha: "2026-06-19",
        lecturaContadorM3: 38659,
      }),
      buildDailyWaterMeterConsumoFromReading({
        fecha: "2026-06-20",
        lecturaContadorM3: 38662.5,
        lecturaAnteriorM3: 38659,
        fechaLecturaAnterior: "2026-06-19",
      }),
      buildDailyWaterMeterConsumo({
        fecha: "2026-06-21",
        contadorGeneralL: 1200,
      }),
    ].map((row, index) => ({ ...row, id: `row-${index}` }));

    expect(findPreviousWaterMeterReading(consumos, "2026-06-21")).toMatchObject({
      fecha: "2026-06-20",
      lecturaM3: 38662.5,
      consumoL: 3500,
    });
  });

  it("uses the final invoice meter reading as the previous reading for the first manual reading", () => {
    const previous = findPreviousWaterMeterReading([
      {
        id: "factura-agua",
        recurso: "agua",
        fecha_inicio: "2026-02-19",
        fecha_fin: "2026-04-23",
        cantidad: 420,
        unidad: "m3",
        fuente: "factura_detallada",
        referencia: "P0005464",
        notas: "Lecturas: 38239 -> 38659. Rango lectura: 2026-02-19 -> 2026-04-23.",
      },
    ], "2026-06-25");

    expect(previous).toMatchObject({
      fecha: "2026-04-23",
      lecturaM3: 38659,
      consumoL: 420000,
    });

    expect(buildDailyWaterMeterConsumoFromReading({
      fecha: "2026-06-25",
      lecturaContadorM3: 38662.5,
      lecturaAnteriorM3: previous?.lecturaM3,
      fechaLecturaAnterior: previous?.fecha,
    }).cantidad).toBe(3500);
  });

  it("uses the existing production kg formula from partes", () => {
    expect(kgProducidosParte({
      date: "2026-04-05",
      kg_produccion_calibrador: 10000,
      kg_mujeres_calibrador: 500,
      kg_reciclado_malla_z1: 300,
      kg_reciclado_malla_z2: 200,
    })).toBe(9000);
  });

  it("uses the audited cascade real production from partes when available", () => {
    expect(kgProducidosParte({
      date: "2026-04-05",
      resumen_ia: { cascada: { produccion_real: 86750 } },
      kg_produccion_calibrador: 100000,
      kg_mujeres_calibrador: 5000,
      kg_reciclado_malla_z1: 3000,
      kg_reciclado_malla_z2: 2000,
    })).toBe(86750);
  });

  it("builds real monthly ratios from partes kg", () => {
    const rows = buildMonthlyConsumptionRows({
      rangeStart: "2026-04-01",
      rangeEnd: "2026-04-30",
      consumos: [
        { id: "agua-1", recurso: "agua", fecha_inicio: "2026-04-01", fecha_fin: "2026-04-30", cantidad: 3000, unidad: "l", fuente: "contador" },
        { id: "luz-1", recurso: "electricidad", fecha_inicio: "2026-04-01", fecha_fin: "2026-04-30", cantidad: 1500, unidad: "kwh", fuente: "contador" },
        { id: "gas-1", recurso: "gasoil", fecha_inicio: "2026-04-01", fecha_fin: "2026-04-30", cantidad: 450, unidad: "l", fuente: "albaran" },
      ],
      partes: [
        { date: "2026-04-05", kg_produccion_calibrador: 10000, kg_mujeres_calibrador: 500, kg_reciclado_malla_z1: 300, kg_reciclado_malla_z2: 200 },
        { date: "2026-04-06", kg_produccion_calibrador: 6000, kg_mujeres_calibrador: 0, kg_reciclado_malla_z1: 0, kg_reciclado_malla_z2: 0 },
      ],
      basesKg: [],
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].confianza).toBe("real");
    expect(rows[0].kgBase).toBe(15000);
    expect(rows[0].aguaLKg).toBeCloseTo(0.2);
    expect(rows[0].electricidadKwhKg).toBeCloseTo(0.1);
    expect(rows[0].gasoilMlKg).toBeCloseTo(30);
    expect(rows[0].gasoilLT).toBeCloseTo(30);
  });

  it("prorates consumption and kg bases across overlapping month days", () => {
    const rows = buildMonthlyConsumptionRows({
      rangeStart: "2026-03-15",
      rangeEnd: "2026-04-15",
      consumos: [
        { id: "agua-bimensual", recurso: "agua", fecha_inicio: "2026-03-15", fecha_fin: "2026-04-15", cantidad: 3200, unidad: "l", fuente: "contador" },
      ],
      partes: [],
      basesKg: [
        { id: "ventas-bimensual", tipo_base: "ventas", fecha_inicio: "2026-03-15", fecha_fin: "2026-04-15", kg: 32000 },
      ],
    });

    expect(rows).toHaveLength(2);
    expect(rows[0].periodo).toBe("2026-03");
    expect(rows[0].aguaL).toBeCloseTo(1700);
    expect(rows[0].kgBase).toBeCloseTo(17000);
    expect(rows[0].aguaLKg).toBeCloseTo(0.1);
    expect(rows[0].confianza).toBe("estimado");
    expect(rows[1].periodo).toBe("2026-04");
    expect(rows[1].aguaL).toBeCloseTo(1500);
    expect(rows[1].kgBase).toBeCloseTo(15000);
    expect(rows[1].aguaLKg).toBeCloseTo(0.1);
    expect(rows[1].confianza).toBe("estimado");
  });

  it("spreads water invoice totals by daily parte kg when partes exist inside the invoice range", () => {
    const dailyRows = buildDailyConsumptionRows({
      rangeStart: "2026-01-01",
      rangeEnd: "2026-01-04",
      consumos: [
        { id: "agua-bimensual", recurso: "agua", fecha_inicio: "2026-01-01", fecha_fin: "2026-01-04", cantidad: 100, unidad: "m3", fuente: "factura_detallada" },
      ],
      partes: [
        { date: "2026-01-01", kg_produccion_calibrador: 1000, kg_mujeres_calibrador: 0, kg_reciclado_malla_z1: 0, kg_reciclado_malla_z2: 0 },
        { date: "2026-01-02", kg_produccion_calibrador: 3000, kg_mujeres_calibrador: 0, kg_reciclado_malla_z1: 0, kg_reciclado_malla_z2: 0 },
        { date: "2026-01-03", kg_produccion_calibrador: 0, kg_mujeres_calibrador: 0, kg_reciclado_malla_z1: 0, kg_reciclado_malla_z2: 0 },
        { date: "2026-01-04", kg_produccion_calibrador: 6000, kg_mujeres_calibrador: 0, kg_reciclado_malla_z1: 0, kg_reciclado_malla_z2: 0 },
      ],
      basesKg: [],
    });

    expect(dailyRows.map((row) => row.aguaL)).toEqual([
      10000,
      30000,
      0,
      60000,
    ]);
    expect(dailyRows.reduce((total, row) => total + row.aguaL, 0)).toBeCloseTo(100000);
    expect(dailyRows[0].aguaLKg).toBeCloseTo(10);
    expect(dailyRows[1].aguaLKg).toBeCloseTo(10);
    expect(dailyRows[2].aguaLKg).toBeNull();
    expect(dailyRows[3].aguaLKg).toBeCloseTo(10);
  });

  it("spreads water by audited daily cascade kg instead of raw calibrator kg", () => {
    const dailyRows = buildDailyConsumptionRows({
      rangeStart: "2026-01-01",
      rangeEnd: "2026-01-02",
      consumos: [
        { id: "agua-bimensual", recurso: "agua", fecha_inicio: "2026-01-01", fecha_fin: "2026-01-02", cantidad: 100, unidad: "m3", fuente: "factura_detallada" },
      ],
      partes: [
        {
          date: "2026-01-01",
          resumen_ia: { cascada: { produccion_real: 1000 } },
          kg_produccion_calibrador: 10000,
          kg_mujeres_calibrador: 0,
          kg_reciclado_malla_z1: 0,
          kg_reciclado_malla_z2: 0,
        },
        {
          date: "2026-01-02",
          resumen_ia: { cascada: { produccion_real: 3000 } },
          kg_produccion_calibrador: 10000,
          kg_mujeres_calibrador: 0,
          kg_reciclado_malla_z1: 0,
          kg_reciclado_malla_z2: 0,
        },
      ],
      basesKg: [],
    });

    expect(dailyRows.map((row) => row.aguaL)).toEqual([
      25000,
      75000,
    ]);
    expect(dailyRows[0].kgBase).toBe(1000);
    expect(dailyRows[1].kgBase).toBe(3000);
  });

  it("uses exact daily general meter readings before allocating the remaining invoice water", () => {
    const dailyRows = buildDailyConsumptionRows({
      rangeStart: "2026-01-01",
      rangeEnd: "2026-01-04",
      consumos: [
        { id: "factura-agua", recurso: "agua", fecha_inicio: "2026-01-01", fecha_fin: "2026-01-04", cantidad: 100, unidad: "m3", fuente: "factura_detallada" },
        { id: "contador-02", recurso: "agua", fecha_inicio: "2026-01-02", fecha_fin: "2026-01-02", cantidad: 30000, unidad: "l", fuente: "contador" },
        { id: "contador-04", recurso: "agua", fecha_inicio: "2026-01-04", fecha_fin: "2026-01-04", cantidad: 10000, unidad: "l", fuente: "contador" },
      ],
      partes: [
        { date: "2026-01-01", kg_produccion_calibrador: 1000, kg_mujeres_calibrador: 0, kg_reciclado_malla_z1: 0, kg_reciclado_malla_z2: 0 },
        { date: "2026-01-02", kg_produccion_calibrador: 3000, kg_mujeres_calibrador: 0, kg_reciclado_malla_z1: 0, kg_reciclado_malla_z2: 0 },
        { date: "2026-01-03", kg_produccion_calibrador: 2000, kg_mujeres_calibrador: 0, kg_reciclado_malla_z1: 0, kg_reciclado_malla_z2: 0 },
        { date: "2026-01-04", kg_produccion_calibrador: 4000, kg_mujeres_calibrador: 0, kg_reciclado_malla_z1: 0, kg_reciclado_malla_z2: 0 },
      ],
      basesKg: [],
    });

    expect(dailyRows.map((row) => row.aguaL)).toEqual([
      20000,
      30000,
      40000,
      10000,
    ]);
    expect(dailyRows.reduce((total, row) => total + row.aguaL, 0)).toBeCloseTo(100000);
  });

  it("spreads water invoice totals by sales kg when daily partes are not available", () => {
    const rows = buildMonthlyConsumptionRows({
      rangeStart: "2026-03-01",
      rangeEnd: "2026-04-30",
      consumos: [
        { id: "agua-marzo-abril", recurso: "agua", fecha_inicio: "2026-03-01", fecha_fin: "2026-04-30", cantidad: 100, unidad: "m3", fuente: "factura_detallada" },
      ],
      partes: [],
      basesKg: [
        { id: "ventas-marzo", tipo_base: "ventas", fecha_inicio: "2026-03-01", fecha_fin: "2026-03-31", kg: 1000 },
        { id: "ventas-abril", tipo_base: "ventas", fecha_inicio: "2026-04-01", fecha_fin: "2026-04-30", kg: 3000 },
      ],
    });

    expect(rows.map((row) => row.periodo)).toEqual(["2026-03", "2026-04"]);
    expect(rows[0].aguaL).toBeCloseTo(25000);
    expect(rows[1].aguaL).toBeCloseTo(75000);
    expect(rows[0].aguaLKg).toBeCloseTo(25);
    expect(rows[1].aguaLKg).toBeCloseTo(25);
  });

  it("does not use monthly sales kg as an exact weekly base", () => {
    const rows = buildWeeklyConsumptionRows({
      rangeStart: "2026-03-01",
      rangeEnd: "2026-03-14",
      consumos: [
        { id: "agua-marzo", recurso: "agua", fecha_inicio: "2026-03-01", fecha_fin: "2026-03-31", cantidad: 100, unidad: "m3", fuente: "factura_detallada" },
      ],
      partes: [],
      basesKg: [
        { id: "ventas-marzo", tipo_base: "ventas", fecha_inicio: "2026-03-01", fecha_fin: "2026-03-31", kg: 31000 },
      ],
    });

    expect(rows[0].kgVentas).toBe(0);
    expect(rows[0].kgBase).toBe(0);
    expect(rows[0].confianza).toBe("incompleto");
    expect(rows[0].aguaL).toBe(0);
  });

  it("can use an exact weekly kg base for a weekly consumption view", () => {
    const rows = buildWeeklyConsumptionRows({
      rangeStart: "2026-03-01",
      rangeEnd: "2026-03-07",
      consumos: [
        { id: "agua-semana", recurso: "agua", fecha_inicio: "2026-03-01", fecha_fin: "2026-03-07", cantidad: 10, unidad: "m3", fuente: "factura_detallada" },
      ],
      partes: [],
      basesKg: [
        { id: "ventas-semana", tipo_base: "ventas", fecha_inicio: "2026-03-01", fecha_fin: "2026-03-07", kg: 5000 },
      ],
    });

    expect(rows[0].kgVentas).toBe(5000);
    expect(rows[0].kgBase).toBe(5000);
    expect(rows[0].aguaL).toBe(10000);
    expect(rows[0].aguaLKg).toBe(2);
  });

  it("uses daily pallet kg as an exact weekly and monthly base", () => {
    const input = {
      rangeStart: "2026-03-01",
      rangeEnd: "2026-03-02",
      consumos: [
        { id: "agua-palets", recurso: "agua" as const, fecha_inicio: "2026-03-01", fecha_fin: "2026-03-02", cantidad: 100, unidad: "m3" as const, fuente: "factura_detallada" as const },
      ],
      partes: [],
      basesKg: [
        { id: "palets-1", tipo_base: "palets" as const, fecha_inicio: "2026-03-01", fecha_fin: "2026-03-01", kg: 1000 },
        { id: "palets-2", tipo_base: "palets" as const, fecha_inicio: "2026-03-02", fecha_fin: "2026-03-02", kg: 3000 },
      ],
    };

    const weekly = buildWeeklyConsumptionRows(input);
    const monthly = buildMonthlyConsumptionRows(input);
    const daily = buildDailyConsumptionRows(input);

    expect(weekly[0].kgPalets).toBe(4000);
    expect(weekly[0].aguaL).toBe(100000);
    expect(monthly[0].kgPalets).toBe(4000);
    expect(monthly[0].aguaL).toBe(100000);
    expect(daily.map((row) => row.kgPalets)).toEqual([1000, 3000]);
    expect(daily.map((row) => row.aguaL)).toEqual([25000, 75000]);
  });

  it("does not dump a two-month water invoice into the only month with pallet kg", () => {
    const rows = buildMonthlyConsumptionRows({
      rangeStart: "2025-09-01",
      rangeEnd: "2025-10-31",
      consumos: [
        { id: "agua-sep-oct", recurso: "agua", fecha_inicio: "2025-09-01", fecha_fin: "2025-10-31", cantidad: 190, unidad: "m3", fuente: "factura_detallada" },
      ],
      partes: [],
      basesKg: [
        { id: "palets-octubre", tipo_base: "palets", fecha_inicio: "2025-10-01", fecha_fin: "2025-10-01", kg: 75760 },
      ],
    });

    expect(rows.map((row) => row.aguaL)).toEqual([0, 0]);
    expect(rows[0].issues).toContain("Sin kg base para calcular ratios");
    expect(rows[1].issues).toContain("Sin consumo fisico registrado");
  });

  it("does not use weekly kg as an exact daily base", () => {
    const rows = buildDailyConsumptionRows({
      rangeStart: "2026-03-01",
      rangeEnd: "2026-03-02",
      consumos: [
        { id: "agua-semana", recurso: "agua", fecha_inicio: "2026-03-01", fecha_fin: "2026-03-07", cantidad: 10, unidad: "m3", fuente: "factura_detallada" },
      ],
      partes: [],
      basesKg: [
        { id: "ventas-semana", tipo_base: "ventas", fecha_inicio: "2026-03-01", fecha_fin: "2026-03-07", kg: 5000 },
      ],
    });

    expect(rows[0].kgVentas).toBe(0);
    expect(rows[0].kgBase).toBe(0);
    expect(rows[0].aguaL).toBe(0);
  });

  it("does not split a real March-April water invoice equally when monthly kg differ", () => {
    const rows = buildMonthlyConsumptionRows({
      rangeStart: "2025-03-01",
      rangeEnd: "2025-04-30",
      consumos: [
        { id: "agua-marzo-abril-2025", recurso: "agua", fecha_inicio: "2025-03-01", fecha_fin: "2025-04-30", cantidad: 947, unidad: "m3", fuente: "factura_detallada" },
      ],
      partes: [],
      basesKg: [
        { id: "ventas-marzo-2025", tipo_base: "ventas", fecha_inicio: "2025-03-01", fecha_fin: "2025-03-31", kg: 2862926 },
        { id: "ventas-abril-2025", tipo_base: "ventas", fecha_inicio: "2025-04-01", fecha_fin: "2025-04-30", kg: 2596633 },
      ],
    });

    expect(rows.map((row) => row.periodo)).toEqual(["2025-03", "2025-04"]);
    expect(rows[0].aguaL).toBeCloseTo(496595.2235);
    expect(rows[1].aguaL).toBeCloseTo(450404.7765);
    expect(rows[0].aguaL).not.toBeCloseTo(rows[1].aguaL);
  });

  it("allocates the full 2024/2025 campaign water invoices by monthly sold kg", () => {
    const rows = buildMonthlyConsumptionRows({
      rangeStart: FACTURAS_CAMPANA_2024_2025_RANGE.fechaInicio,
      rangeEnd: FACTURAS_CAMPANA_2024_2025_RANGE.fechaFin,
      consumos: buildFacturasCampana2024_2025Rows("user-1"),
      partes: [],
      basesKg: buildCampana2024_2025BasesKgRows("user-1"),
    });

    const byPeriod = Object.fromEntries(rows.map((row) => [row.periodo, row]));

    expect(rows.reduce((total, row) => total + row.aguaL, 0)).toBeCloseTo(3005000);
    expect(byPeriod["2025-03"].kgVentas).toBe(2862926);
    expect(byPeriod["2025-04"].kgVentas).toBe(2596633);
    expect(byPeriod["2025-03"].aguaL).toBeCloseTo(496595.2235);
    expect(byPeriod["2025-04"].aguaL).toBeCloseTo(450404.7765);
    expect(byPeriod["2025-05"].aguaL).toBeCloseTo(276380.4529);
    expect(byPeriod["2025-06"].aguaL).toBeCloseTo(231619.5471);
  });

  it("allocates only invoiced 2025/2026 water and leaves May-June pending until that invoice exists", () => {
    const rows = buildMonthlyConsumptionRows({
      rangeStart: FACTURAS_CAMPANA_2025_2026_RANGE.fechaInicio,
      rangeEnd: "2026-06-30",
      consumos: buildFacturasCampana2025_2026Rows("user-1"),
      partes: [],
      basesKg: buildCampana2025_2026BasesKgRows("user-1"),
    });

    const byPeriod = Object.fromEntries(rows.map((row) => [row.periodo, row]));

    expect(rows.reduce((total, row) => total + row.aguaL, 0)).toBeCloseTo(1466000);
    expect(byPeriod["2026-03"].kgVentas).toBe(2665698);
    expect(byPeriod["2026-04"].kgVentas).toBeCloseTo(2223978.73);
    expect(byPeriod["2026-03"].aguaL).toBeCloseTo(228970.7933);
    expect(byPeriod["2026-04"].aguaL).toBeCloseTo(191029.2067);
    expect(byPeriod["2026-05"].aguaL).toBe(0);
    expect(byPeriod["2026-06"].aguaL).toBe(0);
  });

  it("does not create round monthly water artifacts or a March spike in the current campaign", () => {
    const rows = buildMonthlyConsumptionRows({
      rangeStart: FACTURAS_CAMPANA_2025_2026_RANGE.fechaInicio,
      rangeEnd: "2026-06-30",
      consumos: buildFacturasCampana2025_2026Rows("user-1"),
      partes: [],
      basesKg: [
        ...buildCampana2025_2026BasesKgRows("user-1"),
        ...buildPaletsDesdeCampana2024BasesKgRows("user-1"),
      ],
    });

    const byPeriod = Object.fromEntries(rows.map((row) => [row.periodo, row]));

    expect(byPeriod["2025-09"].aguaL).toBeCloseTo(121058.7192);
    expect(byPeriod["2025-10"].aguaL).toBeCloseTo(68941.2808);
    expect(byPeriod["2025-10"].aguaL).not.toBe(190000);
    expect(byPeriod["2026-03"].aguaL).toBeCloseTo(228970.7933);
    expect(byPeriod["2026-03"].aguaL).toBeLessThan(250000);
  });

  it("treats non-finite input numbers as zero", () => {
    const rows = buildMonthlyConsumptionRows({
      rangeStart: "2026-05-01",
      rangeEnd: "2026-05-31",
      consumos: [
        { id: "agua-nan", recurso: "agua", fecha_inicio: "2026-05-01", fecha_fin: "2026-05-31", cantidad: Number.NaN, unidad: "l", fuente: "contador" },
        { id: "luz-infinita", recurso: "electricidad", fecha_inicio: "2026-05-01", fecha_fin: "2026-05-31", cantidad: Number.POSITIVE_INFINITY, unidad: "kwh", fuente: "contador" },
      ],
      partes: [
        { date: "2026-05-10", kg_produccion_calibrador: Number.NaN, kg_mujeres_calibrador: Number.POSITIVE_INFINITY, kg_reciclado_malla_z1: 0, kg_reciclado_malla_z2: 0 },
      ],
      basesKg: [
        { id: "ventas-nan", tipo_base: "ventas", fecha_inicio: "2026-05-01", fecha_fin: "2026-05-31", kg: Number.NaN },
      ],
    });

    expect(Number.isNaN(rows[0].aguaL)).toBe(false);
    expect(Number.isNaN(rows[0].electricidadKwh)).toBe(false);
    expect(Number.isNaN(rows[0].kgBase)).toBe(false);
    expect(rows[0].aguaL).toBe(0);
    expect(rows[0].electricidadKwh).toBe(0);
    expect(rows[0].kgBase).toBe(0);
  });

  it("uses kg sold as estimated base when no partes exist", () => {
    const rows = buildMonthlyConsumptionRows({
      rangeStart: "2026-03-01",
      rangeEnd: "2026-03-31",
      consumos: [
        { id: "agua-marzo", recurso: "agua", fecha_inicio: "2026-03-01", fecha_fin: "2026-03-31", cantidad: 2, unidad: "m3", fuente: "factura_detallada" },
      ],
      partes: [],
      basesKg: [
        { id: "ventas-marzo", tipo_base: "ventas", fecha_inicio: "2026-03-01", fecha_fin: "2026-03-31", kg: 10000 },
      ],
    });

    expect(rows[0].confianza).toBe("estimado");
    expect(rows[0].kgBase).toBe(10000);
    expect(rows[0].aguaLKg).toBeCloseTo(0.2);
  });

  it("marks a month as mixed when partes and proxy kg coexist", () => {
    const rows = buildMonthlyConsumptionRows({
      rangeStart: "2026-04-01",
      rangeEnd: "2026-04-30",
      consumos: [
        { id: "gas-abril", recurso: "gasoil", fecha_inicio: "2026-04-01", fecha_fin: "2026-04-30", cantidad: 300, unidad: "l", fuente: "albaran" },
      ],
      partes: [
        { date: "2026-04-15", kg_produccion_calibrador: 12000, kg_mujeres_calibrador: 0, kg_reciclado_malla_z1: 0, kg_reciclado_malla_z2: 0 },
      ],
      basesKg: [
        { id: "ventas-abril", tipo_base: "ventas", fecha_inicio: "2026-04-01", fecha_fin: "2026-04-30", kg: 8000 },
      ],
    });

    expect(rows[0].confianza).toBe("mixto");
    expect(rows[0].kgBase).toBe(12000);
    expect(rows[0].kgVentas).toBe(8000);
  });

  it("marks incomplete rows when consumption or kg base is missing", () => {
    const rows = buildMonthlyConsumptionRows({
      rangeStart: "2026-02-01",
      rangeEnd: "2026-02-28",
      consumos: [],
      partes: [],
      basesKg: [],
    });

    expect(rows[0].confianza).toBe("incompleto");
    expect(rows[0].issues).toContain("Sin consumo fisico registrado");
    expect(rows[0].issues).toContain("Sin kg base para calcular ratios");
  });

  it("builds campaign weekly rows from the campaign start date", () => {
    const rows = buildWeeklyConsumptionRows({
      rangeStart: "2025-09-01",
      rangeEnd: "2025-09-15",
      consumos: [
        { id: "agua-septiembre", recurso: "agua", fecha_inicio: "2025-09-01", fecha_fin: "2025-09-15", cantidad: 800, unidad: "l", fuente: "contador" },
      ],
      partes: [
        { date: "2025-09-01", kg_produccion_calibrador: 1000, kg_mujeres_calibrador: 0, kg_reciclado_malla_z1: 0, kg_reciclado_malla_z2: 0 },
        { date: "2025-09-08", kg_produccion_calibrador: 500, kg_mujeres_calibrador: 0, kg_reciclado_malla_z1: 0, kg_reciclado_malla_z2: 0 },
        { date: "2025-09-15", kg_produccion_calibrador: 500, kg_mujeres_calibrador: 0, kg_reciclado_malla_z1: 0, kg_reciclado_malla_z2: 0 },
      ],
      basesKg: [],
    });

    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({
      periodo: "S01",
      fechaInicio: "2025-09-01",
      fechaFin: "2025-09-07",
      kgBase: 1000,
    });
    expect(rows[0].aguaL).toBeCloseTo(400);
    expect(rows[1]).toMatchObject({
      periodo: "S02",
      fechaInicio: "2025-09-08",
      fechaFin: "2025-09-14",
      kgBase: 500,
    });
    expect(rows[1].aguaL).toBeCloseTo(200);
    expect(rows[2]).toMatchObject({
      periodo: "S03",
      fechaInicio: "2025-09-15",
      fechaFin: "2025-09-15",
      kgBase: 500,
    });
    expect(rows[2].aguaL).toBeCloseTo(200);
  });

  it("can split the same imported period into monthly, weekly and daily totals", () => {
    const input = {
      rangeStart: "2026-06-08",
      rangeEnd: "2026-06-14",
      consumos: [
        { id: "gasoil-semana", recurso: "gasoil" as const, fecha_inicio: "2026-06-08", fecha_fin: "2026-06-14", cantidad: 700, unidad: "l" as const, fuente: "albaran" as const },
      ],
      partes: [
        { date: "2026-06-08", kg_produccion_calibrador: 1000, kg_mujeres_calibrador: 0, kg_reciclado_malla_z1: 0, kg_reciclado_malla_z2: 0 },
        { date: "2026-06-09", kg_produccion_calibrador: 1000, kg_mujeres_calibrador: 0, kg_reciclado_malla_z1: 0, kg_reciclado_malla_z2: 0 },
        { date: "2026-06-10", kg_produccion_calibrador: 1000, kg_mujeres_calibrador: 0, kg_reciclado_malla_z1: 0, kg_reciclado_malla_z2: 0 },
        { date: "2026-06-11", kg_produccion_calibrador: 1000, kg_mujeres_calibrador: 0, kg_reciclado_malla_z1: 0, kg_reciclado_malla_z2: 0 },
        { date: "2026-06-12", kg_produccion_calibrador: 1000, kg_mujeres_calibrador: 0, kg_reciclado_malla_z1: 0, kg_reciclado_malla_z2: 0 },
        { date: "2026-06-13", kg_produccion_calibrador: 1000, kg_mujeres_calibrador: 0, kg_reciclado_malla_z1: 0, kg_reciclado_malla_z2: 0 },
        { date: "2026-06-14", kg_produccion_calibrador: 1000, kg_mujeres_calibrador: 0, kg_reciclado_malla_z1: 0, kg_reciclado_malla_z2: 0 },
      ],
      basesKg: [
        { id: "ventas-semana", tipo_base: "ventas" as const, fecha_inicio: "2026-06-08", fecha_fin: "2026-06-14", kg: 7000 },
      ],
    };
    const monthly = buildMonthlyConsumptionRows(input);
    const weekly = buildWeeklyConsumptionRows(input);
    const daily = buildDailyConsumptionRows(input);

    expect(monthly).toHaveLength(1);
    expect(weekly).toHaveLength(1);
    expect(daily).toHaveLength(7);
    expect(weekly[0].periodo).toBe("S01");
    expect(weekly[0].gasoilL).toBeCloseTo(700);
    expect(weekly[0].kgBase).toBeCloseTo(7000);
    expect(daily.reduce((total, row) => total + row.gasoilL, 0)).toBeCloseTo(weekly[0].gasoilL);
    expect(daily.reduce((total, row) => total + row.kgBase, 0)).toBeCloseTo(weekly[0].kgBase);
  });

  it("spreads gasoil purchases over kg produced until the next purchase", () => {
    const dailyParts = [
      ["2026-01-01", 100],
      ["2026-01-02", 100],
      ["2026-01-03", 100],
      ["2026-01-04", 100],
      ["2026-01-05", 120],
      ["2026-01-06", 120],
      ["2026-01-07", 120],
      ["2026-01-08", 120],
      ["2026-01-09", 120],
      ["2026-01-10", 100],
      ["2026-01-11", 100],
      ["2026-01-12", 100],
      ["2026-01-13", 100],
      ["2026-01-14", 100],
    ] as const;

    const rows = buildWeeklyConsumptionRows({
      rangeStart: "2026-01-01",
      rangeEnd: "2026-01-14",
      consumos: [
        { id: "gasoil-1", recurso: "gasoil", fecha_inicio: "2026-01-01", fecha_fin: "2026-01-01", cantidad: 900, unidad: "l", fuente: "factura_detallada" },
        { id: "gasoil-2", recurso: "gasoil", fecha_inicio: "2026-01-10", fecha_fin: "2026-01-10", cantidad: 300, unidad: "l", fuente: "factura_detallada" },
      ],
      partes: dailyParts.map(([date, kg]) => ({
        date,
        kg_produccion_calibrador: kg,
        kg_mujeres_calibrador: 0,
        kg_reciclado_malla_z1: 0,
        kg_reciclado_malla_z2: 0,
      })),
      basesKg: [],
    });

    expect(rows.map((row) => row.periodo)).toEqual(["S01", "S02"]);
    expect(rows[0].gasoilL).toBeCloseTo(684);
    expect(rows[1].gasoilL).toBeCloseTo(516);
    expect(rows.reduce((total, row) => total + row.gasoilL, 0)).toBeCloseTo(1200);
  });
});

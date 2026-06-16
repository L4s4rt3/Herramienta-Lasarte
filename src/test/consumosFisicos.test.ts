import { describe, expect, it } from "vitest";
import {
  buildDailyConsumptionRows,
  buildMonthlyConsumptionRows,
  buildWeeklyConsumptionRows,
  kgProducidosParte,
  normalizeConsumoCantidad,
} from "@/lib/consumosFisicos";

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

  it("uses the existing production kg formula from partes", () => {
    expect(kgProducidosParte({
      date: "2026-04-05",
      kg_produccion_calibrador: 10000,
      kg_mujeres_calibrador: 500,
      kg_reciclado_malla_z1: 300,
      kg_reciclado_malla_z2: 200,
    })).toBe(9000);
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

  it("builds ISO weekly rows with week 24 from 2026-06-08 to 2026-06-14 and week 25 from 2026-06-15", () => {
    const rows = buildWeeklyConsumptionRows({
      rangeStart: "2026-06-08",
      rangeEnd: "2026-06-15",
      consumos: [
        { id: "agua-junio", recurso: "agua", fecha_inicio: "2026-06-08", fecha_fin: "2026-06-15", cantidad: 800, unidad: "l", fuente: "contador" },
      ],
      partes: [
        { date: "2026-06-08", kg_produccion_calibrador: 1000, kg_mujeres_calibrador: 0, kg_reciclado_malla_z1: 0, kg_reciclado_malla_z2: 0 },
        { date: "2026-06-15", kg_produccion_calibrador: 500, kg_mujeres_calibrador: 0, kg_reciclado_malla_z1: 0, kg_reciclado_malla_z2: 0 },
      ],
      basesKg: [],
    });

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      periodo: "2026-W24",
      fechaInicio: "2026-06-08",
      fechaFin: "2026-06-14",
      kgBase: 1000,
    });
    expect(rows[0].aguaL).toBeCloseTo(700);
    expect(rows[1]).toMatchObject({
      periodo: "2026-W25",
      fechaInicio: "2026-06-15",
      fechaFin: "2026-06-15",
      kgBase: 500,
    });
    expect(rows[1].aguaL).toBeCloseTo(100);
  });

  it("can split the same imported period into monthly, weekly and daily totals", () => {
    const input = {
      rangeStart: "2026-06-08",
      rangeEnd: "2026-06-14",
      consumos: [
        { id: "gasoil-semana", recurso: "gasoil" as const, fecha_inicio: "2026-06-08", fecha_fin: "2026-06-14", cantidad: 700, unidad: "l" as const, fuente: "albaran" as const },
      ],
      partes: [],
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
    expect(weekly[0].periodo).toBe("2026-W24");
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

    expect(rows.map((row) => row.periodo)).toEqual(["2026-W01", "2026-W02", "2026-W03"]);
    expect(rows[0].gasoilL).toBeCloseTo(360);
    expect(rows[1].gasoilL).toBeCloseTo(660);
    expect(rows[2].gasoilL).toBeCloseTo(180);
    expect(rows.reduce((total, row) => total + row.gasoilL, 0)).toBeCloseTo(1200);
  });
});

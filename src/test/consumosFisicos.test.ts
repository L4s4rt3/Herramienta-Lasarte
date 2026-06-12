import { describe, expect, it } from "vitest";
import {
  buildMonthlyConsumptionRows,
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
});

import { describe, expect, it } from "vitest";
import {
  CAMPANA_2025_2026_VENTAS_KG,
  FACTURAS_CAMPANA_2025_2026_AGUA_CONSUMOS,
  FACTURAS_CAMPANA_2025_2026_CONSUMOS,
  FACTURAS_CAMPANA_2025_2026_ELECTRICIDAD_CONSUMOS,
  FACTURAS_CAMPANA_2025_2026_RANGE,
  buildCampana2025_2026BasesKgRows,
  buildFacturasCampana2025_2026Rows,
  mergeCampana2025_2026BasesKg,
  mergeFacturasCampana2025_2026Consumos,
} from "@/lib/facturasCampana2025_2026";

describe("facturas campana 2025/2026", () => {
  it("ships the current campaign physical invoice rows", () => {
    const totalGasoilL = FACTURAS_CAMPANA_2025_2026_CONSUMOS.reduce((total, row) => total + row.litros, 0);
    const totalAguaM3 = FACTURAS_CAMPANA_2025_2026_AGUA_CONSUMOS.reduce((total, row) => total + row.m3, 0);
    const totalElectricidadKwh = FACTURAS_CAMPANA_2025_2026_ELECTRICIDAD_CONSUMOS.reduce((total, row) => total + row.kwh, 0);

    expect(FACTURAS_CAMPANA_2025_2026_RANGE).toEqual({
      id: "2025-2026",
      label: "Campana 2025/2026",
      fechaInicio: "2025-09-01",
      fechaFin: "2026-08-31",
    });
    expect(FACTURAS_CAMPANA_2025_2026_CONSUMOS).toHaveLength(32);
    expect(totalGasoilL).toBe(28929);
    expect(FACTURAS_CAMPANA_2025_2026_AGUA_CONSUMOS).toHaveLength(4);
    expect(totalAguaM3).toBe(1466);
    expect(FACTURAS_CAMPANA_2025_2026_ELECTRICIDAD_CONSUMOS).toHaveLength(9);
    expect(totalElectricidadKwh).toBe(526799);
  });

  it("converts current campaign invoices into user-scoped physical consumption rows", () => {
    const rows = buildFacturasCampana2025_2026Rows("user-1");

    expect(rows).toHaveLength(45);
    expect(rows[0]).toEqual({
      id: "factura-2025-2026-gasoil-2025-10-10-25-1747-09-91779",
      user_id: "user-1",
      recurso: "gasoil",
      fecha_inicio: "2025-10-10",
      fecha_fin: "2025-10-10",
      cantidad: 1001,
      unidad: "l",
      fuente: "factura_detallada",
      referencia: "25 1747 / 09 91779",
      notas: "Campana 2025/2026. Importado de facturas 2526. Articulo: GASOIL AGRODIESEL E+10 GOB. Precio: 0.750. Importe: 750.75.",
      created_at: "2026-06-12T00:00:00.000Z",
    });
    expect(rows.find((row) => row.id === "factura-2025-2026-agua-17782501p0013377")).toMatchObject({
      recurso: "agua",
      fecha_inicio: "2025-08-19",
      fecha_fin: "2025-10-20",
      cantidad: 190,
      unidad: "m3",
      referencia: "17782501P0013377",
    });
    expect(rows.find((row) => row.id === "factura-2025-2026-electricidad-p25con047349745")).toMatchObject({
      recurso: "electricidad",
      fecha_inicio: "2025-09-01",
      fecha_fin: "2025-09-30",
      cantidad: 8363,
      unidad: "kwh",
      referencia: "P25CON047349745",
    });
  });

  it("does not add a current campaign invoice row when Supabase already has the same invoice", () => {
    const existing = [buildFacturasCampana2025_2026Rows("user-1")[0]];
    const merged = mergeFacturasCampana2025_2026Consumos("user-1", existing);

    expect(merged).toHaveLength(45);
    expect(merged.filter((row) => row.referencia === "25 1747 / 09 91779")).toHaveLength(1);
  });

  it("ships the current campaign monthly net sold kg from ventas campana 2526.xlsx", () => {
    const totalKg = CAMPANA_2025_2026_VENTAS_KG.reduce((total, row) => total + row.kgNetos, 0);
    const rows = buildCampana2025_2026BasesKgRows("user-1");

    expect(CAMPANA_2025_2026_VENTAS_KG).toHaveLength(10);
    expect(totalKg).toBeCloseTo(16205004.73);
    expect(rows).toHaveLength(10);
    expect(rows[0]).toEqual({
      id: "campana-2025-2026-ventas-2025-09",
      user_id: "user-1",
      tipo_base: "ventas",
      fecha_inicio: "2025-09-01",
      fecha_fin: "2025-09-30",
      kg: 78332,
      referencia: "ventas campana 2526.xlsx:2025-09",
      notas: "Campana 2025/2026. Kg vendidos netos desde ventas campana 2526.xlsx. Positivos: 78332 kg. Devoluciones/rectificativas: 0 kg.",
      created_at: "2026-06-12T00:00:00.000Z",
    });
    expect(rows.at(-1)).toMatchObject({
      id: "campana-2025-2026-ventas-2026-06",
      kg: 929925,
      referencia: "ventas campana 2526.xlsx:2026-06",
    });
  });

  it("does not add a current campaign ventas kg row when Supabase already has the same base row", () => {
    const existing = [buildCampana2025_2026BasesKgRows("user-1")[0]];
    const merged = mergeCampana2025_2026BasesKg("user-1", existing);

    expect(merged).toHaveLength(10);
    expect(merged.filter((row) => row.referencia === "ventas campana 2526.xlsx:2025-09")).toHaveLength(1);
  });
});

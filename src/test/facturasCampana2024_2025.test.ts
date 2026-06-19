import { describe, expect, it } from "vitest";
import {
  FACTURAS_CAMPANA_2024_2025_AGUA_CONSUMOS,
  FACTURAS_CAMPANA_2024_2025_ELECTRICIDAD_CONSUMOS,
  CAMPANA_2024_2025_VENTAS_KG,
  buildCampana2024_2025BasesKgRows,
  buildFacturasCampana2024_2025Rows,
  FACTURAS_CAMPANA_2024_2025_FACTURAS_CONTABLES,
  FACTURAS_CAMPANA_2024_2025_CONSUMOS,
  FACTURAS_CAMPANA_2024_2025_RANGE,
  mergeCampana2024_2025BasesKg,
  totalFacturaContablePorRecurso,
  mergeFacturasCampana2024_2025Consumos,
} from "@/lib/facturasCampana2024_2025";

describe("facturas campana 2024/2025", () => {
  it("ships the physical gasoil invoice rows from the previous campaign", () => {
    const totalLitros = FACTURAS_CAMPANA_2024_2025_CONSUMOS.reduce((total, row) => total + row.litros, 0);

    expect(FACTURAS_CAMPANA_2024_2025_RANGE).toEqual({
      id: "2024-2025",
      label: "Campana 2024/2025",
      fechaInicio: "2024-09-01",
      fechaFin: "2025-08-31",
    });
    expect(FACTURAS_CAMPANA_2024_2025_CONSUMOS).toHaveLength(31);
    expect(totalLitros).toBe(24772);
  });

  it("converts shipped invoice entries into user-scoped physical consumption rows", () => {
    const rows = buildFacturasCampana2024_2025Rows("user-1");

    expect(rows).toHaveLength(51);
    expect(rows[0]).toEqual({
      id: "factura-2024-2025-gasoil-2024-11-07-24-1923-03-91827",
      user_id: "user-1",
      recurso: "gasoil",
      fecha_inicio: "2024-11-07",
      fecha_fin: "2024-11-07",
      cantidad: 801,
      unidad: "l",
      fuente: "factura_detallada",
      referencia: "24 1923 / 03 91827",
      notas: "Campana 2024/2025. Importado de 2024-2025-GASOIL.xls. Articulo: GASOIL AGRODIESEL E+10 GOB. Precio: 0.785. Importe: 628.79.",
      created_at: "2026-06-12T00:00:00.000Z",
    });
  });

  it("ships the physical water and electricity consumption from the invoice photos", () => {
    const totalAguaM3 = FACTURAS_CAMPANA_2024_2025_AGUA_CONSUMOS
      .reduce((total, row) => total + row.m3, 0);
    const totalElectricidadKwh = FACTURAS_CAMPANA_2024_2025_ELECTRICIDAD_CONSUMOS
      .reduce((total, row) => total + row.kwh, 0);
    const rows = buildFacturasCampana2024_2025Rows("user-1");

    expect(FACTURAS_CAMPANA_2024_2025_AGUA_CONSUMOS).toHaveLength(6);
    expect(totalAguaM3).toBe(3005);
    expect(FACTURAS_CAMPANA_2024_2025_ELECTRICIDAD_CONSUMOS).toHaveLength(14);
    expect(totalElectricidadKwh).toBe(739868);
    expect(rows.filter((row) => row.recurso === "agua")).toHaveLength(6);
    expect(rows.filter((row) => row.recurso === "electricidad")).toHaveLength(14);
    expect(rows.find((row) => row.id === "factura-2024-2025-agua-1778240ip0013217")).toMatchObject({
      recurso: "agua",
      fecha_inicio: "2024-09-01",
      fecha_fin: "2024-10-31",
      cantidad: 179,
      unidad: "m3",
      referencia: "1778240IP0013217",
    });
    expect(rows.find((row) => row.id === "factura-2024-2025-agua-1778250ip0005285")).toMatchObject({
      recurso: "agua",
      fecha_inicio: "2025-03-01",
      fecha_fin: "2025-04-30",
      cantidad: 947,
      unidad: "m3",
      referencia: "1778250IP0005285",
    });
    expect(rows.find((row) => row.id === "factura-2024-2025-agua-1778250ip0005285")?.notas).toContain("Lecturas: 35122 -> 36069. Rango lectura: 2025-02-18 -> 2025-04-15.");
    expect(rows.find((row) => row.id === "factura-2024-2025-electricidad-p24con039897073")).toMatchObject({
      recurso: "electricidad",
      fecha_inicio: "2024-09-01",
      fecha_fin: "2024-09-30",
      cantidad: 23893,
      unidad: "kwh",
      referencia: "P24CON039897073",
    });
  });

  it("does not add a shipped invoice row when Supabase already has the same invoice", () => {
    const existing = [
      buildFacturasCampana2024_2025Rows("user-1")[0],
      {
        ...buildFacturasCampana2024_2025Rows("user-1").find((row) => row.id === "factura-2024-2025-agua-1778250ip0005285")!,
        fecha_inicio: "2025-02-18",
        fecha_fin: "2025-04-15",
      },
    ];
    const merged = mergeFacturasCampana2024_2025Consumos("user-1", existing);

    expect(merged).toHaveLength(51);
    expect(merged.filter((row) => row.referencia === "24 1923 / 03 91827")).toHaveLength(1);
    expect(merged.filter((row) => row.referencia === "1778250IP0005285")).toHaveLength(1);
    expect(merged.find((row) => row.referencia === "1778250IP0005285")).toMatchObject({
      fecha_inicio: "2025-03-01",
      fecha_fin: "2025-04-30",
    });
  });

  it("replaces an old water row identified by accounting reference with the canonical invoice row", () => {
    const canonical = buildFacturasCampana2024_2025Rows("user-1").find((row) => row.id === "factura-2024-2025-agua-1778250ip0005285")!;
    const existing = [
      {
        ...canonical,
        id: "persisted-agua-p0037051",
        fecha_inicio: "2025-02-18",
        fecha_fin: "2025-04-15",
        referencia: "P0037051",
      },
    ];
    const merged = mergeFacturasCampana2024_2025Consumos("user-1", existing);

    expect(merged).toHaveLength(51);
    expect(merged.filter((row) => row.recurso === "agua" && row.cantidad === 947)).toHaveLength(1);
    expect(merged.find((row) => row.recurso === "agua" && row.cantidad === 947)).toMatchObject({
      id: "factura-2024-2025-agua-1778250ip0005285",
      referencia: "1778250IP0005285",
      fecha_inicio: "2025-03-01",
      fecha_fin: "2025-04-30",
    });
  });

  it("ships the monthly net sold kg from campana2425.xlsx as ventas base rows", () => {
    const totalKg = CAMPANA_2024_2025_VENTAS_KG.reduce((total, row) => total + row.kgNetos, 0);
    const rows = buildCampana2024_2025BasesKgRows("user-1");

    expect(CAMPANA_2024_2025_VENTAS_KG).toHaveLength(12);
    expect(totalKg).toBe(23216597);
    expect(rows).toHaveLength(12);
    expect(rows[0]).toEqual({
      id: "campana-2024-2025-ventas-2024-09",
      user_id: "user-1",
      tipo_base: "ventas",
      fecha_inicio: "2024-09-01",
      fecha_fin: "2024-09-30",
      kg: 213813,
      referencia: "campana2425.xlsx:2024-09",
      notas: "Campana 2024/2025. Kg vendidos netos desde campana2425.xlsx. Positivos: 213813 kg. Devoluciones/rectificativas: 0 kg.",
      created_at: "2026-06-12T00:00:00.000Z",
    });
    expect(rows.at(-1)).toMatchObject({
      id: "campana-2024-2025-ventas-2025-08",
      kg: 1227074,
      referencia: "campana2425.xlsx:2025-08",
    });
  });

  it("does not add a shipped ventas kg row when Supabase already has the same base row", () => {
    const existing = [buildCampana2024_2025BasesKgRows("user-1")[0]];
    const merged = mergeCampana2024_2025BasesKg("user-1", existing);

    expect(merged).toHaveLength(12);
    expect(merged.filter((row) => row.referencia === "campana2425.xlsx:2024-09")).toHaveLength(1);
  });

  it("replaces an old ventas kg base row for the same month with the canonical shipped row", () => {
    const canonical = buildCampana2024_2025BasesKgRows("user-1")[0];
    const existing = [
      {
        ...canonical,
        id: "persisted-ventas-septiembre",
        referencia: "ventas septiembre 2024",
        notas: "Fila creada antes de integrar campana2425.xlsx.",
      },
    ];
    const merged = mergeCampana2024_2025BasesKg("user-1", existing);

    expect(merged).toHaveLength(12);
    expect(merged.filter((row) => row.fecha_inicio === "2024-09-01" && row.fecha_fin === "2024-09-30" && row.tipo_base === "ventas")).toHaveLength(1);
    expect(merged.find((row) => row.fecha_inicio === "2024-09-01" && row.fecha_fin === "2024-09-30" && row.tipo_base === "ventas")).toMatchObject({
      id: "campana-2024-2025-ventas-2024-09",
      referencia: "campana2425.xlsx:2024-09",
      kg: 213813,
    });
  });

  it("ships the accounting water and electricity invoice rows too", () => {
    expect(FACTURAS_CAMPANA_2024_2025_FACTURAS_CONTABLES).toHaveLength(21);
    expect(FACTURAS_CAMPANA_2024_2025_FACTURAS_CONTABLES.filter((row) => row.recurso === "agua")).toHaveLength(6);
    expect(FACTURAS_CAMPANA_2024_2025_FACTURAS_CONTABLES.filter((row) => row.recurso === "electricidad")).toHaveLength(15);
    expect(totalFacturaContablePorRecurso("agua")).toBeCloseTo(9440.07);
    expect(totalFacturaContablePorRecurso("electricidad")).toBeCloseTo(91425.28);
    expect(FACTURAS_CAMPANA_2024_2025_FACTURAS_CONTABLES[0]).toEqual({
      recurso: "agua",
      archivo: "2024-2025-AGUA.xls",
      fecha: "2024-10-31",
      concepto: "S/FRA. P0093278",
      importe: 552.77,
      referencia: "P0093278",
      motivo: "Extracto contable con importes; no incluye litros ni m3.",
    });
  });
});

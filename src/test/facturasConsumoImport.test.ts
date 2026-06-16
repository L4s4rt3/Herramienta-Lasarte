import { describe, expect, it } from "vitest";
import { isDuplicateFacturaConsumo, parseFacturaConsumoRows } from "@/lib/facturasConsumoImport";

describe("facturas consumo import", () => {
  it("imports gasoil invoice rows as physical litre consumptions", () => {
    const rows = [
      ["Fecha", "Entrada", "", "", "Pedido", "Nº Albarán", "", "", "Nº Factura", "", "Fec. Fact.", "", "", "Cent./Alm.", "", "", "Articulo", "", "", "", "", "", "", "", "", "", "Unidades", "", "", "", "Precio", "", "", "Importe"],
      ["07/11/2024", "", "", "", "", "03 91827", "", "", "24 1923", "", "30/11/2024", "", "", "", "", "", "100000002", "", "", "GASOIL AGRODIESEL E+10 GOB", "", "", "", "", "", "", "801.00", "", "", "", "0.785", "", "", "628.79"],
      ["15/11/2024", "", "", "", "", "03 91890", "", "", "24 1923", "", "30/11/2024", "", "", "", "", "", "100000002", "", "", "GASOIL AGRODIESEL E+10 GOB", "", "", "", "", "", "", "700.00", "", "", "", "0.772", "", "", "540.40"],
    ];

    const result = parseFacturaConsumoRows(rows, "2024-2025-GASOIL.xls");

    expect(result.summary.importable).toBe(2);
    expect(result.summary.skipped).toBe(0);
    expect(result.rows.map((row) => row.consumo)).toEqual([
      {
        recurso: "gasoil",
        fecha_inicio: "2024-11-07",
        fecha_fin: "2024-11-07",
        cantidad: 801,
        unidad: "l",
        fuente: "factura_detallada",
        referencia: "24 1923 / 03 91827",
        notas: "Importado de 2024-2025-GASOIL.xls. Articulo: GASOIL AGRODIESEL E+10 GOB. Precio: 0.785. Importe: 628.79.",
      },
      {
        recurso: "gasoil",
        fecha_inicio: "2024-11-15",
        fecha_fin: "2024-11-15",
        cantidad: 700,
        unidad: "l",
        fuente: "factura_detallada",
        referencia: "24 1923 / 03 91890",
        notas: "Importado de 2024-2025-GASOIL.xls. Articulo: GASOIL AGRODIESEL E+10 GOB. Precio: 0.772. Importe: 540.40.",
      },
    ]);
  });

  it("keeps accounting-only electricity rows out of physical consumption imports", () => {
    const rows = [
      ["628002000 SUMINISTROS DE ELECTRICIDAD"],
      ["Fecha", "", "C o n c e p t o", "", "", "", "", "", "C a r g o s", "", "", "A b o n o s", "", "S a l d o"],
      ["30/09/2024", "", "CONSUMO SEPTIEMBRE ENDESA", "", "", "", "", "", "3,195.09", "", "", "", "", "3,195.09"],
      ["31/10/2024", "", "CONSUMO OCTUBRE", "", "", "", "", "", "2,366.48", "", "", "", "", "5,561.57"],
    ];

    const result = parseFacturaConsumoRows(rows, "2024-2025-ELECTRICIDAD.xls");

    expect(result.summary.importable).toBe(0);
    expect(result.summary.skipped).toBe(2);
    expect(result.rows).toEqual([
      expect.objectContaining({
        status: "skipped",
        recurso: "electricidad",
        fecha: "2024-09-30",
        concepto: "CONSUMO SEPTIEMBRE ENDESA",
        reason: "El extracto solo trae importe contable; falta kWh para consumo fisico.",
      }),
      expect.objectContaining({
        status: "skipped",
        recurso: "electricidad",
        fecha: "2024-10-31",
        concepto: "CONSUMO OCTUBRE",
        reason: "El extracto solo trae importe contable; falta kWh para consumo fisico.",
      }),
    ]);
  });

  it("parses Spanish and exported numeric formats consistently", () => {
    const rows = [
      ["Fecha", "Entrada", "", "", "Pedido", "Nº Albarán", "", "", "Nº Factura", "", "Fec. Fact.", "", "", "Cent./Alm.", "", "", "Articulo", "", "", "", "", "", "", "", "", "", "Unidades", "", "", "", "Precio", "", "", "Importe"],
      ["16/12/2024", "", "", "", "", "92089", "", "", "24 2173", "", "31/12/2024", "", "", "", "", "", "100000002", "", "", "GASOIL AGRODIESEL E+10 GOB", "", "", "", "", "", "", "1.350,50", "", "", "", "0,810", "", "", "1.093,91"],
    ];

    const result = parseFacturaConsumoRows(rows, "2024-2025-GASOIL.xls");

    expect(result.rows[0].consumo?.cantidad).toBe(1350.5);
    expect(result.rows[0].consumo?.notas).toContain("Precio: 0.810");
    expect(result.rows[0].consumo?.notas).toContain("Importe: 1093.91");
  });

  it("detects rows already imported from the same invoice reference", () => {
    const consumo = {
      recurso: "gasoil" as const,
      fecha_inicio: "2024-11-07",
      fecha_fin: "2024-11-07",
      cantidad: 801,
      unidad: "l" as const,
      fuente: "factura_detallada" as const,
      referencia: "24 1923 / 03 91827",
      notas: null,
    };

    expect(isDuplicateFacturaConsumo(consumo, [
      {
        id: "saved-1",
        user_id: "user-1",
        created_at: "2026-06-12",
        recurso: "gasoil",
        fecha_inicio: "2024-11-07",
        fecha_fin: "2024-11-07",
        cantidad: 801,
        unidad: "l",
        fuente: "factura_detallada",
        referencia: "24 1923 / 03 91827",
        notas: "Importado antes",
      },
    ])).toBe(true);

    expect(isDuplicateFacturaConsumo(consumo, [
      {
        id: "saved-2",
        user_id: "user-1",
        created_at: "2026-06-12",
        recurso: "gasoil",
        fecha_inicio: "2024-11-08",
        fecha_fin: "2024-11-08",
        cantidad: 801,
        unidad: "l",
        fuente: "factura_detallada",
        referencia: "24 1923 / 03 91827",
        notas: "Otro dia",
      },
    ])).toBe(false);
  });
});

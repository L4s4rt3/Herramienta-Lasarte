import { describe, expect, it } from "vitest";
import { composeDireccionEconomico } from "./useDireccionDashboard";

// Regresión del hallazgo de auditoría: el "Margen bruto" de Dirección debía
// salir SIEMPRE de useEconomicoPanel (el mismo cálculo completo que usa el
// Panel Económico: facturación Mercadona + 2ª − consumos − mallas − fruta −
// personal), nunca recompuesto localmente a partir de facturación/coste
// parciales. Estas pruebas fijan ese passthrough.

const periodo = { label: "julio 2026", detail: "1 – 31 jul 2026" };

function basePanel() {
  return {
    isLoading: false,
    sinPermiso: false,
    hayPrecioCero: false,
    facturacionTotalRango: 100_000,
    costeTotalPeriodo: 70_000,
    margenBruto: 30_000,
    costes: { costePorKg: 0.05 },
  };
}

describe("composeDireccionEconomico", () => {
  it("usa el margen bruto completo de useEconomicoPanel tal cual, sin recomponerlo", () => {
    const result = composeDireccionEconomico(true, periodo, basePanel());
    expect(result.margenBruto).toBe(30_000);
    expect(result.facturacionPeriodo).toBe(100_000);
    expect(result.costeTotal).toBe(70_000);
  });

  it("no recalcula facturación − coste: pasa panel.margenBruto incluso si no coincide con esa resta", () => {
    // Si algún día el panel añade una deducción más al margen que no está en
    // costeTotalPeriodo (p.ej. envasado de la fruta buena), Dirección debe
    // seguir mostrando el margen del panel, no una resta local ficticia.
    const panel = { ...basePanel(), margenBruto: 25_000 };
    const result = composeDireccionEconomico(true, periodo, panel);
    expect(result.margenBruto).toBe(25_000);
    expect(result.margenBruto).not.toBe(panel.facturacionTotalRango - panel.costeTotalPeriodo);
  });

  it("propaga costeTotalPeriodo (consumos + mallas + fruta + personal), no solo consumos+mallas", () => {
    const panel = basePanel();
    const result = composeDireccionEconomico(true, periodo, panel);
    // costeTotal debe ser el total completo del panel, no un subconjunto.
    expect(result.costeTotal).toBe(panel.costeTotalPeriodo);
  });

  it("propaga isLoading, sinPermiso y hayPreciosACero del panel", () => {
    const panel = { ...basePanel(), isLoading: true, sinPermiso: true, hayPrecioCero: true };
    const result = composeDireccionEconomico(false, periodo, panel);
    expect(result.mostrar).toBe(false);
    expect(result.isLoading).toBe(true);
    expect(result.sinPermiso).toBe(true);
    expect(result.hayPreciosACero).toBe(true);
    expect(result.periodoLabel).toBe(periodo.label);
    expect(result.periodoDetail).toBe(periodo.detail);
  });

  it("propaga costePorKg tal cual (coste de consumos por kg, no ligado al margen)", () => {
    const result = composeDireccionEconomico(true, periodo, basePanel());
    expect(result.costePorKg).toBe(0.05);
  });
});

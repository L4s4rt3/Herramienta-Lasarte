import { describe, expect, it } from "vitest";
import { buildConsumoReportSummary, type ExportData } from "./exportConsumo";
import { buildPartesReportSummary, type ParteRow } from "./exportPartes";

describe("export report summaries", () => {
  it("builds consumo KPIs from period rows", () => {
    const data: ExportData = {
      sesiones: [],
      maquinas: [],
      consumosMaquinas: [],
      periodos: [
        {
          periodo: "2026-06",
          fechaInicio: "2026-06-01",
          fechaFin: "2026-06-30",
          confianza: "real",
          kgPartes: 1000,
          kgPalets: 0,
          kgVentas: 0,
          kgManual: 0,
          kgBase: 1000,
          aguaL: 250,
          aguaLKg: 0.25,
          electricidadKwh: 50,
          electricidadKwhKg: 0.05,
          gasoilL: 12,
          gasoilMlKg: 12,
          gasoilLT: 12,
          quimicosL: 4,
          quimicosMlKg: 4,
          issues: [],
        },
      ],
    };

    const summary = buildConsumoReportSummary(data);

    expect(summary.meta.title).toBe("Informe de consumos fisicos");
    expect(summary.meta.periodLabel).toContain("1 periodo");
    expect(summary.kpis.map((kpi) => kpi.label)).toContain("Kg base");
    expect(summary.kpis.find((kpi) => kpi.label === "Agua total")?.sub).toBe("0,250 L/kg");
    expect(summary.insights[0].value).toContain("periodos de consumo");
  });

  it("builds partes KPIs and review insight", () => {
    const partes: ParteRow[] = [
      {
        id: "p1",
        date: "2026-06-15",
        estado: "procesado",
        kg_produccion_calibrador: 1000,
        kg_mujeres_calibrador: 0,
        kg_palets_brutos: 900,
        kg_palets_egipto: 0,
        kg_inventario_sin_alta: 0,
        kg_podrido_bolsa_basura: 0,
      },
    ];

    const summary = buildPartesReportSummary(partes, "2026-06-15", "2026-06-15");

    expect(summary.meta.title).toBe("Informe de partes diarios");
    expect(summary.meta.periodLabel).toContain("15/06/2026");
    expect(summary.kpis.map((kpi) => kpi.label)).toContain("Dias criticos");
    expect(summary.insights.some((insight) => insight.label === "Dia a revisar")).toBe(true);
  });
});

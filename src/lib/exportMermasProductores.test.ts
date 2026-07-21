import { describe, expect, it } from "vitest";
import { agruparMermasExport, type FilaMermaExport } from "./exportMermasProductores";

const fila = (over: Partial<FilaMermaExport> & { lote: string }): FilaMermaExport => ({
  productor: "FRUTAS MORATALLA",
  finca: "Dehesilla",
  articulo: "NAR VAL DELTA SEEDLESS",
  fechaEntrada: "2026-04-28",
  diasEnCamara: 71,
  kgEntrada: 20000,
  kgCalibrador: 19000,
  mermaNaturalKg: 1000,
  mermaNaturalEstimadaKg: 700,
  podridoPreCalibradorKg: 300,
  podridoCalibradorKg: 500,
  podridoCalibradorFuente: "real",
  podridoManualKg: 100,
  pctIndustria: 0.12,
  notas: null,
  ...over,
});

describe("agruparMermasExport", () => {
  it("agrega por productor con % ponderados sobre kg de entrada (merma + los tres podridos = pérdida)", () => {
    const { porProductor } = agruparMermasExport([
      fila({ lote: "26042811" }),
      fila({ lote: "26042913", mermaNaturalKg: 500, podridoCalibradorKg: 200, podridoManualKg: 0, podridoPreCalibradorKg: 0 }),
    ]);
    expect(porProductor).toHaveLength(1);
    const g = porProductor[0];
    expect(g.nLotes).toBe(2);
    expect(g.kgEntrada).toBe(40000);
    expect(g.mermaKg).toBe(1500);
    // podrido: (500+100+300) + (200+0+0) = 1.100
    expect(g.podridoKg).toBe(1100);
    expect(g.perdidaKg).toBe(2600);
    expect(g.pctPerdida).toBeCloseTo((2600 / 40000) * 100);
    expect(g.nLotesPodridoReal).toBe(2);
  });

  it("los lotes sin merma calculable (parciales) se cuentan aparte y sus kg NO entran en los porcentajes", () => {
    const { porProductor } = agruparMermasExport([
      fila({ lote: "26042811" }),
      fila({ lote: "26051309", mermaNaturalKg: null, kgEntrada: 99999 }), // parcial
    ]);
    const g = porProductor[0];
    expect(g.nLotes).toBe(2);
    expect(g.nLotesSinMerma).toBe(1);
    expect(g.kgEntrada).toBe(20000); // el parcial no suma a la base
  });

  it("por finca separa pares productor-finca y ordena por % de pérdida descendente", () => {
    const { porFinca } = agruparMermasExport([
      fila({ lote: "A1", finca: "Dehesilla", mermaNaturalKg: 4000 }), // pérdida alta
      fila({ lote: "B1", finca: "Colombo", mermaNaturalKg: 100, podridoCalibradorKg: 0, podridoManualKg: 0, podridoPreCalibradorKg: 0 }),
    ]);
    expect(porFinca).toHaveLength(2);
    expect(porFinca[0].finca).toBe("Dehesilla");
    expect(porFinca[1].finca).toBe("Colombo");
  });
});

// Tests de la lib pura del cierre mensual automático. El módulo vive en
// supabase/functions/_shared/cierreMensual.ts (lo importa la edge function
// cierre-mensual); aquí se prueba con vitest, patrón informeSemanal.
import { describe, expect, it } from "vitest";
import {
  asuntoCierreMensual,
  computeCierreMensual,
  etiquetaMes,
  fmtVariacion,
  mesAnteriorA,
  mesAnteriorDe,
  rangoMes,
  renderCierreMensualHtml,
  renderCierreMensualTexto,
  type MesDatos,
} from "@/lib/cierreMensual";
import { DESTINOS_ORDEN, type DestinoRentabilidad } from "@/lib/rentabilidadDia";
import type { StockInforme } from "../../supabase/functions/_shared/informeSemanal.ts";

function destinos(parciales: Partial<Record<DestinoRentabilidad, number>>): Record<DestinoRentabilidad, number> {
  const out = {} as Record<DestinoRentabilidad, number>;
  for (const d of DESTINOS_ORDEN) out[d] = parciales[d] ?? 0;
  return out;
}

function mes(anio: number, mesN: number, extra?: Partial<MesDatos>): MesDatos {
  return {
    anio,
    mes: mesN,
    kgEntrada: 500_000,
    numEntradas: 40,
    diasConProduccion: 20,
    kgCalibrado: 450_000,
    kgPorDestino: destinos({ mdna3: 200_000, industria: 30_000, podrido: 9_000 }),
    kgPodrido: 9_000,
    kgIndustria: 30_000,
    sumaPresentes: 200,
    kgConAsistencia: 440_000,
    kgMercadona: 180_000,
    merma: {
      nLotes: 3,
      kgEntrada: 90_000,
      kgMerma: 2_700,
      pctMerma: 3,
      nConDatoARevisar: 0,
      lotes: [],
    },
    ...extra,
  };
}

describe("meses", () => {
  it("rangoMes respeta los días del mes (agosto y febrero)", () => {
    expect(rangoMes(2026, 8)).toEqual({ desde: "2026-08-01", hasta: "2026-08-31" });
    expect(rangoMes(2026, 2)).toEqual({ desde: "2026-02-01", hasta: "2026-02-28" });
    expect(rangoMes(2028, 2).hasta).toBe("2028-02-29");
  });
  it("mesAnteriorDe cruza el año", () => {
    expect(mesAnteriorDe("2026-09-01")).toEqual({ anio: 2026, mes: 8 });
    expect(mesAnteriorDe("2026-01-15")).toEqual({ anio: 2025, mes: 12 });
    expect(mesAnteriorA({ anio: 2026, mes: 1 })).toEqual({ anio: 2025, mes: 12 });
  });
  it("etiquetaMes habla en español", () => {
    expect(etiquetaMes({ anio: 2026, mes: 8 })).toBe("agosto de 2026");
  });
});

describe("fmtVariacion", () => {
  it("con signo y sin dato", () => {
    expect(fmtVariacion(110, 100)).toBe("+10,0 %");
    expect(fmtVariacion(90, 100)).toBe("−10,0 %");
    expect(fmtVariacion(90, null)).toBe("—");
    expect(fmtVariacion(90, 0)).toBe("—");
  });
});

describe("computeCierreMensual", () => {
  it("calcula porcentajes y kg/persona", () => {
    const c = computeCierreMensual(mes(2026, 8), mes(2026, 7), null);
    expect(c.pctPodrido).toBeCloseTo(2, 5);
    expect(c.pctMercadona).toBeCloseTo(40, 5);
    expect(c.kgPorPersonaDia).toBeCloseTo(2200, 5);
    expect(c.avisos).toHaveLength(0);
  });
  it("avisa de los huecos en vez de rellenarlos", () => {
    const c = computeCierreMensual(
      mes(2026, 8, { diasConProduccion: 0, kgCalibrado: 0, sumaPresentes: 0, merma: { nLotes: 0, kgEntrada: 0, kgMerma: 0, pctMerma: null, nConDatoARevisar: 2, lotes: [] } }),
      null,
      null,
    );
    expect(c.kgPorPersonaDia).toBeNull();
    expect(c.pctPodrido).toBeNull();
    expect(c.avisos.length).toBeGreaterThanOrEqual(2);
  });
});

describe("render", () => {
  const stock: StockInforme = {
    kgEnCamara: 25_000,
    kgEnCamaraFirme: 20_000,
    kgProbablementeTerminados: 5_000,
    lotesProbablementeTerminados: 1,
    lotesPendientes: 2,
    lotesParciales: 1,
    antiguedadMaxDias: 9,
  };

  it("el asunto resume el mes", () => {
    const c = computeCierreMensual(mes(2026, 8), null, null);
    expect(asuntoCierreMensual(c)).toContain("agosto de 2026");
    expect(asuntoCierreMensual(c)).toContain("450.000 kg");
  });

  it("el HTML lleva la comparativa y el texto plano las mismas cifras", () => {
    const c = computeCierreMensual(mes(2026, 8), mes(2026, 7, { kgCalibrado: 400_000, kgEntrada: 480_000 }), stock);
    const html = renderCierreMensualHtml(c);
    expect(html).toContain("El mes contra el anterior");
    expect(html).toContain("Mercadona");
    expect(html).toContain("+12,5 %"); // 450.000 vs 400.000
    const texto = renderCierreMensualTexto(c);
    expect(texto).toContain("CIERRE MENSUAL · AGOSTO DE 2026");
    expect(texto).toContain("450.000 kg");
    expect(texto).toContain("+12,5 %");
    expect(texto).toContain("Stock en cámara al cierre: 25.000 kg");
  });

  it("sin mes anterior no inventa comparativas", () => {
    const c = computeCierreMensual(mes(2026, 8), null, null);
    const texto = renderCierreMensualTexto(c);
    expect(texto).not.toContain("mes anterior 0");
    expect(renderCierreMensualHtml(c)).toContain("—");
  });
});

import { describe, expect, it } from "vitest";
import {
  calcularCmv,
  envasadoVendido,
  facturacionNetaCategoriasDelMes,
  fechaReferenciaEnvasadoDelMes,
  formatMes,
  mesRango,
  ventasCategoriaDelMes,
  type CmvInputs,
} from "@/lib/cmv";
import { agregarCosteEmpaque, type EmpaquePrecioInput } from "@/lib/costeEmpaque";

describe("mesRango", () => {
  it("devuelve el mes natural completo", () => {
    expect(mesRango("2026-07")).toEqual({ desde: "2026-07-01", hasta: "2026-07-31" });
    expect(mesRango("2026-04")).toEqual({ desde: "2026-04-01", hasta: "2026-04-30" });
  });

  it("respeta febrero y los bisiestos", () => {
    expect(mesRango("2026-02").hasta).toBe("2026-02-28");
    expect(mesRango("2028-02").hasta).toBe("2028-02-29");
  });
});

describe("formatMes", () => {
  it("da el nombre del mes en español", () => {
    expect(formatMes("2026-07")).toBe("Julio 2026");
    expect(formatMes("2025-12")).toBe("Diciembre 2025");
  });
});

describe("fechaReferenciaEnvasadoDelMes", () => {
  it("usa el fin del mes cuando el mes ya cerro (anterior a hoy)", () => {
    expect(fechaReferenciaEnvasadoDelMes("2026-05-31", "2026-07-17")).toBe("2026-05-31");
  });

  it("usa hoy cuando el mes consultado llega al futuro (mes en curso)", () => {
    expect(fechaReferenciaEnvasadoDelMes("2026-07-31", "2026-07-17")).toBe("2026-07-17");
  });
});

// Regresión (hallazgo de auditoría #1): el envasado de un mes CERRADO debía
// salir SIEMPRE igual, con la vigencia de precio de ESE mes — antes useCmv.ts
// usaba useEmpaquePrecios().costesVigentes, fijado en today(), así que un mes
// histórico cambiaba de €/kg cada vez que subía el precio de envasado.
describe("envasadoVendido con fecha de referencia historica (mes cerrado, dos vigencias de precio)", () => {
  const precios: EmpaquePrecioInput[] = [
    { tipo_malla: "3kg", componente: "etiqueta", precio_malla: 0.02, vigente_desde: "2026-01-01" },
    { tipo_malla: "3kg", componente: "etiqueta", precio_malla: 0.05, vigente_desde: "2026-06-01" },
  ];

  it("un mes cerrado (mayo) usa la vigencia de precio de ESE mes, no la vigente hoy", () => {
    const fechaReferencia = fechaReferenciaEnvasadoDelMes("2026-05-31", "2026-07-17");
    const costes = agregarCosteEmpaque(precios, fechaReferencia);
    const coste3kg = costes.find((c) => c.tipoMalla === "3kg")!;
    // mayo -> vigente la de 0.02 (la de 0.05 empieza en junio).
    expect(coste3kg.totalPorMalla).toBeCloseTo(0.02);

    const result = envasadoVendido(
      [{ metodo: "MA3KGC", kilos: 3000 }],
      costes.map((c) => ({ tipoMalla: c.tipoMalla, totalPorMalla: c.totalPorMalla })),
    );
    // 3000 kg / 3 kg-malla = 1000 mallas x 0,02 EUR = 20 EUR (no 50 EUR de hoy).
    expect(result.total).toBeCloseTo(20, 5);
  });

  it("el mes en curso (julio) SI ve la subida de precio ya vigente", () => {
    const fechaReferencia = fechaReferenciaEnvasadoDelMes("2026-07-31", "2026-07-17");
    const costes = agregarCosteEmpaque(precios, fechaReferencia);
    const coste3kg = costes.find((c) => c.tipoMalla === "3kg")!;
    expect(coste3kg.totalPorMalla).toBeCloseTo(0.05);
  });
});

describe("envasadoVendido", () => {
  const costes = [
    { tipoMalla: "3kg" as const, totalPorMalla: 0.06 },
    { tipoMalla: "5kg" as const, totalPorMalla: 0.25 },
  ];

  it("calcula mallas y coste por método", () => {
    const result = envasadoVendido(
      [
        { metodo: "MA3KGC", kilos: 3000 },
        { metodo: "MA5KGC", kilos: 5000 },
      ],
      costes,
    );
    // 3000 kg / 3 kg-malla = 1000 mallas × 0,06 € = 60 €
    // 5000 kg / 5 kg-malla = 1000 mallas × 0,25 € = 250 €
    expect(result.total).toBeCloseTo(310, 5);
    expect(result.kgSinPrecio).toBe(0);
    const pack3 = result.desglose.find((d) => d.metodo === "MA3KGC");
    expect(pack3?.mallas).toBeCloseTo(1000, 5);
    expect(pack3?.coste).toBeCloseTo(60, 5);
  });

  it("acumula en kgSinPrecio los métodos sin envase configurado (granel/girsac)", () => {
    const result = envasadoVendido(
      [
        { metodo: "MA12KGC", kilos: 12000 },
        { metodo: "MA4KGC", kilos: 4000 },
        { metodo: "ma3kgc", kilos: 300 },
      ],
      costes,
    );
    expect(result.kgSinPrecio).toBe(16000);
    // El método en minúsculas se normaliza y sí se cuenta.
    expect(result.total).toBeCloseTo((300 / 3) * 0.06, 5);
  });

  it("ignora kilos no positivos", () => {
    const result = envasadoVendido([{ metodo: "MA3KGC", kilos: 0 }], costes);
    expect(result.total).toBe(0);
    expect(result.desglose).toHaveLength(0);
  });
});

describe("ventasCategoriaDelMes", () => {
  it("suma solo las filas del mes y valora a pm_real", () => {
    const filas = [
      { mes: "2026-06", kilos: 1000, pm_real: 0.5, base_iva: 600 },
      { mes: "2026-06", kilos: 2000, pm_real: 0.4, base_iva: 900 },
      { mes: "2026-07", kilos: 999, pm_real: 0.9, base_iva: 999 },
    ];
    const result = ventasCategoriaDelMes(filas, "2026-06");
    expect(result.kilos).toBe(3000);
    expect(result.facturacionReal).toBeCloseTo(1000 * 0.5 + 2000 * 0.4, 5);
    expect(result.facturacionBruta).toBe(1500);
  });

  it("tolera nulls del import", () => {
    const result = ventasCategoriaDelMes(
      [{ mes: "2026-06", kilos: null, pm_real: null, base_iva: null }],
      "2026-06",
    );
    expect(result.kilos).toBe(0);
    expect(result.facturacionReal).toBe(0);
  });
});

describe("facturacionNetaCategoriasDelMes", () => {
  it("suma kilos y facturacion NETA (kg x pm_real) de 1a + 2a categoria", () => {
    const primera = ventasCategoriaDelMes(
      [{ mes: "2026-06", kilos: 1000, pm_real: 0.5, base_iva: 700 }],
      "2026-06",
    );
    const segunda = ventasCategoriaDelMes(
      [{ mes: "2026-06", kilos: 2000, pm_real: 0.4, base_iva: 900 }],
      "2026-06",
    );
    const result = facturacionNetaCategoriasDelMes(primera, segunda);
    expect(result.kilos).toBe(3000);
    // 1000*0.5 + 2000*0.4 = 500 + 800 = 1300 (NETO, no la suma de base_iva 700+900=1600)
    expect(result.facturacionReal).toBeCloseTo(1300, 5);
  });

  it("con una categoria vacia solo cuenta la otra", () => {
    const primera = ventasCategoriaDelMes([], "2026-06");
    const segunda = ventasCategoriaDelMes(
      [{ mes: "2026-06", kilos: 500, pm_real: 1.2, base_iva: 650 }],
      "2026-06",
    );
    const result = facturacionNetaCategoriasDelMes(primera, segunda);
    expect(result.kilos).toBe(500);
    expect(result.facturacionReal).toBeCloseTo(600, 5);
  });
});

describe("calcularCmv", () => {
  const base: CmvInputs = {
    fruta: 50000,
    consumos: 6000,
    mallasRotas: 500,
    personalEstimado: 20000,
    personalReal: null,
    envasado: 4000,
    transporteSalida: 3000,
    estructura: 8000,
    otros: 0,
    kgVendidos: 200000,
    facturacionReal: 110000,
  };

  it("suma todos los buckets y divide entre kg VENDIDOS", () => {
    const result = calcularCmv(base);
    const esperado = 50000 + 6000 + 500 + 20000 + 4000 + 3000 + 8000;
    expect(result.costeTotal).toBe(esperado);
    expect(result.cmvPorKg).toBeCloseTo(esperado / 200000, 6);
    expect(result.pmRealPorKg).toBeCloseTo(110000 / 200000, 6);
    expect(result.margenPorKg).toBeCloseTo((110000 - esperado) / 200000, 6);
    expect(result.margenTotal).toBe(110000 - esperado);
    expect(result.usaPersonalReal).toBe(false);
  });

  it("el personal real de gestoría sustituye a la estimación (nunca se suman ambos)", () => {
    const result = calcularCmv({ ...base, personalReal: 25000 });
    expect(result.usaPersonalReal).toBe(true);
    const personal = result.buckets.find((b) => b.clave === "personal");
    expect(personal?.importe).toBe(25000);
    expect(personal?.fuente).toBe("manual");
    expect(result.costeTotal).toBe(50000 + 6000 + 500 + 25000 + 4000 + 3000 + 8000);
  });

  it("un personal real de 0 € también sustituye (registrado explícitamente)", () => {
    const result = calcularCmv({ ...base, personalReal: 0 });
    expect(result.buckets.find((b) => b.clave === "personal")?.importe).toBe(0);
    expect(result.usaPersonalReal).toBe(true);
  });

  it("sin kg vendidos no hay €/kg (null, no división por cero)", () => {
    const result = calcularCmv({ ...base, kgVendidos: 0 });
    expect(result.cmvPorKg).toBeNull();
    expect(result.pmRealPorKg).toBeNull();
    expect(result.margenPorKg).toBeNull();
    expect(result.buckets.every((b) => b.eurPorKg === null)).toBe(true);
    // El margen total sí se puede calcular (facturación - coste).
    expect(result.margenTotal).toBe(base.facturacionReal - result.costeTotal);
  });

  it("los % de coste suman 100", () => {
    const result = calcularCmv(base);
    const suma = result.buckets.reduce((s, b) => s + (b.pctCoste ?? 0), 0);
    expect(suma).toBeCloseTo(100, 6);
  });
});

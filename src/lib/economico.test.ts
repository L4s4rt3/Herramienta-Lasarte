import { describe, expect, it } from "vitest";
import {
  agregarCostesPorRecurso,
  agregarCostesPorSemana,
  agregarCosteFruta,
  convertirUnidad,
  costeConsumo,
  importeEntradaFruta,
  mesesEnRango,
  precioVigente,
  prorratearVentasMercadonaEnRango,
  solapeCantidadEnRango,
  tarifaVigente,
  type CosteEntrada,
  type CosteFrutaEntradaInput,
  type EconomicoPrecioInput,
  type VentaMercadonaSemanaProrrateoInput,
} from "./economico";

const PRECIOS_AGUA: EconomicoPrecioInput[] = [
  { recurso: "agua", unidad: "m3", precio_por_unidad: 0.5, vigente_desde: "2026-01-01" },
  { recurso: "agua", unidad: "m3", precio_por_unidad: 0.8, vigente_desde: "2026-03-01" },
];

describe("tarifaVigente / precioVigente", () => {
  it("usa la tarifa mas reciente cuya vigente_desde es <= fecha (fecha entre dos tarifas)", () => {
    expect(precioVigente(PRECIOS_AGUA, "agua", "2026-02-15")).toBe(0.5);
    expect(tarifaVigente(PRECIOS_AGUA, "agua", "2026-02-15")?.vigente_desde).toBe("2026-01-01");
  });

  it("cambia a la tarifa nueva justo en su fecha de vigencia", () => {
    expect(precioVigente(PRECIOS_AGUA, "agua", "2026-03-01")).toBe(0.8);
    expect(precioVigente(PRECIOS_AGUA, "agua", "2026-03-02")).toBe(0.8);
  });

  it("devuelve null si la fecha es anterior a cualquier tarifa", () => {
    expect(precioVigente(PRECIOS_AGUA, "agua", "2025-12-31")).toBeNull();
  });

  it("devuelve null para un recurso sin tarifas", () => {
    expect(precioVigente(PRECIOS_AGUA, "electricidad", "2026-06-01")).toBeNull();
  });
});

describe("convertirUnidad", () => {
  it("convierte litros a m3 dividiendo entre 1000", () => {
    expect(convertirUnidad(2500, "l", "m3")).toBeCloseTo(2.5);
  });

  it("convierte m3 a litros multiplicando por 1000", () => {
    expect(convertirUnidad(2.5, "m3", "l")).toBeCloseTo(2500);
  });

  it("es identidad cuando origen y destino coinciden (l->l, kwh->kwh)", () => {
    expect(convertirUnidad(120, "l", "l")).toBe(120);
    expect(convertirUnidad(45, "kwh", "kwh")).toBe(45);
  });

  it("lanza si la combinacion no esta soportada", () => {
    expect(() => convertirUnidad(10, "l", "kwh")).toThrow();
  });
});

describe("costeConsumo", () => {
  it("convierte litros a m3 antes de aplicar el precio (agua)", () => {
    // 2500 L = 2.5 m3, a 2 EUR/m3 -> 5 EUR
    expect(costeConsumo(2500, "l", { unidad: "m3", precio_por_unidad: 2 })).toBeCloseTo(5);
  });

  it("no convierte cuando la unidad de consumo ya coincide con la de tarifa", () => {
    expect(costeConsumo(100, "kwh", { unidad: "kwh", precio_por_unidad: 0.15 })).toBeCloseTo(15);
  });

  it("da coste 0 cuando el precio vigente es 0 (tarifas semilla sin tarifa real)", () => {
    expect(costeConsumo(5000, "l", { unidad: "m3", precio_por_unidad: 0 })).toBe(0);
  });

  it("da coste 0 con cantidad 0 o negativa", () => {
    expect(costeConsumo(0, "l", { unidad: "m3", precio_por_unidad: 2 })).toBe(0);
    expect(costeConsumo(-10, "l", { unidad: "m3", precio_por_unidad: 2 })).toBe(0);
  });
});

describe("agregarCostesPorRecurso", () => {
  it("suma cantidad y coste de varias entradas del mismo recurso", () => {
    const entradas: CosteEntrada[] = [
      { recurso: "agua", fecha: "2026-02-01", cantidad: 3000, unidadConsumo: "l" },
      { recurso: "agua", fecha: "2026-02-05", cantidad: 2000, unidadConsumo: "l" },
    ];
    const resultado = agregarCostesPorRecurso(entradas, PRECIOS_AGUA);
    expect(resultado).toHaveLength(1);
    expect(resultado[0].recurso).toBe("agua");
    expect(resultado[0].cantidad).toBe(5000);
    expect(resultado[0].unidad).toBe("l");
    // 5000 L = 5 m3 a 0.5 EUR/m3 = 2.5 EUR
    expect(resultado[0].coste).toBeCloseTo(2.5);
    expect(resultado[0].unidadPrecio).toBe("m3");
    expect(resultado[0].precioMedio).toBeCloseTo(0.5);
  });

  it("aplica la tarifa vigente en la fecha de cada entrada, no una unica tarifa para todo el grupo", () => {
    const entradas: CosteEntrada[] = [
      { recurso: "agua", fecha: "2026-02-15", cantidad: 1000, unidadConsumo: "l" }, // tarifa 0.5
      { recurso: "agua", fecha: "2026-03-15", cantidad: 1000, unidadConsumo: "l" }, // tarifa 0.8
    ];
    const resultado = agregarCostesPorRecurso(entradas, PRECIOS_AGUA);
    // 1 m3 * 0.5 + 1 m3 * 0.8 = 1.3
    expect(resultado[0].coste).toBeCloseTo(1.3);
  });

  it("da coste 0 para un recurso sin ninguna tarifa vigente en esa fecha", () => {
    const entradas: CosteEntrada[] = [
      { recurso: "agua", fecha: "2025-01-01", cantidad: 1000, unidadConsumo: "l" },
    ];
    const resultado = agregarCostesPorRecurso(entradas, PRECIOS_AGUA);
    expect(resultado[0].coste).toBe(0);
    expect(resultado[0].unidadPrecio).toBeNull();
    expect(resultado[0].precioMedio).toBeNull();
  });

  it("ignora entradas con cantidad 0", () => {
    const entradas: CosteEntrada[] = [
      { recurso: "agua", fecha: "2026-02-01", cantidad: 0, unidadConsumo: "l" },
    ];
    expect(agregarCostesPorRecurso(entradas, PRECIOS_AGUA)).toHaveLength(0);
  });
});

describe("agregarCostesPorSemana", () => {
  it("agrupa por semana ISO (lunes) y ordena ascendente", () => {
    const entradas: CosteEntrada[] = [
      { recurso: "agua", fecha: "2026-02-04", cantidad: 1000, unidadConsumo: "l" }, // miercoles, semana del 2026-02-02
      { recurso: "agua", fecha: "2026-02-11", cantidad: 1000, unidadConsumo: "l" }, // semana siguiente
    ];
    const semanas = agregarCostesPorSemana(entradas, PRECIOS_AGUA);
    expect(semanas).toHaveLength(2);
    expect(semanas[0].semanaInicio).toBe("2026-02-02");
    expect(semanas[1].semanaInicio).toBe("2026-02-09");
    expect(semanas[0].coste).toBeCloseTo(0.5);
  });
});

describe("solapeCantidadEnRango", () => {
  it("reparte proporcionalmente al numero de dias solapados", () => {
    // sesion de 4 dias (1-4 ene), rango pide solo 2 y 3 -> mitad de la cantidad
    expect(solapeCantidadEnRango("2026-01-01", "2026-01-04", 400, "2026-01-02", "2026-01-03")).toBeCloseTo(200);
  });

  it("devuelve la cantidad completa si el solape cubre todo el rango de la sesion", () => {
    expect(solapeCantidadEnRango("2026-01-01", "2026-01-02", 100, "2026-01-01", "2026-01-31")).toBeCloseTo(100);
  });

  it("devuelve 0 si no hay solape", () => {
    expect(solapeCantidadEnRango("2026-01-01", "2026-01-02", 100, "2026-02-01", "2026-02-28")).toBe(0);
  });
});

describe("importeEntradaFruta", () => {
  const base: CosteFrutaEntradaInput = {
    fecha: "2026-04-10",
    kg_entrada: 1000,
    importe_compra: null,
    coste_recoleccion: null,
    importe_transporte: null,
    importe_comision: null,
    importe_total: null,
  };

  it("usa importe_total cuando viene relleno, ignorando los componentes", () => {
    expect(importeEntradaFruta({ ...base, importe_total: 500, importe_compra: 999 })).toBe(500);
  });

  it("suma los componentes cuando importe_total es null", () => {
    expect(importeEntradaFruta({
      ...base,
      importe_compra: 300,
      coste_recoleccion: 40,
      importe_transporte: 20,
      importe_comision: 10,
    })).toBeCloseTo(370);
  });

  it("trata los componentes ausentes como 0", () => {
    expect(importeEntradaFruta({ ...base, importe_compra: 300 })).toBe(300);
  });

  it("da 0 cuando no hay ningun importe (p.ej. filas stock_inicial)", () => {
    expect(importeEntradaFruta(base)).toBe(0);
  });
});

describe("agregarCosteFruta", () => {
  it("suma total, desglose, kg y serie semanal de varias entradas", () => {
    const entradas: CosteFrutaEntradaInput[] = [
      {
        fecha: "2026-02-04", // miercoles, semana del 2026-02-02
        kg_entrada: 1000,
        importe_compra: 200,
        coste_recoleccion: 30,
        importe_transporte: 15,
        importe_comision: 5,
        importe_total: null,
      },
      {
        fecha: "2026-02-11", // semana siguiente
        kg_entrada: 500,
        importe_compra: null,
        coste_recoleccion: null,
        importe_transporte: null,
        importe_comision: null,
        importe_total: 100,
      },
    ];
    const resultado = agregarCosteFruta(entradas);
    expect(resultado.totalImporte).toBeCloseTo(350);
    expect(resultado.kgTotales).toBe(1500);
    expect(resultado.desglose).toEqual({ compra: 200, recoleccion: 30, transporte: 15, comision: 5 });
    expect(resultado.serieSemanal).toEqual([
      { semanaInicio: "2026-02-02", coste: 250 },
      { semanaInicio: "2026-02-09", coste: 100 },
    ]);
  });

  it("devuelve todo a 0 con una lista vacia", () => {
    const resultado = agregarCosteFruta([]);
    expect(resultado.totalImporte).toBe(0);
    expect(resultado.kgTotales).toBe(0);
    expect(resultado.serieSemanal).toEqual([]);
  });
});

describe("prorratearVentasMercadonaEnRango", () => {
  // Semana L-S completa dentro de julio 2026 (14-19 jul).
  const semanaCompleta: VentaMercadonaSemanaProrrateoInput = {
    desde: "2026-07-13",
    hasta: "2026-07-18",
    tieneBaseIva: true,
    vendidoKg: 6000, // 1000 kg/dia * 6 dias
    baseIvaMetodos: 3000,
    ajustesBaseIva: 0,
    metodos: [{ metodo: "ma3kgc", kilos: 6000 }],
  };

  // Semana que cruza de mes: mitad en julio (3 dias: 29-31), mitad en agosto (3 dias: 1-3).
  const semanaCruzada: VentaMercadonaSemanaProrrateoInput = {
    desde: "2026-07-29",
    hasta: "2026-08-03",
    tieneBaseIva: true,
    vendidoKg: 1200,
    baseIvaMetodos: 600,
    ajustesBaseIva: 60,
    metodos: [{ metodo: "MA5KGC", kilos: 1200 }],
  };

  it("cuenta entera una semana que cae completa dentro del rango", () => {
    const result = prorratearVentasMercadonaEnRango(
      [semanaCompleta],
      "2026-07-01",
      "2026-07-31",
      { soloConBaseIva: true, conFacturacion: true },
    );
    expect(result.kg).toBeCloseTo(6000);
    expect(result.facturacion).toBeCloseTo(3000);
    expect(result.semanas).toBe(1);
    expect(result.kilosPorMetodo).toEqual([{ metodo: "MA3KGC", kilos: 6000 }]);
  });

  it("prorratea por solape de dias una semana que cruza de mes (mitad julio, mitad agosto)", () => {
    const result = prorratearVentasMercadonaEnRango(
      [semanaCruzada],
      "2026-07-01",
      "2026-07-31",
      { soloConBaseIva: true, conFacturacion: true },
    );
    // 3 de 6 dias caen en julio -> mitad de kg, base_iva y ajustes.
    expect(result.kg).toBeCloseTo(600);
    expect(result.facturacion).toBeCloseTo(330); // (600+60)/2
    expect(result.kilosPorMetodo).toEqual([{ metodo: "MA5KGC", kilos: 600 }]);
  });

  it("con soloConBaseIva=true excluye del todo las semanas sin base_iva", () => {
    const semanaSinBaseIva: VentaMercadonaSemanaProrrateoInput = {
      ...semanaCompleta,
      tieneBaseIva: false,
    };
    const result = prorratearVentasMercadonaEnRango(
      [semanaSinBaseIva],
      "2026-07-01",
      "2026-07-31",
      { soloConBaseIva: true, conFacturacion: true },
    );
    expect(result.kg).toBe(0);
    expect(result.semanas).toBe(0);
  });

  it("con soloConBaseIva=false SI cuenta las semanas sin base_iva (kg fisico puro)", () => {
    const semanaSinBaseIva: VentaMercadonaSemanaProrrateoInput = {
      ...semanaCompleta,
      tieneBaseIva: false,
    };
    const result = prorratearVentasMercadonaEnRango(
      [semanaSinBaseIva],
      "2026-07-01",
      "2026-07-31",
      { soloConBaseIva: false, conFacturacion: false },
    );
    expect(result.kg).toBeCloseTo(6000);
  });

  it("con conFacturacion=false no calcula facturacion ni kilosPorMetodo", () => {
    const result = prorratearVentasMercadonaEnRango(
      [semanaCompleta],
      "2026-07-01",
      "2026-07-31",
      { soloConBaseIva: true, conFacturacion: false },
    );
    expect(result.kg).toBeCloseTo(6000);
    expect(result.facturacion).toBe(0);
    expect(result.kilosPorMetodo).toEqual([]);
  });
});

describe("mesesEnRango", () => {
  it("devuelve un unico mes cuando el rango cae dentro de un mes natural", () => {
    expect(mesesEnRango("2026-04-01", "2026-04-30")).toEqual(["2026-04"]);
  });

  it("devuelve todos los meses que solapan un rango que cruza varios meses", () => {
    expect(mesesEnRango("2026-04-15", "2026-06-05")).toEqual(["2026-04", "2026-05", "2026-06"]);
  });

  it("cruza el cambio de anio correctamente", () => {
    expect(mesesEnRango("2025-12-20", "2026-01-10")).toEqual(["2025-12", "2026-01"]);
  });
});

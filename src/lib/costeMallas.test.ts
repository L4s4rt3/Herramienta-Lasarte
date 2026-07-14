import { describe, expect, it } from "vitest";
import {
  agregarGastoMallas,
  aplicarPrecioEmpaque,
  configVigente,
  gastoMallas,
  gastoMallasPorSemana,
  mallasRotas,
  tipoMallaDeTexto,
  type MallaConfigInput,
} from "./costeMallas";
import { mondayOfLocal } from "./economico";

describe("mallasRotas / gastoMallas", () => {
  it("calcula el nº de mallas rotas y el gasto con datos completos", () => {
    // 500 kg reciclados / 25 kg por malla = 20 mallas, a 3 EUR/malla -> 60 EUR
    expect(mallasRotas(500, 25)).toBeCloseTo(20);
    expect(gastoMallas(500, 25, 3)).toBeCloseTo(60);
  });

  it("da 0 mallas y 0 gasto si kg_por_malla es null", () => {
    expect(mallasRotas(500, null)).toBe(0);
    expect(gastoMallas(500, null, 3)).toBe(0);
  });

  it("da 0 mallas y 0 gasto si kg_por_malla es <= 0", () => {
    expect(mallasRotas(500, 0)).toBe(0);
    expect(gastoMallas(500, -5, 3)).toBe(0);
  });

  it("da 0 gasto si precio_malla es null aunque haya mallas rotas", () => {
    expect(mallasRotas(500, 25)).toBeCloseTo(20);
    expect(gastoMallas(500, 25, null)).toBe(0);
  });

  it("da 0 con kg reciclado 0 o negativo", () => {
    expect(mallasRotas(0, 25)).toBe(0);
    expect(mallasRotas(-10, 25)).toBe(0);
  });
});

describe("gastoMallasPorSemana", () => {
  const configZ1: MallaConfigInput = { zona: "z1", tipo_malla: "Malla 5 kg", kg_por_malla: 5, precio_malla: 0.2424, vigente_desde: "2026-01-01" };
  const configZ2: MallaConfigInput = { zona: "z2", tipo_malla: "Malla 3 kg", kg_por_malla: 3, precio_malla: 0.1134, vigente_desde: "2026-01-01" };

  it("agrupa el gasto por lunes de semana ISO (clave compatible con CosteSemana)", () => {
    const partes = [
      // Semana del lunes 2026-07-06: martes y jueves.
      { date: "2026-07-07", z1_kg: 50, z2_kg: 30 },
      { date: "2026-07-09", z1_kg: 25, z2_kg: 0 },
      // Semana siguiente (lunes 2026-07-13).
      { date: "2026-07-13", z1_kg: 10, z2_kg: 0 },
    ];

    const serie = gastoMallasPorSemana(partes, configZ1, configZ2, mondayOfLocal);

    expect(serie).toHaveLength(2);
    expect(serie[0].semanaInicio).toBe("2026-07-06");
    // (50/5 + 25/5) mallas z1 × 0.2424 + (30/3) mallas z2 × 0.1134
    expect(serie[0].gasto).toBeCloseTo(15 * 0.2424 + 10 * 0.1134, 6);
    expect(serie[1].semanaInicio).toBe("2026-07-13");
    expect(serie[1].gasto).toBeCloseTo(2 * 0.2424, 6);
  });

  it("sin config no genera semanas (gasto 0)", () => {
    const serie = gastoMallasPorSemana([{ date: "2026-07-07", z1_kg: 50, z2_kg: 30 }], null, null, mondayOfLocal);
    expect(serie).toHaveLength(0);
  });
});

describe("tipoMallaDeTexto", () => {
  it("reconoce el tipo 3kg/5kg en los nombres reales de la config", () => {
    expect(tipoMallaDeTexto("Malla 3 kg")).toBe("3kg");
    expect(tipoMallaDeTexto("Malla 5 kg")).toBe("5kg");
    expect(tipoMallaDeTexto("MALLA 5KG ROJA")).toBe("5kg");
    expect(tipoMallaDeTexto("3kg")).toBe("3kg");
    expect(tipoMallaDeTexto("saco 10 kg")).toBeNull();
    expect(tipoMallaDeTexto(null)).toBeNull();
  });
});

describe("aplicarPrecioEmpaque", () => {
  const config: MallaConfigInput = { zona: "z1", tipo_malla: "Malla 5 kg", kg_por_malla: 5, precio_malla: 0.0262, vigente_desde: "2026-01-01" };

  it("sustituye el precio manual por el total de envasado del tipo que casa", () => {
    const conEmpaque = aplicarPrecioEmpaque(config, { "5kg": 0.2424, "3kg": 0.1134 });
    expect(conEmpaque?.precio_malla).toBeCloseTo(0.2424);
    // El resto de la config no cambia.
    expect(conEmpaque?.kg_por_malla).toBe(5);
  });

  it("mantiene el precio manual si no hay total de envasado para ese tipo", () => {
    expect(aplicarPrecioEmpaque(config, {})?.precio_malla).toBe(0.0262);
    expect(aplicarPrecioEmpaque(config, { "5kg": 0 })?.precio_malla).toBe(0.0262);
  });

  it("mantiene el precio manual si el tipo de malla de la zona no es 3kg/5kg", () => {
    const otra: MallaConfigInput = { ...config, tipo_malla: "saco 10 kg" };
    expect(aplicarPrecioEmpaque(otra, { "5kg": 0.2424 })?.precio_malla).toBe(0.0262);
  });

  it("devuelve null si no hay config", () => {
    expect(aplicarPrecioEmpaque(null, { "5kg": 0.2424 })).toBeNull();
  });
});

describe("configVigente", () => {
  const CONFIGS: MallaConfigInput[] = [
    { zona: "z1", tipo_malla: "malla A", kg_por_malla: 20, precio_malla: 2.5, vigente_desde: "2026-01-01" },
    { zona: "z1", tipo_malla: "malla A", kg_por_malla: 22, precio_malla: 3, vigente_desde: "2026-04-01" },
    { zona: "z2", tipo_malla: "malla B", kg_por_malla: 15, precio_malla: 4, vigente_desde: "2026-02-01" },
  ];

  it("usa la vigencia mas reciente cuyo vigente_desde es <= fecha", () => {
    const vigente = configVigente(CONFIGS, "z1", "2026-03-15");
    expect(vigente?.vigente_desde).toBe("2026-01-01");
    expect(vigente?.kg_por_malla).toBe(20);
  });

  it("cambia a la vigencia nueva justo en su fecha", () => {
    const vigente = configVigente(CONFIGS, "z1", "2026-04-01");
    expect(vigente?.vigente_desde).toBe("2026-04-01");
    expect(vigente?.kg_por_malla).toBe(22);
  });

  it("devuelve null si la fecha es anterior a cualquier vigencia de la zona", () => {
    expect(configVigente(CONFIGS, "z1", "2025-12-31")).toBeNull();
  });

  it("no mezcla vigencias de otra zona", () => {
    const vigente = configVigente(CONFIGS, "z2", "2026-06-01");
    expect(vigente?.zona).toBe("z2");
    expect(vigente?.kg_por_malla).toBe(15);
  });
});

describe("agregarGastoMallas", () => {
  const configZ1: MallaConfigInput = { zona: "z1", tipo_malla: "malla A", kg_por_malla: 20, precio_malla: 2.5, vigente_desde: "2026-01-01" };
  const configZ2: MallaConfigInput = { zona: "z2", tipo_malla: "malla B", kg_por_malla: 15, precio_malla: 4, vigente_desde: "2026-01-01" };

  it("agrega mallas y gasto de ambas zonas y suma el total", () => {
    // z1: 400/20=20 mallas x 2.5 = 50 EUR ; z2: 300/15=20 mallas x 4 = 80 EUR
    const resultado = agregarGastoMallas({ z1_kg: 400, z2_kg: 300 }, configZ1, configZ2);
    expect(resultado.z1.mallas).toBeCloseTo(20);
    expect(resultado.z1.gasto).toBeCloseTo(50);
    expect(resultado.z2.mallas).toBeCloseTo(20);
    expect(resultado.z2.gasto).toBeCloseTo(80);
    expect(resultado.totalMallas).toBeCloseTo(40);
    expect(resultado.totalGasto).toBeCloseTo(130);
    expect(resultado.faltanDatos).toBe(false);
  });

  it("marca faltanDatos si hay kg reciclado sin config (kg_por_malla/precio_malla null)", () => {
    const configZ1Vacia: MallaConfigInput = { zona: "z1", tipo_malla: null, kg_por_malla: null, precio_malla: null, vigente_desde: "2026-01-01" };
    const resultado = agregarGastoMallas({ z1_kg: 400, z2_kg: 300 }, configZ1Vacia, configZ2);
    expect(resultado.z1.mallas).toBe(0);
    expect(resultado.z1.gasto).toBe(0);
    expect(resultado.faltanDatos).toBe(true);
    // z2 sigue calculando bien aunque z1 falte
    expect(resultado.z2.gasto).toBeCloseTo(80);
    expect(resultado.totalGasto).toBeCloseTo(80);
  });

  it("no marca faltanDatos si una zona simplemente no tuvo reciclado en el periodo", () => {
    const configZ1Vacia: MallaConfigInput = { zona: "z1", tipo_malla: null, kg_por_malla: null, precio_malla: null, vigente_desde: "2026-01-01" };
    const resultado = agregarGastoMallas({ z1_kg: 0, z2_kg: 300 }, configZ1Vacia, configZ2);
    expect(resultado.faltanDatos).toBe(false);
  });

  it("trata config null (sin ninguna vigencia aplicable) igual que datos faltantes", () => {
    const resultado = agregarGastoMallas({ z1_kg: 400, z2_kg: 300 }, null, configZ2);
    expect(resultado.z1.mallas).toBe(0);
    expect(resultado.z1.gasto).toBe(0);
    expect(resultado.faltanDatos).toBe(true);
  });
});

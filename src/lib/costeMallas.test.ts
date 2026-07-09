import { describe, expect, it } from "vitest";
import {
  agregarGastoMallas,
  configVigente,
  gastoMallas,
  mallasRotas,
  type MallaConfigInput,
} from "./costeMallas";

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

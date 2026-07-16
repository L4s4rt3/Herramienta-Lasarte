import { describe, expect, it } from "vitest";
import {
  avanzarPeriodo,
  esPeriodoActual,
  formatPeriodoLabel,
  hoyPeriodo,
  periodoDeFecha,
  rangoPersonalizado,
  type PeriodoValue,
} from "./selectorPeriodo";

describe("periodoDeFecha", () => {
  it("dia: desde=hasta=la fecha dada", () => {
    const p = periodoDeFecha("dia", "2026-07-14"); // martes
    expect(p).toMatchObject({ modo: "dia", desde: "2026-07-14", hasta: "2026-07-14" });
    expect(p.label).toBe("mar 14 jul");
  });

  it("semana: lunes a domingo de la semana ISO que contiene la fecha", () => {
    const p = periodoDeFecha("semana", "2026-07-14"); // martes
    expect(p.desde).toBe("2026-07-13");
    expect(p.hasta).toBe("2026-07-19");
    expect(p.label).toBe("Semana 29 · 13–19 jul");
  });

  it("semana que cruza de mes en la etiqueta", () => {
    const p = periodoDeFecha("semana", "2026-07-01"); // miercoles, semana 27: 29 jun - 5 jul
    expect(p.desde).toBe("2026-06-29");
    expect(p.hasta).toBe("2026-07-05");
    expect(p.label).toBe("Semana 27 · 29 jun – 5 jul");
  });

  it("mes: primer y ultimo dia del mes natural", () => {
    const p = periodoDeFecha("mes", "2026-07-14");
    expect(p.desde).toBe("2026-07-01");
    expect(p.hasta).toBe("2026-07-31");
    expect(p.label).toBe("Julio 2026");
  });

  it("campana: 1 sep - 31 ago, año de inicio segun el mes de la fecha", () => {
    const enCampana = periodoDeFecha("campana", "2026-07-14"); // dentro de la campaña 25/26
    expect(enCampana.desde).toBe("2025-09-01");
    expect(enCampana.hasta).toBe("2026-08-31");
    expect(enCampana.label).toBe("Campaña 25/26");

    const trasEmpezar = periodoDeFecha("campana", "2026-09-05"); // ya en la campaña 26/27
    expect(trasEmpezar.desde).toBe("2026-09-01");
    expect(trasEmpezar.hasta).toBe("2027-08-31");
    expect(trasEmpezar.label).toBe("Campaña 26/27");
  });

  it("rango: un solo dia (desde=hasta) al partir de una fecha suelta", () => {
    const p = periodoDeFecha("rango", "2026-07-14");
    expect(p.desde).toBe("2026-07-14");
    expect(p.hasta).toBe("2026-07-14");
  });
});

describe("avanzarPeriodo", () => {
  it("dia: +1/-1 dia", () => {
    const base: PeriodoValue = { modo: "dia", desde: "2026-07-14", hasta: "2026-07-14" };
    expect(avanzarPeriodo(base, 1)).toMatchObject({ desde: "2026-07-15", hasta: "2026-07-15" });
    expect(avanzarPeriodo(base, -1)).toMatchObject({ desde: "2026-07-13", hasta: "2026-07-13" });
  });

  it("dia: cruza fin de mes", () => {
    const base: PeriodoValue = { modo: "dia", desde: "2026-07-31", hasta: "2026-07-31" };
    expect(avanzarPeriodo(base, 1)).toMatchObject({ desde: "2026-08-01", hasta: "2026-08-01" });
  });

  it("semana: avanza/retrocede una semana completa", () => {
    const base = periodoDeFecha("semana", "2026-07-14"); // 13-19 jul, semana 29
    const siguiente = avanzarPeriodo(base, 1);
    expect(siguiente).toMatchObject({ desde: "2026-07-20", hasta: "2026-07-26" });
    expect(siguiente.label).toBe("Semana 30 · 20–26 jul");
    const anterior = avanzarPeriodo(base, -1);
    expect(anterior).toMatchObject({ desde: "2026-07-06", hasta: "2026-07-12" });
  });

  it("semana: cruce de año ISO (semana 53 de 2025 -> semana 1 de 2026)", () => {
    // Semana del lunes 22 dic 2025 (semana 52 de 2025).
    const base = periodoDeFecha("semana", "2025-12-24");
    expect(base.desde).toBe("2025-12-22");
    const siguiente = avanzarPeriodo(base, 1);
    // Lunes 29 dic 2025, pero semana ISO 1 de 2026 (el jueves cae en 2026).
    expect(siguiente.desde).toBe("2025-12-29");
    expect(siguiente.hasta).toBe("2026-01-04");
    expect(siguiente.label).toBe("Semana 1 · 29 dic – 4 ene"); // sin año: cruza de año pero no se muestra (igual que formatDayMonth)
  });

  it("mes: avanza/retrocede un mes natural, incluido el cambio de año", () => {
    const diciembre = periodoDeFecha("mes", "2026-12-05");
    const enero = avanzarPeriodo(diciembre, 1);
    expect(enero).toMatchObject({ desde: "2027-01-01", hasta: "2027-01-31" });
    expect(enero.label).toBe("Enero 2027");
    const noviembre = avanzarPeriodo(diciembre, -1);
    expect(noviembre).toMatchObject({ desde: "2026-11-01", hasta: "2026-11-30" });
  });

  it("campana: avanza/retrocede una campaña completa (sep-ago)", () => {
    const actual = periodoDeFecha("campana", "2026-07-14"); // 25/26
    const siguiente = avanzarPeriodo(actual, 1);
    expect(siguiente).toMatchObject({ desde: "2026-09-01", hasta: "2027-08-31" });
    expect(siguiente.label).toBe("Campaña 26/27");
    const anterior = avanzarPeriodo(actual, -1);
    expect(anterior).toMatchObject({ desde: "2024-09-01", hasta: "2025-08-31" });
    expect(anterior.label).toBe("Campaña 24/25");
  });

  it("rango: desplaza la ventana completa por su propia longitud", () => {
    const base: PeriodoValue = { modo: "rango", desde: "2026-05-01", hasta: "2026-07-14" }; // 75 dias
    const siguiente = avanzarPeriodo(base, 1);
    expect(siguiente.desde).toBe("2026-07-15");
    expect(siguiente.hasta).toBe("2026-09-27");
    const anterior = avanzarPeriodo(base, -1);
    expect(anterior.desde).toBe("2026-02-15");
    expect(anterior.hasta).toBe("2026-04-30");
  });

  it("rango de un solo dia: se comporta como avanzar un dia", () => {
    const base: PeriodoValue = { modo: "rango", desde: "2026-07-14", hasta: "2026-07-14" };
    expect(avanzarPeriodo(base, 1)).toMatchObject({ desde: "2026-07-15", hasta: "2026-07-15" });
  });
});

describe("formatPeriodoLabel", () => {
  it("rango libre: '1 may – 14 jul'", () => {
    const label = formatPeriodoLabel({ modo: "rango", desde: "2026-05-01", hasta: "2026-07-14" });
    expect(label).toBe("1 may – 14 jul");
  });

  it("rango dentro del mismo mes: usa guion sin espacios como semana", () => {
    const label = formatPeriodoLabel({ modo: "rango", desde: "2026-07-01", hasta: "2026-07-14" });
    expect(label).toBe("1–14 jul");
  });
});

describe("hoyPeriodo / esPeriodoActual", () => {
  const hoy = new Date(2026, 6, 14, 9, 0); // martes 14 jul 2026

  it("hoyPeriodo delega en periodoDeFecha con la fecha de hoy", () => {
    expect(hoyPeriodo("dia", hoy)).toMatchObject({ desde: "2026-07-14", hasta: "2026-07-14" });
    expect(hoyPeriodo("semana", hoy)).toMatchObject({ desde: "2026-07-13", hasta: "2026-07-19" });
    expect(hoyPeriodo("mes", hoy)).toMatchObject({ desde: "2026-07-01", hasta: "2026-07-31" });
    expect(hoyPeriodo("campana", hoy)).toMatchObject({ desde: "2025-09-01", hasta: "2026-08-31" });
  });

  it("esPeriodoActual compara contra el periodo que contiene hoy", () => {
    expect(esPeriodoActual({ modo: "semana", desde: "2026-07-13", hasta: "2026-07-19" }, hoy)).toBe(true);
    expect(esPeriodoActual({ modo: "semana", desde: "2026-07-06", hasta: "2026-07-12" }, hoy)).toBe(false);
    expect(esPeriodoActual({ modo: "dia", desde: "2026-07-14", hasta: "2026-07-14" }, hoy)).toBe(true);
    expect(esPeriodoActual({ modo: "dia", desde: "2026-07-13", hasta: "2026-07-13" }, hoy)).toBe(false);
  });
});

describe("rangoPersonalizado", () => {
  it("normaliza el orden si 'hasta' llega antes que 'desde'", () => {
    const p = rangoPersonalizado("2026-07-14", "2026-07-01");
    expect(p).toMatchObject({ modo: "rango", desde: "2026-07-01", hasta: "2026-07-14" });
  });

  it("mantiene el orden si ya viene bien", () => {
    const p = rangoPersonalizado("2026-07-01", "2026-07-14");
    expect(p).toMatchObject({ desde: "2026-07-01", hasta: "2026-07-14" });
  });
});

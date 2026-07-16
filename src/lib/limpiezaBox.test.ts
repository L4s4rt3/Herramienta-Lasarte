import { describe, expect, it } from "vitest";
import {
  PIES_A_BOX,
  agregarLimpiezaCoste,
  boxAPies,
  piesABox,
  resumenLimpiezaEnRango,
  resumenLimpiezaPorSemanaIso,
  sumaHoras,
} from "./limpiezaBox";

describe("conversión pies ↔ box", () => {
  it("la constante refleja la equivalencia del dueño: 48 pies = 144 box", () => {
    expect(PIES_A_BOX).toBe(3);
    expect(piesABox(48)).toBe(144);
  });

  it("piesABox redondea a box entero", () => {
    expect(piesABox(1)).toBe(3);
    expect(piesABox(10.5)).toBe(32); // 31,5 → 32
    expect(piesABox(0.1)).toBe(0); // 0,3 → 0
  });

  it("piesABox devuelve 0 para valores no válidos o negativos", () => {
    expect(piesABox(0)).toBe(0);
    expect(piesABox(-5)).toBe(0);
    expect(piesABox(NaN)).toBe(0);
    expect(piesABox(Infinity)).toBe(0);
  });

  it("boxAPies invierte la conversión con 2 decimales", () => {
    expect(boxAPies(144)).toBe(48);
    expect(boxAPies(3)).toBe(1);
    expect(boxAPies(100)).toBe(33.33);
    expect(boxAPies(-9)).toBe(0);
    expect(boxAPies(NaN)).toBe(0);
  });
});

describe("sumaHoras", () => {
  it("suma las horas de los trabajadores ignorando valores no numéricos o negativos", () => {
    expect(
      sumaHoras([
        { horas: 8 },
        { horas: "4.5" },
        { horas: null },
        { horas: undefined },
        { horas: -2 },
        { horas: "no" },
      ]),
    ).toBe(12.5);
    expect(sumaHoras([])).toBe(0);
  });
});

const PARTES = [
  { fecha: "2026-07-06", box: 120, horas: 16 }, // lunes S28
  { fecha: "2026-07-08", box: 90, horas: 12 }, // miércoles S28
  { fecha: "2026-07-12", box: 30, horas: 4 }, // domingo S28
  { fecha: "2026-07-13", box: 144, horas: 24 }, // lunes S29
];

describe("resumenLimpiezaEnRango", () => {
  it("agrega box, horas y partes del rango inclusive", () => {
    const r = resumenLimpiezaEnRango(PARTES, "2026-07-06", "2026-07-12");
    expect(r.partes).toBe(3);
    expect(r.box).toBe(240);
    expect(r.horas).toBe(32);
    expect(r.boxPorHora).toBeCloseTo(7.5);
  });

  it("sin rango agrega todos los partes", () => {
    const r = resumenLimpiezaEnRango(PARTES);
    expect(r.partes).toBe(4);
    expect(r.box).toBe(384);
    expect(r.horas).toBe(56);
  });

  it("con 0 horas la media es null (no divide por cero)", () => {
    const r = resumenLimpiezaEnRango([{ fecha: "2026-07-06", box: 50, horas: 0 }]);
    expect(r.box).toBe(50);
    expect(r.boxPorHora).toBeNull();
  });

  it("rango sin partes devuelve el resumen vacío", () => {
    const r = resumenLimpiezaEnRango(PARTES, "2026-01-01", "2026-01-31");
    expect(r).toEqual({ partes: 0, box: 0, horas: 0, boxPorHora: null });
  });
});

describe("resumenLimpiezaPorSemanaIso", () => {
  it("agrupa por semana ISO (lunes a domingo) con la más reciente primero", () => {
    const semanas = resumenLimpiezaPorSemanaIso(PARTES);
    expect(semanas).toHaveLength(2);
    // S29 (lunes 13 jul 2026) primero por ser más reciente.
    expect(semanas[0].semanaInicio).toBe("2026-07-13");
    expect(semanas[0].weekNumber).toBe(29);
    expect(semanas[0].label).toBe("S29");
    expect(semanas[0].box).toBe(144);
    expect(semanas[0].horas).toBe(24);
    // S28 agrupa lunes, miércoles y domingo de la misma semana.
    expect(semanas[1].semanaInicio).toBe("2026-07-06");
    expect(semanas[1].weekNumber).toBe(28);
    expect(semanas[1].partes).toBe(3);
    expect(semanas[1].box).toBe(240);
  });

  it("ignora fechas no válidas sin romper", () => {
    const semanas = resumenLimpiezaPorSemanaIso([
      { fecha: "no-es-fecha", box: 10, horas: 1 },
      { fecha: "2026-07-06", box: 20, horas: 2 },
    ]);
    expect(semanas).toHaveLength(1);
    expect(semanas[0].box).toBe(20);
  });
});

describe("agregarLimpiezaCoste", () => {
  it("valora solo a los trabajadores de plantilla con coste_hora asignado", () => {
    const costeHoraPorTrabajador = new Map<string, number | null>([
      ["t1", 12],
      ["t2", null], // plantilla pero sin coste_hora asignado
    ]);
    const r = agregarLimpiezaCoste(
      [
        { trabajador_id: "t1", nombre: "Ana", horas: 4 },
        { trabajador_id: "t2", nombre: "Bea", horas: 3 },
        { trabajador_id: null, nombre: "Nombre libre", horas: 2 },
      ],
      costeHoraPorTrabajador,
    );
    expect(r.horasTotal).toBe(9);
    expect(r.horasConCoste).toBe(4);
    expect(r.horasSinCoste).toBe(5);
    expect(r.eurTotal).toBe(48); // 4h × 12€/h
    expect(r.nPersonasSinCoste).toBe(2); // Bea + Nombre libre
  });

  it("ignora horas no numéricas, cero o negativas sin romper", () => {
    const r = agregarLimpiezaCoste(
      [
        { trabajador_id: "t1", nombre: "Ana", horas: 0 },
        { trabajador_id: "t1", nombre: "Ana", horas: -3 },
        { trabajador_id: "t1", nombre: "Ana", horas: "no" as unknown as number },
        { trabajador_id: "t1", nombre: "Ana", horas: null },
      ],
      new Map([["t1", 10]]),
    );
    expect(r).toEqual({ horasTotal: 0, horasConCoste: 0, horasSinCoste: 0, eurTotal: 0, nPersonasSinCoste: 0 });
  });

  it("sin trabajadores ni mapa de costes devuelve el resumen vacío", () => {
    const r = agregarLimpiezaCoste([], new Map());
    expect(r).toEqual({ horasTotal: 0, horasConCoste: 0, horasSinCoste: 0, eurTotal: 0, nPersonasSinCoste: 0 });
  });

  it("un mismo nombre libre repetido en varios partes solo cuenta una vez en nPersonasSinCoste", () => {
    const r = agregarLimpiezaCoste(
      [
        { trabajador_id: null, nombre: "Suplente", horas: 3 },
        { trabajador_id: null, nombre: "Suplente", horas: 5 },
      ],
      new Map(),
    );
    expect(r.horasSinCoste).toBe(8);
    expect(r.nPersonasSinCoste).toBe(1);
  });
});

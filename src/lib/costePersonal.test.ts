import { describe, expect, it } from "vitest";
import {
  agruparCostePersonalPorZona,
  costeTrabajador,
  horasTrabajadas,
  JORNADA_BASE_HORAS,
  type TrabajadorCosteInput,
} from "./costePersonal";

describe("costePersonal", () => {
  it("horasTrabajadas multiplica días presente por la jornada base (8h)", () => {
    expect(JORNADA_BASE_HORAS).toBe(8);
    expect(horasTrabajadas(5)).toBe(40);
    expect(horasTrabajadas(0)).toBe(0);
    expect(horasTrabajadas(3, 6)).toBe(18);
    expect(horasTrabajadas(-2)).toBe(0);
  });

  it("costeTrabajador calcula horas x coste_hora", () => {
    expect(costeTrabajador({ coste_hora: 10, diasPresente: 5 })).toBe(400);
    expect(costeTrabajador({ coste_hora: 12.5, diasPresente: 1 })).toBe(100);
  });

  it("costeTrabajador da 0 si coste_hora es null o no finito", () => {
    expect(costeTrabajador({ coste_hora: null, diasPresente: 10 })).toBe(0);
    expect(costeTrabajador({ coste_hora: undefined, diasPresente: 10 })).toBe(0);
    expect(costeTrabajador({ coste_hora: NaN, diasPresente: 10 })).toBe(0);
  });

  const trabajadores: TrabajadorCosteInput[] = [
    { id: "1", nombre: "Ana", zona: "Malla 1", coste_hora: 10, diasPresente: 5 }, // 400
    { id: "2", nombre: "Berta", zona: "Malla 1", coste_hora: 8, diasPresente: 4 }, // 256
    { id: "3", nombre: "Carlos", zona: "Envasado", coste_hora: 12, diasPresente: 5 }, // 480
    { id: "4", nombre: "Diego", zona: "Envasado", coste_hora: null, diasPresente: 3 }, // 0, sin coste
    { id: "5", nombre: "Elena", zona: null, coste_hora: 9, diasPresente: 0 }, // 0 horas, no presente
  ];

  it("agrupa el coste por zona sumando coste, horas y personas", () => {
    const { porZona } = agruparCostePersonalPorZona(trabajadores);

    const malla1 = porZona.find((z) => z.zona === "Malla 1");
    expect(malla1).toEqual({ zona: "Malla 1", coste: 400 + 256, horas: 40 + 32, personas: 2 });

    const envasado = porZona.find((z) => z.zona === "Envasado");
    expect(envasado).toEqual({ zona: "Envasado", coste: 480, horas: 40 + 24, personas: 2 });

    const sinZona = porZona.find((z) => z.zona === "Sin zona");
    expect(sinZona).toEqual({ zona: "Sin zona", coste: 0, horas: 0, personas: 1 });
  });

  it("cuenta sinCoste solo entre los trabajadores presentes sin coste_hora", () => {
    const { sinCoste } = agruparCostePersonalPorZona(trabajadores);
    // Diego está presente (3 días) y sin coste_hora -> cuenta.
    // Elena no tiene coste_hora pero no estuvo presente (0 días) -> no cuenta.
    expect(sinCoste).toBe(1);
  });

  it("calcula el total como la suma de todos los costes", () => {
    const { total } = agruparCostePersonalPorZona(trabajadores);
    expect(total).toBe(400 + 256 + 480 + 0 + 0);
  });

  it("ordena porPersona por coste descendente", () => {
    const { porPersona } = agruparCostePersonalPorZona(trabajadores);
    expect(porPersona.map((p) => p.id)).toEqual(["3", "1", "2", "4", "5"]);
    expect(porPersona[0]).toMatchObject({ id: "3", nombre: "Carlos", zona: "Envasado", coste: 480, costeHora: 12 });
  });

  it("expone costeHora null para quien no tiene coste asignado", () => {
    const { porPersona } = agruparCostePersonalPorZona(trabajadores);
    const diego = porPersona.find((p) => p.id === "4");
    expect(diego?.costeHora).toBeNull();
    expect(diego?.coste).toBe(0);
  });

  it("devuelve estructura vacía consistente sin trabajadores", () => {
    expect(agruparCostePersonalPorZona([])).toEqual({ porZona: [], porPersona: [], total: 0, sinCoste: 0 });
  });
});

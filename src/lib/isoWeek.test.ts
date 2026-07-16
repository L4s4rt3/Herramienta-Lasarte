import { describe, expect, it } from "vitest";
import { addDays, buildRecentWeeks, getIsoWeekNumber, getWeekStart, toIsoDate } from "./isoWeek";

describe("toIsoDate", () => {
  it("formatea con componentes locales, con ceros a la izquierda", () => {
    expect(toIsoDate(new Date(2026, 0, 5))).toBe("2026-01-05");
    expect(toIsoDate(new Date(2026, 11, 31))).toBe("2026-12-31");
  });
});

describe("addDays", () => {
  it("suma y resta días sin mutar la fecha original", () => {
    const original = new Date(2026, 0, 1);
    const next = addDays(original, 10);
    expect(toIsoDate(original)).toBe("2026-01-01");
    expect(toIsoDate(next)).toBe("2026-01-11");
    expect(toIsoDate(addDays(original, -1))).toBe("2025-12-31");
  });
});

describe("getIsoWeekNumber", () => {
  it("lunes 29 dic 2025 pertenece a la semana 1 de 2026 (el jueves cae en 2026)", () => {
    expect(getIsoWeekNumber(new Date(2025, 11, 29))).toBe(1);
  });

  it("jueves 1 ene 2026 es semana 1 de 2026", () => {
    expect(getIsoWeekNumber(new Date(2026, 0, 1))).toBe(1);
  });

  it("año 2026 tiene semana 53 (31 dic 2026 es jueves)", () => {
    expect(getIsoWeekNumber(new Date(2026, 11, 28))).toBe(53); // lunes de esa semana
    expect(getIsoWeekNumber(new Date(2026, 11, 31))).toBe(53); // jueves
  });

  it("domingo cuenta como el último día de su semana ISO, no el primero", () => {
    // Semana del lunes 6 jul 2026 al domingo 12 jul 2026, ambos misma semana ISO.
    expect(getIsoWeekNumber(new Date(2026, 6, 6))).toBe(28);
    expect(getIsoWeekNumber(new Date(2026, 6, 12))).toBe(28);
  });
});

describe("getWeekStart", () => {
  it("un lunes devuelve el mismo día a las 12:00", () => {
    const lunes = new Date(2026, 6, 6, 8, 30); // lunes 6 jul 2026
    const start = getWeekStart(lunes);
    expect(toIsoDate(start)).toBe("2026-07-06");
    expect(start.getHours()).toBe(12);
  });

  it("un domingo retrocede al lunes de esa misma semana", () => {
    const domingo = new Date(2026, 6, 12, 23, 0); // domingo 12 jul 2026
    const start = getWeekStart(domingo);
    expect(toIsoDate(start)).toBe("2026-07-06");
  });

  it("cruza el cambio de año calendario correctamente", () => {
    const jueves = new Date(2026, 0, 1); // jueves 1 ene 2026
    const start = getWeekStart(jueves);
    expect(toIsoDate(start)).toBe("2025-12-29"); // lunes de esa semana, en el año anterior
  });
});

describe("buildRecentWeeks", () => {
  it("construye N semanas consecutivas terminando en la semana del ancla", () => {
    const anchor = new Date(2026, 6, 8); // miércoles 8 jul 2026
    const weeks = buildRecentWeeks(3, anchor);
    expect(weeks).toHaveLength(3);
    expect(weeks.map((w) => w.start)).toEqual(["2026-06-22", "2026-06-29", "2026-07-06"]);
    expect(weeks.map((w) => w.end)).toEqual(["2026-06-28", "2026-07-05", "2026-07-12"]);
    // La última semana del array es la que contiene el ancla.
    const last = weeks[weeks.length - 1];
    expect(last.weekNumber).toBe(28);
    expect(last.label).toBe("S28");
    expect(last.rangeLabel).toContain("-");
  });

  it("gestiona el cambio de año ISO dentro del rango de semanas construidas", () => {
    const anchor = new Date(2026, 0, 1); // jueves 1 ene 2026
    const weeks = buildRecentWeeks(2, anchor);
    // Semana anterior: lunes 22 dic 2025, semana 52 de 2025.
    expect(weeks[0].start).toBe("2025-12-22");
    expect(weeks[0].weekNumber).toBe(52);
    // Semana del ancla: lunes 29 dic 2025, pero semana ISO 1 de 2026.
    expect(weeks[1].start).toBe("2025-12-29");
    expect(weeks[1].weekNumber).toBe(1);
    expect(weeks[1].label).toBe("S1");
  });
});

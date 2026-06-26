import { describe, expect, it } from "vitest";
import {
  enumerateIsoDateRange,
  previousIsoDate,
  shouldApplyBajaLaboralToDate,
} from "./asistenciaBajasLaborales";

describe("asistencia bajas laborales", () => {
  it("generates all ISO dates in a closed period", () => {
    expect(enumerateIsoDateRange("2026-06-22", "2026-06-25")).toEqual([
      "2026-06-22",
      "2026-06-23",
      "2026-06-24",
      "2026-06-25",
    ]);
  });

  it("detects open-ended sick leave for the selected date", () => {
    expect(shouldApplyBajaLaboralToDate({ fecha_inicio: "2026-06-22", fecha_fin: null }, "2026-06-25")).toBe(true);
    expect(shouldApplyBajaLaboralToDate({ fecha_inicio: "2026-06-26", fecha_fin: null }, "2026-06-25")).toBe(false);
  });

  it("returns the previous ISO date", () => {
    expect(previousIsoDate("2026-06-01")).toBe("2026-05-31");
  });
});

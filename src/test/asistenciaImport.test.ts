import { describe, expect, it } from "vitest";
import {
  buildAttendanceRecords,
  extractDailyAttendanceNames,
  extractWeeklyAttendance,
  matchAttendanceName,
  parseAttendanceDate,
} from "@/lib/asistenciaImport";

describe("asistencia import helpers", () => {
  it("parses common Excel date text", () => {
    expect(parseAttendanceDate("03/06/2026")).toBe("2026-06-03");
    expect(parseAttendanceDate("jueves 4 jun", 2026)).toBe("2026-06-04");
    expect(parseAttendanceDate("2026-06-05")).toBe("2026-06-05");
  });

  it("extracts daily names from a name column", () => {
    const rows = [
      ["Nombre", "Grupo"],
      ["Ana Lopez", "Mallas"],
      ["Mario Perez", "Envasadoras"],
    ];

    expect(extractDailyAttendanceNames(rows)).toEqual(["Ana Lopez", "Mario Perez"]);
  });

  it("extracts weekly attendance from dates in header columns", () => {
    const rows = [
      ["Nombre", "03/06/2026", "04/06/2026"],
      ["Ana Lopez", "x", ""],
      ["Mario Perez", "", 1],
    ];

    expect(extractWeeklyAttendance(rows, 2026)).toEqual([
      { date: "2026-06-03", names: ["Ana Lopez"] },
      { date: "2026-06-04", names: ["Mario Perez"] },
    ]);
  });

  it("extracts weekly attendance from day lists by column", () => {
    const rows = [
      ["03/06/2026", null, "04/06/2026"],
      ["Ana Lopez", null, "Mario Perez"],
      ["Lucia Ruiz", null, "Ana Lopez"],
    ];

    expect(extractWeeklyAttendance(rows, 2026)).toEqual([
      { date: "2026-06-03", names: ["Ana Lopez", "Lucia Ruiz"] },
      { date: "2026-06-04", names: ["Mario Perez", "Ana Lopez"] },
    ]);
  });

  it("builds records using fuzzy worker matching", () => {
    expect(matchAttendanceName("Lopez, Ana", "Ana Lopez")).toBe(true);
    const records = buildAttendanceRecords(
      ["Lopez, Ana"],
      [
        { id: "1", nombre: "Ana Lopez" },
        { id: "2", nombre: "Mario Perez" },
      ],
      "user-1",
      "2026-06-03",
    );

    expect(records).toEqual([
      { user_id: "user-1", date: "2026-06-03", trabajador_id: "1", presente: true },
      { user_id: "user-1", date: "2026-06-03", trabajador_id: "2", presente: false },
    ]);
  });
});

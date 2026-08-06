import { describe, expect, it } from "vitest";
import {
  buildAttendanceRecords,
  extractDailyAttendanceNames,
  extractWeeklyAttendance,
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

  it("builds records resolving the worker by token set (order and comma agnostic)", () => {
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

  // Fichaje real de "LUNES MARTES AGOSTO.xlsx" (06-08-2026): el Excel de horas
  // trae el nombre legal con los DOS apellidos y la plantilla tiene el corto.
  it("casa el nombre legal completo del fichaje con el nombre corto de plantilla", () => {
    const plantilla = [
      { id: "ruben", nombre: "Rubén Chaparro" },
      { id: "carmen", nombre: "Carmen Carmelia Oprea" },
      { id: "alejandro", nombre: "Alejandro Carmona" },
    ];
    const records = buildAttendanceRecords(["CHAPARRO CARMONA, RUBEN"], plantilla, "user-1", "2026-08-03");

    // Solo Rubén: antes el emparejador difuso marcaba también a Carmen
    // Carmelia (prefijo "CARM" de CARMONA/CARMEN) y a Alejandro Carmona.
    expect(records.filter((r) => r.presente).map((r) => r.trabajador_id)).toEqual(["ruben"]);
  });

  it("no marca a nadie cuando el nombre casa con dos personas distintas", () => {
    const plantilla = [
      { id: "leon", nombre: "Sandra León" },
      { id: "naranjo", nombre: "Sandra Naranjo" },
    ];
    const soloNombre = buildAttendanceRecords(["SANDRA"], plantilla, "user-1", "2026-08-03");
    expect(soloNombre.every((r) => !r.presente)).toBe(true);

    // Con el apellido sí desambigua.
    const conApellido = buildAttendanceRecords(["NARANJO FRANCO, SANDRA PATRICIA"], plantilla, "user-1", "2026-08-03");
    expect(conApellido.filter((r) => r.presente).map((r) => r.trabajador_id)).toEqual(["naranjo"]);
  });

  it("respeta el alias aprendido para los nombres que no casan solos", () => {
    const plantilla = [{ id: "encarni", nombre: "Encarni Mínguez" }];
    const sinAlias = buildAttendanceRecords(["MINGUEZ PEREZ ENCARNACION"], plantilla, "user-1", "2026-08-03");
    expect(sinAlias.every((r) => !r.presente)).toBe(true);

    const alias = new Map([["minguez perez encarnacion", "encarni"]]);
    const conAlias = buildAttendanceRecords(["MINGUEZ PEREZ ENCARNACION"], plantilla, "user-1", "2026-08-03", alias);
    expect(conAlias.filter((r) => r.presente).map((r) => r.trabajador_id)).toEqual(["encarni"]);
  });
});

import { describe, expect, it } from "vitest";
import { darBajaTrabajadorPreservandoHistorial } from "./asistenciaTrabajadores";

describe("asistenciaTrabajadores", () => {
  it("keeps the worker row and only marks it inactive", () => {
    const trabajadores = [
      { id: "ana", nombre: "Ana", activo: true },
      { id: "luis", nombre: "Luis", activo: true },
    ];

    expect(darBajaTrabajadorPreservandoHistorial(trabajadores, "ana")).toEqual([
      { id: "ana", nombre: "Ana", activo: false },
      { id: "luis", nombre: "Luis", activo: true },
    ]);
  });
});

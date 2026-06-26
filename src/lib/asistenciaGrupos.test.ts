import { describe, expect, it } from "vitest";
import {
  addAsistenciaGroup,
  DEFAULT_ASISTENCIA_GRUPOS,
  removeAsistenciaGroup,
  renameAsistenciaGroup,
  sanitizeAsistenciaGroups,
} from "./asistenciaGrupos";

describe("asistenciaGrupos", () => {
  it("adds a trimmed group once keeping the existing order", () => {
    expect(addAsistenciaGroup(["Mallas"], "  Nueva zona  ")).toEqual(["Mallas", "Nueva zona"]);
    expect(addAsistenciaGroup(["Mallas"], "mallas")).toEqual(["Mallas"]);
  });

  it("removes a group by normalized name", () => {
    expect(removeAsistenciaGroup(["Mallas", "Nueva zona"], " nueva ZONA ")).toEqual(["Mallas"]);
  });

  it("renames a group preserving order and avoiding duplicates", () => {
    expect(renameAsistenciaGroup(["Mallas", "Mozos"], " mallas ", "  Confeccion malla ")).toEqual([
      "Confeccion malla",
      "Mozos",
    ]);
    expect(renameAsistenciaGroup(["Mallas", "Mozos"], "Mallas", "mozos")).toEqual(["Mallas", "Mozos"]);
  });

  it("sanitizes empty, duplicated and reserved names", () => {
    expect(sanitizeAsistenciaGroups(["", "Mallas", " mallas ", "Sin grupo", "Mozos"])).toEqual(["Mallas", "Mozos"]);
  });

  it("includes Industria as a default asistencia group", () => {
    expect(DEFAULT_ASISTENCIA_GRUPOS).toContain("Industria");
  });
});

import { describe, expect, it } from "vitest";
import {
  CALIDAD_OPTIONS,
  DEFECTO_OPTIONS,
  canValidateCalidadLote,
  createCalidadDraftReport,
  isCalidadLoteLocked,
  reopenCalidadLote,
  validateCalidadLote,
  type CalidadLote,
} from "./calidad";

function lote(overrides: Partial<CalidadLote> = {}): CalidadLote {
  return {
    id: "lote-1",
    jornada_id: "jornada-1",
    user_id: "user-1",
    fecha: "2026-06-29",
    numero_lote: "L-1",
    productor_finca_id: null,
    productor_finca_nombre: "Finca A",
    producto: "Naranja",
    variedad: "Navelina",
    cantidad: "64 frutos",
    hora: null,
    aerobotics_realizado: false,
    calidad: "Regular",
    defectos: [],
    defecto_otro: "",
    observacion: "",
    accion_recomendada: "",
    informe_estado: "borrador",
    informe_generado: "",
    ia_calidad: null,
    ia_defectos: [],
    ia_resumen: "",
    ia_accion_recomendada: "",
    validado_at: null,
    validado_by: null,
    reabierto_at: null,
    reabierto_by: null,
    motivo_reapertura: "",
    created_at: "2026-06-29T10:00:00Z",
    updated_at: "2026-06-29T10:00:00Z",
    ...overrides,
  };
}

describe("calidad MVP domain", () => {
  it("uses the agreed quality and defect options", () => {
    expect(CALIDAD_OPTIONS).toEqual(["Excelente", "Bueno", "Regular", "Deficiente", "Pésimo"]);
    expect(DEFECTO_OPTIONS).toEqual([
      "Rameado",
      "Golpe",
      "Podrido",
      "Mancha",
      "Calibre irregular",
      "Color verde",
      "Piel blanda",
      "Deshidratado",
      "Plaga",
      "Otro",
    ]);
  });

  it("blocks validation when Otro is selected without a manual description", () => {
    const result = canValidateCalidadLote(lote({ defectos: ["Otro"], defecto_otro: "" }), 1);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("Otro");
  });

  it("allows validation with photos and an Otro description", () => {
    const result = canValidateCalidadLote(lote({ defectos: ["Otro"], defecto_otro: "Arañazo raro" }), 1);
    expect(result.ok).toBe(true);
  });

  it("validates and locks a report", () => {
    const validated = validateCalidadLote(lote({ informe_estado: "generado" }), "user-2", "2026-06-29T12:00:00Z");
    expect(validated.informe_estado).toBe("validado");
    expect(validated.validado_by).toBe("user-2");
    expect(isCalidadLoteLocked(validated)).toBe(true);
  });

  it("reopens a validated report and requires revalidation", () => {
    const reopened = reopenCalidadLote(
      lote({ informe_estado: "validado", validado_at: "2026-06-29T12:00:00Z", validado_by: "user-2" }),
      "user-3",
      "2026-06-29T13:00:00Z",
    );
    expect(reopened.informe_estado).toBe("reabierto");
    expect(reopened.reabierto_by).toBe("user-3");
    expect(isCalidadLoteLocked(reopened)).toBe(false);
  });

  it("creates a useful draft report from structured data", () => {
    const report = createCalidadDraftReport(lote({ calidad: "Regular", defectos: ["Golpe", "Podrido"] }), 3, []);
    expect(report.informe).toContain("Finca A");
    expect(report.informe).toContain("regular");
    expect(report.informe).toContain("Golpe");
    expect(report.accion_recomendada).toContain("Revisar");
  });
});

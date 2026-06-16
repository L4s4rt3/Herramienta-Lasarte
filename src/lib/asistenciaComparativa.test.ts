import { describe, expect, it } from "vitest";
import {
  buildSemanasAsistenciaComparativa,
  contarPersonasComputablesPorDia,
  kgComparativaParte,
} from "./asistenciaComparativa";

describe("asistencia comparativa helpers", () => {
  it("counts all computable present workers and excludes carga y descarga", () => {
    const result = contarPersonasComputablesPorDia(
      [
        { date: "2026-06-15", presente: true, trabajador_id: "directa" },
        { date: "2026-06-15", presente: true, trabajador_id: "tratamiento" },
        { date: "2026-06-15", presente: true, trabajador_id: "general" },
        { date: "2026-06-15", presente: true, trabajador_id: "carga" },
        { date: "2026-06-15", presente: false, trabajador_id: "ausente" },
      ],
      [
        { id: "directa", zona: "Mallas" },
        { id: "tratamiento", zona: "Volcador" },
        { id: "general", zona: "Mozos" },
        { id: "carga", zona: "Carga y descarga" },
        { id: "ausente", zona: "Envasadoras" },
      ],
    );

    expect(result).toEqual({ "2026-06-15": 3 });
  });

  it("uses real part production for comparison kg", () => {
    expect(kgComparativaParte({
      kg_produccion_calibrador: 100000,
      kg_mujeres_calibrador: 5000,
      kg_reciclado_malla_z1: 3000,
      kg_reciclado_malla_z2: 2000,
    })).toBe(90000);

    expect(kgComparativaParte({
      resumen_ia: { cascada: { produccion_real: 86750 } },
      kg_produccion_calibrador: 100000,
    })).toBe(86750);
  });

  it("builds weekly comparison rows from computable attendance and real kg", () => {
    const rows = buildSemanasAsistenciaComparativa({
      asistencia: [
        { date: "2026-06-15", presente: true, trabajador_id: "directa" },
        { date: "2026-06-15", presente: true, trabajador_id: "general" },
        { date: "2026-06-15", presente: true, trabajador_id: "carga" },
      ],
      trabajadores: [
        { id: "directa", zona: "Mallas" },
        { id: "general", zona: "Mozos" },
        { id: "carga", zona: "Carga y descarga" },
      ],
      produccion: [
        {
          date: "2026-06-15",
          kg_produccion_calibrador: 50000,
          kg_mujeres_calibrador: 4000,
          kg_reciclado_malla_z1: 1000,
          kg_reciclado_malla_z2: 0,
        },
      ],
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].weekStart).toBe("2026-06-15");
    expect(rows[0].days.Lun.workers).toBe(2);
    expect(rows[0].days.Lun.kg).toBe(45000);
    expect(rows[0].days.Lun.kgPorPersona).toBe(22500);
  });
});

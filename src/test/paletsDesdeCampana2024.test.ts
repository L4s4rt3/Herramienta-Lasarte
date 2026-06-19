import { describe, expect, it } from "vitest";
import {
  PALETS_DESDE_CAMPANA_2024_KG_DIARIOS,
  buildPaletsDesdeCampana2024BasesKgRows,
} from "@/lib/paletsDesdeCampana2024";

describe("palets desde campana 2024", () => {
  it("ships daily net pallet kg from the supplied workbook", () => {
    const totalKg = PALETS_DESDE_CAMPANA_2024_KG_DIARIOS.reduce((total, row) => total + row.kgNetos, 0);
    const september2025 = PALETS_DESDE_CAMPANA_2024_KG_DIARIOS.filter((row) => row.fecha.startsWith("2025-09"));

    expect(PALETS_DESDE_CAMPANA_2024_KG_DIARIOS).toHaveLength(459);
    expect(PALETS_DESDE_CAMPANA_2024_KG_DIARIOS[0]).toEqual({ fecha: "2024-09-02", kgNetos: 31157 });
    expect(PALETS_DESDE_CAMPANA_2024_KG_DIARIOS.at(-1)).toEqual({ fecha: "2026-06-18", kgNetos: 66410 });
    expect(totalKg).toBe(41210597);
    expect(september2025).toHaveLength(0);
  });

  it("converts daily pallet kg into user scoped kg base rows", () => {
    const rows = buildPaletsDesdeCampana2024BasesKgRows("user-1");

    expect(rows).toHaveLength(459);
    expect(rows[0]).toMatchObject({
      user_id: "user-1",
      tipo_base: "palets",
      fecha_inicio: "2024-09-02",
      fecha_fin: "2024-09-02",
      kg: 31157,
      referencia: "palets desde campana 2024.xlsx:2024-09-02",
    });
  });
});

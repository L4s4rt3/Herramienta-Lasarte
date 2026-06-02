import { describe, it, expect } from "vitest";
import {
  isNumericCell,
  isNumericColumn,
  formatNumber,
  formatDate,
  formatCell,
  isStatusColumn,
  matchStatus,
  numericHeaderHint,
  columnMaxWidth,
} from "../../components/excel-preview/formatters";

describe("isNumericCell", () => {
  it.each([
    ["0", true],
    ["1", true],
    ["123", true],
    ["1234", true],
    ["-12", true],
    ["1.5", true],
    ["1,5", true],
    ["1.234,56", true],
    ["1,234.56", true],
    ["-1.234,56", true],
    ["50%", true],
    ["-3,5%", true],
  ])("returns true for %s", (input, expected) => {
    expect(isNumericCell(input)).toBe(expected);
  });

  it.each([
    ["", false],
    ["   ", false],
    ["abc", false],
    ["12a", false],
    ["Lote 5", false],
    ["26/05/2026", false],
  ])("returns false for %s", (input, expected) => {
    expect(isNumericCell(input)).toBe(expected);
  });
});

describe("isNumericColumn", () => {
  it("returns false for empty column", () => {
    expect(isNumericColumn([["a"], ["b"]], 5)).toBe(false);
  });

  it("returns true when 100% of non-empty cells are numeric", () => {
    const rows = [["10"], ["20"], ["30"], ["40"]];
    expect(isNumericColumn(rows, 0)).toBe(true);
  });

  it("returns true when >50% are numeric", () => {
    const rows = [["10"], ["20"], ["30"], ["abc"], ["xyz"]];
    expect(isNumericColumn(rows, 0)).toBe(true);
  });

  it("returns false when <50% are numeric", () => {
    const rows = [["10"], ["abc"], ["xyz"], ["foo"]];
    expect(isNumericColumn(rows, 0)).toBe(false);
  });

  it("ignores empty cells in the calculation", () => {
    const rows = [["10"], [""], ["20"], [""], ["30"]];
    expect(isNumericColumn(rows, 0)).toBe(true);
  });
});

describe("formatNumber", () => {
  it.each([
    [0, "0"],
    [1, "1"],
    [1234, "1.234"],
    [1234.5, "1.234,5"],
    [1234.56, "1.234,56"],
    [-12.5, "-12,5"],
    [1234567, "1.234.567"],
    [1.0, "1"],
    [1.5, "1,5"],
    [0.5, "0,5"],
  ])("formats %s as %s", (input, expected) => {
    expect(formatNumber(input)).toBe(expected);
  });

  it("trims trailing zeros", () => {
    expect(formatNumber(1.5000001)).toBe("1,5");
    expect(formatNumber(100.0)).toBe("100");
  });

  it("returns empty string for null and undefined", () => {
    expect(formatNumber(null)).toBe("");
    expect(formatNumber(undefined)).toBe("");
  });

  it("returns empty string for NaN", () => {
    expect(formatNumber(NaN)).toBe("");
  });

  it("formats percentage with % preserved", () => {
    expect(formatNumber(50, { isPercent: true })).toBe("50%");
    expect(formatNumber(12.5, { isPercent: true })).toBe("12,5%");
  });
});

describe("formatDate", () => {
  it("formats JS Date to DD/MM/YYYY", () => {
    expect(formatDate(new Date(2026, 4, 22))).toBe("22/05/2026");
  });

  it("formats ISO string to DD/MM/YYYY", () => {
    expect(formatDate("2026-05-22")).toBe("22/05/2026");
    expect(formatDate("2026-05-22T00:00:00Z")).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
  });

  it("formats time-only string as HH:mm", () => {
    expect(formatDate("14:30")).toBe("14:30");
  });

  it("formats datetime string", () => {
    expect(formatDate("2026-05-22T14:30:00")).toBe("22/05/2026 14:30");
  });

  it("returns empty for null/undefined", () => {
    expect(formatDate(null)).toBe("");
    expect(formatDate(undefined)).toBe("");
  });

  it("returns raw string if not parseable as date", () => {
    expect(formatDate("Lote 5")).toBe("Lote 5");
  });
});

describe("formatCell", () => {
  it("dispatches by type", () => {
    expect(formatCell(1234.5)).toBe("1.234,5");
    expect(formatCell("abc")).toBe("abc");
    expect(formatCell(new Date(2026, 4, 22))).toBe("22/05/2026");
    expect(formatCell(true)).toBe("Sí");
    expect(formatCell(false)).toBe("No");
  });

  it("returns empty for null/undefined", () => {
    expect(formatCell(null)).toBe("");
    expect(formatCell(undefined)).toBe("");
  });

  it("trims strings", () => {
    expect(formatCell("  abc  ")).toBe("abc");
  });
});

describe("isStatusColumn", () => {
  it.each([
    ["Estado", true],
    ["estado", true],
    ["Status", true],
    ["STATUS", true],
    ["Situación", true],
    ["Sit.", true],
    ["Nombre", false],
    ["Lote", false],
    ["", false],
  ])("returns %s for %s", (input, expected) => {
    expect(isStatusColumn(input)).toBe(expected);
  });
});

describe("matchStatus", () => {
  it.each([
    ["Activo", "success"],
    ["activo", "success"],
    ["Validado", "success"],
    ["Completado", "success"],
    ["Aprobado", "success"],
    ["Cerrado", "info"],
    ["Finalizado", "info"],
    ["Pendiente", "warning"],
    ["En curso", "warning"],
    ["Procesando", "warning"],
    ["Error", "destructive"],
    ["Rechazado", "destructive"],
    ["Cancelado", "destructive"],
    ["Algo random", "muted"],
    ["", "muted"],
  ])("matches %s to %s", (input, expected) => {
    expect(matchStatus(input)).toBe(expected);
  });
});

describe("numericHeaderHint", () => {
  it.each([
    ["kg", true],
    ["Peso (kg)", true],
    ["Cajas", true],
    ["Piezas", true],
    ["Importe €", true],
    ["%", true],
    ["Total", true],
    ["Precio medio", true],
    ["T/h", true],
    ["Lote", true],
    ["Cliente", false],
    ["Nombre", false],
    ["Fecha", false],
    ["", false],
  ])("returns %s for %s", (input, expected) => {
    expect(numericHeaderHint(input)).toBe(expected);
  });
});

describe("columnMaxWidth", () => {
  it("respects header length as minimum", () => {
    const w = columnMaxWidth("Lote", [], 0, 18);
    expect(w).toMatch(/^\d+(\.\d+)?rem$/);
  });

  it("caps at the limit when content is longer", () => {
    const w = columnMaxWidth("Lote", [["x".repeat(200)]], 0, 18);
    const rem = parseFloat(w);
    expect(rem).toBeLessThanOrEqual(18);
  });
});

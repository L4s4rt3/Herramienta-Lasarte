import { describe, expect, it } from "vitest";
import {
  buildReportCoverRows,
  buildReportFilename,
  formatReportDate,
  reportToneColor,
} from "./reportKit";
import { PDF_THEME } from "./exportTheme";

describe("reportKit", () => {
  it("builds stable report filenames", () => {
    const date = new Date("2026-06-16T10:30:00.000Z");
    expect(buildReportFilename("Informe Semanal Operativo", "pdf", date)).toBe("informe-semanal-operativo-2026-06-16.pdf");
    expect(buildReportFilename("Consumos físicos", "xlsx", date)).toBe("consumos-fisicos-2026-06-16.xlsx");
  });

  it("builds cover rows with report metadata and kpis", () => {
    const rows = buildReportCoverRows(
      {
        title: "Informe semanal operativo",
        subtitle: "Produccion y asistencia",
        periodLabel: "Semana 25",
        generatedAt: new Date("2026-06-16T10:30:00"),
      },
      [
        { label: "Kg producidos", value: "248.350", sub: "total" },
        { label: "Kg/persona", value: "4.820" },
      ],
    );

    expect(rows[0]).toEqual(["LASARTE SAT"]);
    expect(rows[1]).toEqual(["Informe semanal operativo"]);
    expect(rows[3]).toEqual(["Semana 25"]);
    expect(rows[6]).toEqual(["Indicador", "Valor", "Detalle"]);
    expect(rows[7]).toEqual(["Kg producidos", "248.350", "total"]);
    expect(rows[8]).toEqual(["Kg/persona", "4.820", ""]);
  });

  it("formats dates for Spanish reports", () => {
    expect(formatReportDate(new Date("2026-06-16T10:30:00"))).toContain("16/06/2026");
  });

  it("maps tones to shared PDF colors", () => {
    expect(reportToneColor("success")).toBe(PDF_THEME.success);
    expect(reportToneColor("warning")).toBe(PDF_THEME.warning);
    expect(reportToneColor("danger")).toBe(PDF_THEME.destructive);
    expect(reportToneColor("neutral")).toBe(PDF_THEME.primaryDark);
  });
});

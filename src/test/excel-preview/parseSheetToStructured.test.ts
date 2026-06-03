import { describe, expect, it } from "vitest";
import { parseSheetToStructured } from "../../components/ExcelViewerDialog";

describe("parseSheetToStructured", () => {
  it("preserves workbook headers so boxes and net weights stay in their columns", () => {
    const parsed = parseSheetToStructured(
      {
        name: "Palets",
        headers: [
          "Tipo Palet",
          "N. Palet",
          "Fecha",
          "Cliente",
          "Producto",
          "Lote",
          "Cajas",
          "Tipo caja",
          "Netos (kg)",
          "Facturacion",
          "Situacion",
        ],
        rows: [
          [
            "CAMARA",
            "3820",
            "01/06/2026",
            "CLIENTE A",
            "LIMON",
            "L-001",
            "84",
            "15 KG",
            "1260",
            "F",
            "S",
          ],
        ],
      },
      "Informe palets.xlsx"
    );

    expect(parsed.tables).toHaveLength(1);
    expect(parsed.tables[0].headers).toEqual([
      "Tipo Palet",
      "N. Palet",
      "Fecha",
      "Cliente",
      "Producto",
      "Lote",
      "Cajas",
      "Tipo caja",
      "Netos (kg)",
      "Facturacion",
      "Situacion",
    ]);
    expect(parsed.tables[0].rows[0][6]).toBe("84");
    expect(parsed.tables[0].rows[0][8]).toBe("1260");
  });
});

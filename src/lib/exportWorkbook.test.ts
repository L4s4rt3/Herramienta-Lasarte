import { describe, expect, it } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import {
  appendAoaSheet,
  appendRowsSheet,
  buildWorkbookXlsxBytes,
  createWorkbook,
} from "./exportWorkbook";

describe("Lasarte export workbook template", () => {
  it("adds the Lasarte header rows before table data", () => {
    const wb = createWorkbook("Test", "Template");
    const ws = appendRowsSheet(
      wb,
      "Detalle",
      [{ Nombre: "Marta", Kg: 1200 }],
      [24, 12],
      { freezeHeader: true },
    );

    expect(ws.A2?.v).toBe("Detalle");
    expect(ws.A3?.v).toBe("Nombre");
    expect(ws.B3?.v).toBe("Kg");
    expect(ws.A4?.v).toBe("Marta");
    expect(ws.B4?.v).toBe(1200);
    expect(ws["!autofilter"]?.ref).toBe("A3:B4");
    expect(ws["!freeze"]).toEqual({ xSplit: 0, ySplit: 3 });
    expect(ws["!cols"]?.slice(0, 4)).toEqual([
      { wch: 18 },
      { wch: 18 },
      { wch: 22 },
      { wch: 22 },
    ]);
    expect(ws["!rows"]?.[0]).toEqual({ hpt: 72 });
    expect(ws["!merges"]).toEqual(expect.arrayContaining([
      { s: { r: 0, c: 0 }, e: { r: 0, c: 3 } },
      { s: { r: 1, c: 0 }, e: { r: 1, c: 3 } },
    ]));
  });

  it("keeps the logo block width fixed even when the sheet has many columns", () => {
    const wb = createWorkbook("Test", "Template");
    const ws = appendRowsSheet(
      wb,
      "Muchos datos",
      [{ A: 1, B: 2, C: 3, D: 4, E: 5, F: 6 }],
      [10, 12, 40, 8, 30, 16],
      { freezeHeader: true },
    );

    expect(ws["!cols"]?.slice(0, 4)).toEqual([
      { wch: 18 },
      { wch: 18 },
      { wch: 22 },
      { wch: 22 },
    ]);
    expect(ws["!cols"]?.[4]).toEqual({ wch: 30 });
    expect(ws["!merges"]).toEqual(expect.arrayContaining([
      { s: { r: 0, c: 0 }, e: { r: 0, c: 3 } },
      { s: { r: 1, c: 0 }, e: { r: 1, c: 5 } },
    ]));
  });

  it("uses the same logo space for cover-style sheets", () => {
    const wb = createWorkbook("Test", "Template");
    const ws = appendAoaSheet(wb, "Portada", [
      [""],
      ["Informe"],
      ["Indicador", "Valor"],
      ["Dias", 3],
    ], [12, 20]);

    expect(ws["!cols"]?.slice(0, 4)).toEqual([
      { wch: 18 },
      { wch: 18 },
      { wch: 22 },
      { wch: 22 },
    ]);
    expect(ws["!rows"]?.[0]).toEqual({ hpt: 72 });
    expect(ws["!merges"]).toEqual(expect.arrayContaining([
      { s: { r: 0, c: 0 }, e: { r: 0, c: 3 } },
    ]));
  });

  it("injects the Lasarte logo, drawing relationships, and theme styles into xlsx bytes", () => {
    const wb = createWorkbook("Test", "Template");
    appendRowsSheet(wb, "Detalle", [{ Nombre: "Marta", Kg: 1200 }], [24, 12], { freezeHeader: true });

    const bytes = buildWorkbookXlsxBytes(wb, {
      logoBytes: new Uint8Array([1, 2, 3, 4]),
    });
    const zip = unzipSync(bytes);
    const names = Object.keys(zip);

    expect(names).toContain("xl/media/lasarte-sat-logo-1.jpeg");
    expect(names).toContain("xl/drawings/drawing1.xml");
    expect(names).toContain("xl/drawings/_rels/drawing1.xml.rels");
    expect(names).toContain("xl/worksheets/_rels/sheet1.xml.rels");

    const worksheet = strFromU8(zip["xl/worksheets/sheet1.xml"]);
    const rels = strFromU8(zip["xl/worksheets/_rels/sheet1.xml.rels"]);
    const drawing = strFromU8(zip["xl/drawings/drawing1.xml"]);
    const styles = strFromU8(zip["xl/styles.xml"]);

    expect(worksheet).toContain('<drawing r:id="rIdLasarteLogo1"/>');
    expect(rels).toContain('Target="../drawings/drawing1.xml"');
    expect(strFromU8(zip["xl/drawings/_rels/drawing1.xml.rels"])).toContain("../media/lasarte-sat-logo-1.jpeg");
    expect(drawing).toContain("<xdr:oneCellAnchor>");
    expect(drawing).not.toContain("<xdr:twoCellAnchor");
    expect(drawing).toContain('<xdr:from><xdr:col>0</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>0</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>');
    expect(drawing).toContain('<xdr:ext cx="4484370" cy="869384"/>');
    expect(drawing).toContain('name="Logo Lasarte SAT"');
    expect(drawing).toContain('r:embed="rId1"');
    expect(styles).toContain("102030");
    expect(styles).toContain("9BB8D8");
    expect(styles).toContain("E6B8B7");
  });
});

import { describe, expect, it } from "vitest";
import { repararPaletsMercadona } from "./useMercadonaExpediciones";

const palet = (part_id: string, producto: string, cliente: string | null, kg = 265) => ({
  part_id,
  producto,
  cliente,
  kg_neto: kg,
  n_cajas: 23,
  situacion: null,
});

describe("repararPaletsMercadona", () => {
  it("mantiene los palets con cliente Mercadona", () => {
    const rows = [palet("p1", "NAR VALENCIA LATE CAL6/8", "MERCADONA S.A.")];
    expect(repararPaletsMercadona(rows)).toHaveLength(1);
  });

  it("recupera un palet sin cliente si el mismo parte tiene el mismo producto como Mercadona", () => {
    const rows = [
      palet("p1", "NAR VALENCIA LATE CAL6/8", "MERCADONA S.A."),
      palet("p1", "NAR VALENCIA LATE CAL6/8", ""),
      palet("p1", "NAR VALENCIA LATE CAL6/8", null),
    ];
    expect(repararPaletsMercadona(rows)).toHaveLength(3);
  });

  it("NO recupera un palet sin cliente de un producto que nunca va a Mercadona en ese parte", () => {
    const rows = [
      palet("p1", "NAR VALENCIA LATE CAL6/8", "MERCADONA S.A."),
      palet("p1", "NAR VALENCIA MIDKNIGHT CATII CAL6/7", ""),
    ];
    expect(repararPaletsMercadona(rows)).toHaveLength(1);
  });

  it("NO recupera entre partes distintos (la coincidencia es por el mismo parte)", () => {
    const rows = [
      palet("p1", "NAR VALENCIA LATE CAL6/8", "MERCADONA S.A."),
      palet("p2", "NAR VALENCIA LATE CAL6/8", ""),
    ];
    expect(repararPaletsMercadona(rows)).toHaveLength(1);
  });

  it("NO toca palets con otro cliente aunque el producto coincida", () => {
    const rows = [
      palet("p1", "NAR VALENCIA LATE CAL6/8", "MERCADONA S.A."),
      palet("p1", "NAR VALENCIA LATE CAL6/8", "ALYCA ASOCIADOS 2015 S.L."),
    ];
    const result = repararPaletsMercadona(rows);
    expect(result).toHaveLength(1);
    expect(result[0].cliente).toBe("MERCADONA S.A.");
  });

  it("compara producto sin distinguir mayusculas ni espacios extremos", () => {
    const rows = [
      palet("p1", "NAR VALENCIA LATE CAL6/8", "MERCADONA S.A."),
      palet("p1", "  nar valencia late cal6/8 ", ""),
    ];
    expect(repararPaletsMercadona(rows)).toHaveLength(2);
  });
});

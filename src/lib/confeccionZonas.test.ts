import { describe, expect, it } from "vitest";
import { agregarConfeccionZonas, zonaConfeccionDe } from "./confeccionZonas";

describe("zonaConfeccionDe", () => {
  it("clasifica los productos reales del informe en su zona", () => {
    expect(zonaConfeccionDe({ date: "2026-07-01", producto: "MDNA 4KG GIRSAC CAL 6/8 MALLA EXTRUSIONADA", kg: 100 })).toBe("Mallas");
    expect(zonaConfeccionDe({ date: "2026-07-01", producto: "MDNA 5KG D-PACK CAL 5/6", kg: 100 })).toBe("Mallas");
    expect(zonaConfeccionDe({ date: "2026-07-01", producto: "LA FEA GRANEL CAL 6/7", kg: 100 })).toBe("Graneleras");
    expect(zonaConfeccionDe({ date: "2026-07-01", producto: "MDNA GRANEL CAL 1/2 (84-100 MM)", kg: 100 })).toBe("Graneleras");
    expect(zonaConfeccionDe({ date: "2026-07-01", producto: "LA FEA EMP CAL 2--2/48", kg: 100 })).toBe("Envasado");
    expect(zonaConfeccionDe({ date: "2026-07-01", producto: "INDUSTRIA", kg: 100 })).toBe("Industria");
    expect(zonaConfeccionDe({ date: "2026-07-01", producto: "INDUSTRIA GENERADA PRODUCCION LST", kg: 100 })).toBe("Industria");
  });

  it("excluye podrido, precalibrado y filas sin producto", () => {
    expect(zonaConfeccionDe({ date: "2026-07-01", producto: "PODRIDO", kg: 100 })).toBeNull();
    expect(zonaConfeccionDe({ date: "2026-07-01", producto: "PREC 1", kg: 100 })).toBeNull();
    expect(zonaConfeccionDe({ date: "2026-07-01", producto: null, kg: 100 })).toBeNull();
  });
});

describe("agregarConfeccionZonas", () => {
  const rows = [
    { date: "2026-07-01", producto: "MDNA 4KG GIRSAC CAL 6/8 MALLA EXTRUSIONADA", kg: 100 },
    { date: "2026-07-01", producto: "LA FEA GRANEL CAL 6/7", kg: 200 },
    { date: "2026-07-02", producto: "LA FEA EMP CAL 2--2/48", kg: 300 },
    { date: "2026-07-02", producto: "INDUSTRIA", kg: 50 },
    { date: "2026-07-02", producto: "PODRIDO", kg: 999 },
    { date: "2026-07-05", producto: "LA FEA GRANEL CAL 7/8", kg: 400 },
  ];

  it("suma por zona dentro del rango y cuenta los días", () => {
    const agg = agregarConfeccionZonas(rows, "2026-07-01", "2026-07-02");
    expect(agg.kg.Mallas).toBe(100);
    expect(agg.kg.Graneleras).toBe(200);
    expect(agg.kg.Envasado).toBe(300);
    expect(agg.kg.Industria).toBe(50);
    expect(agg.total).toBe(650);
    expect(agg.nDias).toBe(2);
  });

  it("ignora lo excluido y lo que cae fuera del rango", () => {
    const agg = agregarConfeccionZonas(rows, "2026-07-05", "2026-07-05");
    expect(agg.kg.Graneleras).toBe(400);
    expect(agg.total).toBe(400);
    expect(agg.nDias).toBe(1);
  });
});

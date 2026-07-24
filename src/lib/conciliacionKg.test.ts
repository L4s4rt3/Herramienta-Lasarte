import { describe, expect, it } from "vitest";
import {
  conciliarKgProcesados,
  contarBoxesReciclaje,
  familiaVariedad,
  mismaFamiliaVariedad,
  type EntradaConciliacion,
} from "./conciliacionKg";

const entrada = (over: Partial<EntradaConciliacion> & { lote: string; kg_entrada: number }): EntradaConciliacion => ({
  fecha: "2026-05-01",
  finca: "INVERMARMELO",
  articulo: "NAR VAL DELTA SEEDLESS",
  ...over,
});

describe("familiaVariedad / mismaFamiliaVariedad", () => {
  it("extrae el primer token distintivo, saltando los genéricos", () => {
    expect(familiaVariedad("NAR VAL DELTA SEEDLESS")).toBe("DELTA");
    expect(familiaVariedad("NARANJA VALENCIA DELTA")).toBe("DELTA");
    expect(familiaVariedad("NARANJA VALENCIA MIDKNIGHT")).toBe("MIDKNIGHT");
    expect(familiaVariedad("NAVELINA")).toBe("NAVELINA"); // NAVEL es genérico, NAVELINA no
    expect(familiaVariedad(null)).toBe("");
  });

  it("casa por prefijo (POWEL/POWELL) y nunca con familia vacía", () => {
    expect(mismaFamiliaVariedad("POWEL", "POWELL")).toBe(true);
    expect(mismaFamiliaVariedad("DELTA", "DELTA")).toBe(true);
    expect(mismaFamiliaVariedad("DELTA", "MIDKNIGHT")).toBe(false);
    expect(mismaFamiliaVariedad("", "")).toBe(false);
  });
});

describe("conciliarKgProcesados — asignación directa", () => {
  it("una pasada normal dentro de la entrada no genera movimientos", () => {
    const res = conciliarKgProcesados(
      [entrada({ lote: "26050101", kg_entrada: 20000 })],
      [{ lote_codigo: "26050101", kg_peso_total: 19000, date: "2026-05-03" }],
    );
    expect(res.procesados).toEqual([{ lote_codigo: "26050101", kg_peso_total: 19000, date: "2026-05-03" }]);
    expect(res.movimientos).toHaveLength(0);
    expect(res.excesosSinColocar).toHaveLength(0);
  });

  it("pasada multi-código: reparte con tope en el pendiente de cada lote nombrado (caso real 25111002+25111001)", () => {
    const res = conciliarKgProcesados(
      [
        entrada({ lote: "25111002", kg_entrada: 20000, fecha: "2025-11-10" }),
        entrada({ lote: "25111001", kg_entrada: 15000, fecha: "2025-11-10" }),
      ],
      [{ lote_codigo: "25111002+25111001", kg_peso_total: 29929, date: "2025-11-10" }],
    );
    const kg = new Map(res.procesados.map((p) => [p.lote_codigo, p.kg_peso_total]));
    expect(kg.get("25111002")).toBe(20000);
    expect(kg.get("25111001")).toBeCloseTo(9929);
    expect(res.movimientos).toEqual([{ de: "25111002", a: "25111001", kg: 9929, motivo: "multi_codigo" }]);
  });

  it("kg_preasignado (ajuste de stock) reduce el pendiente pero no aparece en el procesado sintético", () => {
    const res = conciliarKgProcesados(
      [entrada({ lote: "26050101", kg_entrada: 20000, kg_preasignado: 15000 })],
      [{ lote_codigo: "26050101", kg_peso_total: 5000, date: "2026-05-01" }],
    );
    expect(res.procesados[0].kg_peso_total).toBe(5000); // el ajuste lo suma buildStockEntradas aparte
    expect(res.excesosSinColocar).toHaveLength(0);
  });
});

describe("conciliarKgProcesados — derrame de excesos", () => {
  it("el patrón real proc≈2×entrada: el exceso va al lote hermano de la misma finca y variedad (que quedaba como stock fantasma)", () => {
    const res = conciliarKgProcesados(
      [
        entrada({ lote: "26021405", kg_entrada: 24940, fecha: "2026-02-14" }),
        entrada({ lote: "26021610", kg_entrada: 30400, fecha: "2026-02-16" }), // fantasma: 0 pasadas
      ],
      [{ lote_codigo: "26021405", kg_peso_total: 52235, date: "2026-02-14" }],
    );
    const kg = new Map(res.procesados.map((p) => [p.lote_codigo, p.kg_peso_total]));
    expect(kg.get("26021405")).toBe(24940); // ya no supera su entrada
    expect(kg.get("26021610")).toBeCloseTo(27295); // absorbe el exceso
    expect(res.movimientos).toEqual([
      { de: "26021405", a: "26021610", kg: 27295, motivo: "exceso_misma_finca" },
    ]);
    expect(res.deltaPorLote.get("26021405")).toBeCloseTo(-27295);
    expect(res.deltaPorLote.get("26021610")).toBeCloseTo(27295);
  });

  it("prioridad: misma finca antes que otra finca de la misma variedad; nunca a variedad distinta", () => {
    const res = conciliarKgProcesados(
      [
        entrada({ lote: "26030101", kg_entrada: 10000, fecha: "2026-03-01", finca: "DEHESILLA" }),
        entrada({ lote: "26030102", kg_entrada: 4000, fecha: "2026-03-01", finca: "DEHESILLA" }),
        entrada({ lote: "26030103", kg_entrada: 50000, fecha: "2026-03-01", finca: "COLOMBO" }), // misma variedad, otra finca
        entrada({ lote: "26030104", kg_entrada: 50000, fecha: "2026-03-01", finca: "DEHESILLA", articulo: "NARANJA NAVELINA" }), // otra variedad: jamás
      ],
      [{ lote_codigo: "26030101", kg_peso_total: 20000, date: "2026-03-01" }],
    );
    const kg = new Map(res.procesados.map((p) => [p.lote_codigo, p.kg_peso_total]));
    expect(kg.get("26030102")).toBe(4000); // primero agota la misma finca
    expect(kg.get("26030103")).toBeCloseTo(6000); // luego la misma variedad en otra finca
    expect(kg.has("26030104")).toBe(false);
    expect(res.movimientos.map((m) => m.motivo)).toEqual(["exceso_misma_finca", "exceso_misma_variedad"]);
  });

  it("candidatos de la misma finca se ordenan por cercanía de fecha de entrada", () => {
    const res = conciliarKgProcesados(
      [
        entrada({ lote: "26030101", kg_entrada: 10000, fecha: "2026-03-01" }),
        entrada({ lote: "26031501", kg_entrada: 8000, fecha: "2026-03-15" }), // a 14 días
        entrada({ lote: "26030301", kg_entrada: 8000, fecha: "2026-03-03" }), // a 2 días: primero
      ],
      [{ lote_codigo: "26030101", kg_peso_total: 15000, date: "2026-03-01" }],
    );
    expect(res.movimientos[0].a).toBe("26030301");
    expect(res.movimientos[0].kg).toBe(5000);
  });

  it("el exceso sin receptor queda en la cola de revisión, no se inventa", () => {
    const res = conciliarKgProcesados(
      [entrada({ lote: "26030101", kg_entrada: 10000 })],
      [{ lote_codigo: "26030101", kg_peso_total: 15000, date: "2026-03-02" }],
    );
    expect(res.excesosSinColocar).toEqual([{ lote: "26030101", kg: 5000 }]);
    expect(res.procesados[0].kg_peso_total).toBe(10000);
  });
});

describe("conciliarKgProcesados — precalibrado", () => {
  it("la entrada PREC absorbe su re-pasada, pero su exceso NO se derrama a lotes reales (sería doble cuenta)", () => {
    const res = conciliarKgProcesados(
      [
        entrada({ lote: "26063001", kg_entrada: 5000, esPrecalibrado: true, finca: "PREC 1 ALMACEN" }),
        entrada({ lote: "26050101", kg_entrada: 20000 }), // lote real con pendiente
      ],
      [{ lote_codigo: "PREC 26063001", kg_peso_total: 8000, date: "2026-07-01" }],
    );
    const kg = new Map(res.procesados.map((p) => [p.lote_codigo, p.kg_peso_total]));
    expect(kg.get("26063001")).toBe(5000);
    expect(kg.has("26050101")).toBe(false);
    expect(res.excesosSinColocar).toEqual([{ lote: "26063001", kg: 3000 }]);
  });

  it("precalibradoPendienteKg: re-entradas PREC aún sin pasada asignada = fruta física esperando línea", () => {
    const res = conciliarKgProcesados(
      [
        entrada({ lote: "26071502", kg_entrada: 5099, esPrecalibrado: true, fecha: "2026-07-15" }),
        entrada({ lote: "26071601", kg_entrada: 2009, esPrecalibrado: true, fecha: "2026-07-16" }),
        entrada({ lote: "26050101", kg_entrada: 20000 }), // real: no cuenta aquí
      ],
      // Solo la primera re-entrada tiene pasada (parcial: 3.000 de 5.099).
      [{ lote_codigo: "PREC 26071502", kg_peso_total: 3000, date: "2026-07-16" }],
    );
    expect(res.precalibradoPendienteKg).toBeCloseTo((5099 - 3000) + 2009);
  });

  it("los lotes PREC tampoco reciben derrames de lotes reales", () => {
    const res = conciliarKgProcesados(
      [
        entrada({ lote: "26050101", kg_entrada: 10000 }),
        entrada({ lote: "26063001", kg_entrada: 9000, esPrecalibrado: true }),
      ],
      [{ lote_codigo: "26050101", kg_peso_total: 14000, date: "2026-05-01" }],
    );
    expect(res.excesosSinColocar).toEqual([{ lote: "26050101", kg: 4000 }]);
  });

  it("pasada sin ningún código ('PREC DIA…') va a la cola con su texto crudo", () => {
    const res = conciliarKgProcesados(
      [entrada({ lote: "26050101", kg_entrada: 10000 })],
      [{ lote_codigo: "PREC DIA", kg_peso_total: 1868, date: "2025-11-08" }],
    );
    expect(res.excesosSinColocar).toEqual([{ lote: "PREC DIA", kg: 1868 }]);
  });
});

describe("conciliarKgProcesados — reciclaje diario (Z1/Z2 ya netos de tara)", () => {
  it("contarBoxesReciclaje suma todas las menciones 'N BOX' del texto", () => {
    expect(contarBoxesReciclaje("26042712 + 7 BOX DE RECICLAJE")).toBe(7);
    expect(contarBoxesReciclaje("26042411+PREC 26063001+8 BOX DE 4K M")).toBe(8);
    expect(contarBoxesReciclaje("26043003+2 BOX DE RECICLAJE")).toBe(2);
    expect(contarBoxesReciclaje("26050101")).toBe(0);
    expect(contarBoxesReciclaje(null)).toBe(0);
  });

  it("descuenta directamente los kg netos guardados en Z1/Z2 sin aplicar una segunda tara", () => {
    const res = conciliarKgProcesados(
      [entrada({ lote: "26050101", kg_entrada: 50000 })],
      [{ lote_codigo: "26050101", kg_peso_total: 20610, date: "2026-05-03" }],
      [{ fecha: "2026-05-03", kgBruto: 610, nBox: 3 }],
    );
    expect(res.kgReciclajeEstimado).toBeCloseTo(610);
    expect(res.procesados[0].kg_peso_total).toBeCloseTo(20000);
    expect(res.reciclaje[0]).toMatchObject({ lote: "(parte del 2026-05-03)", nBox: 3, kg: 610 });
  });

  it("el neto va primero a las pasadas que anotan boxes en el nombre (localizan por dónde volvió la fruta), el resto proporcional", () => {
    const res = conciliarKgProcesados(
      [
        entrada({ lote: "26050101", kg_entrada: 50000 }),
        entrada({ lote: "26050102", kg_entrada: 50000 }),
      ],
      [
        { lote_codigo: "26050101+2 BOX DE RECICLAJE", kg_peso_total: 10000, date: "2026-05-03" },
        { lote_codigo: "26050102", kg_peso_total: 20000, date: "2026-05-03" },
      ],
      // 640 kg netos: todo cabe en la pasada que anota los box.
      [{ fecha: "2026-05-03", kgBruto: 640, nBox: 2 }],
    );
    const kg = new Map(res.procesados.map((p) => [p.lote_codigo, p.kg_peso_total]));
    expect(kg.get("26050101")).toBeCloseTo(10000 - 640, 0);
    expect(kg.get("26050102")).toBeCloseTo(20000, 0);
    expect(res.reciclaje).toEqual([{ lote: "26050101", nBox: 2, kg: 640, fecha: "2026-05-03" }]);
  });

  it("sin dato del parte NO se descuenta nada: los boxes anotados en nombres no cuantifican fruta por sí solos", () => {
    const res = conciliarKgProcesados(
      [entrada({ lote: "26042712", kg_entrada: 25000 })],
      [{ lote_codigo: "26042712 + 7 BOX DE RECICLAJE", kg_peso_total: 20790, date: "2026-07-10" }],
    );
    expect(res.kgReciclajeEstimado).toBe(0);
    expect(res.procesados[0].kg_peso_total).toBe(20790);
  });

  it("el neto nunca descuenta más que los kg procesados del día", () => {
    const res = conciliarKgProcesados(
      [entrada({ lote: "26050101", kg_entrada: 50000 })],
      [{ lote_codigo: "26050101", kg_peso_total: 300, date: "2026-05-04" }],
      [{ fecha: "2026-05-04", kgBruto: 3000, nBox: 10 }], // neto declarado 2.700, solo hay 300 procesados
    );
    expect(res.procesados).toHaveLength(0); // los 300 kg eran todos reciclaje
    expect(res.kgReciclajeEstimado).toBeCloseTo(300);
  });
});

describe("conciliarKgProcesados — capacidad de cámara (tope de merma)", () => {
  it("con merma REAL de cámara registrada, el lote no puede absorber más que peso inicial − merma (caso real Dehesilla 26042811: 21.580 − 820)", () => {
    const res = conciliarKgProcesados(
      [entrada({ lote: "26042811", kg_entrada: 21580, fecha: "2026-04-28", kg_merma_camara: 820 })],
      // El calibrador atribuyó 23.561 kg a este lote el 08/07 (incluía otra fruta).
      [{ lote_codigo: "26042811", kg_peso_total: 23561, date: "2026-07-08" }],
    );
    expect(res.procesados[0].kg_peso_total).toBe(21580 - 820); // 20.760 = peso final real de cámara
    expect(res.excesosSinColocar[0].kg).toBeCloseTo(23561 - 20760);
  });

  it("sin dato real, la capacidad se estima con la tasa diaria: un lote 70 días en cámara no llega al 100 % de su entrada", () => {
    const res = conciliarKgProcesados(
      [entrada({ lote: "26042811", kg_entrada: 20000, fecha: "2026-04-28" })],
      [{ lote_codigo: "26042811", kg_peso_total: 20000, date: "2026-07-07" }], // 70 días
    );
    const esperado = 20000 * (1 - 0.000553 * 70);
    expect(res.procesados[0].kg_peso_total).toBeCloseTo(esperado, 0);
    expect(res.excesosSinColocar[0].kg).toBeCloseTo(20000 - esperado, 0);
  });
});

describe("conciliarKgProcesados — fechas y cierres", () => {
  it("el receptor del derrame hereda la última fecha de las pasadas del donante (salvo si está cerrado a mano)", () => {
    const res = conciliarKgProcesados(
      [
        entrada({ lote: "26030101", kg_entrada: 10000, fecha: "2026-03-01" }),
        entrada({ lote: "26030301", kg_entrada: 8000, fecha: "2026-03-03" }),
        entrada({ lote: "26030401", kg_entrada: 8000, fecha: "2026-03-04", cerrado: true }),
      ],
      [{ lote_codigo: "26030101", kg_peso_total: 30000, date: "2026-03-01" }],
    );
    const porLote = new Map(res.procesados.map((p) => [p.lote_codigo, p]));
    expect(porLote.get("26030301")?.date).toBe("2026-03-01"); // hereda
    expect(porLote.get("26030401")?.date).toBeNull(); // cerrado: recibe kg pero sin fecha (no dispara "actividad posterior al cierre")
    expect(porLote.get("26030401")?.kg_peso_total).toBe(8000);
  });
});

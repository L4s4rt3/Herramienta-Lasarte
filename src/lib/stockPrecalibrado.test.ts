import { describe, expect, it } from "vitest";
import { buildStockPrecalibrado, extraerAlmacenPrec, UMBRAL_PENDIENTE_PREC_KG } from "./stockPrecalibrado";

const reentrada = (over: Partial<Parameters<typeof buildStockPrecalibrado>[0][number]> & { lote: string; kg_entrada: number }) => ({
  fecha: "2026-07-01",
  finca: "PREC 1 ALMACEN",
  ...over,
});

describe("extraerAlmacenPrec", () => {
  it("saca el número del almacén de la finca de báscula", () => {
    expect(extraerAlmacenPrec("PREC 1 ALMACEN")).toBe("PREC 1");
    expect(extraerAlmacenPrec("PREC 2 ALMACEN")).toBe("PREC 2");
    expect(extraerAlmacenPrec("PREC2 ALMACEN")).toBe("PREC 2");
    expect(extraerAlmacenPrec(null)).toBe("PREC");
    expect(extraerAlmacenPrec("ALMACEN PRECALIBRADO")).toBe("PREC");
  });
});

describe("buildStockPrecalibrado", () => {
  it("pendiente por re-entrada = kg − conciliado a su código; los totales conservan (reintroducido = reprocesado + pendiente)", () => {
    const stock = buildStockPrecalibrado(
      [
        reentrada({ lote: "26050101", kg_entrada: 10000 }),
        reentrada({ lote: "26050102", kg_entrada: 8000, finca: "PREC 2 ALMACEN" }),
      ],
      [
        { lote_codigo: "26050101", kg_peso_total: 10000 }, // re-pasado entero
        { lote_codigo: "26050102", kg_peso_total: 3000 },  // a medias
      ],
      "2026-07-28",
    );
    expect(stock.kgReintroducido).toBe(18000);
    expect(stock.kgReprocesado).toBe(13000);
    expect(stock.kgPendiente).toBe(5000);
    expect(stock.kgReprocesado + stock.kgPendiente).toBe(stock.kgReintroducido);
    expect(stock.pendientes).toHaveLength(1);
    expect(stock.pendientes[0]).toMatchObject({ lote: "26050102", almacen: "PREC 2", kgPendiente: 5000, dias: 27 });
  });

  it("lo conciliado por encima de la re-entrada NO produce pendiente negativo (min defensivo)", () => {
    const stock = buildStockPrecalibrado(
      [reentrada({ lote: "26050101", kg_entrada: 5000 })],
      [{ lote_codigo: "26050101", kg_peso_total: 6000 }],
      "2026-07-28",
    );
    expect(stock.kgReprocesado).toBe(5000);
    expect(stock.kgPendiente).toBe(0);
  });

  it("los residuos pequeños suman en los totales pero no se listan (umbral por re-entrada)", () => {
    const stock = buildStockPrecalibrado(
      [reentrada({ lote: "26050101", kg_entrada: 1000 })],
      [{ lote_codigo: "26050101", kg_peso_total: 1000 - UMBRAL_PENDIENTE_PREC_KG + 1 }],
      "2026-07-28",
    );
    expect(stock.kgPendiente).toBe(UMBRAL_PENDIENTE_PREC_KG - 1);
    expect(stock.pendientes).toHaveLength(0);
  });

  it("agrupa por almacén (PREC 1 / PREC 2) y ordena los pendientes del más antiguo al más nuevo", () => {
    const stock = buildStockPrecalibrado(
      [
        reentrada({ lote: "26050101", kg_entrada: 2000, fecha: "2026-07-10" }),
        reentrada({ lote: "26050102", kg_entrada: 3000, fecha: "2026-06-20", finca: "PREC 2 ALMACEN" }),
      ],
      [],
      "2026-07-28",
    );
    expect(stock.porAlmacen.map((a) => a.almacen)).toEqual(["PREC 2", "PREC 1"]);
    expect(stock.pendientes.map((p) => p.lote)).toEqual(["26050102", "26050101"]);
  });

  it("el código de la re-entrada se normaliza a 8 dígitos para casar con las pasadas ('26050101 + 2 BOX')", () => {
    const stock = buildStockPrecalibrado(
      [reentrada({ lote: "26050101", kg_entrada: 1000 })],
      [{ lote_codigo: "26050101 + 2 BOX DE RECICLAJE", kg_peso_total: 1000 }],
      "2026-07-28",
    );
    expect(stock.kgPendiente).toBe(0);
  });
});

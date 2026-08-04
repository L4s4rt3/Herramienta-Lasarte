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

  it("expone el id de la re-entrada en `pendientes` (para el botón de cierre manual 1-clic); null si no se pasó", () => {
    const conId = buildStockPrecalibrado(
      [reentrada({ lote: "26050101", kg_entrada: 5000, id: "abc-123" })],
      [],
      "2026-07-28",
    );
    expect(conId.pendientes[0].id).toBe("abc-123");

    const sinId = buildStockPrecalibrado(
      [reentrada({ lote: "26050101", kg_entrada: 5000 })],
      [],
      "2026-07-28",
    );
    expect(sinId.pendientes[0].id).toBeNull();
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

describe("buildStockPrecalibrado — evidencia de pasada compuesta (refuerzo 04-08-2026, caso real 25111002+25111001+PREC 25111901 verificado en BD)", () => {
  it("re-entrada nombrada como no-primero en una pasada compuesta se da por consumida ENTERA, sin inventar un kg intermedio", () => {
    const huerfanos = new Map([["25111901", { primeros: ["25111002"], ultimaFecha: "2025-11-19" }]]);
    const stock = buildStockPrecalibrado(
      [reentrada({ lote: "25111901", kg_entrada: 5437, fecha: "2025-11-19" })],
      [], // 0 kg bajo su propio código: el reparto por capacidad se lo llevó todo el código principal
      "2026-08-04",
      huerfanos,
    );
    expect(stock.pendientes).toHaveLength(0); // NO se queda en la cola de "sin indicación"
    expect(stock.resueltasPorCompuesta).toEqual([
      { lote: "25111901", fecha: "2025-11-19", almacen: "PREC 1", kg: 5437, primeros: ["25111002"], ultimaFecha: "2025-11-19", dias: 258 },
    ]);
    // Conservación: se consume ENTERA (kg conocido, ninguno inventado ni perdido).
    expect(stock.kgReprocesado).toBe(5437);
    expect(stock.kgPendiente).toBe(0);
    expect(stock.kgReprocesado + stock.kgPendiente).toBe(stock.kgReintroducido);
  });

  it("con ALGO de kg directo bajo su propio código, la evidencia de compuesta NO se consulta ni hace falta: manda el directo", () => {
    const huerfanos = new Map([["26050101", { primeros: ["26050001"], ultimaFecha: "2026-05-01" }]]);
    const stock = buildStockPrecalibrado(
      [reentrada({ lote: "26050101", kg_entrada: 5000 })],
      [{ lote_codigo: "26050101", kg_peso_total: 5000 }], // ya cubierta del todo por su propio código
      "2026-07-28",
      huerfanos,
    );
    expect(stock.resueltasPorCompuesta).toHaveLength(0);
    expect(stock.kgPendiente).toBe(0);
  });

  it("sin NINGUNA mención (ni directa ni compuesta) se queda en 'pendientes': no se inventa nada (encargo explícito del dueño)", () => {
    const stock = buildStockPrecalibrado(
      [reentrada({ lote: "26050101", kg_entrada: 5000 })],
      [],
      "2026-07-28",
      new Map(), // ninguna evidencia
    );
    expect(stock.resueltasPorCompuesta).toHaveLength(0);
    expect(stock.pendientes).toHaveLength(1);
    expect(stock.pendientes[0].kgPendiente).toBe(5000);
  });

  it("una re-entrada YA cerrada a mano no se toca aunque tenga evidencia de compuesta pendiente de aplicar", () => {
    const huerfanos = new Map([["25111901", { primeros: ["25111002"], ultimaFecha: "2025-11-19" }]]);
    const stock = buildStockPrecalibrado(
      [reentrada({ lote: "25111901", kg_entrada: 5437, fecha: "2025-11-19", cerrado_at: "2026-01-01T00:00:00Z" })],
      [],
      "2026-08-04",
      huerfanos,
    );
    expect(stock.resueltasPorCompuesta).toHaveLength(0);
    expect(stock.candidatosCierre).toHaveLength(0);
  });
});

describe("buildStockPrecalibrado — candidatosCierre (cierre automático persistido, mismo margen DIAS_SIN_ACTIVIDAD_AUTOCIERRE=2 que el resto)", () => {
  it("motivo 'compuesto': candidata con ≥2 días desde la ÚLTIMA pasada compuesta que la menciona", () => {
    const huerfanos = new Map([["25111901", { primeros: ["25111002"], ultimaFecha: "2026-08-01" }]]);
    const listo = buildStockPrecalibrado(
      [reentrada({ lote: "25111901", kg_entrada: 5437, id: "id-1" })],
      [],
      "2026-08-03", // exactamente 2 días desde la última mención
      huerfanos,
    );
    expect(listo.candidatosCierre).toEqual([{ id: "id-1", lote: "25111901", motivo: "compuesto" }]);

    const aun = buildStockPrecalibrado(
      [reentrada({ lote: "25111901", kg_entrada: 5437, id: "id-1" })],
      [],
      "2026-08-02", // 1 día: se espera a que se asiente
      huerfanos,
    );
    expect(aun.candidatosCierre).toHaveLength(0);
  });

  it("motivo 'consumido': candidata cuando la re-pasada bajo su propio código cubre el kg y ha pasado el margen desde esa pasada", () => {
    const listo = buildStockPrecalibrado(
      [reentrada({ lote: "26050101", kg_entrada: 5000, id: "id-2" })],
      [{ lote_codigo: "26050101", kg_peso_total: 5000, date: "2026-08-01" }],
      "2026-08-03",
    );
    expect(listo.candidatosCierre).toEqual([{ id: "id-2", lote: "26050101", motivo: "consumido" }]);

    const aun = buildStockPrecalibrado(
      [reentrada({ lote: "26050101", kg_entrada: 5000, id: "id-2" })],
      [{ lote_codigo: "26050101", kg_peso_total: 5000, date: "2026-08-02" }],
      "2026-08-03", // 1 día: aún no
    );
    expect(aun.candidatosCierre).toHaveLength(0);
  });

  it("sin id -> nunca candidata (no se puede cerrar lo que no se puede identificar)", () => {
    const huerfanos = new Map([["25111901", { primeros: ["25111002"], ultimaFecha: "2026-08-01" }]]);
    const stock = buildStockPrecalibrado(
      [reentrada({ lote: "25111901", kg_entrada: 5437 })], // sin id
      [],
      "2026-08-10",
      huerfanos,
    );
    expect(stock.candidatosCierre).toHaveLength(0);
  });

  it("pendiente sin resolver (ni directo ni compuesta) -> nunca candidata, por muchos días que lleve", () => {
    const stock = buildStockPrecalibrado(
      [reentrada({ lote: "26050101", kg_entrada: 5000, id: "id-3", fecha: "2025-01-01" })],
      [],
      "2026-08-10",
    );
    expect(stock.candidatosCierre).toHaveLength(0);
    expect(stock.pendientes).toHaveLength(1);
  });
});

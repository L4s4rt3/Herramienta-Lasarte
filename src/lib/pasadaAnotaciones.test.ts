import { describe, expect, it } from "vitest";
import { conciliarKgProcesados, type EntradaConciliacion } from "./conciliacionKg";
import {
  agruparAnotacionesPorLoteDia,
  construirLoteCodigoEfectivo,
  parsearCodigosAnotacion,
  validarCodigosContraBascula,
  type PasadaAnotacionRow,
} from "./pasadaAnotaciones";

const entrada = (over: Partial<EntradaConciliacion> & { lote: string; kg_entrada: number }): EntradaConciliacion => ({
  fecha: "2026-05-01",
  finca: "INVERMARMELO",
  articulo: "NAR VAL DELTA SEEDLESS",
  ...over,
});

const anotacion = (over: Partial<PasadaAnotacionRow> & { lote_dia_id: string; codigo_extra: string }): PasadaAnotacionRow => ({
  id: `${over.lote_dia_id}-${over.codigo_extra}`,
  user_id: "user-1",
  nota: null,
  created_at: "2026-08-04T10:00:00.000Z",
  ...over,
});

describe("construirLoteCodigoEfectivo — inyección del código anotado (a) y (c)", () => {
  it("sin anotaciones, devuelve el texto original SIN TOCAR (no-op)", () => {
    expect(construirLoteCodigoEfectivo("26050101", [])).toBe("26050101");
    expect(construirLoteCodigoEfectivo(null, [])).toBe("");
  });

  it("el código PRINCIPAL va siempre primero; los extra se añaden con ' - '", () => {
    expect(construirLoteCodigoEfectivo("25111002", ["25111001"])).toBe("25111002 - 25111001");
    expect(construirLoteCodigoEfectivo("25111002", ["25111001", "25111099"])).toBe("25111002 - 25111001 - 25111099");
  });

  it("respeta el ORDEN de indicación de los extra (nunca FIFO)", () => {
    // El dueño teclea 99 antes que 01: el motor debe verlos en ESE orden.
    expect(construirLoteCodigoEfectivo("25111002", ["25111099", "25111001"])).toBe("25111002 - 25111099 - 25111001");
  });

  it("DEDUP: nunca añade un código que ya aparece en el texto original", () => {
    expect(construirLoteCodigoEfectivo("25111002+25111001", ["25111001"])).toBe("25111002+25111001");
    // Mezcla: uno ya presente, otro nuevo — solo se añade el nuevo.
    expect(construirLoteCodigoEfectivo("25111002+25111001", ["25111001", "25111099"])).toBe("25111002+25111001 - 25111099");
  });

  it("DEDUP: nunca repite un código entre sí mismo, aunque venga duplicado en la lista de extras", () => {
    expect(construirLoteCodigoEfectivo("26050101", ["25111099", "25111099"])).toBe("26050101 - 25111099");
  });

  it("sin código original (texto vacío o null), los extra quedan solos sin separador colgando", () => {
    expect(construirLoteCodigoEfectivo(null, ["25111099"])).toBe("25111099");
    expect(construirLoteCodigoEfectivo("  ", ["25111099", "25111001"])).toBe("25111099 - 25111001");
  });

  it("preserva texto pegado del calibrador (boxes de reciclaje) antes de añadir el extra", () => {
    expect(construirLoteCodigoEfectivo("26042712 + 7 BOX DE RECICLAJE", ["25111099"])).toBe(
      "26042712 + 7 BOX DE RECICLAJE - 25111099",
    );
  });
});

describe("conciliarKgProcesados — el motor reparte a los anotados IGUAL que a los nombrados (b)", () => {
  it("un código anotado a posteriori produce EXACTAMENTE el mismo reparto que si viniera escrito en el nombre (fixture multi_codigo real 25111002+25111001)", () => {
    const entradas = [
      entrada({ lote: "25111002", kg_entrada: 20000, fecha: "2025-11-10" }),
      entrada({ lote: "25111001", kg_entrada: 15000, fecha: "2025-11-10" }),
    ];

    // Referencia: el calibrador SÍ escribió los dos códigos en el nombre.
    const referencia = conciliarKgProcesados(
      entradas,
      [{ lote_codigo: "25111002+25111001", kg_peso_total: 29929, date: "2025-11-10" }],
    );

    // Caso real: el calibrador solo escribió el principal; "25111001" es un
    // código ANOTADO a posteriori (dirección recordó que también se echó).
    // La inyección (construirLoteCodigoEfectivo) se hace ANTES de llamar al
    // motor — igual que useEntradasBascula.ts.
    const loteCodigoEfectivo = construirLoteCodigoEfectivo("25111002", ["25111001"]);
    const anotado = conciliarKgProcesados(
      entradas,
      [{ lote_codigo: loteCodigoEfectivo, kg_peso_total: 29929, date: "2025-11-10" }],
    );

    expect(anotado.procesados).toEqual(referencia.procesados);
    expect(anotado.movimientos).toEqual(referencia.movimientos);
    expect(anotado.excesosSinColocar).toEqual(referencia.excesosSinColocar);

    // Y de verdad reparte: el principal se llena primero (×0,97 de capacidad,
    // regla del dueño 04-08-2026) y el resto (el anotado) recibe lo que sobra.
    const kg = new Map(anotado.procesados.map((p) => [p.lote_codigo, p.kg_peso_total]));
    expect(kg.get("25111002")).toBe(19400);
    expect(kg.get("25111001")).toBeCloseTo(10529);
    expect(anotado.movimientos).toEqual([{ de: "25111002", a: "25111001", kg: 10529, motivo: "multi_codigo" }]);
  });

  it("con 2 códigos anotados, el sobrante tras llenar a los nombrados va a reentrada_nombrados igual que si vinieran escritos (fixture real 26030101+26030102)", () => {
    const entradas = [
      entrada({ lote: "26030101", kg_entrada: 10000, fecha: "2026-03-01" }),
      entrada({ lote: "26030102", kg_entrada: 4000, fecha: "2026-03-01" }),
      entrada({ lote: "26030199", kg_entrada: 50000, fecha: "2026-03-01" }), // misma finca, NO nombrado
    ];

    const referencia = conciliarKgProcesados(
      entradas,
      [{ lote_codigo: "26030101+26030102", kg_peso_total: 20000, date: "2026-03-01" }],
    );

    const loteCodigoEfectivo = construirLoteCodigoEfectivo("26030101", ["26030102"]);
    const anotado = conciliarKgProcesados(
      entradas,
      [{ lote_codigo: loteCodigoEfectivo, kg_peso_total: 20000, date: "2026-03-01" }],
    );

    expect(anotado.procesados).toEqual(referencia.procesados);
    expect(anotado.movimientos).toEqual(referencia.movimientos);
    expect(anotado.excesosSinColocar).toEqual(referencia.excesosSinColocar);
    // El lote ajeno (misma finca, no nombrado ni anotado) sigue sin recibir nada.
    expect(anotado.procesados.some((p) => p.lote_codigo === "26030199")).toBe(false);
  });
});

describe("validarCodigosContraBascula — validación de códigos no existentes (d)", () => {
  const codigosBascula = new Set(["25111001", "25111002", "26050101"]);

  it("separa encontrados de no-encontrados sin inventar ningún cruce", () => {
    const res = validarCodigosContraBascula(["25111001", "99999999", "26050101"], codigosBascula);
    expect(res.encontrados).toEqual(["25111001", "26050101"]);
    expect(res.noEncontrados).toEqual(["99999999"]);
  });

  it("todos encontrados: noEncontrados vacío", () => {
    const res = validarCodigosContraBascula(["25111001", "25111002"], codigosBascula);
    expect(res.encontrados).toEqual(["25111001", "25111002"]);
    expect(res.noEncontrados).toHaveLength(0);
  });

  it("ninguno encontrado: encontrados vacío, se reportan tal cual", () => {
    const res = validarCodigosContraBascula(["11111111", "22222222"], codigosBascula);
    expect(res.encontrados).toHaveLength(0);
    expect(res.noEncontrados).toEqual(["11111111", "22222222"]);
  });
});

describe("parsearCodigosAnotacion", () => {
  it("separa por comas/espacios/saltos de línea, normaliza y deduplica conservando el orden", () => {
    expect(parsearCodigosAnotacion("26051408, 26051906\n26051408 26052602")).toEqual([
      "26051408", "26051906", "26052602",
    ]);
  });

  it("ignora trozos sin 8 dígitos reconocibles", () => {
    expect(parsearCodigosAnotacion("hola, 26051408, x")).toEqual(["26051408"]);
  });
});

describe("agruparAnotacionesPorLoteDia", () => {
  it("agrupa por lote_dia_id preservando el orden de created_at (indicación del usuario, nunca FIFO)", () => {
    const filas: PasadaAnotacionRow[] = [
      anotacion({ lote_dia_id: "pasada-1", codigo_extra: "25111099", created_at: "2026-08-04T10:02:00.000Z" }),
      anotacion({ lote_dia_id: "pasada-1", codigo_extra: "25111001", created_at: "2026-08-04T10:01:00.000Z" }),
      anotacion({ lote_dia_id: "pasada-2", codigo_extra: "26050101", created_at: "2026-08-04T09:00:00.000Z" }),
    ];
    const mapa = agruparAnotacionesPorLoteDia(filas);
    expect(mapa.get("pasada-1")!.map((f) => f.codigo_extra)).toEqual(["25111001", "25111099"]);
    expect(mapa.get("pasada-2")!.map((f) => f.codigo_extra)).toEqual(["26050101"]);
  });

  it("lista vacía produce un mapa vacío (degradado cuando la migración aún no está aplicada)", () => {
    expect(agruparAnotacionesPorLoteDia([]).size).toBe(0);
  });
});

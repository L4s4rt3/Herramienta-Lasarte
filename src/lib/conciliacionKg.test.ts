import { describe, expect, it } from "vitest";
import {
  capacidadFraccionEstimada,
  conciliarKgProcesados,
  contarBoxesReciclaje,
  detectarLotesEnPasadaCompuesta,
  familiaVariedad,
  mismaFamiliaVariedad,
  type EntradaConciliacion,
  type PasadaConciliacion,
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
    // Regla del dueño 04-08-2026 (2ª parte): la capacidad ya no es el 100 %
    // de la entrada, descuenta también el podrido pre-calibrador habitual
    // (×0,97): 20000×0,97=19400 y 15000×0,97=14550.
    expect(kg.get("25111002")).toBe(19400);
    expect(kg.get("25111001")).toBeCloseTo(10529); // 29929 − 19400, cabe entero en su pendiente (14550)
    expect(res.movimientos).toEqual([{ de: "25111002", a: "25111001", kg: 10529, motivo: "multi_codigo" }]);
    expect(res.excesosSinColocar).toHaveLength(0);
  });

  it("kg_preasignado (ajuste de stock) reduce el pendiente pero no aparece en el procesado sintético", () => {
    const res = conciliarKgProcesados(
      // kg_preasignado bajado de 15000 a 10000 (regla 04-08-2026: la
      // capacidad ya no es la entrada completa, 20000×0,97=19400 — con
      // 15000 preasignados este caso ya no cabía y probaba otra cosa).
      [entrada({ lote: "26050101", kg_entrada: 20000, kg_preasignado: 10000 })],
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
    // Regla del dueño 04-08-2026 (2ª parte): la capacidad descuenta también
    // el podrido pre-calibrador habitual (×0,97): 24940×0,97=24191,8, y el
    // exceso que absorbe el hermano es 52235−24191,8=28043,2 (30400×0,97=
    // 29488 de capacidad en el receptor, le cabe entero).
    expect(kg.get("26021405")).toBeCloseTo(24191.8); // ya no supera su entrada (y ahora tampoco llega al 100 %)
    expect(kg.get("26021610")).toBeCloseTo(28043.2); // absorbe el exceso
    expect(res.movimientos).toEqual([
      { de: "26021405", a: "26021610", kg: 28043.2, motivo: "exceso_misma_finca" },
    ]);
    expect(res.deltaPorLote.get("26021405")).toBeCloseTo(-28043.2);
    expect(res.deltaPorLote.get("26021610")).toBeCloseTo(28043.2);
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
    // Regla 04-08-2026 (2ª parte): 26030101 solo absorbe 10000×0,97=9700 de su
    // propia pasada; el exceso (10300) se derrama con el mismo tope ×0,97 en
    // cada receptor (4000×0,97=3880 en 26030102, resto 6420 en 26030103).
    expect(kg.get("26030102")).toBeCloseTo(3880); // primero agota la misma finca
    expect(kg.get("26030103")).toBeCloseTo(6420); // luego la misma variedad en otra finca
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
    // Exceso = 15000 − 10000×0,97 (regla 04-08-2026, 2ª parte) = 5300.
    expect(res.movimientos[0].kg).toBe(5300);
  });

  it("el exceso sin receptor queda en la cola de revisión, no se inventa", () => {
    const res = conciliarKgProcesados(
      [entrada({ lote: "26030101", kg_entrada: 10000 })],
      [{ lote_codigo: "26030101", kg_peso_total: 15000, date: "2026-03-02" }],
    );
    // Capacidad = 10000×0,97 = 9700 (regla 04-08-2026, 2ª parte: podrido
    // pre-calibrador habitual descontado también aquí).
    expect(res.excesosSinColocar).toEqual([{ lote: "26030101", kg: 5300 }]);
    expect(res.procesados[0].kg_peso_total).toBe(9700);
  });
});

describe("conciliarKgProcesados — reentrada_nombrados (regla del dueño 04-08-2026)", () => {
  it("sobrante de una pasada multi-código va como reentrada a los DEMÁS nombrados, NUNCA a un lote de la misma finca ajeno al informe", () => {
    const res = conciliarKgProcesados(
      [
        entrada({ lote: "26030101", kg_entrada: 10000, fecha: "2026-03-01" }), // principal
        entrada({ lote: "26030102", kg_entrada: 4000, fecha: "2026-03-01" }), // 2º nombrado
        // Lote de la MISMA finca y variedad, pendiente libre, pero NO nombrado
        // en la pasada: con la regla vieja recibía el derrame; ahora no debe
        // recibir nada.
        entrada({ lote: "26030199", kg_entrada: 50000, fecha: "2026-03-01" }),
      ],
      // Capacidad (regla 04-08-2026, 2ª parte, ×0,97): 10000→9700 (principal),
      // 4000→3880 (2º). Pendiente total nombrados = 13580; la pasada trae
      // 20000: sobran 6420 tras llenar a los dos nombrados.
      [{ lote_codigo: "26030101+26030102", kg_peso_total: 20000, date: "2026-03-01" }],
    );
    const kg = new Map(res.procesados.map((p) => [p.lote_codigo, p.kg_peso_total]));
    expect(kg.get("26030101")).toBe(9700);
    expect(kg.get("26030102")).toBe(3880); // sin inflar: el tope de capacidad se mantiene
    expect(kg.has("26030199")).toBe(false); // el lote ajeno NO recibe nada

    // El sobrante queda documentado como reentrada hacia el 2º nombrado (el
    // único "demás" código de esta pasada) y sigue en la cola de revisión
    // (no hay procesado real que lo absorba). También aparece el movimiento
    // "multi_codigo" normal de la fase 1 (los 3880 que sí cupieron en su
    // pendiente directo).
    expect(res.movimientos).toEqual([
      { de: "26030101", a: "26030102", kg: 3880, motivo: "multi_codigo" },
      { de: "26030101", a: "26030102", kg: 6420, motivo: "reentrada_nombrados" },
    ]);
    expect(res.excesosSinColocar).toEqual([{ lote: "26030101", kg: 6420 }]);
    // Conservación: nada se inventa ni se pierde.
    expect(kg.get("26030101")! + kg.get("26030102")! + res.excesosSinColocar[0].kg).toBe(20000);
  });

  it("con 3 códigos nombrados, el sobrante se reparte entre los 2 demás proporcional a lo que cada uno absorbió de esa pasada", () => {
    const res = conciliarKgProcesados(
      [
        entrada({ lote: "26030201", kg_entrada: 10000, fecha: "2026-03-02" }), // principal
        entrada({ lote: "26030202", kg_entrada: 3000, fecha: "2026-03-02" }),
        entrada({ lote: "26030203", kg_entrada: 1000, fecha: "2026-03-02" }),
      ],
      // Capacidad ×0,97 (regla 04-08-2026, 2ª parte): 9700 + 2910 + 970 =
      // 13580 de pendiente total nombrados; pasada trae 18000: sobran 4420,
      // repartidos 2910/970 = 3:1 entre el 2º y el 3º (3315/1105).
      [{ lote_codigo: "26030201+26030202+26030203", kg_peso_total: 18000, date: "2026-03-02" }],
    );
    const reentradas = res.movimientos.filter((m) => m.motivo === "reentrada_nombrados");
    expect(reentradas).toEqual([
      { de: "26030201", a: "26030202", kg: 3315, motivo: "reentrada_nombrados" },
      { de: "26030201", a: "26030203", kg: 1105, motivo: "reentrada_nombrados" },
    ]);
    expect(res.excesosSinColocar).toEqual([{ lote: "26030201", kg: 4420 }]);
  });

  it("pasada de código SIMPLE con exceso sigue el derrame de siempre (finca/variedad), sin cambios", () => {
    const res = conciliarKgProcesados(
      [
        entrada({ lote: "26030301", kg_entrada: 10000, fecha: "2026-03-03" }),
        entrada({ lote: "26030302", kg_entrada: 8000, fecha: "2026-03-03" }), // misma finca/variedad, fantasma
      ],
      [{ lote_codigo: "26030301", kg_peso_total: 15000, date: "2026-03-03" }],
    );
    const kg = new Map(res.procesados.map((p) => [p.lote_codigo, p.kg_peso_total]));
    // Capacidad ×0,97 (regla 04-08-2026, 2ª parte): 10000→9700, exceso
    // 15000−9700=5300 cabe entero en el receptor (8000×0,97=7760).
    expect(kg.get("26030301")).toBe(9700);
    expect(kg.get("26030302")).toBe(5300);
    expect(res.movimientos).toEqual([
      { de: "26030301", a: "26030302", kg: 5300, motivo: "exceso_misma_finca" },
    ]);
    expect(res.excesosSinColocar).toHaveLength(0);
  });

  it("mismo código repetido en el nombre ('A+A') no cuenta como multi-código: el exceso sigue el derrame de finca/variedad, no reentrada_nombrados", () => {
    const res = conciliarKgProcesados(
      [
        entrada({ lote: "26030401", kg_entrada: 10000, fecha: "2026-03-04" }),
        entrada({ lote: "26030402", kg_entrada: 8000, fecha: "2026-03-04" }),
      ],
      [{ lote_codigo: "26030401+26030401", kg_peso_total: 15000, date: "2026-03-04" }],
    );
    // Capacidad ×0,97 (regla 04-08-2026, 2ª parte): exceso 15000−9700=5300.
    expect(res.movimientos).toEqual([
      { de: "26030401", a: "26030402", kg: 5300, motivo: "exceso_misma_finca" },
    ]);
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
    // Capacidad ×0,97 (regla 04-08-2026, 2ª parte): 10000×0,97=9700, exceso
    // 14000−9700=4300 (el PREC sigue sin ser candidato, esté o no lleno).
    expect(res.excesosSinColocar).toEqual([{ lote: "26050101", kg: 4300 }]);
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
    // Regla del dueño 04-08-2026 (2ª parte): sobre el peso final real de
    // cámara (21580−820=20760) se descuenta TAMBIÉN el podrido
    // pre-calibrador habitual (×0,97): 20760×0,97=20137,2.
    const capacidadEsperada = (21580 - 820) * 0.97;
    expect(res.procesados[0].kg_peso_total).toBeCloseTo(capacidadEsperada);
    expect(res.excesosSinColocar[0].kg).toBeCloseTo(23561 - capacidadEsperada);
  });

  it("sin dato real, la capacidad se estima con la tasa diaria: un lote 70 días en cámara no llega al 100 % de su entrada", () => {
    const res = conciliarKgProcesados(
      [entrada({ lote: "26042811", kg_entrada: 20000, fecha: "2026-04-28" })],
      [{ lote_codigo: "26042811", kg_peso_total: 20000, date: "2026-07-07" }], // 70 días
    );
    // Regla del dueño 04-08-2026 (2ª parte): tras la merma natural estimada
    // por días se descuenta también el podrido pre-calibrador habitual
    // (×0,97).
    const esperado = 20000 * (1 - 0.000513 * 70) * 0.97;
    expect(res.procesados[0].kg_peso_total).toBeCloseTo(esperado, 0);
    expect(res.excesosSinColocar[0].kg).toBeCloseTo(20000 - esperado, 0);
  });
});

describe("conciliarKgProcesados — podrido pre-calibrador habitual en la capacidad (regla del dueño 04-08-2026, 2ª parte: \"nunca habrá un lote que no tenga podrido o mermas\")", () => {
  it("SIN merma de cámara real: la capacidad es entrada × (1 − TASA_MERMA_NATURAL_DIA×días) × 0,97, no el 100 % de la entrada", () => {
    const res = conciliarKgProcesados(
      [entrada({ lote: "26080101", kg_entrada: 20000, fecha: "2026-08-01" })],
      // Pasada el mismo día (0 días de cámara): sin la 2ª parte de la regla
      // cabrían los 20000 enteros; con ella, el tope es 20000×0,97=19400.
      [{ lote_codigo: "26080101", kg_peso_total: 19400, date: "2026-08-01" }],
    );
    expect(res.procesados[0].kg_peso_total).toBe(19400); // cabe justo en el tope, sin exceso
    expect(res.excesosSinColocar).toHaveLength(0);

    // Un solo kg más ya no cabe: se convierte en exceso (cola de revisión,
    // al no haber más lotes candidatos).
    const conExceso = conciliarKgProcesados(
      [entrada({ lote: "26080101", kg_entrada: 20000, fecha: "2026-08-01" })],
      [{ lote_codigo: "26080101", kg_peso_total: 19401, date: "2026-08-01" }],
    );
    expect(conExceso.procesados[0].kg_peso_total).toBe(19400);
    expect(conExceso.excesosSinColocar).toEqual([{ lote: "26080101", kg: 1 }]);
  });

  it("CON merma de cámara real: el podrido pre-calibrador se descuenta SOBRE el resto tras la merma, no sobre la entrada bruta", () => {
    const res = conciliarKgProcesados(
      [entrada({ lote: "26080201", kg_entrada: 10000, fecha: "2026-08-02", kg_merma_camara: 200 })],
      [{ lote_codigo: "26080201", kg_peso_total: 20000, date: "2026-08-02" }],
    );
    // (10000 − 200) × 0,97 = 9506, NO (10000 × 0,97) − 200.
    const capacidadEsperada = (10000 - 200) * 0.97;
    expect(capacidadEsperada).toBeCloseTo(9506);
    expect(res.procesados[0].kg_peso_total).toBeCloseTo(9506);
    expect(res.excesosSinColocar[0].kg).toBeCloseTo(20000 - 9506);
  });

  it("el podrido de CALIBRADOR (clase J) NO se descuenta de la capacidad: ya pasó y pesó en la pasada, no es doble cuenta", () => {
    // La pasada trae exactamente el 97% de la entrada (incluyendo posible
    // podrido de calibrador ya pesado dentro de esos kg): debe caber ENTERA,
    // sin generar exceso ni cola de revisión — la capacidad no vuelve a
    // restar nada que ya viniera dentro del kg de la pasada.
    const res = conciliarKgProcesados(
      [entrada({ lote: "26080301", kg_entrada: 30000, fecha: "2026-08-03" })],
      [{ lote_codigo: "26080301", kg_peso_total: 29100, date: "2026-08-03" }], // 30000×0,97
    );
    expect(res.procesados[0].kg_peso_total).toBeCloseTo(29100);
    expect(res.excesosSinColocar).toHaveLength(0);
  });

  it("multi-código: el principal YA NO absorbe el 100 % de su entrada, el resto fluye entero al 2º nombrado", () => {
    const res = conciliarKgProcesados(
      [
        entrada({ lote: "26080401", kg_entrada: 10000, fecha: "2026-08-04" }), // principal
        entrada({ lote: "26080402", kg_entrada: 5000, fecha: "2026-08-04" }), // 2º nombrado, con pendiente de sobra
      ],
      // La pasada trae justo la entrada del principal (10000): antes de la
      // regla, el principal se la habría llevado ENTERA (100 %). Ahora su
      // tope es 9700, así que 300 kg fluyen al 2º nombrado en vez de
      // quedarse (falsamente) en el principal.
      [{ lote_codigo: "26080401+26080402", kg_peso_total: 10000, date: "2026-08-04" }],
    );
    const kg = new Map(res.procesados.map((p) => [p.lote_codigo, p.kg_peso_total]));
    expect(kg.get("26080401")).toBe(9700); // < su entrada (10000): ya no se llena al 100 %
    expect(kg.get("26080401")!).toBeLessThan(10000);
    expect(kg.get("26080402")).toBe(300); // absorbe el resto vía multi_codigo, dentro de su pendiente (4850)
    expect(res.movimientos).toEqual([
      { de: "26080401", a: "26080402", kg: 300, motivo: "multi_codigo" },
    ]);
    expect(res.excesosSinColocar).toHaveLength(0); // no hizo falta reentrada: el 2º nombrado tenía pendiente de sobra
  });

  it("conservación global: con capacidad reducida por podrido + reentrada_nombrados, nada se inventa ni se pierde", () => {
    const entradas: EntradaConciliacion[] = [
      entrada({ lote: "26080501", kg_entrada: 10000, fecha: "2026-08-05" }), // principal
      entrada({ lote: "26080502", kg_entrada: 2000, fecha: "2026-08-05" }), // 2º nombrado, pendiente pequeño
    ];
    const pasadas: PasadaConciliacion[] = [
      { lote_codigo: "26080501+26080502", kg_peso_total: 15000, date: "2026-08-05" },
    ];
    const totalPasadas = pasadas.reduce((s, p) => s + (p.kg_peso_total ?? 0), 0);
    const res = conciliarKgProcesados(entradas, pasadas);
    const totalProcesado = res.procesados.reduce((s, p) => s + p.kg_peso_total, 0);
    const totalCola = res.excesosSinColocar.reduce((s, e) => s + e.kg, 0);
    // Σ procesados + Σ cola de revisión === Σ pasadas (los movimientos
    // "reentrada_nombrados" son solo atribución/auditoría, no mueven kg real
    // fuera de esta suma — ver docstring del módulo).
    expect(totalProcesado + totalCola).toBeCloseTo(totalPasadas);
    expect(res.movimientos.some((m) => m.motivo === "reentrada_nombrados")).toBe(true);
  });
});

describe("capacidadFraccionEstimada — fracción exportada para el umbral dinámico de entradasBascula.ts (refuerzo 04-08-2026)", () => {
  it("0 días: 1 × (1 − 0,03) = 0,97 (sin merma, solo podrido pre-calibrador habitual)", () => {
    expect(capacidadFraccionEstimada(0)).toBeCloseTo(0.97);
  });

  it("90 días: (1 − 0,000513×90) × 0,97 ≈ 0,9252 — coincide con el caso real Guadex", () => {
    expect(capacidadFraccionEstimada(90)).toBeCloseTo((1 - 0.000513 * 90) * 0.97, 4);
  });

  it("la merma por días se acota al 15 % (lote muy viejo no cae por debajo de 0,85×0,97)", () => {
    const dias400 = capacidadFraccionEstimada(400); // 0,000513×400=20,5%, por encima del tope del 15%
    expect(dias400).toBeCloseTo(0.85 * 0.97);
  });

  it("días negativos se tratan como 0 (nunca se infla la capacidad)", () => {
    expect(capacidadFraccionEstimada(-5)).toBe(capacidadFraccionEstimada(0));
  });

  it("conciliarKgProcesados usa EXACTAMENTE esta función para la capacidad sin merma real (no hay dos fórmulas)", () => {
    // Mismo caso que el test de la 2ª parte del podrido (arriba): 20000 kg,
    // 0 días -> capacidad = 20000 × capacidadFraccionEstimada(0).
    const res = conciliarKgProcesados(
      [entrada({ lote: "26080601", kg_entrada: 20000, fecha: "2026-08-06" })],
      [{ lote_codigo: "26080601", kg_peso_total: 20000, date: "2026-08-06" }],
    );
    expect(res.procesados[0].kg_peso_total).toBeCloseTo(20000 * capacidadFraccionEstimada(0));
  });
});

describe("conciliarKgProcesados — lotesEnCamaraExterna (ground truth del dueño 04-08-2026 nº2, PRIORIDAD MÁXIMA)", () => {
  // Caso real que destapó el bug: 26050809 (Invermarmelo, Guadex, sin
  // venta_directa/entrada_lst/fecha_salida_camara/pasadas propias) recibía
  // kg del derrame por misma finca/variedad de otro lote real de
  // Invermarmelo con exceso, y el auto-cierre por edad lo cerraba
  // "con_analisis" — físicamente imposible, la fruta seguía en Guadex.
  it("un lote confirmado en cámara EXTERNA nunca recibe derrame por exceso, aunque sea el mejor candidato por finca/variedad", () => {
    const res = conciliarKgProcesados(
      [
        entrada({ lote: "26050501", kg_entrada: 20000, fecha: "2026-05-05", finca: "INVERMARMELO - GG" }), // donante con exceso
        entrada({ lote: "26050809", kg_entrada: 21060, fecha: "2026-05-08", finca: "INVERMARMELO - GG" }), // Guadex: confirmado en cámara
      ],
      [{ lote_codigo: "26050501", kg_peso_total: 25000, date: "2026-05-05" }],
      [],
      new Set(["26050809"]), // señal de cámara externa
    );
    const kg = new Map(res.procesados.map((p) => [p.lote_codigo, p.kg_peso_total]));
    expect(kg.has("26050809")).toBe(false); // NUNCA recibe nada, ni un kg
    // El exceso (25000 − 20000×0,97 = 5600) se queda en la cola de revisión:
    // no hay a quién derramarlo, y NUNCA se inventa un receptor prohibido.
    expect(res.excesosSinColocar).toEqual([{ lote: "26050501", kg: 5600 }]);
  });

  it("control: SIN la señal de cámara externa, el mismo exceso SÍ derrama normalmente al lote hermano (para confirmar que el bloqueo es justo por el Set)", () => {
    const res = conciliarKgProcesados(
      [
        entrada({ lote: "26050501", kg_entrada: 20000, fecha: "2026-05-05", finca: "INVERMARMELO - GG" }),
        entrada({ lote: "26050809", kg_entrada: 21060, fecha: "2026-05-08", finca: "INVERMARMELO - GG" }),
      ],
      [{ lote_codigo: "26050501", kg_peso_total: 25000, date: "2026-05-05" }],
      // sin reciclajePorDia ni el Set de cámara externa:
    );
    const kg = new Map(res.procesados.map((p) => [p.lote_codigo, p.kg_peso_total]));
    expect(kg.get("26050809")).toBeCloseTo(5600);
    expect(res.excesosSinColocar).toHaveLength(0);
  });

  it("con OTRO candidato disponible además del bloqueado, el exceso va al que SÍ puede recibirlo (el bloqueo no rompe el resto del derrame)", () => {
    const res = conciliarKgProcesados(
      [
        entrada({ lote: "26050501", kg_entrada: 20000, fecha: "2026-05-05", finca: "INVERMARMELO - GG" }),
        entrada({ lote: "26050809", kg_entrada: 21060, fecha: "2026-05-08", finca: "INVERMARMELO - GG" }), // bloqueado
        entrada({ lote: "26050602", kg_entrada: 21060, fecha: "2026-05-06", finca: "INVERMARMELO - GG" }), // libre, misma finca/variedad
      ],
      [{ lote_codigo: "26050501", kg_peso_total: 25000, date: "2026-05-05" }],
      [],
      new Set(["26050809"]),
    );
    const kg = new Map(res.procesados.map((p) => [p.lote_codigo, p.kg_peso_total]));
    expect(kg.has("26050809")).toBe(false);
    expect(kg.get("26050602")).toBeCloseTo(5600);
    expect(res.excesosSinColocar).toHaveLength(0);
  });

  it("los 4 casos de control reales del dueño (26050809/26051106/26052207/26052506, todos Invermarmelo/Guadex) quedan sin kg cuando están en el Set, incluso con varios donantes distintos", () => {
    const codigosGuadex = ["26050809", "26051106", "26052207", "26052506"];
    const res = conciliarKgProcesados(
      [
        entrada({ lote: "26050502", kg_entrada: 20000, fecha: "2026-05-05", finca: "INVERMARMELO - GG" }), // donante con exceso
        ...codigosGuadex.map((lote, i) => entrada({ lote, kg_entrada: 20000 + i * 100, fecha: "2026-05-08", finca: "INVERMARMELO - GG" })),
      ],
      [{ lote_codigo: "26050502", kg_peso_total: 40000, date: "2026-05-05" }], // exceso grande, cabría de sobra en cualquiera de los 4
      [],
      new Set(codigosGuadex),
    );
    const kg = new Map(res.procesados.map((p) => [p.lote_codigo, p.kg_peso_total]));
    for (const lote of codigosGuadex) expect(kg.has(lote)).toBe(false);
    expect(res.excesosSinColocar.length).toBeGreaterThan(0); // el exceso se queda en cola, nunca en Guadex
  });
});

describe("detectarLotesEnPasadaCompuesta — evidencia de huérfanos en pasadas compuestas (refuerzo 2026-08-03)", () => {
  it("un código NO-primero de una pasada compuesta queda asociado al primero, aunque no reciba kg en el reparto", () => {
    const pasadas: PasadaConciliacion[] = [
      { lote_codigo: "25111002+25111001", kg_peso_total: 29929, date: "2025-11-10" },
    ];
    const mapa = detectarLotesEnPasadaCompuesta(pasadas);
    expect(mapa.get("25111001")).toEqual({ primeros: ["25111002"], ultimaFecha: "2025-11-10" });
    // El primer código de la pasada NO se marca a sí mismo como huérfano.
    expect(mapa.has("25111002")).toBe(false);
  });

  it("un código visto con varios primeros distintos acumula todos, sin duplicar y ordenados", () => {
    const pasadas: PasadaConciliacion[] = [
      { lote_codigo: "26010101+26010102", kg_peso_total: 5000, date: "2026-01-01" },
      { lote_codigo: "26010103+26010102", kg_peso_total: 3000, date: "2026-01-02" },
      { lote_codigo: "26010101+26010102", kg_peso_total: 1000, date: "2026-01-03" }, // repetido: no duplica
    ];
    const mapa = detectarLotesEnPasadaCompuesta(pasadas);
    expect(mapa.get("26010102")?.primeros).toEqual(["26010101", "26010103"]);
  });

  it("ultimaFecha es la MÁS RECIENTE entre todas las pasadas que nombran al lote (margen del cierre automático)", () => {
    const pasadas: PasadaConciliacion[] = [
      { lote_codigo: "26010101+26010102", kg_peso_total: 5000, date: "2026-01-05" },
      { lote_codigo: "26010103+26010102", kg_peso_total: 3000, date: "2026-01-02" }, // anterior: no gana
      { lote_codigo: "26010104+26010102", kg_peso_total: 1000, date: "2026-01-09" }, // posterior: gana
    ];
    const mapa = detectarLotesEnPasadaCompuesta(pasadas);
    expect(mapa.get("26010102")).toEqual({ primeros: ["26010101", "26010103", "26010104"], ultimaFecha: "2026-01-09" });
  });

  it("sin fecha en ninguna pasada, ultimaFecha queda null (nunca se inventa)", () => {
    const pasadas: PasadaConciliacion[] = [
      { lote_codigo: "26010101+26010102", kg_peso_total: 5000, date: null },
    ];
    const mapa = detectarLotesEnPasadaCompuesta(pasadas);
    expect(mapa.get("26010102")?.ultimaFecha).toBeNull();
  });

  it("una pasada normal de un solo código no genera ninguna asociación", () => {
    const pasadas: PasadaConciliacion[] = [{ lote_codigo: "26050101", kg_peso_total: 19000, date: "2026-05-03" }];
    expect(detectarLotesEnPasadaCompuesta(pasadas).size).toBe(0);
  });

  it("una pasada con 3 códigos asocia el 2º y el 3º solo con el primero, no entre ellos", () => {
    const pasadas: PasadaConciliacion[] = [
      { lote_codigo: "26020101+26020102+26020103", kg_peso_total: 12000, date: "2026-02-01" },
    ];
    const mapa = detectarLotesEnPasadaCompuesta(pasadas);
    expect(mapa.get("26020102")?.primeros).toEqual(["26020101"]);
    expect(mapa.get("26020103")?.primeros).toEqual(["26020101"]);
    expect(mapa.has("26020101")).toBe(false);
  });

  it("kg <= 0 o el mismo código repetido en el texto no generan asociación", () => {
    const pasadas: PasadaConciliacion[] = [
      { lote_codigo: "26030101+26030102", kg_peso_total: 0, date: "2026-03-01" }, // sin kg: se ignora
      { lote_codigo: "26030103+26030103", kg_peso_total: 5000, date: "2026-03-02" }, // mismo código dos veces
    ];
    const mapa = detectarLotesEnPasadaCompuesta(pasadas);
    expect(mapa.size).toBe(0);
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
    // Capacidad ×0,97 (regla 04-08-2026, 2ª parte): 8000×0,97=7760 — el lote
    // cerrado también tiene su propio tope de capacidad más bajo.
    expect(porLote.get("26030401")?.kg_peso_total).toBe(7760);
  });
});

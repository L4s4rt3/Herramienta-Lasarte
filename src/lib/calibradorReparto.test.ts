import { describe, expect, it } from "vitest";
import {
  aplicarReparto,
  calcularRepartoPasadas,
  codigosDelNombre,
  esNombreCompuesto,
  esProductorReal,
  repartirPasada,
  repartirPorCapacidad,
  type CapacidadLote,
  type DuenoLote,
  type EntradaRepartoPasadas,
  type FilaProductor,
  type PasadaConDesglose,
  type PasadaReparto,
} from "@/lib/calibradorReparto";
import type { LineaDesglose } from "@/lib/desgloseBox";

const pasada = (batch_name: string, extra: Partial<PasadaConDesglose> = {}): PasadaConDesglose => ({
  batch_id: 1,
  batch_name,
  lote: "26013107",
  fecha: "2026-02-01",
  kg_total: 10_000,
  kg_exportacion: 6_000,
  kg_no_exportacion: 2_000,
  kg_industria: 1_500,
  kg_mujeres: 400,
  kg_otros: 100,
  ...extra,
});

describe("repartirPasada", () => {
  it("reparte dos lotes con sus box en proporcion a los box", () => {
    const r = repartirPasada(pasada("26013107 20 BOX + 26012608 30 BOX"));
    expect(r.estado).toBe("repartida");
    // 30 de 50 box se van al segundo lote: 60% de los kilos.
    const mov = r.movimientos.find((m) => m.hacia === "26012608");
    expect(mov).toBeDefined();
    expect(mov?.kg.kg_total).toBeCloseTo(6_000, 0);
    expect(mov?.kg.kg_exportacion).toBeCloseTo(3_600, 0);
  });

  it("mantiene la proporcion entre destinos: se mueve la misma fraccion de cada uno", () => {
    const p = pasada("26013107 20 BOX + 26012608 30 BOX");
    const mov = repartirPasada(p).movimientos[0];
    const fraccion = (mov.kg.kg_total ?? 0) / p.kg_total;
    for (const g of ["kg_exportacion", "kg_industria", "kg_mujeres"] as const) {
      expect((mov.kg[g] ?? 0) / p[g]).toBeCloseTo(fraccion, 6);
    }
  });

  it("no se inventa nada cuando falta algun box: va a la cola", () => {
    // El operario escribio los box del reciclaje pero no los del lote.
    const r = repartirPasada(pasada("26060204+3 BOX DE RECICLAJE"));
    expect(r.estado).toBe("cola");
    expect(r.cola?.motivo).toMatch(/sin box/i);
  });

  it("un precalibrado nombrado por fecha lo decide una persona", () => {
    const r = repartirPasada(pasada("26050402 10 BOX + 6 BOX PREC DIA 23/06"));
    expect(r.estado).toBe("cola");
    expect(r.cola?.motivo).toMatch(/precalibrado/i);
  });

  it("un nombre sin desglose real no se toca", () => {
    const r = repartirPasada(pasada("26013107"));
    expect(r.estado).toBe("cola");
  });

  it("el reciclaje no recibe kilos de nadie: salen de la atribucion", () => {
    const r = repartirPasada(pasada("26013107 20 BOX + 7 BOX DE RECICLAJE"));
    if (r.estado === "repartida") {
      for (const m of r.movimientos) expect(m.hacia).not.toBe("26013107");
      // Lo que sale del lote va a "nadie" (hacia null), nunca a otro productor.
      expect(r.movimientos.every((m) => m.hacia === null || /^\d{8}$/.test(m.hacia))).toBe(true);
    }
  });

  it("nunca mueve mas kilos de los que tiene la pasada", () => {
    const p = pasada("26013107 10 BOX + 26012608 10 BOX + 26012207 10 BOX");
    const r = repartirPasada(p);
    const movido = r.movimientos.reduce((s, m) => s + (m.kg.kg_total ?? 0), 0);
    expect(movido).toBeLessThanOrEqual(p.kg_total + 0.01);
  });
});

describe("aplicarReparto", () => {
  const fila = (productor: string, kg: number): FilaProductor => ({
    productor_id: `id-${productor}`, productor, lotes: 1,
    kg_total: kg, kg_exportacion: kg * 0.6, kg_no_exportacion: kg * 0.2,
    kg_industria: kg * 0.15, kg_mujeres: kg * 0.04, kg_otros: kg * 0.01,
    pct_exportacion: 60,
  });
  const dueno = new Map<string, DuenoLote>([
    ["26013107", [{ productor_id: "id-ANA", productor: "ANA", fraccion: 1 }]],
    ["26012608", [{ productor_id: "id-BEA", productor: "BEA", fraccion: 1 }]],
  ]);

  it("quita del primer lote y se lo da al que era", () => {
    const r = aplicarReparto(
      [fila("ANA", 10_000), fila("BEA", 5_000)],
      [pasada("26013107 20 BOX + 26012608 30 BOX")],
      dueno,
    );
    const ana = r.productores.find((p) => p.productor === "ANA");
    const bea = r.productores.find((p) => p.productor === "BEA");
    expect(ana?.kg_total).toBeCloseTo(4_000, 0);   // 10.000 − 6.000
    expect(bea?.kg_total).toBeCloseTo(11_000, 0);  // 5.000 + 6.000
    expect(r.pasadasRepartidas).toBe(1);
  });

  it("el total de kilos no cambia: solo cambia de dueno", () => {
    const antes = [fila("ANA", 10_000), fila("BEA", 5_000)];
    const total = (fs: FilaProductor[]) => fs.reduce((s, f) => s + f.kg_total, 0);
    const r = aplicarReparto(antes, [pasada("26013107 20 BOX + 26012608 30 BOX")], dueno);
    expect(total(r.productores) + r.kgLiberados).toBeCloseTo(total(antes), 0);
  });

  it("recalcula el % de exportacion con los kilos nuevos", () => {
    const r = aplicarReparto([fila("ANA", 10_000), fila("BEA", 5_000)],
      [pasada("26013107 20 BOX + 26012608 30 BOX")], dueno);
    for (const p of r.productores) {
      expect(p.pct_exportacion).toBeCloseTo((p.kg_exportacion / p.kg_total) * 100, 6);
    }
  });

  it("si el lote de destino no tiene entrada de bascula, los kilos se liberan", () => {
    const r = aplicarReparto([fila("ANA", 10_000)],
      [pasada("26013107 20 BOX + 26099999 30 BOX")], dueno);
    expect(r.kgLiberados).toBeCloseTo(6_000, 0);
    expect(r.productores.find((p) => p.productor === "ANA")?.kg_total).toBeCloseTo(4_000, 0);
  });

  it("las pasadas que no se pueden repartir quedan listadas, no desaparecen", () => {
    const r = aplicarReparto([fila("ANA", 10_000)],
      [pasada("26060204+3 BOX DE RECICLAJE"), pasada("26013107")], dueno);
    expect(r.cola).toHaveLength(2);
    expect(r.pasadasRepartidas).toBe(0);
    expect(r.productores.find((p) => p.productor === "ANA")?.kg_total).toBe(10_000);
  });

  it("no muta las filas que le pasan", () => {
    const antes = [fila("ANA", 10_000), fila("BEA", 5_000)];
    const copia = JSON.parse(JSON.stringify(antes));
    aplicarReparto(antes, [pasada("26013107 20 BOX + 26012608 30 BOX")], dueno);
    expect(antes).toEqual(copia);
  });

  // Un lote de re-entrada de precalibrado puede venir de varias fincas: la
  // trazabilidad del ERP dice en qué proporción (erp_precalibrado_origen).
  describe("cuando el lote destino es precalibrado de varias fincas", () => {
    const conPrec = new Map<string, DuenoLote>([
      ["26013107", [{ productor_id: "id-ANA", productor: "ANA", fraccion: 1 }]],
      // 26012608 es una re-entrada: 70% venía de BEA y 30% de CARMEN.
      ["26012608", [
        { productor_id: "id-BEA", productor: "BEA", fraccion: 0.7 },
        { productor_id: "id-CARMEN", productor: "CARMEN", fraccion: 0.3 },
      ]],
    ]);

    it("reparte los kilos entre las fincas de origen por su fraccion", () => {
      const r = aplicarReparto(
        [fila("ANA", 10_000), fila("BEA", 5_000)],
        [pasada("26013107 20 BOX + 26012608 30 BOX")],
        conPrec,
      );
      // Se mueven 6.000 kg: 70% a BEA (4.200) y 30% a CARMEN (1.800).
      expect(r.productores.find((p) => p.productor === "BEA")?.kg_total).toBeCloseTo(9_200, 0);
      expect(r.productores.find((p) => p.productor === "CARMEN")?.kg_total).toBeCloseTo(1_800, 0);
      expect(r.productores.find((p) => p.productor === "ANA")?.kg_total).toBeCloseTo(4_000, 0);
    });

    it("y el total sigue sin cambiar", () => {
      const antes = [fila("ANA", 10_000), fila("BEA", 5_000)];
      const total = (fs: FilaProductor[]) => fs.reduce((s, f) => s + f.kg_total, 0);
      const r = aplicarReparto(antes, [pasada("26013107 20 BOX + 26012608 30 BOX")], conPrec);
      expect(total(r.productores) + r.kgLiberados).toBeCloseTo(total(antes), 0);
    });
  });
});

describe("codigosDelNombre", () => {
  it("saca los codigos en orden y sin repetir", () => {
    expect(codigosDelNombre("25111002+25111001+PREC 25111901"))
      .toEqual(["25111002", "25111001", "25111901"]);
    expect(codigosDelNombre("26013107+26013107")).toEqual(["26013107"]);
    expect(codigosDelNombre("RECICLAJE")).toEqual([]);
  });
});

describe("repartirPorCapacidad", () => {
  const cap = (kgEntrada: number, kgAtribuidoSimple = 0): CapacidadLote => ({ kgEntrada, kgAtribuidoSimple });

  it("el segundo lote solo recibe lo que le quepa", () => {
    const capacidad = new Map([
      ["26013107", cap(30_000, 25_000)],   // le quedan 5.000
      ["26012608", cap(20_000, 0)],        // le quedan 20.000
    ]);
    const r = repartirPorCapacidad([pasada("26013107+26012608")], capacidad);
    // El primero absorbe sus 5.000 y el resto (5.000) se va al segundo.
    expect(r.movimientos).toHaveLength(1);
    expect(r.movimientos[0].hacia).toBe("26012608");
    expect(r.movimientos[0].kg.kg_total).toBeCloseTo(5_000, 0);
    expect(r.kgSinColocar).toBe(0);
  });

  it("si el primero tiene sitio de sobra se lo lleva todo y nadie mas recibe", () => {
    const capacidad = new Map([
      ["26013107", cap(50_000, 0)],
      ["26012608", cap(20_000, 0)],
    ]);
    const r = repartirPorCapacidad([pasada("26013107+26012608")], capacidad);
    expect(r.movimientos).toHaveLength(0);
    expect(r.pasadasRepartidas).toBe(0);
  });

  it("lo que no cabe en ningun lote nombrado se queda donde estaba", () => {
    const capacidad = new Map([
      ["26013107", cap(3_000, 0)],
      ["26012608", cap(2_000, 0)],
    ]);
    const r = repartirPorCapacidad([pasada("26013107+26012608")], capacidad);
    expect(r.kgSinColocar).toBeCloseTo(5_000, 0);   // 10.000 − 3.000 − 2.000
  });

  it("un lote sin entrada de bascula no absorbe nada", () => {
    const r = repartirPorCapacidad(
      [pasada("26013107+26099999")],
      new Map([["26013107", cap(1_000, 0)]]),
    );
    expect(r.movimientos).toHaveLength(0);
    expect(r.kgSinColocar).toBeCloseTo(9_000, 0);
  });

  it("gasta el pendiente en orden cronologico, no en el orden en que llegan", () => {
    const capacidad = new Map([
      ["26013107", cap(0, 0)],
      ["26012608", cap(6_000, 0)],
    ]);
    const tarde = pasada("26013107+26012608", { batch_id: 2, fecha: "2026-03-01", kg_total: 10_000 });
    const pronto = pasada("26013107+26012608", { batch_id: 1, fecha: "2026-01-01", kg_total: 10_000 });
    // Se pasan desordenadas a propósito: la temprana debe comerse el hueco.
    const r = repartirPorCapacidad([tarde, pronto], capacidad);
    expect(r.movimientos).toHaveLength(1);
    expect(r.movimientos[0].batch_id).toBe(1);
    expect(r.movimientos[0].kg.kg_total).toBeCloseTo(6_000, 0);
  });

  it("nunca da a un lote mas de lo que le cabe, ni con varias pasadas", () => {
    const capacidad = new Map([
      ["26013107", cap(0, 0)],
      ["26012608", cap(7_000, 0)],
    ]);
    const r = repartirPorCapacidad(
      [pasada("26013107+26012608", { batch_id: 1, fecha: "2026-01-01" }),
        pasada("26013107+26012608", { batch_id: 2, fecha: "2026-01-02" })],
      capacidad,
    );
    const recibido = r.movimientos.reduce((s, m) => s + (m.kg.kg_total ?? 0), 0);
    expect(recibido).toBeLessThanOrEqual(7_000 + 0.01);
  });
});

describe("esProductorReal", () => {
  const p = (productor: string) => ({ productor_id: "x", productor });

  it("un productor de verdad si lo es", () => {
    expect(esProductorReal(p("ECILIMP AGRO S.L."))).toBe(true);
    expect(esProductorReal(p("LASARTE EXPORT S.L. Camba S.C."))).toBe(true);
  });

  it("el almacen de precalibrado NO es un productor", () => {
    expect(esProductorReal(p("LASARTE ALMACEN PRECALIBRADO"))).toBe(false);
    expect(esProductorReal(p("PRECALIBRADO"))).toBe(false);
  });

  it("los movimientos internos tampoco", () => {
    expect(esProductorReal(p("Confeccion.. 1"))).toBe(false);
    expect(esProductorReal(p("Sobrante.. 3"))).toBe(false);
  });

  it("los huecos entre parentesis tampoco", () => {
    expect(esProductorReal(p("(sin lote legible en el calibrador)"))).toBe(false);
    expect(esProductorReal(p("(lote sin entrada de bascula)"))).toBe(false);
  });

  it("no caza a un productor real que solo se PAREZCA", () => {
    expect(esProductorReal(p("PRECALIBRADOS S.L."))).toBe(true);
    expect(esProductorReal(p("Finca El Precioso"))).toBe(true);
  });
});

// ─── Reparto canónico (lo que escribe la edge function reparto-pasadas) ───────
describe("calcularRepartoPasadas", () => {
  const pasadaR = (batch_name: string, extra: Partial<PasadaReparto> = {}): PasadaReparto => ({
    batch_id: 1, batch_name, lote: "26013107", fecha: "2026-02-01", kg_total: 10_000, ...extra,
  });
  const cap = (kgEntrada: number, kgAtribuidoSimple = 0): CapacidadLote => ({ kgEntrada, kgAtribuidoSimple });
  const lineaLote = (lote_codigo: string, box: number | null, box_tamano: "grande" | "pequeno" = "grande"): LineaDesglose =>
    ({ tipo: "lote", lote_codigo, box, box_tamano });
  const lineaReciclaje = (box: number): LineaDesglose => ({ tipo: "reciclaje", box, box_tamano: "grande", nota: "Reciclaje" });
  const entrada = (parcial: Partial<EntradaRepartoPasadas>): EntradaRepartoPasadas => ({
    pasadas: [], capacidad: new Map(), desglosesManuales: [], ...parcial,
  });
  const sumaFracciones = (filas: ReturnType<typeof calcularRepartoPasadas>["filas"], batch_id: number) =>
    filas.filter((f) => f.batch_id === batch_id).reduce((s, f) => s + f.fraccion, 0);

  it("el desglose manual manda sobre los box del nombre", () => {
    // El nombre dice 20/30 box (60 % al segundo); la persona teclea 10 y 10 (50 %).
    const r = calcularRepartoPasadas(entrada({
      pasadas: [pasadaR("26013107 20 BOX + 26012608 30 BOX")],
      desglosesManuales: [{ batch_id: 1, lineas: [lineaLote("26013107", 10), lineaLote("26012608", 10)] }],
    }));
    expect(r.filas.every((f) => f.metodo === "manual")).toBe(true);
    expect(r.filas.find((f) => f.lote8 === "26012608")?.fraccion).toBeCloseTo(0.5, 9);
    expect(r.filas.find((f) => f.lote8 === "26013107")?.fraccion).toBeCloseTo(0.5, 9);
    expect(r.resumen.repartidas).toEqual({ manual: 1, box: 0, capacidad: 0 });
    expect(r.sinRepartir).toHaveLength(0);
  });

  it("sin desglose manual, los box del nombre mandan sobre la capacidad", () => {
    // La capacidad diría que el primero aún tiene sitio para todo; los box dicen 60 % al segundo.
    const r = calcularRepartoPasadas(entrada({
      pasadas: [pasadaR("26013107 20 BOX + 26012608 30 BOX")],
      capacidad: new Map([["26013107", cap(50_000)], ["26012608", cap(50_000)]]),
    }));
    expect(r.filas.every((f) => f.metodo === "box")).toBe(true);
    expect(r.filas.find((f) => f.lote8 === "26012608")?.fraccion).toBeCloseTo(0.6, 9);
    expect(r.filas.find((f) => f.lote8 === "26013107")?.fraccion).toBeCloseTo(0.4, 9);
  });

  it("sin box escritos, reparte por capacidad pendiente en el orden del nombre", () => {
    const r = calcularRepartoPasadas(entrada({
      pasadas: [pasadaR("26013107+26012608")],
      capacidad: new Map([["26013107", cap(30_000, 25_000)], ["26012608", cap(20_000)]]),
    }));
    // Al primero le quedaban 5.000; el resto (5.000) va al segundo.
    expect(r.filas.map((f) => [f.lote8, f.metodo, f.orden])).toEqual([
      ["26013107", "capacidad", 1],
      ["26012608", "capacidad", 2],
    ]);
    expect(r.filas.find((f) => f.lote8 === "26012608")?.fraccion).toBeCloseTo(0.5, 9);
    expect(r.resumen.kgMovidos).toBeCloseTo(5_000, 0);
  });

  it("las fracciones de cada pasada suman 1 y el primero se queda el resto", () => {
    // Lotes distintos en cada pasada: lo resuelto por manual o box descuenta
    // capacidad (ver el test de más abajo) y aquí se quiere medir cada método solo.
    const r = calcularRepartoPasadas(entrada({
      pasadas: [
        pasadaR("26020101 20 BOX + 26020202 30 BOX", { batch_id: 1, lote: "26020101" }),
        pasadaR("26013107+26012608", { batch_id: 2, fecha: "2026-02-02" }),
        pasadaR("26030303 10 BOX + 26030404 10 BOX + 26030505 20 BOX", { batch_id: 3, fecha: "2026-02-03", lote: "26030303" }),
      ],
      capacidad: new Map([["26013107", cap(3_000)], ["26012608", cap(4_000)]]),
      desglosesManuales: [{ batch_id: 1, lineas: [lineaLote("26020101", 5), lineaLote("26020202", 15)] }],
    }));
    for (const id of [1, 2, 3]) expect(sumaFracciones(r.filas, id)).toBeCloseTo(1, 9);
    // La pasada 2 por capacidad: 3.000 al primero, 4.000 al segundo y 3.000 que no caben
    // en nadie se quedan en el primero → 0,6 / 0,4.
    expect(r.filas.find((f) => f.batch_id === 2 && f.lote8 === "26013107")?.fraccion).toBeCloseTo(0.6, 9);
    expect(r.filas.find((f) => f.batch_id === 2 && f.lote8 === "26012608")?.fraccion).toBeCloseTo(0.4, 9);
    // kg = fraccion × kg de la pasada, a 4 decimales.
    for (const f of r.filas) expect(f.kg).toBeCloseTo(f.fraccion * 10_000, 3);
  });

  it("el reciclaje se queda en el primer codigo: no se libera ni se regala", () => {
    // 20 + 30 + 10 box: el segundo se lleva 30/60; el primero sus 20/60 MÁS los 10/60 del reciclaje.
    const r = calcularRepartoPasadas(entrada({
      pasadas: [pasadaR("26013107 20 BOX + 26012608 30 BOX + 10 BOX DE RECICLAJE")],
    }));
    expect(r.filas.find((f) => f.lote8 === "26012608")?.fraccion).toBeCloseTo(0.5, 9);
    expect(r.filas.find((f) => f.lote8 === "26013107")?.fraccion).toBeCloseTo(0.5, 9);
    expect(sumaFracciones(r.filas, 1)).toBeCloseTo(1, 9);
    // Y con desglose manual, igual: el reciclaje del manual también se queda en el primero.
    const m = calcularRepartoPasadas(entrada({
      pasadas: [pasadaR("26013107+26012608")],
      desglosesManuales: [{ batch_id: 1, lineas: [lineaLote("26013107", 20), lineaLote("26012608", 30), lineaReciclaje(10)] }],
    }));
    expect(m.filas.find((f) => f.lote8 === "26013107")?.fraccion).toBeCloseTo(0.5, 9);
    expect(sumaFracciones(m.filas, 1)).toBeCloseTo(1, 9);
  });

  it("una pasada que no se puede repartir va a la cola con su motivo", () => {
    const r = calcularRepartoPasadas(entrada({
      pasadas: [
        pasadaR("26050402 10 BOX + 6 BOX PREC DIA 23/06", { batch_id: 1, lote: "26050402" }),
        pasadaR("26013107+26099999", { batch_id: 2 }),          // sin box y el segundo sin báscula
        pasadaR("26051904-15 BOX +7 BOX DE RECICLAJE", { batch_id: 3, lote: "26051904" }),
      ],
      capacidad: new Map([["26013107", cap(50_000)]]),
    }));
    expect(r.filas).toHaveLength(0);
    expect(r.sinRepartir).toHaveLength(3);
    expect(r.resumen.enCola).toBe(3);
    const motivo = (id: number) => r.sinRepartir.find((s) => s.batch_id === id)?.motivo ?? "";
    expect(motivo(1)).toMatch(/precalibrado/i);
    // Llegó a capacidad y tampoco: el motivo dice por qué en cada fase.
    expect(motivo(2)).toMatch(/sin box/i);
    expect(motivo(2)).toMatch(/por capacidad/i);
    expect(motivo(2)).toMatch(/26099999/);
    // Solo reciclaje: no cambia nada, y se dice.
    expect(motivo(3)).toMatch(/reciclaje/i);
  });

  it("un desglose manual que lo deja todo en el primero consta como una fila con fraccion 1", () => {
    const r = calcularRepartoPasadas(entrada({
      pasadas: [pasadaR("26050408 +3 BOX DE RECICLAJE", { lote: "26050408" })],
      desglosesManuales: [{ batch_id: 1, lineas: [lineaLote("26050408", 68, "pequeno"), lineaReciclaje(3)] }],
    }));
    expect(r.filas).toEqual([
      { batch_id: 1, lote8: "26050408", fraccion: 1, kg: 10_000, metodo: "manual", orden: 1 },
    ]);
    expect(r.sinRepartir).toHaveLength(0);
  });

  it("un desglose manual que no atribuye nada es como si no existiera", () => {
    const r = calcularRepartoPasadas(entrada({
      pasadas: [pasadaR("26013107 20 BOX + 26012608 30 BOX")],
      desglosesManuales: [{ batch_id: 1, lineas: [lineaLote("26013107", null), lineaLote("26012608", null)] }],
    }));
    // Cae a los box del nombre.
    expect(r.filas.every((f) => f.metodo === "box")).toBe(true);
    expect(r.filas.find((f) => f.lote8 === "26012608")?.fraccion).toBeCloseTo(0.6, 9);
  });

  it("lo resuelto por box o manual se descuenta del pendiente antes de repartir por capacidad", () => {
    // Al lote B le caben 10.000. La pasada 1 (box) ya le da 6.000, así que a la
    // pasada 2 (sin box) solo le puede absorber 4.000.
    const r = calcularRepartoPasadas(entrada({
      pasadas: [
        pasadaR("26013107 40 BOX + 26012608 60 BOX", { batch_id: 1, fecha: "2026-02-01" }),
        pasadaR("26013107+26012608", { batch_id: 2, fecha: "2026-02-02" }),
      ],
      capacidad: new Map([["26013107", cap(0)], ["26012608", cap(10_000)]]),
    }));
    const p2 = r.filas.filter((f) => f.batch_id === 2);
    expect(p2.find((f) => f.lote8 === "26012608")?.kg).toBeCloseTo(4_000, 0);
    expect(p2.find((f) => f.lote8 === "26013107")?.fraccion).toBeCloseTo(0.6, 9);
  });

  it("el orden es la posicion del codigo en el nombre", () => {
    const r = calcularRepartoPasadas(entrada({
      pasadas: [pasadaR("26013107 10 BOX + 26012207 10 BOX + 26012608 10 BOX")],
    }));
    expect(r.filas.map((f) => [f.lote8, f.orden])).toEqual([
      ["26013107", 1], ["26012207", 2], ["26012608", 3],
    ]);
  });

  it("no muta la capacidad que le pasan y es determinista", () => {
    const capacidad = new Map([["26013107", cap(30_000, 25_000)], ["26012608", cap(20_000)]]);
    const copia = JSON.parse(JSON.stringify([...capacidad]));
    const e = entrada({ pasadas: [pasadaR("26013107+26012608")], capacidad });
    const a = calcularRepartoPasadas(e);
    const b = calcularRepartoPasadas(e);
    expect([...capacidad]).toEqual(copia);
    expect(a).toEqual(b);
  });

  it("una pasada sin codigo receptor o sin kilos va a la cola, nunca a la tabla", () => {
    const r = calcularRepartoPasadas(entrada({
      pasadas: [
        pasadaR("22/07  22 BOX  -  23/07 43 BOX", { batch_id: 1, lote: "22/07  22 BOX  -  23/07 43 BOX" }),
        pasadaR("26013107+26012608", { batch_id: 2, kg_total: 0 }),
      ],
    }));
    expect(r.filas).toHaveLength(0);
    expect(r.sinRepartir.map((s) => s.batch_id)).toEqual([1, 2]);
    expect(r.sinRepartir[1].motivo).toMatch(/no tiene kilos/);
  });
});

describe("esNombreCompuesto", () => {
  it("es el mismo criterio que la RPC de capacidad: dos grupos de 8 digitos", () => {
    expect(esNombreCompuesto("26030208-26030308")).toBe(true);
    expect(esNombreCompuesto("26052102- 26052102 TORRECILLA")).toBe(true);   // aunque sea el mismo código
    expect(esNombreCompuesto("26051904-15 BOX +7 BOX DE RECICLAJE")).toBe(false);
    expect(esNombreCompuesto(null)).toBe(false);
  });
});

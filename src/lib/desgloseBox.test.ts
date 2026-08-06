import { describe, expect, it } from "vitest";
import {
  BOX_NETO_KG,
  BOX_TARA_KG,
  codigoAtribuidoDe,
  expandirPasadaPorDesglose,
  fechaPrecalibradoAIso,
  kgPorBoxDeReentrada,
  normalizarBoxTamano,
  parsearDesgloseTexto,
  repartirPasadaPorBox,
  resolverPrecalibradoPorFecha,
  type LineaDesglose,
} from "./desgloseBox";

/** Atajo: línea de lote con box grandes (el caso normal). */
function lote(codigo: string, box: number | null): LineaDesglose {
  return { tipo: "lote", lote_codigo: codigo, box, box_tamano: "grande" };
}

describe("pesos del box (regla del dueño 06-08-2026)", () => {
  it("grande: 350 brutos − 35 de tara = 315 kg de fruta", () => {
    expect(BOX_TARA_KG.grande).toBe(35);
    expect(BOX_NETO_KG.grande).toBe(315);
  });

  it("pequeño: 230 brutos − 30 de tara = 200 kg de fruta (misma tara que el box de reciclaje)", () => {
    expect(BOX_TARA_KG.pequeno).toBe(30);
    expect(BOX_NETO_KG.pequeno).toBe(200);
  });

  it("sin especificar, un box es grande", () => {
    expect(normalizarBoxTamano(undefined)).toBe("grande");
    expect(normalizarBoxTamano("mediano")).toBe("grande");
    expect(normalizarBoxTamano("pequeno")).toBe("pequeno");
  });
});

describe("repartirPasadaPorBox", () => {
  it("caso real 04-08 08:00 «30/07 46B, 27/07 7B, 29/07 2B, 21/07 7B» — 62 box y 15.476,86 kg", () => {
    const r = repartirPasadaPorBox(15476.8571, [
      { tipo: "precalibrado", prec_fecha: "2026-07-30", box: 46, box_tamano: "grande" },
      { tipo: "precalibrado", prec_fecha: "2026-07-27", box: 7, box_tamano: "grande" },
      { tipo: "precalibrado", prec_fecha: "2026-07-29", box: 2, box_tamano: "grande" },
      { tipo: "precalibrado", prec_fecha: "2026-07-21", box: 7, box_tamano: "grande" },
    ]);

    expect(r.boxTotal).toBe(62);
    // Todos los box del mismo tamaño ⇒ reparto exactamente proporcional a box.
    expect(r.lineas[0].kg).toBeCloseTo(15476.8571 * (46 / 62), 3);
    expect(r.lineas[1].kg).toBeCloseTo(15476.8571 * (7 / 62), 3);
    // Los box NO iban llenos: 249,6 kg/box reales frente a los 315 teóricos.
    expect(r.kgPorBoxReal).toBeCloseTo(249.63, 2);
    expect(r.kgTeoricoTotal).toBe(62 * 315);
    expect(r.desviacionKg).toBeLessThan(0);
  });

  it("el total repartido es EXACTAMENTE el kg real de la pasada (residuo del redondeo incluido)", () => {
    const r = repartirPasadaPorBox(10000, [lote("26051904", 1), lote("26051905", 1), lote("26051906", 1)]);
    // 3 partes iguales de 10.000 no son exactas: el residuo va a una sola línea.
    expect(r.lineas.reduce((s, l) => s + l.kg, 0)).toBeCloseTo(10000, 6);
    expect(r.lineas.map((l) => l.kg).sort()).toEqual([3333.3333, 3333.3333, 3333.3334]);
  });

  it("mezcla de tamaños: un box pequeño pesa 200/315 de uno grande", () => {
    const r = repartirPasadaPorBox(1030, [
      { tipo: "lote", lote_codigo: "26051904", box: 2, box_tamano: "grande" },
      { tipo: "lote", lote_codigo: "26051905", box: 2, box_tamano: "pequeno" },
    ]);
    expect(r.lineas[0].kg).toBeCloseTo(1030 * (630 / 1030), 3);
    expect(r.lineas[1].kg).toBeCloseTo(1030 * (400 / 1030), 3);
    expect(r.lineas[0].kg + r.lineas[1].kg).toBeCloseTo(1030, 6);
  });

  it("el reciclaje consume kg de la pasada pero no se atribuye a ningún lote (sería doble cuenta)", () => {
    const r = repartirPasadaPorBox(5948.4002, [
      lote("26051904", 15),
      { tipo: "reciclaje", box: 7, box_tamano: "grande" },
    ]);
    expect(r.lineas[0].codigoAtribuido).toBe("26051904");
    expect(r.lineas[1].codigoAtribuido).toBeNull();
    expect(r.kgAtribuido).toBeCloseTo(5948.4002 * (15 / 22), 3);
    expect(r.kgSinAtribuir).toBeCloseTo(5948.4002 * (7 / 22), 3);
    expect(r.kgAtribuido + r.kgSinAtribuir).toBeCloseTo(5948.4002, 3);
  });

  it("un precalibrado sin resolver a código se lleva sus kg pero no los atribuye a nadie", () => {
    const r = repartirPasadaPorBox(1000, [
      { tipo: "precalibrado", prec_fecha: "2026-07-22", lote_codigo: null, box: 1, box_tamano: "grande" },
      lote("26051904", 1),
    ]);
    expect(r.lineas[0].codigoAtribuido).toBeNull();
    expect(r.kgAtribuido).toBe(500);
    expect(r.kgSinAtribuir).toBe(500);
  });

  it("las líneas sin box no reciben kg y se reportan para reclamarlas", () => {
    const r = repartirPasadaPorBox(8644.1653, [
      { tipo: "precalibrado", prec_fecha: "2026-07-29", box: null, box_tamano: "grande" },
      { tipo: "precalibrado", prec_fecha: "2026-07-27", box: null, box_tamano: "grande" },
    ]);
    expect(r.lineasSinBox).toBe(2);
    expect(r.lineas.every((l) => l.kg === 0)).toBe(true);
    expect(r.kgPorBoxReal).toBeNull();
  });

  it("sin líneas, o con 0 box, no reparte nada y no revienta", () => {
    expect(repartirPasadaPorBox(1000, []).lineas).toEqual([]);
    expect(repartirPasadaPorBox(1000, [lote("26051904", 0)]).lineas[0].kg).toBe(0);
    expect(repartirPasadaPorBox(null, [lote("26051904", 5)]).lineas[0].kg).toBe(0);
  });
});

describe("parsearDesgloseTexto — nombres REALES de pasadas del calibrador", () => {
  const FECHA_PARTE = "2026-08-04";

  it("«26051904-15 BOX +7 BOX DE RECICLAJE»: lote con sus box + reciclaje aparte", () => {
    expect(parsearDesgloseTexto("26051904-15 BOX +7 BOX DE RECICLAJE", FECHA_PARTE)).toMatchObject([
      { tipo: "lote", lote_codigo: "26051904", box: 15 },
      { tipo: "reciclaje", box: 7 },
    ]);
  });

  it("«22/07  22 BOX  -  23/07 43 BOX»: dos precalibrados por fecha", () => {
    expect(parsearDesgloseTexto("22/07  22 BOX  -  23/07 43 BOX", FECHA_PARTE)).toMatchObject([
      { tipo: "precalibrado", prec_fecha: "2026-07-22", box: 22 },
      { tipo: "precalibrado", prec_fecha: "2026-07-23", box: 43 },
    ]);
  });

  it("«30/07 - 46 B27/07,-7B -29/07-2 B -21/07-7 B»: cuatro fechas con los box pegados", () => {
    expect(parsearDesgloseTexto("30/07 - 46 B27/07,-7B -29/07-2 B -21/07-7 B", FECHA_PARTE)).toMatchObject([
      { tipo: "precalibrado", prec_fecha: "2026-07-30", box: 46 },
      { tipo: "precalibrado", prec_fecha: "2026-07-27", box: 7 },
      { tipo: "precalibrado", prec_fecha: "2026-07-29", box: 2 },
      { tipo: "precalibrado", prec_fecha: "2026-07-21", box: 7 },
    ]);
  });

  it("«31/07 -28 BOX  +3 BOX DE 4K DIA 03/08»: «4K» es formato, no box; los 3 son del 03/08", () => {
    expect(parsearDesgloseTexto("31/07 -28 BOX  +3 BOX DE 4K DIA 03/08", FECHA_PARTE)).toMatchObject([
      { tipo: "precalibrado", prec_fecha: "2026-07-31", box: 28 },
      { tipo: "precalibrado", prec_fecha: "2026-08-03", box: 3 },
    ]);
  });

  it("«26052607+3 BOX DE PREC DIA 31/07+2 PREC DIA 03/08»: los box van DELANTE de su precalibrado", () => {
    expect(parsearDesgloseTexto("26052607+3 BOX DE PREC DIA 31/07+2 PREC DIA 03/08", "2026-08-03")).toMatchObject([
      { tipo: "lote", lote_codigo: "26052607", box: null },
      { tipo: "precalibrado", prec_fecha: "2026-07-31", box: 3 },
      { tipo: "precalibrado", prec_fecha: "2026-08-03", box: 2 },
    ]);
  });

  it("«26051102+ 6 BOX DE RECICLAJE»: el lote queda sin box (lo pondrá el usuario), el reciclaje con 6", () => {
    expect(parsearDesgloseTexto("26051102+ 6 BOX DE RECICLAJE", "2026-08-03")).toMatchObject([
      { tipo: "lote", lote_codigo: "26051102", box: null },
      { tipo: "reciclaje", box: 6 },
    ]);
  });

  it("«29/07-27/07» y «24/07»: fechas sin box, para que las rellene el usuario", () => {
    expect(parsearDesgloseTexto("29/07-27/07", FECHA_PARTE)).toMatchObject([
      { tipo: "precalibrado", prec_fecha: "2026-07-29", box: null },
      { tipo: "precalibrado", prec_fecha: "2026-07-27", box: null },
    ]);
    expect(parsearDesgloseTexto("24/07", FECHA_PARTE)).toHaveLength(1);
  });

  it("variantes reales de la campaña: box pegados, guion antes de BOX y erratas del operario", () => {
    // "26041606+ PREC 12/06 -10-BOX" (15-06): el guion entre el número y BOX.
    expect(parsearDesgloseTexto("26041606+ PREC 12/06 -10-BOX", "2026-06-15")).toMatchObject([
      { tipo: "lote", lote_codigo: "26041606", box: null },
      { tipo: "precalibrado", prec_fecha: "2026-06-12", box: 10 },
    ]);
    // "26060903+2BOX DE RECICLAJE 11/02" (12-06): "2BOX" sin espacio.
    expect(parsearDesgloseTexto("26060903+2BOX DE RECICLAJE", "2026-06-12")).toMatchObject([
      { tipo: "lote", lote_codigo: "26060903", box: null },
      { tipo: "reciclaje", box: 2 },
    ]);
    // "26052003-+2 BOX  DE  RECILAJE" (24-07): errata real del operario.
    expect(parsearDesgloseTexto("26052003-+2 BOX  DE  RECILAJE", "2026-07-24")).toMatchObject([
      { tipo: "lote", lote_codigo: "26052003", box: null },
      { tipo: "reciclaje", box: 2 },
    ]);
  });

  it("descarte, desmontaje y Egipto se tratan como el reciclaje: no atribuyen kg, pero se ve qué eran", () => {
    expect(parsearDesgloseTexto("26050510+ 7 BOX DE DESCARTE", "2026-07-23")).toMatchObject([
      { tipo: "lote", lote_codigo: "26050510", box: null },
      { tipo: "reciclaje", box: 7, nota: "Descarte" },
    ]);
    expect(parsearDesgloseTexto("26042711+ 5 BOX DE RECICLAJE+2 BOX DE EGIP", "2026-07-20")).toMatchObject([
      { tipo: "lote", lote_codigo: "26042711", box: null },
      { tipo: "reciclaje", box: 5, nota: "Reciclaje" },
      { tipo: "reciclaje", box: 2, nota: "Egip" },
    ]);
    expect(parsearDesgloseTexto("26061501+ 2 BOX DE   DESMONTAJE", "2026-06-22")).toMatchObject([
      { tipo: "lote", lote_codigo: "26061501", box: null },
      { tipo: "reciclaje", box: 2, nota: "Desmontaje" },
    ]);
  });

  it("«N BOX DEL/DE <otro lote>»: los box son del lote que viene detrás, no del primero", () => {
    expect(parsearDesgloseTexto("26042108+8 BOX DEL 26042008", "2026-06-08")).toMatchObject([
      { tipo: "lote", lote_codigo: "26042108", box: null },
      { tipo: "lote", lote_codigo: "26042008", box: 8 },
    ]);
    // Sin preposición, en cambio, son del lote ya abierto.
    expect(parsearDesgloseTexto("26042213+26042108 8 BOX +2 BOX DE RECICLAJE", "2026-06-10")).toMatchObject([
      { tipo: "lote", lote_codigo: "26042213", box: null },
      { tipo: "lote", lote_codigo: "26042108", box: 8 },
      { tipo: "reciclaje", box: 2 },
    ]);
  });

  it("un nombre que no ancla nada («8098», vacío) no inventa líneas", () => {
    expect(parsearDesgloseTexto("8098", FECHA_PARTE)).toEqual([]);
    expect(parsearDesgloseTexto("", FECHA_PARTE)).toEqual([]);
    expect(parsearDesgloseTexto(null, FECHA_PARTE)).toEqual([]);
  });

  it("una pasada normal de un solo lote da una línea sin box: el desglose no cambia nada", () => {
    expect(parsearDesgloseTexto("26050808", FECHA_PARTE)).toMatchObject([
      { tipo: "lote", lote_codigo: "26050808", box: null },
    ]);
  });

  it("el texto parseado, con los box puestos, cuadra con el kg real de la pasada", () => {
    const lineas = parsearDesgloseTexto("22/07  22 BOX  -  23/07 43 BOX", FECHA_PARTE);
    const r = repartirPasadaPorBox(13698.8565, lineas);
    expect(r.boxTotal).toBe(65);
    expect(r.lineas.reduce((s, l) => s + l.kg, 0)).toBeCloseTo(13698.8565, 6);
  });
});

describe("expandirPasadaPorDesglose (lo que ve el motor de conciliación)", () => {
  const pasada = { id: "p1", lote_codigo: "26051904-15 BOX +7 BOX DE RECICLAJE", kg_peso_total: 5948.4002, kg_industria: 220 };

  it("sin desglose, la pasada pasa intacta", () => {
    expect(expandirPasadaPorDesglose(pasada, [])).toEqual([pasada]);
  });

  it("el reciclaje no genera pasada: sus kg no se atribuyen a ningún lote", () => {
    const r = expandirPasadaPorDesglose(pasada, [
      lote("26051904", 15),
      { tipo: "reciclaje", box: 7, box_tamano: "grande" },
    ]);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ id: "p1#box1", lote_codigo: "26051904" });
    expect(r[0].kg_peso_total).toBeCloseTo(5948.4002 * (15 / 22), 3);
    // El destrío a industria se prorratea con los kg, no se duplica.
    expect(r[0].kg_industria).toBeCloseTo(220 * (15 / 22), 3);
  });

  it("varios lotes en una pasada: una pasada sintética por lote, con id propio", () => {
    const r = expandirPasadaPorDesglose(
      { id: "p2", lote_codigo: "22/07 22 BOX - 23/07 43 BOX", kg_peso_total: 13698.8565 },
      [
        { tipo: "precalibrado", prec_fecha: "2026-07-22", lote_codigo: "26072201", box: 22, box_tamano: "grande" },
        { tipo: "precalibrado", prec_fecha: "2026-07-23", lote_codigo: "26072301", box: 43, box_tamano: "grande" },
      ],
    );
    expect(r.map((p) => p.lote_codigo)).toEqual(["26072201", "26072301"]);
    expect(r.map((p) => p.id)).toEqual(["p2#box1", "p2#box2"]);
    expect(r.reduce((s, p) => s + p.kg_peso_total, 0)).toBeCloseTo(13698.8565, 6);
  });

  it("CINTURÓN: un desglose que aún no atribuye nada deja la pasada intacta (no se pierden kg)", () => {
    // Líneas sin box todavía.
    expect(expandirPasadaPorDesglose(pasada, [lote("26051904", null)])).toEqual([pasada]);
    // Solo reciclaje: si se aplicara, el lote perdería toda su fruta.
    expect(expandirPasadaPorDesglose(pasada, [{ tipo: "reciclaje", box: 7, box_tamano: "grande" }])).toEqual([pasada]);
    // Precalibrado sin re-entrada que lo respalde.
    expect(expandirPasadaPorDesglose(pasada, [
      { tipo: "precalibrado", prec_fecha: "2026-07-22", box: 10, box_tamano: "grande" },
    ])).toEqual([pasada]);
  });
});

describe("fechaPrecalibradoAIso", () => {
  it("usa el año del parte", () => {
    expect(fechaPrecalibradoAIso("22/07", "2026-08-04")).toBe("2026-07-22");
    expect(fechaPrecalibradoAIso("3/8", "2026-08-04")).toBe("2026-08-03");
  });

  it("una fecha posterior al parte es del año anterior (el precalibrado se apartó antes)", () => {
    expect(fechaPrecalibradoAIso("28/12", "2026-01-05")).toBe("2025-12-28");
  });

  it("respeta el año si el operario lo escribe, y rechaza lo que no es fecha", () => {
    expect(fechaPrecalibradoAIso("22/07/25", "2026-08-04")).toBe("2025-07-22");
    expect(fechaPrecalibradoAIso("40/07", "2026-08-04")).toBeNull();
    expect(fechaPrecalibradoAIso("22-07", "2026-08-04")).toBeNull();
  });
});

describe("resolverPrecalibradoPorFecha", () => {
  const candidatas = [
    { lote: "26072001", fecha: "2026-07-20", finca: "PREC 1 ALMACEN", kg_entrada: 30, envases: 1 },
    { lote: "26072002", fecha: "2026-07-20", finca: "PREC 2 ALMACEN", kg_entrada: 5084, envases: 20 },
    { lote: "26071601", fecha: "2026-07-16", finca: "PREC 1 ALMACEN", kg_entrada: 2009, envases: 16 },
    // Caso real de la BD (jul-2026): re-entrada sembrada desde el informe de
    // stock de lotes — sin finca, solo agricultor. Debe resolver igual.
    { lote: "26073001", fecha: "2026-07-30", finca: null, agricultor: "LASARTE ALMACEN PRECALIBRADO", kg_entrada: 5259, envases: 23 },
  ];

  it("una re-entrada sin finca (sembrada desde stock) resuelve igual que las de báscula", () => {
    expect(resolverPrecalibradoPorFecha("2026-07-30", candidatas)).toMatchObject({
      estado: "resuelto",
      codigo: "26073001",
    });
  });

  it("una sola re-entrada ese día: se resuelve a su código", () => {
    expect(resolverPrecalibradoPorFecha("2026-07-16", candidatas)).toMatchObject({
      estado: "resuelto",
      codigo: "26071601",
    });
  });

  it("varias re-entradas el mismo día: ambiguo, lo elige una persona (nunca FIFO ni la mayor)", () => {
    const r = resolverPrecalibradoPorFecha("2026-07-20", candidatas);
    expect(r.estado).toBe("ambiguo");
    expect(r.estado === "ambiguo" && r.candidatas).toHaveLength(2);
  });

  it("sin re-entrada ese día (o sin fecha) no se inventa cruce", () => {
    expect(resolverPrecalibradoPorFecha("2026-07-19", candidatas).estado).toBe("sin_candidatos");
    expect(resolverPrecalibradoPorFecha(null, candidatas).estado).toBe("sin_candidatos");
  });

  it("kg por box de la re-entrada, para contrastar con el reparto", () => {
    expect(kgPorBoxDeReentrada(candidatas[1])).toBe(254.2);
    expect(kgPorBoxDeReentrada({ ...candidatas[1], envases: 0 })).toBeNull();
  });
});

describe("codigoAtribuidoDe", () => {
  it("el reciclaje nunca atribuye; el lote y el PREC resuelto sí", () => {
    expect(codigoAtribuidoDe({ tipo: "reciclaje", box: 3, box_tamano: "grande" })).toBeNull();
    expect(codigoAtribuidoDe(lote("26051904", 3))).toBe("26051904");
    expect(codigoAtribuidoDe({ tipo: "precalibrado", lote_codigo: "26072002", box: 3, box_tamano: "grande" })).toBe("26072002");
    expect(codigoAtribuidoDe({ tipo: "precalibrado", prec_fecha: "2026-07-22", box: 3, box_tamano: "grande" })).toBeNull();
  });
});

// La facturación real de Mercadona leída del ERP: método por línea, agrupado por
// semana ISO y la regla que decide qué se escribe. Las cifras de los casos son
// las reales de las semanas 27, 30 y 31 de 2026, que es contra lo que se validó
// el criterio (fecha de albarán, palets → método, serie R → ajustes).
import { describe, expect, it } from "vitest";
import {
  agruparFacturacionErp,
  baseGuardada,
  cambiosDeSemana,
  claveLineaVenta,
  decidirSemana,
  metodoDeLineaVenta,
  parsearSemanaArg,
  rangoFechas,
  semanasEntre,
  SIN_METODO,
  type LineaVentaErp,
  type PaletsLineaErp,
  type SemanaBase,
  type SemanaErp,
} from "./mercadonaFacturacionErp";

function linea(parcial: Partial<LineaVentaErp> & { fechaAlbaran: string }): LineaVentaErp {
  return {
    tipoDocumento: 40, serie: "C", numDcmto: 19026, numLinea: 1, articulo: "10000495",
    denominacion: "NAR VALENCIA LATE CAL6/8", texto: "NAR VALENCIA LATE CAL6/8 GIRSAC 3 X 4 KG",
    kg: 1000, importe: 860, numFactura: 5418, centroCliente: "04",
    ...parcial,
  };
}

const paletsDe = (metodo: string, kg = 1000, palets = 3, cajas = 72): PaletsLineaErp[] => [{ metodo, kg, palets, cajas }];

describe("metodoDeLineaVenta", () => {
  it("manda la fórmula de confección de los palets (y gana la mayoría por kilos si hay mezcla)", () => {
    expect(metodoDeLineaVenta(linea({ fechaAlbaran: "2026-07-20" }), paletsDe("MA4KGC "))).toEqual({ metodo: "MA4KGC", origen: "palets" });
    const mezcla: PaletsLineaErp[] = [{ metodo: "MA3KGC", kg: 297, palets: 1, cajas: 24 }, { metodo: "MA4KGC", kg: 5000, palets: 17, cajas: 400 }];
    expect(metodoDeLineaVenta(linea({ fechaAlbaran: "2026-07-20" }), mezcla).metodo).toBe("MA4KGC");
  });
  it("sin palets deduce el formato del texto de la línea con las reglas de mdnaMix", () => {
    const casos: Array<[string, string]> = [
      ["NAR VALENCIA MIDKNIGHT CAL4/5 D-PACK 4 X 3 KG", "MA3KGC"],
      ["NAR VALENCIA LATE CAL6/8 GIRSAC 3 X 4 KG  ", "MA4KGC"],
      ["NAR VALENCIA LATE CAL5/6 D-PACK 2 X 5 KG", "MA5KGC"],
      ["NAR VALENCIA MIDKNIGHT CAL1/2 GRANEL 12 KG", "MA12KGC"],
    ];
    for (const [texto, esperado] of casos) {
      expect(metodoDeLineaVenta(linea({ fechaAlbaran: "2026-07-20", texto }), undefined)).toEqual({ metodo: esperado, origen: "texto" });
    }
  });
  it("un abono (serie R) no tiene método aunque el texto lo dijera: es la fila de ajustes", () => {
    expect(metodoDeLineaVenta(linea({ fechaAlbaran: "2026-07-28", serie: "R", texto: "NAR VALENCIA LATE CAL5/6 D-PACK 2 X 5 KG" }), paletsDe("MA5KGC")))
      .toEqual({ metodo: null, origen: "abono" });
  });
  it("sin palets y sin formato en el texto no se adivina", () => {
    expect(metodoDeLineaVenta(linea({ fechaAlbaran: "2026-07-20", texto: "NAR VALENCIA LATE CAL6/8" }), [])).toEqual({ metodo: null, origen: "ninguno" });
  });
});

describe("agruparFacturacionErp", () => {
  const palets = new Map<string, PaletsLineaErp[]>([
    [claveLineaVenta("C", 19026, 1), paletsDe("MA12KGC", 62, 1, 5)],
    [claveLineaVenta("C", 19026, 2), paletsDe("MA3KGC", 180, 1, 15)],
    [claveLineaVenta("C", 19100, 1), paletsDe("MA12KGC", 500, 2, 40)],
  ]);
  const lineas: LineaVentaErp[] = [
    // S30: lunes 20-07 y domingo 26-07 (el domingo cierra su semana).
    linea({ fechaAlbaran: "2026-07-20", numDcmto: 19026, numLinea: 1, articulo: "10000719", texto: "NAR VALENCIA MIDKNIGHT CAL1/2 GRANEL 12 KG", kg: 62, importe: 87.42 }),
    linea({ fechaAlbaran: "2026-07-20", numDcmto: 19026, numLinea: 2, articulo: "10000869", texto: "NAR VALENCIA MIDKNIGHT CAL4/5 D-PACK 4 X 3 KG", kg: 180, importe: 217.8 }),
    linea({ fechaAlbaran: "2026-07-26", numDcmto: 19100, numLinea: 1, articulo: "10000719", texto: "NAR VALENCIA MIDKNIGHT CAL1/2 GRANEL 12 KG", kg: 500, importe: 705, centroCliente: "07" }),
    // S31: lunes 27-07 sin palets (método por texto) y un abono de la serie R.
    linea({ fechaAlbaran: "2026-07-27", numDcmto: 19200, numLinea: 1, articulo: "10000487", texto: "NAR VALENCIA LATE CAL5/6 D-PACK 2 X 5 KG", kg: 430, importe: 425.7 }),
    linea({ fechaAlbaran: "2026-07-28", serie: "R", numDcmto: 1179, numLinea: 3, articulo: "10000869", texto: "NAR VALENCIA MIDKNIGHT CAL4/5", kg: 0, importe: -22.75, numFactura: 257 }),
    // S31: una línea sin valorar (kilos e importe 0), una vacía del todo y una de otro tipo de documento.
    linea({ fechaAlbaran: "2026-07-29", numDcmto: 19201, numLinea: 1, kg: 800, importe: 0, numFactura: null }),
    linea({ fechaAlbaran: "2026-07-29", numDcmto: 19201, numLinea: 2, kg: 0, importe: 0, numFactura: null }),
    linea({ fechaAlbaran: "2026-07-29", tipoDocumento: 51, numDcmto: 77, numLinea: 1, kg: 10, importe: 10 }),
    // S31: una línea de venta sin palets ni formato en el texto: SIN_METODO.
    linea({ fechaAlbaran: "2026-07-30", numDcmto: 19202, numLinea: 1, texto: "NAR VALENCIA LATE CAL6/8", kg: 100, importe: 86 }),
  ];
  const semanas = agruparFacturacionErp(lineas, palets);

  it("agrupa por semana ISO de la fecha de albarán, ordenadas", () => {
    expect(semanas.map((s) => s.clave)).toEqual(["2026-W30", "2026-W31"]);
  });
  it("S30: métodos por palets, con kilos, base, líneas, palets y cajas, y las plataformas aparte", () => {
    const s30 = semanas[0];
    expect(s30.metodos.map((m) => m.metodo)).toEqual(["MA12KGC", "MA3KGC"]);
    const granel = s30.metodos[0];
    expect(granel).toMatchObject({ lineas: 2, kg: 562, base: 792.42, sinValorar: 0, porTexto: 0, palets: 3, cajas: 45 });
    expect(s30.baseMetodos).toBe(1010.22);
    expect(s30.kgMetodos).toBe(742);
    expect(s30.lineasMetodos).toBe(3);
    expect(s30.ajustes).toEqual({ lineas: 0, base: 0, kg: 0 });
    expect(s30.porCentro).toEqual([
      { centro: "04", lineas: 2, kg: 242, base: 305.22 },
      { centro: "07", lineas: 1, kg: 500, base: 705 },
    ]);
  });
  it("S31: abono a ajustes, método por texto avisado, sin valorar contado, vacía ignorada, otro tipo aparte, SIN_METODO aparte", () => {
    const s31 = semanas[1];
    expect(s31.ajustes).toEqual({ lineas: 1, base: -22.75, kg: 0 });
    const dpack = s31.metodos.find((m) => m.metodo === "MA5KGC")!;
    expect(dpack).toMatchObject({ lineas: 1, kg: 430, base: 425.7, porTexto: 1 });
    const girsac = s31.metodos.find((m) => m.metodo === "MA4KGC")!;
    expect(girsac).toMatchObject({ lineas: 1, kg: 800, base: 0, sinValorar: 1 });
    expect(s31.lineasSinValorar).toBe(1);
    expect(s31.otrosTipos).toBe(1);
    expect(s31.sinMetodo).toMatchObject({ metodo: SIN_METODO, lineas: 1, kg: 100, base: 86 });
    // La línea vacía del todo no cuenta en ningún sitio.
    expect(s31.lineasMetodos).toBe(2);
  });
});

/** La S30 de 2026 tal y como está en el ERP (y en la base, que la reproduce al céntimo). */
function s30Erp(): SemanaErp {
  const metodos = [
    { metodo: "MA12KGC", lineas: 16, kg: 18148, base: 25588.68 },
    { metodo: "MA3KGC", lineas: 18, kg: 31728, base: 38390.88 },
    { metodo: "MA4KGC", lineas: 18, kg: 69451, base: 59727.86 },
    { metodo: "MA5KGC", lineas: 18, kg: 46030, base: 45569.7 },
  ].map((m) => ({ ...m, sinValorar: 0, porTexto: 0, palets: 0, cajas: 0 }));
  return {
    anio: 2026, semana: 30, clave: "2026-W30", metodos, ajustes: { lineas: 0, base: 0, kg: 0 }, sinMetodo: null,
    lineasSinValorar: 0, otrosTipos: 0, porCentro: [], baseMetodos: 169277.12, kgMetodos: 165357, lineasMetodos: 70,
  };
}

/**
 * La misma S30 en la base. Las líneas se toman de las del ERP (16 en el granel,
 * 18 en el resto) para que "mismos euros" signifique de verdad "nada que
 * cambiar": el número de líneas también se escribe, y si no coincidiera saldría
 * como cambio (lo prueba el caso de más abajo).
 */
function s30Base(bases: Record<string, number | null>, extra: Partial<SemanaBase> = {}): SemanaBase {
  const lineasErp = new Map(s30Erp().metodos.map((m) => [m.metodo, m.lineas]));
  return {
    id: "sem-30", anio: 2026, semana: 30, ajustesBaseIva: null, ajustesLineas: null,
    metodos: Object.entries(bases).map(([metodo, baseIva], i) => ({ id: `m${i}`, metodo, kilos: 1, baseIva, lineas: lineasErp.get(metodo) ?? 18 })),
    ...extra,
  };
}

describe("decidirSemana", () => {
  it("la base ya tiene lo que dice el ERP: sin cambios (idempotente)", () => {
    const d = decidirSemana(s30Erp(), s30Base({ MA12KGC: 25588.68, MA3KGC: 38390.88, MA4KGC: 59727.86, MA5KGC: 45569.7 }));
    expect(d.accion).toBe("sin-cambios");
    expect(d.baseDb).toBe(169277.12);
    expect(d.baseErp).toBe(169277.12);
  });
  it("base parcial (< 80 % del ERP, como las semanas 27-29 y 32): actualizar", () => {
    // S27 real: 59.976,80 guardados frente a 159.727,85 del ERP (37 %).
    const d = decidirSemana(s30Erp(), s30Base({ MA12KGC: 10319.68, MA3KGC: 14582.88, MA4KGC: 18906.24, MA5KGC: 16168 }));
    expect(d.accion).toBe("actualizar");
    expect(d.motivo).toContain("parcial");
    expect(Math.round((d.fraccion ?? 0) * 100)).toBe(35);
  });
  it("difiere pero la base tiene ≥ 80 %: se informa y no se toca", () => {
    const d = decidirSemana(s30Erp(), s30Base({ MA12KGC: 25588.68, MA3KGC: 38390.88, MA4KGC: 59727.86, MA5KGC: 40000 }));
    expect(d.accion).toBe("difiere-sin-tocar");
  });
  it("semana con planificación pero sin base_iva: actualizar", () => {
    const d = decidirSemana(s30Erp(), s30Base({ MA12KGC: null, MA3KGC: null, MA4KGC: null, MA5KGC: null }));
    expect(d.accion).toBe("actualizar");
    expect(d.baseDb).toBeNull();
  });
  it("sin fila en la base: crear (solo con la opción explícita)", () => {
    expect(decidirSemana(s30Erp(), null).accion).toBe("crear");
  });
  it("líneas sin valorar: el ERP está incompleto y no se escribe nada, exista o no la fila", () => {
    const erp = s30Erp();
    erp.lineasSinValorar = 4;
    expect(decidirSemana(erp, null).accion).toBe("erp-incompleto");
    expect(decidirSemana(erp, s30Base({ MA12KGC: 100 })).accion).toBe("erp-incompleto");
  });
  it("líneas sin método o de otro tipo de documento: no cuadra", () => {
    const conSinMetodo = s30Erp();
    conSinMetodo.sinMetodo = { metodo: SIN_METODO, lineas: 1, kg: 100, base: 86, sinValorar: 0, porTexto: 0, palets: 0, cajas: 0 };
    expect(decidirSemana(conSinMetodo, null).accion).toBe("no-cuadra");
    const otroTipo = s30Erp();
    otroTipo.otrosTipos = 1;
    expect(decidirSemana(otroTipo, null).accion).toBe("no-cuadra");
  });
  it("sin líneas en el ERP: sin datos", () => {
    expect(decidirSemana(null, null).accion).toBe("sin-datos");
    expect(decidirSemana(null, s30Base({ MA12KGC: 1 })).motivo).toContain("la base sí");
  });
  it("avisa de métodos que solo están en la base y de ajustes que no casan", () => {
    const erp = s30Erp();
    erp.ajustes = { lineas: 5, base: -11011.18, kg: 0 };
    const d = decidirSemana(erp, s30Base({ MA12KGC: 25588.68, MA3KGC: 38390.88, MA4KGC: 59727.86, MA5KGC: 45569.7, MA3KGB: 12 }));
    expect(d.avisos.some((a) => a.includes("MA3KGB"))).toBe(true);
    expect(d.avisos.some((a) => a.startsWith("ajustes"))).toBe(true);
  });
});

describe("cambiosDeSemana y baseGuardada", () => {
  it("lista qué métodos cambian de base/líneas, cuáles faltan en la base y si cambian los ajustes", () => {
    const erp = s30Erp();
    erp.ajustes = { lineas: 5, base: -11011.18, kg: 0 };
    const base = s30Base({ MA12KGC: 25588.68, MA3KGC: 14582.88, MA4KGC: 18906.24 });
    const c = cambiosDeSemana(erp, base);
    expect(c.metodos.map((m) => m.metodo)).toEqual(["MA3KGC", "MA4KGC", "MA5KGC"]);
    expect(c.metodos[0]).toMatchObject({ idBase: "m1", baseAntes: 14582.88, baseDespues: 38390.88, lineasAntes: 18, lineasDespues: 18 });
    expect(c.metodos[2]).toMatchObject({ idBase: null, baseAntes: null, baseDespues: 45569.7 });
    expect(c.ajustes).toEqual({ antes: { base: null, lineas: null }, despues: { base: -11011.18, lineas: 5 } });
  });
  it("sin diferencias no propone nada", () => {
    const c = cambiosDeSemana(s30Erp(), s30Base({ MA12KGC: 25588.68, MA3KGC: 38390.88, MA4KGC: 59727.86, MA5KGC: 45569.7 }));
    expect(c.metodos).toEqual([]);
    expect(c.ajustes).toBeNull();
  });
  it("un método con los mismos euros pero distinto número de líneas también se corrige", () => {
    const base = s30Base({ MA12KGC: 25588.68, MA3KGC: 38390.88, MA4KGC: 59727.86, MA5KGC: 45569.7 });
    base.metodos[0].lineas = 15; // el ERP dice 16
    const c = cambiosDeSemana(s30Erp(), base);
    expect(c.metodos).toHaveLength(1);
    expect(c.metodos[0]).toMatchObject({ metodo: "MA12KGC", baseAntes: 25588.68, baseDespues: 25588.68, lineasAntes: 15, lineasDespues: 16 });
  });
  it("baseGuardada es null cuando ningún método tiene base (solo planificación)", () => {
    expect(baseGuardada(s30Base({ MA12KGC: null, MA3KGC: null }))).toBeNull();
    expect(baseGuardada(s30Base({ MA12KGC: 1.1, MA3KGC: 2.2 }))).toBe(3.3);
  });
});

describe("semanas: argumentos, rango y lista", () => {
  it("parsearSemanaArg entiende 2026-W27, 2026W5 y el número suelto con el año por defecto", () => {
    expect(parsearSemanaArg("2026-W27", 2025)).toEqual({ anio: 2026, semana: 27 });
    expect(parsearSemanaArg("2026W5", 2025)).toEqual({ anio: 2026, semana: 5 });
    expect(parsearSemanaArg("36", 2026)).toEqual({ anio: 2026, semana: 36 });
  });
  it("rechaza semanas que no existen: la 54, y la 53 de un año de 52 semanas", () => {
    expect(parsearSemanaArg("54", 2026)).toBeNull();
    expect(parsearSemanaArg("2025-W53", 2026)).toBeNull();
    expect(parsearSemanaArg("2026-W53", 2026)).toEqual({ anio: 2026, semana: 53 });
    expect(parsearSemanaArg("", 2026)).toBeNull();
  });
  it("semanasEntre cruza el año: 2026 tiene 53 semanas", () => {
    expect(semanasEntre({ anio: 2026, semana: 27 }, { anio: 2026, semana: 30 }).map((s) => s.semana)).toEqual([27, 28, 29, 30]);
    expect(semanasEntre({ anio: 2026, semana: 52 }, { anio: 2027, semana: 2 })).toEqual([
      { anio: 2026, semana: 52 }, { anio: 2026, semana: 53 }, { anio: 2027, semana: 1 }, { anio: 2027, semana: 2 },
    ]);
  });
  it("rangoFechas va del lunes de la primera al lunes siguiente al domingo de la última (exclusivo)", () => {
    expect(rangoFechas({ anio: 2026, semana: 27 }, { anio: 2026, semana: 36 })).toEqual({ desdeISO: "2026-06-29", hastaExclusivoISO: "2026-09-07" });
  });
});

import { describe, expect, it } from "vitest";
import type { CamionCamaraExterna, SenalesRecepcion } from "./camarasExternas";
import {
  CIERRE_MODO_CONCILIACION_CAMARA_VACIA,
  combinarNotaEntrada,
  conciliadosCamaraVacia,
  esConciliadoCamaraVacia,
  notaConciliacionCamaraVacia,
  previsualizarConciliacionCamaraVacia,
  resumenConciliacionCamaraVacia,
  type EntradaBasculaParaConciliacion,
} from "./conciliarCamaraVacia";

const camion = (over: Partial<CamionCamaraExterna>): CamionCamaraExterna => ({
  procedencia: "GUADEX",
  s_ref: "S26/1",
  lote: "26050809",
  fecha_almacenamiento: "2026-05-08",
  proveedor: "Invermarmelo",
  finca: null,
  variedad: null,
  envases: null,
  kg: 20000,
  entrada_lst_1: null,
  entrada_lst_2: null,
  envases_1: null,
  envases_2: null,
  venta_directa: null,
  nota_entrada: null,
  transporte_lst: null,
  ...over,
});

const sinSenales: SenalesRecepcion = { salidaPorLote: new Map(), lotesProcesados: new Set() };

describe("previsualizarConciliacionCamaraVacia — selección de pendientes por procedencia", () => {
  it("solo incluye camiones en_camara/parcial de LA procedencia pedida", () => {
    const camiones = [
      camion({ s_ref: "S26/1", procedencia: "GUADEX", lote: "26050809" }),
      camion({ s_ref: "S26/2", procedencia: "ZAMEXFRUIT", lote: "26051509" }),
    ];
    const preview = previsualizarConciliacionCamaraVacia("GUADEX", camiones, sinSenales, [], "2026-08-04");
    expect(preview.pendientes.map((p) => p.camion.s_ref)).toEqual(["S26/1"]);
    expect(preview.kgTotal).toBe(20000);
  });

  it("excluye los que ya tienen SALIDA (fecha_salida_camara) — ya recibidos, no pendientes", () => {
    const c = camion({ lote: "26050809" });
    const senales: SenalesRecepcion = { salidaPorLote: new Map([["26050809", "2026-07-01"]]), lotesProcesados: new Set() };
    const preview = previsualizarConciliacionCamaraVacia("GUADEX", [c], senales, [], "2026-08-04");
    expect(preview.pendientes).toHaveLength(0);
  });

  it("excluye los que ya tienen PROCESADO (pasada de calibrador) — ya recibidos, no pendientes", () => {
    const c = camion({ lote: "26050809" });
    const senales: SenalesRecepcion = { salidaPorLote: new Map(), lotesProcesados: new Set(["26050809"]) };
    const preview = previsualizarConciliacionCamaraVacia("GUADEX", [c], senales, [], "2026-08-04");
    expect(preview.pendientes).toHaveLength(0);
  });

  it("excluye venta directa — no es un camión 'en cámara'", () => {
    const c = camion({ venta_directa: "Venta directa 15/05" });
    const preview = previsualizarConciliacionCamaraVacia("GUADEX", [c], sinSenales, [], "2026-08-04");
    expect(preview.pendientes).toHaveLength(0);
  });

  it("un camión PARCIAL cuenta solo su kg restante prorrateado, no el kg total", () => {
    const c = camion({ envases: 72, entrada_lst_1: "2026-06-26", envases_1: 6, kg: 23140 });
    const senales: SenalesRecepcion = { salidaPorLote: new Map(), lotesProcesados: new Set(["26050809"]) };
    const preview = previsualizarConciliacionCamaraVacia("GUADEX", [c], senales, [], "2026-08-04");
    expect(preview.pendientes).toHaveLength(1);
    expect(preview.pendientes[0].estado.estado).toBe("parcial");
    expect(preview.kgTotal).toBeCloseTo(23140 * (66 / 72), 3);
  });

  it("resuelve el id real de entradas_bascula por lote normalizado (8 dígitos, casa aunque venga con texto pegado)", () => {
    const c = camion({ lote: "26050809" });
    const entradas: EntradaBasculaParaConciliacion[] = [
      { id: "id-real", lote: "26050809 texto pegado", cerradoAt: null },
    ];
    const preview = previsualizarConciliacionCamaraVacia("GUADEX", [c], sinSenales, entradas, "2026-08-04");
    expect(preview.pendientes[0].entradaId).toBe("id-real");
    expect(preview.sinEntradaBascula).toHaveLength(0);
  });

  it("caso real: lote sin NINGUNA entrada de báscula localizable → rareza en sinEntradaBascula, sin reventar", () => {
    const c = camion({ lote: "26050809" });
    const preview = previsualizarConciliacionCamaraVacia("GUADEX", [c], sinSenales, [], "2026-08-04");
    expect(preview.pendientes[0].entradaId).toBeNull();
    expect(preview.sinEntradaBascula).toHaveLength(1);
    expect(preview.sinEntradaBascula[0].camion.s_ref).toBe("S26/1");
  });

  it("entrada ya cerrada a mano se marca aparte (entradaYaCerrada) para no recerrarla ni pisar su modo", () => {
    const c = camion({ lote: "26050809" });
    const entradas: EntradaBasculaParaConciliacion[] = [{ id: "id-real", lote: "26050809", cerradoAt: "2026-07-01T00:00:00Z" }];
    const preview = previsualizarConciliacionCamaraVacia("GUADEX", [c], sinSenales, entradas, "2026-08-04");
    expect(preview.pendientes[0].entradaYaCerrada).toBe(true);
    expect(preview.entradaYaCerrada).toHaveLength(1);
  });

  it("ordena por fecha de almacenamiento, el más antiguo primero", () => {
    const camiones = [
      camion({ s_ref: "B", lote: "26050101", fecha_almacenamiento: "2026-05-20" }),
      camion({ s_ref: "A", lote: "26050102", fecha_almacenamiento: "2026-04-24" }),
    ];
    const preview = previsualizarConciliacionCamaraVacia("GUADEX", camiones, sinSenales, [], "2026-08-04");
    expect(preview.pendientes.map((p) => p.camion.s_ref)).toEqual(["A", "B"]);
  });
});

describe("nota rastreable de la conciliación", () => {
  it("notaConciliacionCamaraVacia trae la fecha y explica que no hay rastro de procesado", () => {
    expect(notaConciliacionCamaraVacia("2026-08-04")).toBe(
      "Conciliado como cámara vacía el 2026-08-04 (sin rastro de procesado con su código)",
    );
  });

  it("combinarNotaEntrada concatena sin pisar una nota previa", () => {
    expect(combinarNotaEntrada("06/04/206", "Conciliado como cámara vacía el 2026-08-04 (sin rastro de procesado con su código)"))
      .toBe("06/04/206 · Conciliado como cámara vacía el 2026-08-04 (sin rastro de procesado con su código)");
  });

  it("combinarNotaEntrada sin nota previa devuelve solo la nota nueva", () => {
    expect(combinarNotaEntrada(null, "nota nueva")).toBe("nota nueva");
  });

  it("el modo de cierre de esta conciliación es 'sin_registro' (no inventa merma)", () => {
    expect(CIERRE_MODO_CONCILIACION_CAMARA_VACIA).toBe("sin_registro");
  });
});

describe("esConciliadoCamaraVacia / conciliadosCamaraVacia / resumenConciliacionCamaraVacia", () => {
  it("reconoce un camión conciliado por la marca en nota_entrada, sin necesitar una columna nueva", () => {
    const c = camion({ nota_entrada: notaConciliacionCamaraVacia("2026-08-04") });
    expect(esConciliadoCamaraVacia(c)).toBe(true);
  });

  it("una nota_entrada de otro origen (errata del registro) NO cuenta como conciliado", () => {
    const c = camion({ nota_entrada: "06/04/206" });
    expect(esConciliadoCamaraVacia(c)).toBe(false);
  });

  it("nota_entrada null no revienta", () => {
    expect(esConciliadoCamaraVacia(camion({ nota_entrada: null }))).toBe(false);
  });

  it("la marca sigue reconociéndose aunque esté concatenada detrás de una nota previa", () => {
    const nota = combinarNotaEntrada("06/04/206", notaConciliacionCamaraVacia("2026-08-04"));
    expect(esConciliadoCamaraVacia(camion({ nota_entrada: nota }))).toBe(true);
  });

  it("conciliadosCamaraVacia filtra solo los marcados y los ordena del más reciente al más antiguo", () => {
    const camiones = [
      camion({ s_ref: "A", fecha_almacenamiento: "2026-05-08", nota_entrada: notaConciliacionCamaraVacia("2026-08-01") }),
      camion({ s_ref: "B", fecha_almacenamiento: "2026-05-25", nota_entrada: notaConciliacionCamaraVacia("2026-08-02") }),
      camion({ s_ref: "C", fecha_almacenamiento: "2026-06-01", nota_entrada: null }),
    ];
    const conciliados = conciliadosCamaraVacia(camiones);
    expect(conciliados.map((c) => c.s_ref)).toEqual(["B", "A"]);
  });

  it("resumenConciliacionCamaraVacia agrupa n camiones y t por procedencia", () => {
    const camiones = [
      camion({ s_ref: "A", procedencia: "GUADEX", kg: 20000, nota_entrada: notaConciliacionCamaraVacia("2026-08-01") }),
      camion({ s_ref: "B", procedencia: "GUADEX", kg: 15000, nota_entrada: notaConciliacionCamaraVacia("2026-08-01") }),
      camion({ s_ref: "C", procedencia: "ZAMEXFRUIT", kg: 10000, nota_entrada: notaConciliacionCamaraVacia("2026-08-01") }),
      camion({ s_ref: "D", procedencia: "ZAMEXFRUIT", kg: 999, nota_entrada: null }),
    ];
    const resumen = resumenConciliacionCamaraVacia(camiones);
    expect(resumen).toEqual([
      { procedencia: "GUADEX", camiones: 2, kg: 35000 },
      { procedencia: "ZAMEXFRUIT", camiones: 1, kg: 10000 },
    ]);
  });
});

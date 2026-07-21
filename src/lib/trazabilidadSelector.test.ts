import { describe, expect, it } from "vitest";
import type { StockLoteRow } from "@/lib/entradasBascula";
import {
  desplazarFecha,
  esNotaOperarioLote,
  filtrarLotesSelector,
  ordenarLotesSelector,
  variedadesDisponibles,
} from "./trazabilidadSelector";

const fila = (over: Partial<StockLoteRow> & { lote: string }): StockLoteRow => ({
  fecha_entrada: "2026-04-28",
  finca: "Dehesilla - GG",
  articulo: "NAR VAL DELTA SEEDLESS",
  agricultor: "LASARTE EXPORT S.L. Frutas Moratalla",
  kg_entrada: 21580,
  kg_procesado: 21580,
  kg_en_camara: 0,
  ultima_fecha_procesado: "2026-07-08",
  dias_en_camara: 71,
  estado: "procesado",
  cerrado_at: null,
  cierre_modo: null,
  probablementeTerminado: false,
  cerradoConActividadPosterior: false,
  ...over,
});

const filas = [
  fila({ lote: "26042811" }),
  fila({ lote: "26051309", finca: "COLOMBO - GG", articulo: "NARANJA VALENCIA MIDKNIGHT", fecha_entrada: "2026-05-13", estado: "parcial", kg_en_camara: 5000, dias_en_camara: 69 }),
  fila({ lote: "26052503", finca: "LAS MARIAS", articulo: "NARANJA VALENCIA DELTA", fecha_entrada: "2026-05-25", estado: "pendiente", kg_en_camara: 23680, kg_procesado: 0, dias_en_camara: 57 }),
];

describe("filtrarLotesSelector", () => {
  it("texto libre casa contra lote, finca, variedad y agricultor (sin acentos)", () => {
    expect(filtrarLotesSelector(filas, { texto: "colombo", estado: "todos", variedad: "" })).toHaveLength(1);
    expect(filtrarLotesSelector(filas, { texto: "marías", estado: "todos", variedad: "" })[0].lote).toBe("26052503");
    expect(filtrarLotesSelector(filas, { texto: "26042811", estado: "todos", variedad: "" })).toHaveLength(1);
    expect(filtrarLotesSelector(filas, { texto: "moratalla", estado: "todos", variedad: "" })[0].lote).toBe("26042811");
  });

  it("estado 'camara' deja pendientes y parciales; 'procesados' solo procesados", () => {
    expect(filtrarLotesSelector(filas, { texto: "", estado: "camara", variedad: "" }).map((f) => f.lote))
      .toEqual(["26051309", "26052503"]);
    expect(filtrarLotesSelector(filas, { texto: "", estado: "procesados", variedad: "" }).map((f) => f.lote))
      .toEqual(["26042811"]);
  });

  it("variedad filtra por articulo exacto", () => {
    expect(filtrarLotesSelector(filas, { texto: "", estado: "todos", variedad: "NARANJA VALENCIA MIDKNIGHT" }).map((f) => f.lote))
      .toEqual(["26051309"]);
  });
});

describe("ordenarLotesSelector", () => {
  it("ordena por kg en cámara desc con desempate estable", () => {
    const orden = ordenarLotesSelector(filas, "kg_en_camara", "desc").map((f) => f.lote);
    expect(orden).toEqual(["26052503", "26051309", "26042811"]);
  });

  it("por % procesado asc: el pendiente (0%) primero", () => {
    const orden = ordenarLotesSelector(filas, "pct_procesado", "asc").map((f) => f.lote);
    expect(orden[0]).toBe("26052503");
    expect(orden[2]).toBe("26042811");
  });

  it("no muta el array original", () => {
    const copia = [...filas];
    ordenarLotesSelector(filas, "lote", "asc");
    expect(filas).toEqual(copia);
  });
});

describe("variedadesDisponibles", () => {
  it("únicas y ordenadas", () => {
    expect(variedadesDisponibles(filas)).toEqual([
      "NAR VAL DELTA SEEDLESS",
      "NARANJA VALENCIA DELTA",
      "NARANJA VALENCIA MIDKNIGHT",
    ]);
  });
});

describe("esNotaOperarioLote", () => {
  it("acepta notas reales y rechaza vacío y boilerplate de imports", () => {
    expect(esNotaOperarioLote("Fruta floja, problemas de densidad")).toBe(true);
    expect(esNotaOperarioLote(null)).toBe(false);
    expect(esNotaOperarioLote("  ")).toBe(false);
    expect(esNotaOperarioLote("Import histórico de campaña")).toBe(false);
    expect(esNotaOperarioLote("Import histórico de campaña (agregada de 2 filas duplicadas del Excel, mismo lote y día)")).toBe(false);
    expect(esNotaOperarioLote("Procesado reconstruido desde Informe LOTE (import histórico): kg = suma…")).toBe(false);
  });
});

describe("filtrarLotesSelector — búsqueda por notas", () => {
  it("el texto libre casa contra las notas del operario cuando se pasan", () => {
    const notas = new Map([["26042811", "Fruta con densidad, piel envejecida"]]);
    const res = filtrarLotesSelector(filas, { texto: "densidad", estado: "todos", variedad: "" }, notas);
    expect(res.map((f) => f.lote)).toEqual(["26042811"]);
    // sin mapa de notas, ese texto no casa con nada
    expect(filtrarLotesSelector(filas, { texto: "densidad", estado: "todos", variedad: "" })).toHaveLength(0);
  });
});

describe("ordenarLotesSelector — % industria", () => {
  it("ordena por el mapa de % industria (sin dato = 0)", () => {
    const pct = new Map([["26051309", 0.22], ["26052503", 0.05]]);
    const orden = ordenarLotesSelector(filas, "pct_industria", "desc", pct).map((f) => f.lote);
    expect(orden).toEqual(["26051309", "26052503", "26042811"]);
  });
});

describe("desplazarFecha", () => {
  it("suma y resta días cruzando meses", () => {
    expect(desplazarFecha("2026-07-10", 1)).toBe("2026-07-11");
    expect(desplazarFecha("2026-07-01", -1)).toBe("2026-06-30");
    expect(desplazarFecha("2026-12-31", 1)).toBe("2027-01-01");
  });
});

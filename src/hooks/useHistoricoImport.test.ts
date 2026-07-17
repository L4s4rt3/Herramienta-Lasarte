import { describe, expect, it } from "vitest";
import { agruparFilasProduccionPorFechaLote, claveLoteDedup, planImportInformesLote, type ArchivoInformeLote } from "./useHistoricoImport";
import type { FilaInformeProduccion } from "@/lib/historicoProduccion";
import type { InformeLote } from "@/lib/informeLote";

// Fila mínima con solo lo necesario para el test dado (el resto a null).
function fila(overrides: Partial<FilaInformeProduccion> & { lote_codigo: string; fecha: string; kg: number }): FilaInformeProduccion {
  return {
    productor: null,
    productor_codigo: null,
    producto: null,
    toneladas_hora: null,
    duracion_min: null,
    ...overrides,
  };
}

describe("claveLoteDedup", () => {
  it("usa el primer grupo de 8 dígitos (misma convención A que normalizarLoteCodigo)", () => {
    expect(claveLoteDedup("26050101")).toBe("26050101");
    expect(claveLoteDedup("26050101- 26050104")).toBe("26050101"); // primer grupo, no el segundo
    expect(claveLoteDedup("25110707+25110606")).toBe("25110707");
  });

  it("sin 8 dígitos reconocibles, usa el texto crudo recortado con prefijo raw:", () => {
    expect(claveLoteDedup("PREC DIA 08/11/25")).toBe("raw:PREC DIA 08/11/25");
    expect(claveLoteDedup("  PREC DIA 08/11/25  ")).toBe("raw:PREC DIA 08/11/25"); // trim
  });

  it("null/undefined no rompe: cae al texto vacío", () => {
    expect(claveLoteDedup(null)).toBe("raw:");
    expect(claveLoteDedup(undefined)).toBe("raw:");
  });
});

describe("agruparFilasProduccionPorFechaLote", () => {
  it("dos filas reales del mismo lote el mismo día se agregan en UNA fila con kg sumado (evidencia: el mismo lote puede tener legítimamente dos pasadas el mismo día)", () => {
    const filas = [
      fila({ lote_codigo: "26050101", fecha: "2026-05-06", kg: 600, producto: "NAVELINA", productor: "TORRE DEL JUDIO" }),
      fila({ lote_codigo: "26050101", fecha: "2026-05-06", kg: 400, producto: "NAVELINA", productor: "TORRE DEL JUDIO" }),
    ];
    const agregadas = agruparFilasProduccionPorFechaLote(filas);

    expect(agregadas).toHaveLength(1);
    expect(agregadas[0].kg).toBe(1000);
    expect(agregadas[0].nFilasOriginales).toBe(2);
    expect(agregadas[0].fecha).toBe("2026-05-06");
    expect(agregadas[0].clave).toBe("26050101");
  });

  it("mismo lote en DÍAS distintos no se agrega: cada (fecha, lote) es un grupo independiente", () => {
    const filas = [
      fila({ lote_codigo: "26050101", fecha: "2026-05-06", kg: 600 }),
      fila({ lote_codigo: "26050101", fecha: "2026-05-11", kg: 400 }),
    ];
    const agregadas = agruparFilasProduccionPorFechaLote(filas);

    expect(agregadas).toHaveLength(2);
    expect(agregadas.map((f) => f.kg).sort()).toEqual([400, 600]);
  });

  it("lotes distintos el mismo día no se agregan", () => {
    const filas = [
      fila({ lote_codigo: "26050101", fecha: "2026-05-06", kg: 600 }),
      fila({ lote_codigo: "26050102", fecha: "2026-05-06", kg: 400 }),
    ];
    const agregadas = agruparFilasProduccionPorFechaLote(filas);
    expect(agregadas).toHaveLength(2);
  });

  it("duracion_min se suma solo si TODAS las filas del grupo la traen; si falta en alguna, el total queda null (no un 0 parcial)", () => {
    const conAmbas = agruparFilasProduccionPorFechaLote([
      fila({ lote_codigo: "26050101", fecha: "2026-05-06", kg: 600, duracion_min: 30 }),
      fila({ lote_codigo: "26050101", fecha: "2026-05-06", kg: 400, duracion_min: 20 }),
    ]);
    expect(conAmbas[0].duracion_min).toBe(50);

    const conUnaFaltante = agruparFilasProduccionPorFechaLote([
      fila({ lote_codigo: "26050101", fecha: "2026-05-06", kg: 600, duracion_min: 30 }),
      fila({ lote_codigo: "26050101", fecha: "2026-05-06", kg: 400, duracion_min: null }),
    ]);
    expect(conUnaFaltante[0].duracion_min).toBeNull();
  });

  it("producto/productor/toneladas_hora representativos: de la PRIMERA fila del grupo, en el orden de entrada", () => {
    const agregadas = agruparFilasProduccionPorFechaLote([
      fila({ lote_codigo: "26050101", fecha: "2026-05-06", kg: 600, producto: "NAVELINA", productor: "TORRE DEL JUDIO", toneladas_hora: 3.2 }),
      fila({ lote_codigo: "26050101", fecha: "2026-05-06", kg: 400, producto: "OTRO", productor: "OTRO PRODUCTOR", toneladas_hora: 5 }),
    ]);
    expect(agregadas[0].producto).toBe("NAVELINA");
    expect(agregadas[0].productor).toBe("TORRE DEL JUDIO");
    expect(agregadas[0].toneladas_hora).toBe(3.2);
  });

  it("una fila sin código de 8 dígitos (PRECALIBRADO sin lote reconocible) no se agrega con otras: su clave es el texto crudo completo", () => {
    const agregadas = agruparFilasProduccionPorFechaLote([
      fila({ lote_codigo: "PREC DIA 08/11/25", fecha: "2026-05-06", kg: 100 }),
      fila({ lote_codigo: "PREC DIA 09/11/25", fecha: "2026-05-06", kg: 200 }),
    ]);
    expect(agregadas).toHaveLength(2);
  });
});

// ─── planImportInformesLote (Informe LOTE del calibrador) ───────────────────

/** Informe mínimo con solo lo necesario para el test dado. */
function informe(overrides: Partial<InformeLote> & { loteCodigo: string; fechaComienzo: string | null }): InformeLote {
  const kgTotal = overrides.kgTotal ?? 100;
  return {
    loteCodigoNormalizado: overrides.loteCodigo.match(/\d{8}/)?.[0] ?? null,
    productorNombre: "INVERMARMELO",
    productorCodigo: "71",
    variedad: "VALENCIA DELTA",
    toneladasHora: null,
    pesoFrutaPromedioG: null,
    duracionLoteMin: null,
    kgTotal,
    kgPodrido: 0,
    clasificacion: [{
      producto: "INDUSTRIA", calidad: "1", clase: "(I) Industria", grupoDestino: null,
      tamano: "(01) CITRICA", piezas: null, pctPiezas: null, pesoKg: kgTotal, pctPeso: null, cartons: null, pctCartons: null,
    }],
    ...overrides,
  };
}

function archivo(fileName: string, inf: InformeLote): ArchivoInformeLote {
  return { fileName, informe: inf };
}

const mapa = (entries: Array<[string, string[]]>) => new Map(entries.map(([f, cs]) => [f, new Set(cs)] as const));

describe("planImportInformesLote — dedup por (fecha, lote) e independencia clasificación/lotes_dia", () => {
  it("lote sin nada previo: inserta clasificación Y repara lotes_dia (expedido-sin-procesado)", () => {
    const plan = planImportInformesLote(
      [archivo("Informe 26043013.xlsx", informe({ loteCodigo: "26043013", fechaComienzo: "2026-07-15", kgTotal: 23802.5, kgPodrido: 256.73 }))],
      new Map(), new Map(),
    );
    expect(plan.items).toHaveLength(1);
    expect(plan.items[0]).toMatchObject({ clave: "26043013", fecha: "2026-07-15", insertaClasificacion: true, reparaLotesDia: true });
    expect(plan.nReparaciones).toBe(1);
    expect(plan.kgReparados).toBeCloseTo(23802.5);
    expect(plan.kgPodridoRealNuevo).toBeCloseTo(256.73);
  });

  it("con lotes_dia ya existente para esa (fecha, lote) NO se toca lotes_dia (no duplicar kg), pero SÍ se inserta la clasificación", () => {
    const plan = planImportInformesLote(
      [archivo("a.xlsx", informe({ loteCodigo: "26043013", fechaComienzo: "2026-07-15" }))],
      new Map(),
      mapa([["2026-07-15", ["26043013"]]]),
    );
    expect(plan.items[0]).toMatchObject({ insertaClasificacion: true, reparaLotesDia: false });
    expect(plan.kgReparados).toBe(0);
  });

  it("con clasificación ya existente para esa (fecha, lote) se salta la clasificación ('ya tenía informe'), aunque el mismo lote tenga informe de OTRA fecha", () => {
    const clasifExistente = mapa([["2026-07-15", ["26043013"]]]);
    const mismaFecha = planImportInformesLote(
      [archivo("a.xlsx", informe({ loteCodigo: "26043013", fechaComienzo: "2026-07-15" }))],
      clasifExistente, mapa([["2026-07-15", ["26043013"]]]),
    );
    expect(mismaFecha.items[0].insertaClasificacion).toBe(false);
    expect(mismaFecha.nYaTenianInforme).toBe(1);

    // Una pasada del MISMO lote en OTRO día es OTRO informe: sí se inserta.
    const otraFecha = planImportInformesLote(
      [archivo("b.xlsx", informe({ loteCodigo: "26043013", fechaComienzo: "2026-07-16" }))],
      clasifExistente, new Map(),
    );
    expect(otraFecha.items[0].insertaClasificacion).toBe(true);
  });

  it("dos informes de la misma (fecha, lote) en la MISMA tanda: el segundo se trata como 'ya tenía' (idempotencia dentro de la tanda)", () => {
    const inf = informe({ loteCodigo: "26042912+26042911", fechaComienzo: "2026-07-15", kgTotal: 10.7 });
    const plan = planImportInformesLote([archivo("a.xlsx", inf), archivo("a (copia).xlsx", inf)], new Map(), new Map());
    expect(plan.items[0]).toMatchObject({ clave: "26042912", insertaClasificacion: true, reparaLotesDia: true });
    expect(plan.items[1]).toMatchObject({ insertaClasificacion: false, reparaLotesDia: false });
    expect(plan.nClasificacionesNuevas).toBe(1);
    expect(plan.kgReparados).toBeCloseTo(10.7);
  });

  it("descarta con motivo los informes sin fecha o sin filas con kg", () => {
    const plan = planImportInformesLote(
      [
        archivo("sin-fecha.xlsx", informe({ loteCodigo: "26043013", fechaComienzo: null })),
        archivo("vacio.xlsx", informe({ loteCodigo: "26043014", fechaComienzo: "2026-07-15", kgTotal: 0, clasificacion: [] })),
      ],
      new Map(), new Map(),
    );
    expect(plan.items).toHaveLength(0);
    expect(plan.descartados).toHaveLength(2);
    expect(plan.descartados[0].motivo).toMatch(/Fecha/);
    expect(plan.descartados[1].motivo).toMatch(/clasificación/);
  });

  it("no muta los mapas de entrada (la preview usa la cache de React Query)", () => {
    const clasif = mapa([["2026-07-15", ["11111111"]]]);
    const lotes = new Map<string, Set<string>>();
    planImportInformesLote([archivo("a.xlsx", informe({ loteCodigo: "26043013", fechaComienzo: "2026-07-15" }))], clasif, lotes);
    expect(clasif.get("2026-07-15")!.has("26043013")).toBe(false);
    expect(lotes.size).toBe(0);
  });
});

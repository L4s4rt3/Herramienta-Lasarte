import { describe, expect, it } from "vitest";
import { agruparFilasProduccionPorFechaLote, claveLoteDedup } from "./useHistoricoImport";
import type { FilaInformeProduccion } from "@/lib/historicoProduccion";

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

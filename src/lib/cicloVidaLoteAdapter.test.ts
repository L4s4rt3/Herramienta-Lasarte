import { describe, expect, it } from "vitest";
import {
  compararConMotorViejo,
  construirCicloVidaCampana,
  type ConstruirInputEventosParams,
  type EntradaParaEventos,
} from "@/lib/cicloVidaLoteAdapter";
import type { LoteCiclo } from "@/lib/cicloVidaLote";
import type { StockLoteRow } from "@/lib/entradasBascula";

function entrada(over: Partial<EntradaParaEventos> & { lote: string; kg_entrada: number }): EntradaParaEventos {
  return {
    fecha: "2026-05-01",
    finca: "Finca A",
    articulo: "NAR VAL DELTA",
    agricultor: "Agricultor A",
    kg_ajuste_stock: 0,
    ...over,
  };
}

const baseParams: Omit<ConstruirInputEventosParams, "entradas" | "entradasConciliacionReales" | "entradasConciliacionPrecalibrado" | "pasadas" | "anotaciones"> = {
  reciclajePorDia: [],
  camionesCamaraExterna: [],
  lotesConfirmadosEnCamara: new Set(),
  senalesCamaraExterna: { salidaPorLote: new Map(), lotesProcesados: new Set() },
  hoy: "2026-05-10",
};

describe("construirCicloVidaCampana", () => {
  it("caso 26042313-like: una foto de stock negativa que anula una pasada propia sale como contradicción visible", () => {
    const real = entrada({ lote: "26042313", kg_entrada: 20000, kg_ajuste_stock: -18000 });
    const { ciclo } = construirCicloVidaCampana({
      ...baseParams,
      entradas: [real],
      entradasConciliacionReales: [real],
      entradasConciliacionPrecalibrado: [],
      pasadas: [{ id: "p1", lote_codigo: "26042313", kg_peso_total: 19000, date: "2026-05-02" }],
      anotaciones: [],
    });
    const lote = ciclo.find((c) => c.lote === "26042313")!;
    expect(lote).toBeDefined();
    expect(lote.contradicciones.some((c) => c.tipo === "pasada_vs_foto_stock")).toBe(true);
  });

  it("un lote nombrado y cerrado sale 'cerrado' con evidencia dura completa", () => {
    const real = entrada({ lote: "26050101", kg_entrada: 1000, cerrado_at: "2026-05-06T10:00:00Z", cierre_modo: "con_analisis" });
    const { ciclo } = construirCicloVidaCampana({
      ...baseParams,
      entradas: [real],
      entradasConciliacionReales: [real],
      entradasConciliacionPrecalibrado: [],
      pasadas: [{ id: "p1", lote_codigo: "26050101", kg_peso_total: 980, date: "2026-05-05" }],
      anotaciones: [],
    });
    const lote = ciclo.find((c) => c.lote === "26050101")!;
    expect(lote.estado).toBe("cerrado");
    expect(lote.pctConEvidenciaDura).toBe(1);
  });
});

describe("compararConMotorViejo", () => {
  const cicloBase: LoteCiclo = {
    lote: "26050101",
    fechaEntrada: "2026-05-01",
    kgEntrada: 1000,
    esPrecalibrado: false,
    esCampoCit: false,
    estado: "sin_evidencia_suficiente",
    kgPorClase: { nombrado: 0, anotado: 0, medido: 0, derivado: 1000, sinRastro: 0 },
    pctConEvidenciaDura: 0,
    destino: "Sin evidencia suficiente (solo derrame — regla de oro)",
    contradicciones: [{ tipo: "exceso_sin_dueno", kgDerivado: 1000, detalle: "El cierre de este lote solo se explica por un derrame de exceso." }],
    diasEnCamara: 9,
  };

  it("sin fila del motor viejo (lote fuera del stock): no hay nada que comparar", () => {
    expect(compararConMotorViejo(null, cicloBase)).toBeNull();
  });

  it("ambos motores de acuerdo (los dos 'sin resolver'): no hay discrepancia", () => {
    const fila = { cerrado_at: null, estado: "parcial" } as StockLoteRow;
    expect(compararConMotorViejo(fila, cicloBase)).toBeNull();
  });

  it("caso real del encargo: viejo 'procesado' (vía derrame), nuevo 'sin evidencia suficiente' — discrepan y la nota lo explica", () => {
    const fila = { cerrado_at: null, estado: "procesado" } as StockLoteRow;
    const resultado = compararConMotorViejo(fila, cicloBase);
    expect(resultado).not.toBeNull();
    expect(resultado!.estadoViejo).toBe("procesado");
    expect(resultado!.estadoNuevo).toBe("sin_evidencia_suficiente");
    expect(resultado!.nota).toContain("derrame de exceso");
    expect(resultado!.nota).toContain("sin resolver");
  });

  it("viejo cerrado a mano, nuevo también resuelto (completo_pendiente_cierre): sin discrepancia aunque los estados no sean idénticos", () => {
    const fila = { cerrado_at: "2026-05-08", estado: "procesado" } as StockLoteRow;
    const cicloCompleto: LoteCiclo = { ...cicloBase, estado: "completo_pendiente_cierre", contradicciones: [] };
    expect(compararConMotorViejo(fila, cicloCompleto)).toBeNull();
  });
});

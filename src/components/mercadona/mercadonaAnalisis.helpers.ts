// src/components/mercadona/mercadonaAnalisis.helpers.ts
// Logica pura (sin JSX/React) para la pestaña "Analisis" de Mercadona:
// cumplimiento historico, tendencias de mix de metodos y deltas semana a semana.
// Se extrae aqui para poder testear con vitest sin montar componentes.
import type { MercadonaMetodoRow, MercadonaSemanaConMetodos } from "@/hooks/useMercadonaVentas";

// ─── Cumplimiento historico ───────────────────────────────────────────────────

export interface CumplimientoPunto {
  id: string;
  anio: number;
  semana: number;
  label: string;
  pct: number;
}

/** Solo semanas con planificado > 0 (division por cero => se excluyen). */
export function buildCumplimientoSerie(semanas: MercadonaSemanaConMetodos[]): CumplimientoPunto[] {
  return semanas
    .filter((s) => (s.planificado_semana_kg ?? 0) > 0)
    .map((s) => ({
      id: s.id,
      anio: s.anio,
      semana: s.semana,
      label: `S${s.semana}`,
      pct: ((s.vendido_kg ?? 0) / (s.planificado_semana_kg as number)) * 100,
    }));
}

export interface CumplimientoResumen {
  media: number;
  mejor: CumplimientoPunto | null;
  peor: CumplimientoPunto | null;
}

export function resumenCumplimiento(serie: CumplimientoPunto[]): CumplimientoResumen {
  if (serie.length === 0) return { media: 0, mejor: null, peor: null };
  const media = serie.reduce((sum, p) => sum + p.pct, 0) / serie.length;
  const mejor = serie.reduce((best, p) => (p.pct > best.pct ? p : best), serie[0]);
  const peor = serie.reduce((worst, p) => (p.pct < worst.pct ? p : worst), serie[0]);
  return { media, mejor, peor };
}

// ─── Mix de metodos ────────────────────────────────────────────────────────────

export const METODOS_ORDEN = ["MA12KGC", "MA3KGC", "MA4KGC", "MA5KGC"] as const;

/** Nombres cortos para leyendas/chips, consistentes con los formatos reales de Mercadona. */
export const METODO_LABELS: Record<string, string> = {
  MA12KGC: "Granel 12 kg",
  MA3KGC: "Pack 3 kg",
  MA4KGC: "Girsac 4 kg",
  MA5KGC: "Pack 5 kg",
};

export function metodoLabel(metodo: string): string {
  return METODO_LABELS[metodo.toUpperCase()] ?? metodo;
}

export interface MixPunto {
  id: string;
  label: string;
  [metodo: string]: string | number;
}

/** Serie apilable: un punto por semana con un campo numerico por cada metodo conocido. */
export function buildMixSerie(semanas: MercadonaSemanaConMetodos[]): MixPunto[] {
  return semanas.map((s) => {
    const punto: MixPunto = { id: s.id, label: `S${s.semana}` };
    for (const metodo of METODOS_ORDEN) {
      const row = s.metodos.find((m) => m.metodo.toUpperCase() === metodo);
      punto[metodo] = row?.kilos ?? 0;
    }
    return punto;
  });
}

export interface TendenciaMetodo {
  metodo: string;
  label: string;
  mediaReciente: number;
  mediaPrevia: number;
  variacionPct: number | null;
  direccion: "up" | "down" | "flat";
}

/**
 * Compara la media de las ultimas 2 semanas vs las 2 anteriores a esas, por metodo.
 * Devuelve null si hay menos de 4 semanas en total (llamador decide si ocultar).
 */
export function tendenciasMetodos(semanas: MercadonaSemanaConMetodos[]): TendenciaMetodo[] | null {
  if (semanas.length < 4) return null;

  const n = semanas.length;
  const recientes = semanas.slice(n - 2);
  const previas = semanas.slice(n - 4, n - 2);

  const kgPorMetodo = (grupo: MercadonaSemanaConMetodos[], metodo: string): number => {
    const valores = grupo.map((s) => {
      const row = s.metodos.find((m) => m.metodo.toUpperCase() === metodo);
      return row?.kilos ?? 0;
    });
    return valores.reduce((sum, v) => sum + v, 0) / valores.length;
  };

  return METODOS_ORDEN.map((metodo) => {
    const mediaReciente = kgPorMetodo(recientes, metodo);
    const mediaPrevia = kgPorMetodo(previas, metodo);
    const variacionPct = mediaPrevia > 0 ? ((mediaReciente - mediaPrevia) / mediaPrevia) * 100 : null;
    const direccion: "up" | "down" | "flat" =
      variacionPct == null || Math.abs(variacionPct) < 0.5 ? "flat" : variacionPct > 0 ? "up" : "down";
    return { metodo, label: metodoLabel(metodo), mediaReciente, mediaPrevia, variacionPct, direccion };
  });
}

// ─── Comparativa semana a semana ──────────────────────────────────────────────

export interface ComparativaMetodoRow {
  metodo: string;
  label: string;
  kgActual: number;
  kgAnterior: number;
  deltaKg: number;
  deltaPct: number | null;
  palets: number;
  cajas: number;
}

export interface ComparativaSemanas {
  filas: ComparativaMetodoRow[];
  total: ComparativaMetodoRow;
}

function metodoRowOrZero(metodos: MercadonaMetodoRow[], metodo: string): MercadonaMetodoRow | null {
  return metodos.find((m) => m.metodo.toUpperCase() === metodo) ?? null;
}

/** Tabla metodo a metodo: semana seleccionada vs la semana inmediatamente anterior en la lista (puede ser null). */
export function buildComparativaSemanas(
  actual: MercadonaSemanaConMetodos,
  anterior: MercadonaSemanaConMetodos | null,
): ComparativaSemanas {
  const filas: ComparativaMetodoRow[] = METODOS_ORDEN.map((metodo) => {
    const rowActual = metodoRowOrZero(actual.metodos, metodo);
    const rowAnterior = anterior ? metodoRowOrZero(anterior.metodos, metodo) : null;
    const kgActual = rowActual?.kilos ?? 0;
    const kgAnterior = rowAnterior?.kilos ?? 0;
    const deltaKg = kgActual - kgAnterior;
    const deltaPct = kgAnterior > 0 ? (deltaKg / kgAnterior) * 100 : null;
    return {
      metodo,
      label: metodoLabel(metodo),
      kgActual,
      kgAnterior,
      deltaKg,
      deltaPct,
      palets: rowActual?.palets ?? 0,
      cajas: rowActual?.cajas ?? 0,
    };
  });

  const total: ComparativaMetodoRow = filas.reduce(
    (acc, f) => ({
      metodo: "TOTAL",
      label: "Total",
      kgActual: acc.kgActual + f.kgActual,
      kgAnterior: acc.kgAnterior + f.kgAnterior,
      deltaKg: acc.deltaKg + f.deltaKg,
      deltaPct: null,
      palets: acc.palets + f.palets,
      cajas: acc.cajas + f.cajas,
    }),
    { metodo: "TOTAL", label: "Total", kgActual: 0, kgAnterior: 0, deltaKg: 0, deltaPct: null, palets: 0, cajas: 0 } as ComparativaMetodoRow,
  );
  total.deltaPct = total.kgAnterior > 0 ? (total.deltaKg / total.kgAnterior) * 100 : null;

  return { filas, total };
}

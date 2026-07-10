/**
 * useMercadonaAprovechamiento — aprovechamiento REAL y ESTIMADO de Mercadona
 * para una semana Mercadona (L–S).
 *
 * Tres niveles (ver estudio en src/lib/mercadonaAprovechamiento.ts):
 *  - REAL: vendido_kg del informe semanal (mercadona_semanas) sobre los kg de
 *    entrada al calibrador de la misma semana. Exacto, pero solo existe
 *    cuando la semana tiene informe importado.
 *  - ESTIMADO: kg de palets con perfil Mercadona (regla esPaletMercadona)
 *    sobre el calibrador. Disponible al día, error histórico ±3%.
 *  - La confección MDNA (useMercadona.pct_kg) queda como métrica de fábrica,
 *    NO de venta: sobrestima el vendido ~15%.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { mercadonaWeekDateRange } from "@/lib/mercadonaVentas";
import { kgMercadonaEstimado, type PaletAprovechamiento } from "@/lib/mercadonaAprovechamiento";

const IN_CHUNK_SIZE = 200;

export interface MercadonaAprovechamientoSemana {
  /** Kg de entrada al calibrador de la semana (L–S). Denominador de ambos %. */
  kgCalibrador: number;
  /** Kg vendidos según el informe semanal de Mercadona; null si aún no hay informe. */
  vendidoKg: number | null;
  /** Kg estimados por la regla de palets (cliente Mercadona + sin cliente con perfil Mercadona). */
  estimadoKg: number;
  /** vendido / calibrador; null sin informe. */
  realPct: number | null;
  /** estimado / calibrador. */
  estimadoPct: number;
  /** estimado / vendido (fiabilidad del estimador); null sin informe. */
  fiabilidadPct: number | null;
}

async function fetchPaletsInChunks(partIds: string[]): Promise<PaletAprovechamiento[]> {
  const rows: PaletAprovechamiento[] = [];
  for (let i = 0; i < partIds.length; i += IN_CHUNK_SIZE) {
    const chunk = partIds.slice(i, i + IN_CHUNK_SIZE);
    const { data, error } = await supabase
      .from("palets_dia")
      .select("cliente, producto, kg_neto")
      .in("part_id", chunk)
      .limit(100000);
    if (error) throw error;
    rows.push(...((data ?? []) as PaletAprovechamiento[]));
  }
  return rows;
}

export function useMercadonaAprovechamiento(anio: number, semana: number) {
  const rango = mercadonaWeekDateRange(anio, semana);

  const query = useQuery({
    queryKey: ["mercadona-aprovechamiento-real", anio, semana],
    queryFn: async () => {
      const { data: partes, error: partesError } = await supabase
        .from("partes_diarios")
        .select("id, kg_produccion_calibrador")
        .gte("date", rango.desde)
        .lte("date", rango.hasta);
      if (partesError) throw partesError;

      const kgCalibrador = (partes ?? []).reduce(
        (s, p) => s + (Number(p.kg_produccion_calibrador) || 0),
        0,
      );

      const partIds = (partes ?? []).map((p) => p.id as string);
      const palets = partIds.length > 0 ? await fetchPaletsInChunks(partIds) : [];
      const estimadoKg = kgMercadonaEstimado(palets);

      const { data: semanaRow, error: semanaError } = await supabase
        .from("mercadona_semanas")
        .select("vendido_kg")
        .eq("anio", anio)
        .eq("semana", semana)
        .maybeSingle();
      if (semanaError) throw semanaError;
      const vendidoKg = semanaRow?.vendido_kg != null ? Number(semanaRow.vendido_kg) : null;

      return { kgCalibrador, estimadoKg, vendidoKg };
    },
  });

  const { kgCalibrador = 0, estimadoKg = 0, vendidoKg = null } = query.data ?? {};

  const resumen: MercadonaAprovechamientoSemana = {
    kgCalibrador,
    vendidoKg,
    estimadoKg,
    realPct: vendidoKg != null && kgCalibrador > 0 ? (vendidoKg / kgCalibrador) * 100 : null,
    estimadoPct: kgCalibrador > 0 ? (estimadoKg / kgCalibrador) * 100 : 0,
    fiabilidadPct: vendidoKg != null && vendidoKg > 0 ? (estimadoKg / vendidoKg) * 100 : null,
  };

  return { ...resumen, isLoading: query.isLoading, error: query.error };
}

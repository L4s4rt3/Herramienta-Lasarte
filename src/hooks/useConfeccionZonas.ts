/**
 * useConfeccionZonas — filas del informe de producto (producto_dia) de toda la
 * campaña con su fecha, listas para agregar por zona de confección
 * (Mallas / Granel / Envasado / Industria) en cualquier rango: día, semana,
 * mes o campaña. Ver src/lib/confeccionZonas.ts.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/fetchAllRows";
import { buildPeriodoRange } from "@/lib/consumoPeriodoView";
import type { ConfeccionZonaRow } from "@/lib/confeccionZonas";

const IN_CHUNK_SIZE = 200;

interface ProductoDiaDbRow {
  part_id: string;
  producto: string | null;
  formato_caja: string | null;
  grupo_destino: string | null;
  linea: string | null;
  kg: number | null;
}

// producto_dia: cada chunk de 200 partes puede devolver por sí solo más de
// 1.000 filas (varias líneas por día), sobre todo pidiendo toda la campaña.
// El .limit(100000) no protegía nada, PostgREST recorta a su max-rows en
// silencio. Se pagina cada chunk con fetchAllRows.
async function fetchProductoDiaInChunks(partIds: string[]): Promise<ProductoDiaDbRow[]> {
  const rows: ProductoDiaDbRow[] = [];
  for (let i = 0; i < partIds.length; i += IN_CHUNK_SIZE) {
    const chunk = partIds.slice(i, i + IN_CHUNK_SIZE);
    const chunkRows = await fetchAllRows<ProductoDiaDbRow>((from, to) =>
      supabase
        .from("producto_dia")
        .select("part_id, producto, formato_caja, grupo_destino, linea, kg")
        .in("part_id", chunk)
        .order("id")
        .range(from, to),
    );
    rows.push(...chunkRows);
  }
  return rows;
}

export function useConfeccionZonas() {
  const campana = buildPeriodoRange("campana", 0);

  const query = useQuery({
    queryKey: ["confeccion-zonas", campana.start, campana.end],
    queryFn: async (): Promise<ConfeccionZonaRow[]> => {
      // Rango de "toda la campaña": partes_diarios va camino de las 1.000
      // filas (creciendo), se pagina por seguridad de cara al futuro.
      const partes = await fetchAllRows<{ id: string; date: string }>((from, to) =>
        supabase.from("partes_diarios").select("id, date").gte("date", campana.start).lte("date", campana.end).order("id").range(from, to),
      );
      if (partes.length === 0) return [];

      const dateById = new Map(partes.map((p) => [p.id, p.date]));
      const productos = await fetchProductoDiaInChunks(Array.from(dateById.keys()));

      return productos
        .map((p) => ({
          date: dateById.get(p.part_id) ?? "",
          producto: p.producto,
          formato_caja: p.formato_caja,
          grupo_destino: p.grupo_destino,
          linea: p.linea,
          kg: p.kg,
        }))
        .filter((p) => p.date !== "");
    },
  });

  const rows = query.data ?? [];
  const ultimoDia = rows.reduce<string | null>(
    (max, r) => (max === null || r.date > max ? r.date : max),
    null,
  );

  return { rows, ultimoDia, campana, isLoading: query.isLoading, error: query.error };
}

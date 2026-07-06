/**
 * useMercadona — aprovechamiento de Mercadona sobre los kg confeccionados.
 *
 * Fuente: producto_dia (informe de confección por línea), no palets_dia.
 * No existe vínculo palet → lote, así que el análisis es por día/semana:
 * se cargan los partes del rango (id, date) y luego los producto_dia de esos
 * part_id, agregando los productos cuyo nombre contiene "MDNA" por formato
 * (peso en kg o granel).
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

const IN_CHUNK_SIZE = 200;

export interface MercadonaFormato {
  formato: string;
  kg: number;
  n_cajas: number;
  pct: number;
  productos: string[];
}

export interface MercadonaDia {
  date: string;
  kg_mercadona: number;
  kg_total: number;
  pct: number;
}

export interface MercadonaResumen {
  kg_mercadona: number;
  n_cajas_mercadona: number;
  kg_total: number;
  pct_kg: number;
  por_formato: MercadonaFormato[];
  por_dia: MercadonaDia[];
}

interface ProductoDiaRow {
  part_id: string;
  producto: string | null;
  kg: number;
  n_cajas: number | null;
}

/** Normaliza el nombre crudo de producto MDNA a un formato agrupable. */
export function normalizarFormatoMdna(producto: string): string {
  const upper = producto.toUpperCase();
  if (upper.includes("GRANEL")) return "MDNA Granel";
  const match = upper.match(/(\d+)\s*K(G)?\b/i);
  if (match) return `MDNA ${match[1]} kg`;
  return "MDNA otros";
}

async function fetchInChunks(ids: string[]): Promise<ProductoDiaRow[]> {
  const rows: ProductoDiaRow[] = [];
  for (let i = 0; i < ids.length; i += IN_CHUNK_SIZE) {
    const chunk = ids.slice(i, i + IN_CHUNK_SIZE);
    const { data, error } = await supabase
      .from("producto_dia")
      .select("part_id, producto, kg, n_cajas")
      .in("part_id", chunk)
      .limit(100000);

    if (error) throw error;
    rows.push(...((data ?? []) as ProductoDiaRow[]));
  }
  return rows;
}

export function useMercadona(desde: string, hasta: string) {
  const query = useQuery({
    queryKey: ["mercadona-aprovechamiento", desde, hasta],
    queryFn: async (): Promise<{ productos: ProductoDiaRow[]; partesById: Map<string, string> }> => {
      const { data: partesIds, error: partesError } = await supabase
        .from("partes_diarios")
        .select("id, date")
        .gte("date", desde)
        .lte("date", hasta);

      if (partesError) throw partesError;
      if (!partesIds || partesIds.length === 0) {
        return { productos: [], partesById: new Map() };
      }

      const partesById = new Map(partesIds.map((p) => [p.id as string, p.date as string]));
      const ids = Array.from(partesById.keys());
      const productos = await fetchInChunks(ids);

      return { productos, partesById };
    },
  });

  const resumen = useMemo<MercadonaResumen>(() => {
    const { productos: productosRaw, partesById } = query.data ?? { productos: [], partesById: new Map<string, string>() };

    // El informe de producto incluye una fila TOTAL por día con producto vacío/null
    // (duplica el kg del día). Se excluye de todos los cálculos.
    const productos = productosRaw.filter((p) => (p.producto ?? "").trim() !== "");

    const kg_total = productos.reduce((s, p) => s + (Number(p.kg) || 0), 0);

    const mdnaProductos = productos.filter((p) => (p.producto ?? "").toUpperCase().includes("MDNA"));
    const kg_mercadona = mdnaProductos.reduce((s, p) => s + (Number(p.kg) || 0), 0);
    const n_cajas_mercadona = mdnaProductos.reduce((s, p) => s + (Number(p.n_cajas) || 0), 0);
    const pct_kg = kg_total > 0 ? (kg_mercadona / kg_total) * 100 : 0;

    const porFormatoMap = new Map<string, { kg: number; n_cajas: number; productos: Set<string> }>();
    for (const p of mdnaProductos) {
      const nombreCrudo = p.producto?.trim() || "Sin producto";
      const formato = normalizarFormatoMdna(nombreCrudo);
      const entry = porFormatoMap.get(formato) ?? { kg: 0, n_cajas: 0, productos: new Set<string>() };
      entry.kg += Number(p.kg) || 0;
      entry.n_cajas += Number(p.n_cajas) || 0;
      entry.productos.add(nombreCrudo);
      porFormatoMap.set(formato, entry);
    }
    const por_formato: MercadonaFormato[] = Array.from(porFormatoMap.entries())
      .map(([formato, v]) => ({
        formato,
        kg: v.kg,
        n_cajas: v.n_cajas,
        pct: kg_mercadona > 0 ? (v.kg / kg_mercadona) * 100 : 0,
        productos: Array.from(v.productos),
      }))
      .sort((a, b) => b.kg - a.kg);

    const porDiaMap = new Map<string, { kg_mercadona: number; kg_total: number }>();
    for (const p of productos) {
      const date = partesById.get(p.part_id);
      if (!date) continue;
      const entry = porDiaMap.get(date) ?? { kg_mercadona: 0, kg_total: 0 };
      entry.kg_total += Number(p.kg) || 0;
      if ((p.producto ?? "").toUpperCase().includes("MDNA")) {
        entry.kg_mercadona += Number(p.kg) || 0;
      }
      porDiaMap.set(date, entry);
    }
    const por_dia: MercadonaDia[] = Array.from(porDiaMap.entries())
      .map(([date, v]) => ({
        date,
        kg_mercadona: v.kg_mercadona,
        kg_total: v.kg_total,
        pct: v.kg_total > 0 ? (v.kg_mercadona / v.kg_total) * 100 : 0,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    return { kg_mercadona, n_cajas_mercadona, kg_total, pct_kg, por_formato, por_dia };
  }, [query.data]);

  return {
    ...resumen,
    isLoading: query.isLoading,
    error: query.error,
  };
}

/**
 * usePartes — hook centralizado para partes_diarios.
 *
 * - Carga todos los partes con sus cascadas ya computadas.
 * - Suscripción realtime: cualquier cambio en la tabla actualiza el estado.
 * - Expone helpers de filtrado y totales para PartesList y Dashboard.
 */
import { useEffect, useMemo } from "react";
import { QueryClient, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { computeCascade, CascadeResult } from "@/lib/cascade";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthProvider";

// ─── Tipos ──────────────────────────────────────────────────────────────────

export interface ParteRaw {
  id: string;
  date: string;
  estado: string;
  created_at: string;
  kg_produccion_calibrador: number | null;
  kg_mujeres_calibrador: number | null;
  kg_palets_brutos: number | null;
  kg_palets_egipto: number | null;
  kg_palets_campo: number | null;
  kg_podrido_calibrador_auto: number | null;
  kg_industria_manual: number | null;
  kg_reciclado_malla_z1: number | null;
  kg_reciclado_malla_z2: number | null;
  kg_inventario_sin_alta: number | null;
  kg_podrido_bolsa_basura: number | null;
  kg_inventario_anterior_sin_alta: number | null;
  notas_generales: string | null;
  notas_inventario: string | null;
  resumen_ia: any;
}

export interface Parte extends ParteRaw {
  /** Cascada DJPMN pre-calculada */
  cascade: CascadeResult;
}

export type EstadoFiltro = "todos" | "Analizado" | "Borrador";

export interface PartesFilter {
  search: string;           // busca en fecha (string)
  estado: EstadoFiltro;
  soloAlertas: boolean;     // solo partes con |DJPMN| > 3%
  desde?: string;           // YYYY-MM-DD
  hasta?: string;
}

export interface PartesTotals {
  produccion_real: number;
  palets_ajustados: number;
  dsj: number;
  dsj_pct: number;
  mermas_totales: number;
  n_ok: number;
  n_amarillo: number;
  n_rojo: number;
  kg_exportacion: number;
  kg_mercado: number;
  kg_industria_destino: number;
  kg_perdida_real: number;
}

// ─── Helper ─────────────────────────────────────────────────────────────────

function buildCascade(p: ParteRaw): Parte {
  const cascade = computeCascade({
    kg_produccion_calibrador: Number(p.kg_produccion_calibrador) || 0,
    kg_mujeres_calibrador: Number(p.kg_mujeres_calibrador) || 0,
    kg_palets_brutos: (Number(p.kg_palets_brutos) || 0) - (Number(p.kg_palets_egipto) || 0),
    kg_podrido_calibrador: Number(p.kg_podrido_calibrador_auto) || 0,
    kg_industria_manual: Number(p.kg_industria_manual) || 0,
    kg_reciclado_malla_z1: Number(p.kg_reciclado_malla_z1) || 0,
    kg_reciclado_malla_z2: Number(p.kg_reciclado_malla_z2) || 0,
    kg_inventario_sin_alta: Number(p.kg_inventario_sin_alta) || 0,
    kg_podrido_bolsa_basura: Number(p.kg_podrido_bolsa_basura) || 0,
    kg_inventario_anterior_sin_alta: Number(p.kg_inventario_anterior_sin_alta) || 0,
  });
  return { ...p, cascade };
}

export const PARTES_QUERY_KEY = ["partes"] as const;

export async function fetchPartes(): Promise<Parte[]> {
  const { data, error } = await supabase
    .from("partes_diarios")
    .select("*")
    .order("date", { ascending: false });

  if (error) throw error;
  return ((data ?? []) as ParteRaw[]).map(buildCascade);
}

export const partesQueryOptions = {
  queryKey: PARTES_QUERY_KEY,
  queryFn: fetchPartes,
};

let partesChannel: ReturnType<typeof supabase.channel> | null = null;
let partesSubscribers = 0;

function subscribePartesRealtime(queryClient: QueryClient) {
  partesSubscribers += 1;

  if (!partesChannel) {
    partesChannel = supabase
      .channel("partes_diarios_changes_cache")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "partes_diarios" },
        () => {
          void queryClient.invalidateQueries({ queryKey: PARTES_QUERY_KEY });
        }
      )
      .subscribe();
  }

  return () => {
    partesSubscribers = Math.max(0, partesSubscribers - 1);
    if (partesSubscribers === 0 && partesChannel) {
      void supabase.removeChannel(partesChannel);
      partesChannel = null;
    }
  };
}

// ─── Hook principal ──────────────────────────────────────────────────────────

export function usePartes() {
  const queryClient = useQueryClient();
  const { user, loading: authLoading } = useAuth();
  const canLoadPartes = !authLoading && Boolean(user);
  const query = useQuery({
    ...partesQueryOptions,
    enabled: canLoadPartes,
  });

  useEffect(() => {
    if (!canLoadPartes) return;
    return subscribePartesRealtime(queryClient);

    // Realtime: nombre único para evitar conflictos con múltiples hooks
  }, [canLoadPartes, queryClient]);

  useEffect(() => {
    if (canLoadPartes && query.error instanceof Error && !query.isFetching) {
      toast({ title: "Error cargando partes", description: query.error.message, variant: "destructive" });
    }
  }, [canLoadPartes, query.error, query.isFetching]);

  return { partes: query.data ?? [], loading: authLoading || query.isLoading, refetch: query.refetch };
}

// ─── Hook de partes filtrados (para PartesList) ──────────────────────────────

export function usePartesFiltered(filter: PartesFilter) {
  const { partes, loading, refetch } = usePartes();

  const filtered = useMemo(() => {
    return partes.filter((p) => {
      if (filter.search && !p.date.includes(filter.search)) return false;
      if (filter.estado !== "todos" && p.estado !== filter.estado) return false;
      if (filter.soloAlertas && Math.abs(p.cascade.dsj_pct) <= 5) return false;
      if (filter.desde && p.date < filter.desde) return false;
      if (filter.hasta && p.date > filter.hasta) return false;
      return true;
    });
  }, [partes, filter]);

  const totals = useMemo<PartesTotals>(() => {
    const total_prod = filtered.reduce((s, p) => s + p.cascade.produccion_real, 0);
    const total_dsj  = filtered.reduce((s, p) => s + p.cascade.dsj, 0);
    return {
      produccion_real:  total_prod,
      palets_ajustados: filtered.reduce((s, p) => s + p.cascade.palets_ajustados, 0),
      dsj:              total_dsj,
      dsj_pct:          total_prod ? (total_dsj / total_prod) * 100 : 0,
      mermas_totales:   filtered.reduce((s, p) => s + p.cascade.mermas_totales, 0),
      n_ok:             filtered.filter((p) => p.cascade.semaforo === "verde").length,
      n_amarillo:       filtered.filter((p) => p.cascade.semaforo === "amarillo").length,
      n_rojo:           filtered.filter((p) => p.cascade.semaforo === "rojo").length,
      kg_exportacion:   filtered.reduce((s, p) => s + p.cascade.kg_exportacion, 0),
      kg_mercado:        filtered.reduce((s, p) => s + p.cascade.kg_mercado, 0),
      kg_industria_destino: filtered.reduce((s, p) => s + p.cascade.kg_industria_destino, 0),
      kg_perdida_real:   filtered.reduce((s, p) => s + p.cascade.kg_perdida_real, 0),
    };
  }, [filtered]);

  return { partes: filtered, allPartes: partes, loading, totals, refetch };
}

// ─── Hook ligero para Dashboard (últimos N días) ─────────────────────────────

export function usePartesDashboard(days = 30) {
  const { partes, loading } = usePartes();

  const since = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - days);
    return d.toISOString().slice(0, 10);
  }, [days]);

  const recent = useMemo(
    () => partes.filter((p) => p.date >= since),
    [partes, since]
  );

  const totals = useMemo<PartesTotals>(() => {
    const total_prod = recent.reduce((s, p) => s + p.cascade.produccion_real, 0);
    const total_dsj  = recent.reduce((s, p) => s + p.cascade.dsj, 0);
    return {
      produccion_real:  total_prod,
      palets_ajustados: recent.reduce((s, p) => s + p.cascade.palets_ajustados, 0),
      dsj:              total_dsj,
      dsj_pct:          total_prod ? (total_dsj / total_prod) * 100 : 0,
      mermas_totales:   recent.reduce((s, p) => s + p.cascade.mermas_totales, 0),
      n_ok:             recent.filter((p) => p.cascade.semaforo === "verde").length,
      n_amarillo:       recent.filter((p) => p.cascade.semaforo === "amarillo").length,
      n_rojo:           recent.filter((p) => p.cascade.semaforo === "rojo").length,
    };
  }, [recent]);

  /** Serie para gráfico: ordenada ASC, lista para recharts */
  const chartSeries = useMemo(
    () =>
      [...recent]
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((p) => ({
          date: p.date,
          label: p.date.slice(5),   // "MM-DD"
          produccion: Math.round(p.cascade.produccion_real),
          palets: Math.round(p.cascade.palets_ajustados),
          dsj_pct: parseFloat(p.cascade.dsj_pct.toFixed(2)),
          mermas: Math.round(p.cascade.mermas_totales),
          semaforo: p.cascade.semaforo,
        })),
    [recent]
  );

  return { partes: recent, allPartes: partes, loading, totals, chartSeries };
}

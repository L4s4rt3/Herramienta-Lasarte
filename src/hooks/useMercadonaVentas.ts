/**
 * useMercadonaVentas — datos de ventas semanales de Mercadona (planificacion vs
 * vendido) persistidos en mercadona_semanas / mercadona_semana_metodos.
 *
 * IMPORTANTE: estas dos tablas NO existen todavia en src/integrations/supabase/types.ts
 * (la migracion vive en scratchpad/migracion_mercadona.sql, pendiente de aplicar por
 * el orquestador; cuando se aplique y se regeneren los tipos, sustituir los `as any`
 * de aqui por `Tables<"mercadona_semanas">` / `Tables<"mercadona_semana_metodos">`
 * igual que hace useVentasCategoria.ts con Tables<"ventas_categoria_resumen">, y
 * eliminar el cast `SUPA` de mas abajo).
 *
 * Mientras tanto, cualquier query falla con "relation does not exist" (Postgres
 * 42P01) o similar: se detecta ese caso y se expone `tablesMissing` para que la
 * pagina muestre un estado "seccion pendiente de activar" en vez de un error crudo.
 */
import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useAuth } from "@/contexts/AuthProvider";
import { supabase } from "@/integrations/supabase/client";
import { toError } from "@/lib/errorMessage";
import type { ParsedSemana } from "@/lib/mercadonaVentas";

// Cast local: las tablas mercadona_* aun no estan en el Database generado.
// Ver comentario de cabecera para el plan de retirada de este cast.
const SUPA = supabase as unknown as SupabaseClient<any>;

export interface MercadonaMetodoRow {
  id: string;
  semana_id: string;
  metodo: string;
  descripcion: string | null;
  pct: number | null;
  kilos: number | null;
  palets: number | null;
  cajas: number | null;
  comparativa_anterior_pct: number | null;
}

export interface MercadonaSemanaRow {
  id: string;
  user_id: string;
  anio: number;
  semana: number;
  rango_planificacion: string | null;
  planificado_quincena_kg: number | null;
  planificado_semana_kg: number | null;
  vendido_kg: number | null;
  diferencia_pct: number | null;
  notas: string[];
  created_at: string;
  updated_at: string;
}

export interface MercadonaSemanaConMetodos extends MercadonaSemanaRow {
  metodos: MercadonaMetodoRow[];
}

const TABLE_MISSING_CODES = new Set(["42P01", "PGRST205", "PGRST204"]);

function isTableMissingError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const record = error as { code?: string; message?: string };
  if (record.code && TABLE_MISSING_CODES.has(record.code)) return true;
  const message = (record.message ?? "").toLowerCase();
  return message.includes("does not exist") || message.includes("could not find the table");
}

export function useMercadonaVentas() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const baseKey = ["mercadona-ventas"] as const;

  const semanasQuery = useQuery({
    queryKey: [...baseKey, "semanas"],
    queryFn: async (): Promise<MercadonaSemanaConMetodos[]> => {
      const { data: semanas, error } = await SUPA
        .from("mercadona_semanas")
        .select("*")
        .order("anio", { ascending: true })
        .order("semana", { ascending: true });
      if (error) throw error;

      const semanaIds = (semanas ?? []).map((s: MercadonaSemanaRow) => s.id);
      let metodos: MercadonaMetodoRow[] = [];
      if (semanaIds.length > 0) {
        const { data: metodosData, error: metodosError } = await SUPA
          .from("mercadona_semana_metodos")
          .select("*")
          .in("semana_id", semanaIds);
        if (metodosError) throw metodosError;
        metodos = (metodosData ?? []) as MercadonaMetodoRow[];
      }

      const metodosPorSemana = new Map<string, MercadonaMetodoRow[]>();
      for (const m of metodos) {
        const list = metodosPorSemana.get(m.semana_id) ?? [];
        list.push(m);
        metodosPorSemana.set(m.semana_id, list);
      }

      return (semanas ?? []).map((s: MercadonaSemanaRow) => ({
        ...s,
        notas: s.notas ?? [],
        metodos: metodosPorSemana.get(s.id) ?? [],
      }));
    },
    enabled: Boolean(user),
    retry: (failureCount, error) => (isTableMissingError(error) ? false : failureCount < 2),
  });

  const tablesMissing = isTableMissingError(semanasQuery.error);

  const semanas = useMemo(() => semanasQuery.data ?? [], [semanasQuery.data]);

  /** upsert por (anio, semana): reemplaza cabecera + metodos de cada semana parseada. */
  const importSemanas = useMutation({
    mutationFn: async (parsed: ParsedSemana[]) => {
      if (!user) throw new Error("Debes iniciar sesion para importar.");
      let creadas = 0;
      let actualizadas = 0;

      for (const semana of parsed) {
        const { data: existente, error: existenteError } = await SUPA
          .from("mercadona_semanas")
          .select("id")
          .eq("anio", semana.anio)
          .eq("semana", semana.semana)
          .maybeSingle();
        if (existenteError) throw existenteError;

        const payload = {
          user_id: user.id,
          anio: semana.anio,
          semana: semana.semana,
          rango_planificacion: semana.rangoPlanificacion,
          planificado_quincena_kg: semana.planificadoQuincenaKg,
          planificado_semana_kg: semana.planificadoSemanaKg,
          vendido_kg: semana.vendidoKg,
          diferencia_pct: semana.diferenciaPct,
          notas: semana.notas,
        };

        const upsertPayload: Record<string, unknown> = existente ? { id: existente.id, ...payload } : payload;
        const { data: saved, error: saveError } = await SUPA
          .from("mercadona_semanas")
          .upsert(upsertPayload, { onConflict: "anio,semana" })
          .select("id")
          .single();
        if (saveError) throw saveError;

        if (existente) actualizadas += 1;
        else creadas += 1;

        const semanaId = saved.id as string;
        const { error: deleteError } = await SUPA
          .from("mercadona_semana_metodos")
          .delete()
          .eq("semana_id", semanaId);
        if (deleteError) throw deleteError;

        if (semana.metodos.length > 0) {
          const { error: insertError } = await SUPA
            .from("mercadona_semana_metodos")
            .insert(semana.metodos.map((m) => ({
              semana_id: semanaId,
              metodo: m.metodo,
              descripcion: m.descripcion,
              pct: m.pct,
              kilos: m.kilos,
              palets: m.palets,
              cajas: m.cajas,
              comparativa_anterior_pct: m.comparativaAnteriorPct,
            })));
          if (insertError) throw insertError;
        }
      }

      return { creadas, actualizadas };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: baseKey });
    },
  });

  const updatePlanificadoSemana = useMutation({
    mutationFn: async (input: { id: string; planificado_semana_kg: number }) => {
      const { error } = await SUPA
        .from("mercadona_semanas")
        .update({ planificado_semana_kg: input.planificado_semana_kg })
        .eq("id", input.id);
      if (error) throw toError(error);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: baseKey });
    },
  });

  return {
    semanas,
    semanasQuery,
    isLoading: semanasQuery.isLoading,
    tablesMissing,
    importSemanas,
    updatePlanificadoSemana,
  };
}

export interface MercadonaTopProductor {
  productor: string;
  kg: number;
  n_lotes: number;
}

export interface MercadonaTopDia {
  date: string;
  pct: number;
  kg_mercadona: number;
}

/**
 * Cruce simplificado con produccion para la pestaña "Que le va bien a Mercadona":
 * top productores por kg de los dias del rango dado, a partir de lotes_dia
 * (mismo dato fuente que useAnalisisDiario, sin el resto de agregados que no
 * hacen falta aqui).
 */
export function useMercadonaTopProductores(desde: string, hasta: string) {
  const query = useQuery({
    queryKey: ["mercadona-top-productores", desde, hasta],
    queryFn: async (): Promise<MercadonaTopProductor[]> => {
      const { data: partes, error: partesError } = await supabase
        .from("partes_diarios")
        .select("id")
        .gte("date", desde)
        .lte("date", hasta);
      if (partesError) throw toError(partesError);

      const partIds = (partes ?? []).map((p) => p.id as string);
      if (partIds.length === 0) return [];

      const { data: lotes, error: lotesError } = await supabase
        .from("lotes_dia")
        .select("productor, kg_peso_total")
        .in("part_id", partIds);
      if (lotesError) throw toError(lotesError);

      const porProductor = new Map<string, { kg: number; n_lotes: number }>();
      for (const lote of lotes ?? []) {
        const nombre = (lote.productor ?? "").trim() || "Sin productor";
        const entry = porProductor.get(nombre) ?? { kg: 0, n_lotes: 0 };
        entry.kg += Number(lote.kg_peso_total) || 0;
        entry.n_lotes += 1;
        porProductor.set(nombre, entry);
      }

      return Array.from(porProductor.entries())
        .map(([productor, v]) => ({ productor, kg: v.kg, n_lotes: v.n_lotes }))
        .sort((a, b) => b.kg - a.kg);
    },
    enabled: Boolean(desde && hasta),
  });

  return { productores: query.data ?? [], isLoading: query.isLoading, error: query.error };
}

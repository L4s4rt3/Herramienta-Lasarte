/**
 * useMercadonaPrevisiones — kg previstos que Mercadona pide con antelación cada
 * semana, persistidos en mercadona_previsiones (anio, semana, kg_previstos,
 * kg_previstos_quincena, notas). Permite comparar por adelantado el previsto
 * contra la capacidad reciente de confección MDNA y, más tarde, contra lo que
 * realmente se vendió (cruce con mercadona_semanas vía MercadonaPrevision.tsx).
 *
 * IMPORTANTE: la tabla mercadona_previsiones NO esta todavia en
 * src/integrations/supabase/types.ts (analogo a mercadona_semanas en
 * useMercadonaVentas.ts): se usa el mismo cast `SUPA` y el mismo patron
 * `tablesMissing` para degradar con gracia si la migracion aun no esta aplicada
 * en este entorno. Cuando se regeneren los tipos, sustituir por
 * `Tables<"mercadona_previsiones">` y eliminar el cast.
 */
import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useAuth } from "@/contexts/AuthProvider";
import { supabase } from "@/integrations/supabase/client";
import { toError } from "@/lib/errorMessage";

// Cast local: la tabla mercadona_previsiones aun no esta en el Database generado.
// Ver comentario de cabecera para el plan de retirada de este cast.
const SUPA = supabase as unknown as SupabaseClient<any>;

export interface MercadonaPrevisionRow {
  id: string;
  user_id: string;
  anio: number;
  semana: number;
  kg_previstos: number;
  kg_previstos_quincena: number | null;
  notas: string | null;
  created_at: string;
  updated_at: string;
}

export interface MercadonaPrevisionInput {
  anio: number;
  semana: number;
  kg_previstos: number;
  kg_previstos_quincena?: number | null;
  notas?: string | null;
}

const TABLE_MISSING_CODES = new Set(["42P01", "PGRST205", "PGRST204"]);

function isTableMissingError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const record = error as { code?: string; message?: string };
  if (record.code && TABLE_MISSING_CODES.has(record.code)) return true;
  const message = (record.message ?? "").toLowerCase();
  return message.includes("does not exist") || message.includes("could not find the table");
}

export function useMercadonaPrevisiones() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const baseKey = ["mercadona-previsiones"] as const;

  const previsionesQuery = useQuery({
    queryKey: baseKey,
    queryFn: async (): Promise<MercadonaPrevisionRow[]> => {
      const { data, error } = await SUPA
        .from("mercadona_previsiones")
        .select("*")
        .order("anio", { ascending: true })
        .order("semana", { ascending: true });
      if (error) throw error;
      return (data ?? []) as MercadonaPrevisionRow[];
    },
    enabled: Boolean(user),
    retry: (failureCount, error) => (isTableMissingError(error) ? false : failureCount < 2),
  });

  const tablesMissing = isTableMissingError(previsionesQuery.error);

  const previsiones = useMemo(() => previsionesQuery.data ?? [], [previsionesQuery.data]);

  /** upsert por (anio, semana). */
  const guardarPrevision = useMutation({
    mutationFn: async (input: MercadonaPrevisionInput) => {
      if (!user) throw new Error("Debes iniciar sesión para guardar la previsión.");
      const { error } = await SUPA
        .from("mercadona_previsiones")
        .upsert(
          {
            user_id: user.id,
            anio: input.anio,
            semana: input.semana,
            kg_previstos: input.kg_previstos,
            kg_previstos_quincena: input.kg_previstos_quincena ?? null,
            notas: input.notas ?? null,
          },
          { onConflict: "anio,semana" },
        );
      if (error) throw toError(error);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: baseKey });
    },
  });

  const borrarPrevision = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await SUPA.from("mercadona_previsiones").delete().eq("id", id);
      if (error) throw toError(error);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: baseKey });
    },
  });

  return {
    previsiones,
    previsionesQuery,
    isLoading: previsionesQuery.isLoading,
    tablesMissing,
    guardarPrevision,
    borrarPrevision,
  };
}

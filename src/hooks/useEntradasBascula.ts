/**
 * useEntradasBascula — entradas de fruta por báscula + stock de fruta sin
 * procesar. El stock cruza las entradas con lotes_dia (kg que el calibrador
 * ya ha procesado de cada lote) vía el código de lote normalizado.
 * Ver src/lib/entradasBascula.ts.
 */
import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthProvider";
import { supabase } from "@/integrations/supabase/client";
import { toError } from "@/lib/errorMessage";
import { buildStockEntradas, type EntradaBasculaParsed, type LoteProcesadoInput } from "@/lib/entradasBascula";
import { today } from "@/lib/format";
import type { Tables } from "@/integrations/supabase/types";

export type EntradaBasculaRow = Tables<"entradas_bascula">;

const CHUNK = 200;

export function useEntradasBascula() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const entradasKey = ["entradas_bascula"] as const;

  const entradasQuery = useQuery({
    queryKey: entradasKey,
    queryFn: async (): Promise<EntradaBasculaRow[]> => {
      const { data, error } = await supabase
        .from("entradas_bascula")
        .select("*")
        .order("fecha", { ascending: false })
        .limit(20000);
      if (error) throw toError(error);
      return (data ?? []) as EntradaBasculaRow[];
    },
    enabled: Boolean(user),
  });

  // Kg procesados por lote: todos los lotes del calibrador con la fecha de su parte.
  const procesadosQuery = useQuery({
    queryKey: ["entradas_bascula", "lotes-procesados"],
    queryFn: async (): Promise<LoteProcesadoInput[]> => {
      const [{ data: lotes, error: lotesError }, { data: partes, error: partesError }] = await Promise.all([
        supabase.from("lotes_dia").select("lote_codigo, kg_peso_total, part_id").limit(50000),
        supabase.from("partes_diarios").select("id, date"),
      ]);
      if (lotesError) throw toError(lotesError);
      if (partesError) throw toError(partesError);
      const fechaPorParte = new Map((partes ?? []).map((p) => [p.id as string, p.date as string]));
      return (lotes ?? []).map((l) => ({
        lote_codigo: l.lote_codigo as string | null,
        kg_peso_total: Number(l.kg_peso_total) || 0,
        date: fechaPorParte.get(l.part_id as string) ?? null,
      }));
    },
    enabled: Boolean(user),
  });

  const importar = useMutation({
    mutationFn: async (entradas: EntradaBasculaParsed[]) => {
      if (!user) throw new Error("No auth");
      if (entradas.length === 0) throw new Error("El archivo no contiene entradas importables.");
      // Upsert por lote: reimportar el mismo día (o un rango que solape) actualiza
      // en vez de duplicar.
      for (let i = 0; i < entradas.length; i += CHUNK) {
        const chunk = entradas.slice(i, i + CHUNK).map((e) => ({ ...e, user_id: user.id }));
        const { error } = await supabase
          .from("entradas_bascula")
          .upsert(chunk, { onConflict: "lote" });
        if (error) throw toError(error);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: entradasKey });
    },
  });

  const eliminar = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("entradas_bascula").delete().eq("id", id);
      if (error) throw toError(error);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: entradasKey });
    },
  });

  const entradas = entradasQuery.data ?? [];

  const stock = useMemo(
    () => buildStockEntradas(
      entradas.map((e) => ({
        lote: e.lote,
        fecha: e.fecha,
        kg_entrada: Number(e.kg_entrada) || 0,
        finca: e.finca,
        articulo: e.articulo,
        agricultor: e.agricultor,
      })),
      procesadosQuery.data ?? [],
      today(),
    ),
    [entradas, procesadosQuery.data],
  );

  return {
    entradas,
    stock,
    isLoading: entradasQuery.isLoading || procesadosQuery.isLoading,
    error: entradasQuery.error ?? procesadosQuery.error,
    importar,
    eliminar,
  };
}

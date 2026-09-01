// Datos del stock de consumibles (/consumibles): lista completa con refresco
// en vivo (si dos móviles cuentan a la vez, ambos se ven), mutaciones con
// invalidación y el historial de cambios de un artículo (lo escribe un trigger
// en la base, aquí solo se lee).
import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/fetchAllRows";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthProvider";
import type { TablesInsert, TablesUpdate } from "@/integrations/supabase/types";
import type { StockConsumible, StockConsumibleHistorial } from "@/lib/stockConsumibles";

const QUERY_KEY = ["stock_consumibles"];

export function useStockConsumibles() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: QUERY_KEY,
    enabled: Boolean(user),
    queryFn: async () =>
      fetchAllRows<StockConsumible>(
        (from, to) =>
          supabase
            .from("stock_consumibles")
            .select("*")
            .order("familia")
            .order("nombre")
            .order("id")
            .range(from, to) as never,
      ),
  });

  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel("stock-consumibles-live")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "stock_consumibles" },
        () => void queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [user, queryClient]);

  return query;
}

export function useStockConsumiblesMutations() {
  const queryClient = useQueryClient();
  const invalidar = () => queryClient.invalidateQueries({ queryKey: QUERY_KEY });
  const onError = (error: unknown) =>
    toast({
      title: "No se pudo guardar",
      description: error instanceof Error ? error.message : String(error),
      variant: "destructive",
    });

  const actualizar = useMutation({
    mutationFn: async ({ id, cambios }: { id: string; cambios: TablesUpdate<"stock_consumibles"> }) => {
      const { error } = await supabase.from("stock_consumibles").update(cambios).eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidar,
    onError,
  });

  const crear = useMutation({
    mutationFn: async (fila: TablesInsert<"stock_consumibles">) => {
      const { error } = await supabase.from("stock_consumibles").insert(fila);
      if (error) throw error;
    },
    onSuccess: invalidar,
    onError,
  });

  return { actualizar, crear };
}

/** Últimos cambios de stock de un artículo (los escribe el trigger de la base). */
export function useStockHistorial(consumibleId: string | null) {
  return useQuery({
    queryKey: ["stock_consumibles_historial", consumibleId],
    enabled: Boolean(consumibleId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("stock_consumibles_historial")
        .select("*")
        .eq("consumible_id", consumibleId as string)
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data ?? []) as StockConsumibleHistorial[];
    },
  });
}

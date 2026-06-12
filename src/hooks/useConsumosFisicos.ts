import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthProvider";
import { supabase } from "@/integrations/supabase/client";
import {
  buildMonthlyConsumptionRows,
  type ParteKgInput,
} from "@/lib/consumosFisicos";
import { today } from "@/lib/format";
import type { ConsumoBaseKgRow, ConsumoFisicoRow } from "@/lib/types";

export interface ConsumoFisicoFormValues {
  recurso: ConsumoFisicoRow["recurso"];
  fecha_inicio: ConsumoFisicoRow["fecha_inicio"];
  fecha_fin: ConsumoFisicoRow["fecha_fin"];
  cantidad: ConsumoFisicoRow["cantidad"];
  unidad: ConsumoFisicoRow["unidad"];
  fuente: ConsumoFisicoRow["fuente"];
  referencia?: ConsumoFisicoRow["referencia"];
  notas?: ConsumoFisicoRow["notas"];
}

export interface ConsumoBaseKgFormValues {
  tipo_base: ConsumoBaseKgRow["tipo_base"];
  fecha_inicio: ConsumoBaseKgRow["fecha_inicio"];
  fecha_fin: ConsumoBaseKgRow["fecha_fin"];
  kg: ConsumoBaseKgRow["kg"];
  referencia?: ConsumoBaseKgRow["referencia"];
  notas?: ConsumoBaseKgRow["notas"];
}

export function useConsumosFisicos(rangeStart = "2025-09-01", rangeEnd = today()) {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const { data: consumos = [], isLoading: loadingConsumos } = useQuery({
    queryKey: ["consumos_fisicos"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("consumos_fisicos")
        .select("*")
        .order("fecha_inicio", { ascending: false });

      if (error) {
        throw error;
      }

      return (data ?? []) as ConsumoFisicoRow[];
    },
  });

  const { data: basesKg = [], isLoading: loadingBasesKg } = useQuery({
    queryKey: ["consumos_bases_kg"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("consumos_bases_kg")
        .select("*")
        .order("fecha_inicio", { ascending: false });

      if (error) {
        throw error;
      }

      return (data ?? []) as ConsumoBaseKgRow[];
    },
  });

  const { data: partes = [], isLoading: loadingPartes } = useQuery({
    queryKey: ["partes_diarios_kg", rangeStart, rangeEnd],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("partes_diarios")
        .select("date, kg_produccion_calibrador, kg_mujeres_calibrador, kg_reciclado_malla_z1, kg_reciclado_malla_z2")
        .gte("date", rangeStart)
        .lte("date", rangeEnd);

      if (error) {
        throw error;
      }

      return (data ?? []) as ParteKgInput[];
    },
  });

  const addConsumoMutation = useMutation({
    mutationFn: async (values: ConsumoFisicoFormValues) => {
      if (!user) {
        throw new Error("No auth");
      }

      const { error } = await supabase.from("consumos_fisicos").insert({
        ...values,
        user_id: user.id,
      });

      if (error) {
        throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["consumos_fisicos"] });
    },
  });

  const addBaseKgMutation = useMutation({
    mutationFn: async (values: ConsumoBaseKgFormValues) => {
      if (!user) {
        throw new Error("No auth");
      }

      const { error } = await supabase.from("consumos_bases_kg").insert({
        ...values,
        user_id: user.id,
      });

      if (error) {
        throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["consumos_bases_kg"] });
    },
  });

  const deleteConsumoMutation = useMutation({
    mutationFn: async (id: ConsumoFisicoRow["id"]) => {
      if (!user) {
        throw new Error("No auth");
      }

      const { error } = await supabase
        .from("consumos_fisicos")
        .delete()
        .eq("id", id);

      if (error) {
        throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["consumos_fisicos"] });
    },
  });

  const deleteBaseKgMutation = useMutation({
    mutationFn: async (id: ConsumoBaseKgRow["id"]) => {
      if (!user) {
        throw new Error("No auth");
      }

      const { error } = await supabase
        .from("consumos_bases_kg")
        .delete()
        .eq("id", id);

      if (error) {
        throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["consumos_bases_kg"] });
    },
  });

  const monthlyRows = useMemo(
    () => buildMonthlyConsumptionRows({
      rangeStart,
      rangeEnd,
      consumos,
      basesKg,
      partes,
    }),
    [rangeStart, rangeEnd, consumos, basesKg, partes],
  );

  return {
    consumos,
    basesKg,
    partes,
    monthlyRows,
    isLoading: loadingConsumos || loadingBasesKg || loadingPartes,
    addConsumo: addConsumoMutation,
    addBaseKg: addBaseKgMutation,
    deleteConsumo: deleteConsumoMutation,
    deleteBaseKg: deleteBaseKgMutation,
  };
}

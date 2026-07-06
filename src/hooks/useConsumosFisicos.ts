import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthProvider";
import { supabase } from "@/integrations/supabase/client";
import {
  buildAnnualConsumptionRows,
  buildDailyConsumptionRows,
  buildMonthlyConsumptionRows,
  buildWeeklyConsumptionRows,
  type ParteKgInput,
} from "@/lib/consumosFisicos";
import { toError } from "@/lib/errorMessage";
import {
  mergeCampana2024_2025BasesKg,
  mergeFacturasCampana2024_2025Consumos,
} from "@/lib/facturasCampana2024_2025";
import {
  mergeCampana2025_2026BasesKg,
  mergeFacturasCampana2025_2026Consumos,
} from "@/lib/facturasCampana2025_2026";
import { buildPaletsDesdeCampana2024BasesKgRows } from "@/lib/paletsDesdeCampana2024";
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

export type ConsumoFisicoUpdateValues = ConsumoFisicoFormValues & {
  id: ConsumoFisicoRow["id"];
};

export type ConsumoBaseKgUpdateValues = ConsumoBaseKgFormValues & {
  id: ConsumoBaseKgRow["id"];
};

export function useConsumosFisicos(rangeStart = "2025-09-01", rangeEnd = today()) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const consumosQueryKey = ["consumos_fisicos", user?.id] as const;
  const basesKgQueryKey = ["consumos_bases_kg", user?.id] as const;
  const partesKgQueryKey = ["partes_diarios_kg", user?.id, rangeStart, rangeEnd] as const;

  const { data: persistedConsumos = [], isLoading: loadingConsumos } = useQuery({
    queryKey: consumosQueryKey,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("consumos_fisicos")
        .select("*")
        .order("fecha_inicio", { ascending: false });

      if (error) {
        throw toError(error);
      }

      return (data ?? []) as ConsumoFisicoRow[];
    },
    enabled: Boolean(user),
  });

  const consumos = useMemo(
    () => {
      if (!user) {
        return persistedConsumos;
      }

      return mergeFacturasCampana2025_2026Consumos(
        user.id,
        mergeFacturasCampana2024_2025Consumos(user.id, persistedConsumos),
      );
    },
    [persistedConsumos, user],
  );

  const { data: persistedBasesKg = [], isLoading: loadingBasesKg } = useQuery({
    queryKey: basesKgQueryKey,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("consumos_bases_kg")
        .select("*")
        .order("fecha_inicio", { ascending: false });

      if (error) {
        throw toError(error);
      }

      return (data ?? []) as ConsumoBaseKgRow[];
    },
    enabled: Boolean(user),
  });

  const basesKg = useMemo(
    () => {
      if (!user) {
        return persistedBasesKg;
      }

      return mergeCampana2025_2026BasesKg(
        user.id,
        mergeCampana2024_2025BasesKg(user.id, persistedBasesKg),
      ).concat(buildPaletsDesdeCampana2024BasesKgRows(user.id));
    },
    [persistedBasesKg, user],
  );

  const { data: partes = [], isLoading: loadingPartes } = useQuery({
    queryKey: partesKgQueryKey,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("partes_diarios")
        .select("date, resumen_ia, kg_produccion_calibrador, kg_mujeres_calibrador, kg_reciclado_malla_z1, kg_reciclado_malla_z2")
        .gte("date", rangeStart)
        .lte("date", rangeEnd);

      if (error) {
        throw toError(error);
      }

      return (data ?? []) as ParteKgInput[];
    },
    enabled: Boolean(user),
  });

  const addConsumoMutation = useMutation({
    mutationFn: async (values: ConsumoFisicoFormValues) => {
      if (!user) {
        throw new Error("No auth");
      }

      const insertPayload = {
        recurso: values.recurso,
        fecha_inicio: values.fecha_inicio,
        fecha_fin: values.fecha_fin,
        cantidad: values.cantidad,
        unidad: values.unidad,
        fuente: values.fuente,
        user_id: user.id,
        ...(values.referencia ? { referencia: values.referencia } : {}),
        ...(values.notas ? { notas: values.notas } : {}),
      };

      const { error } = await supabase.from("consumos_fisicos").insert(insertPayload);

      if (error) {
        throw toError(error);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: consumosQueryKey });
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
        throw toError(error);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: basesKgQueryKey });
    },
  });

  const updateConsumoMutation = useMutation({
    mutationFn: async (values: ConsumoFisicoUpdateValues) => {
      if (!user) {
        throw new Error("No auth");
      }

      const { id, ...updatePayload } = values;
      const { error } = await supabase
        .from("consumos_fisicos")
        .update({
          ...updatePayload,
          referencia: updatePayload.referencia || null,
          notas: updatePayload.notas || null,
        })
        .eq("id", id);

      if (error) {
        throw toError(error);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: consumosQueryKey });
    },
  });

  const updateBaseKgMutation = useMutation({
    mutationFn: async (values: ConsumoBaseKgUpdateValues) => {
      if (!user) {
        throw new Error("No auth");
      }

      const { id, ...updatePayload } = values;
      const { error } = await supabase
        .from("consumos_bases_kg")
        .update({
          ...updatePayload,
          referencia: updatePayload.referencia || null,
          notas: updatePayload.notas || null,
        })
        .eq("id", id);

      if (error) {
        throw toError(error);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: basesKgQueryKey });
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
        throw toError(error);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: consumosQueryKey });
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
        throw toError(error);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: basesKgQueryKey });
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

  const weeklyRows = useMemo(
    () => buildWeeklyConsumptionRows({
      rangeStart,
      rangeEnd,
      consumos,
      basesKg,
      partes,
    }),
    [rangeStart, rangeEnd, consumos, basesKg, partes],
  );

  const dailyRows = useMemo(
    () => buildDailyConsumptionRows({
      rangeStart,
      rangeEnd,
      consumos,
      basesKg,
      partes,
    }),
    [rangeStart, rangeEnd, consumos, basesKg, partes],
  );

  const annualRows = useMemo(
    () => buildAnnualConsumptionRows({
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
    registrosConsumo: persistedConsumos,
    basesKg,
    registrosBaseKg: persistedBasesKg,
    partes,
    monthlyRows,
    weeklyRows,
    dailyRows,
    annualRows,
    isLoading: loadingConsumos || loadingBasesKg || loadingPartes,
    addConsumo: addConsumoMutation,
    addBaseKg: addBaseKgMutation,
    updateConsumo: updateConsumoMutation,
    updateBaseKg: updateBaseKgMutation,
    deleteConsumo: deleteConsumoMutation,
    deleteBaseKg: deleteBaseKgMutation,
  };
}

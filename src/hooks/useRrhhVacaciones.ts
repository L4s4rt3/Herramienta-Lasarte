/**
 * useRrhhVacaciones — datos de "Vacaciones y horas" de RRHH: periodos de
 * vacaciones disfrutados (rrhh_vacaciones_periodos) y bolsa de horas
 * (rrhh_horas), cruzados con la plantilla activa (trabajadores).
 *
 * IMPORTANTE: rrhh_vacaciones_periodos / rrhh_horas son tablas NUEVAS que
 * todavia no estan en src/integrations/supabase/types.ts (pendientes de
 * migracion + regeneracion de tipos). Se usa el mismo cast local que
 * useMercadonaVentas.ts (`SUPA = supabase as unknown as SupabaseClient<any>`)
 * hasta que existan los tipos generados; cuando se apliquen, sustituir por
 * `Tables<"rrhh_vacaciones_periodos">` / `Tables<"rrhh_horas">` y retirar el cast.
 * Ademas, trabajadores.fecha_alta / trabajadores.vacaciones_dias_anuales son
 * columnas nuevas que tampoco estan en el Database generado: se leen via el
 * mismo SUPA para no chocar con el tipo estrecho de `trabajadores` ya generado.
 *
 * RLS: estas tablas solo son legibles/editables por rrhh/admin. Si el usuario
 * no tiene permiso, Postgres devuelve 42501 (o PostgREST envuelve el mensaje
 * como "permission denied"): se detecta ese caso y se expone `accessDenied`
 * para que la pagina degrade con un aviso en vez de un error crudo.
 */
import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useAuth } from "@/contexts/AuthProvider";
import { supabase } from "@/integrations/supabase/client";
import { toError } from "@/lib/errorMessage";

// Cast local: rrhh_vacaciones_periodos / rrhh_horas y las columnas nuevas de
// trabajadores aun no estan en el Database generado. Ver comentario de cabecera.
const SUPA = supabase as unknown as SupabaseClient<any>;

const PERMISSION_DENIED_CODES = new Set(["42501", "PGRST301"]);

function isPermissionDeniedError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const record = error as { code?: string; message?: string };
  if (record.code && PERMISSION_DENIED_CODES.has(record.code)) return true;
  const message = (record.message ?? "").toLowerCase();
  return message.includes("permission denied") || message.includes("rls");
}

export interface RrhhTrabajadorRow {
  id: string;
  nombre: string;
  activo: boolean;
  /** Columna nueva (pendiente de migracion): fecha de alta del trabajador. */
  fecha_alta: string | null;
  /** Columna nueva (pendiente de migracion): dias naturales de vacaciones/año de convenio de esta persona. */
  vacaciones_dias_anuales: number | null;
}

export interface RrhhVacacionesPeriodoRow {
  id: string;
  trabajador_id: string;
  fecha_inicio: string;
  fecha_fin: string;
  dias_naturales: number;
  notas: string | null;
  created_at: string;
}

export interface RrhhHoraRow {
  id: string;
  trabajador_id: string;
  fecha: string;
  horas: number;
  motivo: string | null;
  created_at: string;
}

/** true si el error indica que la tabla/columna aun no existe (misma heuristica que useMercadonaVentas). */
function isTableMissingError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const record = error as { code?: string; message?: string };
  if (record.code && ["42P01", "PGRST205", "PGRST204", "42703"].includes(record.code)) return true;
  const message = (record.message ?? "").toLowerCase();
  return message.includes("does not exist") || message.includes("could not find");
}

export function useRrhhVacaciones() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const baseKey = ["rrhh-vacaciones"] as const;

  const trabajadoresQuery = useQuery({
    queryKey: [...baseKey, "trabajadores"],
    queryFn: async (): Promise<RrhhTrabajadorRow[]> => {
      const { data, error } = await SUPA
        .from("trabajadores")
        .select("id, nombre, activo, fecha_alta, vacaciones_dias_anuales")
        .eq("activo", true)
        .order("nombre", { ascending: true });
      if (error) throw error;
      return (data ?? []) as RrhhTrabajadorRow[];
    },
    enabled: Boolean(user),
    retry: (failureCount, error) =>
      isPermissionDeniedError(error) || isTableMissingError(error) ? false : failureCount < 2,
  });

  const periodosQuery = useQuery({
    queryKey: [...baseKey, "periodos"],
    queryFn: async (): Promise<RrhhVacacionesPeriodoRow[]> => {
      const { data, error } = await SUPA
        .from("rrhh_vacaciones_periodos")
        .select("*")
        .order("fecha_inicio", { ascending: false });
      if (error) throw error;
      return (data ?? []) as RrhhVacacionesPeriodoRow[];
    },
    enabled: Boolean(user),
    retry: (failureCount, error) =>
      isPermissionDeniedError(error) || isTableMissingError(error) ? false : failureCount < 2,
  });

  const horasQuery = useQuery({
    queryKey: [...baseKey, "horas"],
    queryFn: async (): Promise<RrhhHoraRow[]> => {
      const { data, error } = await SUPA
        .from("rrhh_horas")
        .select("*")
        .order("fecha", { ascending: false });
      if (error) throw error;
      return (data ?? []) as RrhhHoraRow[];
    },
    enabled: Boolean(user),
    retry: (failureCount, error) =>
      isPermissionDeniedError(error) || isTableMissingError(error) ? false : failureCount < 2,
  });

  const accessDenied =
    isPermissionDeniedError(trabajadoresQuery.error) ||
    isPermissionDeniedError(periodosQuery.error) ||
    isPermissionDeniedError(horasQuery.error);

  const tablesMissing =
    isTableMissingError(periodosQuery.error) || isTableMissingError(horasQuery.error);

  const trabajadores = useMemo(() => trabajadoresQuery.data ?? [], [trabajadoresQuery.data]);
  const periodos = useMemo(() => periodosQuery.data ?? [], [periodosQuery.data]);
  const horas = useMemo(() => horasQuery.data ?? [], [horasQuery.data]);

  const isLoading = trabajadoresQuery.isLoading || periodosQuery.isLoading || horasQuery.isLoading;

  const invalidateAll = () => queryClient.invalidateQueries({ queryKey: baseKey });

  const crearPeriodo = useMutation({
    mutationFn: async (input: {
      trabajador_id: string;
      fecha_inicio: string;
      fecha_fin: string;
      dias_naturales: number;
      notas?: string | null;
    }) => {
      const { error } = await SUPA.from("rrhh_vacaciones_periodos").insert({
        trabajador_id: input.trabajador_id,
        fecha_inicio: input.fecha_inicio,
        fecha_fin: input.fecha_fin,
        dias_naturales: input.dias_naturales,
        notas: input.notas ?? null,
      });
      if (error) throw toError(error);
    },
    onSuccess: invalidateAll,
  });

  const borrarPeriodo = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await SUPA.from("rrhh_vacaciones_periodos").delete().eq("id", id);
      if (error) throw toError(error);
    },
    onSuccess: invalidateAll,
  });

  const registrarHoras = useMutation({
    mutationFn: async (input: {
      trabajador_id: string;
      fecha: string;
      horas: number;
      motivo?: string | null;
    }) => {
      const { error } = await SUPA.from("rrhh_horas").insert({
        trabajador_id: input.trabajador_id,
        fecha: input.fecha,
        horas: input.horas,
        motivo: input.motivo ?? null,
      });
      if (error) throw toError(error);
    },
    onSuccess: invalidateAll,
  });

  const borrarHoras = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await SUPA.from("rrhh_horas").delete().eq("id", id);
      if (error) throw toError(error);
    },
    onSuccess: invalidateAll,
  });

  return {
    trabajadores,
    periodos,
    horas,
    isLoading,
    accessDenied,
    tablesMissing,
    crearPeriodo,
    borrarPeriodo,
    registrarHoras,
    borrarHoras,
  };
}

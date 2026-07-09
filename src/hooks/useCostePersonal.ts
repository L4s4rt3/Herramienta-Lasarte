// src/hooks/useCostePersonal.ts
//
// useCostePersonal — coste de personal del periodo [desde, hasta], agrupado
// por zona/grupo y por persona, para la sección "Coste de personal" de
// Económico → Costes (de la mano de RRHH).
//
// MODELO: ver cabecera de src/lib/costePersonal.ts. Este hook solo reúne los
// datos crudos (trabajadores activos, días PRESENTE en asistencia_detalle
// dentro del rango, kg producidos del periodo) y delega el cálculo puro en
// `agruparCostePersonalPorZona`.
//
// IMPORTANTE: `trabajadores.coste_hora` es una columna NUEVA que aún no está
// en src/integrations/supabase/types.ts. Se usa el mismo cast local `SUPA` a
// SupabaseClient<any> que el resto de hooks de Económico/RRHH
// (useEconomico.ts, useRrhhPersonas.ts): cuando se regeneren los tipos,
// sustituir por `Tables<"trabajadores">` y eliminar el cast.
//
// RLS: coste_hora es un dato económico, igual que economico_precios, así que
// se asume el mismo criterio de acceso restringido a administración. Si el
// usuario actual no es admin, Postgres devuelve un error de permiso (42501)
// o PostgREST oculta la columna/tabla (PGRST301/302); en ambos casos se
// detecta con `isPermissionError` y la página degrada mostrando
// "Solo administración" en vez de un error crudo (mismo patrón que
// useCostesPeriodo en useEconomico.ts).
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useAuth } from "@/contexts/AuthProvider";
import { supabase } from "@/integrations/supabase/client";
import { toError } from "@/lib/errorMessage";
import {
  agruparCostePersonalPorZona,
  type CostePersonalAgrupado,
} from "@/lib/costePersonal";
import { kgProducidosParte, type ParteKgInput } from "@/lib/consumosFisicos";

// Cast local: trabajadores.coste_hora aun no esta en el Database generado.
// Ver comentario de cabecera para el plan de retirada de este cast.
const SUPA = supabase as unknown as SupabaseClient<any>;

const PERMISSION_ERROR_CODES = new Set(["42501", "PGRST301", "PGRST302"]);

/** Distingue "sin permiso RLS" (degradar con aviso) de otros errores (relanzar). */
function isPermissionError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const record = error as { code?: string; message?: string; status?: number };
  if (record.code && PERMISSION_ERROR_CODES.has(record.code)) return true;
  if (record.status === 401 || record.status === 403) return true;
  const message = (record.message ?? "").toLowerCase();
  return (
    message.includes("permission denied") ||
    message.includes("row-level security") ||
    message.includes("row level security")
  );
}

interface TrabajadorCosteHoraRow {
  id: string;
  nombre: string;
  zona: string | null;
  activo: boolean;
  coste_hora: number | null;
}

interface AsistenciaPresenteRow {
  trabajador_id: string;
}

export interface CostePersonal extends CostePersonalAgrupado {
  /** Coste de personal / kg producido del periodo. Null si no hubo kg producidos. */
  costePorKg: number | null;
  kgProducidos: number;
  isLoading: boolean;
  /** Igual que useCostesPeriodo: sin esto no se puede ver coste_hora. */
  sinPermiso: boolean;
}

/**
 * Coste de personal de [desde, hasta]: trabajadores activos + días PRESENTE
 * en asistencia_detalle dentro del rango (jornada base, ver
 * src/lib/costePersonal.ts) + kg producidos del periodo (partes_diarios,
 * misma fórmula que useCostesPeriodo).
 */
export function useCostePersonal(desde: string, hasta: string): CostePersonal {
  const { user } = useAuth();

  const trabajadoresQuery = useQuery({
    queryKey: ["coste-personal-trabajadores", user?.id],
    queryFn: async (): Promise<TrabajadorCosteHoraRow[]> => {
      const { data, error } = await SUPA
        .from("trabajadores")
        .select("id, nombre, zona, activo, coste_hora")
        .eq("activo", true);
      if (error) throw toError(error);
      return (data ?? []) as TrabajadorCosteHoraRow[];
    },
    enabled: Boolean(user),
    retry: (failureCount, error) => (isPermissionError(error) ? false : failureCount < 2),
  });

  const sinPermiso = isPermissionError(trabajadoresQuery.error);

  const asistenciaQuery = useQuery({
    queryKey: ["coste-personal-asistencia", user?.id, desde, hasta],
    queryFn: async (): Promise<AsistenciaPresenteRow[]> => {
      const { data, error } = await SUPA
        .from("asistencia_detalle")
        .select("trabajador_id")
        .eq("presente", true)
        .gte("date", desde)
        .lte("date", hasta);
      if (error) throw toError(error);
      return (data ?? []) as AsistenciaPresenteRow[];
    },
    enabled: Boolean(user) && !sinPermiso,
  });

  const partesQuery = useQuery({
    queryKey: ["coste-personal-partes", user?.id, desde, hasta],
    queryFn: async (): Promise<ParteKgInput[]> => {
      const { data, error } = await supabase
        .from("partes_diarios")
        .select("date, resumen_ia, kg_produccion_calibrador, kg_mujeres_calibrador, kg_reciclado_malla_z1, kg_reciclado_malla_z2")
        .gte("date", desde)
        .lte("date", hasta);
      if (error) throw toError(error);
      return (data ?? []) as ParteKgInput[];
    },
    enabled: Boolean(user) && !sinPermiso,
  });

  // Días PRESENTE por trabajador dentro del rango (una sola query, agregada en cliente).
  const diasPresentePorTrabajador = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of asistenciaQuery.data ?? []) {
      map.set(row.trabajador_id, (map.get(row.trabajador_id) ?? 0) + 1);
    }
    return map;
  }, [asistenciaQuery.data]);

  const agrupado = useMemo(
    () => agruparCostePersonalPorZona(
      (trabajadoresQuery.data ?? []).map((t) => ({
        id: t.id,
        nombre: t.nombre,
        zona: t.zona,
        coste_hora: t.coste_hora,
        diasPresente: diasPresentePorTrabajador.get(t.id) ?? 0,
      })),
    ),
    [trabajadoresQuery.data, diasPresentePorTrabajador],
  );

  const kgProducidos = useMemo(
    () => (partesQuery.data ?? []).reduce((total, p) => total + kgProducidosParte(p), 0),
    [partesQuery.data],
  );

  const costePorKg = kgProducidos > 0 ? agrupado.total / kgProducidos : null;

  const isLoading = trabajadoresQuery.isLoading || asistenciaQuery.isLoading || partesQuery.isLoading;

  return {
    ...agrupado,
    costePorKg,
    kgProducidos,
    isLoading,
    sinPermiso,
  };
}

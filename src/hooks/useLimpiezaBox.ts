/**
 * useLimpiezaBox — cargas y mutaciones de la zona "Limpieza de box"
 * (src/pages/LimpiezaBox.tsx): partes diarios del grupo de limpieza de boxes
 * con sus trabajadores/horas.
 *
 * IMPORTANTE: limpieza_partes y limpieza_parte_trabajadores NO están todavía
 * en src/integrations/supabase/types.ts (la migración
 * supabase/migrations/20260714120000_limpieza_box.sql está pendiente de
 * aplicar por el orquestador). Mientras tanto se usa el cast SUPA de más
 * abajo (mismo patrón que useMercadonaVentas.ts) y cualquier query puede
 * fallar con "relation does not exist": se detecta con
 * esErrorTablaOColumnaInexistente y se expone `tablaPendiente` para que la
 * página muestre "pendiente de aplicar migración" en vez de un error crudo.
 * Cuando se aplique y se regeneren los tipos, sustituir las interfaces de
 * fila por Tables<"limpieza_partes"> / Tables<"limpieza_parte_trabajadores">
 * y retirar el cast.
 *
 * Dataset COMPARTIDO entre usuarios (UNIQUE(fecha, turno) en limpieza_partes):
 * las lecturas no filtran por user_id; la RLS permite editar/borrar solo lo
 * propio (o todo a un admin).
 */
import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useAuth } from "@/contexts/AuthProvider";
import { supabase } from "@/integrations/supabase/client";
import { toError } from "@/lib/errorMessage";
import { esErrorTablaOColumnaInexistente } from "@/lib/productoresCanonicos";
import { agregarLimpiezaCoste, type LimpiezaCostePeriodo } from "@/lib/limpiezaBox";

// Cast local: las tablas limpieza_* aún no están en el Database generado.
// Ver comentario de cabecera para el plan de retirada de este cast.
const SUPA = supabase as unknown as SupabaseClient<any>;

export interface LimpiezaParteTrabajadorRow {
  id: string;
  parte_id: string;
  trabajador_id: string | null;
  nombre: string;
  horas: number;
  created_at: string;
}

export interface LimpiezaParteRow {
  id: string;
  user_id: string;
  fecha: string;
  turno: 1 | 2;
  unidad: "pies" | "box";
  pies: number | null;
  box: number;
  escaleras: number | null;
  observaciones: string | null;
  created_at: string;
  updated_at: string;
}

export interface LimpiezaParteConTrabajadores extends LimpiezaParteRow {
  trabajadores: LimpiezaParteTrabajadorRow[];
}

export interface LimpiezaTrabajadorInput {
  /** id de la plantilla (tabla trabajadores), o null si es nombre libre. */
  trabajadorId: string | null;
  /** Snapshot del nombre, siempre relleno. */
  nombre: string;
  horas: number;
}

export interface LimpiezaParteInput {
  fecha: string;
  turno: 1 | 2;
  unidad: "pies" | "box";
  /** Pies originales; null si el dato se metió directamente en box. */
  pies: number | null;
  /** Box (ya convertidos si la unidad fue pies). */
  box: number;
  escaleras: number | null;
  observaciones: string | null;
  trabajadores: LimpiezaTrabajadorInput[];
}

export const LIMPIEZA_PARTES_KEY = ["limpieza-box", "partes"] as const;

interface LimpiezaPartesData {
  partes: LimpiezaParteConTrabajadores[];
  /** true si limpieza_partes aún no existe (migración 20260714120000 pendiente). */
  tablaPendiente: boolean;
}

async function fetchPartes(): Promise<LimpiezaPartesData> {
  const { data: partes, error } = await SUPA
    .from("limpieza_partes")
    .select("*")
    .order("fecha", { ascending: false })
    .order("turno", { ascending: false })
    .limit(2000);
  if (error) {
    if (esErrorTablaOColumnaInexistente(error)) {
      console.warn("useLimpiezaBox: limpieza_partes aún no existe (migración 20260714120000 pendiente de aplicar).", error);
      return { partes: [], tablaPendiente: true };
    }
    throw toError(error);
  }

  const filas = (partes ?? []) as LimpiezaParteRow[];
  const ids = filas.map((p) => p.id);
  let trabajadores: LimpiezaParteTrabajadorRow[] = [];
  if (ids.length > 0) {
    // Join manual en dos queries + ensamblado, como el resto de hooks del repo.
    const { data: hijos, error: hijosError } = await SUPA
      .from("limpieza_parte_trabajadores")
      .select("*")
      .in("parte_id", ids)
      .order("nombre", { ascending: true });
    if (hijosError) throw toError(hijosError);
    trabajadores = (hijos ?? []) as LimpiezaParteTrabajadorRow[];
  }

  const porParte = new Map<string, LimpiezaParteTrabajadorRow[]>();
  for (const t of trabajadores) {
    const arr = porParte.get(t.parte_id) ?? [];
    arr.push(t);
    porParte.set(t.parte_id, arr);
  }

  return {
    partes: filas.map((p) => ({ ...p, trabajadores: porParte.get(p.id) ?? [] })),
    tablaPendiente: false,
  };
}

/** Inserta las filas hijas (trabajadores) de un parte. */
async function insertarTrabajadores(parteId: string, trabajadores: LimpiezaTrabajadorInput[]) {
  const filas = trabajadores
    .filter((t) => t.nombre.trim() !== "")
    .map((t) => ({
      parte_id: parteId,
      trabajador_id: t.trabajadorId,
      nombre: t.nombre.trim(),
      horas: t.horas,
    }));
  if (filas.length === 0) return;
  const { error } = await SUPA.from("limpieza_parte_trabajadores").insert(filas);
  if (error) throw toError(error);
}

export function useLimpiezaBox() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: LIMPIEZA_PARTES_KEY,
    queryFn: fetchPartes,
    enabled: Boolean(user),
  });

  const invalidar = () => queryClient.invalidateQueries({ queryKey: LIMPIEZA_PARTES_KEY });

  const crearParte = useMutation({
    mutationFn: async (input: LimpiezaParteInput) => {
      if (!user) throw new Error("Debes iniciar sesión para guardar un parte.");
      const { data, error } = await SUPA
        .from("limpieza_partes")
        .insert({
          user_id: user.id,
          fecha: input.fecha,
          turno: input.turno,
          unidad: input.unidad,
          pies: input.pies,
          box: input.box,
          escaleras: input.escaleras,
          observaciones: input.observaciones,
        })
        .select("id")
        .single();
      if (error) {
        if (esErrorTablaOColumnaInexistente(error)) {
          throw new Error("La tabla limpieza_partes todavía no existe: aplica primero la migración 20260714120000_limpieza_box.sql.");
        }
        throw toError(error);
      }
      await insertarTrabajadores((data as { id: string }).id, input.trabajadores);
      return data as { id: string };
    },
    onSuccess: invalidar,
  });

  const editarParte = useMutation({
    mutationFn: async (input: LimpiezaParteInput & { id: string }) => {
      const { error } = await SUPA
        .from("limpieza_partes")
        .update({
          fecha: input.fecha,
          turno: input.turno,
          unidad: input.unidad,
          pies: input.pies,
          box: input.box,
          escaleras: input.escaleras,
          observaciones: input.observaciones,
          updated_at: new Date().toISOString(),
        })
        .eq("id", input.id);
      if (error) throw toError(error);
      // Hijos: delete + insert (aceptado para listas cortas como esta).
      const { error: delError } = await SUPA.from("limpieza_parte_trabajadores").delete().eq("parte_id", input.id);
      if (delError) throw toError(delError);
      await insertarTrabajadores(input.id, input.trabajadores);
    },
    onSuccess: invalidar,
  });

  const eliminarParte = useMutation({
    mutationFn: async (id: string) => {
      // ON DELETE CASCADE en limpieza_parte_trabajadores borra los hijos solo.
      const { error } = await SUPA.from("limpieza_partes").delete().eq("id", id);
      if (error) throw toError(error);
    },
    onSuccess: invalidar,
  });

  return {
    partes: query.data?.partes ?? [],
    tablaPendiente: query.data?.tablaPendiente ?? false,
    isLoading: query.isLoading,
    error: query.error,
    crearParte,
    editarParte,
    eliminarParte,
  };
}

export interface LimpiezaBoxCostePeriodo extends LimpiezaCostePeriodo {
  isLoading: boolean;
  /** true si limpieza_partes/limpieza_parte_trabajadores no existen todavía. */
  tablaPendiente: boolean;
}

/**
 * Coste de personal del grupo de limpieza de boxes en [desde, hasta]: DESGLOSE
 * informativo del coste de personal de Económico → Costes (por asistencia),
 * NO un gasto adicional — ver cabecera de agregarLimpiezaCoste en
 * src/lib/limpiezaBox.ts. Reutiliza useLimpiezaBox() (misma queryKey, React
 * Query dedupe el fetch si la página ya la usa) y solo añade una query propia
 * y pequeña para el coste_hora de la plantilla activa.
 */
export function useLimpiezaBoxCostePeriodo(desde: string, hasta: string): LimpiezaBoxCostePeriodo {
  const { user } = useAuth();
  const { partes, tablaPendiente, isLoading: isLoadingPartes } = useLimpiezaBox();

  const trabajadoresQuery = useQuery({
    queryKey: ["limpieza-box", "coste-trabajadores", user?.id],
    queryFn: async (): Promise<{ id: string; coste_hora: number | null }[]> => {
      const { data, error } = await SUPA.from("trabajadores").select("id, coste_hora").eq("activo", true);
      if (error) throw toError(error);
      return (data ?? []) as { id: string; coste_hora: number | null }[];
    },
    enabled: Boolean(user) && !tablaPendiente,
  });

  const costeHoraPorTrabajador = useMemo(
    () => new Map((trabajadoresQuery.data ?? []).map((t) => [t.id, t.coste_hora] as const)),
    [trabajadoresQuery.data],
  );

  const trabajadoresDelPeriodo = useMemo(
    () => partes
      .filter((p) => p.fecha >= desde && p.fecha <= hasta)
      .flatMap((p) => p.trabajadores),
    [partes, desde, hasta],
  );

  const resultado = useMemo(
    () => agregarLimpiezaCoste(trabajadoresDelPeriodo, costeHoraPorTrabajador),
    [trabajadoresDelPeriodo, costeHoraPorTrabajador],
  );

  return {
    ...resultado,
    isLoading: isLoadingPartes || trabajadoresQuery.isLoading,
    tablaPendiente,
  };
}

/**
 * Último parte de limpieza (solo fecha + box): resumen barato para el
 * dashboard de producción (FASE 2 del rediseño, "La sección") — a diferencia
 * de useLimpiezaBox(), que trae la lista completa con sus trabajadores, esto
 * es una sola fila con dos columnas. `null` mientras carga, si aún no hay
 * ningún parte o si la tabla no existe todavía (migración pendiente).
 */
export function useUltimoParteLimpieza() {
  const { user } = useAuth();

  const query = useQuery({
    queryKey: ["limpieza-box", "ultimo-parte"] as const,
    queryFn: async (): Promise<{ fecha: string; box: number } | null> => {
      const { data, error } = await SUPA
        .from("limpieza_partes")
        .select("fecha, box")
        .order("fecha", { ascending: false })
        .order("turno", { ascending: false })
        .limit(1);
      if (error) {
        if (esErrorTablaOColumnaInexistente(error)) return null;
        throw toError(error);
      }
      const fila = (data ?? [])[0] as { fecha: string; box: number } | undefined;
      return fila ? { fecha: fila.fecha, box: fila.box } : null;
    },
    enabled: Boolean(user),
  });

  return { data: query.data ?? null, isLoading: query.isLoading };
}

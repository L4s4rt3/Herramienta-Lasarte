/**
 * useCosteMallas — acceso a public.economico_mallas_config (config de "mallas
 * rotas" por zona) y cálculo del gasto de un periodo cruzando esa config con
 * el reciclado de malla de partes_diarios (`kg_reciclado_malla_z1`/`_z2`).
 *
 * IMPORTANTE: economico_mallas_config es una tabla NUEVA que NO existe todavia
 * en src/integrations/supabase/types.ts. Se usa el mismo patron que
 * useEconomico.ts (usePreciosRecursos): cast local `SUPA` a
 * SupabaseClient<any>. Cuando se regeneren los tipos, sustituir los
 * `as any`/`SUPA` por `Tables<"economico_mallas_config">` y eliminar el cast.
 *
 * RLS: economico_mallas_config SOLO es legible/editable por administración
 * (igual que economico_precios) — se detecta con `isPermissionError` y las
 * paginas degradan mostrando "Solo administración" en vez de un error crudo.
 *
 * CONFIG VIGENTE POR PERIODO: a diferencia de agua/gasoil (que reparten el
 * consumo día a día y resuelven una tarifa por día), el reciclado de malla de
 * `partes_diarios` se suma para todo el rango pedido y se cruza con UNA sola
 * config vigente por zona — no hay una fecha por kg individual a la que
 * atribuir una vigencia distinta dentro del periodo. La fecha de referencia
 * usada para elegir esa config es el fin del rango (`hasta`), o hoy si el
 * rango pedido llega hasta el futuro (mismo tope que "vigente ahora" usa en
 * el resto de Económico, ver `vigentesPorRecurso` en useEconomico.ts).
 */
import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useAuth } from "@/contexts/AuthProvider";
import { supabase } from "@/integrations/supabase/client";
import { toError } from "@/lib/errorMessage";
import { today } from "@/lib/format";
import {
  agregarGastoMallas,
  configVigente,
  type AgregadoGastoMallas,
  type MallaConfigInput,
  type ZonaMalla,
} from "@/lib/costeMallas";

// Cast local: la tabla economico_mallas_config aun no esta en el Database generado.
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

export interface EconomicoMallaConfigRow extends MallaConfigInput {
  id: string;
  user_id: string;
  zona: string;
  notas: string | null;
}

export interface NuevaMallaConfigInput {
  zona: ZonaMalla;
  tipo_malla: string | null;
  kg_por_malla: number | null;
  precio_malla: number | null;
  vigente_desde: string;
  notas: string | null;
}

// ─── Config por zona (para EconomicoPrecios) ────────────────────────────────

/**
 * Listado de config de mallas rotas (Z1/Z2) + alta de una vigencia nueva.
 * Igual que las tarifas de recursos: un cambio real de peso/precio de malla
 * es siempre una fila nueva con `vigente_desde` en la fecha del cambio, nunca
 * una edición de la vigencia anterior.
 */
export function useMallasConfig() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const baseKey = ["economico-mallas-config"] as const;

  const query = useQuery({
    queryKey: baseKey,
    queryFn: async (): Promise<EconomicoMallaConfigRow[]> => {
      const { data, error } = await SUPA
        .from("economico_mallas_config")
        .select("*")
        .order("zona", { ascending: true })
        .order("vigente_desde", { ascending: false });
      if (error) throw error;
      return (data ?? []) as EconomicoMallaConfigRow[];
    },
    enabled: Boolean(user),
    retry: (failureCount, error) => (isPermissionError(error) ? false : failureCount < 2),
  });

  const sinPermiso = isPermissionError(query.error);
  const configs = useMemo(() => query.data ?? [], [query.data]);

  const zonas: ZonaMalla[] = ["z1", "z2"];

  /** Config vigente HOY por zona, para la fila "vigente" de cada zona. */
  const vigentePorZona = useMemo(() => {
    const map = new Map<ZonaMalla, EconomicoMallaConfigRow>();
    const hoy = today();
    for (const zona of zonas) {
      const vigente = configVigente(configs, zona, hoy);
      if (vigente) map.set(zona, vigente);
    }
    return map;
  }, [configs]);

  /** Histórico completo por zona, mas reciente primero. */
  const historicoPorZona = useMemo(() => {
    const map = new Map<ZonaMalla, EconomicoMallaConfigRow[]>();
    for (const zona of zonas) {
      map.set(
        zona,
        configs
          .filter((c) => c.zona === zona)
          .sort((a, b) => b.vigente_desde.localeCompare(a.vigente_desde)),
      );
    }
    return map;
  }, [configs]);

  /** true si a la vigencia actual de alguna zona le falta tipo_malla, kg_por_malla o precio_malla. */
  const hayDatosFaltantes = useMemo(
    () => zonas.some((zona) => {
      const vigente = vigentePorZona.get(zona);
      return !vigente || vigente.kg_por_malla == null || vigente.precio_malla == null;
    }),
    [vigentePorZona],
  );

  const crear = useMutation({
    mutationFn: async (input: NuevaMallaConfigInput) => {
      if (!user) throw new Error("Debes iniciar sesion para registrar la config de mallas.");
      const { error } = await SUPA.from("economico_mallas_config").insert({
        user_id: user.id,
        zona: input.zona,
        tipo_malla: input.tipo_malla,
        kg_por_malla: input.kg_por_malla,
        precio_malla: input.precio_malla,
        vigente_desde: input.vigente_desde,
        notas: input.notas,
      });
      if (error) throw toError(error);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: baseKey });
    },
  });

  return {
    configs,
    vigentePorZona,
    historicoPorZona,
    hayDatosFaltantes,
    isLoading: query.isLoading,
    sinPermiso,
    crear,
  };
}

// ─── Gasto de mallas rotas de un periodo (para EconomicoCostes) ────────────

interface ParteRecicladoRow {
  kg_reciclado_malla_z1: number | null;
  kg_reciclado_malla_z2: number | null;
}

export interface CosteMallasPeriodo extends AgregadoGastoMallas {
  isLoading: boolean;
  sinPermiso: boolean;
}

/**
 * Gasto de mallas rotas de [desde, hasta]: suma el reciclado de malla de
 * partes_diarios por zona y lo cruza con la config vigente de cada zona (ver
 * cabecera del módulo para la elección de la fecha de referencia).
 */
export function useCosteMallas(desde: string, hasta: string): CosteMallasPeriodo {
  const { user } = useAuth();

  const configQuery = useQuery({
    queryKey: ["economico-mallas-config"],
    queryFn: async (): Promise<EconomicoMallaConfigRow[]> => {
      const { data, error } = await SUPA
        .from("economico_mallas_config")
        .select("*");
      if (error) throw error;
      return (data ?? []) as EconomicoMallaConfigRow[];
    },
    enabled: Boolean(user),
    retry: (failureCount, error) => (isPermissionError(error) ? false : failureCount < 2),
  });

  const sinPermiso = isPermissionError(configQuery.error);

  const partesQuery = useQuery({
    queryKey: ["economico-mallas-partes", user?.id, desde, hasta],
    queryFn: async (): Promise<ParteRecicladoRow[]> => {
      const { data, error } = await supabase
        .from("partes_diarios")
        .select("kg_reciclado_malla_z1, kg_reciclado_malla_z2")
        .gte("date", desde)
        .lte("date", hasta);
      if (error) throw toError(error);
      return (data ?? []) as ParteRecicladoRow[];
    },
    enabled: Boolean(user) && !sinPermiso,
  });

  const configs = configQuery.data ?? [];
  const partes = partesQuery.data ?? [];

  const kgTotales = useMemo(() => {
    let z1 = 0;
    let z2 = 0;
    for (const p of partes) {
      z1 += Number(p.kg_reciclado_malla_z1 ?? 0);
      z2 += Number(p.kg_reciclado_malla_z2 ?? 0);
    }
    return { z1_kg: z1, z2_kg: z2 };
  }, [partes]);

  // Fecha de referencia para elegir la config vigente de cada zona: el fin
  // del rango pedido, o hoy si ese rango se extiende al futuro (ver cabecera).
  const fechaReferencia = hasta < today() ? hasta : today();

  const configZ1 = useMemo(() => configVigente(configs, "z1", fechaReferencia), [configs, fechaReferencia]);
  const configZ2 = useMemo(() => configVigente(configs, "z2", fechaReferencia), [configs, fechaReferencia]);

  const resultado = useMemo(
    () => agregarGastoMallas(kgTotales, configZ1, configZ2),
    [kgTotales, configZ1, configZ2],
  );

  const isLoading = configQuery.isLoading || partesQuery.isLoading;

  return {
    ...resultado,
    isLoading,
    sinPermiso,
  };
}

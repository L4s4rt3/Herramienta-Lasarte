/**
 * useEconomico — acceso a public.economico_precios (tarifas de recursos del
 * "modo económico") y cálculo de costes de un periodo cruzando esas tarifas
 * con los consumos físicos ya existentes.
 *
 * IMPORTANTE: economico_precios es una tabla NUEVA que NO existe todavia en
 * src/integrations/supabase/types.ts. Se usa el mismo patron que
 * src/hooks/useMercadonaVentas.ts / src/hooks/useRrhhDocs.ts: cast local
 * `SUPA` a SupabaseClient<any>. Cuando se regeneren los tipos, sustituir los
 * `as any`/`SUPA` por `Tables<"economico_precios">` y eliminar el cast.
 *
 * RLS: economico_precios SOLO es legible/editable por administración (incluso
 * el SELECT esta restringido). Si el usuario actual no es admin, Postgres
 * devuelve un error de permiso (42501) o PostgREST oculta la tabla
 * (PGRST301/302) — en ambos casos se detecta con `isPermissionError` y las
 * paginas degradan mostrando "Solo administración" en vez de un error crudo.
 *
 * REPARTO DE CONSUMOS (ver cabecera de src/lib/economico.ts para el porque):
 * - Agua: consumos_fisicos (recurso "agua"), reutilizando
 *   `buildDailyConsumptionRows` de src/lib/consumosFisicos.ts para heredar la
 *   regla de subcontadores (tratamiento/tratamiento+jabon no suman) y el
 *   reparto de lecturas multi-dia — NO se reimplementa esa logica aqui.
 * - Gasoil/electricidad/quimicos: sesiones_consumo, repartida por solape de
 *   dias con el rango pedido via `solapeCantidadEnRango` (src/lib/economico.ts).
 * - Kg producidos: partes_diarios, produccion real via `kgProducidosParte`
 *   (misma formula que usa consumosFisicos.ts: kg_produccion_calibrador menos
 *   mujeres y reciclado de mallas Z1/Z2).
 */
import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useAuth } from "@/contexts/AuthProvider";
import { supabase } from "@/integrations/supabase/client";
import { toError } from "@/lib/errorMessage";
import { today } from "@/lib/format";
import {
  buildDailyConsumptionRows,
  kgProducidosParte,
  type ParteKgInput,
} from "@/lib/consumosFisicos";
import {
  agregarCostesPorRecurso,
  agregarCostesPorSemana,
  solapeCantidadEnRango,
  tarifaVigente,
  type CosteEntrada,
  type CostePorRecurso,
  type CosteSemana,
} from "@/lib/economico";
import type { ConsumoFisicoRow, SesionConsumoRow } from "@/lib/types";

// Cast local: la tabla economico_precios aun no esta en el Database generado.
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

export type EconomicoRecurso = "agua" | "electricidad" | "gasoil" | "quimicos";

export interface EconomicoPrecioRow {
  id: string;
  user_id: string;
  recurso: string;
  unidad: string;
  precio_por_unidad: number;
  vigente_desde: string;
  notas: string | null;
}

export interface NuevaTarifaInput {
  recurso: string;
  unidad: string;
  precio_por_unidad: number;
  vigente_desde: string;
  notas: string | null;
}

export type EditarTarifaInput = NuevaTarifaInput & { id: string };

// ─── Tarifas ─────────────────────────────────────────────────────────────────

/**
 * Listado de tarifas + altas/edicion/borrado. Editar/borrar una fila existente
 * solo tiene sentido para corregir una errata: para un cambio real de precio
 * hay que dar de alta una fila nueva con `vigente_desde` en la fecha del
 * cambio (ver `crear`), nunca editar la tarifa anterior.
 */
export function usePreciosRecursos() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const baseKey = ["economico-precios"] as const;

  const query = useQuery({
    queryKey: baseKey,
    queryFn: async (): Promise<EconomicoPrecioRow[]> => {
      const { data, error } = await SUPA
        .from("economico_precios")
        .select("*")
        .order("recurso", { ascending: true })
        .order("vigente_desde", { ascending: false });
      if (error) throw error;
      return (data ?? []) as EconomicoPrecioRow[];
    },
    enabled: Boolean(user),
    retry: (failureCount, error) => (isPermissionError(error) ? false : failureCount < 2),
  });

  const sinPermiso = isPermissionError(query.error);
  const precios = useMemo(() => query.data ?? [], [query.data]);

  const recursos = useMemo(
    () => Array.from(new Set(precios.map((p) => p.recurso))).sort(),
    [precios],
  );

  /** Tarifa vigente HOY por recurso, para la tabla "tarifas vigentes". */
  const vigentesPorRecurso = useMemo(() => {
    const map = new Map<string, EconomicoPrecioRow>();
    const hoy = today();
    for (const recurso of recursos) {
      const vigente = tarifaVigente(precios, recurso, hoy);
      if (vigente) map.set(recurso, vigente);
    }
    return map;
  }, [precios, recursos]);

  /** Historico completo por recurso, mas reciente primero. */
  const historicoPorRecurso = useMemo(() => {
    const map = new Map<string, EconomicoPrecioRow[]>();
    for (const p of precios) {
      const list = map.get(p.recurso) ?? [];
      list.push(p);
      map.set(p.recurso, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => b.vigente_desde.localeCompare(a.vigente_desde));
    }
    return map;
  }, [precios]);

  const hayPrecioCero = useMemo(
    () => recursos.some((recurso) => (vigentesPorRecurso.get(recurso)?.precio_por_unidad ?? 0) === 0),
    [recursos, vigentesPorRecurso],
  );

  const crear = useMutation({
    mutationFn: async (input: NuevaTarifaInput) => {
      if (!user) throw new Error("Debes iniciar sesion para registrar una tarifa.");
      const { error } = await SUPA.from("economico_precios").insert({
        user_id: user.id,
        recurso: input.recurso,
        unidad: input.unidad,
        precio_por_unidad: input.precio_por_unidad,
        vigente_desde: input.vigente_desde,
        notas: input.notas,
      });
      if (error) throw toError(error);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: baseKey });
    },
  });

  /** Editar una tarifa existente: pensado para corregir una errata, no para un cambio de precio real. */
  const editar = useMutation({
    mutationFn: async (input: EditarTarifaInput) => {
      const { id, ...patch } = input;
      const { error } = await SUPA
        .from("economico_precios")
        .update({
          recurso: patch.recurso,
          unidad: patch.unidad,
          precio_por_unidad: patch.precio_por_unidad,
          vigente_desde: patch.vigente_desde,
          notas: patch.notas,
        })
        .eq("id", id);
      if (error) throw toError(error);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: baseKey });
    },
  });

  const borrar = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await SUPA.from("economico_precios").delete().eq("id", id);
      if (error) throw toError(error);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: baseKey });
    },
  });

  return {
    precios,
    recursos,
    vigentesPorRecurso,
    historicoPorRecurso,
    hayPrecioCero,
    isLoading: query.isLoading,
    sinPermiso,
    crear,
    editar,
    borrar,
  };
}

// ─── Costes de un periodo ────────────────────────────────────────────────────

export interface CostesPeriodo {
  porRecurso: CostePorRecurso[];
  costeTotal: number;
  kgProducidos: number;
  costePorKg: number | null;
  hayPreciosACero: boolean;
  serieSemanal: CosteSemana[];
  isLoading: boolean;
  sinPermiso: boolean;
}

/**
 * Costes de [desde, hasta] cruzando consumos fisicos (agua via
 * consumos_fisicos, resto via sesiones_consumo) con las tarifas vigentes en
 * cada fecha. `sinPermiso` refleja el mismo acceso restringido que
 * `usePreciosRecursos` (sin tarifas visibles no hay coste que calcular).
 */
export function useCostesPeriodo(desde: string, hasta: string): CostesPeriodo {
  const { user } = useAuth();
  const { precios, sinPermiso, isLoading: loadingPrecios } = usePreciosRecursos();

  const consumosAguaQuery = useQuery({
    queryKey: ["economico-consumos-agua", user?.id, desde, hasta],
    queryFn: async (): Promise<ConsumoFisicoRow[]> => {
      const { data, error } = await supabase
        .from("consumos_fisicos")
        .select("*")
        .eq("recurso", "agua")
        .lte("fecha_inicio", hasta)
        .gte("fecha_fin", desde);
      if (error) throw toError(error);
      return (data ?? []) as ConsumoFisicoRow[];
    },
    enabled: Boolean(user) && !sinPermiso,
  });

  const sesionesQuery = useQuery({
    queryKey: ["economico-sesiones-consumo", user?.id, desde, hasta],
    queryFn: async (): Promise<SesionConsumoRow[]> => {
      const { data, error } = await supabase
        .from("sesiones_consumo")
        .select("*")
        .lte("fecha_inicio", hasta)
        .gte("fecha_fin", desde);
      if (error) throw toError(error);
      return (data ?? []) as SesionConsumoRow[];
    },
    enabled: Boolean(user) && !sinPermiso,
  });

  const partesQuery = useQuery({
    queryKey: ["economico-partes-diarios", user?.id, desde, hasta],
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

  const partes = partesQuery.data ?? [];

  // Agua: reutiliza el reparto diario ya existente (subcontadores excluidos,
  // reparto de lecturas multi-dia por kg de produccion real del tramo).
  const aguaDailyRows = useMemo(() => {
    if (!consumosAguaQuery.data) return [];
    return buildDailyConsumptionRows({
      rangeStart: desde,
      rangeEnd: hasta,
      consumos: consumosAguaQuery.data,
      basesKg: [],
      partes,
    });
  }, [consumosAguaQuery.data, partes, desde, hasta]);

  const entradas = useMemo<CosteEntrada[]>(() => {
    const lista: CosteEntrada[] = [];

    for (const row of aguaDailyRows) {
      if (row.aguaL > 0) {
        lista.push({ recurso: "agua", fecha: row.periodo, cantidad: row.aguaL, unidadConsumo: "l" });
      }
    }

    for (const sesion of sesionesQuery.data ?? []) {
      // Dia de referencia para resolver la tarifa vigente: el fin de la sesion.
      const fecha = sesion.fecha_fin;

      const gasoilL = solapeCantidadEnRango(sesion.fecha_inicio, sesion.fecha_fin, sesion.gasoil_l, desde, hasta);
      if (gasoilL > 0) lista.push({ recurso: "gasoil", fecha, cantidad: gasoilL, unidadConsumo: "l" });

      const electricidadKwh = solapeCantidadEnRango(sesion.fecha_inicio, sesion.fecha_fin, sesion.electricidad_total_kwh, desde, hasta);
      if (electricidadKwh > 0) lista.push({ recurso: "electricidad", fecha, cantidad: electricidadKwh, unidadConsumo: "kwh" });

      const quimicosL = solapeCantidadEnRango(sesion.fecha_inicio, sesion.fecha_fin, sesion.quimicos_drencher_l, desde, hasta);
      if (quimicosL > 0) lista.push({ recurso: "quimicos", fecha, cantidad: quimicosL, unidadConsumo: "l" });
    }

    return lista;
  }, [aguaDailyRows, sesionesQuery.data, desde, hasta]);

  const porRecurso = useMemo(() => agregarCostesPorRecurso(entradas, precios), [entradas, precios]);
  const serieSemanal = useMemo(() => agregarCostesPorSemana(entradas, precios), [entradas, precios]);

  const costeTotal = useMemo(() => porRecurso.reduce((total, r) => total + r.coste, 0), [porRecurso]);
  const kgProducidos = useMemo(() => partes.reduce((total, p) => total + kgProducidosParte(p), 0), [partes]);
  const costePorKg = kgProducidos > 0 ? costeTotal / kgProducidos : null;
  const hayPreciosACero = porRecurso.some((r) => r.cantidad > 0 && r.coste === 0);

  const isLoading = loadingPrecios || consumosAguaQuery.isLoading || sesionesQuery.isLoading || partesQuery.isLoading;

  return {
    porRecurso,
    costeTotal,
    kgProducidos,
    costePorKg,
    hayPreciosACero,
    serieSemanal,
    isLoading,
    sinPermiso,
  };
}

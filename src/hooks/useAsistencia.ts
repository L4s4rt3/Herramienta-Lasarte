/**
 * useAsistencia — cargas y mutaciones de la página de Asistencia (RRHH):
 * plantilla de trabajadores, asistencia/bajas laborales del día seleccionado,
 * parte diario de producción (para kg/persona), la asistencia de un PERIODO
 * cualquiera (semana, mes, campaña o rango a mano), qué días tienen datos
 * volcados y el histórico de eficiencia kg/persona.
 *
 * Dataset COMPARTIDO entre usuarios (UNIQUE(date, trabajador_id) en
 * asistencia_detalle, editado en vivo desde varias sesiones a la vez): las
 * lecturas JAMÁS filtran por user_id, solo por fecha/rango, igual que el
 * código legado (useState/useEffect manual) que sustituyen.
 *
 * staleTime: 0 + refetchOnMount: "always" en TODAS las queries de este hook,
 * a diferencia del default global (5 min de staleTime, refetchOnMount false
 * en src/lib/queryClient.ts): el código legado no cacheaba nada, así que cada
 * vez que se volvía a ver una fecha/semana ya visitada se recargaba de cero
 * desde el servidor. Para no perder ese refresco (importante en un dataset
 * compartido: otro usuario puede haber pasado lista mientras tanto) se anula
 * aquí el default global explícitamente.
 *
 * Las escrituras (alta/baja de presencia, importaciones Excel, vínculo de
 * nombres no resueltos) son useMutation con invalidación de las queryKeys de
 * las fechas afectadas, conservando el flujo optimista (toggleAsistencia) o
 * no-optimista (marcarTodosPresentes, limpiarAsistenciaDia) que ya tenían.
 */
import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthProvider";
import { supabase } from "@/integrations/supabase/client";
import { toError } from "@/lib/errorMessage";
import { toast } from "@/hooks/use-toast";
import { today, toISODateLocal } from "@/lib/format";
import { produccionRealParte } from "@/lib/asistenciaRendimiento";
import { previousIsoDate, shouldApplyBajaLaboralToDate } from "@/lib/asistenciaBajasLaborales";
import { aplicarZonasOperativasTrabajadores } from "@/lib/asistenciaTrabajadores";
import {
  ASISTENCIA_COMPARATIVA_RANGE_DAYS,
  buildSemanasAsistenciaComparativa,
  type SemanaComparativaData,
} from "@/lib/asistenciaComparativa";
import type { PeriodoAsistenciaRaw } from "@/lib/asistenciaSemanal";
import {
  enumerarDias,
  resumirCobertura,
  trocear,
  type CoberturaAsistencia,
  type DiaCoberturaRow,
} from "@/lib/asistenciaPeriodo";
import { fetchAllRows } from "@/lib/fetchAllRows";
import type { AsistenciaBajaLaboralRow, TrabajadorRow } from "@/lib/types";

export const BAJA_LABORAL_MOTIVO = "baja_laboral";

// Sin cache: ver comentario de cabecera. Se anula el default global de
// src/lib/queryClient.ts (staleTime 5 min, refetchOnMount false) para que
// cada vez que se observe una fecha/semana (incluida una ya visitada) se
// recargue de cero, igual que el useEffect manual que sustituye.
const SIN_CACHE = { staleTime: 0, refetchOnMount: "always" as const };

export interface ParteDiarioRendimiento {
  [key: string]: unknown;
  id?: string;
  resumen_ia?: unknown;
  kg_produccion_calibrador?: number | null;
  kg_industria_manual?: number | null;
  kg_mujeres_calibrador?: number | null;
  kg_reciclado_malla_z1?: number | null;
  kg_reciclado_malla_z2?: number | null;
  producto_dia?: ProductoConfeccionDia[];
}

export interface ProductoConfeccionDia {
  linea?: string | null;
  producto?: string | null;
  formato_caja?: string | null;
  kg?: number | string | null;
  kg_neto?: number | string | null;
  n_cajas?: number | string | null;
  grupo_destino?: string | null;
}

export interface EficienciaRow {
  rango: string;
  dias: number;
  kgMedia: number;
  kgPorPersona: number;
}

export interface AsistenciaUpsertRecord {
  user_id: string;
  date: string;
  trabajador_id: string;
  presente: boolean;
  motivo_ausencia: string | null;
}

// ─── QueryKeys ──────────────────────────────────────────────────────────────

export const ASISTENCIA_TRABAJADORES_KEY = ["asistencia", "trabajadores"] as const;
export const ASISTENCIA_EFICIENCIA_KEY = ["asistencia", "eficiencia"] as const;
export function asistenciaDiaKey(date: string) {
  return ["asistencia", "dia", date] as const;
}
export function asistenciaParteDiaKey(date: string) {
  return ["asistencia", "parte-dia", date] as const;
}
export function asistenciaPeriodoKey(desde: string, hasta: string) {
  return ["asistencia", "periodo", desde, hasta] as const;
}
export const ASISTENCIA_COBERTURA_KEY = ["asistencia", "cobertura"] as const;

/**
 * Todo lo que se calcula A PARTIR de asistencia_detalle y por tanto queda
 * desfasado en cuanto alguien pasa lista o importa un volcado: la vista de
 * periodo (cualquier rango) y el mapa de qué días tienen datos. Se llama
 * desde cada escritura, para que no haga falta recargar la página para que
 * un día recién marcado aparezca en el mes o en la cobertura.
 */
function invalidarAsistenciaDerivada(queryClient: ReturnType<typeof useQueryClient>) {
  void queryClient.invalidateQueries({ queryKey: ["asistencia", "periodo"] });
  void queryClient.invalidateQueries({ queryKey: ASISTENCIA_COBERTURA_KEY });
}

/** Toast estándar al asentarse un error de carga (no mientras sigue reintentando). */
function useToastOnQueryError(error: unknown, isFetching: boolean, title = "Error") {
  useEffect(() => {
    if (error instanceof Error && !isFetching) {
      toast({ title, description: error.message, variant: "destructive" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [error, isFetching]);
}

// ─── Trabajadores ───────────────────────────────────────────────────────────

/** Plantilla completa de trabajadores (activos e inactivos), con zonas operativas aplicadas. */
export function useAsistenciaTrabajadores() {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ASISTENCIA_TRABAJADORES_KEY,
    queryFn: async (): Promise<TrabajadorRow[]> => {
      const { data, error } = await supabase
        .from("trabajadores")
        .select("*")
        .order("nombre", { ascending: true });
      if (error) throw toError(error);
      return aplicarZonasOperativasTrabajadores(data ?? []);
    },
    ...SIN_CACHE,
  });

  useToastOnQueryError(query.error, query.isFetching);

  const crearTrabajador = useMutation({
    mutationFn: async (input: { userId: string; nombre: string; zona: string | null }) => {
      const { data, error } = await supabase
        .from("trabajadores")
        .insert({ user_id: input.userId, nombre: input.nombre, zona: input.zona })
        .select("id")
        .single();
      if (error) throw toError(error);
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ASISTENCIA_TRABAJADORES_KEY }),
  });

  return {
    trabajadores: query.data ?? [],
    query,
    crearTrabajador,
  };
}

// ─── Asistencia del día ─────────────────────────────────────────────────────

export interface AsistenciaDiaData {
  asistencia: Record<string, boolean>;
  asistenciaMotivos: Record<string, string | null>;
  bajasLaborales: AsistenciaBajaLaboralRow[];
}

async function fetchAsistenciaDia(date: string): Promise<AsistenciaDiaData> {
  const { data, error } = await supabase
    .from("asistencia_detalle")
    .select("trabajador_id, presente, motivo_ausencia")
    .eq("date", date);
  const { data: bajasData, error: bajasError } = await supabase
    .from("asistencia_bajas_laborales")
    .select("*")
    .lte("fecha_inicio", date)
    .or(`fecha_fin.is.null,fecha_fin.gte.${date}`);

  if (error || bajasError) {
    throw new Error(error?.message ?? bajasError?.message ?? "Error desconocido");
  }

  const bajasDelDia = (bajasData ?? []).filter((baja) => shouldApplyBajaLaboralToDate(baja, date));
  const asistencia: Record<string, boolean> = {};
  const asistenciaMotivos: Record<string, string | null> = {};
  for (const r of data ?? []) {
    asistencia[r.trabajador_id] = r.presente;
    asistenciaMotivos[r.trabajador_id] = r.motivo_ausencia ?? null;
  }
  for (const baja of bajasDelDia) {
    if (asistencia[baja.trabajador_id] !== true) {
      asistencia[baja.trabajador_id] = false;
      asistenciaMotivos[baja.trabajador_id] = BAJA_LABORAL_MOTIVO;
    }
  }
  return { asistencia, asistenciaMotivos, bajasLaborales: bajasDelDia };
}

/**
 * Asistencia/bajas laborales de una fecha concreta, con las mutaciones de
 * pase de lista (toggle, limpiar día, marcar todos presentes). `enabled:
 * Boolean(user)` reproduce el `if (!user) return;` del código legado.
 */
export function useAsistenciaDia(date: string) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const queryKey = asistenciaDiaKey(date);

  const query = useQuery({
    queryKey,
    queryFn: () => fetchAsistenciaDia(date),
    enabled: Boolean(user),
    ...SIN_CACHE,
  });

  useToastOnQueryError(query.error, query.isFetching);

  /** Cierra bajas laborales abiertas al marcar presente a un trabajador (mismo criterio que el código legado). */
  async function cerrarBajaLaboralAbierta(trabajadorId: string, fecha: string) {
    const actuales = queryClient.getQueryData<AsistenciaDiaData>(queryKey);
    const abiertas = (actuales?.bajasLaborales ?? []).filter(
      (baja) => baja.trabajador_id === trabajadorId && baja.fecha_fin == null && baja.fecha_inicio <= fecha,
    );
    if (abiertas.length === 0) return;

    for (const baja of abiertas) {
      if (baja.fecha_inicio >= fecha) {
        const { error } = await supabase.from("asistencia_bajas_laborales").delete().eq("id", baja.id);
        if (error) {
          toast({ title: "No se pudo cerrar la baja", description: error.message, variant: "destructive" });
          return;
        }
      } else {
        const { error } = await supabase
          .from("asistencia_bajas_laborales")
          .update({ fecha_fin: previousIsoDate(fecha) })
          .eq("id", baja.id);
        if (error) {
          toast({ title: "No se pudo cerrar la baja", description: error.message, variant: "destructive" });
          return;
        }
      }
    }

    queryClient.setQueryData<AsistenciaDiaData>(queryKey, (prev) =>
      prev
        ? { ...prev, bajasLaborales: prev.bajasLaborales.filter((baja) => !abiertas.some((item) => item.id === baja.id)) }
        : prev,
    );
  }

  /** Optimista: refleja el cambio antes de confirmar, revierte si falla (igual que el código legado). */
  const toggleAsistencia = useMutation({
    mutationFn: async (input: { trabajadorId: string; presente: boolean; motivoAusencia: string | null; userId: string }) => {
      const { error } = await supabase.from("asistencia_detalle").upsert(
        {
          user_id: input.userId,
          date,
          trabajador_id: input.trabajadorId,
          presente: input.presente,
          motivo_ausencia: input.presente ? null : input.motivoAusencia,
        },
        { onConflict: "date,trabajador_id" },
      );
      if (error) throw toError(error);
    },
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<AsistenciaDiaData>(queryKey);
      queryClient.setQueryData<AsistenciaDiaData>(queryKey, (prev) => {
        const base = prev ?? { asistencia: {}, asistenciaMotivos: {}, bajasLaborales: [] };
        return {
          ...base,
          asistencia: { ...base.asistencia, [input.trabajadorId]: input.presente },
          asistenciaMotivos: { ...base.asistenciaMotivos, [input.trabajadorId]: input.presente ? null : input.motivoAusencia },
        };
      });
      return { previous };
    },
    onError: (err, _input, context) => {
      if (context?.previous) queryClient.setQueryData(queryKey, context.previous);
      toast({ title: "Error", description: toError(err).message, variant: "destructive" });
      void queryClient.invalidateQueries({ queryKey });
    },
    onSuccess: async (_result, input) => {
      if (input.presente) await cerrarBajaLaboralAbierta(input.trabajadorId, date);
      invalidarAsistenciaDerivada(queryClient);
    },
  });

  /** No optimista: limpia solo tras confirmar el borrado en servidor (igual que el código legado espera antes de mostrar el toast). */
  const limpiarAsistenciaDia = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("asistencia_detalle").delete().eq("date", date);
      if (error) throw toError(error);
    },
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<AsistenciaDiaData>(queryKey);
      queryClient.setQueryData<AsistenciaDiaData>(queryKey, (prev) => (prev ? { ...prev, asistencia: {}, asistenciaMotivos: {} } : prev));
      return { previous };
    },
    onError: (err, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(queryKey, context.previous);
      toast({ title: "Error", description: toError(err).message, variant: "destructive" });
      void queryClient.invalidateQueries({ queryKey });
    },
    onSuccess: () => {
      invalidarAsistenciaDerivada(queryClient);
      toast({ title: "Asistencia del día limpiada" });
    },
  });

  const marcarTodosPresentes = useMutation({
    mutationFn: async (input: { activos: TrabajadorRow[]; userId: string }) => {
      const records = input.activos.map((t) => ({
        user_id: input.userId,
        date,
        trabajador_id: t.id,
        presente: true,
        motivo_ausencia: null,
      }));
      const { error } = await supabase.from("asistencia_detalle").upsert(records, { onConflict: "date,trabajador_id" });
      if (error) throw toError(error);
      return input.activos;
    },
    onSuccess: async (activos) => {
      const map: Record<string, boolean> = {};
      for (const t of activos) map[t.id] = true;
      queryClient.setQueryData<AsistenciaDiaData>(queryKey, (prev) => ({
        asistencia: map,
        asistenciaMotivos: {},
        bajasLaborales: prev?.bajasLaborales ?? [],
      }));
      for (const trabajador of activos) {
        await cerrarBajaLaboralAbierta(trabajador.id, date);
      }
      invalidarAsistenciaDerivada(queryClient);
      toast({ title: "Todos marcados como presentes" });
    },
    onError: (err) => {
      toast({ title: "Error", description: toError(err).message, variant: "destructive" });
    },
  });

  return {
    data: query.data,
    isFetching: query.isFetching,
    toggleAsistencia,
    limpiarAsistenciaDia,
    marcarTodosPresentes,
  };
}

/**
 * Upsert genérico de registros de asistencia_detalle (importaciones Excel y
 * vínculo retroactivo de nombres no resueltos), no ligado a una fecha
 * concreta: invalida la query de "dia" de cada fecha presente en los
 * registros para que, si está siendo observada, se refresque sola.
 */
export function useUpsertAsistenciaRegistros() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (records: AsistenciaUpsertRecord[]) => {
      const { error } = await supabase.from("asistencia_detalle").upsert(records, { onConflict: "date,trabajador_id" });
      if (error) throw toError(error);
      return records;
    },
    onSuccess: async (records) => {
      const fechas = new Set(records.map((r) => r.date));
      await Promise.all(
        Array.from(fechas).map((fecha) => queryClient.invalidateQueries({ queryKey: asistenciaDiaKey(fecha) })),
      );
      invalidarAsistenciaDerivada(queryClient);
    },
  });
}

// ─── Parte del día (producción, para kg/persona) ───────────────────────────

async function fetchParteDelDia(date: string): Promise<ParteDiarioRendimiento | null> {
  const { data, error } = await supabase
    .from("partes_diarios")
    .select("id, resumen_ia, kg_produccion_calibrador, kg_industria_manual, kg_mujeres_calibrador, kg_reciclado_malla_z1, kg_reciclado_malla_z2")
    .eq("date", date)
    .maybeSingle();
  if (error || !data) return null;

  const { data: productoDia } = await supabase
    .from("producto_dia")
    .select("linea, producto, formato_caja, kg, n_cajas, grupo_destino")
    .eq("part_id", data.id);
  return { ...data, producto_dia: productoDia ?? [] };
}

/** Parte diario de producción de la fecha (para kg/persona y clasificación de productos). Sin toast de error: el código legado tampoco lo mostraba. */
export function useParteDelDia(date: string) {
  const query = useQuery({
    queryKey: asistenciaParteDiaKey(date),
    queryFn: () => fetchParteDelDia(date),
    ...SIN_CACHE,
  });

  return { parteDelDia: query.data ?? null, query };
}

// ─── Periodo (semana, mes, campaña o rango a mano) ──────────────────────────
//
// Hasta el 17-09-2026 esto solo sabía cargar UNA semana (`.in("date", dates)`
// con las 7 fechas, y un SELECT de producto_dia por cada parte). Para un mes o
// una campaña las dos cosas se rompen:
//   · el `.in` de 365 fechas no cabe en la URL de PostgREST, y las ~15.000
//     filas de asistencia_detalle de una campaña pasan del tope de 1.000 filas
//     que el servidor recorta EN SILENCIO (ver src/lib/fetchAllRows.ts);
//   · el SELECT por parte serían 250 idas y venidas.
// Ahora se filtra por rango (gte/lte) con fetchAllRows, y la producción se
// carga aparte y solo al exportar (ver cargarProduccionPeriodo).

const ASISTENCIA_PERIODO_ERROR_GENERICO = "Error al cargar la asistencia del periodo";
const ASISTENCIA_PERIODO_ERROR_INESPERADO = "Error inesperado al cargar la asistencia del periodo";

/** Ids por tanda en los `.in(...)`: 80 UUID son ~3 KB de URL, muy por debajo del límite. */
const IDS_POR_TANDA = 80;

interface AsistenciaPeriodoFila {
  trabajador_id: string;
  date: string;
  presente: boolean;
  motivo_ausencia: string | null;
}

/**
 * La asistencia del periodo, SIN producción: la vista de pantalla es solo
 * asistencia (presentes / ausentes / bajas / sin marcar), así lo pidió el
 * dueño. Traer los partes y sus productos aquí cargaría de más cada vez que
 * se cambia de mes para nada.
 */
export async function cargarAsistenciaPeriodo(desde: string, hasta: string): Promise<PeriodoAsistenciaRaw> {
  const dates = enumerarDias(desde, hasta);

  try {
    const [asistenciaFilas, bajasRes, trabajadoresRes] = await Promise.all([
      // Orden estable (date + trabajador_id, que son la clave única de la
      // tabla) porque fetchAllRows pagina: sin él una fila podría repetirse o
      // saltarse entre páginas.
      fetchAllRows<AsistenciaPeriodoFila>((from, to) =>
        supabase
          .from("asistencia_detalle")
          .select("trabajador_id, date, presente, motivo_ausencia")
          .gte("date", desde)
          .lte("date", hasta)
          .order("date", { ascending: true })
          .order("trabajador_id", { ascending: true })
          .range(from, to),
      ),
      supabase.from("asistencia_bajas_laborales").select("*").lte("fecha_inicio", hasta).or(`fecha_fin.is.null,fecha_fin.gte.${desde}`),
      supabase.from("trabajadores").select("*").order("nombre", { ascending: true }),
    ]);

    if (bajasRes.error || trabajadoresRes.error) {
      throw new Error(ASISTENCIA_PERIODO_ERROR_GENERICO);
    }

    const asistenciaMap: PeriodoAsistenciaRaw["asistencia"] = {};
    for (const r of asistenciaFilas) {
      if (!asistenciaMap[r.trabajador_id]) asistenciaMap[r.trabajador_id] = [];
      asistenciaMap[r.trabajador_id].push({ date: r.date, presente: r.presente, motivo_ausencia: r.motivo_ausencia });
    }

    return {
      desde,
      hasta,
      days: dates,
      trabajadores: aplicarZonasOperativasTrabajadores(trabajadoresRes.data ?? []),
      asistencia: asistenciaMap,
      bajasLaborales: bajasRes.data ?? [],
      partes: {},
    };
  } catch (err) {
    if (err instanceof Error && err.message === ASISTENCIA_PERIODO_ERROR_GENERICO) throw err;
    throw new Error(ASISTENCIA_PERIODO_ERROR_INESPERADO);
  }
}

/** Asistencia de un rango de fechas. `habilitada` evita cargar cuando la vista activa es la del día. */
export function useAsistenciaPeriodo(desde: string, hasta: string, habilitada: boolean) {
  const { user } = useAuth();
  const query = useQuery({
    queryKey: asistenciaPeriodoKey(desde, hasta),
    queryFn: () => cargarAsistenciaPeriodo(desde, hasta),
    enabled: habilitada && Boolean(user) && Boolean(desde) && Boolean(hasta),
    ...SIN_CACHE,
  });

  useToastOnQueryError(query.error, query.isFetching);

  return { periodoData: query.data ?? null, isFetching: query.isFetching };
}

/**
 * Los partes de producción del periodo con su producto_dia, indexados por
 * fecha. Se llama BAJO DEMANDA desde el botón de exportar (el informe Excel sí
 * lleva kg/persona, rendimiento por zona, kg por sección y productos), no en
 * cada cambio de periodo de la pantalla.
 */
export async function cargarProduccionPeriodo(desde: string, hasta: string): Promise<PeriodoAsistenciaRaw["partes"]> {
  const partes = await fetchAllRows<{ id: string; date: string } & Record<string, unknown>>((from, to) =>
    supabase
      .from("partes_diarios")
      .select("id, date, resumen_ia, kg_produccion_calibrador, kg_industria_manual, kg_mujeres_calibrador, kg_reciclado_malla_z1, kg_reciclado_malla_z2")
      .gte("date", desde)
      .lte("date", hasta)
      .order("date", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to),
  );

  const partesMap: PeriodoAsistenciaRaw["partes"] = {};
  const productosPorParte = new Map<string, ProductoConfeccionDia[]>();

  // producto_dia no tiene fecha: se pide por part_id, en tandas para que la
  // lista de ids no reviente la URL (una campaña son ~250 partes).
  for (const tanda of trocear(partes.map((p) => p.id), IDS_POR_TANDA)) {
    const filas = await fetchAllRows<{ part_id: string } & ProductoConfeccionDia>((from, to) =>
      supabase
        .from("producto_dia")
        .select("part_id, linea, producto, formato_caja, kg, n_cajas, grupo_destino")
        .in("part_id", tanda)
        .order("id", { ascending: true })
        .range(from, to),
    );
    for (const fila of filas) {
      const lista = productosPorParte.get(fila.part_id) ?? [];
      lista.push(fila);
      productosPorParte.set(fila.part_id, lista);
    }
  }

  for (const parte of partes) {
    partesMap[parte.date] = { ...parte, producto_dia: productosPorParte.get(parte.id) ?? [] };
  }
  return partesMap;
}

// ─── Cobertura: desde cuándo hasta cuándo hay asistencia ───────────────────

/**
 * Un renglón por día CON registros (vista `asistencia_cobertura_dia`). Con
 * esto la página puede decir "hay datos del 18 may al 13 sep" y señalar los
 * días laborables que faltan por volcar, sin que nadie tenga que ir pasando
 * semana a semana. Son ~100 filas hoy y ~300 por campaña; aun así se pagina,
 * que es la regla para cualquier SELECT sin tope por diseño.
 */
export function useAsistenciaCobertura() {
  const { user } = useAuth();
  const query = useQuery({
    queryKey: ASISTENCIA_COBERTURA_KEY,
    queryFn: async (): Promise<CoberturaAsistencia> => {
      const filas = await fetchAllRows<DiaCoberturaRow>((from, to) =>
        supabase
          .from("asistencia_cobertura_dia")
          .select("fecha, registros, presentes, ausentes")
          .order("fecha", { ascending: true })
          .range(from, to),
      );
      return resumirCobertura(filas);
    },
    enabled: Boolean(user),
    ...SIN_CACHE,
  });

  useToastOnQueryError(query.error, query.isFetching, "Error al leer qué días tienen asistencia");

  return { cobertura: query.data ?? null, isFetching: query.isFetching };
}

// ─── Eficiencia histórica (60 días, aún sin panel de visualización) ───────

async function fetchAsistenciaEficiencia(): Promise<EficienciaRow[]> {
  const until = today();
  const from = toISODateLocal(new Date(Date.now() - 60 * 24 * 60 * 60 * 1000));

  const { data: attendance } = await supabase
    .from("asistencia_detalle")
    .select("date, presente")
    .gte("date", from)
    .lte("date", until);

  const dayWorkers: Record<string, number> = {};
  for (const r of attendance ?? []) {
    if (r.presente) dayWorkers[r.date] = (dayWorkers[r.date] ?? 0) + 1;
  }

  const { data: production } = await supabase
    .from("partes_diarios")
    .select("date, resumen_ia, kg_produccion_calibrador, kg_industria_manual, kg_mujeres_calibrador, kg_reciclado_malla_z1, kg_reciclado_malla_z2")
    .gte("date", from)
    .lte("date", until);

  const kgByDay: Record<string, number> = {};
  for (const r of production ?? []) {
    const kg = produccionRealParte(r) || Number(r.kg_produccion_calibrador) || 0;
    if (kg > 0) kgByDay[r.date] = (kgByDay[r.date] ?? 0) + kg;
  }

  const buckets: Record<string, { days: number; totalKg: number; totalWorkers: number }> = {};
  for (const [date, workers] of Object.entries(dayWorkers)) {
    const kg = kgByDay[date] ?? 0;
    if (kg === 0) continue;
    let bucket: string;
    if (workers <= 5) bucket = "1–5";
    else if (workers <= 10) bucket = "6–10";
    else if (workers <= 15) bucket = "11–15";
    else if (workers <= 20) bucket = "16–20";
    else if (workers <= 25) bucket = "21–25";
    else bucket = "26+";
    if (!buckets[bucket]) buckets[bucket] = { days: 0, totalKg: 0, totalWorkers: 0 };
    buckets[bucket].days++;
    buckets[bucket].totalKg += kg;
    buckets[bucket].totalWorkers += workers;
  }

  return Object.entries(buckets)
    .sort(([a], [b]) => {
      const aMin = parseInt(a.replace(/\D/g, "")) || 0;
      const bMin = parseInt(b.replace(/\D/g, "")) || 0;
      return aMin - bMin;
    })
    .map(([rango, data]) => ({
      rango,
      dias: data.days,
      kgMedia: data.days > 0 ? data.totalKg / data.days : 0,
      kgPorPersona: data.totalWorkers > 0 ? data.totalKg / data.totalWorkers : 0,
    }));
}

/** Histórico de eficiencia kg/persona (60 días). Aún sin panel de visualización dedicado; sin toast de error, igual que el código legado. */
export function useAsistenciaEficiencia() {
  const query = useQuery({
    queryKey: ASISTENCIA_EFICIENCIA_KEY,
    queryFn: fetchAsistenciaEficiencia,
  });
  return { eficiencia: query.data ?? [], isLoading: query.isLoading };
}

// ─── Comparativa semanal exportable (bajo demanda, sin cache) ─────────────

/** Semanas exportables (comparativa Excel/PDF) del rango de los últimos ASISTENCIA_COMPARATIVA_RANGE_DAYS días. Se llama bajo demanda desde el botón de exportar, no es una query cacheada. */
export async function cargarSemanasAsistenciaExportables(): Promise<SemanaComparativaData[]> {
  const until = today();
  const from = toISODateLocal(new Date(Date.now() - ASISTENCIA_COMPARATIVA_RANGE_DAYS * 24 * 60 * 60 * 1000));

  const { data: attendance, error: attendanceError } = await supabase
    .from("asistencia_detalle")
    .select("date, presente, trabajador_id")
    .gte("date", from)
    .lte("date", until);
  if (attendanceError) throw attendanceError;

  const { data: trabajadoresExport, error: trabajadoresError } = await supabase
    .from("trabajadores")
    .select("id, zona");
  if (trabajadoresError) throw trabajadoresError;

  const { data: production, error: productionError } = await supabase
    .from("partes_diarios")
    .select("id, date, resumen_ia, kg_produccion_calibrador, kg_industria_manual, kg_mujeres_calibrador, kg_reciclado_malla_z1, kg_reciclado_malla_z2")
    .gte("date", from)
    .lte("date", until);
  if (productionError) throw productionError;

  return buildSemanasAsistenciaComparativa({
    asistencia: attendance,
    trabajadores: trabajadoresExport,
    produccion: production,
  });
}

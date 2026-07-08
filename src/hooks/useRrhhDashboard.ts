/**
 * useRrhhDashboard — agrega los datos del "Panel de RRHH" (nueva portada de
 * la sección, sustituye a la comparativa suelta que vivía en Asistencia):
 * plantilla activa, asistencia de hoy/semana, bajas laborales activas,
 * comparativa semanal de kg/persona (mismo cálculo que
 * src/pages/AsistenciaComparativa.tsx) y un vistazo a las tablas rrhh_*
 * (justificantes sin resolver, últimas amonestaciones, próximas vacaciones).
 *
 * trabajadores / asistencia_detalle / asistencia_bajas_laborales /
 * partes_diarios ya están en el Database generado (tipos normales, sin
 * cast). Las tablas rrhh_* tienen RLS restringido a rrhh/admin: se usa el
 * mismo cast local `SUPA` + patrón `sinPermiso` que
 * src/hooks/useRrhhPersonas.ts y src/hooks/useRrhhDocs.ts para que el panel
 * degrade con un aviso en vez de romperse cuando el usuario no tiene ese rol.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useAuth } from "@/contexts/AuthProvider";
import { supabase } from "@/integrations/supabase/client";
import { toError } from "@/lib/errorMessage";
import { today, toISODateLocal } from "@/lib/format";
import {
  calcularRendimientoGrupos,
  calcularResumenKgPersonaOperacion,
  cuentaTrabajadorKgPersona,
  produccionRealParte,
  RENDIMIENTO_GRUPOS,
  type RendimientoGrupoKey,
} from "@/lib/asistenciaRendimiento";
import {
  calcularRendimientoZonasAlmacen,
  type RendimientoZonaAlmacen,
} from "@/lib/asistenciaPlantilla";
import {
  ASISTENCIA_COMPARATIVA_RANGE_DAYS,
  buildSemanasAsistenciaComparativa,
  type SemanaComparativaData,
} from "@/lib/asistenciaComparativa";

// Cast local: las tablas rrhh_* aun conviven con RLS estricta rrhh/admin.
// Mismo patron que useRrhhPersonas.ts / useRrhhDocs.ts.
const SUPA = supabase as unknown as SupabaseClient<any>;

const BAJA_LABORAL_MOTIVO = "baja_laboral";
const PERMISSION_DENIED_CODES = new Set(["42501", "PGRST301"]);

function isPermissionDeniedError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const record = error as { code?: string; message?: string };
  if (record.code && PERMISSION_DENIED_CODES.has(record.code)) return true;
  const message = (record.message ?? "").toLowerCase();
  return message.includes("permission denied") || message.includes("rls");
}

function getWeekStartMonday(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00`);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(d);
  monday.setDate(diff);
  return toISODateLocal(monday);
}

// ─── Tipos expuestos ────────────────────────────────────────────────────────

export type RrhhGravedad = "leve" | "grave" | "muy_grave";

export interface RrhhAmonestacionResumen {
  id: string;
  trabajadorId: string;
  nombre: string;
  fecha: string;
  motivo: string;
  gravedad: RrhhGravedad;
}

export interface RrhhVacacionProximaResumen {
  id: string;
  trabajadorId: string;
  nombre: string;
  fechaInicio: string;
  fechaFin: string;
  diasNaturales: number;
}

export interface RrhhBajaActivaResumen {
  id: string;
  trabajadorId: string;
  nombre: string;
  fechaInicio: string;
  motivo: string;
}

export interface RrhhZonaResumen {
  zona: string;
  total: number;
}

export function useRrhhDashboard() {
  const { user } = useAuth();
  const hoy = today();
  const weekStart = useMemo(() => getWeekStartMonday(hoy), [hoy]);
  const comparativaDesde = useMemo(
    () => toISODateLocal(new Date(Date.now() - ASISTENCIA_COMPARATIVA_RANGE_DAYS * 24 * 60 * 60 * 1000)),
    [],
  );

  // ─── Plantilla ──────────────────────────────────────────────────────────
  const trabajadoresQuery = useQuery({
    queryKey: ["rrhh-dashboard", "trabajadores"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("trabajadores")
        .select("id, nombre, zona, activo, computa_kg_persona")
        .order("nombre", { ascending: true });
      if (error) throw toError(error);
      return data ?? [];
    },
    enabled: Boolean(user),
  });

  // ─── Asistencia + producción reciente (comparativa y KPIs de hoy/semana) ─
  const asistenciaQuery = useQuery({
    queryKey: ["rrhh-dashboard", "asistencia", comparativaDesde, hoy],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("asistencia_detalle")
        .select("date, presente, trabajador_id, motivo_ausencia")
        .gte("date", comparativaDesde)
        .lte("date", hoy);
      if (error) throw toError(error);
      return data ?? [];
    },
    enabled: Boolean(user),
  });

  const produccionQuery = useQuery({
    queryKey: ["rrhh-dashboard", "produccion", comparativaDesde, hoy],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("partes_diarios")
        .select("id, date, resumen_ia, kg_produccion_calibrador, kg_industria_manual, kg_mujeres_calibrador, kg_reciclado_malla_z1, kg_reciclado_malla_z2")
        .gte("date", comparativaDesde)
        .lte("date", hoy);
      if (error) throw toError(error);
      return data ?? [];
    },
    enabled: Boolean(user),
  });

  const bajasQuery = useQuery({
    queryKey: ["rrhh-dashboard", "bajas", hoy],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("asistencia_bajas_laborales")
        .select("*")
        .or(`fecha_fin.is.null,fecha_fin.gte.${hoy}`)
        .order("fecha_inicio", { ascending: false });
      if (error) throw toError(error);
      return data ?? [];
    },
    enabled: Boolean(user),
  });

  // ─── rrhh_* (RLS rrhh/admin — degrada con sinPermisoRrhh) ────────────────
  const justificantesQuery = useQuery({
    queryKey: ["rrhh-dashboard", "justificantes", comparativaDesde],
    queryFn: async () => {
      const { data, error } = await SUPA
        .from("rrhh_justificantes")
        .select("trabajador_id, fecha")
        .gte("fecha", comparativaDesde);
      if (error) throw error;
      return (data ?? []) as { trabajador_id: string; fecha: string }[];
    },
    enabled: Boolean(user),
    retry: (failureCount: number, error: unknown) => (isPermissionDeniedError(error) ? false : failureCount < 2),
  });

  const amonestacionesQuery = useQuery({
    queryKey: ["rrhh-dashboard", "amonestaciones"],
    queryFn: async () => {
      const { data, error } = await SUPA
        .from("rrhh_amonestaciones")
        .select("id, trabajador_id, fecha, motivo, gravedad")
        .order("fecha", { ascending: false })
        .limit(5);
      if (error) throw error;
      return (data ?? []) as { id: string; trabajador_id: string; fecha: string; motivo: string; gravedad: RrhhGravedad }[];
    },
    enabled: Boolean(user),
    retry: (failureCount: number, error: unknown) => (isPermissionDeniedError(error) ? false : failureCount < 2),
  });

  const vacacionesQuery = useQuery({
    queryKey: ["rrhh-dashboard", "vacaciones"],
    queryFn: async () => {
      const { data, error } = await SUPA
        .from("rrhh_vacaciones_periodos")
        .select("id, trabajador_id, fecha_inicio, fecha_fin, dias_naturales")
        .order("fecha_inicio", { ascending: true });
      if (error) throw error;
      return (data ?? []) as { id: string; trabajador_id: string; fecha_inicio: string; fecha_fin: string; dias_naturales: number }[];
    },
    enabled: Boolean(user),
    retry: (failureCount: number, error: unknown) => (isPermissionDeniedError(error) ? false : failureCount < 2),
  });

  const sinPermisoRrhh =
    isPermissionDeniedError(justificantesQuery.error) ||
    isPermissionDeniedError(amonestacionesQuery.error) ||
    isPermissionDeniedError(vacacionesQuery.error);

  // ─── Plantilla derivada ───────────────────────────────────────────────────
  const trabajadores = useMemo(() => trabajadoresQuery.data ?? [], [trabajadoresQuery.data]);
  const activos = useMemo(() => trabajadores.filter((t) => t.activo), [trabajadores]);
  const trabajadoresPorId = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of trabajadores) map.set(t.id, t.nombre);
    return map;
  }, [trabajadores]);

  const activosPorZona: RrhhZonaResumen[] = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of activos) {
      const zona = t.zona?.trim() || "Sin grupo";
      map.set(zona, (map.get(zona) ?? 0) + 1);
    }
    return Array.from(map.entries())
      .map(([zona, total]) => ({ zona, total }))
      .sort((a, b) => b.total - a.total);
  }, [activos]);

  const computablesKgPersona = useMemo(
    () => activos.filter((t) => cuentaTrabajadorKgPersona(t)).length,
    [activos],
  );

  // ─── Asistencia derivada (último día con datos / semana / justificantes) ─
  // Las asistencias se registran al día siguiente (la lista de un día se pasa
  // a la mañana siguiente), así que "hoy" normalmente todavía no tiene
  // registros. Los KPIs de asistencia puntual se calculan sobre el último día
  // con datos reales en asistencia_detalle, no sobre "hoy", para no mostrar un
  // 0%/0 engañoso. El panel es de solo consulta: no se ofrece marcar
  // asistencia de hoy desde aquí.
  const asistencia = useMemo(() => asistenciaQuery.data ?? [], [asistenciaQuery.data]);

  const ultimoDiaConDatos = useMemo(() => {
    let max: string | null = null;
    for (const r of asistencia) {
      if (max === null || r.date > max) max = r.date;
    }
    return max;
  }, [asistencia]);

  const ayer = useMemo(() => toISODateLocal(new Date(Date.now() - 24 * 60 * 60 * 1000)), []);
  // Fecha por defecto para el selector de día del bloque de rendimiento: el
  // último día con asistencia registrada, o ayer si todavía no hay ninguno.
  const ultimoDiaConAsistencia = ultimoDiaConDatos ?? ayer;
  const hayAsistenciaRegistrada = ultimoDiaConDatos !== null;

  const asistenciaUltimoDia = useMemo(
    () => (ultimoDiaConDatos ? asistencia.filter((r) => r.date === ultimoDiaConDatos) : []),
    [asistencia, ultimoDiaConDatos],
  );
  const presentesUltimoDia = useMemo(
    () => new Set(asistenciaUltimoDia.filter((r) => r.presente).map((r) => r.trabajador_id)).size,
    [asistenciaUltimoDia],
  );
  const pctAsistenciaUltimoDia =
    hayAsistenciaRegistrada && activos.length > 0
      ? Math.round((presentesUltimoDia / activos.length) * 100)
      : null;

  const ausenciasSemana = useMemo(
    () => asistencia.filter((r) => r.date >= weekStart && r.date <= hoy && r.presente === false).length,
    [asistencia, weekStart, hoy],
  );

  const justificadas = useMemo(() => {
    const set = new Set<string>();
    for (const j of justificantesQuery.data ?? []) set.add(`${j.trabajador_id}__${j.fecha}`);
    return set;
  }, [justificantesQuery.data]);

  // "Sin resolver" = ausencia (no baja laboral) del periodo sin justificante adjunto.
  // Si no hay permiso sobre rrhh_justificantes no podemos saberlo: se expone 0 y
  // la página debe apoyarse en `sinPermisoRrhh` para no mostrar un dato engañoso.
  const justificantesPendientes = useMemo(() => {
    if (sinPermisoRrhh) return 0;
    return asistencia.filter((r) => {
      if (r.presente !== false) return false;
      if (r.motivo_ausencia === BAJA_LABORAL_MOTIVO) return false;
      return !justificadas.has(`${r.trabajador_id}__${r.date}`);
    }).length;
  }, [asistencia, justificadas, sinPermisoRrhh]);

  // ─── Bajas activas ────────────────────────────────────────────────────────
  const bajasActivas: RrhhBajaActivaResumen[] = useMemo(
    () => (bajasQuery.data ?? [])
      .filter((b) => b.fecha_fin == null)
      .map((b) => ({
        id: b.id,
        trabajadorId: b.trabajador_id,
        nombre: trabajadoresPorId.get(b.trabajador_id) ?? "Trabajador desconocido",
        fechaInicio: b.fecha_inicio,
        motivo: b.motivo,
      })),
    [bajasQuery.data, trabajadoresPorId],
  );

  // ─── Amonestaciones / vacaciones (rrhh_*) ─────────────────────────────────
  const amonestacionesRecientes: RrhhAmonestacionResumen[] = useMemo(
    () => (amonestacionesQuery.data ?? []).map((a) => ({
      id: a.id,
      trabajadorId: a.trabajador_id,
      nombre: trabajadoresPorId.get(a.trabajador_id) ?? "Trabajador desconocido",
      fecha: a.fecha,
      motivo: a.motivo,
      gravedad: a.gravedad,
    })),
    [amonestacionesQuery.data, trabajadoresPorId],
  );

  const vacacionesProximas: RrhhVacacionProximaResumen[] = useMemo(
    () => (vacacionesQuery.data ?? [])
      .filter((v) => v.fecha_fin >= hoy)
      .slice(0, 5)
      .map((v) => ({
        id: v.id,
        trabajadorId: v.trabajador_id,
        nombre: trabajadoresPorId.get(v.trabajador_id) ?? "Trabajador desconocido",
        fechaInicio: v.fecha_inicio,
        fechaFin: v.fecha_fin,
        diasNaturales: v.dias_naturales,
      })),
    [vacacionesQuery.data, trabajadoresPorId, hoy],
  );

  const diasVacacionesAnioActual = useMemo(() => {
    const anio = hoy.slice(0, 4);
    return (vacacionesQuery.data ?? [])
      .filter((v) => v.fecha_inicio.startsWith(anio))
      .reduce((sum, v) => sum + (Number(v.dias_naturales) || 0), 0);
  }, [vacacionesQuery.data, hoy]);

  // ─── Comparativa semanal (mismo calculo que AsistenciaComparativa.tsx) ───
  const semanas: SemanaComparativaData[] = useMemo(() => buildSemanasAsistenciaComparativa({
    asistencia,
    trabajadores: trabajadores.map((t) => ({ id: t.id, zona: t.zona })),
    produccion: produccionQuery.data ?? [],
  }), [asistencia, trabajadores, produccionQuery.data]);

  const isLoading =
    trabajadoresQuery.isLoading ||
    asistenciaQuery.isLoading ||
    produccionQuery.isLoading ||
    bajasQuery.isLoading;

  const isLoadingRrhh =
    justificantesQuery.isLoading || amonestacionesQuery.isLoading || vacacionesQuery.isLoading;

  return {
    isLoading,
    isLoadingRrhh,
    sinPermisoRrhh,

    plantillaActiva: activos.length,
    activosPorZona,
    computablesKgPersona,

    ultimoDiaConAsistencia,
    hayAsistenciaRegistrada,
    presentesUltimoDia,
    pctAsistenciaUltimoDia,
    ausenciasSemana,
    justificantesPendientes,

    bajasActivas,
    amonestacionesRecientes,
    vacacionesProximas,
    diasVacacionesAnioActual,

    semanas,
  };
}

// ─── Rendimiento de un día concreto ─────────────────────────────────────────
// Mismo cálculo que usaba src/pages/Asistencia.tsx (parte del día + producto_dia
// + asistencia_detalle + trabajadores → calcularRendimientoGrupos /
// calcularRendimientoZonasAlmacen / calcularResumenKgPersonaOperacion), ahora
// parametrizado por fecha para el selector de día del Panel de RRHH.

const RENDIMIENTO_GROUP_LABELS: Record<RendimientoGrupoKey, string> = {
  Envasadoras: "Mesas",
  Industria: "Industria",
  Mallas: "Mallas",
  Graneleras: "Graneleras",
};

export interface RrhhGrupoRendimientoResumen {
  grupo: RendimientoGrupoKey;
  label: string;
  kg: number;
  personas: number;
  kgPersona: number;
  porcentajeKg: number;
  /** 0-1, relativo al grupo con más kg del día — para barras. */
  pct: number;
  objetivo: number | null;
}

interface ParteDiaRendimiento {
  [key: string]: unknown;
  id: string;
  resumen_ia: unknown;
  kg_produccion_calibrador: number | null;
  kg_mujeres_calibrador: number | null;
  kg_reciclado_malla_z1: number | null;
  kg_reciclado_malla_z2: number | null;
  producto_dia: { linea?: string | null; producto?: string | null; formato_caja?: string | null; kg?: number | string | null; n_cajas?: number | string | null; grupo_destino?: string | null }[];
}

export function useRendimientoDia(fecha: string) {
  const { user } = useAuth();

  const parteQuery = useQuery({
    queryKey: ["rrhh-dashboard", "rendimiento-parte", fecha],
    queryFn: async (): Promise<ParteDiaRendimiento | null> => {
      const { data, error } = await supabase
        .from("partes_diarios")
        .select("id, resumen_ia, kg_produccion_calibrador, kg_mujeres_calibrador, kg_reciclado_malla_z1, kg_reciclado_malla_z2")
        .eq("date", fecha)
        .maybeSingle();
      if (error) throw toError(error);
      if (!data) return null;

      const { data: productoDia, error: productoError } = await supabase
        .from("producto_dia")
        .select("linea, producto, formato_caja, kg, n_cajas, grupo_destino")
        .eq("part_id", data.id);
      if (productoError) throw toError(productoError);

      return { ...data, producto_dia: productoDia ?? [] };
    },
    enabled: Boolean(user) && Boolean(fecha),
  });

  const asistenciaDiaQuery = useQuery({
    queryKey: ["rrhh-dashboard", "rendimiento-asistencia", fecha],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("asistencia_detalle")
        .select("trabajador_id, presente")
        .eq("date", fecha);
      if (error) throw toError(error);
      return data ?? [];
    },
    enabled: Boolean(user) && Boolean(fecha),
  });

  // Mismo queryKey que la plantilla del panel principal (arriba): comparte
  // caché de react-query, no dispara una segunda llamada a "trabajadores".
  const trabajadoresDiaQuery = useQuery({
    queryKey: ["rrhh-dashboard", "trabajadores"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("trabajadores")
        .select("id, nombre, zona, activo, computa_kg_persona")
        .order("nombre", { ascending: true });
      if (error) throw toError(error);
      return data ?? [];
    },
    enabled: Boolean(user),
  });

  const trabajadores = useMemo(() => trabajadoresDiaQuery.data ?? [], [trabajadoresDiaQuery.data]);
  const activos = useMemo(() => trabajadores.filter((t) => t.activo), [trabajadores]);

  const asistenciaMap = useMemo(() => {
    const map: Record<string, boolean> = {};
    for (const r of asistenciaDiaQuery.data ?? []) map[r.trabajador_id] = r.presente === true;
    return map;
  }, [asistenciaDiaQuery.data]);

  const parte = parteQuery.data ?? null;

  const kgProduccionDia = useMemo(
    () => (parte ? (produccionRealParte(parte) || Number(parte.kg_produccion_calibrador) || 0) : 0),
    [parte],
  );

  const resumenKgPersona = useMemo(
    () => calcularResumenKgPersonaOperacion({ trabajadores: activos, asistencia: asistenciaMap, kgProduccionDia }),
    [activos, asistenciaMap, kgProduccionDia],
  );

  const rendimientoGrupos = useMemo(
    () => calcularRendimientoGrupos({ parte, trabajadores: activos, asistencia: asistenciaMap }),
    [parte, activos, asistenciaMap],
  );

  const rendimientoZonasAlmacen = useMemo(() => calcularRendimientoZonasAlmacen({
    trabajadores,
    asistencia: asistenciaMap,
    kgPorZona: {
      mallas: rendimientoGrupos.Mallas.kg,
      granelRp: rendimientoGrupos.Graneleras.kg,
      mesas: rendimientoGrupos.Envasadoras.kg,
      industria: rendimientoGrupos.Industria.kg,
    },
  }), [trabajadores, asistenciaMap, rendimientoGrupos]);

  const rendimientoZonaByGrupo = useMemo(() => new Map<RendimientoGrupoKey, RendimientoZonaAlmacen | undefined>([
    ["Envasadoras", rendimientoZonasAlmacen.zonas.find((z) => z.id === "mesas")],
    ["Industria", rendimientoZonasAlmacen.zonas.find((z) => z.id === "industria")],
    ["Mallas", rendimientoZonasAlmacen.zonas.find((z) => z.id === "mallas")],
    ["Graneleras", rendimientoZonasAlmacen.zonas.find((z) => z.id === "granelRp")],
  ]), [rendimientoZonasAlmacen]);

  const grupos: RrhhGrupoRendimientoResumen[] = useMemo(() => {
    const maxKg = Math.max(...RENDIMIENTO_GRUPOS.map((g) => rendimientoGrupos[g].kg), 1);
    const totalKgGrupos = RENDIMIENTO_GRUPOS.reduce((sum, g) => sum + rendimientoGrupos[g].kg, 0);
    return RENDIMIENTO_GRUPOS.map((g) => {
      const zona = rendimientoZonaByGrupo.get(g);
      const kg = rendimientoGrupos[g].kg;
      return {
        grupo: g,
        label: RENDIMIENTO_GROUP_LABELS[g],
        kg,
        personas: zona?.presentes ?? rendimientoGrupos[g].personas,
        kgPersona: zona?.kgPersonaPresentes ?? (rendimientoGrupos[g].personas > 0 ? kg / rendimientoGrupos[g].personas : 0),
        porcentajeKg: totalKgGrupos > 0 ? (kg / totalKgGrupos) * 100 : 0,
        pct: kg / maxKg,
        objetivo: zona?.objetivo ?? null,
      };
    });
  }, [rendimientoGrupos, rendimientoZonaByGrupo]);

  const isLoading = parteQuery.isLoading || asistenciaDiaQuery.isLoading || trabajadoresDiaQuery.isLoading;
  const hayParte = parte != null;
  const hayAsistencia = (asistenciaDiaQuery.data ?? []).length > 0;

  return {
    fecha,
    isLoading,
    hayDatos: hayParte || hayAsistencia,
    hayParte,
    kgProduccionDia,
    kgPersonaGeneral: resumenKgPersona.kgPersona,
    presentes: resumenKgPersona.presentes,
    presentesComputables: resumenKgPersona.presentesComputables,
    fueraKgPersona: resumenKgPersona.fueraKgPersona,
    grupos,
  };
}

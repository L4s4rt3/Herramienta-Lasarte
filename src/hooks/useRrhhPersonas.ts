/**
 * useRrhhPersonas — plantilla de trabajadores (listado + ficha individual) para
 * la sección "Plantilla" de RRHH: datos base de `trabajadores` (con las columnas
 * nuevas categoria_profesional/fecha_alta/vacaciones_dias_anuales) + historial de
 * cada persona repartido en varias tablas rrhh_* (RLS solo rrhh/admin).
 *
 * IMPORTANTE: ninguna de las tablas rrhh_* (ni las columnas nuevas de
 * `trabajadores`) existe todavia en src/integrations/supabase/types.ts. Se usa
 * el cast `SUPA` local, copiando el patron exacto de
 * src/hooks/useMercadonaVentas.ts: cuando se regeneren los tipos, sustituir los
 * `as any`/`SUPA` por los tipos generados (`Tables<"rrhh_...">`) y eliminar el
 * cast.
 *
 * Las tablas rrhh_* tienen RLS restringido a rrhh/admin. Si el usuario actual
 * no tiene ese rol, Postgres devuelve un error de permiso (42501) o RLS filtra
 * todo a vacio; en el primer caso se detecta y se expone `sinPermiso` para que
 * la pagina muestre "Solo RRHH y administración" en vez de un error crudo.
 */
import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useAuth } from "@/contexts/AuthProvider";
import { supabase } from "@/integrations/supabase/client";
import { toError } from "@/lib/errorMessage";

// Cast local: las tablas/columnas rrhh_* aun no estan en el Database generado.
// Ver comentario de cabecera para el plan de retirada de este cast.
const SUPA = supabase as unknown as SupabaseClient<any>;

const RRHH_DOCS_BUCKET = "rrhh-docs";
const PERMISSION_DENIED_CODES = new Set(["42501", "PGRST301"]);

function isPermissionDeniedError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const record = error as { code?: string; message?: string };
  if (record.code && PERMISSION_DENIED_CODES.has(record.code)) return true;
  const message = (record.message ?? "").toLowerCase();
  return message.includes("permission denied") || message.includes("rls");
}

// ─── Tipos ──────────────────────────────────────────────────────────────────

export interface TrabajadorPlantillaRow {
  id: string;
  user_id: string;
  nombre: string;
  zona: string | null;
  activo: boolean;
  categoria_profesional: string | null;
  fecha_alta: string | null;
  vacaciones_dias_anuales: number;
  /**
   * Override manual de si el trabajador computa para el kg/persona diario.
   * null = automático según la zona (ver cuentaTrabajadorKgPersona en
   * src/lib/asistenciaRendimiento.ts); true/false fuerzan el valor.
   */
  computa_kg_persona: boolean | null;
  email: string | null;
  telefono: string | null;
  dni: string | null;
  created_at: string;
}

/** Baja laboral ABIERTA (fecha_fin IS NULL) de un trabajador. */
export interface BajaAbiertaRow {
  id: string;
  trabajador_id: string;
  fecha_inicio: string;
  motivo: string;
}

export interface AsistenciaDetalleFaltaRow {
  trabajador_id: string;
  date: string;
  presente: boolean;
  motivo_ausencia: string | null;
}

export interface AsistenciaBajaLaboralHistRow {
  id: string;
  trabajador_id: string;
  fecha_inicio: string;
  fecha_fin: string | null;
  motivo: string;
}

export interface RrhhJustificanteRow {
  id: string;
  trabajador_id: string;
  fecha: string;
  notas: string | null;
  archivo_path: string | null;
  archivo_nombre: string | null;
  created_at: string;
}

export type RrhhGravedad = "leve" | "grave" | "muy_grave";

export interface RrhhAmonestacionRow {
  id: string;
  trabajador_id: string;
  fecha: string;
  motivo: string;
  gravedad: RrhhGravedad;
  archivo_path: string | null;
  archivo_nombre: string | null;
  notas: string | null;
  created_at: string;
}

export interface RrhhVacacionPeriodoRow {
  id: string;
  trabajador_id: string;
  fecha_inicio: string;
  fecha_fin: string;
  dias_naturales: number;
  notas: string | null;
  created_at: string;
}

export interface RrhhHorasRow {
  id: string;
  trabajador_id: string;
  fecha: string;
  horas: number;
  motivo: string | null;
  created_at: string;
}

export interface RrhhNominaRow {
  id: string;
  trabajador_id: string;
  anio: number;
  mes: number;
  archivo_path: string | null;
  archivo_nombre: string | null;
  notas: string | null;
  created_at: string;
}

export interface RrhhFichaPersona {
  faltas: AsistenciaDetalleFaltaRow[];
  bajas: AsistenciaBajaLaboralHistRow[];
  justificantes: RrhhJustificanteRow[];
  amonestaciones: RrhhAmonestacionRow[];
  vacaciones: RrhhVacacionPeriodoRow[];
  horas: RrhhHorasRow[];
  nominas: RrhhNominaRow[];
}

const FICHA_VACIA: RrhhFichaPersona = {
  faltas: [],
  bajas: [],
  justificantes: [],
  amonestaciones: [],
  vacaciones: [],
  horas: [],
  nominas: [],
};

// ─── Listado de plantilla ───────────────────────────────────────────────────

export function useRrhhPlantilla() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const queryKey = ["rrhh-plantilla"] as const;
  const bajasQueryKey = ["rrhh-plantilla-bajas-abiertas"] as const;

  const query = useQuery({
    queryKey,
    queryFn: async (): Promise<TrabajadorPlantillaRow[]> => {
      const { data, error } = await SUPA
        .from("trabajadores")
        .select("*")
        .order("nombre", { ascending: true });
      if (error) throw toError(error);
      return (data ?? []).map((t: any) => ({
        ...t,
        vacaciones_dias_anuales: t.vacaciones_dias_anuales ?? 30,
      })) as TrabajadorPlantillaRow[];
    },
    enabled: Boolean(user),
  });

  // Bajas laborales ABIERTAS de toda la plantilla (una consulta para todos, en
  // vez de una por trabajador): fecha_fin IS NULL = baja en curso.
  const bajasQuery = useQuery({
    queryKey: bajasQueryKey,
    queryFn: async (): Promise<BajaAbiertaRow[]> => {
      const { data, error } = await SUPA
        .from("asistencia_bajas_laborales")
        .select("id, trabajador_id, fecha_inicio, motivo")
        .is("fecha_fin", null);
      if (error) throw toError(error);
      return (data ?? []) as BajaAbiertaRow[];
    },
    enabled: Boolean(user),
  });

  const trabajadores = useMemo(() => query.data ?? [], [query.data]);

  const bajaAbiertaPorTrabajador = useMemo(() => {
    const map = new Map<string, BajaAbiertaRow>();
    for (const b of bajasQuery.data ?? []) map.set(b.trabajador_id, b);
    return map;
  }, [bajasQuery.data]);

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey });
    queryClient.invalidateQueries({ queryKey: bajasQueryKey });
    queryClient.invalidateQueries({ queryKey: ["rrhh-ficha"] });
  };

  function withDuplicateNombreError<T>(fn: () => Promise<T>): Promise<T> {
    return fn().catch((error) => {
      // UNIQUE(nombre): el dataset de trabajadores es compartido entre secciones.
      if ((error as { code?: string }).code === "23505") {
        const dupError = new Error("Ya existe un trabajador con ese nombre.") as Error & { code: string };
        dupError.code = "23505";
        throw dupError;
      }
      throw error;
    });
  }

  const updateFicha = useMutation({
    mutationFn: async (input: {
      id: string;
      nombre?: string;
      zona?: string | null;
      categoria_profesional?: string | null;
      fecha_alta?: string | null;
      vacaciones_dias_anuales?: number;
      computa_kg_persona?: boolean | null;
      email?: string | null;
      telefono?: string | null;
      dni?: string | null;
    }) => {
      const { id, ...patch } = input;
      if (patch.nombre !== undefined) {
        const nombre = patch.nombre.trim();
        if (!nombre) throw new Error("El nombre no puede quedar vacío.");
        patch.nombre = nombre;
      }
      await withDuplicateNombreError(async () => {
        const { error } = await SUPA.from("trabajadores").update(patch).eq("id", id);
        if (error) throw toError(error);
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
    },
  });

  const altaTrabajador = useMutation({
    mutationFn: async (input: {
      nombre: string;
      zona: string;
      categoria_profesional?: string | null;
      fecha_alta?: string | null;
      vacaciones_dias_anuales?: number;
      computa_kg_persona?: boolean | null;
      email?: string | null;
      telefono?: string | null;
      dni?: string | null;
    }) => {
      const nombre = input.nombre.trim();
      if (!nombre) throw new Error("El nombre no puede quedar vacío.");
      const zona = input.zona.trim();
      if (!zona) throw new Error("La zona / puesto no puede quedar vacío.");
      if (!user) throw new Error("Sesión no válida.");
      await withDuplicateNombreError(async () => {
        const { error } = await SUPA.from("trabajadores").insert({
          user_id: user.id,
          nombre,
          zona,
          activo: true,
          categoria_profesional: input.categoria_profesional?.trim() || null,
          fecha_alta: input.fecha_alta || null,
          vacaciones_dias_anuales: input.vacaciones_dias_anuales ?? 30,
          computa_kg_persona: input.computa_kg_persona ?? null,
          email: input.email?.trim() || null,
          telefono: input.telefono?.trim() || null,
          dni: input.dni?.trim() || null,
        });
        if (error) throw toError(error);
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
    },
  });

  const setActivo = useMutation({
    mutationFn: async (input: { id: string; activo: boolean }) => {
      const { error } = await SUPA.from("trabajadores").update({ activo: input.activo }).eq("id", input.id);
      if (error) throw toError(error);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
    },
  });

  const darDeBaja = useMutation({
    mutationFn: async (input: { trabajador_id: string; fecha_inicio: string; motivo?: string | null }) => {
      const { error } = await SUPA.from("asistencia_bajas_laborales").insert({
        trabajador_id: input.trabajador_id,
        fecha_inicio: input.fecha_inicio,
        fecha_fin: null,
        motivo: input.motivo?.trim() || "Baja laboral",
      });
      if (error) throw toError(error);
    },
    onSuccess: invalidateAll,
  });

  const darDeAlta = useMutation({
    mutationFn: async (input: { id: string; fecha_fin: string }) => {
      const { error } = await SUPA.from("asistencia_bajas_laborales").update({ fecha_fin: input.fecha_fin }).eq("id", input.id);
      if (error) throw toError(error);
    },
    onSuccess: invalidateAll,
  });

  return {
    trabajadores,
    bajaAbiertaPorTrabajador,
    isLoading: query.isLoading || bajasQuery.isLoading,
    error: query.error,
    updateFicha,
    altaTrabajador,
    setActivo,
    darDeBaja,
    darDeAlta,
  };
}

// ─── Ficha individual ───────────────────────────────────────────────────────

export function useRrhhFichaPersona(trabajadorId: string | null) {
  const queryKey = ["rrhh-ficha", trabajadorId] as const;

  const query = useQuery({
    queryKey,
    queryFn: async (): Promise<RrhhFichaPersona> => {
      if (!trabajadorId) return FICHA_VACIA;

      const [faltasRes, bajasRes, justRes, amonRes, vacRes, horasRes, nomRes] = await Promise.all([
        SUPA
          .from("asistencia_detalle")
          .select("trabajador_id, date, presente, motivo_ausencia")
          .eq("trabajador_id", trabajadorId)
          .eq("presente", false)
          .order("date", { ascending: false }),
        SUPA
          .from("asistencia_bajas_laborales")
          .select("id, trabajador_id, fecha_inicio, fecha_fin, motivo")
          .eq("trabajador_id", trabajadorId)
          .order("fecha_inicio", { ascending: false }),
        SUPA
          .from("rrhh_justificantes")
          .select("*")
          .eq("trabajador_id", trabajadorId)
          .order("fecha", { ascending: false }),
        SUPA
          .from("rrhh_amonestaciones")
          .select("*")
          .eq("trabajador_id", trabajadorId)
          .order("fecha", { ascending: false }),
        SUPA
          .from("rrhh_vacaciones_periodos")
          .select("*")
          .eq("trabajador_id", trabajadorId)
          .order("fecha_inicio", { ascending: false }),
        SUPA
          .from("rrhh_horas")
          .select("*")
          .eq("trabajador_id", trabajadorId)
          .order("fecha", { ascending: false }),
        SUPA
          .from("rrhh_nominas")
          .select("*")
          .eq("trabajador_id", trabajadorId)
          .order("anio", { ascending: false })
          .order("mes", { ascending: false }),
      ]);

      // faltas/bajas viven en tablas de Asistencia (sin RLS especial): si fallan,
      // es un error real y se relanza. Las rrhh_* son las que pueden venir
      // bloqueadas por RLS a rrhh/admin.
      if (faltasRes.error) throw toError(faltasRes.error);
      if (bajasRes.error) throw toError(bajasRes.error);

      const rrhhErrors = [justRes.error, amonRes.error, vacRes.error, horasRes.error, nomRes.error].filter(Boolean);
      if (rrhhErrors.length > 0 && rrhhErrors.every((e) => isPermissionDeniedError(e))) {
        const permError = new Error("Solo RRHH y administración") as Error & { code: string };
        permError.code = "RRHH_SIN_PERMISO";
        throw permError;
      }
      for (const e of rrhhErrors) {
        if (e && !isPermissionDeniedError(e)) throw toError(e);
      }

      return {
        faltas: (faltasRes.data ?? []) as AsistenciaDetalleFaltaRow[],
        bajas: (bajasRes.data ?? []) as AsistenciaBajaLaboralHistRow[],
        justificantes: justRes.error ? [] : ((justRes.data ?? []) as RrhhJustificanteRow[]),
        amonestaciones: amonRes.error ? [] : ((amonRes.data ?? []) as RrhhAmonestacionRow[]),
        vacaciones: vacRes.error ? [] : ((vacRes.data ?? []) as RrhhVacacionPeriodoRow[]),
        horas: horasRes.error ? [] : ((horasRes.data ?? []) as RrhhHorasRow[]),
        nominas: nomRes.error ? [] : ((nomRes.data ?? []) as RrhhNominaRow[]),
      };
    },
    enabled: Boolean(trabajadorId),
  });

  const sinPermiso = query.error != null && (query.error as { code?: string }).code === "RRHH_SIN_PERMISO";

  return {
    ficha: query.data ?? FICHA_VACIA,
    isLoading: query.isLoading,
    error: query.error,
    sinPermiso,
  };
}

/** URL firmada (60s) de un archivo del bucket privado "rrhh-docs" (justificantes/nominas/amonestaciones). */
export async function urlDescargaRrhhDoc(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from(RRHH_DOCS_BUCKET).createSignedUrl(path, 60);
  if (error) throw toError(error);
  if (!data?.signedUrl) throw new Error("No se pudo generar el enlace de descarga.");
  return data.signedUrl;
}

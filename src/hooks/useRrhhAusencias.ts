/**
 * useRrhhAusencias — datos de la sección "Ausencias y bajas" de RRHH:
 * cruza asistencia_detalle (faltas del periodo), asistencia_bajas_laborales
 * (bajas activas/recientes), trabajadores y rrhh_justificantes (justificantes
 * adjuntados a una falta puntual).
 *
 * IMPORTANTE: rrhh_justificantes es una tabla NUEVA que NO existe todavia en
 * src/integrations/supabase/types.ts (infraestructura pendiente de aplicar/
 * regenerar tipos). Se usa el cast `SUPA` de mas abajo, copiando el patron
 * exacto de src/hooks/useMercadonaVentas.ts: cuando se regeneren los tipos,
 * sustituir los `as any` por `Tables<"rrhh_justificantes">` y eliminar el cast.
 *
 * RLS: la tabla solo es legible/escribible por roles rrhh/admin. Si el select
 * devuelve un error de permiso (Postgres 42501 / "permission denied" /
 * PostgREST equivalente), se expone `forbidden` para que la página degrade
 * con el aviso "Solo RRHH y administración" en vez de un error crudo.
 */
import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { endOfWeek, parseISO, startOfWeek } from "date-fns";
import { useAuth } from "@/contexts/AuthProvider";
import { supabase } from "@/integrations/supabase/client";
import { toError } from "@/lib/errorMessage";
import { idCortoStorage, sanearNombreArchivo } from "@/lib/cmrArchivo";
import { toISODateLocal } from "@/lib/format";
import type { AsistenciaBajaLaboralRow, TrabajadorRow } from "@/lib/types";

// Cast local: la tabla rrhh_justificantes aun no esta en el Database generado.
// Ver comentario de cabecera para el plan de retirada de este cast.
const SUPA = supabase as unknown as SupabaseClient<any>;

const BUCKET = "rrhh-docs";

const PERMISSION_DENIED_CODES = new Set(["42501", "PGRST301"]);

function isPermissionDeniedError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const record = error as { code?: string; message?: string };
  if (record.code && PERMISSION_DENIED_CODES.has(record.code)) return true;
  const message = (record.message ?? "").toLowerCase();
  return message.includes("permission denied") || message.includes("rls");
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

export interface AusenciaDetalleRow {
  trabajador_id: string;
  date: string;
  motivo_ausencia: string | null;
}

export interface FaltaConEstado {
  trabajadorId: string;
  nombre: string;
  fecha: string;
  motivo: string | null;
  justificante: RrhhJustificanteRow | null;
}

export interface RrhhAusenciasFiltros {
  desde: string;
  hasta: string;
}

/** Faltas agrupadas por semana ISO (lunes-domingo), ya con recuentos de justificadas/sin justificar. */
export interface SemanaAusencias {
  /** Clave estable de la semana: fecha (YYYY-MM-DD) del lunes de inicio. */
  claveSemana: string;
  inicio: Date;
  fin: Date;
  faltas: FaltaConEstado[];
  total: number;
  justificadas: number;
  sinJustificar: number;
}

/**
 * Agrupa una lista de faltas (ya filtrada por la página: persona, sin-justificar, etc.)
 * en semanas ISO lunes-domingo, ordenadas de más reciente a más antigua. Es un helper
 * puro (sin estado ni queries) para que la página lo use tanto sobre `faltas` como sobre
 * cualquier subconjunto filtrado en cliente.
 */
export function agruparFaltasPorSemana(faltas: FaltaConEstado[]): SemanaAusencias[] {
  const grupos = new Map<string, FaltaConEstado[]>();
  for (const falta of faltas) {
    const inicioSemana = startOfWeek(parseISO(falta.fecha), { weekStartsOn: 1 });
    const clave = toISODateLocal(inicioSemana);
    const grupo = grupos.get(clave);
    if (grupo) grupo.push(falta);
    else grupos.set(clave, [falta]);
  }

  return Array.from(grupos.entries())
    .map(([clave, faltasSemana]) => {
      const inicio = parseISO(clave);
      const fin = endOfWeek(inicio, { weekStartsOn: 1 });
      const justificadas = faltasSemana.filter((f) => f.justificante).length;
      return {
        claveSemana: clave,
        inicio,
        fin,
        faltas: faltasSemana,
        total: faltasSemana.length,
        justificadas,
        sinJustificar: faltasSemana.length - justificadas,
      };
    })
    .sort((a, b) => b.claveSemana.localeCompare(a.claveSemana));
}

const BAJA_LABORAL_MOTIVO = "baja_laboral";

function justificanteKey(trabajadorId: string, fecha: string): string {
  return `${trabajadorId}__${fecha}`;
}

/** Datos crudos del periodo: faltas, trabajadores, bajas laborales y justificantes. */
export function useRrhhAusencias({ desde, hasta }: RrhhAusenciasFiltros) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const baseKey = ["rrhh-ausencias", desde, hasta] as const;

  const trabajadoresQuery = useQuery({
    queryKey: ["rrhh-ausencias", "trabajadores"],
    queryFn: async (): Promise<TrabajadorRow[]> => {
      const { data, error } = await supabase
        .from("trabajadores")
        .select("*")
        .order("nombre", { ascending: true });
      if (error) throw toError(error);
      return (data ?? []) as TrabajadorRow[];
    },
    enabled: Boolean(user),
  });

  const faltasQuery = useQuery({
    queryKey: [...baseKey, "faltas"],
    queryFn: async (): Promise<AusenciaDetalleRow[]> => {
      const { data, error } = await supabase
        .from("asistencia_detalle")
        .select("trabajador_id, date, presente, motivo_ausencia")
        .eq("presente", false)
        .gte("date", desde)
        .lte("date", hasta)
        .order("date", { ascending: false });
      if (error) throw toError(error);
      return (data ?? []).map((row) => ({
        trabajador_id: row.trabajador_id,
        date: row.date,
        motivo_ausencia: row.motivo_ausencia ?? null,
      }));
    },
    enabled: Boolean(user),
  });

  const bajasQuery = useQuery({
    queryKey: [...baseKey, "bajas"],
    queryFn: async (): Promise<AsistenciaBajaLaboralRow[]> => {
      const { data, error } = await supabase
        .from("asistencia_bajas_laborales")
        .select("*")
        .or(`fecha_fin.is.null,fecha_fin.gte.${desde}`)
        .order("fecha_inicio", { ascending: false });
      if (error) throw toError(error);
      return (data ?? []) as AsistenciaBajaLaboralRow[];
    },
    enabled: Boolean(user),
  });

  const justificantesQuery = useQuery({
    queryKey: [...baseKey, "justificantes"],
    queryFn: async (): Promise<RrhhJustificanteRow[]> => {
      const { data, error } = await SUPA
        .from("rrhh_justificantes")
        .select("*")
        .gte("fecha", desde)
        .lte("fecha", hasta);
      if (error) throw error;
      return (data ?? []) as RrhhJustificanteRow[];
    },
    enabled: Boolean(user),
    retry: (failureCount, error) => (isPermissionDeniedError(error) ? false : failureCount < 2),
  });

  const forbidden = isPermissionDeniedError(justificantesQuery.error);

  const trabajadoresPorId = useMemo(() => {
    const map = new Map<string, TrabajadorRow>();
    for (const t of trabajadoresQuery.data ?? []) map.set(t.id, t);
    return map;
  }, [trabajadoresQuery.data]);

  const justificantesPorClave = useMemo(() => {
    const map = new Map<string, RrhhJustificanteRow>();
    for (const j of justificantesQuery.data ?? []) {
      map.set(justificanteKey(j.trabajador_id, j.fecha), j);
    }
    return map;
  }, [justificantesQuery.data]);

  const faltas: FaltaConEstado[] = useMemo(() => {
    return (faltasQuery.data ?? []).map((falta) => ({
      trabajadorId: falta.trabajador_id,
      nombre: trabajadoresPorId.get(falta.trabajador_id)?.nombre ?? "Trabajador desconocido",
      fecha: falta.date,
      motivo: falta.motivo_ausencia,
      justificante: justificantesPorClave.get(justificanteKey(falta.trabajador_id, falta.date)) ?? null,
    }));
  }, [faltasQuery.data, trabajadoresPorId, justificantesPorClave]);

  const bajasActivas = useMemo(
    () => (bajasQuery.data ?? []).filter((baja) => baja.fecha_fin == null),
    [bajasQuery.data],
  );

  const isLoading = trabajadoresQuery.isLoading || faltasQuery.isLoading || bajasQuery.isLoading;

  /** URL firmada de descarga/visualización del justificante (bucket privado, 60s de validez). */
  const urlJustificante = async (path: string): Promise<string> => {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 60);
    if (error) throw toError(error);
    if (!data?.signedUrl) throw new Error("No se pudo generar el enlace de descarga.");
    return data.signedUrl;
  };

  const justificarFalta = useMutation({
    mutationFn: async (input: { trabajadorId: string; fecha: string; notas: string; archivo: File | null }) => {
      if (!user) throw new Error("Debes iniciar sesion para justificar una falta.");
      if (!input.notas.trim() && !input.archivo) {
        throw new Error("Escribe una nota o adjunta un justificante.");
      }

      let archivoPath: string | null = null;
      let archivoNombre: string | null = null;
      if (input.archivo) {
        archivoPath = `justificantes/${idCortoStorage()}-${sanearNombreArchivo(input.archivo.name)}`;
        archivoNombre = input.archivo.name;
        const { error: uploadError } = await supabase.storage.from(BUCKET).upload(archivoPath, input.archivo);
        if (uploadError) throw toError(uploadError);
      }

      const { error: insertError } = await SUPA.from("rrhh_justificantes").insert({
        trabajador_id: input.trabajadorId,
        fecha: input.fecha,
        notas: input.notas.trim() || null,
        archivo_path: archivoPath,
        archivo_nombre: archivoNombre,
      });
      if (insertError) throw insertError;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["rrhh-ausencias"] });
    },
  });

  return {
    trabajadores: trabajadoresQuery.data ?? [],
    faltas,
    bajas: bajasQuery.data ?? [],
    bajasActivas,
    isLoading,
    forbidden,
    error: faltasQuery.error ?? bajasQuery.error ?? trabajadoresQuery.error,
    urlJustificante,
    justificarFalta,
  };
}

export { BAJA_LABORAL_MOTIVO };

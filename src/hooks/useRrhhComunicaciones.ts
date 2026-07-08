/**
 * useRrhhComunicaciones — sección "RRHH → Comunicaciones": avisos automáticos
 * (horas acumuladas, saldo de vacaciones) y correos personalizados a la
 * plantilla, enviados vía la Edge Function `enviar-comunicacion` (Resend).
 *
 * Si el dueño todavía no ha dado de alta la API key de Resend, la función
 * responde { enviado:false, motivo:"no_configurado" } — no es un error: la
 * comunicación se guarda igualmente en `rrhh_comunicaciones` con estado
 * "borrador" para que se pueda enviar en cuanto se active el servicio.
 *
 * IMPORTANTE: rrhh_comunicaciones es una tabla NUEVA que todavía no está en
 * src/integrations/supabase/types.ts (infraestructura pendiente de aplicar/
 * regenerar tipos). Se usa el mismo cast local `SUPA` que el resto de hooks
 * rrhh (useRrhhVacaciones.ts, useRrhhAusencias.ts, useRrhhDocs.ts). Las
 * columnas email/telefono/dni de trabajadores tampoco están en el Database
 * generado todavía, así que se leen por el mismo cast.
 *
 * RLS: rrhh_comunicaciones solo es accesible para rrhh/admin — se expone
 * `sinPermiso` con el mismo patrón que el resto de hooks rrhh para que la
 * página degrade con el aviso "Solo RRHH y administración" en vez de un
 * error crudo.
 */
import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useAuth } from "@/contexts/AuthProvider";
import { supabase } from "@/integrations/supabase/client";
import { toError } from "@/lib/errorMessage";
import { saldoVacaciones, type PeriodoVacaciones } from "@/lib/rrhhVacaciones";
import { today } from "@/lib/format";

// Cast local: rrhh_comunicaciones y las columnas email/telefono/dni de
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

// ─── Tipos ──────────────────────────────────────────────────────────────────

export type ComunicacionTipo = "personalizado" | "aviso_horas" | "aviso_vacaciones" | "aviso_generico";
export type ComunicacionEstado = "borrador" | "enviado" | "error" | "parcial";

export interface RrhhTrabajadorComunicacion {
  id: string;
  nombre: string;
  email: string | null;
  zona: string | null;
  activo: boolean;
  /** Suma de rrhh_horas (positivas y negativas). */
  horasAcumuladas: number;
  /** Saldo de vacaciones (devengadas - disfrutadas) del año en curso. */
  vacacionesSaldo: number;
}

export interface DestinatarioComunicacion {
  trabajador_id: string;
  nombre: string;
  email: string;
  horas?: number;
  vacaciones?: number;
}

export interface FalloEnvio {
  email: string;
  error: string;
}

export interface RrhhComunicacionRow {
  id: string;
  tipo: ComunicacionTipo;
  asunto: string;
  cuerpo: string;
  destinatarios: DestinatarioComunicacion[];
  estado: ComunicacionEstado;
  detalle_envio: { enviados?: number; fallidos?: FalloEnvio[]; motivo?: string; error?: string | null } | null;
  enviado_at: string | null;
  created_at: string;
}

export interface EnviarComunicacionResultado {
  estado: ComunicacionEstado;
  totalDestinatarios: number;
  enviados: number;
  fallidos: FalloEnvio[];
  motivo?: string;
}

interface TrabajadorRawRow {
  id: string;
  nombre: string;
  email: string | null;
  zona: string | null;
  activo: boolean;
  fecha_alta: string | null;
  vacaciones_dias_anuales: number | null;
}

interface HoraRawRow {
  trabajador_id: string;
  horas: number;
}

/** Forma de la respuesta 200 de la Edge Function `enviar-comunicacion`. */
interface RespuestaEdgeFunction {
  enviado: boolean;
  motivo?: string;
  enviados?: number;
  fallidos?: FalloEnvio[];
}

export function useRrhhComunicaciones() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const hoy = today();

  const trabajadoresQuery = useQuery({
    queryKey: ["rrhh-comunicaciones", "trabajadores"],
    queryFn: async (): Promise<TrabajadorRawRow[]> => {
      const { data, error } = await SUPA
        .from("trabajadores")
        .select("id, nombre, email, zona, activo, fecha_alta, vacaciones_dias_anuales")
        .eq("activo", true)
        .order("nombre", { ascending: true });
      if (error) throw error;
      return (data ?? []) as TrabajadorRawRow[];
    },
    enabled: Boolean(user),
    retry: (failureCount, error) => (isPermissionDeniedError(error) ? false : failureCount < 2),
  });

  const horasQuery = useQuery({
    queryKey: ["rrhh-comunicaciones", "horas"],
    queryFn: async (): Promise<HoraRawRow[]> => {
      const { data, error } = await SUPA.from("rrhh_horas").select("trabajador_id, horas");
      if (error) throw error;
      return (data ?? []) as HoraRawRow[];
    },
    enabled: Boolean(user),
    retry: (failureCount, error) => (isPermissionDeniedError(error) ? false : failureCount < 2),
  });

  const periodosQuery = useQuery({
    queryKey: ["rrhh-comunicaciones", "periodos"],
    queryFn: async (): Promise<(PeriodoVacaciones & { trabajador_id: string })[]> => {
      const { data, error } = await SUPA
        .from("rrhh_vacaciones_periodos")
        .select("trabajador_id, fecha_inicio, fecha_fin, dias_naturales");
      if (error) throw error;
      return (data ?? []) as (PeriodoVacaciones & { trabajador_id: string })[];
    },
    enabled: Boolean(user),
    retry: (failureCount, error) => (isPermissionDeniedError(error) ? false : failureCount < 2),
  });

  const historialQuery = useQuery({
    queryKey: ["rrhh-comunicaciones", "historial"],
    queryFn: async (): Promise<RrhhComunicacionRow[]> => {
      const { data, error } = await SUPA
        .from("rrhh_comunicaciones")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as RrhhComunicacionRow[];
    },
    enabled: Boolean(user),
    retry: (failureCount, error) => (isPermissionDeniedError(error) ? false : failureCount < 2),
  });

  const sinPermiso =
    isPermissionDeniedError(trabajadoresQuery.error) ||
    isPermissionDeniedError(horasQuery.error) ||
    isPermissionDeniedError(periodosQuery.error) ||
    isPermissionDeniedError(historialQuery.error);

  // ─── Trabajadores con saldos calculados ──────────────────────────────────
  const trabajadores: RrhhTrabajadorComunicacion[] = useMemo(() => {
    const horasPorTrabajador = new Map<string, number>();
    for (const h of horasQuery.data ?? []) {
      horasPorTrabajador.set(h.trabajador_id, (horasPorTrabajador.get(h.trabajador_id) ?? 0) + (Number(h.horas) || 0));
    }

    const periodosPorTrabajador = new Map<string, PeriodoVacaciones[]>();
    for (const p of periodosQuery.data ?? []) {
      const lista = periodosPorTrabajador.get(p.trabajador_id) ?? [];
      lista.push({ fecha_inicio: p.fecha_inicio, fecha_fin: p.fecha_fin, dias_naturales: p.dias_naturales });
      periodosPorTrabajador.set(p.trabajador_id, lista);
    }

    return (trabajadoresQuery.data ?? []).map((t) => {
      const saldo = saldoVacaciones(
        { fechaAlta: t.fecha_alta, hasta: hoy, diasAnuales: t.vacaciones_dias_anuales ?? 30 },
        periodosPorTrabajador.get(t.id) ?? [],
      );
      return {
        id: t.id,
        nombre: t.nombre,
        email: t.email,
        zona: t.zona,
        activo: t.activo,
        horasAcumuladas: horasPorTrabajador.get(t.id) ?? 0,
        vacacionesSaldo: saldo.saldo,
      };
    });
  }, [trabajadoresQuery.data, horasQuery.data, periodosQuery.data, hoy]);

  const zonas = useMemo(() => {
    const set = new Set<string>();
    for (const t of trabajadores) if (t.zona && t.zona.trim()) set.add(t.zona.trim());
    return Array.from(set).sort((a, b) => a.localeCompare(b, "es"));
  }, [trabajadores]);

  const conEmail = useMemo(() => trabajadores.filter((t) => Boolean(t.email && t.email.trim())), [trabajadores]);
  const sinEmail = useMemo(() => trabajadores.filter((t) => !t.email || !t.email.trim()), [trabajadores]);

  // ─── Construcción de destinatarios ────────────────────────────────────────

  function aDestinatario(t: RrhhTrabajadorComunicacion, incluirValores: boolean): DestinatarioComunicacion | null {
    const email = t.email?.trim();
    if (!email) return null;
    const destinatario: DestinatarioComunicacion = { trabajador_id: t.id, nombre: t.nombre, email };
    if (incluirValores) {
      destinatario.horas = Math.round(t.horasAcumuladas * 10) / 10;
      destinatario.vacaciones = Math.round(t.vacacionesSaldo * 10) / 10;
    }
    return destinatario;
  }

  /** Destinatarios a partir de una lista de ids de trabajador (selección individual). */
  function destinatariosDeIds(ids: string[], incluirValores = false): DestinatarioComunicacion[] {
    const set = new Set(ids);
    return trabajadores
      .filter((t) => set.has(t.id))
      .map((t) => aDestinatario(t, incluirValores))
      .filter((d): d is DestinatarioComunicacion => d != null);
  }

  /** Destinatarios de una zona concreta. */
  function destinatariosDeZona(zona: string, incluirValores = false): DestinatarioComunicacion[] {
    return trabajadores
      .filter((t) => (t.zona ?? "").trim() === zona)
      .map((t) => aDestinatario(t, incluirValores))
      .filter((d): d is DestinatarioComunicacion => d != null);
  }

  /** Destinatarios de toda la plantilla activa. */
  function destinatariosTodos(incluirValores = false): DestinatarioComunicacion[] {
    return trabajadores
      .map((t) => aDestinatario(t, incluirValores))
      .filter((d): d is DestinatarioComunicacion => d != null);
  }

  // ─── Envío ─────────────────────────────────────────────────────────────────

  const invalidateHistorial = () => queryClient.invalidateQueries({ queryKey: ["rrhh-comunicaciones", "historial"] });

  const enviarComunicacion = useMutation({
    mutationFn: async (input: {
      asunto: string;
      cuerpo: string;
      tipo: ComunicacionTipo;
      destinatarios: DestinatarioComunicacion[];
    }): Promise<EnviarComunicacionResultado> => {
      if (!input.asunto.trim()) throw new Error("Escribe un asunto.");
      if (!input.cuerpo.trim()) throw new Error("Escribe el cuerpo del mensaje.");
      if (input.destinatarios.length === 0) throw new Error("Selecciona al menos un destinatario con email.");

      let respuesta: RespuestaEdgeFunction | null = null;
      let errorInvocacion: string | null = null;

      try {
        const { data, error } = await supabase.functions.invoke("enviar-comunicacion", {
          body: {
            asunto: input.asunto,
            cuerpo: input.cuerpo,
            tipo: input.tipo,
            destinatarios: input.destinatarios,
          },
        });
        if (error) throw error;
        respuesta = data as RespuestaEdgeFunction;
      } catch (err) {
        errorInvocacion = err instanceof Error ? err.message : String(err);
      }

      let estado: ComunicacionEstado;
      let enviados = 0;
      let fallidos: FalloEnvio[] = [];
      let motivo: string | undefined;

      if (errorInvocacion) {
        estado = "error";
        fallidos = input.destinatarios.map((d) => ({ email: d.email, error: errorInvocacion as string }));
      } else if (!respuesta?.enviado) {
        estado = "borrador";
        motivo = respuesta?.motivo ?? "no_configurado";
      } else {
        enviados = respuesta.enviados ?? 0;
        fallidos = respuesta.fallidos ?? [];
        estado = fallidos.length === 0 ? "enviado" : enviados > 0 ? "parcial" : "error";
      }

      const { error: insertError } = await SUPA.from("rrhh_comunicaciones").insert({
        tipo: input.tipo,
        asunto: input.asunto,
        cuerpo: input.cuerpo,
        destinatarios: input.destinatarios,
        estado,
        detalle_envio: { enviados, fallidos, motivo: motivo ?? null, error: errorInvocacion },
        enviado_at: estado === "enviado" || estado === "parcial" ? new Date().toISOString() : null,
      });
      if (insertError) throw toError(insertError);

      return { estado, totalDestinatarios: input.destinatarios.length, enviados, fallidos, motivo };
    },
    onSuccess: invalidateHistorial,
    onError: invalidateHistorial,
  });

  const isLoading =
    trabajadoresQuery.isLoading || horasQuery.isLoading || periodosQuery.isLoading || historialQuery.isLoading;

  return {
    trabajadores,
    zonas,
    conEmail,
    sinEmail,
    historial: historialQuery.data ?? [],
    isLoading,
    sinPermiso,
    destinatariosDeIds,
    destinatariosDeZona,
    destinatariosTodos,
    enviarComunicacion,
  };
}

/**
 * useComunicacionesCampo — sección "Comunicaciones de campaña": Jesús
 * (jesus@lasartesat.es) envía comunicados a agricultores y proveedores
 * informando de qué hay que hacer para la campaña que entra. El acceso lo
 * decide la RPC can_access_comunicaciones_campo (admin O ese email), mismo
 * patrón que useVentasCategoriaAccess con can_access_ventas_categoria.
 *
 * El envío reutiliza la Edge Function `enviar-comunicacion` (Brevo o Resend)
 * pasando el canal explícito "campana", que aplica identidad, remitente y
 * diseño propios. Igual que en RRHH → Comunicaciones, si no hay proveedor de correo
 * configurado la función responde { enviado:false, motivo:"no_configurado" }
 * y la comunicación se guarda como borrador, sin romper la sección.
 *
 * IMPORTANTE: contactos_campo y comunicaciones_campo son tablas NUEVAS que
 * todavía no están en src/integrations/supabase/types.ts (la migración
 * 20260717150000_comunicaciones_campo.sql la aplica el orquestador). Se usa
 * el mismo cast local `SUPA` que el resto de hooks con infraestructura
 * pendiente y se degrada con esErrorTablaOColumnaInexistente.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useAuth } from "@/contexts/AuthProvider";
import { supabase } from "@/integrations/supabase/client";
import { toError } from "@/lib/errorMessage";
import { fetchAllRows } from "@/lib/fetchAllRows";
import { esErrorTablaOColumnaInexistente } from "@/lib/productoresCanonicos";
import { normalizarEmail, type ContactoCampoImportado, type ContactoCampoTipo } from "@/lib/contactosCampo";

// Cast local: tablas y RPC aún no están en el Database generado (ver cabecera).
const SUPA = supabase as unknown as SupabaseClient<any>;

// ─── Tipos ──────────────────────────────────────────────────────────────────

export interface ContactoCampoRow {
  id: string;
  nombre: string;
  email: string;
  tipo: ContactoCampoTipo;
  notas: string | null;
  activo: boolean;
  productor_id: string | null;
  created_at: string;
}

export interface DestinatarioCampo {
  nombre: string;
  email: string;
}

export interface FalloEnvioCampo {
  email: string;
  error: string;
}

export interface CorreoEnviadoCampo {
  email: string;
  providerId: string | null;
}

export type ComunicacionCampoEstado = "enviada" | "borrador" | "error";

export interface ComunicacionCampoRow {
  id: string;
  asunto: string;
  cuerpo: string;
  destinatarios: DestinatarioCampo[];
  enviados: number;
  fallidos: FalloEnvioCampo[] | null;
  estado: ComunicacionCampoEstado;
  provider_ids: CorreoEnviadoCampo[] | null;
  created_at: string;
}

export interface EnviarComunicacionCampoResultado {
  estado: ComunicacionCampoEstado;
  totalDestinatarios: number;
  enviados: number;
  fallidos: FalloEnvioCampo[];
  motivo?: string;
}

/** Forma de la respuesta 200 de la Edge Function `enviar-comunicacion`. */
interface RespuestaEdgeFunction {
  enviado: boolean;
  motivo?: string;
  enviados?: number;
  fallidos?: FalloEnvioCampo[];
  correos?: CorreoEnviadoCampo[];
}

// ─── Acceso ─────────────────────────────────────────────────────────────────

/**
 * Gate de la sección: admin siempre; para el resto pregunta a la RPC
 * can_access_comunicaciones_campo (true solo para jesus@lasartesat.es).
 * Si la migración no está aplicada aún (función inexistente), degrada a
 * "sin acceso" para no-admins en vez de romper.
 */
export function useComunicacionesCampoAccess() {
  const { user, role } = useAuth();

  const accessQuery = useQuery({
    queryKey: ["comunicaciones-campo", "access", user?.email, role],
    queryFn: async () => {
      if (role === "admin") return true;
      const { data, error } = await SUPA.rpc("can_access_comunicaciones_campo");
      if (error) {
        // Migración pendiente: la función todavía no existe → sin acceso, sin error crudo.
        if (esErrorTablaOColumnaInexistente(error)) return false;
        throw toError(error);
      }
      return Boolean(data);
    },
    enabled: Boolean(user),
    retry: (failureCount, error) => (esErrorTablaOColumnaInexistente(error) ? false : failureCount < 2),
  });

  const hasAccess = role === "admin" || accessQuery.data === true;

  return {
    accessQuery,
    hasAccess,
    isLoading: accessQuery.isLoading,
    role,
    isAdmin: role === "admin",
  };
}

// ─── Datos y acciones ───────────────────────────────────────────────────────

export function useComunicacionesCampo() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const access = useComunicacionesCampoAccess();
  const enabled = Boolean(user) && access.hasAccess;

  const contactosQuery = useQuery({
    queryKey: ["comunicaciones-campo", "contactos"],
    queryFn: async (): Promise<ContactoCampoRow[]> =>
      // fetchAllRows con order estable (regla PostgREST max-rows): la agenda
      // puede crecer por encima del recorte silencioso de 1.000 filas.
      fetchAllRows<ContactoCampoRow>((from, to) =>
        SUPA
          .from("contactos_campo")
          .select("*")
          .order("nombre", { ascending: true })
          .order("id", { ascending: true })
          .range(from, to),
      ),
    enabled,
    retry: (failureCount, error) => (esErrorTablaOColumnaInexistente(error) ? false : failureCount < 2),
  });

  const historialQuery = useQuery({
    queryKey: ["comunicaciones-campo", "historial"],
    queryFn: async (): Promise<ComunicacionCampoRow[]> =>
      fetchAllRows<ComunicacionCampoRow>((from, to) =>
        SUPA
          .from("comunicaciones_campo")
          .select("*")
          .order("created_at", { ascending: false })
          .order("id", { ascending: true })
          .range(from, to),
      ),
    enabled,
    retry: (failureCount, error) => (esErrorTablaOColumnaInexistente(error) ? false : failureCount < 2),
  });

  /** La migración de las tablas aún no está aplicada: la página degrada con un aviso. */
  const infraPendiente =
    esErrorTablaOColumnaInexistente(contactosQuery.error) ||
    esErrorTablaOColumnaInexistente(historialQuery.error);

  const invalidateContactos = () =>
    queryClient.invalidateQueries({ queryKey: ["comunicaciones-campo", "contactos"] });
  const invalidateHistorial = () =>
    queryClient.invalidateQueries({ queryKey: ["comunicaciones-campo", "historial"] });

  const crearContacto = useMutation({
    mutationFn: async (input: { nombre: string; email: string; tipo: ContactoCampoTipo; notas?: string | null }) => {
      const nombre = input.nombre.trim();
      const email = normalizarEmail(input.email);
      if (!nombre) throw new Error("Escribe el nombre del contacto.");
      if (!email) throw new Error("Escribe el email del contacto.");
      const { error } = await SUPA.from("contactos_campo").insert({
        user_id: user?.id ?? null,
        nombre,
        email,
        tipo: input.tipo,
        notas: input.notas?.trim() || null,
      });
      if (error) throw toError(error);
    },
    onSuccess: invalidateContactos,
  });

  const editarContacto = useMutation({
    mutationFn: async (input: {
      id: string;
      nombre?: string;
      email?: string;
      tipo?: ContactoCampoTipo;
      notas?: string | null;
    }) => {
      const patch: Record<string, unknown> = {};
      if (input.nombre !== undefined) patch.nombre = input.nombre.trim();
      if (input.email !== undefined) patch.email = normalizarEmail(input.email);
      if (input.tipo !== undefined) patch.tipo = input.tipo;
      if (input.notas !== undefined) patch.notas = input.notas?.trim() || null;
      const { error } = await SUPA.from("contactos_campo").update(patch).eq("id", input.id);
      if (error) throw toError(error);
    },
    onSuccess: invalidateContactos,
  });

  /** Alta/baja lógica: los contactos desactivados se conservan (y se pueden reactivar). */
  const setContactoActivo = useMutation({
    mutationFn: async (input: { id: string; activo: boolean }) => {
      const { error } = await SUPA.from("contactos_campo").update({ activo: input.activo }).eq("id", input.id);
      if (error) throw toError(error);
    },
    onSuccess: invalidateContactos,
  });

  /** Importación desde Excel: upsert por email (los repetidos actualizan nombre/tipo/notas). */
  const importarContactos = useMutation({
    mutationFn: async (contactos: ContactoCampoImportado[]): Promise<number> => {
      if (contactos.length === 0) return 0;
      const filas = contactos.map((c) => ({
        user_id: user?.id ?? null,
        nombre: c.nombre,
        email: normalizarEmail(c.email),
        tipo: c.tipo,
        notas: c.notas,
        activo: true,
      }));
      const { error } = await SUPA.from("contactos_campo").upsert(filas, { onConflict: "email" });
      if (error) throw toError(error);
      return filas.length;
    },
    onSuccess: invalidateContactos,
  });

  const enviarComunicacion = useMutation({
    mutationFn: async (input: {
      asunto: string;
      cuerpo: string;
      destinatarios: DestinatarioCampo[];
    }): Promise<EnviarComunicacionCampoResultado> => {
      if (!input.asunto.trim()) throw new Error("Escribe un asunto.");
      if (!input.cuerpo.trim()) throw new Error("Escribe el cuerpo del mensaje.");
      if (input.destinatarios.length === 0) throw new Error("Añade al menos un destinatario.");

      let respuesta: RespuestaEdgeFunction | null = null;
      let errorInvocacion: string | null = null;

      try {
        const { data, error } = await supabase.functions.invoke("enviar-comunicacion", {
          body: {
            asunto: input.asunto,
            cuerpo: input.cuerpo,
            canal: "campana",
            tipo: "campo",
            destinatarios: input.destinatarios,
          },
        });
        if (error) throw error;
        respuesta = data as RespuestaEdgeFunction;
      } catch (err) {
        errorInvocacion = err instanceof Error ? err.message : String(err);
      }

      let estado: ComunicacionCampoEstado;
      let enviados = 0;
      let fallidos: FalloEnvioCampo[] = [];
      let motivo: string | undefined;
      let providerIds: CorreoEnviadoCampo[] | null = null;

      if (errorInvocacion) {
        estado = "error";
        fallidos = input.destinatarios.map((d) => ({ email: d.email, error: errorInvocacion as string }));
      } else if (!respuesta?.enviado) {
        // Proveedor de correo sin configurar: borrador, no error (ver cabecera).
        estado = "borrador";
        motivo = respuesta?.motivo ?? "no_configurado";
      } else {
        enviados = respuesta.enviados ?? 0;
        fallidos = respuesta.fallidos ?? [];
        providerIds = respuesta.correos ?? null;
        // El check de la tabla no tiene estado "parcial": si algo salió,
        // cuenta como enviada (los fallidos quedan detallados en su columna).
        estado = enviados > 0 ? "enviada" : fallidos.length > 0 ? "error" : "enviada";
      }

      const { error: insertError } = await SUPA.from("comunicaciones_campo").insert({
        user_id: user?.id ?? null,
        asunto: input.asunto,
        cuerpo: input.cuerpo,
        destinatarios: input.destinatarios,
        enviados,
        fallidos: fallidos.length > 0 ? fallidos : null,
        estado,
        provider_ids: providerIds,
      });
      if (insertError) throw toError(insertError);

      return { estado, totalDestinatarios: input.destinatarios.length, enviados, fallidos, motivo };
    },
    onSuccess: invalidateHistorial,
    onError: invalidateHistorial,
  });

  return {
    access,
    contactos: contactosQuery.data ?? [],
    historial: historialQuery.data ?? [],
    isLoading: contactosQuery.isLoading || historialQuery.isLoading,
    infraPendiente,
    crearContacto,
    editarContacto,
    setContactoActivo,
    importarContactos,
    enviarComunicacion,
  };
}

/**
 * vigilante — Edge Function que comprueba, desde FUERA del portátil de la
 * oficina, que los trabajos automáticos siguen dando señales.
 *
 * POR QUÉ. Todo el flujo diario (tarea de las 07:10, receptor del calibrador,
 * fotos de palets, buzón) corre en un portátil. Su propia alarma era "si no
 * llega el correo de las 07:10, algo va mal" — pero una ausencia no la nota
 * nadie, y cuando el portátil está apagado es justo el correo lo que no sale.
 * Este vigilante corre en Supabase (pg_cron, job `vigilante-diario`, 11:45 UTC:
 * 13:45 Madrid en verano, 12:45 en invierno — siempre después de las 12:10, el
 * último reintento de la tarea diaria) y AVISA por correo cuando algo no late.
 *
 * La lógica de "qué es estar bien" vive en _shared/saludTrabajos.ts y es LA
 * MISMA que pinta la página /datos/fuentes: el correo y la pantalla no pueden
 * contradecirse.
 *
 * Entrada (POST, JSON, todo opcional):
 * - dry_run: true evalúa y devuelve el resultado SIN enviar ni registrar.
 * - force: true reenvía el correo aunque hoy ya se hubiera avisado.
 *
 * Cuando todo está bien NO manda nada: el correo del día ya es el de las 07:10.
 * Solo habla cuando ese otro no puede. Los trabajos "sin estrenar" tampoco
 * despiertan a nadie: se ven en la página, pero no son una avería.
 *
 * Seguridad: verify_jwt activo (el cron llama con la anon key). Destinatarios
 * SOLO de secretos (VIGILANTE_PARA); el body no puede desviar el aviso.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.0";
import {
  evaluarTrabajos,
  problemasQueAvisa,
  renderAvisoVigilante,
  type LatidoRow,
} from "../_shared/saludTrabajos.ts";
import { registrarLatido } from "../_shared/latido.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const RESEND_API_URL = "https://api.resend.com/emails";
const EMAIL_TIMEOUT_MS = 20_000;
const DESTINATARIO_DEFECTO = "soporte@lasartesat.es";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RETENCION_DIAS = 90;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function enviarResend(
  apiKey: string,
  from: string,
  destinatarios: string[],
  asunto: string,
  texto: string,
): Promise<{ ok: boolean; error: string | null }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), EMAIL_TIMEOUT_MS);
  try {
    const res = await fetch(RESEND_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ from, to: destinatarios, subject: asunto, text: texto }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "unknown");
      return { ok: false, error: `Resend ${res.status}: ${errText.slice(0, 300)}` };
    }
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  } finally {
    clearTimeout(timer);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // El cliente se crea FUERA del try: el catch lo necesita para dejar latido de
  // error. Hasta el 02-09-2026 el vigilante era el único trabajo de correo que
  // moría sin rastro — justo lo que vino a vigilar.
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  try {
    const body = (await req.json().catch(() => ({}))) as { dry_run?: boolean; force?: boolean };
    const inicio = new Date().toISOString();

    const { data: latidos, error: errLatidos } = await db.from("sistema_latidos").select("*");
    if (errLatidos) throw new Error(errLatidos.message);

    const salud = evaluarTrabajos((latidos ?? []) as unknown as LatidoRow[], new Date());
    // Todo lo que esté mal; de sí mismo, también si AYER terminó con error
    // (p. ej. no pudo enviar): ver problemasQueAvisa. Además el vigía de
    // negocio (12:15 UTC) comprueba que este vigilante haya dado señal hoy.
    const problemas = problemasQueAvisa(salud);

    if (body.dry_run) {
      return json({ dry_run: true, problemas: problemas.length, salud });
    }

    // Anti-repetición: el cron corre una vez al día, pero una invocación a mano
    // no debe duplicar el correo si hoy ya se avisó.
    let yaAvisado = false;
    if (problemas.length > 0 && !body.force) {
      const { data: previos } = await db
        .from("sistema_ejecuciones")
        .select("fin, datos")
        .eq("trabajo", "vigilante")
        .gte("fin", new Date(Date.now() - 20 * 3_600_000).toISOString())
        .order("fin", { ascending: false })
        .limit(5);
      yaAvisado = (previos ?? []).some((p) => (p.datos as { avisado?: boolean } | null)?.avisado === true);
    }

    let envio: { ok: boolean; error: string | null } | null = null;
    if (problemas.length > 0 && !yaAvisado) {
      const apiKey = Deno.env.get("RESEND_API_KEY")?.trim();
      const from = (
        Deno.env.get("RESEND_FROM_VIGILANTE") ||
        Deno.env.get("RESEND_FROM_INFORME") ||
        Deno.env.get("RESEND_FROM_RRHH") ||
        Deno.env.get("RESEND_FROM")
      )?.trim();
      const destinatarios = (Deno.env.get("VIGILANTE_PARA") ?? DESTINATARIO_DEFECTO)
        .split(/[,;]/)
        .map((d) => d.trim())
        .filter((d) => EMAIL_RE.test(d));
      if (apiKey && from && destinatarios.length > 0) {
        const { asunto, cuerpo } = renderAvisoVigilante(problemas);
        envio = await enviarResend(apiKey, from, destinatarios, asunto, cuerpo);
      } else {
        envio = { ok: false, error: "sin RESEND_API_KEY / RESEND_FROM / destinatarios configurados" };
      }
    }

    // Limpieza del histórico: con 90 días sobra para diagnosticar cualquier cosa.
    await db.from("sistema_ejecuciones")
      .delete()
      .lt("fin", new Date(Date.now() - RETENCION_DIAS * 86_400_000).toISOString());

    const sinEstrenar = salud.filter((t) => t.estado === "sin-estrenar").length;
    const detalle = problemas.length === 0
      ? `todo bien: ${salud.length - sinEstrenar} trabajos con señal` +
        (sinEstrenar > 0 ? `, ${sinEstrenar} sin estrenar` : "")
      : `${problemas.length} sin señales: ${problemas.map((p) => p.nombre).join(" · ")}` +
        (yaAvisado ? " (ya avisado hoy)" : envio?.ok ? " (correo enviado)" : ` (NO se pudo avisar: ${envio?.error})`);
    // "NO se pudo avisar" es un ERROR del vigilante, no un aviso: así la
    // página lo pinta en ámbar con el motivo, mañana él mismo lo cuenta en su
    // correo (problemasQueAvisa) y el vigía de negocio lo ve hoy.
    const estado = problemas.length === 0 ? "ok" : envio && !envio.ok ? "error" : "aviso";

    const { error: errReg } = await db.from("sistema_ejecuciones").insert({
      trabajo: "vigilante",
      inicio,
      estado,
      detalle,
      equipo: "supabase-edge",
      datos: { problemas: problemas.map((p) => p.id), avisado: envio?.ok === true },
    });
    if (errReg) console.error(`[vigilante] no se pudo registrar: ${errReg.message}`);
    await registrarLatido(db, "vigilante", estado, detalle);

    console.log(`[vigilante] problemas=${problemas.length} avisado=${envio?.ok ?? false} yaAvisado=${yaAvisado}`);
    return json({ problemas: problemas.map((p) => ({ id: p.id, titulo: p.titulo })), avisado: envio?.ok === true, yaAvisado, detalle });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[vigilante] error: ${msg}`);
    // Latido de error también aquí: el vigía de negocio lo lee media hora después.
    await registrarLatido(db, "vigilante", "error", `no pudo completar la comprobación: ${msg}`);
    return json({ error: "El vigilante no pudo completar la comprobación.", detalle: msg }, 500);
  }
});

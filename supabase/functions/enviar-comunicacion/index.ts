/**
 * enviar-comunicacion — Edge Function que envía correos reales a la plantilla
 * (avisos de horas acumuladas / vacaciones o comunicados personalizados desde
 * RRHH → Comunicaciones) vía Resend.
 *
 * Si RESEND_API_KEY todavía no está dada de alta en los secretos (el dueño no
 * la ha proporcionado aún), la función responde 200 con
 * { enviado:false, motivo:"no_configurado" } en vez de fallar: el cliente usa
 * esa respuesta para guardar la comunicación en modo borrador sin romper la
 * UI ni la función.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const RESEND_API_URL = "https://api.resend.com/emails";
const RESEND_DEFAULT_FROM = "Lasarte SAT <onboarding@resend.dev>";
const RESEND_TIMEOUT_MS = 15_000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface Destinatario {
  trabajador_id?: string;
  nombre?: string | null;
  email?: string | null;
  horas?: number | string | null;
  vacaciones?: number | string | null;
}

interface Body {
  asunto?: string;
  cuerpo?: string;
  tipo?: string;
  destinatarios?: Destinatario[];
}

interface FalloEnvio {
  email: string;
  error: string;
}

/** Sustituye {nombre}/{horas}/{vacaciones} por los valores del destinatario, si vienen. */
function personalizar(texto: string, destinatario: Destinatario): string {
  let out = texto;
  if (destinatario.nombre != null) out = out.replaceAll("{nombre}", String(destinatario.nombre));
  if (destinatario.horas != null) out = out.replaceAll("{horas}", String(destinatario.horas));
  if (destinatario.vacaciones != null) out = out.replaceAll("{vacaciones}", String(destinatario.vacaciones));
  return out;
}

/** Texto plano a HTML mínimo: párrafos por línea en blanco, saltos de línea sueltos como <br/>. */
function textoAHtml(texto: string): string {
  return texto
    .split(/\n{2,}/)
    .map((parrafo) => `<p>${parrafo.replace(/\n/g, "<br/>")}</p>`)
    .join("\n");
}

/** Envía un único correo vía Resend, con timeout propio. Nunca lanza: siempre devuelve un resultado. */
async function enviarUno(
  destinatario: Destinatario,
  asunto: string,
  cuerpo: string,
  apiKey: string,
  from: string,
): Promise<{ ok: true; email: string } | { ok: false; email: string; error: string }> {
  const email = (destinatario.email ?? "").trim();
  if (!EMAIL_RE.test(email)) {
    return { ok: false, email: email || "(sin email)", error: "Email no válido" };
  }

  const asuntoPersonalizado = personalizar(asunto, destinatario);
  const cuerpoPersonalizado = personalizar(cuerpo, destinatario);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RESEND_TIMEOUT_MS);
  try {
    const res = await fetch(RESEND_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        from,
        to: [email],
        subject: asuntoPersonalizado,
        html: textoAHtml(cuerpoPersonalizado),
        text: cuerpoPersonalizado,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "unknown");
      return { ok: false, email, error: `Resend ${res.status}: ${errText.slice(0, 300)}` };
    }
    return { ok: true, email };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, email, error: msg };
  } finally {
    clearTimeout(timer);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const resendKey = Deno.env.get("RESEND_API_KEY");
    const resendFrom = Deno.env.get("RESEND_FROM") || RESEND_DEFAULT_FROM;

    const body = (await req.json().catch(() => ({}))) as Body;
    const asunto = typeof body.asunto === "string" ? body.asunto.trim() : "";
    const cuerpo = typeof body.cuerpo === "string" ? body.cuerpo : "";
    const destinatarios = Array.isArray(body.destinatarios) ? body.destinatarios : [];

    if (!asunto || !cuerpo) {
      return new Response(
        JSON.stringify({ error: "Faltan 'asunto' o 'cuerpo'." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    if (destinatarios.length === 0) {
      return new Response(
        JSON.stringify({ error: "No hay destinatarios." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!resendKey) {
      // Modo borrador: todavía no hay clave de Resend configurada. No es un
      // error del cliente, así que se responde 200 igualmente.
      console.log("[enviar-comunicacion] RESEND_API_KEY no configurada, respondiendo modo borrador");
      return new Response(
        JSON.stringify({ enviado: false, motivo: "no_configurado" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    let enviados = 0;
    const fallidos: FalloEnvio[] = [];
    for (const destinatario of destinatarios) {
      const resultado = await enviarUno(destinatario, asunto, cuerpo, resendKey, resendFrom);
      if (resultado.ok) enviados += 1;
      else fallidos.push({ email: resultado.email, error: resultado.error });
    }

    console.log(`[enviar-comunicacion] enviados=${enviados} fallidos=${fallidos.length}`);

    return new Response(
      JSON.stringify({ enviado: true, enviados, fallidos }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[enviar-comunicacion] error: ${msg}`);
    return new Response(
      JSON.stringify({ error: "No se pudo procesar el envío. Inténtalo de nuevo en unos segundos." }),
      { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

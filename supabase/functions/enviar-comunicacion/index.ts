/**
 * enviar-comunicacion — Edge Function que envía correos reales a la plantilla
 * (avisos de horas acumuladas / vacaciones o comunicados personalizados desde
 * RRHH → Comunicaciones) vía Brevo o Resend.
 *
 * Si no hay ningún proveedor configurado en los secretos, la función responde 200 con
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
const BREVO_API_URL = "https://api.brevo.com/v3/smtp/email";
const EMAIL_TIMEOUT_MS = 15_000;
const DEFAULT_APP_URL = "https://controlproduccion.vercel.app";
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
  /**
   * Texto del chip de la cabecera del correo. Opcional y retrocompatible:
   * sin él se mantiene "Comunicación de RR. HH." (los envíos de RRHH no lo
   * mandan). Comunicaciones de campaña envía "Comunicación de campaña".
   */
  categoria?: string;
  destinatarios?: Destinatario[];
}

const CATEGORIA_POR_DEFECTO = "Comunicación de RR. HH.";

interface FalloEnvio {
  email: string;
  error: string;
}

type EmailProvider =
  | { kind: "brevo"; apiKey: string; fromEmail: string; fromName: string; replyToEmail: string }
  | { kind: "resend"; apiKey: string; from: string; replyToEmail: string };

/** Sustituye {nombre}/{horas}/{vacaciones} por los valores del destinatario, si vienen. */
function personalizar(texto: string, destinatario: Destinatario): string {
  let out = texto;
  if (destinatario.nombre != null) out = out.replaceAll("{nombre}", String(destinatario.nombre));
  if (destinatario.horas != null) out = out.replaceAll("{horas}", String(destinatario.horas));
  if (destinatario.vacaciones != null) out = out.replaceAll("{vacaciones}", String(destinatario.vacaciones));
  return out;
}

/** Evita que el contenido escrito en RRHH pueda romper o inyectar HTML en el correo. */
function escaparHtml(texto: string): string {
  return texto
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/** Texto plano a párrafos HTML seguros. */
function textoAHtml(texto: string): string {
  return escaparHtml(texto)
    .split(/\n{2,}/)
    .map((parrafo) => `<p style="margin:0 0 18px;color:#30354a;font-size:16px;line-height:1.65;">${parrafo.replace(/\n/g, "<br>")}</p>`)
    .join("\n");
}

function crearEmailHtml(asunto: string, cuerpo: string, logoUrl: string, categoria: string): string {
  const asuntoSeguro = escaparHtml(asunto);
  const cuerpoHtml = textoAHtml(cuerpo);
  const logoUrlSeguro = escaparHtml(logoUrl);
  const categoriaSegura = escaparHtml(categoria);

  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light">
  <title>${asuntoSeguro}</title>
</head>
<body style="margin:0;padding:0;background:#f3f5f8;font-family:Arial,Helvetica,sans-serif;color:#30354a;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${asuntoSeguro} · Lasarte Cítricos SL</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:#f3f5f8;">
    <tr>
      <td align="center" style="padding:28px 12px;">
        <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 8px 28px rgba(31,42,94,.10);">
          <tr>
            <td style="height:7px;background:#93c13d;font-size:0;line-height:0;">&nbsp;</td>
          </tr>
          <tr>
            <td style="padding:27px 34px 23px;border-bottom:1px solid #e8ebf1;">
              <img src="${logoUrlSeguro}" width="220" alt="Lasarte Cítricos SL" style="display:block;width:220px;max-width:100%;height:auto;border:0;">
            </td>
          </tr>
          <tr>
            <td style="padding:34px 34px 8px;">
              <div style="margin:0 0 14px;">
                <span style="display:inline-block;padding:7px 11px;border-radius:999px;background:#eef5df;color:#557b17;font-size:11px;font-weight:700;letter-spacing:.9px;text-transform:uppercase;">${categoriaSegura}</span>
              </div>
              <h1 style="margin:0;color:#22295c;font-size:27px;line-height:1.25;font-weight:700;">${asuntoSeguro}</h1>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 34px 10px;">
              ${cuerpoHtml}
            </td>
          </tr>
          <tr>
            <td style="padding:22px 34px;background:#22295c;border-top:4px solid #f28b22;">
              <p style="margin:0 0 7px;color:#ffffff;font-size:13px;font-weight:700;">Lasarte Cítricos SL</p>
              <p style="margin:0;color:#cdd2e6;font-size:12px;line-height:1.55;">Mensaje interno enviado desde Control de Producción. Puedes responder directamente a este correo si necesitas alguna aclaración.</p>
            </td>
          </tr>
        </table>
        <p style="margin:16px 0 0;color:#80869a;font-size:11px;line-height:1.5;">Este correo está dirigido exclusivamente a su destinatario.</p>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/** Envía un único correo vía Resend, con timeout propio. Nunca lanza: siempre devuelve un resultado. */
async function enviarUno(
  destinatario: Destinatario,
  asunto: string,
  cuerpo: string,
  provider: EmailProvider,
  logoUrl: string,
  categoria: string,
): Promise<{ ok: true; email: string; providerId: string | null } | { ok: false; email: string; error: string }> {
  const email = (destinatario.email ?? "").trim();
  if (!EMAIL_RE.test(email)) {
    return { ok: false, email: email || "(sin email)", error: "Email no válido" };
  }

  const asuntoPersonalizado = personalizar(asunto, destinatario);
  const cuerpoPersonalizado = personalizar(cuerpo, destinatario);
  const htmlPersonalizado = crearEmailHtml(asuntoPersonalizado, cuerpoPersonalizado, logoUrl, categoria);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), EMAIL_TIMEOUT_MS);
  try {
    const esBrevo = provider.kind === "brevo";
    const res = await fetch(esBrevo ? BREVO_API_URL : RESEND_API_URL, {
      method: "POST",
      headers: esBrevo
        ? {
          "Content-Type": "application/json",
          "Accept": "application/json",
          "api-key": provider.apiKey,
        }
        : {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${provider.apiKey}`,
        },
      body: JSON.stringify(esBrevo
        ? {
          sender: { name: provider.fromName, email: provider.fromEmail },
          to: [{ email, name: destinatario.nombre ?? undefined }],
          replyTo: { email: provider.replyToEmail, name: provider.fromName },
          subject: asuntoPersonalizado,
          htmlContent: htmlPersonalizado,
          textContent: cuerpoPersonalizado,
        }
        : {
          from: provider.from,
          to: [email],
          reply_to: provider.replyToEmail,
          subject: asuntoPersonalizado,
          html: htmlPersonalizado,
          text: cuerpoPersonalizado,
        }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "unknown");
      const nombreProveedor = esBrevo ? "Brevo" : "Resend";
      return { ok: false, email, error: `${nombreProveedor} ${res.status}: ${errText.slice(0, 300)}` };
    }
    // El id del proveedor (Resend: { id }, Brevo: { messageId }) permite
    // rastrear el correo en su panel; se devuelve al cliente para auditoría.
    const cuerpoRespuesta = await res.json().catch(() => null) as { id?: string; messageId?: string } | null;
    return { ok: true, email, providerId: cuerpoRespuesta?.id ?? cuerpoRespuesta?.messageId ?? null };
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
    const brevoKey = Deno.env.get("BREVO_API_KEY")?.trim();
    const brevoFromEmail = Deno.env.get("BREVO_FROM_EMAIL")?.trim();
    const brevoFromName = Deno.env.get("BREVO_FROM_NAME")?.trim() || "Lasarte Cítricos SL";
    const resendKey = Deno.env.get("RESEND_API_KEY");
    const resendFrom = Deno.env.get("RESEND_FROM")?.trim();
    const emailReplyTo = Deno.env.get("EMAIL_REPLY_TO")?.trim();
    const appUrl = (Deno.env.get("APP_URL")?.trim() || DEFAULT_APP_URL).replace(/\/$/, "");
    const logoUrl = Deno.env.get("EMAIL_LOGO_URL")?.trim() || `${appUrl}/branding/lasarte-sat-logo.jpeg`;

    const provider: EmailProvider | null = brevoKey && brevoFromEmail
      ? {
        kind: "brevo",
        apiKey: brevoKey,
        fromEmail: brevoFromEmail,
        fromName: brevoFromName,
        replyToEmail: emailReplyTo || brevoFromEmail,
      }
      : resendKey && resendFrom
      ? { kind: "resend", apiKey: resendKey, from: resendFrom, replyToEmail: emailReplyTo || resendFrom }
      : null;

    const body = (await req.json().catch(() => ({}))) as Body;
    const asunto = typeof body.asunto === "string" ? body.asunto.trim() : "";
    const cuerpo = typeof body.cuerpo === "string" ? body.cuerpo : "";
    const categoria = typeof body.categoria === "string" && body.categoria.trim()
      ? body.categoria.trim()
      : CATEGORIA_POR_DEFECTO;
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

    if (!provider) {
      // Diagnóstico por proveedor: se informa de lo que falta del proveedor
      // más cercano a estar completo (si hay una clave a medias, esa ruta).
      const faltantes = resendKey || resendFrom
        ? [!resendKey && "RESEND_API_KEY", !resendFrom && "RESEND_FROM"].filter(Boolean)
        : [!brevoKey && "BREVO_API_KEY", !brevoFromEmail && "BREVO_FROM_EMAIL"].filter(Boolean);
      console.log(`[enviar-comunicacion] proveedor no configurado; faltan: ${faltantes.join(", ")}`);
      return new Response(
        JSON.stringify({ enviado: false, motivo: "no_configurado", faltantes }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Validación del reply-to SOLO cuando hay proveedor y se va a enviar de
    // verdad: un secreto mal escrito no debe romper el modo borrador (la
    // garantía de cabecera: esta función no tumba la UI por configuración).
    if (emailReplyTo && !EMAIL_RE.test(emailReplyTo)) {
      console.error("[enviar-comunicacion] EMAIL_REPLY_TO no es una dirección válida");
      return new Response(
        JSON.stringify({ error: "El secreto EMAIL_REPLY_TO no contiene una dirección de correo válida. Corrígelo antes de enviar." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Envío en paralelo por lotes de 10: los destinatarios son independientes
    // (cada envío tiene su propio timeout) y en serie un solo destinatario
    // lento bloqueaba a todos los demás, con riesgo de agotar el límite de
    // ejecución de la función con plantillas grandes. El lote de 10 respeta
    // los límites de ritmo de los proveedores.
    let enviados = 0;
    const fallidos: FalloEnvio[] = [];
    const correos: Array<{ email: string; providerId: string | null }> = [];
    const TAMANO_LOTE = 10;
    for (let i = 0; i < destinatarios.length; i += TAMANO_LOTE) {
      const lote = destinatarios.slice(i, i + TAMANO_LOTE);
      const resultados = await Promise.all(
        lote.map((destinatario) => enviarUno(destinatario, asunto, cuerpo, provider, logoUrl, categoria)),
      );
      for (const resultado of resultados) {
        if (resultado.ok) {
          enviados += 1;
          correos.push({ email: resultado.email, providerId: resultado.providerId });
        } else {
          fallidos.push({ email: resultado.email, error: resultado.error });
        }
      }
    }

    console.log(`[enviar-comunicacion] enviados=${enviados} fallidos=${fallidos.length}`);

    return new Response(
      JSON.stringify({ enviado: true, enviados, fallidos, correos }),
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

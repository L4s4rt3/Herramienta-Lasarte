/**
 * enviar-comunicacion — Edge Function que envía correos vía Brevo o Resend.
 * Mantiene dos identidades y diseños separados:
 * - RRHH: comunicaciones internas dirigidas a la plantilla.
 * - Campaña: comunicaciones externas dirigidas a agricultores y productores.
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
const DEFAULT_RRHH_REPLY_TO = "beatriz@lasartesat.es";
const CAMPANA_LOGO_CID = "lasarte-logo-campana";
const CAMPANA_LOGO_FILENAME = "lasarte-logo.jpeg";
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
  canal?: CanalComunicacion;
  /** @deprecated Se conserva para aceptar clientes antiguos, pero ya no define el diseño. */
  categoria?: string;
  destinatarios?: Destinatario[];
}

type CanalComunicacion = "rrhh" | "campana";

interface FalloEnvio {
  email: string;
  error: string;
}

type EmailProvider =
  | { kind: "brevo"; apiKey: string; fromEmail: string; fromName: string; replyToEmail: string }
  | { kind: "resend"; apiKey: string; from: string; replyToEmail: string };

const RRHH_TIPO_LABEL: Record<string, string> = {
  aviso_horas: "Bolsa de horas",
  aviso_vacaciones: "Vacaciones",
  aviso_generico: "Aviso interno",
  personalizado: "Comunicación personalizada",
};

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

/** Extrae la dirección de formatos como `Nombre <correo@dominio.com>`. */
function extraerEmailRemitente(remitente: string): string {
  const entreAngulos = remitente.match(/<([^<>]+)>/);
  return (entreAngulos?.[1] ?? remitente).trim();
}

/** Texto plano a párrafos HTML seguros. */
function textoAHtml(texto: string): string {
  return escaparHtml(texto)
    .split(/\n{2,}/)
    .map((parrafo) => `<p style="margin:0 0 18px;color:#30354a;font-size:16px;line-height:1.65;">${parrafo.replace(/\n/g, "<br>")}</p>`)
    .join("\n");
}

function crearEmailRrhhHtml(asunto: string, cuerpo: string, logoUrl: string, tipo?: string): string {
  const asuntoSeguro = escaparHtml(asunto);
  const cuerpoHtml = textoAHtml(cuerpo);
  const logoUrlSeguro = escaparHtml(logoUrl);
  const tipoSeguro = escaparHtml(RRHH_TIPO_LABEL[tipo ?? ""] ?? "Comunicación interna");

  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light">
  <title>${asuntoSeguro}</title>
</head>
<body style="margin:0;padding:0;background:#f2f4f8;font-family:Arial,Helvetica,sans-serif;color:#30354a;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">Comunicación interna de RR. HH. · ${asuntoSeguro}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:#f2f4f8;">
    <tr>
      <td align="center" style="padding:32px 12px;">
        <table role="presentation" width="620" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:620px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 10px 32px rgba(31,42,94,.11);">
          <tr>
            <td style="height:6px;background:#22295c;font-size:0;line-height:0;">&nbsp;</td>
          </tr>
          <tr>
            <td style="padding:25px 36px 22px;border-bottom:1px solid #e7e9f1;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td><img src="${logoUrlSeguro}" width="205" alt="Lasarte Cítricos SL" style="display:block;width:205px;max-width:100%;height:auto;border:0;"></td>
                  <td align="right" style="color:#6e7488;font-size:11px;font-weight:700;letter-spacing:.8px;text-transform:uppercase;">Recursos Humanos</td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:34px 36px 8px;">
              <div style="margin:0 0 14px;">
                <span style="display:inline-block;padding:7px 11px;border-radius:999px;background:#eef0f8;color:#22295c;font-size:11px;font-weight:700;letter-spacing:.8px;text-transform:uppercase;">Comunicación interna · ${tipoSeguro}</span>
              </div>
              <h1 style="margin:0;color:#22295c;font-size:28px;line-height:1.25;font-weight:700;">${asuntoSeguro}</h1>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 36px 18px;">
              ${cuerpoHtml}
            </td>
          </tr>
          <tr>
            <td style="padding:22px 36px;background:#22295c;border-top:4px solid #93c13d;">
              <p style="margin:0 0 7px;color:#ffffff;font-size:13px;font-weight:700;">RR. HH. · Lasarte Cítricos SL</p>
              <p style="margin:0;color:#d6d9e8;font-size:12px;line-height:1.6;">Información interna dirigida a la plantilla. Si necesitas alguna aclaración, responde directamente a este correo.</p>
            </td>
          </tr>
        </table>
        <p style="margin:16px 0 0;color:#858a9b;font-size:11px;line-height:1.5;">Este mensaje puede contener información laboral de carácter personal. No lo reenvíes si no es necesario.</p>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function crearEmailCampanaHtml(asunto: string, cuerpo: string, logoSrc: string): string {
  const asuntoSeguro = escaparHtml(asunto);
  const cuerpoHtml = textoAHtml(cuerpo);
  const logoSrcSeguro = escaparHtml(logoSrc);

  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light">
  <title>${asuntoSeguro}</title>
</head>
<body style="margin:0;padding:0;background:#f4f6ef;font-family:Arial,Helvetica,sans-serif;color:#30372d;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">Información de campaña para agricultores y productores · ${asuntoSeguro}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:#f4f6ef;">
    <tr>
      <td align="center" style="padding:32px 12px;">
        <table role="presentation" width="620" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:620px;background:#ffffff;border-radius:18px;overflow:hidden;box-shadow:0 10px 32px rgba(56,82,31,.12);">
          <tr>
            <td style="height:8px;background:#f28b22;font-size:0;line-height:0;">&nbsp;</td>
          </tr>
          <tr>
            <td style="padding:27px 36px 24px;background:#ffffff;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td>
                    <img src="${logoSrcSeguro}" width="220" alt="Lasarte Cítricos SL" style="display:block;width:220px;max-width:100%;height:auto;border:0;">
                  </td>
                  <td align="right" style="color:#69705f;font-size:10px;font-weight:700;letter-spacing:.8px;text-transform:uppercase;">Comunicaciones de campaña</td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:30px 36px 28px;background:#5f8428;">
              <p style="margin:0 0 12px;color:#eaf4d9;font-size:12px;font-weight:700;letter-spacing:1px;text-transform:uppercase;">Campaña citrícola · Agricultores y productores</p>
              <h1 style="margin:0;color:#ffffff;font-size:29px;line-height:1.24;font-weight:700;">${asuntoSeguro}</h1>
            </td>
          </tr>
          <tr>
            <td style="padding:34px 36px 22px;border-left:1px solid #e6eadf;border-right:1px solid #e6eadf;">
              ${cuerpoHtml}
            </td>
          </tr>
          <tr>
            <td style="padding:21px 36px;background:#f7f3e9;border-top:1px solid #ece3cf;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td width="6" style="width:6px;background:#f28b22;border-radius:8px;font-size:0;line-height:0;">&nbsp;</td>
                  <td style="padding-left:14px;">
                    <p style="margin:0 0 5px;color:#3f5528;font-size:13px;font-weight:700;">Equipo de campaña · Lasarte Cítricos SL</p>
                    <p style="margin:0;color:#69705f;font-size:12px;line-height:1.6;">Para consultas sobre esta comunicación, responde directamente a este correo.</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
        <p style="margin:16px auto 0;max-width:570px;color:#828777;font-size:11px;line-height:1.5;">Has recibido este mensaje por tu relación profesional como agricultor, productor o proveedor de Lasarte Cítricos SL.</p>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function crearEmailHtml(
  asunto: string,
  cuerpo: string,
  logoUrl: string,
  canal: CanalComunicacion,
  tipo?: string,
): string {
  return canal === "campana"
    ? crearEmailCampanaHtml(asunto, cuerpo, logoUrl)
    : crearEmailRrhhHtml(asunto, cuerpo, logoUrl, tipo);
}

/** Envía un único correo con timeout propio. Nunca lanza: siempre devuelve un resultado. */
async function enviarUno(
  destinatario: Destinatario,
  asunto: string,
  cuerpo: string,
  provider: EmailProvider,
  logoUrl: string,
  canal: CanalComunicacion,
  tipo?: string,
): Promise<{ ok: true; email: string; providerId: string | null } | { ok: false; email: string; error: string }> {
  const email = (destinatario.email ?? "").trim();
  if (!EMAIL_RE.test(email)) {
    return { ok: false, email: email || "(sin email)", error: "Email no válido" };
  }

  const asuntoPersonalizado = personalizar(asunto, destinatario);
  const cuerpoPersonalizado = personalizar(cuerpo, destinatario);
  // En Resend el logo de campaña viaja como imagen CID: no depende de que el
  // cliente de correo permita cargar imágenes remotas desde Control Producción.
  const logoSrc = canal === "campana" && provider.kind === "resend"
    ? `cid:${CAMPANA_LOGO_CID}`
    : logoUrl;
  const htmlPersonalizado = crearEmailHtml(asuntoPersonalizado, cuerpoPersonalizado, logoSrc, canal, tipo);

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
          ...(canal === "campana"
            ? {
              attachments: [{
                path: logoUrl,
                filename: CAMPANA_LOGO_FILENAME,
                content_id: CAMPANA_LOGO_CID,
              }],
            }
            : {}),
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
    const body = (await req.json().catch(() => ({}))) as Body;
    const asunto = typeof body.asunto === "string" ? body.asunto.trim() : "";
    const cuerpo = typeof body.cuerpo === "string" ? body.cuerpo : "";
    const tipo = typeof body.tipo === "string" ? body.tipo : undefined;
    // `tipo: "campo"` mantiene compatibles las llamadas desplegadas antes de
    // introducir `canal`. La categoría libre ya no decide identidad ni diseño.
    const canal: CanalComunicacion = body.canal === "campana" || body.tipo === "campo" ? "campana" : "rrhh";
    const destinatarios = Array.isArray(body.destinatarios) ? body.destinatarios : [];

    const brevoKey = Deno.env.get("BREVO_API_KEY")?.trim();
    const sufijoCanal = canal === "campana" ? "CAMPANA" : "RRHH";
    const nombreCanal = canal === "campana" ? "Campaña · Lasarte Cítricos" : "RR. HH. · Lasarte Cítricos";
    const brevoFromEmail = (Deno.env.get(`BREVO_FROM_EMAIL_${sufijoCanal}`) || Deno.env.get("BREVO_FROM_EMAIL"))?.trim();
    const brevoFromName = (Deno.env.get(`BREVO_FROM_NAME_${sufijoCanal}`) || Deno.env.get("BREVO_FROM_NAME"))?.trim() || nombreCanal;
    const resendKey = Deno.env.get("RESEND_API_KEY")?.trim();
    const resendFrom = (Deno.env.get(`RESEND_FROM_${sufijoCanal}`) || Deno.env.get("RESEND_FROM"))?.trim();
    // RRHH responde a Beatriz por defecto. El secreto específico permite
    // cambiar esa bandeja en el futuro sin volver a desplegar la función.
    // Campaña mantiene su reply-to global o específico completamente separado.
    const emailReplyTo = (
      Deno.env.get(`EMAIL_REPLY_TO_${sufijoCanal}`) ||
      (canal === "rrhh" ? DEFAULT_RRHH_REPLY_TO : Deno.env.get("EMAIL_REPLY_TO"))
    )?.trim();
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
      ? {
        kind: "resend",
        apiKey: resendKey,
        from: resendFrom,
        replyToEmail: emailReplyTo || extraerEmailRemitente(resendFrom),
      }
      : null;

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
    if (!EMAIL_RE.test(provider.replyToEmail)) {
      console.error(`[enviar-comunicacion] EMAIL_REPLY_TO_${sufijoCanal} no es una dirección válida`);
      return new Response(
        JSON.stringify({ error: `La dirección de respuesta configurada para ${canal} no es válida. Corrígela antes de enviar.` }),
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
        lote.map((destinatario) => enviarUno(destinatario, asunto, cuerpo, provider, logoUrl, canal, tipo)),
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

    console.log(`[enviar-comunicacion] canal=${canal} enviados=${enviados} fallidos=${fallidos.length}`);

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

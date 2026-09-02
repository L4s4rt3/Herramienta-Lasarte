/**
 * ventas-mercadona-semanal — el correo de los lunes con las ventas de Mercadona.
 *
 * Encargo del dueño (19-08-2026): "envíame cada lunes las ventas de la semana
 * de Mercadona" — kg, cajas y palets. Lo programa pg_cron los lunes por la
 * mañana; cubre la semana ISO que acaba de cerrar (lunes a domingo anterior).
 *
 * CORRE EN SUPABASE, NO EN EL PORTÁTIL. Lee erp_palet (que la sincronización
 * diaria del ERP ya deja en la base durante la semana), así que el correo sale
 * aunque el portátil esté apagado el lunes — igual que el vigilante y el informe
 * semanal. La fuente es la MISMA que la pestaña Expediciones de /mercadona: no
 * hay números nuevos que puedan contradecir a los de la pantalla.
 *
 * Entrada (POST, JSON, todo opcional):
 * - anio, semana: una semana ISO concreta (por defecto, la anterior a hoy Madrid).
 * - force: reenvía aunque esa semana ya se hubiera enviado.
 * - dry_run: calcula y devuelve sin enviar ni registrar.
 *
 * Seguridad: verify_jwt activo (el cron llama con la anon key). Destinatarios
 * SOLO de secretos (VENTAS_MERCADONA_PARA); el body no puede desviar el correo.
 */
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.57.0";
import {
  asuntoVentasMercadona,
  CLIENTE_MERCADONA,
  fechasSemanaIso,
  partirEnSemanas,
  renderVentasMercadonaHtml,
  renderVentasMercadonaTexto,
  resumirVentasSemana,
  semanaIsoAnterior,
  type PaletVenta,
  type SemanaIso,
} from "../_shared/ventasMercadona.ts";
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
const PAGE = 1000;

// El cliente sin tipos generados: `ReturnType<typeof createClient>` resolvía las
// filas a `never` con los tipos de npm de supabase-js (lo destapó el deno check
// del CI, 02-09-2026); con Database = any las filas son `any`, que es lo que
// este código siempre asumió.
// deno-lint-ignore no-explicit-any
type Db = SupabaseClient<any, "public", any>;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** Hoy en Madrid (YYYY-MM-DD): el cron corre en UTC pero la semana es la local. */
function hoyMadrid(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid" }).format(new Date());
}

/** Espejo de fetchAllRows: PostgREST recorta a 1.000 en silencio. */
async function fetchTodas<T>(
  consulta: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await consulta(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const filas = data ?? [];
    out.push(...filas);
    if (filas.length < PAGE) return out;
  }
}

const restarDias = (iso: string, n: number): string => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d - n)).toISOString().slice(0, 10);
};

async function enviarResend(
  apiKey: string, from: string, destinatarios: string[], asunto: string, html: string, texto: string,
): Promise<{ ok: boolean; id: string | null; error: string | null }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), EMAIL_TIMEOUT_MS);
  try {
    const res = await fetch(RESEND_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ from, to: destinatarios, subject: asunto, html, text: texto }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "unknown");
      return { ok: false, id: null, error: `Resend ${res.status}: ${errText.slice(0, 300)}` };
    }
    const cuerpo = await res.json().catch(() => null) as { id?: string } | null;
    return { ok: true, id: cuerpo?.id ?? null, error: null };
  } catch (e) {
    return { ok: false, id: null, error: e instanceof Error ? e.message : String(e) };
  } finally {
    clearTimeout(timer);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = (await req.json().catch(() => ({}))) as {
      anio?: number; semana?: number; force?: boolean; dry_run?: boolean;
    };
    const db: Db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const objetivo: SemanaIso = body.anio && body.semana
      ? { anio: body.anio, semana: body.semana }
      : semanaIsoAnterior(hoyMadrid());
    const fechas = fechasSemanaIso(objetivo.anio, objetivo.semana);
    const lunes = fechas[0];
    const domingo = fechas[6];
    const lunesAnterior = restarDias(lunes, 7);

    // Idempotencia + anti-spam (salvo dry_run).
    if (!body.dry_run) {
      const { data: previos, error } = await db.from("ventas_mercadona_envios")
        .select("anio, semana, estado").eq("anio", objetivo.anio).eq("semana", objetivo.semana).eq("estado", "enviado");
      if (error && !/does not exist|relation/i.test(error.message)) throw new Error(error.message);
      if ((previos ?? []).length > 0 && !body.force) {
        return json({ enviado: false, motivo: "ya_enviado", ...objetivo });
      }
    }

    // Dos semanas de una vez (la objetivo y la anterior, para comparar), y se
    // parten en cliente. erp_palet trae una fila por palet con su cliente.
    const filas = await fetchTodas<PaletVenta>((from, to) =>
      db.from("erp_palet")
        .select("numero, num_cajas, kg_netos, fecha")
        .eq("cliente", CLIENTE_MERCADONA)
        .gte("fecha", lunesAnterior).lte("fecha", domingo)
        .order("numero").range(from, to)
    );
    const { objetivo: filasObj, anterior: filasAnt } = partirEnSemanas(filas, lunes);
    const actual = resumirVentasSemana(filasObj);
    const anterior = resumirVentasSemana(filasAnt);

    const datos = { anio: objetivo.anio, semana: objetivo.semana, fechas, actual, anterior };
    const asunto = asuntoVentasMercadona(datos);
    const html = renderVentasMercadonaHtml(datos);
    const texto = renderVentasMercadonaTexto(datos);

    if (body.dry_run) {
      return json({ enviado: false, motivo: "dry_run", asunto, actual, anterior, ...objetivo });
    }

    const destinatarios = (Deno.env.get("VENTAS_MERCADONA_PARA") ?? DESTINATARIO_DEFECTO)
      .split(/[,;]/).map((d) => d.trim()).filter((d) => EMAIL_RE.test(d));
    const apiKey = Deno.env.get("RESEND_API_KEY")?.trim();
    const from = (Deno.env.get("RESEND_FROM_INFORME") || Deno.env.get("RESEND_FROM_RRHH") || Deno.env.get("RESEND_FROM"))?.trim();
    if (!apiKey || !from || destinatarios.length === 0) {
      return json({ enviado: false, motivo: "no_configurado",
        faltantes: [!apiKey && "RESEND_API_KEY", !from && "RESEND_FROM", !destinatarios.length && "VENTAS_MERCADONA_PARA"].filter(Boolean) });
    }

    const envio = await enviarResend(apiKey, from, destinatarios, asunto, html, texto);

    const { error: errLog } = await db.from("ventas_mercadona_envios").insert({
      anio: objetivo.anio, semana: objetivo.semana, destinatarios, asunto,
      palets: actual.palets, cajas: actual.cajas, kg: actual.kg,
      estado: envio.ok ? "enviado" : "error", detalle: envio.ok ? envio.id : envio.error,
    });
    if (errLog) console.error(`[ventas-mercadona] no se pudo registrar: ${errLog.message}`);

    await registrarLatido(
      db,
      "ventas-mercadona",
      envio.ok ? "ok" : "error",
      envio.ok
        ? `semana ${objetivo.semana}/${objetivo.anio} enviada (${actual.palets} palets, ${Math.round(actual.kg)} kg)`
        : `semana ${objetivo.semana}/${objetivo.anio}: ${envio.error}`,
    );

    console.log(`[ventas-mercadona] semana=${objetivo.semana}/${objetivo.anio} enviado=${envio.ok} palets=${actual.palets} kg=${actual.kg}`);
    if (!envio.ok) return json({ enviado: false, motivo: "error_envio", detalle: envio.error, ...objetivo }, 502);
    return json({ enviado: true, asunto, destinatarios, actual, anterior, ...objetivo });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[ventas-mercadona] error: ${msg}`);
    // Latido de error también aquí: un lunes mudo sin rastro no lo caza nadie.
    try {
      const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
      await registrarLatido(db, "ventas-mercadona", "error", msg);
    } catch { /* best-effort */ }
    return json({ error: "No se pudo generar el correo de ventas Mercadona.", detalle: msg }, 500);
  }
});

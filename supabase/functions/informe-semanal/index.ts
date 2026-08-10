/**
 * informe-semanal — Edge Function del informe semanal automático.
 *
 * La programa pg_cron cada martes por la mañana (la asistencia se vuelca los
 * lunes por semanas completas: el lunes aún no está). Reúne los datos de la
 * semana ISO ANTERIOR con las MISMAS consultas que src/hooks/useRentabilidadDia.ts,
 * clasifica cada día con computeRentabilidadDia (la misma función pura que la
 * página — de ella se usan SOLO los kg, no los euros) y envía por Resend el
 * informe operativo pedido por el dueño (10-08-2026): kg producidos, podrido,
 * trabajadores al día, kg por trabajador y zona, y podrido por productor y
 * finca. Los huecos se enseñan como huecos en "Datos que faltan" — nunca se
 * estima en silencio.
 *
 * Entrada (POST, JSON, todo opcional):
 * - anio, semana: semana ISO concreta (por defecto, la anterior a hoy Madrid).
 * - force: true reenvía aunque esa semana ya se haya enviado.
 * - dry_run: true calcula y devuelve el informe SIN enviar ni registrar.
 *
 * Seguridad: verify_jwt activo (el cron llama con la anon key). Los
 * destinatarios salen SOLO de secretos/env (INFORME_SEMANAL_PARA) — el body
 * no puede redirigir el informe a direcciones arbitrarias. Idempotencia y
 * anti-spam con la tabla informe_semanal_envios.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.0";
import {
  computeRentabilidadDia,
  PRECIOS_RENTABILIDAD_DEFECTO,
  type FilaClasifRentabilidad,
  type FrutaLoteRentabilidad,
} from "../_shared/rentabilidadDia.ts";
import { normalizarLoteCodigo } from "../_shared/loteCodigo.ts";
import {
  asuntoInformeSemanal,
  computeInformeSemanal,
  fechasSemanaIso,
  renderInformeSemanalHtml,
  renderInformeSemanalTexto,
  semanaIsoAnterior,
  SIN_ZONA,
  type DiaInformeSemanal,
  type SemanaIso,
} from "../_shared/informeSemanal.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const RESEND_API_URL = "https://api.resend.com/emails";
const EMAIL_TIMEOUT_MS = 20_000;
const DESTINATARIO_DEFECTO = "soporte@lasartesat.es";
const COOLDOWN_MS = 60_000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PAGE = 1000;

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

/** Espejo de src/lib/fetchAllRows.ts: PostgREST recorta a 1.000 en silencio. */
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

interface EnvioResend {
  ok: boolean;
  id: string | null;
  error: string | null;
}

async function enviarResend(
  apiKey: string,
  from: string,
  replyTo: string,
  destinatarios: string[],
  asunto: string,
  html: string,
  texto: string,
): Promise<EnvioResend> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), EMAIL_TIMEOUT_MS);
  try {
    const res = await fetch(RESEND_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ from, to: destinatarios, reply_to: replyTo, subject: asunto, html, text: texto }),
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
      anio?: number;
      semana?: number;
      force?: boolean;
      dry_run?: boolean;
    };

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const db = createClient(SUPABASE_URL, SERVICE_ROLE);

    // Semana objetivo: la pedida o la ISO anterior a hoy (hora de Madrid).
    const objetivo: SemanaIso = body.anio && body.semana
      ? { anio: body.anio, semana: body.semana }
      : semanaIsoAnterior(hoyMadrid());
    const fechas = fechasSemanaIso(objetivo.anio, objetivo.semana);
    const lunes = fechas[0];
    const domingo = fechas[6];

    // Idempotencia + anti-spam (salvo dry_run, que ni envía ni registra).
    if (!body.dry_run) {
      const { data: previos, error: errPrevios } = await db
        .from("informe_semanal_envios")
        .select("anio, semana, estado, enviado_at")
        .order("enviado_at", { ascending: false })
        .limit(10);
      if (errPrevios) throw new Error(errPrevios.message);
      const yaEnviado = (previos ?? []).some((p) =>
        p.anio === objetivo.anio && p.semana === objetivo.semana && p.estado === "enviado"
      );
      if (yaEnviado && !body.force) {
        return json({ enviado: false, motivo: "ya_enviado", ...objetivo });
      }
      const ultimo = previos?.[0];
      if (ultimo && Date.now() - new Date(ultimo.enviado_at).getTime() < COOLDOWN_MS) {
        return json({ enviado: false, motivo: "cooldown", ...objetivo }, 429);
      }
    }

    // --- Datos de la semana: mismas consultas que useRentabilidadDia -------
    interface FilaConFecha extends FilaClasifRentabilidad {
      fecha: string | null;
    }
    const filas = await fetchTodas<FilaConFecha>((from, to) =>
      db
        .from("lote_clasificacion")
        .select("fecha, lote_codigo, productor, producto, clase, peso_kg, toneladas_hora, duracion_min")
        .gte("fecha", lunes)
        .lte("fecha", domingo)
        .order("id")
        .range(from, to)
    );

    const clavesLote = [...new Set(
      filas.map((f) => normalizarLoteCodigo(f.lote_codigo)).filter((c): c is string => !!c),
    )];

    // Entradas de báscula de los lotes calibrados: finca para el desglose por
    // productor/finca y presencia para detectar lotes sin entrada (en tandas:
    // .in con listas largas).
    const entradasLotes: Array<{ lote: string | null; finca: string | null }> = [];
    for (let i = 0; i < clavesLote.length; i += 150) {
      const { data, error } = await db
        .from("entradas_bascula")
        .select("lote, finca")
        .in("lote", clavesLote.slice(i, i + 150));
      if (error) throw new Error(error.message);
      entradasLotes.push(...(data ?? []));
    }

    const [asistenciaRes, trabajadoresRes, entradasSemanaRes] = await Promise.all([
      db.from("asistencia_detalle").select("date, trabajador_id").gte("date", lunes).lte("date", domingo).eq("presente", true),
      db.from("trabajadores").select("id, zona"),
      db.from("entradas_bascula").select("fecha, kg_entrada").gte("fecha", lunes).lte("fecha", domingo),
    ]);
    if (asistenciaRes.error) throw new Error(asistenciaRes.error.message);
    if (trabajadoresRes.error) throw new Error(trabajadoresRes.error.message);
    if (entradasSemanaRes.error) throw new Error(entradasSemanaRes.error.message);

    // finca por clave de lote (si un lote tiene varias entradas, la primera
    // con finca no vacía) + presencia en báscula.
    const fincaPorLote = new Map<string, string | null>();
    for (const e of entradasLotes) {
      const clave = normalizarLoteCodigo(e.lote);
      if (!clave) continue;
      const actual = fincaPorLote.get(clave);
      if (actual == null || actual.trim() === "") {
        fincaPorLote.set(clave, e.finca ?? actual ?? null);
      }
    }

    const zonaPorTrabajador = new Map(
      (trabajadoresRes.data ?? []).map((t: { id: string; zona: string | null }) => [t.id, t.zona]),
    );

    const dias: DiaInformeSemanal[] = fechas.map((fecha) => {
      const filasDia = filas.filter((f) => f.fecha === fecha);

      const presentesDia = (asistenciaRes.data ?? []).filter((a: { date: string }) => a.date === fecha);
      const presentesPorZona: Record<string, number> = {};
      for (const p of presentesDia as Array<{ trabajador_id: string }>) {
        const zona = (zonaPorTrabajador.get(p.trabajador_id) ?? "").trim() || SIN_ZONA;
        presentesPorZona[zona] = (presentesPorZona[zona] ?? 0) + 1;
      }

      // De computeRentabilidadDia se usan SOLO los kg (total, por destino,
      // podrido): precios por defecto y personal/fruta vacíos — los campos en
      // euros del resultado se ignoran a propósito.
      const rentabilidad = filasDia.length > 0
        ? computeRentabilidadDia(
          filasDia,
          new Map<string, FrutaLoteRentabilidad>(),
          { presentes: presentesDia.length, sumaCosteHoraConocida: 0, presentesSinCoste: 0 },
          { precios: PRECIOS_RENTABILIDAD_DEFECTO, horasJornada: 0, suministrosDiaEur: 0, costeHoraMedio: 0 },
        )
        : null;

      const clavesDia = [...new Set(
        filasDia.map((f) => normalizarLoteCodigo(f.lote_codigo)).filter((c): c is string => !!c),
      )];

      const entradasDia = (entradasSemanaRes.data ?? []).filter((e: { fecha: string }) => e.fecha === fecha);

      return {
        fecha,
        rentabilidad,
        presentes: presentesDia.length,
        presentesPorZona,
        lotesSinEntrada: clavesDia.filter((c) => !fincaPorLote.has(c)),
        kgEntradaBascula: entradasDia.reduce((s: number, e: { kg_entrada: number | null }) => s + (e.kg_entrada ?? 0), 0),
        numEntradasBascula: entradasDia.length,
      };
    });

    const informe = computeInformeSemanal(dias, {
      anio: objetivo.anio,
      semana: objetivo.semana,
      fincaPorLote,
    });
    const asunto = asuntoInformeSemanal(informe);
    const html = renderInformeSemanalHtml(informe);
    const texto = renderInformeSemanalTexto(informe);

    if (body.dry_run) {
      return json({
        enviado: false,
        motivo: "dry_run",
        anio: informe.anio,
        semana: informe.semana,
        asunto,
        kg_total: Math.round(informe.kgTotal),
        pct_podrido: informe.pctPodrido,
        dias_con_produccion: informe.diasConProduccion,
        avisos: informe.avisos,
        texto,
      });
    }

    // Destinatarios SOLO de env: el body no puede desviar el informe.
    const destinatarios = (Deno.env.get("INFORME_SEMANAL_PARA") ?? DESTINATARIO_DEFECTO)
      .split(/[,;]/)
      .map((d) => d.trim())
      .filter((d) => EMAIL_RE.test(d));
    if (destinatarios.length === 0) {
      return json({ enviado: false, motivo: "sin_destinatarios_validos" }, 500);
    }

    const resendKey = Deno.env.get("RESEND_API_KEY")?.trim();
    const from = (
      Deno.env.get("RESEND_FROM_INFORME") ||
      Deno.env.get("RESEND_FROM_RRHH") ||
      Deno.env.get("RESEND_FROM")
    )?.trim();
    if (!resendKey || !from) {
      // Mismo contrato que enviar-comunicacion: sin proveedor no se rompe, se avisa.
      return json({ enviado: false, motivo: "no_configurado", faltantes: [!resendKey && "RESEND_API_KEY", !from && "RESEND_FROM"].filter(Boolean) });
    }
    const replyTo = Deno.env.get("EMAIL_REPLY_TO_INFORME")?.trim() || DESTINATARIO_DEFECTO;

    const envio = await enviarResend(resendKey, from, replyTo, destinatarios, asunto, html, texto);

    const { error: errLog } = await db.from("informe_semanal_envios").insert({
      anio: informe.anio,
      semana: informe.semana,
      destinatarios,
      asunto,
      kg_total: Math.round(informe.kgTotal * 100) / 100,
      avisos: informe.avisos,
      estado: envio.ok ? "enviado" : "error",
      detalle: envio.ok ? envio.id : envio.error,
    });
    if (errLog) console.error(`[informe-semanal] no se pudo registrar el envío: ${errLog.message}`);

    console.log(
      `[informe-semanal] semana=${informe.semana}/${informe.anio} enviado=${envio.ok} destinatarios=${destinatarios.length} avisos=${informe.avisos.length}`,
    );

    if (!envio.ok) {
      return json({ enviado: false, motivo: "error_envio", detalle: envio.error, anio: informe.anio, semana: informe.semana }, 502);
    }
    return json({
      enviado: true,
      anio: informe.anio,
      semana: informe.semana,
      asunto,
      destinatarios,
      kg_total: Math.round(informe.kgTotal),
      pct_podrido: informe.pctPodrido,
      avisos: informe.avisos,
      resend_id: envio.id,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[informe-semanal] error: ${msg}`);
    return json({ error: "No se pudo generar el informe semanal.", detalle: msg }, 500);
  }
});

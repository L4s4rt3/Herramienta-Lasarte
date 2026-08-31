/**
 * cierre-mensual — Edge Function del cierre mensual automático.
 *
 * La programa pg_cron el día 1 de cada mes (05:45 UTC, job
 * `cierre-mensual-dia1`). Reúne el mes CERRADO y lo manda por Resend con la
 * comparación contra el mes anterior: entradas, calibrado por destino,
 * podrido, kg por persona, merma de los lotes terminados, ventas a Mercadona
 * y la foto del stock.
 *
 * TODO el cálculo es compartido con la app vía _shared: computeRentabilidadDia
 * por día (como el informe semanal), el ensamblaje de campaña de
 * campanaEdge.ts (stock + merma con la conciliación de kg) y la lib pura
 * cierreMensual.ts (agregado + render, testeada con vitest).
 *
 * Entrada (POST, JSON, todo opcional):
 * - anio, mes: mes concreto (por defecto, el anterior a hoy Madrid).
 * - force: true reenvía aunque ese mes ya se haya enviado.
 * - dry_run: true calcula y devuelve el cierre SIN enviar ni registrar.
 *
 * Seguridad: verify_jwt activo (el cron llama con la anon key). Destinatarios
 * SOLO de secretos (CIERRE_MENSUAL_PARA); idempotencia con cierre_mensual_envios.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.0";
import {
  computeRentabilidadDia,
  DESTINOS_ORDEN,
  PRECIOS_RENTABILIDAD_DEFECTO,
  type DestinoRentabilidad,
  type FilaClasifRentabilidad,
  type FrutaLoteRentabilidad,
} from "../_shared/rentabilidadDia.ts";
import { seleccionarMermaSemana } from "../_shared/informeSemanal.ts";
import {
  asuntoCierreMensual,
  computeCierreMensual,
  mesAnteriorA,
  mesAnteriorDe,
  rangoMes,
  renderCierreMensualHtml,
  renderCierreMensualTexto,
  type MesDatos,
  type MesRef,
} from "../_shared/cierreMensual.ts";
import {
  calcularStockYMerma,
  cargarCampana,
  fetchTodas,
  toNum,
  type StockYMerma,
} from "../_shared/campanaEdge.ts";

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

type Db = ReturnType<typeof createClient>;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function hoyMadrid(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid" }).format(new Date());
}

async function enviarResend(
  apiKey: string,
  from: string,
  replyTo: string,
  destinatarios: string[],
  asunto: string,
  html: string,
  texto: string,
): Promise<{ ok: boolean; id: string | null; error: string | null }> {
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

function destinosVacios(): Record<DestinoRentabilidad, number> {
  const out = {} as Record<DestinoRentabilidad, number>;
  for (const d of DESTINOS_ORDEN) out[d] = 0;
  return out;
}

/** Los agregados de un mes con las MISMAS funciones que el informe semanal. */
async function cargarMes(db: Db, ref: MesRef, stockYMerma: StockYMerma): Promise<MesDatos> {
  const { desde, hasta } = rangoMes(ref.anio, ref.mes);

  // La VISTA clasificacion_lote: volcado SQL + Excel + DOCX con la regla de
  // frescura por lote-día (migración 20260831120000).
  interface FilaConFecha extends FilaClasifRentabilidad {
    fecha: string | null;
    fuente: string | null;
  }
  const [filas, asistenciaRes, entradasRes, mercadonaKg] = await Promise.all([
    fetchTodas<FilaConFecha>((from, to) =>
      db.from("clasificacion_lote")
        .select("fecha, fuente, lote_codigo, productor, producto, clase, peso_kg, toneladas_hora, duracion_min")
        .gte("fecha", desde).lte("fecha", hasta).order("id").range(from, to)
    ),
    db.from("asistencia_detalle").select("date").gte("date", desde).lte("date", hasta).eq("presente", true),
    db.from("entradas_bascula").select("fecha, kg_entrada").gte("fecha", desde).lte("fecha", hasta),
    fetchTodas<{ kg_netos: number | string | null }>((from, to) =>
      db.from("erp_palet")
        .select("kg_netos")
        .gte("fecha", desde).lte("fecha", hasta)
        .ilike("cliente", "%mercadona%")
        .order("numero").range(from, to)
    ).then((rows) => rows.reduce((s, r) => s + toNum(r.kg_netos), 0)),
  ]);
  if (asistenciaRes.error) throw new Error(asistenciaRes.error.message);
  if (entradasRes.error) throw new Error(entradasRes.error.message);

  const presentesPorDia = new Map<string, number>();
  for (const a of (asistenciaRes.data ?? []) as Array<{ date: string }>) {
    presentesPorDia.set(a.date, (presentesPorDia.get(a.date) ?? 0) + 1);
  }

  const fechasConFilas = [...new Set(filas.map((f) => f.fecha).filter((f): f is string => !!f))].sort();

  const mes: MesDatos = {
    anio: ref.anio,
    mes: ref.mes,
    kgEntrada: ((entradasRes.data ?? []) as Array<{ kg_entrada: number | null }>)
      .reduce((s, e) => s + toNum(e.kg_entrada), 0),
    numEntradas: (entradasRes.data ?? []).length,
    diasConProduccion: 0,
    kgCalibrado: 0,
    kgPorDestino: destinosVacios(),
    kgPodrido: 0,
    kgIndustria: 0,
    sumaPresentes: 0,
    kgConAsistencia: 0,
    kgMercadona: mercadonaKg,
    merma: null,
    kgDetalleDocx: filas.reduce((s, f) => s + (f.fuente === "docx" ? toNum(f.peso_kg) : 0), 0),
  };

  for (const fecha of fechasConFilas) {
    const filasDia = filas.filter((f) => f.fecha === fecha);
    // De computeRentabilidadDia se usan SOLO los kg (mismo uso que el informe
    // semanal): precios por defecto y personal/fruta vacíos a propósito.
    const r = computeRentabilidadDia(
      filasDia,
      new Map<string, FrutaLoteRentabilidad>(),
      { presentes: presentesPorDia.get(fecha) ?? 0, sumaCosteHoraConocida: 0, presentesSinCoste: 0 },
      { precios: PRECIOS_RENTABILIDAD_DEFECTO, horasJornada: 0, suministrosDiaEur: 0, costeHoraMedio: 0 },
    );
    if (r.kgTotal <= 0) continue;
    mes.diasConProduccion += 1;
    mes.kgCalibrado += r.kgTotal;
    for (const d of DESTINOS_ORDEN) mes.kgPorDestino[d] += r.kgPorDestino[d];
    const presentes = presentesPorDia.get(fecha) ?? 0;
    if (presentes > 0) {
      mes.sumaPresentes += presentes;
      mes.kgConAsistencia += r.kgTotal;
    }
  }
  mes.kgPodrido = mes.kgPorDestino.podrido + mes.kgPorDestino.muestra;
  mes.kgIndustria = mes.kgPorDestino.industria;

  mes.merma = seleccionarMermaSemana(
    stockYMerma.mermaLotes,
    stockYMerma.ultimaFechaPorLote,
    desde,
    hasta,
    stockYMerma.datosPorLote,
  );

  return mes;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = (await req.json().catch(() => ({}))) as {
      anio?: number;
      mes?: number;
      force?: boolean;
      dry_run?: boolean;
    };

    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const hoy = hoyMadrid();
    const objetivo: MesRef = body.anio && body.mes
      ? { anio: body.anio, mes: body.mes }
      : mesAnteriorDe(hoy);

    // Idempotencia + anti-spam (salvo dry_run, que ni envía ni registra).
    if (!body.dry_run) {
      const { data: previos, error: errPrevios } = await db
        .from("cierre_mensual_envios")
        .select("anio, mes, estado, enviado_at")
        .order("enviado_at", { ascending: false })
        .limit(10);
      if (errPrevios) throw new Error(errPrevios.message);
      const yaEnviado = (previos ?? []).some((p) =>
        p.anio === objetivo.anio && p.mes === objetivo.mes && p.estado === "enviado"
      );
      if (yaEnviado && !body.force) {
        return json({ enviado: false, motivo: "ya_enviado", ...objetivo });
      }
      const ultimo = previos?.[0];
      if (ultimo && Date.now() - new Date(ultimo.enviado_at).getTime() < COOLDOWN_MS) {
        return json({ enviado: false, motivo: "cooldown", ...objetivo }, 429);
      }
    }

    // Campaña completa (stock + merma con el cableado de la app) y los dos meses.
    const campana = await cargarCampana(db);
    const stockYMerma = calcularStockYMerma(campana, hoy);
    const [actual, anterior] = await Promise.all([
      cargarMes(db, objetivo, stockYMerma),
      cargarMes(db, mesAnteriorA(objetivo), stockYMerma),
    ]);

    const cierre = computeCierreMensual(actual, anterior, stockYMerma.stockInforme);
    const asunto = asuntoCierreMensual(cierre);
    const html = renderCierreMensualHtml(cierre);
    const texto = renderCierreMensualTexto(cierre);

    if (body.dry_run) {
      return json({
        enviado: false,
        motivo: "dry_run",
        ...objetivo,
        asunto,
        kg_entrada: Math.round(actual.kgEntrada),
        kg_calibrado: Math.round(actual.kgCalibrado),
        pct_podrido: cierre.pctPodrido,
        kg_mercadona: Math.round(actual.kgMercadona),
        merma: actual.merma ? { n_lotes: actual.merma.nLotes, kg: Math.round(actual.merma.kgMerma), pct: actual.merma.pctMerma } : null,
        avisos: cierre.avisos,
        texto,
      });
    }

    // Destinatarios SOLO de env: el body no puede desviar el cierre.
    const destinatarios = (Deno.env.get("CIERRE_MENSUAL_PARA") ?? Deno.env.get("INFORME_SEMANAL_PARA") ?? DESTINATARIO_DEFECTO)
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
      return json({ enviado: false, motivo: "no_configurado", faltantes: [!resendKey && "RESEND_API_KEY", !from && "RESEND_FROM"].filter(Boolean) });
    }
    const replyTo = Deno.env.get("EMAIL_REPLY_TO_INFORME")?.trim() || DESTINATARIO_DEFECTO;

    const envio = await enviarResend(resendKey, from, replyTo, destinatarios, asunto, html, texto);

    const { error: errLog } = await db.from("cierre_mensual_envios").insert({
      anio: objetivo.anio,
      mes: objetivo.mes,
      destinatarios,
      asunto,
      kg_entrada: Math.round(actual.kgEntrada * 100) / 100,
      kg_calibrado: Math.round(actual.kgCalibrado * 100) / 100,
      estado: envio.ok ? "enviado" : "error",
      detalle: envio.ok ? envio.id : envio.error,
    });
    if (errLog) console.error(`[cierre-mensual] no se pudo registrar el envío: ${errLog.message}`);

    // Latido para el vigilante y la página /datos/fuentes.
    const { error: errLat } = await db.from("sistema_latidos").upsert({
      trabajo: "cierre-mensual",
      visto_a: new Date().toISOString(),
      estado: envio.ok ? "ok" : "error",
      detalle: envio.ok ? `cierre de ${objetivo.mes}/${objetivo.anio} enviado` : envio.error,
      equipo: "supabase-edge",
    });
    if (errLat) console.error(`[cierre-mensual] no se pudo actualizar el latido: ${errLat.message}`);

    console.log(`[cierre-mensual] mes=${objetivo.mes}/${objetivo.anio} enviado=${envio.ok} kg=${Math.round(actual.kgCalibrado)}`);

    if (!envio.ok) {
      return json({ enviado: false, motivo: "error_envio", detalle: envio.error, ...objetivo }, 502);
    }
    return json({
      enviado: true,
      ...objetivo,
      asunto,
      destinatarios,
      kg_entrada: Math.round(actual.kgEntrada),
      kg_calibrado: Math.round(actual.kgCalibrado),
      pct_podrido: cierre.pctPodrido,
      kg_mercadona: Math.round(actual.kgMercadona),
      resend_id: envio.id,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[cierre-mensual] error: ${msg}`);
    return json({ error: "No se pudo generar el cierre mensual.", detalle: msg }, 500);
  }
});

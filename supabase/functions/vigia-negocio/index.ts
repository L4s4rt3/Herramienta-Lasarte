/**
 * vigia-negocio — Edge Function del vigía de NEGOCIO (diaria, pg_cron 12:15
 * UTC, job `vigia-negocio-diario`).
 *
 * El vigilante avisa cuando un TRABAJO deja de dar señales; este vigía avisa
 * cuando los DATOS, estando vivos, cuentan algo que cuesta dinero o que se
 * está quedando sin hacer. Las reglas viven en _shared/vigiaNegocio.ts (lib
 * pura, testeada con vitest); el stock y la merma salen del MISMO cableado
 * que la app (_shared/campanaEdge.ts). Los hallazgos se guardan en
 * vigia_hallazgos: un "evento" se avisa una sola vez; un "estado" se recuerda
 * los lunes y se resuelve solo cuando deja de detectarse.
 *
 * Si no hay nada nuevo (ni es lunes con pendientes), NO se manda nada.
 *
 * Entrada (POST, JSON, todo opcional):
 * - dry_run: true evalúa y devuelve los hallazgos SIN escribir ni enviar.
 * - force: true manda el correo aunque hoy ya se hubiera avisado.
 *
 * Seguridad: verify_jwt activo (el cron llama con la anon key). Destinatarios
 * SOLO de secretos (VIGIA_PARA, con euros: solo admin); el body no puede
 * desviar el aviso.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.0";
import { calcularStockYMerma, cargarCampana, fetchTodas, toNum } from "../_shared/campanaEdge.ts";
import { registrarLatido } from "../_shared/latido.ts";
import { seleccionarMermaSemana } from "../_shared/informeSemanal.ts";
import {
  conciliarHallazgos,
  costePuestoDesdeCamiones,
  fechaMenosDias,
  reglaCuadreSaf,
  reglaDineroParado,
  reglaFrutaParada,
  reglaMermaFueraDeBanda,
  reglaDetalleCalibrador,
  reglaPartes,
  reglaRendimiento,
  reglaSinVender,
  reglaSobrellenadoMalla,
  renderCorreoVigia,
  tocaEnviarCorreoVigia,
  type DiaDetalleCalibrador,
  type DiaRendimientoVigia,
  type EntradaSafVigiaRow,
  type Hallazgo,
  type HallazgoGuardadoRow,
  type PaletVigiaRow,
  type ParteVigiaRow,
  type SafCamionRow,
} from "../_shared/vigiaNegocio.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const RESEND_API_URL = "https://api.resend.com/emails";
const EMAIL_TIMEOUT_MS = 20_000;
const DESTINATARIO_DEFECTO = "soporte@lasartesat.es";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Ventana de palets del ERP que se mira (cubre dinero-parado y sin-vender). */
const VENTANA_PALETS_DIAS = 70;
/** Ventana de partes que se revisan (descuadres, borradores, papel). */
const VENTANA_PARTES_DIAS = 45;
/** Días hacia atrás para el rendimiento (la asistencia llega los lunes). */
const VENTANA_RENDIMIENTO_DIAS = 12;
/** Días hacia atrás que evalúa el sobrellenado de malla (por si un día no corrió). */
const VENTANA_SOBRELLENADO_DIAS = 3;
/** Primera entrada de la era SAF: lo anterior (Egipto) no se cuadra con Laadbon. */
const SAF_DESDE = "2026-08-25";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function hoyMadrid(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid" }).format(new Date());
}

function esLunesMadrid(): boolean {
  return new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Madrid", weekday: "short" })
    .format(new Date()) === "Mon";
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = (await req.json().catch(() => ({}))) as { dry_run?: boolean; force?: boolean };
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const inicio = new Date().toISOString();
    const hoy = hoyMadrid();
    const esLunes = esLunesMadrid();

    // ── 1. Datos ─────────────────────────────────────────────────────────────
    const [palets, camionesSaf, entradasSaf, partes, filasClasif, asistencia, campana] = await Promise.all([
      fetchTodas<PaletVigiaRow>((from, to) =>
        db.from("erp_palet")
          .select("fecha, articulo, cliente, num_cajas, kg_netos, num_albaran_venta, num_factura, fecha_venta, importe_venta")
          .gte("fecha", fechaMenosDias(hoy, VENTANA_PALETS_DIAS))
          .order("fecha").order("numero").range(from, to)
      ),
      fetchTodas<SafCamionRow>((from, to) =>
        db.from("saf_camiones").select("lote, fecha, cajas, eur_caja, porte_eur, kg_neto_laadbon").order("lote").range(from, to)
      ),
      fetchTodas<EntradaSafVigiaRow>((from, to) =>
        db.from("entradas_bascula")
          .select("lote, fecha, kg_entrada, importe_compra")
          .gte("fecha", SAF_DESDE)
          .ilike("agricultor", "%goesten%")
          .order("fecha").range(from, to)
      ),
      fetchTodas<ParteVigiaRow>((from, to) =>
        db.from("partes_diarios")
          .select("date, estado, campos_estimados")
          .gte("date", fechaMenosDias(hoy, VENTANA_PARTES_DIAS))
          .order("date").range(from, to)
      ),
      // La vista clasificacion_lote mezcla volcado SQL + Excel + DOCX con la
      // regla de frescura por lote-día (migración 20260831120000).
      fetchTodas<{ fecha: string | null; peso_kg: number | string | null }>((from, to) =>
        db.from("clasificacion_lote")
          .select("fecha, peso_kg")
          .gte("fecha", fechaMenosDias(hoy, VENTANA_RENDIMIENTO_DIAS))
          .order("id").range(from, to)
      ),
      fetchTodas<{ date: string }>((from, to) =>
        db.from("asistencia_detalle")
          .select("date")
          .gte("date", fechaMenosDias(hoy, VENTANA_RENDIMIENTO_DIAS))
          .eq("presente", true)
          .order("date").range(from, to)
      ),
      cargarCampana(db),
    ]);

    // ── 2. Reglas ────────────────────────────────────────────────────────────
    const { stockInforme, mermaLotes, ultimaFechaPorLote, datosPorLote } = calcularStockYMerma(campana, hoy);
    const mermaUltimos7 = seleccionarMermaSemana(
      mermaLotes, ultimaFechaPorLote, fechaMenosDias(hoy, 7), hoy, datosPorLote,
    );

    // Kg del día según el PARTE (lotes_dia): es la fuente que sigue viva en la
    // era SAF — lote_clasificacion depende del import manual del Excel y puede
    // quedarse atrás (justo lo que vigila reglaSinDetalleCalibrador).
    const desdeRendimiento = fechaMenosDias(hoy, VENTANA_RENDIMIENTO_DIAS);
    const fechaPorParte = new Map(campana.partes.map((p) => [p.id, p.date ?? null]));
    const kgPorDia = new Map<string, number>();
    for (const l of campana.lotesDia) {
      const fecha = fechaPorParte.get(l.part_id);
      if (!fecha || fecha < desdeRendimiento) continue;
      kgPorDia.set(fecha, (kgPorDia.get(fecha) ?? 0) + toNum(l.kg_peso_total));
    }
    const presentesPorDia = new Map<string, number>();
    for (const a of asistencia) {
      presentesPorDia.set(a.date, (presentesPorDia.get(a.date) ?? 0) + 1);
    }
    const diasRendimiento: DiaRendimientoVigia[] = [...kgPorDia.entries()]
      .filter(([fecha]) => fecha < hoy)
      .map(([fecha, kg]) => ({ fecha, kg, presentes: presentesPorDia.get(fecha) ?? 0 }));

    // El detalle del calibrador (vista, tres fuentes) contra el parte, por día.
    const kgDetallePorDia = new Map<string, number>();
    for (const f of filasClasif) {
      if (!f.fecha) continue;
      kgDetallePorDia.set(f.fecha, (kgDetallePorDia.get(f.fecha) ?? 0) + toNum(f.peso_kg));
    }
    const diasDetalle: DiaDetalleCalibrador[] = [...kgPorDia.entries()]
      .filter(([fecha]) => fecha < hoy)
      .map(([fecha, kgParte]) => ({ fecha, kgParte, kgDetalle: kgDetallePorDia.get(fecha) ?? 0 }));

    const fechasSobrellenado = Array.from(
      { length: VENTANA_SOBRELLENADO_DIAS },
      (_, i) => fechaMenosDias(hoy, i + 1),
    );

    const actuales: Hallazgo[] = [
      ...reglaSobrellenadoMalla(palets, fechasSobrellenado, costePuestoDesdeCamiones(camionesSaf)),
      ...reglaCuadreSaf(camionesSaf, entradasSaf, hoy),
      ...reglaDineroParado(palets, hoy),
      ...reglaSinVender(palets, hoy),
      ...reglaFrutaParada(stockInforme),
      ...reglaMermaFueraDeBanda(mermaUltimos7),
      ...reglaPartes(partes, hoy),
      ...reglaRendimiento(diasRendimiento),
      ...reglaDetalleCalibrador(diasDetalle),
    ];

    // ── 3. Conciliación con lo ya guardado ──────────────────────────────────
    const claves = [...new Set(actuales.map((h) => h.clave))];
    const [porClaveRes, abiertosRes] = await Promise.all([
      claves.length > 0
        ? db.from("vigia_hallazgos").select("id, clave, tipo, titulo, creado_at, resuelto_at").in("clave", claves)
        : Promise.resolve({ data: [], error: null }),
      db.from("vigia_hallazgos").select("id, clave, tipo, titulo, creado_at, resuelto_at").is("resuelto_at", null),
    ]);
    if (porClaveRes.error) throw new Error(porClaveRes.error.message);
    if (abiertosRes.error) throw new Error(abiertosRes.error.message);
    const guardadosPorId = new Map<string, HallazgoGuardadoRow>();
    for (const g of [...(porClaveRes.data ?? []), ...(abiertosRes.data ?? [])] as HallazgoGuardadoRow[]) {
      guardadosPorId.set(g.id, g);
    }
    const plan = conciliarHallazgos(actuales, [...guardadosPorId.values()]);

    if (body.dry_run) {
      return json({
        dry_run: true,
        hallazgos: actuales.length,
        nuevos: plan.nuevos,
        pendientes: plan.pendientes.map((p) => ({ titulo: p.hallazgo.titulo, desde: p.desde })),
        resolver: plan.resolverIds.length,
        enviaria: tocaEnviarCorreoVigia(plan, esLunes),
      });
    }

    // ── 4. Persistencia ──────────────────────────────────────────────────────
    const ahora = new Date().toISOString();
    if (plan.nuevos.length > 0) {
      const { error: errIns } = await db.from("vigia_hallazgos").insert(plan.nuevos.map((h) => ({
        regla: h.regla,
        clave: h.clave,
        tipo: h.tipo,
        severidad: h.severidad,
        titulo: h.titulo,
        detalle: h.detalle,
        eur: h.eur,
        kg: h.kg,
        // Un evento no es un estado abierto: nace ya resuelto (queda de histórico).
        resuelto_at: h.tipo === "evento" ? ahora : null,
      })));
      if (errIns) throw new Error(errIns.message);
    }
    for (const a of plan.actualizar) {
      const { error: errUpd } = await db.from("vigia_hallazgos")
        .update({ titulo: a.titulo, detalle: a.detalle, eur: a.eur, kg: a.kg, actualizado_at: ahora })
        .eq("id", a.id);
      if (errUpd) console.error(`[vigia-negocio] no se pudo refrescar ${a.id}: ${errUpd.message}`);
    }
    if (plan.resolverIds.length > 0) {
      const { error: errRes } = await db.from("vigia_hallazgos")
        .update({ resuelto_at: ahora, actualizado_at: ahora })
        .in("id", plan.resolverIds);
      if (errRes) console.error(`[vigia-negocio] no se pudo resolver: ${errRes.message}`);
    }

    // ── 5. Correo (anti-repetición: una vez al día salvo force) ─────────────
    let envio: { ok: boolean; id: string | null; error: string | null } | null = null;
    let yaAvisado = false;
    if (tocaEnviarCorreoVigia(plan, esLunes)) {
      if (!body.force && plan.nuevos.length === 0) {
        // El resumen del lunes no debe duplicarse si alguien reinvoca a mano.
        const { data: previos } = await db
          .from("sistema_ejecuciones")
          .select("fin, datos")
          .eq("trabajo", "vigia-negocio")
          .gte("fin", new Date(Date.now() - 20 * 3_600_000).toISOString())
          .order("fin", { ascending: false })
          .limit(5);
        yaAvisado = (previos ?? []).some((p) => (p.datos as { avisado?: boolean } | null)?.avisado === true);
      }
      if (!yaAvisado) {
        const apiKey = Deno.env.get("RESEND_API_KEY")?.trim();
        const from = (
          Deno.env.get("RESEND_FROM_VIGIA") ||
          Deno.env.get("RESEND_FROM_VIGILANTE") ||
          Deno.env.get("RESEND_FROM_INFORME") ||
          Deno.env.get("RESEND_FROM")
        )?.trim();
        const destinatarios = (Deno.env.get("VIGIA_PARA") ?? DESTINATARIO_DEFECTO)
          .split(/[,;]/)
          .map((d) => d.trim())
          .filter((d) => EMAIL_RE.test(d));
        if (apiKey && from && destinatarios.length > 0) {
          const correo = renderCorreoVigia(plan, hoy, esLunes);
          envio = await enviarResend(apiKey, from, DESTINATARIO_DEFECTO, destinatarios, correo.asunto, correo.html, correo.texto);
        } else {
          envio = { ok: false, id: null, error: "sin RESEND_API_KEY / RESEND_FROM / destinatarios configurados" };
        }
      }
    }

    // ── 5b. ¿Y el vigilante? Nadie más lo mira ───────────────────────────────
    // El vigilante (11:45 UTC) se excluye a sí mismo de su correo, y si el cron
    // que lo dispara se desprograma, o Resend le falla, no había quien lo dijera
    // (hasta el 02-09-2026). Este vigía corre media hora después: si el
    // vigilante no ha dado señal HOY, o su última señal fue de error, manda un
    // correo llano a los destinatarios del vigilante — una vez al día. Solo
    // se mira pasadas las 12:00 UTC, para que una invocación a mano por la
    // mañana no dé una falsa alarma.
    let avisoVigilante: { ok: boolean; error: string | null } | null = null;
    if (!body.dry_run && new Date().getUTCHours() >= 12) {
      const { data: latidos } = await db.from("sistema_latidos").select("trabajo, visto_a, estado, detalle").eq("trabajo", "vigilante");
      const fila = (latidos ?? [])[0] as { visto_a: string; estado: string; detalle: string | null } | undefined;
      const vistoHoy = !!fila && new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid" }).format(new Date(fila.visto_a)) === hoy;
      const motivo = !fila
        ? null // sin estrenar: no es una avería
        : !vistoHoy
        ? `hoy no ha dado señal (le tocaba a las 13:45; lo último fue ${fila.visto_a.slice(0, 16).replace("T", " ")} UTC)`
        : fila.estado === "error"
        ? `hoy terminó con error: ${fila.detalle ?? "sin detalle"}`
        : null;
      if (motivo) {
        const { data: previos } = await db
          .from("sistema_ejecuciones")
          .select("fin, datos")
          .eq("trabajo", "vigia-negocio")
          .gte("fin", new Date(Date.now() - 20 * 3_600_000).toISOString())
          .order("fin", { ascending: false })
          .limit(5);
        const yaAvisadoVigilante = (previos ?? []).some((p) => (p.datos as { vigilanteAvisado?: boolean } | null)?.vigilanteAvisado === true);
        if (!yaAvisadoVigilante) {
          const apiKey = Deno.env.get("RESEND_API_KEY")?.trim();
          const from = (Deno.env.get("RESEND_FROM_VIGILANTE") || Deno.env.get("RESEND_FROM_VIGIA") || Deno.env.get("RESEND_FROM_INFORME") || Deno.env.get("RESEND_FROM"))?.trim();
          const destinatarios = (Deno.env.get("VIGILANTE_PARA") ?? Deno.env.get("VIGIA_PARA") ?? DESTINATARIO_DEFECTO)
            .split(/[,;]/).map((d) => d.trim()).filter((d) => EMAIL_RE.test(d));
          const texto = [
            "Soy el vigía de negocio que corre en Supabase. Este correo solo llega cuando el VIGILANTE",
            "— el trabajo que avisa si el portátil de la oficina deja de dar señales — tiene un problema,",
            "porque él no puede avisar de sí mismo.",
            "",
            `QUÉ PASA: el vigilante ${motivo}.`,
            "",
            "QUÉ HACER: en Supabase, revisar el job «vigilante-diario» de pg_cron (que exista y esté activo) y",
            "los logs de la edge function vigilante. Si el motivo es de correo (Resend), revisar RESEND_API_KEY",
            "y RESEND_FROM_VIGILANTE en los secretos. Mientras el vigilante esté caído, un portátil apagado",
            "NO genera ningún aviso.",
            "",
            "El detalle de todos los trabajos está en https://controlproduccion.vercel.app/datos/fuentes",
          ].join("\n");
          const html = `<pre style="font:14px/1.5 system-ui,sans-serif;white-space:pre-wrap">${texto.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</pre>`;
          avisoVigilante = apiKey && from && destinatarios.length > 0
            ? await enviarResend(apiKey, from, DESTINATARIO_DEFECTO, destinatarios, "[SISTEMA] El vigilante no está vigilando", html, texto)
            : { ok: false, error: "sin RESEND_API_KEY / RESEND_FROM / destinatarios configurados" };
          console.log(`[vigia-negocio] vigilante en apuros (${motivo}) avisado=${avisoVigilante.ok}${avisoVigilante.error ? ` error=${avisoVigilante.error}` : ""}`);
        }
      }
    }

    // ── 6. Rastro (latido + ejecución, patrón vigilante) ─────────────────────
    const detalle = actuales.length === 0
      ? "sin hallazgos: todo en orden"
      : `${plan.nuevos.length} nuevo(s), ${plan.pendientes.length} pendiente(s), ${plan.resolverIds.length} resuelto(s)` +
        (envio ? (envio.ok ? " (correo enviado)" : ` (NO se pudo avisar: ${envio.error})`) : yaAvisado ? " (ya avisado hoy)" : " (sin correo: nada nuevo)");
    const estado = plan.nuevos.length > 0 ? "aviso" : "ok";

    const { error: errReg } = await db.from("sistema_ejecuciones").insert({
      trabajo: "vigia-negocio",
      inicio,
      estado,
      detalle,
      equipo: "supabase-edge",
      datos: {
        nuevos: plan.nuevos.map((h) => h.clave),
        pendientes: plan.pendientes.length,
        resueltos: plan.resolverIds.length,
        avisado: envio?.ok === true,
        vigilanteAvisado: avisoVigilante?.ok === true,
      },
    });
    if (errReg) console.error(`[vigia-negocio] no se pudo registrar: ${errReg.message}`);
    await registrarLatido(db, "vigia-negocio", estado, detalle + (avisoVigilante ? (avisoVigilante.ok ? " · avisado: el vigilante no vigila" : ` · el vigilante no vigila y NO se pudo avisar: ${avisoVigilante.error}`) : ""));

    console.log(`[vigia-negocio] hallazgos=${actuales.length} nuevos=${plan.nuevos.length} pendientes=${plan.pendientes.length} resueltos=${plan.resolverIds.length} avisado=${envio?.ok ?? false}`);
    return json({
      hallazgos: actuales.length,
      nuevos: plan.nuevos.map((h) => ({ clave: h.clave, titulo: h.titulo })),
      pendientes: plan.pendientes.length,
      resueltos: plan.resolverIds.length,
      avisado: envio?.ok === true,
      yaAvisado,
      detalle,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[vigia-negocio] error: ${msg}`);
    // Latido de error también aquí: un vigía mudo sin rastro no lo caza nadie.
    try {
      const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
      await registrarLatido(db, "vigia-negocio", "error", msg);
    } catch { /* best-effort */ }
    return json({ error: "El vigía de negocio no pudo completar la revisión.", detalle: msg }, 500);
  }
});

/**
 * informe-semanal — Edge Function del informe semanal automático.
 *
 * La programa pg_cron cada lunes a las 12:00 hora de Madrid. Reúne los datos
 * de la semana ISO ANTERIOR y envía por Resend el informe operativo pedido
 * por el dueño (10-08-2026): kg producidos, podrido, trabajadores al día,
 * kg por trabajador y zona, podrido por productor y finca, MERMA de los
 * lotes terminados en la semana y STOCK en cámara.
 *
 * TODO el cálculo es compartido con la app vía _shared (patrón
 * fotoLotesCoherencia): computeRentabilidadDia (kg/podrido, como la página de
 * Rentabilidad), conciliarKgProcesados + buildStockEntradas (la pestaña Stock
 * de Entradas) y computeMermaLotes (la pestaña "Mermas y coste"). El cableado
 * de este archivo es un ESPEJO del de src/hooks/useEntradasBascula.ts y
 * src/hooks/useMermaLote.ts — mismo orden de inyecciones (anotaciones →
 * desglose por box → señales de cámara → conciliación → stock/merma); si se
 * añade una inyección nueva en el hook, añadirla aquí también.
 *
 * Los huecos se enseñan como huecos en "Datos que faltan" — nunca se estima
 * en silencio.
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
  seleccionarMermaSemana,
  semanaIsoAnterior,
  SIN_ZONA,
  type DiaInformeSemanal,
  type SemanaIso,
  type StockInforme,
} from "../_shared/informeSemanal.ts";
import {
  esEntradaCampoCit,
  esEntradaPrecalibrado,
  esErrorTablaOColumnaInexistente,
} from "../_shared/productoresCanonicos.ts";
import {
  agruparAnotacionesPorLoteDia,
  construirLoteCodigoEfectivo,
  type PasadaAnotacionRow,
} from "../_shared/pasadaAnotaciones.ts";
import {
  agruparLineasBoxPorLoteDia,
  expandirPasadaPorDesglose,
  lineaDesdeRow,
  type PasadaBoxLineaRow,
} from "../_shared/desgloseBox.ts";
import {
  codigosEnCamaraExterna,
  type CamionCamaraExterna,
  type SenalesRecepcion,
} from "../_shared/camarasExternas.ts";
import {
  camaraConfirmadaVigentePorLote,
  unirLotesConfirmadosEnCamara,
  type EntradaConCamaraConfirmada,
} from "../_shared/camaraConfirmada.ts";
import {
  capacidadFraccionEstimada,
  conciliarKgProcesados,
  detectarLotesEnPasadaCompuesta,
  type EntradaConciliacion,
  type ReciclajeDiaInput,
} from "../_shared/conciliacionKg.ts";
import { buildStockEntradas, type CierreModo } from "../_shared/entradasBascula.ts";
import {
  computeMermaLotes,
  mapPodridoAggToClasificacionInput,
  type EntradaLoteInput,
  type ParteMermaInput,
  type PodridoAggRow,
} from "../_shared/mermaLote.ts";

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

type Db = ReturnType<typeof createClient>;

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

function toNum(value: unknown): number {
  return Number(value) || 0;
}
function toNumOrNull(value: unknown): number | null {
  return value == null ? null : Number(value) || 0;
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

// ─── Campaña completa: los datos que alimentan stock y merma ────────────────
// Espejo de las queries de useEntradasBascula.ts / useMermaLote.ts /
// usePasadaBoxLineas.ts / useCamarasExternas.ts (mismos selects, misma
// paginación). Las tablas opcionales degradan a lista vacía igual que la app.

interface EntradaCampanaRow {
  lote: string;
  fecha: string;
  agricultor: string | null;
  finca: string | null;
  articulo: string | null;
  kg_entrada: number | null;
  kg_ajuste_stock: number | null;
  importe_compra: number | null;
  coste_recoleccion: number | null;
  importe_transporte: number | null;
  importe_comision: number | null;
  importe_total: number | null;
  cerrado_at?: string | null;
  cierre_modo?: CierreModo | null;
  merma_camara_kg?: number | null;
  fecha_salida_camara?: string | null;
  camara_confirmada_nombre?: string | null;
  camara_confirmada_fecha?: string | null;
}

interface PasadaCampana {
  id: string;
  lote_codigo: string | null;
  kg_peso_total: number;
  date: string | null;
}

interface ParteCampana {
  id: string;
  date: string | null;
  kg_reciclado_malla_z1: number | null;
  kg_reciclado_malla_z2: number | null;
  box_reciclaje?: number | null;
  kg_podrido_calibrador_auto: number | null;
  kg_podrido_bolsa_basura: number | null;
}

async function fetchOpcional<T>(fetcher: () => Promise<T[]>): Promise<T[]> {
  try {
    return await fetcher();
  } catch (e) {
    if (esErrorTablaOColumnaInexistente(e)) return [];
    throw e;
  }
}

async function cargarCampana(db: Db) {
  const fetchPartes = async (): Promise<ParteCampana[]> => {
    try {
      return await fetchTodas<ParteCampana>((from, to) =>
        db.from("partes_diarios")
          .select("id, date, kg_reciclado_malla_z1, kg_reciclado_malla_z2, box_reciclaje, kg_podrido_calibrador_auto, kg_podrido_bolsa_basura")
          .order("id").range(from, to)
      );
    } catch (e) {
      if (!esErrorTablaOColumnaInexistente(e)) throw e;
      return await fetchTodas<ParteCampana>((from, to) =>
        db.from("partes_diarios")
          .select("id, date, kg_reciclado_malla_z1, kg_reciclado_malla_z2, kg_podrido_calibrador_auto, kg_podrido_bolsa_basura")
          .order("id").range(from, to)
      );
    }
  };

  const [entradasTodas, lotesDia, partes, anotaciones, boxLineas, camiones, clasifAgg] = await Promise.all([
    fetchTodas<EntradaCampanaRow>((from, to) =>
      db.from("entradas_bascula").select("*").order("fecha", { ascending: false }).order("id", { ascending: false }).range(from, to)
    ),
    fetchTodas<{ id: string; lote_codigo: string | null; kg_peso_total: number | null; part_id: string }>((from, to) =>
      db.from("lotes_dia").select("id, lote_codigo, kg_peso_total, part_id").order("id").range(from, to)
    ),
    fetchPartes(),
    fetchOpcional(() =>
      fetchTodas<PasadaAnotacionRow>((from, to) =>
        db.from("pasada_anotaciones").select("id, user_id, lote_dia_id, codigo_extra, nota, created_at").order("created_at").order("id").range(from, to)
      )
    ),
    fetchOpcional(() =>
      fetchTodas<PasadaBoxLineaRow>((from, to) =>
        db.from("pasada_box_lineas").select("id, user_id, lote_dia_id, posicion, tipo, lote_codigo, prec_fecha, box, box_tamano, nota").order("lote_dia_id").order("posicion").range(from, to)
      )
    ),
    fetchOpcional(() =>
      fetchTodas<CamionCamaraExterna>((from, to) =>
        db.from("camara_externa_camiones")
          .select("procedencia, s_ref, lote, fecha_almacenamiento, proveedor, finca, variedad, envases, kg, entrada_lst_1, entrada_lst_2, envases_1, envases_2, venta_directa, nota_entrada, transporte_lst")
          .order("fecha_almacenamiento").order("s_ref").range(from, to)
      )
    ),
    // Vista agregada del podrido por lote (migración 20260717120000): si no
    // existiera, el informe FALLA a propósito — degradar aquí cambiaría el
    // podrido real por prorrateo en silencio.
    fetchTodas<PodridoAggRow>((from, to) =>
      db.from("lote_clasificacion_podrido_agg").select("lote8, kg_podrido, n_filas").order("lote8").range(from, to)
    ),
  ]);

  return { entradasTodas, lotesDia, partes, anotaciones, boxLineas, camiones, clasifAgg };
}

/**
 * Stock y merma con el MISMO cableado que useEntradasBascula/useMermaLotes.
 * Devuelve también los mapas auxiliares que el informe necesita (última fecha
 * de procesado conciliada, datos de productor/finca por lote).
 */
function calcularStockYMerma(
  campana: Awaited<ReturnType<typeof cargarCampana>>,
  hoy: string,
  lunes: string,
  domingo: string,
) {
  const { entradasTodas, lotesDia, partes, anotaciones, boxLineas, camiones, clasifAgg } = campana;

  // 1) Partición de entradas (espejo de useEntradasBascula):
  //    PREC = movimiento interno (fuera de stock, tope de re-pasadas);
  //    CAMPO/CIT = derivado a Cítrica (fuera de stock y merma).
  const externas: EntradaCampanaRow[] = [];
  const precalibrado: EntradaCampanaRow[] = [];
  for (const e of entradasTodas) {
    if (esEntradaPrecalibrado(e)) precalibrado.push(e);
    else if (esEntradaCampoCit(e)) continue;
    else externas.push(e);
  }

  // 2) Pasadas del calibrador con la fecha de su parte.
  const fechaPorParte = new Map(partes.map((p) => [p.id, p.date ?? null]));
  const pasadasCrudas: PasadaCampana[] = lotesDia.map((l) => ({
    id: l.id,
    lote_codigo: l.lote_codigo,
    kg_peso_total: toNum(l.kg_peso_total),
    date: fechaPorParte.get(l.part_id) ?? null,
  }));

  const reciclajePorDia: ReciclajeDiaInput[] = partes
    .map((p) => ({
      fecha: p.date ?? "",
      kgBruto: toNum(p.kg_reciclado_malla_z1) + toNum(p.kg_reciclado_malla_z2),
      nBox: toNum(p.box_reciclaje),
    }))
    .filter((p) => p.kgBruto > 0);

  // 3) Inyección de anotaciones a posteriori (código efectivo por pasada).
  const anotacionesPorLoteDia = agruparAnotacionesPorLoteDia(anotaciones);
  const pasadasConAnotaciones = anotacionesPorLoteDia.size === 0 ? pasadasCrudas : pasadasCrudas.map((p) => {
    const filas = anotacionesPorLoteDia.get(p.id);
    if (!filas || filas.length === 0) return p;
    return { ...p, lote_codigo: construirLoteCodigoEfectivo(p.lote_codigo, filas.map((f) => f.codigo_extra)) };
  });

  // 4) Inyección del desglose por box (pasadas sintéticas ya repartidas).
  const lineasPorLoteDia = agruparLineasBoxPorLoteDia(boxLineas);
  const pasadasConDesgloseBox = lineasPorLoteDia.size === 0 ? pasadasConAnotaciones : pasadasConAnotaciones.flatMap((p) => {
    const filas = lineasPorLoteDia.get(p.id);
    if (!filas || filas.length === 0) return [p];
    return expandirPasadaPorDesglose(p, filas.map(lineaDesdeRow));
  });

  // 5) Señales de "sigue en cámara": externa (Guadex/Zamexfruit) + física.
  const salidaPorLote = new Map<string, string | null>();
  for (const e of externas) {
    if (e.fecha_salida_camara == null && e.merma_camara_kg == null) continue;
    const lote8 = normalizarLoteCodigo(e.lote);
    if (lote8) salidaPorLote.set(lote8, e.fecha_salida_camara ?? null);
  }
  const lotesProcesados = new Set<string>();
  for (const p of pasadasCrudas) {
    const lote8 = normalizarLoteCodigo(p.lote_codigo);
    if (lote8) lotesProcesados.add(lote8);
  }
  const senales: SenalesRecepcion = { salidaPorLote, lotesProcesados };
  const codigosExterna = codigosEnCamaraExterna(camiones, senales, hoy);
  const confirmadaPorLote = camaraConfirmadaVigentePorLote(
    externas.map((e): EntradaConCamaraConfirmada => ({
      lote: e.lote,
      camara_confirmada_nombre: e.camara_confirmada_nombre ?? null,
      camara_confirmada_fecha: e.camara_confirmada_fecha ?? null,
    })),
    pasadasCrudas,
  );
  const lotesConfirmadosEnCamara = unirLotesConfirmadosEnCamara(codigosExterna, confirmadaPorLote);

  // 6) Conciliación de kg procesados (reglas del dueño 21-jul-2026).
  const aConciliacion = (e: EntradaCampanaRow, esPrec: boolean): EntradaConciliacion => ({
    lote: e.lote,
    fecha: e.fecha,
    finca: e.finca,
    articulo: e.articulo,
    kg_entrada: toNum(e.kg_entrada),
    kg_preasignado: Math.max(0, toNum(e.kg_ajuste_stock)),
    esPrecalibrado: esPrec,
    cerrado: Boolean(e.cerrado_at),
    kg_merma_camara: e.merma_camara_kg ?? null,
  });
  const conciliacion = conciliarKgProcesados(
    [...externas.map((e) => aConciliacion(e, false)), ...precalibrado.map((e) => aConciliacion(e, true))],
    pasadasConDesgloseBox,
    reciclajePorDia,
    lotesConfirmadosEnCamara,
  );

  const lotesEnPasadaCompuesta = detectarLotesEnPasadaCompuesta(
    pasadasCrudas.map((p) => ({ lote_codigo: p.lote_codigo, kg_peso_total: p.kg_peso_total, date: p.date })),
  );

  // Regla de oro: los kg recibidos por derrame no puntúan para cerrar.
  const kgDerramePorLote = new Map<string, number>();
  for (const m of conciliacion.movimientos) {
    if (m.motivo !== "exceso_misma_finca" && m.motivo !== "exceso_misma_variedad") continue;
    const clave = normalizarLoteCodigo(m.a) ?? m.a;
    kgDerramePorLote.set(clave, (kgDerramePorLote.get(clave) ?? 0) + toNum(m.kg));
  }

  // 7) STOCK — misma llamada que la pestaña Stock de Entradas.
  const stock = buildStockEntradas(
    externas.map((e) => ({
      lote: e.lote,
      fecha: e.fecha,
      kg_entrada: toNum(e.kg_entrada),
      kg_ajuste_stock: toNum(e.kg_ajuste_stock),
      finca: e.finca,
      articulo: e.articulo,
      agricultor: e.agricultor,
      cerrado_at: e.cerrado_at ?? null,
      cierre_modo: e.cierre_modo ?? null,
    })),
    conciliacion.procesados,
    hoy,
    lotesEnPasadaCompuesta,
    capacidadFraccionEstimada,
    lotesConfirmadosEnCamara,
    confirmadaPorLote,
    kgDerramePorLote,
  );
  const stockInforme: StockInforme = {
    kgEnCamara: stock.kgEnCamara,
    kgEnCamaraFirme: stock.kgEnCamaraFirme,
    kgProbablementeTerminados: stock.kgProbablementeTerminados,
    lotesProbablementeTerminados: stock.lotesProbablementeTerminados,
    lotesPendientes: stock.lotesPendientes,
    lotesParciales: stock.lotesParciales,
    antiguedadMaxDias: stock.antiguedadMaxDias,
  };

  // 8) MERMA — misma llamada que la pestaña "Mermas y coste".
  const conciliadoPorLote = new Map<string, { kg: number; ultimaFecha: string | null }>();
  for (const p of conciliacion.procesados) {
    conciliadoPorLote.set(p.lote_codigo, { kg: p.kg_peso_total, ultimaFecha: p.date });
  }
  const entradasMerma: EntradaLoteInput[] = externas.map((e) => ({
    lote: e.lote,
    fecha: e.fecha,
    kg_entrada: toNum(e.kg_entrada),
    kg_ajuste_stock: toNumOrNull(e.kg_ajuste_stock),
    importe_compra: toNumOrNull(e.importe_compra),
    coste_recoleccion: toNumOrNull(e.coste_recoleccion),
    importe_transporte: toNumOrNull(e.importe_transporte),
    importe_comision: toNumOrNull(e.importe_comision),
    importe_total: toNumOrNull(e.importe_total),
    cerrado_at: e.cerrado_at ?? null,
    cierre_modo: e.cierre_modo ?? null,
    merma_camara_kg: toNumOrNull(e.merma_camara_kg),
  }));
  const partesMerma: ParteMermaInput[] = partes.map((p) => ({
    part_id: p.id,
    date: p.date ?? null,
    kg_podrido_calibrador_auto: toNumOrNull(p.kg_podrido_calibrador_auto),
    kg_podrido_bolsa_basura: toNumOrNull(p.kg_podrido_bolsa_basura),
  }));
  const mermaLotes = computeMermaLotes(
    entradasMerma,
    lotesDia.map((l) => ({ lote_codigo: l.lote_codigo, kg_peso_total: toNum(l.kg_peso_total), part_id: l.part_id })),
    mapPodridoAggToClasificacionInput(clasifAgg),
    partesMerma,
    conciliadoPorLote.size > 0 ? conciliadoPorLote : undefined,
  );

  // Última fecha de procesado por lote: la conciliada; sin ella, la cruda.
  const ultimaFechaPorLote = new Map<string, string | null>();
  for (const p of pasadasCrudas) {
    const lote8 = normalizarLoteCodigo(p.lote_codigo);
    if (!lote8 || !p.date) continue;
    const actual = ultimaFechaPorLote.get(lote8);
    if (!actual || p.date > actual) ultimaFechaPorLote.set(lote8, p.date);
  }
  for (const [lote, c] of conciliadoPorLote) {
    if (c.ultimaFecha) ultimaFechaPorLote.set(lote, c.ultimaFecha);
  }

  const datosPorLote = new Map<string, { agricultor: string | null; finca: string | null }>();
  for (const e of externas) {
    const lote8 = normalizarLoteCodigo(e.lote);
    if (lote8 && !datosPorLote.has(lote8)) datosPorLote.set(lote8, { agricultor: e.agricultor, finca: e.finca });
  }

  const mermaSemana = seleccionarMermaSemana(mermaLotes, ultimaFechaPorLote, lunes, domingo, datosPorLote);

  // finca por lote para el desglose de podrido por productor+finca.
  const fincaPorLote = new Map<string, string | null>();
  for (const [lote8, d] of datosPorLote) fincaPorLote.set(lote8, d.finca);

  return { stockInforme, mermaSemana, fincaPorLote };
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
    const hoy = hoyMadrid();
    const objetivo: SemanaIso = body.anio && body.semana
      ? { anio: body.anio, semana: body.semana }
      : semanaIsoAnterior(hoy);
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

    // --- Datos de la SEMANA (espejo de useRentabilidadDia) + CAMPAÑA -------
    interface FilaConFecha extends FilaClasifRentabilidad {
      fecha: string | null;
    }
    const [filas, asistenciaRes, trabajadoresRes, entradasSemanaRes, campana] = await Promise.all([
      fetchTodas<FilaConFecha>((from, to) =>
        db.from("lote_clasificacion")
          .select("fecha, lote_codigo, productor, producto, clase, peso_kg, toneladas_hora, duracion_min")
          .gte("fecha", lunes).lte("fecha", domingo).order("id").range(from, to)
      ),
      db.from("asistencia_detalle").select("date, trabajador_id").gte("date", lunes).lte("date", domingo).eq("presente", true),
      db.from("trabajadores").select("id, zona"),
      db.from("entradas_bascula").select("fecha, kg_entrada").gte("fecha", lunes).lte("fecha", domingo),
      cargarCampana(db),
    ]);
    if (asistenciaRes.error) throw new Error(asistenciaRes.error.message);
    if (trabajadoresRes.error) throw new Error(trabajadoresRes.error.message);
    if (entradasSemanaRes.error) throw new Error(entradasSemanaRes.error.message);

    // --- Stock + merma con el cableado de la app ----------------------------
    const { stockInforme, mermaSemana, fincaPorLote } = calcularStockYMerma(campana, hoy, lunes, domingo);

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
      mermaSemana,
      stock: stockInforme,
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
        stock_kg: Math.round(stockInforme.kgEnCamara),
        merma_semana: { n_lotes: mermaSemana.nLotes, kg: Math.round(mermaSemana.kgMerma), pct: mermaSemana.pctMerma },
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
      `[informe-semanal] semana=${informe.semana}/${informe.anio} enviado=${envio.ok} destinatarios=${destinatarios.length} avisos=${informe.avisos.length} stock=${Math.round(stockInforme.kgEnCamara)}kg merma_lotes=${mermaSemana.nLotes}`,
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
      stock_kg: Math.round(stockInforme.kgEnCamara),
      merma_semana: { n_lotes: mermaSemana.nLotes, kg: Math.round(mermaSemana.kgMerma), pct: mermaSemana.pctMerma },
      avisos: informe.avisos,
      resend_id: envio.id,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[informe-semanal] error: ${msg}`);
    return json({ error: "No se pudo generar el informe semanal.", detalle: msg }, 500);
  }
});

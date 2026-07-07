/**
 * chat — Edge Function para Vadim, el asistente de Herramienta Lasarte.
 * Llama a un proveedor IA con formato OpenAI (streaming SSE) y reenvía el
 * stream de texto plano al cliente (useChatBot / gemini.ts).
 *
 * Cadena de proveedores:
 *   1. OpenRouter (si hay OPENROUTER_API_KEY): modelo principal gratuito con
 *      fallback automático a un segundo modelo gratuito si el primero
 *      devuelve error o límite de peticiones (429), o si ambos fallan del
 *      todo y hay OpenCode disponible como último recurso. Solo en los
 *      intentos de OpenRouter se ofrece function calling (tools) contra la
 *      base de datos: el modelo puede pedir datos exactos antes de responder.
 *   2. OpenCode zen (si hay OPENCODE_API_KEY): mismo formato OpenAI, sin tools.
 *   3. Puter (si hay PUTER_AUTH_TOKEN): sin streaming, texto de una pieza, sin tools.
 *   4. Si no hay ninguna key configurada: error claro.
 */

import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

const PROVIDER_TIMEOUT_MS = 30_000;

const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_PRIMARY_MODEL = "nvidia/nemotron-3-ultra-550b-a55b:free";
const OPENROUTER_FALLBACK_MODEL = "nvidia/nemotron-3-super-120b-a12b:free";
const SITE_URL = "https://lasartesat.es";
const SITE_TITLE = "Herramienta Lasarte";

const OPENCODE_API_URL = "https://opencode.ai/zen/v1/chat/completions";
const OPENCODE_MODEL = "deepseek-v4-flash"; // requiere método de pago en el workspace de OpenCode (su free tier fue retirado)

const PUTER_API_URL = "https://api.puter.com/puterai/openai/v1/chat/completions";
const PUTER_MODEL = "qwen/qwen3.6-flash";

const MAX_TOOL_ITERATIONS = 4;

/**
 * Llama a un endpoint de chat completions compatible con OpenAI (streaming
 * SSE). Devuelve el Response crudo si el upstream respondió ok (para poder
 * leer el stream); lanza si no.
 */
async function callProvider(
  url: string,
  headers: Record<string, string>,
  model: string,
  messages: ChatMessage[],
  signal: AbortSignal,
  label: string,
  extraBody: Record<string, unknown> = {},
): Promise<Response> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify({
      model,
      messages,
      stream: true,
      temperature: 0.3,
      ...extraBody,
    }),
    signal,
  });

  if (!res.ok || !res.body) {
    const errText = await res.text().catch(() => "unknown");
    const err = new Error(`${label} ${model} -> ${res.status}: ${errText}`);
    (err as Error & { status?: number }).status = res.status;
    throw err;
  }

  return res;
}

/**
 * Convierte la respuesta SSE completa de un proveedor OpenAI-compatible en el
 * texto final (concatena los delta.content). Se procesa el cuerpo entero: el
 * runtime edge de Supabase no reenvía streams transformados de forma fiable
 * (perdía caracteres multibyte o cerraba la tubería), así que la respuesta se
 * entrega de una pieza, igual que hacía el chat original.
 */
function sseToText(raw: string): string {
  let out = "";
  for (const rawLine of raw.split("\n")) {
    const line = rawLine.trim();
    if (!line || !line.startsWith("data:")) continue;
    const data = line.slice(5).trim();
    if (data === "[DONE]") continue;
    try {
      const delta: string | undefined = JSON.parse(data)?.choices?.[0]?.delta?.content;
      if (delta) out += delta;
    } catch {
      // Línea de mantenimiento o incompleta: se ignora.
    }
  }
  return out;
}

// ─── Herramientas (function calling) ───────────────────────────────────────
// Funciones curadas y fijas: el modelo nunca escribe SQL, solo elige una de
// estas funciones y le pasa parámetros tipados. Cada una hace SOLO lecturas
// con el service role (RLS bypass de lectura), valida sus parámetros y
// devuelve JSON compacto (kg redondeados) para no gastar contexto.

const TOOLS_SCHEMA = [
  {
    type: "function",
    function: {
      name: "produccion_por_dias",
      description:
        "Producción diaria real de la planta entre dos fechas (partes_diarios). Devuelve, por cada día: producción real en kg (calibrador menos mujeres y reciclado), palets ajustados en kg, y el DSJ (diferencia de saldo en kg y en %). Útil para preguntas sobre cuánto se produjo, mermas o descuadres en un periodo.",
      parameters: {
        type: "object",
        properties: {
          desde: { type: "string", description: "Fecha inicio, formato YYYY-MM-DD" },
          hasta: { type: "string", description: "Fecha fin, formato YYYY-MM-DD" },
        },
        required: ["desde", "hasta"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "top_productores",
      description:
        "Ranking de productores por kg totales aportados en un periodo (lotes_dia agrupado por productor). Incluye número de lotes, toneladas/hora media y nº de productos distintos que trajo cada uno. Útil para preguntas de 'quién trajo más' o comparativas entre productores.",
      parameters: {
        type: "object",
        properties: {
          desde: { type: "string", description: "Fecha inicio, formato YYYY-MM-DD" },
          hasta: { type: "string", description: "Fecha fin, formato YYYY-MM-DD" },
          limite: { type: "number", description: "Nº máximo de productores a devolver (máx 20, por defecto 10)" },
        },
        required: ["desde", "hasta"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "lotes_de_productor",
      description:
        "Lista de lotes concretos de un productor (por nombre, coincidencia parcial) en un periodo: fecha, código de lote, producto, kg y toneladas/hora. Útil para inspeccionar el detalle de un productor concreto.",
      parameters: {
        type: "object",
        properties: {
          productor: { type: "string", description: "Nombre o parte del nombre del productor a buscar" },
          desde: { type: "string", description: "Fecha inicio, formato YYYY-MM-DD" },
          hasta: { type: "string", description: "Fecha fin, formato YYYY-MM-DD" },
        },
        required: ["productor", "desde", "hasta"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "mercadona_semanas",
      description:
        "Datos de las semanas de Mercadona de un año: kg vendidos, kg planificados, diferencia porcentual y desglose de kilos por método de trabajo. Útil para preguntas sobre cumplimiento de planificación con Mercadona.",
      parameters: {
        type: "object",
        properties: {
          anio: { type: "number", description: "Año (ej. 2026)" },
        },
        required: ["anio"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "consumos_por_dias",
      description:
        "Consumos físicos totales de la planta en un periodo (consumos_fisicos), agrupados por recurso: agua (litros), gasoil (litros), electricidad (kWh) y químicos (litros). Útil para preguntas sobre consumo de recursos o costes energéticos/hídricos.",
      parameters: {
        type: "object",
        properties: {
          desde: { type: "string", description: "Fecha inicio, formato YYYY-MM-DD" },
          hasta: { type: "string", description: "Fecha fin, formato YYYY-MM-DD" },
        },
        required: ["desde", "hasta"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "calidad_recientes",
      description:
        "Resumen de calidad de fruta en un periodo (calidad_lotes): número de notas registradas, número de incidencias (calidad Regular, Deficiente o Pésimo), los 5 defectos más frecuentes y los productores con incidencias. Útil para preguntas sobre problemas de calidad.",
      parameters: {
        type: "object",
        properties: {
          desde: { type: "string", description: "Fecha inicio, formato YYYY-MM-DD" },
          hasta: { type: "string", description: "Fecha fin, formato YYYY-MM-DD" },
        },
        required: ["desde", "hasta"],
      },
    },
  },
];

const MAX_RANGE_DAYS = 92;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function toolError(message: string): string {
  return JSON.stringify({ error: message });
}

function round(n: number, decimals = 1): number {
  const f = Math.pow(10, decimals);
  return Math.round((Number(n) || 0) * f) / f;
}

/** Valida un rango de fechas YYYY-MM-DD, con tope de días. Lanza string de error si algo falla. */
function validarRango(desde: unknown, hasta: unknown, maxDays = MAX_RANGE_DAYS): { desde: string; hasta: string } | { error: string } {
  if (typeof desde !== "string" || !DATE_RE.test(desde)) return { error: "Parámetro 'desde' inválido, debe ser YYYY-MM-DD" };
  if (typeof hasta !== "string" || !DATE_RE.test(hasta)) return { error: "Parámetro 'hasta' inválido, debe ser YYYY-MM-DD" };
  const d1 = new Date(desde + "T00:00:00Z").getTime();
  const d2 = new Date(hasta + "T00:00:00Z").getTime();
  if (!isFinite(d1) || !isFinite(d2)) return { error: "Fechas no válidas" };
  if (d2 < d1) return { error: "'hasta' no puede ser anterior a 'desde'" };
  const days = Math.round((d2 - d1) / 86_400_000) + 1;
  if (days > maxDays) return { error: `El rango no puede superar ${maxDays} días (pedido: ${days})` };
  return { desde, hasta };
}

// ─── Implementación de cada herramienta ────────────────────────────────────

async function toolProduccionPorDias(admin: SupabaseClient, args: Record<string, unknown>): Promise<string> {
  const rango = validarRango(args.desde, args.hasta);
  if ("error" in rango) return toolError(rango.error);

  const { data, error } = await admin
    .from("partes_diarios")
    .select(
      "date, kg_produccion_calibrador, kg_mujeres_calibrador, kg_reciclado_malla_z1, kg_reciclado_malla_z2, kg_palets_brutos, kg_inventario_anterior_sin_alta, kg_inventario_sin_alta, kg_podrido_bolsa_basura",
    )
    .gte("date", rango.desde)
    .lte("date", rango.hasta)
    .order("date", { ascending: true });

  if (error) return toolError(error.message);

  const dias = (data ?? []).map((r) => {
    const produccion_real =
      (Number(r.kg_produccion_calibrador) || 0) -
      (Number(r.kg_mujeres_calibrador) || 0) -
      (Number(r.kg_reciclado_malla_z1) || 0) -
      (Number(r.kg_reciclado_malla_z2) || 0);
    const palets_ajustados = (Number(r.kg_palets_brutos) || 0) - (Number(r.kg_inventario_anterior_sin_alta) || 0);
    const diferencia_bruta = produccion_real - palets_ajustados - (Number(r.kg_inventario_sin_alta) || 0);
    const dsj = diferencia_bruta - (Number(r.kg_podrido_bolsa_basura) || 0);
    const dsj_pct = produccion_real > 0 ? (dsj / produccion_real) * 100 : 0;
    return {
      fecha: r.date,
      produccion_real_kg: round(produccion_real, 0),
      palets_ajustados_kg: round(palets_ajustados, 0),
      dsj_kg: round(dsj, 0),
      dsj_pct: round(dsj_pct, 2),
    };
  });

  return JSON.stringify({ desde: rango.desde, hasta: rango.hasta, dias });
}

async function toolTopProductores(admin: SupabaseClient, args: Record<string, unknown>): Promise<string> {
  const rango = validarRango(args.desde, args.hasta);
  if ("error" in rango) return toolError(rango.error);

  let limite = Number(args.limite) || 10;
  if (!isFinite(limite) || limite <= 0) limite = 10;
  limite = Math.min(20, Math.max(1, Math.round(limite)));

  const { data, error } = await admin
    .from("lotes_dia")
    .select("productor, producto, kg_peso_total, toneladas_hora, partes_diarios!inner(date)")
    .gte("partes_diarios.date", rango.desde)
    .lte("partes_diarios.date", rango.hasta);

  if (error) return toolError(error.message);

  type Acc = { kg: number; lotes: number; tphSum: number; tphCount: number; productos: Set<string> };
  const porProductor = new Map<string, Acc>();
  for (const r of (data ?? []) as Array<{ productor: string | null; producto: string | null; kg_peso_total: number | null; toneladas_hora: number | null }>) {
    const nombre = (r.productor ?? "Sin productor").trim() || "Sin productor";
    const acc = porProductor.get(nombre) ?? { kg: 0, lotes: 0, tphSum: 0, tphCount: 0, productos: new Set<string>() };
    acc.kg += Number(r.kg_peso_total) || 0;
    acc.lotes += 1;
    if (r.toneladas_hora != null && Number(r.toneladas_hora) > 0) {
      acc.tphSum += Number(r.toneladas_hora);
      acc.tphCount += 1;
    }
    if (r.producto) acc.productos.add(r.producto);
    porProductor.set(nombre, acc);
  }

  const productores = Array.from(porProductor.entries())
    .map(([productor, acc]) => ({
      productor,
      kg_total: round(acc.kg, 0),
      n_lotes: acc.lotes,
      tph_media: acc.tphCount > 0 ? round(acc.tphSum / acc.tphCount, 2) : null,
      n_productos: acc.productos.size,
    }))
    .sort((a, b) => b.kg_total - a.kg_total)
    .slice(0, limite);

  return JSON.stringify({ desde: rango.desde, hasta: rango.hasta, productores });
}

async function toolLotesDeProductor(admin: SupabaseClient, args: Record<string, unknown>): Promise<string> {
  const rango = validarRango(args.desde, args.hasta);
  if ("error" in rango) return toolError(rango.error);
  const productor = typeof args.productor === "string" ? args.productor.trim() : "";
  if (!productor) return toolError("Parámetro 'productor' requerido");

  const { data, error } = await admin
    .from("lotes_dia")
    .select("lote_codigo, producto, kg_peso_total, toneladas_hora, productor, partes_diarios!inner(date)")
    .ilike("productor", `%${productor}%`)
    .gte("partes_diarios.date", rango.desde)
    .lte("partes_diarios.date", rango.hasta)
    .limit(50);

  if (error) return toolError(error.message);

  const lotes = (data ?? []).map((r: any) => ({
    fecha: r.partes_diarios?.date ?? null,
    lote_codigo: r.lote_codigo,
    producto: r.producto,
    kg: round(Number(r.kg_peso_total) || 0, 0),
    tph: r.toneladas_hora != null ? round(Number(r.toneladas_hora), 2) : null,
  }));

  return JSON.stringify({ productor, desde: rango.desde, hasta: rango.hasta, n_lotes: lotes.length, lotes });
}

async function toolMercadonaSemanas(admin: SupabaseClient, args: Record<string, unknown>): Promise<string> {
  const anio = Number(args.anio);
  if (!isFinite(anio) || anio < 2000 || anio > 2100) return toolError("Parámetro 'anio' inválido");

  const { data: semanas, error } = await admin
    .from("mercadona_semanas")
    .select("id, semana, vendido_kg, planificado_semana_kg, planificado_quincena_kg, diferencia_pct")
    .eq("anio", anio)
    .order("semana", { ascending: true });

  if (error) return toolError(error.message);
  if (!semanas || semanas.length === 0) return JSON.stringify({ anio, semanas: [] });

  const ids = semanas.map((s) => s.id);
  const { data: metodos, error: mErr } = await admin
    .from("mercadona_semana_metodos")
    .select("semana_id, metodo, kilos")
    .in("semana_id", ids);
  if (mErr) return toolError(mErr.message);

  const kgPorSemana = new Map<string, number>();
  for (const m of metodos ?? []) {
    kgPorSemana.set(m.semana_id, (kgPorSemana.get(m.semana_id) ?? 0) + (Number(m.kilos) || 0));
  }

  const result = semanas.map((s) => ({
    semana: s.semana,
    vendido_kg: round(Number(s.vendido_kg) || 0, 0),
    planificado_semana_kg: s.planificado_semana_kg != null ? round(Number(s.planificado_semana_kg), 0) : null,
    diferencia_pct: s.diferencia_pct != null ? round(Number(s.diferencia_pct), 2) : null,
    kg_por_metodos: round(kgPorSemana.get(s.id) ?? 0, 0),
  }));

  return JSON.stringify({ anio, semanas: result });
}

async function toolConsumosPorDias(admin: SupabaseClient, args: Record<string, unknown>): Promise<string> {
  const rango = validarRango(args.desde, args.hasta);
  if ("error" in rango) return toolError(rango.error);

  // Cualquier registro de consumo cuyo rango [fecha_inicio, fecha_fin] se solape
  // con el periodo pedido se cuenta entero (aproximación simple, sin prorrateo
  // por día — el prorrateo fino vive en consumosFisicos.ts del frontend).
  const { data, error } = await admin
    .from("consumos_fisicos")
    .select("recurso, cantidad, unidad, fecha_inicio, fecha_fin")
    .lte("fecha_inicio", rango.hasta)
    .gte("fecha_fin", rango.desde);

  if (error) return toolError(error.message);

  let aguaL = 0, gasoilL = 0, electricidadKwh = 0, quimicosL = 0;
  for (const r of data ?? []) {
    const cantidad = Number(r.cantidad) || 0;
    const enLitros = r.unidad === "m3" ? cantidad * 1000 : cantidad;
    switch (r.recurso) {
      case "agua": aguaL += enLitros; break;
      case "gasoil": gasoilL += enLitros; break;
      case "electricidad": electricidadKwh += cantidad; break;
      case "quimicos": quimicosL += enLitros; break;
    }
  }

  return JSON.stringify({
    desde: rango.desde,
    hasta: rango.hasta,
    agua_l: round(aguaL, 0),
    gasoil_l: round(gasoilL, 0),
    electricidad_kwh: round(electricidadKwh, 0),
    quimicos_l: round(quimicosL, 0),
  });
}

async function toolCalidadRecientes(admin: SupabaseClient, args: Record<string, unknown>): Promise<string> {
  const rango = validarRango(args.desde, args.hasta);
  if ("error" in rango) return toolError(rango.error);

  const { data, error } = await admin
    .from("calidad_lotes")
    .select("calidad, defectos, productor_finca_nombre, fecha")
    .gte("fecha", rango.desde)
    .lte("fecha", rango.hasta);

  if (error) return toolError(error.message);

  const rows = data ?? [];
  const INCIDENCIA_ESTADOS = new Set(["Regular", "Deficiente", "Pésimo"]);
  let incidencias = 0;
  const defectosCount = new Map<string, number>();
  const productoresConIncidencia = new Set<string>();

  for (const r of rows) {
    const esIncidencia = INCIDENCIA_ESTADOS.has(r.calidad as string);
    if (esIncidencia) {
      incidencias += 1;
      if (r.productor_finca_nombre) productoresConIncidencia.add(r.productor_finca_nombre);
    }
    for (const d of (r.defectos ?? []) as string[]) {
      defectosCount.set(d, (defectosCount.get(d) ?? 0) + 1);
    }
  }

  const top_defectos = Array.from(defectosCount.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([defecto, veces]) => ({ defecto, veces }));

  return JSON.stringify({
    desde: rango.desde,
    hasta: rango.hasta,
    n_notas: rows.length,
    n_incidencias: incidencias,
    top_defectos,
    productores_con_incidencias: Array.from(productoresConIncidencia).slice(0, 20),
  });
}

async function ejecutarHerramienta(admin: SupabaseClient, name: string, argsRaw: string): Promise<string> {
  let args: Record<string, unknown> = {};
  try {
    args = argsRaw ? JSON.parse(argsRaw) : {};
  } catch {
    return toolError("Argumentos JSON inválidos");
  }

  console.log(`[chat] tool ${name} args=${JSON.stringify(args)}`);

  try {
    switch (name) {
      case "produccion_por_dias": return await toolProduccionPorDias(admin, args);
      case "top_productores": return await toolTopProductores(admin, args);
      case "lotes_de_productor": return await toolLotesDeProductor(admin, args);
      case "mercadona_semanas": return await toolMercadonaSemanas(admin, args);
      case "consumos_por_dias": return await toolConsumosPorDias(admin, args);
      case "calidad_recientes": return await toolCalidadRecientes(admin, args);
      default:
        return toolError(`Herramienta desconocida: ${name}`);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[chat] tool ${name} error: ${msg}`);
    return toolError(`Fallo al ejecutar ${name}: ${msg}`);
  }
}

/** Detecta si el error de un proveedor viene de que el modelo/endpoint no soporta 'tools'. */
function esErrorDeTools(msg: string): boolean {
  return /\btools?\b/i.test(msg) && /(not support|unsupport|invalid|unknown|function.?calling)/i.test(msg);
}

/**
 * Llama a un endpoint OpenAI-compatible SIN streaming (stream:false) para
 * poder leer tool_calls directamente del JSON. Devuelve el mensaje del
 * asistente (choices[0].message).
 */
async function callProviderNonStreaming(
  url: string,
  headers: Record<string, string>,
  model: string,
  messages: ChatMessage[],
  signal: AbortSignal,
  label: string,
  tools: unknown[] | undefined,
  extraBody: Record<string, unknown> = {},
): Promise<{ role: string; content: string | null; tool_calls?: ToolCall[] }> {
  const body: Record<string, unknown> = {
    model,
    messages,
    stream: false,
    temperature: 0.3,
    ...extraBody,
  };
  if (tools && tools.length > 0) body.tools = tools;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "unknown");
    const err = new Error(`${label} ${model} -> ${res.status}: ${errText}`);
    (err as Error & { status?: number }).status = res.status;
    throw err;
  }

  const json = await res.json();
  const message = json?.choices?.[0]?.message;
  if (!message) throw new Error(`${label}: respuesta sin message`);
  return message;
}

/**
 * Ejecuta el bucle de tool-calling contra OpenRouter para un modelo dado.
 * Si el proveedor no soporta tools, reintenta una vez sin ellas antes de
 * lanzar. Devuelve el texto final de una pieza.
 */
async function callOpenRouterConTools(
  model: string,
  baseMessages: ChatMessage[],
  headers: Record<string, string>,
  admin: SupabaseClient,
  signal: AbortSignal,
): Promise<string> {
  let messages = [...baseMessages];
  let useTools = true;

  for (let reintento = 0; reintento < 2; reintento++) {
    try {
      for (let iter = 0; iter < MAX_TOOL_ITERATIONS; iter++) {
        const forzarFinal = iter === MAX_TOOL_ITERATIONS - 1;
        const message = await callProviderNonStreaming(
          OPENROUTER_API_URL,
          headers,
          model,
          messages,
          signal,
          "OpenRouter",
          useTools && !forzarFinal ? TOOLS_SCHEMA : undefined,
          { reasoning: { enabled: false } },
        );

        const toolCalls = message.tool_calls;
        if (useTools && !forzarFinal && Array.isArray(toolCalls) && toolCalls.length > 0) {
          messages.push({ role: "assistant", content: message.content ?? "", tool_calls: toolCalls });
          for (const call of toolCalls) {
            const resultado = await ejecutarHerramienta(admin, call.function.name, call.function.arguments);
            messages.push({ role: "tool", tool_call_id: call.id, name: call.function.name, content: resultado });
          }
          continue; // siguiente iteración: dejar que el modelo use los resultados
        }

        const texto = message.content ?? "";
        if (!texto.trim()) throw new Error("OpenRouter: respuesta vacía");
        return texto;
      }
      throw new Error("OpenRouter: se agotaron las iteraciones de herramientas sin respuesta final");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (useTools && esErrorDeTools(msg)) {
        console.warn(`[chat] ${model} no soporta tools, reintentando sin ellas: ${msg}`);
        useTools = false;
        messages = [...baseMessages];
        continue;
      }
      throw err;
    }
  }
  throw new Error("OpenRouter: fallo inesperado en el bucle de tools");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const openRouterKey = Deno.env.get("OPENROUTER_API_KEY");
    const openCodeKey = Deno.env.get("OPENCODE_API_KEY");
    const puterToken = Deno.env.get("PUTER_AUTH_TOKEN");

    if (!openRouterKey && !openCodeKey && !puterToken) {
      return new Response(
        JSON.stringify({ error: "El asistente no está configurado todavía (falta OPENROUTER_API_KEY, OPENCODE_API_KEY o PUTER_AUTH_TOKEN en los secretos)." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

    const { message, history, systemInstruction } = await req.json() as {
      message: string;
      history: ChatMessage[];
      systemInstruction: string;
    };

    if (!message || !message.trim()) {
      return new Response(
        JSON.stringify({ error: "Falta el mensaje a enviar." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Fecha local España (Europe/Madrid) para dar contexto temporal al modelo.
    const fechaHoyEspana = new Intl.DateTimeFormat("es-ES", {
      timeZone: "Europe/Madrid",
      year: "numeric",
      month: "long",
      day: "numeric",
    }).format(new Date());

    const guiaHerramientas =
      "\n\nDispones de herramientas para consultar datos exactos de la base de datos. " +
      "Úsalas cuando pregunten por cifras concretas, comparativas o periodos que no estén en tu contexto. " +
      `Hoy es ${fechaHoyEspana}. Responde siempre con los datos obtenidos, citando el periodo consultado.`;

    const systemInstructionCompleta = (systemInstruction ?? "") + guiaHerramientas;

    const messages: ChatMessage[] = [
      { role: "system", content: systemInstructionCompleta },
      ...(history ?? []),
      { role: "user", content: message },
    ];

    // Timeout POR INTENTO, no global: el bucle de herramientas (varias idas y
    // vueltas al modelo + consultas a la BD) supera con facilidad los 30 s, y
    // un timeout global compartido abortaba también los intentos restantes de
    // la cadena con la señal ya consumida ("The signal has been aborted").
    const TOOLS_TIMEOUT_MS = 90_000;
    function conTimeout<T>(ms: number, fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
      const c = new AbortController();
      const t = setTimeout(() => c.abort(), ms);
      return fn(c.signal).finally(() => clearTimeout(t));
    }

    const callOpenCode = (signal: AbortSignal) =>
      callProvider(
        OPENCODE_API_URL,
        { "Authorization": `Bearer ${openCodeKey}` },
        OPENCODE_MODEL,
        messages,
        signal,
        "OpenCode",
      );

    /** Puter no soporta streaming fiable: se pide la respuesta completa. */
    async function callPuter(signal: AbortSignal): Promise<string> {
      const res = await fetch(PUTER_API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${puterToken}` },
        body: JSON.stringify({ model: PUTER_MODEL, messages, stream: false, max_tokens: 2000, temperature: 0.3 }),
        signal,
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => "unknown");
        throw new Error(`Puter ${PUTER_MODEL} -> ${res.status}: ${errText.slice(0, 300)}`);
      }
      const data = await res.json();
      const content: string = data?.choices?.[0]?.message?.content ?? "";
      if (!content) throw new Error("Puter: respuesta vacía");
      return content;
    }

    // Cadena de intentos en orden de preferencia: el primero que devuelva
    // texto no vacío gana (una respuesta vacía también pasa al siguiente).
    let textoCompleto: string | null = null;

    async function leerTexto(res: Response, label: string): Promise<string> {
      const raw = await res.text();
      const texto = sseToText(raw);
      if (!texto) throw new Error(label + ": respuesta vacía");
      return texto;
    }
    const fallos: string[] = [];

    const intentos: Array<{ nombre: string; run: () => Promise<void> }> = [];
    if (openRouterKey) {
      const openRouterHeaders = {
        "Authorization": `Bearer ${openRouterKey}`,
        "HTTP-Referer": SITE_URL,
        "X-Title": SITE_TITLE,
      };
      intentos.push({
        nombre: `OpenRouter ${OPENROUTER_PRIMARY_MODEL}`,
        run: async () => {
          textoCompleto = await conTimeout(TOOLS_TIMEOUT_MS, (signal) =>
            callOpenRouterConTools(OPENROUTER_PRIMARY_MODEL, messages, openRouterHeaders, admin, signal));
        },
      });
      intentos.push({
        nombre: `OpenRouter ${OPENROUTER_FALLBACK_MODEL}`,
        run: async () => {
          textoCompleto = await conTimeout(TOOLS_TIMEOUT_MS, (signal) =>
            callOpenRouterConTools(OPENROUTER_FALLBACK_MODEL, messages, openRouterHeaders, admin, signal));
        },
      });
    }
    if (openCodeKey) {
      intentos.push({
        nombre: `OpenCode ${OPENCODE_MODEL}`,
        run: async () => {
          textoCompleto = await conTimeout(PROVIDER_TIMEOUT_MS, async (signal) => leerTexto(await callOpenCode(signal), "OpenCode"));
        },
      });
    }
    if (puterToken) {
      intentos.push({
        nombre: `Puter ${PUTER_MODEL}`,
        run: async () => {
          textoCompleto = await conTimeout(PROVIDER_TIMEOUT_MS, (signal) => callPuter(signal));
        },
      });
    }

    for (const intento of intentos) {
      try {
        await intento.run();
        break;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        fallos.push(msg);
        console.error(`[chat] ${intento.nombre} falló: ${msg}`);
      }
    }

    if (textoCompleto === null) {
      throw new Error(fallos.join(" | ") || "sin proveedores disponibles");
    }

    const encoder = new TextEncoder();
    const oneShot = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(encoder.encode(textoCompleto as string));
        c.close();
      },
    });

    return new Response(oneShot, {
      headers: { ...corsHeaders, "Content-Type": "text/plain; charset=utf-8" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[chat] error: ${msg}`);
    return new Response(
      JSON.stringify({ error: "El asistente no ha podido responder ahora mismo. Inténtalo de nuevo en unos segundos." }),
      { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

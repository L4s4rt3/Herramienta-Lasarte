/**
 * chat — Edge Function para Vadim, el asistente de Herramienta Lasarte.
 * Llama a un proveedor IA con formato OpenAI (streaming SSE) y reenvía el
 * stream de texto plano al cliente (useChatBot / gemini.ts).
 *
 * Cadena de proveedores:
 *   1. OpenRouter (si hay OPENROUTER_API_KEY): modelo principal gratuito con
 *      fallback automático a un segundo modelo gratuito si el primero
 *      devuelve error o límite de peticiones (429), o si ambos fallan del
 *      todo y hay OpenCode disponible como último recurso.
 *   2. OpenCode zen (si hay OPENCODE_API_KEY): mismo formato OpenAI.
 *   3. Puter (si hay PUTER_AUTH_TOKEN): sin streaming, texto de una pieza.
 *   4. Si no hay ninguna key configurada: error claro.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

const PROVIDER_TIMEOUT_MS = 30_000;

const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_PRIMARY_MODEL = "nvidia/nemotron-3-ultra-550b-a55b:free";
const OPENROUTER_FALLBACK_MODEL = "nvidia/nemotron-3-super-120b-a12b:free";
const SITE_URL = "https://lasartesat.es";
const SITE_TITLE = "Herramienta Lasarte";

const OPENCODE_API_URL = "https://opencode.ai/zen/v1/chat/completions";
const OPENCODE_MODEL = "ring-2.6-1t-free";

const PUTER_API_URL = "https://api.puter.com/puterai/openai/v1/chat/completions";
const PUTER_MODEL = "qwen/qwen3.6-flash";

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

    const messages: ChatMessage[] = [
      { role: "system", content: systemInstruction },
      ...(history ?? []),
      { role: "user", content: message },
    ];

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);

    const callOpenCode = () =>
      callProvider(
        OPENCODE_API_URL,
        { "Authorization": `Bearer ${openCodeKey}` },
        OPENCODE_MODEL,
        messages,
        controller.signal,
        "OpenCode",
      );

    /** Puter no soporta streaming fiable: se pide la respuesta completa. */
    async function callPuter(): Promise<string> {
      const res = await fetch(PUTER_API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${puterToken}` },
        body: JSON.stringify({ model: PUTER_MODEL, messages, stream: false, max_tokens: 2000, temperature: 0.3 }),
        signal: controller.signal,
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
          const res = await callProvider(OPENROUTER_API_URL, openRouterHeaders, OPENROUTER_PRIMARY_MODEL, messages, controller.signal, "OpenRouter", { reasoning: { enabled: false } });
          textoCompleto = await leerTexto(res, "OpenRouter");
        },
      });
      intentos.push({
        nombre: `OpenRouter ${OPENROUTER_FALLBACK_MODEL}`,
        run: async () => {
          const res = await callProvider(OPENROUTER_API_URL, openRouterHeaders, OPENROUTER_FALLBACK_MODEL, messages, controller.signal, "OpenRouter", { reasoning: { enabled: false } });
          textoCompleto = await leerTexto(res, "OpenRouter");
        },
      });
    }
    if (openCodeKey) {
      intentos.push({ nombre: `OpenCode ${OPENCODE_MODEL}`, run: async () => { textoCompleto = await leerTexto(await callOpenCode(), "OpenCode"); } });
    }
    if (puterToken) {
      intentos.push({ nombre: `Puter ${PUTER_MODEL}`, run: async () => { textoCompleto = await callPuter(); } });
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

    clearTimeout(timeout);

    if (textoCompleto === null) {
      throw new Error(fallos.join(" | ") || "sin proveedores disponibles");
    }

    const encoder = new TextEncoder();
    const oneShot = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(encoder.encode(textoCompleto));
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

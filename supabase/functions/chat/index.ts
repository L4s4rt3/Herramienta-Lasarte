/**
 * chat — Edge Function para Vadim, el asistente de Herramienta Lasarte.
 * Llama a OpenRouter (formato OpenAI, streaming SSE) y reenvía el stream de
 * texto plano al cliente (useChatBot / gemini.ts). Modelo principal gratuito
 * con fallback automático a un segundo modelo gratuito si el primero
 * devuelve error o límite de peticiones (429).
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

const OPENROUTER_TIMEOUT_MS = 30_000;
const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";
const PRIMARY_MODEL = "deepseek/deepseek-chat-v3-0324:free";
const FALLBACK_MODEL = "meta-llama/llama-3.3-70b-instruct:free";
const SITE_URL = "https://lasartesat.es";
const SITE_TITLE = "Herramienta Lasarte";

/**
 * Llama a OpenRouter con streaming SSE. Devuelve el Response crudo si el
 * upstream respondió ok (para poder leer el stream); lanza si no.
 */
async function callOpenRouter(apiKey: string, model: string, messages: ChatMessage[], signal: AbortSignal): Promise<Response> {
  const res = await fetch(OPENROUTER_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
      "HTTP-Referer": SITE_URL,
      "X-Title": SITE_TITLE,
    },
    body: JSON.stringify({
      model,
      messages,
      stream: true,
      temperature: 0.3,
    }),
    signal,
  });

  if (!res.ok || !res.body) {
    const errText = await res.text().catch(() => "unknown");
    const err = new Error(`OpenRouter ${model} -> ${res.status}: ${errText}`);
    (err as Error & { status?: number }).status = res.status;
    throw err;
  }

  return res;
}

/**
 * Transforma el stream SSE de OpenRouter (formato OpenAI: líneas
 * "data: {...}" y "data: [DONE]") en un stream de texto plano con solo el
 * contenido incremental de cada delta, que es lo que espera el cliente.
 */
function sseToPlainTextStream(upstream: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = upstream.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const rawLine of lines) {
            const line = rawLine.trim();
            if (!line || !line.startsWith("data:")) continue;
            const data = line.slice(5).trim();
            if (data === "[DONE]") continue;
            try {
              const json = JSON.parse(data);
              const delta: string | undefined = json?.choices?.[0]?.delta?.content;
              if (delta) controller.enqueue(encoder.encode(delta));
            } catch {
              // Línea SSE incompleta o de mantenimiento (comentario ":"): se ignora.
            }
          }
        }
      } catch (err) {
        controller.error(err);
        return;
      } finally {
        reader.releaseLock();
      }
      controller.close();
    },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const apiKey = Deno.env.get("OPENROUTER_API_KEY");
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: "El asistente no está configurado todavía (falta OPENROUTER_API_KEY)." }),
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
    const timeout = setTimeout(() => controller.abort(), OPENROUTER_TIMEOUT_MS);

    let upstream: Response;
    try {
      upstream = await callOpenRouter(apiKey, PRIMARY_MODEL, messages, controller.signal);
    } catch (primaryErr) {
      const status = (primaryErr as Error & { status?: number }).status;
      console.error(`[chat] modelo principal (${PRIMARY_MODEL}) falló: ${primaryErr instanceof Error ? primaryErr.message : primaryErr}`);
      // Solo probamos el fallback ante fallos "recuperables" del proveedor
      // (límite de peticiones, error de servidor, modelo no disponible).
      const shouldFallback = status === undefined || status === 429 || status >= 500;
      if (!shouldFallback) {
        clearTimeout(timeout);
        throw primaryErr;
      }
      try {
        upstream = await callOpenRouter(apiKey, FALLBACK_MODEL, messages, controller.signal);
      } catch (fallbackErr) {
        clearTimeout(timeout);
        console.error(`[chat] modelo de respaldo (${FALLBACK_MODEL}) también falló: ${fallbackErr instanceof Error ? fallbackErr.message : fallbackErr}`);
        throw fallbackErr;
      }
    }

    // El fetch ya resolvió (cabeceras recibidas): el timeout de conexión ya
    // cumplió su propósito. Lo limpiamos aquí; si el cuerpo tarda en fluir,
    // es responsabilidad del cliente/edge runtime, no de este AbortController.
    clearTimeout(timeout);

    const plainStream = sseToPlainTextStream(upstream.body!);

    return new Response(plainStream, {
      headers: {
        ...corsHeaders,
        "Content-Type": "text/plain; charset=utf-8",
      },
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

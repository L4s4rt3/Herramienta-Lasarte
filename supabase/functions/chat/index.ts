/**
 * chat — Edge Function para Vadim. Llama a Puter (OpenAI-compatible) y devuelve texto plano.
 * Usa el modelo Qwen 3.6 Plus (gratuito, sin límites).
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

const PUTER_TIMEOUT_MS = 25_000;
const PUTER_API_URL = "https://api.puter.com/puterai/openai/v1/chat/completions";
const MODEL = "qwen/qwen3.6-plus";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const puterToken = Deno.env.get("PUTER_AUTH_TOKEN");
    if (!puterToken) {
      return new Response(
        JSON.stringify({ error: "PUTER_AUTH_TOKEN no configurado en los secretos de Supabase" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { message, history, systemInstruction } = await req.json() as {
      message: string;
      history: ChatMessage[];
      systemInstruction: string;
    };

    const messages: ChatMessage[] = [
      { role: "system", content: systemInstruction },
      ...(history ?? []),
      { role: "user", content: message },
    ];

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PUTER_TIMEOUT_MS);

    const puterRes = await fetch(PUTER_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${puterToken}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages,
        stream: false,
        max_tokens: 2000,
        temperature: 0.7,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!puterRes.ok) {
      const errText = await puterRes.text().catch(() => "unknown");
      throw new Error(`Puter ${puterRes.status}: ${errText}`);
    }

    const data = await puterRes.json();
    const content: string = data?.choices?.[0]?.message?.content ?? "";

    if (!content) {
      throw new Error("Puter: respuesta vacía");
    }

    // Devolver como stream de texto plano para compatibilidad con el cliente
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(content));
        controller.close();
      },
    });

    return new Response(stream, {
      headers: {
        ...corsHeaders,
        "Content-Type": "text/plain; charset=utf-8",
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[chat] error: ${msg}`);
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

/**
 * chat — Edge Function para Vadim. Llama a OpenCode API y devuelve texto plano.
 * Se usa non-streaming para evitar problemas de formato SSE.
 * Timeout de 30s y fallback entre modelos.
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

const OPCODE_TIMEOUT_MS = 18_000;
// big-pickle primero: el más estable y rápido en free tier.
// Fallback a deepseek-v4-flash-free por si big-pickle está saturado.
const OPCODE_MODELS = ["big-pickle", "deepseek-v4-flash-free"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const apiKey = Deno.env.get("OPENCODE_API_KEY");
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: "OPENCODE_API_KEY no configurada en los secretos de Supabase" }),
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

    let lastError = "";

    for (const model of OPCODE_MODELS) {
      console.log(`[chat] intentando modelo: ${model}`);

      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), OPCODE_TIMEOUT_MS);

        const opencodeRes = await fetch("https://opencode.ai/zen/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model,
            messages,
            stream: false,
            max_tokens: 2000,
            temperature: 0.7,
          }),
          signal: controller.signal,
        });

        clearTimeout(timeout);
        console.log(`[chat] ${model} status: ${opencodeRes.status}`);

        if (!opencodeRes.ok) {
          const errText = await opencodeRes.text().catch(() => "unknown");
          lastError = `OpenCode ${opencodeRes.status} para ${model}: ${errText}`;
          console.error(`[chat] ${lastError}`);
          continue;
        }

        const data = await opencodeRes.json();
        const content: string = data?.choices?.[0]?.message?.content ?? "";

        if (!content) {
          lastError = `${model}: respuesta vacía`;
          console.error(`[chat] ${lastError}`);
          continue;
        }

        console.log(`[chat] ${model} OK, ${content.length} caracteres`);

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
      } catch (fetchErr) {
        const msg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
        console.error(`[chat] error con modelo ${model}: ${msg}`);
        lastError = msg;
      }
    }

    return new Response(
      JSON.stringify({
        error: `No se pudo obtener respuesta de OpenCode. Último error: ${lastError}`,
      }),
      { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[chat] error fatal: ${msg}`);
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

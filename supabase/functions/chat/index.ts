/**
 * chat — Edge Function para Vadim, el asistente experto de Lasarte SAT.
 * Usa OpenCode API con streaming y timeout. La API key vive como secreto.
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

const OPCODE_TIMEOUT_MS = 30_000;
const OPCODE_MODELS = ["deepseek-v4-flash-free", "nemotron-3-super-free", "mimo-v2-5-free", "big-pickle"];

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

    // Intentar con cada modelo hasta que uno funcione
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
            stream: true,
            max_tokens: 2000,
            temperature: 0.7,
          }),
          signal: controller.signal,
        });

        clearTimeout(timeout);
        console.log(`[chat] ${model} status: ${opencodeRes.status}`);

        if (!opencodeRes.ok) {
          const errText = await opencodeRes.text().catch(() => "unknown");
          const errorMsg = `OpenCode ${opencodeRes.status} para ${model}: ${errText}`;
          console.error(`[chat] ${errorMsg}`);
          lastError = errorMsg;
          continue;
        }

        if (!opencodeRes.body) {
          lastError = `OpenCode ${model}: body es null`;
          console.error(`[chat] ${lastError}`);
          continue;
        }

        // Streaming exitoso — devolver stream al cliente
        const encoder = new TextEncoder();
        const stream = new ReadableStream({
          async start(streamController) {
            try {
              const reader = opencodeRes.body!.getReader();
              const decoder = new TextDecoder();
              let buffer = "";

              while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split("\n");
                buffer = lines.pop() ?? "";

                for (const line of lines) {
                  if (!line.startsWith("data: ")) continue;
                  const data = line.slice(6).trim();
                  if (data === "[DONE]") continue;
                  try {
                    const json = JSON.parse(data);
                    const text: string = json?.choices?.[0]?.delta?.content ?? "";
                    if (text) streamController.enqueue(encoder.encode(text));
                  } catch {
                    // chunk malformado, ignorar
                  }
                }
              }
            } catch (streamErr) {
              console.error(`[chat] error en stream: ${streamErr}`);
            } finally {
              streamController.close();
            }
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

    // Ningún modelo funcionó
    return new Response(
      JSON.stringify({
        error: `No se pudo conectar con OpenCode tras intentar todos los modelos. Último error: ${lastError}`,
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

/**
 * chat — Edge Function para Vadim, el asistente experto de Lasarte SAT.
 * Usa OpenCode API (ring-2.6-1t-free) con capacidades RAG y debugging.
 * La API key vive como secreto de Supabase — nunca expuesta al cliente.
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

    const opencodeRes = await fetch("https://opencode.ai/zen/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "ring-2.6-1t-free",
        messages,
        stream: true,
        max_tokens: 2000,
        temperature: 0.7,
      }),
    });

    if (!opencodeRes.ok) {
      const err = await opencodeRes.text();
      return new Response(
        JSON.stringify({ error: `OpenCode error ${opencodeRes.status}: ${err}` }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Parsear SSE de OpenCode y hacer streaming de texto plano al cliente
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
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
              if (text) controller.enqueue(encoder.encode(text));
            } catch {
              // chunk malformado, ignorar
            }
          }
        }
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
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

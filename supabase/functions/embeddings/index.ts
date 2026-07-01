/**
 * embeddings — Edge Function que genera embeddings vía OpenCode.
 *
 * La clave OPENCODE_API_KEY vive en los secretos de Supabase (lado servidor),
 * NUNCA en el bundle del cliente. El frontend la invoca autenticado con
 * supabase.functions.invoke("embeddings", { body: { text } }).
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const OPENCODE_API_URL = "https://opencode.ai/zen/v1";
const EMBEDDING_MODEL = "text-embedding-3-small";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const apiKey = Deno.env.get("OPENCODE_API_KEY");
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: "OPENCODE_API_KEY no configurado en los secretos de Supabase" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { text } = (await req.json()) as { text?: string };
    if (!text || typeof text !== "string") {
      return new Response(
        JSON.stringify({ error: "Falta el campo 'text'" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const res = await fetch(`${OPENCODE_API_URL}/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model: EMBEDDING_MODEL, input: text }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "unknown");
      throw new Error(`OpenCode ${res.status}: ${errText}`);
    }

    const data = await res.json();
    const embedding = data?.data?.[0]?.embedding;
    if (!Array.isArray(embedding)) {
      throw new Error("OpenCode: respuesta sin embedding");
    }

    return new Response(
      JSON.stringify({ embedding }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[embeddings] error: ${msg}`);
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

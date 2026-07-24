import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SYSTEM_PROMPT = `Eres un extractor especializado en una hoja manuscrita diaria de producción de cítricos.

La hoja repite estas líneas:
- fecha
- Cítrica
- Cítrica podrido
- Podrido
- Malla Z1
- Malla Z2
- Palets punta
Después puede contener un desglose de palets por formatos (10 kg, 15 kg, malla granel, malla 3/4/5 kg, etc.). Ese desglose NO se extrae.

REGLAS:
1. Devuelve los kilos BRUTOS tal como aparecen escritos. No restes taras ni corrijas cálculos: la aplicación lo hará de forma determinista.
2. Si una línea tiene "peso × cantidad = total", *_kg_brutos es el TOTAL final escrito y *_box es la cantidad o multiplicador.
3. En Malla Z1/Z2, expresiones 1'5, 1,5 o 1.5 significan 1,5 box.
4. Si hay kilos en Cítrica, Cítrica podrido o Podrido sin multiplicador explícito, devuelve 1 en su campo *_box.
5. Una línea vacía devuelve null. Ignora valores tachados y usa la corrección escrita a su lado.
6. No confundas "Cítrica" con "Cítrica podrido", ni "Palets punta" con los desgloses inferiores.
7. Si el total escrito contradice la multiplicación, conserva el total escrito y añade una duda concreta.
8. La fecha debe ir en formato YYYY-MM-DD.
9. No inventes. Si un dígito no es legible, usa null o la mejor lectura con una duda concreta.

Responde SOLO JSON con todas estas claves:
{"raw":{"fecha":"2026-07-21","citrica_kg_brutos":null,"citrica_box":null,"citrica_podrido_kg_brutos":null,"citrica_podrido_box":null,"podrido_kg_brutos":null,"podrido_box":null,"malla_z1_kg_brutos":null,"malla_z1_box":null,"malla_z2_kg_brutos":null,"malla_z2_box":null,"palets_punta_kg":null},"confianza":0.9,"dudas":[]}`;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function sanitizeImage(value: unknown): { mime: string; b64: string } | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const mime = String(raw.mime ?? "").toLowerCase();
  const b64 = String(raw.b64 ?? "").trim();
  if (!/^image\/(?:jpeg|png|webp)$/.test(mime)) return null;
  if (b64.length < 100 || b64.length > 2_200_000) return null;
  if (!/^[a-z0-9+/=]+$/i.test(b64)) return null;
  return { mime, b64 };
}

function parseJsonObject(value: unknown): Record<string, unknown> | null {
  let text = String(value ?? "{}").trim();
  text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      const parsed = JSON.parse(match[0]);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
}

function hasUsefulData(parsed: Record<string, unknown>) {
  const raw = parsed.raw && typeof parsed.raw === "object"
    ? parsed.raw as Record<string, unknown>
    : parsed;
  return [
    "fecha",
    "citrica_kg_brutos",
    "citrica_podrido_kg_brutos",
    "podrido_kg_brutos",
    "malla_z1_kg_brutos",
    "malla_z2_kg_brutos",
    "palets_punta_kg",
  ].some((key) => raw[key] !== null && raw[key] !== undefined && raw[key] !== "");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "No autorizado" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey =
      Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!;
    const openRouterApiKey = Deno.env.get("OPENROUTER_API_KEY");
    const preferredModel = Deno.env.get("OPENROUTER_VISION_MODEL") ?? "openrouter/free";
    if (!openRouterApiKey) return json({ error: "OPENROUTER_API_KEY no configurada" }, 500);

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData.user) return json({ error: "No autorizado" }, 401);

    const requestBody = await req.json();
    const image = sanitizeImage(requestBody?.image);
    if (!image) return json({ error: "Imagen no válida o demasiado grande" }, 400);
    const expectedDate = String(requestBody?.fecha_esperada ?? "").trim();
    const dateContext = /^\d{4}-\d{2}-\d{2}$/.test(expectedDate)
      ? `El parte abierto corresponde a ${expectedDate}. Comprueba la fecha manuscrita y devuélvela; no la sustituyas si la foto muestra otra.`
      : "Lee también la fecha manuscrita.";

    const models = Array.from(new Set([
      preferredModel,
      "openrouter/free",
      "google/gemma-4-31b-it:free",
    ].filter(Boolean)));
    const errors: string[] = [];

    for (const model of models) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 60_000);
      try {
        const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${openRouterApiKey}`,
            "Content-Type": "application/json",
            "X-Title": "Herramienta Lasarte",
          },
          signal: controller.signal,
          body: JSON.stringify({
            model,
            messages: [
              { role: "system", content: SYSTEM_PROMPT },
              {
                role: "user",
                content: [
                  { type: "text", text: `Extrae únicamente los campos diarios indicados. ${dateContext}` },
                  { type: "image_url", image_url: { url: `data:${image.mime};base64,${image.b64}` } },
                ],
              },
            ],
            response_format: { type: "json_object" },
            temperature: 0,
            max_tokens: 700,
          }),
        });
        clearTimeout(timeout);

        if (!response.ok) {
          errors.push(`${model}: HTTP ${response.status}`);
          continue;
        }
        const payload = await response.json();
        const parsed = parseJsonObject(payload?.choices?.[0]?.message?.content);
        if (!parsed || !hasUsefulData(parsed)) {
          errors.push(`${model}: respuesta sin campos útiles`);
          continue;
        }
        return json({
          ...parsed,
          modelo: String(payload?.model ?? model),
        });
      } catch (error) {
        clearTimeout(timeout);
        errors.push(`${model}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    return json({
      error: "No se pudo leer el papel con suficiente seguridad.",
      detalles: errors,
    }, 422);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Error inesperado" }, 500);
  }
});

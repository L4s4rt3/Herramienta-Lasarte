import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const WATER_METER_PROMPT = `Eres un lector especializado en contadores mecánicos de agua.

La foto muestra siempre el mismo contador general Iberconta de una planta. La lectura total se compone de:
- Ventanilla rectangular superior: cinco rodillos de metros cúbicos enteros.
- Esfera superior derecha "x0,1": décimas de m3.
- Esfera inferior derecha "x0,01": centésimas de m3.
- Esfera grande izquierda "x0,001": milésimas de m3. Puedes interpolar una cuarta cifra decimal si la posición es clara.

REGLAS:
1. Lee primero los cinco rodillos de izquierda a derecha. La secuencia histórica real de este contador está alrededor de 39079–39160.
2. Lee después las agujas rojas en el orden x0,1, x0,01 y x0,001. No confundas las tres escalas.
   Es obligatorio leerlas: decimales=0 solo es válido si las TRES agujas apuntan exactamente al 0.
3. Las agujas pueden girar en sentidos distintos. Usa los números impresos de cada esfera, no una suposición sobre el sentido.
4. Cuando un rodillo esté cambiando y muestre la cifra siguiente (por ejemplo 39087 cuando las agujas todavía representan 39086,94), aplica la regla mecánica de acarreo y devuelve la lectura total coherente.
5. Referencias verificadas del mismo contador:
   - ventanilla 39079 + agujas ≈ 39079,26
   - ventanilla en transición 39087 + agujas ≈ 39086,94
   - ventanilla 39093 + agujas ≈ 39093,76
   - ventanilla en transición 39102 + agujas ≈ 39101,96
   - ventanilla 39111 + agujas ≈ 39111,78
   - ventanilla 39118 + agujas ≈ 39118,67
   - ventanilla 39125 + agujas ≈ 39125,71
   - ventanilla 39131 + agujas ≈ 39131,87
   - ventanilla 39141 + agujas ≈ 39141,01
6. No interpretes números grabados en el aro, el caudal "Qn 6 m3/h", la marca ni el número de serie.
7. No inventes. Si no distingues la ventanilla, devuelve lectura_m3=null. Si distingues los enteros pero dudas de una aguja, devuelve la mejor estimación y anota exactamente la duda.

Devuelve también por separado el entero que VES en los rodillos y la fracción que LEES en las agujas. No hagas tú el acarreo en esos dos campos; el servidor lo calculará.

Responde SOLO JSON:
{"rodillos_entero":39079,"decimales":0.26,"lectura_m3":39079.26,"lectura_texto":"39079.26","confianza":0.95,"dudas":[]}`;

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

function parseReading(value: unknown): number | null {
  let parsed: number;
  if (typeof value === "number") {
    parsed = value;
  } else {
    const raw = String(value ?? "").trim().replace(/\s/g, "");
    if (!raw) return null;
    const normalized = raw.includes(",")
      ? raw.replace(/\./g, "").replace(",", ".")
      : raw;
    if (!/^\d{5,6}(?:\.\d{1,4})?$/.test(normalized)) return null;
    parsed = Number(normalized);
  }
  if (!Number.isFinite(parsed) || parsed < 10_000 || parsed > 999_999.9999) return null;
  return Math.round(parsed * 10_000) / 10_000;
}

function parseRollers(value: unknown): number | null {
  const raw = String(value ?? "").replace(/\D/g, "");
  if (raw.length < 5 || raw.length > 6) return null;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 10_000 && parsed <= 999_999 ? parsed : null;
}

function parseFraction(value: unknown): number | null {
  const raw = String(value ?? "").trim().replace(",", ".");
  if (!raw) return null;
  let parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  if (parsed >= 1) {
    const digits = raw.replace(/\D/g, "");
    if (!digits || digits.length > 4) return null;
    parsed = Number(digits) / (10 ** digits.length);
  }
  if (parsed >= 1) return null;
  return Math.round(parsed * 10_000) / 10_000;
}

function combineMechanicalReading(rollers: number, fraction: number) {
  const carriedInteger = fraction >= 0.9 ? rollers - 1 : rollers;
  return Math.round((carriedInteger + fraction) * 10_000) / 10_000;
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "No autorizado" }, 401);

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_ANON_KEY =
      Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!;
    const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY");
    const preferredModel =
      Deno.env.get("OPENROUTER_VISION_MODEL") ?? "openrouter/free";

    if (!OPENROUTER_API_KEY) {
      return json({ error: "OPENROUTER_API_KEY no configurada" }, 500);
    }

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData.user) return json({ error: "No autorizado" }, 401);

    const requestBody = await req.json();
    const image = sanitizeImage(requestBody?.image);
    if (!image) return json({ error: "Imagen no válida o demasiado grande" }, 400);
    const previousReading = parseReading(requestBody?.lectura_anterior_m3);
    const readingContext = previousReading == null
      ? "No hay una lectura anterior disponible."
      : `La lectura anterior verificada es ${previousReading.toFixed(4)} m3. El contador nunca retrocede: cualquier resultado menor es imposible y debes volver a revisar los cinco rodillos.`;

    const models = Array.from(new Set([
      "openrouter/free",
      preferredModel,
      "google/gemma-4-31b-it:free",
    ].filter(Boolean)));
    const errors: string[] = [];
    let integerOnlyCandidate: number | null = null;

    for (const model of models) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 60_000);
      try {
        const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
            "Content-Type": "application/json",
            "X-Title": "Herramienta Lasarte",
          },
          signal: controller.signal,
          body: JSON.stringify({
            model,
            messages: [
              { role: "system", content: WATER_METER_PROMPT },
              {
                role: "user",
                content: [
                  {
                    type: "text",
                    text: `Lee la lectura total del contador: rodillos enteros y agujas decimales. ${readingContext}`,
                  },
                  { type: "image_url", image_url: { url: `data:${image.mime};base64,${image.b64}` } },
                ],
              },
            ],
            response_format: { type: "json_object" },
            temperature: 0,
            max_tokens: 500,
          }),
        });
        clearTimeout(timeout);

        if (!response.ok) {
          errors.push(`${model}: HTTP ${response.status}`);
          continue;
        }

        const payload = await response.json();
        const parsed = parseJsonObject(payload?.choices?.[0]?.message?.content);
        const rollers = parseRollers(parsed?.rodillos_entero);
        const fraction = parseFraction(parsed?.decimales);
        const reading = rollers != null && fraction != null
          ? combineMechanicalReading(rollers, fraction)
          : parseReading(parsed?.lectura_m3 ?? parsed?.lectura_texto);
        if (reading == null) {
          errors.push(`${model}: lectura no válida`);
          continue;
        }
        if (fraction === 0) {
          integerOnlyCandidate = rollers ?? Math.trunc(reading);
          errors.push(`${model}: agujas decimales no leídas`);
          continue;
        }
        if (previousReading != null && reading < previousReading) {
          errors.push(`${model}: lectura ${reading} inferior a la anterior ${previousReading}`);
          continue;
        }

        const confidenceRaw = Number(parsed?.confianza);
        const confidence = Number.isFinite(confidenceRaw)
          ? Math.max(0, Math.min(1, confidenceRaw))
          : 0.5;
        const doubts = Array.isArray(parsed?.dudas)
          ? parsed.dudas.map((item) => String(item ?? "").trim()).filter(Boolean).slice(0, 5)
          : [];

        return json({
          lectura_m3: reading,
          lectura_texto: String(reading),
          confianza: confidence,
          dudas: doubts,
          modelo: String(payload?.model ?? model),
        });
      } catch (error) {
        clearTimeout(timeout);
        errors.push(`${model}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    if (integerOnlyCandidate != null && (
      previousReading == null || integerOnlyCandidate >= Math.trunc(previousReading)
    )) {
      return json({
        lectura_m3: integerOnlyCandidate,
        lectura_texto: String(integerOnlyCandidate),
        confianza: 0.45,
        dudas: ["Solo se ha podido confirmar la ventanilla. Revisa y completa las agujas decimales antes de guardar."],
        modelo: null,
      });
    }

    return json({
      error: "No se pudo leer con suficiente seguridad la ventanilla del contador.",
      detalles: errors,
    }, 422);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Error inesperado" }, 500);
  }
});

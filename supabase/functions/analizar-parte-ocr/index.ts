import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.0";

// Lee el parte manual manuscrito (papel EMBASUR) con Mistral OCR y devuelve el
// TEXTO transcrito. El parseo/validación determinista (recalcular operaciones,
// checksum del desglose, reconciliación) lo hace el cliente en
// src/lib/partOcrParser.ts, reutilizando la derivación de netos existente.
// Mistral OCR gana claramente al modelo de visión free en dígitos manuscritos.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "No autorizado" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey =
      Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!;
    const mistralApiKey = Deno.env.get("MISTRAL_API_KEY");
    const ocrModel = Deno.env.get("MISTRAL_OCR_MODEL") ?? "mistral-ocr-latest";
    if (!mistralApiKey) return json({ error: "MISTRAL_API_KEY no configurada" }, 500);

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData.user) return json({ error: "No autorizado" }, 401);

    const requestBody = await req.json();
    const image = sanitizeImage(requestBody?.image);
    if (!image) return json({ error: "Imagen no válida o demasiado grande" }, 400);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60_000);
    try {
      const response = await fetch("https://api.mistral.ai/v1/ocr", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${mistralApiKey}`,
          "Content-Type": "application/json",
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: ocrModel,
          document: { type: "image_url", image_url: `data:${image.mime};base64,${image.b64}` },
        }),
      });
      clearTimeout(timeout);

      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        return json({ error: `Mistral OCR HTTP ${response.status}`, detalle: detail.slice(0, 300) }, 502);
      }

      const payload = await response.json();
      const pages = Array.isArray(payload?.pages) ? payload.pages : [];
      const ocr_md = pages.map((p: { markdown?: unknown }) => String(p?.markdown ?? "")).join("\n").trim();
      if (!ocr_md) return json({ error: "El OCR no devolvió texto legible del papel." }, 422);

      return json({ ocr_md, modelo: String(payload?.model ?? ocrModel) });
    } catch (error) {
      clearTimeout(timeout);
      const msg = error instanceof Error ? error.message : String(error);
      return json({ error: `No se pudo leer el papel con Mistral OCR: ${msg}` }, 502);
    }
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Error inesperado" }, 500);
  }
});

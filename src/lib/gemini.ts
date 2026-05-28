/**
 * gemini.ts — Utilidades para el asistente de producción Lasarte SAT.
 * Las llamadas a Gemini se hacen a través de la Supabase Edge Function "chat",
 * donde la API key vive como secreto de servidor — nunca expuesta al cliente.
 */

// ─── System prompt (sin datos; el contexto de producción se inyecta en el hook) ─

export const DOMAIN_PROMPT = `
Eres el asistente de producción de Lasarte SAT, cooperativa citrícola española.
Ayudas a operarios y gestores a interpretar los datos del sistema de control de producción.

CONCEPTOS DEL SISTEMA:
- Parte diario: registro diario de producción del calibrador
- Producción real = Calibrador - Mujeres(L) - Reciclado Z1 - Reciclado Z2
- Palets ajustados = Palets brutos - Inventario sin alta D-1
- DSJ (Diferencia Sin Justificar) = Producción real - Palets ajustados - Inventario final - Mermas
- DJPMN % = DSJ / Producción real × 100
- Semáforo: ≤3% verde (OK), 3–5% amarillo (revisar), >5% rojo (crítico)
- T/h: toneladas/hora — eficiencia de máquina. Buena ≥16, aceptable ≥12, baja <12
- Destinos de fruta: Exportación (1ª calidad), Mercado nacional, Industria (zumo)
- Mermas: podrido en calibrador + podrido manual (bolsa basura)

COMPORTAMIENTO:
- Responde siempre en español, de forma concisa y directa
- Cuando menciones % de DSJ, indica el semáforo (verde/amarillo/rojo)
- Formatea cantidades: "125.300 kg" o "125,3 t"
- Si no tienes datos suficientes, dilo claramente sin inventar
- Usa los datos actuales del sistema cuando estén disponibles
`.trim();

// ─── Formato de historial compatible con OpenAI / Groq ───────────────────────

export interface ChatContent {
  role: "user" | "assistant";
  content: string;
}

// ─── Llamada a la Edge Function con streaming ─────────────────────────────────

const SUPABASE_URL  = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

export async function callChatFunction({
  message,
  history,
  systemInstruction,
  onChunk,
}: {
  message: string;
  history: ChatContent[];
  systemInstruction: string;
  onChunk: (text: string) => void;
}): Promise<string> {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${SUPABASE_ANON}`,
      "apikey": SUPABASE_ANON,
    },
    body: JSON.stringify({ message, history, systemInstruction }),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => `HTTP ${res.status}`);
    throw new Error(err);
  }

  const reader  = res.body!.getReader();
  const decoder = new TextDecoder();
  let full = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    full += chunk;
    onChunk(full);
  }

  return full;
}

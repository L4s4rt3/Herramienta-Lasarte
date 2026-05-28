/**
 * gemini.ts — Cliente Gemini para el asistente de producción Lasarte SAT.
 * Modelo: gemini-1.5-flash (free tier: 15 RPM, 1M tokens/day)
 */
import { GoogleGenerativeAI } from "@google/generative-ai";

// Clave embebida para que funcione en producción para todos los usuarios.
// Herramienta interna — clave free tier de Gemini.
const apiKey = import.meta.env.VITE_GEMINI_API_KEY || "AIzaSyCg1uoTG5_sCTaE8ypG6mOJkHpAFepfkUg";

export const genAI = new GoogleGenerativeAI(apiKey);

// ─── System prompt ────────────────────────────────────────────────────────────

const DOMAIN_PROMPT = `
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

// ─── Crear sesión de chat ─────────────────────────────────────────────────────

export function createChatSession(contextData?: string) {
  const systemInstruction = contextData
    ? `${DOMAIN_PROMPT}\n\nDATOS ACTUALES DEL SISTEMA (últimos 30 días):\n${contextData}`
    : DOMAIN_PROMPT;

  const model = genAI.getGenerativeModel({
    model: "gemini-1.5-flash",
    systemInstruction,
  });

  return model.startChat({
    generationConfig: {
      maxOutputTokens: 600,
      temperature: 0.6,
    },
  });
}

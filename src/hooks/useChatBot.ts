/**
 * useChatBot — Hook para el asistente de producción con Gemini.
 * Inyecta contexto real de Supabase en el system prompt al abrir el chat.
 */
import { useState, useCallback, useRef } from "react";
import type { ChatSession } from "@google/generative-ai";
import { supabase } from "@/integrations/supabase/client";
import { createChatSession } from "@/lib/gemini";
import { computeCascade } from "@/lib/cascade";

// ─── Tipos ────────────────────────────────────────────────────────────────────

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  error?: boolean;
}

// ─── Contexto de producción desde Supabase ────────────────────────────────────

async function fetchProductionContext(): Promise<string> {
  const since = new Date();
  since.setDate(since.getDate() - 30);

  const { data } = await supabase
    .from("partes_diarios")
    .select(`
      date, estado,
      kg_produccion_calibrador, kg_mujeres_calibrador,
      kg_palets_brutos, kg_palets_egipto,
      kg_podrido_calibrador_auto, kg_industria_manual,
      kg_reciclado_malla_z1, kg_reciclado_malla_z2,
      kg_inventario_sin_alta, kg_podrido_bolsa_basura,
      kg_inventario_anterior_sin_alta
    `)
    .gte("date", since.toISOString().slice(0, 10))
    .order("date", { ascending: false })
    .limit(30);

  if (!data || data.length === 0) {
    return "No hay partes registrados en los últimos 30 días.";
  }

  const partes = data.map((p) => {
    const cascade = computeCascade({
      kg_produccion_calibrador:    Number(p.kg_produccion_calibrador) || 0,
      kg_mujeres_calibrador:       Number(p.kg_mujeres_calibrador) || 0,
      kg_palets_brutos:            (Number(p.kg_palets_brutos) || 0) - (Number(p.kg_palets_egipto) || 0),
      kg_podrido_calibrador:       Number(p.kg_podrido_calibrador_auto) || 0,
      kg_industria_manual:         Number(p.kg_industria_manual) || 0,
      kg_reciclado_malla_z1:       Number(p.kg_reciclado_malla_z1) || 0,
      kg_reciclado_malla_z2:       Number(p.kg_reciclado_malla_z2) || 0,
      kg_inventario_sin_alta:      Number(p.kg_inventario_sin_alta) || 0,
      kg_podrido_bolsa_basura:     Number(p.kg_podrido_bolsa_basura) || 0,
      kg_inventario_anterior_sin_alta: Number(p.kg_inventario_anterior_sin_alta) || 0,
    });
    return { date: p.date as string, estado: p.estado as string, ...cascade };
  });

  const totalProd = partes.reduce((s, p) => s + p.produccion_real, 0);
  const avgDsj    = partes.reduce((s, p) => s + p.dsj_pct, 0) / partes.length;
  const nVerde    = partes.filter((p) => p.semaforo === "verde").length;
  const nAmarillo = partes.filter((p) => p.semaforo === "amarillo").length;
  const nRojo     = partes.filter((p) => p.semaforo === "rojo").length;

  const recentList = partes
    .slice(0, 7)
    .map((p) =>
      `  ${p.date}: ${(p.produccion_real / 1000).toFixed(1)}t, DSJ ${p.dsj_pct.toFixed(2)}% (${p.semaforo}), estado: ${p.estado}`
    )
    .join("\n");

  return [
    `Total partes: ${partes.length} | Producción acumulada: ${(totalProd / 1000).toFixed(1)} t`,
    `DJPMN medio: ${avgDsj.toFixed(2)}% | Semáforos: ${nVerde} verde · ${nAmarillo} amarillo · ${nRojo} rojo`,
    ``,
    `Últimos 7 partes:`,
    recentList,
  ].join("\n");
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useChatBot() {
  const [isOpen, setIsOpen]             = useState(false);
  const [messages, setMessages]         = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading]       = useState(false);
  const [streaming, setStreaming]       = useState("");
  const [apiError, setApiError]         = useState<string | null>(null);
  const sessionRef                      = useRef<ChatSession | null>(null);
  const initializedRef                  = useRef(false);

  // Inicializa sesión con contexto de producción real
  const initSession = useCallback(async () => {
    if (initializedRef.current) return;
    initializedRef.current = true;
    try {
      const context = await fetchProductionContext();
      sessionRef.current = createChatSession(context);
      setMessages([{
        id: "welcome",
        role: "assistant",
        content: "¡Hola! Soy el asistente de Lasarte SAT. Tengo acceso a los datos de producción de los últimos 30 días. ¿En qué puedo ayudarte?",
        timestamp: new Date(),
      }]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Error al inicializar el asistente";
      setApiError(msg);
      setMessages([{
        id: "err-init",
        role: "assistant",
        content: `⚠️ ${msg}`,
        timestamp: new Date(),
        error: true,
      }]);
    }
  }, []);

  const open = useCallback(async () => {
    setIsOpen(true);
    await initSession();
  }, [initSession]);

  const close = useCallback(() => setIsOpen(false), []);

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || !sessionRef.current || isLoading) return;

    setMessages((prev) => [...prev, {
      id: `u-${Date.now()}`,
      role: "user",
      content: text.trim(),
      timestamp: new Date(),
    }]);
    setIsLoading(true);
    setStreaming("");

    try {
      const stream = await sessionRef.current.sendMessageStream(text.trim());
      let full = "";
      for await (const chunk of stream.stream) {
        full += chunk.text();
        setStreaming(full);
      }
      setMessages((prev) => [...prev, {
        id: `a-${Date.now()}`,
        role: "assistant",
        content: full,
        timestamp: new Date(),
      }]);
    } catch (err) {
      setMessages((prev) => [...prev, {
        id: `err-${Date.now()}`,
        role: "assistant",
        content: "Lo siento, hubo un error al procesar tu consulta. Inténtalo de nuevo.",
        timestamp: new Date(),
        error: true,
      }]);
    } finally {
      setIsLoading(false);
      setStreaming("");
    }
  }, [isLoading]);

  const clearHistory = useCallback(() => {
    initializedRef.current = false;
    sessionRef.current = null;
    setMessages([]);
    setApiError(null);
    initSession();
  }, [initSession]);

  return { isOpen, open, close, messages, isLoading, streaming, sendMessage, clearHistory, apiError };
}

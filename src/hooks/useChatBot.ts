/**
 * useChatBot — Hook para Vadim, el asistente de producción Lasarte SAT.
 * Al abrirse, carga datos de TODAS las secciones en paralelo y los inyecta
 * como contexto en el system prompt. El asistente sabe todo sin navegar.
 */
import { useState, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { callChatFunction, DOMAIN_PROMPT, ChatContent } from "@/lib/gemini";
import { computeCascade } from "@/lib/cascade";

// ─── Tipos ────────────────────────────────────────────────────────────────────

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  error?: boolean;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt(n: number) { return n.toLocaleString("es-ES", { maximumFractionDigits: 0 }); }
function fmtT(kg: number) { return `${(kg / 1000).toFixed(1)} t`; }
function sinceStr(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

// ─── Carga de contexto completo ───────────────────────────────────────────────

async function fetchFullContext(): Promise<string> {
  const since30 = sinceStr(30);
  const since7  = sinceStr(7);
  const sections: string[] = [];

  // ── 1. Partes diarios (30 días) ──────────────────────────────────────────
  const { data: partesRaw } = await supabase
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
    .gte("date", since30)
    .order("date", { ascending: false })
    .limit(30);

  const partes = (partesRaw ?? []).map((p) => {
    const cascade = computeCascade({
      kg_produccion_calibrador:        Number(p.kg_produccion_calibrador) || 0,
      kg_mujeres_calibrador:           Number(p.kg_mujeres_calibrador) || 0,
      kg_palets_brutos:                (Number(p.kg_palets_brutos) || 0) - (Number(p.kg_palets_egipto) || 0),
      kg_podrido_calibrador:           Number(p.kg_podrido_calibrador_auto) || 0,
      kg_industria_manual:             Number(p.kg_industria_manual) || 0,
      kg_reciclado_malla_z1:           Number(p.kg_reciclado_malla_z1) || 0,
      kg_reciclado_malla_z2:           Number(p.kg_reciclado_malla_z2) || 0,
      kg_inventario_sin_alta:          Number(p.kg_inventario_sin_alta) || 0,
      kg_podrido_bolsa_basura:         Number(p.kg_podrido_bolsa_basura) || 0,
      kg_inventario_anterior_sin_alta: Number(p.kg_inventario_anterior_sin_alta) || 0,
    });
    return { date: p.date as string, estado: p.estado as string, ...cascade };
  });

  if (partes.length > 0) {
    const totalProd = partes.reduce((s, p) => s + p.produccion_real, 0);
    const avgDsj    = partes.reduce((s, p) => s + p.dsj_pct, 0) / partes.length;
    const nVerde    = partes.filter((p) => p.semaforo === "verde").length;
    const nAmarillo = partes.filter((p) => p.semaforo === "amarillo").length;
    const nRojo     = partes.filter((p) => p.semaforo === "rojo").length;
    const recentList = partes.slice(0, 10).map((p) =>
      `  ${p.date}: ${fmtT(p.produccion_real)}, DJPMN ${p.dsj_pct.toFixed(2)}% (${p.semaforo}), ${p.estado}`
    ).join("\n");

    sections.push([
      `── PARTES DIARIOS (últimos 30 días) ──`,
      `Total: ${partes.length} partes | Producción: ${fmtT(totalProd)} | DJPMN medio: ${avgDsj.toFixed(2)}%`,
      `Semáforos: ${nVerde} verde · ${nAmarillo} amarillo · ${nRojo} rojo`,
      `Últimos 10 partes:`,
      recentList,
    ].join("\n"));
  } else {
    sections.push("── PARTES: Sin partes en los últimos 30 días.");
  }

  // ── Las siguientes consultas en paralelo ──────────────────────────────────
  const [lotesRes, calibresRes, sesionesRes, asistenciaRes] = await Promise.allSettled([

    // 2. Productores (lotes_dia, 30 días)
    supabase
      .from("lotes_dia")
      .select("productor, toneladas_hora, duracion_min, kg_peso_total, partes_diarios!inner(date)")
      .gte("partes_diarios.date", since30)
      .limit(2000),

    // 3. Distribución por destino (calibres_dia, 30 días)
    (async () => {
      const { data: partesIds } = await supabase
        .from("partes_diarios").select("id").gte("date", since30);
      if (!partesIds?.length) return { data: null };
      return supabase
        .from("calibres_dia")
        .select("grupo_destino, kg")
        .in("part_id", partesIds.map((p) => p.id))
        .limit(100000);
    })(),

    // 4. Consumos (sesiones_consumo)
    supabase
      .from("sesiones_consumo")
      .select("fecha_inicio, fecha_fin, kg_procesados, agua_linea_l, agua_drencher_l, electricidad_total_kwh, gasoil_l, quimicos_drencher_l")
      .order("fecha_inicio", { ascending: false })
      .limit(5),

    // 5. Asistencia (últimos 7 días)
    supabase
      .from("asistencia_detalle")
      .select("date, presente")
      .gte("date", since7)
      .limit(500),
  ]);

  // ── 2. Productores ───────────────────────────────────────────────────────
  if (lotesRes.status === "fulfilled" && lotesRes.value.data?.length) {
    const lotes = lotesRes.value.data;
    const byProd = new Map<string, { kg: number; lotes: number; tphSum: number; tphMin: number; tphCount: number }>();
    for (const l of lotes) {
      const k = l.productor || "Desconocido";
      if (!byProd.has(k)) byProd.set(k, { kg: 0, lotes: 0, tphSum: 0, tphMin: 0, tphCount: 0 });
      const p = byProd.get(k)!;
      p.kg    += Number(l.kg_peso_total) || 0;
      p.lotes += 1;
      const tph = Number(l.toneladas_hora) || 0;
      const min = Number(l.duracion_min)   || 0;
      if (tph > 0) { p.tphSum += tph * min; p.tphMin += min; p.tphCount += 1; }
    }
    const ranking = Array.from(byProd.entries())
      .map(([nombre, s]) => ({
        nombre,
        kg: s.kg,
        lotes: s.lotes,
        tph: s.tphCount > 0 ? (s.tphMin > 0 ? s.tphSum / s.tphMin : s.tphSum / s.tphCount) : null,
      }))
      .sort((a, b) => b.kg - a.kg)
      .slice(0, 10);

    const list = ranking.map((p) =>
      `  ${p.nombre}: ${fmtT(p.kg)}, ${p.lotes} lotes${p.tph ? `, ${p.tph.toFixed(1)} T/h` : ""}`
    ).join("\n");

    sections.push([
      `── PRODUCTORES (top 10 por kg, últimos 30 días) ──`,
      list,
    ].join("\n"));
  }

  // ── 3. Distribución por destino ──────────────────────────────────────────
  if (calibresRes.status === "fulfilled") {
    const result = calibresRes.value as { data: { grupo_destino: string | null; kg: number }[] | null };
    if (result?.data?.length) {
      const map = new Map<string, number>();
      for (const c of result.data) {
        const grupo = normalizeGrupo(c.grupo_destino);
        map.set(grupo, (map.get(grupo) ?? 0) + (Number(c.kg) || 0));
      }
      const total = Array.from(map.values()).reduce((s, v) => s + v, 0);
      const list = Array.from(map.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([g, kg]) => `  ${g}: ${((kg / total) * 100).toFixed(1)}% (${fmtT(kg)})`)
        .join("\n");
      sections.push([`── DISTRIBUCIÓN POR DESTINO (últimos 30 días) ──`, list].join("\n"));
    }
  }

  // ── 4. Consumos ──────────────────────────────────────────────────────────
  if (sesionesRes.status === "fulfilled" && sesionesRes.value.data?.length) {
    const sesiones = sesionesRes.value.data;
    const list = sesiones.slice(0, 3).map((s) => {
      const kg = Number(s.kg_procesados) || 1;
      const agua = ((Number(s.agua_linea_l) || 0) + (Number(s.agua_drencher_l) || 0)) / kg;
      const elec = (Number(s.electricidad_total_kwh) || 0) / kg;
      const gasoil = ((Number(s.gasoil_l) || 0) * 1000) / kg;
      return `  ${s.fecha_inicio}→${s.fecha_fin}: ${fmt(kg)} kg | Agua ${agua.toFixed(2)} L/kg | Electricidad ${elec.toFixed(3)} kWh/kg | Gasoil ${gasoil.toFixed(1)} mL/kg`;
    }).join("\n");
    sections.push([`── CONSUMOS (últimas sesiones) ──`, list].join("\n"));
  }

  // ── 5. Asistencia ────────────────────────────────────────────────────────
  if (asistenciaRes.status === "fulfilled" && asistenciaRes.value.data?.length) {
    const rows = asistenciaRes.value.data;
    const byDay = new Map<string, { presentes: number; total: number }>();
    for (const r of rows) {
      if (!byDay.has(r.date)) byDay.set(r.date, { presentes: 0, total: 0 });
      const d = byDay.get(r.date)!;
      d.total++;
      if (r.presente) d.presentes++;
    }
    const avgPresentes = Array.from(byDay.values()).reduce((s, d) => s + d.presentes, 0) / Math.max(byDay.size, 1);
    const list = Array.from(byDay.entries())
      .sort((a, b) => b[0].localeCompare(a[0]))
      .slice(0, 5)
      .map(([date, d]) => `  ${date}: ${d.presentes}/${d.total} presentes`)
      .join("\n");
    sections.push([
      `── ASISTENCIA (últimos 7 días) ──`,
      `Media de presentes: ${avgPresentes.toFixed(0)} personas/día`,
      list,
    ].join("\n"));
  }

  return sections.join("\n\n");
}

function normalizeGrupo(valor: string | null): string {
  if (!valor) return "Otro";
  const v = valor.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  if (v.includes("no_export") || v.includes("no export")) return "No exportación";
  if (v.includes("no_comerc") || v.includes("industria") || v.includes("ind")) return "No comercial";
  if (v.includes("export") || v.includes("ext")) return "Exportación";
  if (v.includes("mujer")) return "Mujeres";
  if (v.includes("mercado") || v.includes("nac") || v.includes("interior")) return "Mercado";
  return valor;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useChatBot() {
  const [isOpen, setIsOpen]         = useState(false);
  const [messages, setMessages]     = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading]   = useState(false);
  const [streaming, setStreaming]   = useState("");

  const historyRef      = useRef<ChatContent[]>([]);
  const systemRef       = useRef<string>(DOMAIN_PROMPT);
  const initializedRef  = useRef(false);

  const initSession = useCallback(async () => {
    if (initializedRef.current) return;
    initializedRef.current = true;
    try {
      const context = await fetchFullContext();
      systemRef.current = `${DOMAIN_PROMPT}\n\n${"═".repeat(50)}\nDATOS ACTUALES DEL SISTEMA:\n${context}`;
      historyRef.current = [];
      setMessages([{
        id: "welcome",
        role: "assistant",
        content: "¡Hola! Soy Vadim, tu asistente de producción. Tengo acceso completo a los datos de producción, productores, consumos y asistencia. ¿En qué puedo ayudarte?",
        timestamp: new Date(),
      }]);
    } catch {
      setMessages([{
        id: "err",
        role: "assistant",
        content: "⚠️ No se pudieron cargar los datos. Puedes preguntar igualmente sobre la herramienta.",
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
    if (!text.trim() || isLoading) return;

    setMessages((prev) => [...prev, {
      id: `u-${Date.now()}`, role: "user",
      content: text.trim(), timestamp: new Date(),
    }]);
    setIsLoading(true);
    setStreaming("");

    try {
      const fullText = await callChatFunction({
        message: text.trim(),
        history: historyRef.current,
        systemInstruction: systemRef.current,
        onChunk: (partial) => setStreaming(partial),
      });
      historyRef.current = [
        ...historyRef.current,
        { role: "user",      content: text.trim() },
        { role: "assistant", content: fullText },
      ];
      setMessages((prev) => [...prev, {
        id: `a-${Date.now()}`, role: "assistant",
        content: fullText, timestamp: new Date(),
      }]);
    } catch (err) {
      setMessages((prev) => [...prev, {
        id: `err-${Date.now()}`, role: "assistant",
        content: `Lo siento, hubo un error: ${err instanceof Error ? err.message : String(err)}`,
        timestamp: new Date(), error: true,
      }]);
    } finally {
      setIsLoading(false);
      setStreaming("");
    }
  }, [isLoading]);

  const clearHistory = useCallback(() => {
    initializedRef.current = false;
    historyRef.current = [];
    setMessages([]);
    initSession();
  }, [initSession]);

  return { isOpen, open, close, messages, isLoading, streaming, sendMessage, clearHistory };
}

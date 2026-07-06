/**
 * useChatBot — Hook para Vadim, el asistente de producción Lasarte SAT.
 * Al abrirse, carga un resumen agregado de TODAS las secciones (semana
 * actual, Mercadona, productores del mes, consumos, calidad) y lo inyecta
 * como contexto en el system prompt, manteniendo el total bajo ~8k tokens
 * (resúmenes, no filas crudas). El contexto se cachea unos minutos para no
 * repetir todas las consultas cada vez que se abre el panel.
 *
 * Sistema RAG (Retrieval Augmented Generation) opcional para:
 * - Búsqueda semántica en código fuente
 * - Memoria persistente de conversaciones
 * - Aprendizaje continuo
 */
import { useState, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { callChatFunction, DOMAIN_PROMPT, ChatContent } from "@/lib/gemini";
import { computeCascade } from "@/lib/cascade";
import { normalizeConsumoCantidad, type ConsumoFisicoInput } from "@/lib/consumosFisicos";
import { detectarTipoClasificacion } from "@/lib/destinoClasificacion";
import { getRAGContext, formatRAGContext, saveConversation } from "@/lib/rag";
import { useAuth } from "@/contexts/AuthProvider";

// ─── Tipos ────────────────────────────────────────────────────────────────────

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  error?: boolean;
}

// ─── Helpers de formato y fechas ───────────────────────────────────────────────

function fmt(n: number) { return n.toLocaleString("es-ES", { maximumFractionDigits: 0 }); }
function fmtT(kg: number) { return `${(kg / 1000).toFixed(1)} t`; }

function sinceStr(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  // Componentes locales, no UTC, para que "hoy" sea el día local del usuario.
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function shortText(value: unknown, max = 120) {
  const text = String(value ?? "").trim().replace(/\s+/g, " ");
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

/** Inicio (lunes) de la semana natural que contiene `date`, en formato YYYY-MM-DD. */
function weekStartStr(date = new Date()) {
  const d = new Date(date);
  const day = d.getDay() === 0 ? 6 : d.getDay() - 1;
  d.setDate(d.getDate() - day);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Primer día del mes actual, en formato YYYY-MM-DD. */
function monthStartStr(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-01`;
}

function currentSessionPrompt() {
  const now = new Date();
  return [
    DOMAIN_PROMPT,
    `FECHA ACTUAL DE LA SESION: ${now.toLocaleDateString("es-ES")} (${sinceStr(0)}). Zona horaria del usuario: Europe/Madrid.`,
    `ESTILO: responde en español, cita siempre números concretos con su unidad cuando estén en el contexto de datos. Si un dato no está en el contexto, dilo con claridad y sugiere en qué sección de la app consultarlo.`,
  ].join("\n\n");
}

function normalizeGrupo(valor: string | null): string {
  return detectarTipoClasificacion(valor);
}

// ─── Carga de contexto agregado (resúmenes, no filas crudas) ──────────────────

/** Cascada calculada para una fila cruda de partes_diarios. */
function cascadeFromParteRow(p: Record<string, unknown>) {
  const n = (v: unknown) => Number(v) || 0;
  return computeCascade({
    kg_produccion_calibrador: n(p.kg_produccion_calibrador),
    kg_mujeres_calibrador: n(p.kg_mujeres_calibrador),
    kg_palets_brutos: n(p.kg_palets_brutos) - n(p.kg_palets_egipto),
    kg_podrido_calibrador: n(p.kg_podrido_calibrador_auto),
    kg_industria_manual: n(p.kg_industria_manual),
    kg_reciclado_malla_z1: n(p.kg_reciclado_malla_z1),
    kg_reciclado_malla_z2: n(p.kg_reciclado_malla_z2),
    kg_inventario_sin_alta: n(p.kg_inventario_sin_alta),
    kg_podrido_bolsa_basura: n(p.kg_podrido_bolsa_basura),
    kg_inventario_anterior_sin_alta: n(p.kg_inventario_anterior_sin_alta),
  });
}

const PARTE_COLUMNS = `
  id, date, estado,
  kg_produccion_calibrador, kg_mujeres_calibrador,
  kg_palets_brutos, kg_palets_egipto,
  kg_podrido_calibrador_auto, kg_industria_manual,
  kg_reciclado_malla_z1, kg_reciclado_malla_z2,
  kg_inventario_sin_alta, kg_podrido_bolsa_basura,
  kg_inventario_anterior_sin_alta
`;

async function buildResumenSemanal(sections: string[], weekStart: string, since30: string): Promise<string[]> {
  const { data: partesRaw } = await supabase
    .from("partes_diarios")
    .select(PARTE_COLUMNS)
    .gte("date", since30)
    .order("date", { ascending: false })
    .limit(60);

  const partes = (partesRaw ?? []).map((p) => ({
    id: p.id as string,
    date: p.date as string,
    estado: p.estado as string,
    ...cascadeFromParteRow(p as Record<string, unknown>),
  }));

  if (partes.length === 0) {
    sections.push("-- PARTES: Sin partes en los ultimos 30 dias.");
    return [];
  }

  const semanaActual = partes.filter((p) => p.date >= weekStart);
  const totalProd = partes.reduce((s, p) => s + p.produccion_real, 0);
  const avgDsj = partes.reduce((s, p) => s + p.dsj_pct, 0) / partes.length;

  const semanaProd = semanaActual.reduce((s, p) => s + p.produccion_real, 0);
  const semanaPalets = semanaActual.reduce((s, p) => s + p.palets_ajustados, 0);
  const semanaDsj = semanaActual.reduce((s, p) => s + p.dsj, 0);
  const semanaDsjPct = semanaProd > 0 ? (semanaDsj / semanaProd) * 100 : 0;
  const semanaSemaforo = Math.abs(semanaDsjPct) <= 3 ? "verde" : Math.abs(semanaDsjPct) <= 5 ? "amarillo" : "rojo";

  const recentList = partes.slice(0, 10).map((p) =>
    `  ${p.date}: ${fmtT(p.produccion_real)}, DJPMN ${p.dsj_pct.toFixed(2)}% (${p.semaforo}), ${p.estado}`
  ).join("\n");

  sections.push([
    "-- RESUMEN SEMANA ACTUAL (desde " + weekStart + ") --",
    semanaActual.length > 0
      ? `Produccion: ${fmtT(semanaProd)} | Kg dados de alta (palets ajustados): ${fmtT(semanaPalets)} | DJPMN: ${semanaDsjPct.toFixed(2)}% (${semanaSemaforo}) | ${semanaActual.length} parte(s)`
      : "Sin partes cargados todavia esta semana.",
  ].join("\n"));

  sections.push([
    "-- PARTES DIARIOS (ultimos 30 dias) --",
    `Total: ${partes.length} partes | Produccion: ${fmtT(totalProd)} | DJPMN medio: ${avgDsj.toFixed(2)}%`,
    `Semaforos: ${partes.filter((p) => p.semaforo === "verde").length} verde | ${partes.filter((p) => p.semaforo === "amarillo").length} amarillo | ${partes.filter((p) => p.semaforo === "rojo").length} rojo`,
    "Ultimos 10 partes:",
    recentList,
  ].join("\n"));

  return partes.map((p) => p.id);
}

async function buildMercadonaSemanal(sections: string[], weekStart: string, weekEnd: string) {
  const { data: partesIds } = await supabase
    .from("partes_diarios")
    .select("id")
    .gte("date", weekStart)
    .lte("date", weekEnd);

  if (!partesIds?.length) {
    sections.push("-- APROVECHAMIENTO MERCADONA (semana actual): sin partes esta semana.");
    return;
  }

  const { data: productos } = await supabase
    .from("producto_dia")
    .select("producto, kg, n_cajas")
    .in("part_id", partesIds.map((p) => p.id))
    .limit(5000);

  const rows = (productos ?? []).filter((p) => (p.producto ?? "").trim() !== "");
  const kgTotal = rows.reduce((s, p) => s + (Number(p.kg) || 0), 0);
  const mdna = rows.filter((p) => (p.producto ?? "").toUpperCase().includes("MDNA"));
  const kgMdna = mdna.reduce((s, p) => s + (Number(p.kg) || 0), 0);
  const cajasMdna = mdna.reduce((s, p) => s + (Number(p.n_cajas) || 0), 0);
  const pct = kgTotal > 0 ? (kgMdna / kgTotal) * 100 : 0;

  if (kgTotal === 0) {
    sections.push("-- APROVECHAMIENTO MERCADONA (semana actual): sin kg confeccionados (informe de producto) todavia.");
    return;
  }

  sections.push([
    "-- APROVECHAMIENTO MERCADONA (formatos MDNA, semana actual) --",
    `${pct.toFixed(1)}% de los kg confeccionados fueron Mercadona: ${fmtT(kgMdna)} de ${fmtT(kgTotal)} totales | ${cajasMdna.toLocaleString("es-ES")} cajas`,
  ].join("\n"));
}

function normalizeNombreProductor(value: string | null | undefined): string {
  return String(value ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
}

async function buildProductoresDelMes(sections: string[], monthStart: string) {
  const [{ data: lotes }, { data: clasifRaw }] = await Promise.all([
    supabase
      .from("lotes_dia")
      .select("productor, toneladas_hora, duracion_min, kg_peso_total, kg_industria, partes_diarios!inner(date)")
      .gte("partes_diarios.date", monthStart)
      .limit(3000),
    supabase
      .from("lote_clasificacion")
      .select("productor, grupo_destino, peso_kg")
      .gte("fecha", monthStart)
      .limit(20000),
  ]);

  if (!lotes?.length) {
    sections.push("-- PRODUCTORES DEL MES: sin lotes registrados este mes.");
    return;
  }

  // % export por productor, a partir del Informe LOTE (si existe para ese productor).
  const exportPorProductor = new Map<string, { kgExport: number; kgTotal: number }>();
  for (const c of clasifRaw ?? []) {
    const nombre = normalizeNombreProductor(c.productor);
    if (!nombre) continue;
    const acc = exportPorProductor.get(nombre) ?? { kgExport: 0, kgTotal: 0 };
    const kg = Number(c.peso_kg) || 0;
    acc.kgTotal += kg;
    if (detectarTipoClasificacion(c.grupo_destino) === "Exportación") acc.kgExport += kg;
    exportPorProductor.set(nombre, acc);
  }

  const byProd = new Map<string, { kg: number; lotes: number; tphSum: number; tphMin: number; tphCount: number; kgIndustria: number }>();
  for (const l of lotes) {
    const k = l.productor || "Desconocido";
    if (!byProd.has(k)) byProd.set(k, { kg: 0, lotes: 0, tphSum: 0, tphMin: 0, tphCount: 0, kgIndustria: 0 });
    const p = byProd.get(k)!;
    p.kg += Number(l.kg_peso_total) || 0;
    p.lotes += 1;
    p.kgIndustria += Number(l.kg_industria) || 0;
    const tph = Number(l.toneladas_hora) || 0;
    const min = Number(l.duracion_min) || 0;
    if (tph > 0) { p.tphSum += tph * min; p.tphMin += min; p.tphCount += 1; }
  }

  const ranking = Array.from(byProd.entries())
    .map(([nombre, s]) => {
      const exportInfo = exportPorProductor.get(normalizeNombreProductor(nombre));
      const pctExport = exportInfo && exportInfo.kgTotal > 0 ? (exportInfo.kgExport / exportInfo.kgTotal) * 100 : null;
      return {
        nombre,
        kg: s.kg,
        lotes: s.lotes,
        tph: s.tphCount > 0 ? (s.tphMin > 0 ? s.tphSum / s.tphMin : s.tphSum / s.tphCount) : null,
        pctIndustria: s.kg > 0 ? (s.kgIndustria / s.kg) * 100 : 0,
        pctExport,
      };
    })
    .sort((a, b) => b.kg - a.kg)
    .slice(0, 8);

  const list = ranking.map((p) =>
    `  ${p.nombre}: ${fmtT(p.kg)}, ${p.lotes} lotes${p.tph ? `, ${p.tph.toFixed(1)} T/h` : ""}, ${p.pctIndustria.toFixed(1)}% industria${p.pctExport !== null ? `, ${p.pctExport.toFixed(1)}% exportación` : ""}`
  ).join("\n");

  sections.push(["-- TOP PRODUCTORES DEL MES (por kg, con T/h y % exportación) --", list].join("\n"));
}

async function buildDistribucionDestino(sections: string[], partIds: string[]) {
  if (!partIds.length) return;
  const { data: calibres } = await supabase
    .from("calibres_dia")
    .select("grupo_destino, kg")
    .in("part_id", partIds)
    .limit(50000);

  if (!calibres?.length) return;
  const map = new Map<string, number>();
  for (const c of calibres) {
    const grupo = normalizeGrupo(c.grupo_destino);
    map.set(grupo, (map.get(grupo) ?? 0) + (Number(c.kg) || 0));
  }
  const total = Array.from(map.values()).reduce((s, v) => s + v, 0);
  if (total <= 0) return;
  const list = Array.from(map.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([g, kg]) => `  ${g}: ${((kg / total) * 100).toFixed(1)}% (${fmtT(kg)})`)
    .join("\n");
  sections.push([`-- DISTRIBUCION POR DESTINO (ultimos 30 dias) --`, list].join("\n"));
}

async function buildConsumosSemana(sections: string[], weekStart: string, weekEnd: string) {
  const [{ data: consumosRaw }, { data: basesRaw }] = await Promise.all([
    supabase
      .from("consumos_fisicos")
      .select("recurso, fecha_inicio, fecha_fin, cantidad, unidad, fuente")
      .lte("fecha_inicio", weekEnd)
      .gte("fecha_fin", weekStart)
      .limit(200),
    supabase
      .from("consumos_bases_kg")
      .select("tipo_base, fecha_inicio, fecha_fin, kg")
      .lte("fecha_inicio", weekEnd)
      .gte("fecha_fin", weekStart)
      .limit(200),
  ]);

  const consumos = (consumosRaw ?? []) as ConsumoFisicoInput[];
  if (consumos.length === 0) {
    sections.push("-- CONSUMOS (semana actual): sin lecturas/registros de consumo esta semana.");
    return;
  }

  let aguaL = 0;
  let elecKwh = 0;
  let gasoilL = 0;
  let quimicosL = 0;
  for (const c of consumos) {
    const { cantidadBase, unidadBase } = normalizeConsumoCantidad(c);
    if (c.recurso === "agua") aguaL += cantidadBase;
    else if (c.recurso === "electricidad" && unidadBase === "kwh") elecKwh += cantidadBase;
    else if (c.recurso === "gasoil") gasoilL += cantidadBase;
    else if (c.recurso === "quimicos") quimicosL += cantidadBase;
  }

  const kgBase = (basesRaw ?? []).reduce((s, b) => s + (Number(b.kg) || 0), 0);

  const ratios = kgBase > 0
    ? `Agua ${(aguaL / kgBase).toFixed(2)} L/kg | Electricidad ${(elecKwh / kgBase).toFixed(3)} kWh/kg | Gasoil ${((gasoilL * 1000) / kgBase).toFixed(1)} mL/kg`
    : "Sin kg base para calcular ratios por kg esta semana.";

  sections.push([
    "-- CONSUMOS (semana actual) --",
    `Agua ${fmt(aguaL)} L | Electricidad ${fmt(elecKwh)} kWh | Gasoil ${fmt(gasoilL)} L | Quimicos ${fmt(quimicosL)} L`,
    ratios,
  ].join("\n"));
}

async function buildEstadoCalidad(sections: string[], since30: string) {
  const [jornadasRes, lotesRes] = await Promise.allSettled([
    supabase
      .from("calidad_jornadas" as any)
      .select("fecha, responsable, estado")
      .gte("fecha", since30)
      .order("fecha", { ascending: false })
      .limit(30),
    supabase
      .from("calidad_lotes" as any)
      .select("fecha, numero_lote, productor_finca_nombre, producto, variedad, calidad, defectos, observacion, accion_recomendada")
      .gte("fecha", since30)
      .order("fecha", { ascending: false })
      .limit(150),
  ]);

  const calidadJornadas = jornadasRes.status === "fulfilled" ? ((jornadasRes.value.data ?? []) as any[]) : [];
  const calidadLotes = lotesRes.status === "fulfilled" ? ((lotesRes.value.data ?? []) as any[]) : [];

  if (calidadJornadas.length === 0 && calidadLotes.length === 0) {
    sections.push("-- CALIDAD: Sin jornadas ni lotes anotados en los ultimos 30 dias.");
    return;
  }

  const byQuality = new Map<string, number>();
  const incidencias: string[] = [];
  for (const lote of calidadLotes) {
    const calidad = String(lote.calidad ?? "Sin calidad");
    byQuality.set(calidad, (byQuality.get(calidad) ?? 0) + 1);
    const tieneDefectos = Array.isArray(lote.defectos) && lote.defectos.length > 0;
    const esIncidencia = calidad === "Regular" || calidad === "Deficiente" || calidad === "Pésimo" || tieneDefectos || lote.observacion;
    if (esIncidencia && incidencias.length < 8) {
      const flags = [
        tieneDefectos ? `defectos: ${lote.defectos.join(", ")}` : "",
        lote.observacion ? `obs: ${shortText(lote.observacion, 80)}` : "",
      ].filter(Boolean).join(" | ");
      incidencias.push(`  ${lote.fecha} lote ${lote.numero_lote || "-"} (${lote.productor_finca_nombre || "-"}): ${calidad}${flags ? ` | ${flags}` : ""}`);
    }
  }
  const qualityLine = Array.from(byQuality.entries()).sort((a, b) => b[1] - a[1]).map(([q, c]) => `${q}: ${c}`).join(" | ");

  sections.push([
    "-- ESTADO DE CALIDAD (ultimos 30 dias) --",
    `Jornadas: ${calidadJornadas.length} | Lotes anotados: ${calidadLotes.length}`,
    qualityLine ? `Estados: ${qualityLine}` : "Estados: sin lotes anotados",
    incidencias.length > 0 ? `Incidencias recientes:\n${incidencias.join("\n")}` : "Sin incidencias recientes.",
  ].join("\n"));
}

async function fetchAggregatedContext(): Promise<string> {
  const since30 = sinceStr(30);
  const weekStart = weekStartStr();
  const monthStart = monthStartStr();
  const today = sinceStr(0);

  const sections: string[] = [
    `-- SESION --\nFecha actual: ${new Date().toLocaleDateString("es-ES")} | Semana actual desde ${weekStart} | Mes actual desde ${monthStart}`,
  ];

  const partIds = await buildResumenSemanal(sections, weekStart, since30);

  await Promise.allSettled([
    buildMercadonaSemanal(sections, weekStart, today),
    buildProductoresDelMes(sections, monthStart),
    buildDistribucionDestino(sections, partIds),
    buildConsumosSemana(sections, weekStart, today),
    buildEstadoCalidad(sections, since30),
  ]);

  return sections.join("\n\n");
}

// ─── Cache del contexto agregado (unos minutos, evita recargar todo al reabrir) ─

const CONTEXT_CACHE_MS = 4 * 60 * 1000;
let cachedContext: { value: string; expiresAt: number } | null = null;

async function getCachedContext(): Promise<string> {
  if (cachedContext && cachedContext.expiresAt > Date.now()) {
    return cachedContext.value;
  }
  const value = await fetchAggregatedContext();
  cachedContext = { value, expiresAt: Date.now() + CONTEXT_CACHE_MS };
  return value;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useChatBot() {
  const { user } = useAuth();
  const [isOpen, setIsOpen]         = useState(false);
  const [messages, setMessages]     = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading]   = useState(false);
  const [streaming, setStreaming]   = useState("");

  const historyRef      = useRef<ChatContent[]>([]);
  const systemRef       = useRef<string>(currentSessionPrompt());
  const initializedRef  = useRef(false);

  const initSession = useCallback(async () => {
    if (initializedRef.current) return;
    initializedRef.current = true;
    try {
      const context = await getCachedContext();
      systemRef.current = `${currentSessionPrompt()}\n\n${"═".repeat(50)}\nDATOS ACTUALES DEL SISTEMA:\n${context}`;
      historyRef.current = [];
      setMessages([{
        id: "welcome",
        role: "assistant",
        content: "¡Hola! Soy Vadim, tu asistente de producción. Tengo el resumen de la semana actual (producción, DJPMN, Mercadona), productores del mes, consumos y calidad. ¿En qué puedo ayudarte?",
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
      // Obtener contexto RAG (código relevante, conversaciones anteriores, conocimiento)
      let ragContext = "";
      if (user?.id) {
        try {
          const context = await getRAGContext(text.trim(), user.id);
          ragContext = formatRAGContext(context);
        } catch (error) {
          console.warn("Error obteniendo contexto RAG:", error);
        }
      }

      // Construir system prompt con contexto RAG
      const enhancedSystemPrompt = ragContext
        ? `${systemRef.current}\n\n${ragContext}`
        : systemRef.current;

      const fullText = await callChatFunction({
        message: text.trim(),
        history: historyRef.current,
        systemInstruction: enhancedSystemPrompt,
        onChunk: (partial) => setStreaming(partial),
      });

      // Guardar conversación en base de datos (para memoria persistente)
      if (user?.id) {
        try {
          await Promise.all([
            saveConversation(user.id, "user", text.trim()),
            saveConversation(user.id, "assistant", fullText),
          ]);
        } catch (error) {
          console.warn("Error guardando conversación:", error);
        }
      }

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
      const message = err instanceof Error ? err.message : String(err);
      setMessages((prev) => [...prev, {
        id: `err-${Date.now()}`, role: "assistant",
        content: message,
        timestamp: new Date(), error: true,
      }]);
    } finally {
      setIsLoading(false);
      setStreaming("");
    }
  }, [isLoading, user?.id]);

  const clearHistory = useCallback(() => {
    initializedRef.current = false;
    historyRef.current = [];
    setMessages([]);
    initSession();
  }, [initSession]);

  return { isOpen, open, close, messages, isLoading, streaming, sendMessage, clearHistory };
}

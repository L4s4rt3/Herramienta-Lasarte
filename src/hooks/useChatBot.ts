/**
 * useChatBot — Hook para Vadim, el asistente de producción Lasarte SAT.
 * Al abrirse, carga datos de TODAS las secciones en paralelo y los inyecta
 * como contexto en el system prompt. El asistente sabe todo sin navegar.
 * 
 * NUEVO: Sistema RAG (Retrieval Augmented Generation) para:
 * - Búsqueda semántica en código fuente
 * - Memoria persistente de conversaciones
 * - Aprendizaje continuo
 */
import { useState, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { callChatFunction, DOMAIN_PROMPT, TOOL_KNOWLEDGE_PROMPT, ChatContent } from "@/lib/gemini";
import { computeCascade } from "@/lib/cascade";
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

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt(n: number) { return n.toLocaleString("es-ES", { maximumFractionDigits: 0 }); }
function fmtT(kg: number) { return `${(kg / 1000).toFixed(1)} t`; }
function sinceStr(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function shortText(value: unknown, max = 120) {
  const text = String(value ?? "").trim().replace(/\s+/g, " ");
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

function currentSessionPrompt() {
  const now = new Date();
  return [
    DOMAIN_PROMPT,
    TOOL_KNOWLEDGE_PROMPT,
    `FECHA ACTUAL DE LA SESION: ${now.toLocaleDateString("es-ES")} (${now.toISOString().slice(0, 10)}). Zona horaria del usuario: Europe/Madrid.`,
  ].join("\n\n");
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
  const [lotesRes, calibresRes, sesionesRes, asistenciaRes, trabajadoresRes, calidadJornadasRes, calidadLotesRes] = await Promise.allSettled([

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
      .select("date, presente, trabajador_id")
      .gte("date", since7)
      .limit(500),

    // 6. Trabajadores activos/inactivos
    supabase
      .from("trabajadores")
      .select("id, nombre, zona, activo")
      .limit(1000),

    // 7. Jornadas de Calidad (30 dias)
    supabase
      .from("calidad_jornadas" as any)
      .select("fecha, responsable, estado")
      .gte("fecha", since30)
      .order("fecha", { ascending: false })
      .limit(30),

    // 8. Lotes de Calidad (30 dias)
    supabase
      .from("calidad_lotes" as any)
      .select("fecha, numero_lote, productor_finca_nombre, producto, variedad, cantidad, hora, aerobotics_realizado, calidad, defectos, observacion, accion_recomendada")
      .gte("fecha", since30)
      .order("fecha", { ascending: false })
      .limit(200),
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

async function fetchFullContextV2(): Promise<string> {
  const since30 = sinceStr(30);
  const since7 = sinceStr(7);
  const sections: string[] = [];

  sections.push(`-- SESION --\nFecha actual: ${new Date().toLocaleDateString("es-ES")} | Ventana principal de datos: ultimos 30 dias`);

  const { data: partesRaw } = await supabase
    .from("partes_diarios")
    .select(`
      id, date, estado,
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
      kg_produccion_calibrador: Number(p.kg_produccion_calibrador) || 0,
      kg_mujeres_calibrador: Number(p.kg_mujeres_calibrador) || 0,
      kg_palets_brutos: (Number(p.kg_palets_brutos) || 0) - (Number(p.kg_palets_egipto) || 0),
      kg_podrido_calibrador: Number(p.kg_podrido_calibrador_auto) || 0,
      kg_industria_manual: Number(p.kg_industria_manual) || 0,
      kg_reciclado_malla_z1: Number(p.kg_reciclado_malla_z1) || 0,
      kg_reciclado_malla_z2: Number(p.kg_reciclado_malla_z2) || 0,
      kg_inventario_sin_alta: Number(p.kg_inventario_sin_alta) || 0,
      kg_podrido_bolsa_basura: Number(p.kg_podrido_bolsa_basura) || 0,
      kg_inventario_anterior_sin_alta: Number(p.kg_inventario_anterior_sin_alta) || 0,
    });
    return { id: p.id as string, date: p.date as string, estado: p.estado as string, ...cascade };
  });

  if (partes.length > 0) {
    const totalProd = partes.reduce((s, p) => s + p.produccion_real, 0);
    const avgDsj = partes.reduce((s, p) => s + p.dsj_pct, 0) / partes.length;
    const recentList = partes.slice(0, 10).map((p) =>
      `  ${p.date}: ${fmtT(p.produccion_real)}, DJPMN ${p.dsj_pct.toFixed(2)}% (${p.semaforo}), ${p.estado}`
    ).join("\n");
    sections.push([
      "-- PARTES DIARIOS (ultimos 30 dias) --",
      `Total: ${partes.length} partes | Produccion: ${fmtT(totalProd)} | DJPMN medio: ${avgDsj.toFixed(2)}%`,
      `Semaforos: ${partes.filter((p) => p.semaforo === "verde").length} verde | ${partes.filter((p) => p.semaforo === "amarillo").length} amarillo | ${partes.filter((p) => p.semaforo === "rojo").length} rojo`,
      "Ultimos 10 partes:",
      recentList,
    ].join("\n"));
  } else {
    sections.push("-- PARTES: Sin partes en los ultimos 30 dias.");
  }

  const partIds = partes.map((p) => p.id);
  const [lotesRes, calibresRes, sesionesRes, asistenciaRes, trabajadoresRes, calidadJornadasRes, calidadLotesRes] = await Promise.allSettled([
    supabase.from("lotes_dia").select("productor, toneladas_hora, duracion_min, kg_peso_total, partes_diarios!inner(date)").gte("partes_diarios.date", since30).limit(2000),
    partIds.length ? supabase.from("calibres_dia").select("grupo_destino, kg").in("part_id", partIds).limit(100000) : Promise.resolve({ data: [] }),
    supabase.from("sesiones_consumo").select("fecha_inicio, fecha_fin, kg_procesados, agua_linea_l, agua_drencher_l, electricidad_total_kwh, gasoil_l, quimicos_drencher_l").order("fecha_inicio", { ascending: false }).limit(5),
    supabase.from("asistencia_detalle").select("date, presente, trabajador_id").gte("date", since7).limit(500),
    supabase.from("trabajadores").select("id, nombre, zona, activo").limit(1000),
    supabase.from("calidad_jornadas" as any).select("fecha, responsable, estado").gte("fecha", since30).order("fecha", { ascending: false }).limit(30),
    supabase.from("calidad_lotes" as any).select("fecha, numero_lote, productor_finca_nombre, producto, variedad, cantidad, hora, aerobotics_realizado, calidad, defectos, observacion, accion_recomendada").gte("fecha", since30).order("fecha", { ascending: false }).limit(200),
  ]);

  if (lotesRes.status === "fulfilled" && lotesRes.value.data?.length) {
    const byProd = new Map<string, { kg: number; lotes: number; tphSum: number; tphMin: number; tphCount: number }>();
    for (const l of lotesRes.value.data) {
      const k = l.productor || "Desconocido";
      if (!byProd.has(k)) byProd.set(k, { kg: 0, lotes: 0, tphSum: 0, tphMin: 0, tphCount: 0 });
      const p = byProd.get(k)!;
      p.kg += Number(l.kg_peso_total) || 0;
      p.lotes += 1;
      const tph = Number(l.toneladas_hora) || 0;
      const min = Number(l.duracion_min) || 0;
      if (tph > 0) {
        p.tphSum += tph * min;
        p.tphMin += min;
        p.tphCount += 1;
      }
    }
    const list = Array.from(byProd.entries())
      .map(([nombre, s]) => ({ nombre, kg: s.kg, lotes: s.lotes, tph: s.tphCount > 0 ? (s.tphMin > 0 ? s.tphSum / s.tphMin : s.tphSum / s.tphCount) : null }))
      .sort((a, b) => b.kg - a.kg)
      .slice(0, 10)
      .map((p) => `  ${p.nombre}: ${fmtT(p.kg)}, ${p.lotes} lotes${p.tph ? `, ${p.tph.toFixed(1)} T/h` : ""}`)
      .join("\n");
    sections.push(["-- PRODUCTORES (top 10 por kg, ultimos 30 dias) --", list].join("\n"));
  }

  if (calibresRes.status === "fulfilled") {
    const result = calibresRes.value as { data: { grupo_destino: string | null; kg: number }[] | null };
    if (result?.data?.length) {
      const map = new Map<string, number>();
      for (const c of result.data) {
        const grupo = normalizeGrupo(c.grupo_destino);
        map.set(grupo, (map.get(grupo) ?? 0) + (Number(c.kg) || 0));
      }
      const total = Array.from(map.values()).reduce((s, v) => s + v, 0);
      const list = Array.from(map.entries()).sort((a, b) => b[1] - a[1]).map(([g, kg]) => `  ${g}: ${total ? ((kg / total) * 100).toFixed(1) : "0.0"}% (${fmtT(kg)})`).join("\n");
      sections.push(["-- DISTRIBUCION POR DESTINO (ultimos 30 dias) --", list].join("\n"));
    }
  }

  if (sesionesRes.status === "fulfilled" && sesionesRes.value.data?.length) {
    const list = sesionesRes.value.data.slice(0, 3).map((s) => {
      const kg = Number(s.kg_procesados) || 1;
      const agua = ((Number(s.agua_linea_l) || 0) + (Number(s.agua_drencher_l) || 0)) / kg;
      const elec = (Number(s.electricidad_total_kwh) || 0) / kg;
      const gasoil = ((Number(s.gasoil_l) || 0) * 1000) / kg;
      return `  ${s.fecha_inicio}->${s.fecha_fin}: ${fmt(kg)} kg | Agua ${agua.toFixed(2)} L/kg | Electricidad ${elec.toFixed(3)} kWh/kg | Gasoil ${gasoil.toFixed(1)} mL/kg`;
    }).join("\n");
    sections.push(["-- CONSUMOS (ultimas sesiones) --", list].join("\n"));
  }

  const calidadJornadas = calidadJornadasRes.status === "fulfilled" ? ((calidadJornadasRes.value.data ?? []) as any[]) : [];
  const calidadLotes = calidadLotesRes.status === "fulfilled" ? ((calidadLotesRes.value.data ?? []) as any[]) : [];
  if (calidadJornadas.length > 0 || calidadLotes.length > 0) {
    const byQuality = new Map<string, number>();
    let aerobotics = 0;
    for (const lote of calidadLotes) {
      const calidad = String(lote.calidad ?? "Sin calidad");
      byQuality.set(calidad, (byQuality.get(calidad) ?? 0) + 1);
      if (lote.aerobotics_realizado) aerobotics += 1;
    }
    const qualityLine = Array.from(byQuality.entries()).sort((a, b) => b[1] - a[1]).map(([q, c]) => `${q}: ${c}`).join(" | ");
    const jornadaLine = calidadJornadas.slice(0, 5).map((j) => `  ${j.fecha}: ${j.estado ?? "sin estado"} | responsable ${j.responsable || "-"}`).join("\n");
    const lotesLine = calidadLotes.slice(0, 8).map((lote) => {
      const flags = [
        lote.aerobotics_realizado ? "Aerobotics si" : "Aerobotics no",
        lote.defectos?.length ? `defectos: ${lote.defectos.join(", ")}` : "",
        lote.observacion ? `obs: ${shortText(lote.observacion, 80)}` : "",
        lote.accion_recomendada ? `accion: ${shortText(lote.accion_recomendada, 80)}` : "",
      ].filter(Boolean).join(" | ");
      return `  ${lote.fecha} lote ${lote.numero_lote || "-"}: ${lote.productor_finca_nombre || "-"} | ${lote.producto || "-"} ${lote.variedad || ""} | ${lote.calidad || "-"}${flags ? ` | ${flags}` : ""}`;
    }).join("\n");
    sections.push([
      "-- CALIDAD (ultimos 30 dias) --",
      `Jornadas: ${calidadJornadas.length} | Lotes anotados: ${calidadLotes.length} | Aerobotics: ${aerobotics}`,
      qualityLine ? `Estados: ${qualityLine}` : "Estados: sin lotes anotados",
      jornadaLine ? `Ultimas jornadas:\n${jornadaLine}` : "",
      lotesLine ? `Ultimos lotes anotados:\n${lotesLine}` : "",
    ].filter(Boolean).join("\n"));
  } else {
    sections.push("-- CALIDAD: Sin jornadas ni lotes anotados en los ultimos 30 dias.");
  }

  const trabajadores = trabajadoresRes.status === "fulfilled" ? ((trabajadoresRes.value.data ?? []) as any[]) : [];
  const trabajadoresById = new Map<string, { nombre: string; zona: string | null; activo: boolean }>();
  if (trabajadores.length > 0) {
    const byZona = new Map<string, { activos: number; inactivos: number }>();
    for (const trabajador of trabajadores) {
      trabajadoresById.set(trabajador.id, { nombre: trabajador.nombre ?? "Sin nombre", zona: trabajador.zona ?? null, activo: Boolean(trabajador.activo) });
      const zona = trabajador.zona || "Sin zona";
      if (!byZona.has(zona)) byZona.set(zona, { activos: 0, inactivos: 0 });
      const stats = byZona.get(zona)!;
      if (trabajador.activo) stats.activos += 1;
      else stats.inactivos += 1;
    }
    const zonas = Array.from(byZona.entries()).sort((a, b) => b[1].activos - a[1].activos).map(([zona, stats]) => `  ${zona}: ${stats.activos} activos${stats.inactivos ? `, ${stats.inactivos} inactivos` : ""}`).join("\n");
    sections.push(["-- TRABAJADORES --", `Total: ${trabajadores.length} | Activos: ${trabajadores.filter((t) => t.activo).length} | Inactivos: ${trabajadores.filter((t) => !t.activo).length}`, zonas].join("\n"));
  }

  if (asistenciaRes.status === "fulfilled" && asistenciaRes.value.data?.length) {
    const byDay = new Map<string, { presentes: number; total: number; ausentes: string[] }>();
    for (const r of asistenciaRes.value.data) {
      if (!byDay.has(r.date)) byDay.set(r.date, { presentes: 0, total: 0, ausentes: [] });
      const d = byDay.get(r.date)!;
      d.total += 1;
      if (r.presente) d.presentes += 1;
      else {
        const trabajador = trabajadoresById.get(r.trabajador_id);
        if (trabajador?.nombre) d.ausentes.push(trabajador.nombre);
      }
    }
    const avgPresentes = Array.from(byDay.values()).reduce((s, d) => s + d.presentes, 0) / Math.max(byDay.size, 1);
    const list = Array.from(byDay.entries())
      .sort((a, b) => b[0].localeCompare(a[0]))
      .slice(0, 5)
      .map(([date, d]) => {
        const absent = d.ausentes.length ? ` | ausentes: ${d.ausentes.slice(0, 8).join(", ")}${d.ausentes.length > 8 ? "..." : ""}` : "";
        return `  ${date}: ${d.presentes}/${d.total} presentes${absent}`;
      })
      .join("\n");
    sections.push(["-- ASISTENCIA (ultimos 7 dias) --", `Media de presentes: ${avgPresentes.toFixed(0)} personas/dia`, list].join("\n"));
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
      const context = await fetchFullContextV2();
      systemRef.current = `${currentSessionPrompt()}\n\n${"═".repeat(50)}\nDATOS ACTUALES DEL SISTEMA:\n${context}`;
      historyRef.current = [];
      setMessages([{
        id: "welcome",
        role: "assistant",
        content: "¡Hola! Soy Vadim, tu asistente de producción. Tengo contexto de Partes, Calidad, productores, consumos, asistencia y exportaciones. ¿En qué puedo ayudarte?",
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
      setMessages((prev) => [...prev, {
        id: `err-${Date.now()}`, role: "assistant",
        content: `Lo siento, hubo un error: ${err instanceof Error ? err.message : String(err)}`,
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

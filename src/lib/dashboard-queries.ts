import { supabase } from "@/integrations/supabase/client";
import { DailyProduction, ProduccionResumen } from "./types";
import { today, toISODateLocal } from "./format";

interface ProduccionPartesRow {
  date: string;
  kg_produccion_calibrador: number | null;
  kg_industria_manual: number | null;
  kg_mujeres_calibrador: number | null;
  kg_reciclado_malla_z1: number | null;
  kg_reciclado_malla_z2: number | null;
}

interface EstadoParteRow {
  user_id: string;
  estado: string;
  date: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers de fecha
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Devuelve el rango de la semana (lunes–domingo) con un offset.
 * weekOffset = 0  → semana actual
 * weekOffset = -1 → semana anterior
 */
export function getWeekRange(weekOffset = 0): { from: string; to: string; label: string } {
  const now = new Date();
  const dayOfWeek = now.getDay() === 0 ? 6 : now.getDay() - 1; // lunes = 0
  const monday = new Date(now);
  monday.setDate(now.getDate() - dayOfWeek + weekOffset * 7);
  monday.setHours(0, 0, 0, 0);

  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);

  const fmt = (d: Date) => toISODateLocal(d);

  // Número de semana ISO
  const jan4 = new Date(monday.getFullYear(), 0, 4);
  const weekNo = Math.ceil(
    ((monday.getTime() - jan4.getTime()) / 86400000 + jan4.getDay() + 1) / 7
  );

  return {
    from: fmt(monday),
    to: fmt(sunday),
    label: `Semana ${weekNo} · ${monday.toLocaleDateString("es-ES", {
      day: "numeric",
      month: "short",
    })} – ${sunday.toLocaleDateString("es-ES", { day: "numeric", month: "short" })}`,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Cálculo de producción real (espeja la lógica de cascade.ts)
// producción real = calibrador − mujeres − reciclado_z1 − reciclado_z2
// ─────────────────────────────────────────────────────────────────────────────

function calcProduccionReal(row: ProduccionPartesRow): number {
  return (
    (Number(row.kg_produccion_calibrador) || 0) -
    (Number(row.kg_mujeres_calibrador)     || 0) -
    (Number(row.kg_reciclado_malla_z1)     || 0) -
    (Number(row.kg_reciclado_malla_z2)     || 0)
  );
}

const PROD_SELECT =
  "date, kg_produccion_calibrador, kg_industria_manual, kg_mujeres_calibrador, kg_reciclado_malla_z1, kg_reciclado_malla_z2";

// ─────────────────────────────────────────────────────────────────────────────
// Queries
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Producción real día a día para la semana indicada.
 * weekOffset: 0 = semana actual, -1 = anterior, -2 = hace dos semanas…
 * Genera los 7 días aunque no haya partes (kg = 0).
 */
export async function getProduccionSemanal(
  weekOffset = 0
): Promise<{ days: DailyProduction[]; weekLabel: string }> {
  const { from, to, label } = getWeekRange(weekOffset);

  const { data, error } = await supabase
    .from("partes_diarios")
    .select(PROD_SELECT)
    .gte("date", from)
    .lte("date", to)
    .order("date", { ascending: true });

  if (error) {
    console.error("Error fetching producción semanal:", error);
    throw error;
  }

  // Agrupa por fecha (puede haber varios partes por día)
  const grouped: Record<string, number> = {};
  for (const row of (data ?? []) as ProduccionPartesRow[]) {
    grouped[row.date] = (grouped[row.date] ?? 0) + calcProduccionReal(row);
  }

  // Genera los 7 días del lunes al domingo
  const days: DailyProduction[] = [];
  const cursor = new Date(from);
  for (let i = 0; i < 7; i++) {
    const dateKey = cursor.toISOString().slice(0, 10);
    days.push({
      date: cursor.toLocaleDateString("es-ES", { weekday: "short", day: "numeric" }),
      kg: Math.max(0, grouped[dateKey] ?? 0),
      objetivo: 0, // sin objetivo por turno
    });
    cursor.setDate(cursor.getDate() + 1);
  }

  return { days, weekLabel: label };
}

/**
 * Producción real total de hoy.
 */
export async function getProduccionHoy(): Promise<ProduccionResumen> {
  const todayStr = today();

  const { data, error } = await supabase
    .from("partes_diarios")
    .select(PROD_SELECT)
    .eq("date", todayStr);

  if (error) {
    console.error("Error fetching producción hoy:", error);
    throw error;
  }

  const totalKg = ((data ?? []) as ProduccionPartesRow[]).reduce((sum, r) => sum + calcProduccionReal(r), 0);

  return { totalKg, objetivo: 0, completion: 0 };
}

/**
 * Ausentes hoy según asistencia_detalle + trabajadores.
 */
export async function getAusentesHoy(): Promise<{
  ausentes: number;
  presentes: number;
  plantilla: number;
}> {
  const todayStr = today();

  const [trabajadores, asistencias] = await Promise.all([
    supabase
      .from("trabajadores")
      .select("id")
      .eq("activo", true),
    supabase
      .from("asistencia_detalle")
      .select("trabajador_id, presente")
      .eq("date", todayStr),
  ]);

  if (trabajadores.error) throw trabajadores.error;
  if (asistencias.error) throw asistencias.error;

  const totalActivos = (trabajadores.data ?? []).length;
  const presentes = (asistencias.data ?? []).filter((r) => r.presente).length;

  return {
    plantilla: totalActivos,
    presentes,
    ausentes: totalActivos - presentes,
  };
}

/**
 * Kg producidos de media por trabajador presente hoy.
 */
export async function getRendimientoPorTrabajador(): Promise<number> {
  const [prod, asistencia] = await Promise.all([
    getProduccionHoy(),
    getAusentesHoy(),
  ]);
  return asistencia.presentes > 0
    ? Math.round(prod.totalKg / asistencia.presentes)
    : 0;
}

/**
 * Estado de los partes de hoy.
 * Útil para alertas cuando quedan partes en Borrador.
 */
export async function getEstadoPartesHoy(): Promise<
  Array<{ user_id: string; estado: string; fecha: string }>
> {
  const todayStr = today();

  const { data, error } = await supabase
    .from("partes_diarios")
    .select("user_id, estado, date")
    .eq("date", todayStr);

  if (error) {
    console.error("Error fetching estado partes:", error);
    throw error;
  }

  return ((data ?? []) as EstadoParteRow[]).map((r) => ({
    user_id: r.user_id,
    estado: r.estado,
    fecha: r.date,
  }));
}

import { supabase } from "@/integrations/supabase/client";
import { DailyProduction, LineProduction, WorkerAttendance, ProduccionResumen } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Campos kg del nuevo esquema de partes_diarios.
 * Se seleccionan todos para poder calcular totales y desgloses.
 */
const KG_FIELDS = [
  "kg_industria_manual",
  "kg_reciclado_malla_z1",
  "kg_reciclado_malla_z2",
  "kg_inventario_sin_alta",
  "kg_podrido_bolsa_basura",
  "kg_produccion_calibrador",
  "kg_mujeres_calibrador",
  "kg_palets_brutos",
  "kg_podrido_calibrador_auto",
  "kg_inventario_anterior_sin_alta",
] as const;

type KgRow = Record<(typeof KG_FIELDS)[number], number>;

/**
 * Producción neta del calibrador (salida útil principal).
 * Ajusta esta función si la definición de "producido" cambia.
 */
function calcKgProducido(row: Partial<KgRow>): number {
  return (row.kg_produccion_calibrador ?? 0) + (row.kg_mujeres_calibrador ?? 0);
}

/**
 * Kg totales brutos de entrada al proceso.
 */
function calcKgBrutos(row: Partial<KgRow>): number {
  return row.kg_palets_brutos ?? 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Queries
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Obtiene la producción de los últimos 7 días agrupada por fecha.
 * La producción diaria se calcula como kg_produccion_calibrador + kg_mujeres_calibrador.
 */
export async function getProduccionUltimos7Dias(): Promise<DailyProduction[]> {
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const fromDate = sevenDaysAgo.toISOString().slice(0, 10);

  const { data, error } = await supabase
    .from("partes_diarios")
    .select(`date, ${KG_FIELDS.join(", ")}`)
    .gte("date", fromDate)
    .order("date", { ascending: true });

  if (error) {
    console.error("Error fetching producción últimos 7 días:", error);
    throw error;
  }

  // Agrupar por día (puede haber varios partes por día de distintos usuarios)
  const grouped = (data ?? []).reduce((acc: Record<string, any>, row: any) => {
    const dateKey = row.date;
    if (!acc[dateKey]) {
      acc[dateKey] = { date: dateKey, kg: 0, objetivo: 5200 };
    }
    acc[dateKey].kg += calcKgProducido(row);
    return acc;
  }, {});

  return Object.values(grouped)
    .map((row: any) => ({
      ...row,
      date: new Date(row.date).toLocaleDateString("es-ES", { weekday: "short" }),
    }))
    .sort((a, b) => {
      const order = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"];
      return order.indexOf(a.date.toLowerCase()) - order.indexOf(b.date.toLowerCase());
    });
}

/**
 * Devuelve el desglose de kg de hoy por categoría de proceso.
 * Sustituye al anterior agrupado por línea, ya que el nuevo esquema
 * no incluye el campo `linea`.
 *
 * Cada categoría de kg actúa como un "segmento de línea" en el dashboard.
 */
export async function getProduccionPorLinea(): Promise<LineProduction[]> {
  const today = new Date().toISOString().slice(0, 10);

  const { data, error } = await supabase
    .from("partes_diarios")
    .select(`${KG_FIELDS.join(", ")}`)
    .eq("date", today);

  if (error) {
    console.error("Error fetching producción por categoría:", error);
    throw error;
  }

  // Sumar todos los partes del día
  const totals: KgRow = {
    kg_industria_manual: 0,
    kg_reciclado_malla_z1: 0,
    kg_reciclado_malla_z2: 0,
    kg_inventario_sin_alta: 0,
    kg_podrido_bolsa_basura: 0,
    kg_produccion_calibrador: 0,
    kg_mujeres_calibrador: 0,
    kg_palets_brutos: 0,
    kg_podrido_calibrador_auto: 0,
    kg_inventario_anterior_sin_alta: 0,
  };

  for (const row of data ?? []) {
    for (const field of KG_FIELDS) {
      totals[field] += (row as any)[field] ?? 0;
    }
  }

  // Metas orientativas por categoría (ajusta según tus objetivos reales)
  const GOALS: Record<string, number> = {
    "Producción calibrador": 3000,
    "Mujeres calibrador": 800,
    "Industria manual": 600,
    "Reciclado malla Z1": 400,
    "Reciclado malla Z2": 400,
  };

  const categories: Array<{ key: keyof KgRow; label: string }> = [
    { key: "kg_produccion_calibrador", label: "Producción calibrador" },
    { key: "kg_mujeres_calibrador", label: "Mujeres calibrador" },
    { key: "kg_industria_manual", label: "Industria manual" },
    { key: "kg_reciclado_malla_z1", label: "Reciclado malla Z1" },
    { key: "kg_reciclado_malla_z2", label: "Reciclado malla Z2" },
    { key: "kg_podrido_bolsa_basura", label: "Podrido bolsa/basura" },
    { key: "kg_podrido_calibrador_auto", label: "Podrido calibrador auto" },
    { key: "kg_inventario_sin_alta", label: "Inventario sin alta" },
    { key: "kg_inventario_anterior_sin_alta", label: "Inventario anterior sin alta" },
    { key: "kg_palets_brutos", label: "Palets brutos (entrada)" },
  ];

  return categories.map(({ key, label }) => {
    const kg = totals[key];
    const goal = GOALS[label] ?? 500;
    return {
      line: label,
      kg,
      goal,
      status:
        kg >= goal
          ? "optimal"
          : kg >= goal * 0.6
          ? "warning"
          : "critical",
    } satisfies LineProduction;
  });
}

/**
 * Obtiene asistencia de hoy.
 * (Tabla `asistencia` sin cambios en el esquema.)
 */
export async function getAsistenciaHoy(): Promise<WorkerAttendance[]> {
  const today = new Date().toISOString().slice(0, 10);

  const { data, error } = await supabase
    .from("asistencia")
    .select("id, trabajador, linea, entrada, status")
    .eq("date", today)
    .order("trabajador", { ascending: true });

  if (error) {
    console.error("Error fetching asistencia:", error);
    throw error;
  }

  return (data ?? []).map((row: any) => ({
    id: row.id,
    name: row.trabajador,
    line: row.linea,
    status: (row.status || "absent") as "present" | "absent" | "late",
    entry_time: row.entrada ? row.entrada.slice(0, 5) : undefined, // HH:MM
  }));
}

/**
 * Obtiene producción total de hoy.
 * totalKg = suma de kg_produccion_calibrador + kg_mujeres_calibrador de todos los partes del día.
 * objetivo permanece como constante hasta que el esquema incluya un campo dedicado.
 */
export async function getProduccionHoy(): Promise<ProduccionResumen> {
  const today = new Date().toISOString().slice(0, 10);

  const { data, error } = await supabase
    .from("partes_diarios")
    .select("kg_produccion_calibrador, kg_mujeres_calibrador, kg_palets_brutos")
    .eq("date", today);

  if (error) {
    console.error("Error fetching producción hoy:", error);
    throw error;
  }

  const rows = data ?? [];
  const totalKg = rows.reduce((sum, r: any) => sum + calcKgProducido(r), 0);
  const objetivo = 5200; // sin campo objetivo_kg en el esquema actual
  const completion = Math.round((totalKg / objetivo) * 100);

  return { totalKg, objetivo, completion };
}

/**
 * Obtiene conteo de trabajadores presentes vs ausentes hoy.
 */
export async function getResumenAsistencia() {
  const today = new Date().toISOString().slice(0, 10);

  const { data, error } = await supabase
    .from("asistencia")
    .select("status")
    .eq("date", today);

  if (error) {
    console.error("Error fetching resumen asistencia:", error);
    throw error;
  }

  const rows = data ?? [];
  const present = rows.filter((r: any) => r.status === "present").length;
  const absent = rows.filter((r: any) => r.status === "absent").length;
  const late = rows.filter((r: any) => r.status === "late").length;
  const total = rows.length;

  return { present, absent, late, total };
}

/**
 * Kg producidos de media por trabajador presente hoy.
 */
export async function getRendimientoPorTrabajador(): Promise<number> {
  const [prodHoy, asistencia] = await Promise.all([
    getProduccionHoy(),
    getResumenAsistencia(),
  ]);

  return asistencia.present > 0
    ? Math.round(prodHoy.totalKg / asistencia.present)
    : 0;
}

/**
 * Obtiene el estado de los partes de hoy (Borrador / Validado / etc.).
 * Útil para mostrar alertas en el dashboard cuando quedan partes sin validar.
 */
export async function getEstadoPartesHoy(): Promise<
  Array<{ user_id: string; estado: string; fecha: string }>
> {
  const today = new Date().toISOString().slice(0, 10);

  const { data, error } = await supabase
    .from("partes_diarios")
    .select("user_id, estado, date")
    .eq("date", today);

  if (error) {
    console.error("Error fetching estado partes:", error);
    throw error;
  }

  return (data ?? []).map((r: any) => ({
    user_id: r.user_id,
    estado: r.estado,
    fecha: r.date,
  }));
}

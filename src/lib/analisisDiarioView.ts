import type { LoteResumen } from "@/hooks/useAnalisisDiario";
import { calcularTphOperativa } from "@/lib/velocidadOperativa";

export const SLOW_TPH_THRESHOLD = 12.5;

export interface ProductionEvolutionPoint {
  date: string;
  kg: number;
}

export function shouldShowProductionEvolution(points: readonly ProductionEvolutionPoint[]): boolean {
  return points.length > 1;
}

export interface DiaSubtotales {
  kg: number;
  avgTph: number | null;
  avgPesoFruta: number | null;
  nLotes: number;
  nLentes: number;
  totalHoras: number;
}

export interface WeekRange {
  start: string; // ISO date
  end: string;   // ISO date
  label: string;
}

export type Periodo = "esta_semana" | "anterior" | "ultimas_4" | "custom" | "todo";

export function groupLotesByDay(lotes: LoteResumen[]): Map<string, LoteResumen[]> {
  const map = new Map<string, LoteResumen[]>();
  for (const l of lotes) {
    const key = l.fecha;
    const arr = map.get(key) ?? [];
    arr.push(l);
    map.set(key, arr);
  }
  return map;
}

export function calcularTphPonderado(lotes: LoteResumen[]): number | null {
  const valid = lotes.filter((l) => l.toneladas_hora !== null && l.toneladas_hora > 0 && l.kg_peso_total > 0);
  if (valid.length === 0) return null;
  const totalKg = valid.reduce((s, l) => s + l.kg_peso_total, 0);
  if (totalKg === 0) return null;
  const weightedSum = valid.reduce((s, l) => s + (l.toneladas_hora! * l.kg_peso_total), 0);
  return weightedSum / totalKg;
}

export function calcularSubtotalesDia(lotes: LoteResumen[]): DiaSubtotales {
  const kg = lotes.reduce((s, l) => s + l.kg_peso_total, 0);
  // Usar producción real del parte si disponible, sino usar suma de lotes
  const produccionReal = lotes[0]?.produccion_real_part ?? kg;
  // T/h del día = producción real / horas de jornada del día (8 h; 7 h desde el 2 jul 2026).
  const avgTph = calcularTphOperativa(produccionReal, lotes[0]?.fecha ?? null);
  const lotesConPeso = lotes.filter((l) => l.peso_fruta_promedio_g !== null && l.peso_fruta_promedio_g > 0);
  const avgPesoFruta = lotesConPeso.length > 0
    ? lotesConPeso.reduce((s, l) => s + l.peso_fruta_promedio_g!, 0) / lotesConPeso.length
    : null;
  const nLotes = lotes.length;
  const nLentes = lotes.filter((l) => l.toneladas_hora !== null && l.toneladas_hora < SLOW_TPH_THRESHOLD).length;
  const totalHoras = lotes.reduce((s, l) => s + (l.duracion_min ?? 0), 0) / 60;
  return { kg, avgTph, avgPesoFruta, nLotes, nLentes, totalHoras };
}

export function detectarLotesLentos(lotes: LoteResumen[]): boolean {
  return lotes.some((l) => l.toneladas_hora !== null && l.toneladas_hora < SLOW_TPH_THRESHOLD);
}

function getMonday(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function toISODate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function buildWeekRange(periodo: Periodo, customDesde?: string, customHasta?: string): WeekRange {
  const now = new Date();
  if (periodo === "custom") {
    return {
      start: customDesde ?? toISODate(now),
      end: customHasta ?? toISODate(now),
      label: "Personalizado",
    };
  }
  if (periodo === "todo") {
    return { start: "2000-01-01", end: toISODate(now), label: "Todo el histórico" };
  }
  const monday = getMonday(now);
  if (periodo === "esta_semana") {
    const sunday = new Date(monday);
    sunday.setDate(sunday.getDate() + 6);
    return { start: toISODate(monday), end: toISODate(sunday), label: "Esta semana" };
  }
  if (periodo === "anterior") {
    const prevMonday = new Date(monday);
    prevMonday.setDate(prevMonday.getDate() - 7);
    const prevSunday = new Date(prevMonday);
    prevSunday.setDate(prevSunday.getDate() + 6);
    return { start: toISODate(prevMonday), end: toISODate(prevSunday), label: "Semana anterior" };
  }
  // ultimas_4
  const fourWeeksAgo = new Date(monday);
  fourWeeksAgo.setDate(fourWeeksAgo.getDate() - 21);
  const sunday = new Date(monday);
  sunday.setDate(sunday.getDate() + 6);
  return { start: toISODate(fourWeeksAgo), end: toISODate(sunday), label: "Ultimas 4 semanas" };
}

export function getDiaSemana(isoDate: string): string {
  const dias = ["Dom", "Lun", "Mar", "Mie", "Jue", "Vie", "Sab"];
  const d = new Date(isoDate + "T12:00:00");
  return dias[d.getDay()];
}

export function formatFechaCorta(isoDate: string): string {
  const [, m, d] = isoDate.split("-");
  return `${d}/${m}`;
}

export function getIntensityColor(kg: number, maxKg: number): string {
  if (maxKg === 0) return "bg-transparent";
  const ratio = kg / maxKg;
  if (ratio > 0.75) return "bg-primary/20";
  if (ratio > 0.5) return "bg-primary/12";
  if (ratio > 0.25) return "bg-primary/6";
  return "bg-transparent";
}

export function getTphBadge(tph: number | null): "success" | "warning" | "destructive" | null {
  if (tph === null) return null;
  if (tph >= 14.5) return "success";
  if (tph >= 12.5) return "warning";
  return "destructive";
}

function detectarTipoClasificacion(valor: string | null): string {
  if (!valor) return "Otro";
  const v = valor.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (v.includes("no_export") || v.includes("no export") || v.includes("no_exportac") || v.includes("no exportac")) return "No exportación";
  if (v.includes("no_comerc") || v.includes("no comerc") || v.includes("industria") || v.includes("ind")) return "No comercial";
  if (v.includes("export") || v.includes("ext")) return "Exportación";
  if (v.includes("mujer")) return "Mujeres";
  if (v.includes("mercado") || v.includes("nac") || v.includes("interior") || v.includes("int")) return "Mercado";
  return valor;
}

export interface MatrixData {
  data: Record<string, Record<string, number>>;
  days: string[];
  dimensions: string[];
  dayTotals: Record<string, number>;
  dimensionTotals: Record<string, number>;
  grandTotal: number;
}

export function buildClaseMatrix(
  _clases: Array<{ clase: string; kg_total: number }>,
  calibresRaw: Array<{ clase: string | null; grupo_destino: string | null; kg: number; part_id: string }>,
  partDateMap: Map<string, string>,
  weekDays: string[]
): MatrixData {
  const dayMap = new Map<string, Map<string, number>>();
  const dimSet = new Set<string>();

  for (const c of calibresRaw) {
    const day = partDateMap.get(c.part_id);
    if (!day || !weekDays.includes(day)) continue;
    const clase = c.clase ?? "Sin clase";
    const kg = Number(c.kg) || 0;
    dimSet.add(clase);

    const dimMap = dayMap.get(day) ?? new Map();
    dimMap.set(clase, (dimMap.get(clase) ?? 0) + kg);
    dayMap.set(day, dimMap);
  }

  const dimensions = Array.from(dimSet).sort();
  const data: Record<string, Record<string, number>> = {};
  const dayTotals: Record<string, number> = {};
  const dimensionTotals: Record<string, number> = {};
  let grandTotal = 0;

  for (const day of weekDays) {
    const dimMap = dayMap.get(day) ?? new Map();
    data[day] = {};
    let dayTotal = 0;
    for (const dim of dimensions) {
      const kg = dimMap.get(dim) ?? 0;
      data[day][dim] = kg;
      dimensionTotals[dim] = (dimensionTotals[dim] ?? 0) + kg;
      dayTotal += kg;
    }
    dayTotals[day] = dayTotal;
    grandTotal += dayTotal;
  }

  return { data, days: weekDays, dimensions, dayTotals, dimensionTotals, grandTotal };
}

export function buildGrupoMatrix(
  calibresRaw: Array<{ grupo_destino: string | null; kg: number; part_id: string }>,
  partDateMap: Map<string, string>,
  weekDays: string[]
): MatrixData {
  const dayMap = new Map<string, Map<string, number>>();
  const dimSet = new Set<string>();

  for (const c of calibresRaw) {
    const day = partDateMap.get(c.part_id);
    if (!day || !weekDays.includes(day)) continue;
    const grupo = detectarTipoClasificacion(c.grupo_destino);
    const kg = Number(c.kg) || 0;
    dimSet.add(grupo);

    const dimMap = dayMap.get(day) ?? new Map();
    dimMap.set(grupo, (dimMap.get(grupo) ?? 0) + kg);
    dayMap.set(day, dimMap);
  }

  const dimensions = Array.from(dimSet).sort();
  const data: Record<string, Record<string, number>> = {};
  const dayTotals: Record<string, number> = {};
  const dimensionTotals: Record<string, number> = {};
  let grandTotal = 0;

  for (const day of weekDays) {
    const dimMap = dayMap.get(day) ?? new Map();
    data[day] = {};
    let dayTotal = 0;
    for (const dim of dimensions) {
      const kg = dimMap.get(dim) ?? 0;
      data[day][dim] = kg;
      dimensionTotals[dim] = (dimensionTotals[dim] ?? 0) + kg;
      dayTotal += kg;
    }
    dayTotals[day] = dayTotal;
    grandTotal += dayTotal;
  }

  return { data, days: weekDays, dimensions, dayTotals, dimensionTotals, grandTotal };
}

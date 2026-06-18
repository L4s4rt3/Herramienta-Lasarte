import type { LoteResumen } from "@/hooks/useAnalisisDiario";

export const SLOW_TPH_THRESHOLD = 12;

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
  nLotes: number;
  nLentes: number;
}

export interface WeekRange {
  start: string; // ISO date
  end: string;   // ISO date
  label: string;
}

export type Periodo = "esta_semana" | "anterior" | "ultimas_4" | "custom";

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
  const avgTph = calcularTphPonderado(lotes);
  const nLotes = lotes.length;
  const nLentes = lotes.filter((l) => l.toneladas_hora !== null && l.toneladas_hora < SLOW_TPH_THRESHOLD).length;
  return { kg, avgTph, nLotes, nLentes };
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
  if (tph >= 16) return "success";
  if (tph >= 12) return "warning";
  return "destructive";
}
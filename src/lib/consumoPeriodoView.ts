import type { ConsumoPeriodoRow } from "@/lib/consumosFisicos";
import { toISODateLocal } from "@/lib/format";

/**
 * Vista de periodo (Semana | Mes | Campaña) para la pagina de Consumos.
 * Construida encima de `dailyRows` que ya calcula `useConsumosFisicos` (reparto de
 * facturas, proxy de palets, etc.) - aqui solo se agregan esos dias por rango de fechas,
 * sin reimplementar el reparto fisico.
 */

export type ConsumoPeriodoTipo = "semana" | "mes" | "campana";

export interface PeriodoRange {
  tipo: ConsumoPeriodoTipo;
  start: string; // ISO date, inclusive
  end: string;   // ISO date, inclusive
  label: string;
  detail: string;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function parseISO(date: string): Date {
  return new Date(`${date}T12:00:00`);
}

function toISO(date: Date): string {
  return toISODateLocal(date);
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function startOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function endOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

/** Numero de semana ISO-8601 (1-53). */
export function isoWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d.getTime() - yearStart.getTime()) / MS_PER_DAY) + 1) / 7);
}

const MES_LABEL = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function formatDayMonth(date: Date): string {
  return `${date.getDate()} ${MES_LABEL[date.getMonth()].slice(0, 3)}`;
}

/** Campaña citricola: septiembre -> agosto. Devuelve el año de inicio de campaña para una fecha dada. */
export function campanaStartYear(date: Date): number {
  const month = date.getMonth() + 1; // 1-12
  return month >= 9 ? date.getFullYear() : date.getFullYear() - 1;
}

export function campanaLabel(startYear: number): string {
  const shortStart = String(startYear).slice(2);
  const shortEnd = String(startYear + 1).slice(2);
  return `Campaña ${shortStart}/${shortEnd}`;
}

/** Construye el rango [start,end] para un tipo de periodo, desplazado `offset` unidades desde hoy. */
export function buildPeriodoRange(tipo: ConsumoPeriodoTipo, offset: number, today: Date = new Date()): PeriodoRange {
  if (tipo === "semana") {
    const base = addDays(startOfWeek(today), offset * 7);
    const end = addDays(base, 6);
    const weekNum = isoWeekNumber(base);
    return {
      tipo,
      start: toISO(base),
      end: toISO(end),
      label: `Semana ${weekNum}`,
      detail: `${formatDayMonth(base)} – ${formatDayMonth(end)}`,
    };
  }

  if (tipo === "mes") {
    const base = new Date(today.getFullYear(), today.getMonth() + offset, 1);
    const start = startOfMonth(base);
    const end = endOfMonth(base);
    return {
      tipo,
      start: toISO(start),
      end: toISO(end),
      label: capitalize(`${MES_LABEL[base.getMonth()]} ${base.getFullYear()}`),
      detail: `${formatDayMonth(start)} – ${formatDayMonth(end)}`,
    };
  }

  // campana
  const startYear = campanaStartYear(today) + offset;
  const start = new Date(startYear, 8, 1); // 1 sep
  const end = new Date(startYear + 1, 7, 31); // 31 ago
  return {
    tipo,
    start: toISO(start),
    end: toISO(end),
    label: campanaLabel(startYear),
    detail: `1 sep ${startYear} – 31 ago ${startYear + 1}`,
  };
}

/** Rango previo del mismo tamaño/tipo, para comparativas (delta). */
export function buildPreviousPeriodoRange(tipo: ConsumoPeriodoTipo, offset: number, today: Date = new Date()): PeriodoRange {
  return buildPeriodoRange(tipo, offset - 1, today);
}

export interface MateriaTotales {
  aguaL: number;
  electricidadKwh: number;
  gasoilL: number;
  quimicosL: number;
  kgBase: number;
}

/** Filtra filas diarias dentro de [start, end] inclusive. */
export function filterDailyRowsInRange(dailyRows: ConsumoPeriodoRow[], start: string, end: string): ConsumoPeriodoRow[] {
  return dailyRows.filter((row) => row.periodo >= start && row.periodo <= end);
}

export function sumMateriaTotales(rows: ConsumoPeriodoRow[]): MateriaTotales {
  return rows.reduce(
    (acc, row) => {
      acc.aguaL += row.aguaL;
      acc.electricidadKwh += row.electricidadKwh;
      acc.gasoilL += row.gasoilL;
      acc.quimicosL += row.quimicosL;
      acc.kgBase += row.kgBase;
      return acc;
    },
    { aguaL: 0, electricidadKwh: 0, gasoilL: 0, quimicosL: 0, kgBase: 0 },
  );
}

export function deltaPct(current: number, previous: number): number | null {
  if (!Number.isFinite(previous) || previous <= 0) return null;
  if (!Number.isFinite(current)) return null;
  return ((current - previous) / previous) * 100;
}

export interface SemanaGroup {
  id: string;
  label: string;
  detail: string;
  rows: ConsumoPeriodoRow[];
}

/** Agrupa filas diarias en semanas ISO para la vista Mes/Campaña con muchos dias. */
export function groupDailyRowsByWeek(rows: ConsumoPeriodoRow[]): SemanaGroup[] {
  const groups = new Map<string, ConsumoPeriodoRow[]>();

  rows.forEach((row) => {
    const date = parseISO(row.periodo);
    const monday = startOfWeek(date);
    const key = toISO(monday);
    const arr = groups.get(key) ?? [];
    arr.push(row);
    groups.set(key, arr);
  });

  return Array.from(groups.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([mondayIso, groupRows]) => {
      const monday = parseISO(mondayIso);
      const sunday = addDays(monday, 6);
      return {
        id: mondayIso,
        label: `Semana ${isoWeekNumber(monday)}`,
        detail: `${formatDayMonth(monday)} – ${formatDayMonth(sunday)}`,
        rows: groupRows,
      };
    });
}

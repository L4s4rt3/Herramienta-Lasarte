/**
 * Utilidades de semana ISO (lunes a domingo), compartidas por el Dashboard
 * de Producción (src/pages/Dashboard.tsx) y el Panel de dirección
 * (src/hooks/useDireccionDashboard.ts). Antes vivían duplicadas carácter a
 * carácter en ambos archivos; aquí hay una única versión tipada de cada una.
 *
 * Convención de "semana ISO" usada en todo el proyecto:
 * - La semana empieza en LUNES (no domingo, que es lo que da `Date.getDay()`
 *   de forma nativa en JS) y termina en domingo.
 * - El número de semana sigue ISO-8601: se calcula mirando el JUEVES de esa
 *   semana y contando cuántas semanas completas han pasado desde el 1 de
 *   enero del año de ese jueves. Por eso el número de semana puede "tirar"
 *   hacia el año siguiente o anterior al del lunes (p. ej. el lunes 29 de
 *   diciembre puede pertenecer a la semana 1 del año siguiente), y por eso
 *   puede existir una semana 53 en años en los que el jueves de la última
 *   semana cae todavía dentro de ese año.
 * - `getWeekStart` fija la hora a las 12:00 al calcular el lunes de la
 *   semana, para no arrastrar problemas de cambio de horario (DST) al sumar
 *   o restar días con `addDays`.
 */

/** Formatea una fecha como YYYY-MM-DD usando los componentes locales (no UTC). */
export function toIsoDate(date: Date): string {
  // Componentes locales, no UTC (en España toISOString adelantaría el día de madrugada).
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** Devuelve una nueva fecha desplazada `days` días (puede ser negativo). */
export function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

/** Número de semana ISO-8601 (1-53) de la fecha dada. */
export function getIsoWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

/** Lunes (a las 12:00) de la semana ISO a la que pertenece `date`. */
export function getWeekStart(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay() === 0 ? 6 : d.getDay() - 1;
  d.setDate(d.getDate() - day);
  d.setHours(12, 0, 0, 0);
  return d;
}

export interface SemanaIso {
  start: string;
  end: string;
  weekNumber: number;
  label: string;
  /** Rango legible, p. ej. "1 jul - 7 jul". */
  rangeLabel: string;
}

/**
 * Construye las `count` semanas ISO más recientes hasta la que contiene
 * `anchor` (incluida, como última del array).
 */
export function buildRecentWeeks(count: number, anchor: Date): SemanaIso[] {
  const currentStart = getWeekStart(anchor);
  return Array.from({ length: count }, (_, index) => {
    const start = addDays(currentStart, (index - count + 1) * 7);
    const end = addDays(start, 6);
    const weekNumber = getIsoWeekNumber(start);
    return {
      start: toIsoDate(start),
      end: toIsoDate(end),
      weekNumber,
      label: `S${weekNumber}`,
      rangeLabel: `${start.toLocaleDateString("es-ES", { day: "numeric", month: "short" })} - ${end.toLocaleDateString("es-ES", { day: "numeric", month: "short" })}`,
    };
  });
}

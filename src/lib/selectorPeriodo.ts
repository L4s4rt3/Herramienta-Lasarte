// src/lib/selectorPeriodo.ts
// Lógica PURA de navegación de periodo para el componente único
// `SelectorPeriodo` (src/components/SelectorPeriodo.tsx). FASE 1 del
// rediseño del lenguaje temporal: antes había 7 implementaciones distintas
// de selector de tiempo (WeekSelector, chevrons ad-hoc en Dashboard /
// MercadonaProduccion / Mercadona / CalidadJornada / Asistencia,
// EconomicoPanel, ConsumoPeriodoSelector...) para 4 necesidades reales:
// navegar por día, semana, mes o campaña, más un rango libre.
//
// No reinventa cálculos de fechas: para semana/mes/campaña delega en
// `buildPeriodoRange` de consumoPeriodoView.ts (que ya resuelve lunes-domingo,
// mes natural y campaña cítricola sep-ago), y usa `isoWeekNumber` /
// `campanaStartYear` / `campanaLabel` de ese mismo módulo para las etiquetas.
// Aquí solo se añaden los modos "dia" y "rango" (que buildPeriodoRange no
// cubre) y el formateo de la etiqueta legible combinada.
import { toISODateLocal } from "@/lib/format";
import {
  buildPeriodoRange,
  campanaLabel,
  campanaStartYear,
  isoWeekNumber,
  type ConsumoPeriodoTipo,
} from "@/lib/consumoPeriodoView";

export type PeriodoModo = "dia" | "semana" | "mes" | "campana" | "rango";

/** Valor controlado del selector: rango [desde, hasta] ISO inclusive + granularidad activa. */
export interface PeriodoValue {
  modo: PeriodoModo;
  desde: string; // "YYYY-MM-DD"
  hasta: string; // "YYYY-MM-DD"
}

export interface PeriodoInfo extends PeriodoValue {
  /** Etiqueta legible del periodo, p.ej. "Semana 29 · 13–19 jul". */
  label: string;
}

function parseISO(iso: string): Date {
  return new Date(`${iso}T12:00:00`);
}

function toISO(date: Date): string {
  return toISODateLocal(date);
}

function addDaysLocal(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function diffDaysLocal(start: Date, end: Date): number {
  // Ambas fechas ancladas al mediodía local (parseISO), por lo que no hay
  // desfase de DST que redondear: la resta en días es exacta.
  return Math.round((end.getTime() - start.getTime()) / 86400000);
}

const DIA_CORTO = ["dom", "lun", "mar", "mie", "jue", "vie", "sab"];
const MES_CORTO = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const MES_LARGO = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

function formatDiaCorto(date: Date): string {
  return `${DIA_CORTO[date.getDay()]} ${date.getDate()} ${MES_CORTO[date.getMonth()]}`;
}

/**
 * "13–19 jul" (mismo mes) o "28 jun – 4 jul" (cruza de mes, incluido cambio de
 * año calendario: nunca se muestra el año, igual que `formatDayMonth` de
 * consumoPeriodoView.ts — el año del periodo ya es evidente por contexto en la
 * página que lo muestra).
 */
function formatRangoCorto(start: Date, end: Date): string {
  const sameMonth = start.getFullYear() === end.getFullYear() && start.getMonth() === end.getMonth();
  if (sameMonth) {
    return `${start.getDate()}–${end.getDate()} ${MES_CORTO[end.getMonth()]}`;
  }
  return `${start.getDate()} ${MES_CORTO[start.getMonth()]} – ${end.getDate()} ${MES_CORTO[end.getMonth()]}`;
}

/** Etiqueta legible del periodo. Única fuente de formateo: usada tanto al construir un periodo como al navegarlo. */
export function formatPeriodoLabel(value: PeriodoValue): string {
  const desde = parseISO(value.desde);
  const hasta = parseISO(value.hasta);
  switch (value.modo) {
    case "dia":
      return formatDiaCorto(desde);
    case "semana":
      return `Semana ${isoWeekNumber(desde)} · ${formatRangoCorto(desde, hasta)}`;
    case "mes":
      return `${MES_LARGO[desde.getMonth()]} ${desde.getFullYear()}`;
    case "campana":
      return campanaLabel(campanaStartYear(desde));
    case "rango":
      return formatRangoCorto(desde, hasta);
    default:
      return "";
  }
}

/** [desde, hasta] del periodo de tipo `modo` que contiene `ancla`, sin etiqueta. */
function computeRango(modo: PeriodoModo, ancla: Date): PeriodoValue {
  if (modo === "dia" || modo === "rango") {
    const iso = toISO(ancla);
    return { modo, desde: iso, hasta: iso };
  }
  // "semana" | "mes" | "campana": delega en buildPeriodoRange (consumoPeriodoView.ts).
  const tipo: ConsumoPeriodoTipo = modo;
  const r = buildPeriodoRange(tipo, 0, ancla);
  return { modo, desde: r.start, hasta: r.end };
}

/** Periodo de tipo `modo` que contiene la fecha ISO dada (p.ej. al saltar con el GlassDatePicker). */
export function periodoDeFecha(modo: PeriodoModo, fechaIso: string): PeriodoInfo {
  const value = computeRango(modo, parseISO(fechaIso));
  return { ...value, label: formatPeriodoLabel(value) };
}

/** Periodo de tipo `modo` que contiene "hoy" (o la fecha `hoy` dada, para tests). */
export function hoyPeriodo(modo: PeriodoModo, hoy: Date = new Date()): PeriodoInfo {
  return periodoDeFecha(modo, toISO(hoy));
}

/**
 * Rango libre [desde, hasta] explícito (modo "rango"): normaliza el orden si
 * el usuario elige primero la fecha "hasta".
 */
export function rangoPersonalizado(desde: string, hasta: string): PeriodoInfo {
  const [d, h] = desde <= hasta ? [desde, hasta] : [hasta, desde];
  const value: PeriodoValue = { modo: "rango", desde: d, hasta: h };
  return { ...value, label: formatPeriodoLabel(value) };
}

/**
 * Avanza (`dir` = 1) o retrocede (`dir` = -1) una unidad de la granularidad
 * activa: un día, una semana ISO, un mes natural, una campaña (sep-ago), o
 * — en modo "rango" — la ventana completa desplazada por su propia longitud.
 */
export function avanzarPeriodo(value: PeriodoValue, dir: -1 | 1): PeriodoInfo {
  let next: PeriodoValue;
  if (value.modo === "dia") {
    const d = addDaysLocal(parseISO(value.desde), dir);
    next = { modo: "dia", desde: toISO(d), hasta: toISO(d) };
  } else if (value.modo === "rango") {
    const start = parseISO(value.desde);
    const end = parseISO(value.hasta);
    const span = diffDaysLocal(start, end) + 1; // longitud inclusive de la ventana
    next = {
      modo: "rango",
      desde: toISO(addDaysLocal(start, dir * span)),
      hasta: toISO(addDaysLocal(end, dir * span)),
    };
  } else {
    // "semana" | "mes" | "campana": `value.desde` es siempre el inicio canónico
    // del periodo (lunes / día 1 / 1-sep), así que usarlo como ancla con
    // offset=dir en buildPeriodoRange desplaza exactamente una unidad.
    const tipo: ConsumoPeriodoTipo = value.modo;
    const r = buildPeriodoRange(tipo, dir, parseISO(value.desde));
    next = { modo: value.modo, desde: r.start, hasta: r.end };
  }
  return { ...next, label: formatPeriodoLabel(next) };
}

/** ¿`value` es exactamente el periodo "actual" (el que contiene `hoy`) de su propia granularidad? */
export function esPeriodoActual(value: PeriodoValue, hoy: Date = new Date()): boolean {
  const actual = hoyPeriodo(value.modo, hoy);
  return value.desde === actual.desde && value.hasta === actual.hasta;
}

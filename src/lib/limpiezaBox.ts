/**
 * limpiezaBox — lógica pura de la zona "Limpieza de box" (partes diarios del
 * grupo de limpieza de boxes, src/pages/LimpiezaBox.tsx + useLimpiezaBox.ts).
 *
 * CONVERSIÓN PIES ↔ BOX: el dato de campo llega unas veces en PIES y otras en
 * BOX. La equivalencia del dueño es 48 pies = 144 box, es decir 1 pie = 3 box
 * (PIES_A_BOX). El formulario permite meter cualquiera de las dos unidades y
 * guarda SIEMPRE ambos valores (pies solo si fue la unidad original).
 *
 * Este módulo no toca Supabase: solo conversión y agregación de resúmenes, para
 * poder testearlo sin red (ver limpiezaBox.test.ts).
 */
import { getIsoWeekNumber, getWeekStart, toIsoDate } from "@/lib/isoWeek";

/** 48 pies = 144 box → 1 pie = 3 box. */
export const PIES_A_BOX = 3;

/**
 * Box equivalentes a `pies` (redondeado a entero: un box no se limpia a
 * medias). Valores no numéricos o negativos devuelven 0.
 */
export function piesABox(pies: number): number {
  const n = Number(pies);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n * PIES_A_BOX);
}

/**
 * Pies equivalentes a `box` (redondeado a 2 decimales: 1 box = 1/3 de pie,
 * que no es exacto en decimal). Valores no numéricos o negativos devuelven 0.
 */
export function boxAPies(box: number): number {
  const n = Number(box);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round((n / PIES_A_BOX) * 100) / 100;
}

/** Lo mínimo que necesita la agregación de un parte de limpieza. */
export interface ParteLimpiezaResumen {
  /** Fecha "YYYY-MM-DD". */
  fecha: string;
  /** Box limpiados en el parte (ya convertidos si se metieron en pies). */
  box: number;
  /** Suma de horas de todos los trabajadores del parte. */
  horas: number;
}

export interface ResumenLimpieza {
  partes: number;
  box: number;
  horas: number;
  /** Box por hora trabajada, o null si no hay horas (evita dividir por 0). */
  boxPorHora: number | null;
}

/** Suma horas de una lista de trabajadores de parte (ignora valores no numéricos). */
export function sumaHoras(trabajadores: Array<{ horas: number | string | null | undefined }>): number {
  return trabajadores.reduce((s, t) => {
    const h = Number(t.horas);
    return s + (Number.isFinite(h) && h > 0 ? h : 0);
  }, 0);
}

/**
 * Resumen agregado de los partes cuya fecha cae en [desde, hasta] (ambos
 * inclusive, formato "YYYY-MM-DD"; la comparación lexicográfica es correcta
 * para ese formato). Sin `desde`/`hasta` agrega todos los partes recibidos.
 */
export function resumenLimpiezaEnRango(
  partes: ParteLimpiezaResumen[],
  desde?: string,
  hasta?: string,
): ResumenLimpieza {
  let box = 0;
  let horas = 0;
  let n = 0;
  for (const p of partes) {
    if (desde && p.fecha < desde) continue;
    if (hasta && p.fecha > hasta) continue;
    box += Number(p.box) || 0;
    horas += Number(p.horas) || 0;
    n += 1;
  }
  return {
    partes: n,
    box,
    horas,
    boxPorHora: horas > 0 ? box / horas : null,
  };
}

// ─── Coste de personal de limpieza (FASE 3 del rediseño, decisión del dueño) ─
// DESGLOSE informativo del coste de personal ya contado en Económico → Costes
// (por asistencia): estas horas NO se suman a ningún total, solo se muestran
// aparte para que el dueño vea cuánto de ese coste ya contado corresponde al
// grupo de limpieza de boxes. Trabajador de plantilla (trabajador_id resuelto
// con coste_hora numérico) → cuenta en horas Y en €; nombre libre o trabajador
// sin coste_hora asignado → cuenta solo en horas (el € de esa persona no se
// puede estimar, se deja fuera en vez de asumir un coste inventado).

export interface LimpiezaParteTrabajadorInput {
  trabajador_id: string | null;
  nombre: string;
  horas: number | string | null | undefined;
}

export interface LimpiezaCostePeriodo {
  /** Horas de TODOS los trabajadores del periodo (plantilla + nombres libres). */
  horasTotal: number;
  /** De horasTotal, las de trabajadores de plantilla con coste_hora asignado. */
  horasConCoste: number;
  /** De horasTotal, las que no se pueden valorar (nombre libre o sin coste_hora). */
  horasSinCoste: number;
  /** Σ horas × coste_hora, solo de quien tiene coste_hora asignado. */
  eurTotal: number;
  /** Nº de nombres distintos sin coste_hora resuelto (para el aviso de la UI). */
  nPersonasSinCoste: number;
}

/**
 * Agrega las filas de `limpieza_parte_trabajadores` de un periodo (ya
 * filtradas por fecha por el llamador) valorando cada una con el coste_hora
 * de `costeHoraPorTrabajador` (id de la tabla `trabajadores` → coste_hora,
 * `null`/ausente = sin coste asignado).
 */
export function agregarLimpiezaCoste(
  trabajadoresParte: readonly LimpiezaParteTrabajadorInput[],
  costeHoraPorTrabajador: ReadonlyMap<string, number | null>,
): LimpiezaCostePeriodo {
  let horasTotal = 0;
  let horasConCoste = 0;
  let horasSinCoste = 0;
  let eurTotal = 0;
  const sinCosteNombres = new Set<string>();

  for (const t of trabajadoresParte) {
    const horas = Number(t.horas);
    if (!Number.isFinite(horas) || horas <= 0) continue;
    horasTotal += horas;

    const costeHora = t.trabajador_id ? costeHoraPorTrabajador.get(t.trabajador_id) ?? null : null;
    if (costeHora != null && Number.isFinite(costeHora)) {
      horasConCoste += horas;
      eurTotal += horas * costeHora;
    } else {
      horasSinCoste += horas;
      sinCosteNombres.add(t.nombre);
    }
  }

  return { horasTotal, horasConCoste, horasSinCoste, eurTotal, nPersonasSinCoste: sinCosteNombres.size };
}

export interface ResumenSemanaLimpieza extends ResumenLimpieza {
  /** Lunes de la semana ISO, "YYYY-MM-DD" (clave estable de agrupación). */
  semanaInicio: string;
  /** Número de semana ISO-8601 (1-53). */
  weekNumber: number;
  /** Etiqueta corta "S28". */
  label: string;
}

/**
 * Resumen por semana ISO (lunes a domingo, convención de src/lib/isoWeek.ts),
 * ordenado de la semana más reciente a la más antigua.
 */
export function resumenLimpiezaPorSemanaIso(partes: ParteLimpiezaResumen[]): ResumenSemanaLimpieza[] {
  const porSemana = new Map<string, ParteLimpiezaResumen[]>();
  for (const p of partes) {
    const fecha = new Date(`${p.fecha}T12:00:00`);
    if (Number.isNaN(fecha.getTime())) continue;
    const inicio = toIsoDate(getWeekStart(fecha));
    const arr = porSemana.get(inicio) ?? [];
    arr.push(p);
    porSemana.set(inicio, arr);
  }
  return Array.from(porSemana.entries())
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([semanaInicio, partesSemana]) => {
      const weekNumber = getIsoWeekNumber(new Date(`${semanaInicio}T12:00:00`));
      return {
        semanaInicio,
        weekNumber,
        label: `S${weekNumber}`,
        ...resumenLimpiezaEnRango(partesSemana),
      };
    });
}

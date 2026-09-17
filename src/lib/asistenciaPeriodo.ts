// src/lib/asistenciaPeriodo.ts
// Lógica PURA de "asistencia por periodos" (17-09-2026).
//
// POR QUÉ EXISTE. La página de asistencia solo sabía mirar UNA semana. Dos
// problemas prácticos para RRHH:
//   1. Para saber desde cuándo hay fichajes había que ir pasando semana a
//      semana hacia atrás a ciegas.
//   2. No se podía sacar un Excel de un mes, de una campaña, ni de un rango
//      cualquiera: solo de la semana que estuvieras mirando.
//
// Los cálculos de asistencia (buildFaltasSemanales, calcularKgPersonaSemanal,
// calcularRendimientoGrupoSemanal…) ya recorren `periodo.days`, sea cual sea
// su longitud: NO hacía falta duplicarlos para el periodo, solo darles una
// lista de días más larga. Lo que sí faltaba —y es lo que vive aquí— es:
//   · enumerar los días de un rango,
//   · leer la cobertura (qué días tienen datos y cuáles no) y resumirla,
//   · el porcentaje de asistencia por trabajador, que en una semana se lee de
//     un vistazo en la rejilla de días pero en una campaña no.
//
// Todo son funciones puras sin Supabase ni React: la carga vive en
// src/hooks/useAsistencia.ts y la pintura en src/pages/Asistencia.tsx.
import { getDiasLaborables } from "./asistenciaSemanal";
import type { FaltasSemanalesRow } from "./asistenciaSemanal";

/** Un día con registros de asistencia, tal cual lo da la vista `asistencia_cobertura_dia`. */
export interface DiaCoberturaRow {
  fecha: string;
  registros: number;
  presentes: number;
  ausentes: number;
}

export interface CoberturaAsistencia {
  /** Primer y último día CON registros de todo el histórico (null si no hay ninguno). */
  primera: string | null;
  ultima: string | null;
  /** Días con algún registro (incluye domingos volcados con todo el mundo ausente). */
  diasConRegistros: number;
  /** Días con al menos una presencia: los días que de verdad se trabajó. */
  diasConPresencia: number;
  /** Índice fecha → fila, para preguntar por un día suelto sin recorrer el array. */
  porFecha: Map<string, DiaCoberturaRow>;
}

export interface CoberturaPeriodo {
  /**
   * Días laborables de la VENTANA (ver ventanaDesde/ventanaHasta), no del
   * periodo entero: domingo fuera, sábado según el interruptor.
   */
  laborables: number;
  /** De esos laborables, los que tienen algún registro volcado. */
  conRegistros: number;
  /** De esos laborables, los que tienen alguna presencia. */
  conPresencia: number;
  /** Laborables SIN ningún registro: o no se trabajó, o el fichaje no se ha volcado. */
  sinDatos: string[];
  /** Primer y último día CON registros dentro del periodo. */
  primera: string | null;
  ultima: string | null;
  /**
   * El tramo del periodo en el que TIENE SENTIDO preguntarse si hay datos:
   * desde el primer día del histórico (antes no había sistema) hasta hoy
   * (después aún no ha pasado). null si el periodo cae entero fuera.
   */
  ventanaDesde: string | null;
  ventanaHasta: string | null;
  /** true si la ventana recorta el periodo por algún extremo (para decirlo en pantalla). */
  recortada: boolean;
}

export interface MesCobertura {
  /** "2026-05": clave de mes, no visible. */
  mes: string;
  /** "may 2026". */
  label: string;
  /** Día 1 del mes, para saltar a él con el selector de periodo. */
  primerDia: string;
  diasConRegistros: number;
  diasConPresencia: number;
  /** Días laborables del mes acotados al histórico real (no se cuenta el futuro). */
  laborables: number;
}

const MES_CORTO = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

function parseISO(iso: string): Date {
  // Mediodía local: mismo criterio que el resto de la app, así ningún cambio
  // de hora mueve una fecha al día anterior.
  return new Date(`${iso}T12:00:00`);
}

function toISO(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Todos los días ISO entre `desde` y `hasta`, ambos incluidos. Si el rango
 * viene del revés se devuelve vacío (el selector ya lo normaliza, pero un
 * rango imposible no debe inventarse días).
 */
export function enumerarDias(desde: string, hasta: string): string[] {
  if (!desde || !hasta || desde > hasta) return [];
  const dias: string[] = [];
  const fin = parseISO(hasta);
  for (let d = parseISO(desde); d <= fin; d.setDate(d.getDate() + 1)) {
    dias.push(toISO(d));
  }
  return dias;
}

/** Número de días del rango, ambos incluidos (0 si el rango es imposible). */
export function contarDias(desde: string, hasta: string): number {
  if (!desde || !hasta || desde > hasta) return 0;
  return Math.round((parseISO(hasta).getTime() - parseISO(desde).getTime()) / 86400000) + 1;
}

/** Resume las filas de la vista de cobertura: extremos, totales e índice por fecha. */
export function resumirCobertura(filas: DiaCoberturaRow[]): CoberturaAsistencia {
  const porFecha = new Map<string, DiaCoberturaRow>();
  let primera: string | null = null;
  let ultima: string | null = null;
  let diasConPresencia = 0;

  for (const fila of filas) {
    if (!fila?.fecha) continue;
    porFecha.set(fila.fecha, fila);
    if (primera === null || fila.fecha < primera) primera = fila.fecha;
    if (ultima === null || fila.fecha > ultima) ultima = fila.fecha;
    if (fila.presentes > 0) diasConPresencia++;
  }

  return { primera, ultima, diasConRegistros: porFecha.size, diasConPresencia, porFecha };
}

/**
 * Qué parte del periodo elegido tiene datos. `sinDatos` son los días
 * LABORABLES sin ningún registro: es la lista que contesta "¿me falta por
 * volcar el fichaje de algún día?" sin pasar semana a semana.
 *
 * OJO CON LOS DOS EXTREMOS, o el aviso miente:
 *   · antes del primer día del histórico no es que falte nada, es que no
 *     había sistema (la asistencia arranca el 18-05-2026);
 *   · después de hoy tampoco falta nada: esos días no han pasado.
 * Por eso se cuenta solo dentro de la VENTANA — la parte del periodo entre el
 * arranque del histórico y hoy — y se avisa cuando esa ventana recorta.
 */
export function coberturaDelPeriodo(
  cobertura: CoberturaAsistencia,
  dias: string[],
  incluirSabado: boolean,
  hoy: string = toISO(new Date()),
): CoberturaPeriodo {
  // Los extremos se buscan sobre TODOS los días del periodo, no solo los
  // laborables: si lo único volcado de una semana es el sábado, el periodo
  // igualmente empieza y acaba ahí.
  let primera: string | null = null;
  let ultima: string | null = null;
  for (const dia of dias) {
    if (!cobertura.porFecha.has(dia)) continue;
    if (primera === null) primera = dia;
    ultima = dia;
  }

  const periodoDesde = dias[0] ?? null;
  const periodoHasta = dias[dias.length - 1] ?? null;
  const arranque = cobertura.primera;
  const ventanaDesde = periodoDesde && arranque ? (periodoDesde > arranque ? periodoDesde : arranque) : null;
  const ventanaHasta = periodoHasta ? (periodoHasta < hoy ? periodoHasta : hoy) : null;
  const vacia = !ventanaDesde || !ventanaHasta || ventanaDesde > ventanaHasta;

  const laborables = vacia
    ? []
    : getDiasLaborables(dias, incluirSabado).filter((dia) => dia >= ventanaDesde! && dia <= ventanaHasta!);
  const sinDatos: string[] = [];
  let conRegistros = 0;
  let conPresencia = 0;

  for (const dia of laborables) {
    const fila = cobertura.porFecha.get(dia);
    if (!fila) {
      sinDatos.push(dia);
      continue;
    }
    conRegistros++;
    if (fila.presentes > 0) conPresencia++;
  }

  return {
    laborables: laborables.length,
    conRegistros,
    conPresencia,
    sinDatos,
    primera,
    ultima,
    ventanaDesde: vacia ? null : ventanaDesde,
    ventanaHasta: vacia ? null : ventanaHasta,
    recortada: !vacia && (ventanaDesde !== periodoDesde || ventanaHasta !== periodoHasta),
  };
}

/**
 * Cobertura agrupada por mes, del primer al último día con datos. Es el
 * "mapa" que enseña de un vistazo dónde hay información y dónde no, y desde
 * el que se salta a un mes concreto sin navegar semana a semana.
 */
export function mesesDeCobertura(cobertura: CoberturaAsistencia, incluirSabado: boolean): MesCobertura[] {
  if (!cobertura.primera || !cobertura.ultima) return [];

  const meses = new Map<string, MesCobertura>();
  // Los laborables se cuentan solo dentro del histórico real (de la primera a
  // la última fecha con datos): un mes a medias no debe parecer incompleto
  // por los días que aún no han llegado.
  for (const dia of getDiasLaborables(enumerarDias(cobertura.primera, cobertura.ultima), incluirSabado)) {
    const mes = dia.slice(0, 7);
    let fila = meses.get(mes);
    if (!fila) {
      const d = parseISO(dia);
      fila = {
        mes,
        label: `${MES_CORTO[d.getMonth()]} ${d.getFullYear()}`,
        primerDia: `${mes}-01`,
        diasConRegistros: 0,
        diasConPresencia: 0,
        laborables: 0,
      };
      meses.set(mes, fila);
    }
    fila.laborables++;
    const registro = cobertura.porFecha.get(dia);
    if (registro) {
      fila.diasConRegistros++;
      if (registro.presentes > 0) fila.diasConPresencia++;
    }
  }

  return Array.from(meses.values()).sort((a, b) => a.mes.localeCompare(b.mes));
}

/**
 * Cuántas marcas hay volcadas cada día y cuántas son presencias, a partir de
 * la asistencia ya cargada (trabajador → sus días). Es lo mismo que contesta
 * la vista `asistencia_cobertura_dia` para todo el histórico, pero calculado
 * sobre el periodo que ya se tiene en la mano: así el Excel no vuelve a
 * preguntar a la base de datos lo que ya se trajo.
 */
export function contarMarcasPorDia(
  asistencia: Record<string, { date: string; presente: boolean | null }[]>,
): Map<string, { registros: number; presentes: number }> {
  const porDia = new Map<string, { registros: number; presentes: number }>();
  for (const registros of Object.values(asistencia)) {
    for (const r of registros) {
      const acc = porDia.get(r.date) ?? { registros: 0, presentes: 0 };
      acc.registros++;
      if (r.presente === true) acc.presentes++;
      porDia.set(r.date, acc);
    }
  }
  return porDia;
}

export interface ResumenTrabajadorPeriodo extends FaltasSemanalesRow {
  /**
   * Presentes / (presentes + ausentes + bajas) × 100. Los días "sin marcar"
   * quedan FUERA del denominador a propósito: un día sin volcar no es una
   * falta de nadie, y meterlo hundiría el porcentaje de toda la plantilla.
   */
  pctAsistencia: number;
  /** Días laborables del periodo con marca de este trabajador (el denominador de arriba). */
  diasComputados: number;
}

/**
 * El mismo desglose por trabajador que la vista semanal, más el porcentaje de
 * asistencia — que en una semana se lee de un vistazo en la rejilla de días y
 * en un mes o una campaña ya no.
 */
export function resumirTrabajadoresPeriodo(faltas: FaltasSemanalesRow[]): ResumenTrabajadorPeriodo[] {
  return faltas.map((row) => {
    const diasComputados = row.totalPresentes + row.totalFaltas + row.totalBajas;
    return {
      ...row,
      diasComputados,
      pctAsistencia: diasComputados > 0 ? (row.totalPresentes / diasComputados) * 100 : 0,
    };
  });
}

/** Totales del periodo para los KPIs de cabecera. */
export function totalesPeriodo(faltas: FaltasSemanalesRow[]) {
  return faltas.reduce(
    (acc, row) => ({
      presentes: acc.presentes + row.totalPresentes,
      faltas: acc.faltas + row.totalFaltas,
      bajas: acc.bajas + row.totalBajas,
      sinRegistrar: acc.sinRegistrar + row.totalSinRegistrar,
      conBaja: acc.conBaja + (row.totalBajas > 0 ? 1 : 0),
    }),
    { presentes: 0, faltas: 0, bajas: 0, sinRegistrar: 0, conBaja: 0 },
  );
}

/** "18 may 2026" — fecha suelta legible, para los textos de cobertura. */
export function formatFechaLarga(iso: string): string {
  const d = parseISO(iso);
  return `${d.getDate()} ${MES_CORTO[d.getMonth()]} ${d.getFullYear()}`;
}

/**
 * Enumera los días en trozos de como mucho `tamano` fechas. Lo usan las
 * lecturas que filtran con `.in("date", …)`: una campaña entera son ~365
 * fechas y la URL de PostgREST no aguanta una lista así.
 */
export function trocear<T>(elementos: T[], tamano: number): T[][] {
  if (tamano <= 0) throw new Error("trocear: tamano debe ser > 0");
  const trozos: T[][] = [];
  for (let i = 0; i < elementos.length; i += tamano) {
    trozos.push(elementos.slice(i, i + tamano));
  }
  return trozos;
}

/**
 * semanaIso.ts — LA implementación de semana ISO-8601 (lunes a domingo) de
 * toda la Herramienta, compartida frontend/Deno (patrón fotoLotesCoherencia).
 *
 * POR QUÉ EXISTE (02-09-2026). Había TRES copias: src/lib/isoWeek.ts (páginas),
 * _shared/informeSemanal.ts (el correo del lunes) y _shared/ventasMercadona.ts
 * (el correo de Mercadona), más una cuarta en consumoPeriodoView.ts y otra vía
 * date-fns en calidad.ts. Eran iguales… hasta que dejaran de serlo: son las
 * funciones que deciden QUÉ SEMANA se envía por correo, y una divergencia en
 * el borde de año (semana 53, lunes 29 de diciembre) no la habría detectado
 * nadie. Ahora todas importan de aquí y las demás son re-exports.
 *
 * Convención (la de siempre en el proyecto):
 * - La semana empieza en LUNES y termina en domingo.
 * - El número de semana es ISO-8601: manda el JUEVES de la semana. Por eso el
 *   lunes 29-12-2025 es la semana 1 de 2026, y 2026 tiene semana 53 (el 31-12
 *   cae en jueves): del 28-12-2026 al 03-01-2027.
 * - Todo en UTC puro sobre fechas YYYY-MM-DD: sin horas, sin zona, sin DST.
 *   Las funciones que reciben un Date usan sus componentes LOCALES (año, mes,
 *   día) para no adelantar el día de madrugada en España.
 */

export interface SemanaIso {
  anio: number;
  semana: number;
}

const DIA_MS = 86_400_000;

function aFechaUtc(fechaISO: string): Date {
  const [y, m, d] = fechaISO.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function aISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Semana ISO-8601 (año ISO + número) de una fecha YYYY-MM-DD. */
export function semanaIsoDe(fechaISO: string): SemanaIso {
  const d = aFechaUtc(fechaISO);
  // El jueves de la semana fija el año ISO.
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const anio = d.getUTCFullYear();
  const inicioAnio = new Date(Date.UTC(anio, 0, 1));
  const semana = Math.ceil(((d.getTime() - inicioAnio.getTime()) / DIA_MS + 1) / 7);
  return { anio, semana };
}

/** Número de semana ISO (1-53) de un Date, leído por sus componentes locales. */
export function numeroSemanaIso(date: Date): number {
  return semanaIsoDe(fechaLocalISO(date)).semana;
}

/** Año ISO al que pertenece la semana de un Date (puede no ser el del calendario). */
export function anioSemanaIso(date: Date): number {
  return semanaIsoDe(fechaLocalISO(date)).anio;
}

/** Etiqueta "2026-W27" de una fecha YYYY-MM-DD. */
export function claveSemanaIso(fechaISO: string): string {
  const { anio, semana } = semanaIsoDe(fechaISO);
  return `${anio}-W${String(semana).padStart(2, "0")}`;
}

/** Las 7 fechas YYYY-MM-DD (lunes..domingo) de una semana ISO. */
export function fechasSemanaIso(anio: number, semana: number): string[] {
  // El 4 de enero está siempre en la semana 1 del año ISO.
  const enero4 = new Date(Date.UTC(anio, 0, 4));
  const lunesSemana1 = new Date(enero4.getTime() - ((enero4.getUTCDay() || 7) - 1) * DIA_MS);
  const lunes = new Date(lunesSemana1.getTime() + (semana - 1) * 7 * DIA_MS);
  return Array.from({ length: 7 }, (_, i) => aISO(new Date(lunes.getTime() + i * DIA_MS)));
}

/** Lunes (YYYY-MM-DD) de la semana ISO a la que pertenece la fecha. */
export function lunesDeSemanaIso(fechaISO: string): string {
  const d = aFechaUtc(fechaISO);
  return aISO(new Date(d.getTime() - ((d.getUTCDay() || 7) - 1) * DIA_MS));
}

/** Semana ISO anterior a la de la fecha dada (la que cubren los correos del lunes). */
export function semanaIsoAnterior(hoyISO: string): SemanaIso {
  const lunes = aFechaUtc(lunesDeSemanaIso(hoyISO));
  return semanaIsoDe(aISO(new Date(lunes.getTime() - 7 * DIA_MS)));
}

/** YYYY-MM-DD con los componentes LOCALES de un Date (no UTC). */
export function fechaLocalISO(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

// src/lib/rrhhVacaciones.ts
// Devengo de vacaciones acordado con el dueño (jul 2026): 30 dias NATURALES al
// año (equivale a 2,5 dias/mes, el minimo del Estatuto), prorrateado POR DIAS
// dentro del año natural — mas justo con altas a mitad de mes que contar meses
// cerrados. `vacaciones_dias_anuales` de trabajadores permite otro convenio
// por persona. No se arrastra saldo entre años (cada año natural empieza de 0).

export interface DevengoInput {
  /** Fecha de alta del trabajador (YYYY-MM-DD) o null si no consta. */
  fechaAlta: string | null;
  /** Dia hasta el que se devenga, normalmente hoy (YYYY-MM-DD). */
  hasta: string;
  /** Dias naturales de vacaciones al año de este trabajador (default 30). */
  diasAnuales?: number;
}

function parseDia(fecha: string): Date {
  const [y, m, d] = fecha.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1, 12, 0, 0);
}

function diasEntreInclusive(desde: Date, hasta: Date): number {
  const MS_DIA = 86_400_000;
  return Math.floor((hasta.getTime() - desde.getTime()) / MS_DIA) + 1;
}

function diasDelAnio(anio: number): number {
  return diasEntreInclusive(new Date(anio, 0, 1, 12), new Date(anio, 11, 31, 12));
}

/**
 * Dias devengados en el año natural de `hasta`: dias transcurridos del año
 * (desde el 1 de enero, o desde la fecha de alta si fue este año) × anuales/365(6).
 * Si el trabajador aun no estaba de alta, 0.
 */
export function diasDevengados({ fechaAlta, hasta, diasAnuales = 30 }: DevengoInput): number {
  const hastaD = parseDia(hasta);
  const anio = hastaD.getFullYear();
  const inicioAnio = new Date(anio, 0, 1, 12);
  const alta = fechaAlta ? parseDia(fechaAlta) : null;
  if (alta && alta > hastaD) return 0;
  const desde = alta && alta > inicioAnio ? alta : inicioAnio;
  const transcurridos = diasEntreInclusive(desde, hastaD);
  return (transcurridos * diasAnuales) / diasDelAnio(anio);
}

export interface PeriodoVacaciones {
  fecha_inicio: string;
  fecha_fin: string;
  dias_naturales: number;
}

/** Dias disfrutados dentro del año natural `anio` (los periodos no se parten entre años al computar: cuenta el solape real de dias). */
export function diasDisfrutadosEnAnio(periodos: PeriodoVacaciones[], anio: number): number {
  const inicioAnio = new Date(anio, 0, 1, 12);
  const finAnio = new Date(anio, 11, 31, 12);
  let total = 0;
  for (const p of periodos) {
    const ini = parseDia(p.fecha_inicio);
    const fin = parseDia(p.fecha_fin);
    const desde = ini > inicioAnio ? ini : inicioAnio;
    const hasta = fin < finAnio ? fin : finAnio;
    if (hasta < desde) continue;
    total += diasEntreInclusive(desde, hasta);
  }
  return total;
}

export interface SaldoVacaciones {
  devengados: number;
  disfrutados: number;
  saldo: number;
}

export function saldoVacaciones(input: DevengoInput, periodos: PeriodoVacaciones[]): SaldoVacaciones {
  const devengados = diasDevengados(input);
  const disfrutados = diasDisfrutadosEnAnio(periodos, parseDia(input.hasta).getFullYear());
  return { devengados, disfrutados, saldo: devengados - disfrutados };
}

/** Dias naturales de un periodo [inicio, fin] ambos inclusive (para precalcular dias_naturales al guardar). */
export function diasNaturalesPeriodo(fechaInicio: string, fechaFin: string): number {
  return diasEntreInclusive(parseDia(fechaInicio), parseDia(fechaFin));
}

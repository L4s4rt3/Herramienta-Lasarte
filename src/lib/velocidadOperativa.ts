/**
 * Velocidad operativa (T/h): kg producidos entre horas de jornada.
 *
 * La jornada operativa depende de la fecha:
 *  - Hasta el 2026-07-01: 8 h/día.
 *  - Desde el 2026-07-02: 7 h/día (aviso del dueño, jul 2026, hasta nuevo aviso).
 *
 * Por eso el cálculo pide las FECHAS de los días (una o varias) y no un número
 * de días: una semana que cruce el 2 de julio mezcla días de 8 h y de 7 h.
 * La firma numérica (nº de días × 8 h) se mantiene solo para las rutas legacy
 * de análisis local (analisis.ts/parsers.ts) que no conocen la fecha.
 */
export const HORAS_OPERATIVAS_DIA = 8;
export const HORAS_OPERATIVAS_DIA_REDUCIDA = 7;
/** Primer día con jornada reducida de 7 h. */
export const FECHA_JORNADA_REDUCIDA = "2026-07-02";

/** Horas de jornada operativa del día ("YYYY-MM-DD"). Sin fecha → 8 h (legacy). */
export function horasOperativasDia(date: string | null | undefined): number {
  return date && date >= FECHA_JORNADA_REDUCIDA
    ? HORAS_OPERATIVAS_DIA_REDUCIDA
    : HORAS_OPERATIVAS_DIA;
}

/** Etiqueta de la jornada vigente para un día, p.ej. "7 h/día". */
export function jornadaLabel(date: string | null | undefined): string {
  return `${horasOperativasDia(date)} h/día`;
}

export function calcularTphOperativa(
  kg: number | null | undefined,
  fechasONDias: number | string | Array<string | null | undefined> = 1,
): number | null {
  const kgValue = Number(kg) || 0;

  const horas =
    typeof fechasONDias === "number"
      ? fechasONDias * HORAS_OPERATIVAS_DIA
      : (Array.isArray(fechasONDias) ? fechasONDias : [fechasONDias]).reduce(
          (s, f) => s + horasOperativasDia(f),
          0,
        );

  if (kgValue <= 0 || horas <= 0) {
    return null;
  }

  return kgValue / 1000 / horas;
}

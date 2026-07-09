// src/lib/costePersonal.ts
//
// Cálculo puro del coste de personal por trabajador y por zona/grupo, para la
// sección "Coste de personal" de Económico → Costes (de la mano de RRHH).
//
// MODELO DE COSTE (decidido con el dueño): coste por hora del trabajador
// (`trabajadores.coste_hora`, numeric, puede ser null = sin coste asignado)
// multiplicado por las horas trabajadas en el periodo.
//
// No hay horas reales por día en `asistencia_detalle` (solo el booleano
// `presente`), así que las horas se ESTIMAN como días PRESENTE en el rango ×
// `JORNADA_BASE_HORAS`. Esa jornada de 8h es la misma base fija que ya usa el
// resto de la planta para KPIs de producción/eficiencia (ver
// `HORAS_OPERATIVAS_DIA` en src/lib/velocidadOperativa.ts y
// src/lib/exportEficiencia.ts): no son horas fichadas, es la jornada estándar
// de la planta.

/** Jornada base de la planta, en horas/día. Ver cabecera del archivo. */
export const JORNADA_BASE_HORAS = 8;

/** Horas trabajadas estimadas = días presente × jornada base. */
export function horasTrabajadas(diasPresente: number, jornada: number = JORNADA_BASE_HORAS): number {
  const dias = Number.isFinite(diasPresente) ? Math.max(0, diasPresente) : 0;
  return dias * jornada;
}

export interface CosteTrabajadorInput {
  /** null = sin coste/hora asignado todavía → coste 0. */
  coste_hora: number | null | undefined;
  diasPresente: number;
}

/** Coste de UN trabajador en el periodo. 0 si no tiene coste_hora asignado. */
export function costeTrabajador({ coste_hora, diasPresente }: CosteTrabajadorInput): number {
  if (coste_hora == null || !Number.isFinite(coste_hora)) return 0;
  return horasTrabajadas(diasPresente) * coste_hora;
}

export interface TrabajadorCosteInput {
  id: string;
  nombre: string;
  zona?: string | null;
  coste_hora?: number | null;
  diasPresente: number;
}

export interface CosteZonaRow {
  zona: string;
  coste: number;
  horas: number;
  personas: number;
}

export interface CostePersonaRow {
  id: string;
  nombre: string;
  zona: string;
  coste: number;
  horas: number;
  /** null = sin coste/hora asignado. */
  costeHora: number | null;
}

export interface CostePersonalAgrupado {
  /** Una fila por zona/grupo (`trabajador.zona`, o "Sin zona" si viene vacía). */
  porZona: CosteZonaRow[];
  /** Una fila por persona, ordenada por coste descendente. */
  porPersona: CostePersonaRow[];
  /** Suma del coste de todos los trabajadores. */
  total: number;
  /** Nº de trabajadores PRESENTES en el periodo (diasPresente > 0) sin coste_hora asignado. */
  sinCoste: number;
}

const SIN_ZONA = "Sin zona";

function zonaDe(zona: string | null | undefined): string {
  const trimmed = zona?.trim();
  return trimmed ? trimmed : SIN_ZONA;
}

function tieneCosteHoraValido(coste_hora: number | null | undefined): coste_hora is number {
  return coste_hora != null && Number.isFinite(coste_hora);
}

/**
 * Agrupa el coste de personal del periodo por zona/grupo y por persona.
 * Pensado para recibir, por cada trabajador, los días PRESENTE ya contados
 * en `asistencia_detalle` dentro del rango elegido (ver useCostePersonal).
 */
export function agruparCostePersonalPorZona(
  trabajadores: readonly TrabajadorCosteInput[],
): CostePersonalAgrupado {
  const zonaMap = new Map<string, CosteZonaRow>();
  const porPersona: CostePersonaRow[] = [];
  let total = 0;
  let sinCoste = 0;

  for (const t of trabajadores) {
    const zona = zonaDe(t.zona);
    const horas = horasTrabajadas(t.diasPresente);
    const costeHora: number | null = tieneCosteHoraValido(t.coste_hora) ? t.coste_hora : null;
    const coste = costeHora != null ? horas * costeHora : 0;

    if (costeHora == null && t.diasPresente > 0) sinCoste += 1;

    total += coste;

    porPersona.push({
      id: t.id,
      nombre: t.nombre,
      zona,
      coste,
      horas,
      costeHora,
    });

    const zonaRow = zonaMap.get(zona) ?? { zona, coste: 0, horas: 0, personas: 0 };
    zonaRow.coste += coste;
    zonaRow.horas += horas;
    zonaRow.personas += 1;
    zonaMap.set(zona, zonaRow);
  }

  porPersona.sort((a, b) => b.coste - a.coste);
  const porZona = Array.from(zonaMap.values()).sort((a, b) => b.coste - a.coste);

  return { porZona, porPersona, total, sinCoste };
}

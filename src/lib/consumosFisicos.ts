export type ConsumoRecurso = "agua" | "electricidad" | "gasoil" | "quimicos";
export type ConsumoUnidad = "l" | "m3" | "kwh";
export type ConsumoFuente = "contador" | "factura_detallada" | "albaran" | "estimacion_manual";
export type BaseKgTipo = "ventas" | "manual";
export type ConsumoConfianza = "real" | "estimado" | "mixto" | "incompleto";

export interface ConsumoFisicoInput {
  id: string;
  recurso: ConsumoRecurso;
  fecha_inicio: string;
  fecha_fin: string;
  cantidad: number | null | undefined;
  unidad: ConsumoUnidad;
  fuente: ConsumoFuente;
}

export interface BaseKgInput {
  id: string;
  tipo_base: BaseKgTipo;
  fecha_inicio: string;
  fecha_fin: string;
  kg: number | null | undefined;
}

export interface ParteKgInput {
  date: string;
  kg_produccion_calibrador?: number | null;
  kg_mujeres_calibrador?: number | null;
  kg_reciclado_malla_z1?: number | null;
  kg_reciclado_malla_z2?: number | null;
}

export interface NormalizedConsumo {
  cantidadBase: number;
  unidadBase: "l" | "kwh";
}

export interface ConsumoPeriodoRow {
  periodo: string;
  fechaInicio: string;
  fechaFin: string;
  kgBase: number;
  kgPartes: number;
  kgVentas: number;
  kgManual: number;
  confianza: ConsumoConfianza;
  issues: string[];
  aguaL: number;
  electricidadKwh: number;
  gasoilL: number;
  quimicosL: number;
  aguaLKg: number | null;
  electricidadKwhKg: number | null;
  gasoilMlKg: number | null;
  gasoilLT: number | null;
  quimicosMlKg: number | null;
}

interface BuildMonthlyConsumptionRowsInput {
  rangeStart: string;
  rangeEnd: string;
  consumos: ConsumoFisicoInput[];
  partes: ParteKgInput[];
  basesKg: BaseKgInput[];
}

interface MonthPeriod {
  periodo: string;
  fechaInicio: string;
  fechaFin: string;
  startMs: number;
  endMs: number;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function normalizeConsumoCantidad(input: Pick<ConsumoFisicoInput, "recurso" | "cantidad" | "unidad">): NormalizedConsumo {
  const cantidad = input.cantidad ?? 0;

  if (input.recurso === "electricidad") {
    return {
      cantidadBase: cantidad,
      unidadBase: "kwh",
    };
  }

  return {
    cantidadBase: input.unidad === "m3" ? cantidad * 1000 : cantidad,
    unidadBase: "l",
  };
}

export function kgProducidosParte(parte: ParteKgInput): number {
  return (
    (parte.kg_produccion_calibrador ?? 0)
    - (parte.kg_mujeres_calibrador ?? 0)
    - (parte.kg_reciclado_malla_z1 ?? 0)
    - (parte.kg_reciclado_malla_z2 ?? 0)
  );
}

export function buildMonthlyConsumptionRows(input: BuildMonthlyConsumptionRowsInput): ConsumoPeriodoRow[] {
  const months = buildMonthPeriods(input.rangeStart, input.rangeEnd);

  return months.map((month) => {
    const totals = totalConsumosForMonth(input.consumos, month);
    const kgPartes = totalPartesForMonth(input.partes, month);
    const kgVentas = totalBasesForMonth(input.basesKg, month, "ventas");
    const kgManual = totalBasesForMonth(input.basesKg, month, "manual");
    const proxyKg = kgVentas > 0 ? kgVentas : kgManual;
    const kgBase = kgPartes > 0 ? kgPartes : proxyKg;
    const hasConsumo = totals.aguaL > 0 || totals.electricidadKwh > 0 || totals.gasoilL > 0 || totals.quimicosL > 0;
    const hasProxyKg = kgVentas > 0 || kgManual > 0;
    const issues: string[] = [];

    if (!hasConsumo) {
      issues.push("Sin consumo fisico registrado");
    }

    if (kgBase <= 0) {
      issues.push("Sin kg base para calcular ratios");
    }

    if (kgPartes > 0 && hasProxyKg) {
      issues.push("Partes y kg proxy coexisten; se usa kg de partes");
    }

    const confianza = resolveConfianza({
      hasConsumo,
      kgBase,
      kgPartes,
      hasProxyKg,
    });

    return {
      periodo: month.periodo,
      fechaInicio: month.fechaInicio,
      fechaFin: month.fechaFin,
      kgBase,
      kgPartes,
      kgVentas,
      kgManual,
      confianza,
      issues,
      aguaL: totals.aguaL,
      electricidadKwh: totals.electricidadKwh,
      gasoilL: totals.gasoilL,
      quimicosL: totals.quimicosL,
      aguaLKg: ratio(totals.aguaL, kgBase),
      electricidadKwhKg: ratio(totals.electricidadKwh, kgBase),
      gasoilMlKg: ratio(totals.gasoilL * 1000, kgBase),
      gasoilLT: ratio(totals.gasoilL * 1000, kgBase),
      quimicosMlKg: ratio(totals.quimicosL * 1000, kgBase),
    };
  });
}

function resolveConfianza(input: {
  hasConsumo: boolean;
  kgBase: number;
  kgPartes: number;
  hasProxyKg: boolean;
}): ConsumoConfianza {
  if (!input.hasConsumo || input.kgBase <= 0) {
    return "incompleto";
  }

  if (input.kgPartes > 0 && input.hasProxyKg) {
    return "mixto";
  }

  if (input.kgPartes > 0) {
    return "real";
  }

  return "estimado";
}

function totalConsumosForMonth(consumos: ConsumoFisicoInput[], month: MonthPeriod) {
  return consumos.reduce(
    (acc, consumo) => {
      const factor = overlapFactor(consumo.fecha_inicio, consumo.fecha_fin, month);
      if (factor <= 0) {
        return acc;
      }

      const normalized = normalizeConsumoCantidad(consumo);
      const cantidad = normalized.cantidadBase * factor;

      if (consumo.recurso === "agua") {
        acc.aguaL += cantidad;
      } else if (consumo.recurso === "electricidad") {
        acc.electricidadKwh += cantidad;
      } else if (consumo.recurso === "gasoil") {
        acc.gasoilL += cantidad;
      } else {
        acc.quimicosL += cantidad;
      }

      return acc;
    },
    {
      aguaL: 0,
      electricidadKwh: 0,
      gasoilL: 0,
      quimicosL: 0,
    },
  );
}

function totalPartesForMonth(partes: ParteKgInput[], month: MonthPeriod): number {
  return partes.reduce((total, parte) => {
    const dateMs = dateToUtcMs(parte.date);
    if (dateMs < month.startMs || dateMs > month.endMs) {
      return total;
    }

    return total + kgProducidosParte(parte);
  }, 0);
}

function totalBasesForMonth(basesKg: BaseKgInput[], month: MonthPeriod, tipoBase: BaseKgTipo): number {
  return basesKg.reduce((total, base) => {
    if (base.tipo_base !== tipoBase) {
      return total;
    }

    return total + ((base.kg ?? 0) * overlapFactor(base.fecha_inicio, base.fecha_fin, month));
  }, 0);
}

function buildMonthPeriods(rangeStart: string, rangeEnd: string): MonthPeriod[] {
  const rangeStartMs = dateToUtcMs(rangeStart);
  const rangeEndMs = dateToUtcMs(rangeEnd);
  const start = parseDateParts(rangeStart);
  const current = new Date(Date.UTC(start.year, start.month - 1, 1));
  const months: MonthPeriod[] = [];

  while (current.getTime() <= rangeEndMs) {
    const year = current.getUTCFullYear();
    const month = current.getUTCMonth() + 1;
    const monthStartMs = Date.UTC(year, month - 1, 1);
    const monthEndMs = Date.UTC(year, month, 0);
    const startMs = Math.max(monthStartMs, rangeStartMs);
    const endMs = Math.min(monthEndMs, rangeEndMs);

    if (startMs <= endMs) {
      months.push({
        periodo: `${year}-${pad2(month)}`,
        fechaInicio: utcMsToDateString(startMs),
        fechaFin: utcMsToDateString(endMs),
        startMs,
        endMs,
      });
    }

    current.setUTCMonth(current.getUTCMonth() + 1);
  }

  return months;
}

function overlapFactor(fechaInicio: string, fechaFin: string, month: MonthPeriod): number {
  const startMs = dateToUtcMs(fechaInicio);
  const endMs = dateToUtcMs(fechaFin);
  const totalDays = inclusiveDays(startMs, endMs);

  if (totalDays <= 0) {
    return 0;
  }

  const overlapStartMs = Math.max(startMs, month.startMs);
  const overlapEndMs = Math.min(endMs, month.endMs);
  const overlapDays = inclusiveDays(overlapStartMs, overlapEndMs);

  return overlapDays > 0 ? overlapDays / totalDays : 0;
}

function ratio(cantidad: number, kgBase: number): number | null {
  if (kgBase <= 0) {
    return null;
  }

  return cantidad / kgBase;
}

function inclusiveDays(startMs: number, endMs: number): number {
  if (endMs < startMs) {
    return 0;
  }

  return Math.floor((endMs - startMs) / MS_PER_DAY) + 1;
}

function dateToUtcMs(date: string): number {
  const parts = parseDateParts(date);
  return Date.UTC(parts.year, parts.month - 1, parts.day);
}

function utcMsToDateString(ms: number): string {
  const date = new Date(ms);
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

function parseDateParts(date: string): { year: number; month: number; day: number } {
  const [year, month, day] = date.split("-").map(Number);
  return { year, month, day };
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

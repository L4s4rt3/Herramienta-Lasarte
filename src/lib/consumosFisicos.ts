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

interface BuildConsumptionRowsInput {
  rangeStart: string;
  rangeEnd: string;
  consumos: ConsumoFisicoInput[];
  partes: ParteKgInput[];
  basesKg: BaseKgInput[];
}

interface ConsumptionPeriod {
  periodo: string;
  fechaInicio: string;
  fechaFin: string;
  startMs: number;
  endMs: number;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function normalizeConsumoCantidad(input: Pick<ConsumoFisicoInput, "recurso" | "cantidad" | "unidad">): NormalizedConsumo {
  const cantidad = finiteOrZero(input.cantidad);

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
    finiteOrZero(parte.kg_produccion_calibrador)
    - finiteOrZero(parte.kg_mujeres_calibrador)
    - finiteOrZero(parte.kg_reciclado_malla_z1)
    - finiteOrZero(parte.kg_reciclado_malla_z2)
  );
}

export function buildMonthlyConsumptionRows(input: BuildConsumptionRowsInput): ConsumoPeriodoRow[] {
  return buildConsumptionRows(input, buildMonthPeriods(input.rangeStart, input.rangeEnd));
}

export function buildWeeklyConsumptionRows(input: BuildConsumptionRowsInput): ConsumoPeriodoRow[] {
  return buildConsumptionRows(input, buildIsoWeekPeriods(input.rangeStart, input.rangeEnd));
}

export function buildDailyConsumptionRows(input: BuildConsumptionRowsInput): ConsumoPeriodoRow[] {
  return buildConsumptionRows(input, buildDayPeriods(input.rangeStart, input.rangeEnd));
}

function buildConsumptionRows(input: BuildConsumptionRowsInput, periods: ConsumptionPeriod[]): ConsumoPeriodoRow[] {
  const gasoilLByPeriod = distributeGasoilPurchases(input, periods);

  return periods.map((period, index) => {
    const totals = totalConsumosForPeriod(input.consumos, period);
    totals.gasoilL = gasoilLByPeriod[index] ?? 0;
    const kgPartes = totalPartesForPeriod(input.partes, period);
    const kgVentas = totalBasesForPeriod(input.basesKg, period, "ventas");
    const kgManual = totalBasesForPeriod(input.basesKg, period, "manual");
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
      periodo: period.periodo,
      fechaInicio: period.fechaInicio,
      fechaFin: period.fechaFin,
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
      // L/t is numerically equal to mL/kg because both scale numerator and denominator by 1000.
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

function totalConsumosForPeriod(consumos: ConsumoFisicoInput[], period: ConsumptionPeriod) {
  return consumos.reduce(
    (acc, consumo) => {
      if (consumo.recurso === "gasoil") {
        return acc;
      }

      const factor = overlapFactor(consumo.fecha_inicio, consumo.fecha_fin, period);
      if (factor <= 0) {
        return acc;
      }

      const normalized = normalizeConsumoCantidad(consumo);
      const cantidad = normalized.cantidadBase * factor;

      if (consumo.recurso === "agua") {
        acc.aguaL += cantidad;
      } else if (consumo.recurso === "electricidad") {
        acc.electricidadKwh += cantidad;
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

function distributeGasoilPurchases(input: BuildConsumptionRowsInput, periods: ConsumptionPeriod[]): number[] {
  const result = periods.map(() => 0);
  const purchases = gasoilPurchasesByDate(input.consumos);
  const rangeStartMs = dateToUtcMs(input.rangeStart);
  const rangeEndMs = dateToUtcMs(input.rangeEnd);

  purchases.forEach((purchase, index) => {
    const nextPurchase = purchases[index + 1];
    const rawEndMs = nextPurchase ? nextPurchase.dateMs - MS_PER_DAY : rangeEndMs;
    const startMs = Math.max(purchase.dateMs, rangeStartMs);
    const endMs = Math.min(rawEndMs, rangeEndMs);

    if (purchase.litros <= 0 || endMs < startMs) {
      return;
    }

    const tramoKg = kgBaseForRange(input, startMs, endMs);

    if (tramoKg <= 0) {
      addGasoilToPurchasePeriod(result, periods, startMs, purchase.litros);
      return;
    }

    periods.forEach((period, periodIndex) => {
      const overlapStartMs = Math.max(startMs, period.startMs);
      const overlapEndMs = Math.min(endMs, period.endMs);

      if (overlapEndMs < overlapStartMs) {
        return;
      }

      const overlapKg = kgBaseForRange(input, overlapStartMs, overlapEndMs);
      if (overlapKg <= 0) {
        return;
      }

      result[periodIndex] += purchase.litros * (overlapKg / tramoKg);
    });
  });

  return result;
}

function gasoilPurchasesByDate(consumos: ConsumoFisicoInput[]): Array<{ dateMs: number; litros: number }> {
  const purchases = new Map<number, number>();

  consumos.forEach((consumo) => {
    if (consumo.recurso !== "gasoil") {
      return;
    }

    const dateMs = dateToUtcMs(consumo.fecha_inicio);
    const normalized = normalizeConsumoCantidad(consumo);
    purchases.set(dateMs, (purchases.get(dateMs) ?? 0) + normalized.cantidadBase);
  });

  return Array.from(purchases.entries())
    .map(([dateMs, litros]) => ({ dateMs, litros }))
    .sort((a, b) => a.dateMs - b.dateMs);
}

function kgBaseForRange(input: BuildConsumptionRowsInput, startMs: number, endMs: number): number {
  const period = periodFromRange(startMs, endMs);
  const kgPartes = totalPartesForPeriod(input.partes, period);
  const kgVentas = totalBasesForPeriod(input.basesKg, period, "ventas");
  const kgManual = totalBasesForPeriod(input.basesKg, period, "manual");

  if (kgPartes > 0) {
    return kgPartes;
  }

  return kgVentas > 0 ? kgVentas : kgManual;
}

function periodFromRange(startMs: number, endMs: number): ConsumptionPeriod {
  return {
    periodo: "",
    fechaInicio: utcMsToDateString(startMs),
    fechaFin: utcMsToDateString(endMs),
    startMs,
    endMs,
  };
}

function addGasoilToPurchasePeriod(result: number[], periods: ConsumptionPeriod[], dateMs: number, litros: number): void {
  const periodIndex = periods.findIndex((period) => dateMs >= period.startMs && dateMs <= period.endMs);
  if (periodIndex >= 0) {
    result[periodIndex] += litros;
  }
}

function totalPartesForPeriod(partes: ParteKgInput[], period: ConsumptionPeriod): number {
  return partes.reduce((total, parte) => {
    const dateMs = dateToUtcMs(parte.date);
    if (dateMs < period.startMs || dateMs > period.endMs) {
      return total;
    }

    return total + kgProducidosParte(parte);
  }, 0);
}

function totalBasesForPeriod(basesKg: BaseKgInput[], period: ConsumptionPeriod, tipoBase: BaseKgTipo): number {
  return basesKg.reduce((total, base) => {
    if (base.tipo_base !== tipoBase) {
      return total;
    }

    return total + (finiteOrZero(base.kg) * overlapFactor(base.fecha_inicio, base.fecha_fin, period));
  }, 0);
}

function finiteOrZero(value: number | null | undefined): number {
  return Number.isFinite(value) ? value : 0;
}

function buildMonthPeriods(rangeStart: string, rangeEnd: string): ConsumptionPeriod[] {
  const rangeStartMs = dateToUtcMs(rangeStart);
  const rangeEndMs = dateToUtcMs(rangeEnd);
  const start = parseDateParts(rangeStart);
  const current = new Date(Date.UTC(start.year, start.month - 1, 1));
  const months: ConsumptionPeriod[] = [];

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

function buildIsoWeekPeriods(rangeStart: string, rangeEnd: string): ConsumptionPeriod[] {
  const rangeStartMs = dateToUtcMs(rangeStart);
  const rangeEndMs = dateToUtcMs(rangeEnd);
  const current = new Date(startOfIsoWeekMs(rangeStartMs));
  const weeks: ConsumptionPeriod[] = [];

  while (current.getTime() <= rangeEndMs) {
    const weekStartMs = current.getTime();
    const weekEndMs = weekStartMs + (6 * MS_PER_DAY);
    const startMs = Math.max(weekStartMs, rangeStartMs);
    const endMs = Math.min(weekEndMs, rangeEndMs);

    if (startMs <= endMs) {
      const iso = isoWeekFromUtcMs(weekStartMs);
      weeks.push({
        periodo: `${iso.year}-W${pad2(iso.week)}`,
        fechaInicio: utcMsToDateString(startMs),
        fechaFin: utcMsToDateString(endMs),
        startMs,
        endMs,
      });
    }

    current.setUTCDate(current.getUTCDate() + 7);
  }

  return weeks;
}

function buildDayPeriods(rangeStart: string, rangeEnd: string): ConsumptionPeriod[] {
  const rangeStartMs = dateToUtcMs(rangeStart);
  const rangeEndMs = dateToUtcMs(rangeEnd);
  const days: ConsumptionPeriod[] = [];

  for (let currentMs = rangeStartMs; currentMs <= rangeEndMs; currentMs += MS_PER_DAY) {
    const date = utcMsToDateString(currentMs);
    days.push({
      periodo: date,
      fechaInicio: date,
      fechaFin: date,
      startMs: currentMs,
      endMs: currentMs,
    });
  }

  return days;
}

function overlapFactor(fechaInicio: string, fechaFin: string, period: ConsumptionPeriod): number {
  const startMs = dateToUtcMs(fechaInicio);
  const endMs = dateToUtcMs(fechaFin);
  const totalDays = inclusiveDays(startMs, endMs);

  if (totalDays <= 0) {
    return 0;
  }

  const overlapStartMs = Math.max(startMs, period.startMs);
  const overlapEndMs = Math.min(endMs, period.endMs);
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

function startOfIsoWeekMs(dateMs: number): number {
  const date = new Date(dateMs);
  const day = date.getUTCDay() || 7;
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - day + 1);
}

function isoWeekFromUtcMs(dateMs: number): { year: number; week: number } {
  const thursday = new Date(dateMs);
  const day = thursday.getUTCDay() || 7;
  thursday.setUTCDate(thursday.getUTCDate() + 4 - day);
  const year = thursday.getUTCFullYear();
  const yearStart = Date.UTC(year, 0, 1);
  const week = Math.ceil((((thursday.getTime() - yearStart) / MS_PER_DAY) + 1) / 7);

  return { year, week };
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

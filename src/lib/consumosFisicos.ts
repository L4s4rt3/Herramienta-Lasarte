import { produccionRealParte } from "./asistenciaRendimiento";

export type ConsumoRecurso = "agua" | "electricidad" | "gasoil" | "quimicos";
export type ConsumoUnidad = "l" | "m3" | "kwh";
export type ConsumoFuente = "contador" | "factura_detallada" | "albaran" | "estimacion_manual";
export type BaseKgTipo = "ventas" | "palets" | "manual";
export type ConsumoConfianza = "real" | "estimado" | "mixto" | "incompleto";
type PeriodGranularity = "monthly" | "weekly" | "daily";

export interface ConsumoFisicoInput {
  id: string;
  recurso: ConsumoRecurso;
  fecha_inicio: string;
  fecha_fin: string;
  cantidad: number | null | undefined;
  unidad: ConsumoUnidad;
  fuente: ConsumoFuente;
  referencia?: string | null;
  notas?: string | null;
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
  resumen_ia?: unknown;
  cascade?: unknown;
  cascada?: unknown;
  kg_produccion_calibrador?: number | null;
  kg_mujeres_calibrador?: number | null;
  kg_reciclado_malla_z1?: number | null;
  kg_reciclado_malla_z2?: number | null;
}

export interface NormalizedConsumo {
  cantidadBase: number;
  unidadBase: "l" | "kwh";
}

export interface DailyWaterMeterInput {
  fecha: string;
  contadorGeneralL: number | null | undefined;
  lineaTratamientoL?: number | null;
  drencherL?: number | null;
}

export interface DailyWaterMeterReadingInput {
  fecha: string;
  lecturaContadorM3: number | null | undefined;
  lecturaAnteriorM3?: number | null;
  fechaLecturaAnterior?: string | null;
  lineaTratamientoL?: number | null;
  drencherL?: number | null;
}

export interface WaterMeterTratamientoReadingInput {
  fecha: string;
  lecturaContadorM3: number | null | undefined;
  lecturaAnteriorM3?: number | null;
  fechaLecturaAnterior?: string | null;
}

export interface WaterMeterJabonReadingInput {
  fecha: string;
  lecturaContadorL: number | null | undefined;
  lecturaAnteriorL?: number | null;
  fechaLecturaAnterior?: string | null;
}

export type WaterMeterReference =
  | "agua-contador-general"
  | "agua-contador-tratamiento"
  | "agua-contador-tratamiento-jabon";

export function isWaterMeterReference(value: string | null | undefined): value is WaterMeterReference {
  return value === "agua-contador-general"
    || value === "agua-contador-tratamiento"
    || value === "agua-contador-tratamiento-jabon";
}

export interface WaterMeterReading {
  id?: string;
  fecha: string;
  lecturaM3: number | null;
  lecturaL: number | null;
  consumoL: number;
  referencia: WaterMeterReference;
}

export type DailyWaterMeterConsumo = Omit<ConsumoFisicoInput, "id" | "cantidad"> & { cantidad: number };

export interface ConsumoPeriodoRow {
  periodo: string;
  fechaInicio: string;
  fechaFin: string;
  kgBase: number;
  kgPartes: number;
  kgPalets: number;
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

export function parseConsumoNumber(value: string): number {
  const trimmed = value.trim();
  if (!trimmed) {
    return 0;
  }

  const withoutSpaces = trimmed.replace(/\s/g, "");
  const hasComma = withoutSpaces.includes(",");
  const normalized = hasComma
    ? withoutSpaces.replace(/\./g, "").replace(",", ".")
    : withoutSpaces;
  const parsed = Number(normalized);

  return Number.isFinite(parsed) ? parsed : 0;
}

export function kgProducidosParte(parte: ParteKgInput): number {
  return produccionRealParte(parte);
}

export function buildDailyWaterMeterConsumo(input: DailyWaterMeterInput): DailyWaterMeterConsumo {
  const contadorGeneralL = finiteOrZero(input.contadorGeneralL);
  const lineaTratamientoL = finiteOrZero(input.lineaTratamientoL);
  const drencherL = finiteOrZero(input.drencherL);

  return {
    recurso: "agua",
    fecha_inicio: input.fecha,
    fecha_fin: input.fecha,
    cantidad: contadorGeneralL,
    unidad: "l",
    fuente: "contador",
    referencia: "agua-contador-general",
    notas: `Contador general: ${contadorGeneralL} L. Linea tratamiento: ${lineaTratamientoL} L. Drencher: ${drencherL} L.`,
  };
}

/**
 * Resta un día a una fecha "YYYY-MM-DD" en horario local, sin desplazamiento UTC.
 * Usa mediodía local como ancla (igual criterio que parseLocalDate en lib/format)
 * para evitar que el cambio de horario de verano/invierno mueva el día resultante.
 */
export function subtractOneDayLocal(date: string): string {
  const { year, month, day } = parseDateParts(date);
  const d = new Date(year, month - 1, day, 12, 0, 0);
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/**
 * Suma un día a una fecha "YYYY-MM-DD" en horario local, sin desplazamiento UTC.
 * Simétrico a subtractOneDayLocal: usa mediodía local como ancla para evitar que el
 * cambio de horario de verano/invierno mueva el día resultante.
 */
export function addOneDayLocal(date: string): string {
  const { year, month, day } = parseDateParts(date);
  const d = new Date(year, month - 1, day, 12, 0, 0);
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/**
 * Día de la semana (0=domingo..6=sabado) de una fecha "YYYY-MM-DD" anclada a
 * mediodía local, mismo criterio que subtractOneDayLocal/addOneDayLocal.
 */
function localWeekday(date: string): number {
  const { year, month, day } = parseDateParts(date);
  return new Date(year, month - 1, day, 12, 0, 0).getDay();
}

/**
 * Fallback de fecha_inicio cuando no hay fechaLecturaAnterior (no hay lectura previa
 * de contador registrada, p.ej. primera lectura, o dato manual sin fila anterior).
 * Las fotos se hacen de lunes a viernes: si la foto es de LUNES, la foto anterior más
 * probable fue el viernes, por lo que el rango debe cubrir el fin de semana completo
 * [viernes, domingo] = [foto-3, foto-1]. Cualquier otro día de la semana no tiene ese
 * hueco de findes y el rango colapsa a un único día: [foto-1, foto-1].
 */
function fallbackFechaInicioSinLecturaAnterior(fecha: string): string {
  const MONDAY = 1;
  if (localWeekday(fecha) === MONDAY) {
    return subtractOneDayLocal(subtractOneDayLocal(subtractOneDayLocal(fecha)));
  }
  return subtractOneDayLocal(fecha);
}

/**
 * REGLA 1 (atribución de lecturas de contador): la foto de hoy registra el consumo
 * de AYER (y de todos los días transcurridos desde la foto anterior, si hubo un hueco
 * -p.ej. fin de semana-). Por eso el consumo calculado se fecha [fechaLecturaAnterior,
 * fecha de la foto actual − 1 día] y NUNCA el día de la foto en sí. Si no hay lectura
 * anterior (primera vez), no hay delta que atribuir y el rango colapsa a fecha−1.
 */
export function buildDailyWaterMeterConsumoFromReading(input: DailyWaterMeterReadingInput): DailyWaterMeterConsumo {
  const lecturaContadorM3 = finiteOrZero(input.lecturaContadorM3);
  const lecturaAnteriorM3 = input.lecturaAnteriorM3 == null ? null : finiteOrZero(input.lecturaAnteriorM3);
  const consumoM3 = lecturaAnteriorM3 == null ? 0 : Math.max(0, lecturaContadorM3 - lecturaAnteriorM3);
  const consumoL = consumoM3 * 1000;
  const lineaTratamientoL = finiteOrZero(input.lineaTratamientoL);
  const drencherL = finiteOrZero(input.drencherL);
  const diaAnterior = subtractOneDayLocal(input.fecha);
  const fechaInicio = input.fechaLecturaAnterior ?? fallbackFechaInicioSinLecturaAnterior(input.fecha);
  const previousNote = lecturaAnteriorM3 == null
    ? "Lectura anterior: sin referencia."
    : `Lectura anterior: ${lecturaAnteriorM3} m3${input.fechaLecturaAnterior ? ` (${input.fechaLecturaAnterior})` : ""}.`;

  return {
    recurso: "agua",
    fecha_inicio: fechaInicio,
    fecha_fin: diaAnterior,
    cantidad: consumoL,
    unidad: "l",
    fuente: "contador",
    referencia: "agua-contador-general",
    notas: `Lectura contador: ${lecturaContadorM3} m3 (foto del ${input.fecha}). ${previousNote} Consumo calculado: ${consumoL} L. Linea tratamiento: ${lineaTratamientoL} L. Drencher: ${drencherL} L.`,
  };
}

export function buildTratamientoWaterMeterConsumoFromReading(input: WaterMeterTratamientoReadingInput): DailyWaterMeterConsumo {
  const lecturaContadorM3 = finiteOrZero(input.lecturaContadorM3);
  const lecturaAnteriorM3 = input.lecturaAnteriorM3 == null ? null : finiteOrZero(input.lecturaAnteriorM3);
  const consumoM3 = lecturaAnteriorM3 == null ? 0 : Math.max(0, lecturaContadorM3 - lecturaAnteriorM3);
  const consumoL = consumoM3 * 1000;
  const diaAnterior = subtractOneDayLocal(input.fecha);
  const fechaInicio = input.fechaLecturaAnterior ?? fallbackFechaInicioSinLecturaAnterior(input.fecha);
  const previousNote = lecturaAnteriorM3 == null
    ? "Lectura anterior: sin referencia."
    : `Lectura anterior: ${lecturaAnteriorM3} m3${input.fechaLecturaAnterior ? ` (${input.fechaLecturaAnterior})` : ""}.`;

  return {
    recurso: "agua",
    fecha_inicio: fechaInicio,
    fecha_fin: diaAnterior,
    cantidad: consumoL,
    unidad: "l",
    fuente: "contador",
    referencia: "agua-contador-tratamiento",
    notas: `Lectura contador (m3): ${lecturaContadorM3} m3 (foto del ${input.fecha}). ${previousNote} Consumo calculado: ${consumoL} L.`,
  };
}

export function buildJabonWaterMeterConsumoFromReading(input: WaterMeterJabonReadingInput): DailyWaterMeterConsumo {
  const lecturaContadorL = finiteOrZero(input.lecturaContadorL);
  const lecturaAnteriorL = input.lecturaAnteriorL == null ? null : finiteOrZero(input.lecturaAnteriorL);
  const consumoL = lecturaAnteriorL == null ? 0 : Math.max(0, lecturaContadorL - lecturaAnteriorL);
  const diaAnterior = subtractOneDayLocal(input.fecha);
  const fechaInicio = input.fechaLecturaAnterior ?? fallbackFechaInicioSinLecturaAnterior(input.fecha);
  const previousNote = lecturaAnteriorL == null
    ? "Lectura anterior: sin referencia."
    : `Lectura anterior: ${lecturaAnteriorL} L${input.fechaLecturaAnterior ? ` (${input.fechaLecturaAnterior})` : ""}.`;

  return {
    recurso: "agua",
    fecha_inicio: fechaInicio,
    fecha_fin: diaAnterior,
    cantidad: consumoL,
    unidad: "l",
    fuente: "contador",
    referencia: "agua-contador-tratamiento-jabon",
    notas: `Lectura contador (L): ${lecturaContadorL} L (foto del ${input.fecha}). ${previousNote} Consumo calculado: ${consumoL} L.`,
  };
}

export function parseWaterMeterReading(consumo: Pick<ConsumoFisicoInput, "referencia" | "notas">): { lecturaM3: number | null; lecturaL: number | null } {
  const notes = consumo.notas ?? "";
  const matchM3 = notes.match(/Lectura contador(?: \(m3\))?:\s*([0-9.,\s]+)/i);
  const matchL = notes.match(/Lectura contador \(L\):\s*([0-9.,\s]+)/i);
  const invoiceMatch = notes.match(/Lecturas:\s*[0-9.,\s]+\s*->\s*([0-9.,\s]+)/i);
  const ref = normalizeText(consumo.referencia ?? "");
  const useLiters = ref === "agua-contador-tratamiento-jabon";

  if (useLiters) {
    const text = matchL?.[1] ?? matchM3?.[1] ?? invoiceMatch?.[1];
    if (!text) {
      return { lecturaM3: null, lecturaL: null };
    }
    const value = parseConsumoNumber(text);
    return { lecturaM3: null, lecturaL: value > 0 ? value : null };
  }

  const text = matchM3?.[1] ?? invoiceMatch?.[1];
  if (!text) {
    return { lecturaM3: null, lecturaL: null };
  }
  const value = parseConsumoNumber(text);
  return { lecturaM3: value > 0 ? value : null, lecturaL: null };
}

export function parseWaterMeterReadingM3(input: Pick<ConsumoFisicoInput, "notas">): number | null {
  const { lecturaM3 } = parseWaterMeterReading(input);
  return lecturaM3;
}

/**
 * Extrae la fecha REAL de la foto/lectura desde las notas (formato "(foto del
 * YYYY-MM-DD)", escrito por los builders de lectura). Necesario porque desde la
 * REGLA 1 la fila guarda el consumo en [fecha_inicio, fecha_fin] = día(s) anterior(es)
 * a la foto, así que fecha_fin ya NO es la fecha de la lectura en sí: la foto real es
 * fecha_fin + 1. Para filas sin esa anotación (facturas "factura_detallada", datos
 * antiguos sin la nota) se usa ese mismo fallback fecha_fin + 1 día como aproximación:
 * una factura cubre consumo HASTA fecha_fin, así que la siguiente lectura/lectura debe
 * anclarse en fecha_fin + 1, nunca en fecha_fin (eso duplicaría ese último día al
 * solaparse con el rango de la lectura siguiente).
 */
export function extractFotoFecha(consumo: Pick<ConsumoFisicoInput, "notas" | "fecha_fin">): string {
  const notes = consumo.notas ?? "";
  const match = notes.match(/foto del (\d{4}-\d{2}-\d{2})/i);
  return match ? match[1] : addOneDayLocal(consumo.fecha_fin);
}

export function findPreviousWaterMeterReading(
  consumos: ConsumoFisicoInput[],
  fecha: string,
  referencia: WaterMeterReference = "agua-contador-general",
): WaterMeterReading | null {
  return consumos
    .filter((consumo) => {
      if (consumo.recurso !== "agua") return false;
      if (extractFotoFecha(consumo) >= fecha) return false;
      const { lecturaM3, lecturaL } = parseWaterMeterReading(consumo);
      if (lecturaM3 == null && lecturaL == null) return false;
      if (consumo.referencia === referencia) return true;
      // Las facturas de agua sin referencia de contador sirven como lectura
      // inicial del siguiente registro manual del mismo contador.
      if (consumo.fuente === "factura_detallada") return true;
      return false;
    })
    .map((consumo) => {
      const { lecturaM3, lecturaL } = parseWaterMeterReading(consumo);
      return {
        id: consumo.id,
        fecha: extractFotoFecha(consumo),
        lecturaM3,
        lecturaL,
        consumoL: normalizeConsumoCantidad(consumo).cantidadBase,
        referencia,
      };
    })
    .sort((a, b) => b.fecha.localeCompare(a.fecha))[0] ?? null;
}

export interface WaterBreakdown {
  tratamientoL: number;
  tratamientoJabonL: number;
}

/**
 * REGLA 2 (desglose informativo): tratamiento y tratamiento+jabon no suman al total
 * de agua (ver isWaterSubmeterReference / distributeWaterConsumptions), pero sí se
 * quieren mostrar como desglose de qué parte del consumo general fue de cada uno.
 * Prorratea por solape de días igual que el resto del reparto físico del módulo.
 */
export function waterBreakdownForRange(
  consumos: ConsumoFisicoInput[],
  start: string,
  end: string,
): WaterBreakdown {
  const period: ConsumptionPeriod = {
    periodo: "",
    fechaInicio: start,
    fechaFin: end,
    startMs: dateToUtcMs(start),
    endMs: dateToUtcMs(end),
  };

  return consumos.reduce<WaterBreakdown>(
    (acc, consumo) => {
      if (consumo.recurso !== "agua") {
        return acc;
      }

      const ref = normalizeText(consumo.referencia ?? "");
      if (ref !== "agua-contador-tratamiento" && ref !== "agua-contador-tratamiento-jabon") {
        return acc;
      }

      const factor = overlapFactor(consumo.fecha_inicio, consumo.fecha_fin, period);
      if (factor <= 0) {
        return acc;
      }

      const litros = normalizeConsumoCantidad(consumo).cantidadBase * factor;

      if (ref === "agua-contador-tratamiento") {
        acc.tratamientoL += litros;
      } else {
        acc.tratamientoJabonL += litros;
      }

      return acc;
    },
    { tratamientoL: 0, tratamientoJabonL: 0 },
  );
}

export function buildMonthlyConsumptionRows(input: BuildConsumptionRowsInput): ConsumoPeriodoRow[] {
  return buildConsumptionRows(input, buildMonthPeriods(input.rangeStart, input.rangeEnd), "monthly");
}

export function buildWeeklyConsumptionRows(input: BuildConsumptionRowsInput): ConsumoPeriodoRow[] {
  return buildConsumptionRows(input, buildCampaignWeekPeriods(input.rangeStart, input.rangeEnd), "weekly");
}

export function buildDailyConsumptionRows(input: BuildConsumptionRowsInput): ConsumoPeriodoRow[] {
  return buildConsumptionRows(input, buildDayPeriods(input.rangeStart, input.rangeEnd), "daily");
}

/**
 * Vista anual: un único periodo que cubre todo [rangeStart, rangeEnd] (normalmente
 * una campaña completa). Reutiliza la granularidad "monthly" a propósito: es la más
 * gruesa que ya entiende el resto del reparto (proxy de palets, huecos de gasoil sin
 * kg en el tramo), y una campaña entera nunca debería tener menos cobertura que un mes.
 */
export function buildAnnualConsumptionRows(input: BuildConsumptionRowsInput): ConsumoPeriodoRow[] {
  return buildConsumptionRows(input, buildYearPeriods(input.rangeStart, input.rangeEnd), "monthly");
}

function buildConsumptionRows(input: BuildConsumptionRowsInput, periods: ConsumptionPeriod[], granularity: PeriodGranularity): ConsumoPeriodoRow[] {
  const usePaletsAsProxy = shouldUsePaletsAsProxy(input, granularity);
  const gasoilLByPeriod = distributeGasoilPurchases(input, periods, granularity, usePaletsAsProxy);
  const aguaLByPeriod = distributeWaterConsumptions(input, periods, granularity, usePaletsAsProxy);

  return periods.map((period, index) => {
    const totals = totalConsumosForPeriod(input.consumos, period);
    totals.aguaL = aguaLByPeriod[index] ?? 0;
    totals.gasoilL = gasoilLByPeriod[index] ?? 0;
    const kgPartes = totalPartesForPeriod(input.partes, period);
    const kgPalets = totalBasesForPeriod(input.basesKg, period, "palets", granularity);
    const kgVentas = totalBasesForPeriod(input.basesKg, period, "ventas", granularity);
    const kgManual = totalBasesForPeriod(input.basesKg, period, "manual", granularity);
    const proxyKg = usePaletsAsProxy && kgPalets > 0 ? kgPalets : kgVentas > 0 ? kgVentas : kgManual;
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
      kgPalets,
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
      if (consumo.recurso === "agua" || consumo.recurso === "gasoil") {
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

/**
 * REGLA 2 (subcontadores): tratamiento y tratamiento+jabon son SUBCONTADORES del
 * contador general -su consumo ya viaja dentro del delta del general-, así que jamás
 * deben sumarse al total de agua (ni como lectura diaria exacta, ni por reparto
 * proporcional). Solo sirven para el desglose informativo (ver waterBreakdownForRange).
 */
function isWaterSubmeterReference(reference: string | null | undefined): boolean {
  const normalizedReference = normalizeText(reference ?? "");
  return normalizedReference === "agua-contador-tratamiento"
    || normalizedReference === "agua-contador-tratamiento-jabon";
}

function distributeWaterConsumptions(
  input: BuildConsumptionRowsInput,
  periods: ConsumptionPeriod[],
  granularity: PeriodGranularity,
  usePaletsAsProxy: boolean,
): number[] {
  const result = periods.map(() => 0);
  const rangeStartMs = dateToUtcMs(input.rangeStart);
  const rangeEndMs = dateToUtcMs(input.rangeEnd);
  const exactReadings = dailyAllWaterMeterReadings(input.consumos, rangeStartMs, rangeEndMs);
  const exactReadingDates = new Set(exactReadings.keys());

  addDailyWaterReadingsToPeriods(result, periods, exactReadings);

  input.consumos.forEach((consumo) => {
    if (consumo.recurso !== "agua") {
      return;
    }

    if (isWaterSubmeterReference(consumo.referencia)) {
      return;
    }

    if (isDailyMeterReading(consumo)) {
      return;
    }

    const normalized = normalizeConsumoCantidad(consumo);
    const litros = normalized.cantidadBase;
    const startMs = Math.max(dateToUtcMs(consumo.fecha_inicio), rangeStartMs);
    const endMs = Math.min(dateToUtcMs(consumo.fecha_fin), rangeEndMs);

    if (litros <= 0 || endMs < startMs) {
      return;
    }

    const remainingLitros = Math.max(0, litros - exactWaterLitersForRange(exactReadings, startMs, endMs));
    if (remainingLitros <= 0) {
      return;
    }

    const tramoKg = waterDistributionKgForRange(input, startMs, endMs, granularity, usePaletsAsProxy, exactReadingDates);

    if (tramoKg <= 0) {
      return;
    }

    periods.forEach((period, periodIndex) => {
      const overlapStartMs = Math.max(startMs, period.startMs);
      const overlapEndMs = Math.min(endMs, period.endMs);

      if (overlapEndMs < overlapStartMs) {
        return;
      }

      const overlapKg = waterDistributionKgForRange(input, overlapStartMs, overlapEndMs, granularity, usePaletsAsProxy, exactReadingDates);
      if (overlapKg <= 0) {
        return;
      }

      result[periodIndex] += remainingLitros * (overlapKg / tramoKg);
    });
  });

  return result;
}

function dailyAllWaterMeterReadings(consumos: ConsumoFisicoInput[], rangeStartMs: number, rangeEndMs: number): Map<number, number> {
  const readings = new Map<number, number>();

  consumos.forEach((consumo) => {
    if (!isDailyMeterReading(consumo)) {
      return;
    }

    const dateMs = dateToUtcMs(consumo.fecha_inicio);
    if (dateMs < rangeStartMs || dateMs > rangeEndMs) {
      return;
    }

    const normalized = normalizeConsumoCantidad(consumo);
    readings.set(dateMs, (readings.get(dateMs) ?? 0) + normalized.cantidadBase);
  });

  return readings;
}

function isDailyMeterReading(consumo: ConsumoFisicoInput): boolean {
  return consumo.recurso === "agua"
    && consumo.fuente === "contador"
    && consumo.fecha_inicio === consumo.fecha_fin
    && !isWaterBreakdownReference(consumo.referencia)
    && !isWaterSubmeterReference(consumo.referencia);
}

function isWaterBreakdownReference(reference: string | null | undefined): boolean {
  const normalizedReference = normalizeText(reference ?? "");
  return normalizedReference === "agua-linea-tratamiento"
    || normalizedReference === "agua-drencher"
    || normalizedReference === "linea-tratamiento"
    || normalizedReference === "drencher";
}

function addDailyWaterReadingsToPeriods(result: number[], periods: ConsumptionPeriod[], readings: Map<number, number>): void {
  readings.forEach((litros, dateMs) => {
    periods.forEach((period, periodIndex) => {
      if (dateMs >= period.startMs && dateMs <= period.endMs) {
        result[periodIndex] += litros;
      }
    });
  });
}

function exactWaterLitersForRange(readings: Map<number, number>, startMs: number, endMs: number): number {
  let total = 0;

  readings.forEach((litros, dateMs) => {
    if (dateMs >= startMs && dateMs <= endMs) {
      total += litros;
    }
  });

  return total;
}

function waterDistributionKgForRange(
  input: BuildConsumptionRowsInput,
  startMs: number,
  endMs: number,
  granularity: PeriodGranularity,
  usePaletsAsProxy: boolean,
  excludedDateMs: Set<number>,
): number {
  if (excludedDateMs.size === 0 || !rangeHasAnyDate(startMs, endMs, excludedDateMs)) {
    return kgBaseForRange(input, startMs, endMs, granularity, usePaletsAsProxy);
  }

  let total = 0;
  let segmentStartMs: number | null = null;
  let segmentEndMs: number | null = null;

  const flushSegment = () => {
    if (segmentStartMs != null && segmentEndMs != null) {
      total += kgBaseForRange(input, segmentStartMs, segmentEndMs, granularity, usePaletsAsProxy);
      segmentStartMs = null;
      segmentEndMs = null;
    }
  };

  for (let currentMs = startMs; currentMs <= endMs; currentMs += MS_PER_DAY) {
    if (excludedDateMs.has(currentMs)) {
      flushSegment();
      continue;
    }

    segmentStartMs ??= currentMs;
    segmentEndMs = currentMs;
  }

  flushSegment();

  return total;
}

function rangeHasAnyDate(startMs: number, endMs: number, dates: Set<number>): boolean {
  for (let currentMs = startMs; currentMs <= endMs; currentMs += MS_PER_DAY) {
    if (dates.has(currentMs)) {
      return true;
    }
  }

  return false;
}

function distributeGasoilPurchases(
  input: BuildConsumptionRowsInput,
  periods: ConsumptionPeriod[],
  granularity: PeriodGranularity,
  usePaletsAsProxy: boolean,
): number[] {
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

    const tramoKg = kgBaseForRange(input, startMs, endMs, granularity, usePaletsAsProxy);

    if (tramoKg <= 0) {
      if (granularity !== "monthly") {
        return;
      }

      addGasoilToPurchasePeriod(result, periods, startMs, purchase.litros);
      return;
    }

    periods.forEach((period, periodIndex) => {
      const overlapStartMs = Math.max(startMs, period.startMs);
      const overlapEndMs = Math.min(endMs, period.endMs);

      if (overlapEndMs < overlapStartMs) {
        return;
      }

      const overlapKg = kgBaseForRange(input, overlapStartMs, overlapEndMs, granularity, usePaletsAsProxy);
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

function kgBaseForRange(
  input: BuildConsumptionRowsInput,
  startMs: number,
  endMs: number,
  granularity: PeriodGranularity,
  usePaletsAsProxy: boolean,
): number {
  const period = periodFromRange(startMs, endMs);
  const kgPartes = totalPartesForPeriod(input.partes, period);
  const kgPalets = totalBasesForPeriod(input.basesKg, period, "palets", granularity);
  const kgVentas = totalBasesForPeriod(input.basesKg, period, "ventas", granularity);
  const kgManual = totalBasesForPeriod(input.basesKg, period, "manual", granularity);

  if (kgPartes > 0) {
    return kgPartes;
  }

  if (usePaletsAsProxy && kgPalets > 0) {
    return kgPalets;
  }

  return kgVentas > 0 ? kgVentas : kgManual;
}

function shouldUsePaletsAsProxy(input: BuildConsumptionRowsInput, granularity: PeriodGranularity): boolean {
  if (granularity !== "monthly") {
    return true;
  }

  const months = buildMonthPeriods(input.rangeStart, input.rangeEnd);
  if (months.length === 0) {
    return false;
  }

  return months.every((monthPeriod) => (
    totalBasesForPeriod(input.basesKg, monthPeriod, "palets", "monthly") > 0
  ));
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

function totalBasesForPeriod(
  basesKg: BaseKgInput[],
  period: ConsumptionPeriod,
  tipoBase: BaseKgTipo,
  granularity: PeriodGranularity,
): number {
  return basesKg.reduce((total, base) => {
    if (base.tipo_base !== tipoBase) {
      return total;
    }

    if (tipoBase !== "palets" && granularity !== "monthly" && !sameDateRange(base.fecha_inicio, base.fecha_fin, period)) {
      return total;
    }

    return total + (finiteOrZero(base.kg) * overlapFactor(base.fecha_inicio, base.fecha_fin, period));
  }, 0);
}

function sameDateRange(fechaInicio: string, fechaFin: string, period: ConsumptionPeriod): boolean {
  return dateToUtcMs(fechaInicio) === period.startMs && dateToUtcMs(fechaFin) === period.endMs;
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

function buildCampaignWeekPeriods(rangeStart: string, rangeEnd: string): ConsumptionPeriod[] {
  const rangeStartMs = dateToUtcMs(rangeStart);
  const rangeEndMs = dateToUtcMs(rangeEnd);
  const weeks: ConsumptionPeriod[] = [];
  let weekNumber = 1;

  for (let weekStartMs = rangeStartMs; weekStartMs <= rangeEndMs; weekStartMs += 7 * MS_PER_DAY) {
    const weekEndMs = weekStartMs + (6 * MS_PER_DAY);
    const startMs = weekStartMs;
    const endMs = Math.min(weekEndMs, rangeEndMs);

    if (startMs <= endMs) {
      weeks.push({
        periodo: `S${pad2(weekNumber)}`,
        fechaInicio: utcMsToDateString(startMs),
        fechaFin: utcMsToDateString(endMs),
        startMs,
        endMs,
      });
    }

    weekNumber += 1;
  }

  return weeks;
}

function buildYearPeriods(rangeStart: string, rangeEnd: string): ConsumptionPeriod[] {
  const rangeStartMs = dateToUtcMs(rangeStart);
  const rangeEndMs = dateToUtcMs(rangeEnd);

  if (rangeEndMs < rangeStartMs) {
    return [];
  }

  // Año agrícola: septiembre a agosto. Si el inicio del rango ya cae en
  // septiembre o después, la campaña es (año, año+1); si cae antes, (año-1, año).
  const start = parseDateParts(rangeStart);
  const campaignStartYear = start.month >= 9 ? start.year : start.year - 1;

  return [{
    periodo: `${campaignStartYear}-${campaignStartYear + 1}`,
    fechaInicio: rangeStart,
    fechaFin: rangeEnd,
    startMs: rangeStartMs,
    endMs: rangeEndMs,
  }];
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

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
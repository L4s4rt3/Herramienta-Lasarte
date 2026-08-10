/**
 * economico.ts — lógica pura del "modo económico": tarifas de recursos
 * (public.economico_precios) y coste de los consumos físicos ya calculados
 * por src/lib/consumosFisicos.ts / src/lib/consumoPeriodoView.ts.
 *
 * REGLA HISTÓRICO: el precio aplicable a una fecha es la fila con mayor
 * `vigente_desde` que sea <= esa fecha (ver `tarifaVigente`/`precioVigente`).
 * Cambiar de tarifa implica insertar una fila nueva, nunca editar la antigua
 * (salvo corrección de errata, que sí se permite editar/borrar desde la UI).
 *
 * Este módulo NO reimplementa las reglas de reparto de agua/gasoil de
 * consumosFisicos.ts (subcontadores que no suman, reparto por kg en tramos
 * multi-día, etc.) — el hook `useCostesPeriodo` reutiliza directamente
 * `buildDailyConsumptionRows` para el agua. Lo único nuevo aquí es:
 * - la resolución de tarifa vigente por fecha/recurso,
 * - la conversión de unidades de consumo a unidad de tarifa,
 * - el reparto por solape de días de `sesiones_consumo` (tabla propia del
 *   modo económico, sin reparto existente que reutilizar), y
 * - la agregación de costes por recurso/semana.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface EconomicoPrecioInput {
  recurso: string;
  unidad: string;
  precio_por_unidad: number;
  vigente_desde: string; // "YYYY-MM-DD"
}

/**
 * Fila de tarifa vigente en `fecha` para `recurso`: la de mayor `vigente_desde`
 * que sea <= fecha. `null` si no hay ninguna tarifa aplicable todavía.
 */
export function tarifaVigente<T extends EconomicoPrecioInput>(
  precios: T[],
  recurso: string,
  fecha: string,
): T | null {
  let mejor: T | null = null;
  for (const p of precios) {
    if (p.recurso !== recurso) continue;
    if (p.vigente_desde > fecha) continue;
    if (!mejor || p.vigente_desde > mejor.vigente_desde) {
      mejor = p;
    }
  }
  return mejor;
}

/** Precio por unidad vigente en `fecha` para `recurso`, o `null` si no hay tarifa. */
export function precioVigente(precios: EconomicoPrecioInput[], recurso: string, fecha: string): number | null {
  const tarifa = tarifaVigente(precios, recurso, fecha);
  return tarifa ? tarifa.precio_por_unidad : null;
}

// ─── Conversión de unidades ─────────────────────────────────────────────────

/**
 * Factores de conversión soportados, extensibles según se necesiten más
 * recursos/unidades. Clave "desde->hasta".
 */
const CONVERSION_FACTORS: Record<string, number> = {
  "l->m3": 1 / 1000,
  "m3->l": 1000,
  "l->l": 1,
  "m3->m3": 1,
  "kwh->kwh": 1,
};

/** Convierte `cantidad` de la unidad `desde` a la unidad `hasta`. Lanza si la combinación no está soportada. */
export function convertirUnidad(cantidad: number, desde: string, hasta: string): number {
  if (desde === hasta) return cantidad;
  const factor = CONVERSION_FACTORS[`${desde}->${hasta}`];
  if (factor == null) {
    throw new Error(`Conversion de unidad no soportada: ${desde} -> ${hasta}`);
  }
  return cantidad * factor;
}

export interface PrecioUnidad {
  unidad: string;
  precio_por_unidad: number;
}

/** Coste de `cantidad` (en `unidadConsumo`) al precio de tarifa `precio` (en su propia unidad). */
export function costeConsumo(cantidad: number, unidadConsumo: string, precio: PrecioUnidad): number {
  if (!Number.isFinite(cantidad) || cantidad <= 0) return 0;
  if (!Number.isFinite(precio.precio_por_unidad) || precio.precio_por_unidad === 0) return 0;
  const cantidadConvertida = convertirUnidad(cantidad, unidadConsumo, precio.unidad);
  return cantidadConvertida * precio.precio_por_unidad;
}

// ─── Agregación de costes ────────────────────────────────────────────────────

export interface CosteEntrada {
  recurso: string;
  /** Fecha (día) a la que se atribuye la cantidad, usada para resolver tarifa y agrupar por semana. */
  fecha: string;
  cantidad: number;
  unidadConsumo: string;
}

export interface CostePorRecurso {
  recurso: string;
  cantidad: number;
  unidad: string;
  coste: number;
  /** Unidad de la tarifa aplicada (null si nunca hubo tarifa vigente para este recurso). */
  unidadPrecio: string | null;
  /** Precio medio efectivo (coste / cantidad convertida a unidadPrecio). Null si no hay coste. */
  precioMedio: number | null;
}

/** Agrupa entradas de coste por recurso, sumando cantidad y coste (helper de agregación de costeConsumo/tarifaVigente). */
export function agregarCostesPorRecurso(entradas: CosteEntrada[], precios: EconomicoPrecioInput[]): CostePorRecurso[] {
  interface Acc {
    cantidad: number;
    coste: number;
    unidadConsumo: string;
    cantidadConvertida: number;
    unidadPrecio: string | null;
  }
  const grupos = new Map<string, Acc>();

  for (const entrada of entradas) {
    if (!Number.isFinite(entrada.cantidad) || entrada.cantidad <= 0) continue;

    const tarifa = tarifaVigente(precios, entrada.recurso, entrada.fecha);
    const coste = tarifa ? costeConsumo(entrada.cantidad, entrada.unidadConsumo, tarifa) : 0;

    const acc = grupos.get(entrada.recurso) ?? {
      cantidad: 0,
      coste: 0,
      unidadConsumo: entrada.unidadConsumo,
      cantidadConvertida: 0,
      unidadPrecio: null,
    };

    acc.cantidad += entrada.cantidad;
    acc.coste += coste;
    if (tarifa) {
      acc.cantidadConvertida += convertirUnidad(entrada.cantidad, entrada.unidadConsumo, tarifa.unidad);
      acc.unidadPrecio = tarifa.unidad;
    }

    grupos.set(entrada.recurso, acc);
  }

  return Array.from(grupos.entries()).map(([recurso, acc]) => ({
    recurso,
    cantidad: acc.cantidad,
    unidad: acc.unidadConsumo,
    coste: acc.coste,
    unidadPrecio: acc.unidadPrecio,
    precioMedio: acc.cantidadConvertida > 0 ? acc.coste / acc.cantidadConvertida : null,
  }));
}

export interface CosteSemana {
  /** Lunes (ISO, "YYYY-MM-DD") de la semana. */
  semanaInicio: string;
  coste: number;
}

/** Lunes de la semana ISO que contiene `fecha`, calculado en horario local (mismo criterio que el resto de la app). */
export function mondayOfLocal(fecha: string): string {
  const [year, month, day] = fecha.split("-").map(Number);
  const date = new Date(year, month - 1, day, 12, 0, 0);
  const weekday = date.getDay();
  const diff = date.getDate() - weekday + (weekday === 0 ? -6 : 1);
  date.setDate(diff);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** Agrupa el coste total (todos los recursos) por semana ISO (lunes-domingo), ordenado ascendente. */
export function agregarCostesPorSemana(entradas: CosteEntrada[], precios: EconomicoPrecioInput[]): CosteSemana[] {
  const map = new Map<string, number>();

  for (const entrada of entradas) {
    if (!Number.isFinite(entrada.cantidad) || entrada.cantidad <= 0) continue;

    const tarifa = tarifaVigente(precios, entrada.recurso, entrada.fecha);
    const coste = tarifa ? costeConsumo(entrada.cantidad, entrada.unidadConsumo, tarifa) : 0;
    const semanaInicio = mondayOfLocal(entrada.fecha);
    map.set(semanaInicio, (map.get(semanaInicio) ?? 0) + coste);
  }

  return Array.from(map.entries())
    .map(([semanaInicio, coste]) => ({ semanaInicio, coste }))
    .sort((a, b) => a.semanaInicio.localeCompare(b.semanaInicio));
}

// ─── Coste de compra de fruta (entradas_bascula, ver useEconomico.ts) ───────

export interface CosteFrutaEntradaInput {
  fecha: string; // "YYYY-MM-DD"
  kg_entrada: number;
  importe_compra: number | null;
  coste_recoleccion: number | null;
  importe_transporte: number | null;
  importe_comision: number | null;
  importe_total: number | null;
}

export interface CosteFrutaDesglose {
  compra: number;
  recoleccion: number;
  transporte: number;
  comision: number;
}

export interface CosteFrutaSemana {
  /** Lunes (ISO) de la semana, misma clave que CosteSemana/GastoMallasSemana. */
  semanaInicio: string;
  coste: number;
}

export interface AgregadoCosteFruta {
  totalImporte: number;
  desglose: CosteFrutaDesglose;
  kgTotales: number;
  serieSemanal: CosteFrutaSemana[];
}

/**
 * Importe de UNA entrada de báscula: `importe_total` si el export lo trae
 * relleno; si no, la suma de sus componentes (compra + recolección +
 * transporte + comisión, cada uno 0 si falta). Los componentes ya vienen en
 * euros desde el export (no hay que multiplicar por kg).
 */
export function importeEntradaFruta(entrada: CosteFrutaEntradaInput): number {
  if (entrada.importe_total != null && Number.isFinite(entrada.importe_total)) {
    return entrada.importe_total;
  }
  return (entrada.importe_compra ?? 0)
    + (entrada.coste_recoleccion ?? 0)
    + (entrada.importe_transporte ?? 0)
    + (entrada.importe_comision ?? 0);
}

/**
 * Agrega el coste de compra de fruta de un periodo a partir de las entradas
 * de báscula ya filtradas por rango (y sin las filas `origen='stock_inicial'`,
 * ver criterio en `useCosteFruta`): total, desglose por componente, kg
 * totales y serie semanal (misma clave de lunes ISO que `agregarCostesPorSemana`
 * y `gastoMallasPorSemana`, para poder cruzarla si hiciera falta).
 */
export function agregarCosteFruta(entradas: CosteFrutaEntradaInput[]): AgregadoCosteFruta {
  let totalImporte = 0;
  let kgTotales = 0;
  const desglose: CosteFrutaDesglose = { compra: 0, recoleccion: 0, transporte: 0, comision: 0 };
  const semanaMap = new Map<string, number>();

  for (const entrada of entradas) {
    const importe = importeEntradaFruta(entrada);
    totalImporte += importe;
    kgTotales += Number.isFinite(entrada.kg_entrada) ? entrada.kg_entrada : 0;
    desglose.compra += entrada.importe_compra ?? 0;
    desglose.recoleccion += entrada.coste_recoleccion ?? 0;
    desglose.transporte += entrada.importe_transporte ?? 0;
    desglose.comision += entrada.importe_comision ?? 0;

    const semanaInicio = mondayOfLocal(entrada.fecha);
    semanaMap.set(semanaInicio, (semanaMap.get(semanaInicio) ?? 0) + importe);
  }

  const serieSemanal = Array.from(semanaMap.entries())
    .map(([semanaInicio, coste]) => ({ semanaInicio, coste }))
    .sort((a, b) => a.semanaInicio.localeCompare(b.semanaInicio));

  return { totalImporte, desglose, kgTotales, serieSemanal };
}

// ─── Meses que solapan un rango (datos mensuales: ventas_categoria_*) ───────

/**
 * Claves "YYYY-MM" de todos los meses naturales que solapan [desde, hasta]
 * (ambos inclusive). Usado para sumar datos que solo existen con granularidad
 * mensual (ventas_categoria_mensual_cliente del importador mensual, ver
 * ventasMensualImport.ts) dentro de un rango de fechas diario: al no haber
 * reparto diario en el origen, un mes que solape aunque sea parcialmente se
 * cuenta ENTERO (no se prorratea) — ver useEconomicoPanel para el criterio de
 * uso completo.
 */
export function mesesEnRango(desde: string, hasta: string): string[] {
  const [y1, m1] = desde.split("-").map(Number);
  const [y2, m2] = hasta.split("-").map(Number);
  const meses: string[] = [];
  let year = y1;
  let month = m1;
  while (year < y2 || (year === y2 && month <= m2)) {
    meses.push(`${year}-${String(month).padStart(2, "0")}`);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return meses;
}

// ─── Reparto por solape de días (sesiones_consumo) ──────────────────────────

function toUtcMs(date: string): number {
  const [year, month, day] = date.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

function inclusiveDays(startMs: number, endMs: number): number {
  if (endMs < startMs) return 0;
  return Math.floor((endMs - startMs) / MS_PER_DAY) + 1;
}

/**
 * Porción de `cantidad` (repartida uniformemente entre los días de
 * [fechaInicio, fechaFin]) que cae dentro de [rangoInicio, rangoFin].
 * Usado para sesiones_consumo, que no tiene ningún reparto existente que
 * reutilizar (a diferencia del agua/gasoil de consumos_fisicos).
 */
export function solapeCantidadEnRango(
  fechaInicio: string,
  fechaFin: string,
  cantidad: number,
  rangoInicio: string,
  rangoFin: string,
): number {
  if (!Number.isFinite(cantidad) || cantidad <= 0) return 0;

  const startMs = toUtcMs(fechaInicio);
  const endMs = toUtcMs(fechaFin);
  const totalDias = inclusiveDays(startMs, endMs);
  if (totalDias <= 0) return 0;

  const rangoStartMs = toUtcMs(rangoInicio);
  const rangoEndMs = toUtcMs(rangoFin);
  const overlapStartMs = Math.max(startMs, rangoStartMs);
  const overlapEndMs = Math.min(endMs, rangoEndMs);
  const overlapDias = inclusiveDays(overlapStartMs, overlapEndMs);

  return overlapDias > 0 ? cantidad * (overlapDias / totalDias) : 0;
}

// ─── Prorrateo de ventas Mercadona por solape de días con un rango ──────────
//
// Mercadona reporta por semana (lunes-sábado, mercadonaWeekDateRange); varias
// pantallas necesitan atribuir esa venta semanal a un rango de días distinto
// (el mes natural del CMV, un periodo cualquiera de Consumos) prorrateando
// por solape de días con `solapeCantidadEnRango`. Esta función centraliza ese
// prorrateo para kg + facturación + kg por método (antes vivía inline en
// useCmv.ts). Los dos usos existentes difieren en si necesitan facturación y
// si filtran las semanas sin base_iva (ver `ProrratearVentasMercadonaOpciones`):
//  - useCmv.ts (CMV mensual): SÍ filtra por base_iva (soloConBaseIva=true) y
//    SÍ necesita facturación/kilosPorMetodo (conFacturacion=true) — el CMV
//    necesita €, y una semana sin base_iva no aporta ni kg fiables ni €.
//  - src/lib/consumosFisicos.ts (kgVendidosDerivados): mide kg FÍSICOS
//    vendidos, no facturación — por eso NO filtra por base_iva (semanas
//    históricas sin base_iva sí tienen vendido_kg válido) y no necesita el
//    desglose por método. Mantiene su propio prorrateo (mismo cálculo, otra
//    semántica) en vez de llamar aquí con conFacturacion=false — ver el
//    comentario cruzado en su cabecera (sección "kg vendidos DERIVADOS").

export interface VentaMercadonaSemanaProrrateoInput {
  /** Lunes de la semana (rango L-S de Mercadona, mercadonaWeekDateRange). */
  desde: string;
  /** Sábado de la semana. */
  hasta: string;
  /** true si la semana trae base_iva real (tieneBaseIvaSemana de useEconomico.ts). */
  tieneBaseIva: boolean;
  vendidoKg: number;
  /** Suma de base_iva de los métodos de la semana. */
  baseIvaMetodos: number;
  ajustesBaseIva: number;
  metodos: { metodo: string; kilos: number }[];
}

export interface VentaMercadonaMetodoKilos {
  metodo: string;
  kilos: number;
}

export interface VentasMercadonaProrrateadas {
  kg: number;
  facturacion: number;
  /** Nº de semanas que aportaron algo al rango (kg o facturación > 0). */
  semanas: number;
  kilosPorMetodo: VentaMercadonaMetodoKilos[];
}

export interface ProrratearVentasMercadonaOpciones {
  /** Excluye del todo las semanas sin base_iva (no cuentan ni kg ni €). */
  soloConBaseIva: boolean;
  /** Si false, no calcula facturación ni kilosPorMetodo (kg físico puro, sin €). */
  conFacturacion: boolean;
}

/**
 * Prorratea kg + facturación + kg por método de varias semanas Mercadona por
 * solape de días con [rangoDesde, rangoHasta]. Ver cabecera de esta sección
 * para el porqué de `opciones` y quién usa cada combinación.
 */
export function prorratearVentasMercadonaEnRango(
  semanas: VentaMercadonaSemanaProrrateoInput[],
  rangoDesde: string,
  rangoHasta: string,
  opciones: ProrratearVentasMercadonaOpciones,
): VentasMercadonaProrrateadas {
  let kg = 0;
  let facturacion = 0;
  let semanasCount = 0;
  const porMetodo = new Map<string, number>();

  for (const semana of semanas) {
    if (opciones.soloConBaseIva && !semana.tieneBaseIva) continue;

    const kgMes = solapeCantidadEnRango(semana.desde, semana.hasta, semana.vendidoKg, rangoDesde, rangoHasta);

    let netoMes = 0;
    if (opciones.conFacturacion) {
      const netoSemana = semana.baseIvaMetodos + semana.ajustesBaseIva;
      netoMes = netoSemana === 0
        ? 0
        : Math.sign(netoSemana) * solapeCantidadEnRango(semana.desde, semana.hasta, Math.abs(netoSemana), rangoDesde, rangoHasta);
    }

    if (kgMes <= 0 && netoMes === 0) continue;
    semanasCount += 1;
    kg += kgMes;
    facturacion += netoMes;

    if (opciones.conFacturacion) {
      for (const metodo of semana.metodos) {
        const kilosMes = solapeCantidadEnRango(semana.desde, semana.hasta, metodo.kilos, rangoDesde, rangoHasta);
        if (kilosMes <= 0) continue;
        const clave = metodo.metodo.toUpperCase();
        porMetodo.set(clave, (porMetodo.get(clave) ?? 0) + kilosMes);
      }
    }
  }

  return {
    kg,
    facturacion,
    semanas: semanasCount,
    kilosPorMetodo: Array.from(porMetodo.entries()).map(([metodo, kilos]) => ({ metodo, kilos })),
  };
}

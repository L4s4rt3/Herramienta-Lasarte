/**
 * costeMallas.ts — lógica pura del gasto de "mallas rotas": en Z1 se usa un
 * tipo de malla y en Z2 otro, cada una con su propio peso de fruta por malla
 * y su propio precio. El reciclado de malla de `partes_diarios`
 * (`kg_reciclado_malla_z1`/`_z2`) es la señal de cuánta malla se ha roto:
 *
 *   nº mallas rotas = kg reciclados de la zona / kg de fruta por malla de la zona
 *   gasto           = nº mallas rotas × precio por malla de la zona
 *
 * REGLA HISTÓRICO (igual que `tarifaVigente`/`precioVigente` en
 * src/lib/economico.ts): la config aplicable a una fecha es la fila de mayor
 * `vigente_desde` <= esa fecha, por zona. Un cambio real de peso/precio de
 * malla implica dar de alta una fila nueva en `economico_mallas_config`,
 * nunca editar la vigencia anterior.
 */

export type ZonaMalla = "z1" | "z2";

export interface MallaConfigInput {
  zona: string;
  tipo_malla: string | null;
  kg_por_malla: number | null;
  precio_malla: number | null;
  vigente_desde: string; // "YYYY-MM-DD"
}

/**
 * Fila de config vigente en `fecha` para `zona`: la de mayor `vigente_desde`
 * que sea <= fecha. `null` si no hay ninguna config aplicable todavía.
 */
export function configVigente<T extends MallaConfigInput>(
  configs: T[],
  zona: ZonaMalla,
  fecha: string,
): T | null {
  let mejor: T | null = null;
  for (const c of configs) {
    if (c.zona !== zona) continue;
    if (c.vigente_desde > fecha) continue;
    if (!mejor || c.vigente_desde > mejor.vigente_desde) {
      mejor = c;
    }
  }
  return mejor;
}

/** "Malla 3 kg" / "3kg" / "MALLA 5KG…" → "3kg" | "5kg" | null. */
export function tipoMallaDeTexto(texto: string | null | undefined): "3kg" | "5kg" | null {
  const match = String(texto ?? "").match(/([35])\s*kg/i);
  return match ? (`${match[1]}kg` as "3kg" | "5kg") : null;
}

/** De dónde viene el precio EFECTIVO que se usa para valorar una malla rota. */
export type FuentePrecioMalla = "envasado" | "manual";

export interface PrecioMallaResuelto {
  precio: number | null;
  /** `null` si no hay precio de ningún lado (ni envasado ni manual). */
  fuente: FuentePrecioMalla | null;
}

/**
 * Resuelve el precio EFECTIVO de una malla rota y de dónde viene: el coste
 * TOTAL de envasado por malla (empaque_precios, ver costeEmpaque.ts) manda
 * cuando el tipo de malla de la zona casa con 3kg/5kg y tiene precio; el
 * precio manual de economico_mallas_config es solo el respaldo para zonas
 * sin coste de envasado (aún) configurado. Fuente única = envasado — el
 * manual no debe rellenarse si el envasado ya cubre el tipo de la zona.
 */
export function resolverPrecioMalla<T extends MallaConfigInput>(
  config: T | null,
  totalPorTipo: Partial<Record<"3kg" | "5kg", number>>,
): PrecioMallaResuelto {
  if (!config) return { precio: null, fuente: null };
  const tipo = tipoMallaDeTexto(config.tipo_malla);
  const total = tipo ? totalPorTipo[tipo] : undefined;
  if (total != null && Number.isFinite(total) && total > 0) {
    return { precio: total, fuente: "envasado" };
  }
  if (config.precio_malla != null && Number.isFinite(config.precio_malla) && config.precio_malla > 0) {
    return { precio: config.precio_malla, fuente: "manual" };
  }
  return { precio: null, fuente: null };
}

/**
 * El precio de la malla rota viene DIRECTO del coste total de envasado por
 * malla (empaque_precios, ver costeEmpaque.ts) cuando el tipo de malla de la
 * zona casa con 3kg/5kg. El precio manual de economico_mallas_config queda
 * solo como respaldo para tipos sin coste de envasado configurado.
 */
export function aplicarPrecioEmpaque<T extends MallaConfigInput>(
  config: T | null,
  totalPorTipo: Partial<Record<"3kg" | "5kg", number>>,
): T | null {
  if (!config) return null;
  const resuelto = resolverPrecioMalla(config, totalPorTipo);
  if (resuelto.fuente !== "envasado" || resuelto.precio == null) return config;
  return { ...config, precio_malla: resuelto.precio };
}

/** Nº de mallas rotas = kg reciclados / kg de fruta por malla. 0 si `kgPorMalla` es null/<=0. */
export function mallasRotas(kgReciclado: number, kgPorMalla: number | null | undefined): number {
  if (!Number.isFinite(kgReciclado) || kgReciclado <= 0) return 0;
  if (kgPorMalla == null || !Number.isFinite(kgPorMalla) || kgPorMalla <= 0) return 0;
  return kgReciclado / kgPorMalla;
}

/** Gasto = mallas rotas × precio por malla. 0 si falta cualquier dato necesario. */
export function gastoMallas(
  kgReciclado: number,
  kgPorMalla: number | null | undefined,
  precioMalla: number | null | undefined,
): number {
  const mallas = mallasRotas(kgReciclado, kgPorMalla);
  if (mallas <= 0) return 0;
  if (precioMalla == null || !Number.isFinite(precioMalla) || precioMalla <= 0) return 0;
  return mallas * precioMalla;
}

export interface KgRecicladoZonas {
  z1_kg: number;
  z2_kg: number;
}

export interface ParteRecicladoDia {
  date: string; // "YYYY-MM-DD"
  z1_kg: number;
  z2_kg: number;
}

export interface GastoMallasSemana {
  /** Lunes (ISO) de la semana, misma clave que CosteSemana de economico.ts. */
  semanaInicio: string;
  gasto: number;
}

/**
 * Gasto de mallas rotas por semana ISO (clave = lunes local), para sumarlo a la
 * serie semanal de costes del Panel económico. Usa la misma config vigente
 * para todo el rango (ver useCosteMallas: no hay vigencia por día individual).
 */
export function gastoMallasPorSemana(
  partes: ParteRecicladoDia[],
  configZ1: MallaConfigInput | null,
  configZ2: MallaConfigInput | null,
  mondayOf: (fecha: string) => string,
): GastoMallasSemana[] {
  const map = new Map<string, number>();
  for (const parte of partes) {
    const gasto = gastoMallas(parte.z1_kg, configZ1?.kg_por_malla, configZ1?.precio_malla)
      + gastoMallas(parte.z2_kg, configZ2?.kg_por_malla, configZ2?.precio_malla);
    if (gasto <= 0) continue;
    const semanaInicio = mondayOf(parte.date);
    map.set(semanaInicio, (map.get(semanaInicio) ?? 0) + gasto);
  }
  return Array.from(map.entries())
    .map(([semanaInicio, gasto]) => ({ semanaInicio, gasto }))
    .sort((a, b) => a.semanaInicio.localeCompare(b.semanaInicio));
}

export interface ZonaMallaResultado {
  kg: number;
  kgPorMalla: number | null;
  precioMalla: number | null;
  /** De dónde viene `precioMalla`: envasado, manual, o null si no se pasó. */
  fuentePrecio: FuentePrecioMalla | null;
  mallas: number;
  gasto: number;
}

export interface AgregadoGastoMallas {
  z1: ZonaMallaResultado;
  z2: ZonaMallaResultado;
  totalMallas: number;
  totalGasto: number;
  /** true si alguna zona con kg reciclado > 0 no tiene kg_por_malla o precio_malla (ni envasado ni manual). */
  faltanDatos: boolean;
}

function resultadoZona(
  kg: number,
  config: MallaConfigInput | null,
  fuentePrecio: FuentePrecioMalla | null = null,
): ZonaMallaResultado {
  const kgPorMalla = config?.kg_por_malla ?? null;
  const precioMalla = config?.precio_malla ?? null;
  return {
    kg,
    kgPorMalla,
    precioMalla,
    fuentePrecio,
    mallas: mallasRotas(kg, kgPorMalla),
    gasto: gastoMallas(kg, kgPorMalla, precioMalla),
  };
}

/**
 * Agrega el gasto de mallas rotas de Z1 y Z2 a partir de los kg reciclados
 * del periodo y la config vigente (ya resuelta por el llamador, ver
 * `configVigente`/`aplicarPrecioEmpaque`) de cada zona. `fuenteZ1`/`fuenteZ2`
 * son opcionales — solo para que la UI muestre de dónde viene el precio
 * usado (envasado o manual); no afectan al cálculo.
 */
export function agregarGastoMallas(
  kg: KgRecicladoZonas,
  configZ1: MallaConfigInput | null,
  configZ2: MallaConfigInput | null,
  fuenteZ1: FuentePrecioMalla | null = null,
  fuenteZ2: FuentePrecioMalla | null = null,
): AgregadoGastoMallas {
  const z1 = resultadoZona(kg.z1_kg, configZ1, fuenteZ1);
  const z2 = resultadoZona(kg.z2_kg, configZ2, fuenteZ2);
  const faltaZ1 = z1.kg > 0 && (z1.kgPorMalla == null || z1.precioMalla == null);
  const faltaZ2 = z2.kg > 0 && (z2.kgPorMalla == null || z2.precioMalla == null);

  return {
    z1,
    z2,
    totalMallas: z1.mallas + z2.mallas,
    totalGasto: z1.gasto + z2.gasto,
    faltanDatos: faltaZ1 || faltaZ2,
  };
}

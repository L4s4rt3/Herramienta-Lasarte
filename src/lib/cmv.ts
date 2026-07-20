// src/lib/cmv.ts — lógica pura del CMV (coste medio por kg VENDIDO) mensual.
//
// DEFINICIÓN (decisión de dirección, jul 2026, ver Económico → CMV):
//   CMV €/kg = (todos los costes imputables del mes) / (kg vendidos del mes)
//
// Dos reglas conceptuales que NO deben romperse al tocar este módulo:
// 1. La merma/podrido NO es un sumando: ya está pagada dentro del coste de
//    compra de fruta. Al dividir entre kg VENDIDOS (no comprados ni
//    producidos) la pérdida queda incorporada sola; sumarla aparte la
//    contaría dos veces. La merma se lee como la DIFERENCIA entre el €/kg
//    comprado y el CMV.
// 2. El CMV se compara contra el precio medio REAL de venta (pm_real, neto
//    de comisión/transporte de venta — misma convención que la vista
//    ventas_categoria_lineas_con_ajustes), nunca contra el bruto.
//
// El periodo base es el MES natural: las ventas de categoría (1ª/2ª) solo
// existen con granularidad mensual y los costes manuales (gestoría,
// estructura, transporte de salida) también llegan por meses. Mercadona es
// semanal y se prorratea por solape de días (solapeCantidadEnRango).

import type { TipoMalla } from "@/lib/costeEmpaque";

// ─── Tipos de coste manual (tabla cmv_costes_mensuales) ─────────────────────

export type CmvTipoCosteManual = "personal_real" | "suministros" | "transporte_salida" | "estructura" | "otros";

export const CMV_TIPOS_MANUALES: CmvTipoCosteManual[] = [
  "personal_real", "suministros", "transporte_salida", "estructura", "otros",
];

export const CMV_TIPO_LABEL: Record<CmvTipoCosteManual, string> = {
  personal_real: "Personal (coste empresa real)",
  suministros: "Suministros (facturas reales)",
  transporte_salida: "Transporte de salida",
  estructura: "Estructura",
  otros: "Otros costes",
};

export const CMV_TIPO_HINT: Record<CmvTipoCosteManual, string> = {
  personal_real: "Coste empresa del mes según gestoría (nómina + Seguridad Social). Si se registra, sustituye a la estimación por asistencia.",
  suministros: "Bases sin IVA de las facturas del mes (electricidad, agua, gasoil...). Una fila por factura; el mes es el del CONSUMO (periodo de la factura), no el de emisión. Si se registran, sustituyen a la estimación por lecturas × tarifa del módulo de Consumos.",
  transporte_salida: "Facturas de transporte a cliente del mes (los CMR no llevan importe). Puede registrarse una fila por factura.",
  estructura: "Alquiler, seguros, amortización, financieros, gestoría... Importe mensual, se revisa por campaña.",
  otros: "Cualquier otro coste del mes que no capture ningún módulo.",
};

// ─── Mes natural ─────────────────────────────────────────────────────────────

/** Rango [primer día, último día] del mes natural "YYYY-MM". */
export function mesRango(mes: string): { desde: string; hasta: string } {
  const [year, month] = mes.split("-").map(Number);
  const ultimoDia = new Date(year, month, 0).getDate();
  return {
    desde: `${mes}-01`,
    hasta: `${mes}-${String(ultimoDia).padStart(2, "0")}`,
  };
}

const MES_NOMBRE = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

/** "2026-07" → "Julio 2026". */
export function formatMes(mes: string): string {
  const [year, month] = mes.split("-").map(Number);
  const nombre = MES_NOMBRE[month - 1] ?? mes;
  return `${nombre.charAt(0).toUpperCase()}${nombre.slice(1)} ${year}`;
}

/**
 * Fecha de referencia para el precio de envasado de un mes: el FIN del mes
 * consultado, o `hoy` si ese mes todavía no ha cerrado (llega al futuro).
 * Mismo criterio que useCosteMallas.ts para elegir la config vigente de
 * mallas — un mes CERRADO debe salir siempre con el mismo escandallo, no
 * recalcularse con el precio vigente en el momento de mirar el informe.
 */
export function fechaReferenciaEnvasadoDelMes(hasta: string, hoy: string): string {
  return hasta < hoy ? hasta : hoy;
}

// ─── Envasado de la fruta vendida (Mercadona, por método) ────────────────────

/**
 * Métodos de Mercadona con coste de envasado configurable en empaque_precios.
 * MA12KGC (granel 12 kg) y MA4KGC (girsac 4 kg) no tienen precio de material
 * configurado hoy: sus kg se devuelven en `kgSinPrecio` para avisar en la UI
 * en vez de imputarles 0 en silencio.
 */
export const METODO_ENVASE: Record<string, { tipoMalla: TipoMalla; kgPorMalla: number }> = {
  MA3KGC: { tipoMalla: "3kg", kgPorMalla: 3 },
  MA5KGC: { tipoMalla: "5kg", kgPorMalla: 5 },
};

export interface EnvasadoMetodoKilos {
  metodo: string;
  kilos: number;
}

export interface EnvasadoCostePorMalla {
  tipoMalla: TipoMalla;
  totalPorMalla: number;
}

export interface EnvasadoMetodoDesglose {
  metodo: string;
  kilos: number;
  mallas: number;
  costePorMalla: number;
  coste: number;
}

export interface EnvasadoVendido {
  total: number;
  desglose: EnvasadoMetodoDesglose[];
  /** Kg vendidos en métodos SIN precio de envasado configurado (granel/girsac). */
  kgSinPrecio: number;
}

/**
 * Coste del material de envasado de los kg vendidos por método: nº de mallas
 * (kilos / kg por malla) × coste total de la malla (agregarCosteEmpaque).
 * Solo cuenta los métodos de METODO_ENVASE; el resto va a `kgSinPrecio`.
 */
export function envasadoVendido(
  metodos: EnvasadoMetodoKilos[],
  costesPorMalla: EnvasadoCostePorMalla[],
): EnvasadoVendido {
  const costePorTipo = new Map(costesPorMalla.map((c) => [c.tipoMalla, c.totalPorMalla]));
  const desglose: EnvasadoMetodoDesglose[] = [];
  let total = 0;
  let kgSinPrecio = 0;

  for (const { metodo, kilos } of metodos) {
    if (!Number.isFinite(kilos) || kilos <= 0) continue;
    const envase = METODO_ENVASE[metodo.toUpperCase()];
    if (!envase) {
      kgSinPrecio += kilos;
      continue;
    }
    const costePorMalla = costePorTipo.get(envase.tipoMalla) ?? 0;
    const mallas = kilos / envase.kgPorMalla;
    const coste = mallas * costePorMalla;
    desglose.push({ metodo: metodo.toUpperCase(), kilos, mallas, costePorMalla, coste });
    total += coste;
  }

  desglose.sort((a, b) => b.coste - a.coste);
  return { total, desglose, kgSinPrecio };
}

// ─── Cálculo del CMV ─────────────────────────────────────────────────────────

export type CmvBucketClave =
  | "fruta"
  | "personal"
  | "consumos"
  | "mallas_rotas"
  | "envasado"
  | "transporte_salida"
  | "estructura"
  | "otros";

export type CmvBucketFuente = "modulo" | "estimado" | "manual" | "calculado";

export interface CmvBucket {
  clave: CmvBucketClave;
  label: string;
  importe: number;
  /** importe / kg vendidos. Null si no hay kg vendidos. */
  eurPorKg: number | null;
  /** % sobre el coste total del mes. Null si el coste total es 0. */
  pctCoste: number | null;
  /** De dónde sale el importe, para el chip de la UI. */
  fuente: CmvBucketFuente;
}

export const CMV_BUCKET_LABEL: Record<CmvBucketClave, string> = {
  fruta: "Compra de fruta (compra + recolección + acarreo + comisión)",
  personal: "Personal",
  consumos: "Consumos (agua, luz, gasoil, químicos)",
  mallas_rotas: "Mallas rotas (envasado perdido)",
  envasado: "Envasado de la fruta vendida",
  transporte_salida: "Transporte de salida",
  estructura: "Estructura",
  otros: "Otros costes",
};

export interface CmvInputs {
  /** Coste de compra de fruta del mes (importeEntradaFruta agregado). */
  fruta: number;
  /** ESTIMACIÓN de consumos del mes (lecturas físicas × tarifas del módulo de Consumos). */
  consumos: number;
  /**
   * Bases sin IVA de las facturas de suministros del mes (apuntes manuales
   * tipo "suministros"). Null si no hay ninguno registrado. Si existe,
   * SUSTITUYE a `consumos` — misma regla real-sobre-estimado que
   * personalReal/personalEstimado, y por la misma razón: no contar dos veces
   * el mismo suministro (factura + lecturas × tarifa).
   */
  suministrosReales: number | null;
  /** Gasto de mallas rotas del mes. */
  mallasRotas: number;
  /** Estimación de personal (días presente × jornada × coste_hora). */
  personalEstimado: number;
  /** Coste empresa real del mes (apunte manual). Null si no se ha registrado. */
  personalReal: number | null;
  /** Envasado de la fruta vendida (envasadoVendido().total). */
  envasado: number;
  /** Apuntes manuales del mes. */
  transporteSalida: number;
  estructura: number;
  otros: number;
  /** Denominador: kg vendidos del mes (Mercadona prorrateada + categorías 1ª y 2ª). */
  kgVendidos: number;
  /** Facturación REAL del mes (neta de comisión/transporte de venta). */
  facturacionReal: number;
}

export interface CmvResultado {
  buckets: CmvBucket[];
  costeTotal: number;
  /** CMV: coste total / kg vendidos. Null si no hay kg vendidos. */
  cmvPorKg: number | null;
  kgVendidos: number;
  facturacionReal: number;
  /** Precio medio real de venta: facturación real / kg vendidos. */
  pmRealPorKg: number | null;
  margenPorKg: number | null;
  margenTotal: number;
  /** true si el bucket de personal usa el coste real de gestoría (no la estimación). */
  usaPersonalReal: boolean;
  /** true si el bucket de consumos usa las facturas reales (no lecturas × tarifa). */
  usaSuministrosReales: boolean;
}

/**
 * Junta todos los buckets de coste del mes en un único escandallo €/kg
 * vendido. Personal: usa el apunte manual `personalReal` si existe (aunque la
 * estimación también exista); si no, cae a la estimación por asistencia.
 * Consumos: misma regla con `suministrosReales` (facturas) sobre `consumos`
 * (lecturas × tarifa).
 */
export function calcularCmv(inputs: CmvInputs): CmvResultado {
  const usaPersonalReal = inputs.personalReal != null;
  const personal = inputs.personalReal ?? inputs.personalEstimado;
  const usaSuministrosReales = inputs.suministrosReales != null;
  const consumos = inputs.suministrosReales ?? inputs.consumos;

  const base: { clave: CmvBucketClave; importe: number; fuente: CmvBucketFuente }[] = [
    { clave: "fruta", importe: inputs.fruta, fuente: "modulo" },
    { clave: "personal", importe: personal, fuente: usaPersonalReal ? "manual" : "estimado" },
    { clave: "consumos", importe: consumos, fuente: usaSuministrosReales ? "manual" : "modulo" },
    { clave: "mallas_rotas", importe: inputs.mallasRotas, fuente: "modulo" },
    { clave: "envasado", importe: inputs.envasado, fuente: "calculado" },
    { clave: "transporte_salida", importe: inputs.transporteSalida, fuente: "manual" },
    { clave: "estructura", importe: inputs.estructura, fuente: "manual" },
    { clave: "otros", importe: inputs.otros, fuente: "manual" },
  ];

  const costeTotal = base.reduce((sum, b) => sum + b.importe, 0);
  const kgVendidos = inputs.kgVendidos;

  const buckets: CmvBucket[] = base.map((b) => ({
    clave: b.clave,
    label: CMV_BUCKET_LABEL[b.clave],
    importe: b.importe,
    eurPorKg: kgVendidos > 0 ? b.importe / kgVendidos : null,
    pctCoste: costeTotal > 0 ? (b.importe / costeTotal) * 100 : null,
    fuente: b.fuente,
  }));

  const cmvPorKg = kgVendidos > 0 ? costeTotal / kgVendidos : null;
  const pmRealPorKg = kgVendidos > 0 ? inputs.facturacionReal / kgVendidos : null;
  const margenPorKg = cmvPorKg != null && pmRealPorKg != null ? pmRealPorKg - cmvPorKg : null;
  const margenTotal = inputs.facturacionReal - costeTotal;

  return {
    buckets,
    costeTotal,
    cmvPorKg,
    kgVendidos,
    facturacionReal: inputs.facturacionReal,
    pmRealPorKg,
    margenPorKg,
    margenTotal,
    usaPersonalReal,
    usaSuministrosReales,
  };
}

// ─── Ventas de categoría (1ª/2ª) del mes ────────────────────────────────────

export interface VentaCategoriaMensualInput {
  mes: string | null;
  kilos: number | null;
  /** pm_real de la vista ventas_categoria_mensual_cliente (neto de ajustes de venta). */
  pm_real: number | null;
  base_iva: number | null;
}

export interface VentasCategoriaMes {
  kilos: number;
  /** Σ kilos × pm_real: facturación neta de comisión/transporte de venta. */
  facturacionReal: number;
  facturacionBruta: number;
}

/** Agrega las filas mensuales de una categoría (vista mensual_cliente) para el mes dado. */
export function ventasCategoriaDelMes(filas: VentaCategoriaMensualInput[], mes: string): VentasCategoriaMes {
  let kilos = 0;
  let facturacionReal = 0;
  let facturacionBruta = 0;
  for (const fila of filas) {
    if (fila.mes !== mes) continue;
    const kg = fila.kilos ?? 0;
    kilos += kg;
    facturacionReal += kg * (fila.pm_real ?? 0);
    facturacionBruta += fila.base_iva ?? 0;
  }
  return { kilos, facturacionReal, facturacionBruta };
}

export interface VentasCategoriasCombinadas {
  kilos: number;
  /** Σ kilos × pm_real de 1ª + 2ª: facturación NETA (ver cabecera del módulo). */
  facturacionReal: number;
}

/**
 * Junta 1ª + 2ª categoría del mes (kilos × pm_real, ver `ventasCategoriaDelMes`)
 * en la facturación NETA que usa el CMV para el denominador y el margen.
 * Extraído como función pura con nombre propio (en vez de sumar inline en
 * useCmv.ts) para que quede explícito y testeado que esta cifra es NETA
 * (precio medio real tras comisión/transporte de venta) — a diferencia de la
 * facturación BRUTA (base IVA) que usa el Panel económico para "Ventas 2ª
 * categoría" (ver divergencia documentada en useEconomico.ts, junto a
 * `facturacionSegunda`, y la nota de EconomicoCmv.tsx).
 */
export function facturacionNetaCategoriasDelMes(
  primera: VentasCategoriaMes,
  segunda: VentasCategoriaMes,
): VentasCategoriasCombinadas {
  return {
    kilos: primera.kilos + segunda.kilos,
    facturacionReal: primera.facturacionReal + segunda.facturacionReal,
  };
}

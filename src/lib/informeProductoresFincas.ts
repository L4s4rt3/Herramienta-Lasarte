/**
 * informeProductoresFincas — lógica pura del informe "Entradas por productor
 * y finca": agrupa las entradas de báscula de un periodo por productor
 * canónico y, dentro de cada productor, por finca — el mismo desglose
 * productor → fincas del "Listado de entradas por proveedor" del ERP, pero
 * calculado sobre entradas_bascula para poder consultarlo/exportarlo desde la
 * herramienta con cualquier rango de fechas.
 *
 * La identidad del productor se resuelve con el MISMO criterio canónico que
 * el resto de la app (resolveProductorGroupKey: productor_id directo → alias
 * aprendido → texto crudo), para que este informe agrupe exactamente igual
 * que el dossier de Productores o la pérdida por agricultor de Entradas.
 *
 * Módulo sin Supabase ni React: testeable en frío (ver
 * informeProductoresFincas.test.ts).
 */
import { resolveProductorGroupKey } from "@/lib/productoresCanonicos";

export interface EntradaInformeInput {
  /** Fecha ISO (aaaa-mm-dd) de la entrada. */
  fecha: string;
  agricultor: string | null;
  /** entradas_bascula.productor_id si la fila ya lo trae resuelto. */
  productor_id?: string | null;
  finca: string | null;
  envases?: number | null;
  kg_entrada: number;
}

export interface FincaInforme {
  finca: string;
  nEntradas: number;
  envases: number;
  kg: number;
  /** Última fecha ISO con entrada de esta finca dentro del periodo. */
  ultimaFecha: string;
}

export interface ProductorInforme {
  /** Clave canónica de agrupación (ver resolveProductorGroupKey). */
  key: string;
  nombre: string;
  nEntradas: number;
  envases: number;
  kg: number;
  fincas: FincaInforme[];
}

export interface InformeProductoresFincas {
  productores: ProductorInforme[];
  totalKg: number;
  totalEntradas: number;
  totalEnvases: number;
  /** Nº de pares (productor, finca) distintos: una finca con el mismo nombre bajo dos productores cuenta dos veces. */
  nFincas: number;
}

export const SIN_FINCA_LABEL = "Sin finca";
export const SIN_AGRICULTOR_LABEL = "Sin agricultor";

/**
 * Construye el informe productor → fincas para las entradas cuyo `fecha` cae
 * dentro de [desde, hasta] (ambos inclusive, ISO aaaa-mm-dd). Productores
 * ordenados por kg desc; fincas de cada productor también por kg desc.
 */
export function buildInformeProductoresFincas(
  entradas: EntradaInformeInput[],
  opts: {
    desde: string;
    hasta: string;
    aliasPorNombreNormalizado: Map<string, string>;
    nombrePorProductorId: Map<string, string>;
  },
): InformeProductoresFincas {
  const { desde, hasta, aliasPorNombreNormalizado, nombrePorProductorId } = opts;

  interface AccFinca { finca: string; nEntradas: number; envases: number; kg: number; ultimaFecha: string }
  interface AccProductor { key: string; nombre: string; fincas: Map<string, AccFinca> }
  const porProductor = new Map<string, AccProductor>();

  let totalKg = 0;
  let totalEntradas = 0;
  let totalEnvases = 0;

  for (const e of entradas) {
    if (!e.fecha || e.fecha < desde || e.fecha > hasta) continue;

    const agricultor = (e.agricultor ?? "").trim();
    const { key, productorId } = resolveProductorGroupKey(agricultor, e.productor_id ?? null, aliasPorNombreNormalizado);
    const nombre = (productorId ? nombrePorProductorId.get(productorId) : null) ?? (agricultor || SIN_AGRICULTOR_LABEL);

    let prod = porProductor.get(key);
    if (!prod) {
      prod = { key, nombre, fincas: new Map() };
      porProductor.set(key, prod);
    }

    const finca = (e.finca ?? "").trim() || SIN_FINCA_LABEL;
    let acc = prod.fincas.get(finca);
    if (!acc) {
      acc = { finca, nEntradas: 0, envases: 0, kg: 0, ultimaFecha: e.fecha };
      prod.fincas.set(finca, acc);
    }

    const kg = Number(e.kg_entrada) || 0;
    const envases = Number(e.envases) || 0;
    acc.nEntradas += 1;
    acc.envases += envases;
    acc.kg += kg;
    if (e.fecha > acc.ultimaFecha) acc.ultimaFecha = e.fecha;

    totalKg += kg;
    totalEntradas += 1;
    totalEnvases += envases;
  }

  let nFincas = 0;
  const productores: ProductorInforme[] = [...porProductor.values()].map((prod) => {
    const fincas = [...prod.fincas.values()].sort((a, b) => b.kg - a.kg);
    nFincas += fincas.length;
    return {
      key: prod.key,
      nombre: prod.nombre,
      nEntradas: fincas.reduce((s, f) => s + f.nEntradas, 0),
      envases: fincas.reduce((s, f) => s + f.envases, 0),
      kg: fincas.reduce((s, f) => s + f.kg, 0),
      fincas,
    };
  });
  productores.sort((a, b) => b.kg - a.kg);

  return { productores, totalKg, totalEntradas, totalEnvases, nFincas };
}

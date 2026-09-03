/**
 * mdnaMix.ts — el MIX de clasificación de un lote (destinos, clases aptas y
 * los cuatro formatos de Mercadona), compartido frontend/Deno/scripts.
 *
 * POR QUÉ EXISTE (03-09-2026). Este cálculo vivía copiado en tres sitios
 * (scripts/analisis-mermas-mercadona.ts, informe-aprovechamiento-invermarmelo.ts
 * y tmp/analisis-semana-fincas-mdna.ts) con DOS criterios distintos de "clase
 * apta" (por letra A–F en uno, por nombre en otro). La página de campaña y los
 * scripts tienen que dar el mismo número: aquí vive la única implementación.
 *
 * REGLAS (confirmadas con el dueño en el estudio de stock de agosto de 2026):
 * - Clases aptas para Mercadona: A–F (Extra 1, Extra 2, Cat1 A, Cat1 B, Verde
 *   Claro, Cat 2). Mujeres, Cat 3, Verde Oscuro, Industria, Podrido y Densidad
 *   NO van a Mercadona nunca. La letra entre paréntesis es la que escribe el
 *   calibrador ("(C) Cat1 A"); sin letra, la fila no cuenta como apta en vez de
 *   adivinar por el texto.
 * - El formato de Mercadona se deduce del NOMBRE del producto (los cuatro
 *   códigos del ERP son 1:1 con los cuatro formatos que compra). "MDNA" en el
 *   nombre sin formato reconocible se cuenta aparte, jamás se reparte a ojo.
 * - Los kg son los del calibrador (peso_kg de la clasificación); quien quiera
 *   llevarlos a los kg conciliados del lote aplica su factor fuera de aquí.
 */
import { normalizarLoteCodigo } from "./loteCodigo.ts";

// ─── Formatos de Mercadona ───────────────────────────────────────────────────

/** Los 4 formatos que compra Mercadona, en el orden en que se enseñan. */
export const METODOS_MDNA = ["MA3KGC", "MA4KGC", "MA5KGC", "MA12KGC"] as const;
export type MetodoMdna = (typeof METODOS_MDNA)[number];
export const LABEL_MDNA: Record<MetodoMdna, string> = {
  MA3KGC: "Malla 3 kg",
  MA4KGC: "Girsac 4 kg exprimidor",
  MA5KGC: "D-Pack 5 kg",
  MA12KGC: "Granel",
};

function textoBusqueda(value: string | null | undefined): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Método de venta de Mercadona al que corresponde el producto, leído de su
 * propio nombre. `null` para todo lo demás.
 *
 * Solo Mercadona porque solo ahí el nombre del producto DICE el método: los
 * cuatro códigos (MA3KGC/MA4KGC/MA5KGC/MA12KGC) son 1:1 con los cuatro
 * formatos que Mercadona compra, y el producto los nombra ("MDNA 5KG D-PACK…",
 * "MDNA GRANEL CAL 3/4"). Para el resto de clientes el nombre del producto no
 * contiene el código del ERP, así que adivinarlo sería inventar: esos productos
 * llevan el método en su ficha, puesto a mano.
 *
 * El granel se comprueba ANTES que los formatos: "MDNA GRANEL CAL 3/4" lleva
 * un "3/4" que el patrón de formato confundiría con una malla de 3 kg.
 *
 * (Movida aquí desde src/lib/productosCanonicos.ts el 03-09-2026; aquel módulo
 * la re-exporta para que sus consumidores no cambien.)
 */
export function deducirMetodoVentaMdna(producto: string | null | undefined): MetodoMdna | null {
  const t = textoBusqueda(producto);
  if (!/\bMDNA\b|\bMERCADONA\b/.test(t)) return null;
  if (/\bGRANEL\b/.test(t)) return "MA12KGC";
  if (/\b3\s*KG?\b/.test(t)) return "MA3KGC";
  if (/\b4\s*KG?\b/.test(t)) return "MA4KGC";
  if (/\b5\s*KG?\b/.test(t)) return "MA5KGC";
  return null;
}

/**
 * Formato de Mercadona del producto, o "SIN_FORMATO" cuando el nombre dice
 * Mercadona pero no dice cuál (se cuenta aparte), o null si no es de Mercadona.
 */
export function metodoMdnaDeProducto(producto: string | null | undefined): MetodoMdna | "SIN_FORMATO" | null {
  const deducido = deducirMetodoVentaMdna(producto);
  if (deducido) return deducido;
  return /\bMDNA\b|\bMERCADONA\b/i.test(String(producto ?? "")) ? "SIN_FORMATO" : null;
}

// ─── Clases y destinos ───────────────────────────────────────────────────────

const CLASES_APTAS_MDNA = new Set(["A", "B", "C", "D", "E", "F"]);

/** La letra que escribe el calibrador delante de la clase: "(C) Cat1 A" → "C". */
export function letraClase(clase: string | null | undefined): string | null {
  const m = /^\s*\(([A-Z])\)/.exec(String(clase ?? "").toUpperCase());
  return m?.[1] ?? null;
}

/** ÚNICO criterio de clase apta para Mercadona: por la letra A–F del calibrador. */
export function esClaseAptaMdna(clase: string | null | undefined): boolean {
  const letra = letraClase(clase);
  return letra != null && CLASES_APTAS_MDNA.has(letra);
}

/** Destino normalizado: la BD tiene "EXPORTACIÓN" y "EXPORTACION" conviviendo. */
export function destinoNorm(grupo: string | null | undefined): string {
  return String(grupo ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .trim();
}

// ─── El mix ──────────────────────────────────────────────────────────────────

export interface MixLote {
  kgClasificado: number;
  kgExportacion: number;
  kgNoExportacion: number;
  kgMujeres: number;
  kgNoComercial: number;
  kgClaseApta: number;
  kgClasePodrido: number;
  kgClaseIndustria: number;
  mdna: Record<MetodoMdna, number>;
  mdnaSinFormato: number;
  mdnaTotal: number;
}

export function mixVacio(): MixLote {
  return {
    kgClasificado: 0, kgExportacion: 0, kgNoExportacion: 0, kgMujeres: 0, kgNoComercial: 0,
    kgClaseApta: 0, kgClasePodrido: 0, kgClaseIndustria: 0,
    mdna: { MA3KGC: 0, MA4KGC: 0, MA5KGC: 0, MA12KGC: 0 }, mdnaSinFormato: 0, mdnaTotal: 0,
  };
}

/** Una fila de clasificación tal y como la dan la vista clasificacion_lote, la tabla lote_clasificacion o su agregado. */
export interface FilaClasificacionMix {
  lote_codigo: string | null;
  producto: string | null;
  clase: string | null;
  grupo_destino: string | null;
  peso_kg: number | string | null;
}

/** Suma una fila al mix. `metodo` se pasa ya deducido para no repetir la regex por fila (hay cientos de miles). */
export function acumularMix(mix: MixLote, fila: FilaClasificacionMix, metodo: MetodoMdna | "SIN_FORMATO" | null): void {
  const kg = Number(fila.peso_kg) || 0;
  mix.kgClasificado += kg;

  const destino = destinoNorm(fila.grupo_destino);
  if (destino === "EXPORTACION") mix.kgExportacion += kg;
  else if (destino === "NO EXPORTACION") mix.kgNoExportacion += kg;
  else if (destino === "MUJERES") mix.kgMujeres += kg;
  else if (destino === "NO COMERCIAL") mix.kgNoComercial += kg;

  const letra = letraClase(fila.clase);
  if (letra && CLASES_APTAS_MDNA.has(letra)) mix.kgClaseApta += kg;
  if (letra === "J") mix.kgClasePodrido += kg;
  if (letra === "I") mix.kgClaseIndustria += kg;

  if (metodo === "SIN_FORMATO") {
    mix.mdnaSinFormato += kg;
    mix.mdnaTotal += kg;
  } else if (metodo) {
    mix.mdna[metodo] += kg;
    mix.mdnaTotal += kg;
  }
}

/**
 * Mix por LOTE (clave de 8 dígitos, normalizarLoteCodigo) a partir de filas de
 * clasificación. Las filas sin lote reconocible se ignoran. Acepta tanto las
 * filas crudas (una por clase/tamaño) como las ya agregadas por
 * (lote, producto, clase, destino): el resultado es el mismo.
 */
export function mixPorLoteDesdeClasificacion(filas: Iterable<FilaClasificacionMix>): Map<string, MixLote> {
  return mixPorClave(filas, (f) => normalizarLoteCodigo(f.lote_codigo));
}

/**
 * Una fila de la vista materializada clasificacion_lote_mix_mv (migración
 * 20260903): el mix ya pivotado por (lote, producto) en servidor, con los
 * destinos y los grupos de clase como columnas. Aquí solo falta el FORMATO de
 * Mercadona, que se deduce del nombre del producto — la única regla que no
 * vive en SQL.
 */
export interface FilaMixPivot {
  lote8: string;
  producto: string | null;
  kg_clasificado: number | string | null;
  kg_exportacion: number | string | null;
  kg_no_exportacion: number | string | null;
  kg_mujeres: number | string | null;
  kg_no_comercial: number | string | null;
  kg_clase_apta: number | string | null;
  kg_clase_podrido: number | string | null;
  kg_clase_industria: number | string | null;
}

/** Mix por lote a partir del pivot del servidor. Mismo resultado que mixPorLoteDesdeClasificacion sobre las filas crudas. */
export function mixPorLoteDesdePivot(filas: Iterable<FilaMixPivot>): Map<string, MixLote> {
  const out = new Map<string, MixLote>();
  const metodoPorProducto = new Map<string, MetodoMdna | "SIN_FORMATO" | null>();
  const n = (v: number | string | null) => Number(v) || 0;
  for (const f of filas) {
    if (!f.lote8) continue;
    let mix = out.get(f.lote8);
    if (!mix) {
      mix = mixVacio();
      out.set(f.lote8, mix);
    }
    const kg = n(f.kg_clasificado);
    mix.kgClasificado += kg;
    mix.kgExportacion += n(f.kg_exportacion);
    mix.kgNoExportacion += n(f.kg_no_exportacion);
    mix.kgMujeres += n(f.kg_mujeres);
    mix.kgNoComercial += n(f.kg_no_comercial);
    mix.kgClaseApta += n(f.kg_clase_apta);
    mix.kgClasePodrido += n(f.kg_clase_podrido);
    mix.kgClaseIndustria += n(f.kg_clase_industria);
    const producto = f.producto ?? "";
    let metodo = metodoPorProducto.get(producto);
    if (metodo === undefined) {
      metodo = metodoMdnaDeProducto(producto);
      metodoPorProducto.set(producto, metodo);
    }
    if (metodo === "SIN_FORMATO") {
      mix.mdnaSinFormato += kg;
      mix.mdnaTotal += kg;
    } else if (metodo) {
      mix.mdna[metodo] += kg;
      mix.mdnaTotal += kg;
    }
  }
  return out;
}

/** Igual que el anterior con la clave que se quiera (parcela, finca, día…). */
export function mixPorClave<T extends FilaClasificacionMix>(
  filas: Iterable<T>,
  clave: (fila: T) => string | null | undefined,
): Map<string, MixLote> {
  const out = new Map<string, MixLote>();
  const metodoPorProducto = new Map<string, MetodoMdna | "SIN_FORMATO" | null>();
  for (const fila of filas) {
    const k = clave(fila);
    if (!k) continue;
    let mix = out.get(k);
    if (!mix) {
      mix = mixVacio();
      out.set(k, mix);
    }
    const producto = fila.producto ?? "";
    let metodo = metodoPorProducto.get(producto);
    if (metodo === undefined) {
      metodo = metodoMdnaDeProducto(producto);
      metodoPorProducto.set(producto, metodo);
    }
    acumularMix(mix, fila, metodo);
  }
  return out;
}

/**
 * trazabilidadErp.ts — el origen y el destino de la fruta según el ERP.
 *
 * POR QUÉ EXISTE. Hasta ahora la ficha de trazabilidad resolvía el código
 * impreso en un palet volteándolo (`NN+AAMMDD` → `AAMMDD+NN`, ver
 * src/lib/origenConfeccion.ts) y cruzándolo con las entradas de báscula. Ese
 * volteo NO identifica la fruta, y ahora se puede demostrar: sobre 639 lotes de
 * confección con origen conocido en el ERP, el volteo acierta **0 de 1.277**
 * pares; cae en una entrada que existe en 414 casos (64,8%) y en las 414 esa
 * entrada NO es el origen real. Es decir, dos de cada tres veces la app aceptaba
 * una atribución falsa porque el código resuelto "parecía" coherente.
 *
 * La autoridad pasa a ser el ERP: `erp_confeccion_origen` dice de qué lotes de
 * ENTRADA sale cada lote de CONFECCIÓN, y `erp_palet` dice a qué cliente fue
 * cada palet y por cuántos euros. El volteo se queda solo para leer un código
 * tecleado, nunca para decir de quién es la fruta.
 *
 * DOS CIFRAS, SIEMPRE. El ERP solo tiene el enlace donde se registró la
 * elaboración: el 56,9% de los kilos paletizados de la campaña. Todo lo que
 * devuelve este módulo lleva al lado el total, para que la UI pueda decir
 * "trazados X de Y" y no dé a entender que lo no trazado no existe.
 *
 * REPARTO PROPORCIONAL. El ERP dice qué entradas alimentaron un lote de
 * confección, no de qué entrada salió cada palet. Repartir los kilos o los
 * euros de un palet entre sus orígenes es por tanto una ESTIMACIÓN por peso: el
 * hecho es la lista de productores, no la cifra. Las funciones que reparten
 * llevan `Estimado` en el nombre para que no se confunda al leerlas.
 *
 * Ver docs/ERP_LR_INFORMATICA.md.
 */

/**
 * El mismo código leído como lote de CONFECCIÓN (`NN+AAMMDD`) a partir del
 * canónico de entrada (`AAMMDDNN`). No es una conversión de identidad —son
 * lotes distintos— sino la forma de buscar en el ERP el código tal y como se
 * teclea desde la etiqueta de un palet. Ver la cabecera de este fichero.
 */
export function codigoFormatoPalet(canonico: string): string | null {
  return /^\d{8}$/.test(canonico) ? canonico.slice(6, 8) + canonico.slice(0, 6) : null;
}

/** Fila de `erp_confeccion_origen`. */
export interface OrigenConfeccionFila {
  lote_confeccion: string;
  lote_entrada: string;
  articulo: string | null;
  kg_atribuidos: number;
}

/** Fila de `erp_palet` (solo lo que se usa aquí). */
export interface PaletErpFila {
  numero: string;
  lote_confeccion: string;
  kg_netos: number | null;
  cliente: string | null;
  importe_venta: number | null;
  fecha_venta: string | null;
}

/** Quién es el dueño de un lote de entrada (sale de `entradas_bascula`). */
export interface DuenoEntrada {
  agricultor: string | null;
  finca: string | null;
}

export interface OrigenLote {
  loteEntrada: string;
  articulo: string | null;
  kgAtribuidos: number;
  agricultor: string | null;
  finca: string | null;
  /** true si ese lote de entrada no está en `entradas_bascula` (p. ej. lotes de campañas anteriores a la app). */
  desconocido: boolean;
}

export interface ClienteDestino {
  cliente: string;
  kgEstimados: number;
  eurosEstimados: number | null;
}

/** Lo que sabemos de un lote de CONFECCIÓN: de dónde vino y a dónde fue. */
export interface FichaConfeccion {
  loteConfeccion: string;
  origenes: OrigenLote[];
  /** Σ kg que el ERP atribuye a orígenes conocidos. */
  kgConOrigen: number;
  palets: number;
  /** Σ kg netos de los palets de ese lote: el total contra el que comparar. */
  kgPalets: number;
  euros: number | null;
  clientes: ClienteDestino[];
}

/** Lo que sabemos de un lote de ENTRADA: en qué se confeccionó y a quién se vendió. */
export interface FichaDestinoEntrada {
  /** El lote consultado, o null cuando la ficha agrupa varios (un productor entero). */
  loteEntrada: string | null;
  confecciones: {
    loteConfeccion: string;
    kgAtribuidos: number;
    /** Σ kg atribuidos a TODOS los orígenes de ese lote de confección: el denominador del reparto. */
    kgLoteConfeccion: number;
    palets: number;
  }[];
  clientes: ClienteDestino[];
  kgEstimadosVendidos: number;
  eurosEstimados: number | null;
}

const kgDe = (p: PaletErpFila) => Number(p.kg_netos) || 0;

/**
 * Ficha de un lote de confección: sus orígenes reales y sus clientes.
 * Aquí NO se reparte nada: los kilos y euros de los palets son del lote entero.
 */
export function fichaConfeccion(
  loteConfeccion: string,
  origenes: OrigenConfeccionFila[],
  palets: PaletErpFila[],
  duenos: Map<string, DuenoEntrada>,
): FichaConfeccion {
  const propios = origenes.filter((o) => o.lote_confeccion === loteConfeccion);
  const paletsPropios = palets.filter((p) => p.lote_confeccion === loteConfeccion);

  const porCliente = new Map<string, { kg: number; euros: number | null }>();
  for (const p of paletsPropios) {
    const clave = p.cliente ?? "(sin vender)";
    const acc = porCliente.get(clave) ?? { kg: 0, euros: null };
    acc.kg += kgDe(p);
    if (p.importe_venta != null) acc.euros = (acc.euros ?? 0) + Number(p.importe_venta);
    porCliente.set(clave, acc);
  }

  const conImporte = paletsPropios.filter((p) => p.importe_venta != null);
  return {
    loteConfeccion,
    origenes: propios
      .map((o) => {
        const dueno = duenos.get(o.lote_entrada);
        return {
          loteEntrada: o.lote_entrada,
          articulo: o.articulo,
          kgAtribuidos: Number(o.kg_atribuidos) || 0,
          agricultor: dueno?.agricultor ?? null,
          finca: dueno?.finca ?? null,
          desconocido: !dueno,
        };
      })
      .sort((a, b) => b.kgAtribuidos - a.kgAtribuidos),
    kgConOrigen: propios.reduce((s, o) => s + (Number(o.kg_atribuidos) || 0), 0),
    palets: paletsPropios.length,
    kgPalets: paletsPropios.reduce((s, p) => s + kgDe(p), 0),
    euros: conImporte.length
      ? conImporte.reduce((s, p) => s + Number(p.importe_venta), 0)
      : null,
    clientes: [...porCliente.entries()]
      .map(([cliente, v]) => ({ cliente, kgEstimados: v.kg, eurosEstimados: v.euros }))
      .sort((a, b) => b.kgEstimados - a.kgEstimados),
  };
}

/**
 * Ficha de un lote de ENTRADA: a qué lotes de confección fue y, prorrateando por
 * peso, a qué clientes y por cuántos euros. Los kg y € son ESTIMACIÓN.
 */
export function fichaDestinoEntrada(
  loteEntrada: string,
  origenes: OrigenConfeccionFila[],
  palets: PaletErpFila[],
): FichaDestinoEntrada {
  return fichaDestinoLotes([loteEntrada], origenes, palets);
}

/**
 * Lo mismo para VARIOS lotes de entrada a la vez: el destino de toda la fruta de
 * un productor.
 *
 * La identidad del productor NO se resuelve aquí ni por nombre: quien llama
 * decide qué lotes son suyos con `resolveProductorGroupKey`
 * (productoresCanonicos.ts) sobre `entradas_bascula`, y pasa la lista. El cruce
 * es por CÓDIGO DE LOTE, que es único en la app y el mismo que usa el ERP.
 *
 * Comprobado contra las dos bases el 10-08-2026: de los 775 lotes que el ERP usa
 * como origen, 765 están en `entradas_bascula` y los 765 tienen `productor_id`
 * (el 99,95% de los kilos). Y el mapeo es una biyección: 43 proveedores del ERP
 * ↔ 43 productores de la app, sin ninguno partido ni juntado. Por eso agrupar
 * así es seguro y no hace falta comparar nombres.
 */
export function fichaDestinoLotes(
  lotesEntrada: string[],
  origenes: OrigenConfeccionFila[],
  palets: PaletErpFila[],
): FichaDestinoEntrada {
  const suyos = new Set(lotesEntrada);
  // Denominador por lote de confección: el total atribuido a TODOS sus orígenes.
  const kgPorLote = new Map<string, number>();
  for (const o of origenes) {
    kgPorLote.set(o.lote_confeccion, (kgPorLote.get(o.lote_confeccion) ?? 0) + (Number(o.kg_atribuidos) || 0));
  }

  const mios = origenes.filter((o) => suyos.has(o.lote_entrada));
  const paletsPorLote = new Map<string, PaletErpFila[]>();
  for (const p of palets) {
    const lista = paletsPorLote.get(p.lote_confeccion) ?? [];
    lista.push(p);
    paletsPorLote.set(p.lote_confeccion, lista);
  }

  const porCliente = new Map<string, { kg: number; euros: number | null }>();
  let kgTotal = 0;
  let eurosTotal: number | null = null;
  const confecciones: FichaDestinoEntrada["confecciones"] = [];

  for (const o of mios) {
    const denominador = kgPorLote.get(o.lote_confeccion) ?? 0;
    const cuota = denominador > 0 ? (Number(o.kg_atribuidos) || 0) / denominador : 0;
    const paletsDelLote = paletsPorLote.get(o.lote_confeccion) ?? [];
    confecciones.push({
      loteConfeccion: o.lote_confeccion,
      kgAtribuidos: Number(o.kg_atribuidos) || 0,
      kgLoteConfeccion: denominador,
      palets: paletsDelLote.length,
    });
    for (const p of paletsDelLote) {
      const clave = p.cliente ?? "(sin vender)";
      const acc = porCliente.get(clave) ?? { kg: 0, euros: null };
      const kg = kgDe(p) * cuota;
      acc.kg += kg;
      kgTotal += kg;
      if (p.importe_venta != null) {
        const eur = Number(p.importe_venta) * cuota;
        acc.euros = (acc.euros ?? 0) + eur;
        eurosTotal = (eurosTotal ?? 0) + eur;
      }
      porCliente.set(clave, acc);
    }
  }

  return {
    loteEntrada: lotesEntrada.length === 1 ? lotesEntrada[0] : null,
    confecciones: confecciones.sort((a, b) => b.kgAtribuidos - a.kgAtribuidos),
    clientes: [...porCliente.entries()]
      .map(([cliente, v]) => ({ cliente, kgEstimados: v.kg, eurosEstimados: v.euros }))
      .sort((a, b) => b.kgEstimados - a.kgEstimados),
    kgEstimadosVendidos: kgTotal,
    eurosEstimados: eurosTotal,
  };
}

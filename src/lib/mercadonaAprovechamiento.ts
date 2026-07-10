/**
 * Aprovechamiento REAL de Mercadona — estudio con datos de S21–S27 2026.
 *
 * Las tres cifras de la cadena miden cosas distintas y nunca cuadran entre sí:
 *  - Confección MDNA (producto_dia): kg empacados en formatos Mercadona.
 *    Sobrestima el vendido real de forma sistemática (~15%): parte se queda en
 *    cámara, se reprocesa o acaba en otro destino.
 *  - Palets de alta a Mercadona (palets_dia): era la cifra buena (S21 clavaba
 *    el vendido al 99,6%), pero desde S23 el informe Spectrim viene con el
 *    cliente vacío en más de la mitad de los palets.
 *  - Vendido (mercadona_semanas.vendido_kg, informe semanal de Mercadona):
 *    la ÚNICA cifra exacta y contractual. Llega con la semana cerrada.
 *
 * Este módulo implementa el ESTIMADOR por palets que recupera los palets sin
 * cliente con perfil Mercadona: los palets de Mercadona van en cajas y pesan
 * ~240–290 kg, frente a los ~850–950 kg de los palets de mayoristas. La regla
 * (cliente Mercadona + sin cliente de <500 kg excluyendo CATII, precalibrado
 * y CITRICAS) reproduce el vendido real de las 7 semanas con informe con un
 * error del 0,4% al 5,7%.
 */

export interface PaletAprovechamiento {
  cliente: string | null;
  producto: string | null;
  kg_neto: number | null;
}

/** Peso máximo de un palet "perfil Mercadona": cajas de ~10 kg → ~240–290 kg/palet. */
export const MERCADONA_PALET_MAX_KG = 500;

/**
 * true si el palet cuenta como Mercadona para el estimador:
 * cliente MERCADONA, o palet sin cliente con perfil Mercadona (ligero y que
 * no sea categoría II, precalibrado ni granel a CITRICAS).
 */
export function esPaletMercadona(palet: PaletAprovechamiento): boolean {
  const cliente = (palet.cliente ?? "").trim().toUpperCase();
  if (cliente.includes("MERCADONA")) return true;
  if (cliente !== "") return false;

  const producto = (palet.producto ?? "").toUpperCase();
  if (producto.includes("CATII")) return false;
  // "PRE" cubre PRE1/PRE2/PREC1/PRECALIBRADO: producto a medio confeccionar.
  if (producto.includes("PRE")) return false;
  if (producto.includes("CITRICA")) return false;

  const kg = Number(palet.kg_neto) || 0;
  return kg > 0 && kg < MERCADONA_PALET_MAX_KG;
}

/** Kg estimados de Mercadona de un conjunto de palets (regla esPaletMercadona). */
export function kgMercadonaEstimado(palets: PaletAprovechamiento[]): number {
  return palets.reduce((sum, p) => sum + (esPaletMercadona(p) ? Number(p.kg_neto) || 0 : 0), 0);
}

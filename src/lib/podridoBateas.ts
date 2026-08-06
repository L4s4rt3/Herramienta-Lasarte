/**
 * podridoBateas.ts — cuánto CUESTA la fruta que se tira en las bateas de la
 * tría (PURO, sin red).
 *
 * Encargo del dueño (06-ago-2026, textual): "la batea se va llenando cada día
 * y cuando se llena se le da salida, entonces no se puede saber cuántos kg han
 * ido por día. Para lo único que podríamos cogerlo es para calcular el coste
 * que nos supone perder esa fruta haciendo una media de coste de compra".
 *
 * Hasta ahora `partes_diarios.kg_podrido_bateas` (migración 20260727120000) se
 * apuntaba y no lo consumía NADIE: este módulo es su único uso.
 *
 * ─── LO QUE ESTE MÓDULO NO HACE, Y POR QUÉ ──────────────────────────────────
 *
 * 1. NO reparte por día ni por lote. El kg de un vaciado es de todos los días
 *    desde el vaciado anterior, así que prorratearlo por la fecha en que se
 *    apuntó inventaría un dato (ya se intentó y se retiró en jul-2026, ver la
 *    nota de `ParteMermaInput` en mermaLote.ts). Aquí solo se SUMA lo pesado
 *    en un rango y se multiplica por un €/kg.
 *
 * 2. NO se suma a ninguna pérdida ya calculada. Esta fruta se aparta ANTES del
 *    calibrador (confirmado por el dueño el 06-ago-2026), así que sus kg ya
 *    están dentro de la merma medida de sus lotes (entrada − calibrador) y por
 *    tanto ya valorados en `eurPerdidaMermaTotal`/`eurPodridoPreCalibradorTotal`
 *    de mermaLote.ts. Este € es una LECTURA APARTE del mismo dinero — la
 *    parte del podrido pre-calibrador que sí se pesó — nunca un sumando
 *    adicional. Sumarlo sería exactamente el error que se corrigió ese mismo
 *    día con el podrido manual.
 *
 * 3. NO usa el coste real de los lotes de esa fruta: no se sabe de qué lotes
 *    salió. Se valora al coste MEDIO de compra del periodo (Σ importe / Σ kg
 *    de las entradas de fruta, el que ya calcula agregarCosteFruta en
 *    economico.ts), que es lo que pidió el dueño.
 */

/** Fila de partes_diarios: fecha del parte y kg pesados al vaciar la batea ese día. */
export interface VaciadoBateaInput {
  date: string;
  /** `null` = no hubo vaciado ese día (no un 0), ver PartDetailManual. */
  kg_podrido_bateas: number | null;
}

export interface CostePodridoBateas {
  /** Σ kg de los vaciados del rango. */
  kgTotal: number;
  /** Nº de vaciados (días con pesada), no de días con podrido. */
  nVaciados: number;
  /** Primer y último vaciado del rango: acotan a qué periodo pertenece de verdad la fruta. */
  primerVaciado: string | null;
  ultimoVaciado: string | null;
  /** €/kg medio de compra usado para valorar. `null` si no se pudo calcular. */
  costeMedioKg: number | null;
  /** kgTotal × costeMedioKg. `null` si no hay coste medio: "no se sabe" no es 0. */
  eur: number | null;
}

/**
 * €/kg medio de compra de fruta de un periodo, a partir del agregado que ya
 * calcula `agregarCosteFruta` (economico.ts) — no se reimplementa la regla de
 * importe_total vs suma de componentes. `null` si no hay kg o no hay importe
 * (un periodo sin importes cargados no vale 0 €/kg, sencillamente no se sabe).
 */
export function costeMedioCompraFruta(totalImporte: number, kgTotales: number): number | null {
  if (!(kgTotales > 0) || !(totalImporte > 0)) return null;
  return totalImporte / kgTotales;
}

/**
 * Suma los vaciados de batea cuya FECHA DE PESADA cae en [desde, hasta] y los
 * valora al €/kg medio dado.
 *
 * OJO con el rango (limitación inherente, no se puede corregir con los datos
 * de hoy): un vaciado dentro del periodo puede contener fruta apartada ANTES
 * de que el periodo empezara, y la que se esté acumulando ahora no aparecerá
 * hasta que se vacíe. Por eso se devuelven `primerVaciado`/`ultimoVaciado`:
 * son lo único honesto que se puede decir sobre a qué fechas pertenece de
 * verdad este kg.
 */
export function agregarPodridoBateas(
  vaciados: VaciadoBateaInput[],
  desde: string,
  hasta: string,
  costeMedioKg: number | null,
): CostePodridoBateas {
  const enRango = vaciados
    .filter((v) => v.date >= desde && v.date <= hasta)
    .filter((v) => v.kg_podrido_bateas != null && Number(v.kg_podrido_bateas) > 0)
    .sort((a, b) => a.date.localeCompare(b.date));

  const kgTotal = enRango.reduce((s, v) => s + (Number(v.kg_podrido_bateas) || 0), 0);

  return {
    kgTotal,
    nVaciados: enRango.length,
    primerVaciado: enRango[0]?.date ?? null,
    ultimoVaciado: enRango[enRango.length - 1]?.date ?? null,
    costeMedioKg,
    eur: costeMedioKg != null ? kgTotal * costeMedioKg : null,
  };
}

/** Explicación canónica para el tooltip de la UI (única fuente, no la copies a mano). */
export const INFO_COSTE_PODRIDO_BATEAS =
  "Kg pesados al vaciar las bateas de la tría, valorados al coste MEDIO de compra de la fruta del periodo (no se sabe de qué lotes salió esa fruta). La batea se llena durante varios días y se pesa al vaciarla, así que su kg no se puede repartir por día ni por lote: aquí solo se suman los vaciados del periodo. NO se suma a la pérdida total — esta fruta se aparta antes del calibrador, así que ya está contada dentro de la merma de sus lotes; esto es solo ponerle precio a la parte que sí se pesa.";

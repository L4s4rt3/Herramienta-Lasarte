/**
 * mermaPorProductor.ts — agrega `MermaLote[]` (src/lib/mermaLote.ts) POR
 * PRODUCTOR para el dossier de producción (src/pages/Productores.tsx).
 *
 * NO reimplementa ponderación, exclusión de "cerrado sin registro" ni el
 * desglose real/estimado/asumido/sin dato: cada grupo es solo un subconjunto
 * de lotes al que se le aplica `agregarMermaLotes` (la MISMA función que ya
 * usa la pestaña "Mermas y coste" de EntradasBascula.tsx para el conjunto
 * completo) — así el % de pérdida por productor es exactamente coherente con
 * el que ya se ve ahí, solo que filtrado a sus lotes.
 *
 * La CLAVE de agrupación (id del catálogo canónico o texto crudo) la resuelve
 * quien llama con `resolveProductorGroupKey` (productoresCanonicos.ts) —
 * mismo patrón que `agruparPerdidaPorProductor` (mermaLote.ts) y
 * `agruparForfait` (forfait.ts): este módulo solo agrupa por la clave ya
 * resuelta.
 */
import { agregarMermaLotes, type MermaLote, type MermaLotesAgregado } from "@/lib/mermaLote";

export interface ItemMermaAgrupable {
  lote: MermaLote;
  /** Clave de agrupación ya resuelta (ver resolveProductorGroupKey): "id:<uuid>" o "nombre:<texto crudo>". Vacía o falsy se descarta (sin productor al que atribuir el lote). */
  productorKey: string | null | undefined;
}

/**
 * Agrupa por `productorKey` y aplica `agregarMermaLotes` a cada grupo.
 *
 * Un productor sin ningún lote en `items` (o cuyos lotes se descartaron todos
 * por no traer clave) simplemente NO aparece en el mapa devuelto: el
 * consumidor debe tratar `.get(key)` === `undefined` como "sin dato todavía",
 * nunca como una pérdida de 0 (mismo criterio de "null, no 0" que sigue todo
 * mermaLote.ts).
 */
export function agregarMermaPorProductor(items: ItemMermaAgrupable[]): Map<string, MermaLotesAgregado> {
  const lotesPorKey = new Map<string, MermaLote[]>();
  for (const { lote, productorKey } of items) {
    if (!productorKey) continue;
    const arr = lotesPorKey.get(productorKey) ?? [];
    arr.push(lote);
    lotesPorKey.set(productorKey, arr);
  }

  const resultado = new Map<string, MermaLotesAgregado>();
  for (const [key, lotes] of lotesPorKey) {
    resultado.set(key, agregarMermaLotes(lotes));
  }
  return resultado;
}

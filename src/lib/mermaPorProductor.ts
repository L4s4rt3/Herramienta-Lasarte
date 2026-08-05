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
import { tieneContradiccionPasadaVsFotoStock, type LoteCiclo } from "@/lib/cicloVidaLote";

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

// ─── Corolario de la REGLA DE ORO (decisión del dueño 05-08-2026, FASE 3d) ──
// "Los lotes con CONTRADICCIONES abiertas del motor nuevo (pasada↔foto de
// stock) no pueden repartir su merma/€ por productor en silencio — su merma
// es incalculable hasta que el dueño resuelva la contradicción físicamente."
// Esto NO toca ninguna fórmula de mermaLote.ts (esos kg/€ se siguen
// calculando exactamente igual, "informativos" en la ficha del lote): lo
// único que cambia es que estos lotes salen de cualquier reparto POR
// PRODUCTOR (aquí y en cualquier ranking/coste en € que agrupe por
// productor, ver EconomicoCostes.tsx) y se devuelven aparte para que la UI
// los enseñe con su kg y un link a la ficha, nunca desaparecidos sin más.

/** Lote excluido del reparto por productor por tener una contradicción del motor nuevo abierta — lo mínimo para que la UI lo enseñe (kg + link a /trazabilidad?lote=). */
export interface LotePendienteComprobacionFisica {
  lote: string;
  kgEntrada: number;
}

/**
 * Separa, de una lista de `MermaLote`, los que tienen la contradicción
 * "pasada_vs_foto_stock" VIGENTE en el motor nuevo (`cicloPorLote`, ver
 * cicloVidaLoteAdapter.ts/useEntradasBascula.ts — YA calculado, cero fetches
 * nuevos) de los que se pueden repartir con normalidad. Se aplica ANTES de
 * construir los `Item*Agrupable`/`Item*Productor` de cualquier ranking por
 * productor (`agregarMermaPorProductor` aquí, `agruparPerdidaPorProductor` en
 * mermaLote.ts para el ranking en € de EconomicoCostes.tsx): ninguno de los
 * dos ve nunca estos lotes, así que no hay riesgo de que alguna llamada nueva
 * los cuele por accidente. Sin `cicloPorLote` (motor nuevo aún sin cargar o
 * mapa vacío) se comporta como si no hubiera contradicciones — no bloquea la
 * UI mientras el motor nuevo termina de calcular.
 */
export function separarLotesPendientesComprobacionFisica(
  lotes: MermaLote[],
  cicloPorLote: Map<string, LoteCiclo> | null | undefined,
): { normales: MermaLote[]; pendientes: LotePendienteComprobacionFisica[] } {
  if (!cicloPorLote || cicloPorLote.size === 0) return { normales: lotes, pendientes: [] };
  const normales: MermaLote[] = [];
  const pendientes: LotePendienteComprobacionFisica[] = [];
  for (const l of lotes) {
    if (tieneContradiccionPasadaVsFotoStock(cicloPorLote.get(l.lote))) {
      pendientes.push({ lote: l.lote, kgEntrada: l.kgEntrada });
    } else {
      normales.push(l);
    }
  }
  return { normales, pendientes };
}

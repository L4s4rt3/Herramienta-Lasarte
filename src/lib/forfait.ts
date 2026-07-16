/**
 * forfait.ts — FORFAIT: coste real por kg APROVECHABLE, para decidir qué
 * productores/fincas son rentables (definición V1 acordada con el dueño,
 * 2026-07-15). NO reimplementa merma/podrido/coste por lote: solo COMPONE los
 * números que ya calcula computeMermaLotes (src/lib/mermaLote.ts).
 *
 * ─── Por qué "aprovechable" y no "kgEntrada" ────────────────────────────────
 * El forfait quiere responder "¿cuánto me cuesta de verdad el kilo que
 * realmente puedo vender?", no el kilo que entró por báscula. De los kg que
 * entran, una parte nunca llega al calibrador (merma natural + podrido
 * pre-calibrador: YA quedan fuera de `kgCalibrador`, ver mermaLote.ts) y otra
 * parte SÍ llega pero se descarta allí o en la mesa manual (podrido de
 * calibrador + podrido manual). El aprovechable es lo que queda después de
 * quitar SOLO esta segunda parte:
 *
 *   kgAprovechable = kgCalibrador − podridoCalibradorKg − podridoManualKg
 *
 * El pre-calibrador (merma natural + podrido pre-calibrador asumido) NO se
 * resta aquí aparte porque NUNCA estuvo dentro de `kgCalibrador`: restarlo de
 * nuevo sería contarlo dos veces. Por eso, en cambio, SÍ entra en
 * `pctPerdidaTotal` (que se mide contra `kgEntrada`, no contra `kgCalibrador`):
 *
 *   pctPerdidaTotal = (kgEntrada − kgAprovechable) / kgEntrada
 *
 * Desarrollando: kgEntrada − kgAprovechable = (kgEntrada − kgCalibrador) +
 * podridoCalibradorKg + podridoManualKg. Cuando el lote no tiene ajuste de
 * stock (kg_ajuste_stock = 0, el caso normal) y el calibrador no supera la
 * entrada, (kgEntrada − kgCalibrador) es exactamente `mermaNaturalKg`, que a
 * su vez se descompone en mermaNaturalEstimadaKg (asumido por días en cámara)
 * + podridoPreCalibradorKg (asumido, contenedor no pesado). Es decir:
 * pctPerdidaTotal = (natural estimada + podrido pre-calibrador + podrido de
 * calibrador + podrido manual) / kgEntrada — la pérdida total desde que la
 * fruta entra hasta lo que queda aprovechable, tal y como pidió el dueño (ver
 * el test de coherencia en forfait.test.ts, que verifica esta identidad
 * reconstruyendo ambos lados a partir de un MermaLote real).
 *
 * Si el lote SÍ trae `kg_ajuste_stock` distinto de 0 (caso raro, conciliación
 * manual de stock), `pctPerdidaTotal` no lo descuenta (la fórmula usa
 * `kgCalibrador` directo, no `mermaNaturalKg`): es una decisión deliberada
 * para no reinventar una tercera fórmula fuera de la acordada con el dueño,
 * se documenta en vez de ocultarse. Con el mismo motivo, si
 * `calibradorSuperaEntrada` (dato a revisar, ver mermaLote.ts) el
 * `pctPerdidaTotal` puede salir negativo: no se clampa, es la misma filosofía
 * de "exponer el dato crudo" que ya sigue mermaLote.ts.
 *
 * ─── Guard: kgAprovechable <= 0 ──────────────────────────────────────────────
 * Un lote donde el podrido (calibrador + manual) iguala o supera lo que pesó
 * el calibrador no tiene "kilo bueno" que forfaitar: `forfaitEurKg` sale
 * `null` (no Infinity ni 0) y el lote se marca `sinForfait: true`. El resto de
 * sus cifras (kgEntrada, costeTotalEur, pctPerdidaTotal) se calculan igual:
 * el guard solo afecta a la división €/kg aprovechable.
 *
 * ─── Solo lotes procesados y con coste ──────────────────────────────────────
 * `computeForfaitLote` devuelve `null` (no un objeto con nulls) si el lote no
 * está "procesado" (`estado`, que YA incluye los cerrados manualmente — ver
 * mermaLote.ts), si no tiene coste conocido (`sinCoste`), o si está
 * `cerradoSinRegistro` (cierre manual sin registro de procesado bajo su
 * código, ver mermaLote.ts): sin ese registro, `kgAprovechable` saldría de
 * restar podrido sobre un `kgCalibrador` que no representa lo que realmente
 * se procesó, así que no hay forfait honesto que calcular. Así, el
 * consumidor (agregación por productor/finca, tabla de la UI) puede filtrar
 * con un simple `.filter(Boolean)` y contar los excluidos aparte
 * (`nLotesExcluidos`, sin distinguir el motivo — para eso está
 * `agregado.nLotesCerradosSinRegistro` de mermaLote.ts).
 */
import type { FuentePodrido, MermaLote } from "@/lib/mermaLote";

// ─── Por lote ────────────────────────────────────────────────────────────────

export interface LoteForfait {
  lote: string;
  fecha: string;
  kgEntrada: number;
  /** costeTotalLote del MermaLote de origen (importeEntradaFruta). */
  costeTotalEur: number;
  /**
   * kgCalibrador − podridoCalibradorKg − podridoManualKg. Puede ser <= 0 (ver
   * `sinForfait`). Si el lote tiene podrido desconocido (import histórico de
   * campaña sin dato de podrido, ver mermaLote.ts), la resta usa SOLO lo
   * conocido (el componente `null` no se resta, ver `podridoDesconocido`):
   * el kg puede quedar sobreestimado para esos lotes.
   */
  kgAprovechable: number;
  /** true si el lote tiene podrido (calibrador y/o manual) desconocido: `kgAprovechable` está calculado solo con lo conocido, no lo trates como un forfait completo. */
  podridoDesconocido: boolean;
  /** true si kgAprovechable <= 0: no hay kilo aprovechable que forfaitar. */
  sinForfait: boolean;
  /** costeTotalEur / kgAprovechable. `null` si sinForfait. */
  forfaitEurKg: number | null;
  /** costeTotalEur / kgEntrada. `null` si kgEntrada <= 0 (no debería pasar con datos reales, guard defensivo). */
  eurKgNominal: number | null;
  /** forfaitEurKg − eurKgNominal. `null` si cualquiera de los dos es null. */
  sobrecosteEurKg: number | null;
  /** (kgEntrada − kgAprovechable) / kgEntrada. `null` si kgEntrada <= 0. Ver cabecera del archivo para la equivalencia con merma+podrido. */
  pctPerdidaTotal: number | null;
  /** Fuente del podrido de calibrador del lote (real/prorrateo): para la mini-badge de calidad del dato en la UI. */
  podridoCalibradorFuente: FuentePodrido;
  cerradoManualmente: boolean;
}

/** `null` si el lote no está procesado, no tiene coste conocido, o está cerrado sin registro de procesado (ver cabecera del archivo). */
export function computeForfaitLote(lote: MermaLote): LoteForfait | null {
  if (lote.estado !== "procesado" || lote.sinCoste || lote.cerradoSinRegistro) return null;

  const kgEntrada = lote.kgEntrada;
  const costeTotalEur = lote.costeTotalLote;
  const kgAprovechable = lote.kgCalibrador - (lote.podridoCalibradorKg ?? 0) - (lote.podridoManualKg ?? 0);
  const sinForfait = kgAprovechable <= 0;

  const forfaitEurKg = sinForfait ? null : costeTotalEur / kgAprovechable;
  const eurKgNominal = kgEntrada > 0 ? costeTotalEur / kgEntrada : null;
  const sobrecosteEurKg = forfaitEurKg != null && eurKgNominal != null ? forfaitEurKg - eurKgNominal : null;
  const pctPerdidaTotal = kgEntrada > 0 ? (kgEntrada - kgAprovechable) / kgEntrada : null;

  return {
    lote: lote.lote,
    fecha: lote.fecha,
    kgEntrada,
    costeTotalEur,
    kgAprovechable,
    sinForfait,
    forfaitEurKg,
    eurKgNominal,
    sobrecosteEurKg,
    pctPerdidaTotal,
    podridoCalibradorFuente: lote.podridoCalibradorFuente,
    podridoDesconocido: lote.podridoDesconocido,
    cerradoManualmente: lote.cerradoManualmente,
  };
}

/** Aplica computeForfaitLote a una lista, descartando los `null` (no procesados / sin coste). */
export function computeForfaitLotes(lotes: MermaLote[]): LoteForfait[] {
  const out: LoteForfait[] = [];
  for (const lote of lotes) {
    const f = computeForfaitLote(lote);
    if (f) out.push(f);
  }
  return out;
}

// ─── Agregación por grupo (productor o finca — la clave la resuelve quien llama) ─
// Parametrizada en vez de duplicada: el consumidor (EconomicoFruta.tsx) decide
// la clave/etiqueta de agrupación (resolveProductorGroupKey del catálogo
// canónico para productor, texto crudo de `finca` para finca — no existe hoy
// un catálogo canónico de fincas), este módulo solo suma.

export interface ItemForfaitAgrupable {
  lote: MermaLote;
  groupKey: string;
  groupLabel: string;
}

export interface ForfaitGrupo {
  key: string;
  label: string;
  /** Nº de lotes procesados y con coste incluidos en el grupo (los excluidos se cuentan aparte, ver ForfaitAgregado.nLotesExcluidos). */
  nLotes: number;
  kgEntrada: number;
  costeTotalEur: number;
  /** Σ kgAprovechable del grupo (puede ser <= 0 si el grupo entero está mal, ver forfaitEurKg null en ese caso). */
  kgAprovechable: number;
  /** Σcoste / Σaprovechable — NO la media de los forfaits individuales. `null` si Σaprovechable <= 0. */
  forfaitEurKg: number | null;
  /** Σcoste / ΣkgEntrada. `null` si ΣkgEntrada <= 0. */
  eurKgNominal: number | null;
  sobrecosteEurKg: number | null;
  /** (ΣkgEntrada − Σaprovechable) / ΣkgEntrada — ponderado por construcción (suma de kg, no media de %). `null` si ΣkgEntrada <= 0. */
  pctPerdidaTotal: number | null;
  /** De los lotes incluidos, cuántos tienen podridoCalibradorFuente "real" (Informe LOTE) — para la mini-badge de calidad del dato. */
  nLotesPodridoReal: number;
  /** nLotesPodridoReal / nLotes × 100. 0 si nLotes es 0 (no debería darse: un grupo solo existe si tiene al menos un lote). */
  pctPodridoReal: number;
  /** De los lotes incluidos, cuántos tienen `podridoDesconocido=true` (kgAprovechable calculado solo con lo conocido): la UI debe marcar el grupo. */
  nLotesPodridoDesconocido: number;
}

export interface ForfaitAgregado {
  /** Sin ordenar: cada consumidor ordena por el criterio que le interese (forfait asc por defecto en la UI). */
  grupos: ForfaitGrupo[];
  /** Nº de lotes del conjunto de entrada que quedaron fuera (no procesados o sin coste conocido). */
  nLotesExcluidos: number;
}

/**
 * Agrupa por `groupKey`, sumando kg/€/aprovechable — la media ponderada
 * (Σcoste/Σaprovechable) sale de dividir los acumulados al final, nunca de
 * promediar los forfaits individuales de cada lote. Los lotes no procesados o
 * sin coste (computeForfaitLote devuelve null) se excluyen de todos los
 * grupos y se cuentan en `nLotesExcluidos`.
 */
export function agruparForfait(items: ItemForfaitAgrupable[]): ForfaitAgregado {
  const map = new Map<string, {
    label: string;
    nLotes: number;
    kgEntrada: number;
    costeTotalEur: number;
    kgAprovechable: number;
    nLotesPodridoReal: number;
    nLotesPodridoDesconocido: number;
  }>();
  let nLotesExcluidos = 0;

  for (const item of items) {
    const forfaitLote = computeForfaitLote(item.lote);
    if (!forfaitLote) {
      nLotesExcluidos += 1;
      continue;
    }
    const acc = map.get(item.groupKey) ?? {
      label: item.groupLabel,
      nLotes: 0,
      kgEntrada: 0,
      costeTotalEur: 0,
      kgAprovechable: 0,
      nLotesPodridoReal: 0,
      nLotesPodridoDesconocido: 0,
    };
    acc.nLotes += 1;
    acc.kgEntrada += forfaitLote.kgEntrada;
    acc.costeTotalEur += forfaitLote.costeTotalEur;
    acc.kgAprovechable += forfaitLote.kgAprovechable;
    if (forfaitLote.podridoCalibradorFuente === "real") acc.nLotesPodridoReal += 1;
    if (forfaitLote.podridoDesconocido) acc.nLotesPodridoDesconocido += 1;
    map.set(item.groupKey, acc);
  }

  const grupos: ForfaitGrupo[] = Array.from(map.entries()).map(([key, v]) => {
    const forfaitEurKg = v.kgAprovechable > 0 ? v.costeTotalEur / v.kgAprovechable : null;
    const eurKgNominal = v.kgEntrada > 0 ? v.costeTotalEur / v.kgEntrada : null;
    const sobrecosteEurKg = forfaitEurKg != null && eurKgNominal != null ? forfaitEurKg - eurKgNominal : null;
    const pctPerdidaTotal = v.kgEntrada > 0 ? (v.kgEntrada - v.kgAprovechable) / v.kgEntrada : null;
    return {
      key,
      label: v.label,
      nLotes: v.nLotes,
      kgEntrada: v.kgEntrada,
      costeTotalEur: v.costeTotalEur,
      kgAprovechable: v.kgAprovechable,
      forfaitEurKg,
      eurKgNominal,
      sobrecosteEurKg,
      pctPerdidaTotal,
      nLotesPodridoReal: v.nLotesPodridoReal,
      pctPodridoReal: v.nLotes > 0 ? (v.nLotesPodridoReal / v.nLotes) * 100 : 0,
      nLotesPodridoDesconocido: v.nLotesPodridoDesconocido,
    };
  });

  return { grupos, nLotesExcluidos };
}

// ─── Simulador (funciones puras, sin acceso a red, sin guardar nada) ────────

/**
 * Forfait proyectado si se comprara a `precioTodoInclEurKg` (€/kg todo
 * incluido: compra + recolección + transporte + comisión) a un
 * productor/finca con `pctPerdida` histórico (fracción, no %; p.ej. 0,08 = 8%).
 * `precio / (1 − pctPerdida)`: si de cada kg comprado solo queda aprovechable
 * (1 − pctPerdida), hay que repartir el precio pagado entre esa fracción.
 * `null` si `pctPerdida >= 1` (se perdería el 100% o más: no hay forfait
 * finito posible, no se devuelve Infinity).
 */
export function forfaitProyectado(precioTodoInclEurKg: number, pctPerdida: number): number | null {
  if (pctPerdida >= 1) return null;
  return precioTodoInclEurKg / (1 - pctPerdida);
}

/**
 * Inverso de `forfaitProyectado`: precio máximo de compra (€/kg todo
 * incluido) para no superar `forfaitObjetivoEurKg` con un `pctPerdida`
 * histórico dado. `objetivo × (1 − pctPerdida)`. Sin guard adicional: con
 * `pctPerdida >= 1` el resultado sale <= 0 (ningún precio de compra sería
 * rentable), un valor perfectamente informativo que la UI puede mostrar en
 * rojo en vez de ocultar.
 */
export function precioMaxCompra(forfaitObjetivoEurKg: number, pctPerdida: number): number {
  return forfaitObjetivoEurKg * (1 - pctPerdida);
}

// ─── Simulador: podrido no pesado asumido (decisión del dueño, 2026-07-15) ──
//
// El simulador proyecta el forfait de un productor SIN lotes procesados
// todavía (o con pocos): no hay un `pctPerdidaTotal` medido (ver
// ForfaitGrupo.pctPerdidaTotal) con el que precargar el % de pérdida, así que
// hay que COMPONERLO a partir de lo que sí se conoce:
//   1. El podrido REAL del calibrador para ese productor, si existe informe
//      (calidad_referencias_productor, ver src/lib/calidadReferencias.ts):
//      aproxima podridoCalibradorKg + podridoManualKg reales (lo que el
//      calibrador SÍ pesó y descartó).
//   2. La merma natural esperada por días en cámara (mismo TASA_MERMA_NATURAL_DIA
//      que mermaLote.ts, aplicado a unos días ESTIMADOS en vez de medidos).
//   3. El podrido NO pesado: fruta que se retira en un contenedor
//      pre-calibrador que no se pesa a diario (igual concepto que
//      `podridoPreCalibradorKg` de mermaLote.ts) — el informe de referencia
//      del calibrador NUNCA lo ve, porque esa fruta no llega a pasar por él.
//      Al no tener dato medido por productor, se ASUME un %.

/**
 * % de podrido no pesado ASUMIDO para el componente 3 de arriba cuando no hay
 * un hueco medido específico del productor. Procedencia: estimación del
 * dueño (jul 2026) para el podrido retirado antes del calibrador a
 * contenedor sin pesar + margen; sustituir por el hueco medido del productor
 * cuando el histórico lo dé (p. ej., comparando su podrido de referencia del
 * calibrador contra su pérdida total real una vez tenga lotes procesados).
 * Fracción, no %: 0,03 = 3%.
 */
export const PCT_PODRIDO_NO_PESADO_DEFECTO = 0.03;

export interface PerdidaSimuladaInput {
  /**
   * % de podrido medido en el calibrador para este productor (de
   * `calidad_referencias_productor`, agregado si tiene varias variedades),
   * fracción 0–1. `null` si no hay informe de referencia para este
   * productor: se trata como 0 en la suma (el llamador/la UI es quien debe
   * indicar que este componente falta, mostrando "sin dato" en vez de un
   * 0% real).
   */
  pctPodridoReferencia: number | null;
  /**
   * % de merma natural esperada, fracción 0–1: `TASA_MERMA_NATURAL_DIA ×
   * días de cámara ESTIMADOS` (parámetro del simulador, no medido lote a
   * lote como en mermaLote.ts).
   */
  pctMermaNatural: number;
  /**
   * % de podrido no pesado ASUMIDO, fracción 0–1 — normalmente
   * `PCT_PODRIDO_NO_PESADO_DEFECTO`, editable en la UI del simulador.
   */
  pctPodridoNoPesado: number;
}

/**
 * pctPerdidaTotal simulado, SUMANDO los 3 componentes sobre la entrada — NO
 * compuestos multiplicativamente (no se hace `1 - (1-a)(1-b)(1-c)`). Mismo
 * criterio que `pctPerdidaTotal` de `computeForfaitLote`/`computeMermaLotes`:
 * ese valor real es exactamente la suma de fracciones de kgEntrada (merma
 * natural + podrido pre-calibrador + podrido de calibrador + podrido
 * manual), nunca un producto de probabilidades de pérdida independientes.
 * Aquí se replica la misma descomposición con datos proyectados en vez de
 * medidos: `pctPodridoReferencia` aproxima (podridoCalibrador + podridoManual),
 * `pctPodridoNoPesado` aproxima podridoPreCalibrador (asumido) y
 * `pctMermaNatural` aproxima mermaNaturalEstimada.
 *
 * `pctPodridoReferencia` null se trata como 0 en la suma (ver
 * `PerdidaSimuladaInput`). Sin guard de rango: puede superar 1 si los
 * componentes son grandes, exactamente igual que `pctPerdidaTotal` real
 * (que tampoco se clampa) — `forfaitProyectado` ya sabe devolver `null` si
 * el resultado es >= 1.
 *
 * ─── Sesgo conocido y ACEPTADO: bases distintas en la suma ──────────────────
 * Los 3 componentes NO se miden todos sobre la misma base. `pctMermaNatural`
 * y `pctPodridoNoPesado` son fracciones de kg ENTRADA (igual que el
 * `pctPerdidaTotal` real de `computeForfaitLote`). Pero `pctPodridoReferencia`
 * viene de `calidad_referencias_productor` (informe del calibrador) y es
 * podrido / kg CALIBRADO, es decir, fracción de lo que YA pasó el
 * pre-calibrador (kgEntrada menos merma natural y podrido pre-calibrador),
 * no de kgEntrada. Sumar una fracción de kgCalibrador como si fuera fracción
 * de kgEntrada SOBREESTIMA la pérdida total (el denominador real de ese
 * componente es más pequeño que kgEntrada, así que su fracción "verdadera"
 * sobre kgEntrada sería algo menor que `pctPodridoReferencia`).
 *
 * Se decide MANTENER la suma tal cual (no corregir la base) porque:
 *   1. Es conservador: el simulador nunca sale más optimista de lo que
 *      debería, solo más pesimista — para decidir si comprar a un precio
 *      compensa, errar por el lado de "cuesta más de lo que parece" es el
 *      lado seguro.
 *   2. La diferencia es pequeña en la práctica: el error es
 *      `pctPodridoReferencia × (pérdida pre-calibrador)` (el producto de dos
 *      fracciones normalmente < 0,15 cada una, así que el error queda por
 *      debajo de un par de puntos porcentuales) — despreciable frente a la
 *      incertidumbre de los propios % ASUMIDOS (podrido no pesado, días de
 *      cámara estimados) que ya tiene el simulador.
 *   3. Corregir la base exigiría recalcular `pctPodridoReferencia` a
 *      fracción de kgEntrada multiplicándolo por (1 − pctMermaNatural −
 *      pctPodridoNoPesado) ANTES de sumarlo, lo que acopla los 3 componentes
 *      entre sí y complica la fórmula para una ganancia de precisión menor
 *      que el margen de error de los propios datos ASUMIDOS.
 * Si en el futuro el histórico da suficientes lotes reales por productor,
 * el método "medido real" (ver `simTieneForfaitReal` en EconomicoFruta.tsx)
 * sustituye a este compuesto y el sesgo deja de aplicar.
 */
export function perdidaSimulada(input: PerdidaSimuladaInput): number {
  return (input.pctPodridoReferencia ?? 0) + input.pctMermaNatural + input.pctPodridoNoPesado;
}

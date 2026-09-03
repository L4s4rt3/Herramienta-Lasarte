/**
 * mermaMdnaAgregado.ts — la CAMPAÑA por productor y finca: pérdida (merma de
 * cámara, podrido de tría, podrido de calibrador, euros) y aprovechamiento de
 * Mercadona por formato. Compartida frontend/Deno/scripts.
 *
 * POR QUÉ EXISTE (03-09-2026). Era el corazón de
 * scripts/analisis-mermas-mercadona.ts (regenerado a mano 5 veces en 3
 * semanas) y estaba duplicado a medias en src/lib/exportMermasProductores.ts y
 * src/lib/mermaPorProductor.ts. La pestaña "Campaña" de Entradas y el Excel
 * del script tienen que dar el MISMO número: aquí vive la única agregación.
 *
 * DOS DENOMINADORES, a propósito (decisión del dueño 06-ago-2026):
 * - kgEntradaBase: solo lotes con merma calculable (terminados). Base del % de
 *   merma de cámara y del % de podrido de tría.
 * - kgBasePctPerdida: entrada completa si el lote está terminado; solo lo ya
 *   pasado por línea si está a medias (su podrido de calibrador cuenta en el
 *   numerador, así que sus kg pasados tienen que contar en el denominador).
 *   Base del % de podrido de calibrador y del % de PÉRDIDA TOTAL.
 *
 * Pérdida total = merma medida (solo terminados) + podrido de calibrador
 * (todos). El podrido MANUAL no se suma: sale antes del calibrador y ya está
 * dentro de la merma medida.
 */
import { normalizarLoteCodigo } from "./loteCodigo.ts";
import {
  esAgricultorMovimientoInterno,
  esProductorPrecalibrado,
  resolveProductorGroupKey,
} from "./productoresCanonicos.ts";
import { tasaPodridoPreCalibradorMes, type MermaLote } from "./mermaLote.ts";
import { METODOS_MDNA, type MetodoMdna, type MixLote } from "./mdnaMix.ts";

const num = (v: unknown): number => Number(v) || 0;

/** % o null cuando no hay base: nunca un 0 que parezca un dato. */
export function pctONull(parte: number | null, total: number | null): number | null {
  return parte == null || total == null || total <= 0 ? null : (parte / total) * 100;
}

// ─── Fila por lote (merma + identidad + mix de clasificación) ────────────────

export interface FilaLoteMermaMdna {
  lote: string;
  fecha: string;
  productorKey: string;
  productor: string;
  finca: string;
  variedad: string;
  estado: string;
  cerradoSinRegistro: boolean;
  /** Movimiento interno (precalibrado, confección/sobrante): fuera de los rankings. */
  interno: boolean;
  diasEnCamara: number | null;
  kgEntrada: number;
  kgAjuste: number;
  kgCalibrador: number;
  mermaMedidaKg: number | null;
  mermaCamaraKg: number | null;
  mermaCamaraReal: boolean;
  podridoPreKg: number | null;
  podridoPreEsperadoKg: number | null;
  podridoPreNoVistoKg: number | null;
  sinMargen: boolean;
  podridoCalibradorKg: number | null;
  podridoCalibradorFuente: string;
  podridoManualKg: number | null;
  perdidaKg: number | null;
  perdidaEur: number | null;
  costeTotal: number;
  mix: MixLote | null;
  /** kgCalibrador conciliado / kgClasificado: lleva el mix del papel a los kg del lote. */
  factorConciliado: number | null;
}

/** Lo mínimo que hace falta de la entrada de báscula para poner nombre a un lote. */
export interface EntradaIdentidad {
  lote: string;
  agricultor?: string | null;
  productor_id?: string | null;
  finca?: string | null;
  articulo?: string | null;
  kg_entrada?: number | string | null;
}

export interface ConstruirFilasInput {
  mermaLotes: MermaLote[];
  /** Entradas externas (sin precalibrado ni CAMPO/CIT). Si hay dos con el mismo lote gana la de más kg. */
  entradas: EntradaIdentidad[];
  mixPorLote: Map<string, MixLote>;
  /** calidad_productores: id → nombre canónico. */
  nombrePorProductorId: Map<string, string>;
  /** productores_alias: alias_normalizado → productor_id. */
  aliasPorNombre: Map<string, string>;
}

export function construirFilasMermaMdna(input: ConstruirFilasInput): FilaLoteMermaMdna[] {
  const entradaPorLote = new Map<string, EntradaIdentidad>();
  for (const e of input.entradas) {
    const lote8 = normalizarLoteCodigo(e.lote) ?? e.lote;
    // Una entrada por lote: si hubiera duplicados, gana la de más kg (la real;
    // las de 0 kg son correcciones administrativas).
    const previa = entradaPorLote.get(lote8);
    if (!previa || num(e.kg_entrada) > num(previa.kg_entrada)) entradaPorLote.set(lote8, e);
  }

  return input.mermaLotes.map((m): FilaLoteMermaMdna => {
    const e = entradaPorLote.get(m.lote);
    const agricultor = e?.agricultor ?? "";
    const { key, productorId } = resolveProductorGroupKey(agricultor, e?.productor_id ?? null, input.aliasPorNombre);
    const nombre = (productorId ? input.nombrePorProductorId.get(productorId) : null) ?? (agricultor.trim() || "(sin productor)");
    const interno = esProductorPrecalibrado(nombre) || esAgricultorMovimientoInterno(nombre)
      || esProductorPrecalibrado(agricultor) || esAgricultorMovimientoInterno(agricultor);

    const mix = input.mixPorLote.get(m.lote) ?? null;
    const factorConciliado = mix && mix.kgClasificado > 0 ? m.kgCalibrador / mix.kgClasificado : null;
    const mermaMedidaKg = m.mermaNaturalKg == null ? null : Math.max(0, m.mermaNaturalKg);
    const perdidaKg = mermaMedidaKg == null ? null : mermaMedidaKg + (m.podridoCalibradorKg ?? 0);

    return {
      lote: m.lote,
      fecha: m.fecha,
      productorKey: key,
      productor: nombre,
      finca: (e?.finca ?? "").trim() || "(sin finca)",
      variedad: (e?.articulo ?? "").trim() || "—",
      estado: m.estado,
      cerradoSinRegistro: m.cerradoSinRegistro,
      interno,
      diasEnCamara: m.diasEnCamara,
      kgEntrada: m.kgEntrada,
      kgAjuste: m.kgAjuste,
      kgCalibrador: m.kgCalibrador,
      mermaMedidaKg,
      mermaCamaraKg: m.mermaNaturalEstimadaKg,
      mermaCamaraReal: m.mermaCamaraReal,
      podridoPreKg: m.podridoPreCalibradorKg,
      podridoPreEsperadoKg: m.podridoPreCalibradorEsperadoKg,
      podridoPreNoVistoKg: m.podridoPreCalibradorNoVistoKg,
      sinMargen: m.podridoPreCalibradorSinMargen,
      podridoCalibradorKg: m.podridoCalibradorKg,
      podridoCalibradorFuente: m.podridoCalibradorFuente,
      podridoManualKg: m.podridoManualKg,
      perdidaKg,
      perdidaEur: m.perdidaTotalEur,
      costeTotal: m.costeTotalLote,
      mix,
      factorConciliado,
    };
  });
}

/**
 * Un lote no puede perder más de lo que entró. Los que salen así tienen un
 * `kg_ajuste_stock` NEGATIVO (alguien reasignó sus kg a otro lote a mano) y
 * meterían "merma" imposible: se apartan del año y se listan para arreglar
 * el apunte.
 */
export function esLoteImposible(f: FilaLoteMermaMdna): boolean {
  return f.mermaMedidaKg != null && (f.mermaMedidaKg > f.kgEntrada || f.kgAjuste < 0);
}

/** Las filas que entran en los rankings: ni movimientos internos ni imposibles. */
export function filasDelRanking(filas: FilaLoteMermaMdna[]): FilaLoteMermaMdna[] {
  return filas.filter((f) => !f.interno && !esLoteImposible(f));
}

// ─── Agregación por grupo (productor, o productor+finca) ─────────────────────

export type DimensionMermaMdna = "productor" | "productor_finca";

export interface GrupoMermaMdna {
  productor: string;
  productorKey: string;
  finca?: string;
  nLotes: number;
  nLotesConMerma: number;
  nLotesSinMerma: number;
  nLotesSinRegistro: number;
  nLotesPodridoReal: number;
  nLotesSinMargen: number;
  nLotesSinClasificacion: number;
  /**
   * Lotes cuya entrada entera es AJUSTE DE STOCK y no tienen ninguna pasada
   * propia (import del histórico: la fruta ya estaba contada). Su merma medida
   * es 0 de verdad, pero sus kg sí están en la base de los %, así que bajan el %
   * del grupo. Se cuentan aparte para que ese 0 se pueda explicar.
   */
  nLotesTodoAjuste: number;
  kgAjuste: number;

  kgEntradaTotal: number;
  /** Solo lotes con merma calculable: base de los % de merma de cámara y podrido de tría. */
  kgEntradaBase: number;
  /** Base del % de podrido de calibrador y de pérdida total (ver cabecera). */
  kgBasePctPerdida: number;
  kgCalibrador: number;
  kgDiasPonderados: number;
  /** Denominador de la media de días: solo los kg de lotes con días en cámara conocidos. */
  kgConDias: number;

  /** Σ max(0, merma natural) de los lotes procesados = merma cámara + podrido pre-calibrador. */
  mermaMedidaKg: number;
  mermaCamaraKg: number;
  podridoPreKg: number;
  podridoPreEsperadoKg: number;
  podridoPreNoVistoKg: number;
  podridoCalibradorKg: number;
  podridoManualKg: number;
  perdidaKg: number;
  perdidaEur: number;
  costeTotal: number;

  kgClasificado: number;
  kgExportacion: number;
  kgNoExportacion: number;
  kgMujeres: number;
  kgNoComercial: number;
  kgClaseApta: number;
  /** Kg del mix llevados a los kg conciliados del lote. */
  mdnaAjustado: Record<MetodoMdna, number>;
  mdnaSinFormatoAjustado: number;
  mdnaTotalAjustado: number;
  mdnaTotalClasificado: number;
  /** Clases A–F que NO acabaron en un producto de Mercadona. */
  kgAptoNoMdna: number;
}

export function grupoMermaMdnaVacio(productor: string, productorKey = productor, finca?: string): GrupoMermaMdna {
  return {
    productor, productorKey, ...(finca !== undefined ? { finca } : {}),
    nLotes: 0, nLotesConMerma: 0, nLotesSinMerma: 0, nLotesSinRegistro: 0,
    nLotesPodridoReal: 0, nLotesSinMargen: 0, nLotesSinClasificacion: 0, nLotesTodoAjuste: 0, kgAjuste: 0,
    kgEntradaTotal: 0, kgEntradaBase: 0, kgBasePctPerdida: 0, kgCalibrador: 0, kgDiasPonderados: 0, kgConDias: 0,
    mermaMedidaKg: 0, mermaCamaraKg: 0, podridoPreKg: 0, podridoPreEsperadoKg: 0, podridoPreNoVistoKg: 0,
    podridoCalibradorKg: 0, podridoManualKg: 0, perdidaKg: 0, perdidaEur: 0, costeTotal: 0,
    kgClasificado: 0, kgExportacion: 0, kgNoExportacion: 0, kgMujeres: 0, kgNoComercial: 0,
    kgClaseApta: 0,
    mdnaAjustado: { MA3KGC: 0, MA4KGC: 0, MA5KGC: 0, MA12KGC: 0 },
    mdnaSinFormatoAjustado: 0, mdnaTotalAjustado: 0, mdnaTotalClasificado: 0, kgAptoNoMdna: 0,
  };
}

export function acumularEnGrupo(g: GrupoMermaMdna, f: FilaLoteMermaMdna): void {
  g.nLotes += 1;
  g.kgEntradaTotal += f.kgEntrada;
  g.kgCalibrador += f.kgCalibrador;
  g.kgAjuste += f.kgAjuste;
  if (f.kgCalibrador <= 0 && f.kgAjuste >= f.kgEntrada && f.kgEntrada > 0) g.nLotesTodoAjuste += 1;
  if (f.cerradoSinRegistro) g.nLotesSinRegistro += 1;
  if (f.podridoCalibradorFuente === "real") g.nLotesPodridoReal += 1;
  if (f.sinMargen) g.nLotesSinMargen += 1;

  // La MERMA solo se calcula sobre lotes terminados: uno a medias todavía puede
  // seguir vaciándose desde cámara, así que restar ahora mezclaría cámara (fruta
  // que AÚN no ha pasado) con merma real.
  if (f.mermaMedidaKg == null) {
    g.nLotesSinMerma += 1;
    // Su PODRIDO sí cuenta (decisión del dueño 06-ago-2026), y por eso los kg
    // que ya han pasado por línea entran en la base del %.
    if ((f.podridoCalibradorKg ?? 0) > 0 || (f.podridoManualKg ?? 0) > 0) {
      g.kgBasePctPerdida += Math.max(0, f.kgCalibrador);
    }
  } else {
    g.nLotesConMerma += 1;
    g.kgEntradaBase += f.kgEntrada;
    g.kgBasePctPerdida += f.kgEntrada;
    g.mermaMedidaKg += f.mermaMedidaKg;
    // Sin desglose posible (calibrador por encima de la entrada, o sin días en
    // cámara conocidos) la merma medida entera se atribuye a cámara.
    g.mermaCamaraKg += f.mermaCamaraKg ?? f.mermaMedidaKg;
    g.podridoPreKg += f.podridoPreKg ?? 0;
    if (f.diasEnCamara != null) {
      g.kgDiasPonderados += f.kgEntrada * f.diasEnCamara;
      g.kgConDias += f.kgEntrada;
    }
  }
  g.podridoPreEsperadoKg += f.podridoPreEsperadoKg ?? 0;
  g.podridoPreNoVistoKg += f.podridoPreNoVistoKg ?? 0;
  g.podridoCalibradorKg += f.podridoCalibradorKg ?? 0;
  g.podridoManualKg += f.podridoManualKg ?? 0;
  g.perdidaEur += f.perdidaEur ?? 0;
  g.costeTotal += f.costeTotal;
  g.perdidaKg = g.mermaMedidaKg + g.podridoCalibradorKg;

  if (!f.mix) {
    g.nLotesSinClasificacion += 1;
    return;
  }
  const k = f.factorConciliado ?? 0;
  g.kgClasificado += f.mix.kgClasificado;
  g.kgExportacion += f.mix.kgExportacion;
  g.kgNoExportacion += f.mix.kgNoExportacion;
  g.kgMujeres += f.mix.kgMujeres;
  g.kgNoComercial += f.mix.kgNoComercial;
  g.kgClaseApta += f.mix.kgClaseApta;
  for (const m of METODOS_MDNA) g.mdnaAjustado[m] += f.mix.mdna[m] * k;
  g.mdnaSinFormatoAjustado += f.mix.mdnaSinFormato * k;
  g.mdnaTotalAjustado += f.mix.mdnaTotal * k;
  g.mdnaTotalClasificado += f.mix.mdnaTotal;
  g.kgAptoNoMdna += Math.max(0, f.mix.kgClaseApta - f.mix.mdnaTotal);
}

/** Agrupa por productor o por productor+finca. El orden de salida es el de aparición; ordenar es cosa de quien pinta. */
export function agruparMermaMdna(filas: FilaLoteMermaMdna[], dimension: DimensionMermaMdna): GrupoMermaMdna[] {
  const map = new Map<string, GrupoMermaMdna>();
  for (const f of filas) {
    const k = dimension === "productor" ? f.productorKey : `${f.productorKey}::${f.finca}`;
    let g = map.get(k);
    if (!g) {
      g = grupoMermaMdnaVacio(f.productor, f.productorKey, dimension === "productor_finca" ? f.finca : undefined);
      map.set(k, g);
    }
    acumularEnGrupo(g, f);
  }
  return [...map.values()];
}

/** La fila TOTAL: todas las filas en un solo grupo. */
export function totalMermaMdna(filas: FilaLoteMermaMdna[], nombre = "TOTAL CAMPAÑA"): GrupoMermaMdna {
  const g = grupoMermaMdnaVacio(nombre, nombre);
  for (const f of filas) acumularEnGrupo(g, f);
  return g;
}

/** Orden de los rankings de pérdida: peor % primero, y a igualdad, más kg. */
export function ordenarPorPerdida(grupos: GrupoMermaMdna[]): GrupoMermaMdna[] {
  return [...grupos].sort((a, b) =>
    (pctONull(b.perdidaKg, b.kgEntradaBase) ?? -1) - (pctONull(a.perdidaKg, a.kgEntradaBase) ?? -1)
    || b.kgEntradaTotal - a.kgEntradaTotal);
}

/** Orden de los rankings de Mercadona: mayor % sobre entrada primero. */
export function ordenarPorMdna(grupos: GrupoMermaMdna[]): GrupoMermaMdna[] {
  return [...grupos].sort((a, b) =>
    (pctONull(b.mdnaTotalAjustado, b.kgEntradaTotal) ?? -1) - (pctONull(a.mdnaTotalAjustado, a.kgEntradaTotal) ?? -1));
}

// ─── Las dos filas de salida (mismos % en la tabla y en el Excel) ────────────

export interface MetricasPerdida {
  productor: string;
  finca?: string;
  nLotes: number;
  nLotesConMerma: number;
  nLotesSinMerma: number;
  kgEntradaTotal: number;
  kgEntradaBase: number;
  diasMedio: number | null;
  nLotesTodoAjuste: number;
  kgAjuste: number;
  mermaMedidaKg: number;
  mermaCamaraKg: number;
  pctMermaCamara: number | null;
  podridoPreKg: number;
  pctPodridoPre: number | null;
  podridoPreEsperadoKg: number;
  podridoPreNoVistoKg: number;
  nLotesSinMargen: number;
  kgCalibrador: number;
  podridoCalibradorKg: number;
  pctPodridoCalibrador: number | null;
  nLotesPodridoReal: number;
  perdidaKg: number;
  kgBasePctPerdida: number;
  pctPerdida: number | null;
  perdidaEur: number | null;
  pctPerdidaCoste: number | null;
  podridoManualKg: number;
}

export function metricasPerdida(g: GrupoMermaMdna): MetricasPerdida {
  return {
    productor: g.productor,
    ...(g.finca !== undefined ? { finca: g.finca } : {}),
    nLotes: g.nLotes,
    nLotesConMerma: g.nLotesConMerma,
    nLotesSinMerma: g.nLotesSinMerma,
    kgEntradaTotal: g.kgEntradaTotal,
    kgEntradaBase: g.kgEntradaBase,
    // Media ponderada solo sobre los kg con días conocidos.
    diasMedio: g.kgConDias > 0 ? g.kgDiasPonderados / g.kgConDias : null,
    nLotesTodoAjuste: g.nLotesTodoAjuste,
    kgAjuste: g.kgAjuste,
    mermaMedidaKg: g.mermaMedidaKg,
    mermaCamaraKg: g.mermaCamaraKg,
    pctMermaCamara: pctONull(g.mermaCamaraKg, g.kgEntradaBase),
    podridoPreKg: g.podridoPreKg,
    pctPodridoPre: pctONull(g.podridoPreKg, g.kgEntradaBase),
    podridoPreEsperadoKg: g.podridoPreEsperadoKg,
    podridoPreNoVistoKg: g.podridoPreNoVistoKg,
    nLotesSinMargen: g.nLotesSinMargen,
    kgCalibrador: g.kgCalibrador,
    podridoCalibradorKg: g.podridoCalibradorKg,
    pctPodridoCalibrador: pctONull(g.podridoCalibradorKg, g.kgBasePctPerdida),
    nLotesPodridoReal: g.nLotesPodridoReal,
    perdidaKg: g.perdidaKg,
    kgBasePctPerdida: g.kgBasePctPerdida,
    pctPerdida: pctONull(g.perdidaKg, g.kgBasePctPerdida),
    perdidaEur: g.perdidaEur > 0 ? g.perdidaEur : null,
    pctPerdidaCoste: g.costeTotal > 0 ? pctONull(g.perdidaEur, g.costeTotal) : null,
    podridoManualKg: g.podridoManualKg,
  };
}

export interface MetricasMdna {
  productor: string;
  finca?: string;
  nLotes: number;
  nLotesSinClasificacion: number;
  kgEntradaTotal: number;
  kgCalibrador: number;
  kgClasificado: number;
  pctExportacion: number | null;
  pctNoExportacion: number | null;
  pctMujeres: number | null;
  pctNoComercial: number | null;
  pctClaseApta: number | null;
  mdna3: number;
  pctMdna3: number | null;
  mdna4: number;
  pctMdna4: number | null;
  mdna5: number;
  pctMdna5: number | null;
  mdna12: number;
  pctMdna12: number | null;
  mdnaSinFormato: number;
  mdnaTotalAjustado: number;
  pctMdnaSobreEntrada: number | null;
  pctMdnaSobreProcesado: number | null;
  mdnaTotalClasificado: number;
  kgAptoNoMdna: number;
}

export function metricasMdna(g: GrupoMermaMdna): MetricasMdna {
  return {
    productor: g.productor,
    ...(g.finca !== undefined ? { finca: g.finca } : {}),
    nLotes: g.nLotes,
    nLotesSinClasificacion: g.nLotesSinClasificacion,
    kgEntradaTotal: g.kgEntradaTotal,
    kgCalibrador: g.kgCalibrador,
    kgClasificado: g.kgClasificado,
    pctExportacion: pctONull(g.kgExportacion, g.kgClasificado),
    pctNoExportacion: pctONull(g.kgNoExportacion, g.kgClasificado),
    pctMujeres: pctONull(g.kgMujeres, g.kgClasificado),
    pctNoComercial: pctONull(g.kgNoComercial, g.kgClasificado),
    pctClaseApta: pctONull(g.kgClaseApta, g.kgClasificado),
    mdna3: g.mdnaAjustado.MA3KGC,
    pctMdna3: pctONull(g.mdnaAjustado.MA3KGC, g.kgEntradaTotal),
    mdna4: g.mdnaAjustado.MA4KGC,
    pctMdna4: pctONull(g.mdnaAjustado.MA4KGC, g.kgEntradaTotal),
    mdna5: g.mdnaAjustado.MA5KGC,
    pctMdna5: pctONull(g.mdnaAjustado.MA5KGC, g.kgEntradaTotal),
    mdna12: g.mdnaAjustado.MA12KGC,
    pctMdna12: pctONull(g.mdnaAjustado.MA12KGC, g.kgEntradaTotal),
    mdnaSinFormato: g.mdnaSinFormatoAjustado,
    mdnaTotalAjustado: g.mdnaTotalAjustado,
    pctMdnaSobreEntrada: pctONull(g.mdnaTotalAjustado, g.kgEntradaTotal),
    pctMdnaSobreProcesado: pctONull(g.mdnaTotalAjustado, g.kgCalibrador),
    mdnaTotalClasificado: g.mdnaTotalClasificado,
    kgAptoNoMdna: g.kgAptoNoMdna,
  };
}

// ─── Podrido pre-calibrador por MES DE PROCESO: lo pesado vs lo asumido ──────

export interface ParteBolsaBateas {
  date: string | null;
  kg_podrido_bolsa_basura: number | string | null;
  kg_podrido_bateas: number | string | null;
}

export interface FilaPodridoMes {
  mes: string;
  lotes: number;
  procesado: number | null;
  tasaMes: number;
  asumido: number | null;
  pctAsumido: number | null;
  esperado: number | null;
  noVisto: number;
  sinMargen: number;
  bolsa: number | null;
  bateas: number | null;
  pesadoTotal: number | null;
  partesConDato: number;
}

/**
 * La bolsa se pesa a diario y las bateas al vaciarlas (varios días). Ninguna
 * de las dos se puede repartir por lote, así que el contraste solo tiene
 * sentido agregado por MES DE PROCESO (fecha de entrada + días en cámara).
 */
export function podridoPorMesDeProceso(filas: FilaLoteMermaMdna[], partes: ParteBolsaBateas[]): FilaPodridoMes[] {
  const pesadoPorMes = new Map<string, { bolsa: number; bateas: number; partes: number }>();
  for (const p of partes) {
    const mes = (p.date ?? "").slice(0, 7);
    if (!mes) continue;
    const acc = pesadoPorMes.get(mes) ?? { bolsa: 0, bateas: 0, partes: 0 };
    acc.bolsa += num(p.kg_podrido_bolsa_basura);
    acc.bateas += num(p.kg_podrido_bateas);
    acc.partes += 1;
    pesadoPorMes.set(mes, acc);
  }
  const asumidoPorMes = new Map<string, { asumido: number; esperado: number; procesado: number; lotes: number; sinMargen: number }>();
  for (const f of filas) {
    if (f.diasEnCamara == null) continue;
    const fin = new Date(Date.UTC(
      Number(f.fecha.slice(0, 4)), Number(f.fecha.slice(5, 7)) - 1, Number(f.fecha.slice(8, 10)) + f.diasEnCamara));
    const mes = fin.toISOString().slice(0, 7);
    const acc = asumidoPorMes.get(mes) ?? { asumido: 0, esperado: 0, procesado: 0, lotes: 0, sinMargen: 0 };
    acc.asumido += f.podridoPreKg ?? 0;
    acc.esperado += f.podridoPreEsperadoKg ?? 0;
    acc.procesado += f.kgCalibrador;
    acc.lotes += 1;
    if (f.sinMargen) acc.sinMargen += 1;
    asumidoPorMes.set(mes, acc);
  }
  const meses = [...new Set([...pesadoPorMes.keys(), ...asumidoPorMes.keys()])].sort();
  return meses.map((mes) => {
    const p = pesadoPorMes.get(mes) ?? { bolsa: 0, bateas: 0, partes: 0 };
    const a = asumidoPorMes.get(mes) ?? { asumido: 0, esperado: 0, procesado: 0, lotes: 0, sinMargen: 0 };
    return {
      mes,
      lotes: a.lotes,
      procesado: a.procesado || null,
      tasaMes: tasaPodridoPreCalibradorMes(`${mes}-15`) * 100,
      asumido: a.asumido || null,
      pctAsumido: pctONull(a.asumido, a.procesado),
      esperado: a.esperado || null,
      noVisto: a.esperado > a.asumido ? a.esperado - a.asumido : 0,
      sinMargen: a.sinMargen,
      bolsa: p.bolsa || null,
      bateas: p.bateas || null,
      pesadoTotal: p.bolsa + p.bateas || null,
      partesConDato: p.partes,
    };
  });
}

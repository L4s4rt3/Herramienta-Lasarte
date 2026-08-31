/**
 * campanaEdge.ts — carga y ensamblaje de los datos de CAMPAÑA para las edge
 * functions (informe-semanal, vigia-negocio, cierre-mensual).
 *
 * Es el ESPEJO del cableado de src/hooks/useEntradasBascula.ts y
 * src/hooks/useMermaLote.ts — mismo orden de inyecciones (anotaciones →
 * desglose por box → señales de cámara → conciliación → stock/merma); si se
 * añade una inyección nueva en el hook, añadirla aquí también. Vivía dentro de
 * informe-semanal/index.ts; se extrajo el 31-08-2026 para que el vigía de
 * negocio y el cierre mensual usaran EXACTAMENTE las mismas cuentas (regla de
 * la casa: mismo número ⇒ misma función pura).
 *
 * OJO: este módulo NO es puro (habla con PostgREST vía el cliente que se le
 * pasa), por eso no tiene shim en src/lib ni tests de vitest: la lógica de
 * cálculo de verdad vive en conciliacionKg/entradasBascula/mermaLote, que sí
 * los tienen. Aquí solo hay fetch paginado y cableado.
 */
import { normalizarLoteCodigo } from "./loteCodigo.ts";
import {
  esEntradaCampoCit,
  esEntradaPrecalibrado,
  esErrorTablaOColumnaInexistente,
} from "./productoresCanonicos.ts";
import {
  agruparAnotacionesPorLoteDia,
  construirLoteCodigoEfectivo,
  type PasadaAnotacionRow,
} from "./pasadaAnotaciones.ts";
import {
  agruparLineasBoxPorLoteDia,
  expandirPasadaPorDesglose,
  lineaDesdeRow,
  type PasadaBoxLineaRow,
} from "./desgloseBox.ts";
import {
  codigosEnCamaraExterna,
  type CamionCamaraExterna,
  type SenalesRecepcion,
} from "./camarasExternas.ts";
import {
  camaraConfirmadaVigentePorLote,
  unirLotesConfirmadosEnCamara,
  type EntradaConCamaraConfirmada,
} from "./camaraConfirmada.ts";
import {
  capacidadFraccionEstimada,
  conciliarKgProcesados,
  detectarLotesEnPasadaCompuesta,
  type EntradaConciliacion,
  type ReciclajeDiaInput,
} from "./conciliacionKg.ts";
import { buildStockEntradas, type CierreModo } from "./entradasBascula.ts";
import {
  computeMermaLotes,
  mapPodridoAggToClasificacionInput,
  type EntradaLoteInput,
  type MermaLote,
  type ParteMermaInput,
  type PodridoAggRow,
} from "./mermaLote.ts";
import type { StockInforme } from "./informeSemanal.ts";

const PAGE = 1000;

/**
 * Lo mínimo que este módulo necesita del cliente de Supabase. Se tipa
 * estructural (y laxo) a propósito: así la lib no importa supabase-js y el
 * typecheck del frontend no la arrastra.
 */
// deno-lint-ignore no-explicit-any
export type DbLike = { from(tabla: string): any };

export function toNum(value: unknown): number {
  return Number(value) || 0;
}
export function toNumOrNull(value: unknown): number | null {
  return value == null ? null : Number(value) || 0;
}

/** Espejo de src/lib/fetchAllRows.ts: PostgREST recorta a 1.000 en silencio. */
export async function fetchTodas<T>(
  consulta: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await consulta(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const filas = data ?? [];
    out.push(...filas);
    if (filas.length < PAGE) return out;
  }
}

export async function fetchOpcional<T>(fetcher: () => Promise<T[]>): Promise<T[]> {
  try {
    return await fetcher();
  } catch (e) {
    if (esErrorTablaOColumnaInexistente(e)) return [];
    throw e;
  }
}

// ─── Campaña completa: los datos que alimentan stock y merma ────────────────
// Espejo de las queries de useEntradasBascula.ts / useMermaLote.ts /
// usePasadaBoxLineas.ts / useCamarasExternas.ts (mismos selects, misma
// paginación). Las tablas opcionales degradan a lista vacía igual que la app.

export interface EntradaCampanaRow {
  lote: string;
  fecha: string;
  agricultor: string | null;
  finca: string | null;
  articulo: string | null;
  kg_entrada: number | null;
  kg_ajuste_stock: number | null;
  importe_compra: number | null;
  coste_recoleccion: number | null;
  importe_transporte: number | null;
  importe_comision: number | null;
  importe_total: number | null;
  cerrado_at?: string | null;
  cierre_modo?: CierreModo | null;
  merma_camara_kg?: number | null;
  fecha_salida_camara?: string | null;
  camara_confirmada_nombre?: string | null;
  camara_confirmada_fecha?: string | null;
}

export interface PasadaCampana {
  id: string;
  lote_codigo: string | null;
  kg_peso_total: number;
  date: string | null;
}

export interface ParteCampana {
  id: string;
  date: string | null;
  kg_reciclado_malla_z1: number | null;
  kg_reciclado_malla_z2: number | null;
  box_reciclaje?: number | null;
  kg_podrido_calibrador_auto: number | null;
  kg_podrido_bolsa_basura: number | null;
}

export interface CampanaDatos {
  entradasTodas: EntradaCampanaRow[];
  lotesDia: Array<{ id: string; lote_codigo: string | null; kg_peso_total: number | null; part_id: string }>;
  partes: ParteCampana[];
  anotaciones: PasadaAnotacionRow[];
  boxLineas: PasadaBoxLineaRow[];
  camiones: CamionCamaraExterna[];
  clasifAgg: PodridoAggRow[];
}

export async function cargarCampana(db: DbLike): Promise<CampanaDatos> {
  const fetchPartes = async (): Promise<ParteCampana[]> => {
    try {
      return await fetchTodas<ParteCampana>((from, to) =>
        db.from("partes_diarios")
          .select("id, date, kg_reciclado_malla_z1, kg_reciclado_malla_z2, box_reciclaje, kg_podrido_calibrador_auto, kg_podrido_bolsa_basura")
          .order("id").range(from, to)
      );
    } catch (e) {
      if (!esErrorTablaOColumnaInexistente(e)) throw e;
      return await fetchTodas<ParteCampana>((from, to) =>
        db.from("partes_diarios")
          .select("id, date, kg_reciclado_malla_z1, kg_reciclado_malla_z2, kg_podrido_calibrador_auto, kg_podrido_bolsa_basura")
          .order("id").range(from, to)
      );
    }
  };

  const [entradasTodas, lotesDia, partes, anotaciones, boxLineas, camiones, clasifAgg] = await Promise.all([
    fetchTodas<EntradaCampanaRow>((from, to) =>
      db.from("entradas_bascula").select("*").order("fecha", { ascending: false }).order("id", { ascending: false }).range(from, to)
    ),
    fetchTodas<{ id: string; lote_codigo: string | null; kg_peso_total: number | null; part_id: string }>((from, to) =>
      db.from("lotes_dia").select("id, lote_codigo, kg_peso_total, part_id").order("id").range(from, to)
    ),
    fetchPartes(),
    fetchOpcional(() =>
      fetchTodas<PasadaAnotacionRow>((from, to) =>
        db.from("pasada_anotaciones").select("id, user_id, lote_dia_id, codigo_extra, nota, created_at").order("created_at").order("id").range(from, to)
      )
    ),
    fetchOpcional(() =>
      fetchTodas<PasadaBoxLineaRow>((from, to) =>
        db.from("pasada_box_lineas").select("id, user_id, lote_dia_id, posicion, tipo, lote_codigo, prec_fecha, box, box_tamano, nota").order("lote_dia_id").order("posicion").range(from, to)
      )
    ),
    fetchOpcional(() =>
      fetchTodas<CamionCamaraExterna>((from, to) =>
        db.from("camara_externa_camiones")
          .select("procedencia, s_ref, lote, fecha_almacenamiento, proveedor, finca, variedad, envases, kg, entrada_lst_1, entrada_lst_2, envases_1, envases_2, venta_directa, nota_entrada, transporte_lst")
          .order("fecha_almacenamiento").order("s_ref").range(from, to)
      )
    ),
    // Vista agregada del podrido por lote (migración 20260717120000): si no
    // existiera, el informe FALLA a propósito — degradar aquí cambiaría el
    // podrido real por prorrateo en silencio.
    fetchTodas<PodridoAggRow>((from, to) =>
      db.from("lote_clasificacion_podrido_agg").select("lote8, kg_podrido, n_filas").order("lote8").range(from, to)
    ),
  ]);

  return { entradasTodas, lotesDia, partes, anotaciones, boxLineas, camiones, clasifAgg };
}

export interface StockYMerma {
  stockInforme: StockInforme;
  /** MermaLote de TODA la campaña, los mismos números que "Mermas y coste". */
  mermaLotes: MermaLote[];
  /** Última fecha de procesado por lote (la conciliada; sin ella, la cruda). */
  ultimaFechaPorLote: Map<string, string | null>;
  /** Productor/finca de báscula por clave de lote (8 dígitos). */
  datosPorLote: Map<string, { agricultor: string | null; finca: string | null }>;
  fincaPorLote: Map<string, string | null>;
}

/**
 * Stock y merma con el MISMO cableado que useEntradasBascula/useMermaLotes.
 * Devuelve también los mapas auxiliares que los informes necesitan.
 */
export function calcularStockYMerma(campana: CampanaDatos, hoy: string): StockYMerma {
  const { entradasTodas, lotesDia, partes, anotaciones, boxLineas, camiones, clasifAgg } = campana;

  // 1) Partición de entradas (espejo de useEntradasBascula):
  //    PREC = movimiento interno (fuera de stock, tope de re-pasadas);
  //    CAMPO/CIT = derivado a Cítrica (fuera de stock y merma).
  const externas: EntradaCampanaRow[] = [];
  const precalibrado: EntradaCampanaRow[] = [];
  for (const e of entradasTodas) {
    if (esEntradaPrecalibrado(e)) precalibrado.push(e);
    else if (esEntradaCampoCit(e)) continue;
    else externas.push(e);
  }

  // 2) Pasadas del calibrador con la fecha de su parte.
  const fechaPorParte = new Map(partes.map((p) => [p.id, p.date ?? null]));
  const pasadasCrudas: PasadaCampana[] = lotesDia.map((l) => ({
    id: l.id,
    lote_codigo: l.lote_codigo,
    kg_peso_total: toNum(l.kg_peso_total),
    date: fechaPorParte.get(l.part_id) ?? null,
  }));

  const reciclajePorDia: ReciclajeDiaInput[] = partes
    .map((p) => ({
      fecha: p.date ?? "",
      kgBruto: toNum(p.kg_reciclado_malla_z1) + toNum(p.kg_reciclado_malla_z2),
      nBox: toNum(p.box_reciclaje),
    }))
    .filter((p) => p.kgBruto > 0);

  // 3) Inyección de anotaciones a posteriori (código efectivo por pasada).
  const anotacionesPorLoteDia = agruparAnotacionesPorLoteDia(anotaciones);
  const pasadasConAnotaciones = anotacionesPorLoteDia.size === 0 ? pasadasCrudas : pasadasCrudas.map((p) => {
    const filas = anotacionesPorLoteDia.get(p.id);
    if (!filas || filas.length === 0) return p;
    return { ...p, lote_codigo: construirLoteCodigoEfectivo(p.lote_codigo, filas.map((f) => f.codigo_extra)) };
  });

  // 4) Inyección del desglose por box (pasadas sintéticas ya repartidas).
  const lineasPorLoteDia = agruparLineasBoxPorLoteDia(boxLineas);
  const pasadasConDesgloseBox = lineasPorLoteDia.size === 0 ? pasadasConAnotaciones : pasadasConAnotaciones.flatMap((p) => {
    const filas = lineasPorLoteDia.get(p.id);
    if (!filas || filas.length === 0) return [p];
    return expandirPasadaPorDesglose(p, filas.map(lineaDesdeRow));
  });

  // 5) Señales de "sigue en cámara": externa (Guadex/Zamexfruit) + física.
  const salidaPorLote = new Map<string, string | null>();
  for (const e of externas) {
    if (e.fecha_salida_camara == null && e.merma_camara_kg == null) continue;
    const lote8 = normalizarLoteCodigo(e.lote);
    if (lote8) salidaPorLote.set(lote8, e.fecha_salida_camara ?? null);
  }
  const lotesProcesados = new Set<string>();
  for (const p of pasadasCrudas) {
    const lote8 = normalizarLoteCodigo(p.lote_codigo);
    if (lote8) lotesProcesados.add(lote8);
  }
  const senales: SenalesRecepcion = { salidaPorLote, lotesProcesados };
  const codigosExterna = codigosEnCamaraExterna(camiones, senales, hoy);
  const confirmadaPorLote = camaraConfirmadaVigentePorLote(
    externas.map((e): EntradaConCamaraConfirmada => ({
      lote: e.lote,
      camara_confirmada_nombre: e.camara_confirmada_nombre ?? null,
      camara_confirmada_fecha: e.camara_confirmada_fecha ?? null,
    })),
    pasadasCrudas,
  );
  const lotesConfirmadosEnCamara = unirLotesConfirmadosEnCamara(codigosExterna, confirmadaPorLote);

  // 6) Conciliación de kg procesados (reglas del dueño 21-jul-2026).
  const aConciliacion = (e: EntradaCampanaRow, esPrec: boolean): EntradaConciliacion => ({
    lote: e.lote,
    fecha: e.fecha,
    finca: e.finca,
    articulo: e.articulo,
    kg_entrada: toNum(e.kg_entrada),
    kg_preasignado: Math.max(0, toNum(e.kg_ajuste_stock)),
    esPrecalibrado: esPrec,
    cerrado: Boolean(e.cerrado_at),
    kg_merma_camara: e.merma_camara_kg ?? null,
  });
  const conciliacion = conciliarKgProcesados(
    [...externas.map((e) => aConciliacion(e, false)), ...precalibrado.map((e) => aConciliacion(e, true))],
    pasadasConDesgloseBox,
    reciclajePorDia,
    lotesConfirmadosEnCamara,
  );

  const lotesEnPasadaCompuesta = detectarLotesEnPasadaCompuesta(
    pasadasCrudas.map((p) => ({ lote_codigo: p.lote_codigo, kg_peso_total: p.kg_peso_total, date: p.date })),
  );

  // Regla de oro: los kg recibidos por derrame no puntúan para cerrar.
  const kgDerramePorLote = new Map<string, number>();
  for (const m of conciliacion.movimientos) {
    if (m.motivo !== "exceso_misma_finca" && m.motivo !== "exceso_misma_variedad") continue;
    const clave = normalizarLoteCodigo(m.a) ?? m.a;
    kgDerramePorLote.set(clave, (kgDerramePorLote.get(clave) ?? 0) + toNum(m.kg));
  }

  // 7) STOCK — misma llamada que la pestaña Stock de Entradas.
  const stock = buildStockEntradas(
    externas.map((e) => ({
      lote: e.lote,
      fecha: e.fecha,
      kg_entrada: toNum(e.kg_entrada),
      kg_ajuste_stock: toNum(e.kg_ajuste_stock),
      finca: e.finca,
      articulo: e.articulo,
      agricultor: e.agricultor,
      cerrado_at: e.cerrado_at ?? null,
      cierre_modo: e.cierre_modo ?? null,
    })),
    conciliacion.procesados,
    hoy,
    lotesEnPasadaCompuesta,
    capacidadFraccionEstimada,
    lotesConfirmadosEnCamara,
    confirmadaPorLote,
    kgDerramePorLote,
  );
  const stockInforme: StockInforme = {
    kgEnCamara: stock.kgEnCamara,
    kgEnCamaraFirme: stock.kgEnCamaraFirme,
    kgProbablementeTerminados: stock.kgProbablementeTerminados,
    lotesProbablementeTerminados: stock.lotesProbablementeTerminados,
    lotesPendientes: stock.lotesPendientes,
    lotesParciales: stock.lotesParciales,
    antiguedadMaxDias: stock.antiguedadMaxDias,
  };

  // 8) MERMA — misma llamada que la pestaña "Mermas y coste".
  const conciliadoPorLote = new Map<string, { kg: number; ultimaFecha: string | null }>();
  for (const p of conciliacion.procesados) {
    conciliadoPorLote.set(p.lote_codigo, { kg: p.kg_peso_total, ultimaFecha: p.date });
  }
  const entradasMerma: EntradaLoteInput[] = externas.map((e) => ({
    lote: e.lote,
    fecha: e.fecha,
    kg_entrada: toNum(e.kg_entrada),
    kg_ajuste_stock: toNumOrNull(e.kg_ajuste_stock),
    importe_compra: toNumOrNull(e.importe_compra),
    coste_recoleccion: toNumOrNull(e.coste_recoleccion),
    importe_transporte: toNumOrNull(e.importe_transporte),
    importe_comision: toNumOrNull(e.importe_comision),
    importe_total: toNumOrNull(e.importe_total),
    cerrado_at: e.cerrado_at ?? null,
    cierre_modo: e.cierre_modo ?? null,
    merma_camara_kg: toNumOrNull(e.merma_camara_kg),
  }));
  const partesMerma: ParteMermaInput[] = partes.map((p) => ({
    part_id: p.id,
    date: p.date ?? null,
    kg_podrido_calibrador_auto: toNumOrNull(p.kg_podrido_calibrador_auto),
    kg_podrido_bolsa_basura: toNumOrNull(p.kg_podrido_bolsa_basura),
  }));
  const mermaLotes = computeMermaLotes(
    entradasMerma,
    lotesDia.map((l) => ({ lote_codigo: l.lote_codigo, kg_peso_total: toNum(l.kg_peso_total), part_id: l.part_id })),
    mapPodridoAggToClasificacionInput(clasifAgg),
    partesMerma,
    conciliadoPorLote.size > 0 ? conciliadoPorLote : undefined,
  );

  // Última fecha de procesado por lote: la conciliada; sin ella, la cruda.
  const ultimaFechaPorLote = new Map<string, string | null>();
  for (const p of pasadasCrudas) {
    const lote8 = normalizarLoteCodigo(p.lote_codigo);
    if (!lote8 || !p.date) continue;
    const actual = ultimaFechaPorLote.get(lote8);
    if (!actual || p.date > actual) ultimaFechaPorLote.set(lote8, p.date);
  }
  for (const [lote, c] of conciliadoPorLote) {
    if (c.ultimaFecha) ultimaFechaPorLote.set(lote, c.ultimaFecha);
  }

  const datosPorLote = new Map<string, { agricultor: string | null; finca: string | null }>();
  for (const e of externas) {
    const lote8 = normalizarLoteCodigo(e.lote);
    if (lote8 && !datosPorLote.has(lote8)) datosPorLote.set(lote8, { agricultor: e.agricultor, finca: e.finca });
  }

  // finca por lote para los desgloses por productor+finca.
  const fincaPorLote = new Map<string, string | null>();
  for (const [lote8, d] of datosPorLote) fincaPorLote.set(lote8, d.finca);

  return { stockInforme, mermaLotes, ultimaFechaPorLote, datosPorLote, fincaPorLote };
}

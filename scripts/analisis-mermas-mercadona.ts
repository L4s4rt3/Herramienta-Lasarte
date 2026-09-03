/**
 * analisis-mermas-mercadona — el informe completo de PÉRDIDA DE FRUTA por
 * productor y finca, con el aprovechamiento de Mercadona (los 4 formatos) al
 * lado, en un solo Excel.
 *
 *   node node_modules/vite-node/vite-node.mjs scripts/analisis-mermas-mercadona.ts
 *
 * ─── Por qué es un script y no una página ───────────────────────────────────
 * La app ya enseña estos números repartidos entre /entradas ("Mermas y coste"),
 * /productores y /mercadona. Lo que no existía era la FOTO ENTERA de la
 * campaña: la cascada completa de un kg de naranja desde que la báscula lo pesa
 * hasta que sale en una malla de Mercadona, cortada por productor y por finca.
 * Eso es lo que genera este script.
 *
 * ─── No re-implementa NADA ──────────────────────────────────────────────────
 * El cableado es un ESPEJO de supabase/functions/informe-semanal/index.ts (que
 * a su vez lo es de useEntradasBascula.ts + useMermaLote.ts): mismas queries,
 * mismo orden de inyecciones (anotaciones → desglose por box → señales de
 * cámara → conciliación → merma) y las MISMAS funciones puras
 * (conciliarKgProcesados, computeMermaLotes, deducirMetodoVentaMdna). Si un día
 * cambia una fórmula en _shared, este informe cambia con ella. Lo único propio
 * de aquí es la AGREGACIÓN por productor/finca y el cruce con la clasificación.
 *
 * ─── La cascada, y por qué cada kg cuenta una sola vez ──────────────────────
 *   kg entrada (báscula)
 *     ├── merma de cámara ......... deshidratación: dato REAL (merma_camara_kg)
 *     │                             o estimado TASA_MERMA_NATURAL_DIA × días
 *     ├── podrido pre-calibrador .. la tría antes de la máquina (bolsa + bateas).
 *     │                             Por lote SIEMPRE se deduce por resta; se
 *     │                             contrasta con la tasa esperada del mes.
 *     └── kg procesado (conciliado)
 *           ├── podrido de calibrador ... REAL si hay Informe LOTE, si no prorrateo
 *           └── fruta clasificada ....... exportación / no exportación / mujeres /
 *                                         no comercial, y dentro de exportación
 *                                         los 4 formatos de Mercadona.
 * Pérdida total = merma medida (cámara + pre-calibrador) + podrido de
 * calibrador. El podrido MANUAL (bolsa) no se suma aparte: sale ANTES del
 * calibrador y ya está dentro de la merma medida (decisión del dueño
 * 06-ago-2026) — se enseña como desglose, nunca como sumando.
 *
 * ─── El aprovechamiento de Mercadona: dos cifras, no una ────────────────────
 * La clasificación (lote_clasificacion) atribuye los kg al PRIMER código de la
 * pasada, igual que lotes_dia — el mismo sesgo que la conciliación corrige para
 * los kg. Como la conciliación reparte KG pero no MEZCLA, aquí se hace lo
 * honesto: el MIX (qué % de lo clasificado fue a cada formato) se toma tal cual
 * del informe, y ese mix se aplica a los kg CONCILIADOS del lote. Se publican
 * las dos columnas — "clasificado" (lo que dice el papel) y "sobre procesado
 * conciliado" (lo que le toca al lote) — nunca una sola cifra que esconda cuál
 * es cuál. Un lote sin informe de clasificación no tiene mix: sale `null`, no 0.
 *
 * Los 4 formatos salen de `deducirMetodoVentaMdna` (productosCanonicos.ts), que
 * lee el formato del NOMBRE del producto: MA3KGC (malla 3 kg), MA4KGC (girsac 4
 * kg exprimidor), MA5KGC (D-Pack 5 kg) y MA12KGC (granel). Lo que dice "MDNA"
 * pero no declara formato se cuenta aparte ("MDNA sin formato"), no se reparte
 * a ojo entre los cuatro.
 */
import fs from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { normalizarLoteCodigo } from "../src/lib/loteCodigo";
import {
  agregarMermaLotes,
  computeMermaLotes,
  mapPodridoAggToClasificacionInput,
  pctPerdidaTotalDeAgregado,
  TASA_MERMA_NATURAL_DIA,
  tasaPodridoPreCalibradorMes,
  type EntradaLoteInput,
  type MermaLote,
  type ParteMermaInput,
  type PodridoAggRow,
} from "../src/lib/mermaLote";
import {
  conciliarKgProcesados,
  type EntradaConciliacion,
  type ReciclajeDiaInput,
} from "../src/lib/conciliacionKg";
import {
  esEntradaCampoCit,
  esEntradaImportacion,
  esEntradaPrecalibrado,
  esErrorTablaOColumnaInexistente,
} from "../src/lib/productoresCanonicos";
import {
  agruparAnotacionesPorLoteDia,
  construirLoteCodigoEfectivo,
  type PasadaAnotacionRow,
} from "../src/lib/pasadaAnotaciones";
import {
  agruparLineasBoxPorLoteDia,
  expandirPasadaPorDesglose,
  lineaDesdeRow,
  type PasadaBoxLineaRow,
} from "../src/lib/desgloseBox";
import { codigosEnCamaraExterna, type CamionCamaraExterna, type SenalesRecepcion } from "../src/lib/camarasExternas";
import {
  camaraConfirmadaVigentePorLote,
  unirLotesConfirmadosEnCamara,
  type EntradaConCamaraConfirmada,
} from "../src/lib/camaraConfirmada";
import { LABEL_MDNA, METODOS_MDNA, mixPorLoteDesdeClasificacion } from "../src/lib/mdnaMix";
import {
  agruparMermaMdna,
  construirFilasMermaMdna,
  esLoteImposible,
  metricasMdna,
  metricasPerdida,
  type GrupoMermaMdna,
  ordenarPorMdna,
  ordenarPorPerdida,
  podridoPorMesDeProceso,
  totalMermaMdna,
} from "../src/lib/mermaMdnaAgregado";

// Las filas del Excel son objetos abiertos (Record) para añadirHojaTabla; las
// métricas vienen tipadas de la lib, así que se copian tal cual.
const filaPerdida = (g: GrupoMermaMdna): Record<string, unknown> => ({ ...metricasPerdida(g) });
const filaMdna = (g: GrupoMermaMdna): Record<string, unknown> => ({ ...metricasMdna(g) });
import {
  añadirHojaTabla,
  crearLibroLasarte,
  FMT_EUR,
  FMT_INT,
  FMT_KG,
  FMT_PCT,
  type ColumnaTabla,
} from "../src/lib/exportKit";

process.loadEnvFile(".env");

const PAGE = 1000;
const SALIDA = path.resolve("outputs", `Mermas_Podrido_Aprovechamiento_MDNA_${new Date().toISOString().slice(0, 10)}.xlsx`);

const num = (v: unknown): number => Number(v) || 0;
const numOrNull = (v: unknown): number | null => (v == null ? null : Number(v) || 0);
const pct = (parte: number | null, total: number | null): number | null =>
  parte == null || total == null || total <= 0 ? null : (parte / total) * 100;

/** Espejo de src/lib/fetchAllRows.ts: PostgREST recorta a 1.000 filas en silencio. */
async function fetchTodas<T>(
  etiqueta: string,
  consulta: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await consulta(from, from + PAGE - 1);
    if (error) throw Object.assign(new Error(`${etiqueta}: ${error.message}`), error);
    const filas = data ?? [];
    out.push(...filas);
    if (filas.length < PAGE) {
      console.log(`  ${etiqueta}: ${out.length} filas`);
      return out;
    }
    if (out.length % 50_000 === 0) console.log(`  ${etiqueta}: ${out.length}…`);
  }
}

/**
 * Reintenta una carga que puede morir por `statement timeout` (código 57014).
 * `lote_clasificacion_podrido_agg` es una VISTA que reagrega las ~260.000 filas
 * de lote_clasificacion en cada llamada: lanzada a la vez que las otras ocho
 * consultas, el servidor la corta de vez en cuando. No es un error de datos —
 * la misma consulta pasa sola — así que se reintenta con una espera creciente
 * en vez de tumbar el informe entero.
 */
async function conReintento<T>(etiqueta: string, fetcher: () => Promise<T>, intentos = 3): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fetcher();
    } catch (e) {
      const codigo = (e as { code?: string }).code;
      const esTimeout = codigo === "57014" || /statement timeout/i.test(String((e as Error).message ?? ""));
      if (!esTimeout || i >= intentos) throw e;
      const espera = i * 5000;
      console.log(`  ${etiqueta}: timeout del servidor, reintento ${i}/${intentos - 1} en ${espera / 1000}s…`);
      await new Promise((r) => setTimeout(r, espera));
    }
  }
}

async function fetchOpcional<T>(fetcher: () => Promise<T[]>): Promise<T[]> {
  try {
    return await fetcher();
  } catch (e) {
    if (esErrorTablaOColumnaInexistente(e)) return [];
    throw e;
  }
}

// ─── Filas crudas ────────────────────────────────────────────────────────────

interface EntradaRow {
  id: string;
  lote: string;
  fecha: string;
  agricultor: string | null;
  productor_id: string | null;
  finca: string | null;
  articulo: string | null;
  kg_entrada: number | null;
  kg_ajuste_stock: number | null;
  importe_compra: number | null;
  coste_recoleccion: number | null;
  importe_transporte: number | null;
  importe_comision: number | null;
  importe_total: number | null;
  cerrado_at: string | null;
  cierre_modo: "con_analisis" | "sin_registro" | null;
  merma_camara_kg: number | null;
  fecha_salida_camara: string | null;
  camara_confirmada_nombre: string | null;
  camara_confirmada_fecha: string | null;
}

interface ClasifRow {
  lote_codigo: string | null;
  producto: string | null;
  clase: string | null;
  grupo_destino: string | null;
  peso_kg: number | null;
  /** Parte al que pertenece el desglose: sirve para saber qué DÍAS de línea tienen mix por lote y cuáles no (ver la hoja "Cobertura del mix"). */
  part_id: string | null;
}

// ─── Carga ───────────────────────────────────────────────────────────────────

async function cargar(db: SupabaseClient) {
  console.log("Cargando campaña completa de Supabase…");
  const [entradas, lotesDia, partes, anotaciones, boxLineas, camiones, productores, alias] =
    await Promise.all([
      fetchTodas<EntradaRow>("entradas_bascula", (f, t) =>
        db.from("entradas_bascula").select("*").order("fecha", { ascending: false }).order("id", { ascending: false }).range(f, t)),
      fetchTodas<{ id: string; lote_codigo: string | null; kg_peso_total: number | null; part_id: string }>("lotes_dia", (f, t) =>
        db.from("lotes_dia").select("id, lote_codigo, kg_peso_total, part_id").order("id").range(f, t)),
      fetchTodas<{
        id: string; date: string | null;
        kg_reciclado_malla_z1: number | null; kg_reciclado_malla_z2: number | null; box_reciclaje: number | null;
        kg_podrido_calibrador_auto: number | null; kg_podrido_bolsa_basura: number | null; kg_podrido_bateas: number | null;
      }>("partes_diarios", (f, t) =>
        db.from("partes_diarios")
          .select("id, date, kg_reciclado_malla_z1, kg_reciclado_malla_z2, box_reciclaje, kg_podrido_calibrador_auto, kg_podrido_bolsa_basura, kg_podrido_bateas")
          .order("id").range(f, t)),
      fetchOpcional(() => fetchTodas<PasadaAnotacionRow>("pasada_anotaciones", (f, t) =>
        db.from("pasada_anotaciones").select("id, user_id, lote_dia_id, codigo_extra, nota, created_at").order("created_at").order("id").range(f, t))),
      fetchOpcional(() => fetchTodas<PasadaBoxLineaRow>("pasada_box_lineas", (f, t) =>
        db.from("pasada_box_lineas").select("id, user_id, lote_dia_id, posicion, tipo, lote_codigo, prec_fecha, box, box_tamano, nota").order("lote_dia_id").order("posicion").range(f, t))),
      fetchOpcional(() => fetchTodas<CamionCamaraExterna>("camara_externa_camiones", (f, t) =>
        db.from("camara_externa_camiones")
          .select("procedencia, s_ref, lote, fecha_almacenamiento, proveedor, finca, variedad, envases, kg, entrada_lst_1, entrada_lst_2, envases_1, envases_2, venta_directa, nota_entrada, transporte_lst")
          .order("fecha_almacenamiento").order("s_ref").range(f, t))),
      fetchTodas<{ id: string; nombre: string }>("calidad_productores", (f, t) =>
        db.from("calidad_productores").select("id, nombre").order("id").range(f, t)),
      fetchOpcional(() => fetchTodas<{ alias_normalizado: string; productor_id: string }>("productores_alias", (f, t) =>
        db.from("productores_alias").select("alias_normalizado, productor_id").order("productor_id").range(f, t))),
    ]);

  // Podrido REAL por lote, ya agregado en servidor. Va SECUENCIAL y con
  // reintento a propósito: es una vista que reagrega las ~260.000 filas de
  // lote_clasificacion en cada llamada, y lanzada junto a las otras ocho
  // consultas el servidor la corta por `statement timeout` (pasó el 28-08-2026).
  // Si la vista no existiera, el informe falla a propósito: degradar cambiaría
  // el podrido real por prorrateo en silencio (mismo criterio que informe-semanal).
  const clasifAgg = await conReintento("lote_clasificacion_podrido_agg", () =>
    fetchTodas<PodridoAggRow>("lote_clasificacion_podrido_agg", (f, t) =>
      db.from("lote_clasificacion_podrido_agg").select("lote8, kg_podrido, n_filas").order("lote8").range(f, t)));

  // La clasificación completa también va aparte: son ~260.000 filas y no
  // conviene lanzarla en paralelo con el resto (el pool se resiente y no gana nada).
  const clasif = await conReintento("lote_clasificacion", () =>
    fetchTodas<ClasifRow>("lote_clasificacion", (f, t) =>
      db.from("lote_clasificacion").select("lote_codigo, producto, clase, grupo_destino, peso_kg, part_id").order("id").range(f, t)));

  return { entradas, lotesDia, partes, anotaciones, boxLineas, camiones, clasifAgg, productores, alias, clasif };
}

// ─── Pipeline (espejo de informe-semanal/index.ts) ───────────────────────────

function calcularMerma(datos: Awaited<ReturnType<typeof cargar>>, hoy: string) {
  const { entradas, lotesDia, partes, anotaciones, boxLineas, camiones, clasifAgg } = datos;

  // 1) Partición de entradas: PREC = movimiento interno (fuera de stock, tope
  //    de re-pasadas); CAMPO/CIT = fruta derivada a Cítrica, nunca entra a línea.
  const externas: EntradaRow[] = [];
  const precalibrado: EntradaRow[] = [];
  const campoCit: EntradaRow[] = [];
  const importacion: EntradaRow[] = [];
  for (const e of entradas) {
    if (esEntradaPrecalibrado(e)) precalibrado.push(e);
    else if (esEntradaCampoCit(e)) campoCit.push(e);
    else if (esEntradaImportacion(e)) importacion.push(e);
    else externas.push(e);
  }

  // 2) Pasadas del calibrador con la fecha de su parte.
  const fechaPorParte = new Map(partes.map((p) => [p.id, p.date ?? null]));
  const pasadasCrudas = lotesDia.map((l) => ({
    id: l.id,
    lote_codigo: l.lote_codigo,
    kg_peso_total: num(l.kg_peso_total),
    date: fechaPorParte.get(l.part_id) ?? null,
  }));

  const reciclajePorDia: ReciclajeDiaInput[] = partes
    .map((p) => ({
      fecha: p.date ?? "",
      kgBruto: num(p.kg_reciclado_malla_z1) + num(p.kg_reciclado_malla_z2),
      nBox: num(p.box_reciclaje),
    }))
    .filter((p) => p.kgBruto > 0);

  // 3) Anotaciones a posteriori: código efectivo por pasada.
  const anotacionesPorLoteDia = agruparAnotacionesPorLoteDia(anotaciones);
  const conAnotaciones = anotacionesPorLoteDia.size === 0 ? pasadasCrudas : pasadasCrudas.map((p) => {
    const filas = anotacionesPorLoteDia.get(p.id);
    if (!filas?.length) return p;
    return { ...p, lote_codigo: construirLoteCodigoEfectivo(p.lote_codigo, filas.map((f) => f.codigo_extra)) };
  });

  // 4) Desglose por box: pasadas sintéticas ya repartidas.
  const lineasPorLoteDia = agruparLineasBoxPorLoteDia(boxLineas);
  const conDesglose = lineasPorLoteDia.size === 0 ? conAnotaciones : conAnotaciones.flatMap((p) => {
    const filas = lineasPorLoteDia.get(p.id);
    if (!filas?.length) return [p];
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
  const confirmadaPorLote = camaraConfirmadaVigentePorLote(
    externas.map((e): EntradaConCamaraConfirmada => ({
      lote: e.lote,
      camara_confirmada_nombre: e.camara_confirmada_nombre ?? null,
      camara_confirmada_fecha: e.camara_confirmada_fecha ?? null,
    })),
    pasadasCrudas,
  );
  const lotesConfirmadosEnCamara = unirLotesConfirmadosEnCamara(
    codigosEnCamaraExterna(camiones, senales, hoy),
    confirmadaPorLote,
  );

  // 6) Conciliación de kg procesados (reglas del dueño, 21-jul-2026).
  const aConciliacion = (e: EntradaRow, esPrec: boolean): EntradaConciliacion => ({
    lote: e.lote,
    fecha: e.fecha,
    finca: e.finca,
    articulo: e.articulo,
    kg_entrada: num(e.kg_entrada),
    kg_preasignado: Math.max(0, num(e.kg_ajuste_stock)),
    esPrecalibrado: esPrec,
    cerrado: Boolean(e.cerrado_at),
    kg_merma_camara: e.merma_camara_kg ?? null,
  });
  const conciliacion = conciliarKgProcesados(
    [...externas.map((e) => aConciliacion(e, false)), ...precalibrado.map((e) => aConciliacion(e, true))],
    conDesglose,
    reciclajePorDia,
    lotesConfirmadosEnCamara,
  );

  // 7) Merma por lote — misma llamada que la pestaña "Mermas y coste".
  const conciliadoPorLote = new Map<string, { kg: number; ultimaFecha: string | null }>();
  for (const p of conciliacion.procesados) {
    conciliadoPorLote.set(p.lote_codigo, { kg: p.kg_peso_total, ultimaFecha: p.date });
  }
  const entradasMerma: EntradaLoteInput[] = externas.map((e) => ({
    lote: e.lote,
    fecha: e.fecha,
    kg_entrada: num(e.kg_entrada),
    // El clamp del ajuste negativo vive ahora en la lib compartida
    // (mermaLote.ts, 28-ago-2026): aquí ya no hay que hacer nada especial.
    kg_ajuste_stock: numOrNull(e.kg_ajuste_stock),
    importe_compra: numOrNull(e.importe_compra),
    coste_recoleccion: numOrNull(e.coste_recoleccion),
    importe_transporte: numOrNull(e.importe_transporte),
    importe_comision: numOrNull(e.importe_comision),
    importe_total: numOrNull(e.importe_total),
    cerrado_at: e.cerrado_at ?? null,
    cierre_modo: e.cierre_modo ?? null,
    merma_camara_kg: numOrNull(e.merma_camara_kg),
  }));
  const partesMerma: ParteMermaInput[] = partes.map((p) => ({
    part_id: p.id,
    date: p.date ?? null,
    kg_podrido_calibrador_auto: numOrNull(p.kg_podrido_calibrador_auto),
    kg_podrido_bolsa_basura: numOrNull(p.kg_podrido_bolsa_basura),
  }));
  const mermaLotes = computeMermaLotes(
    entradasMerma,
    lotesDia.map((l) => ({ lote_codigo: l.lote_codigo, kg_peso_total: num(l.kg_peso_total), part_id: l.part_id })),
    mapPodridoAggToClasificacionInput(clasifAgg),
    partesMerma,
    conciliadoPorLote.size > 0 ? conciliadoPorLote : undefined,
  );

  // Los INPUTS se devuelven junto al resultado para poder repetir el cálculo
  // con las mismas piezas (ver `simularCierreDeCampana`): así la simulación usa
  // exactamente la misma función pura que el número real, sin una segunda
  // implementación que pueda divergir.
  const lotesDiaInput = lotesDia.map((l) => ({
    lote_codigo: l.lote_codigo, kg_peso_total: num(l.kg_peso_total), part_id: l.part_id,
  }));
  const clasifInput = mapPodridoAggToClasificacionInput(clasifAgg);

  return {
    mermaLotes, externas, precalibrado, campoCit, importacion, conciliacion,
    entradasMerma, lotesDiaInput, clasifInput, partesMerma, conciliadoPorLote,
  };
}

/**
 * "Ya no queda fruta en el almacén": qué saldría si se cerraran los lotes que
 * el sistema todavía tiene abiertos.
 *
 * Un lote sin cerrar no tiene merma calculable (mermaLote.ts devuelve `null`, no
 * 0: mientras pueda seguir vaciándose desde cámara, restar mezclaría cámara con
 * pérdida). Al final de campaña eso deja fuera de los totales toda la fruta que
 * ya no va a procesarse nunca — y el año sale con menos pérdida de la real.
 *
 * Esto NO escribe en la base: repite el cálculo con `cerrado_at` puesto en
 * memoria, con la MISMA `computeMermaLotes` que el número real, para poder
 * enseñar el impacto y que el dueño decida lote a lote. Cerrar de verdad es una
 * decisión suya, y además hay dos modos con consecuencias distintas
 * ("con_analisis" convierte el hueco en pérdida; "sin_registro" lo excluye
 * porque esa fruta se procesó bajo otro código o se vendió sin pasar por línea).
 */
function simularCierreDeCampana(
  merma: ReturnType<typeof calcularMerma>,
  hoy: string,
): { lotes: MermaLote[]; cerrados: Set<string> } {
  const abiertos = new Set(
    merma.mermaLotes.filter((l) => l.estado !== "procesado" && !l.cerradoSinRegistro).map((l) => l.lote),
  );
  const entradas = merma.entradasMerma.map((e) => {
    const lote = normalizarLoteCodigo(e.lote) ?? e.lote;
    if (!abiertos.has(lote) || e.cerrado_at) return e;
    return { ...e, cerrado_at: hoy, cierre_modo: "con_analisis" as const };
  });
  return {
    lotes: computeMermaLotes(
      entradas, merma.lotesDiaInput, merma.clasifInput, merma.partesMerma,
      merma.conciliadoPorLote.size > 0 ? merma.conciliadoPorLote : undefined,
    ),
    cerrados: abiertos,
  };
}

// ─── Columnas del Excel ──────────────────────────────────────────────────────

const kgCol = (header: string, key: string, width = 15): ColumnaTabla =>
  ({ header, key, tipo: "numero", numFmt: FMT_KG, width });
const pctCol = (header: string, key: string, width = 11): ColumnaTabla =>
  ({ header, key, tipo: "numero", numFmt: FMT_PCT, width });
const intCol = (header: string, key: string, width = 9): ColumnaTabla =>
  ({ header, key, tipo: "numero", numFmt: FMT_INT, width });

function colsPerdida(conFinca: boolean): ColumnaTabla[] {
  return [
    { header: "Productor", key: "productor", width: 40 },
    ...(conFinca ? [{ header: "Finca", key: "finca", width: 28 } as ColumnaTabla] : []),
    intCol("Lotes", "nLotes"),
    intCol("Con merma calc.", "nLotesConMerma", 13),
    intCol("Sin merma calc.", "nLotesSinMerma", 13),
    kgCol("Kg entrada (todos)", "kgEntradaTotal", 17),
    kgCol("Kg entrada de lotes terminados", "kgEntradaBase", 22),
    intCol("Lotes sin pasada propia", "nLotesTodoAjuste", 16),
    { header: "Días cámara (medio)", key: "diasMedio", tipo: "numero", numFmt: "#,##0.0", width: 15 },
    kgCol("MERMA MEDIDA kg", "mermaMedidaKg", 16),
    kgCol("Merma cámara kg", "mermaCamaraKg"),
    pctCol("% merma cámara", "pctMermaCamara", 13),
    kgCol("Podrido pre-calibrador kg", "podridoPreKg", 20),
    pctCol("% podrido pre-cal.", "pctPodridoPre", 15),
    kgCol("Esperado por tasa del mes", "podridoPreEsperadoKg", 20),
    kgCol("No visto por la resta", "podridoPreNoVistoKg", 18),
    intCol("Lotes sin margen", "nLotesSinMargen", 13),
    kgCol("Kg procesados (conciliado)", "kgCalibrador", 21),
    kgCol("Podrido calibrador kg", "podridoCalibradorKg", 18),
    pctCol("% podrido calibrador", "pctPodridoCalibrador", 16),
    intCol("Lotes con podrido real", "nLotesPodridoReal", 16),
    kgCol("PÉRDIDA TOTAL kg", "perdidaKg", 17),
    kgCol("Base del % de pérdida", "kgBasePctPerdida", 18),
    pctCol("% PÉRDIDA TOTAL", "pctPerdida", 14),
    { header: "Pérdida €", key: "perdidaEur", tipo: "numero", numFmt: FMT_EUR, width: 15 },
    pctCol("% pérdida sobre coste", "pctPerdidaCoste", 16),
    kgCol("Podrido bolsa (prorrateo)", "podridoManualKg", 19),
  ];
}

function colsMdna(conFinca: boolean): ColumnaTabla[] {
  return [
    { header: "Productor", key: "productor", width: 40 },
    ...(conFinca ? [{ header: "Finca", key: "finca", width: 28 } as ColumnaTabla] : []),
    intCol("Lotes", "nLotes"),
    intCol("Sin informe clasif.", "nLotesSinClasificacion", 14),
    kgCol("Kg entrada", "kgEntradaTotal", 16),
    kgCol("Kg procesados (conciliado)", "kgCalibrador", 21),
    kgCol("Kg clasificados (informe)", "kgClasificado", 20),
    pctCol("% exportación", "pctExportacion", 12),
    pctCol("% no exportación", "pctNoExportacion", 14),
    pctCol("% mujeres", "pctMujeres", 11),
    pctCol("% no comercial", "pctNoComercial", 13),
    pctCol("% clases aptas MDNA (A-F)", "pctClaseApta", 19),
    kgCol("MDNA malla 3 kg", "mdna3", 16),
    pctCol("% malla 3 kg", "pctMdna3", 12),
    kgCol("MDNA girsac 4 kg exprimidor", "mdna4", 22),
    pctCol("% girsac 4 kg", "pctMdna4", 12),
    kgCol("MDNA D-Pack 5 kg", "mdna5", 17),
    pctCol("% D-Pack 5 kg", "pctMdna5", 13),
    kgCol("MDNA granel", "mdna12", 14),
    pctCol("% granel", "pctMdna12", 10),
    kgCol("MDNA sin formato en el nombre", "mdnaSinFormato", 23),
    kgCol("TOTAL MDNA (sobre conciliado)", "mdnaTotalAjustado", 23),
    pctCol("% MDNA sobre entrada", "pctMdnaSobreEntrada", 17),
    pctCol("% MDNA sobre procesado", "pctMdnaSobreProcesado", 18),
    kgCol("TOTAL MDNA clasificado (papel)", "mdnaTotalClasificado", 24),
    kgCol("Apto A-F no vendido a MDNA", "kgAptoNoMdna", 21),
  ];
}

// ─── Programa ────────────────────────────────────────────────────────────────

async function main() {
  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Faltan VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY en .env");
  const db = createClient(url, key, { auth: { persistSession: false } });

  const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid" }).format(new Date());
  const datos = await cargar(db);
  console.log("Conciliando kg y calculando merma por lote…");
  const mermaAbierta = calcularMerma(datos, hoy);

  // ─── LA CAMPAÑA ESTÁ CERRADA (regla del dueño, 28-ago-2026) ───────────────
  // "Ya no tenemos más lotes, estamos sin naranjas." Físicamente no queda fruta
  // de campaña en el almacén, así que ningún lote puede seguir vaciándose desde
  // cámara: lo que no ha pasado por línea ya no va a pasar, y su hueco ES
  // pérdida. Por eso el informe se calcula con TODOS los lotes cerrados, no con
  // los que la base tiene marcados — si no, el año saldría corto por abajo y
  // habría que leerlo con una simulación al lado, que es justo lo que no
  // quedaba claro.
  //
  // Esto NO escribe en la base: `simularCierreDeCampana` repite el cálculo en
  // memoria con la misma `computeMermaLotes`. La hoja "Cierre pendiente" lista
  // los lotes a los que todavía hay que ponerles `cerrado_at` para que la app
  // enseñe estos mismos números.
  const cierre = simularCierreDeCampana(mermaAbierta, hoy);
  const merma = { ...mermaAbierta, mermaLotes: cierre.lotes };
  const todasLasFilas = construirFilasMermaMdna({
    mermaLotes: merma.mermaLotes,
    entradas: merma.externas,
    mixPorLote: mixPorLoteDesdeClasificacion(datos.clasif),
    nombrePorProductorId: new Map(datos.productores.map((p) => [p.id, p.nombre])),
    aliasPorNombre: new Map(datos.alias.map((a) => [a.alias_normalizado, a.productor_id])),
  });

  // Un lote no puede perder más de lo que entró. Los que salen así tienen un
  // `kg_ajuste_stock` NEGATIVO (alguien reasignó sus kg a otro lote a mano) y
  // al cerrarlos meterían "merma" imposible: se apartan del año y se listan
  // para arreglar el apunte. Ver la hoja "Cierre pendiente".
  const esImposible = esLoteImposible;

  // Los movimientos internos (precalibrado, confección/sobrante) no son
  // productores: fuera de los rankings, contados aparte para poder informarlo.
  const filas = todasLasFilas.filter((f) => !f.interno && !esImposible(f));
  const internas = todasLasFilas.filter((f) => f.interno);
  const imposibles = todasLasFilas.filter((f) => !f.interno && esImposible(f));
  const pendientesDeCerrar = todasLasFilas.filter((f) => cierre.cerrados.has(f.lote) && !f.interno);

  const porProductor = ordenarPorPerdida(agruparMermaMdna(filas, "productor"));
  const porFinca = ordenarPorPerdida(agruparMermaMdna(filas, "productor_finca"));
  const total = totalMermaMdna(filas);

  const porProductorMdna = ordenarPorMdna(porProductor);
  const porFincaMdna = ordenarPorMdna(porFinca);

  // Contraste del podrido pre-calibrador por mes de proceso: lo pesado (bolsa
  // y bateas) frente a lo asumido por la tasa. Ver podridoPorMesDeProceso.
  const filasMes = podridoPorMesDeProceso(filas, datos.partes);

  // ─── Excel ────────────────────────────────────────────────────────────────
  console.log("Escribiendo el Excel…");
  const ctx = crearLibroLasarte({
    titulo: "Mermas, podrido y aprovechamiento de Mercadona por productor y finca",
    periodo: `Campaña 2025/26 · entradas ${filas.reduce((m, f) => f.fecha < m ? f.fecha : m, "9999")} a ${filas.reduce((m, f) => f.fecha > m ? f.fecha : m, "0000")}`,
    usuario: "Herramienta Lasarte (análisis de campaña)",
    clasificacion: "Dirección",
  });

  // 1. Resumen: la cascada entera de la campaña.
  const cascada: Array<[string, number | null, number | null, string]> = [
    ["Kg de entrada por báscula", total.kgEntradaTotal, 100, `${total.nLotes} lotes de naranja PROPIA. Fuera: ${merma.importacion.length} de importación (Egipto y SAF), ${merma.precalibrado.length} de precalibrado, ${internas.length} movimientos internos, ${merma.campoCit.length} CAMPO/CIT y ${imposibles.length} con el apunte de ajuste roto`],
    ["  · de ellos, con merma ya calculable", total.kgEntradaBase, pct(total.kgEntradaBase, total.kgEntradaTotal), `${total.nLotesConMerma} lotes: la campaña se cuenta CERRADA (el almacén está vacío), así que es la base de los % de merma y podrido de tría`],
    ["  · de ellos, aún sin merma calculable", total.kgEntradaTotal - total.kgEntradaBase, pct(total.kgEntradaTotal - total.kgEntradaBase, total.kgEntradaTotal), `${total.nLotesSinMerma} lotes cerrados «sin registro»: su procesado no consta bajo su código (pasó bajo otro, o se vendió sin línea), así que su hueco NO es pérdida`],
    ["  · de ellos, sin ninguna pasada propia", total.kgAjuste, pct(total.kgAjuste, total.kgEntradaTotal), `${total.nLotesTodoAjuste} lotes cuya entrada entera es ajuste de stock (histórico ya contado): su merma es 0 de verdad, y baja el % de su productor`],
    ["MERMA MEDIDA (báscula − procesado)", total.mermaMedidaKg, pct(total.mermaMedidaKg, total.kgEntradaBase), "Lo que la báscula pesó y el calibrador nunca llegó a pesar. Se parte en las dos líneas de abajo"],
    ["  · merma de cámara (deshidratación)", total.mermaCamaraKg, pct(total.mermaCamaraKg, total.kgEntradaBase), `Real donde hay registro de cámara; si no, ${(TASA_MERMA_NATURAL_DIA * 100).toFixed(4)} % de la entrada por cada día en cámara`],
    ["  · podrido pre-calibrador (tría: bolsa + bateas)", total.podridoPreKg, pct(total.podridoPreKg, total.kgEntradaBase), "El resto de la merma medida. Deducido por resta lote a lote — las pesadas no se pueden repartir por lote"],
    ["      lo que la tasa del mes esperaría", total.podridoPreEsperadoKg, pct(total.podridoPreEsperadoKg, total.kgEntradaBase), "Referencia paralela: NO se suma a ninguna pérdida"],
    ["      lo que la resta NO ve", total.podridoPreNoVistoKg, pct(total.podridoPreNoVistoKg, total.kgEntradaBase), `${total.nLotesSinMargen} lotes «sin margen»: la resta colapsa a 0 aunque sí hubiera tría`],
    ["Kg procesados por el calibrador (conciliados)", total.kgCalibrador, pct(total.kgCalibrador, total.kgEntradaTotal), "Reparto conciliado de las pasadas, no la suma cruda del calibrador"],
    ["Podrido del calibrador", total.podridoCalibradorKg, pct(total.podridoCalibradorKg, total.kgBasePctPerdida), `Real en ${total.nLotesPodridoReal} lotes con Informe LOTE; prorrateo del parte en el resto`],
    ["PÉRDIDA TOTAL DE FRUTA", total.perdidaKg, pct(total.perdidaKg, total.kgBasePctPerdida), "Merma medida + podrido de calibrador. Cada kg cuenta una sola vez. El % va sobre la base de pérdida (ver Metodología)"],
    ["  · valorada al coste de compra", null, null, `${Math.round(total.perdidaEur).toLocaleString("es-ES")} € sobre ${Math.round(total.costeTotal).toLocaleString("es-ES")} € de coste de fruta (${(pct(total.perdidaEur, total.costeTotal) ?? 0).toFixed(2)} %)`],
    ["  · de ellos, podrido de la bolsa (prorrateo)", total.podridoManualKg, pct(total.podridoManualKg, total.kgEntradaBase), "DESGLOSE de la merma medida, NO un sumando: esa fruta se aparta antes del calibrador"],
    ["Kg clasificados en el Informe LOTE", total.kgClasificado, pct(total.kgClasificado, total.kgCalibrador), `Pasa del 100 % de lo conciliado porque el informe atribuye cada pasada al PRIMER código de su nombre. Por eso de aquí solo se toma el MIX, no los kg. ${total.nLotesSinClasificacion} lotes sin informe: sin mix conocido`],
    ["  · exportación", total.kgExportacion, pct(total.kgExportacion, total.kgClasificado), "% sobre lo clasificado"],
    ["  · no exportación", total.kgNoExportacion, pct(total.kgNoExportacion, total.kgClasificado), "% sobre lo clasificado"],
    ["  · mujeres", total.kgMujeres, pct(total.kgMujeres, total.kgClasificado), "% sobre lo clasificado"],
    ["  · no comercial (industria y podrido)", total.kgNoComercial, pct(total.kgNoComercial, total.kgClasificado), "% sobre lo clasificado"],
    ["  · clases aptas para Mercadona (A–F)", total.kgClaseApta, pct(total.kgClaseApta, total.kgClasificado), "Extra 1/2, Cat1 A/B, Verde Claro y Cat 2"],
    ...METODOS_MDNA.map((m): [string, number | null, number | null, string] => ([
      `MERCADONA · ${LABEL_MDNA[m]} (${m})`,
      total.mdnaAjustado[m],
      pct(total.mdnaAjustado[m], total.kgEntradaTotal),
      "% sobre los kg de entrada: el aprovechamiento real de campo a Mercadona",
    ])),
    ["MERCADONA · sin formato en el nombre", total.mdnaSinFormatoAjustado, pct(total.mdnaSinFormatoAjustado, total.kgEntradaTotal), "Dice MDNA pero el nombre no declara formato: no se reparte a ojo"],
    ["MERCADONA · TOTAL", total.mdnaTotalAjustado, pct(total.mdnaTotalAjustado, total.kgEntradaTotal), "De cada 100 kg que entran por báscula, los que acaban en Mercadona"],
    ["MERCADONA · TOTAL sobre lo YA procesado", total.mdnaTotalAjustado, pct(total.mdnaTotalAjustado, total.kgCalibrador), "El mismo total sin diluir con la fruta que sigue en cámara: es la cifra a comparar entre productores"],
    ["Apto A–F que NO fue a Mercadona", total.kgAptoNoMdna, pct(total.kgAptoNoMdna, total.kgClasificado), "Fruta con calidad de Mercadona vendida a otros clientes"],
  ];
  añadirHojaTabla(ctx, {
    nombreHoja: "Resumen",
    titulo: "La cascada completa de un kg de naranja, de la báscula a la malla",
    autofilter: false,
    columnas: [
      { header: "Concepto", key: "concepto", width: 46 },
      kgCol("Kg", "kg", 18),
      pctCol("%", "pct", 12),
      { header: "Cómo se ha calculado", key: "nota", width: 95 },
    ],
    filas: cascada.map(([concepto, kg, p, nota]) => ({ concepto, kg, pct: p, nota })),
  });

  añadirHojaTabla(ctx, {
    nombreHoja: "Productores",
    titulo: "Pérdida de fruta por productor (ordenado por % de pérdida)",
    columnas: colsPerdida(false),
    filas: porProductor.map(filaPerdida),
    totales: { ...filaPerdida(total), productor: "TOTAL" },
  });

  añadirHojaTabla(ctx, {
    nombreHoja: "Fincas",
    titulo: "Pérdida de fruta por productor y finca (ordenado por % de pérdida)",
    columnas: colsPerdida(true),
    filas: porFinca.map(filaPerdida),
    totales: { ...filaPerdida(total), productor: "TOTAL" },
  });

  añadirHojaTabla(ctx, {
    nombreHoja: "Mercadona productores",
    titulo: "Aprovechamiento de Mercadona por productor · los 4 formatos (ordenado por % MDNA sobre entrada)",
    columnas: colsMdna(false),
    filas: porProductorMdna.map(filaMdna),
    totales: { ...filaMdna(total), productor: "TOTAL" },
  });

  añadirHojaTabla(ctx, {
    nombreHoja: "Mercadona fincas",
    titulo: "Aprovechamiento de Mercadona por finca · los 4 formatos (ordenado por % MDNA sobre entrada)",
    columnas: colsMdna(true),
    filas: porFincaMdna.map(filaMdna),
    totales: { ...filaMdna(total), productor: "TOTAL" },
  });

  añadirHojaTabla(ctx, {
    nombreHoja: "Podrido por mes",
    titulo: "Podrido de tría: lo PESADO (bolsa + bateas) frente a lo ASUMIDO por la resta, por mes de proceso",
    columnas: [
      { header: "Mes de proceso", key: "mes", width: 14 },
      intCol("Lotes", "lotes"),
      kgCol("Kg procesados", "procesado", 16),
      pctCol("Tasa esperada del mes", "tasaMes", 16),
      kgCol("Asumido por la resta", "asumido", 17),
      pctCol("% asumido s/ procesado", "pctAsumido", 17),
      kgCol("Esperado por la tasa", "esperado", 17),
      kgCol("No visto por la resta", "noVisto", 17),
      intCol("Lotes sin margen", "sinMargen", 13),
      kgCol("Pesado en bolsa", "bolsa", 15),
      kgCol("Pesado en bateas", "bateas", 15),
      kgCol("Pesado total", "pesadoTotal", 15),
      intCol("Partes del mes", "partesConDato", 12),
    ],
    filas: filasMes.map((f) => ({ ...f })) as Record<string, unknown>[],
  });

  // ─── CIERRE PENDIENTE EN EL SISTEMA ───────────────────────────────────────
  // El año de arriba ya está calculado CON la campaña cerrada (ver el bloque de
  // `simularCierreDeCampana` en main). Lo que va aquí es la lista de deberes:
  // a qué lotes hay que ponerles `cerrado_at` en la base para que la app enseñe
  // exactamente estos mismos números, y con qué modo.
  const entradaPorLote = new Map(merma.externas.map((e) => [normalizarLoteCodigo(e.lote) ?? e.lote, e]));

  añadirHojaTabla(ctx, {
    nombreHoja: "Cierre pendiente",
    titulo: "Lotes a los que falta ponerles la fecha de cierre en el sistema (los números del año ya los dan por cerrados)",
    columnas: [
      { header: "Productor", key: "productor", width: 38 },
      { header: "Finca", key: "finca", width: 26 },
      { header: "Lote", key: "lote", width: 11 },
      { header: "Entrada", key: "fecha", width: 11 },
      kgCol("Kg entrada", "kgEntrada"),
      kgCol("Kg procesados (conc.)", "kgCalibrador", 18),
      pctCol("% procesado", "pctProcesado", 12),
      kgCol("Merma al cerrar", "kgMerma", 15),
      { header: "Modo de cierre", key: "modo", width: 15 },
      { header: "Qué pasó con este lote", key: "situacion", width: 74 },
    ],
    filas: pendientesDeCerrar
      .slice()
      .sort((a, b) => b.kgEntrada - a.kgEntrada)
      .map((f) => {
        const e = entradaPorLote.get(f.lote);
        const roto = esImposible(f);
        return {
          productor: f.productor, finca: f.finca, lote: f.lote, fecha: f.fecha,
          kgEntrada: f.kgEntrada, kgCalibrador: f.kgCalibrador,
          pctProcesado: pct(f.kgCalibrador + f.kgAjuste, f.kgEntrada),
          kgMerma: roto ? null : f.mermaMedidaKg,
          modo: roto ? "ARREGLAR ANTES" : f.kgCalibrador <= 0 ? "sin registro" : "con análisis",
          situacion: roto
            ? `Ajuste de stock NEGATIVO (${Math.round(f.kgAjuste).toLocaleString("es-ES")} kg): al cerrarlo la merma saldría ${Math.round(f.kgEntrada - f.kgCalibrador - f.kgAjuste).toLocaleString("es-ES")} kg sobre ${Math.round(f.kgEntrada).toLocaleString("es-ES")} kg de entrada. Imposible: hay que corregir el apunte.`
            : f.kgCalibrador <= 0
              ? "Ni una sola pasada bajo su código: se vendió sin procesar o pasó bajo el código de otro lote. Cerrar «sin registro» — su hueco NO es pérdida."
              : e?.camara_confirmada_nombre
                ? `Estuvo confirmado en ${e.camara_confirmada_nombre}; ya salió. Cerrar «con análisis»: el hueco es merma real.`
                : "Pasó parte y el resto no consta. Cerrar «con análisis»: el hueco es merma real.",
        };
      }),
  });


  // ─── Cobertura del MIX: qué días de línea traen desglose por lote ─────────
  // La merma solo necesita kg; el aprovechamiento necesita saber en qué se
  // convirtió cada lote, y eso solo lo dice el Informe LOTE / el volcado del
  // Sizer. Si un tramo de campaña no lo trae, sus kg entran en la pérdida pero
  // NO pueden repartirse entre destinos ni entre los formatos de Mercadona.
  const partesConMix = new Set(datos.clasif.map((c) => c.part_id).filter(Boolean) as string[]);
  const fechaDeParte = new Map(datos.partes.map((p) => [p.id, p.date ?? null]));
  const mixPorMes = new Map<string, { con: number; sin: number }>();
  for (const l of datos.lotesDia) {
    const fecha = fechaDeParte.get(l.part_id);
    if (!fecha) continue;
    const mes = fecha.slice(0, 7);
    const acc = mixPorMes.get(mes) ?? { con: 0, sin: 0 };
    if (partesConMix.has(l.part_id)) acc.con += num(l.kg_peso_total);
    else acc.sin += num(l.kg_peso_total);
    mixPorMes.set(mes, acc);
  }
  const mesesMix = [...mixPorMes.keys()].sort();
  const totalSinMix = [...mixPorMes.values()].reduce((s, v) => s + v.sin, 0);
  const totalConMix = [...mixPorMes.values()].reduce((s, v) => s + v.con, 0);

  añadirHojaTabla(ctx, {
    nombreHoja: "Cobertura del mix",
    titulo: "Qué kg procesados tienen desglose por lote (y por tanto aprovechamiento) y cuáles no",
    columnas: [
      { header: "Mes de línea", key: "mes", width: 14 },
      kgCol("Kg procesados", "total", 16),
      kgCol("Con desglose por lote", "con", 19),
      kgCol("SIN desglose por lote", "sin", 19),
      pctCol("% con desglose", "pctCon", 14),
      { header: "Qué significa", key: "nota", width: 76 },
    ],
    filas: [
      ...mesesMix.map((mes) => {
        const v = mixPorMes.get(mes)!;
        return {
          mes, total: v.con + v.sin, con: v.con, sin: v.sin || null,
          pctCon: pct(v.con, v.con + v.sin),
          nota: v.sin > 0 ? "Estos kg cuentan en la pérdida pero NO se pueden repartir entre destinos ni formatos de Mercadona" : "",
        };
      }),
      {
        mes: "TOTAL", total: totalConMix + totalSinMix, con: totalConMix, sin: totalSinMix || null,
        pctCon: pct(totalConMix, totalConMix + totalSinMix),
        nota: totalSinMix > 0
          ? `${Math.round(totalSinMix).toLocaleString("es-ES")} kg sin desglose: el aprovechamiento del año se calcula sobre el resto`
          : "Campaña entera con desglose por lote",
      },
    ],
  });

  añadirHojaTabla(ctx, {
    nombreHoja: "Detalle lotes",
    titulo: "Una fila por lote: merma, podrido y destino",
    columnas: [
      { header: "Productor", key: "productor", width: 36 },
      { header: "Finca", key: "finca", width: 26 },
      { header: "Variedad", key: "variedad", width: 24 },
      { header: "Lote", key: "lote", width: 11 },
      { header: "Entrada", key: "fecha", width: 11 },
      { header: "Estado", key: "estado", width: 10 },
      intCol("Días cámara", "diasEnCamara", 11),
      kgCol("Kg entrada", "kgEntrada"),
      kgCol("Kg procesados (conc.)", "kgCalibrador", 18),
      kgCol("Merma medida", "mermaMedidaKg", 15),
      kgCol("Merma cámara", "mermaCamaraKg", 15),
      { header: "Cámara medida", key: "camaraFuente", width: 13 },
      kgCol("Podrido pre-calibrador", "podridoPreKg", 19),
      kgCol("Esperado del mes", "podridoPreEsperadoKg", 16),
      { header: "Sin margen", key: "sinMargenTxt", width: 10 },
      kgCol("Podrido calibrador", "podridoCalibradorKg", 17),
      { header: "Fuente podrido", key: "podridoCalibradorFuente", width: 13 },
      kgCol("Podrido bolsa (prorr.)", "podridoManualKg", 18),
      kgCol("PÉRDIDA total", "perdidaKg", 15),
      pctCol("% pérdida", "pctPerdida", 11),
      { header: "Pérdida €", key: "perdidaEur", tipo: "numero", numFmt: FMT_EUR, width: 14 },
      kgCol("Kg clasificados", "kgClasificado", 16),
      kgCol("MDNA 3 kg", "mdna3", 13),
      kgCol("MDNA 4 kg exprimidor", "mdna4", 18),
      kgCol("MDNA 5 kg", "mdna5", 13),
      kgCol("MDNA granel", "mdna12", 13),
      kgCol("MDNA sin formato", "mdnaSinFormato", 16),
      kgCol("TOTAL MDNA (conc.)", "mdnaTotalAjustado", 18),
      pctCol("% MDNA sobre entrada", "pctMdnaEntrada", 17),
    ],
    filas: filas
      .slice()
      .sort((a, b) => a.productor.localeCompare(b.productor, "es") || a.finca.localeCompare(b.finca, "es") || a.lote.localeCompare(b.lote))
      .map((f) => {
        const k = f.factorConciliado ?? 0;
        const mdnaTotal = f.mix ? f.mix.mdnaTotal * k : null;
        return {
          productor: f.productor, finca: f.finca, variedad: f.variedad, lote: f.lote, fecha: f.fecha,
          estado: f.cerradoSinRegistro ? "sin registro" : f.estado,
          diasEnCamara: f.diasEnCamara,
          kgEntrada: f.kgEntrada, kgCalibrador: f.kgCalibrador,
          mermaMedidaKg: f.mermaMedidaKg, mermaCamaraKg: f.mermaCamaraKg,
          camaraFuente: f.mermaCamaraKg == null ? "—" : f.mermaCamaraReal ? "real" : "estimada",
          podridoPreKg: f.podridoPreKg, podridoPreEsperadoKg: f.podridoPreEsperadoKg,
          sinMargenTxt: f.sinMargen ? "SÍ" : "",
          podridoCalibradorKg: f.podridoCalibradorKg, podridoCalibradorFuente: f.podridoCalibradorFuente,
          podridoManualKg: f.podridoManualKg,
          perdidaKg: f.perdidaKg, pctPerdida: pct(f.perdidaKg, f.kgEntrada),
          perdidaEur: f.perdidaEur,
          kgClasificado: f.mix?.kgClasificado ?? null,
          mdna3: f.mix ? f.mix.mdna.MA3KGC * k : null,
          mdna4: f.mix ? f.mix.mdna.MA4KGC * k : null,
          mdna5: f.mix ? f.mix.mdna.MA5KGC * k : null,
          mdna12: f.mix ? f.mix.mdna.MA12KGC * k : null,
          mdnaSinFormato: f.mix ? f.mix.mdnaSinFormato * k : null,
          mdnaTotalAjustado: mdnaTotal,
          pctMdnaEntrada: pct(mdnaTotal, f.kgEntrada),
        };
      }),
  });

  // Metodología: lo que hay que leer ANTES de discutir una cifra.
  const metodo: Array<[string, string]> = [
    ["Qué se cuenta como entrada", `Las ${total.nLotes} entradas de báscula de naranja PROPIA, la comprada a productores con finca y parcela. Quedan fuera: ${merma.importacion.length} lotes de IMPORTACIÓN (${Math.round(merma.importacion.reduce((s, e) => s + num(e.kg_entrada), 0)).toLocaleString("es-ES")} kg de naranja de Egipto vía Uria Export y el primer camión de SAF de Harrie Goesten) — no tienen productor al que atribuir una merma de campo y su rendimiento se juzga contra el precio de compra, no contra la finca; ${internas.length} movimientos internos de confección/sobrante; ${merma.precalibrado.length} entradas del almacén de precalibrado; y ${merma.campoCit.length} lotes CAMPO/CIT derivados a Cítrica sin pasar por el calibrador.`],
    ["Base de los porcentajes", `La merma (cámara y podrido de tría) va sobre los ${Math.round(total.kgEntradaBase).toLocaleString("es-ES")} kg de los ${total.nLotesConMerma} lotes terminados: un lote a medias todavía puede seguir vaciándose desde cámara, meterlo en el denominador bajaría el % de todo el mundo sin que nadie haya perdido menos fruta. El podrido de calibrador y la PÉRDIDA TOTAL van sobre una base algo mayor (${Math.round(total.kgBasePctPerdida).toLocaleString("es-ES")} kg, columna «Base del % de pérdida»): el podrido de un lote a medio procesar cuenta, así que sus kg ya pasados por línea cuentan también en el denominador. Es la misma regla que usa la app.`],
    ["Lotes sin ninguna pasada propia", `${total.nLotesTodoAjuste} lotes traen toda su entrada como «ajuste de stock» del histórico importado y ni una pasada de calibrador. Su merma sale 0 y es un 0 REAL (no hay nada que restar: esa fruta ya venía contada), pero sus kg sí pesan en la base, así que hunden el % de su productor. La columna «Lotes sin pasada propia» permite localizarlos antes de comparar a nadie.`],
    ["Lotes cerrados «sin registro»", `${total.nLotesSinRegistro} lotes cerrados sin ninguna pasada bajo su código (se procesaron bajo un código compuesto o se vendieron sin pasar por línea). Se excluyen del análisis de merma: darles pérdida real metería millones de kg ficticios.`],
    ["Merma de cámara", `Dato REAL donde el registro de cámaras lo tiene medido; donde no, ${(TASA_MERMA_NATURAL_DIA * 100).toFixed(4)} % de la entrada por cada día en cámara (media ponderada de 60 camiones re-pesados, 53-80 días). La tasa no es estable: hasta el 17-jul daba 0,0466 %/día y del 20 al 24-jul 0,0592 %/día, así que en estancias largas de verano se queda corta.`],
    ["Podrido pre-calibrador", "Es la tría que se retira ANTES de la máquina, y sale por dos sitios que sí se pesan: la bolsa (a diario) y las bateas (al vaciarlas, tras varios días). Ninguna de las dos se puede repartir por lote, así que por lote SIEMPRE se deduce por resta: entrada − merma de cámara − procesado. Nunca se suman las pesadas encima: ya están dentro de la merma medida."],
    ["El aviso «sin margen»", `Cuando la conciliación atribuye al lote casi toda su entrada, esa resta se queda sin hueco y sale 0 aunque sí hubiera tría. Pasa sobre todo de junio en adelante: hay ${total.nLotesSinMargen} lotes así. Su 0 no es físico — la columna «esperado por la tasa del mes» y la hoja «Podrido por mes» dicen cuánto falta. Consecuencia práctica: los productores cuya fruta pasó por línea a final de campaña salen artificialmente bien en el ranking de pérdida.`],
    ["Podrido del calibrador", `REAL (suma de las clases «Podrido» del Informe LOTE) en ${total.nLotesPodridoReal} de ${total.nLotes} lotes; en el resto, prorrateo del podrido del parte por los kg del lote en ese día. Las dos fuentes se separan en la columna «Lotes con podrido real» para saber cuánto del número está medido.`],
    ["Kg procesados", "Vienen del reparto CONCILIADO, no de la suma cruda del calibrador: la máquina atribuye cada pasada al primer código de su nombre, lo que infla unos lotes (merma negativa) y deja a sus hermanos con stock fantasma. La conciliación reparte multi-códigos, descuenta boxes de reciclaje, acota el precalibrado y derrama los excesos."],
    ["Aprovechamiento de Mercadona: las dos cifras", "«Kg clasificados» y «TOTAL MDNA clasificado» son lo que dice el Informe LOTE tal cual, con la misma atribución al primer código que tiene el calibrador. «TOTAL MDNA (sobre conciliado)» aplica ese mismo mix a los kg conciliados del lote, que son los que de verdad le tocan. Los % de los 4 formatos van sobre los KG DE ENTRADA: es el aprovechamiento real de campo a lineal."],
    ["Los 4 formatos", `${METODOS_MDNA.map((m) => `${m} = ${LABEL_MDNA[m]}`).join(" · ")}. Se leen del nombre del producto que teclea el calibrador. Lo que dice «MDNA» sin declarar formato va a «MDNA sin formato en el nombre» — no se reparte a ojo entre los cuatro.`],
    ["Clases aptas para Mercadona", "A–F (Extra 1, Extra 2, Cat1 A, Cat1 B, Verde Claro, Cat 2). Mujeres, Cat 3, Verde Oscuro, Industria, Podrido y Densidad no van a Mercadona nunca. La columna «Apto A-F no vendido a MDNA» es fruta con calidad de Mercadona que se vendió a otros clientes."],
    ["Qué % de Mercadona mirar", "«% MDNA sobre entrada» responde a «de cada 100 kg que compro a este productor, cuántos acaban en Mercadona», pero se diluye si el productor todavía tiene fruta en cámara sin procesar. «% MDNA sobre procesado» quita esa dilución y es la comparable entre productores. Cuando las dos se separan mucho, es que a ese productor le queda campaña por delante, no que rinda peor."],
    ["Cómo leer «Podrido por mes»", `De octubre a mayo el «asumido por la resta» y el «esperado por la tasa» coinciden casi clavados, y eso NO es una validación: la tasa de esos meses se calibró justamente con ese residuo. Lo que sí informa es junio en adelante, donde la resta se queda sin hueco. En los meses con pesada real (${filasMes.filter((m) => (m.pesadoTotal ?? 0) > 0).map((m) => `${m.mes}: pesados ${Math.round(m.pesadoTotal ?? 0).toLocaleString("es-ES")} kg frente a ${Math.round(m.asumido ?? 0).toLocaleString("es-ES")} asumidos`).join("; ")}) se ve de un vistazo dónde el informe se queda corto.`],
    ["Lotes sin informe de clasificación", `${total.nLotesSinClasificacion} lotes no tienen ninguna fila de Informe LOTE: su mix es desconocido y sale vacío, nunca 0. Sus kg de entrada SÍ cuentan en la columna de entrada, así que su ausencia baja el % de Mercadona del grupo — está a propósito, para que se vea el hueco.`],
    ["Euros", "El coste por kg de cada lote sale del importe de compra ya contabilizado en Económico. Los lotes sin coste conocido no aportan € (quedan vacíos, no a 0) pero sí aportan kg."],
    ["La campaña se calcula CERRADA", `El dueño confirmó el 28-ago-2026 que ya no queda naranja de campaña en el almacén. Físicamente eso significa que ningún lote puede seguir vaciándose desde cámara: lo que no ha pasado por línea ya no va a pasar, y su hueco ES pérdida. Por eso los números de este informe se calculan con TODOS los lotes cerrados, no solo con los que la base tiene marcados — si no, el año saldría corto por abajo. El cálculo no escribe en la base: la hoja «Cierre pendiente» lista los ${pendientesDeCerrar.length} lotes a los que falta ponerles la fecha de cierre para que la app enseñe estos mismos números, y con qué modo («con análisis» convierte el hueco en pérdida; «sin registro» lo excluye porque esa fruta se procesó bajo otro código o se vendió sin pasar por línea).`],
    ["Los lotes con ajuste negativo", `${imposibles.length} lotes traen kg_ajuste_stock NEGATIVO (alguien reasignó sus kg a otro lote a mano). Como la merma es entrada − procesado − ajuste, un ajuste negativo la SUMA: al cerrarlos saldría una merma MAYOR que su propia entrada, que es físicamente imposible. Están FUERA de todos los totales del año (${Math.round(imposibles.reduce((s, f) => s + f.kgEntrada, 0)).toLocaleString("es-ES")} kg de entrada) y listados en «Cierre pendiente» con el modo «ARREGLAR ANTES». Hay que corregir el apunte para poder cerrarlos.`],
    ["Aprovechamiento: hasta dónde llega", `${Math.round(totalSinMix).toLocaleString("es-ES")} kg procesados (${(pct(totalSinMix, totalConMix + totalSinMix) ?? 0).toFixed(1)} % del año, todo entre el 11 y el 26 de agosto) no tienen desglose por lote: el volcado del calibrador se paró el 11 de agosto y el Informe LOTE el día 10. Esos kg SÍ cuentan en la pérdida (para eso basta con los kg del parte) pero NO se pueden repartir entre destinos ni entre los formatos de Mercadona. Ver la hoja «Cobertura del mix».`],
  ];
  añadirHojaTabla(ctx, {
    nombreHoja: "Metodología",
    titulo: "Cómo leer este informe (y qué NO dice)",
    autofilter: false,
    columnas: [
      { header: "Punto", key: "punto", width: 38 },
      { header: "Explicación", key: "texto", width: 150 },
    ],
    filas: metodo.map(([punto, texto]) => ({ punto, texto })),
  });

  fs.mkdirSync(path.dirname(SALIDA), { recursive: true });
  // Si el informe de hoy está abierto en Excel, Windows bloquea el fichero
  // (EBUSY). Perder el cálculo entero por eso sería absurdo: se escribe al lado
  // con la hora, y el nombre real se dice al final.
  let salida = SALIDA;
  try {
    await ctx.workbook.xlsx.writeFile(salida);
  } catch (e) {
    if ((e as { code?: string }).code !== "EBUSY") throw e;
    const hhmm = new Date().toTimeString().slice(0, 5).replace(":", "");
    salida = SALIDA.replace(/\.xlsx$/, `_${hhmm}.xlsx`);
    console.log(`  (el fichero de hoy está abierto en Excel: se guarda como ${path.basename(salida)})`);
    await ctx.workbook.xlsx.writeFile(salida);
  }

  // ─── Cuadres en consola (para poder discutir el informe sin abrirlo) ──────
  // Invariante del módulo: el desglose no puede sumar más ni menos que la merma
  // realmente medida (mermaLote.ts lo garantiza sin redondeos por lote).
  const invariante = Math.abs((total.mermaCamaraKg + total.podridoPreKg) - total.mermaMedidaKg);
  const lotesAnalizados = new Set(filas.map((f) => f.lote));
  const agregadoMismoConjunto = agregarMermaLotes(merma.mermaLotes.filter((m) => lotesAnalizados.has(m.lote)));
  console.log("\n─── Cuadres ───");
  console.log(`Lotes analizados            ${total.nLotes} (internos excluidos: ${internas.length})`);
  console.log(`Kg entrada                  ${Math.round(total.kgEntradaTotal).toLocaleString("es-ES")}`);
  console.log(`Kg de lotes terminados      ${Math.round(total.kgEntradaBase).toLocaleString("es-ES")} (${total.nLotesConMerma} lotes)`);
  console.log(`Base del % de pérdida       ${Math.round(total.kgBasePctPerdida).toLocaleString("es-ES")}`);
  console.log(`Merma medida                ${Math.round(total.mermaMedidaKg).toLocaleString("es-ES")} (${(pct(total.mermaMedidaKg, total.kgEntradaBase) ?? 0).toFixed(2)} %)`);
  console.log(`  · cámara                  ${Math.round(total.mermaCamaraKg).toLocaleString("es-ES")} (${(pct(total.mermaCamaraKg, total.kgEntradaBase) ?? 0).toFixed(2)} %)`);
  console.log(`  · podrido pre-calibrador  ${Math.round(total.podridoPreKg).toLocaleString("es-ES")} (${(pct(total.podridoPreKg, total.kgEntradaBase) ?? 0).toFixed(2)} %) · esperado por tasa ${Math.round(total.podridoPreEsperadoKg).toLocaleString("es-ES")}`);
  console.log(`Podrido calibrador          ${Math.round(total.podridoCalibradorKg).toLocaleString("es-ES")} (${(pct(total.podridoCalibradorKg, total.kgBasePctPerdida) ?? 0).toFixed(2)} %)`);
  console.log(`PÉRDIDA TOTAL               ${Math.round(total.perdidaKg).toLocaleString("es-ES")} (${(pct(total.perdidaKg, total.kgBasePctPerdida) ?? 0).toFixed(2)} %) · ${Math.round(total.perdidaEur).toLocaleString("es-ES")} €`);
  console.log(`Invariante desglose         ${invariante.toFixed(6)} kg (debe ser ~0)`);
  console.log(`Invariante vs app           merma ${(total.mermaMedidaKg - Math.max(0, agregadoMismoConjunto.kgMermaNaturalTotal)).toFixed(2)} kg · podrido ${(total.podridoCalibradorKg - (agregadoMismoConjunto.kgPodridoCalibradorReal + agregadoMismoConjunto.kgPodridoCalibradorEstimado)).toFixed(2)} kg (mismo conjunto de lotes, deben ser ~0)`);
  console.log(`% pérdida según la app      ${(pctPerdidaTotalDeAgregado(agregadoMismoConjunto) ?? 0).toFixed(2)} % (fórmula compartida de mermaLote.ts)`);
  console.log(`MDNA total                  ${Math.round(total.mdnaTotalAjustado).toLocaleString("es-ES")} (${(pct(total.mdnaTotalAjustado, total.kgEntradaTotal) ?? 0).toFixed(2)} % de la entrada)`);
  for (const m of METODOS_MDNA) {
    console.log(`  ${LABEL_MDNA[m].padEnd(24)} ${Math.round(total.mdnaAjustado[m]).toLocaleString("es-ES").padStart(11)} (${(pct(total.mdnaAjustado[m], total.kgEntradaTotal) ?? 0).toFixed(2)} %)`);
  }
  console.log(`  ${"sin formato".padEnd(24)} ${Math.round(total.mdnaSinFormatoAjustado).toLocaleString("es-ES").padStart(11)}`);
  console.log(`Fuera del análisis          ${merma.importacion.length} lotes de IMPORTACIÓN (${Math.round(merma.importacion.reduce((s, e) => s + num(e.kg_entrada), 0)).toLocaleString("es-ES")} kg: Egipto + SAF) · ${merma.precalibrado.length} de almacén de precalibrado · ${merma.campoCit.length} CAMPO/CIT · ${internas.length} movimientos internos`);
  console.log("");
  console.log("─── Cierre de campaña ───");
  console.log(`Campaña CERRADA: los ${pendientesDeCerrar.length} lotes que la base tenía abiertos se cuentan como terminados (el almacén está vacío).`);
  console.log(`Falta ponerles cerrado_at   ${pendientesDeCerrar.length} lotes (${Math.round(pendientesDeCerrar.reduce((s, f) => s + f.kgEntrada, 0)).toLocaleString("es-ES")} kg) → hoja «Cierre pendiente»`);
  console.log(`Apartados por apunte roto   ${imposibles.length} lotes con ajuste de stock NEGATIVO (${Math.round(imposibles.reduce((s, f) => s + f.kgEntrada, 0)).toLocaleString("es-ES")} kg) fuera del año; de ellos ${pendientesDeCerrar.filter(esImposible).length} están además sin cerrar`);
  console.log(`Cobertura del mix           ${Math.round(totalConMix).toLocaleString("es-ES")} kg con desglose por lote · ${Math.round(totalSinMix).toLocaleString("es-ES")} kg SIN (${(pct(totalSinMix, totalConMix + totalSinMix) ?? 0).toFixed(1)} % de lo procesado, todo del 11 al 26 de agosto)`);
  console.log(`\nExcel: ${salida}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

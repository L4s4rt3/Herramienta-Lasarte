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
  capacidadFraccionEstimada,
  conciliarKgProcesados,
  type EntradaConciliacion,
  type ReciclajeDiaInput,
} from "../src/lib/conciliacionKg";
import {
  esAgricultorMovimientoInterno,
  esEntradaCampoCit,
  esEntradaPrecalibrado,
  esErrorTablaOColumnaInexistente,
  esProductorPrecalibrado,
  normalizeProductorName,
  resolveProductorGroupKey,
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
import { deducirMetodoVentaMdna } from "../src/lib/productosCanonicos";
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
}

// ─── Clases y destinos ───────────────────────────────────────────────────────

/**
 * Clases aptas para Mercadona: A–F (Extra 1, Extra 2, Cat1 A, Cat1 B, Verde
 * Claro, Cat 2). Confirmado con el dueño en el estudio de stock de agosto de
 * 2026: Mujeres, Cat 3, Verde Oscuro, Industria, Podrido y Densidad NO van a
 * Mercadona nunca. La letra entre paréntesis es la que escribe el calibrador
 * ("(C) Cat1 A"); si un día llegara sin letra, la fila no cuenta como apta en
 * vez de adivinar por el texto.
 */
const CLASES_APTAS_MDNA = new Set(["A", "B", "C", "D", "E", "F"]);

function letraClase(clase: string | null | undefined): string | null {
  const m = /^\s*\(([A-Z])\)/.exec(String(clase ?? "").toUpperCase());
  return m?.[1] ?? null;
}

/** Destino normalizado: la BD tiene "EXPORTACIÓN" y "EXPORTACION" conviviendo. */
function destinoNorm(grupo: string | null | undefined): string {
  return String(grupo ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .trim();
}

/** Los 4 formatos que compra Mercadona, en el orden en que se enseñan. */
const METODOS_MDNA = ["MA3KGC", "MA4KGC", "MA5KGC", "MA12KGC"] as const;
type MetodoMdna = (typeof METODOS_MDNA)[number];
const LABEL_MDNA: Record<MetodoMdna, string> = {
  MA3KGC: "Malla 3 kg",
  MA4KGC: "Girsac 4 kg exprimidor",
  MA5KGC: "D-Pack 5 kg",
  MA12KGC: "Granel",
};

interface MixLote {
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

function mixVacio(): MixLote {
  return {
    kgClasificado: 0, kgExportacion: 0, kgNoExportacion: 0, kgMujeres: 0, kgNoComercial: 0,
    kgClaseApta: 0, kgClasePodrido: 0, kgClaseIndustria: 0,
    mdna: { MA3KGC: 0, MA4KGC: 0, MA5KGC: 0, MA12KGC: 0 }, mdnaSinFormato: 0, mdnaTotal: 0,
  };
}

// ─── Carga ───────────────────────────────────────────────────────────────────

async function cargar(db: SupabaseClient) {
  console.log("Cargando campaña completa de Supabase…");
  const [entradas, lotesDia, partes, anotaciones, boxLineas, camiones, clasifAgg, productores, alias] =
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
      // Podrido REAL por lote ya agregado en servidor. Si no existiera la vista
      // el informe falla a propósito: degradar cambiaría el podrido real por
      // prorrateo en silencio (mismo criterio que informe-semanal).
      fetchTodas<PodridoAggRow>("lote_clasificacion_podrido_agg", (f, t) =>
        db.from("lote_clasificacion_podrido_agg").select("lote8, kg_podrido, n_filas").order("lote8").range(f, t)),
      fetchTodas<{ id: string; nombre: string }>("calidad_productores", (f, t) =>
        db.from("calidad_productores").select("id, nombre").order("id").range(f, t)),
      fetchOpcional(() => fetchTodas<{ alias_normalizado: string; productor_id: string }>("productores_alias", (f, t) =>
        db.from("productores_alias").select("alias_normalizado, productor_id").order("productor_id").range(f, t))),
    ]);

  // La clasificación va aparte: son ~260.000 filas y no conviene lanzarla en
  // paralelo con el resto (el pool de conexiones se resiente y no gana nada).
  const clasif = await fetchTodas<ClasifRow>("lote_clasificacion", (f, t) =>
    db.from("lote_clasificacion").select("lote_codigo, producto, clase, grupo_destino, peso_kg").order("id").range(f, t));

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
  for (const e of entradas) {
    if (esEntradaPrecalibrado(e)) precalibrado.push(e);
    else if (esEntradaCampoCit(e)) campoCit.push(e);
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

  return { mermaLotes, externas, precalibrado, campoCit, conciliacion, agregado: agregarMermaLotes(mermaLotes) };
}

// ─── Fila por lote (merma + identidad + mix de clasificación) ────────────────

interface FilaLote {
  lote: string;
  fecha: string;
  productorKey: string;
  productor: string;
  finca: string;
  variedad: string;
  estado: string;
  cerradoSinRegistro: boolean;
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

function construirFilas(
  merma: ReturnType<typeof calcularMerma>,
  datos: Awaited<ReturnType<typeof cargar>>,
): FilaLote[] {
  const nombrePorId = new Map(datos.productores.map((p) => [p.id, p.nombre]));
  const aliasPorNombre = new Map(datos.alias.map((a) => [a.alias_normalizado, a.productor_id]));
  const entradaPorLote = new Map<string, EntradaRow>();
  for (const e of merma.externas) {
    const lote8 = normalizarLoteCodigo(e.lote) ?? e.lote;
    // Una entrada por lote: si hubiera duplicados, gana la de más kg (la real;
    // las de 0 kg son correcciones administrativas).
    const previa = entradaPorLote.get(lote8);
    if (!previa || num(e.kg_entrada) > num(previa.kg_entrada)) entradaPorLote.set(lote8, e);
  }

  // Mix de clasificación por lote.
  const mixPorLote = new Map<string, MixLote>();
  const metodoPorProducto = new Map<string, MetodoMdna | "SIN_FORMATO" | null>();
  for (const row of datos.clasif) {
    const lote = normalizarLoteCodigo(row.lote_codigo);
    if (!lote) continue;
    const kg = num(row.peso_kg);
    const mix = mixPorLote.get(lote) ?? mixVacio();
    mixPorLote.set(lote, mix);
    mix.kgClasificado += kg;

    const destino = destinoNorm(row.grupo_destino);
    if (destino === "EXPORTACION") mix.kgExportacion += kg;
    else if (destino === "NO EXPORTACION") mix.kgNoExportacion += kg;
    else if (destino === "MUJERES") mix.kgMujeres += kg;
    else if (destino === "NO COMERCIAL") mix.kgNoComercial += kg;

    const letra = letraClase(row.clase);
    if (letra && CLASES_APTAS_MDNA.has(letra)) mix.kgClaseApta += kg;
    if (letra === "J") mix.kgClasePodrido += kg;
    if (letra === "I") mix.kgClaseIndustria += kg;

    const producto = row.producto ?? "";
    let metodo = metodoPorProducto.get(producto);
    if (metodo === undefined) {
      const deducido = deducirMetodoVentaMdna(producto) as MetodoMdna | null;
      // "MDNA" en el nombre sin formato reconocible: se cuenta aparte, jamás se
      // reparte a ojo entre los cuatro formatos.
      metodo = deducido ?? (/\bMDNA\b|\bMERCADONA\b/i.test(producto) ? "SIN_FORMATO" : null);
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

  return merma.mermaLotes.map((m: MermaLote): FilaLote => {
    const e = entradaPorLote.get(m.lote);
    const agricultor = e?.agricultor ?? "";
    const { key, productorId } = resolveProductorGroupKey(agricultor, e?.productor_id ?? null, aliasPorNombre);
    const nombre = (productorId ? nombrePorId.get(productorId) : null) ?? (agricultor.trim() || "(sin productor)");
    const interno = esProductorPrecalibrado(nombre) || esAgricultorMovimientoInterno(nombre)
      || esProductorPrecalibrado(agricultor) || esAgricultorMovimientoInterno(agricultor);

    const mix = mixPorLote.get(m.lote) ?? null;
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

// ─── Agregación por grupo (productor, o productor+finca) ─────────────────────

interface Grupo {
  productor: string;
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
   * propia (import del histórico de campaña: la fruta ya estaba contada). Su
   * merma medida es 0 de verdad — no hay nada que restar — pero sus kg sí
   * están en la base de los %, así que bajan el % del grupo. Se cuentan aparte
   * para que ese 0 se pueda explicar en vez de parecer un productor perfecto.
   */
  nLotesTodoAjuste: number;
  kgAjuste: number;

  kgEntradaTotal: number;
  /** Solo lotes con merma calculable: la base de los % de merma de cámara y podrido de tría. */
  kgEntradaBase: number;
  /**
   * Base del % de PODRIDO DE CALIBRADOR y de PÉRDIDA TOTAL (misma regla que
   * `kgBaseParaPctPerdida` en mermaLote.ts, decisión del dueño 06-ago-2026):
   * el podrido de un lote a medio procesar cuenta en el numerador, así que sus
   * kg YA pasados por línea tienen que contar en el denominador o el % sale
   * inflado. Para un lote terminado se cuenta toda su entrada; para uno a
   * medias, solo lo que ya ha pasado.
   */
  kgBasePctPerdida: number;
  kgCalibrador: number;
  kgDiasPonderados: number;
  /** Denominador de la media de días: solo los kg de lotes con días en cámara conocidos. */
  kgConDias: number;

  /** Σ max(0, merma natural) de los lotes procesados = merma cámara + podrido pre-calibrador (invariante de conservación). */
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
  /** Kg del mix llevados a los kg conciliados del lote (ver cabecera). */
  mdnaAjustado: Record<MetodoMdna, number>;
  mdnaSinFormatoAjustado: number;
  mdnaTotalAjustado: number;
  mdnaTotalClasificado: number;
  /** Clases A–F que NO acabaron en un producto de Mercadona. */
  kgAptoNoMdna: number;
}

function grupoVacio(productor: string, finca?: string): Grupo {
  return {
    productor, ...(finca !== undefined ? { finca } : {}),
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

function acumular(g: Grupo, f: FilaLote): void {
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
    // que ya han pasado por línea entran en la base del % — el resto sigue en
    // cámara y todavía no ha podido perderse.
    if ((f.podridoCalibradorKg ?? 0) > 0 || (f.podridoManualKg ?? 0) > 0) {
      g.kgBasePctPerdida += Math.max(0, f.kgCalibrador);
    }
  } else {
    g.nLotesConMerma += 1;
    g.kgEntradaBase += f.kgEntrada;
    g.kgBasePctPerdida += f.kgEntrada;
    g.mermaMedidaKg += f.mermaMedidaKg;
    // Sin desglose posible (calibrador por encima de la entrada, o sin días en
    // cámara conocidos) la merma medida entera se atribuye a cámara: es el
    // mismo criterio que ya usa el export de mermas de la app.
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
  // Pérdida total = merma medida (solo terminados) + podrido de calibrador
  // (todos). El podrido MANUAL no se suma: sale antes del calibrador y ya está
  // dentro de la merma medida.
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

function agrupar(filas: FilaLote[], clave: (f: FilaLote) => string, conFinca: boolean): Grupo[] {
  const map = new Map<string, Grupo>();
  for (const f of filas) {
    const k = clave(f);
    let g = map.get(k);
    if (!g) {
      g = grupoVacio(f.productor, conFinca ? f.finca : undefined);
      map.set(k, g);
    }
    acumular(g, f);
  }
  return [...map.values()];
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

function filaPerdida(g: Grupo): Record<string, unknown> {
  return {
    productor: g.productor,
    ...(g.finca !== undefined ? { finca: g.finca } : {}),
    nLotes: g.nLotes,
    nLotesConMerma: g.nLotesConMerma,
    nLotesSinMerma: g.nLotesSinMerma,
    kgEntradaTotal: g.kgEntradaTotal,
    kgEntradaBase: g.kgEntradaBase,
    // Media ponderada solo sobre los kg con días conocidos: incluir en el
    // denominador lotes sin fecha de proceso la hundiría sin que nadie haya
    // pasado menos tiempo en cámara.
    diasMedio: g.kgConDias > 0 ? g.kgDiasPonderados / g.kgConDias : null,
    nLotesTodoAjuste: g.nLotesTodoAjuste,
    kgAjuste: g.kgAjuste,
    mermaMedidaKg: g.mermaMedidaKg,
    mermaCamaraKg: g.mermaCamaraKg,
    pctMermaCamara: pct(g.mermaCamaraKg, g.kgEntradaBase),
    podridoPreKg: g.podridoPreKg,
    pctPodridoPre: pct(g.podridoPreKg, g.kgEntradaBase),
    podridoPreEsperadoKg: g.podridoPreEsperadoKg,
    podridoPreNoVistoKg: g.podridoPreNoVistoKg,
    nLotesSinMargen: g.nLotesSinMargen,
    kgCalibrador: g.kgCalibrador,
    podridoCalibradorKg: g.podridoCalibradorKg,
    // Denominador que incluye los kg ya pasados de los lotes sin terminar que
    // aportan podrido al numerador (ver kgBasePctPerdida).
    pctPodridoCalibrador: pct(g.podridoCalibradorKg, g.kgBasePctPerdida),
    nLotesPodridoReal: g.nLotesPodridoReal,
    perdidaKg: g.perdidaKg,
    kgBasePctPerdida: g.kgBasePctPerdida,
    pctPerdida: pct(g.perdidaKg, g.kgBasePctPerdida),
    perdidaEur: g.perdidaEur > 0 ? g.perdidaEur : null,
    pctPerdidaCoste: g.costeTotal > 0 ? pct(g.perdidaEur, g.costeTotal) : null,
    podridoManualKg: g.podridoManualKg,
  };
}

function filaMdna(g: Grupo): Record<string, unknown> {
  return {
    productor: g.productor,
    ...(g.finca !== undefined ? { finca: g.finca } : {}),
    nLotes: g.nLotes,
    nLotesSinClasificacion: g.nLotesSinClasificacion,
    kgEntradaTotal: g.kgEntradaTotal,
    kgCalibrador: g.kgCalibrador,
    kgClasificado: g.kgClasificado,
    pctExportacion: pct(g.kgExportacion, g.kgClasificado),
    pctNoExportacion: pct(g.kgNoExportacion, g.kgClasificado),
    pctMujeres: pct(g.kgMujeres, g.kgClasificado),
    pctNoComercial: pct(g.kgNoComercial, g.kgClasificado),
    pctClaseApta: pct(g.kgClaseApta, g.kgClasificado),
    mdna3: g.mdnaAjustado.MA3KGC,
    pctMdna3: pct(g.mdnaAjustado.MA3KGC, g.kgEntradaTotal),
    mdna4: g.mdnaAjustado.MA4KGC,
    pctMdna4: pct(g.mdnaAjustado.MA4KGC, g.kgEntradaTotal),
    mdna5: g.mdnaAjustado.MA5KGC,
    pctMdna5: pct(g.mdnaAjustado.MA5KGC, g.kgEntradaTotal),
    mdna12: g.mdnaAjustado.MA12KGC,
    pctMdna12: pct(g.mdnaAjustado.MA12KGC, g.kgEntradaTotal),
    mdnaSinFormato: g.mdnaSinFormatoAjustado,
    mdnaTotalAjustado: g.mdnaTotalAjustado,
    pctMdnaSobreEntrada: pct(g.mdnaTotalAjustado, g.kgEntradaTotal),
    pctMdnaSobreProcesado: pct(g.mdnaTotalAjustado, g.kgCalibrador),
    mdnaTotalClasificado: g.mdnaTotalClasificado,
    kgAptoNoMdna: g.kgAptoNoMdna,
  };
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
  const merma = calcularMerma(datos, hoy);
  const todasLasFilas = construirFilas(merma, datos);

  // Los movimientos internos (precalibrado, confección/sobrante) no son
  // productores: fuera de los rankings, contados aparte para poder informarlo.
  const filas = todasLasFilas.filter((f) => !f.interno);
  const internas = todasLasFilas.filter((f) => f.interno);

  const porProductor = agrupar(filas, (f) => f.productorKey, false)
    .sort((a, b) => (pct(b.perdidaKg, b.kgEntradaBase) ?? -1) - (pct(a.perdidaKg, a.kgEntradaBase) ?? -1)
      || b.kgEntradaTotal - a.kgEntradaTotal);
  const porFinca = agrupar(filas, (f) => `${f.productorKey}::${f.finca}`, true)
    .sort((a, b) => (pct(b.perdidaKg, b.kgEntradaBase) ?? -1) - (pct(a.perdidaKg, a.kgEntradaBase) ?? -1)
      || b.kgEntradaTotal - a.kgEntradaTotal);
  const total = grupoVacio("TOTAL CAMPAÑA");
  for (const f of filas) acumular(total, f);

  const porProductorMdna = [...porProductor].sort(
    (a, b) => (pct(b.mdnaTotalAjustado, b.kgEntradaTotal) ?? -1) - (pct(a.mdnaTotalAjustado, a.kgEntradaTotal) ?? -1));
  const porFincaMdna = [...porFinca].sort(
    (a, b) => (pct(b.mdnaTotalAjustado, b.kgEntradaTotal) ?? -1) - (pct(a.mdnaTotalAjustado, a.kgEntradaTotal) ?? -1));

  // ─── Contraste del podrido pre-calibrador: lo PESADO vs lo ASUMIDO ────────
  // La bolsa se pesa a diario y las bateas al vaciarlas (varios días). Ninguna
  // de las dos se puede repartir por lote, así que el contraste solo tiene
  // sentido agregado por MES DE PROCESO.
  const pesadoPorMes = new Map<string, { bolsa: number; bateas: number; partes: number }>();
  for (const p of datos.partes) {
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
  const filasMes = meses.map((mes) => {
    const p = pesadoPorMes.get(mes) ?? { bolsa: 0, bateas: 0, partes: 0 };
    const a = asumidoPorMes.get(mes) ?? { asumido: 0, esperado: 0, procesado: 0, lotes: 0, sinMargen: 0 };
    return {
      mes,
      lotes: a.lotes,
      procesado: a.procesado || null,
      tasaMes: tasaPodridoPreCalibradorMes(`${mes}-15`) * 100,
      asumido: a.asumido || null,
      pctAsumido: pct(a.asumido, a.procesado),
      esperado: a.esperado || null,
      noVisto: a.esperado > a.asumido ? a.esperado - a.asumido : 0,
      sinMargen: a.sinMargen,
      bolsa: p.bolsa || null,
      bateas: p.bateas || null,
      pesadoTotal: p.bolsa + p.bateas || null,
      partesConDato: p.partes,
    };
  });

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
    ["Kg de entrada por báscula", total.kgEntradaTotal, 100, `${total.nLotes} lotes de productores externos (fuera precalibrado, movimientos internos y CAMPO/CIT)`],
    ["  · de ellos, con merma ya calculable", total.kgEntradaBase, pct(total.kgEntradaBase, total.kgEntradaTotal), `${total.nLotesConMerma} lotes terminados o cerrados: es la base de los % de merma y podrido de tría`],
    ["  · de ellos, aún sin merma calculable", total.kgEntradaTotal - total.kgEntradaBase, pct(total.kgEntradaTotal - total.kgEntradaBase, total.kgEntradaTotal), `${total.nLotesSinMerma} lotes a medias o en cámara: no se les puede restar nada todavía`],
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
    filas: filasMes,
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
    ["Qué se cuenta como entrada", `Las ${total.nLotes} entradas de báscula de productores externos. Quedan fuera, por ser movimiento interno o fruta que no entra a línea: ${internas.length} lotes de precalibrado/confección/sobrante, ${merma.precalibrado.length} entradas del almacén de precalibrado y ${merma.campoCit.length} lotes CAMPO/CIT (fruta derivada a Cítrica sin pasar por el calibrador).`],
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
  await ctx.workbook.xlsx.writeFile(SALIDA);

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
  console.log(`Entradas fuera del análisis ${merma.precalibrado.length} de almacén de precalibrado · ${merma.campoCit.length} CAMPO/CIT · ${internas.length} movimientos internos · ${total.nLotesSinRegistro} cerrados sin registro`);
  console.log(`\nExcel: ${SALIDA}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

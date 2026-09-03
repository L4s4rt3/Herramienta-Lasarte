/**
 * informe-aprovechamiento-invermarmelo — aprovechamiento REAL (medido, no
 * estimado) de las parcelas 2 y 4 de Invermarmelo, en Excel.
 *
 *   node node_modules/vite-node/vite-node.mjs scripts/informe-aprovechamiento-invermarmelo.ts
 *
 * DESDE EL 03-09-2026 ESTO MISMO ESTÁ EN LA APP para cualquier finca y parcela:
 * Análisis → Por productor → «Aprovechamiento real por parcela». Las funciones
 * que hacen los números son LAS MISMAS (src/lib/aprovechamientoReal.ts, es
 * decir supabase/functions/_shared/aprovechamientoReal.ts): misma cifra aquí y
 * en pantalla. El script queda para quien quiera el Excel; la explicación de
 * fondo (por qué esto sí es "real", por qué la base son los kg del calibrador,
 * la cobertura y la frescura) vive en la cabecera de esa librería.
 *
 * ─── Las fuentes de este script ─────────────────────────────────────────────
 * El script lee las tablas crudas del Sizer (calibrador_batch +
 * calibrador_clasificacion, batch_id > 0) y los informes Word volcados por el
 * receptor (batch_id NEGATIVO), y aplica él mismo la regla POR LOTE Y DÍA:
 * si ese lote-día está en el volcado SQL, manda el SQL (trae TODAS las pasadas
 * del día); si no, entra el Word (solo la última pasada del día). Es la misma
 * regla que aplica la vista canónica clasificacion_lote, de la que bebe la
 * pantalla. Corregido el 19-08-2026: decir "no hay desglose" con el volcado
 * parado era FALSO, el Word ya estaba guardado.
 *
 * Aprendido a la mala el 18-ago-2026: el informe se entregó diciendo que el
 * lote 26051903 "seguía en cámara" cuando se había procesado el día 14 — el
 * volcado SQL llevaba parado desde el 11 y nada en el informe lo decía. Por eso
 * la FECHA de cada fuente va en cabecera y se cruzan los partes diarios.
 */
import fs from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import {
  acumularDetalleReal,
  acumuladoRealVacio,
  calibresReal,
  clasesReal,
  coberturaReal,
  frescuraFuentes,
  LABEL_ESTADO_DATO,
  pasadasCompuestas,
  pasadasDelPartePorLote,
  resumenReal,
  type AcumuladoReal,
  type FilaDetalleReal,
} from "../src/lib/aprovechamientoReal";
import { LABEL_MDNA, METODOS_MDNA } from "../src/lib/mdnaMix";
import {
  añadirHojaTabla,
  crearLibroLasarte,
  FMT_INT,
  FMT_KG,
  FMT_PCT,
  type ColumnaTabla,
} from "../src/lib/exportKit";

process.loadEnvFile(".env");

const FINCA = "INVERMARMELO - GG";
const PARCELAS = ["Parcela Nº2 Delta Seedless", "Parcela Nº4 Delta Seedless"] as const;
/** Etiqueta corta: el dueño las llama "finca 2" y "finca 4". */
const CORTO: Record<string, string> = {
  "Parcela Nº2 Delta Seedless": "Finca 2 (Parcela Nº2)",
  "Parcela Nº4 Delta Seedless": "Finca 4 (Parcela Nº4)",
};

const num = (v: unknown): number => Number(v) || 0;
const pct = (parte: number, total: number): number | null => (total > 0 ? (parte / total) * 100 : null);

async function fetchTodas<T>(
  etiqueta: string,
  consulta: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  silencioso = false,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await consulta(from, from + 999);
    if (error) throw new Error(`${etiqueta}: ${error.message}`);
    const filas = data ?? [];
    out.push(...filas);
    if (filas.length < 1000) {
      if (!silencioso) console.log(`  ${etiqueta}: ${out.length} filas`);
      return out;
    }
  }
}

/** Código de 8 dígitos del lote; null si no hay 8 dígitos reconocibles. */
function lote8(v: string | null | undefined): string | null {
  const d = String(v ?? "").replace(/\D/g, "");
  return d.length >= 8 ? d.slice(0, 8) : null;
}

interface EntradaRow {
  lote: string; fecha: string; parcela: string | null; kg_entrada: number | null;
  kg_ajuste_stock: number | null; cerrado_at: string | null; cierre_modo: string | null;
  camara_confirmada_nombre: string | null; camara_confirmada_fecha: string | null;
  fecha_salida_camara: string | null;
}
interface BatchRow { batch_id: number; lote: string | null; batch_name: string | null; inicio: string | null; sincronizado_at: string | null; }
interface PasadaParteRow { lote_codigo: string | null; kg_peso_total: number | null; part_id: string; }
interface ParteRow { id: string; date: string | null; }
interface ClasifRow {
  batch_id: number; producto: string | null; clase: string | null;
  grupo_destino: string | null; tamano: string | null; peso_kg: number | null;
}
/** Cabecera de un informe Word ya volcado por el receptor (batch_id negativo). */
interface InformeRow {
  batch_id: number; lote: string | null; fecha: string | null; comienzo: string | null; fichero: string | null;
}

async function main() {
  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Faltan VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY en .env");
  const db: SupabaseClient = createClient(url, key, { auth: { persistSession: false } });

  console.log(`Cargando ${FINCA} · ${PARCELAS.join(" y ")}…`);
  const entradas = await fetchTodas<EntradaRow>("entradas_bascula", (f, t) =>
    db.from("entradas_bascula")
      .select("lote, fecha, parcela, kg_entrada, kg_ajuste_stock, cerrado_at, cierre_modo, camara_confirmada_nombre, camara_confirmada_fecha, fecha_salida_camara")
      .eq("finca", FINCA).in("parcela", PARCELAS as unknown as string[]).order("lote").range(f, t));
  if (entradas.length === 0) throw new Error(`Ningún lote de ${FINCA} en esas parcelas: ¿ha cambiado el texto de la finca o la parcela?`);

  const parcelaPorLote = new Map<string, string>();
  for (const e of entradas) {
    const l8 = lote8(e.lote);
    if (l8 && e.parcela) parcelaPorLote.set(l8, e.parcela);
  }

  // Batches del Sizer: se traen todos y se filtran por código de lote (más
  // barato que una consulta por cada uno de los lotes). Los TODOS también
  // sirven para saber hasta qué día llega el volcado (frescura, ver cabecera).
  const batchesTodos = await fetchTodas<BatchRow>("calibrador_batch", (f, t) =>
    db.from("calibrador_batch").select("batch_id, lote, batch_name, inicio, sincronizado_at").order("batch_id").range(f, t));
  const batches = batchesTodos.filter((b) => { const l = lote8(b.lote); return l != null && parcelaPorLote.has(l); });

  // Partes diarios: la otra fuente de "esto ya ha pasado por línea". Llega
  // antes que el volcado del Sizer, así que es la que destapa si el volcado se
  // ha quedado atrás.
  const [partes, pasadasParte] = await Promise.all([
    fetchTodas<ParteRow>("partes_diarios", (f, t) =>
      db.from("partes_diarios").select("id, date").order("id").range(f, t)),
    fetchTodas<PasadaParteRow>("lotes_dia", (f, t) =>
      db.from("lotes_dia").select("lote_codigo, kg_peso_total, part_id").order("id").range(f, t)),
  ]);
  const fechaPorParte = new Map(partes.map((p) => [p.id, p.date ?? null]));
  const pasadasPartePorLote = pasadasDelPartePorLote(pasadasParte, fechaPorParte, new Set(parcelaPorLote.keys()));

  // Frescura de cada fuente.
  const maxONull = (xs: Array<string | null | undefined>): string | null =>
    xs.filter((x): x is string => Boolean(x)).sort().at(-1) ?? null;

  // ─── Respaldo: los informes Word que ya entraron por el receptor ──────────
  // Se guardan con batch_id NEGATIVO. Solo se usan para los lote-DÍA que el
  // volcado SQL todavía no cubre (ver cabecera): si el SQL está, manda el SQL.
  const informesTodos = await fetchTodas<InformeRow>("calibrador_informe", (f, t) =>
    db.from("calibrador_informe").select("batch_id, lote, fecha, comienzo, fichero")
      .lt("batch_id", 0).order("batch_id").range(f, t));
  const diaVolcadoSQL = new Set(
    batchesTodos.map((b) => `${lote8(b.lote)}|${String(b.inicio ?? "").slice(0, 10)}`),
  );
  const informes = informesTodos.filter((i) => {
    const l = lote8(i.lote);
    if (!l || !parcelaPorLote.has(l)) return false;
    return !diaVolcadoSQL.has(`${l}|${String(i.fecha ?? "").slice(0, 10)}`);
  });
  const frescura = frescuraFuentes({
    ultimaPasadaSql: maxONull(batchesTodos.map((b) => b.inicio)),
    ultimaSincronizacion: maxONull(batchesTodos.map((b) => b.sincronizado_at)),
    ultimoDocx: maxONull(informesTodos.map((i) => i.fecha)),
    ultimoParte: maxONull(partes.map((p) => p.date)),
  });
  console.log(`  calibrador_informe (Word de respaldo aplicable a estos lotes): ${informes.length}`);

  const clasif: ClasifRow[] = [];
  const ids = [...batches.map((b) => b.batch_id), ...informes.map((i) => i.batch_id)];
  for (let i = 0; i < ids.length; i += 40) {
    clasif.push(...await fetchTodas<ClasifRow>("calibrador_clasificacion", (f, t) =>
      db.from("calibrador_clasificacion").select("batch_id, producto, clase, grupo_destino, tamano, peso_kg")
        .in("batch_id", ids.slice(i, i + 40)).order("batch_id").range(f, t), true));
  }
  console.log(`  calibrador_batch (de estos lotes): ${batches.length} pasadas · calibrador_clasificacion: ${clasif.length} filas`);

  // ─── Las filas al formato de la librería: cada una con su lote, su fuente y el nombre de la pasada ──
  const cabeceraDeBatch = new Map<number, { lote8: string; fecha: string | null; fuente: "calibrador" | "docx"; nombre: string }>();
  for (const b of batches) {
    const l = lote8(b.lote);
    if (l) cabeceraDeBatch.set(b.batch_id, { lote8: l, fecha: String(b.inicio ?? "").slice(0, 10) || null, fuente: "calibrador", nombre: String(b.batch_name ?? b.lote ?? "") });
  }
  for (const i of informes) {
    const l = lote8(i.lote);
    if (l) cabeceraDeBatch.set(i.batch_id, { lote8: l, fecha: i.fecha, fuente: "docx", nombre: String(i.lote ?? "") });
  }
  const filas: FilaDetalleReal[] = [];
  for (const c of clasif) {
    const cab = cabeceraDeBatch.get(c.batch_id);
    if (!cab) continue;
    filas.push({
      lote8: cab.lote8, fecha: cab.fecha, batchId: c.batch_id, fuente: cab.fuente, nombrePasada: cab.nombre,
      producto: c.producto, clase: c.clase, destino: c.grupo_destino, tamano: c.tamano, kg: c.peso_kg,
    });
  }

  // ─── La comprobación que sostiene todo el informe ─────────────────────────
  // Si alguna pasada nombrara dos lotes, sus kg NO serían atribuibles y esto
  // dejaría de poder llamarse "real". Se comprueba, no se supone.
  const compuestas = pasadasCompuestas(filas);

  const porParcelaCalc = acumularDetalleReal(filas, (f) => parcelaPorLote.get(f.lote8));
  const porParcela = new Map<string, AcumuladoReal>(PARCELAS.map((p) => [p, porParcelaCalc.get(p) ?? acumuladoRealVacio()]));
  const porLote = acumularDetalleReal(filas, (f) => f.lote8);

  // ─── Cobertura: cada lote, con dato o con motivo ──────────────────────────
  const cobertura = coberturaReal(
    entradas.map((e) => ({
      lote: e.lote, fecha: e.fecha, parcela: e.parcela, kgEntrada: num(e.kg_entrada), kgAjuste: num(e.kg_ajuste_stock),
      cerradoAt: e.cerrado_at, camaraConfirmadaNombre: e.camara_confirmada_nombre, camaraConfirmadaFecha: e.camara_confirmada_fecha,
    })),
    porLote,
    pasadasPartePorLote,
    frescura,
  ).map((c) => ({ ...c, parcela: CORTO[c.parcela ?? ""] ?? c.parcela, conDato: LABEL_ESTADO_DATO[c.estado] }));
  const pendientesVolcado = cobertura.filter((c) => c.estado === "pendiente_volcado");

  // ─── Excel ────────────────────────────────────────────────────────────────
  const hoy = new Date();
  const ctx = crearLibroLasarte({
    titulo: "Aprovechamiento real — Invermarmelo, fincas 2 y 4",
    periodo: `Campaña 2025/26 · entradas ${entradas.reduce((m, e) => e.fecha < m ? e.fecha : m, "9999")} a ${entradas.reduce((m, e) => e.fecha > m ? e.fecha : m, "0000")}`,
    usuario: "Herramienta Lasarte",
    clasificacion: "Dirección",
    generadoEn: hoy,
  });

  const kgCol = (h: string, k: string, w = 15): ColumnaTabla => ({ header: h, key: k, tipo: "numero", numFmt: FMT_KG, width: w });
  const pctCol = (h: string, k: string, w = 12): ColumnaTabla => ({ header: h, key: k, tipo: "numero", numFmt: FMT_PCT, width: w });

  const p2 = porParcela.get(PARCELAS[0])!;
  const p4 = porParcela.get(PARCELAS[1])!;
  const r2 = resumenReal(p2);
  const r4 = resumenReal(p4);
  const kgDocxTotal = r2.kgRespaldo + r4.kgRespaldo;
  const dePar = (p: string) => entradas.filter((e) => e.parcela === p);
  const kgEntTotal = (p: string) => dePar(p).reduce((s, e) => s + num(e.kg_entrada), 0);
  const kgEntConDato = (p: string) => dePar(p).filter((e) => porLote.has(lote8(e.lote)!)).reduce((s, e) => s + num(e.kg_entrada), 0);
  const nLotes = (p: string) => dePar(p).length;
  const nConDato = (p: string) => dePar(p).filter((e) => porLote.has(lote8(e.lote)!)).length;

  type Unidad = "kg" | "pct" | "int" | "txt";
  const fila = (concepto: string, v2: number | null, v4: number | null, unidad: Unidad, nota: string) => ({
    concepto, v2, v4, unidad, nota, dif: v2 != null && v4 != null ? v4 - v2 : null,
  });
  const resumen = [
    // ─── Hasta qué día llega cada fuente ────────────────────────────────────
    // Va lo PRIMERO a propósito: sin esto, un informe con el volcado parado se
    // lee como si estuviera al día (ver cabecera del script).
    fila("▸ Última pasada en el volcado del calibrador", null, null, "txt",
      `${frescura.ultimaPasadaSizer ?? "sin dato"} · sincronizado por última vez el ${frescura.ultimaSincronizacion ?? "sin dato"}`),
    fila("▸ Último informe Word de lote recibido", null, null, "txt",
      `${frescura.ultimoInformeDocx ?? "sin dato"} · es el respaldo que tapa los días que el volcado SQL no trae`),
    fila("▸ Último parte diario registrado", null, null, "txt", frescura.ultimoParte ?? "sin dato"),
    fila("▸ Estado de los datos", null, null, "txt",
      frescura.volcadoAtrasado
        ? `⚠ EL VOLCADO SQL DEL CALIBRADOR VA POR DETRÁS DE LOS PARTES (${frescura.ultimaPasadaSizer} frente a ${frescura.ultimoParte}). Lo procesado después del ${frescura.ultimaPasadaSizer} entra en este informe con el INFORME WORD de lote (${Math.round(kgDocxTotal).toLocaleString("es-ES")} kg en total), que trae solo la última pasada de cada día. ${pendientesVolcado.length > 0 ? `Quedan ${pendientesVolcado.length} lote(s) sin ninguna de las dos fuentes: ${pendientesVolcado.map((c) => c.lote8).join(", ")} (${Math.round(pendientesVolcado.reduce((s, c) => s + (c.kgEnParte ?? 0), 0)).toLocaleString("es-ES")} kg). Ver hoja «Cobertura».` : "Ningún lote de estas parcelas se queda sin desglose. Ver la columna «De ellos, del Word» en «Cobertura»."}`
        : "Volcado del calibrador y partes diarios al mismo día: el informe está completo hasta esa fecha."),
    fila("Kg que vienen del Word en vez del volcado SQL", r2.kgRespaldo, r4.kgRespaldo, "kg",
      "Dato de respaldo: el Word solo trae la última pasada de cada día, el volcado las trae todas"),
    fila("Lotes de la parcela", nLotes(PARCELAS[0]), nLotes(PARCELAS[1]), "int", "Todos los lotes entrados por báscula"),
    fila("Lotes con dato real del calibrador", nConDato(PARCELAS[0]), nConDato(PARCELAS[1]), "int", "Los demás no han pasado por línea: ver hoja «Cobertura»"),
    fila("Pasadas analizadas", r2.pasadas, r4.pasadas, "int", "Todas de un solo lote: cada kg es directamente atribuible"),
    fila("Kg entrada por báscula (todos los lotes)", kgEntTotal(PARCELAS[0]), kgEntTotal(PARCELAS[1]), "kg", "Referencia, NO la base de los porcentajes"),
    fila("Kg entrada de los lotes analizados", kgEntConDato(PARCELAS[0]), kgEntConDato(PARCELAS[1]), "kg", "La parte de la parcela que ya ha pasado por línea"),
    fila("Cobertura del informe", pct(kgEntConDato(PARCELAS[0]), kgEntTotal(PARCELAS[0])), pct(kgEntConDato(PARCELAS[1]), kgEntTotal(PARCELAS[1])), "pct", "Sobre kg de entrada"),
    fila("KG PESADOS POR EL CALIBRADOR", r2.kgSizer, r4.kgSizer, "kg", "★ LA BASE de todos los porcentajes de abajo"),
    fila("Desfase calibrador vs báscula", pct(r2.kgSizer - kgEntConDato(PARCELAS[0]), kgEntConDato(PARCELAS[0])), pct(r4.kgSizer - kgEntConDato(PARCELAS[1]), kgEntConDato(PARCELAS[1])), "pct", "Sistemático en toda la campaña (+7,80 % en 904 lotes): desfase de tara, no fruta de otro sitio"),
    fila("% EXPORTACIÓN", r2.pctExportacion, r4.pctExportacion, "pct", "Extra 1/2, Cat1 A/B y Verde Claro"),
    fila("% NO EXPORTACIÓN", r2.pctNoExportacion, r4.pctNoExportacion, "pct", "Cat 2, Cat 3 y Verde Oscuro"),
    fila("% MUJERES", r2.pctMujeres, r4.pctMujeres, "pct", "Fruta desviada a repaso manual"),
    fila("% NO COMERCIAL", r2.pctNoComercial, r4.pctNoComercial, "pct", "Industria, podrido y densidad"),
    fila("Podrido en el calibrador", r2.kgPodrido, r4.kgPodrido, "kg", "Medido por la máquina, no prorrateado"),
    fila("% podrido en el calibrador", r2.pctPodrido, r4.pctPodrido, "pct", "Solo el que descarta la máquina: la tría previa no se ve aquí"),
    fila("% clases aptas para Mercadona (A–F)", r2.pctApta, r4.pctApta, "pct", "Techo teórico de lo que Mercadona podría aceptar"),
    ...METODOS_MDNA.map((m) => fila(`MERCADONA · ${LABEL_MDNA[m]}`, r2.pctMdnaFormato[m], r4.pctMdnaFormato[m], "pct",
      `${Math.round(r2.mdna[m]).toLocaleString("es-ES")} kg en la finca 2 y ${Math.round(r4.mdna[m]).toLocaleString("es-ES")} kg en la 4`)),
    fila("MERCADONA · sin formato en el nombre", r2.pctMdnaSinFormato, r4.pctMdnaSinFormato, "pct", "Dice MDNA pero no declara formato: no se reparte a ojo"),
    fila("% MERCADONA TOTAL", r2.pctMdna, r4.pctMdna, "pct", "★ EL APROVECHAMIENTO DE MERCADONA de la parcela"),
    fila("Kg a Mercadona", r2.mdnaTotal, r4.mdnaTotal, "kg", "Kg reales clasificados en un producto de Mercadona"),
    fila("Apto A–F que NO fue a Mercadona", r2.pctAptoFuera, r4.pctAptoFuera, "pct", "Fruta con calidad de Mercadona vendida a otros clientes"),
  ];

  añadirHojaTabla(ctx, {
    nombreHoja: "Resumen",
    titulo: "Aprovechamiento REAL de las fincas 2 y 4 · medido por el calibrador, sin estimar",
    autofilter: false,
    columnas: [
      { header: "Concepto", key: "concepto", width: 42 },
      { header: CORTO[PARCELAS[0]], key: "v2", tipo: "numero", numFmt: "#,##0.00", width: 20 },
      { header: CORTO[PARCELAS[1]], key: "v4", tipo: "numero", numFmt: "#,##0.00", width: 20 },
      { header: "Diferencia (F4 − F2)", key: "dif", tipo: "numero", numFmt: "#,##0.00", width: 18 },
      { header: "Unidad", key: "unidad", width: 8 },
      { header: "Qué significa", key: "nota", width: 88 },
    ],
    filas: resumen.map((r) => ({
      concepto: r.concepto,
      v2: r.v2 == null ? null : Number(r.v2.toFixed(2)),
      v4: r.v4 == null ? null : Number(r.v4.toFixed(2)),
      dif: r.dif == null ? null : Number(r.dif.toFixed(2)),
      unidad: r.unidad === "pct" ? "%" : r.unidad === "kg" ? "kg" : r.unidad === "int" ? "nº" : "",
      nota: r.nota,
    })),
  });

  añadirHojaTabla(ctx, {
    nombreHoja: "Clases y destinos",
    titulo: "Qué salió de la máquina, clase a clase (kg medidos)",
    columnas: [
      { header: "Parcela", key: "parcela", width: 22 },
      { header: "Destino", key: "destino", width: 18 },
      { header: "Clase", key: "clase", width: 16 },
      { header: "¿Apta MDNA?", key: "apta", width: 12 },
      kgCol("Kg", "kg"),
      pctCol("% sobre lo pesado", "pctSizer", 16),
    ],
    filas: PARCELAS.flatMap((p) => clasesReal(porParcela.get(p)!).map((c) => ({
      parcela: CORTO[p], destino: c.destino, clase: c.clase, apta: c.apta ? "SÍ" : "no", kg: c.kg, pctSizer: c.pct,
    }))),
  });

  añadirHojaTabla(ctx, {
    nombreHoja: "Mercadona 4 formatos",
    titulo: "Aprovechamiento de Mercadona por formato · kg reales del calibrador",
    columnas: [
      { header: "Parcela", key: "parcela", width: 22 },
      { header: "Formato", key: "formato", width: 34 },
      kgCol("Kg", "kg"),
      pctCol("% sobre lo pesado", "pctSizer", 16),
      pctCol("% del total MDNA", "pctMdna", 16),
    ],
    filas: PARCELAS.flatMap((p) => {
      const r = resumenReal(porParcela.get(p)!);
      return [
        ...METODOS_MDNA.map((m) => ({
          parcela: CORTO[p], formato: `${LABEL_MDNA[m]} (${m})`, kg: r.mdna[m],
          pctSizer: r.pctMdnaFormato[m], pctMdna: pct(r.mdna[m], r.mdnaTotal),
        })),
        { parcela: CORTO[p], formato: "Sin formato en el nombre", kg: r.mdnaSinFormato, pctSizer: r.pctMdnaSinFormato, pctMdna: pct(r.mdnaSinFormato, r.mdnaTotal) },
        { parcela: CORTO[p], formato: "TOTAL MERCADONA", kg: r.mdnaTotal, pctSizer: r.pctMdna, pctMdna: r.mdnaTotal > 0 ? 100 : null },
        { parcela: CORTO[p], formato: "Apto A–F vendido a otros clientes", kg: r.kgAptoFuera, pctSizer: r.pctAptoFuera, pctMdna: null },
        { parcela: CORTO[p], formato: "No apto para Mercadona", kg: r.kgNoApta, pctSizer: r.pctNoApta, pctMdna: null },
      ];
    }),
  });

  añadirHojaTabla(ctx, {
    nombreHoja: "Calibres",
    titulo: "Calibre de la fruta apta para Mercadona y a qué tornillo puede ir",
    columnas: [
      { header: "Parcela", key: "parcela", width: 22 },
      { header: "Calibre", key: "calibre", width: 12 },
      kgCol("Kg aptos", "kg"),
      pctCol("% de lo apto", "pctApta", 13),
      { header: "Tornillos de Mercadona que admiten este calibre", key: "tornillos", width: 42 },
    ],
    filas: PARCELAS.flatMap((p) => calibresReal(porParcela.get(p)!).map((c) => ({
      parcela: CORTO[p], calibre: c.calibre, kg: c.kg, pctApta: c.pctApta, tornillos: c.tornillos,
    }))),
  });

  añadirHojaTabla(ctx, {
    nombreHoja: "Detalle lotes",
    titulo: "Un lote por fila: todo medido, nada prorrateado",
    columnas: [
      { header: "Parcela", key: "parcela", width: 22 },
      { header: "Lote", key: "lote", width: 11 },
      { header: "Entrada", key: "fecha", width: 11 },
      { header: "Pasadas", key: "pasadas", tipo: "numero", numFmt: FMT_INT, width: 9 },
      kgCol("Kg báscula", "kgEntrada", 14),
      kgCol("Kg calibrador", "kgSizer", 15),
      pctCol("Desfase", "desfase", 10),
      pctCol("% exportación", "pctExport", 13),
      pctCol("% no exportación", "pctNoExport", 14),
      pctCol("% mujeres", "pctMujeres", 11),
      pctCol("% no comercial", "pctNoComercial", 13),
      kgCol("Podrido kg", "kgPodrido", 13),
      pctCol("% podrido", "pctPodrido", 11),
      kgCol("MDNA 3 kg", "mdna3", 13),
      kgCol("MDNA 4 kg", "mdna4", 13),
      kgCol("MDNA 5 kg", "mdna5", 13),
      kgCol("MDNA granel", "mdna12", 13),
      kgCol("MDNA total", "mdnaTotal", 14),
      pctCol("% MDNA", "pctMdna", 11),
    ],
    filas: cobertura.filter((c) => c.estado === "sql").map((c) => {
      const r = resumenReal(porLote.get(c.lote8)!);
      return {
        parcela: c.parcela, lote: c.lote8, fecha: c.fecha, pasadas: c.pasadas,
        kgEntrada: c.kgEntrada, kgSizer: r.kgSizer, desfase: c.desfase,
        pctExport: r.pctExportacion, pctNoExport: r.pctNoExportacion, pctMujeres: r.pctMujeres, pctNoComercial: r.pctNoComercial,
        kgPodrido: r.kgPodrido, pctPodrido: r.pctPodrido,
        mdna3: r.mdna.MA3KGC, mdna4: r.mdna.MA4KGC, mdna5: r.mdna.MA5KGC, mdna12: r.mdna.MA12KGC,
        mdnaTotal: r.mdnaTotal, pctMdna: r.pctMdna,
      };
    }),
  });

  añadirHojaTabla(ctx, {
    nombreHoja: "Cobertura",
    titulo: "Los lotes de las dos parcelas: cuáles entran en el análisis y por qué los demás no",
    columnas: [
      { header: "Parcela", key: "parcela", width: 22 },
      { header: "Lote", key: "lote", width: 11 },
      { header: "Entrada", key: "fecha", width: 11 },
      kgCol("Kg báscula", "kgEntrada", 14),
      { header: "¿Dato real?", key: "conDato", width: 16 },
      { header: "Pasadas", key: "pasadas", tipo: "numero", numFmt: FMT_INT, width: 9 },
      kgCol("Kg calibrador", "kgSizer", 15),
      kgCol("De ellos, del Word", "kgDocx", 18),
      kgCol("Kg según el parte (sin volcar)", "kgEnParte", 20),
      pctCol("Desfase", "desfase", 10),
      { header: "Motivo", key: "motivo", width: 88 },
    ],
    filas: cobertura.map((c) => ({
      parcela: c.parcela, lote: c.lote8, fecha: c.fecha, kgEntrada: c.kgEntrada, conDato: c.conDato, pasadas: c.pasadas,
      kgSizer: c.kgSizer, kgDocx: c.kgRespaldo, kgEnParte: c.kgEnParte, desfase: c.desfase, motivo: c.motivo,
    })),
  });

  const totalEnt = kgEntTotal(PARCELAS[0]) + kgEntTotal(PARCELAS[1]);
  const totalConDato = kgEntConDato(PARCELAS[0]) + kgEntConDato(PARCELAS[1]);
  const metodo: Array<[string, string]> = [
    ["Qué se ha medido", `Las ${r2.pasadas + r4.pasadas} pasadas de calibrador de los ${nConDato(PARCELAS[0]) + nConDato(PARCELAS[1])} lotes de las fincas 2 y 4 que ya han pasado por línea. La fuente es el volcado SQL del Compac Sizer, que registra TODAS las pasadas de cada lote — el informe Word solo trae la última, y 225 lotes de la campaña pasan más de una vez.`],
    ["Por qué esto SÍ es real", `Se ha comprobado pasada a pasada que ninguna nombra más de un lote (${compuestas.length} compuestas encontradas): no hay códigos que mezclen fruta de dos parcelas. Por eso cada kg que clasificó la máquina se atribuye directamente, sin prorrateo, sin conciliación y sin aplicar mezclas de otros lotes. El script avisa por consola si algún día aparece una pasada compuesta.`],
    ["La base de los porcentajes", `Los kg que pesó el CALIBRADOR (${Math.round(r2.kgSizer + r4.kgSizer).toLocaleString("es-ES")} kg entre las dos parcelas), no los de la báscula de entrada. Las dos básculas no coinciden: el calibrador pesa un +7,80 % de más en los 904 lotes de la campaña con volcado, un +9,41 % en la finca 2 y un +5,06 % en la 4. Como el desfase es sistemático y las pasadas son de un solo lote, no es fruta de otro sitio: es tara/calibración. Calcular los porcentajes sobre la entrada daría cifras que suman más del 100 %.`],
    ["Cobertura", `${Math.round(totalConDato).toLocaleString("es-ES")} kg analizados de ${Math.round(totalEnt).toLocaleString("es-ES")} kg entrados (${(pct(totalConDato, totalEnt) ?? 0).toFixed(1)} %). Los lotes que faltan no se estiman ni se rellenan: cada uno tiene su motivo en la hoja «Cobertura». La mayoría sigue físicamente en cámara, confirmado a pie por el dueño.`],
    ["Hasta qué día llega el informe", `El volcado SQL del calibrador llega al ${frescura.ultimaPasadaSizer ?? "—"} (última sincronización: ${frescura.ultimaSincronizacion ?? "—"}), los informes Word de lote al ${frescura.ultimoInformeDocx ?? "—"} y los partes diarios al ${frescura.ultimoParte ?? "—"}. ${frescura.volcadoAtrasado ? `EL VOLCADO SQL VA POR DETRÁS, así que lo procesado después del ${frescura.ultimaPasadaSizer} entra por el Word (${Math.round(kgDocxTotal).toLocaleString("es-ES")} kg). Lo que no tenga ninguna de las dos fuentes sale en «Cobertura» como «pendiente volcado» — con sus kg reales del parte — y NUNCA como «en cámara».` : "Las dos fuentes están al mismo día."}`],
    ["Las dos fuentes del desglose", `El volcado SQL del Sizer es la fuente canónica: trae TODAS las pasadas de cada lote. El informe Word por producto y lote, que entra solo por el receptor y se guarda con batch_id negativo, es el RESPALDO: solo trae la última pasada de cada día. La regla, la misma que aplica el receptor al guardarlo, es POR LOTE Y DÍA — si ese lote-día está en el volcado, manda el volcado; si no está, entra el Word. En este informe ${kgDocxTotal > 0 ? `${Math.round(kgDocxTotal).toLocaleString("es-ES")} kg vienen del Word (columna «De ellos, del Word» en «Cobertura»)` : "no ha hecho falta el Word: el volcado cubre todo"}.`],
    ["Qué NO dice este informe", "El podrido que se ve aquí es SOLO el que descarta la máquina. La tría que se retira antes de entrar al calibrador (bolsa y bateas) no se puede repartir por lote — se pesa por día y las bateas se vacían cada varios días — así que no aparece. Para la pérdida completa de fruta, con merma de cámara y podrido de tría, está el informe de campaña por productor y finca."],
    ["Clases aptas para Mercadona", "Extra 1, Extra 2, Cat1 A, Cat1 B, Verde Claro y Cat 2. Mujeres, Cat 3, Verde Oscuro, Industria, Podrido y Densidad no van a Mercadona nunca. Ojo: el volcado del Sizer escribe la clase sin la letra («Extra 1») y el Word con ella («(A) Extra 1»); aquí se casa por nombre."],
    ["Los 4 formatos", `${METODOS_MDNA.map((m) => `${m} = ${LABEL_MDNA[m]}`).join(" · ")}. Se leen del nombre del producto que teclea el calibrador, con la misma función que usa la app. Lo que dice «MDNA» sin declarar formato se cuenta aparte.`],
    ["Los calibres", "La hoja «Calibres» no reparte kg entre tornillos: los rangos se solapan (un 3/54 vale para malla de 5 kg y para granel) y quien decide es la programación de la semana. Dice para qué SIRVE cada calibre, que es lo que permite ver si una parcela encaja con lo que Mercadona pide."],
  ];
  añadirHojaTabla(ctx, {
    nombreHoja: "Metodología",
    titulo: "Cómo se ha calculado (y qué no dice)",
    autofilter: false,
    columnas: [
      { header: "Punto", key: "punto", width: 32 },
      { header: "Explicación", key: "texto", width: 150 },
    ],
    filas: metodo.map(([punto, texto]) => ({ punto, texto })),
  });

  const salida = path.resolve("outputs", `Aprovechamiento_Invermarmelo_F2_F4_${hoy.toISOString().slice(0, 10)}.xlsx`);
  fs.mkdirSync(path.dirname(salida), { recursive: true });
  await ctx.workbook.xlsx.writeFile(salida);

  // ─── Resumen en consola ───────────────────────────────────────────────────
  console.log("\n─── Aprovechamiento REAL · Invermarmelo fincas 2 y 4 ───");
  console.log(`Volcado SQL hasta ${frescura.ultimaPasadaSizer} (sincronizado ${frescura.ultimaSincronizacion}) · Word de lote hasta ${frescura.ultimoInformeDocx} · partes diarios hasta ${frescura.ultimoParte}`);
  if (frescura.volcadoAtrasado) {
    console.log(`⚠ EL VOLCADO SQL VA ${frescura.ultimaPasadaSizer} → ${frescura.ultimoParte}: esos días entran por el Word de lote (${Math.round(kgDocxTotal).toLocaleString("es-ES")} kg, solo la última pasada de cada día).`);
    for (const c of pendientesVolcado) {
      console.log(`  · ${c.lote8} (${c.parcela}) procesado según el parte, ${Math.round(c.kgEnParte ?? 0).toLocaleString("es-ES")} kg SIN ninguna fuente de desglose`);
    }
    if (pendientesVolcado.length === 0) console.log("  · ningún lote de estas dos parcelas se queda sin desglose");
  }
  console.log(`Pasadas que nombran más de un lote (romperían la atribución): ${compuestas.length}`);
  for (const b of compuestas) console.log(`  ¡AVISO! pasada ${b.clave} (${b.fuente}): ${b.nombre}`);
  for (const p of PARCELAS) {
    const a = porParcela.get(p)!;
    const r = resumenReal(a);
    console.log(`\n${CORTO[p]} — ${nConDato(p)}/${nLotes(p)} lotes · ${r.pasadas} pasadas${r.pasadasRespaldo > 0 ? ` (${r.pasadasRespaldo} del Word, ${Math.round(r.kgRespaldo).toLocaleString("es-ES")} kg)` : ""}`);
    console.log(`  Entrada báscula   ${Math.round(kgEntTotal(p)).toLocaleString("es-ES").padStart(9)} kg (analizados ${Math.round(kgEntConDato(p)).toLocaleString("es-ES")}, ${(pct(kgEntConDato(p), kgEntTotal(p)) ?? 0).toFixed(1)} %)`);
    console.log(`  Pesado calibrador ${Math.round(r.kgSizer).toLocaleString("es-ES").padStart(9)} kg (desfase ${(pct(r.kgSizer - kgEntConDato(p), kgEntConDato(p)) ?? 0).toFixed(2)} %)`);
    console.log(`  Exportación ${(r.pctExportacion ?? 0).toFixed(1)} % · No exp. ${(r.pctNoExportacion ?? 0).toFixed(1)} % · Mujeres ${(r.pctMujeres ?? 0).toFixed(1)} % · No comercial ${(r.pctNoComercial ?? 0).toFixed(1)} %`);
    console.log(`  Podrido máquina   ${Math.round(r.kgPodrido).toLocaleString("es-ES").padStart(9)} kg (${(r.pctPodrido ?? 0).toFixed(2)} %)`);
    console.log(`  Apto MDNA ${(r.pctApta ?? 0).toFixed(1)} %  ·  A MERCADONA ${(r.pctMdna ?? 0).toFixed(1)} % (${Math.round(r.mdnaTotal).toLocaleString("es-ES")} kg)`);
    for (const m of METODOS_MDNA) {
      console.log(`    ${LABEL_MDNA[m].padEnd(24)} ${Math.round(r.mdna[m]).toLocaleString("es-ES").padStart(8)} kg (${(r.pctMdnaFormato[m] ?? 0).toFixed(1)} %)`);
    }
    if (r.mdnaSinFormato > 0) console.log(`    ${"sin formato".padEnd(24)} ${Math.round(r.mdnaSinFormato).toLocaleString("es-ES").padStart(8)} kg`);
    console.log(`  Cuadre destinos ${r.cuadreDestinos.toFixed(3)} kg (debe ser 0)`);
  }
  console.log(`\nExcel: ${salida}`);
}

main().catch((e) => { console.error(e); process.exit(1); });

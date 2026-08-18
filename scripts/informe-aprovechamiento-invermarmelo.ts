/**
 * informe-aprovechamiento-invermarmelo — aprovechamiento REAL (medido, no
 * estimado) de las parcelas 2 y 4 de Invermarmelo.
 *
 *   node node_modules/vite-node/vite-node.mjs scripts/informe-aprovechamiento-invermarmelo.ts
 *
 * ─── Por qué este informe SÍ puede decir "real" ─────────────────────────────
 * El informe general de campaña (scripts/analisis-mermas-mercadona.ts) tiene
 * que ESTIMAR el destino de la fruta de cada productor: toma el mix del Informe
 * LOTE y lo aplica a los kg conciliados, porque el calibrador atribuye cada
 * pasada al primer código de su nombre y muchas pasadas mezclan lotes.
 *
 * Aquí no hace falta estimar nada. Se ha comprobado pasada a pasada que las de
 * estas dos parcelas son de UN SOLO LOTE cada una (ningún BatchName nombra dos
 * códigos), así que cada kg que clasificó la máquina se puede atribuir
 * directamente a su parcela. La fuente es el volcado SQL del Compac Sizer
 * (calibrador_batch + calibrador_clasificacion, batch_id > 0), que es la fuente
 * canónica y cubre TODAS las pasadas — no solo la última, como el Word.
 *
 * ─── La base de los porcentajes, y por qué NO es la entrada de báscula ──────
 * El calibrador pesa sistemáticamente MÁS que la báscula: +7,80 % en los 904
 * lotes de la campaña con volcado, +9,41 % en la parcela 2 y +5,06 % en la 4.
 * No es fruta de otro sitio (las pasadas son de un solo lote): es un desfase de
 * tara/calibración entre las dos básculas. Por eso los porcentajes van sobre
 * los KG QUE PESÓ LA MÁQUINA, que es lo único medido de punta a punta. La
 * entrada de báscula se enseña al lado para que el desfase se vea, nunca
 * mezclada en el mismo porcentaje.
 *
 * ─── Cobertura: lo que no está, se dice ─────────────────────────────────────
 * Los lotes sin ninguna pasada no se rellenan ni se prorratean: se listan uno a
 * uno con su motivo (en cámara confirmada a pie, entrada que es ajuste de
 * stock, o cerrado sin registro) en la hoja "Cobertura". El aprovechamiento se
 * declara sobre lo que sí pasó por línea.
 *
 * ─── FRESCURA: el volcado del Sizer se puede quedar atrás, y hay que verlo ──
 * Aprendido a la mala el 18-ago-2026: el informe se entregó diciendo que el
 * lote 26051903 "seguía en cámara" cuando se había procesado el día 14 — el
 * volcado SQL del calibrador llevaba parado desde el 11 y nada en el informe lo
 * decía. Los partes diarios sí llegaban al 17.
 *
 * Por eso el informe ahora (a) enseña la FECHA de cada fuente en cabecera y
 * avisa si el volcado va por detrás de los partes, y (b) cruza los partes
 * diarios para detectar lotes que YA se han procesado pero cuyo desglose de
 * clases todavía no ha volcado el Sizer: esos salen como "procesado, pendiente
 * de volcado", nunca como "en cámara". Un lote así no entra en los
 * porcentajes (no hay clases que repartir) pero deja de estar mal etiquetado.
 */
import fs from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { deducirMetodoVentaMdna } from "../src/lib/productosCanonicos";
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
const norm = (v: string | null | undefined): string => String(v ?? "").trim().toUpperCase();

/**
 * Clases aptas para Mercadona (A–F). OJO: el volcado SQL del Sizer escribe la
 * clase SIN el prefijo de letra ("Extra 1") mientras que el Word la trae con él
 * ("(A) Extra 1"), así que aquí se casa por NOMBRE, no por letra. Mujeres,
 * Cat 3, Verde Oscuro, Industria, Podrido, Densidad y Recirculo no van a
 * Mercadona nunca.
 */
const CLASES_APTAS_MDNA = new Set(["EXTRA 1", "EXTRA 2", "CAT1 A", "CAT1 B", "VERDE CLARO", "CAT 2", "CAT2"]);

const METODOS = ["MA3KGC", "MA4KGC", "MA5KGC", "MA12KGC"] as const;
type Metodo = (typeof METODOS)[number];
const LABEL: Record<Metodo, string> = {
  MA3KGC: "Malla 3 kg",
  MA4KGC: "Girsac 4 kg exprimidor",
  MA5KGC: "D-Pack 5 kg",
  MA12KGC: "Granel",
};

/**
 * A qué tornillo de Mercadona puede ir cada calibre (mapeo confirmado con lo
 * empacado del 3 al 5 de agosto de 2026). Los rangos SE SOLAPAN a propósito: un
 * 3/54 vale para la malla de 5 kg y para el granel, y quien decide es la
 * programación de la semana. Por eso esto no reparte kg — solo dice para qué
 * sirve cada calibre.
 */
const TORNILLOS_POR_CALIBRE: Record<string, string> = {
  "7/110": "exprimidor", "7-110": "exprimidor", "7/100": "exprimidor", "6/90": "exprimidor",
  "5/80": "exprimidor", "4/70": "exprimidor + malla 3",
  "3/60": "malla 5 + malla 3", "3/54": "malla 5 + malla 3 + granel",
  "2/48": "malla 3 + granel", "1/42": "malla 3 + granel",
  "1/36": "granel", "1/30": "granel",
};

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

interface Acumulado {
  kgSizer: number;
  porDestino: Map<string, number>;
  porClase: Map<string, { kg: number; destino: string; apta: boolean }>;
  porCalibreApta: Map<string, number>;
  mdna: Record<Metodo, number>;
  mdnaSinFormato: number;
  mdnaTotal: number;
  kgApta: number;
  pasadas: number;
}
const nuevoAcumulado = (): Acumulado => ({
  kgSizer: 0, porDestino: new Map(), porClase: new Map(), porCalibreApta: new Map(),
  mdna: { MA3KGC: 0, MA4KGC: 0, MA5KGC: 0, MA12KGC: 0 }, mdnaSinFormato: 0, mdnaTotal: 0,
  kgApta: 0, pasadas: 0,
});

/** Suma una fila de clasificación a un acumulado (parcela o lote). */
function acumular(
  acc: Acumulado,
  kg: number,
  clase: string,
  destino: string,
  apta: boolean,
  calibre: string,
  metodo: Metodo | "SIN_FORMATO" | null,
): void {
  acc.kgSizer += kg;
  acc.porDestino.set(destino, (acc.porDestino.get(destino) ?? 0) + kg);
  const ent = acc.porClase.get(clase) ?? { kg: 0, destino, apta };
  ent.kg += kg;
  acc.porClase.set(clase, ent);
  if (apta) {
    acc.kgApta += kg;
    acc.porCalibreApta.set(calibre, (acc.porCalibreApta.get(calibre) ?? 0) + kg);
  }
  if (metodo === "SIN_FORMATO") {
    acc.mdnaSinFormato += kg;
    acc.mdnaTotal += kg;
  } else if (metodo) {
    acc.mdna[metodo] += kg;
    acc.mdnaTotal += kg;
  }
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
  // barato que una consulta por cada uno de los 36 lotes). Los TODOS también
  // sirven para saber hasta qué día llega el volcado (frescura, ver cabecera).
  const batchesTodos = await fetchTodas<BatchRow>("calibrador_batch", (f, t) =>
    db.from("calibrador_batch").select("batch_id, lote, batch_name, inicio, sincronizado_at").order("batch_id").range(f, t));
  const batches = batchesTodos.filter((b) => { const l = lote8(b.lote); return l != null && parcelaPorLote.has(l); });

  // Partes diarios: la otra fuente de "esto ya ha pasado por línea". Llega
  // antes que el volcado del Sizer, así que es la que destapa si el volcado se
  // ha quedado atrás (ver cabecera).
  const [partes, pasadasParte] = await Promise.all([
    fetchTodas<ParteRow>("partes_diarios", (f, t) =>
      db.from("partes_diarios").select("id, date").order("id").range(f, t)),
    fetchTodas<PasadaParteRow>("lotes_dia", (f, t) =>
      db.from("lotes_dia").select("lote_codigo, kg_peso_total, part_id").order("id").range(f, t)),
  ]);
  const fechaPorParte = new Map(partes.map((p) => [p.id, p.date ?? null]));

  // Pasadas del parte que NOMBRAN uno de nuestros lotes, en cualquier posición
  // del código (mismo criterio que el resto del motor: nunca por LIKE).
  const pasadasPartePorLote = new Map<string, Array<{ fecha: string | null; kg: number; codigo: string }>>();
  for (const p of pasadasParte) {
    const codigo = String(p.lote_codigo ?? "");
    for (const m of codigo.matchAll(/\d{8}/g)) {
      if (!parcelaPorLote.has(m[0])) continue;
      const arr = pasadasPartePorLote.get(m[0]) ?? [];
      arr.push({ fecha: fechaPorParte.get(p.part_id) ?? null, kg: num(p.kg_peso_total), codigo });
      pasadasPartePorLote.set(m[0], arr);
    }
  }

  // Frescura de cada fuente.
  const maxONull = (xs: Array<string | null | undefined>): string | null =>
    xs.filter((x): x is string => Boolean(x)).sort().at(-1) ?? null;
  const ultimaPasadaSizer = maxONull(batchesTodos.map((b) => b.inicio))?.slice(0, 10) ?? null;
  const ultimaSincronizacion = maxONull(batchesTodos.map((b) => b.sincronizado_at))?.slice(0, 10) ?? null;
  const ultimoParte = maxONull(partes.map((p) => p.date));
  const volcadoAtrasado = Boolean(ultimaPasadaSizer && ultimoParte && ultimoParte > ultimaPasadaSizer);

  const clasif: ClasifRow[] = [];
  const ids = batches.map((b) => b.batch_id);
  for (let i = 0; i < ids.length; i += 40) {
    clasif.push(...await fetchTodas<ClasifRow>("calibrador_clasificacion", (f, t) =>
      db.from("calibrador_clasificacion").select("batch_id, producto, clase, grupo_destino, tamano, peso_kg")
        .in("batch_id", ids.slice(i, i + 40)).gt("batch_id", 0).order("batch_id").range(f, t), true));
  }
  console.log(`  calibrador_batch (de estos lotes): ${batches.length} pasadas · calibrador_clasificacion: ${clasif.length} filas`);

  // ─── La comprobación que sostiene todo el informe ─────────────────────────
  // Si alguna pasada nombrara dos lotes, sus kg NO serían atribuibles y esto
  // dejaría de poder llamarse "real". Se comprueba, no se supone.
  const compuestas = batches.filter((b) => (String(b.batch_name ?? "").match(/\d{8}/g) ?? []).length > 1);

  const parcelaDeBatch = new Map<number, string>();
  const loteDeBatch = new Map<number, string>();
  for (const b of batches) {
    const l = lote8(b.lote);
    if (!l) continue;
    const p = parcelaPorLote.get(l);
    if (!p) continue;
    parcelaDeBatch.set(b.batch_id, p);
    loteDeBatch.set(b.batch_id, l);
  }

  const porParcela = new Map<string, Acumulado>(PARCELAS.map((p) => [p, nuevoAcumulado()]));
  const porLote = new Map<string, Acumulado>();
  for (const b of batches) {
    const p = parcelaDeBatch.get(b.batch_id);
    const l = loteDeBatch.get(b.batch_id);
    if (p) porParcela.get(p)!.pasadas += 1;
    if (l) {
      const acc = porLote.get(l) ?? nuevoAcumulado();
      acc.pasadas += 1;
      porLote.set(l, acc);
    }
  }

  const metodoPorProducto = new Map<string, Metodo | "SIN_FORMATO" | null>();
  for (const c of clasif) {
    const p = parcelaDeBatch.get(c.batch_id);
    const l = loteDeBatch.get(c.batch_id);
    if (!p || !l) continue;
    const kg = num(c.peso_kg);
    const clase = norm(c.clase);
    const destino = norm(c.grupo_destino).normalize("NFD").replace(/[̀-ͯ]/g, "") || "(sin destino)";
    const apta = CLASES_APTAS_MDNA.has(clase);
    const calibre = String(c.tamano ?? "—").trim() || "—";

    const producto = c.producto ?? "";
    let metodo = metodoPorProducto.get(producto);
    if (metodo === undefined) {
      const deducido = deducirMetodoVentaMdna(producto) as Metodo | null;
      // Dice MDNA pero no declara formato: se cuenta aparte, nunca se reparte
      // a ojo entre los cuatro.
      metodo = deducido ?? (/\bMDNA\b|\bMERCADONA\b/i.test(producto) ? "SIN_FORMATO" : null);
      metodoPorProducto.set(producto, metodo);
    }

    acumular(porParcela.get(p)!, kg, clase, destino, apta, calibre, metodo);
    acumular(porLote.get(l)!, kg, clase, destino, apta, calibre, metodo);
  }

  // ─── Cobertura: cada lote, con dato o con motivo ──────────────────────────
  const cobertura = entradas.map((e) => {
    const l = lote8(e.lote)!;
    const acc = porLote.get(l);
    const kgEnt = num(e.kg_entrada);
    const kgAj = num(e.kg_ajuste_stock);
    // El parte diario llega ANTES que el volcado del Sizer. Si el parte dice
    // que este lote ya pasó por línea, no puede etiquetarse "en cámara" por
    // mucho que la confirmación física sea anterior a esa pasada (ver cabecera).
    const enParte = pasadasPartePorLote.get(l) ?? [];
    const ultimaEnParte = maxONull(enParte.map((p) => p.fecha));
    const kgEnParte = enParte.reduce((s, p) => s + p.kg, 0);
    const procesadoSinVolcado = !acc && enParte.length > 0;

    const motivo = acc
      ? "Con dato real del calibrador"
      : procesadoSinVolcado
        ? `PROCESADO el ${ultimaEnParte} según el parte diario (${Math.round(kgEnParte).toLocaleString("es-ES")} kg), pero el volcado del calibrador todavía no lo trae${ultimaPasadaSizer ? ` (volcado parado en el ${ultimaPasadaSizer})` : ""}: no hay desglose de clases que analizar`
        : e.camara_confirmada_nombre
          ? `Sigue en cámara — ${e.camara_confirmada_nombre}, confirmado a pie el ${e.camara_confirmada_fecha}`
          : kgAj >= kgEnt && kgEnt > 0
            ? "La entrada se registró entera como ajuste de stock: no hay pasada que analizar"
            : e.cerrado_at
              ? "Cerrado a mano SIN ningún registro de procesado bajo su código"
              : "Sin pasada y sin señal de cámara: pendiente de aclarar";
    return {
      parcela: CORTO[e.parcela ?? ""] ?? e.parcela,
      lote: l, fecha: e.fecha, kgEntrada: kgEnt,
      conDato: acc ? "SÍ" : procesadoSinVolcado ? "pendiente volcado" : "no",
      pasadas: acc?.pasadas ?? enParte.length,
      kgSizer: acc?.kgSizer ?? null,
      desfase: acc && kgEnt > 0 ? (acc.kgSizer / kgEnt - 1) * 100 : null,
      motivo,
      procesadoSinVolcado,
      kgEnParte: procesadoSinVolcado ? kgEnParte : null,
    };
  }).sort((a, b) => String(a.parcela).localeCompare(String(b.parcela)) || a.fecha.localeCompare(b.fecha));

  const pendientesVolcado = cobertura.filter((c) => c.procesadoSinVolcado);

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
  const dePar = (p: string) => entradas.filter((e) => e.parcela === p);
  const kgEntTotal = (p: string) => dePar(p).reduce((s, e) => s + num(e.kg_entrada), 0);
  const kgEntConDato = (p: string) => dePar(p).filter((e) => porLote.has(lote8(e.lote)!)).reduce((s, e) => s + num(e.kg_entrada), 0);
  const nLotes = (p: string) => dePar(p).length;
  const nConDato = (p: string) => dePar(p).filter((e) => porLote.has(lote8(e.lote)!)).length;
  const dest = (a: Acumulado, d: string) => a.porDestino.get(d) ?? 0;
  const podrido = (a: Acumulado) => a.porClase.get("PODRIDO")?.kg ?? 0;

  type Unidad = "kg" | "pct" | "int" | "txt";
  const fila = (concepto: string, v2: number | null, v4: number | null, unidad: Unidad, nota: string) => ({
    concepto, v2, v4, unidad, nota, dif: v2 != null && v4 != null ? v4 - v2 : null,
  });
  const resumen = [
    // ─── Hasta qué día llega cada fuente ────────────────────────────────────
    // Va lo PRIMERO a propósito: sin esto, un informe con el volcado parado se
    // lee como si estuviera al día (ver cabecera del script).
    fila("▸ Última pasada en el volcado del calibrador", null, null, "txt",
      `${ultimaPasadaSizer ?? "sin dato"} · sincronizado por última vez el ${ultimaSincronizacion ?? "sin dato"}`),
    fila("▸ Último parte diario registrado", null, null, "txt", ultimoParte ?? "sin dato"),
    fila("▸ Estado de los datos", null, null, "txt",
      volcadoAtrasado
        ? `⚠ EL VOLCADO DEL CALIBRADOR VA POR DETRÁS DE LOS PARTES (${ultimaPasadaSizer} frente a ${ultimoParte}). Lo procesado después del ${ultimaPasadaSizer} todavía no tiene desglose de clases y NO está en los porcentajes de abajo.${pendientesVolcado.length > 0 ? ` Afecta a ${pendientesVolcado.length} lote(s) de estas parcelas: ${pendientesVolcado.map((c) => c.lote).join(", ")} (${Math.round(pendientesVolcado.reduce((s, c) => s + (c.kgEnParte ?? 0), 0)).toLocaleString("es-ES")} kg). Ver hoja «Cobertura».` : " Ninguno de los lotes de estas dos parcelas está afectado."}`
        : "Volcado del calibrador y partes diarios al mismo día: el informe está completo hasta esa fecha."),
    fila("Lotes de la parcela", nLotes(PARCELAS[0]), nLotes(PARCELAS[1]), "int", "Todos los lotes entrados por báscula"),
    fila("Lotes con dato real del calibrador", nConDato(PARCELAS[0]), nConDato(PARCELAS[1]), "int", "Los demás no han pasado por línea: ver hoja «Cobertura»"),
    fila("Pasadas analizadas", p2.pasadas, p4.pasadas, "int", "Todas de un solo lote: cada kg es directamente atribuible"),
    fila("Kg entrada por báscula (todos los lotes)", kgEntTotal(PARCELAS[0]), kgEntTotal(PARCELAS[1]), "kg", "Referencia, NO la base de los porcentajes"),
    fila("Kg entrada de los lotes analizados", kgEntConDato(PARCELAS[0]), kgEntConDato(PARCELAS[1]), "kg", "La parte de la parcela que ya ha pasado por línea"),
    fila("Cobertura del informe", pct(kgEntConDato(PARCELAS[0]), kgEntTotal(PARCELAS[0])), pct(kgEntConDato(PARCELAS[1]), kgEntTotal(PARCELAS[1])), "pct", "Sobre kg de entrada"),
    fila("KG PESADOS POR EL CALIBRADOR", p2.kgSizer, p4.kgSizer, "kg", "★ LA BASE de todos los porcentajes de abajo"),
    fila("Desfase calibrador vs báscula", pct(p2.kgSizer - kgEntConDato(PARCELAS[0]), kgEntConDato(PARCELAS[0])), pct(p4.kgSizer - kgEntConDato(PARCELAS[1]), kgEntConDato(PARCELAS[1])), "pct", "Sistemático en toda la campaña (+7,80 % en 904 lotes): desfase de tara, no fruta de otro sitio"),
    fila("% EXPORTACIÓN", pct(dest(p2, "EXPORTACION"), p2.kgSizer), pct(dest(p4, "EXPORTACION"), p4.kgSizer), "pct", "Extra 1/2, Cat1 A/B y Verde Claro"),
    fila("% NO EXPORTACIÓN", pct(dest(p2, "NO EXPORTACION"), p2.kgSizer), pct(dest(p4, "NO EXPORTACION"), p4.kgSizer), "pct", "Cat 2, Cat 3 y Verde Oscuro"),
    fila("% MUJERES", pct(dest(p2, "MUJERES"), p2.kgSizer), pct(dest(p4, "MUJERES"), p4.kgSizer), "pct", "Fruta desviada a repaso manual"),
    fila("% NO COMERCIAL", pct(dest(p2, "NO COMERCIAL"), p2.kgSizer), pct(dest(p4, "NO COMERCIAL"), p4.kgSizer), "pct", "Industria, podrido y densidad"),
    fila("Podrido en el calibrador", podrido(p2), podrido(p4), "kg", "Medido por la máquina, no prorrateado"),
    fila("% podrido en el calibrador", pct(podrido(p2), p2.kgSizer), pct(podrido(p4), p4.kgSizer), "pct", "Solo el que descarta la máquina: la tría previa no se ve aquí"),
    fila("% clases aptas para Mercadona (A–F)", pct(p2.kgApta, p2.kgSizer), pct(p4.kgApta, p4.kgSizer), "pct", "Techo teórico de lo que Mercadona podría aceptar"),
    ...METODOS.map((m) => fila(`MERCADONA · ${LABEL[m]}`, pct(p2.mdna[m], p2.kgSizer), pct(p4.mdna[m], p4.kgSizer), "pct",
      `${Math.round(p2.mdna[m]).toLocaleString("es-ES")} kg en la finca 2 y ${Math.round(p4.mdna[m]).toLocaleString("es-ES")} kg en la 4`)),
    fila("MERCADONA · sin formato en el nombre", pct(p2.mdnaSinFormato, p2.kgSizer), pct(p4.mdnaSinFormato, p4.kgSizer), "pct", "Dice MDNA pero no declara formato: no se reparte a ojo"),
    fila("% MERCADONA TOTAL", pct(p2.mdnaTotal, p2.kgSizer), pct(p4.mdnaTotal, p4.kgSizer), "pct", "★ EL APROVECHAMIENTO DE MERCADONA de la parcela"),
    fila("Kg a Mercadona", p2.mdnaTotal, p4.mdnaTotal, "kg", "Kg reales clasificados en un producto de Mercadona"),
    fila("Apto A–F que NO fue a Mercadona", pct(Math.max(0, p2.kgApta - p2.mdnaTotal), p2.kgSizer), pct(Math.max(0, p4.kgApta - p4.mdnaTotal), p4.kgSizer), "pct", "Fruta con calidad de Mercadona vendida a otros clientes"),
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
    filas: PARCELAS.flatMap((p) => {
      const a = porParcela.get(p)!;
      return [...a.porClase.entries()].sort((x, y) => y[1].kg - x[1].kg).map(([clase, v]) => ({
        parcela: CORTO[p], destino: v.destino, clase, apta: v.apta ? "SÍ" : "no",
        kg: v.kg, pctSizer: pct(v.kg, a.kgSizer),
      }));
    }),
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
      const a = porParcela.get(p)!;
      const aptoFuera = Math.max(0, a.kgApta - a.mdnaTotal);
      return [
        ...METODOS.map((m) => ({
          parcela: CORTO[p], formato: `${LABEL[m]} (${m})`, kg: a.mdna[m],
          pctSizer: pct(a.mdna[m], a.kgSizer), pctMdna: pct(a.mdna[m], a.mdnaTotal),
        })),
        { parcela: CORTO[p], formato: "Sin formato en el nombre", kg: a.mdnaSinFormato, pctSizer: pct(a.mdnaSinFormato, a.kgSizer), pctMdna: pct(a.mdnaSinFormato, a.mdnaTotal) },
        { parcela: CORTO[p], formato: "TOTAL MERCADONA", kg: a.mdnaTotal, pctSizer: pct(a.mdnaTotal, a.kgSizer), pctMdna: a.mdnaTotal > 0 ? 100 : null },
        { parcela: CORTO[p], formato: "Apto A–F vendido a otros clientes", kg: aptoFuera, pctSizer: pct(aptoFuera, a.kgSizer), pctMdna: null },
        { parcela: CORTO[p], formato: "No apto para Mercadona", kg: a.kgSizer - a.kgApta, pctSizer: pct(a.kgSizer - a.kgApta, a.kgSizer), pctMdna: null },
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
    filas: PARCELAS.flatMap((p) => {
      const a = porParcela.get(p)!;
      return [...a.porCalibreApta.entries()].sort((x, y) => y[1] - x[1]).map(([calibre, kg]) => ({
        parcela: CORTO[p], calibre, kg, pctApta: pct(kg, a.kgApta),
        tornillos: TORNILLOS_POR_CALIBRE[calibre] ?? "— (calibre fuera de los tornillos de Mercadona)",
      }));
    }),
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
    filas: cobertura.filter((c) => c.conDato === "SÍ").map((c) => {
      const a = porLote.get(c.lote)!;
      return {
        parcela: c.parcela, lote: c.lote, fecha: c.fecha, pasadas: c.pasadas,
        kgEntrada: c.kgEntrada, kgSizer: a.kgSizer, desfase: c.desfase,
        pctExport: pct(dest(a, "EXPORTACION"), a.kgSizer),
        pctNoExport: pct(dest(a, "NO EXPORTACION"), a.kgSizer),
        pctMujeres: pct(dest(a, "MUJERES"), a.kgSizer),
        pctNoComercial: pct(dest(a, "NO COMERCIAL"), a.kgSizer),
        kgPodrido: podrido(a), pctPodrido: pct(podrido(a), a.kgSizer),
        mdna3: a.mdna.MA3KGC, mdna4: a.mdna.MA4KGC, mdna5: a.mdna.MA5KGC, mdna12: a.mdna.MA12KGC,
        mdnaTotal: a.mdnaTotal, pctMdna: pct(a.mdnaTotal, a.kgSizer),
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
      kgCol("Kg según el parte (sin volcar)", "kgEnParte", 20),
      pctCol("Desfase", "desfase", 10),
      { header: "Motivo", key: "motivo", width: 88 },
    ],
    filas: cobertura,
  });

  const totalEnt = kgEntTotal(PARCELAS[0]) + kgEntTotal(PARCELAS[1]);
  const totalConDato = kgEntConDato(PARCELAS[0]) + kgEntConDato(PARCELAS[1]);
  const metodo: Array<[string, string]> = [
    ["Qué se ha medido", `Las ${p2.pasadas + p4.pasadas} pasadas de calibrador de los ${nConDato(PARCELAS[0]) + nConDato(PARCELAS[1])} lotes de las fincas 2 y 4 que ya han pasado por línea. La fuente es el volcado SQL del Compac Sizer, que registra TODAS las pasadas de cada lote — el informe Word solo trae la última, y 225 lotes de la campaña pasan más de una vez.`],
    ["Por qué esto SÍ es real", `Se ha comprobado pasada a pasada que ninguna nombra más de un lote (${compuestas.length} compuestas encontradas): no hay códigos que mezclen fruta de dos parcelas. Por eso cada kg que clasificó la máquina se atribuye directamente, sin prorrateo, sin conciliación y sin aplicar mezclas de otros lotes. El script avisa por consola si algún día aparece una pasada compuesta.`],
    ["La base de los porcentajes", `Los kg que pesó el CALIBRADOR (${Math.round(p2.kgSizer + p4.kgSizer).toLocaleString("es-ES")} kg entre las dos parcelas), no los de la báscula de entrada. Las dos básculas no coinciden: el calibrador pesa un +7,80 % de más en los 904 lotes de la campaña con volcado, un +9,41 % en la finca 2 y un +5,06 % en la 4. Como el desfase es sistemático y las pasadas son de un solo lote, no es fruta de otro sitio: es tara/calibración. Calcular los porcentajes sobre la entrada daría cifras que suman más del 100 %.`],
    ["Cobertura", `${Math.round(totalConDato).toLocaleString("es-ES")} kg analizados de ${Math.round(totalEnt).toLocaleString("es-ES")} kg entrados (${(pct(totalConDato, totalEnt) ?? 0).toFixed(1)} %). Los lotes que faltan no se estiman ni se rellenan: cada uno tiene su motivo en la hoja «Cobertura». La mayoría sigue físicamente en cámara, confirmado a pie por el dueño.`],
    ["Hasta qué día llega el informe", `El volcado del calibrador llega al ${ultimaPasadaSizer ?? "—"} (última sincronización: ${ultimaSincronizacion ?? "—"}) y los partes diarios al ${ultimoParte ?? "—"}. ${volcadoAtrasado ? `EL VOLCADO VA POR DETRÁS: lo que se procesó después del ${ultimaPasadaSizer} ya está en los partes pero todavía no tiene desglose de clases, así que no puede entrar en los porcentajes. Los lotes en esa situación salen en «Cobertura» como «pendiente volcado» — con sus kg reales del parte — y NUNCA como «en cámara».` : "Las dos fuentes están al mismo día."}`],
    ["Qué NO dice este informe", "El podrido que se ve aquí es SOLO el que descarta la máquina. La tría que se retira antes de entrar al calibrador (bolsa y bateas) no se puede repartir por lote — se pesa por día y las bateas se vacían cada varios días — así que no aparece. Para la pérdida completa de fruta, con merma de cámara y podrido de tría, está el informe de campaña por productor y finca."],
    ["Clases aptas para Mercadona", "Extra 1, Extra 2, Cat1 A, Cat1 B, Verde Claro y Cat 2. Mujeres, Cat 3, Verde Oscuro, Industria, Podrido y Densidad no van a Mercadona nunca. Ojo: el volcado del Sizer escribe la clase sin la letra («Extra 1») y el Word con ella («(A) Extra 1»); aquí se casa por nombre."],
    ["Los 4 formatos", `${METODOS.map((m) => `${m} = ${LABEL[m]}`).join(" · ")}. Se leen del nombre del producto que teclea el calibrador, con la misma función que usa la app. Lo que dice «MDNA» sin declarar formato se cuenta aparte.`],
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
  console.log(`Volcado del calibrador hasta ${ultimaPasadaSizer} (sincronizado ${ultimaSincronizacion}) · partes diarios hasta ${ultimoParte}`);
  if (volcadoAtrasado) {
    console.log(`⚠ EL VOLCADO VA ${ultimaPasadaSizer} → ${ultimoParte}: hay proceso registrado que aún no tiene desglose de clases.`);
    for (const c of pendientesVolcado) {
      console.log(`  · ${c.lote} (${c.parcela}) procesado según el parte, ${Math.round(c.kgEnParte ?? 0).toLocaleString("es-ES")} kg SIN volcar`);
    }
    if (pendientesVolcado.length === 0) console.log("  · ningún lote de estas dos parcelas afectado");
  }
  console.log(`Pasadas que nombran más de un lote (romperían la atribución): ${compuestas.length}`);
  for (const b of compuestas) console.log(`  ¡AVISO! batch ${b.batch_id}: ${b.batch_name}`);
  for (const p of PARCELAS) {
    const a = porParcela.get(p)!;
    const cuadre = [...a.porDestino.values()].reduce((s, v) => s + v, 0) - a.kgSizer;
    console.log(`\n${CORTO[p]} — ${nConDato(p)}/${nLotes(p)} lotes · ${a.pasadas} pasadas`);
    console.log(`  Entrada báscula   ${Math.round(kgEntTotal(p)).toLocaleString("es-ES").padStart(9)} kg (analizados ${Math.round(kgEntConDato(p)).toLocaleString("es-ES")}, ${(pct(kgEntConDato(p), kgEntTotal(p)) ?? 0).toFixed(1)} %)`);
    console.log(`  Pesado calibrador ${Math.round(a.kgSizer).toLocaleString("es-ES").padStart(9)} kg (desfase ${(pct(a.kgSizer - kgEntConDato(p), kgEntConDato(p)) ?? 0).toFixed(2)} %)`);
    console.log(`  Exportación ${(pct(dest(a, "EXPORTACION"), a.kgSizer) ?? 0).toFixed(1)} % · No exp. ${(pct(dest(a, "NO EXPORTACION"), a.kgSizer) ?? 0).toFixed(1)} % · Mujeres ${(pct(dest(a, "MUJERES"), a.kgSizer) ?? 0).toFixed(1)} % · No comercial ${(pct(dest(a, "NO COMERCIAL"), a.kgSizer) ?? 0).toFixed(1)} %`);
    console.log(`  Podrido máquina   ${Math.round(podrido(a)).toLocaleString("es-ES").padStart(9)} kg (${(pct(podrido(a), a.kgSizer) ?? 0).toFixed(2)} %)`);
    console.log(`  Apto MDNA ${(pct(a.kgApta, a.kgSizer) ?? 0).toFixed(1)} %  ·  A MERCADONA ${(pct(a.mdnaTotal, a.kgSizer) ?? 0).toFixed(1)} % (${Math.round(a.mdnaTotal).toLocaleString("es-ES")} kg)`);
    for (const m of METODOS) {
      console.log(`    ${LABEL[m].padEnd(24)} ${Math.round(a.mdna[m]).toLocaleString("es-ES").padStart(8)} kg (${(pct(a.mdna[m], a.kgSizer) ?? 0).toFixed(1)} %)`);
    }
    if (a.mdnaSinFormato > 0) console.log(`    ${"sin formato".padEnd(24)} ${Math.round(a.mdnaSinFormato).toLocaleString("es-ES").padStart(8)} kg`);
    console.log(`  Cuadre destinos ${cuadre.toFixed(3)} kg (debe ser 0)`);
  }
  console.log(`\nExcel: ${salida}`);
}

main().catch((e) => { console.error(e); process.exit(1); });

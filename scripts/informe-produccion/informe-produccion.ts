/**
 * informe-produccion.ts — datos para los informes diarios/semanales de producción
 * (económico + rendimiento). Sustituye al informe-semana33.ts puntual.
 *
 * USO (desde la raíz del repo):
 *   node node_modules/vite-node/vite-node.mjs scripts/informe-produccion/informe-produccion.ts
 *   node ... informe-produccion.ts --hasta=2026-08-14   (por defecto: hoy, hora de Madrid)
 *
 * Reglas de fidelidad:
 * - SEMANA ACTUAL = lunes ISO de --hasta … --hasta. SEMANA ANTERIOR = la ISO completa previa.
 * - Fuente del detalle POR DÍA: espejo de la BD del Sizer si ese día tiene pasadas;
 *   si no, los DOCX de outputs/calibrador (validados). Si hay ambas, se usa la BD y
 *   se comprueba que los DOCX digan lo mismo (aviso si difieren >1 %).
 * - Tarifa Mercadona: la última semana con los 4 formatos facturados; si su €/kg
 *   medio cae por debajo del 80 % de la anterior completa, se considera "a medio
 *   facturar" y se usa la anterior (aviso).
 * - Personas: salida/asistencias.json (export del reloj parseado). Si un día no
 *   tiene datos de personas, se dice — no se inventa.
 * Solo LEE de Supabase. Escribe scripts/informe-produccion/salida/informe-datos.json.
 */
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
// @ts-ignore — lib ESM sin tipos
import { parsearInformeCalibrador, fechaDeComienzo, validarBloques } from "../lib-informe-calibrador.mjs";
import {
  clasificarDestinoRentabilidad,
  esMdnaSinFormato,
  preciosMdnaDesdeSemana,
  ENVASE_EUR_KG,
  DESTINOS_ORDEN,
  DESTINO_LABEL,
  PRECIOS_RENTABILIDAD_DEFECTO,
  SUMINISTROS_DIA_DEFECTO_EUR,
  COSTE_HORA_MEDIO_DEFECTO,
  type DestinoRentabilidad,
} from "@/lib/rentabilidadDia";
import { claveProducto, deducirProducto, INDICE_CONFECCION_SEMILLA } from "@/lib/productosCanonicos";
import { grupoRendimientoTrabajador, cuentaTrabajadorKgPersona, tipoCosteTrabajador } from "@/lib/asistenciaRendimiento";
import { normalizarLoteCodigo } from "@/lib/loteCodigo";

const CARPETA = path.resolve("scripts/informe-produccion");
const SALIDA_DIR = path.join(CARPETA, "salida");
const SALIDA = path.join(SALIDA_DIR, "informe-datos.json");
const ASISTENCIAS = path.join(SALIDA_DIR, "asistencias.json");

// ─── Fechas (hora de Madrid, semanas ISO) ────────────────────────────────────
const hoyMadrid = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid" }).format(new Date());
const argHasta = process.argv.find((a) => a.startsWith("--hasta="))?.split("=")[1];
const HASTA = argHasta ?? hoyMadrid();
if (!/^\d{4}-\d{2}-\d{2}$/.test(HASTA)) throw new Error(`--hasta inválido: ${HASTA}`);

const aDate = (iso: string) => new Date(iso + "T12:00:00Z"); // mediodía UTC: inmune a DST
const aIso = (d: Date) => d.toISOString().slice(0, 10);
const sumaDias = (iso: string, n: number) => { const d = aDate(iso); d.setUTCDate(d.getUTCDate() + n); return aIso(d); };
const lunesDe = (iso: string) => sumaDias(iso, -((aDate(iso).getUTCDay() + 6) % 7));
const numSemanaIso = (iso: string) => {
  const d = aDate(iso);
  d.setUTCDate(d.getUTCDate() + 3 - ((d.getUTCDay() + 6) % 7)); // jueves de su semana
  const enero1 = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - enero1.getTime()) / 864e5 + 1) / 7);
};

const lunesActual = lunesDe(HASTA);
const DIAS_ACTUAL: string[] = [];
for (let f = lunesActual; f <= HASTA; f = sumaDias(f, 1)) DIAS_ACTUAL.push(f);
const lunesAnterior = sumaDias(lunesActual, -7);
const DIAS_ANTERIOR_TODOS: string[] = [];
for (let i = 0; i < 7; i++) DIAS_ANTERIOR_TODOS.push(sumaDias(lunesAnterior, i));
const DESDE_DATOS = sumaDias(lunesAnterior, -1);

try { process.loadEnvFile(path.resolve(".env")); } catch { /* entorno */ }
const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY en .env");
const db = createClient(url, key, { auth: { persistSession: false } });

const PAGE = 1000;
async function fetchTodas<T>(consulta: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await consulta(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const filas = data ?? [];
    out.push(...filas);
    if (filas.length < PAGE) return out;
  }
}

const num = (v: unknown): number => Number(v) || 0;
const norm = (s: unknown) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

async function main() {
  const avisos: string[] = [];

  const [batches, informes, entradas, productoDia, fichas, semanasMdna, erpPalets, partes, trabajadores] = await Promise.all([
    fetchTodas<{ batch_id: number; lote: string | null; inicio: string; fin: string | null }>((a, b) =>
      db.from("calibrador_batch").select("batch_id, lote, inicio, fin").gte("inicio", DESDE_DATOS).order("batch_id").range(a, b)),
    fetchTodas<{ batch_id: number | null; lote: string; fecha: string; toneladas_hora: number | null }>((a, b) =>
      db.from("calibrador_informe").select("batch_id, lote, fecha, toneladas_hora").gte("fecha", DESDE_DATOS).order("fecha").range(a, b)),
    fetchTodas<{ lote: string; fecha: string; kg_entrada: number | null; importe_total: number | null; agricultor: string | null; finca: string | null; articulo: string | null }>((a, b) =>
      db.from("entradas_bascula").select("lote, fecha, kg_entrada, importe_total, agricultor, finca, articulo").order("fecha").range(a, b)),
    fetchTodas<{ producto: string | null; formato_caja: string | null; kg: number | null }>((a, b) =>
      db.from("producto_dia").select("producto, formato_caja, kg").order("id").range(a, b)),
    fetchTodas<{ clave: string; nombre: string; metodo_venta: string | null; precio_venta_eur_kg: number | null }>((a, b) =>
      db.from("productos_catalogo").select("clave, nombre, metodo_venta, precio_venta_eur_kg").order("clave").range(a, b)),
    db.from("mercadona_semanas").select("id, anio, semana").order("anio").order("semana").then(async (r) => {
      if (r.error) throw new Error(r.error.message);
      const ids = (r.data ?? []).map((s) => s.id);
      const m = ids.length ? await db.from("mercadona_semana_metodos").select("semana_id, metodo, kilos, base_iva").in("semana_id", ids) : { data: [], error: null };
      if (m.error) throw new Error(m.error.message);
      return { semanas: r.data ?? [], metodos: m.data ?? [] };
    }),
    fetchTodas<{ fecha: string; articulo: string | null; kg_netos: number | null; importe_venta: number | null; cliente: string | null; num_albaran_venta: string | null }>((a, b) =>
      db.from("erp_palet").select("fecha, articulo, kg_netos, importe_venta, cliente, num_albaran_venta").gte("fecha", DESDE_DATOS).lte("fecha", sumaDias(HASTA, 2)).order("fecha").range(a, b)),
    fetchTodas<{ date: string; kg_produccion_calibrador: number | null; kg_mujeres_calibrador: number | null; kg_reciclado_malla_z1: number | null; kg_reciclado_malla_z2: number | null; kg_podrido_bolsa_basura: number | null; kg_industria_manual: number | null; kg_palets_brutos: number | null; origen_calibrador: string | null }>((a, b) =>
      db.from("partes_diarios").select("date, kg_produccion_calibrador, kg_mujeres_calibrador, kg_reciclado_malla_z1, kg_reciclado_malla_z2, kg_podrido_bolsa_basura, kg_industria_manual, kg_palets_brutos, origen_calibrador").gte("date", DESDE_DATOS).lte("date", HASTA).order("date").range(a, b)),
    fetchTodas<{ id: string; nombre: string; zona: string | null; coste_hora: number | null; computa_kg_persona: boolean | null; activo: boolean }>((a, b) =>
      db.from("trabajadores").select("id, nombre, zona, coste_hora, computa_kg_persona, activo").order("nombre").range(a, b)),
  ]);

  const batchIds = batches.map((b) => b.batch_id);
  const clasif: Array<{ batch_id: number; lote: string; producto: string | null; calidad: string | null; clase: string | null; tamano: string | null; peso_kg: number | null }> = [];
  for (let i = 0; i < batchIds.length; i += 100) {
    const trozo = batchIds.slice(i, i + 100);
    const filas = await fetchTodas<typeof clasif[number]>((a, b) =>
      db.from("calibrador_clasificacion").select("batch_id, lote, producto, calidad, clase, tamano, peso_kg").in("batch_id", trozo).order("batch_id").range(a, b));
    clasif.push(...filas);
  }

  // ─── Fecha por batch y kg por batch (para decidir la fuente de cada día) ──
  const aFechaMadrid = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid" }).format(new Date(iso));
  const fechaPorBatch = new Map<number, string>();
  for (const b of batches) fechaPorBatch.set(b.batch_id, aFechaMadrid(b.inicio));
  const kgPorBatch = new Map<number, number>();
  for (const c of clasif) kgPorBatch.set(c.batch_id, (kgPorBatch.get(c.batch_id) ?? 0) + num(c.peso_kg));
  const kgBdPorDia = new Map<string, number>();
  for (const b of batches) {
    const f = fechaPorBatch.get(b.batch_id)!;
    kgBdPorDia.set(f, (kgBdPorDia.get(f) ?? 0) + (kgPorBatch.get(b.batch_id) ?? 0));
  }

  // ─── DOCX locales: parsear TODOS los del rango, agrupados por día ──────────
  const hhmmssAHoras = (t: string | null): number | null => {
    const m = /^(\d+):(\d{2}):(\d{2})$/.exec(String(t ?? "").trim());
    if (!m) return null;
    return Number(m[1]) + Number(m[2]) / 60 + Number(m[3]) / 3600;
  };
  interface PasadaDocx { fecha: string; lote: string; horas: number | null; th: number | null; kg: number; lineas: Array<Record<string, unknown>>; fichero: string; malos: number }
  const docxPorDia = new Map<string, PasadaDocx[]>();
  // DOS carpetas de DOCX: la del receptor de la LAN (outputs/calibrador, hoy
  // respaldo) y la del buzón de correo (outputs/buzon), que es la VÍA ÚNICA
  // desde el 26-08. Mirar solo la del receptor dejó la semana del 17-25 en
  // "sin datos" con los informes en disco. El dedup por (fecha, lote,
  // comienzo) ya absorbe el mismo informe llegado por las dos vías.
  const dirsDocx = [path.resolve("outputs/calibrador"), path.resolve("outputs/buzon")]
    .filter((d) => fs.existsSync(d));
  {
    const porPasada = new Map<string, PasadaDocx>();
    const ficheros = dirsDocx.flatMap((dir) =>
      (fs.readdirSync(dir, { recursive: true }) as string[])
        .map((f) => path.join(dir, String(f))).filter((f) => f.endsWith(".docx"))).sort();
    for (const f of ficheros) {
      let r: { cabecera: Record<string, unknown>; lineas: Array<Record<string, unknown>>; bloques: unknown[] };
      try { r = parsearInformeCalibrador(fs.readFileSync(f)); } catch { continue; }
      const fecha = fechaDeComienzo(r.cabecera.comienzo as string);
      if (!fecha || fecha < DESDE_DATOS || fecha > HASTA) continue;
      const claveP = `${fecha}|${r.cabecera.lote}|${r.cabecera.comienzo}`;
      const horas = hhmmssAHoras(r.cabecera.tiempoLote as string);
      porPasada.set(claveP, {
        fecha, lote: String(r.cabecera.lote ?? "(sin lote)"),
        horas: horas != null && horas > 0 && horas < 9 ? horas : null,
        th: num(r.cabecera.toneladasHora) || null,
        kg: r.lineas.reduce((s, l) => s + num(l.kg), 0),
        lineas: r.lineas, fichero: path.basename(f),
        malos: validarBloques(r.bloques as never[]).length,
      });
    }
    for (const p of porPasada.values()) {
      const lista = docxPorDia.get(p.fecha) ?? [];
      lista.push(p);
      docxPorDia.set(p.fecha, lista);
    }
  }

  // ─── Pasadas EXTRA: informes exportados a Excel desde el visor del Sizer ───
  // (parsear_lotes_extra.py los deja en salida/pasadas-extra.json). Cubren el
  // lote que se olvidó enviar por correo; si su DOCX llega después, se ignora
  // el extra (dedup por fecha+lote).
  const EXTRA = path.join(SALIDA_DIR, "pasadas-extra.json");
  if (fs.existsSync(EXTRA)) {
    const extras = JSON.parse(fs.readFileSync(EXTRA, "utf-8")) as Array<{ fichero: string; fecha: string | null; lote: string; horas: number | null; th: number | null; kg: number; lineas: Array<Record<string, unknown>> }>;
    for (const x of extras) {
      if (!x.fecha || x.fecha < DESDE_DATOS || x.fecha > HASTA) continue;
      const lista = docxPorDia.get(x.fecha) ?? [];
      if (lista.some((p) => norm(p.lote) === norm(x.lote))) continue;
      lista.push({ fecha: x.fecha, lote: x.lote, horas: x.horas != null && x.horas > 0 && x.horas < 9 ? x.horas : null, th: x.th, kg: x.kg, lineas: x.lineas, fichero: x.fichero, malos: 0 });
      docxPorDia.set(x.fecha, lista);
      avisos.push(`${x.fecha}: lote «${x.lote}» añadido desde el Excel exportado del calibrador (${Math.round(x.kg)} kg).`);
    }
  }

  // ─── Días con datos y fuente por día ───────────────────────────────────────
  const partePorFecha = new Map(partes.map((p) => [p.date, p]));
  const tieneDatos = (f: string) => (kgBdPorDia.get(f) ?? 0) > 0 || (docxPorDia.get(f)?.length ?? 0) > 0 || partePorFecha.has(f);
  const DIAS_ANTERIOR = DIAS_ANTERIOR_TODOS.filter(tieneDatos);
  const TODOS_DIAS = [...DIAS_ANTERIOR, ...DIAS_ACTUAL];
  const fuentePorDia = new Map<string, "bd" | "docx" | "sin_datos">();
  for (const f of TODOS_DIAS) {
    if ((kgBdPorDia.get(f) ?? 0) > 0) {
      fuentePorDia.set(f, "bd");
      const kgDocx = (docxPorDia.get(f) ?? []).reduce((s, p) => s + p.kg, 0);
      const kgBd = kgBdPorDia.get(f) ?? 0;
      if (kgDocx > 0 && Math.abs(kgDocx - kgBd) / kgBd > 0.01) {
        avisos.push(`${f}: la BD del Sizer (${Math.round(kgBd)} kg) y los DOCX (${Math.round(kgDocx)} kg) difieren >1 % — se usa la BD.`);
      }
    } else if ((docxPorDia.get(f)?.length ?? 0) > 0) {
      fuentePorDia.set(f, "docx");
      for (const p of docxPorDia.get(f)!) {
        if (p.malos > 0) avisos.push(`DOCX ${p.fichero}: ${p.malos} bloque(s) no cuadran con su total — revisar.`);
      }
    } else {
      fuentePorDia.set(f, "sin_datos");
      if (f <= HASTA) avisos.push(`${f}: sin datos del calibrador (ni BD ni DOCX).`);
    }
  }

  // ─── Filas unificadas + velocidad por pasada ───────────────────────────────
  interface Fila { fecha: string; lote: string; producto: string; calidad: string | null; clase: string | null; tamano: string | null; kg: number }
  const filas: Fila[] = [];
  const pasadasPorDia = new Map<string, Array<{ lote: string; horas: number | null; th: number | null; kg: number }>>();
  const horasPorDia = new Map<string, number>();
  const thInformePorLote = new Map<string, number>();
  for (const inf of informes) {
    if (inf.toneladas_hora != null) thInformePorLote.set(`${inf.fecha}|${normalizarLoteCodigo(inf.lote) ?? inf.lote}`, num(inf.toneladas_hora));
  }

  for (const b of batches) {
    const fecha = fechaPorBatch.get(b.batch_id)!;
    if (fuentePorDia.get(fecha) !== "bd") continue;
    const kg = kgPorBatch.get(b.batch_id) ?? 0;
    let horas: number | null = null;
    if (b.fin) {
      horas = (new Date(b.fin).getTime() - new Date(b.inicio).getTime()) / 3600e3;
      if (horas <= 0 || horas > 9) horas = null;
    }
    const th = thInformePorLote.get(`${fecha}|${normalizarLoteCodigo(b.lote ?? "") ?? b.lote}`) ?? null;
    const lista = pasadasPorDia.get(fecha) ?? [];
    lista.push({ lote: b.lote ?? "(sin lote)", horas, th, kg });
    pasadasPorDia.set(fecha, lista);
    if (horas != null) horasPorDia.set(fecha, (horasPorDia.get(fecha) ?? 0) + horas);
  }
  for (const c of clasif) {
    const fecha = fechaPorBatch.get(c.batch_id);
    if (!fecha || fuentePorDia.get(fecha) !== "bd" || num(c.peso_kg) <= 0) continue;
    filas.push({ fecha, lote: c.lote, producto: (c.producto ?? "").trim(), calidad: c.calidad, clase: c.clase, tamano: c.tamano, kg: num(c.peso_kg) });
  }
  for (const [fecha, pasadas] of docxPorDia) {
    if (fuentePorDia.get(fecha) !== "docx") continue;
    for (const p of pasadas) {
      const lista = pasadasPorDia.get(fecha) ?? [];
      lista.push({ lote: p.lote, horas: p.horas, th: p.th, kg: p.kg });
      pasadasPorDia.set(fecha, lista);
      if (p.horas != null) horasPorDia.set(fecha, (horasPorDia.get(fecha) ?? 0) + p.horas);
      for (const l of p.lineas) {
        if (num(l.kg) <= 0) continue;
        filas.push({ fecha, lote: p.lote, producto: String(l.producto ?? "").trim(), calidad: l.calidad == null ? null : String(l.calidad), clase: l.clase == null ? null : String(l.clase), tamano: l.tamano == null ? null : String(l.tamano), kg: num(l.kg) });
      }
    }
  }

  // ─── Tarifa Mercadona: última semana completa, con guarda anti-parcial ─────
  const metodosPorSemanaId = new Map<string, Array<{ metodo: string | null; kilos: number | null; base_iva: number | null }>>();
  for (const m of semanasMdna.metodos) {
    const lista = metodosPorSemanaId.get(m.semana_id as string) ?? [];
    lista.push(m);
    metodosPorSemanaId.set(m.semana_id as string, lista);
  }
  interface Candidata { anio: number; semana: number; precios: Partial<Record<"mdna3" | "mdna4" | "mdna5" | "mdnaGranel", number>>; media: number }
  const candidatas: Candidata[] = [];
  for (const s of semanasMdna.semanas) {
    const p = preciosMdnaDesdeSemana(metodosPorSemanaId.get(s.id as string) ?? []);
    if (p.mdna3 && p.mdna4 && p.mdna5 && p.mdnaGranel) {
      candidatas.push({ anio: s.anio, semana: s.semana, precios: p, media: (p.mdna3 + p.mdna4 + p.mdna5 + p.mdnaGranel) / 4 });
    }
  }
  candidatas.sort((a, b) => a.anio - b.anio || a.semana - b.semana);
  let tarifa = candidatas.at(-1) ?? null;
  if (tarifa && candidatas.length >= 2) {
    const previa = candidatas.at(-2)!;
    if (tarifa.media < 0.8 * previa.media) {
      avisos.push(`La semana Mercadona ${tarifa.semana}/${tarifa.anio} parece a medio facturar (media ${tarifa.media.toFixed(2)} €/kg vs ${previa.media.toFixed(2)} de la ${previa.semana}): se usa la tarifa de la ${previa.semana}.`);
      tarifa = previa;
    }
  }
  if (!tarifa) avisos.push("Sin ninguna semana Mercadona con los 4 formatos facturados: precios MDNA a 0 — cargar la hoja semanal.");
  const precios = { ...PRECIOS_RENTABILIDAD_DEFECTO, ...(tarifa?.precios ?? {}) };

  // ─── Fruta €/kg por lote ───────────────────────────────────────────────────
  const frutaPorLote = new Map<string, { eurKg: number | null; kg: number; eur: number; agricultor: string | null; finca: string | null; articulo: string | null; fechaEntrada: string | null }>();
  for (const e of entradas) {
    const lote8 = normalizarLoteCodigo(e.lote);
    if (!lote8) continue;
    const acc = frutaPorLote.get(lote8) ?? { eurKg: null, kg: 0, eur: 0, agricultor: e.agricultor, finca: e.finca, articulo: e.articulo, fechaEntrada: e.fecha };
    acc.kg += num(e.kg_entrada);
    acc.eur += num(e.importe_total);
    if (!acc.agricultor) acc.agricultor = e.agricultor;
    if (!acc.finca) acc.finca = e.finca;
    if (!acc.articulo) acc.articulo = e.articulo;
    if (!acc.fechaEntrada || e.fecha < acc.fechaEntrada) acc.fechaEntrada = e.fecha;
    frutaPorLote.set(lote8, acc);
  }
  for (const acc of frutaPorLote.values()) acc.eurKg = acc.eur > 0 && acc.kg > 0 ? acc.eur / acc.kg : null;

  // ─── Empaque dominante y fichas ────────────────────────────────────────────
  const empaquePorClave = new Map<string, { empaque: string; kg: number }>();
  for (const p of productoDia) {
    const clave = claveProducto(p.producto);
    const empaque = (p.formato_caja ?? "").trim();
    if (!clave || !empaque || /total/i.test(empaque)) continue;
    const acc = empaquePorClave.get(clave);
    if (!acc || num(p.kg) > acc.kg) empaquePorClave.set(clave, { empaque, kg: num(p.kg) });
  }
  const fichaPorClave = new Map(fichas.map((f) => [f.clave, f]));

  // ─── Asistencia (opcional pero muy recomendable) ───────────────────────────
  interface RegistroAsistencia { nombre: string; fecha: string; horas: number | null; entrada: string | null; salida: string | null }
  let registros: RegistroAsistencia[] = [];
  if (fs.existsSync(ASISTENCIAS)) {
    registros = JSON.parse(fs.readFileSync(ASISTENCIAS, "utf-8"));
  } else {
    avisos.push("Sin salida/asistencias.json: días sin personas. Exporta el fichero del reloj a scripts/informe-produccion/asistencias.xlsx y vuelve a generar.");
  }
  const fechasAsistencia = new Set(registros.map((r) => r.fecha));
  for (const f of TODOS_DIAS) {
    if (fuentePorDia.get(f) !== "sin_datos" && !fechasAsistencia.has(f)) {
      avisos.push(`${f}: hay producción pero NO hay datos del reloj de personas — kg/persona de ese día en blanco.`);
    }
  }

  const STOP = new Set(["DE", "DEL", "LA", "LOS", "LAS", "Y"]);
  const tokens = (s: string) => norm(s).split(" ").filter((t) => t && !STOP.has(t));
  const prefijoComun = (a: string, b: string) => { let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++; return i; };
  const casaToken = (t: string, otros: string[]) => otros.some((o) =>
    o === t || (t.length >= 4 && o.length >= 4 && (o.startsWith(t) || t.startsWith(o))) || prefijoComun(t, o) >= 6);
  const trabajadorPorNombreXlsx = new Map<string, typeof trabajadores[number] | null>();
  const nombresSinFicha: string[] = [];
  for (const nombreXlsx of new Set(registros.map((r) => r.nombre))) {
    const tx = tokens(nombreXlsx);
    const candidatos = trabajadores
      .map((t) => ({ t, tt: tokens(t.nombre) }))
      .filter(({ tt }) => tt.length > 0 && tt.every((tk) => casaToken(tk, tx)))
      .sort((a, b) => b.tt.length - a.tt.length);
    if (candidatos.length > 0 && (candidatos.length === 1 || candidatos[0].tt.length > candidatos[1].tt.length)) {
      trabajadorPorNombreXlsx.set(nombreXlsx, candidatos[0].t);
    } else if (candidatos.length > 1) {
      avisos.push(`Nombre ambiguo en el reloj: "${nombreXlsx}" casa con ${candidatos.map((c) => c.t.nombre).join(" / ")} — se usa ${candidatos[0].t.nombre}.`);
      trabajadorPorNombreXlsx.set(nombreXlsx, candidatos[0].t);
    } else {
      trabajadorPorNombreXlsx.set(nombreXlsx, null);
      nombresSinFicha.push(nombreXlsx);
    }
  }
  if (nombresSinFicha.length) avisos.push(`Sin ficha de trabajador (coste a media ${COSTE_HORA_MEDIO_DEFECTO} €/h, sin zona): ${nombresSinFicha.join("; ")}`);

  // ─── Composición por día (idéntica a la validada en la semana 33) ──────────
  const esPodrido = (clase: string | null, producto: string) =>
    (clase != null && (/^\(J\)/i.test(clase.trim()) || norm(clase) === "PODRIDO")) || norm(producto) === "PODRIDO";
  const claseDisplay = (clase: string | null) => {
    const s = String(clase ?? "").replace(/^\([A-Z0-9]+\)\s*/i, "").replace(/\s+/g, " ").trim();
    return s || "(sin clase)";
  };
  const tamanoDisplay = (t: string | null) => String(t ?? "").replace(/^\(\d+\)\s*/, "").trim() || "(sin tamaño)";

  const productosDia: Array<Record<string, unknown>> = [];
  const dias: Array<Record<string, unknown>> = [];
  const categoriasDia: Array<{ fecha: string; clase: string; kg: number }> = [];
  const calibresDia: Array<{ fecha: string; tamano: string; kg: number }> = [];
  const lotesDiaOut: Array<Record<string, unknown>> = [];

  for (const fecha of TODOS_DIAS) {
    const filasDia = filas.filter((f) => f.fecha === fecha);
    const kgDia = filasDia.reduce((s, f) => s + f.kg, 0);

    const regsDia = registros.filter((r) => r.fecha === fecha && (r.horas ?? 0) >= 1);
    let costePersonal = 0, horasReales = 0, presentes = 0, computables = 0, personasSinCoste = 0;
    const personasPorGrupo: Record<string, number> = { Envasadoras: 0, Industria: 0, Mallas: 0, Graneleras: 0 };
    const detallePersonas: Array<Record<string, unknown>> = [];
    for (const r of regsDia) {
      const t = trabajadorPorNombreXlsx.get(r.nombre) ?? null;
      const horas = r.horas ?? 0;
      presentes += 1; horasReales += horas;
      const costeHora = t?.coste_hora ?? null;
      costePersonal += horas * (costeHora ?? COSTE_HORA_MEDIO_DEFECTO);
      if (costeHora == null) personasSinCoste += 1;
      const computa = t ? cuentaTrabajadorKgPersona(t) : true;
      if (computa) computables += 1;
      const grupo = t ? grupoRendimientoTrabajador(t) : null;
      if (grupo) personasPorGrupo[grupo] += 1;
      detallePersonas.push({ fecha, nombre: t?.nombre ?? r.nombre, zona: t?.zona ?? "(sin ficha)", grupo, computa, horas, costeHora: costeHora ?? COSTE_HORA_MEDIO_DEFECTO, costeEur: horas * (costeHora ?? COSTE_HORA_MEDIO_DEFECTO), tipo: t ? tipoCosteTrabajador(t) : "sin_grupo", entrada: r.entrada, salida: r.salida, conFicha: !!t });
    }

    const parte = partePorFecha.get(fecha) ?? null;
    const kgMujeresClase = filasDia.filter((f) => norm(f.clase ?? "") === "MUJERES").reduce((s, f) => s + f.kg, 0);
    // el parte se autocorrige con retraso: si el calibrador ya suma más (lote
    // llegado tarde), manda el mayor — son la misma fuente con distinta frescura
    const prodParte = parte ? Math.max(num(parte.kg_produccion_calibrador), kgDia) : kgDia;
    const mujeres = parte ? Math.max(num(parte.kg_mujeres_calibrador), kgMujeresClase) : kgMujeresClase;
    const z1 = parte ? num(parte.kg_reciclado_malla_z1) : 0;
    const z2 = parte ? num(parte.kg_reciclado_malla_z2) : 0;
    const produccionReal = Math.max(0, prodParte - mujeres - z1 - z2);
    if (parte && kgDia > 0 && Math.abs(kgDia - prodParte) / Math.max(prodParte, 1) > 0.01) {
      avisos.push(`${fecha}: el calibrador (${Math.round(kgDia)} kg) y el parte (${Math.round(prodParte)} kg) difieren >1 %.`);
    }

    const porClase = new Map<string, number>();
    const porTamano = new Map<string, number>();
    for (const f of filasDia) {
      const c = esPodrido(f.clase, f.producto) ? "Podrido" : claseDisplay(f.clase);
      porClase.set(c, (porClase.get(c) ?? 0) + f.kg);
      const t = tamanoDisplay(f.tamano);
      porTamano.set(t, (porTamano.get(t) ?? 0) + f.kg);
    }
    for (const [clase, kg] of porClase) categoriasDia.push({ fecha, clase, kg });
    for (const [tamano, kg] of porTamano) calibresDia.push({ fecha, tamano, kg });

    interface Acc { nombre: string; kg: number; frutaEur: number; kgConFruta: number; kgSinFruta: number; kgPrecalibrado: number; kgMdnaSinFormato: number }
    const porProducto = new Map<string, Acc>();
    for (const f of filasDia) {
      const nombreCrudo = esPodrido(f.clase, f.producto) ? "PODRIDO" : f.producto;
      const clave = claveProducto(nombreCrudo);
      if (!clave) continue;
      let acc = porProducto.get(clave);
      if (!acc) { acc = { nombre: nombreCrudo, kg: 0, frutaEur: 0, kgConFruta: 0, kgSinFruta: 0, kgPrecalibrado: 0, kgMdnaSinFormato: 0 }; porProducto.set(clave, acc); }
      acc.kg += f.kg;
      const lote8 = normalizarLoteCodigo(f.lote);
      const eurKg = lote8 ? (frutaPorLote.get(lote8)?.eurKg ?? null) : null;
      if (eurKg != null) { acc.frutaEur += f.kg * eurKg; acc.kgConFruta += f.kg; }
      else { acc.kgSinFruta += f.kg; if (!lote8) acc.kgPrecalibrado += f.kg; }
      if (esMdnaSinFormato(f.producto) && !esPodrido(f.clase, f.producto)) acc.kgMdnaSinFormato += f.kg;
    }

    const confeccionDiaEur = costePersonal + SUMINISTROS_DIA_DEFECTO_EUR;
    let kgPonderadosDia = 0;
    const resueltos = [...porProducto.entries()].map(([clave, acc]) => {
      const empaque = empaquePorClave.get(clave)?.empaque ?? null;
      const ded = deducirProducto(acc.nombre, empaque);
      const destino = clasificarDestinoRentabilidad(acc.nombre, norm(acc.nombre) === "PODRIDO" ? "(J) Podrido" : null);
      const indice = INDICE_CONFECCION_SEMILLA[ded.zona];
      const kgPonderados = indice != null && indice > 0 ? acc.kg * indice : 0;
      kgPonderadosDia += kgPonderados;
      return { clave, acc, ded, destino, indice, kgPonderados, empaque };
    });

    let kgMdnaSinFormatoDia = 0;
    for (const r of resueltos) {
      const { acc } = r;
      kgMdnaSinFormatoDia += acc.kgMdnaSinFormato;
      const ficha = fichaPorClave.get(r.clave);
      let precio: number | null = null;
      let fuente = "";
      if (r.destino === "podrido" || r.destino === "muestra") { precio = 0; fuente = "sin valor"; }
      else if (r.destino.startsWith("mdna")) { precio = precios[r.destino as keyof typeof precios]; fuente = tarifa ? `tarifa Mercadona S${tarifa.semana}` : "SIN TARIFA"; }
      else if (ficha?.precio_venta_eur_kg != null) { precio = ficha.precio_venta_eur_kg; fuente = "ficha del producto"; }
      else { precio = precios[r.destino as keyof typeof precios] ?? null; fuente = `estándar ${DESTINO_LABEL[r.destino]}`; }
      productosDia.push({
        fecha, clave: r.clave, nombre: acc.nombre, empaque: r.empaque, zona: r.ded.zona, destino: r.destino,
        indice: r.indice, kg: acc.kg, kgPonderados: r.kgPonderados,
        frutaEur: acc.frutaEur, kgConFruta: acc.kgConFruta, kgSinFruta: acc.kgSinFruta, kgPrecalibrado: acc.kgPrecalibrado,
        precioEurKg: precio, precioFuente: fuente, ingresoEur: (precio ?? 0) * acc.kg,
        envaseEur: ENVASE_EUR_KG[r.destino] * acc.kg,
        confeccionEur: kgPonderadosDia > 0 ? confeccionDiaEur * (r.kgPonderados / kgPonderadosDia) : 0,
      });
    }
    if (kgMdnaSinFormatoDia > 0) avisos.push(`${fecha}: ${Math.round(kgMdnaSinFormatoDia)} kg MDNA sin formato reconocido (contados como girsac 4 kg).`);

    const porLote = new Map<string, { kg: number; podrido: number; industria: number }>();
    for (const f of filasDia) {
      const acc = porLote.get(f.lote) ?? { kg: 0, podrido: 0, industria: 0 };
      acc.kg += f.kg;
      if (esPodrido(f.clase, f.producto)) acc.podrido += f.kg;
      if (clasificarDestinoRentabilidad(f.producto, null) === "industria" && !esPodrido(f.clase, f.producto)) acc.industria += f.kg;
      porLote.set(f.lote, acc);
    }
    for (const [lote, acc] of porLote) {
      const lote8 = normalizarLoteCodigo(lote);
      const fruta = lote8 ? frutaPorLote.get(lote8) : undefined;
      lotesDiaOut.push({ fecha, lote, lote8, agricultor: fruta?.agricultor ?? null, finca: fruta?.finca ?? null, articulo: fruta?.articulo ?? null, fechaEntrada: fruta?.fechaEntrada ?? null, kg: acc.kg, pctPodrido: acc.kg > 0 ? acc.podrido / acc.kg : null, pctIndustria: acc.kg > 0 ? acc.industria / acc.kg : null, frutaEurKg: fruta?.eurKg ?? null });
    }

    const horasLinea = horasPorDia.get(fecha) ?? null;
    const pasadas = pasadasPorDia.get(fecha) ?? [];
    const kgConHoras = pasadas.filter((p) => p.horas != null).reduce((s, p) => s + p.kg, 0);
    const thEfectiva = horasLinea && horasLinea > 0 && kgConHoras > 0 ? kgConHoras / 1000 / horasLinea : null;
    const conTh = pasadas.filter((p) => p.th != null && (p.th as number) > 0 && p.kg > 0);
    const tTotal = conTh.reduce((s, p) => s + p.kg / 1000, 0);
    const horasTh = conTh.reduce((s, p) => s + p.kg / 1000 / (p.th as number), 0);
    const thMaquina = tTotal > 0 && horasTh > 0 ? tTotal / horasTh : null;

    dias.push({
      fecha, fuente: fuentePorDia.get(fecha), kgCalibrador: kgDia, prodParte, produccionReal, mujeres, z1, z2,
      podridoBolsa: parte ? num(parte.kg_podrido_bolsa_basura) : null,
      industriaManual: parte ? num(parte.kg_industria_manual) : null,
      paletsBrutos: parte ? num(parte.kg_palets_brutos) : null,
      origenParte: parte?.origen_calibrador ?? null,
      sinParte: !parte,
      presentes, computables, horasReales, costePersonalEur: costePersonal,
      suministrosEur: SUMINISTROS_DIA_DEFECTO_EUR, personasSinCoste,
      personasPorGrupo, nPasadas: pasadas.length, horasLinea, thEfectiva, thMaquina,
      kgPersona: computables > 0 ? produccionReal / computables : null,
      detallePersonas,
    });
  }

  const ventasErp = erpPalets
    .filter((p) => TODOS_DIAS.includes(p.fecha))
    .map((p) => ({
      fecha: p.fecha, articulo: p.articulo, cliente: p.cliente, kg: num(p.kg_netos),
      eur: p.importe_venta == null ? null : num(p.importe_venta),
      estado: p.num_albaran_venta == null ? "sin albarán" : (num(p.importe_venta) > 0 ? "valorado" : "albarán sin valorar"),
    }));

  const hoy = hoyMadrid();
  if (DIAS_ACTUAL.includes(hoy)) {
    avisos.push(`${hoy} es HOY: día provisional (el parte y los palets del ERP se completan mañana por la mañana).`);
  }

  fs.mkdirSync(SALIDA_DIR, { recursive: true });
  const salida = {
    generado: new Date().toISOString(),
    hasta: HASTA,
    semanaActual: DIAS_ACTUAL, semanaAnterior: DIAS_ANTERIOR,
    numSemanaActual: numSemanaIso(HASTA), numSemanaAnterior: numSemanaIso(lunesAnterior),
    tarifaMdna: tarifa ? { semana: tarifa.semana, anio: tarifa.anio, precios: tarifa.precios } : null,
    preciosMdna: { aplicados: precios },
    constantes: {
      envaseEurKg: ENVASE_EUR_KG, destinosOrden: DESTINOS_ORDEN, destinoLabel: DESTINO_LABEL,
      suministrosDia: SUMINISTROS_DIA_DEFECTO_EUR, costeHoraMedio: COSTE_HORA_MEDIO_DEFECTO,
      indices: INDICE_CONFECCION_SEMILLA, preciosDefecto: PRECIOS_RENTABILIDAD_DEFECTO,
    },
    dias, productosDia, categoriasDia, calibresDia, lotesDia: lotesDiaOut, ventasErp, avisos,
  };
  fs.writeFileSync(SALIDA, JSON.stringify(salida, null, 1), "utf-8");

  for (const d of dias) {
    console.log(`${d.fecha} [${d.fuente}]: ${Math.round(num(d.kgCalibrador))} kg (parte: ${d.sinParte ? "—" : Math.round(num(d.prodParte))}) · ${d.presentes} pers · t/h ${d.thEfectiva == null ? "-" : num(d.thEfectiva).toFixed(1)}`);
  }
  console.log(`Semana ${salida.numSemanaActual} hasta ${HASTA} · tarifa MDNA: S${tarifa?.semana ?? "—"} · avisos: ${avisos.length}`);
  for (const a of avisos) console.log(" - " + a);
  console.log(`OK → ${SALIDA}`);
}

main().catch((e) => { console.error("ERROR:", e instanceof Error ? e.message : e); process.exit(1); });

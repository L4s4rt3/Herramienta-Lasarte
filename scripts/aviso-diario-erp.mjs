/**
 * Aviso diario: que paso AYER, y deja el parte listo para rellenar a mano.
 *
 * POR QUE DEL DIA ANTERIOR. La tarea corre a las 7:10, asi que ayer ya esta
 * cerrado: los numeros no se mueven mientras lo lees.
 *
 * QUE HACE, EN ORDEN
 *   1. Crea (o completa) el parte diario del dia anterior con los campos
 *      automaticos — validado al kilo contra 5 partes ya cerrados.
 *   2. Recoge produccion, ventas, productores, trazabilidad e incidencias.
 *   3. Manda el correo. Si no llega, ESA es la alarma: la tarea no corrio.
 *
 * El texto vive en lib-aviso-diario.mjs (puro, con tests).
 */
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { componerAviso, comoFecha } from "./lib-aviso-diario.mjs";
import { repasarPartes, datosCalibradorDelDia, traerTodo } from "./crear-parte-diario.mjs";
import { analizarPartesPendientes } from "./analizar-partes-pendientes.mjs";
import { conectarErp } from "./lib-palets-erp.mjs";
import { generarYSubir } from "./generar-gstock-erp.mjs";
import { detectarCierre, inventarioSinAlta } from "./lib-cierre-alta.mjs";

try { process.loadEnvFile(path.resolve(".env")); } catch { /* entorno */ }

const IP_ESPERADA = process.env.IP_RECEPTOR ?? "192.168.1.237";
const DESTINO = process.env.AVISO_DESTINO ?? "soporte@lasartesat.es";
const REMITENTE = process.env.RESEND_FROM_TECNICO ?? "calibrador@comunicaciones.lasartesat.com";
const LOG = path.resolve("outputs/log-tarea-diaria.txt");
const sinTildes = (s) => (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();

function ipLocal() {
  for (const [, dirs] of Object.entries(os.networkInterfaces())) {
    for (const d of dirs ?? []) {
      if (d.family === "IPv4" && !d.internal && d.address.startsWith("192.168.")) return d.address;
    }
  }
  return null;
}

/** ¿Escucha el receptor? Si no, los informes del Sizer se pierden. */
function receptorVivo(puerto = 25, ms = 2000) {
  return new Promise((resolve) => {
    const s = net.createConnection({ host: "127.0.0.1", port: puerto });
    const fin = (v) => { s.destroy(); resolve(v); };
    s.setTimeout(ms);
    s.once("connect", () => fin(true));
    s.once("error", () => fin(false));
    s.once("timeout", () => fin(false));
  });
}

const colaDelLog = (n = 15) => {
  try { return fs.readFileSync(LOG, "utf8").trimEnd().split(/\r?\n/).slice(-n); } catch { return []; }
};

/**
 * Cada fuente de datos, cada cuánto DEBERÍA llegar, y cuánto puede tardar antes
 * de que sea raro. Sin esto, una fuente que deja de alimentarse no se nota:
 * la herramienta sigue enseñando el último dato como si fuera de hoy, y el
 * descubrimiento llega semanas después. Los umbrales son generosos a propósito
 * — la idea es cazar el abandono, no dar la lata por un día de retraso.
 */
const FUENTES = [
  { tabla: "entradas_bascula", campo: "fecha", que: "Entradas de fruta", dias: 7 },
  { tabla: "calibrador_batch", campo: "inicio", que: "Pasadas del calibrador", dias: 5 },
  { tabla: "erp_palet", campo: "fecha", que: "Palets del ERP", dias: 5 },
  { tabla: "calidad_lotes", campo: "fecha", que: "Informes de calidad", dias: 14 },
  { tabla: "limpieza_partes", campo: "fecha", que: "Partes de limpieza de box", dias: 21 },
  { tabla: "consumos_fisicos", campo: "fecha_fin", que: "Consumos (agua, luz, gasoil)", dias: 45 },
  { tabla: "ventas_categoria_lineas", campo: "fecha", que: "Ventas por categoria", dias: 45 },
  { tabla: "camara_externa_camiones", campo: "fecha_almacenamiento", que: "Registro de camaras externas", dias: 60 },
];

/**
 * Qué llegó ayer al buzón de correo y qué pasó con ello. Sin esto, un Excel que
 * el buzón deja esperando porque necesita confirmación se quedaría ahí para
 * siempre y nadie lo sabría — que es justo el problema que el buzón venía a
 * resolver.
 */
function buzonDelDia(fecha) {
  const registro = path.resolve("outputs/calibrador/registro.jsonl");
  let lineas;
  try { lineas = fs.readFileSync(registro, "utf8").trimEnd().split(/\r?\n/); } catch { return null; }

  const importados = [];
  const esperando = [];
  const noReconocidos = [];
  for (const l of lineas) {
    let ev;
    try { ev = JSON.parse(l); } catch { continue; }
    if (!String(ev.recibido ?? "").startsWith(fecha)) continue;
    for (const a of ev.adjuntos ?? []) {
      const b = a.buzon;
      if (!b) continue;
      const item = { fichero: path.basename(a.fichero), etiqueta: b.etiqueta, detalle: b.detalle };
      if (b.estado === "importado") importados.push(item);
      else if (b.estado === "esperando") esperando.push(item);
      else noReconocidos.push(item);
    }
  }
  if (!importados.length && !esperando.length && !noReconocidos.length) return null;
  return { importados, esperando, noReconocidos };
}

/**
 * A qué hora se cerró el alta y cuánto quedó sin dar de alta, deducido de las
 * fotos horarias del ERP (ver lib-cierre-alta.mjs).
 *
 * TODAVÍA NO SE ESCRIBE EN EL PARTE. El número se enseña al lado del que apuntan
 * a mano para poder compararlos unos días; hasta que no coincidan, el bueno
 * sigue siendo el suyo. Mismo criterio que se siguió con la producción y las
 * mujeres, que se validaron contra 5 partes antes de darlas por buenas.
 */
async function cierreEInventario(supabase, dia) {
  const { data, error } = await supabase.from("erp_palets_foto")
    .select("tomada_a, kg_netos, palets").eq("dia", dia).order("tomada_a");
  if (error || !data?.length) return null;
  const cierre = detectarCierre(data);
  const inventario = inventarioSinAlta(dia, data);
  return { fotos: data.length, cierre, inventario };
}

/** El último dato de cada fuente y cuántos días hace de él. */
async function frescuraDeDatos(supabase, hoy) {
  const out = [];
  for (const f of FUENTES) {
    const { data, error } = await supabase.from(f.tabla)
      .select(f.campo).order(f.campo, { ascending: false }).limit(1);
    if (error) continue;                       // tabla que ya no existe: no es asunto del aviso
    const valor = data?.[0]?.[f.campo];
    if (!valor) { out.push({ ...f, ultimo: null, retraso: null }); continue; }
    const ultimo = String(valor).slice(0, 10);
    const retraso = Math.floor((Date.parse(`${hoy}T00:00:00`) - Date.parse(`${ultimo}T00:00:00`)) / 86400000);
    out.push({ ...f, ultimo, retraso });
  }
  return out;
}

async function main() {
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Faltan SUPABASE_URL y/o SUPABASE_SERVICE_ROLE_KEY.");
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  const hoy = new Date();
  const ayer = comoFecha(new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() - 1));

  // 1. Los partes, antes de contar nada: asi el correo puede decir como quedaron.
  //    Se repasa una semana para tapar los dias en que la tarea no llego a correr.
  let parte = null;
  const incidencias = [];
  try {
    const repaso = await repasarPartes(supabase, ayer, { dias: 7, aplicar: true });
    parte = { ...repaso.ultimo, recuperados: repaso.recuperados, erpCaido: repaso.erpCaido };
    for (const e of repaso.errores) {
      if (e.fecha !== ayer) incidencias.push(`ERROR: parte del ${e.fecha}: ${e.motivo}`);
    }
  } catch (e) {
    parte = { accion: "error", motivo: e.message };
  }

  // El GSTOCK (consulta de palets) se genera del ERP y se sube al parte, para
  // que la app lo lea con su logica de siempre en vez de escribirle los kilos
  // por detras. Ver generar-gstock-erp.mjs.
  let gstock = null;
  try {
    const conn = await conectarErp();
    try {
      gstock = await generarYSubir(supabase, conn, ayer, { aplicar: true });
    } finally {
      await conn.end().catch(() => {});
    }
    for (const s of gstock.sospechosos ?? []) {
      incidencias.push(`ERROR: el palet ${s.palet} del GSTOCK tiene ${Math.round(s.kg).toLocaleString("es")} kg` +
        ` ("${s.producto}")${s.desmontado ? ", y es un DESMONTADO (industria o precalibrado)" : ""}.` +
        " Un palet fisico no llega a eso: se apunto despues con la fecha del lote, asi que ese dia" +
        " sale con mas palets de los que se hicieron.");
    }
  } catch (e) {
    incidencias.push(`ERROR: no se pudo generar el GSTOCK del dia: ${e.message}`);
  }

  // Y se analizan los que tengan sus informes subidos y nadie haya analizado:
  // los archivos ahi dentro sin extraer no le sirven a nadie.
  let analizados = [];
  try {
    const desde = comoFecha(new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() - 14));
    analizados = await analizarPartesPendientes(supabase, { url, key, desde, aplicar: true });
    for (const a of analizados) {
      if (a.accion === "error") incidencias.push(`ERROR: analizar el parte del ${a.fecha}: ${a.motivo}`);
    }
  } catch (e) {
    incidencias.push(`ERROR: no se pudieron analizar los partes pendientes: ${e.message}`);
  }

  // 2. Entradas y palets de ayer.
  const [entRes, palRes] = await Promise.all([
    supabase.from("entradas_bascula").select("kg_entrada, agricultor, origen").eq("fecha", ayer),
    supabase.from("erp_palet").select("kg_netos, importe_venta, lote_confeccion, cliente").eq("fecha", ayer),
  ]);
  if (entRes.error) throw new Error(`entradas: ${entRes.error.message}`);
  if (palRes.error) throw new Error(`palets: ${palRes.error.message}`);

  const entFilas = (entRes.data ?? []).filter((e) => e.origen !== "stock_inicial");
  const entradas = {
    n: entFilas.length,
    kg: entFilas.reduce((s, e) => s + (Number(e.kg_entrada) || 0), 0),
    precalibrado: entFilas.filter((e) => /precalibrado/i.test(e.agricultor ?? "")).length,
  };

  const palFilas = palRes.data ?? [];
  const porCliente = new Map();
  for (const p of palFilas) {
    const c = p.cliente ?? "(sin vender)";
    porCliente.set(c, (porCliente.get(c) ?? 0) + (Number(p.kg_netos) || 0));
  }
  // Los KILOS salen del ERP en directo (el mismo número que va al parte), no de
  // `erp_palet`: esa tabla filtra `num_cajas > 0` y ademas va por detras hasta
  // que corre su sincronizador, y dos cifras distintas de "palets" en el mismo
  // correo no se pueden defender. De `erp_palet` se usa lo que solo ella tiene:
  // el importe y el cliente.
  const facturados = palFilas.filter((p) => Number(p.importe_venta) > 0);
  const palets = {
    n: parte?.paletsErp?.palets ?? palFilas.length,
    kg: parte?.paletsErp?.netos ?? palFilas.reduce((s, p) => s + (Number(p.kg_netos) || 0), 0),
    euros: facturados.reduce((s, p) => s + (Number(p.importe_venta) || 0), 0),
    // El precio medio se divide SOLO entre los kilos que llevan importe: con los
    // kilos totales saldria un precio falsamente barato el dia que falte facturar.
    kgFacturados: facturados.reduce((s, p) => s + (Number(p.kg_netos) || 0), 0),
    clientes: [...porCliente.entries()].filter(([c]) => c !== "(sin vender)")
      .map(([cliente, kg]) => ({ cliente, kg })).sort((a, b) => b.kg - a.kg),
  };

  // 3. Calibrador del dia: totales, destino y productores.
  const cal = await datosCalibradorDelDia(supabase, ayer);
  let calibrador = null;
  let productores = null;
  if (cal.pasadas > 0) {
    const { data: batches } = await supabase.from("calibrador_batch")
      .select("batch_id, lote").gte("inicio", `${ayer}T00:00:00`).lte("inicio", `${ayer}T23:59:59`);
    const ids = (batches ?? []).map((b) => b.batch_id);
    const loteDe = new Map((batches ?? []).map((b) => [b.batch_id, b.lote]));
    // Paginado y con orden por la clave primaria entera: un dia normal pasa de
    // 1.000 filas y PostgREST recorta en silencio (ver traerTodo).
    const filas = [];
    for (let i = 0; i < ids.length; i += 100) {
      const trozo = ids.slice(i, i + 100);
      filas.push(...await traerTodo(() => supabase.from("calibrador_clasificacion")
        .select("batch_id, peso_kg, grupo_destino").in("batch_id", trozo)
        .order("batch_id").order("producto").order("calidad").order("clase").order("tamano")));
    }
    const grupo = (f) => sinTildes(f.grupo_destino);
    calibrador = {
      pasadas: cal.pasadas,
      kgTotal: cal.kgTotal,
      kgMujeres: cal.kgMujeres,
      kgExportacion: filas.filter((f) => grupo(f) === "EXPORTACION").reduce((s, f) => s + Number(f.peso_kg), 0),
      kgIndustria: filas.filter((f) => grupo(f) === "NO COMERCIAL" || grupo(f).includes("INDUSTRIA"))
        .reduce((s, f) => s + Number(f.peso_kg), 0),
    };

    // Productores: por lote contra entradas_bascula (nunca por nombre).
    const lotes = [...new Set([...loteDe.values()].filter((l) => /^\d{8}$/.test(l)))];
    const dueno = new Map();
    for (let i = 0; i < lotes.length; i += 200) {
      const { data } = await supabase.from("entradas_bascula")
        .select("lote, agricultor").in("lote", lotes.slice(i, i + 200));
      for (const e of data ?? []) dueno.set(e.lote, e.agricultor);
    }
    const porProd = new Map();
    for (const f of filas) {
      const nombre = dueno.get(loteDe.get(f.batch_id)) ?? "(sin productor)";
      const acc = porProd.get(nombre) ?? { kg: 0, exp: 0 };
      acc.kg += Number(f.peso_kg) || 0;
      if (grupo(f) === "EXPORTACION") acc.exp += Number(f.peso_kg) || 0;
      porProd.set(nombre, acc);
    }
    productores = [...porProd.entries()]
      .map(([productor, a]) => ({ productor, kg: a.kg, pctExportacion: a.kg > 0 ? 100 * a.exp / a.kg : 0 }))
      .sort((a, b) => b.kg - a.kg);

    // ¿Cuanto hace del ultimo export SQL? Si se queda viejo, el parte saldra corto.
    const { data: ultimo } = await supabase.from("calibrador_batch")
      .select("inicio").order("inicio", { ascending: false }).limit(1);
    if (ultimo?.[0]?.inicio) {
      const dias = Math.floor((Date.parse(`${ayer}T23:59:59`) - Date.parse(ultimo[0].inicio)) / 86400000);
      if (dias > 1) calibrador.desfaseExport = dias;
    }
  }

  // 4. Trazabilidad y correcciones.
  const lotesDia = [...new Set(palFilas.map((p) => p.lote_confeccion).filter(Boolean))];
  const cobertura = { lotes: lotesDia.length, conOrigen: 0 };
  let origenesDia = [];
  if (lotesDia.length) {
    const { data } = await supabase.from("erp_confeccion_origen")
      .select("lote_confeccion, lote_entrada").in("lote_confeccion", lotesDia);
    origenesDia = data ?? [];
    cobertura.conOrigen = new Set(origenesDia.map((r) => r.lote_confeccion)).size;
  }

  const yymmdd = ayer.slice(2, 4) + ayer.slice(5, 7) + ayer.slice(8, 10);
  const confAyer = new Set(lotesDia.filter((l) => /^\d{8}$/.test(l) && l.slice(2) === yymmdd));
  const { data: infData } = await supabase.from("calibrador_informe").select("lote").eq("fecha", ayer);
  const lotesInformes = [...new Set((infData ?? []).map((r) => r.lote))].sort();
  const esperados = [...new Set(origenesDia.filter((o) => confAyer.has(o.lote_confeccion)).map((o) => o.lote_entrada))];
  const informesCalibrador = {
    n: lotesInformes.length, lotes: lotesInformes, lotesConfeccion: confAyer.size,
    faltan: esperados.filter((l) => !lotesInformes.includes(l)).sort(),
  };

  let correcciones = null;
  try {
    const csv = path.resolve("outputs", `correcciones-entradas-erp-${comoFecha(hoy)}.csv`);
    correcciones = fs.existsSync(csv) ? fs.readFileSync(csv, "utf8").trimEnd().split(/\r?\n/).length - 1 : 0;
  } catch { /* null = no se pudo comprobar */ }

  const { cuerpo, hayProblema } = componerAviso({
    fecha: ayer, entradas, palets, cobertura, correcciones, informesCalibrador,
    calibrador, parte, productores, ip: ipLocal(), log: [...colaDelLog(), ...incidencias],
    frescura: await frescuraDeDatos(supabase, comoFecha(hoy)),
    buzon: buzonDelDia(ayer),
    analizados: analizados.filter((a) => a.accion === "analizado"),
    alta: await cierreEInventario(supabase, ayer),
    receptor: await receptorVivo(), ipEsperada: IP_ESPERADA,
  });
  const asunto = `${hayProblema ? "[REVISAR] " : ""}Lasarte · resumen del ${ayer}`;

  fs.mkdirSync(path.resolve("outputs"), { recursive: true });
  fs.writeFileSync(path.resolve("outputs/aviso-diario.txt"), `${asunto}\n\n${cuerpo}\n`, "utf8");
  console.log(`${asunto}\n\n${cuerpo}`);

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) { console.log("\n(sin RESEND_API_KEY: queda en outputs/aviso-diario.txt)"); return; }
  if (process.argv.includes("--sin-enviar")) { console.log("\n(--sin-enviar)"); return; }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: REMITENTE, to: [DESTINO], subject: asunto, text: cuerpo }),
  });
  if (!res.ok) throw new Error(`Resend HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  console.log(`\nAviso enviado a ${DESTINO}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
}

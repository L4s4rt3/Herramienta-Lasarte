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
import { componerAviso, comoFecha, informesSinSubir, mezclarSerie } from "./lib-aviso-diario.mjs";
import { renderAvisoHtml } from "./lib-aviso-html.mjs";
import { repasarPartes, datosCalibradorDelDia, traerTodo } from "./crear-parte-diario.mjs";
import { analizarPartesPendientes } from "./analizar-partes-pendientes.mjs";
import { conectarErp } from "./lib-palets-erp.mjs";
import { generarYSubir } from "./generar-gstock-erp.mjs";
import { generarYSubirInformes } from "./generar-informes-parte.mjs";
import { codigoBaseLote } from "./lib-lotes.mjs";
import { cuadrar } from "./rehacer-parte.mjs";
import { estimarPartesPendientes } from "./estimar-manuales-parte.mjs";
import { detectarCierre, inventarioSinAlta, diaLocal } from "./lib-cierre-alta.mjs";
import { anotarEjecucion, salirConError } from "./lib-registro-ejecuciones.mjs";

try { process.loadEnvFile(path.resolve(".env")); } catch { /* entorno */ }

const IP_ESPERADA = process.env.IP_RECEPTOR ?? "192.168.1.237";
const DESTINO = process.env.AVISO_DESTINO ?? "soporte@lasartesat.es";
const REMITENTE = process.env.RESEND_FROM_TECNICO ?? "calibrador@comunicaciones.lasartesat.com";
const LOG = path.resolve("outputs/log-tarea-diaria.txt");
/**
 * Kilos de palets que tiene que aportar el ERP para que merezca la pena rehacer
 * el GSTOCK de un parte que sigue en Borrador. Por debajo de esto no compensa:
 * son los cuatro palets que siempre entran tarde, y en un dia de 70.000 kg
 * mueven el descuadre menos de un punto.
 */
const REFRESCAR_GSTOCK_KG = 500;
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

/** Los `dias` dias que acaban en `hasta`, del mas reciente al mas antiguo. */
const ventanaDias = (hasta, dias) => {
  const fin = new Date(`${hasta}T12:00:00`);
  return Array.from({ length: dias }, (_, i) =>
    comoFecha(new Date(fin.getFullYear(), fin.getMonth(), fin.getDate() - i)));
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
  // El calibrador tiene DOS vias y cualquiera vale: el volcado SQL (a mano) y
  // los informes DOCX de lote que el Sizer manda solos. Mirar solo el volcado
  // hacia decir "nada desde el 11-08" cada mañana con los DOCX entrando a
  // diario y sus partes analizados (visto el 19-08): el dia contaba como sin
  // analizar solo por ser docx. La pregunta de esta lista es "¿sigue entrando
  // el dato?", no "¿por que via?".
  { tablas: [
    { tabla: "calibrador_batch", campo: "inicio" },
    { tabla: "calibrador_informe", campo: "fecha" },
  ], que: "Datos del calibrador (volcado o informes de lote)", dias: 5 },
  // El volcado en si se vigila aparte y con manga ancha: es manual, y si se
  // abandona semanas los dias con varias pasadas (2,9%) se quedan cortos.
  { tabla: "calibrador_batch", campo: "inicio", que: "Volcado SQL del calibrador (export-sizer.ps1 a mano)", dias: 21 },
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
 * Informes que el receptor guardó en disco y que no están en la base.
 *
 * El registro dice si la subida falló, pero NO se usa como verdad: lo que manda
 * es si la pasada está hoy en `calibrador_informe`. Así, en cuanto se reintenta,
 * el aviso desaparece solo. Ver informesSinSubir en lib-aviso-diario.mjs.
 */
async function calibradorSinSubir(supabase) {
  const registro = path.resolve("outputs/calibrador/registro.jsonl");
  let lineas;
  try { lineas = fs.readFileSync(registro, "utf8").trimEnd().split(/\r?\n/); } catch { return null; }

  const entradas = [];
  for (const l of lineas) {
    let ev;
    try { ev = JSON.parse(l); } catch { continue; }
    for (const a of ev.adjuntos ?? []) {
      if (!a.informe?.lote || a.subida?.subido !== false) continue;
      entradas.push({
        recibido: ev.recibido, lote: a.informe.lote,
        comienzo: a.informe.comienzo ?? null, motivo: a.subida.motivo,
      });
    }
  }
  if (!entradas.length) return [];

  // Solo los lotes implicados: son un puñado y evita traerse la tabla entera.
  const lotes = [...new Set(entradas.map((e) => e.lote))];
  const filas = [];
  for (let i = 0; i < lotes.length; i += 100) {
    const { data } = await supabase.from("calibrador_informe")
      .select("lote, comienzo").in("lote", lotes.slice(i, i + 100));
    filas.push(...(data ?? []));
  }
  return informesSinSubir(
    entradas,
    new Set(filas.map((f) => `${f.lote}|${f.comienzo}`)),
    new Set(filas.map((f) => f.lote)),
  );
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
  // La hora de cierre se busca SOLO entre las fotos del propio dia: las de la
  // mañana siguiente son siempre las mas altas (ya esta todo dado de alta) y
  // harian creer que el dia se cerro a las 07:00.
  const delDia = data.filter((f) => diaLocal(f.tomada_a) <= dia);
  const cierre = detectarCierre(delDia);
  const inventario = inventarioSinAlta(dia, data);
  return { fotos: data.length, fotosDelDia: delDia.length, cierre, inventario };
}

/**
 * El día visto por el PARTE, para cuando no hay volcado del calibrador. Los
 * kilos y el destino salen de `producto_dia`, que es lo que escriben los
 * informes DOCX al analizarse.
 *
 * SOLO LAS FILAS CON DESTINO. Los partes viejos traen `grupo_destino` en blanco
 * y darlos por buenos pintaría un día entero al 0% de exportación; esos días
 * tienen su volcado, que es quien manda (ver mezclarSerie). Y nunca la fila
 * TOTAL (producto null), que es el total del día y contaría los kilos dos veces.
 *
 * Las pasadas se cuentan por los informes que llegaron ese día: cuando no hay
 * volcado, son lo único que sabe cuántas fueron.
 */
async function diasDelParte(supabase, desde, hasta) {
  const { data: partes } = await supabase.from("partes_diarios")
    .select("id, date").gte("date", desde).lte("date", hasta);
  if (!partes?.length) return [];
  const fechaDe = new Map(partes.map((p) => [p.id, p.date]));
  const [filas, informes] = await Promise.all([
    traerTodo(() => supabase.from("producto_dia")
      .select("part_id, kg, grupo_destino").in("part_id", [...fechaDe.keys()])
      .not("producto", "is", null).not("grupo_destino", "is", null).order("id")),
    supabase.from("calibrador_informe").select("fecha, lote")
      .gte("fecha", desde).lte("fecha", hasta),
  ]);
  const lotesPorDia = new Map();
  for (const i of informes.data ?? []) {
    if (!lotesPorDia.has(i.fecha)) lotesPorDia.set(i.fecha, new Set());
    lotesPorDia.get(i.fecha).add(i.lote);
  }
  const porDia = new Map();
  for (const fila of filas) {
    const fecha = fechaDe.get(fila.part_id);
    if (!fecha) continue;
    const acc = porDia.get(fecha) ?? { fecha, kg: 0, exportacion: 0, mujeres: 0, pasadas: 0 };
    const kg = Number(fila.kg) || 0;
    acc.kg += kg;
    const g = sinTildes(fila.grupo_destino);
    if (g === "EXPORTACION") acc.exportacion += kg;
    if (g === "MUJERES") acc.mujeres += kg;
    porDia.set(fecha, acc);
  }
  for (const [fecha, acc] of porDia) acc.pasadas = lotesPorDia.get(fecha)?.size ?? 0;
  return [...porDia.values()];
}

/**
 * Los últimos días de producción, para poder decir si el de ayer fue bueno o
 * malo. Un número suelto ("78.689 kg") no dice nada; el mismo número al lado de
 * la media de la semana sí.
 *
 * El % de exportación es el que más se mueve —del 48% al 73% en dos semanas— y
 * es lo que de verdad marca si la fruta salió bien.
 */
async function contextoSemana(supabase, hasta, dias = 14) {
  const desde = comoFecha(new Date(
    new Date(`${hasta}T12:00:00`).getFullYear(),
    new Date(`${hasta}T12:00:00`).getMonth(),
    new Date(`${hasta}T12:00:00`).getDate() - dias,
  ));

  const { data: batches, error } = await supabase.from("calibrador_batch")
    .select("batch_id, inicio").gte("inicio", `${desde}T00:00:00`).lte("inicio", `${hasta}T23:59:59`);
  // CERO PASADAS YA NO ES EL FINAL: desde el 12-08-2026 hay días que solo
  // existen en los informes DOCX, y antes eso dejaba la gráfica entera fuera.
  if (error) return null;

  const diaDe = new Map((batches ?? []).map((b) => [b.batch_id, String(b.inicio).slice(0, 10)]));
  const ids = (batches ?? []).map((b) => b.batch_id);
  const filas = [];
  for (let i = 0; i < ids.length; i += 100) {
    const trozo = ids.slice(i, i + 100);
    filas.push(...await traerTodo(() => supabase.from("calibrador_clasificacion")
      .select("batch_id, peso_kg, grupo_destino").in("batch_id", trozo)
      .order("batch_id").order("producto").order("calidad").order("clase").order("tamano")));
  }

  const porDia = new Map();
  for (const f of filas) {
    const d = diaDe.get(f.batch_id);
    if (!d) continue;
    const acc = porDia.get(d) ?? { fecha: d, kg: 0, exportacion: 0, mujeres: 0, pasadas: new Set() };
    const kg = Number(f.peso_kg) || 0;
    acc.kg += kg;
    const g = sinTildes(f.grupo_destino);
    if (g === "EXPORTACION") acc.exportacion += kg;
    if (g === "MUJERES") acc.mujeres += kg;
    acc.pasadas.add(f.batch_id);
    porDia.set(d, acc);
  }

  // Las pasadas mandan; los días que no las tienen los pone el parte.
  const serie = mezclarSerie(
    [...porDia.values()].map((d) => ({ ...d, pasadas: d.pasadas.size })),
    await diasDelParte(supabase, desde, hasta),
  );
  if (serie.length === 0) return null;

  // La media EXCLUYE el día del que se informa: comparar un día consigo mismo
  // dentro de la media lo acerca artificialmente a ella.
  const previos = serie.filter((d) => d.fecha < hasta);
  const media = previos.length === 0 ? null : {
    dias: previos.length,
    kg: previos.reduce((s, d) => s + d.kg, 0) / previos.length,
    mujeres: previos.reduce((s, d) => s + d.mujeres, 0) / previos.length,
    pctExp: 100 * previos.reduce((s, d) => s + d.exportacion, 0) / previos.reduce((s, d) => s + d.kg, 0),
  };
  return { serie: serie.slice(-8), media, hoy: serie.find((d) => d.fecha === hasta) ?? null };
}

/**
 * El último dato de cada fuente y cuántos días hace de él. Una fuente puede
 * tener varias tablas (`tablas`): vale la MÁS RECIENTE de todas, porque lo que
 * se vigila es que el dato siga entrando, por la vía que sea.
 */
async function frescuraDeDatos(supabase, hoy) {
  const out = [];
  for (const f of FUENTES) {
    const patas = f.tablas ?? [{ tabla: f.tabla, campo: f.campo }];
    let ultimo = null;
    let legible = false;
    for (const p of patas) {
      const { data, error } = await supabase.from(p.tabla)
        .select(p.campo).order(p.campo, { ascending: false }).limit(1);
      if (error) continue;                     // tabla que ya no existe: no es asunto del aviso
      legible = true;
      const valor = data?.[0]?.[p.campo];
      if (!valor) continue;
      const fecha = String(valor).slice(0, 10);
      if (!ultimo || fecha > ultimo) ultimo = fecha;
    }
    if (!legible) continue;
    if (!ultimo) { out.push({ ...f, ultimo: null, retraso: null }); continue; }
    const retraso = Math.floor((Date.parse(`${hoy}T00:00:00`) - Date.parse(`${ultimo}T00:00:00`)) / 86400000);
    out.push({ ...f, ultimo, retraso });
  }
  return out;
}

async function main() {
  const inicioEjecucion = new Date().toISOString();
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Faltan SUPABASE_URL y/o SUPABASE_SERVICE_ROLE_KEY.");
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  const hoy = new Date();
  // --fecha= sirve para rehacer el informe de un dia concreto (p. ej. cuando el
  // volcado del calibrador llega tarde y el correo salio sin produccion).
  const ayer = process.argv.find((a) => a.startsWith("--fecha="))?.split("=")[1]
    ?? comoFecha(new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() - 1));

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
  //
  // Se repasa la MISMA ventana que los partes, no solo ayer: un parte recuperado
  // de hace dias (porque la tarea no corrio, o porque sus informes llegaron
  // tarde) nace sin GSTOCK, y sin GSTOCK no hay palets ni analisis — se quedaria
  // esperando para siempre a un dia que ya paso. generarYSubir no repite trabajo:
  // devuelve "ya-tenia" si el parte ya tiene uno y "sin-parte" si no hay parte.
  //
  // Y SE REHACE EL DE LOS DIAS QUE SE QUEDARON CORTOS. El Excel se genera a las
  // 07:10 del dia siguiente, y a esa hora todavia no han terminado de dar de
  // alta: medido el 14-08-2026, 31 de 55 partes tenian menos palets de los que
  // el ERP dice hoy — el 11-08 le faltaban 11.662 kg y su descuadre era del 22%.
  // Mientras el parte siga en Borrador se rehace solo. Ver generarYSubir: solo
  // toca lo que genero el mismo, solo si el ERP tiene MAS, y nunca un parte
  // cerrado ni un archivo que subiera una persona.
  let gstock = null;
  const gstockRecuperados = [];
  const gstockRehechos = [];
  try {
    const conn = await conectarErp();
    try {
      for (const f of ventanaDias(ayer, 7)) {
        const r = await generarYSubir(supabase, conn, f, { aplicar: true, refrescarSiFaltanKg: REFRESCAR_GSTOCK_KG });
        if (f === ayer) gstock = r;
        else if (r.accion === "subido") gstockRecuperados.push(r);
        if (r.accion === "rehecho") gstockRehechos.push(r);
      }
    } finally {
      await conn.end().catch(() => {});
    }
    for (const s of [...(gstock?.sospechosos ?? []), ...gstockRecuperados.flatMap((r) => r.sospechosos ?? [])]) {
      incidencias.push(`ERROR: el palet ${s.palet} del GSTOCK tiene ${Math.round(s.kg).toLocaleString("es")} kg` +
        ` ("${s.producto}")${s.desmontado ? ", y es un DESMONTADO (industria o precalibrado)" : ""}.` +
        " Un palet fisico no llega a eso: se apunto despues con la fecha del lote, asi que ese dia" +
        " sale con mas palets de los que se hicieron.");
    }
  } catch (e) {
    incidencias.push(`ERROR: no se pudo generar el GSTOCK del dia: ${e.message}`);
  }

  // Y los informes del calibrador que subia la persona (TAMAÑOS/CLASE Y CALIDAD,
  // PRODUCTO y PRODUCCION). Del Sizer solo llega el .docx por lote y
  // `analizar-parte` lee con XLSX: sin estos, el parte se queda sin desglose por
  // calibre ni por destino, que es justo lo que el analisis venia avisando.
  // Mismo criterio que el GSTOCK: se fabrica el fichero, no se escriben los
  // kilos por detras. Ver generar-informes-parte.mjs.
  const informesSubidos = [];
  for (const f of ventanaDias(ayer, 7)) {
    try {
      const r = await generarYSubirInformes(supabase, f, { aplicar: true });
      if (r.accion === "subido" || r.accion === "rehecho") informesSubidos.push(f);
    } catch (e) {
      incidencias.push(`ERROR: informes del calibrador del ${f}: ${e.message}`);
    }
  }

  // Y se analizan los que tengan sus informes subidos y nadie haya analizado:
  // los archivos ahi dentro sin extraer no le sirven a nadie.
  let analizados = [];
  try {
    const desde = comoFecha(new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() - 14));
    // Los rehechos van FORZADOS: su GSTOCK es otro, pero el parte no cumple
    // ninguna de las dos condiciones normales (ya esta analizado y sus palets no
    // estan a cero), asi que sin esto el archivo nuevo se quedaria sin leer.
    analizados = await analizarPartesPendientes(supabase, {
      url, key, desde, aplicar: true, forzar: [...new Set([...gstockRehechos.map((r) => r.fecha), ...informesSubidos])],
    });
    for (const a of analizados) {
      if (a.accion === "error") incidencias.push(`ERROR: analizar el parte del ${a.fecha}: ${a.motivo}`);
    }
  } catch (e) {
    incidencias.push(`ERROR: no se pudieron analizar los partes pendientes: ${e.message}`);
  }

  // Los manuales que nadie metio se ESTIMAN segun historico (encargo del 17-08:
  // "si no hay informacion de la que yo pongo manual, se estima"), con un dia
  // entero de gracia y todo marcado en campos_estimados. El correo lo cuenta, y
  // el dato real, cuando alguien lo teclee, gana y retira la estimacion solo.
  // Ver lib-estimar-manuales.mjs para el metodo campo a campo y sus porques.
  let estimados = null;
  try {
    estimados = await estimarPartesPendientes(supabase, { hoy: comoFecha(hoy), aplicar: true });
  } catch (e) {
    incidencias.push(`ERROR: no se pudieron estimar los manuales pendientes: ${e.message}`);
  }

  // EL CUADRE, TODAS LAS MAÑANAS. Un parte puede quedarse con el detalle
  // descuadrado sin que nada falle: los informes se suben, el analisis termina
  // bien, y aun asi calibres_dia suma otra cosa que kg_produccion_calibrador.
  // Paso el 17-08-2026 con las mujeres contadas dos veces, y solo se vio porque
  // alguien se puso a mirarlo. Comprobarlo aqui es lo que convierte "se subio"
  // en "esta bien", y sale en el correo con el dia y los kilos.
  for (const f of ventanaDias(ayer, 7)) {
    try {
      const { data: p } = await supabase.from("partes_diarios")
        .select("id, date, kg_produccion_calibrador, kg_palets_brutos").eq("date", f).maybeSingle();
      if (!p) continue;
      const c = await cuadrar(supabase, p);
      for (const d of c.desvios) incidencias.push(`ERROR: el parte del ${f} no cuadra. ${d}.`);
    } catch (e) {
      incidencias.push(`ERROR: no se pudo cuadrar el parte del ${f}: ${e.message}`);
    }
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
    // Las pasadas las elige datosCalibradorDelDia (volcado del Sizer si lo hay,
    // informes de lote si no). Buscarlas otra vez aqui era pedirle el detalle a
    // la fuente que ese dia NO tiene nada.
    const ids = cal.ids ?? [];
    const loteDe = cal.loteDe ?? new Map();
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

    // Productores: por lote contra entradas_bascula (nunca por nombre). El
    // codigo se pasa por codigoBaseLote: el volcado lo trae limpio ("26051903")
    // pero el informe DOCX lo trae tal cual lo teclea planta ("26051903 24
    // BOX"), y compararlo crudo dejaba los dias servidos por DOCX enteros como
    // "(sin productor)" (visto en el aviso del 18-08).
    const lotes = [...new Set([...loteDe.values()].map((l) => codigoBaseLote(l))
      .filter((l) => /^\d{8}$/.test(l)))];
    const dueno = new Map();
    for (let i = 0; i < lotes.length; i += 200) {
      const { data } = await supabase.from("entradas_bascula")
        .select("lote, agricultor").in("lote", lotes.slice(i, i + 200));
      for (const e of data ?? []) dueno.set(e.lote, e.agricultor);
    }
    const porProd = new Map();
    for (const f of filas) {
      const nombre = dueno.get(codigoBaseLote(loteDe.get(f.batch_id))) ?? "(sin productor)";
      const acc = porProd.get(nombre) ?? { kg: 0, exp: 0 };
      acc.kg += Number(f.peso_kg) || 0;
      if (grupo(f) === "EXPORTACION") acc.exp += Number(f.peso_kg) || 0;
      porProd.set(nombre, acc);
    }
    productores = [...porProd.entries()]
      .map(([productor, a]) => ({ productor, kg: a.kg, pctExportacion: a.kg > 0 ? 100 * a.exp / a.kg : 0 }))
      .sort((a, b) => b.kg - a.kg);

    // ¿Cuanto hace del ultimo DATO del calibrador? Las fuentes son DOS, como en
    // datosCalibradorDelDia: el volcado SQL y los informes DOCX de lote. El
    // volcado se exporta A MANO y puede pasarse semanas parado (lo esta desde
    // el 11-08); mientras los informes sigan entrando, el calibrador NO esta
    // mudo. Mirar solo el volcado hacia saltar "[REVISAR] datos de hace N dias"
    // cada mañana, como si los partes de esos dias no se analizaran, cuando se
    // crean y analizan a diario con los DOCX (visto el 19-08). El abandono del
    // volcado en si lo vigila la lista FUENTES, con umbral generoso.
    const [{ data: ultimoBatch }, { data: ultimoInforme }] = await Promise.all([
      supabase.from("calibrador_batch").select("inicio").order("inicio", { ascending: false }).limit(1),
      supabase.from("calibrador_informe").select("fecha").order("fecha", { ascending: false }).limit(1),
    ]);
    const ultimoDato = [ultimoBatch?.[0]?.inicio, ultimoInforme?.[0]?.fecha]
      .filter(Boolean).map((v) => String(v).slice(0, 10)).sort().at(-1);
    if (ultimoDato) {
      const dias = Math.floor((Date.parse(`${ayer}T23:59:59`) - Date.parse(`${ultimoDato}T00:00:00`)) / 86400000);
      if (dias > 1) calibrador.desfaseDatos = dias;
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
  // El lote del informe viene tal cual lo teclea planta ("26051903 24 BOX"):
  // se reduce al codigo base para que case con los lotes de entrada esperados,
  // o cada informe llegado contaria igualmente como "sin informe".
  const { data: infData } = await supabase.from("calibrador_informe").select("lote").eq("fecha", ayer);
  const lotesInformes = [...new Set((infData ?? []).map((r) => codigoBaseLote(r.lote)))].sort();
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

  const { cuerpo, hayProblema, modelo } = componerAviso({
    fecha: ayer, entradas, palets, cobertura, correcciones, informesCalibrador,
    calibrador, productores, ip: ipLocal(), log: [...colaDelLog(), ...incidencias],
    parte: {
      ...parte,
      gstockRecuperados: gstockRecuperados.map((r) => r.fecha),
      gstockRehechos: gstockRehechos.map((r) => ({ fecha: r.fecha, faltaban: r.faltaban })),
    },
    frescura: await frescuraDeDatos(supabase, comoFecha(hoy)),
    buzon: buzonDelDia(ayer),
    analizados: analizados.filter((a) => a.accion === "analizado"),
    estimados,
    alta: await cierreEInventario(supabase, ayer),
    contexto: await contextoSemana(supabase, ayer),
    receptor: await receptorVivo(), ipEsperada: IP_ESPERADA,
    sinSubir: await calibradorSinSubir(supabase),
  });
  // El asunto lleva ya lo esencial: en la bandeja se ve el dia sin abrirlo, y
  // dos meses de correos se pueden repasar en diagonal.
  const dm = `${Number(ayer.slice(8, 10))} ${["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"][Number(ayer.slice(5, 7)) - 1]}`;
  const resumen = calibrador?.kgTotal > 0
    ? `${Math.round(calibrador.kgTotal).toLocaleString("es-ES")} kg · ${Math.round(100 * calibrador.kgExportacion / calibrador.kgTotal)}% export.`
    : "sin datos del calibrador";
  const asunto = `${hayProblema ? "[REVISAR] " : ""}Lasarte ${dm} · ${resumen}`;

  // El HTML es lo que se lee (el texto plano destrozaba las columnas en Gmail);
  // el texto sigue viajando como alternativa y como copia local inspeccionable.
  const html = renderAvisoHtml(modelo);
  fs.mkdirSync(path.resolve("outputs"), { recursive: true });
  fs.writeFileSync(path.resolve("outputs/aviso-diario.txt"), `${asunto}\n\n${cuerpo}\n`, "utf8");
  fs.writeFileSync(path.resolve("outputs/aviso-diario.html"), html, "utf8");
  console.log(`${asunto}\n\n${cuerpo}`);

  const apiKey = process.env.RESEND_API_KEY;
  let envio = "enviado";
  if (!apiKey) {
    console.log("\n(sin RESEND_API_KEY: queda en outputs/aviso-diario.txt)");
    envio = "sin-clave";
  } else if (process.argv.includes("--sin-enviar")) {
    console.log("\n(--sin-enviar)");
    envio = "sin-enviar";
  } else {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: REMITENTE, to: [DESTINO], subject: asunto, html, text: cuerpo }),
    });
    if (!res.ok) throw new Error(`Resend HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    console.log(`\nAviso enviado a ${DESTINO}.`);
  }

  // El rastro del día EN LA BASE: es lo que enseña /datos/fuentes y lo que el
  // vigilante comprueba desde fuera del portátil. "aviso" = corrió, pero el
  // correo salió con cosas que revisar.
  await anotarEjecucion({
    trabajo: "tarea-diaria",
    inicio: inicioEjecucion,
    estado: hayProblema ? "aviso" : "ok",
    detalle: asunto,
    datos: { fecha: ayer, envio },
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(async (e) => {
    // El error tambien deja rastro: un dia que murio entero (sin red, ERP caido)
    // tiene que verse en la base aunque el correo no haya podido salir.
    await anotarEjecucion({ trabajo: "tarea-diaria", estado: "error", detalle: e.message });
    console.error("ERROR:", e.message);
    await salirConError(1);
  });
}

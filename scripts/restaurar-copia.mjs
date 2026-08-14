/**
 * Restaura una copia de scripts/copia-seguridad.mjs. Dos modos:
 *
 * --prueba (el de defecto). El ENSAYO periódico: carga la copia entera en el
 *   esquema `restauracion` (aparte, sin tocar public), compara recuentos y
 *   huellas con la RPC restauracion_comparar, y tira el esquema al acabar.
 *   El criterio de éxito es filas restauradas == filas del manifiesto: eso
 *   demuestra que los ficheros vuelven a ser tablas, fila a fila y tipo a tipo.
 *   La huella contra public solo coincide si la base no se movió desde la
 *   copia — se enseña como información, no como veredicto.
 *
 * --de-verdad. El DESASTRE: inserta en public. Pensado para una base recién
 *   creada (proyecto nuevo + migraciones del repo aplicadas): se niega a tocar
 *   tablas con datos salvo --incluso-con-datos. Es EL MISMO cargador que el de
 *   la prueba — por eso la prueba vale como prueba.
 *
 *   node scripts/restaurar-copia.mjs                          # prueba, última copia
 *   node scripts/restaurar-copia.mjs --carpeta=outputs/copias/2026-08-14
 *   node scripts/restaurar-copia.mjs --tablas=entradas_bascula,erp_palet
 *   node scripts/restaurar-copia.mjs --de-verdad               # restauración real
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { pathToFileURL } from "node:url";
import zlib from "node:zlib";
import { finished } from "node:stream/promises";
import { createClient } from "@supabase/supabase-js";
import { anotarEjecucion, salirConError } from "./lib-registro-ejecuciones.mjs";
import { conReintentos } from "./lib-copia-seguridad.mjs";

try { process.loadEnvFile(path.resolve(".env")); } catch { /* entorno */ }

const CARPETA = path.resolve("outputs/copias");
const LOTE = 2000; // filas por llamada: ~1 MB de JSON en la tabla más ancha

const arg = (nombre) => process.argv.find((a) => a.startsWith(`--${nombre}=`))?.split("=")[1];

function ultimaCarpeta() {
  const dias = fs.readdirSync(CARPETA, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(d.name))
    .map((d) => d.name).sort();
  if (!dias.length) throw new Error(`no hay ninguna copia en ${CARPETA}`);
  return path.join(CARPETA, dias.at(-1));
}

/** La huella del fichero tiene que ser LA DEL MANIFIESTO antes de restaurar nada. */
async function comprobarHuella(fichero, esperada) {
  const sha = crypto.createHash("sha256");
  const lectura = fs.createReadStream(fichero);
  lectura.on("data", (t) => sha.update(t));
  await finished(lectura);
  const real = sha.digest("hex");
  if (esperada && real !== esperada) {
    throw new Error(`${path.basename(fichero)}: la huella no coincide con el manifiesto — el fichero se ha corrompido o tocado`);
  }
}

/** Recorre el NDJSON comprimido en lotes de `LOTE` filas. */
async function porLotes(fichero, porLote) {
  const lector = readline.createInterface({
    input: fs.createReadStream(fichero).pipe(zlib.createGunzip()),
    crlfDelay: Infinity,
  });
  let lote = [];
  for await (const linea of lector) {
    if (!linea.trim()) continue;
    lote.push(JSON.parse(linea));
    if (lote.length >= LOTE) { await porLote(lote); lote = []; }
  }
  if (lote.length) await porLote(lote);
}

/**
 * Inserta en public (modo --de-verdad). Si la tabla tiene una columna identity
 * GENERATED ALWAYS, el insert con id explícito falla: se reintenta sin el id
 * (los ids se regeneran; solo pasa en tablas de registro, no en las de datos,
 * cuyas claves son naturales o uuid propios).
 */
async function insertarEnPublic(supabase, tabla, lote) {
  const { error } = await supabase.from(tabla).insert(lote);
  if (!error) return lote.length;
  if (/GENERATED ALWAYS/i.test(error.message)) {
    const sinId = lote.map(({ id: _id, ...resto }) => resto);
    const { error: e2 } = await supabase.from(tabla).insert(sinId);
    if (e2) throw new Error(`${tabla}: ${e2.message}`);
    return lote.length;
  }
  throw new Error(`${tabla}: ${error.message}`);
}

async function main() {
  const inicio = new Date().toISOString();
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Faltan SUPABASE_URL y/o SUPABASE_SERVICE_ROLE_KEY.");
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  const deVerdad = process.argv.includes("--de-verdad");
  const carpeta = arg("carpeta") ? path.resolve(arg("carpeta")) : ultimaCarpeta();
  const manifiesto = JSON.parse(fs.readFileSync(path.join(carpeta, "manifiesto.json"), "utf8"));

  const pedidas = arg("tablas")?.split(",").map((t) => t.trim()).filter(Boolean);
  const tablas = manifiesto.tablas.filter((t) => !pedidas || pedidas.includes(t.tabla));
  if (!tablas.length) throw new Error("ninguna tabla del manifiesto coincide con --tablas");

  console.log(`${deVerdad ? "RESTAURACIÓN REAL en public" : "Ensayo de restauración (esquema restauracion)"} desde ${carpeta}`);
  console.log(`Copia del ${manifiesto.fecha}, esquema ${manifiesto.versionEsquema}, ${tablas.length} tablas.\n`);

  // 1. Integridad de los ficheros ANTES de tocar nada.
  for (const t of tablas) {
    await comprobarHuella(path.join(carpeta, t.fichero), t.sha256);
  }

  if (!deVerdad) {
    const { error } = await supabase.rpc("restauracion_preparar", { tablas: tablas.map((t) => t.tabla) });
    if (error) throw new Error(`preparar: ${error.message}`);
  }

  // 2. La carga, tabla a tabla.
  const resultado = [];
  for (const t of tablas) {
    if (deVerdad && !process.argv.includes("--incluso-con-datos")) {
      const { count, error } = await supabase.from(t.tabla).select("*", { count: "exact", head: true });
      if (error) throw new Error(`${t.tabla}: ${error.message}`);
      if ((count ?? 0) > 0) {
        throw new Error(`${t.tabla} ya tiene ${count} filas: la restauración real es para una base vacía (o pasa --incluso-con-datos sabiendo lo que haces)`);
      }
    }
    let cargadas = 0;
    await porLotes(path.join(carpeta, t.fichero), async (lote) => {
      if (deVerdad) {
        cargadas += await conReintentos(() => insertarEnPublic(supabase, t.tabla, lote));
      } else {
        // OJO con reintentar inserciones: restauracion_cargar es un INSERT sin
        // idempotencia, pero un error de red ocurre ANTES de que el servidor
        // conteste — si la llamada llegó y contestó, no se reintenta (el error
        // vendría en `error`, no como excepción de fetch).
        cargadas += await conReintentos(async () => {
          const { data, error } = await supabase.rpc("restauracion_cargar", { tabla: t.tabla, filas: lote });
          if (error) throw new Error(`${t.tabla}: ${error.message}`);
          return data ?? 0;
        });
      }
    });
    const cuadra = cargadas === t.filasReleidas;
    resultado.push({ tabla: t.tabla, esperadas: t.filasReleidas, cargadas, cuadra });
    console.log(`  ${t.tabla}: ${cargadas.toLocaleString("es-ES")} / ${t.filasReleidas.toLocaleString("es-ES")} ${cuadra ? "✓" : "✗ NO CUADRA"}`);
  }

  // 3. El veredicto. La huella va POR TABLA (cada llamada con su propio límite
  //    de tiempo; la primera versión comparaba todo en una y saltó el timeout);
  //    una tabla que no dé huella a tiempo se dice y no tumba la prueba: el
  //    veredicto son los recuentos.
  const fallos = resultado.filter((r) => !r.cuadra);
  let huellasIguales = null;
  if (!deVerdad) {
    huellasIguales = 0;
    let sinHuella = 0;
    for (const r of resultado) {
      const { data, error } = await supabase.rpc("restauracion_comparar", { tabla_pedida: r.tabla });
      if (error) { sinHuella += 1; continue; }
      const c = data?.[0];
      if (c && c.huella_restaurada === c.huella_publico) huellasIguales += 1;
    }
    console.log(`\nHuella idéntica a public en ${huellasIguales}/${resultado.length} tablas` +
      (sinHuella ? ` (${sinHuella} sin huella por tiempo)` : "") +
      (huellasIguales < resultado.length
        ? " — las que difieren: la base siguió moviéndose desde la copia, o numéricos re-escalados; el veredicto es el recuento"
        : ""));
    if (!process.argv.includes("--conservar")) {
      await supabase.rpc("restauracion_limpiar");
    } else {
      console.log("(--conservar: el esquema restauracion se queda para mirarlo)");
    }
  }

  const filasTotales = resultado.reduce((s, r) => s + r.cargadas, 0);
  const detalle = `${deVerdad ? "REAL" : "ensayo"} de la copia del ${manifiesto.fecha}: ` +
    `${resultado.length} tablas, ${filasTotales.toLocaleString("es-ES")} filas restauradas` +
    (fallos.length ? ` · NO CUADRAN: ${fallos.map((f) => f.tabla).join(", ")}` : " · todas cuadran") +
    (huellasIguales != null ? ` · huellas ${huellasIguales}/${resultado.length}` : "");

  await anotarEjecucion({
    trabajo: deVerdad ? "restauracion-real" : "prueba-restauracion",
    inicio,
    estado: fallos.length ? "error" : "ok",
    detalle,
    datos: { carpeta: path.basename(carpeta), tablas: resultado.length, filas: filasTotales },
  });
  console.log(`\n${detalle}`);
  if (fallos.length) throw new Error("la restauración no cuadró con el manifiesto");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(async (e) => {
    console.error("ERROR:", e.message);
    await salirConError(1);
  });
}

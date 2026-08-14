/**
 * Copia de seguridad diaria de la Herramienta (cierre de la Fase 1).
 *
 * QUÉ GUARDA Y DÓNDE:
 *   - Todas las tablas de public, cada una en outputs/copias/<fecha>/<tabla>.ndjson.gz
 *     (una fila JSON por línea), con un manifiesto.json al lado: recuento exacto
 *     por tabla, huella sha256 de cada fichero y la versión del esquema.
 *   - El storage (CMRs, archivos de partes) como ESPEJO incremental en
 *     outputs/copias/archivos/<cubo>/: solo baja lo nuevo o lo cambiado.
 *
 * outputs/ vive dentro de la carpeta de OneDrive, así que cada copia sube sola
 * a la nube: portátil muerto ≠ copia perdida.
 *
 * POR QUÉ POR LA API Y NO CON pg_dump. En este equipo no hay pg_dump, ni Docker,
 * ni contraseña directa de Postgres — solo la service role, que es la misma vía
 * de todos los scripts. La lista de tablas sale de la RPC copia_manifiesto():
 * una tabla nueva entra en la copia sola, sin tocar este script.
 *
 * SE VERIFICA A SÍ MISMA: al terminar cada fichero se RELEE entero (descomprimido)
 * y se compara con el recuento exacto de la base. Una copia que no se puede
 * releer no es una copia.
 *
 * La restauración (de prueba o de verdad) vive en scripts/restaurar-copia.mjs.
 *
 *   node scripts/copia-seguridad.mjs                  # tablas + espejo del storage
 *   node scripts/copia-seguridad.mjs --sin-archivos   # solo tablas
 *   node scripts/copia-seguridad.mjs --forzar         # aunque hoy ya haya copia buena
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import zlib from "node:zlib";
import { finished } from "node:stream/promises";
import { createClient } from "@supabase/supabase-js";
import { anotarEjecucion, salirConError } from "./lib-registro-ejecuciones.mjs";
import { carpetasABorrar, comoTamano, conReintentos, rutaSegura } from "./lib-copia-seguridad.mjs";

try { process.loadEnvFile(path.resolve(".env")); } catch { /* entorno */ }

const CARPETA = path.resolve("outputs/copias");
const PAGINA = 1000;              // PostgREST recorta a 1.000: se pagina siempre
const SIN_PK_MAX = 20000;         // sin clave primaria no hay orden estable: solo tablas pequeñas

const dd = (n) => String(n).padStart(2, "0");
const hoyLocal = () => {
  const d = new Date();
  return `${d.getFullYear()}-${dd(d.getMonth() + 1)}-${dd(d.getDate())}`;
};

/** Escribe en un stream respetando la contrapresión: 250k filas no caben en RAM alegremente. */
function escribir(stream, trozo) {
  if (stream.write(trozo)) return Promise.resolve();
  return new Promise((r) => stream.once("drain", r));
}

/**
 * Vuelca una tabla entera a NDJSON comprimido, paginando por su clave primaria
 * (el único orden estable que hay: sin él, dos páginas podrían pisarse si la
 * base se mueve mientras tanto).
 */
async function volcarTabla(supabase, t, destino) {
  if (t.pk.length === 0 && t.filas > SIN_PK_MAX) {
    throw new Error(`la tabla ${t.tabla} no tiene clave primaria y es grande (${t.filas} filas): sin orden estable la copia podría salir coja. Ponle clave primaria.`);
  }
  const gz = zlib.createGzip({ level: 6 });
  const salida = fs.createWriteStream(destino);
  gz.pipe(salida);

  let filas = 0;
  for (let desde = 0; ; desde += PAGINA) {
    // Leer es idempotente: reintentar una página no puede duplicar nada.
    const data = await conReintentos(async () => {
      let consulta = supabase.from(t.tabla).select("*");
      for (const col of t.pk) consulta = consulta.order(col, { ascending: true });
      const { data: pagina, error } = await consulta.range(desde, desde + PAGINA - 1);
      if (error) throw new Error(`${t.tabla}: ${error.message}`);
      return pagina ?? [];
    });
    for (const fila of data ?? []) {
      await escribir(gz, `${JSON.stringify(fila)}\n`);
      filas += 1;
    }
    if ((data ?? []).length < PAGINA) break;
  }
  gz.end();
  await finished(salida);
  return filas;
}

/** Relee el .gz entero: cuenta líneas y calcula la huella del fichero comprimido. */
async function releer(fichero) {
  const sha = crypto.createHash("sha256");
  let lineas = 0;
  const gunzip = zlib.createGunzip();
  const lectura = fs.createReadStream(fichero);
  lectura.on("data", (t) => sha.update(t));
  lectura.pipe(gunzip);
  gunzip.on("data", (t) => {
    for (let i = 0; i < t.length; i++) if (t[i] === 10) lineas += 1;
  });
  await finished(gunzip);
  return { lineas, sha256: sha.digest("hex"), bytes: fs.statSync(fichero).size };
}

/**
 * Espejo incremental del storage. Baja lo que no está o cambió (por tamaño o
 * fecha); nunca borra en local — un borrado accidental en la nube no debe
 * propagarse a la copia.
 */
async function espejoArchivos(supabase, base) {
  // La RPC también pasa por PostgREST y también se recorta a 1.000 en silencio
  // (la regla de fetchAllRows vale igual aquí): se pagina con orden estable.
  const objetos = [];
  for (let desde = 0; ; desde += PAGINA) {
    const pagina = await conReintentos(async () => {
      const { data, error } = await supabase.rpc("copia_archivos_manifiesto")
        .order("cubo").order("nombre").range(desde, desde + PAGINA - 1);
      if (error) throw new Error(`manifiesto de archivos: ${error.message}`);
      return data ?? [];
    });
    objetos.push(...pagina);
    if (pagina.length < PAGINA) break;
  }

  let nuevos = 0;
  let bytesNuevos = 0;
  const errores = [];
  for (const o of objetos ?? []) {
    const relativa = rutaSegura(o.nombre);
    if (!relativa) continue;
    const destino = path.join(base, "archivos", rutaSegura(o.cubo), ...relativa.split("/"));
    try {
      const st = fs.existsSync(destino) ? fs.statSync(destino) : null;
      const cambiado = !st || st.size !== Number(o.bytes)
        || (o.actualizado && st.mtimeMs < Date.parse(o.actualizado));
      if (!cambiado) continue;
      const { data, error: e } = await supabase.storage.from(o.cubo).download(o.nombre);
      if (e) throw new Error(e.message);
      fs.mkdirSync(path.dirname(destino), { recursive: true });
      fs.writeFileSync(destino, Buffer.from(await data.arrayBuffer()));
      nuevos += 1;
      bytesNuevos += Number(o.bytes) || 0;
      if (nuevos % 100 === 0) console.log(`  archivos: ${nuevos} bajados…`);
    } catch (e) {
      errores.push(`${o.cubo}/${o.nombre}: ${e.message}`);
    }
  }
  return { revisados: (objetos ?? []).length, nuevos, bytesNuevos, errores };
}

export async function hacerCopia(supabase, { fecha = hoyLocal(), conArchivos = true } = {}) {
  const carpetaDia = path.join(CARPETA, fecha);
  fs.mkdirSync(carpetaDia, { recursive: true });

  const [{ data: tablas, error: errMan }, { data: version, error: errVer }] = await Promise.all([
    supabase.rpc("copia_manifiesto"),
    supabase.rpc("copia_version_esquema"),
  ]);
  if (errMan) throw new Error(`manifiesto: ${errMan.message}`);
  if (errVer) throw new Error(`versión del esquema: ${errVer.message}`);

  const resultado = [];
  let filasTotales = 0;
  let bytesTotales = 0;
  for (const t of tablas ?? []) {
    const fichero = path.join(carpetaDia, `${t.tabla}.ndjson.gz`);
    const filas = await volcarTabla(supabase, t, fichero);
    const releido = await releer(fichero);
    // La verificación de verdad: lo que se puede RELEER contra lo que la base
    // decía tener. filas (lo volcado) y releido.lineas no pueden diferir salvo
    // bug propio; contra t.filas puede haber una diferencia pequeña si la base
    // se movió durante el volcado — se anota y decide el umbral de abajo.
    resultado.push({
      tabla: t.tabla,
      fichero: path.basename(fichero),
      pk: t.pk,
      filasEnBase: Number(t.filas),
      filasVolcadas: filas,
      filasReleidas: releido.lineas,
      bytes: releido.bytes,
      sha256: releido.sha256,
    });
    filasTotales += releido.lineas;
    bytesTotales += releido.bytes;
    console.log(`  ${t.tabla}: ${releido.lineas.toLocaleString("es-ES")} filas · ${comoTamano(releido.bytes)}`);
  }

  // Verificado = todo fichero se relee entero y cuadra con lo volcado, y lo
  // volcado no se aleja de lo que la base decía (margen 2%: la base sigue viva
  // mientras se copia, y unas filas de más o de menos a las 21:30 son normales).
  const problemas = resultado.filter((r) =>
    r.filasReleidas !== r.filasVolcadas ||
    Math.abs(r.filasVolcadas - r.filasEnBase) > Math.max(20, r.filasEnBase * 0.02));

  const archivos = conArchivos ? await espejoArchivos(supabase, CARPETA) : null;

  const manifiesto = {
    fecha,
    creado: new Date().toISOString(),
    versionEsquema: version ?? null,
    verificado: problemas.length === 0,
    problemas: problemas.map((p) => p.tabla),
    tablas: resultado,
    archivos,
  };
  fs.writeFileSync(path.join(carpetaDia, "manifiesto.json"), JSON.stringify(manifiesto, null, 2), "utf8");

  // Rotación: 14 diarias + la primera de cada mes. Solo si la copia de hoy
  // está verificada — nunca se borra lo viejo a cambio de algo dudoso.
  let borradas = [];
  if (manifiesto.verificado) {
    const carpetas = fs.readdirSync(CARPETA, { withFileTypes: true })
      .filter((d) => d.isDirectory()).map((d) => d.name);
    borradas = carpetasABorrar(carpetas);
    for (const b of borradas) fs.rmSync(path.join(CARPETA, b), { recursive: true, force: true });
  }

  return { manifiesto, filasTotales, bytesTotales, borradas };
}

async function main() {
  const inicio = new Date().toISOString();
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Faltan SUPABASE_URL y/o SUPABASE_SERVICE_ROLE_KEY.");
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  const fecha = hoyLocal();
  const manifiestoHoy = path.join(CARPETA, fecha, "manifiesto.json");
  if (!process.argv.includes("--forzar") && fs.existsSync(manifiestoHoy)) {
    let hecha = false;
    try { hecha = JSON.parse(fs.readFileSync(manifiestoHoy, "utf8")).verificado === true; }
    catch { /* manifiesto ilegible: se rehace entera */ }
    if (hecha) {
      // Las tablas de hoy ya están; el ESPEJO se repasa igual, que es
      // incremental y barato — así un reintento de la tarea (cada 30 min)
      // recupera un espejo que se quedara a medias sin repetir el volcado.
      console.log(`La copia de hoy (${fecha}) ya está verificada: solo se repasa el espejo del storage.`);
      if (process.argv.includes("--sin-archivos")) return;
      const a = await espejoArchivos(supabase, CARPETA);
      const texto = `espejo al día: ${a.nuevos} nuevos (${comoTamano(a.bytesNuevos)}) de ${a.revisados}`;
      console.log(texto);
      if (a.nuevos > 0 || a.errores.length > 0) {
        await anotarEjecucion({
          trabajo: "copia-seguridad",
          inicio,
          estado: a.errores.length ? "aviso" : "ok",
          detalle: a.errores.length ? `${texto} · ${a.errores.length} no bajaron` : texto,
          datos: { fecha, archivosNuevos: a.nuevos, erroresArchivos: a.errores.slice(0, 5) },
        });
      }
      return;
    }
  }

  console.log(`Copia del ${fecha} en ${CARPETA}`);
  const { manifiesto, filasTotales, bytesTotales, borradas } = await hacerCopia(supabase, {
    fecha,
    conArchivos: !process.argv.includes("--sin-archivos"),
  });

  const a = manifiesto.archivos;
  const detalle = [
    `${manifiesto.tablas.length} tablas · ${filasTotales.toLocaleString("es-ES")} filas · ${comoTamano(bytesTotales)}`,
    a ? `storage: ${a.nuevos} nuevos (${comoTamano(a.bytesNuevos)}) de ${a.revisados}` : "storage: no revisado",
    manifiesto.verificado ? "verificada releyendo" : `NO VERIFICADA: ${manifiesto.problemas.join(", ")}`,
    borradas.length ? `rotadas ${borradas.length} copias viejas` : null,
  ].filter(Boolean).join(" · ");

  const conErrores = (a?.errores?.length ?? 0) > 0;
  const estado = !manifiesto.verificado ? "error" : conErrores ? "aviso" : "ok";
  await anotarEjecucion({
    trabajo: "copia-seguridad",
    inicio,
    estado,
    detalle: conErrores ? `${detalle} · ${a.errores.length} archivos no bajaron` : detalle,
    datos: { fecha, filas: filasTotales, bytes: bytesTotales, archivosNuevos: a?.nuevos ?? 0, erroresArchivos: a?.errores?.slice(0, 5) ?? [] },
  });

  console.log(`\n${detalle}`);
  if (conErrores) {
    console.error(`ARCHIVOS QUE NO BAJARON (${a.errores.length}):`);
    for (const e of a.errores.slice(0, 10)) console.error(`  ${e}`);
  }
  if (!manifiesto.verificado) throw new Error(`la copia NO verificó: ${manifiesto.problemas.join(", ")}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(async (e) => {
    await anotarEjecucion({ trabajo: "copia-seguridad", estado: "error", detalle: e.message });
    console.error("ERROR:", e.message);
    await salirConError(1);
  });
}

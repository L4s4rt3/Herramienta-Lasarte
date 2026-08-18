/**
 * Lee el buzón del calibrador (lasartecitricos@gmail.com) y mete en la
 * Herramienta lo que llegue.
 *
 * REACTIVADO EL 18-08-2026. Tomra configuró el auto-envío del Sizer contra
 * Gmail (smtp, contraseña de aplicación), así que los informes de lote viajan
 * ahora por correo de verdad. Este lector es la otra mitad: los recoge del
 * buzón por IMAP y los procesa EXACTAMENTE igual que el receptor de la LAN
 * (mismas librerías: parsear, validar que cuadra, subir). El receptor sigue
 * escuchando como red de seguridad para lo que aún llegue por dentro.
 *
 * QUÉ PROCESA, y con qué:
 *   - .docx  informe de lote del Sizer  -> lib-informe-calibrador + subirInforme
 *   - .zip   export SQL (lotes.csv + clasificacion.csv) -> importar-export-calibrador
 *   - .xlsx/.csv  Excel de los que la app reconoce -> el clasificador de /importar
 *   Todo se guarda en outputs/buzon/<fecha>/ ANTES de procesarlo: si algo falla,
 *   el fichero ya está a salvo y el correo se queda SIN marcar como leído, así
 *   que la siguiente pasada lo reintenta sola.
 *
 * EL BUZÓN ES COMPARTIDO (18-08-2026: llegan currículums y correos internos de
 * la empresa). Por eso SOLO se tocan los correos del remitente del calibrador
 * (BUZON_REMITENTES, por defecto la propia cuenta, que es el emisor que Tomra
 * configuró): el resto NI SE DESCARGA, ni se guarda, ni se marca como leído —
 * el correo de las personas se queda exactamente como estaba.
 *
 * QUÉ NO HACE: no borra correos, no responde, no manda nada. Solo lee y marca
 * como leído lo que ha podido procesar (y solo con --aplicar).
 *
 * CREDENCIALES (.env). Gmail exige contraseña de aplicación (la normal no vale
 * para IMAP desde 2025, igual que para el envío):
 *
 *   BUZON_IMAP_HOST=imap.gmail.com
 *   BUZON_IMAP_PUERTO=993
 *   BUZON_IMAP_USUARIO=lasartecitricos@gmail.com
 *   BUZON_IMAP_PASSWORD=...            # contraseña de APLICACION (16 letras)
 *   BUZON_IMAP_CARPETA=INBOX
 *
 *   node scripts/leer-buzon-correo.mjs --probar    # solo conecta y cuenta, sin tocar nada
 *   node scripts/leer-buzon-correo.mjs             # simulacion: baja y clasifica, sin importar
 *   node scripts/leer-buzon-correo.mjs --aplicar
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { parsearInformeCalibrador, validarBloques } from "./lib-informe-calibrador.mjs";
import { subirInforme } from "./lib-subir-informe-calibrador.mjs";
import { abrirZipExport, importarExportSizer } from "./importar-export-calibrador.mjs";
import { anotarEjecucion, latido, salirConError } from "./lib-registro-ejecuciones.mjs";

try { process.loadEnvFile(path.resolve(".env")); } catch { /* entorno */ }

const CARPETA = path.resolve("outputs/buzon");
const REGISTRO = path.join(CARPETA, "registro.jsonl");
const ahora = () => new Date().toISOString();
const hoy = () => ahora().slice(0, 10);

/** Nombre de fichero que no se pueda salir de su carpeta ni romper Windows. */
function nombreSeguro(bruto, i) {
  const limpio = String(bruto ?? "").replace(/[\\/:*?"<>|]/g, "_").replace(/^\.+/, "").trim();
  return limpio || `adjunto-${i + 1}.bin`;
}

function anotar(evento) {
  fs.mkdirSync(CARPETA, { recursive: true });
  fs.appendFileSync(REGISTRO, `${JSON.stringify(evento)}\n`, "utf8");
}

/**
 * El marcador de hasta dónde se ha procesado (por UID del buzón). Existe porque
 * Gmail puede dejar como "leídos" los envíos de la propia cuenta (el emisor del
 * Sizer ES la cuenta), así que la cola por "sin leer" perdería informes. Con el
 * marcador, todo correo del calibrador posterior entra, esté leído o no.
 */
const ESTADO = path.join(CARPETA, "estado.json");
function leerEstado() {
  try { return JSON.parse(fs.readFileSync(ESTADO, "utf8")); }
  catch { return { uidValidity: null, ultimoUid: 0 }; }
}
function guardarEstado(e) {
  fs.mkdirSync(CARPETA, { recursive: true });
  fs.writeFileSync(ESTADO, JSON.stringify(e), "utf8");
}

function clienteSupabase() {
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? createClient(url, key, { auth: { persistSession: false } }) : null;
}

/**
 * Informe DOCX de lote: mismo criterio que el receptor de la LAN. NO se sube
 * lo que no cuadra consigo mismo (el formato habría cambiado y esos números no
 * deben entrar hasta mirarlo); el fichero queda en disco pase lo que pase.
 */
async function procesarDocx(supabase, contenido, fichero, { aplicar }) {
  let r;
  try { r = parsearInformeCalibrador(contenido); }
  catch (e) { return { error: e.message }; }
  const descuadres = validarBloques(r.bloques);
  const resumen = {
    lote: r.cabecera.lote,
    comienzo: r.cabecera.comienzo ?? null,
    lineas: r.lineas.length,
    kg: Math.round(r.lineas.reduce((s, l) => s + (l.kg ?? 0), 0)),
    cuadra: descuadres.length === 0,
  };
  if (!resumen.cuadra) return { ...resumen, subida: { subido: false, motivo: `${descuadres.length} bloques no cuadran` } };
  if (!aplicar) return { ...resumen, subida: { subido: false, motivo: "simulacion" } };
  if (!supabase) return { ...resumen, subida: { subido: false, motivo: "sin credenciales de Supabase en el .env" } };
  try {
    const s = await subirInforme(supabase, r, fichero);
    return { ...resumen, subida: { subido: true, lineas: s.lineas, fecha: s.fecha } };
  } catch (e) {
    // La casa ya conoce este motivo: una pasada que ya está en la base choca con
    // su restricción única. No es un fallo — el receptor la subió antes.
    return { ...resumen, subida: { subido: false, motivo: e.message } };
  }
}

/** Delega en el mismo clasificador que usa /importar (es TypeScript, va aparte). */
function clasificarEImportar(ruta, aplicar) {
  return new Promise((resolve) => {
    const args = ["node_modules/vite-node/vite-node.mjs", "scripts/importar-adjunto.ts", ruta];
    if (aplicar) args.push("--aplicar");
    execFile(process.execPath, args,
      { cwd: path.resolve("."), timeout: 120000, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
      (err, stdout) => {
        const linea = String(stdout ?? "").trimEnd().split(/\r?\n/).at(-1) ?? "";
        try { resolve(JSON.parse(linea)); } catch {
          resolve({ estado: "error", detalle: err?.message ?? "no se pudo clasificar" });
        }
      });
  });
}

export function configuracion() {
  const host = process.env.BUZON_IMAP_HOST;
  const user = process.env.BUZON_IMAP_USUARIO;
  const pass = process.env.BUZON_IMAP_PASSWORD;
  if (!host || !user || !pass) {
    throw new Error(
      "Faltan las credenciales del buzon en el .env: BUZON_IMAP_HOST, " +
      "BUZON_IMAP_USUARIO y BUZON_IMAP_PASSWORD (ver la cabecera de este script).",
    );
  }
  return {
    host,
    port: Number(process.env.BUZON_IMAP_PUERTO) || 993,
    secure: true,
    auth: { user, pass },
    carpeta: process.env.BUZON_IMAP_CARPETA || "INBOX",
    logger: false,
  };
}

export async function leerBuzon({ aplicar = false, soloProbar = false } = {}) {
  const cfg = configuracion();
  const cliente = new ImapFlow(cfg);
  const supabase = clienteSupabase();
  await cliente.connect();

  // El buzon es compartido: solo son nuestros los correos de estos remitentes.
  // Los demas ni se buscan, ni se descargan, ni se tocan.
  const remitentes = (process.env.BUZON_REMITENTES ?? cfg.auth.user)
    .toLowerCase().split(/[,;]/).map((s) => s.trim()).filter(Boolean);

  const resultados = [];
  let sinLeer = 0;
  let estado = leerEstado();
  let pendientes = [];
  const cerrojo = await cliente.getMailboxLock(cfg.carpeta);
  try {
    // Si el buzon se recrea (UIDVALIDITY cambia), los UID dejan de valer: el
    // marcador vuelve a cero y las restricciones unicas evitan duplicados.
    const uidValidity = String(cliente.mailbox?.uidValidity ?? "");
    if (estado.uidValidity !== uidValidity) estado = { uidValidity, ultimoUid: 0 };

    sinLeer = ((await cliente.search({ seen: false })) ?? []).length;

    const uids = new Set();
    for (const rem of remitentes) {
      const encontrados = await cliente.search({ from: rem, uid: `${estado.ultimoUid + 1}:*` }, { uid: true });
      // El rango "N:*" devuelve siempre el ultimo mensaje aunque su UID sea
      // menor que N (manias de IMAP): se filtra a mano.
      for (const u of encontrados ?? []) if (u > estado.ultimoUid) uids.add(u);
    }
    pendientes = [...uids].sort((a, b) => a - b);

    if (!soloProbar) {
      for (const uid of pendientes) {
        // Cada correo va en su propio try: uno que no se deje descargar o
        // interpretar se anota, NO adelanta el marcador (se reintenta en la
        // siguiente pasada) y no bloquea a los demas.
        try {
          const fallos = await procesarCorreo(cliente, uid, { aplicar, supabase, resultados });
          if (aplicar && fallos === 0) {
            estado.ultimoUid = uid;
            guardarEstado(estado);
          }
        } catch (e) {
          anotar({ leido: ahora(), uid, error: e.message });
          resultados.push({ leido: ahora(), uid, error: e.message, adjuntos: [], sin_adjuntos: true });
        }
      }
    }
  } finally {
    cerrojo.release();
    await cliente.logout().catch(() => {});
  }
  return { conectado: true, carpeta: cfg.carpeta, sinLeer, propios: pendientes.length, resultados };
}

async function procesarCorreo(cliente, uid, { aplicar, supabase, resultados }) {
  {
      const descarga = await cliente.download(String(uid), undefined, { uid: true });
      if (!descarga?.content) throw new Error("el servidor no devolvio el contenido del mensaje");
      const trozos = [];
      for await (const t of descarga.content) trozos.push(t);
      const correo = await simpleParser(Buffer.concat(trozos));

      const carpetaDia = path.join(CARPETA, hoy());
      fs.mkdirSync(carpetaDia, { recursive: true });

      const adjuntos = [];
      let fallosDeSubida = 0;
      for (const [i, a] of (correo.attachments ?? []).entries()) {
        const marca = ahora().replace(/[:.]/g, "-");
        const nombre = nombreSeguro(a.filename, i);
        const destino = path.join(carpetaDia, `${marca}_${nombre}`);
        // A disco ANTES de procesar: si algo falla luego, el dato no se pierde.
        fs.writeFileSync(destino, a.content);
        const item = { fichero: path.relative(CARPETA, destino), bytes: a.content.length };

        if (/\.docx$/i.test(nombre)) {
          item.informe = await procesarDocx(supabase, a.content, item.fichero, { aplicar });
          if (aplicar && item.informe?.subida?.subido === false
            && !/simulacion|unique/i.test(item.informe.subida.motivo)) fallosDeSubida += 1;
        } else if (/\.zip$/i.test(nombre)) {
          try {
            const csvs = abrirZipExport(a.content);
            if (csvs) {
              if (!aplicar) item.importExport = { simulacion: true };
              else if (!supabase) item.importExport = { error: "sin credenciales de Supabase" };
              else item.importExport = await importarExportSizer(supabase, csvs);
            }
          } catch (e) {
            item.importExport = { error: e.message };
            fallosDeSubida += 1;
          }
        } else if (/\.(xlsx?|csv)$/i.test(nombre)) {
          item.buzon = await clasificarEImportar(destino, aplicar);
        }
        adjuntos.push(item);
      }

      const evento = {
        leido: ahora(), uid,
        de: correo.from?.text ?? null,
        asunto: correo.subject ?? null,
        fecha: correo.date?.toISOString() ?? null,
        adjuntos,
        sin_adjuntos: adjuntos.length === 0,
      };
      anotar(evento);
      resultados.push(evento);

      // Marcar como leido SOLO si se aplico Y todo lo suyo entro (o no era
      // nuestro): un correo con una subida fallida se queda sin marcar y la
      // siguiente pasada lo reintenta sola.
      // La marca de leido es solo cosmetica para quien abra el buzon: la cola
      // de verdad es el marcador de UID.
      if (aplicar && fallosDeSubida === 0) {
        await cliente.messageFlagsAdd(String(uid), ["\\Seen"], { uid: true });
      }
      return fallosDeSubida;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const soloProbar = args.includes("--probar");
  const aplicar = args.includes("--aplicar");
  const inicio = new Date().toISOString();

  const r = await leerBuzon({ aplicar, soloProbar });

  const informes = r.resultados.flatMap((ev) => ev.adjuntos.filter((a) => a.informe));
  const subidos = informes.filter((a) => a.informe?.subida?.subido).length;
  const fallidos = informes.filter((a) => a.informe?.subida?.subido === false
    && !/simulacion|unique/i.test(a.informe.subida.motivo ?? "")).length;

  // El rastro en la base: /datos/fuentes y el vigilante miran esta señal.
  await anotarEjecucion({
    trabajo: "leer-buzon",
    inicio,
    estado: fallidos > 0 ? "aviso" : "ok",
    detalle: r.propios === 0
      ? "sin correos nuevos del calibrador"
      : `${r.propios} del calibrador: ${subidos} informe(s) de lote subidos` +
        (fallidos ? `, ${fallidos} NO subieron (se reintentan solos)` : ""),
    datos: { aplicar, soloProbar, propios: r.propios, sinLeerEnBuzon: r.sinLeer, informesSubidos: subidos },
  });

  console.log(`Buzon "${r.carpeta}": ${r.propios} correo(s) del calibrador pendientes` +
    ` · ${r.sinLeer} sin leer en el buzon (los ajenos no se tocan).`);
  if (soloProbar) return console.log("Conexion correcta. (--probar: no se ha tocado nada)");

  for (const ev of r.resultados) {
    console.log(`\n  "${ev.asunto ?? "(sin asunto)"}" de ${ev.de ?? "?"}`);
    if (ev.sin_adjuntos) { console.log("    sin adjuntos"); continue; }
    for (const a of ev.adjuntos) {
      if (a.informe) {
        const inf = a.informe;
        if (inf.error) { console.log(`    ${path.basename(a.fichero)} -> NO SE ENTIENDE: ${inf.error}`); continue; }
        console.log(`    ${path.basename(a.fichero)} -> lote ${inf.lote} · ${inf.lineas} lineas · ${inf.kg} kg` +
          ` · ${inf.subida.subido ? `SUBIDO (${inf.subida.fecha})` : `no subido: ${inf.subida.motivo}`}`);
      } else if (a.importExport) {
        const x = a.importExport;
        console.log(`    ${path.basename(a.fichero)} -> export SQL: ` +
          (x.error ? `ERROR ${x.error}` : x.simulacion ? "se importaria" : `${x.pasadas} pasadas · ${x.filas} filas`));
      } else if (a.buzon) {
        const b = a.buzon;
        console.log(`    ${path.basename(a.fichero)} -> ${b.etiqueta ?? b.tipo ?? "?"} [${b.estado}]${b.detalle ? ` ${b.detalle}` : ""}`);
      } else {
        console.log(`    ${path.basename(a.fichero)} (guardado, sin procesador)`);
      }
    }
  }
  if (!aplicar && r.resultados.length) console.log("\n(simulacion: repite con --aplicar)");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(async (e) => {
    // Sin credenciales no es una averia, es un pendiente conocido: se deja solo
    // el latido en "aviso" — una fila de error cada 30 minutos por lo mismo
    // enterraria los errores de verdad.
    if (/Faltan las credenciales del buzon/.test(e.message)) {
      await latido("leer-buzon", { estado: "aviso", detalle: "sin configurar: faltan las credenciales IMAP en el .env" });
    } else {
      await anotarEjecucion({ trabajo: "leer-buzon", estado: "error", detalle: e.message });
    }
    console.error("ERROR:", e.message);
    await salirConError(1);
  });
}

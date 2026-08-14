/**
 * Lee el buzón de soporte@lasartesat.es y mete en la Herramienta lo que llegue.
 *
 * POR QUÉ POR IMAP Y NO REENVIANDO AL RECEPTOR. El receptor SMTP solo escucha en
 * la red de la oficina (192.168.1.x): un correo mandado desde fuera no le llega,
 * y exponerlo a internet no se va a hacer. Leyendo el buzón de verdad, basta con
 * que un informe llegue a soporte@lasartesat.es — de quien sea y desde donde
 * sea — para que entre solo.
 *
 * QUÉ HACE, y qué no:
 *   - Mira solo los correos SIN LEER. Al procesar uno lo marca como leído, así
 *     que nunca se importa dos veces y queda claro en el buzón qué ha pasado.
 *   - Guarda cada adjunto en outputs/buzon/<fecha>/ antes de nada: si algo falla
 *     luego, el fichero ya está a salvo.
 *   - Clasifica e importa con el MISMO clasificador de /importar, igual que el
 *     receptor de la LAN (scripts/importar-adjunto.ts). Lo que la app importaría
 *     sola, entra; lo que pide confirmación humana se queda esperando y se avisa.
 *   - NO borra ningún correo. NO responde. NO manda nada. Solo lee y marca.
 *
 * CREDENCIALES. Van en el .env y este script solo las lee del entorno:
 *
 *   BUZON_IMAP_HOST=imap.ionos.es      # IONOS; Google: imap.gmail.com; M365: outlook.office365.com
 *   BUZON_IMAP_PUERTO=993
 *   BUZON_IMAP_USUARIO=soporte@lasartesat.es
 *   BUZON_IMAP_PASSWORD=...            # con 2FA, hay que crear una contraseña de aplicación
 *   BUZON_IMAP_CARPETA=INBOX           # opcional: una carpeta propia si se prefiere
 *
 * Si prefieres no dejar entrar a todo el buzón, crea una carpeta (p. ej.
 * "Herramienta"), pon una regla en el correo que mueva ahí lo que quieras
 * importar, y apunta BUZON_IMAP_CARPETA a esa carpeta: solo se leerá esa.
 *
 *   node scripts/leer-buzon-correo.mjs --probar    # solo conecta y cuenta, sin tocar nada
 *   node scripts/leer-buzon-correo.mjs             # simulacion: baja y clasifica, sin importar
 *   node scripts/leer-buzon-correo.mjs --aplicar
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
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
  await cliente.connect();

  const resultados = [];
  let sinLeer = 0;
  const cerrojo = await cliente.getMailboxLock(cfg.carpeta);
  try {
    const nuevos = await cliente.search({ seen: false });
    sinLeer = nuevos.length;
    if (soloProbar) return { conectado: true, carpeta: cfg.carpeta, sinLeer, resultados };

    for (const uid of nuevos) {
      const { content } = await cliente.download(String(uid), undefined, { uid: true });
      const trozos = [];
      for await (const t of content) trozos.push(t);
      const correo = await simpleParser(Buffer.concat(trozos));

      const carpetaDia = path.join(CARPETA, hoy());
      fs.mkdirSync(carpetaDia, { recursive: true });

      const adjuntos = [];
      for (const [i, a] of (correo.attachments ?? []).entries()) {
        const marca = ahora().replace(/[:.]/g, "-");
        const nombre = nombreSeguro(a.filename, i);
        const destino = path.join(carpetaDia, `${marca}_${nombre}`);
        fs.writeFileSync(destino, a.content);
        const item = { fichero: path.relative(CARPETA, destino), bytes: a.content.length };
        if (/\.(xlsx?|csv)$/i.test(nombre)) {
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

      // Marcar como leido SOLO si se ha aplicado de verdad: en simulacion el
      // correo tiene que seguir ahi para poder repetirlo.
      if (aplicar) await cliente.messageFlagsAdd(String(uid), ["\\Seen"], { uid: true });
    }
  } finally {
    cerrojo.release();
    await cliente.logout().catch(() => {});
  }
  return { conectado: true, carpeta: cfg.carpeta, sinLeer, resultados };
}

async function main() {
  const args = process.argv.slice(2);
  const soloProbar = args.includes("--probar");
  const aplicar = args.includes("--aplicar");
  const inicio = new Date().toISOString();

  const r = await leerBuzon({ aplicar, soloProbar });
  // El rastro en la base: /datos/fuentes y el vigilante miran esta señal.
  await anotarEjecucion({
    trabajo: "leer-buzon",
    inicio,
    estado: "ok",
    detalle: r.sinLeer === 0 ? "sin correos nuevos" : `${r.sinLeer} correo(s) sin leer, ${r.resultados.length} procesados`,
    datos: { aplicar, soloProbar },
  });
  console.log(`Buzon "${r.carpeta}": ${r.sinLeer} correo(s) sin leer.`);
  if (soloProbar) return console.log("Conexion correcta. (--probar: no se ha tocado nada)");

  for (const ev of r.resultados) {
    console.log(`\n  "${ev.asunto ?? "(sin asunto)"}" de ${ev.de ?? "?"}`);
    if (ev.sin_adjuntos) { console.log("    sin adjuntos"); continue; }
    for (const a of ev.adjuntos) {
      const b = a.buzon;
      console.log(`    ${path.basename(a.fichero)}` +
        (b ? ` -> ${b.etiqueta ?? b.tipo ?? "?"} [${b.estado}]${b.detalle ? ` ${b.detalle}` : ""}` : " (no es Excel)"));
    }
  }
  if (!aplicar && r.resultados.length) console.log("\n(simulacion: repite con --aplicar)");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(async (e) => {
    // Sin credenciales no es una averia, es un pendiente conocido (ver el .cmd):
    // se deja solo el latido en "aviso" — una fila de error cada 30 minutos por
    // lo mismo enterraria los errores de verdad.
    if (/Faltan las credenciales del buzon/.test(e.message)) {
      await latido("leer-buzon", { estado: "aviso", detalle: "sin configurar: faltan las credenciales IMAP en el .env" });
    } else {
      await anotarEjecucion({ trabajo: "leer-buzon", estado: "error", detalle: e.message });
    }
    console.error("ERROR:", e.message);
    await salirConError(1);
  });
}

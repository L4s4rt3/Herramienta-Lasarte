/**
 * Receptor de los informes del calibrador (Compac Sizer).
 *
 * POR QUÉ ESTO Y NO UN CORREO DE VERDAD. El Sizer puede enviar cada informe de
 * lote por email al cerrarlo, pero es un programa de 2019 que solo habla
 * TLS 1.0, y cualquier servidor de correo moderno exige TLS 1.2 (comprobado
 * contra Resend: rechaza 1.0 y 1.1, acepta 1.2). Ahí se cortaba la conexión
 * antes del login, y por eso el Sizer descartaba el usuario y la contraseña
 * cada vez que se configuraba.
 *
 * La vuelta es no sacar el correo del edificio: este programa se queda
 * escuchando en la red local, el Sizer le entrega el informe sin cifrado y sin
 * contraseña —que dentro de la LAN no hacen falta— y aquí se guarda el adjunto.
 * Desaparecen de golpe el TLS, el login que no persistía, la API key, el
 * proveedor de correo y el "y ahora quién lee ese buzón".
 *
 * QUÉ HACE. Guarda cada adjunto en outputs/calibrador/<fecha>/ y deja una línea
 * por correo en outputs/calibrador/registro.jsonl. NO interpreta todavía el
 * contenido: primero hay que ver un informe real para saber qué formato manda
 * el Sizer (PDF o DOCX). El registro es la red de seguridad: si un día dejan de
 * llegar informes, se ve en el fichero en vez de descubrirlo semanas después.
 *
 * Uso:
 *   node scripts/receptor-informes-calibrador.mjs
 *   node scripts/receptor-informes-calibrador.mjs --puerto=2525   (para probar sin admin)
 *
 * En el Sizer hay que poner: servidor = la IP de este equipo, puerto 25,
 * "Desactivar SSL/TLS" MARCADO y "Requiere Login" DESMARCADO.
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { SMTPServer } from "smtp-server";
import { simpleParser } from "mailparser";
import { parsearInformeCalibrador, validarBloques } from "./lib-informe-calibrador.mjs";
import { subirInforme } from "./lib-subir-informe-calibrador.mjs";
import { abrirZipExport, importarExportSizer } from "./importar-export-calibrador.mjs";
import { latido } from "./lib-registro-ejecuciones.mjs";

try { process.loadEnvFile(path.resolve(".env")); } catch { /* variables de entorno */ }

const args = process.argv.slice(2);
const arg = (n, def) => {
  const f = args.find((a) => a.startsWith(`--${n}=`));
  return f ? f.split("=")[1] : def;
};

const PUERTO = Number(arg("puerto", 25));
const CARPETA = path.resolve(arg("carpeta", "outputs/calibrador"));
const REGISTRO = path.join(CARPETA, "registro.jsonl");
/** Solo la red de la oficina. El cortafuegos ya filtra, esto es el segundo cinturón. */
const RED_PERMITIDA = /^(192\.168\.1\.\d{1,3}|127\.0\.0\.1|::1|::ffff:192\.168\.1\.\d{1,3}|::ffff:127\.0\.0\.1)$/;
const TAMANO_MAX = 40 * 1024 * 1024;

const ahora = () => new Date().toISOString();
const hoy = () => ahora().slice(0, 10);

/** Un nombre de fichero que no se pueda salir de su carpeta ni romper Windows. */
function nombreSeguro(bruto, i) {
  const limpio = String(bruto ?? "")
    .replace(/[/\\:*?"<>|]/g, "_")
    .replace(/^\.+/, "")
    .trim();
  return limpio || `adjunto-${i + 1}.bin`;
}

function anotar(evento) {
  fs.mkdirSync(CARPETA, { recursive: true });
  fs.appendFileSync(REGISTRO, `${JSON.stringify(evento)}\n`, "utf8");
}

/**
 * Lee el informe nada mas llegar, solo para dejar constancia de si se entiende.
 * NO sube nada todavia: primero hay que ver que aguanta varios formatos reales.
 *
 * Nunca lanza: si el parser falla, el correo ya esta guardado en disco y eso es
 * lo importante. El fallo se anota y se mira luego.
 */
const URL_SUPA = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const KEY_SUPA = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = URL_SUPA && KEY_SUPA
  ? createClient(URL_SUPA, KEY_SUPA, { auth: { persistSession: false } })
  : null;

/**
 * Sube el informe a Supabase. Nunca corta el correo: si falla, el .docx ya esta
 * en disco y se reintenta luego con scripts/subir-informes-calibrador.mjs.
 *
 * NO se sube lo que no cuadra consigo mismo: si algun bloque no coincide con su
 * total, el formato ha cambiado y esos numeros no deben entrar en la Herramienta
 * hasta mirarlo.
 */
async function subir(informe, resumen, fichero) {
  if (!supabase) return { subido: false, motivo: "sin credenciales de Supabase en el .env" };
  if (!resumen.cuadra) return { subido: false, motivo: `${resumen.descuadres} bloques no cuadran` };
  try {
    const r = await subirInforme(supabase, informe, fichero);
    return { subido: true, lineas: r.lineas, fecha: r.fecha };
  } catch (e) {
    return { subido: false, motivo: e.message };
  }
}

function resumirInforme(contenido, nombre) {
  if (!/\.docx$/i.test(nombre ?? "")) return null;
  try {
    const r = parsearInformeCalibrador(contenido);
    const porGrupo = {};
    for (const l of r.lineas) {
      const g = l.grupo ?? "sin grupo";
      porGrupo[g] = Math.round((porGrupo[g] ?? 0) + (l.kg ?? 0));
    }
    const descuadres = validarBloques(r.bloques);
    return {
      informe: r,
      lote: r.cabecera.lote,
      // El COMIENZO va al registro aunque no se enseñe: es la otra mitad de la
      // clave de `calibrador_informe` y sin el no se puede saber si una pasada
      // concreta acabo entrando o se quedo por el camino. Ver informesSinSubir.
      comienzo: r.cabecera.comienzo,
      commodity: r.cabecera.commodity,
      productor: r.cabecera.productorNombre,
      productorCodigo: r.cabecera.productorCodigo,
      lineas: r.lineas.length,
      kg: Math.round(r.lineas.reduce((s, l) => s + (l.kg ?? 0), 0)),
      porGrupo,
      bloquesComprobados: r.bloques.filter((b) => b.totalDeclarado).length,
      descuadres: descuadres.length,
      cuadra: descuadres.length === 0,
    };
  } catch (e) {
    return { error: e.message };
  }
}

/**
 * Clasifica e importa un Excel llegado por correo, delegando en
 * scripts/importar-adjunto.ts (que reutiliza el clasificador de /importar).
 *
 * Nunca lanza hacia arriba de forma que tumbe el correo: el fichero ya está en
 * disco, así que un fallo aquí solo significa "habrá que importarlo a mano".
 */
function clasificarEImportar(ruta) {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      ["node_modules/vite-node/vite-node.mjs", "scripts/importar-adjunto.ts", ruta, "--aplicar"],
      { cwd: path.resolve("."), timeout: 120000, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
      (err, stdout) => {
        // La última línea es el JSON; vite-node escribe ruido antes.
        const linea = String(stdout ?? "").trimEnd().split(/\r?\n/).at(-1) ?? "";
        try {
          resolve(JSON.parse(linea));
        } catch {
          resolve({ estado: "error", detalle: err?.message ?? "no se pudo clasificar" });
        }
      },
    );
  });
}

async function guardarCorreo(buffer, ip) {
  const correo = await simpleParser(buffer);
  const carpetaDia = path.join(CARPETA, hoy());
  fs.mkdirSync(carpetaDia, { recursive: true });

  const guardados = [];
  const adjuntos = correo.attachments ?? [];
  for (const [i, a] of adjuntos.entries()) {
    // Marca de tiempo delante: si el Sizer repite el nombre en cada lote (que
    // lo hará), no se pisan unos a otros.
    const marca = ahora().replace(/[:.]/g, "-");
    const nombre = nombreSeguro(a.filename, i);
    const destino = path.join(carpetaDia, `${marca}_${nombre}`);
    fs.writeFileSync(destino, a.content);
    guardados.push({
      fichero: path.relative(CARPETA, destino),
      bytes: a.content.length,
      informe: resumirInforme(a.content, nombre),
    });
  }

  // Subida a Supabase. Va despues de guardar en disco a proposito: si esto
  // falla, el fichero ya esta a salvo y se reintenta con
  // scripts/subir-informes-calibrador.mjs.
  for (const g of guardados) {
    const inf = g.informe;
    if (!inf || inf.error) continue;
    g.subida = await subir(inf.informe, inf, g.fichero);
    // El informe entero (cientos de lineas) NO va al registro: solo el resumen.
    delete inf.informe;
  }

  // Export SQL del Sizer (zip con lotes.csv + clasificacion.csv): se importa
  // entero al llegar. Igual que los DOCX, el fichero ya esta en disco antes de
  // intentarlo; si falla se reintenta con importar-export-calibrador.mjs.
  for (const g of guardados) {
    if (!/\.zip$/i.test(g.fichero)) continue;
    try {
      const csvs = abrirZipExport(fs.readFileSync(path.join(CARPETA, g.fichero)));
      if (!csvs) continue;
      if (!supabase) { g.importExport = { error: "sin credenciales de Supabase" }; continue; }
      console.log(`[${ahora()}] importando export SQL del Sizer…`);
      g.importExport = await importarExportSizer(supabase, csvs);
    } catch (e) {
      g.importExport = { error: e.message };
    }
  }

  // EL BUZON: cualquier Excel que llegue se clasifica con el MISMO clasificador
  // que usa /importar (13 tipos, 23 tests) y se importa si es de los que la app
  // ya importa sin preguntar. Lo que necesita confirmacion humana se queda
  // esperando y se dice — nunca se escribe a espaldas de nadie.
  //
  // Va en un subproceso porque el clasificador es TypeScript y vive en src/:
  // arrancar vite-node cuesta un segundo, pero evita tener aqui una copia de
  // las reglas de reconocimiento que se quedaria atras a la primera.
  for (const g of guardados) {
    if (!/\.(xlsx?|csv)$/i.test(g.fichero)) continue;
    try {
      g.buzon = await clasificarEImportar(path.join(CARPETA, g.fichero));
    } catch (e) {
      g.buzon = { estado: "error", detalle: e.message };
    }
  }

  const evento = {
    recibido: ahora(),
    desde_ip: ip,
    de: correo.from?.text ?? null,
    para: correo.to?.text ?? null,
    asunto: correo.subject ?? null,
    adjuntos: guardados,
    sin_adjuntos: guardados.length === 0,
  };
  anotar(evento);

  const resumen = guardados.length
    ? guardados.map((g) => `${g.fichero} (${Math.round(g.bytes / 1024)} KB)`).join(", ")
    : "SIN ADJUNTOS";
  console.log(`[${evento.recibido}] ${ip} · "${evento.asunto ?? "(sin asunto)"}" → ${resumen}`);
  for (const g of guardados) {
    const inf = g.informe;
    if (!inf) continue;
    if (inf.error) {
      console.error(`   NO SE ENTIENDE EL INFORME: ${inf.error}`);
      continue;
    }
    const grupos = Object.entries(inf.porGrupo).map(([k, v]) => `${k} ${v}`).join(" · ");
    console.log(
      `   lote ${inf.lote} · ${inf.commodity} · ${inf.productor} · ${inf.lineas} lineas · ${inf.kg} kg`,
    );
    console.log(`   ${grupos}`);
    console.log(
      inf.cuadra
        ? `   cuadra: ${inf.bloquesComprobados} bloques comprobados`
        : `   OJO: ${inf.descuadres} bloques NO cuadran con sus totales`,
    );
    if (g.subida?.subido) {
      console.log(`   subido a la Herramienta: ${g.subida.lineas} lineas (${g.subida.fecha})`);
    } else if (g.subida) {
      console.error(`   NO SUBIDO: ${g.subida.motivo}`);
    }
  }
  for (const g of guardados) {
    if (!g.importExport) continue;
    if (g.importExport.error) {
      console.error(`   EXPORT SQL NO IMPORTADO: ${g.importExport.error}`);
    } else {
      const r = g.importExport;
      console.log(`   export SQL importado: ${r.pasadas} pasadas · ${r.lotes} lotes · ${r.filas} filas · ${r.kg} kg`);
    }
  }
  return evento;
}

const servidor = new SMTPServer({
  // Sin cifrado y sin contraseña: es lo que el Sizer sabe hacer y no sale de la LAN.
  authOptional: true,
  disabledCommands: ["AUTH", "STARTTLS"],
  size: TAMANO_MAX,
  banner: "Receptor de informes del calibrador",

  onConnect(sesion, cb) {
    const ip = sesion.remoteAddress;
    if (!RED_PERMITIDA.test(ip)) {
      console.warn(`[${ahora()}] RECHAZADA conexion de ${ip} (fuera de la red de la oficina)`);
      anotar({ recibido: ahora(), desde_ip: ip, evento: "conexion_rechazada" });
      return cb(new Error("Solo se aceptan conexiones de la red local"));
    }
    // Se anota TODA conexion, aunque luego no llegue ningun correo: un intento
    // que se corta (p. ej. el Sizer exigiendo cifrado) no dejaba rastro en disco
    // y solo se veia en la consola, que es justo el fallo mudo que queremos
    // evitar. Con esto, si algo se intenta y falla, queda escrito.
    anotar({ recibido: ahora(), desde_ip: ip, evento: "conexion" });
    console.log(`[${ahora()}] conexion de ${ip}`);
    cb();
  },

  onData(stream, sesion, cb) {
    const trozos = [];
    let bytes = 0;
    stream.on("data", (t) => { trozos.push(t); bytes += t.length; });
    stream.on("end", () => {
      if (stream.sizeExceeded) {
        console.error(`[${ahora()}] correo DEMASIADO GRANDE (${bytes} bytes), rechazado`);
        return cb(new Error("Mensaje demasiado grande"));
      }
      guardarCorreo(Buffer.concat(trozos), sesion.remoteAddress)
        .then(() => cb())
        .catch((e) => {
          // Se anota el fallo pero se acepta el correo: si se rechaza, el Sizer
          // lo da por perdido y ese informe no vuelve. Mejor guardarlo crudo.
          const crudo = path.join(CARPETA, hoy(), `${ahora().replace(/[:.]/g, "-")}_sin-parsear.eml`);
          try {
            fs.mkdirSync(path.dirname(crudo), { recursive: true });
            fs.writeFileSync(crudo, Buffer.concat(trozos));
          } catch { /* si ni eso se puede, queda el registro */ }
          anotar({ recibido: ahora(), desde_ip: sesion.remoteAddress, error: e.message, crudo });
          console.error(`[${ahora()}] no se pudo interpretar el correo: ${e.message} — guardado crudo`);
          cb();
        });
    });
  },
});

servidor.on("error", (e) => {
  if (e.code === "EACCES") {
    console.error(`El puerto ${PUERTO} necesita permisos de administrador. Prueba --puerto=2525.`);
  } else if (e.code === "EADDRINUSE") {
    console.error(`El puerto ${PUERTO} ya esta ocupado por otro programa.`);
  } else {
    console.error(`Error del servidor: ${e.message}`);
  }
});

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  fs.mkdirSync(CARPETA, { recursive: true });
  servidor.listen(PUERTO, "0.0.0.0", () => {
    console.log(`Receptor escuchando en el puerto ${PUERTO} (todas las interfaces)`);
    console.log(`Guardando en ${CARPETA}`);
    console.log("Para parar: Ctrl+C");
    // El latido: /datos/fuentes y el vigilante miran esta señal para saber que
    // el receptor sigue escuchando — el 13-08 estuvo diez horas muerto y solo
    // se supo por los informes que faltaban. Cada 5 min, lo que tarda su tarea
    // en relanzarlo si muere: un hueco mayor ya es una caida de verdad.
    const darSenal = () => latido("receptor", { detalle: `escuchando en el puerto ${PUERTO}` });
    darSenal();
    setInterval(darSenal, 5 * 60 * 1000).unref();
  });
}

export { guardarCorreo, nombreSeguro };

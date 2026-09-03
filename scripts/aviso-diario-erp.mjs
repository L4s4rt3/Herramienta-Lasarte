/**
 * Aviso diario: que paso AYER, y deja el parte listo para rellenar a mano.
 *
 * POR QUE DEL DIA ANTERIOR. La tarea corre a las 7:10, asi que ayer ya esta
 * cerrado: los numeros no se mueven mientras lo lees.
 *
 * DOS MITADES (Fase 2 de docs/SISTEMA_LASARTE.md, 02-09-2026):
 *   - ERP  (lib-aviso-erp.mjs):  partes + palets del ERP + GSTOCK. Necesita la
 *     red de la oficina. Deja su resultado en sistema_ejecuciones ("tarea-erp").
 *   - NUBE (lib-aviso-nube.mjs): informes, analisis, estimacion, cuadre,
 *     lecturas, correo. Solo habla con Supabase; lo del ERP lo recibe hecho.
 *
 * Este fichero es el orquestador. SIN FLAGS corre las dos mitades seguidas, en
 * este proceso, exactamente como antes del corte: es lo que llama
 * tarea-diaria-erp.cmd a las 07:10. Con flags se pueden correr por separado,
 * que es el ensayo del paso 3 (llevar la nube a una edge function):
 *
 *   node scripts/aviso-diario-erp.mjs                 # las dos mitades (produccion)
 *   node scripts/aviso-diario-erp.mjs --solo-erp      # solo la mitad ERP, y guarda
 *   node scripts/aviso-diario-erp.mjs --solo-nube     # solo la nube, leyendo el ERP de la base
 *   node scripts/aviso-diario-erp.mjs --sin-enviar    # todo menos el correo
 *   node scripts/aviso-diario-erp.mjs --fecha=2026-08-30
 *   node scripts/aviso-diario-erp.mjs --solo-nube --solo-si-falta
 *       # la RED DE SEGURIDAD que corre FUERA del portatil (GitHub Actions,
 *       # .github/workflows/aviso-diario-nube.yml, 12:45 Madrid): si el correo
 *       # de hoy ya salio, no hace nada; si no, manda el correo diciendo que la
 *       # mitad ERP no ha corrido. Asi un portatil apagado ya no es silencio.
 *
 * Y en cualquier modo: si el correo de hoy ya consta como enviado en la base
 * (sistema_ejecuciones), no se vuelve a enviar aunque se ejecute otra vez.
 *
 * El texto del correo vive en lib-aviso-diario.mjs (puro, con tests).
 */
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { comoFecha } from "./lib-aviso-diario.mjs";
import { ejecutarMitadErp, guardarResultadoErp, leerResultadoErp } from "./lib-aviso-erp.mjs";
import { ejecutarMitadNube } from "./lib-aviso-nube.mjs";
import { anotarEjecucion, salirConError } from "./lib-registro-ejecuciones.mjs";

try { process.loadEnvFile(path.resolve(".env")); } catch { /* entorno */ }

/**
 * ¿El correo de `ayer` ya salio hoy? Se mira en la base, no en el disco: el
 * .cmd del portatil tiene su marca en outputs/, pero la red de seguridad de
 * GitHub no ve ese disco, y las dos no pueden mandar el mismo correo.
 */
async function avisoYaEnviado(supabase, ayer) {
  const { data, error } = await supabase.from("sistema_ejecuciones")
    .select("datos").eq("trabajo", "tarea-diaria")
    .gte("inicio", `${ayer}T00:00:00Z`).order("inicio", { ascending: false }).limit(20);
  if (error) throw new Error(`comprobando si el aviso ya salio: ${error.message}`);
  return (data ?? []).some((r) => r.datos?.fecha === ayer && r.datos?.envio === "enviado");
}

async function main() {
  const inicioEjecucion = new Date().toISOString();
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Faltan SUPABASE_URL y/o SUPABASE_SERVICE_ROLE_KEY.");
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  const soloErp = process.argv.includes("--solo-erp");
  const soloNube = process.argv.includes("--solo-nube");
  const soloSiFalta = process.argv.includes("--solo-si-falta");
  let enviar = !process.argv.includes("--sin-enviar");
  const hoy = new Date();
  // --fecha= sirve para rehacer el informe de un dia concreto (p. ej. cuando el
  // volcado del calibrador llega tarde y el correo salio sin produccion).
  const ayer = process.argv.find((a) => a.startsWith("--fecha="))?.split("=")[1]
    ?? comoFecha(new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() - 1));

  // 0. ¿Ya salio el correo de hoy? La red de seguridad entonces no hace nada;
  //    cualquier otra ejecucion sigue (repasa, analiza, cuadra) pero sin enviar.
  if (enviar && await avisoYaEnviado(supabase, ayer)) {
    if (soloSiFalta) {
      console.log(`El correo del ${ayer} ya salio hoy: la red de seguridad no tiene nada que hacer.`);
      return;
    }
    console.log(`El correo del ${ayer} ya salio hoy: esta ejecucion no lo reenvia.`);
    enviar = false;
  }

  // 1. La mitad ERP (o su resultado de hoy, ya guardado).
  let erp = null;
  if (soloNube) {
    erp = await leerResultadoErp(supabase, ayer);
    console.log(erp
      ? `Mitad ERP del ${ayer} leida de la base (corrio a las ${String(erp.inicio).slice(11, 16)} UTC).`
      : `Sin resultado de la mitad ERP para el ${ayer} en la base: el correo lo dira.`);
  } else {
    erp = await ejecutarMitadErp(supabase, ayer);
    const guardado = await guardarResultadoErp(supabase, erp);
    console.log(`Mitad ERP del ${ayer}: parte ${erp.parte?.accion ?? "?"}, GSTOCK ${erp.gstock?.accion ?? "sin-resultado"}` +
      `${erp.gstockRehechos.length ? `, ${erp.gstockRehechos.length} rehecho(s)` : ""}${guardado ? "" : " (NO guardado en la base)"}.`);
    if (soloErp) return;
  }

  // 2. La mitad nube: todo lo demas, y el correo.
  const { asunto, hayProblema, envio } = await ejecutarMitadNube(supabase, { ayer, hoy, erp, url, key, enviar });

  // El rastro del dia EN LA BASE: es lo que enseña /datos/fuentes y lo que el
  // vigilante comprueba desde fuera del portatil. "aviso" = corrio, pero el
  // correo salio con cosas que revisar.
  await anotarEjecucion({
    trabajo: "tarea-diaria",
    inicio: inicioEjecucion,
    estado: hayProblema ? "aviso" : "ok",
    detalle: asunto,
    datos: { fecha: ayer, envio, mitades: soloNube ? "nube" : "erp+nube", redDeSeguridad: soloSiFalta },
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

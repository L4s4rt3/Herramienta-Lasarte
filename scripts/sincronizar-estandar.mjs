/**
 * sincronizar-estandar.mjs — el espejo JSON del estándar de kg/persona.
 *
 * POR QUÉ (04-09-2026). El estándar por régimen de plantilla pasa a vivir en la
 * tabla public.estandar_rendimiento (lo edita el admin desde la app: Económico
 * → Rentabilidad → Por tipo de día). Los informes en Python de la encargada
 * (scripts/informe-produccion/comun_informes.py) y el correo diario
 * (correo-diario.mjs) no hablan con la base para esto: leen
 * scripts/informe-produccion/estandar.json. Este script copia la fila al JSON
 * con EL MISMO formato de siempre, para que ninguno de los dos tenga que cambiar.
 *
 * - Sin --aplicar solo enseña qué cambiaría (simulación, como el resto de scripts).
 * - No reescribe el fichero si el texto es idéntico: el espejo no genera ruido
 *   en git ni fechas de modificación falsas.
 * - Deja rastro en sistema_ejecuciones/sistema_latidos (trabajo
 *   "sincronizar-estandar") cuando corre de verdad, como los demás trabajos del
 *   portátil; la simulación no late (no es una ejecución).
 *
 * Uso:
 *   node scripts/sincronizar-estandar.mjs            # simulación
 *   node scripts/sincronizar-estandar.mjs --aplicar  # escribe el JSON si cambia
 *
 * Requiere SUPABASE_URL (o VITE_SUPABASE_URL) y SUPABASE_SERVICE_ROLE_KEY en .env
 * (service role: la tabla tiene RLS y la lee cualquier sesión, pero el portátil
 * no tiene sesión de usuario). No imprime ninguna clave.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { anotarEjecucion, salirConError } from "./lib-registro-ejecuciones.mjs";

try { process.loadEnvFile(path.resolve(".env")); } catch { /* entorno */ }

const AQUI = path.dirname(fileURLToPath(import.meta.url));
export const FICHERO_ESTANDAR = path.join(AQUI, "informe-produccion", "estandar.json");
const TRABAJO = "sincronizar-estandar";

/**
 * Fila de estandar_rendimiento → objeto con la forma del JSON. Es la MISMA
 * traducción que estandarDesdeFila en
 * supabase/functions/_shared/estandarRendimiento.ts (los .mjs del portátil no
 * importan TypeScript; el test estandarRendimiento.test.ts vigila el lado TS y
 * la primera ejecución real, 04-09-2026, comprobó que el JSON salía idéntico
 * al que había).
 */
export function jsonDesdeFila(fila) {
  return {
    cortePlantillaReducida: Number(fila.corte_plantilla_reducida),
    regimenes: {
      completa: { kgPersonaSuelo: Number(fila.completa_suelo), kgPersonaObjetivo: Number(fila.completa_objetivo) },
      reducida: { kgPersonaSuelo: Number(fila.reducida_suelo), kgPersonaObjetivo: Number(fila.reducida_objetivo) },
    },
    decididoPor: fila.decidido_por ?? "el dueño",
    fecha: fila.fecha,
    // Python y el correo diario no leen la nota; se copia para quien abra el
    // fichero. Sin nota en la fila, cadena vacía (el JSON siempre trae texto).
    nota: fila.nota ?? "",
  };
}

/**
 * El texto EXACTO con el que se escribe el fichero: sangría de un espacio y
 * cada régimen en una sola línea, como está desde el 27-08. JSON.stringify a
 * secas lo partiría en doce líneas y el diff de git dejaría de leerse de un
 * vistazo. Termina en salto de línea.
 */
export function textoEstandarJson(est) {
  const j = (v) => JSON.stringify(v);
  const regimen = (r) => `{ "kgPersonaSuelo": ${j(r.kgPersonaSuelo)}, "kgPersonaObjetivo": ${j(r.kgPersonaObjetivo)} }`;
  return [
    "{",
    ` "cortePlantillaReducida": ${j(est.cortePlantillaReducida)},`,
    ' "regimenes": {',
    `  "completa": ${regimen(est.regimenes.completa)},`,
    `  "reducida": ${regimen(est.regimenes.reducida)}`,
    " },",
    ` "decididoPor": ${j(est.decididoPor)},`,
    ` "fecha": ${j(est.fecha)},`,
    ` "nota": ${j(est.nota)}`,
    "}",
    "",
  ].join("\n");
}

/** "regimenes.completa.kgPersonaSuelo: 1700 → 1800", campo a campo. */
export function diferencias(antes, despues) {
  const plano = (o, prefijo = "") => Object.entries(o ?? {}).flatMap(([k, v]) =>
    v !== null && typeof v === "object" ? plano(v, `${prefijo}${k}.`) : [[`${prefijo}${k}`, v]]);
  const a = new Map(plano(antes));
  const d = new Map(plano(despues));
  return [...new Set([...a.keys(), ...d.keys()])]
    .filter((k) => JSON.stringify(a.get(k)) !== JSON.stringify(d.get(k)))
    .map((k) => `${k}: ${JSON.stringify(a.get(k))} → ${JSON.stringify(d.get(k))}`);
}

/**
 * Lee la fila y deja el fichero como debe estar. Devuelve { accion, cambios, fila }:
 *   sin-cambios   el fichero ya es idéntico (no se toca)
 *   simulado      cambiaría, pero no se ha pedido --aplicar
 *   actualizado   escrito con valores nuevos
 *   reformateado  escrito con los mismos valores (alguien lo había editado a mano)
 */
export async function sincronizarEstandar(supabase, { aplicar = false, fichero = FICHERO_ESTANDAR } = {}) {
  const { data, error } = await supabase.from("estandar_rendimiento").select("*").eq("id", true).maybeSingle();
  if (error) throw new Error(`leyendo estandar_rendimiento: ${error.message}`);
  if (!data) throw new Error("estandar_rendimiento no tiene fila: falta la semilla de la migración estandar_rendimiento");

  const nuevo = jsonDesdeFila(data);
  let textoActual = null;
  let actual = null;
  try {
    textoActual = fs.readFileSync(fichero, "utf8");
    actual = JSON.parse(textoActual);
  } catch { /* sin fichero o ilegible: se escribe entero */ }

  // Se respeta el final de línea que ya tenga el fichero (git en Windows).
  const eol = textoActual?.includes("\r\n") ? "\r\n" : "\n";
  const texto = textoEstandarJson(nuevo).replace(/\n/g, eol);
  const cambios = diferencias(actual, nuevo);

  if (textoActual === texto) return { accion: "sin-cambios", cambios: [], fila: data };
  if (!aplicar) return { accion: "simulado", cambios, fila: data };
  fs.writeFileSync(fichero, texto, "utf8");
  return { accion: cambios.length > 0 ? "actualizado" : "reformateado", cambios, fila: data };
}

const esPrincipal = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (esPrincipal) {
  const aplicar = process.argv.includes("--aplicar");
  const inicio = new Date().toISOString();
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error(`[${TRABAJO}] faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY en el entorno (.env)`);
    process.exit(2);
  }
  const supabase = createClient(url, key, { auth: { persistSession: false } });
  try {
    const r = await sincronizarEstandar(supabase, { aplicar });
    const vigente = `estándar del ${r.fila.fecha}, decidido por ${r.fila.decidido_por}`;
    const resumen = r.cambios.length > 0 ? r.cambios.join("; ") : "mismos valores";
    const detalle = {
      "sin-cambios": `estandar.json ya refleja la tabla (${vigente})`,
      simulado: `SIMULACIÓN: cambiaría ${resumen}. Añade --aplicar para escribir`,
      actualizado: `estandar.json actualizado (${vigente}): ${resumen}`,
      reformateado: `estandar.json reescrito con el formato canónico (${vigente}, mismos valores)`,
    }[r.accion];
    console.log(`[${TRABAJO}] ${detalle}`);
    if (r.accion !== "simulado") {
      await anotarEjecucion({
        trabajo: TRABAJO, inicio, estado: "ok", detalle,
        datos: { accion: r.accion, cambios: r.cambios, fecha_estandar: r.fila.fecha, estandar_actualizado_en: r.fila.updated_at },
      });
    }
  } catch (e) {
    console.error(`[${TRABAJO}] ERROR: ${e.message}`);
    await anotarEjecucion({ trabajo: TRABAJO, inicio, estado: "error", detalle: e.message });
    await salirConError(1);
  }
}

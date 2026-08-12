/**
 * Sube a Supabase los informes del calibrador que haya en outputs/calibrador.
 *
 * Sirve para poner al día lo que ya llegó antes de que el receptor supiera
 * subirlos, y para reintentar si algún día falla la subida (es idempotente:
 * pasarlo dos veces deja la base igual).
 *
 *   node scripts/subir-informes-calibrador.mjs              # simulacion
 *   node scripts/subir-informes-calibrador.mjs --aplicar
 */
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { parsearInformeCalibrador, validarBloques } from "./lib-informe-calibrador.mjs";
import { subirInforme } from "./lib-subir-informe-calibrador.mjs";

try { process.loadEnvFile(path.resolve(".env")); } catch { /* variables de entorno */ }

const aplicar = process.argv.includes("--aplicar");
const dir = path.resolve("outputs/calibrador");

const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Faltan SUPABASE_URL y/o SUPABASE_SERVICE_ROLE_KEY en el .env.");
  process.exit(1);
}
const supabase = createClient(url, key, { auth: { persistSession: false } });

const ficheros = fs.existsSync(dir)
  ? fs.readdirSync(dir, { recursive: true })
      .map((f) => path.join(dir, String(f)))
      .filter((f) => f.endsWith(".docx")).sort()
  : [];
if (!ficheros.length) {
  console.error(`No hay ningun .docx en ${dir}.`);
  process.exit(1);
}

console.log(`${ficheros.length} informe(s) · modo ${aplicar ? "APLICAR" : "simulacion"}\n`);
let fallos = 0;

for (const f of ficheros) {
  const rel = path.relative(dir, f);
  try {
    const r = parsearInformeCalibrador(fs.readFileSync(f));
    const descuadres = validarBloques(r.bloques);
    if (descuadres.length) {
      // No se sube algo que no cuadra consigo mismo: primero hay que mirarlo.
      fallos += 1;
      console.error(`${rel}\n  NO SE SUBE: ${descuadres.length} bloques no cuadran con sus totales`);
      continue;
    }
    const kg = Math.round(r.lineas.reduce((s, l) => s + (l.kg ?? 0), 0));
    if (!aplicar) {
      console.log(`${rel}\n  lote ${r.cabecera.lote} · ${r.lineas.length} lineas · ${kg} kg (simulacion)`);
      continue;
    }
    const res = await subirInforme(supabase, r, rel);
    console.log(`${rel}\n  lote ${res.lote} (${res.fecha}) · ${res.lineas} lineas · ${kg} kg subido`);
  } catch (e) {
    fallos += 1;
    console.error(`${rel}\n  ERROR: ${e.message}`);
  }
}

console.log(fallos === 0 ? "\nTodo correcto." : `\n${fallos} informe(s) con problemas.`);
process.exit(fallos === 0 ? 0 : 1);

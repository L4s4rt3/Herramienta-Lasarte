/**
 * Revisa los partes: comprueba, intenta cuadrar lo que se pueda y dice qué se
 * cree que ha pasado con lo que no.
 *
 * Es el mismo paso que corre la tarea de la mañana antes de mandar el correo
 * (ver lib-aviso-nube.mjs); aquí suelto para poder mirar un día concreto o
 * repasar la semana a mano sin mandar nada a nadie.
 *
 *   node scripts/revisar-partes.mjs                       # ayer, simulacion
 *   node scripts/revisar-partes.mjs --fecha=2026-09-10
 *   node scripts/revisar-partes.mjs --dias=7 --aplicar    # repasa y deja la marca
 *
 * Con --aplicar rehace los partes que no cuadren con su detalle (nunca uno
 * Validado) y guarda en cada parte la marca de revision. Sin --aplicar no
 * escribe nada: solo cuenta como esta.
 *
 * Sale con codigo 1 si algun dia queda con reparos, para poder colgarlo de una
 * tarea y enterarse sin leer la salida.
 */
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { revisarVentana } from "./lib-revision-parte.mjs";

try { process.loadEnvFile(path.resolve(".env")); } catch { /* entorno */ }

const dd = (n) => String(n).padStart(2, "0");
const comoFecha = (d) => `${d.getFullYear()}-${dd(d.getMonth() + 1)}-${dd(d.getDate())}`;

const ICONO = { ok: "  ok ", reparo: "FALTA", "n/a": "  -  " };

async function main() {
  const args = process.argv.slice(2);
  const aplicar = args.includes("--aplicar");
  const argOf = (n) => args.find((a) => a.startsWith(`--${n}=`))?.split("=")[1];

  const hoy = new Date();
  const ayer = comoFecha(new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() - 1));
  const una = argOf("fecha");
  const dias = Number(argOf("dias") ?? 1);
  const fechas = una
    ? [una]
    : Array.from({ length: Math.max(1, dias) }, (_, i) =>
      comoFecha(new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() - dias + i)));

  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Faltan SUPABASE_URL y/o SUPABASE_SERVICE_ROLE_KEY.");
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  const revisiones = await revisarVentana(supabase, fechas, { hoy: comoFecha(hoy), aplicar, url, key });

  let conReparos = 0;
  for (const r of revisiones) {
    if (r.veredicto === "error") {
      conReparos++;
      console.log(`\n${r.fecha}  ERROR: ${r.motivo}`);
      continue;
    }
    const MARCAS = { "en-orden": "EN ORDEN", "sin-parte": "SIN PARTE", "sin-actividad": "sin actividad" };
    const marca = MARCAS[r.veredicto] ?? "CON REPAROS";
    console.log(`\n${r.fecha}  ${marca}${r.estado ? ` (${r.estado})` : ""}${r.fecha === ayer ? "   <- el del correo de hoy" : ""}`);
    for (const c of r.comprobaciones) {
      console.log(`  [${ICONO[c.estado] ?? c.estado}] ${c.titulo}: ${c.detalle}`);
    }
    if (r.dsj) console.log(`  Descuadre: ${r.dsj.kg.toLocaleString("es-ES")} kg (${r.dsj.pct}%)`);
    for (const x of r.reparaciones) console.log(`  > ${x}`);
    for (const x of r.diagnostico) console.log(`  ? ${x}`);
    // Un dia sin actividad no cuenta ni a favor ni en contra: no hay dia.
    if (r.veredicto !== "en-orden" && r.veredicto !== "sin-actividad") conReparos++;
  }

  const conDia = revisiones.filter((r) => r.veredicto !== "sin-actividad").length;
  console.log(`\n${conDia - conReparos} de ${conDia} dia(s) con trabajo en orden.`);
  if (!aplicar) console.log("(simulacion: repite con --aplicar para reparar y dejar la marca)");
  if (conReparos > 0) process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
}

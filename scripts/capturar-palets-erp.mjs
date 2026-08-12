/**
 * Guarda una foto del total de palets del ERP. Se lanza varias veces al día.
 *
 * PARA QUÉ. `kg_palets_brutos` sale hoy de un Excel del GSTOCK que alguien saca
 * a media tarde. Leer el ERP a la mañana siguiente NO vale: se probó el
 * 12-08-2026 y el |DSJ| medio empeora de 4,66% a 13,39%, porque después del
 * cierre siguen apareciendo palets de regularización con esa misma fecha de lote
 * (el 1-jul hay uno de 67.400 kg, que no es un palet físico). Lo que hay que
 * averiguar es A QUÉ HORA el ERP dice lo mismo que el Excel.
 *
 * Y DE PROPINA, lo que se buscaba: la diferencia entre el total final del día y
 * la foto del cierre es lo que quedó SIN DAR DE ALTA — el número que hoy se
 * cuenta a mano. No se puede sacar de otra forma: el ERP le pone a cada palet la
 * fecha de su lote de confección, no la de cuándo se teclea, así que en la base
 * no queda ni un rastro del momento del alta.
 *
 * ESTO NO ESCRIBE EN NINGÚN PARTE. Solo acumula fotos, para poder elegir la hora
 * con datos y no a ojo. Sobre el ERP, solo SELECT.
 *
 *   node scripts/capturar-palets-erp.mjs              # la foto de hoy
 *   node scripts/capturar-palets-erp.mjs --fecha=2026-08-11
 */
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { conectarErp, paletsDelDia } from "./lib-palets-erp.mjs";

try { process.loadEnvFile(path.resolve(".env")); } catch { /* entorno */ }

const dd = (n) => String(n).padStart(2, "0");
const comoFecha = (d) => `${d.getFullYear()}-${dd(d.getMonth() + 1)}-${dd(d.getDate())}`;

export async function capturarFoto(supabase, conn, fecha) {
  const e = await paletsDelDia(conn, fecha);
  if (!e) return { fecha, guardada: false, motivo: "el ERP no tiene palets ese dia" };

  const { error } = await supabase.from("erp_palets_foto").insert({
    dia: fecha,
    kg_netos: e.netos,
    kg_egipto: e.egipto,
    kg_campo: e.campo,
    palets: e.palets,
    sin_valorar: e.sinValorar,
    kg_mayor_palet: e.mayor ?? null,
  });
  if (error) throw new Error(`insert foto: ${error.message}`);
  return { fecha, guardada: true, ...e };
}

async function main() {
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Faltan SUPABASE_URL y/o SUPABASE_SERVICE_ROLE_KEY.");
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  const arg = process.argv.find((a) => a.startsWith("--fecha="))?.split("=")[1];
  const fecha = arg ?? comoFecha(new Date());

  const conn = await conectarErp();
  let r;
  try {
    r = await capturarFoto(supabase, conn, fecha);
  } finally {
    await conn.end().catch(() => {});
  }

  if (!r.guardada) return console.log(`${fecha}: ${r.motivo}`);
  console.log(`Foto del ${fecha}: ${r.palets} palets · ${Math.round(r.netos).toLocaleString("es")} kg` +
    (r.sinValorar > 0 ? ` · ${r.sinValorar} sin valorar todavia` : ""));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
}

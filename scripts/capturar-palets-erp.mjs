/**
 * Guarda una foto del total de palets del ERP. Se lanza cada hora.
 *
 * PARA QUÉ SIRVEN LAS FOTOS (idea de las que dan de alta, 12-08-2026):
 *
 *   1. LA HORA DEL CIERRE. `kg_palets_brutos` sale de un listado de palets que
 *      alguien saca cuando termina de dar de alta. Esa hora se mueve: ahora
 *      terminan sobre las 13:00-13:10, y con horario normal serán las 14:00 o
 *      las 15:00. Con fotos cada hora la hora se DEDUCE de los datos en vez de
 *      preguntarla (ver detectar-cierre-alta.mjs).
 *
 *   2. EL INVENTARIO SIN DAR DE ALTA, que hoy se pesa y se cuenta a mano. Es la
 *      diferencia entre la foto del cierre y la foto de la mañana siguiente:
 *      los palets de ESE día que se dieron de alta después. Por eso se fotografía
 *      AYER además de HOY — por la mañana, lo que interesa medir es cuánto ha
 *      crecido el día anterior desde que se cerró.
 *
 * Leer el ERP sin más a la mañana siguiente NO vale como sustituto del listado:
 * se probó el 12-08-2026 y el |DSJ| medio empeora de 4,66% a 13,39%, porque
 * después del cierre aparecen palets desmontados apuntados con la fecha del lote
 * (el 1-jul uno de 67.400 kg, que no es un palet físico).
 *
 * ESTO NO ESCRIBE EN NINGÚN PARTE. Solo acumula fotos. Sobre el ERP, solo SELECT.
 *
 *   node scripts/capturar-palets-erp.mjs              # ayer y hoy
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
  const hoy = new Date();
  const ayer = comoFecha(new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() - 1));
  // Ayer TAMBIEN: por la mañana, lo que hay que medir es cuanto ha crecido el
  // dia anterior desde que se cerro — eso es el inventario que quedo sin alta.
  const fechas = arg ? [arg] : [ayer, comoFecha(hoy)];

  const conn = await conectarErp();
  try {
    for (const fecha of fechas) {
      const r = await capturarFoto(supabase, conn, fecha);
      if (!r.guardada) { console.log(`${fecha}: ${r.motivo}`); continue; }
      console.log(`Foto del ${fecha}: ${r.palets} palets · ${Math.round(r.netos).toLocaleString("es")} kg` +
        (r.sinValorar > 0 ? ` · ${r.sinValorar} sin valorar todavia` : ""));
    }
  } finally {
    await conn.end().catch(() => {});
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
}

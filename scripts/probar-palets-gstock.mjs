/**
 * ¿El ERP reproduce el número que hoy sale del archivo GSTOCK subido a mano?
 *
 * Compara `paletsDelDia()` (lib-palets-erp.mjs) contra el `kg_palets_brutos`
 * de los partes ya cerrados. NO escribe nada, ni en el ERP ni en Supabase.
 *
 * QUÉ ESPERAR. No sale 100% y no es un fallo: el Excel era una foto del ERP a
 * media tarde y los palets de granel se valoran después (ver la cabecera de
 * lib-palets-erp.mjs). Lo que este test protege es la DIRECCIÓN del error: el
 * ERP debe dar igual o MÁS, nunca MUCHO menos.
 *
 * El margen es 1.000 kg (~1% de un día normal). Medido el 12-ago-2026 sobre 51
 * partes desde junio: 15 idénticos, 30 con el ERP por encima, y 6 por debajo
 * de entre 1 y 499 kg — palets anulados después de sacar el Excel. Si algún día
 * el ERP se queda corto de miles de kilos, la fórmula se ha roto y hay que
 * mirarlo ANTES de que ese número entre en un parte.
 *
 *   node scripts/probar-palets-gstock.mjs
 */
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { conectarErp, paletsDelDia } from "./lib-palets-erp.mjs";

try { process.loadEnvFile(path.resolve(".env")); } catch { /* entorno */ }

async function main() {
  const supabase = createClient(
    process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  const { data: partes, error } = await supabase.from("partes_diarios")
    .select("date, kg_palets_brutos, kg_palets_egipto, kg_palets_campo")
    .gt("kg_palets_brutos", 0).gte("date", "2026-06-01").order("date");
  if (error) throw new Error(error.message);

  const conn = await conectarErp();
  const filas = [];
  try {
    for (const p of partes) filas.push([p, await paletsDelDia(conn, p.date)]);
  } finally {
    await conn.end();
  }

  const MARGEN_KG = 1000;
  let iguales = 0, erpMas = 0, erpMenosPoco = 0, erpMenosMucho = 0, sinDato = 0;
  let campoOk = 0;
  const graves = [];
  for (const [p, e] of filas) {
    if (!e) { sinDato++; continue; }
    const dif = e.netos - Number(p.kg_palets_brutos);
    if (Math.abs(dif) < 1) iguales++;
    else if (dif > 0) erpMas++;
    else if (dif > -MARGEN_KG) erpMenosPoco++;
    else {
      erpMenosMucho++;
      graves.push(`${p.date}: ERP ${Math.round(e.netos).toLocaleString("es")} < parte ${Math.round(p.kg_palets_brutos).toLocaleString("es")} (${Math.round(dif).toLocaleString("es")} kg)`);
    }
    if (Math.abs(e.campo - Number(p.kg_palets_campo)) < 1) campoOk++;
  }

  const n = filas.length;
  const pct = (x) => `${((x / n) * 100).toFixed(1)}%`;
  console.log(`Partes comparados desde el 1-jun: ${n}`);
  console.log(`  identicos al kilo................ ${iguales} (${pct(iguales)})`);
  console.log(`  el ERP da MAS.................... ${erpMas} (${pct(erpMas)})   <- esperado: la foto del Excel iba incompleta`);
  console.log(`  el ERP da menos, por debajo de ${MARGEN_KG} kg.. ${erpMenosPoco}   <- palets anulados despues, tolerable`);
  console.log(`  el ERP se queda MUY corto........ ${erpMenosMucho}   <- esto romperia el DSJ`);
  console.log(`  sin palets en el ERP............. ${sinDato}`);
  console.log(`\n  kg de "campo" identicos.......... ${campoOk} de ${n}`);
  if (graves.length) console.log(`\nDias graves:\n  ${graves.join("\n  ")}`);

  console.log(erpMenosMucho === 0 ? "\nLa formula se sostiene." : "\nLA FORMULA SE HA ROTO: revisar antes de usarla.");
  process.exit(erpMenosMucho === 0 ? 0 : 1);
}

main().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });

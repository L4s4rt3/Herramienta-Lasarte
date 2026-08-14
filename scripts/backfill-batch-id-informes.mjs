/**
 * Rellena `calibrador_informe.batch_id` y quita lo provisional que el volcado ya
 * cubre.
 *
 * DOS COSAS, porque son la misma historia:
 *
 * 1. EL PUENTE. El batch_id de un DOCX se calcula con un hash de JavaScript
 *    (batchIdDeDocx), asi que las filas viejas de `calibrador_informe` no lo
 *    tienen y desde SQL no hay forma de saber de que dia son sus lineas. Se
 *    calcula aqui y se escribe. Ver la migracion 20260814140000.
 *
 * 2. LOS DUPLICADOS. `importar-export-calibrador.mjs` borra lo provisional de
 *    los lotes que vuelca, pero eso solo sirve cuando el volcado llega DESPUES
 *    del DOCX. Al reves no: el 11-08-2026 el volcado entro el dia 12 y los DOCX
 *    de ese mismo dia llegaron el 13, asi que el lote acabo con las dos fuentes.
 *    Mientras nadie sumara los negativos daba igual; desde que el
 *    aprovechamiento los cuenta, son kilos por duplicado. subirInforme ya no los
 *    escribe, pero los que hay se quitan aqui.
 *
 *   node scripts/backfill-batch-id-informes.mjs             # simulacion
 *   node scripts/backfill-batch-id-informes.mjs --aplicar
 */
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { batchIdDeDocx } from "./lib-subir-informe-calibrador.mjs";

try { process.loadEnvFile(path.resolve(".env")); } catch { /* entorno */ }

async function todas(query, paso = 1000) {
  const filas = [];
  for (let d = 0; ; d += paso) {
    const { data, error } = await query().range(d, d + paso - 1);
    if (error) throw new Error(error.message);
    filas.push(...(data ?? []));
    if (!data || data.length < paso) return filas;
  }
}

async function main() {
  const aplicar = process.argv.includes("--aplicar");
  const supabase = createClient(
    process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  // 1. El puente.
  const informes = await todas(() => supabase.from("calibrador_informe")
    .select("lote, comienzo, batch_id").is("batch_id", null).order("lote").order("comienzo"));
  console.log(`Informes sin batch_id: ${informes.length}`);
  if (aplicar) {
    for (const i of informes) {
      const { error } = await supabase.from("calibrador_informe")
        .update({ batch_id: batchIdDeDocx(i.lote, i.comienzo) })
        .eq("lote", i.lote).eq("comienzo", i.comienzo);
      if (error) throw new Error(`${i.lote}: ${error.message}`);
    }
    console.log(`  ${informes.length} rellenados.`);
  }

  // 2. Los duplicados, POR (LOTE, DIA) — nunca por lote a secas.
  //
  // El 14-08-2026 esto se hizo por lote y borro de mas: el 26051506 y el
  // 26051907 se pasaron el 11 (volcado) y OTRA VEZ el 12 (solo DOCX), asi que
  // quitarles todo lo provisional dejo al dia 12 sin 22.598 kg. Un lote solo
  // esta duplicado el dia en que las dos fuentes lo cubren.
  const ocho = (s) => String(s ?? "").match(/\d{8}/)?.[0] ?? null;
  const batches = await todas(() => supabase.from("calibrador_batch")
    .select("lote, inicio").order("batch_id"));
  const volcadoLoteDia = new Set(batches
    .filter((b) => ocho(b.lote))
    .map((b) => `${ocho(b.lote)}|${b.inicio.slice(0, 10)}`));

  const infos = await todas(() => supabase.from("calibrador_informe")
    .select("lote, fecha, batch_id").not("batch_id", "is", null).order("lote").order("comienzo"));
  const idsDuplicados = infos
    .filter((i) => ocho(i.lote) && volcadoLoteDia.has(`${ocho(i.lote)}|${i.fecha}`))
    .map((i) => i.batch_id);

  const clas = await todas(() => supabase.from("calibrador_clasificacion")
    .select("lote, batch_id, peso_kg").lt("batch_id", 0)
    .order("batch_id").order("producto").order("calidad").order("clase").order("tamano"));
  const sobran = clas.filter((c) => idsDuplicados.includes(c.batch_id));
  const kg = sobran.reduce((s, c) => s + (Number(c.peso_kg) || 0), 0);
  console.log(`\nPasadas con las dos fuentes EL MISMO DIA: ${idsDuplicados.length}` +
    ` · ${sobran.length} filas provisionales · ${Math.round(kg).toLocaleString("es")} kg de mas`);

  if (!aplicar) return console.log("\n(simulacion: repite con --aplicar)");
  if (sobran.length === 0) return;

  const ids = [...new Set(sobran.map((c) => c.batch_id))];
  for (let i = 0; i < ids.length; i += 100) {
    const { error } = await supabase.from("calibrador_clasificacion")
      .delete().in("batch_id", ids.slice(i, i + 100));
    if (error) throw new Error(`borrando provisionales: ${error.message}`);
  }
  console.log(`  ${sobran.length} filas provisionales quitadas: manda el volcado.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
}

/**
 * Parte en dos la pasada 26082901 que cruzó del lunes 31-08-2026 al martes 01-09.
 *
 * QUÉ PASÓ (contado por planta el 02-09: "empezaron sobre las 10 menos cuarto").
 * El martes arrancó la línea sin activar el lote nuevo en el Sizer, así que la
 * fruta de la primera hora se apuntó al lote del lunes, "26082901 -95 BOX", que
 * siguió abierto hasta las 10:29 (tiempo de lote 1d 03:23:10). El sistema fecha
 * cada informe por su comienzo y no sabe partir una pasada entre dos días: el
 * lunes salía con +14 % de DSJ y el martes con −39 %.
 *
 * POR QUÉ SE PUEDE PARTIR SIN INVENTAR KILOS. El lunes a las 12:15 el Sizer
 * mandó un informe del lote todavía abierto (batch −74860847, "26082901",
 * 22.396 kg, 03:40:53 de máquina). Los palets del ERP del lunes estaban parados
 * desde las 12:00: ese informe es el cierre real del lunes. El definitivo del
 * martes (batch −648570951, 25.939 kg, 04:20:26 de máquina) trae 3.543 kg y
 * 39 min más, repartidos por todos los calibres y sin una sola línea en
 * negativo: es fruta nueva, la del martes por la mañana.
 *
 * QUÉ HACE
 *   1. Copia de seguridad de las dos cabeceras y sus líneas (outputs/).
 *   2. Crea la pasada del MARTES por el mismo camino que un DOCX real
 *      (subirInforme): lote "26082901 -95 BOX (resto martes, lote sin activar)",
 *      comienzo 09:45 (la hora que dio planta; la máquina dice 39:33 de trabajo
 *      antes del cierre de las 10:29), y las líneas = definitivo − informe de las
 *      12:15.
 *   3. Recorta el definitivo del lunes (−648570951) a las líneas de las 12:15,
 *      conservando su nombre "-95 BOX": la vista clasificacion_lote y los scripts
 *      se quedan con él por ser el más reciente de esa pasada.
 *   4. Deja una nota en los dos partes.
 *
 * Después hay que rehacer los dos partes:
 *   node scripts/rehacer-parte.mjs --desde=2026-08-31 --hasta=2026-09-01 --aplicar
 *
 *   node scripts/partir-pasada-26082901.mjs             # simulación
 *   node scripts/partir-pasada-26082901.mjs --aplicar
 */
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { subirInforme, batchIdDeDocx } from "./lib-subir-informe-calibrador.mjs";

try { process.loadEnvFile(path.resolve(".env")); } catch { /* entorno */ }

const APLICAR = process.argv.includes("--aplicar");

const BATCH_LUNES_1215 = -74860847;    // "26082901", informe de las 12:15 del lunes (lote abierto)
const BATCH_DEFINITIVO = -648570951;   // "26082901 -95 BOX", definitivo del martes 10:45
const LOTE_MARTES = "26082901 -95 BOX (resto martes, lote sin activar)";
const COMIENZO_MARTES = "01-Sep-26 09:45 AM";
const FECHA_LUNES = "2026-08-31";
const FECHA_MARTES = "2026-09-01";

const num = (v) => Number(v) || 0;
const r2 = (n) => Math.round(n * 100) / 100;
const miles = (n) => Math.round(n).toLocaleString("es-ES");
const clave = (l) => [l.producto, l.calidad, l.clase, l.tamano, l.grupo_destino ?? ""].join("|");

async function main() {
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Faltan SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY.");
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  const traer = async (q, que) => { const { data, error } = await q; if (error) throw new Error(`${que}: ${error.message}`); return data ?? []; };
  const informes = await traer(supabase.from("calibrador_informe").select("*").in("batch_id", [BATCH_LUNES_1215, BATCH_DEFINITIVO]), "informes");
  const lineas = await traer(supabase.from("calibrador_clasificacion").select("*").in("batch_id", [BATCH_LUNES_1215, BATCH_DEFINITIVO]), "lineas");
  const cab1215 = informes.find((i) => i.batch_id === BATCH_LUNES_1215);
  const cabDef = informes.find((i) => i.batch_id === BATCH_DEFINITIVO);
  if (!cab1215 || !cabDef) throw new Error("Falta alguna de las dos cabeceras: ¿ya se aplicó?");
  const lin1215 = lineas.filter((l) => l.batch_id === BATCH_LUNES_1215);
  const linDef = lineas.filter((l) => l.batch_id === BATCH_DEFINITIVO);
  if (!lin1215.length || !linDef.length) throw new Error("Falta el detalle de alguno de los dos informes.");

  const kg = (ls) => ls.reduce((s, l) => s + num(l.peso_kg), 0);
  const ya = await traer(supabase.from("calibrador_informe").select("batch_id").eq("lote", LOTE_MARTES), "martes");
  if (ya.length) throw new Error(`La pasada del martes ya existe (batch ${ya[0].batch_id}): no se aplica dos veces.`);
  if (Math.abs(kg(linDef) - kg(lin1215) - 3543.07) > 1) {
    throw new Error(`La diferencia ya no es la medida (${miles(kg(linDef) - kg(lin1215))} kg): revisar antes de tocar.`);
  }

  // ── La diferencia, línea a línea ──────────────────────────────────────────
  const de1215 = new Map(lin1215.map((l) => [clave(l), l]));
  const delta = [];
  for (const l of linDef) {
    const v = de1215.get(clave(l)) ?? {};
    const d = { producto: l.producto, calidad: l.calidad, clase: l.clase, tamano: l.tamano, grupo: l.grupo_destino,
      kg: r2(num(l.peso_kg) - num(v.peso_kg)), piezas: Math.round(num(l.piezas) - num(v.piezas)),
      cartons: r2(num(l.cartons) - num(v.cartons)) };
    if (d.kg < -0.01 || d.piezas < 0) throw new Error(`Línea en negativo (${clave(l)}): no es una diferencia limpia.`);
    if (d.kg > 0 || d.piezas > 0 || d.cartons > 0) delta.push(d);
  }
  const soloEn1215 = lin1215.filter((l) => !linDef.some((m) => clave(m) === clave(l)));
  if (soloEn1215.length) throw new Error(`${soloEn1215.length} línea(s) del informe de las 12:15 no están en el definitivo.`);

  const tot = { kg: delta.reduce((s, d) => s + d.kg, 0), piezas: delta.reduce((s, d) => s + d.piezas, 0), cartons: delta.reduce((s, d) => s + d.cartons, 0) };
  const pct = (x, t) => (t > 0 ? r2((x / t) * 100) : 0);
  const lineasMartes = delta.map((d) => ({ ...d, pctKg: pct(d.kg, tot.kg), pctPiezas: pct(d.piezas, tot.piezas), pctCartons: pct(d.cartons, tot.cartons) }));

  // 04:20:26 − 03:40:53 = 00:39:33 de máquina para el resto del martes.
  const seg = (t) => t.split(":").reduce((s, x) => s * 60 + Number(x), 0);
  const segMaquina = seg(cabDef.tiempo_maquina) - seg(cab1215.tiempo_maquina);
  const hhmmss = (s) => [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map((x) => String(x).padStart(2, "0")).join(":");
  const informeMartes = {
    cabecera: {
      lote: LOTE_MARTES, commodity: cabDef.commodity, productorNombre: cabDef.productor, productorCodigo: cabDef.productor_codigo,
      comienzo: COMIENZO_MARTES,
      tiempoMaquina: hhmmss(segMaquina),
      tiempoLote: "00:44:00",                       // 09:45 → 10:29, cierre del lote en el Sizer
      utilizacionPct: null,
      pesoFrutaMediaG: tot.piezas > 0 ? r2((tot.kg * 1000) / tot.piezas) : null,
      conteoFrutaMedio: null, binsHora: null, binsEjecutados: null,
      toneladasHora: segMaquina > 0 ? r2(tot.kg / 1000 / (segMaquina / 3600)) : null,
      cartons: r2(tot.cartons), cartonsHora: segMaquina > 0 ? r2(tot.cartons / (segMaquina / 3600)) : null,
      rechazoPct: null,
    },
    lineas: lineasMartes,
  };
  const ficheroMartes = `${cabDef.fichero} | resto del martes: diferencia con ${cab1215.fichero} (partido el 02-09-2026, planta empezo ~09:45 sin activar el lote)`;
  const batchMartes = batchIdDeDocx(LOTE_MARTES, COMIENZO_MARTES);

  console.log(`\n${APLICAR ? "APLICANDO" : "SIMULACIÓN"}\n`);
  console.log(`Lunes 12:15   ${miles(kg(lin1215))} kg · ${lin1215.length} líneas · máquina ${cab1215.tiempo_maquina}`);
  console.log(`Definitivo    ${miles(kg(linDef))} kg · ${linDef.length} líneas · máquina ${cabDef.tiempo_maquina}`);
  console.log(`Resto martes  ${miles(tot.kg)} kg · ${miles(tot.piezas)} piezas · ${lineasMartes.length} líneas · máquina ${informeMartes.cabecera.tiempoMaquina}`);
  console.log(`  → "${LOTE_MARTES}" · comienzo ${COMIENZO_MARTES} · batch ${batchMartes}`);
  console.log(`  → T/h ${informeMartes.cabecera.toneladasHora} · peso medio ${informeMartes.cabecera.pesoFrutaMediaG} g`);
  const porGrupo = new Map();
  for (const d of delta) porGrupo.set(d.grupo, (porGrupo.get(d.grupo) ?? 0) + d.kg);
  for (const [g, k] of [...porGrupo].sort((a, b) => b[1] - a[1])) console.log(`     ${g.padEnd(16)} ${miles(k)} kg`);

  // ── Copia de seguridad SIEMPRE ────────────────────────────────────────────
  fs.mkdirSync("outputs", { recursive: true });
  const copia = path.join("outputs", `partir-pasada-26082901-${new Date().toISOString().slice(0, 10)}.json`);
  fs.writeFileSync(copia, JSON.stringify({ informes, lineas, resto_martes: informeMartes }, null, 2), "utf8");
  console.log(`\nCopia de lo anterior → ${copia}`);

  if (!APLICAR) { console.log("\nSimulación: no se ha escrito nada. Repite con --aplicar.\n"); return; }

  // 1. La pasada del martes, por el camino de siempre.
  const subido = await subirInforme(supabase, informeMartes, ficheroMartes);
  if (subido.yaVolcado) throw new Error("El martes está volcado del SQL: la pasada no se escribe.");
  console.log(`\nMartes: pasada creada (${subido.lineas} líneas, fecha ${subido.fecha}).`);

  // 2. El definitivo del lunes se recorta a las 12:15 (mismo batch, mismo nombre).
  const { error: errDel } = await supabase.from("calibrador_clasificacion").delete().eq("batch_id", BATCH_DEFINITIVO);
  if (errDel) throw new Error(`recortando el lunes: ${errDel.message}`);
  const recortadas = lin1215.map((l) => ({ ...l, lote: cabDef.lote, batch_id: BATCH_DEFINITIVO }));
  const { error: errIns } = await supabase.from("calibrador_clasificacion").insert(recortadas);
  if (errIns) throw new Error(`reescribiendo el lunes: ${errIns.message}`);
  const { error: errCab } = await supabase.from("calibrador_informe").update({
    tiempo_maquina: cab1215.tiempo_maquina, toneladas_hora: cab1215.toneladas_hora,
    peso_fruta_media_g: cab1215.peso_fruta_media_g, conteo_fruta_medio: cab1215.conteo_fruta_medio,
    cartons: cab1215.cartons, cartons_hora: cab1215.cartons_hora,
    fichero: `${cabDef.fichero} | recortado el 02-09-2026 a las lineas de ${cab1215.fichero}: los ${miles(tot.kg)} kg restantes son del martes (lote sin activar)`,
  }).eq("batch_id", BATCH_DEFINITIVO);
  if (errCab) throw new Error(`cabecera del lunes: ${errCab.message}`);
  console.log(`Lunes: definitivo recortado a ${miles(kg(lin1215))} kg (${recortadas.length} líneas).`);

  // 3. Nota en los dos partes, sin pisar lo que ya hubiera.
  const notas = {
    [FECHA_LUNES]: `[02-09] El lote 26082901 siguio activo en el Sizer hasta las 10:29 del martes: ${miles(tot.kg)} kg de la manana del martes se han pasado a su dia (informe del lunes recortado al de las 12:15).`,
    [FECHA_MARTES]: `[02-09] La linea arranco ~09:45 sin activar el lote: ${miles(tot.kg)} kg se apuntaron al 26082901 del lunes y se han traido aqui como "${LOTE_MARTES}" (diferencia entre los dos informes del Sizer).`,
  };
  for (const [fecha, nota] of Object.entries(notas)) {
    const { data: p } = await supabase.from("partes_diarios").select("id, notas_generales").eq("date", fecha).maybeSingle();
    if (!p) continue;
    const previa = (p.notas_generales ?? "").trim();
    const { error } = await supabase.from("partes_diarios").update({ notas_generales: previa ? `${previa}\n${nota}` : nota }).eq("id", p.id);
    if (error) throw new Error(`nota ${fecha}: ${error.message}`);
  }
  console.log("Notas puestas en los partes del lunes y del martes.");
  console.log("\nAhora: node scripts/rehacer-parte.mjs --desde=2026-08-31 --hasta=2026-09-01 --aplicar\n");
}

main().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });

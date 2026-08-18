/**
 * Cuadra `lotes_dia` con lo que dice el propio calibrador, PASADA A PASADA.
 *
 * EL PROBLEMA. `lotes_dia` se rellenaba desde el Word que la máquina manda al
 * cerrar un lote, y ese Word SOLO TRAE LA ÚLTIMA PASADA.
 *
 * LO QUE DE VERDAD PASA. Comparada la campaña entera pasada a pasada
 * (18-08-2026), de 1.253 pasadas del calibrador:
 *
 *   · 1.247 cuadran AL KILO con lo que tiene la app  (99,5%)
 *   ·     6 descuadran                               (van al CSV)
 *   ·     0 faltan enteras
 *
 * O sea: a la app NO le fallan los kilos dentro de una pasada.
 *
 * CUIDADO CON LA MEDIDA VIEJA. El 13-08-2026 esta misma cuenta decía que
 * faltaban 165 pasadas enteras (2.865.743 kg), y NO faltaban: se comparaban los
 * códigos crudos y "26051802+ 2 BOX DE RECICLAJE" no casaba con el "26051802"
 * de la máquina. Este script las dio de alta creyéndolas nuevas y dejó 157
 * pasadas repetidas contando 2.708.859 kg dos veces. Ahora se casan por el
 * código base (ver lib-lotes.mjs) y las repetidas se quitaron con
 * quitar-pasadas-repetidas.mjs. Si algún día vuelven a "faltar" pasadas a
 * cientos, lo primero que hay que mirar es el emparejado, no la máquina.
 *
 * POR QUÉ IMPORTA LA DISTINCIÓN. La primera versión de este script sumaba los
 * kilos que faltaban a la fila de mayor peso del lote. Habría metido los 33.982
 * kg del día 21 en el día 20 — arreglando el total del lote y estropeando el
 * DSJ de dos días. Cada kilo va a SU día o no va.
 *
 * QUÉ HACE Y QUÉ NO
 *
 *   · Da de alta las pasadas que faltan, cada una en el parte de SU día, con
 *     `source = 'calibrador'` para que nunca se confunda con lo que metió una
 *     persona.
 *   · Las pasadas que descuadran (3) NO se tocan: van al CSV. Son pocas y cada
 *     una tiene su historia; corregirlas a ciegas es peor que dejarlas vistas.
 *   · Los lotes que están en la app y NO en la máquina NO se borran. Al CSV.
 *   · Simulación por defecto. Sin `--aplicar` no escribe una sola fila.
 *
 * POR QUÉ NO SE HACE CON UNA VISTA. `lotes_dia` es una tabla que la app
 * ESCRIBE (partes, backfill de histórico, cierres). Convertirla en derivada
 * rompería a todos sus escritores.
 *
 *   node scripts/conciliar-lotes-calibrador.mjs             # simulación
 *   node scripts/conciliar-lotes-calibrador.mjs --aplicar
 */
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { codigoBaseLote } from "./lib-lotes.mjs";

try { process.loadEnvFile(path.resolve(".env")); } catch { /* entorno */ }

const APLICAR = process.argv.includes("--aplicar");
/** Tolerancia en kg: por debajo de esto una pasada se considera cuadrada. */
const TOLERANCIA_KG = 1;

const num = (v) => Number(v) || 0;
const miles = (n) => Math.round(n).toLocaleString("es-ES");

/**
 * PostgREST recorta a 1.000 filas EN SILENCIO (regla del repo, ver
 * src/lib/fetchAllRows.ts). Todo SELECT sin acotar tiene que paginar con un
 * orden estable o se trabaja con datos truncados sin enterarse.
 */
async function traerTodo(consulta) {
  const filas = [];
  for (let desde = 0; ; desde += 1000) {
    const { data, error } = await consulta(desde, desde + 999);
    if (error) throw new Error(error.message);
    filas.push(...(data ?? []));
    if (!data || data.length < 1000) return filas;
  }
}

/**
 * Lote y dia, con el lote NORMALIZADO (ver lib-lotes.mjs). Con el codigo crudo
 * "26051802+ 2 BOX DE RECICLAJE" no casaba con el "26051802" de la maquina, esta
 * pasada parecia FALTAR y se daba de alta otra vez: 157 pasadas repetidas y
 * 2.708.859 kg contados dos veces antes de verse (18-08-2026). Las repetidas que
 * ya estan se quitan con quitar-pasadas-repetidas.mjs.
 */
const clave = (lote, dia) => `${codigoBaseLote(lote)}|${dia}`;

async function main() {
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Faltan SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY en el entorno.");
    console.error("La anónima no sirve: lotes_dia tiene RLS y no puede escribir.");
    process.exit(1);
  }
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  // ── 1. Lo que dice la máquina, por lote y día ─────────────────────────────
  // Agregado en servidor: son 266.511 líneas de clasificación.
  const { data: pasadasRaw, error: calErr } = await supabase.rpc("calibrador_kg_por_pasada");
  if (calErr) throw new Error(`No se pudo leer el calibrador: ${calErr.message}`);
  const maquina = new Map(
    (pasadasRaw ?? []).map((r) => [clave(r.lote, r.dia), {
      lote: String(r.lote), dia: r.dia, kg: num(r.kg), pasadas: num(r.pasadas),
      productor_id: r.productor_id ?? null, productor: r.productor ?? null,
    }]),
  );

  // ── 2. Lo que tiene la app, por lote y día de parte ───────────────────────
  const lotesDia = await traerTodo((desde, hasta) =>
    supabase.from("lotes_dia").select("id, lote_codigo, kg_peso_total, part_id, producto")
      .not("lote_codigo", "is", null).order("id").range(desde, hasta));
  // `user_id` va incluido: lotes_dia lo tiene NOT NULL y una pasada nueva
  // hereda el del parte del que cuelga (mismo criterio que
  // scripts/crear-parte-diario.mjs), no el de quien ejecuta el script.
  const partes = await traerTodo((desde, hasta) =>
    supabase.from("partes_diarios").select("id, date, user_id").order("id").range(desde, hasta));

  const fechaDeParte = new Map(partes.map((p) => [p.id, p.date]));
  const parteDeFecha = new Map(partes.map((p) => [p.date, { id: p.id, user_id: p.user_id }]));

  const app = new Map();
  for (const l of lotesDia) {
    const dia = fechaDeParte.get(l.part_id);
    if (!dia) continue;
    const k = clave(l.lote_codigo, dia);
    const previo = app.get(k);
    if (previo) previo.kg += num(l.kg_peso_total);
    else app.set(k, { lote: String(l.lote_codigo), dia, kg: num(l.kg_peso_total) });
  }

  // ── 3. Las tres listas ────────────────────────────────────────────────────
  const faltan = [];        // pasada del calibrador que la app no tiene
  const descuadran = [];    // están en las dos con kilos distintos
  for (const [k, m] of maquina) {
    const enApp = app.get(k);
    if (!enApp) { faltan.push(m); continue; }
    if (Math.abs(enApp.kg - m.kg) > TOLERANCIA_KG) {
      descuadran.push({ ...m, kgApp: enApp.kg, desvio: m.kg - enApp.kg });
    }
  }
  const soloEnApp = [...app.values()].filter((a) => !maquina.has(clave(a.lote, a.dia)));

  const kgFaltan = faltan.reduce((s, f) => s + f.kg, 0);
  const cuadran = maquina.size - faltan.length - descuadran.length;

  // ── 4. Informe ────────────────────────────────────────────────────────────
  console.log(`\n${APLICAR ? "APLICANDO" : "SIMULACIÓN"} — tolerancia: ${TOLERANCIA_KG} kg\n`);
  console.log(`Pasadas del calibrador : ${miles(maquina.size)}`);
  console.log(`  Cuadran al kilo      : ${miles(cuadran)}`);
  console.log(`  Faltan enteras       : ${miles(faltan.length)}  →  ${miles(kgFaltan)} kg`);
  console.log(`  Descuadran           : ${miles(descuadran.length)}  →  ${miles(descuadran.reduce((s, d) => s + d.desvio, 0))} kg (NO se tocan)`);
  console.log(`Filas de la app sin pasada en la máquina: ${miles(soloEnApp.length)} (NO se borran)\n`);

  // Lo que no se toca se escribe siempre, se aplique o no: es lo que alguien
  // tiene que mirar a mano.
  fs.mkdirSync("outputs", { recursive: true });
  const hoy = new Date().toISOString().slice(0, 10);
  const csv = path.join("outputs", `pasadas-para-revisar-${hoy}.csv`);
  const lineas = ["motivo;lote;dia;kg_app;kg_calibrador;diferencia"];
  for (const d of descuadran) {
    lineas.push(`descuadra;${d.lote};${d.dia};${Math.round(d.kgApp)};${Math.round(d.kg)};${Math.round(d.desvio)}`);
  }
  for (const a of soloEnApp) lineas.push(`sin pasada en la maquina;${a.lote};${a.dia};${Math.round(a.kg)};;`);
  fs.writeFileSync(csv, lineas.join("\n"), "utf8");
  console.log(`Para revisar a mano → ${csv}\n`);

  if (!APLICAR) {
    console.log("Simulación: no se ha escrito nada. Repite con --aplicar.\n");
    if (faltan.length) {
      console.log("Muestra de las pasadas que faltan:");
      for (const f of faltan.slice(0, 6)) {
        console.log(`  ${f.lote}  ${f.dia}  ${miles(f.kg).padStart(9)} kg  ${f.productor ?? "(sin productor)"}`);
      }
    }
    return;
  }

  // ── 5. Escribir ───────────────────────────────────────────────────────────
  const nuevas = [];
  const sinParte = [];
  for (const f of faltan) {
    const parte = parteDeFecha.get(f.dia);
    // Sin parte de ese día no hay dónde colgar la pasada. NO se crea el parte:
    // crear un parte vacío mete un día con producción y sin palets, y eso
    // aparece como un descuadre gigante en el DSJ. Se cuenta y se dice.
    if (!parte) { sinParte.push(f); continue; }
    nuevas.push({
      part_id: parte.id,
      user_id: parte.user_id,
      lote_codigo: f.lote,
      kg_peso_total: f.kg,
      productor: f.productor,
      productor_id: f.productor_id,
      source: "calibrador",
    });
  }

  let altas = 0;
  for (let i = 0; i < nuevas.length; i += 500) {
    const trozo = nuevas.slice(i, i + 500);
    const { error } = await supabase.from("lotes_dia").insert(trozo);
    if (error) throw new Error(`Alta de pasadas: ${error.message}`);
    altas += trozo.length;
  }

  console.log(`Pasadas dadas de alta : ${miles(altas)}  →  ${miles(nuevas.reduce((s, n) => s + n.kg_peso_total, 0))} kg`);
  if (sinParte.length) {
    const csvSinParte = path.join("outputs", `pasadas-sin-parte-${hoy}.csv`);
    fs.writeFileSync(csvSinParte,
      ["lote;dia;kg", ...sinParte.map((f) => `${f.lote};${f.dia};${Math.round(f.kg)}`)].join("\n"), "utf8");
    console.log(`Sin parte ese día     : ${miles(sinParte.length)} pasadas, ${miles(sinParte.reduce((s, f) => s + f.kg, 0))} kg`);
    console.log(`  → ${csvSinParte} (hay que crear el parte de esos días antes)`);
  }
  console.log();
}

main().catch((e) => { console.error(e.message); process.exit(1); });

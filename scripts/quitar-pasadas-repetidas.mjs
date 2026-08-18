/**
 * Quita de `lotes_dia` las pasadas que estan DOS VECES: la que metio el parte y
 * la que dio de alta el volcado del calibrador.
 *
 * EL PROBLEMA. `conciliar-lotes-calibrador.mjs` casaba las dos caras por el
 * codigo crudo, y planta escribe en ese campo lo que echo de mas
 * ("26051802+ 2 BOX DE RECICLAJE" contra el "26051802" de la maquina). Como no
 * casaban, la pasada parecia faltar y se daba de alta otra vez. Resultado el
 * 18-08-2026: 157 pasadas repetidas, 2.708.859 kg contados dos veces.
 *
 * POR QUE HAY QUE BORRARLAS Y NO BASTA CON IGNORARLAS. La app suma TODA fila de
 * `lotes_dia` sin mirar el `source` (ver src/hooks/useEntradasBascula.ts): son
 * kilos de mas en el procesado, en el stock y en la merma. La raiz ya esta
 * arreglada — esto limpia lo que quedo hecho.
 *
 * QUE SE BORRA Y QUE NO
 *
 *   · Se borra SOLO la fila del volcado (la de source "calibrador"), y solo si
 *     su gemela del parte no pierde nada: la del parte trae la hora, el
 *     producto, las toneladas/hora y lo que anoto el operario; la del volcado,
 *     kilos y poco mas. Medido sobre las 157: la del parte tiene hora y producto
 *     en las 157 y notas en 85; la del volcado, hora en 0 y notas en 2.
 *   · Si la del volcado tiene algo que la del parte NO tiene (esas 2 notas, unos
 *     kg de industria), NO se toca: va al CSV para que lo mire una persona.
 *     Perder "Mucho podrido, Mucho deshidratado, Todo retornado" para arreglar
 *     una suma es un mal cambio.
 *   · Si algo cuelga de la fila (clasificacion_lote, pasada_anotaciones), NO se
 *     toca. Hoy no cuelga nada, pero el dia que cuelgue esto no puede enterarse
 *     por las malas.
 *   · Se casan de una en una: dos pasadas del mismo lote con los mismos kilos
 *     son dos camiones seguidos, no una repetida.
 *
 * SE PUEDE DESHACER. Antes de borrar, cada fila entera se escribe en un CSV de
 * outputs/ con todas sus columnas.
 *
 * IDEMPOTENTE: la segunda vez no encuentra nada que hacer.
 *
 *   node scripts/quitar-pasadas-repetidas.mjs             # simulacion
 *   node scripts/quitar-pasadas-repetidas.mjs --aplicar
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { codigoBaseLote } from "./lib-lotes.mjs";

try { process.loadEnvFile(path.resolve(".env")); } catch { /* entorno */ }

const APLICAR = process.argv.includes("--aplicar");
/** Tolerancia en kg para considerar que dos filas son la misma pasada. */
const TOLERANCIA_KG = 1;

const COLUMNAS = [
  "id", "part_id", "user_id", "source", "producto", "lote_codigo", "notas", "created_at",
  "productor", "productor_id", "kg_peso_total", "toneladas_hora", "duracion_min",
  "peso_fruta_promedio_g", "hora_inicio", "kg_industria", "kg_precalibrado_z1", "kg_precalibrado_z2",
];

/**
 * Lo que una fila puede tener y la otra no. `kg_peso_total` no esta: es el campo
 * por el que se casan. `id`, `part_id`, `user_id` y `source` tampoco aportan
 * nada que se pueda perder.
 */
const APORTA = [
  "notas", "producto", "productor", "productor_id", "toneladas_hora", "duracion_min",
  "peso_fruta_promedio_g", "hora_inicio", "kg_industria", "kg_precalibrado_z1", "kg_precalibrado_z2",
];

const num = (v) => Number(v) || 0;
const miles = (n) => Math.round(n).toLocaleString("es-ES");

/**
 * Un campo "esta" si dice algo. Los numeros a cero NO cuentan: `kg_industria` a
 * 0 no es un dato que se pueda perder. Los textos si, aunque sean raros.
 */
function tiene(v) {
  if (v == null) return false;
  const s = String(v).trim();
  if (s === "") return false;
  const n = Number(s);
  return Number.isNaN(n) ? true : n !== 0;
}

async function traerTodo(consulta) {
  const filas = [];
  for (let desde = 0; ; desde += 1000) {
    const { data, error } = await consulta(desde, desde + 999);
    if (error) throw new Error(error.message);
    filas.push(...(data ?? []));
    if (!data || data.length < 1000) return filas;
  }
}

/** Los campos que la del volcado tiene y la del parte no. */
const loQueSePerderia = (delVolcado, delParte) =>
  APORTA.filter((c) => tiene(delVolcado[c]) && !tiene(delParte[c]));

/**
 * Las parejas (volcado, parte) de un mismo dia. Puro, para poder razonarlo sin
 * base de datos: dentro de un parte, cada fila del volcado busca UNA fila del
 * parte con su mismo lote base y sus mismos kilos, y la que ya esta casada no
 * vuelve a casarse.
 */
export function emparejarRepetidas(delDia) {
  const delVolcado = delDia.filter((f) => f.source === "calibrador");
  const delParte = delDia.filter((f) => f.source !== "calibrador");
  const yaCasadas = new Set();
  const parejas = [];
  for (const v of delVolcado) {
    const base = codigoBaseLote(v.lote_codigo);
    if (!base) continue;
    const i = delParte.findIndex((p, idx) => !yaCasadas.has(idx)
      && codigoBaseLote(p.lote_codigo) === base
      && Math.abs(num(p.kg_peso_total) - num(v.kg_peso_total)) <= TOLERANCIA_KG);
    if (i < 0) continue;
    yaCasadas.add(i);
    parejas.push({ base, fila: v, gemela: delParte[i] });
  }
  return parejas;
}

async function main() {
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Faltan SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY en el entorno.");
    console.error("La anonima no sirve: lotes_dia tiene RLS y no puede borrar.");
    process.exit(1);
  }
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  const [filas, partes] = await Promise.all([
    traerTodo((d, h) => supabase.from("lotes_dia").select(COLUMNAS.join(", ")).order("id").range(d, h)),
    traerTodo((d, h) => supabase.from("partes_diarios").select("id, date").order("id").range(d, h)),
  ]);
  const fechaDe = new Map(partes.map((p) => [p.id, p.date]));

  // Nada se borra si algo cuelga de ello. Se piden las dos columnas enteras en
  // vez de preguntar fila por fila: son 157 preguntas contra dos consultas.
  const colgando = new Set();
  for (const tabla of ["clasificacion_lote", "pasada_anotaciones"]) {
    try {
      const refs = await traerTodo((d, h) => supabase.from(tabla)
        .select("lote_dia_id").not("lote_dia_id", "is", null).order("lote_dia_id").range(d, h));
      for (const r of refs) colgando.add(r.lote_dia_id);
    } catch (e) {
      throw new Error(`No se pudo comprobar que no cuelga nada de ${tabla}: ${e.message}`);
    }
  }

  const porParte = new Map();
  for (const f of filas) {
    if (!porParte.has(f.part_id)) porParte.set(f.part_id, []);
    porParte.get(f.part_id).push(f);
  }

  const borrar = [];      // repetidas limpias: la del volcado no aporta nada
  const revisar = [];     // repetidas que se llevarian algo por delante
  for (const [partId, delDia] of porParte) {
    const dia = fechaDe.get(partId) ?? "(sin parte)";
    for (const p of emparejarRepetidas(delDia)) {
      const perderia = loQueSePerderia(p.fila, p.gemela);
      if (colgando.has(p.fila.id)) perderia.push("(hay datos colgando de esta fila)");
      (perderia.length ? revisar : borrar).push({ ...p, dia, perderia });
    }
  }

  const kg = (lista) => lista.reduce((s, r) => s + num(r.fila.kg_peso_total), 0);
  console.log(`\n${APLICAR ? "APLICANDO" : "SIMULACION"} — tolerancia: ${TOLERANCIA_KG} kg\n`);
  console.log(`Filas de lotes_dia            : ${miles(filas.length)}`);
  console.log(`Pasadas repetidas             : ${miles(borrar.length + revisar.length)}  ->  ${miles(kg(borrar) + kg(revisar))} kg de mas`);
  console.log(`  Se quitan (nada se pierde)  : ${miles(borrar.length)}  ->  ${miles(kg(borrar))} kg`);
  console.log(`  Para mirar a mano           : ${miles(revisar.length)}  ->  ${miles(kg(revisar))} kg\n`);

  if (!borrar.length && !revisar.length) {
    console.log("No hay pasadas repetidas. Nada que hacer.\n");
    return;
  }

  fs.mkdirSync("outputs", { recursive: true });
  const hoy = new Date().toISOString().slice(0, 10);

  // El respaldo se escribe SIEMPRE, se aplique o no: es lo que permite devolver
  // una fila el dia que resulte que no era una repetida.
  const respaldo = path.join("outputs", `pasadas-repetidas-quitadas-${hoy}.csv`);
  fs.writeFileSync(respaldo, [
    ["dia", "lote_base", "gemela_id", ...COLUMNAS].join(";"),
    ...borrar.map((r) => [r.dia, r.base, r.gemela.id,
      ...COLUMNAS.map((c) => String(r.fila[c] ?? "").replace(/;/g, ","))].join(";")),
  ].join("\n"), "utf8");
  console.log(`Respaldo de lo que se quita -> ${respaldo}`);

  if (revisar.length) {
    const csv = path.join("outputs", `pasadas-repetidas-para-revisar-${hoy}.csv`);
    fs.writeFileSync(csv, [
      ["dia", "lote_base", "que_se_perderia", "id_volcado", "lote_volcado", "notas_volcado",
        "kg_industria_volcado", "id_parte", "lote_parte", "kg"].join(";"),
      ...revisar.map((r) => [r.dia, r.base, r.perderia.join(" + "), r.fila.id, r.fila.lote_codigo,
        String(r.fila.notas ?? "").replace(/;/g, ","), r.fila.kg_industria ?? "", r.gemela.id,
        r.gemela.lote_codigo, Math.round(num(r.fila.kg_peso_total))].join(";")),
    ].join("\n"), "utf8");
    console.log(`Para mirar a mano           -> ${csv}`);
    for (const r of revisar) {
      console.log(`  ${r.dia}  ${r.base}  ${miles(num(r.fila.kg_peso_total)).padStart(8)} kg` +
        `  se perderia: ${r.perderia.join(", ")}`);
    }
  }
  console.log();

  if (!APLICAR) {
    if (borrar.length) {
      console.log("Muestra de lo que se quitaria:");
      for (const r of borrar.slice(0, 8)) {
        console.log(`  ${r.dia}  ${r.base}  ${miles(num(r.fila.kg_peso_total)).padStart(8)} kg` +
          `  (se queda la del parte: "${r.gemela.lote_codigo}")`);
      }
      if (borrar.length > 8) console.log(`  ... y ${miles(borrar.length - 8)} mas`);
    }
    console.log("\nSimulacion: no se ha borrado nada. Repite con --aplicar.\n");
    return;
  }

  let quitadas = 0;
  const ids = borrar.map((r) => r.fila.id);
  for (let i = 0; i < ids.length; i += 200) {
    const trozo = ids.slice(i, i + 200);
    const { error } = await supabase.from("lotes_dia").delete().in("id", trozo);
    if (error) throw new Error(`Al borrar: ${error.message}`);
    quitadas += trozo.length;
  }
  console.log(`Pasadas repetidas quitadas: ${miles(quitadas)}  ->  ${miles(kg(borrar))} kg que ya no se cuentan dos veces.\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}

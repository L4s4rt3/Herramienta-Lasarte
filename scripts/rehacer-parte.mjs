/**
 * Rehace un parte entero: le pone los informes del calibrador, lo reanaliza y
 * COMPRUEBA QUE CUADRA. Un día o un rango.
 *
 * POR QUÉ EXISTE. El 17-08-2026 hice esto a mano para el 11, 12, 13 y 14 de
 * agosto: abrir el parte con un UPDATE suelto, generar los informes, forzar el
 * análisis y mirar los kilos. Cuatro veces la misma secuencia, y con dos pasos
 * que se olvidan con facilidad:
 *
 *   1. REABRIR. `generar-informes-parte.mjs` y `analizar-partes-pendientes.mjs`
 *      se plantan —bien— si el parte no está en Borrador. Reabrirlo a mano con
 *      SQL cada vez es justo el tipo de cosa que acaba haciéndose sobre el parte
 *      equivocado.
 *   2. CUADRAR. Conté filas y las di por buenas. Al comprobarlas contra los
 *      kilos del parte aparecieron dos errores: las mujeres contadas dos veces
 *      en `calibres_dia` y los lotes duplicados en los días con volcado. Si la
 *      comprobación no va DENTRO de la función, se hace el día que uno se
 *      acuerda.
 *
 * QUÉ HACE, EN ORDEN
 *   1. Lee el parte y se guarda el estado y los cinco datos del papel.
 *   2. Lo abre si hacía falta (nunca uno Validado: eso lo firmó una persona).
 *   3. Genera y sube los informes (ver generar-informes-parte.mjs).
 *   4. Fuerza el análisis, que es quien vuelve a poner el estado que toque.
 *   5. CUADRA: producción contra calibres, producto y lotes; palets del parte
 *      contra el detalle. Y comprueba que los cinco del papel siguen intactos.
 *
 * Si el cuadre falla, sale con código 1 y lo dice día por día: la idea es que se
 * pueda colgar de una tarea sin tener que mirarlo a ojo.
 *
 *   node scripts/rehacer-parte.mjs --fecha=2026-08-13
 *   node scripts/rehacer-parte.mjs --desde=2026-08-11 --hasta=2026-08-14 --aplicar
 */
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { generarYSubirInformes } from "./generar-informes-parte.mjs";
import { analizarPartesPendientes } from "./analizar-partes-pendientes.mjs";

try { process.loadEnvFile(path.resolve(".env")); } catch { /* entorno */ }

/** Los cinco del papel: si uno cambia al rehacer, algo se ha pisado. */
const DEL_PAPEL = [
  "kg_industria_manual", "kg_reciclado_malla_z1", "kg_reciclado_malla_z2",
  "kg_inventario_sin_alta", "kg_podrido_bolsa_basura",
];
/** Un parte firmado no se toca ni para mejorarlo. */
const INTOCABLE = new Set(["Validado"]);

const num = (v) => Number(v) || 0;
const miles = (n) => Math.round(n).toLocaleString("es");
const dd = (n) => String(n).padStart(2, "0");
const comoFecha = (d) => `${d.getFullYear()}-${dd(d.getMonth() + 1)}-${dd(d.getDate())}`;

function rango(desde, hasta) {
  const dias = [];
  for (let d = new Date(`${desde}T12:00:00`); comoFecha(d) <= hasta; d.setDate(d.getDate() + 1)) {
    dias.push(comoFecha(d));
  }
  return dias;
}

const sumar = async (supabase, tabla, campo, partId) => {
  const { data, error } = await supabase.from(tabla).select(campo).eq("part_id", partId);
  if (error) throw new Error(`${tabla}: ${error.message}`);
  return (data ?? []).reduce((s, f) => s + num(f[campo]), 0);
};

/**
 * ¿Dicen lo mismo el parte y su detalle? Tolerancia de 1 kg: los informes
 * redondean a gramos y sumar 200 filas arrastra decimales.
 */
export async function cuadrar(supabase, parte) {
  const prod = num(parte.kg_produccion_calibrador);
  const palets = num(parte.kg_palets_brutos);
  const [calibres, producto, lotes, paletsDet] = await Promise.all([
    sumar(supabase, "calibres_dia", "kg", parte.id),
    sumar(supabase, "producto_dia", "kg", parte.id),
    sumar(supabase, "lotes_dia", "kg_peso_total", parte.id),
    sumar(supabase, "palets_dia", "kg_neto", parte.id),
  ]);
  const desvios = [];
  const mira = (que, esperado, real) => {
    if (!(esperado > 0) && !(real > 0)) return;   // nada que comparar, no es un fallo
    if (Math.abs(esperado - real) > 1) {
      desvios.push(`${que}: el parte dice ${miles(esperado)} kg y el detalle ${miles(real)}`);
    }
  };
  mira("calibres", prod, calibres);
  mira("producto", prod, producto);
  mira("lotes", prod, lotes);
  mira("palets", palets, paletsDet);
  return { prod, palets, calibres, producto, lotes, paletsDet, desvios };
}

export async function rehacerParte(supabase, fecha, { url, key, aplicar = false } = {}) {
  const columnas = `id, date, estado, kg_produccion_calibrador, kg_palets_brutos, ${DEL_PAPEL.join(", ")}`;
  const { data: antes, error } = await supabase.from("partes_diarios")
    .select(columnas).eq("date", fecha).maybeSingle();
  if (error) throw new Error(`parte: ${error.message}`);
  if (!antes) return { fecha, accion: "sin-parte" };
  if (INTOCABLE.has(antes.estado)) {
    return { fecha, accion: "intocable", motivo: `esta en "${antes.estado}", lo firmo una persona` };
  }
  if (!aplicar) {
    return { fecha, accion: "reharia", estado: antes.estado, cuadre: await cuadrar(supabase, antes) };
  }

  // Se abre solo si hace falta, y el análisis del final es quien decide el
  // estado que le toca: si los cinco del papel están, lo deja en Analizado.
  const reabierto = antes.estado !== "Borrador";
  if (reabierto) {
    const { error: errE } = await supabase.from("partes_diarios")
      .update({ estado: "Borrador" }).eq("id", antes.id);
    if (errE) throw new Error(`reabrir: ${errE.message}`);
  }

  const informes = await generarYSubirInformes(supabase, fecha, { aplicar: true });
  const analisis = await analizarPartesPendientes(supabase, {
    url, key, desde: fecha, aplicar: true, forzar: [fecha],
  });

  // SE DEVUELVE COMO ESTABA. `analizar-partes-pendientes` reabre el parte cuando
  // los cinco del papel están a cero — regla suya y buena, porque "Analizado" lo
  // pone en solo lectura y le cerraría la puerta al operario. Pero aquí el parte
  // YA estaba cerrado: bajarle el estado por haberlo rehecho es perder algo que
  // decidió una persona. Paso con el 10-08, que entró Analizado y salió Borrador.
  if (reabierto) {
    const { error: errR } = await supabase.from("partes_diarios")
      .update({ estado: antes.estado }).eq("id", antes.id);
    if (errR) throw new Error(`devolver el estado: ${errR.message}`);
  }

  const { data: despues, error: errD } = await supabase.from("partes_diarios")
    .select(columnas).eq("id", antes.id).single();
  if (errD) throw new Error(`releer el parte: ${errD.message}`);

  // Lo que NUNCA puede cambiar por rehacer un parte.
  const pisados = DEL_PAPEL.filter((c) => Math.abs(num(antes[c]) - num(despues[c])) > 0.001)
    .map((c) => `${c}: ${miles(num(antes[c]))} -> ${miles(num(despues[c]))}`);

  return {
    fecha, accion: "rehecho", reabierto,
    estadoAntes: antes.estado, estadoDespues: despues.estado,
    informes: informes.accion, motivo: informes.motivo,
    analisis: analisis.find((a) => a.fecha === fecha)?.accion ?? "sin-analizar",
    avisos: analisis.find((a) => a.fecha === fecha)?.avisos ?? [],
    pisados,
    cuadre: await cuadrar(supabase, despues),
  };
}

async function main() {
  const args = process.argv.slice(2);
  const aplicar = args.includes("--aplicar");
  const argOf = (n) => args.find((a) => a.startsWith(`--${n}=`))?.split("=")[1];
  const una = argOf("fecha");
  const desde = argOf("desde");
  const hasta = argOf("hasta");
  if (!una && !(desde && hasta)) throw new Error("Hace falta --fecha=YYYY-MM-DD o --desde= y --hasta=");

  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Faltan SUPABASE_URL y/o SUPABASE_SERVICE_ROLE_KEY.");
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  let problemas = 0;
  for (const f of una ? [una] : rango(desde, hasta)) {
    const r = await rehacerParte(supabase, f, { url, key, aplicar });
    if (r.accion === "sin-parte") { console.log(`${f}: no hay parte`); continue; }
    if (r.accion === "intocable") { console.log(`${f}: NO SE TOCA (${r.motivo})`); continue; }

    const c = r.cuadre;
    if (r.accion === "reharia") {
      console.log(`${f}: se reharia (esta en ${r.estado})` +
        `${c.desvios.length ? ` · AHORA NO CUADRA: ${c.desvios.join("; ")}` : " · ahora cuadra"}`);
      continue;
    }

    console.log(`${f}: ${r.estadoAntes} -> ${r.estadoDespues}` +
      `${r.reabierto ? " (se reabrio)" : ""} · informes: ${r.informes}${r.motivo ? ` (${r.motivo})` : ""}` +
      ` · analisis: ${r.analisis}`);
    console.log(`   produccion ${miles(c.prod)} = calibres ${miles(c.calibres)}` +
      ` = producto ${miles(c.producto)} = lotes ${miles(c.lotes)}` +
      ` · palets ${miles(c.palets)} = ${miles(c.paletsDet)}`);
    for (const a of r.avisos) console.log(`   aviso: ${a}`);
    for (const d of c.desvios) { problemas++; console.log(`   NO CUADRA -> ${d}`); }
    for (const p of r.pisados) { problemas++; console.log(`   SE PISO UN DATO DEL PAPEL -> ${p}`); }
    if (!c.desvios.length && !r.pisados.length) console.log("   cuadra, y el papel intacto");
  }

  if (!aplicar) console.log("\n(simulacion: repite con --aplicar)");
  if (problemas > 0) {
    console.error(`\n${problemas} cosa(s) que no cuadran.`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
}

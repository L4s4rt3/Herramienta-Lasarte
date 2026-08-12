/**
 * Crea el parte diario del dia anterior con los campos AUTOMATICOS ya puestos.
 *
 * El operario solo tiene que meter los cinco manuales: industria, reciclado de
 * malla Z1 y Z2, inventario sin alta y podrido de bolsa de basura.
 *
 * QUE SE RELLENA Y DE DONDE
 *   kg_produccion_calibrador  suma de calibrador_clasificacion de las pasadas del dia
 *   kg_mujeres_calibrador     idem, grupo MUJERES
 *   kg_inventario_anterior_sin_alta   el kg_inventario_sin_alta del parte anterior
 *
 * VALIDADO CONTRA LA REALIDAD (12-08-2026): los dos primeros reproducen AL KILO
 * los partes ya cerrados del 3, 4, 5, 6 y 7 de agosto — cinco de cinco.
 *
 * QUE NO SE RELLENA, Y POR QUE (medido el 12-08-2026, no es pereza)
 *
 *   kg_palets_brutos   Se probo a sacarlo del ERP y EMPEORA el balance: sobre
 *     50 partes cerrados desde junio, el |DSJ| medio pasa de 4,66% (Excel del
 *     GSTOCK, como se hace hoy) a 13,39%, con dias imposibles como el 27-jul a
 *     −25,5% (mas palets que produccion). La diferencia NO es un filtro que se
 *     pueda corregir: es el MOMENTO. El Excel es la foto del ERP a media tarde;
 *     despues siguen apareciendo palets de regularizacion con esa misma fecha de
 *     lote — el 1-jul hay uno de 67.400 kg, que fisicamente no es un palet. Se
 *     barrieron topes de 5.000 a 20.000 kg para excluirlos y NINGUNO baja del
 *     4,66% del Excel. La via buena es capturar la foto a la hora del cierre,
 *     no leer el ERP a la mañana siguiente.
 *
 *   kg_podrido_calibrador_auto  nuestra clase "Podrido" suma mas de lo que el
 *     parte cuenta (5.849 vs 207 el 3-ago). No entra en el DSJ (cascade.ts): es
 *     informativo, asi que dejarlo a cero no descuadra nada.
 *
 * NUNCA PISA TRABAJO HUMANO: si el parte ya existe y no esta en Borrador, no se
 * toca. Si esta en Borrador, solo se rellenan los campos automaticos que sigan
 * a cero — un valor puesto a mano se respeta siempre.
 *
 * SE REPASA UNA VENTANA, NO SOLO AYER: si un dia la tarea no corre (portatil
 * apagado), ese parte no se crearia nunca. Y el arrastre del inventario del dia
 * anterior solo se puede poner cuando el operario ha cerrado ese dia, que suele
 * ser despues. Repasar los ultimos dias arregla las dos cosas solo.
 *
 *   node scripts/crear-parte-diario.mjs                 # simulacion, ultimos 7 dias
 *   node scripts/crear-parte-diario.mjs --aplicar
 *   node scripts/crear-parte-diario.mjs --fecha=2026-08-10 --aplicar
 *   node scripts/crear-parte-diario.mjs --dias=30 --aplicar
 */
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { conectarErp, paletsDelDia } from "./lib-palets-erp.mjs";

try { process.loadEnvFile(path.resolve(".env")); } catch { /* entorno */ }

const args = process.argv.slice(2);
const aplicar = args.includes("--aplicar");
const argOf = (n) => args.find((a) => a.startsWith(`--${n}=`))?.split("=")[1];
const dd = (n) => String(n).padStart(2, "0");
const comoFecha = (d) => `${d.getFullYear()}-${dd(d.getMonth() + 1)}-${dd(d.getDate())}`;

/**
 * Trae TODAS las filas de un SELECT, paginando con .range().
 *
 * REGLA DEL PROYECTO (src/lib/fetchAllRows.ts): PostgREST recorta cualquier
 * respuesta al max-rows del servidor EN SILENCIO — sin error, sin aviso. Un dia
 * normal del calibrador son ~1.050 filas de clasificacion (8 de los ultimos 12
 * dias pasan de 1.000), asi que esto no es una precaucion teorica: el dia que
 * alguien deje el max-rows por defecto, los partes se rellenarian con kilos
 * cortos y nadie se enteraria. El `order` por una clave estable es obligatorio:
 * sin el, cada pagina se pide sobre una foto distinta de la tabla.
 */
export async function traerTodo(query, { paso = 1000 } = {}) {
  const filas = [];
  for (let desde = 0; ; desde += paso) {
    const { data, error } = await query().range(desde, desde + paso - 1);
    if (error) throw new Error(error.message);
    filas.push(...(data ?? []));
    if (!data || data.length < paso) return filas;
  }
}

/**
 * Orden estable de calibrador_clasificacion: su clave primaria entera
 * (batch_id, producto, calidad, clase, tamano). Con menos columnas las filas
 * empatadas podrian salir en distinto orden entre dos paginas y perderse o
 * duplicarse.
 */
const porClavePrimaria = (q) =>
  q.order("batch_id").order("producto").order("calidad").order("clase").order("tamano");

/** Los kilos que el calibrador clasifico ese dia, por pasada (no por lote). */
export async function datosCalibradorDelDia(supabase, fecha) {
  const { data: batches, error: errB } = await supabase
    .from("calibrador_batch").select("batch_id")
    .gte("inicio", `${fecha}T00:00:00`).lte("inicio", `${fecha}T23:59:59`);
  if (errB) throw new Error(`calibrador_batch: ${errB.message}`);
  const ids = (batches ?? []).map((b) => b.batch_id);
  if (ids.length === 0) return { pasadas: 0, kgTotal: 0, kgMujeres: 0 };

  const filas = [];
  try {
    for (let i = 0; i < ids.length; i += 100) {
      const trozo = ids.slice(i, i + 100);
      filas.push(...await traerTodo(() => porClavePrimaria(supabase
        .from("calibrador_clasificacion").select("peso_kg, grupo_destino")
        .in("batch_id", trozo))));
    }
  } catch (e) {
    throw new Error(`calibrador_clasificacion: ${e.message}`);
  }
  const esMujeres = (g) => (g ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase() === "MUJERES";
  return {
    pasadas: ids.length,
    kgTotal: filas.reduce((s, f) => s + (Number(f.peso_kg) || 0), 0),
    kgMujeres: filas.filter((f) => esMujeres(f.grupo_destino))
      .reduce((s, f) => s + (Number(f.peso_kg) || 0), 0),
  };
}

/**
 * @param palets  lo que devuelve paletsDelDia() del ERP, o null si no se pudo
 *                leer. NULL NO ES CERO: sin ERP los campos de palets se dejan
 *                como estén y el DSJ seguirá esperando el Excel a mano.
 */
export async function crearParteDiario(supabase, fecha, { aplicar = false, palets = null } = {}) {
  const cal = await datosCalibradorDelDia(supabase, fecha);
  if (cal.pasadas === 0) {
    return { fecha, accion: "sin-datos", motivo: "el calibrador no registro ninguna pasada ese dia" };
  }

  // Arrastre del inventario sin alta del parte anterior.
  const { data: previos, error: errPrev } = await supabase
    .from("partes_diarios").select("date, estado, kg_inventario_sin_alta")
    .lt("date", fecha).order("date", { ascending: false }).limit(1);
  if (errPrev) throw new Error(`parte anterior: ${errPrev.message}`);
  const anterior = Number(previos?.[0]?.kg_inventario_sin_alta) || 0;
  // Un 0 arrastrado de un dia que aun no se ha cerrado no es un 0 de verdad:
  // es "todavia no se sabe". PartDetail lo recalcula al abrir el parte, y el
  // repaso de la ventana tambien; hay que decirlo, no ensenar un 0 tranquilo.
  const anteriorPendiente = anterior === 0 && (previos?.[0]?.estado ?? "Borrador") === "Borrador";

  const { data: existentes, error: errEx } = await supabase
    .from("partes_diarios").select("*").eq("date", fecha).limit(1);
  if (errEx) throw new Error(`parte existente: ${errEx.message}`);
  const parte = existentes?.[0] ?? null;

  if (parte && parte.estado !== "Borrador") {
    return { fecha, id: parte.id, estado: parte.estado, accion: "respetado",
      motivo: `ya existe y esta en "${parte.estado}"`, ...cal };
  }

  // Solo se tocan los automaticos que sigan a cero: un valor a mano manda.
  const campos = {};
  const ponSiVacio = (col, valor) => {
    const actual = parte ? Number(parte[col]) || 0 : null;
    if (actual > 0) return;              // puesto a mano (o ya calculado): manda
    if (actual === valor) return;        // el mismo 0 de siempre: no es un cambio
    campos[col] = valor;
  };
  ponSiVacio("kg_produccion_calibrador", Math.round(cal.kgTotal * 10000) / 10000);
  ponSiVacio("kg_mujeres_calibrador", Math.round(cal.kgMujeres * 10000) / 10000);
  ponSiVacio("kg_inventario_anterior_sin_alta", anterior);
  // Los palets NO se rellenan desde el ERP: ver la nota de arriba. `palets` se
  // sigue leyendo para poder enseñarlo en el correo como referencia.

  // Como quedan los automaticos, se hayan escrito hoy o ya estuvieran: es lo
  // que se enseña en el correo para contrastarlo con el papel.
  /** Como queda un campo tras esta pasada: lo que se escribe hoy o lo que ya habia. */
  const efectivo = (c) => campos[c] ?? (parte ? Number(parte[c]) || 0 : 0);
  const automaticos = Object.fromEntries(
    ["kg_produccion_calibrador", "kg_mujeres_calibrador", "kg_palets_brutos",
      "kg_inventario_anterior_sin_alta"].map((c) => [c, efectivo(c)]));

  // El DSJ tal y como lo calcula src/lib/cascade.ts. Es PROVISIONAL: le faltan
  // los manuales del papel (reciclado, inventario final, podrido), que solo
  // pueden bajarlo. Se enseña para poder oler un dia raro nada mas levantarse.
  const dsj = (() => {
    const delParte = (c) => (parte ? Number(parte[c]) || 0 : 0);
    const produccionReal = efectivo("kg_produccion_calibrador") - efectivo("kg_mujeres_calibrador")
      - delParte("kg_reciclado_malla_z1") - delParte("kg_reciclado_malla_z2");
    if (!(produccionReal > 0) || !(efectivo("kg_palets_brutos") > 0)) return null;
    const kg = produccionReal
      - (efectivo("kg_palets_brutos") - efectivo("kg_inventario_anterior_sin_alta"))
      - delParte("kg_inventario_sin_alta") - delParte("kg_podrido_bolsa_basura");
    return { kg, pct: (kg / produccionReal) * 100 };
  })();

  if (Object.keys(campos).length === 0) {
    return { fecha, id: parte.id, estado: parte.estado, accion: "sin-cambios",
      motivo: "los automaticos ya estaban puestos", automaticos, anteriorPendiente, dsj, paletsErp: palets, ...cal };
  }
  if (!aplicar) {
    return { fecha, id: parte?.id, estado: parte?.estado,
      accion: parte ? "actualizaria" : "crearia", campos, automaticos, anteriorPendiente, dsj, paletsErp: palets, ...cal };
  }

  if (parte) {
    const { error } = await supabase.from("partes_diarios").update(campos).eq("id", parte.id);
    if (error) throw new Error(`update parte: ${error.message}`);
    return { fecha, id: parte.id, estado: parte.estado, accion: "actualizado", campos, automaticos, anteriorPendiente, dsj, paletsErp: palets, ...cal };
  }

  // Para crear hace falta user_id: se hereda del ultimo parte (un solo usuario
  // real crea partes hoy; heredarlo evita inventarse una identidad).
  const { data: ultimo, error: errU } = await supabase
    .from("partes_diarios").select("user_id").order("date", { ascending: false }).limit(1);
  if (errU) throw new Error(`user_id: ${errU.message}`);
  const userId = ultimo?.[0]?.user_id;
  if (!userId) throw new Error("No hay ningun parte previo del que heredar el user_id.");

  const { data: nuevo, error } = await supabase.from("partes_diarios").insert({
    date: fecha, user_id: userId, estado: "Borrador", ...campos,
  }).select("id").single();
  if (error) throw new Error(`insert parte: ${error.message}`);
  return { fecha, id: nuevo?.id, estado: "Borrador", accion: "creado", campos, automaticos, anteriorPendiente, dsj, paletsErp: palets, ...cal };
}

/**
 * Repasa los ultimos `dias` dias: crea los partes que falten y completa los
 * automaticos de los que sigan en Borrador. Devuelve el del dia mas reciente
 * (el que interesa contar en el correo) y el resumen de lo demas.
 *
 * Es idempotente: en un dia normal casi todo sale "sin-cambios".
 */
export async function repasarPartes(supabase, hasta, { dias = 7, aplicar = false } = {}) {
  const fin = new Date(`${hasta}T12:00:00`);
  const fechas = Array.from({ length: dias }, (_, i) =>
    comoFecha(new Date(fin.getFullYear(), fin.getMonth(), fin.getDate() - i)));

  // Una sola conexion al ERP para toda la ventana. Si no hay red de oficina el
  // repaso sigue: los palets se quedan sin poner y se dice, que es mejor que
  // no crear el parte.
  let conn = null;
  let erpCaido = null;
  try {
    conn = await conectarErp();
  } catch (e) {
    erpCaido = e.message;
  }

  const resultados = [];
  try {
    for (const f of fechas) {
      try {
        const palets = conn ? await paletsDelDia(conn, f) : null;
        resultados.push(await crearParteDiario(supabase, f, { aplicar, palets }));
      } catch (e) {
        resultados.push({ fecha: f, accion: "error", motivo: e.message });
      }
    }
  } finally {
    if (conn) await conn.end().catch(() => {});
  }
  const tocados = resultados.filter((r) => ["creado", "actualizado", "crearia", "actualizaria"].includes(r.accion));
  return {
    ultimo: resultados[0],
    // Lo que se arreglo de dias pasados: si esto no es 0 es que hubo un hueco.
    recuperados: tocados.filter((r) => r.fecha !== hasta).map((r) => r.fecha).sort(),
    errores: resultados.filter((r) => r.accion === "error"),
    erpCaido,
    resultados,
  };
}

async function main() {
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Faltan SUPABASE_URL y/o SUPABASE_SERVICE_ROLE_KEY.");
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  const hoy = new Date();
  const ayer = comoFecha(new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() - 1));
  const una = argOf("fecha");
  const dias = Number(argOf("dias")) || 7;

  const cuenta = (r) => {
    console.log(`Parte del ${r.fecha}: ${r.accion}${r.motivo ? ` (${r.motivo})` : ""}`);
    if (r.pasadas) {
      console.log(`  calibrador: ${r.pasadas} pasadas · ${Math.round(r.kgTotal).toLocaleString("es")} kg` +
        ` · mujeres ${Math.round(r.kgMujeres).toLocaleString("es")} kg`);
    }
    for (const [k, v] of Object.entries(r.campos ?? {})) {
      console.log(`  ${k} = ${Math.round(Number(v)).toLocaleString("es")}`);
    }
  };

  if (una) {
    const conn = await conectarErp();
    try {
      cuenta(await crearParteDiario(supabase, una, { aplicar, palets: await paletsDelDia(conn, una) }));
    } finally {
      await conn.end().catch(() => {});
    }
  } else {
    const { resultados, recuperados, erpCaido } = await repasarPartes(supabase, ayer, { dias, aplicar });
    for (const r of resultados) cuenta(r);
    if (recuperados.length) console.log(`\nHuecos recuperados: ${recuperados.join(", ")}`);
    if (erpCaido) console.log(`\nAVISO: sin ERP (${erpCaido}). Los palets se han quedado sin poner.`);
  }
  if (!aplicar) console.log("\n(simulacion: repite con --aplicar)");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
}

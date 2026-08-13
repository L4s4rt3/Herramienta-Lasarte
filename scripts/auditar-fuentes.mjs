/**
 * ¿Sigue la Herramienta diciendo lo mismo que sus fuentes?
 *
 * Compara, sin escribir nada, lo que tiene la app contra lo que dicen el
 * calibrador y el ERP. Es la prueba de que la conexión de fuentes (13-08-2026)
 * hizo lo que dice, y la vigilancia para que no se vuelva a desviar en
 * silencio — que es exactamente como se desvió la primera vez.
 *
 * Qué mira, y por qué cada cosa:
 *
 *   1. PASADAS DEL CALIBRADOR contra lotes_dia. Antes faltaban 165 pasadas
 *      enteras (2.865.743 kg) porque el Word solo trae la última.
 *   2. PALETS del ERP contra los totales del parte. El parte llegó a guardar
 *      6.907.510 kg donde sus propias filas sumaban 7.602.630.
 *   3. PRODUCCIÓN del parte contra la máquina. Estaba a cero en 138 de 227 días.
 *   4. NOMBRES DE PRODUCTOR que no casan con el catálogo canónico. Eran los que
 *      hacían que /productores y /calibrador contestasen distinto.
 *   5. FRESCURA: cuándo entró lo último de cada fuente. El registro de cámaras
 *      externas llegó a llevar 78 días parado sin que nadie se enterase.
 *
 * Sale con código 1 si algo está fuera de tolerancia, para poder colgarlo de
 * una tarea programada.
 *
 *   node scripts/auditar-fuentes.mjs
 *   node scripts/auditar-fuentes.mjs --desde=2026-07-01
 */
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

try { process.loadEnvFile(path.resolve(".env")); } catch { /* entorno */ }

const DESDE = process.argv.find((a) => a.startsWith("--desde="))?.split("=")[1] ?? null;
const HASTA = process.argv.find((a) => a.startsWith("--hasta="))?.split("=")[1] ?? null;

const num = (v) => Number(v) || 0;
const miles = (n) => Math.round(n).toLocaleString("es-ES");
const pct = (n) => `${(n * 100).toFixed(2)}%`;

let problemas = 0;
function linea(etiqueta, valor, malSi = false, detalle = "") {
  const marca = malSi ? "  ✗" : "  ·";
  if (malSi) problemas++;
  console.log(`${marca} ${etiqueta.padEnd(46)} ${String(valor).padStart(14)}${detalle ? "   " + detalle : ""}`);
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

const enRango = (dia) => (!DESDE || dia >= DESDE) && (!HASTA || dia <= HASTA);

async function main() {
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Faltan SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY en el entorno.");
    process.exit(1);
  }
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  const rango = DESDE || HASTA ? `${DESDE ?? "inicio"} → ${HASTA ?? "hoy"}` : "toda la campaña";
  console.log(`\n╔══ Auditoría de fuentes ─ ${rango}\n`);

  // ── 1. Pasadas del calibrador ─────────────────────────────────────────────
  console.log("CALIBRADOR → lotes_dia");
  const { data: pasadas, error: e1 } = await supabase.rpc("calibrador_kg_por_pasada");
  if (e1) throw new Error(`calibrador: ${e1.message}`);
  const maquina = new Map();
  for (const p of (pasadas ?? []).filter((p) => enRango(p.dia))) {
    maquina.set(`${p.lote}|${p.dia}`, num(p.kg));
  }

  const lotesDia = await traerTodo((d, h) =>
    supabase.from("lotes_dia").select("lote_codigo, kg_peso_total, part_id")
      .not("lote_codigo", "is", null).order("id").range(d, h));
  const partes = await traerTodo((d, h) =>
    supabase.from("partes_diarios").select("id, date, kg_produccion_calibrador, kg_palets_brutos").order("id").range(d, h));
  const fechaDe = new Map(partes.map((p) => [p.id, p.date]));

  const app = new Map();
  for (const l of lotesDia) {
    const dia = fechaDe.get(l.part_id);
    if (!dia || !enRango(dia)) continue;
    const k = `${l.lote_codigo}|${dia}`;
    app.set(k, (app.get(k) ?? 0) + num(l.kg_peso_total));
  }

  let faltan = 0, kgFaltan = 0, descuadran = 0, kgDescuadre = 0;
  for (const [k, kg] of maquina) {
    const enApp = app.get(k);
    if (enApp === undefined) { faltan++; kgFaltan += kg; continue; }
    if (Math.abs(enApp - kg) > 1) { descuadran++; kgDescuadre += kg - enApp; }
  }
  linea("Pasadas de la máquina", miles(maquina.size));
  linea("Pasadas que la app no tiene", miles(faltan), faltan > 0, `${miles(kgFaltan)} kg`);
  linea("Pasadas con kilos distintos", miles(descuadran), descuadran > 3, `${miles(kgDescuadre)} kg`);

  // ── 2 y 3. El parte contra sus fuentes ────────────────────────────────────
  console.log("\nERP y CALIBRADOR → partes_diarios");
  const { data: paletsDia, error: e2 } = await supabase.rpc("palets_kg_por_dia");
  if (e2) throw new Error(`palets: ${e2.message}`);
  const palets = new Map((paletsDia ?? []).filter((p) => enRango(p.dia)).map((p) => [p.dia, p]));

  const prodPorDia = new Map();
  for (const [k, kg] of maquina) {
    const dia = k.split("|")[1];
    prodPorDia.set(dia, (prodPorDia.get(dia) ?? 0) + kg);
  }

  let prodMal = 0, prodCero = 0, palMal = 0, sinCerrar = 0, diasMirados = 0;
  for (const pa of partes) {
    if (!enRango(pa.date)) continue;
    diasMirados++;
    const prod = prodPorDia.get(pa.date);
    if (prod !== undefined && Math.abs(num(pa.kg_produccion_calibrador) - prod) > 1) {
      prodMal++;
      if (num(pa.kg_produccion_calibrador) === 0) prodCero++;
    }
    const pal = palets.get(pa.date);
    if (!pal) continue;
    if (!pal.cerrado) { sinCerrar++; continue; }
    if (Math.abs(num(pa.kg_palets_brutos) - num(pal.kg_sin_precalibrado)) > 1) palMal++;
  }
  linea("Días mirados", miles(diasMirados));
  linea("Producción distinta de la máquina", miles(prodMal), prodMal > 0, prodCero ? `${miles(prodCero)} a cero` : "");
  linea("Palets distintos del ERP", miles(palMal), palMal > 0);
  linea("Días de palets aún sin cerrar", miles(sinCerrar), false, "normal: el día en curso y el anterior");

  // ── 4. Nombres de productor ───────────────────────────────────────────────
  console.log("\nPRODUCTORES → catálogo canónico");
  const { data: sinCasar, error: e4 } = await supabase.rpc("productores_sin_casar");
  if (e4) {
    linea("Comprobación no disponible", "—", true, e4.message);
  } else {
    const total = (sinCasar ?? []).reduce((s, r) => s + num(r.filas), 0);
    linea("Nombres que no casan", miles((sinCasar ?? []).length), (sinCasar ?? []).length > 0,
      total ? `${miles(total)} filas` : "");
    for (const r of (sinCasar ?? []).slice(0, 5)) {
      console.log(`      · ${r.productor} (${miles(num(r.filas))} filas)`);
    }
  }

  // ── 5. Frescura ───────────────────────────────────────────────────────────
  console.log("\nFRESCURA DE CADA FUENTE");
  const hoy = new Date();
  const dias = (fecha) => fecha ? Math.floor((hoy - new Date(fecha)) / 864e5) : null;
  const fuentes = [
    ["Calibrador (informes)", "calibrador_informe", "recibido_at"],
    ["ERP (palets)", "erp_palet", "sincronizado_at"],
    ["ERP (precalibrado)", "erp_precalibrado_origen", "sincronizado_at"],
    ["Entradas de báscula", "entradas_bascula", "fecha"],
    ["Cámaras externas", "camara_externa_camiones", "created_at"],
  ];
  for (const [nombre, tabla, campo] of fuentes) {
    const { data, error } = await supabase.from(tabla).select(campo).order(campo, { ascending: false }).limit(1);
    if (error) { linea(nombre, "error", true, error.message); continue; }
    const ultimo = data?.[0]?.[campo] ?? null;
    const d = dias(ultimo);
    linea(nombre, ultimo ? String(ultimo).slice(0, 10) : "nunca", d === null || d > 7,
      d === null ? "" : `hace ${d} día${d === 1 ? "" : "s"}`);
  }

  console.log(`\n╚══ ${problemas === 0 ? "Todo cuadra." : `${problemas} cosa(s) fuera de tolerancia.`}\n`);
  process.exit(problemas === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e.message); process.exit(1); });

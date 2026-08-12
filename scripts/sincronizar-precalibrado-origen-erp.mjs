/**
 * De quién era la fruta que vuelve del almacén de precalibrado.
 *
 * El precalibrado se aparta y se vuelve a pasar por la línea. Al re-entrar por
 * báscula lo hace como movimiento interno ("LASARTE ALMACEN PRECALIBRADO") y
 * ahí se pierde el productor: 274.924 kg del aprovechamiento colgaban de un
 * almacén. Esto reconstruye la cadena contra el ERP y llena
 * `erp_precalibrado_origen`. Solo SELECT sobre el ERP.
 *
 * LA CADENA, eslabón a eslabón:
 *
 *   1. RE-ENTRADA DE BÁSCULA (día D, X kg)  ──  PALETS PREC DEL ERP (día D)
 *      Se unen por día y se comprueba que los kilos cuadren. Verificado en
 *      agosto 2026: 5.692/5.692, 4.548/4.548, 14.740/14.740, 4.480/4.480 — al
 *      kilo. En días viejos no siempre cuadra, así que cada fila guarda si el
 *      casado fue "exacto" (<0,5%) o "aproximado" (<5%); por encima de eso no
 *      se casa, se deja el hueco.
 *
 *   2. PALET PREC  ──  LOTE DE ORIGEN
 *      `agri_produc_mp_pt` (lote_pt → lote_mp), la misma tabla de la que sale
 *      `erp_confeccion_origen`. Cubre el 53,7% de los palets PREC.
 *
 * LOS KILOS SON PROPORCIONES, NO MEDICIONES. La traza del ERP va por lote de
 * confección y ese lote agrupa varios palets: hay un palet de 7.000 kg cuyo
 * origen figura con 19.538. Por eso los kg de la re-entrada se reparten entre
 * sus orígenes EN PROPORCIÓN, y se guarda `kg_traza` sin tocar para auditar.
 *
 * SE DESCARTAN LOS ORÍGENES RESIDUALES (< 10 kg): hay filas de 1 kg que no
 * dicen nada y solo meterían ruido en el reparto.
 *
 *   node scripts/sincronizar-precalibrado-origen-erp.mjs             # simulación
 *   node scripts/sincronizar-precalibrado-origen-erp.mjs --aplicar
 */
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { conectarErp } from "./lib-palets-erp.mjs";

try { process.loadEnvFile(path.resolve(".env")); } catch { /* entorno */ }

const EMPRESA = "gdata001";
const KG_MINIMOS_ORIGEN = 10;
const DESDE = "2025-09-01";

const num = (v) => Number(v) || 0;
const miles = (n) => Math.round(n).toLocaleString("es-ES");

/** Palets de precalibrado por día, con su lote de confección. */
const SQL_PALETS_PREC = `
  SELECT DATE(p.fecha_creacion) AS dia, p.lote AS lote_confeccion,
         ROUND(SUM(p.kilos_netos), 4) AS kg
    FROM ${EMPRESA}.palets_cab p
    JOIN ${EMPRESA}.articulo_general ag ON ag.codigo = p.articulo
   WHERE ag.denominacion REGEXP 'PREC' AND p.fecha_creacion >= ?
   GROUP BY DATE(p.fecha_creacion), p.lote`;

/** De qué lote de entrada salió cada lote de confección de precalibrado. */
const SQL_ORIGENES = `
  SELECT t.lote_pt AS lote_confeccion, t.lote_mp AS lote_origen,
         ROUND(SUM(t.kilos_mp_en_pt), 4) AS kg,
         MAX(apt.denominacion) AS articulo
    FROM ${EMPRESA}.agri_produc_mp_pt t
    JOIN ${EMPRESA}.articulo_general apt ON apt.codigo = t.articulo_pt
   WHERE apt.denominacion REGEXP 'PREC'
     AND t.lote_mp REGEXP '^[0-9]{8}$'
     AND t.kilos_mp_en_pt > 0
     AND t.fecha >= ?
   GROUP BY t.lote_pt, t.lote_mp`;

/**
 * Construye las filas de origen. Puro sobre los datos ya leídos, para poder
 * probarlo sin ERP ni Supabase.
 */
export function construirOrigenes({ reentradas, paletsPrec, origenes }) {
  // Palets PREC agrupados por día, con sus lotes de confección.
  const paletsPorDia = new Map();
  for (const p of paletsPrec) {
    const a = paletsPorDia.get(p.dia) ?? { kg: 0, confecciones: [] };
    a.kg += num(p.kg);
    a.confecciones.push({ lote: p.lote_confeccion, kg: num(p.kg) });
    paletsPorDia.set(p.dia, a);
  }
  // Orígenes por lote de confección.
  const origenPorConf = new Map();
  for (const o of origenes) {
    if (num(o.kg) < KG_MINIMOS_ORIGEN) continue;
    const arr = origenPorConf.get(o.lote_confeccion) ?? [];
    arr.push({ lote: o.lote_origen, kg: num(o.kg), articulo: o.articulo });
    origenPorConf.set(o.lote_confeccion, arr);
  }

  const filas = [];
  const sinCasar = [];
  const sinOrigen = [];

  // Re-entradas agrupadas por día: un día puede traer PREC 1 y PREC 2.
  const reentPorDia = new Map();
  for (const r of reentradas) {
    const a = reentPorDia.get(r.fecha) ?? [];
    a.push(r);
    reentPorDia.set(r.fecha, a);
  }

  for (const [dia, lotes] of reentPorDia) {
    const kgDia = lotes.reduce((s, l) => s + num(l.kg_entrada), 0);
    const palets = paletsPorDia.get(dia);
    if (!palets || palets.kg <= 0) {
      sinCasar.push({ dia, kg: kgDia, motivo: "el ERP no creo ningun palet de precalibrado ese dia" });
      continue;
    }
    const desvio = Math.abs(palets.kg - kgDia) / kgDia;
    if (desvio > 0.05) {
      sinCasar.push({ dia, kg: kgDia, motivo: `los kilos no cuadran (bascula ${miles(kgDia)}, ERP ${miles(palets.kg)})` });
      continue;
    }
    const casado = desvio < 0.005 ? "exacto" : "aproximado";

    // Todos los orígenes del día, sumando los de cada lote de confección.
    const porOrigen = new Map();
    for (const conf of palets.confecciones) {
      for (const o of origenPorConf.get(conf.lote) ?? []) {
        const a = porOrigen.get(o.lote) ?? { kg: 0, articulo: o.articulo, confecciones: new Set() };
        a.kg += o.kg;
        a.confecciones.add(conf.lote);
        porOrigen.set(o.lote, a);
      }
    }
    if (porOrigen.size === 0) {
      sinOrigen.push({ dia, kg: kgDia });
      continue;
    }

    // Los kg de CADA re-entrada del día se reparten entre los orígenes en
    // proporción a lo que dice la traza. Nunca se inventan kilos: el total
    // repartido es exactamente el de la re-entrada.
    const kgTraza = [...porOrigen.values()].reduce((s, o) => s + o.kg, 0);
    for (const reent of lotes) {
      const kgReent = num(reent.kg_entrada);
      if (kgReent <= 0) continue;
      for (const [loteOrigen, o] of porOrigen) {
        filas.push({
          lote_reentrada: reent.lote,
          lote_origen: loteOrigen,
          lote_confeccion: [...o.confecciones].sort().join(","),
          kg_atribuidos: Math.round((kgReent * o.kg / kgTraza) * 10000) / 10000,
          kg_traza: o.kg,
          articulo: o.articulo ?? null,
          casado,
        });
      }
    }
  }
  return { filas, sinCasar, sinOrigen };
}

async function main() {
  const aplicar = process.argv.includes("--aplicar");
  const supabase = createClient(
    process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  const { data: reentradas, error } = await supabase.from("entradas_bascula")
    .select("lote, fecha, kg_entrada")
    .ilike("agricultor", "%almacen%precal%").gte("fecha", DESDE).order("fecha");
  if (error) throw new Error(`re-entradas: ${error.message}`);

  const conn = await conectarErp();
  let paletsPrec, origenes;
  try {
    [paletsPrec] = await conn.query(SQL_PALETS_PREC, [DESDE]);
    [origenes] = await conn.query(SQL_ORIGENES, [DESDE]);
  } finally {
    await conn.end().catch(() => {});
  }

  const { filas, sinCasar, sinOrigen } = construirOrigenes({ reentradas: reentradas ?? [], paletsPrec, origenes });

  const kgReent = (reentradas ?? []).reduce((s, r) => s + num(r.kg_entrada), 0);
  const kgAtrib = filas.reduce((s, f) => s + f.kg_atribuidos, 0);
  const reentAtribuidas = new Set(filas.map((f) => f.lote_reentrada));

  console.log(`Re-entradas de precalibrado: ${reentradas?.length ?? 0} · ${miles(kgReent)} kg`);
  console.log(`  con origen conocido....... ${reentAtribuidas.size} · ${miles(kgAtrib)} kg (${((kgAtrib / kgReent) * 100).toFixed(1)}%)`);
  console.log(`  exactos / aproximados..... ${filas.filter((f) => f.casado === "exacto").length} / ${filas.filter((f) => f.casado !== "exacto").length} filas`);
  console.log(`  dias sin casar con el ERP. ${sinCasar.length} · ${miles(sinCasar.reduce((s, x) => s + x.kg, 0))} kg`);
  console.log(`  dias casados pero sin traza ${sinOrigen.length} · ${miles(sinOrigen.reduce((s, x) => s + x.kg, 0))} kg`);
  console.log(`  filas a escribir.......... ${filas.length}`);

  if (!aplicar) return console.log("\n(simulacion: repite con --aplicar)");

  const { error: errDel } = await supabase.from("erp_precalibrado_origen").delete().neq("lote_reentrada", "");
  if (errDel) throw new Error(`limpiar: ${errDel.message}`);
  for (let i = 0; i < filas.length; i += 500) {
    const { error: e } = await supabase.from("erp_precalibrado_origen").insert(filas.slice(i, i + 500));
    if (e) throw new Error(`insert: ${e.message}`);
  }
  console.log(`\n${filas.length} filas escritas.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
}

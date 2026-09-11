/**
 * Precios de consumibles desde el ERP (lunes por la mañana).
 *
 * POR QUÉ. Revisar los precios con cada factura de materiales le comía horas a
 * Jesús. El ERP ya hace ese trabajo al registrar cada entrada de proveedor:
 * gdata001.articulo_compras guarda precio_ult_compra + fecha_ult_compra por
 * artículo. Este script solo lo LEE (al ERP nunca se le escribe) y lo lleva a
 * stock_consumibles.precio_unitario para los artículos ENLAZADOS (erp_codigo).
 *
 * EL ENLACE Y EL FACTOR. erp_codigo/erp_factor viven en la propia tabla (los
 * puede editar el admin en la ficha). €/ud nuestro = precio_ult_compra × factor;
 * el factor 0.001 existe porque el ERP tiene artículos con el precio POR MILLAR
 * metido como unitario (banda EDEKA a "28,66 €/ud"). Enlace inicial curado a
 * mano el 09-09 validando por precio contra el inventario del 01-09; segunda
 * tanda el 11-09 desde las líneas de compra reales (820 artículos no-fruta).
 *
 * SIN precio_ult_compra (artículos antiguos, el ERP lo tiene a 0): se toma la
 * ÚLTIMA LÍNEA de compra real. Como el ERP escribe el precio de línea por
 * unidad o por millar según le dé, se prueban las cuatro lecturas posibles
 * (precio, precio/1000, importe/cantidad y /1000) y se elige la más cercana al
 * precio vigente; sin precio vigente no hay forma de elegir y se pide confirmar.
 *
 * EL GUARDARRAÍL. Si el precio nuevo se sale de [1/3×, 3×] del vigente, NO se
 * aplica: se deja una nota "CONFIRMAR precio ERP..." en el artículo (visible en
 * /consumibles como pendiente) — así un cambio de unidades en el ERP no mete un
 * precio 1000 veces mayor en silencio.
 *
 * LA FUENTE. Cada precio aplicado guarda su procedencia en precio_fuente
 * (artículo ERP, proveedor, albarán/factura y fecha de la última entrada), que
 * la ficha enseña bajo el precio.
 *
 *   node scripts/sincronizar-precios-consumibles-erp.mjs            # simulación
 *   node scripts/sincronizar-precios-consumibles-erp.mjs --aplicar  # escribe
 */
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { conectarErp } from "./lib-palets-erp.mjs";
import { anotarEjecucion, salirConError } from "./lib-registro-ejecuciones.mjs";

const APLICAR = process.argv.includes("--aplicar");
const TRABAJO = "precios-consumibles";
const EMPRESA = "gdata001";
/** Fuera de [1/3, 3] respecto al precio vigente no se aplica: se marca CONFIRMAR. */
const BANDA_SOSPECHA = 3;

try { process.loadEnvFile(path.resolve(".env")); } catch { /* variables del entorno */ }
const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Faltan SUPABASE_URL/VITE_SUPABASE_URL y/o SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}
const supabase = createClient(url, key, { auth: { persistSession: false } });

const inicio = new Date().toISOString();

function fechaCorta(v) {
  const s = String(v ?? "");
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : s;
}

function redondear(n, dec = 6) {
  const f = 10 ** dec;
  return Math.round(n * f) / f;
}

/** De entre varias lecturas posibles de una línea, la más cercana (en log) al precio vigente. */
function masCercano(candidatos, referencia) {
  return candidatos.reduce((mejor, v) =>
    Math.abs(Math.log(v / referencia)) < Math.abs(Math.log(mejor / referencia)) ? v : mejor);
}

async function main() {
  // 1. Consumibles enlazados (el resto ni se mira: sus precios son manuales).
  const { data: consumibles, error } = await supabase
    .from("stock_consumibles")
    .select("id, nombre, almacen, unidad, precio_unitario, nota, erp_codigo, erp_factor")
    .eq("activo", true)
    .not("erp_codigo", "is", null);
  if (error) throw new Error(`Supabase: ${error.message}`);
  if (!consumibles?.length) {
    console.log("No hay consumibles enlazados al ERP; nada que hacer.");
    await anotarEjecucion({ trabajo: TRABAJO, inicio, estado: "aviso", detalle: "0 consumibles enlazados" });
    return;
  }
  const codigos = [...new Set(consumibles.map((c) => Number(c.erp_codigo)))];

  // 2. Por artículo: su precio de última compra (si el ERP lo mantiene) y la
  //    última línea de entrada real (precio, cantidad, importe, proveedor,
  //    albarán/factura y fecha) — evidencia para precio_fuente y respaldo
  //    cuando precio_ult_compra está a 0.
  const erp = await conectarErp();
  let articulos, evidencias;
  try {
    [articulos] = await erp.query(
      `SELECT g.codigo, ac.precio_ult_compra, ac.fecha_ult_compra, g.denominacion
         FROM ${EMPRESA}.articulo_general g
         LEFT JOIN ${EMPRESA}.articulo_compras ac ON ac.codigo = g.codigo
        WHERE g.codigo IN (?)`,
      [codigos],
    );
    [evidencias] = await erp.query(
      `SELECT l.articulo, l.fecha_entrada, l.precio_neto, l.unidades_1 AS cantidad, l.importe,
              cab.albaran_prov, cab.num_fra_prov,
              COALESCE(NULLIF(p.razon_social, ''), p.nombre_comercial) AS proveedor
         FROM ${EMPRESA}.ent_prov_lineas l
         JOIN (SELECT articulo, MAX(clave_registro) AS ult
                 FROM ${EMPRESA}.ent_prov_lineas
                WHERE articulo IN (?) AND precio_neto > 0
                GROUP BY articulo) u ON u.ult = l.clave_registro
         LEFT JOIN ${EMPRESA}.ent_prov_cab_alb cab
                ON cab.serie_entrada = l.serie_entrada AND cab.num_entrada = l.num_entrada
         LEFT JOIN ${EMPRESA}.terceros_proveedores p ON p.num_proveedor = l.num_proveedor`,
      [codigos],
    );
  } finally {
    await erp.end();
  }
  const articuloPorCodigo = new Map(articulos.map((a) => [Number(a.codigo), a]));
  const evidenciaPorCodigo = new Map(evidencias.map((e) => [Number(e.articulo), e]));

  // 3. Consumible a consumible: aplicar, sospechar o dejar en paz.
  const aplicados = [];
  const sospechosos = [];
  const sinCambio = [];
  const sinArticulo = [];

  const marcarSospechoso = async (c, aviso) => {
    sospechosos.push({ c, aviso });
    if (APLICAR && !(c.nota ?? "").includes("CONFIRMAR precio ERP")) {
      const { error: e } = await supabase
        .from("stock_consumibles")
        .update({ nota: c.nota ? `${c.nota} ${aviso}` : aviso })
        .eq("id", c.id);
      if (e) throw new Error(`nota de ${c.nombre}: ${e.message}`);
    }
  };

  for (const c of consumibles) {
    const codigo = Number(c.erp_codigo);
    const art = articuloPorCodigo.get(codigo);
    if (!art) {
      sinArticulo.push(`${c.nombre} (${c.almacen}) → código ${c.erp_codigo} no existe en el ERP`);
      continue;
    }
    const factor = Number(c.erp_factor || 1);
    const actual = c.precio_unitario === null ? null : Number(c.precio_unitario);
    const evidencia = evidenciaPorCodigo.get(codigo);
    const fuenteBase =
      `ERP ${c.erp_codigo} «${art.denominacion}»` +
      (evidencia?.proveedor ? ` · ${evidencia.proveedor}` : "") +
      (evidencia?.num_fra_prov ? ` · fra. ${evidencia.num_fra_prov}` : evidencia?.albaran_prov ? ` · alb. ${evidencia.albaran_prov}` : "") +
      ` · ${fechaCorta(evidencia?.fecha_entrada ?? art.fecha_ult_compra)}`;

    let nuevo = null;
    let fuente = fuenteBase;
    const ultCompra = Number(art.precio_ult_compra);
    if (Number.isFinite(ultCompra) && ultCompra > 0) {
      nuevo = redondear(ultCompra * factor);
    } else if (evidencia && Number(evidencia.precio_neto) > 0) {
      const pn = Number(evidencia.precio_neto);
      const imp = Number(evidencia.importe);
      const qty = Number(evidencia.cantidad);
      const candidatos = [pn, pn / 1000, ...(qty > 0 && imp > 0 ? [imp / qty, imp / qty / 1000] : [])]
        .map((v) => redondear(v * factor))
        .filter((v) => v > 0);
      if (actual !== null && actual > 0) {
        nuevo = masCercano(candidatos, actual);
        fuente = `${fuenteBase} (última línea)`;
      } else {
        await marcarSospechoso(
          c,
          `CONFIRMAR precio ERP: sin precio vigente para elegir entre ${[...new Set(candidatos)].join(" / ")} €/${c.unidad} — ${fuenteBase}.`,
        );
        continue;
      }
    } else {
      sinArticulo.push(`${c.nombre} (${c.almacen}) → ERP ${c.erp_codigo} sin precio ni líneas de compra`);
      continue;
    }

    if (actual !== null && Math.abs(nuevo - actual) < 1e-9) {
      sinCambio.push(c.nombre);
      continue;
    }

    const ratio = actual !== null && actual > 0 ? nuevo / actual : 1;
    if (ratio > BANDA_SOSPECHA || ratio < 1 / BANDA_SOSPECHA) {
      // Fuera de banda: no se toca el precio, se marca para confirmar en la app.
      await marcarSospechoso(c, `CONFIRMAR precio ERP: ${nuevo} €/${c.unidad} (vigente ${actual}) — ${fuente}. ¿Unidades o enlace mal?`);
      continue;
    }

    aplicados.push({ c, actual, nuevo, fuente });
    if (APLICAR) {
      const { error: e } = await supabase
        .from("stock_consumibles")
        .update({ precio_unitario: nuevo, precio_fuente: fuente, precio_actualizado_at: new Date().toISOString() })
        .eq("id", c.id);
      if (e) throw new Error(`precio de ${c.nombre}: ${e.message}`);
    }
  }

  // 4. Contarlo como se debe: cada cifra con su cómo y su de dónde.
  console.log(`${APLICAR ? "APLICADO" : "SIMULACIÓN"} — ${consumibles.length} consumibles enlazados`);
  console.log(`\nPrecios ${APLICAR ? "actualizados" : "que se actualizarían"} (${aplicados.length}):`);
  for (const a of aplicados) {
    console.log(`  ${a.c.nombre} (${a.c.almacen}): ${a.actual ?? "—"} → ${a.nuevo} €/${a.c.unidad}  [${a.fuente}]`);
  }
  if (sospechosos.length) {
    console.log(`\nFUERA DE BANDA o sin referencia, sin aplicar — marcados CONFIRMAR en la app (${sospechosos.length}):`);
    for (const s of sospechosos) console.log(`  ${s.aviso}`);
  }
  if (sinArticulo.length) {
    console.log(`\nEnlazados pero sin precio en el ERP (${sinArticulo.length}):`);
    for (const s of sinArticulo) console.log(`  ${s}`);
  }
  console.log(`\nSin cambio: ${sinCambio.length}`);

  await anotarEjecucion({
    trabajo: TRABAJO,
    inicio,
    estado: sospechosos.length > 0 ? "aviso" : "ok",
    detalle:
      `${APLICAR ? "" : "SIMULACIÓN: "}${aplicados.length} precios actualizados, ${sinCambio.length} sin cambio, ` +
      `${sospechosos.length} fuera de banda (CONFIRMAR), ${sinArticulo.length} sin precio en ERP`,
    datos: {
      aplicar: APLICAR,
      actualizados: aplicados.map((a) => ({ nombre: a.c.nombre, almacen: a.c.almacen, de: a.actual, a: a.nuevo })),
      sospechosos: sospechosos.map((s) => s.aviso),
    },
  });
}

main().catch(async (error) => {
  console.error(`[${TRABAJO}]`, error.message ?? error);
  await anotarEjecucion({ trabajo: TRABAJO, inicio, estado: "error", detalle: String(error.message ?? error) });
  await salirConError(1);
});

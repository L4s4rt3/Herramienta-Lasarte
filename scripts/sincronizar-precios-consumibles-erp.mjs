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
 * y tercera tanda el 11-09 desde las líneas de compra y el catálogo completo;
 * revisión de enlaces el 15-09 contra los precios de Jesús.
 *
 * SEGUNDO COMPONENTE (erp_codigo_extra). Hay consumibles cuyo coste son DOS
 * artículos del ERP sumados: caja de alquiler + fianza/depósito (EPS 3,86 €,
 * IFCO 3,50 €) o caja + tapa (Otello). precio = principal + extra.
 *
 * IMPUESTO DEL PLÁSTICO. Daumar (bandas, mallas, asas, cubres, alveolos PET)
 * factura el impuesto sobre el plástico no reutilizable (0,45 €/kg) como LÍNEA
 * APARTE del albarán (artículo "IMPUESTO SOBRE EL PLASTICO…", familia IMPP), así
 * que precio_ult_compra va sin él. Jesús lo suma al precio (comprobado el 11-09
 * con sus facturas FA288816/FA289881/FA290712: sus cifras son exactamente
 * (importe + impuesto) / unidades). Aquí se hace igual: se busca el albarán más
 * reciente del artículo que lleve línea de impuesto y se aplica su recargo
 * (impuesto / importe de los productos del albarán; si el albarán trae varios
 * productos se reparte por importe y se dice). Sin línea de impuesto, sin recargo.
 *
 * LA ÚLTIMA LÍNEA se elige por FECHA de entrada (y clave de registro a igual
 * fecha), no por clave sola: el ERP registra a veces una entrada antigua después
 * de una más nueva (stiker Frutamine: la línea de febrero-2017 se metió después
 * de la de marzo-2017 y "mandaba").
 *
 * COMPRA PEQUEÑA RARA. Si la última línea es una compra pequeña (menos del 20 %
 * de la anterior) a un precio muy distinto (fuera de ±25 %), NO manda: el palet
 * frutero tenía 26 uds a 5,00 € de Cartonplus tras cientos a 9,73 € de Palyder,
 * y el 5,00 pisó al 9,73. En ese caso el precio se toma de la compra anterior
 * (proporcionalmente sobre precio_ult_compra, que va en la misma unidad) y la
 * fuente dice qué compra se ha ignorado y por qué.
 *
 * SIN precio_ult_compra (artículos antiguos, el ERP lo tiene a 0): se toma la
 * última línea de compra real. Como el ERP escribe el precio de línea por
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
 * la ficha enseña bajo el precio. Se escribe también cuando el precio no cambia.
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
/** Compra pequeña rara: menos de esta fracción de la cantidad anterior… */
const COMPRA_PEQUENA_FRACCION = 0.2;
/** …con un precio fuera de ±25 % del anterior. */
const COMPRA_PEQUENA_DESVIO = 0.25;

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

function formatoNumero(n) {
  return new Intl.NumberFormat("es-ES", { maximumFractionDigits: 4 }).format(n);
}

/** De entre varias lecturas posibles de una línea, la más cercana (en log) al precio vigente. */
function masCercano(candidatos, referencia) {
  return candidatos.reduce((mejor, v) =>
    Math.abs(Math.log(v / referencia)) < Math.abs(Math.log(mejor / referencia)) ? v : mejor);
}

/** Más reciente primero: por fecha de entrada y, a igual fecha, por clave de registro. */
function masRecientePrimero(a, b) {
  const fa = String(a.fecha_entrada ?? "");
  const fb = String(b.fecha_entrada ?? "");
  if (fa !== fb) return fa < fb ? 1 : -1;
  return Number(b.clave_registro) - Number(a.clave_registro);
}

async function main() {
  // 1. Consumibles enlazados (el resto ni se mira: sus precios son manuales).
  const { data: consumibles, error } = await supabase
    .from("stock_consumibles")
    .select("id, nombre, almacen, unidad, precio_unitario, precio_fuente, nota, erp_codigo, erp_factor, erp_codigo_extra, erp_factor_extra")
    .eq("activo", true)
    .not("erp_codigo", "is", null);
  if (error) throw new Error(`Supabase: ${error.message}`);
  if (!consumibles?.length) {
    console.log("No hay consumibles enlazados al ERP; nada que hacer.");
    await anotarEjecucion({ trabajo: TRABAJO, inicio, estado: "aviso", detalle: "0 consumibles enlazados" });
    return;
  }
  const codigos = [...new Set(consumibles.flatMap((c) => [Number(c.erp_codigo), c.erp_codigo_extra === null ? null : Number(c.erp_codigo_extra)]).filter((x) => x !== null))];

  // 2. Del ERP: el precio de última compra de cada artículo (si lo mantiene),
  //    TODAS sus líneas de entrada con precio (para elegir la última de verdad,
  //    detectar compras pequeñas raras y citar factura/proveedor) y las líneas
  //    de los albaranes recientes (para el impuesto del plástico).
  const erp = await conectarErp();
  let articulos, lineas, lineasAlbaranes;
  try {
    [articulos] = await erp.query(
      `SELECT g.codigo, ac.precio_ult_compra, ac.fecha_ult_compra, g.denominacion
         FROM ${EMPRESA}.articulo_general g
         LEFT JOIN ${EMPRESA}.articulo_compras ac ON ac.codigo = g.codigo
        WHERE g.codigo IN (?)`,
      [codigos],
    );
    [lineas] = await erp.query(
      `SELECT l.articulo, l.fecha_entrada, l.clave_registro, l.precio_neto, l.unidades_1 AS cantidad, l.importe,
              cab.albaran_prov, cab.num_fra_prov,
              COALESCE(NULLIF(p.razon_social, ''), p.nombre_comercial) AS proveedor
         FROM ${EMPRESA}.ent_prov_lineas l
         LEFT JOIN ${EMPRESA}.ent_prov_cab_alb cab
                ON cab.serie_entrada = l.serie_entrada AND cab.num_entrada = l.num_entrada
         LEFT JOIN ${EMPRESA}.terceros_proveedores p ON p.num_proveedor = l.num_proveedor
        WHERE l.articulo IN (?) AND l.precio_neto > 0`,
      [codigos],
    );
    [lineasAlbaranes] = await erp.query(
      `SELECT l.serie_entrada, l.num_entrada, l.fecha_entrada, l.clave_registro, l.articulo, l.importe,
              g.Familia AS familia, g.denominacion
         FROM ${EMPRESA}.ent_prov_lineas l
         LEFT JOIN ${EMPRESA}.articulo_general g ON g.codigo = l.articulo
        WHERE (l.serie_entrada, l.num_entrada) IN (
                SELECT DISTINCT serie_entrada, num_entrada FROM ${EMPRESA}.ent_prov_lineas
                 WHERE articulo IN (?) AND precio_neto > 0
                   AND fecha_entrada >= DATE_SUB(CURDATE(), INTERVAL 15 MONTH))`,
      [codigos],
    );
  } finally {
    await erp.end();
  }
  const articuloPorCodigo = new Map(articulos.map((a) => [Number(a.codigo), a]));
  const lineasPorCodigo = new Map();
  for (const l of lineas) {
    const codigo = Number(l.articulo);
    if (!lineasPorCodigo.has(codigo)) lineasPorCodigo.set(codigo, []);
    lineasPorCodigo.get(codigo).push(l);
  }
  for (const lista of lineasPorCodigo.values()) lista.sort(masRecientePrimero);

  // Recargo del impuesto del plástico por artículo. Se recorre del albarán más
  // reciente al más antiguo (el ERP tiene albaranes duplicados SIN la línea de
  // impuesto — la banda neutra blanca del 31-07 — y un albarán sin impuesto no
  // es una exención). Albarán de UN producto: el impuesto es suyo, sea lo que
  // sea. Albarán de varios: solo lo pagan los de plástico (bandas, mallas,
  // alveolos, cubres, plástico, stikers de polipropileno) y se reparte entre
  // ellos por importe — las cajas de cartón, grapas o cintas del mismo albarán
  // no llevan nada (comprobado con los kg de las líneas de impuesto).
  const esImpuesto = (l) => l.familia === "IMPP" || /IMPUESTO/.test(l.denominacion ?? "");
  const esServicio = (l) => l.familia === "SERV" || /TRANSPORTE|SERVICIO|PORTES/.test(l.denominacion ?? "");
  const esPlastico = (l) =>
    ["BANDA", "MALLA", "ALV", "CUB", "PLA"].includes(l.familia) ||
    (l.familia === "ETIQ" && /STIKER|POLIPROP|\bPE\b/.test(l.denominacion ?? ""));
  const porAlbaran = new Map();
  for (const l of lineasAlbaranes) {
    const clave = `${l.serie_entrada}|${l.num_entrada}`;
    if (!porAlbaran.has(clave)) porAlbaran.set(clave, []);
    porAlbaran.get(clave).push(l);
  }
  const recargoPorCodigo = new Map();
  for (const codigo of codigos) {
    const propias = lineasAlbaranes
      .filter((l) => Number(l.articulo) === codigo && Number(l.importe) > 0)
      .sort(masRecientePrimero);
    for (const propia of propias) {
      const lineasAlb = porAlbaran.get(`${propia.serie_entrada}|${propia.num_entrada}`) ?? [];
      const impuesto = lineasAlb.filter(esImpuesto).reduce((s, l) => s + Number(l.importe), 0);
      if (impuesto <= 0) continue;
      const productos = lineasAlb.filter((l) => !esImpuesto(l) && !esServicio(l));
      const distintos = new Set(productos.map((l) => Number(l.articulo)));
      const alb = `alb. ${propia.serie_entrada}${propia.num_entrada} ${fechaCorta(propia.fecha_entrada)}`;
      let base;
      let texto;
      if (distintos.size === 1) {
        base = productos.reduce((s, l) => s + Number(l.importe), 0);
        texto = `impuesto plástico (${alb})`;
      } else {
        if (!esPlastico(propia)) break; // producto sin plástico en un albarán mixto: el impuesto es de otros
        base = productos.filter(esPlastico).reduce((s, l) => s + Number(l.importe), 0);
        texto = `impuesto plástico repartido por importe entre ${distintos.size} productos (${alb})`;
      }
      if (base > 0) recargoPorCodigo.set(codigo, { ratio: impuesto / base, texto: `+${(impuesto / base * 100).toFixed(1)}% ${texto}` });
      break;
    }
  }

  /**
   * La línea que MANDA para un artículo y, si la última era una compra pequeña
   * rara, el factor para pasar de su precio al de la que manda.
   */
  function lineaQueManda(codigo) {
    const lista = lineasPorCodigo.get(codigo) ?? [];
    const ultima = lista[0];
    const anterior = lista[1];
    if (!ultima || !anterior) return { linea: ultima, ajuste: 1, aviso: "" };
    const q0 = Number(ultima.cantidad);
    const q1 = Number(anterior.cantidad);
    const p0 = Number(ultima.precio_neto);
    const p1 = Number(anterior.precio_neto);
    const i0 = Number(ultima.importe);
    const i1 = Number(anterior.importe);
    // "Pequeña" se mide en euros, no en cantidad: el ERP cambia de unidades a
    // millares entre líneas (114 millares a 33,25 tras 96.000 uds a 0,0318 es
    // la MISMA compra de siempre, no una rara). Por lo mismo, "rara" es un
    // precio fuera de ±25 % pero dentro de 3×: un salto de ×1000 es un cambio
    // de unidad, no de precio.
    const pequena = i0 > 0 && i1 > 0 && i0 < COMPRA_PEQUENA_FRACCION * i1 && q0 > 0 && q1 > 0 && q0 < COMPRA_PEQUENA_FRACCION * q1;
    const ratio = p0 > 0 && p1 > 0 ? p0 / p1 : 1;
    const rara = (ratio > 1 + COMPRA_PEQUENA_DESVIO && ratio < BANDA_SOSPECHA) || (ratio < 1 - COMPRA_PEQUENA_DESVIO && ratio > 1 / BANDA_SOSPECHA);
    if (!(pequena && rara)) return { linea: ultima, ajuste: 1, aviso: "" };
    return {
      linea: anterior,
      ajuste: p1 / p0,
      aviso:
        ` (se ignora la compra pequeña de ${formatoNumero(q0)} a ${formatoNumero(p0)} del ${fechaCorta(ultima.fecha_entrada)}` +
        `${ultima.proveedor ? ` de ${ultima.proveedor}` : ""}: manda la de ${formatoNumero(q1)} a ${formatoNumero(p1)})`,
    };
  }

  /**
   * Precio por unidad nuestra de un artículo del ERP y su fuente.
   *  - {precio, fuente}      → resuelto (precio_ult_compra × factor, o última línea elegida por cercanía).
   *  - {candidatos, fuente}  → última línea sin referencia para elegir la lectura.
   *  - {error}               → sin alta o sin precio ni líneas.
   */
  function leerPrecio(codigo, factor, referencia, unidad) {
    const art = articuloPorCodigo.get(codigo);
    if (!art) return { error: `código ${codigo} no existe en el ERP` };
    const { linea: evidencia, ajuste, aviso } = lineaQueManda(codigo);
    const fuenteBase =
      `ERP ${codigo} «${art.denominacion}»` +
      (evidencia?.proveedor ? ` · ${evidencia.proveedor}` : "") +
      (evidencia?.num_fra_prov ? ` · fra. ${evidencia.num_fra_prov}` : evidencia?.albaran_prov ? ` · alb. ${evidencia.albaran_prov}` : "") +
      ` · ${fechaCorta(evidencia?.fecha_entrada ?? art.fecha_ult_compra)}`;
    const recargo = recargoPorCodigo.get(codigo);
    const conImpuesto = (v) => redondear(v * (1 + (recargo?.ratio ?? 0)));
    const fuente = fuenteBase + (recargo ? ` · ${recargo.texto}` : "") + aviso;
    const ultCompra = Number(art.precio_ult_compra);
    if (Number.isFinite(ultCompra) && ultCompra > 0) return { precio: conImpuesto(ultCompra * ajuste * factor), fuente };
    if (evidencia && Number(evidencia.precio_neto) > 0) {
      const pn = Number(evidencia.precio_neto);
      const imp = Number(evidencia.importe);
      const qty = Number(evidencia.cantidad);
      const candidatos = [...new Set(
        [pn, pn / 1000, ...(qty > 0 && imp > 0 ? [imp / qty, imp / qty / 1000] : [])].map((v) => conImpuesto(v * factor)).filter((v) => v > 0),
      )];
      if (referencia > 0) return { precio: masCercano(candidatos, referencia), fuente: `${fuente} (última línea)` };
      return { candidatos, fuente: `${fuente}: sin precio vigente para elegir entre ${candidatos.join(" / ")} €/${unidad}` };
    }
    return { error: `ERP ${codigo} «${art.denominacion}» sin precio ni líneas de compra` };
  }

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
    const actual = c.precio_unitario === null ? null : Number(c.precio_unitario);
    const principal = leerPrecio(Number(c.erp_codigo), Number(c.erp_factor || 1), actual ?? 0, c.unidad);
    if (principal.error) {
      sinArticulo.push(`${c.nombre} (${c.almacen}) → ${principal.error}`);
      continue;
    }
    if (principal.candidatos) {
      await marcarSospechoso(c, `CONFIRMAR precio ERP: ${principal.fuente}.`);
      continue;
    }

    let nuevo = principal.precio;
    let fuente = principal.fuente;
    if (c.erp_codigo_extra !== null) {
      // El extra (fianza, depósito, tapa) se elige contra lo que le falta al principal para llegar al vigente.
      const referenciaExtra = actual !== null && actual > principal.precio ? actual - principal.precio : 0;
      const extra = leerPrecio(Number(c.erp_codigo_extra), Number(c.erp_factor_extra || 1), referenciaExtra, c.unidad);
      if (extra.error || extra.candidatos) {
        await marcarSospechoso(c, `CONFIRMAR precio ERP: el componente extra no se puede leer — ${extra.error ?? extra.fuente}.`);
        continue;
      }
      nuevo = redondear(principal.precio + extra.precio);
      fuente = `${principal.fuente} + ${extra.fuente}`;
    }

    if (actual !== null && Math.abs(nuevo - actual) < 1e-9) {
      // Mismo precio: aun así se deja escrito de dónde sale (y la factura más
      // reciente que lo confirma), que "cada cifra con su de dónde" vale
      // también para las que no cambian.
      sinCambio.push(c.nombre);
      if (APLICAR && (c.precio_fuente ?? "") !== fuente) {
        const { error: e } = await supabase.from("stock_consumibles").update({ precio_fuente: fuente }).eq("id", c.id);
        if (e) throw new Error(`fuente de ${c.nombre}: ${e.message}`);
      }
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
    for (const s of sospechosos) console.log(`  ${s.c.nombre}: ${s.aviso}`);
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
      sospechosos: sospechosos.map((s) => `${s.c.nombre}: ${s.aviso}`),
      sinPrecioErp: sinArticulo,
    },
  });
}

main().catch(async (error) => {
  console.error(`[${TRABAJO}]`, error.message ?? error);
  await anotarEjecucion({ trabajo: TRABAJO, inicio, estado: "error", detalle: String(error.message ?? error) });
  await salirConError(1);
});

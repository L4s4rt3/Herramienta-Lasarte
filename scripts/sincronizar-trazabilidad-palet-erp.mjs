/**
 * Trae del ERP la trazabilidad de palets: productor → entrada → lote de
 * confección → palet → cliente.
 *
 * Llena dos tablas espejo en Supabase, `erp_palet` y `erp_confeccion_origen`.
 * Contra el ERP solo se ejecutan SELECT.
 *
 * POR QUÉ NO SE HACE CON JOINS. La primera versión unía `palets_cab` con
 * `fact_albaranes` por `num_dcmto` + `tipo_documento`, y tardaba más de un
 * cuarto de hora machacando el servidor del ERP: `fact_albaranes` NO tiene
 * ningún índice que empiece por `num_dcmto`, su índice útil es
 * `(tipo_documento, serie_dcmto, num_dcmto, tipo_contable)`. Sin la serie,
 * MySQL recorría media tabla por cada palet. Ahora se hacen tres consultas
 * indexadas y el cruce se hace en memoria, que son segundos.
 *
 * OJO CON LA COBERTURA: solo ~57% de los kilos paletizados tiene origen
 * atribuido, porque hay lotes de confección sin elaboración registrada en el
 * ERP. El script lo dice en cada pasada. Los kilos trazados NO se guardan como
 * columna: se derivan sumando `erp_confeccion_origen` y se presentan siempre
 * junto a los totales. Nunca repartir lo desconocido. Ver
 * docs/ERP_LR_INFORMATICA.md.
 *
 * Uso:
 *   node scripts/sincronizar-trazabilidad-palet-erp.mjs                    # simulación
 *   node scripts/sincronizar-trazabilidad-palet-erp.mjs --aplicar
 *   node scripts/sincronizar-trazabilidad-palet-erp.mjs --desde=2025-09-01 --aplicar
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import mysql from "mysql2/promise";
import { createClient } from "@supabase/supabase-js";

try {
  process.loadEnvFile(path.resolve(".env"));
} catch {
  // sin .env: se usan las variables de entorno
}

const REGISTRO_ERP = "HKCU\\Software\\LRInformatica\\GSTOCKS";
const EMPRESA = "gdata001";
const LOTE_ENTRADA = "^[0-9]{8}$"; // el lote de entrada es AAMMDDNN
const TANDA = 200;

const args = process.argv.slice(2);
const aplicar = args.includes("--aplicar");
const arg = (n, def) => {
  const f = args.find((a) => a.startsWith(`--${n}=`));
  return f ? f.split("=")[1] : def;
};
const hoy = new Date();
const desde = arg("desde", new Date(hoy.getTime() - 30 * 864e5).toISOString().slice(0, 10));
const hasta = arg("hasta", hoy.toISOString().slice(0, 10));

function leerRegistro(valor) {
  const salida = execFileSync("reg", ["query", REGISTRO_ERP, "/v", valor], { encoding: "latin1" });
  const linea = salida.split(/\r?\n/).find((l) => l.trim().startsWith(valor));
  const m = linea?.match(/REG_[A-Z_]+\s{2,}(.*)$/);
  if (!m) throw new Error(`No se pudo leer ${valor} del registro del ERP`);
  return m[1].trim();
}

const txt = (v) => {
  const s = String(v ?? "").trim();
  return s === "" ? null : s;
};
const num = (v) => (v === null || v === undefined || v === "" ? null : Number(v));

/**
 * TODOS los palets del día, marcando cuáles son comerciales.
 *
 * Antes esto filtraba `num_cajas > 0 AND lote <> ''` y dejaba fuera 1.570
 * palets con 1.656.698 kg (campaña 25/26). Ese filtro es correcto para la
 * trazabilidad de VENTA, pero esos 1.570 son fruta a granel y a precalibrado
 * (sin cliente, productos PRE1/PRE2/ALM-LAS/CAMPO, 900-4.100 kg por "palet"
 * frente a los 433 de uno real) que SÍ salió de la línea. Quitarlos del
 * balance del día sube el DSJ del 3,43% al 8,60% sin que falte un kilo de
 * verdad — el descuadre lo crea el filtro, no la fruta.
 *
 * Así que se traen todos y se marca cuál es cuál: el balance de masa los usa
 * todos, las pantallas de venta filtran por `comercial`.
 *
 * Filtro por fecha_creacion: índice `elaboracion`.
 */
const SQL_PALETS = `
  SELECT p.numero, p.lote AS lote_confeccion, DATE(p.fecha_creacion) AS fecha,
         p.referencia, ag.denominacion AS articulo,
         p.num_cajas, p.kilos_netos, p.kilos_brutos, p.codigo_sscc,
         (p.num_cajas > 0 AND p.lote <> '') AS comercial,
         p.tipo_documento_vta, p.serie_dcmto_vta, p.num_dcmto_vta, p.num_linea_vta
    FROM ${EMPRESA}.palets_cab p
    LEFT JOIN ${EMPRESA}.articulo_general ag ON ag.codigo = p.articulo
   WHERE p.fecha_creacion >= ? AND p.fecha_creacion <= ?`;

async function main() {
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Faltan SUPABASE_URL y/o SUPABASE_SERVICE_ROLE_KEY.");
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  console.log(`Ventana: ${desde} -> ${hasta}   modo: ${aplicar ? "APLICAR" : "simulacion"}`);

  const conn = await mysql.createConnection({
    host: leerRegistro("Host"),
    port: Number(leerRegistro("Puerto")) || 3306,
    user: leerRegistro("Usuario"),
    password: leerRegistro("Password"),
    connectTimeout: 30000,
    dateStrings: true,
  });

  let palets = [];
  const origenes = [];
  try {
    let t = Date.now();
    const [crudos] = await conn.query(SQL_PALETS, [desde, `${hasta} 23:59:59`]);
    console.log(`palets_cab: ${crudos.length} palets en ${((Date.now() - t) / 1000).toFixed(1)} s`);

    // Ventas: por (tipo_documento, serie_dcmto, num_dcmto), que es el prefijo
    // del indice `tipo_documento` de fact_albaranes.
    const claves = [...new Map(
      crudos
        .filter((p) => Number(p.num_dcmto_vta) !== 0)
        .map((p) => [
          `${p.tipo_documento_vta}|${p.serie_dcmto_vta}|${p.num_dcmto_vta}`,
          [p.tipo_documento_vta, p.serie_dcmto_vta ?? "", p.num_dcmto_vta],
        ]),
    ).values()];
    // Se van a buscar las LINEAS, no las cabeceras: el palet apunta a la linea
    // concreta (num_linea_vta) y es ahi donde viven el importe y la factura.
    const ventas = new Map();
    t = Date.now();
    for (let i = 0; i < claves.length; i += TANDA) {
      const [filas] = await conn.query(
        `SELECT tipo_documento, serie_dcmto, num_dcmto, num_linea, num_cliente,
                DATE(fecha_albaran) AS fecha_albaran, unidades_1, importe,
                NULLIF(num_factura, 0) AS num_factura, DATE(fecha_factura) AS fecha_factura
           FROM ${EMPRESA}.fact_lin_alb
          WHERE (tipo_documento, serie_dcmto, num_dcmto) IN (?)`,
        [claves.slice(i, i + TANDA)]
      );
      for (const f of filas) {
        ventas.set(`${f.tipo_documento}|${f.serie_dcmto}|${f.num_dcmto}|${f.num_linea}`, f);
      }
    }
    console.log(`fact_lin_alb: ${ventas.size} lineas de ${claves.length} documentos en ${((Date.now() - t) / 1000).toFixed(1)} s`);

    // Clientes: indice `num_cliente`.
    const codigos = [...new Set([...ventas.values()].map((v) => v.num_cliente).filter(Boolean))];
    const clientes = new Map();
    for (let i = 0; i < codigos.length; i += TANDA) {
      const [filas] = await conn.query(
        `SELECT num_cliente, denominacion_social FROM ${EMPRESA}.terceros_clientes
          WHERE num_cliente IN (?)`,
        [codigos.slice(i, i + TANDA)]
      );
      for (const f of filas) clientes.set(String(f.num_cliente), f.denominacion_social);
    }
    console.log(`terceros_clientes: ${clientes.size}/${codigos.length} clientes`);

    const claveLinea = (p) =>
      `${p.tipo_documento_vta}|${p.serie_dcmto_vta ?? ""}|${p.num_dcmto_vta}|${p.num_linea_vta}`;

    // Reparto del importe de la linea entre SUS palets, por kilos: una linea
    // cubre varios palets y copiar su importe en cada uno inflaria las ventas.
    const kgPorLinea = new Map();
    for (const p of crudos) {
      if (Number(p.num_dcmto_vta) === 0) continue;
      const k = claveLinea(p);
      kgPorLinea.set(k, (kgPorLinea.get(k) ?? 0) + (Number(p.kilos_netos) || 0));
    }

    palets = crudos.map((p) => {
      const venta = Number(p.num_dcmto_vta) !== 0 ? ventas.get(claveLinea(p)) : undefined;
      const codigo = venta ? txt(venta.num_cliente) : null;
      const kgLinea = kgPorLinea.get(claveLinea(p)) ?? 0;
      const kg = Number(p.kilos_netos) || 0;
      const importeLinea = venta ? Number(venta.importe) : 0;
      return {
        numero: String(p.numero),
        lote_confeccion: txt(p.lote_confeccion),
        fecha: p.fecha,
        referencia: txt(p.referencia),
        articulo: txt(p.articulo),
        num_cajas: num(p.num_cajas),
        kg_netos: num(p.kilos_netos),
        kg_brutos: num(p.kilos_brutos),
        codigo_sscc: txt(p.codigo_sscc),
        comercial: Number(p.comercial) === 1,
        num_albaran_venta: venta ? String(p.num_dcmto_vta) : null,
        serie_albaran_venta: venta ? txt(p.serie_dcmto_vta) : null,
        linea_venta: venta ? num(p.num_linea_vta) : null,
        cliente_codigo: codigo,
        cliente: codigo ? txt(clientes.get(codigo)) : null,
        fecha_venta: venta?.fecha_albaran ?? null,
        // NULL, nunca 0: "todavia sin facturar" no es "vendido a cero".
        importe_venta: importeLinea > 0 && kgLinea > 0
          ? Number(((importeLinea * kg) / kgLinea).toFixed(2))
          : null,
        num_factura: venta?.num_factura ? String(venta.num_factura) : null,
        fecha_factura: venta?.fecha_factura ?? null,
      };
    });

    // Invariante que dice si el reparto es exacto o aproximado: los kilos de
    // los palets de una linea deberian ser sus unidades_1.
    let lineasCuadran = 0, lineasComprobadas = 0;
    for (const [clave, kg] of kgPorLinea) {
      const v = ventas.get(clave);
      if (!v || !(Number(v.unidades_1) > 0)) continue;
      lineasComprobadas += 1;
      if (Math.abs(Number(v.unidades_1) - kg) <= Math.max(1, kg * 0.005)) lineasCuadran += 1;
    }
    console.log(`Lineas de venta cuyos kilos cuadran con sus palets: ${lineasCuadran}/${lineasComprobadas}`
      + ` (${lineasComprobadas ? ((lineasCuadran / lineasComprobadas) * 100).toFixed(1) : "0"}%)`);

    // Origen por lote de confección: `lote_pt` está indexado en mp_pt.
    const lotes = [...new Set(palets.map((p) => p.lote_confeccion).filter(Boolean))];
    t = Date.now();
    for (let i = 0; i < lotes.length; i += TANDA) {
      const [filas] = await conn.query(
        `SELECT mp.lote_pt AS lote_confeccion, mp.lote_mp AS lote_entrada,
                MIN(ag.denominacion) AS articulo,
                SUM(mp.kilos_mp_en_pt) AS kg_atribuidos
           FROM ${EMPRESA}.agri_produc_mp_pt mp
           LEFT JOIN ${EMPRESA}.articulo_general ag ON ag.codigo = mp.articulo_mp
          WHERE mp.lote_pt IN (?) AND mp.tipo_registro = 0
            AND mp.lote_mp REGEXP '${LOTE_ENTRADA}'
          GROUP BY mp.lote_pt, mp.lote_mp
         HAVING kg_atribuidos > 0`,
        [lotes.slice(i, i + TANDA)]
      );
      origenes.push(...filas.map((f) => ({
        lote_confeccion: String(f.lote_confeccion),
        lote_entrada: String(f.lote_entrada),
        articulo: txt(f.articulo),
        kg_atribuidos: Number(f.kg_atribuidos),
      })));
    }
    console.log(`agri_produc_mp_pt: ${origenes.length} pares en ${((Date.now() - t) / 1000).toFixed(1)} s`);
  } finally {
    await conn.end();
  }

  const kgPalets = palets.reduce((s, p) => s + (p.kg_netos ?? 0), 0);
  const kgTrazados = origenes.reduce((s, o) => s + o.kg_atribuidos, 0);
  const lotesConf = new Set(palets.map((p) => p.lote_confeccion));
  const lotesConOrigen = new Set(origenes.map((o) => o.lote_confeccion));
  const vendidos = palets.filter((p) => p.num_albaran_venta).length;

  console.log(`\nPalets: ${palets.length}  (${vendidos} vendidos, ${palets.length - vendidos} sin albaran)`);
  console.log(`Lotes de confeccion: ${lotesConf.size}, con origen conocido: ${lotesConOrigen.size}`);
  console.log(`Kilos paletizados: ${Math.round(kgPalets).toLocaleString("es")}`);
  console.log(`Kilos con origen:  ${Math.round(kgTrazados).toLocaleString("es")}` +
    ` (${kgPalets > 0 ? ((kgTrazados / kgPalets) * 100).toFixed(1) : "0"}%)`);
  const facturado = palets.reduce((s, p) => s + (p.importe_venta ?? 0), 0);
  const conImporte = palets.filter((p) => p.importe_venta != null).length;
  console.log(`Euros facturados atribuidos: ${Math.round(facturado).toLocaleString("es")} €` +
    ` en ${conImporte} palets (${palets.length - conImporte} sin facturar todavia)`);

  if (!aplicar) {
    console.log("\nSimulacion: no se ha escrito nada. Repite con --aplicar.");
    return;
  }

  const volcar = async (tabla, filas, onConflict) => {
    for (let i = 0; i < filas.length; i += 500) {
      const { error } = await supabase.from(tabla).upsert(filas.slice(i, i + 500), { onConflict });
      if (error) throw new Error(`Supabase (${tabla}): ${error.message}`);
    }
    console.log(`${tabla}: ${filas.length} filas al dia.`);
  };

  await volcar("erp_palet", palets, "numero");
  await volcar("erp_confeccion_origen", origenes, "lote_confeccion,lote_entrada");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error("ERROR:", e.message);
    process.exit(1);
  });
}

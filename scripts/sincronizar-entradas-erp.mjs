/**
 * Sincroniza las ENTRADAS DE FRUTA desde el ERP (LR Informatica, MySQL) hacia
 * la tabla `entradas_bascula` de Supabase.
 *
 * Politica acordada con el dueno (10-08-2026):
 *   - SOLO da de alta entradas nuevas (clave: `lote`, que es UNIQUE en Supabase).
 *   - NUNCA modifica una entrada existente. Si el ERP tiene valores distintos,
 *     la diferencia se vuelca a un CSV de correcciones para revisarla a mano.
 *
 * Contra el ERP solo se ejecutan SELECT. No escribe nada en MySQL ni toca
 * ningun fichero del ERP.
 *
 * Uso:
 *   node scripts/sincronizar-entradas-erp.mjs                 # simulacion (no escribe)
 *   node scripts/sincronizar-entradas-erp.mjs --aplicar       # da de alta las nuevas
 *   node scripts/sincronizar-entradas-erp.mjs --desde=2026-01-01 --hasta=2026-08-10
 *
 * Requiere:
 *   - Estar dentro de la red de la oficina (el ERP vive en 192.168.1.10).
 *   - SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY en el entorno.
 *   - Las credenciales de MySQL se leen del registro de Windows, donde ya las
 *     guarda el propio ERP: no hay que copiarlas a ningun fichero.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import mysql from "mysql2/promise";
import { createClient } from "@supabase/supabase-js";

// Lee el .env del repo si existe (esta en .gitignore, asi que la clave de
// servicio no acaba en git). Si no esta, se usan las variables de entorno.
try {
  process.loadEnvFile(path.resolve(".env"));
} catch {
  // sin .env: seguimos con lo que haya en el entorno
}

const REGISTRO_ERP = "HKCU\\Software\\LRInformatica\\GSTOCKS";
const EMPRESA = "gdata001"; // LASARTE CITRICOS S.L.
const TIPO_DCMTO_ENTRADA_FRUTA = 25;

// ---------------------------------------------------------------- argumentos
const args = process.argv.slice(2);
const aplicar = args.includes("--aplicar");
const soloErp = args.includes("--solo-erp");
const rellenarHuecos = args.includes("--rellenar-huecos");
const arg = (nombre, porDefecto) => {
  const found = args.find((a) => a.startsWith(`--${nombre}=`));
  return found ? found.split("=")[1] : porDefecto;
};
const hoy = new Date();
const haceUnMes = new Date(hoy.getTime() - 30 * 24 * 3600 * 1000);
const desde = arg("desde", haceUnMes.toISOString().slice(0, 10));
const hasta = arg("hasta", hoy.toISOString().slice(0, 10));

// ------------------------------------------------- credenciales del registro
function leerRegistro(valor) {
  const salida = execFileSync("reg", ["query", REGISTRO_ERP, "/v", valor], {
    encoding: "latin1",
  });
  const linea = salida.split(/\r?\n/).find((l) => l.trim().startsWith(valor));
  const m = linea?.match(/REG_[A-Z_]+\s{2,}(.*)$/);
  if (!m) throw new Error(`No se pudo leer ${valor} del registro del ERP`);
  return m[1].trim();
}

// ------------------------------------------------------------- consulta ERP
// Los envases y los importes van como subconsulta a proposito: si se hicieran
// con JOIN, una entrada con dos tipos de envase duplicaria la fila y el lote
// (que es unico en Supabase) chocaria.
const SQL_ENTRADAS = `
  SELECT DATE(bp.fecha)               AS fecha,
         bp.lote                      AS lote,
         bp.num_dcmto_relacionado     AS num_entrada,
         tp.razon_social              AS agricultor,
         af.denominacion              AS finca,
         ap.denominacion              AS parcela,
         ag.denominacion              AS articulo,
         bp.kilos                     AS kg_entrada,
         cab.imp_transporte           AS importe_transporte,
         cab.certificada              AS certificada,
         tpo.certificado_GGAP         AS certificado_ggn,
         (SELECT SUM(e.unidades)
            FROM ${EMPRESA}.basculas_pesadas_envases e
           WHERE e.num_dcmto = bp.num_dcmto_relacionado
             AND e.tipo_dcmto = ${TIPO_DCMTO_ENTRADA_FRUTA})            AS envases,
         (SELECT ag2.denominacion
            FROM ${EMPRESA}.basculas_pesadas_envases e
            JOIN ${EMPRESA}.articulo_general ag2 ON ag2.codigo = e.codigo
           WHERE e.num_dcmto = bp.num_dcmto_relacionado
             AND e.tipo_dcmto = ${TIPO_DCMTO_ENTRADA_FRUTA}
           ORDER BY e.unidades DESC LIMIT 1)                            AS tipo_envase,
         (SELECT SUM(i.importe_bruto)
            FROM ${EMPRESA}.ent_prov_lin_imp i
           WHERE i.num_entrada = bp.num_dcmto_relacionado)              AS importe_compra,
         (SELECT i.precio_compra
            FROM ${EMPRESA}.ent_prov_lin_imp i
           WHERE i.num_entrada = bp.num_dcmto_relacionado
           ORDER BY i.num_linea LIMIT 1)                                AS precio_compra_kg,
         (SELECT COUNT(*)
            FROM ${EMPRESA}.ent_prov_lineas l
           WHERE l.num_entrada = bp.num_dcmto_relacionado)              AS lineas,
         -- Precio del CONTRATO DE RECOLECCION (tipo_contrato = 8; el 9 es el de
         -- compra). Es el ultimo recurso para estimar: dato real del ERP, pero
         -- es la tarifa pactada, no lo que costo de verdad recolectar.
         (SELECT l2.precio_compra
            FROM ${EMPRESA}.compras_contratos_cab c2
            JOIN ${EMPRESA}.compras_contratos_lin l2
              ON l2.num_contrato = c2.num_contrato
             AND l2.serie_contrato = c2.serie_contrato
           WHERE c2.tipo_contrato = 8
             AND c2.num_proveedor = bp.tercero
             AND l2.articulo = epl.articulo
             AND c2.fecha_contrato <= bp.fecha
           ORDER BY c2.fecha_contrato DESC LIMIT 1)                     AS tarifa_contrato
    FROM ${EMPRESA}.basculas_pesadas bp
    LEFT JOIN ${EMPRESA}.ent_prov_lineas  epl ON epl.num_entrada = bp.num_dcmto_relacionado
                                             AND epl.num_linea   = 1
    LEFT JOIN ${EMPRESA}.ent_prov_cab_alb cab ON cab.num_entrada = bp.num_dcmto_relacionado
    LEFT JOIN ${EMPRESA}.terceros_proveedores       tp  ON tp.num_proveedor  = bp.tercero
    LEFT JOIN ${EMPRESA}.terceros_proveedores_otros tpo ON tpo.num_proveedor = bp.tercero
    LEFT JOIN ${EMPRESA}.agricultura_fincas   af ON af.finca = bp.zona_origen
                                                AND af.num_proveedor = bp.tercero
    LEFT JOIN ${EMPRESA}.agricultura_parcelas ap ON ap.finca   = epl.finca
                                                AND ap.parcela = epl.parcela
                                                AND ap.num_proveedor = bp.tercero
    LEFT JOIN ${EMPRESA}.articulo_general ag ON ag.codigo = epl.articulo
   WHERE bp.tipo_dcmto = ${TIPO_DCMTO_ENTRADA_FRUTA}
     AND bp.fecha >= ? AND bp.fecha <= ?
   ORDER BY bp.fecha, bp.orden`;

const num = (v) => (v === null || v === undefined || v === "" ? null : Number(v));
const txt = (v) => {
  const s = String(v ?? "").trim();
  return s === "" ? null : s;
};

/**
 * Indice de tarifas de recoleccion observadas, para estimar.
 *
 * El coste REAL de recoleccion no se puede leer del ERP (lo calcula el modulo
 * de reparto al imprimir el listado), asi que se estima con la ultima tarifa
 * vista en la misma finca y variedad. Backtest de la campana 2025/26: acierta
 * la tarifa exacta el 93,7% de las veces, error acumulado del 0,47%.
 *
 * Las filas llegan ordenadas por fecha, asi que la ultima que se escribe en
 * cada clave es la mas reciente.
 */
function indiceTarifas(historico) {
  const porFincaArticulo = new Map();
  const porFinca = new Map();
  const porAgricultor = new Map();
  // Cuantas entradas tiene cada agricultor y cuantas llevan recoleccion.
  const historial = new Map();
  for (const h of historico) {
    const kg = Number(h.kg_entrada);
    const coste = Number(h.coste_recoleccion);
    if (h.agricultor) {
      const acc = historial.get(h.agricultor) ?? { total: 0, conCoste: 0 };
      acc.total += 1;
      if (coste > 0) acc.conCoste += 1;
      historial.set(h.agricultor, acc);
    }
    if (!(kg > 0) || !(coste > 0)) continue;
    const tarifa = coste / kg;
    if (h.finca && h.articulo) porFincaArticulo.set(`${h.finca}||${h.articulo}`, tarifa);
    if (h.finca) porFinca.set(h.finca, tarifa);
    if (h.agricultor) porAgricultor.set(h.agricultor, tarifa);
  }
  return (fila, tarifaContrato) => {
    // Guarda: si ese agricultor ya tiene historial y NUNCA lleva recoleccion,
    // no se estima nada. Es el caso del almacen de precalibrado — fruta interna
    // que reentra y que nadie recolecta — que ademas tiene contratos tipo 8 con
    // precios de hasta 0,37 e/kg que dispararian una estimacion disparatada.
    const h = fila.agricultor ? historial.get(fila.agricultor) : undefined;
    if (h && h.total > 0 && h.conCoste === 0) return null;
    const fa = fila.finca && fila.articulo
      ? porFincaArticulo.get(`${fila.finca}||${fila.articulo}`)
      : undefined;
    if (fa !== undefined) return { tarifa: fa, origen: "finca_articulo" };
    const f = fila.finca ? porFinca.get(fila.finca) : undefined;
    if (f !== undefined) return { tarifa: f, origen: "finca" };
    const a = fila.agricultor ? porAgricultor.get(fila.agricultor) : undefined;
    if (a !== undefined) return { tarifa: a, origen: "agricultor" };
    const c = num(tarifaContrato);
    if (c !== null && c > 0) return { tarifa: c, origen: "contrato_erp" };
    return null;
  };
}

/** Pasa una fila del ERP a la forma exacta de `entradas_bascula`. */
function aFilaApp(r, userId, estimar) {
  const certificada = Number(r.certificada) === 1;
  const fila = {
    user_id: userId,
    fecha: r.fecha,
    lote: txt(r.lote),
    num_entrada: txt(r.num_entrada),
    agricultor: txt(r.agricultor),
    finca: txt(r.finca),
    parcela: txt(r.parcela),
    articulo: txt(r.articulo),
    tipo_envase: txt(r.tipo_envase),
    envases: num(r.envases),
    kg_entrada: num(r.kg_entrada),
    precio_compra_kg: num(r.precio_compra_kg),
    importe_compra: num(r.importe_compra),
    importe_transporte: num(r.importe_transporte),
    certificada,
    // El ERP guarda el GGN en la ficha del proveedor, no en la entrada; la app
    // solo lo rellena cuando la entrada viene certificada.
    certificado_ggn: certificada ? txt(r.certificado_ggn) : null,
    // recol_kg, coste_recoleccion, comision_kg, importe_comision e importe_total
    // se dejan a NULL a proposito: NO existen en la base de datos del ERP y un
    // 0 se leeria como "no hubo coste", que es falso. Ver README.
    // Mismo `origen` que el importador manual del informe del ERP
    // (useEntradasBascula.importarEntradaFruta), para que estas altas se
    // comporten exactamente igual que las de hoy.
    origen: "bascula",
  };

  // La estimacion va en columnas propias: jamas se escribe en
  // `coste_recoleccion`, que es el hueco reservado al importe real.
  const est = estimar(fila, r.tarifa_contrato);
  fila.recol_kg_estimado = est ? Number(est.tarifa.toFixed(6)) : null;
  fila.coste_recoleccion_estimado =
    est && fila.kg_entrada ? Number((fila.kg_entrada * est.tarifa).toFixed(2)) : null;
  fila.recol_estimacion_origen = est ? est.origen : null;

  return fila;
}

/** Campos que se comparan contra lo que ya hay en la app. */
const COMPARABLES = [
  "num_entrada", "agricultor", "finca", "parcela", "articulo",
  "tipo_envase", "envases", "kg_entrada", "precio_compra_kg",
  "importe_compra", "importe_transporte", "certificada",
];

const vacio = (v) => v === null || v === undefined || v === "";

/**
 * Campos que se pueden RELLENAR cuando la app los tiene vacios.
 *
 * Rellenar un NULL no es pisar un dato: es poner lo que falta. Quedan fuera a
 * proposito `kg_entrada` y `certificada` (no admiten NULL, asi que nunca son un
 * hueco de verdad), el `lote` (identidad, ver la nota de num_entrada) y las
 * columnas de estimacion de recoleccion, que no se retocan en entradas que ya
 * existian.
 */
const RELLENABLES = [
  "num_entrada", "agricultor", "finca", "parcela", "articulo",
  "tipo_envase", "envases", "precio_compra_kg", "importe_compra",
  "importe_transporte", "certificado_ggn",
];

/**
 * Lo que la app tiene vacio y el ERP sabe.
 *
 * Un 0 del ERP NO rellena un NULL de la app: null y 0 no son lo mismo aqui
 * (null = "no se sabe", 0 = "no hubo importe"). Es el caso del precalibrado,
 * donde el ERP pone precio_compra 0 porque es fruta interna que no se compra:
 * escribir ese 0 convertiria un "sin dato" en una afirmacion.
 */
function huecosDe(appRow, erpRow) {
  const parche = {};
  for (const campo of RELLENABLES) {
    const nuevo = erpRow[campo];
    if (!vacio(appRow[campo]) || vacio(nuevo)) continue;
    if (typeof nuevo === "number" && nuevo === 0) continue;
    parche[campo] = nuevo;
  }
  return parche;
}

/** Choques de verdad: los dos tienen valor y no coinciden. */
function diferencias(appRow, erpRow) {
  const difs = [];
  for (const campo of COMPARABLES) {
    const a = appRow[campo];
    const b = erpRow[campo];
    if (vacio(a)) continue; // eso es un hueco, no un choque
    const iguales =
      typeof b === "number" || typeof a === "number"
        ? Math.abs(Number(a ?? 0) - Number(b ?? 0)) < 0.005
        : String(a ?? "") === String(b ?? "");
    if (!iguales) difs.push({ campo, en_la_app: a, en_el_erp: b });
  }
  return difs;
}

// ---------------------------------------------------------------------- main
async function main() {
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!soloErp && (!url || !key)) {
    throw new Error(
      "Faltan SUPABASE_URL y/o SUPABASE_SERVICE_ROLE_KEY en el entorno. " +
        "Con --solo-erp puedes ver lo que trae el ERP sin necesidad de ellas.",
    );
  }
  const supabase = soloErp
    ? null
    : createClient(url, key, { auth: { persistSession: false } });

  const modo = soloErp ? "solo ERP" : aplicar ? "APLICAR" : "simulacion";
  console.log(`Ventana: ${desde} -> ${hasta}   modo: ${modo}`);

  const conn = await mysql.createConnection({
    host: leerRegistro("Host"),
    port: Number(leerRegistro("Puerto")) || 3306,
    user: leerRegistro("Usuario"),
    password: leerRegistro("Password"),
    connectTimeout: 20000,
    dateStrings: true,
  });

  let filasErp;
  try {
    [filasErp] = await conn.query(SQL_ENTRADAS, [desde, `${hasta} 23:59:59`]);
  } finally {
    await conn.end();
  }
  console.log(`ERP: ${filasErp.length} entradas de fruta en la ventana.`);

  const lotes = filasErp.map((r) => String(r.lote));
  const unicos = new Set(lotes);
  if (unicos.size !== lotes.length) {
    throw new Error(
      `La consulta ha devuelto lotes repetidos (${lotes.length} filas, ${unicos.size} lotes). ` +
        "Revisar antes de dar nada de alta.",
    );
  }

  if (soloErp) {
    console.table(
      filasErp.slice(0, 15).map((r) => ({
        fecha: r.fecha, lote: r.lote, agricultor: r.agricultor,
        finca: r.finca, articulo: r.articulo,
        kg: Number(r.kg_entrada), envases: Number(r.envases ?? 0),
      })),
    );
    const sinNombre = filasErp.filter((r) => !txt(r.agricultor) || !txt(r.finca)).length;
    console.log(`Entradas sin productor o sin finca: ${sinNombre}`);
    console.log("(--solo-erp: no se ha consultado ni escrito nada en Supabase)");
    return;
  }

  // Identidad: manda `num_entrada` (el nº de documento del ERP, que no cambia),
  // NO el lote. El importador manual reconstruye el codigo de lote por el orden
  // del listado y puede desviarse: el 31-07-2026 la app guardo 26073101/02
  // donde el ERP dice 26073102/03, con las mismas entradas 16957/16958. Si se
  // dedujera por lote, esa entrada entraria otra vez y duplicaria los kilos.
  const traerPor = async (campo, valores) => {
    const filas = [];
    const utiles = [...new Set(valores.filter(Boolean).map(String))];
    for (let i = 0; i < utiles.length; i += 200) {
      const { data, error } = await supabase
        .from("entradas_bascula")
        .select("*")
        .in(campo, utiles.slice(i, i + 200));
      if (error) throw new Error(`Supabase (${campo}): ${error.message}`);
      filas.push(...(data ?? []));
    }
    return filas;
  };

  const existentes = [
    ...(await traerPor("lote", lotes)),
    ...(await traerPor("num_entrada", filasErp.map((r) => r.num_entrada))),
  ];
  const porLote = new Map(existentes.map((r) => [r.lote, r]));
  const porNumEntrada = new Map(
    existentes.filter((r) => r.num_entrada).map((r) => [String(r.num_entrada), r]),
  );

  const { data: muestra, error: errUser } = await supabase
    .from("entradas_bascula")
    .select("user_id")
    .not("user_id", "is", null)
    .limit(1);
  if (errUser || !muestra?.length) throw new Error("No se pudo averiguar el user_id de la tabla.");
  const userId = muestra[0].user_id;

  // Historial de tarifas de recoleccion, paginado: PostgREST recorta a 1.000
  // filas en silencio y esta tabla crece cada campana.
  const historico = [];
  const PASO = 1000;
  for (let inicio = 0; ; inicio += PASO) {
    const { data, error } = await supabase
      .from("entradas_bascula")
      .select("fecha, finca, articulo, agricultor, kg_entrada, coste_recoleccion")
      .order("fecha", { ascending: true })
      .order("lote", { ascending: true })
      .range(inicio, inicio + PASO - 1);
    if (error) throw new Error(`Supabase (historial de tarifas): ${error.message}`);
    historico.push(...(data ?? []));
    if (!data || data.length < PASO) break;
  }
  const estimar = indiceTarifas(historico);
  const conCoste = historico.filter((h) => Number(h.coste_recoleccion) > 0).length;
  console.log(
    `Historial para estimar recoleccion: ${historico.length} entradas, ${conCoste} con coste conocido.`,
  );

  const nuevas = [];
  const correcciones = [];
  const avisos = [];
  const lotesDesviados = [];
  const parches = [];

  for (const r of filasErp) {
    const fila = aFilaApp(r, userId, estimar);
    if (Number(r.lineas) > 1) {
      avisos.push(`${fila.lote}: la entrada ${fila.num_entrada} tiene ${r.lineas} lineas en el ERP`);
    }
    const porDcmto = fila.num_entrada ? porNumEntrada.get(fila.num_entrada) : undefined;
    const yaEsta = porDcmto ?? porLote.get(fila.lote);
    if (!yaEsta) {
      nuevas.push(fila);
      continue;
    }
    // Misma entrada del ERP guardada con otro codigo de lote: NO es un alta.
    if (porDcmto && porDcmto.lote !== fila.lote) {
      lotesDesviados.push({
        num_entrada: fila.num_entrada,
        fecha: fila.fecha,
        en_la_app: porDcmto.lote,
        en_el_erp: fila.lote,
        kg: fila.kg_entrada,
      });
      continue;
    }
    const parche = huecosDe(yaEsta, fila);
    if (Object.keys(parche).length) {
      parches.push({ id: yaEsta.id, lote: yaEsta.lote, fecha: fila.fecha, parche });
    }
    for (const d of diferencias(yaEsta, fila)) {
      correcciones.push({ lote: fila.lote, fecha: fila.fecha, ...d });
    }
  }

  console.log(`Altas nuevas: ${nuevas.length}`);
  if (nuevas.length) {
    const porOrigen = new Map();
    for (const n of nuevas) {
      const k = n.recol_estimacion_origen ?? "sin estimacion";
      porOrigen.set(k, (porOrigen.get(k) ?? 0) + 1);
    }
    const detalle = [...porOrigen].map(([k, v]) => `${k}: ${v}`).join(", ");
    console.log(`  recoleccion estimada -> ${detalle}  (el coste real queda a NULL)`);
  }
  const camposParche = parches.reduce((s, p) => s + Object.keys(p.parche).length, 0);
  console.log(`Huecos que la app tiene vacios y el ERP sabe: ${camposParche} campos en ${parches.length} entradas`);
  console.log(`Choques de valor (los dos tienen dato y no coinciden): ${
    new Set(correcciones.map((c) => c.lote)).size
  } entradas / ${correcciones.length} campos`);
  for (const a of avisos) console.log(`  aviso -> ${a}`);

  if (lotesDesviados.length) {
    console.log(
      `\nCODIGOS DE LOTE DESVIADOS: ${lotesDesviados.length}. Son la MISMA entrada del ERP` +
        " guardada en la app con otro codigo. No se dan de alta (duplicarian kilos)" +
        " ni se tocan: hay que decidir a mano si se renombra el lote.",
    );
    console.table(lotesDesviados);
  }

  if (correcciones.length) {
    const dir = path.resolve("outputs");
    fs.mkdirSync(dir, { recursive: true });
    const destino = path.join(dir, `correcciones-entradas-erp-${hasta}.csv`);
    const cabecera = "lote;fecha;campo;en_la_app;en_el_erp\n";
    const cuerpo = correcciones
      .map((c) => [c.lote, c.fecha, c.campo, c.en_la_app ?? "", c.en_el_erp ?? ""].join(";"))
      .join("\n");
    fs.writeFileSync(destino, cabecera + cuerpo, "utf8");
    console.log(`Correcciones volcadas en ${destino}`);
  }

  if (!aplicar) {
    if (nuevas.length) {
      console.log("\nSimulacion: no se ha escrito nada. Primeras altas que entrarian:");
      console.table(
        nuevas.slice(0, 10).map((n) => ({
          fecha: n.fecha, lote: n.lote, agricultor: n.agricultor,
          finca: n.finca, kg: n.kg_entrada, envases: n.envases,
          recol_estimada: n.coste_recoleccion_estimado,
          segun: n.recol_estimacion_origen,
        })),
      );
    }
    if (parches.length) {
      console.log("\nPrimeros huecos que se rellenarian (solo con --rellenar-huecos):");
      console.table(
        parches.slice(0, 10).map((p) => ({
          lote: p.lote, fecha: p.fecha, campos: Object.keys(p.parche).join(", "),
        })),
      );
    }
    console.log("\nRepite con --aplicar (y --rellenar-huecos si quieres los huecos).");
    return;
  }

  if (nuevas.length) {
    const { error: errIns } = await supabase.from("entradas_bascula").insert(nuevas);
    if (errIns) throw new Error(`Supabase al insertar: ${errIns.message}`);
    console.log(`\n${nuevas.length} entradas dadas de alta.`);
  } else {
    console.log("\nNo hay nada que dar de alta.");
  }

  if (!parches.length) return;
  if (!rellenarHuecos) {
    console.log(`${parches.length} entradas con huecos SIN tocar (pasa --rellenar-huecos para completarlas).`);
    return;
  }

  let rellenadas = 0;
  for (const p of parches) {
    const { error } = await supabase
      .from("entradas_bascula")
      .update(p.parche)
      .eq("id", p.id);
    if (error) throw new Error(`Supabase al rellenar ${p.lote}: ${error.message}`);
    rellenadas += 1;
  }
  console.log(`${rellenadas} entradas completadas (${camposParche} campos que estaban vacios).`);
}

// Solo arranca si se ejecuta el fichero; asi las funciones puras se pueden
// importar y probar sin tocar ni el ERP ni Supabase.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error("ERROR:", e.message);
    process.exit(1);
  });
}

export { indiceTarifas, aFilaApp };

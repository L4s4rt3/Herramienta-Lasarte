/**
 * Genera el Excel de "consulta de palets" del GSTOCK y lo sube al parte del día.
 *
 * POR QUÉ ASÍ Y NO ESCRIBIENDO LOS KILOS DIRECTAMENTE. Se probó lo segundo el
 * 12-08-2026 y salió mal: leer el ERP y meter `kg_palets_brutos` a mano se salta
 * TODO lo que hace `analizar-parte` con ese archivo — el detalle de palets
 * (cliente, producto, lote, cajas) que alimenta palets_dia, los kg de Egipto y
 * de campo, la protección de campos manuales… Generando el archivo que la
 * persona generaba, la app lo procesa con la MISMA lógica de siempre y no hay
 * ninguna vía nueva que mantener.
 *
 * LAS COLUMNAS SON LAS DEL EXCEL REAL (verificado contra el del 7-ago-2026):
 *   TipoPalet · NºPalet · Fecha · Denominación Producto · Lote · DcmtoVta ·
 *   Fecha · Cliente · Cajas · TipoCaja · Netos · Fact.
 * Los nombres importan: `extractNetos` y `extractPaletsDetalle` de la edge
 * function las buscan por nombre normalizado. Cambiarlos rompería la lectura.
 *
 * NO SE FILTRA POR num_cajas. El GSTOCK no filtra: los palets a granel y los de
 * campo van en box y tienen num_cajas = 0 — el 7-ago son 8 de 225 que valen
 * 22.726 kg. (`erp_palet` sí los filtra, por eso daba menos: ver
 * sincronizar-trazabilidad-palet-erp.mjs.)
 *
 * LOS PALETS DESMONTADOS SÍ VAN (regla del dueño, 12-08-2026). Un palet que se
 * desmonta va a industria o se vuelve a echar como precalibrado: se queda en
 * `palets_cab` con `estado = 4` y al día siguiente se quita de stock. El GSTOCK
 * los incluye, así que aquí tampoco se filtran — el Excel del 7-ago traía 225
 * palets (223 de estado 0 y 2 desmontados) y 87.478 kg, que es justo lo que sale.
 *
 * OJO CON LA HORA. El Excel de la persona era una foto de media tarde; leído a
 * la mañana siguiente el ERP puede traer además algún desmontado grande apuntado
 * DÍAS después con la fecha del lote (el 1-jul hay uno de 67.400 kg, que no es
 * un palet físico). Por eso se avisa cuando aparece uno anormalmente grande, en
 * vez de colarlo en el parte como si tal cosa.
 *
 * Contra el ERP solo SELECT, y siempre por `fecha_creacion` (índice
 * `elaboracion`), nunca por num_dcmto suelto.
 *
 *   node scripts/generar-gstock-erp.mjs --fecha=2026-08-11
 *   node scripts/generar-gstock-erp.mjs --fecha=2026-08-11 --aplicar
 */
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";
import { conectarErp } from "./lib-palets-erp.mjs";

try { process.loadEnvFile(path.resolve(".env")); } catch { /* entorno */ }

const EMPRESA = "gdata001";
const TANDA = 500;
/** Un palet fisico no llega a esto: por encima es una regularizacion. */
const KG_PALET_SOSPECHOSO = 10000;

const num = (v) => Number(v) || 0;

const SQL_PALETS = `
  SELECT p.numero, DATE(p.fecha_creacion) AS fecha, p.lote,
         p.num_cajas, p.kilos_netos, p.kilos_facturar, p.estado,
         p.tipo_documento_vta, p.serie_dcmto_vta, p.num_dcmto_vta, p.num_linea_vta,
         ag.denominacion  AS producto,
         apal.denominacion AS tipo_palet,
         acaj.denominacion AS tipo_caja
    FROM ${EMPRESA}.palets_cab p
    LEFT JOIN ${EMPRESA}.articulo_general ag   ON ag.codigo   = p.articulo
    LEFT JOIN ${EMPRESA}.articulo_general apal ON apal.codigo = p.articulo_palet
    LEFT JOIN ${EMPRESA}.articulo_general acaj ON acaj.codigo = p.articulo_caja
   WHERE DATE(p.fecha_creacion) = ?
   ORDER BY p.numero`;

/** Las filas del Excel, ya con cliente y albarán resueltos. */
export async function filasGstock(conn, fecha) {
  const [crudos] = await conn.query(SQL_PALETS, [fecha]);
  if (crudos.length === 0) return { filas: [], sospechosos: [] };

  // Albaranes: por el prefijo del indice (tipo_documento, serie, num).
  const claves = [...new Map(
    crudos.filter((p) => num(p.num_dcmto_vta) !== 0).map((p) => [
      `${p.tipo_documento_vta}|${p.serie_dcmto_vta}|${p.num_dcmto_vta}`,
      [p.tipo_documento_vta, p.serie_dcmto_vta ?? "", p.num_dcmto_vta],
    ]),
  ).values()];
  const ventas = new Map();
  for (let i = 0; i < claves.length; i += TANDA) {
    const [f] = await conn.query(
      `SELECT tipo_documento, serie_dcmto, num_dcmto, num_linea, num_cliente,
              DATE(fecha_albaran) AS fecha_albaran
         FROM ${EMPRESA}.fact_lin_alb
        WHERE (tipo_documento, serie_dcmto, num_dcmto) IN (?)`,
      [claves.slice(i, i + TANDA)]);
    for (const v of f) ventas.set(`${v.tipo_documento}|${v.serie_dcmto}|${v.num_dcmto}|${v.num_linea}`, v);
  }

  const codigos = [...new Set([...ventas.values()].map((v) => v.num_cliente).filter(Boolean))];
  const clientes = new Map();
  for (let i = 0; i < codigos.length; i += TANDA) {
    const [f] = await conn.query(
      `SELECT num_cliente, denominacion_social FROM ${EMPRESA}.terceros_clientes WHERE num_cliente IN (?)`,
      [codigos.slice(i, i + TANDA)]);
    for (const c of f) clientes.set(String(c.num_cliente), c.denominacion_social);
  }

  const dma = (iso) => (iso ? `${String(iso).slice(8, 10)}/${String(iso).slice(5, 7)}/${String(iso).slice(0, 4)}` : "");
  const filas = crudos.map((p) => {
    const venta = ventas.get(`${p.tipo_documento_vta}|${p.serie_dcmto_vta ?? ""}|${p.num_dcmto_vta}|${p.num_linea_vta}`);
    return {
      TipoPalet: p.tipo_palet ?? "",
      "NºPalet": num(p.numero),
      Fecha: dma(p.fecha),
      "Denominación Producto": p.producto ?? "",
      Lote: p.lote ?? "",
      DcmtoVta: venta ? `Alb.${p.serie_dcmto_vta ?? ""} ${num(p.num_dcmto_vta)}` : "",
      "Fecha ": venta?.fecha_albaran ? dma(venta.fecha_albaran) : "",
      Cliente: venta ? (clientes.get(String(venta.num_cliente)) ?? "") : "",
      Cajas: num(p.num_cajas),
      TipoCaja: p.tipo_caja ?? "",
      Netos: num(p.kilos_netos),
      "Fact.": num(p.kilos_facturar),
      // Situacion: "F" el que ya tiene albaran, "S" el que sigue en stock.
      // Verificado contra el Excel real del 7-ago (211 F con cliente, 12 S sin
      // el). La edge function no la lee, pero el archivo debe ser fiel.
      Sit: venta ? "F" : "S",
      _desmontado: Number(p.estado) === 4,
    };
  });

  const sospechosos = filas.filter((f) => f.Netos > KG_PALET_SOSPECHOSO)
    .map((f) => ({
      palet: f["NºPalet"], kg: Math.round(f.Netos), producto: f["Denominación Producto"],
      desmontado: f._desmontado,
    }));
  return { filas, sospechosos };
}

/** El Excel, con las columnas EXACTAS que espera la edge function. */
export function construirLibro(filas) {
  // `_desmontado` es de uso interno (avisos): NO va al Excel, que debe tener las
  // mismas columnas que el que sacaba la persona.
  const cabecera = ["TipoPalet", "NºPalet", "Fecha", "Denominación Producto", "Lote",
    "DcmtoVta", "Fecha ", "Cliente", "Cajas", "TipoCaja", "Netos", "Fact.", "Sit"];
  const ws = XLSX.utils.json_to_sheet(filas, { header: cabecera });
  // La segunda "Fecha" lleva un espacio para no chocar con la primera en el
  // objeto; en el Excel debe verse igual que en el original.
  ws.G1 = { t: "s", v: "Fecha" };
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet 1");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

/**
 * El nombre que le pone ESTE generador. Es lo que distingue un GSTOCK suyo de
 * uno que subió una persona, que siempre lleva nombre libre ("palets 4 ago.xlsx",
 * "29 julio.xlsx", "PALETS 31 JUL.xlsx"). Un archivo de una persona no se borra
 * jamás, aunque el ERP diga otra cosa.
 */
export const nombreGenerado = (fecha) => `GSTOCK ${fecha}.xlsx`;

/**
 * ¿Se puede rehacer el GSTOCK que ya tiene el parte? Devuelve el motivo por el
 * que NO, o null si se puede.
 */
function motivoParaNoRehacer(parte, archivos, fecha, refrescarSiFaltanKg) {
  if (!refrescarSiFaltanKg) return "el parte ya tiene un GSTOCK subido";
  if (parte.estado === "Validado") return `el parte esta Validado (firmado por una persona)`;
  if (archivos.some((a) => a.file_name !== nombreGenerado(fecha))) {
    return "el GSTOCK del parte lo subio una persona";
  }
  return null;
}

/**
 * @param refrescarSiFaltanKg  si el parte YA tiene un GSTOCK generado por aqui y
 *   el ERP tiene mas kilos que los que el parte guarda, se rehace — pero solo si
 *   la diferencia pasa de estos kilos. A 0 (por defecto) nunca se rehace nada.
 *
 *   POR QUE HACE FALTA (medido el 14-08-2026 sobre 55 partes): el Excel se
 *   genera a las 07:10 del dia siguiente y a esa hora TODAVIA no han terminado
 *   de dar de alta. 31 de esos 55 dias tienen menos palets en el parte que en el
 *   ERP, y casi siempre porque faltan, no porque sobren. El 11-08 faltaban
 *   11.662 kg y el descuadre del dia era del 22%; con los del ERP baja al 5,1%.
 *
 *   SOLO SE REHACE SI EL ERP TIENE MAS, nunca al reves. Reemplazar a ciegas
 *   empeora los dias con descuadre negativo (mas palets que produccion): sobre
 *   los 55 partes, el |DSJ| medio solo baja de 13,80% a 12,95% porque 18 dias
 *   mejoran y 12 empeoran. La regla no es "el ERP manda", es "el ERP manda
 *   cuando al parte le faltan palets".
 */
export async function generarYSubir(supabase, conn, fecha, { aplicar = false, refrescarSiFaltanKg = 0 } = {}) {
  const { data: parte, error: errP } = await supabase.from("partes_diarios")
    .select("id, user_id, estado, kg_palets_brutos").eq("date", fecha).maybeSingle();
  if (errP) throw new Error(`parte: ${errP.message}`);
  if (!parte) return { fecha, accion: "sin-parte" };

  const { data: yaHay, error: errA } = await supabase.from("partes_archivos")
    .select("id, file_name, file_path").eq("part_id", parte.id).eq("file_type", "GSTOCK");
  if (errA) throw new Error(`archivos: ${errA.message}`);

  let viejos = null;
  if (yaHay?.length) {
    const motivo = motivoParaNoRehacer(parte, yaHay, fecha, refrescarSiFaltanKg);
    if (motivo) return { fecha, accion: "ya-tenia", motivo };
    viejos = yaHay;
  }

  const { filas, sospechosos } = await filasGstock(conn, fecha);
  if (filas.length === 0) return { fecha, accion: "sin-palets" };

  const kg = filas.reduce((s, f) => s + f.Netos, 0);

  if (viejos) {
    const faltan = kg - num(parte.kg_palets_brutos);
    if (!(faltan > refrescarSiFaltanKg)) {
      return { fecha, accion: "ya-tenia", motivo: "el ERP no aporta palets que el parte no tenga" };
    }
    if (!aplicar) {
      return { fecha, accion: "reharia", palets: filas.length, kg, faltan,
        teniaKg: num(parte.kg_palets_brutos), sospechosos };
    }
    // BORRAR ANTES DE SUBIR, a proposito. Si se subiera primero y algo fallara
    // en medio, el parte se quedaria con DOS GSTOCK y el analisis sumaria los
    // palets dos veces, en silencio. Al reves, lo peor que pasa es que el parte
    // se quede un rato sin GSTOCK: el correo lo dice y la siguiente pasada lo
    // vuelve a generar.
    // Primero la FILA (con reintento: el analisis del parte puede tener
    // bloqueada lote_clasificacion, cuya FK a partes_archivos hace esperar al
    // DELETE, ver generar-informes-parte.mjs) y despues el fichero: al reves,
    // un timeout dejaba la fila apuntando a un fichero que ya no existia.
    let errFila = null;
    for (let intento = 1; intento <= 3; intento++) {
      ({ error: errFila } = await supabase.from("partes_archivos").delete().in("id", viejos.map((a) => a.id)));
      if (!errFila || !/statement timeout|57014|lock/i.test(errFila.message ?? "")) break;
      await new Promise((r) => setTimeout(r, 5000 * intento));
    }
    if (errFila) throw new Error(`borrando la fila del GSTOCK viejo: ${errFila.message}`);
    const { error: errBorra } = await supabase.storage.from("partes-archivos")
      .remove(viejos.map((a) => a.file_path));
    if (errBorra) console.warn(`[gstock] la fila se borro pero el fichero viejo sigue en el storage: ${errBorra.message}`);
  }

  if (!aplicar) return { fecha, accion: "subiria", palets: filas.length, kg, sospechosos };

  const buffer = construirLibro(filas);
  const nombre = nombreGenerado(fecha);
  const ruta = `${parte.user_id}/${parte.id}/GSTOCK/${crypto.randomUUID()}-${nombre.replace(/\s/g, "_")}`;

  const { error: errU } = await supabase.storage.from("partes-archivos")
    .upload(ruta, buffer, {
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      upsert: false,
    });
  if (errU) throw new Error(`storage: ${errU.message}`);

  const { error: errI } = await supabase.from("partes_archivos").insert({
    part_id: parte.id, user_id: parte.user_id, file_name: nombre, file_path: ruta,
    file_type: "GSTOCK",
    mime_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    file_size: buffer.length,
  });
  if (errI) throw new Error(`partes_archivos: ${errI.message}`);

  // "rehecho" no es lo mismo que "subido": el parte ya tenia unos kilos y ahora
  // tiene otros, asi que hay que volver a analizarlo para que los lea. Quien
  // llama lo distingue por esto.
  if (viejos) {
    return { fecha, accion: "rehecho", palets: filas.length, kg,
      teniaKg: num(parte.kg_palets_brutos), faltaban: kg - num(parte.kg_palets_brutos), sospechosos };
  }
  return { fecha, accion: "subido", palets: filas.length, kg, sospechosos };
}

async function main() {
  const args = process.argv.slice(2);
  const aplicar = args.includes("--aplicar");
  const dd = (n) => String(n).padStart(2, "0");
  const hoy = new Date();
  const fecha = args.find((a) => a.startsWith("--fecha="))?.split("=")[1]
    ?? (() => { const d = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() - 1); return `${d.getFullYear()}-${dd(d.getMonth() + 1)}-${dd(d.getDate())}`; })();

  const supabase = createClient(
    process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  // --refrescar=N rehace el GSTOCK de un parte en Borrador cuando el ERP tiene
  // mas de N kilos que el parte no recogio. Sin el, un parte que ya tiene GSTOCK
  // no se toca.
  const refrescarSiFaltanKg = Number(args.find((a) => a.startsWith("--refrescar="))?.split("=")[1]) || 0;

  // --dias=N recorre la ventana entera, de ayer hacia atras. Es el paso 1 del
  // corte del aviso (docs/SISTEMA_LASARTE.md): el GSTOCK es lo unico del aviso
  // que necesita el ERP, asi que sacarlo a su propia entrada deja al aviso
  // hablando solo con Supabase — que es lo que permite moverlo fuera del
  // portatil. Aqui todavia no se le quita nada al aviso: esta entrada existe y
  // se puede llamar, pero el .cmd sigue como estaba.
  const dias = Number(args.find((a) => a.startsWith("--dias="))?.split("=")[1]) || 0;
  if (dias > 0) {
    const fin = new Date(`${fecha}T12:00:00`);
    const fechas = Array.from({ length: dias }, (_, i) =>
      (() => { const d = new Date(fin.getFullYear(), fin.getMonth(), fin.getDate() - i);
        return `${d.getFullYear()}-${dd(d.getMonth() + 1)}-${dd(d.getDate())}`; })());
    const conn = await conectarErp();
    let tocados = 0;
    try {
      for (const f of fechas) {
        const x = await generarYSubir(supabase, conn, f, { aplicar, refrescarSiFaltanKg });
        if (["subido", "rehecho", "subiria", "reharia"].includes(x.accion)) {
          tocados++;
          console.log(`GSTOCK del ${f}: ${x.accion}` +
            (x.palets ? ` · ${x.palets} palets · ${Math.round(x.kg).toLocaleString("es")} kg` : ""));
          if (x.faltaban != null) {
            console.log(`  le faltaban ${Math.round(x.faltaban).toLocaleString("es")} kg de palets` +
              " · HAY QUE VOLVER A ANALIZAR el parte");
          }
        }
        for (const s of x.sospechosos ?? []) {
          console.log(`  AVISO: el palet ${s.palet} del ${f} tiene ${Math.round(s.kg).toLocaleString("es")} kg` +
            ` ("${s.producto}"). Un palet fisico no llega a eso.`);
        }
      }
    } finally {
      await conn.end().catch(() => {});
    }
    console.log(`${fechas.length} dias repasados, ${tocados} con cambios.`);
    if (!aplicar) console.log("(simulacion: repite con --aplicar)");
    return;
  }

  const conn = await conectarErp();
  let r;
  try {
    r = await generarYSubir(supabase, conn, fecha, { aplicar, refrescarSiFaltanKg });
  } finally {
    await conn.end().catch(() => {});
  }

  console.log(`GSTOCK del ${r.fecha}: ${r.accion}${r.motivo ? ` (${r.motivo})` : ""}` +
    (r.palets ? ` · ${r.palets} palets · ${Math.round(r.kg).toLocaleString("es")} kg` : ""));
  if (r.teniaKg != null) {
    console.log(`  el parte tenia ${Math.round(r.teniaKg).toLocaleString("es")} kg:` +
      ` le faltaban ${Math.round(r.faltaban ?? r.faltan).toLocaleString("es")} kg de palets.`);
    console.log("  HAY QUE VOLVER A ANALIZAR el parte para que lea los nuevos.");
  }
  for (const s of r.sospechosos ?? []) {
    console.log(`  AVISO: el palet ${s.palet} tiene ${s.kg.toLocaleString("es")} kg ("${s.producto}")` +
      `${s.desmontado ? ", y es un DESMONTADO (industria o precalibrado)" : ""}.` +
      " Un palet fisico no llega a eso: se apunto despues con la fecha del lote.");
  }
  if (!aplicar && ["subiria", "reharia"].includes(r.accion)) {
    console.log("  (simulacion: repite con --aplicar)");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
}

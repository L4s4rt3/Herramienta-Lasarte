/**
 * mercadona-facturacion-erp.mjs — la tarifa REAL de Mercadona por semana y
 * formato, del ERP a la base, sin subir el Excel del lunes a mano.
 *
 * POR QUÉ. mercadona_semanas / mercadona_semana_metodos guardan por semana ISO lo
 * que Mercadona compró por formato (MA3KGC malla 3 kg, MA4KGC girsac 4 kg,
 * MA5KGC D-Pack 5 kg, MA12KGC granel) y su base facturada sin IVA. Esa base se
 * cargaba subiendo un Excel que es un listado del propio ERP sacado el lunes, y
 * como los albaranes de Mercadona se valoran al FACTURAR, el listado salía a
 * medias: las semanas 27-29 y 32 de 2026 quedaron a 0,38-0,47 €/kg cuando la
 * tarifa real es ~1,02 (S30 y S31, bien cargadas, son el patrón de verdad y
 * este script las reproduce al céntimo). Leyendo hoy el ERP la base sale entera.
 *
 * QUÉ LEE (SOLO SELECT, docs/ERP_LR_INFORMATICA.md): gdata001.fact_lin_alb del
 * cliente 430000287 por fecha_albaran (índice num_cliente+fecha_albaran),
 * palets_cab por documento de venta (índice Dcmto_vta) para la fórmula de
 * confección = método, agri_confeccion_cab para la descripción del método y
 * terceros_centros_cliente para nombrar la plataforma. El criterio y sus pruebas
 * están en supabase/functions/_shared/mercadonaFacturacionErp.ts.
 *
 * QUÉ ESCRIBE. Nada sin --aplicar. Con --aplicar, SOLO base_iva y lineas de los
 * métodos (y ajustes_base_iva/ajustes_lineas de la cabecera) de las semanas que
 * existen en la base con base vacía o parcial (< 80 % del ERP), y solo si el
 * ERP tiene la semana entera facturada. kilos/palets/cajas de una fila que ya
 * existe no se tocan nunca. Una semana que NO existe en la base solo se crea con
 * --crear-semanas (nace del ERP: kilos, palets, cajas, líneas y base; sin
 * planificación). Idempotente: la segunda pasada no cambia nada.
 *
 *   node scripts/mercadona-facturacion-erp.mjs                          # informe: S27-2026 → semana pasada
 *   node scripts/mercadona-facturacion-erp.mjs --desde=27 --hasta=36    # semanas del año ISO actual
 *   node scripts/mercadona-facturacion-erp.mjs --desde=2026-W27 --hasta=2026-W36 --aplicar
 *   node scripts/mercadona-facturacion-erp.mjs --aplicar --crear-semanas
 *   node scripts/mercadona-facturacion-erp.mjs --sin-rastro             # no anota en sistema_ejecuciones (pruebas)
 *
 * Deja rastro en sistema_ejecuciones / sistema_latidos (trabajo
 * "mercadona-facturacion-erp") salvo con --sin-rastro. Exporta
 * sincronizarFacturacionMercadona() para que la mitad ERP de la tarea diaria
 * (lib-aviso-erp.mjs) pueda llamarlo con su misma conexión.
 */
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { conectarErp } from "./lib-palets-erp.mjs";
import { anotarEjecucion, salirConError } from "./lib-registro-ejecuciones.mjs";
import { fechaLocalISO, fechasSemanaIso, semanaIsoAnterior, semanaIsoDe } from "../supabase/functions/_shared/semanaIso.ts";
import {
  CLIENTE_MERCADONA_ERP,
  agruparFacturacionErp,
  cambiosDeSemana,
  claveLineaVenta,
  claveSemana,
  decidirSemana,
  parsearSemanaArg,
  rangoFechas,
  semanasEntre,
} from "../supabase/functions/_shared/mercadonaFacturacionErp.ts";

try { process.loadEnvFile(path.resolve(".env")); } catch { /* entorno */ }

const EMPRESA = "gdata001";
const TRABAJO = "mercadona-facturacion-erp";
/** Documentos por consulta IN (...): unas 20 por semana, así que 200 son diez semanas de golpe. */
const TANDA = 200;
/**
 * Primera semana del formato "semanal real" (con base_iva) en la base: desde
 * aquí la tarifa se compara y se completa. Lo anterior es planificación sin €.
 */
export const PRIMERA_SEMANA_TARIFA = { anio: 2026, semana: 27 };

// ─── Lectura del ERP ─────────────────────────────────────────────────────────

const num = (v) => (v == null || v === "" ? 0 : Number(v));
const txt = (v) => (v == null ? null : String(v).trim());

/** Todas las líneas de venta a Mercadona con fecha de albarán en [desde, hasta). */
async function leerLineasErp(conn, desdeISO, hastaExclusivoISO) {
  // Índice num_cliente(num_cliente, fecha_albaran, …): la campaña entera sale en un segundo.
  const [filas] = await conn.query(
    `SELECT l.tipo_documento, TRIM(l.serie_dcmto) AS serie, l.num_dcmto, l.num_linea,
            DATE(l.fecha_albaran) AS fecha_albaran, l.articulo, ag.denominacion, l.texto,
            l.unidades_1 AS kg, l.importe, NULLIF(l.num_factura, 0) AS num_factura, l.centro_cliente
       FROM ${EMPRESA}.fact_lin_alb l
       LEFT JOIN ${EMPRESA}.articulo_general ag ON ag.codigo = l.articulo
      WHERE l.num_cliente = ? AND l.fecha_albaran >= ? AND l.fecha_albaran < ?`,
    [CLIENTE_MERCADONA_ERP, desdeISO, hastaExclusivoISO],
  );
  return filas.map((f) => ({
    tipoDocumento: num(f.tipo_documento),
    serie: txt(f.serie) ?? "",
    numDcmto: num(f.num_dcmto),
    numLinea: num(f.num_linea),
    fechaAlbaran: String(f.fecha_albaran),
    articulo: txt(f.articulo) ?? "",
    denominacion: txt(f.denominacion),
    texto: txt(f.texto),
    kg: num(f.kg),
    importe: num(f.importe),
    numFactura: f.num_factura == null ? null : num(f.num_factura),
    centroCliente: txt(f.centro_cliente),
  }));
}

/**
 * Los palets de cada línea de venta, por fórmula de confección. palets_cab
 * apunta a la línea exacta (tipo/serie/num/num_linea_vta) y tiene el índice
 * Dcmto_vta(tipo_documento_vta, serie_dcmto_vta, num_dcmto_vta, …): se consulta
 * por ese prefijo, serie a serie, y nunca uniendo tablas grandes (la lección de
 * la trazabilidad, docs/ERP_LR_INFORMATICA.md).
 */
async function leerPaletsDeLineas(conn, lineas) {
  const porSerie = new Map();
  for (const l of lineas) {
    if (!porSerie.has(l.serie)) porSerie.set(l.serie, new Set());
    porSerie.get(l.serie).add(l.numDcmto);
  }
  const salida = new Map();
  for (const [serie, docs] of porSerie) {
    const numeros = [...docs];
    for (let i = 0; i < numeros.length; i += TANDA) {
      const [filas] = await conn.query(
        `SELECT p.num_dcmto_vta AS num_dcmto, p.num_linea_vta AS num_linea, TRIM(p.formula_confeccion) AS formula,
                COUNT(*) AS palets, SUM(p.kilos_netos) AS kg, SUM(p.num_cajas) AS cajas
           FROM ${EMPRESA}.palets_cab p
          WHERE p.tipo_documento_vta = 40 AND p.serie_dcmto_vta = ? AND p.num_dcmto_vta IN (?)
          GROUP BY p.num_dcmto_vta, p.num_linea_vta, TRIM(p.formula_confeccion)`,
        [serie, numeros.slice(i, i + TANDA)],
      );
      for (const f of filas) {
        const clave = claveLineaVenta(serie, num(f.num_dcmto), num(f.num_linea));
        if (!salida.has(clave)) salida.set(clave, []);
        salida.get(clave).push({ metodo: txt(f.formula) ?? "", palets: num(f.palets), kg: num(f.kg), cajas: num(f.cajas) });
      }
    }
  }
  return salida;
}

/** Descripción de cada método (la que el Excel traía: "HACENDADO D-PACK 4 X 3 KG PLASTICO"). */
async function leerCatalogoMetodos(conn, metodos) {
  if (metodos.length === 0) return new Map();
  // agri_confeccion_cab tiene ~1.000 filas y la fórmula va con espacio de cola: TRIM y a memoria.
  const [filas] = await conn.query(
    `SELECT TRIM(formula) AS formula, denominacion FROM ${EMPRESA}.agri_confeccion_cab WHERE TRIM(formula) IN (?)`,
    [metodos],
  );
  return new Map(filas.map((f) => [txt(f.formula), txt(f.denominacion)]));
}

/** Nombre de cada plataforma de Mercadona (04 ANTEQUERA, 07 SAN ISIDROS FRESCOS = Madrid). */
async function leerCentros(conn) {
  const [filas] = await conn.query(
    `SELECT centro_cliente, denominacion_centro FROM ${EMPRESA}.terceros_centros_cliente WHERE num_cliente = ?`,
    [CLIENTE_MERCADONA_ERP],
  );
  return new Map(filas.map((f) => [txt(f.centro_cliente), txt(f.denominacion_centro)]));
}

// ─── Lectura de la base ──────────────────────────────────────────────────────

const numONull = (v) => (v == null ? null : Number(v));

/**
 * Las semanas pedidas tal y como están en la base, por clave "2026-W30". Son
 * pocas filas (≤ 53 semanas × 5 métodos por año), muy por debajo del recorte
 * de 1.000 de PostgREST, y se piden por año para no mezclar semanas ISO.
 */
async function leerSemanasBase(supabase, semanas) {
  const porAnio = new Map();
  for (const s of semanas) {
    if (!porAnio.has(s.anio)) porAnio.set(s.anio, []);
    porAnio.get(s.anio).push(s.semana);
  }
  const salida = new Map();
  for (const [anio, numeros] of porAnio) {
    const { data: cabeceras, error } = await supabase.from("mercadona_semanas")
      .select("id, user_id, anio, semana, vendido_kg, ajustes_base_iva, ajustes_lineas, notas")
      .eq("anio", anio).in("semana", numeros).order("semana");
    if (error) throw new Error(`leyendo mercadona_semanas: ${error.message}`);
    const ids = (cabeceras ?? []).map((c) => c.id);
    let metodos = [];
    if (ids.length > 0) {
      const { data, error: errorMetodos } = await supabase.from("mercadona_semana_metodos")
        .select("id, semana_id, metodo, descripcion, kilos, palets, cajas, lineas, base_iva")
        .in("semana_id", ids).order("metodo");
      if (errorMetodos) throw new Error(`leyendo mercadona_semana_metodos: ${errorMetodos.message}`);
      metodos = data ?? [];
    }
    for (const c of cabeceras ?? []) {
      salida.set(claveSemana(c), {
        id: c.id, userId: c.user_id, anio: c.anio, semana: c.semana,
        vendidoKg: numONull(c.vendido_kg),
        ajustesBaseIva: numONull(c.ajustes_base_iva), ajustesLineas: numONull(c.ajustes_lineas),
        notas: c.notas ?? [],
        metodos: metodos.filter((m) => m.semana_id === c.id).map((m) => ({
          id: m.id, metodo: String(m.metodo ?? "").trim().toUpperCase(),
          kilos: numONull(m.kilos), baseIva: numONull(m.base_iva), lineas: numONull(m.lineas),
        })),
      });
    }
  }
  return salida;
}

// ─── Escritura ───────────────────────────────────────────────────────────────

const hoyISO = () => fechaLocalISO(new Date());

/**
 * Aplica "actualizar" a una semana existente: base_iva y lineas de cada método
 * (insertando el método si el ERP lo tiene y la base no) y los ajustes de la
 * cabecera. Devuelve la lista de filas tocadas, para el informe y el rastro.
 */
async function actualizarSemana(supabase, erp, base, catalogo) {
  const hechos = [];
  const cambios = cambiosDeSemana(erp, base);
  for (const c of cambios.metodos) {
    if (c.idBase) {
      const { error } = await supabase.from("mercadona_semana_metodos")
        .update({ base_iva: c.baseDespues, lineas: c.lineasDespues }).eq("id", c.idBase);
      if (error) throw new Error(`${erp.clave} ${c.metodo}: ${error.message}`);
      hechos.push({ semana: erp.clave, fila: `mercadona_semana_metodos ${c.metodo}`, id: c.idBase, accion: "update",
        antes: { base_iva: c.baseAntes, lineas: c.lineasAntes }, despues: { base_iva: c.baseDespues, lineas: c.lineasDespues } });
    } else {
      // El ERP tiene un método que la base no: nace del ERP entero (no hay Excel que respetar).
      const m = erp.metodos.find((x) => x.metodo === c.metodo);
      const fila = filaMetodoDesdeErp(base.id, m, catalogo);
      const { data, error } = await supabase.from("mercadona_semana_metodos").insert(fila).select("id").single();
      if (error) throw new Error(`${erp.clave} ${c.metodo} (insert): ${error.message}`);
      hechos.push({ semana: erp.clave, fila: `mercadona_semana_metodos ${c.metodo}`, id: data.id, accion: "insert", antes: null, despues: fila });
    }
  }
  if (cambios.ajustes) {
    const despues = { ajustes_base_iva: cambios.ajustes.despues.base, ajustes_lineas: cambios.ajustes.despues.lineas };
    const { error } = await supabase.from("mercadona_semanas").update(despues).eq("id", base.id);
    if (error) throw new Error(`${erp.clave} ajustes: ${error.message}`);
    hechos.push({ semana: erp.clave, fila: "mercadona_semanas ajustes", id: base.id, accion: "update",
      antes: { ajustes_base_iva: cambios.ajustes.antes.base, ajustes_lineas: cambios.ajustes.antes.lineas }, despues });
  }
  return hechos;
}

function filaMetodoDesdeErp(semanaId, m, catalogo) {
  return {
    semana_id: semanaId, metodo: m.metodo, descripcion: catalogo.get(m.metodo) ?? null,
    pct: null, kilos: m.kg, palets: m.palets || null, cajas: m.cajas || null, comparativa_anterior_pct: null,
    lineas: m.lineas, base_iva: m.base,
  };
}

/**
 * Crea una semana que no existe en la base, entera desde el ERP. La cabecera
 * necesita user_id: se usa el de la última semana cargada (quien importa los
 * Excel), para que esa persona pueda seguir editándola en la app; y se deja en
 * `notas` que la creó este script, que es la única marca de origen que hay.
 */
async function crearSemana(supabase, erp, catalogo, userId) {
  const hechos = [];
  const cabecera = {
    user_id: userId, anio: erp.anio, semana: erp.semana,
    rango_planificacion: null, planificado_quincena_kg: null, planificado_semana_kg: null,
    vendido_kg: erp.kgMetodos, diferencia_pct: null,
    notas: [`Creada desde el ERP por scripts/mercadona-facturacion-erp.mjs el ${hoyISO()} (facturación real; sin planificación).`],
    ajustes_base_iva: erp.ajustes.lineas > 0 ? erp.ajustes.base : null,
    ajustes_lineas: erp.ajustes.lineas > 0 ? erp.ajustes.lineas : null,
  };
  const { data, error } = await supabase.from("mercadona_semanas").insert(cabecera).select("id").single();
  if (error) throw new Error(`${erp.clave} (crear cabecera): ${error.message}`);
  hechos.push({ semana: erp.clave, fila: "mercadona_semanas", id: data.id, accion: "insert", antes: null, despues: cabecera });
  const filas = erp.metodos.map((m) => filaMetodoDesdeErp(data.id, m, catalogo));
  if (filas.length > 0) {
    const { error: errorMetodos } = await supabase.from("mercadona_semana_metodos").insert(filas);
    if (errorMetodos) throw new Error(`${erp.clave} (crear métodos): ${errorMetodos.message}`);
    for (const f of filas) hechos.push({ semana: erp.clave, fila: `mercadona_semana_metodos ${f.metodo}`, id: null, accion: "insert", antes: null, despues: f });
  }
  return hechos;
}

async function usuarioParaCrear(supabase) {
  const { data, error } = await supabase.from("mercadona_semanas")
    .select("user_id, anio, semana").order("updated_at", { ascending: false }).limit(1);
  if (error) throw new Error(`buscando el usuario de la última semana: ${error.message}`);
  return data?.[0]?.user_id ?? null;
}

// ─── El trabajo entero ───────────────────────────────────────────────────────

/**
 * Lee el ERP y la base para el rango de semanas, decide semana a semana y, si
 * `aplicar`, escribe. Devuelve un resultado serializable (JSON puro) con la
 * tabla, las decisiones y las filas tocadas: sirve al informe por consola, al
 * rastro y a la tarea diaria.
 */
export async function sincronizarFacturacionMercadona(supabase, conn, { desde, hasta, aplicar = false, crearSemanas = false } = {}) {
  const inicio = new Date().toISOString();
  const semanas = semanasEntre(desde, hasta);
  const { desdeISO, hastaExclusivoISO } = rangoFechas(desde, hasta);

  const lineas = await leerLineasErp(conn, desdeISO, hastaExclusivoISO);
  const palets = await leerPaletsDeLineas(conn, lineas);
  const porSemanaErp = new Map(agruparFacturacionErp(lineas, palets).map((s) => [s.clave, s]));
  const metodosVistos = [...new Set([...porSemanaErp.values()].flatMap((s) => s.metodos.map((m) => m.metodo)))];
  const catalogo = await leerCatalogoMetodos(conn, metodosVistos);
  const centros = await leerCentros(conn);
  const porSemanaBase = await leerSemanasBase(supabase, semanas);

  const filas = [];
  const hechos = [];
  const incidencias = [];
  let userId;
  for (const ref of semanas) {
    const clave = claveSemana(ref);
    const erp = porSemanaErp.get(clave) ?? null;
    const base = porSemanaBase.get(clave) ?? null;
    const decision = decidirSemana(erp, base);
    const fila = { ...decision, ref, erp, base, aplicado: false, motivoNoAplicado: null };
    if (decision.accion === "no-cuadra") incidencias.push(`${clave}: ${decision.motivo}`);

    if (aplicar && decision.accion === "actualizar") {
      hechos.push(...await actualizarSemana(supabase, erp, base, catalogo));
      fila.aplicado = true;
    } else if (aplicar && decision.accion === "crear") {
      if (!crearSemanas) {
        fila.motivoNoAplicado = "falta --crear-semanas";
      } else {
        userId ??= await usuarioParaCrear(supabase);
        if (!userId) {
          fila.motivoNoAplicado = "no hay ninguna semana en la base de la que tomar el user_id";
          incidencias.push(`${clave}: ${fila.motivoNoAplicado}`);
        } else {
          hechos.push(...await crearSemana(supabase, erp, catalogo, userId));
          fila.aplicado = true;
        }
      }
    }
    filas.push(fila);
  }

  const resumen = {};
  for (const f of filas) resumen[f.accion] = (resumen[f.accion] ?? 0) + 1;
  return JSON.parse(JSON.stringify({
    trabajo: TRABAJO, inicio, desde: claveSemana(desde), hasta: claveSemana(hasta), aplicar, crearSemanas,
    lineasErp: lineas.length, centros: Object.fromEntries(centros), catalogo: Object.fromEntries(catalogo),
    semanas: filas, hechos, incidencias, resumen,
  }));
}

// ─── Informe por consola ─────────────────────────────────────────────────────

const es = new Intl.NumberFormat("es-ES", { maximumFractionDigits: 0 });
const es2 = new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const es4 = new Intl.NumberFormat("es-ES", { minimumFractionDigits: 4, maximumFractionDigits: 4 });
const fKg = (n) => (n == null ? "—" : es.format(n));
const fEur = (n) => (n == null ? "—" : es2.format(n));
const fEurKg = (base, kg) => (base == null || !kg ? "—" : es4.format(base / kg));
const col = (s, ancho, izq = false) => (izq ? String(s).padEnd(ancho) : String(s).padStart(ancho));
const ddmm = (iso) => `${iso.slice(8, 10)}-${iso.slice(5, 7)}`;

export function imprimirInforme(resultado) {
  const { desde, hasta, aplicar, semanas, hechos, incidencias, centros } = resultado;
  console.log(`\nFacturación Mercadona por semana ISO: ${desde} → ${hasta}   modo: ${aplicar ? "APLICAR" : "solo informar"}   (${resultado.lineasErp} líneas del ERP)`);
  console.log("Criterio: fact_lin_alb del cliente 430000287 por fecha de ALBARÁN; método = fórmula de confección de los palets; serie R = ajustes.");
  const cab = `  ${col("Método", 9, true)} ${col("ERP kg", 9)} ${col("Base kg", 9)} ${col("ERP base €", 13)} ${col("Base base €", 13)} ${col("Δ base €", 12)} ${col("ERP lín", 7)} ${col("Base lín", 8)} ${col("ERP €/kg", 9)} ${col("Base €/kg", 9)}`;

  for (const s of semanas) {
    const dias = fechasSemanaIso(s.ref.anio, s.ref.semana);
    const estado = s.aplicado ? " → APLICADO" : s.motivoNoAplicado ? ` → no aplicado (${s.motivoNoAplicado})` : "";
    console.log(`\n${s.clave}  (${ddmm(dias[0])} → ${ddmm(dias[6])})   ${s.accion}${estado} — ${s.motivo}`);
    if (!s.erp && !s.base) continue;
    console.log(cab);
    const metodosBase = new Map((s.base?.metodos ?? []).map((m) => [m.metodo, m]));
    const nombres = [...new Set([...(s.erp?.metodos ?? []).map((m) => m.metodo), ...metodosBase.keys()])].sort();
    for (const nombre of nombres) {
      const e = s.erp?.metodos.find((m) => m.metodo === nombre) ?? null;
      const b = metodosBase.get(nombre) ?? null;
      const delta = e && b?.baseIva != null ? e.base - b.baseIva : null;
      const marca = e?.sinValorar ? ` (${e.sinValorar} sin valorar)` : e?.porTexto ? ` (${e.porTexto} por texto)` : "";
      console.log(`  ${col(nombre, 9, true)} ${col(fKg(e?.kg), 9)} ${col(fKg(b?.kilos), 9)} ${col(fEur(e?.base), 13)} ${col(fEur(b?.baseIva), 13)} ${col(fEur(delta), 12)} ${col(e?.lineas ?? "—", 7)} ${col(b?.lineas ?? "—", 8)} ${col(fEurKg(e?.base, e?.kg), 9)} ${col(fEurKg(b?.baseIva, b?.kilos), 9)}${marca}`);
    }
    if (s.erp?.sinMetodo) {
      const m = s.erp.sinMetodo;
      console.log(`  ${col("SIN MÉTODO", 9, true)} ${col(fKg(m.kg), 9)} ${col("—", 9)} ${col(fEur(m.base), 13)} ${col("—", 13)} ${col("—", 12)} ${col(m.lineas, 7)}   ← líneas de venta sin palets ni formato`);
    }
    const kgBase = s.base ? s.base.metodos.reduce((a, m) => a + (m.kilos ?? 0), 0) : null;
    const linBase = s.base ? s.base.metodos.reduce((a, m) => a + (m.lineas ?? 0), 0) : null;
    const deltaTotal = s.baseErp != null && s.baseDb != null ? s.baseErp - s.baseDb : null;
    console.log(`  ${col("TOTAL", 9, true)} ${col(fKg(s.erp?.kgMetodos), 9)} ${col(fKg(kgBase), 9)} ${col(fEur(s.baseErp), 13)} ${col(fEur(s.baseDb), 13)} ${col(fEur(deltaTotal), 12)} ${col(s.erp?.lineasMetodos ?? "—", 7)} ${col(linBase ?? "—", 8)} ${col(fEurKg(s.baseErp, s.erp?.kgMetodos), 9)} ${col(fEurKg(s.baseDb, kgBase), 9)}`);
    const ajErp = s.erp && s.erp.ajustes.lineas > 0 ? s.erp.ajustes : null;
    if (ajErp || s.base?.ajustesBaseIva != null) {
      const deltaAj = ajErp && s.base?.ajustesBaseIva != null ? ajErp.base - s.base.ajustesBaseIva : null;
      console.log(`  ${col("Ajustes R", 9, true)} ${col(ajErp?.kg ? fKg(ajErp.kg) : "—", 9)} ${col("—", 9)} ${col(fEur(ajErp?.base), 13)} ${col(fEur(s.base?.ajustesBaseIva), 13)} ${col(fEur(deltaAj), 12)} ${col(ajErp?.lineas ?? "—", 7)} ${col(s.base?.ajustesLineas ?? "—", 8)}   (abonos: sin método, restan del neto)`);
    }
    if (s.erp && s.erp.porCentro.length > 0) {
      console.log(`  Plataformas: ${s.erp.porCentro.map((c) => `${c.centro} ${centros[c.centro] ?? "?"} ${c.lineas} lín / ${fKg(c.kg)} kg / ${fEur(c.base)} €`).join(" · ")}`);
    }
    for (const a of s.avisos) console.log(`  Aviso: ${a}`);
  }

  console.log(`\nResumen: ${Object.entries(resultado.resumen).map(([k, v]) => `${v} ${k}`).join(", ")}.`);
  if (hechos.length > 0) {
    console.log(`\nFilas tocadas (${hechos.length}):`);
    for (const h of hechos) {
      console.log(`  ${h.semana} ${h.accion} ${h.fila}${h.id ? ` [${h.id}]` : ""}: ${h.antes ? `${JSON.stringify(h.antes)} → ` : ""}${JSON.stringify(h.despues)}`);
    }
  } else if (aplicar) {
    console.log("\nNo había nada que escribir: la base ya decía lo mismo que el ERP.");
  }
  for (const i of incidencias) console.log(`INCIDENCIA: ${i}`);
}

// ─── main ────────────────────────────────────────────────────────────────────

function leerArgumentos(argv) {
  const valor = (nombre) => argv.find((a) => a.startsWith(`--${nombre}=`))?.split("=")[1];
  const hoy = fechaLocalISO(new Date());
  const anioIso = semanaIsoDe(hoy).anio;
  const desde = valor("desde") == null ? PRIMERA_SEMANA_TARIFA : parsearSemanaArg(valor("desde"), anioIso);
  const hasta = valor("hasta") == null ? semanaIsoAnterior(hoy) : parsearSemanaArg(valor("hasta"), anioIso);
  if (!desde || !hasta) throw new Error("--desde/--hasta tienen que ser una semana ISO válida: 2026-W27 o 27.");
  if (claveSemana(desde) > claveSemana(hasta)) throw new Error(`--desde (${claveSemana(desde)}) es posterior a --hasta (${claveSemana(hasta)}).`);
  return {
    desde, hasta,
    aplicar: argv.includes("--aplicar"),
    crearSemanas: argv.includes("--crear-semanas"),
    sinRastro: argv.includes("--sin-rastro"),
  };
}

function detalleDe(resultado) {
  const r = resultado.resumen;
  const partes = Object.entries(r).map(([k, v]) => `${v} ${k}`);
  return `${resultado.desde}→${resultado.hasta} (${resultado.aplicar ? "aplicar" : "informe"}): ${partes.join(", ")}` +
    (resultado.hechos.length ? ` · ${resultado.hechos.length} fila(s) escritas` : "");
}

async function main() {
  const inicio = new Date().toISOString();
  const opciones = leerArgumentos(process.argv.slice(2));
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Faltan SUPABASE_URL y/o SUPABASE_SERVICE_ROLE_KEY en el entorno (.env).");
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  const conn = await conectarErp();
  let resultado;
  try {
    resultado = await sincronizarFacturacionMercadona(supabase, conn, opciones);
  } finally {
    await conn.end().catch(() => {});
  }
  imprimirInforme(resultado);

  if (!opciones.sinRastro) {
    // "aviso" = corrió, pero dejó semanas que no cuadran o que difieren sin tocarse: alguien tiene que mirarlas.
    const conAviso = resultado.semanas.some((s) => s.accion === "no-cuadra" || s.accion === "difiere-sin-tocar");
    await anotarEjecucion({
      trabajo: TRABAJO, inicio, estado: conAviso ? "aviso" : "ok", detalle: detalleDe(resultado).slice(0, 500),
      datos: {
        desde: resultado.desde, hasta: resultado.hasta, aplicar: resultado.aplicar, crearSemanas: resultado.crearSemanas,
        resumen: resultado.resumen, incidencias: resultado.incidencias,
        semanas: resultado.semanas.map((s) => ({
          clave: s.clave, accion: s.accion, aplicado: s.aplicado, baseErp: s.baseErp, baseDb: s.baseDb,
          kgErp: s.erp?.kgMetodos ?? null, lineasErp: s.erp?.lineasMetodos ?? null, ajustesErp: s.ajustesErp, ajustesDb: s.ajustesDb,
        })),
        hechos: resultado.hechos,
      },
    });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(async (e) => {
    console.error("ERROR:", e.message);
    if (!process.argv.includes("--sin-rastro")) await anotarEjecucion({ trabajo: TRABAJO, estado: "error", detalle: e.message?.slice(0, 500) });
    await salirConError(1);
  });
}

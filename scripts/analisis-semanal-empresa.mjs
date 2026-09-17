/**
 * analisis-semanal-empresa.mjs — el ANÁLISIS COMPLETO DE LA EMPRESA de la semana anterior,
 * cada lunes, para José María.
 *
 * POR QUÉ EXISTE. José María pidió que cada lunes hubiera un análisis completo de la
 * empresa. El de la semana 37 se hizo a mano (tmp/analisis-semana-37.mjs, siete versiones,
 * dos días de trabajo) pegando cifras del ERP, de la app, de la carpeta de Calidad y de
 * los papeles. Esto lo hace solo: lee las mismas fuentes para cualquier semana ISO y deja
 * un Excel de 14 hojas + un correo con el resumen. Lo que solo existe en papel (horas de
 * RRHH, cuaderno de la encargada, chat de calidad, recuento de cámara) NO se inventa: se
 * lee si alguien lo ha dejado en su sitio, y si no, la hoja dice SIN DATO y qué falta.
 *
 * FUENTES (todas solo lectura):
 *   ERP MySQL (gdata001)     palets_cab, agri_produc_mp, ent_prov_*, fact_lin_alb, stock_exist_lote
 *   App (Supabase)           clasificacion_lote (vista), calibrador_informe, erp_palet, asistencia_detalle,
 *                            trabajadores, calidad_import_controles, vigia_hallazgos, sistema_latidos,
 *                            estandar_rendimiento, partes_diarios
 *   LAN (192.168.1.10)       DEPARTAMENTO CALIDAD\SUDAFRICA 25-26\CONTROLES CALIDAD: hojas PESO (kg palet a
 *                            palet) y Laadopdracht (bon de HG, cajas y €/caja) — PDF leído con Python/pymupdf
 *   Papel, si está           scripts/informe-produccion/asistencias-semana_NN.xlsx (hoja semanal de RRHH)
 *                            outputs/analisis-semanal/notas-<semana>.md (notas a mano: chat, cuaderno)
 *                            outputs/analisis-semanal/recuento-<fecha>.json (recuento físico de cámara)
 *
 * REGLAS QUE SIGUE (memoria del proyecto):
 *   - Cada cifra con su cómo y su de dónde; MEDIDO vs ESTIMADO explícito; si dos fuentes discrepan, las dos.
 *   - El Sizer NO sirve para stock ni para fruta consumida (pesa de menos la SAF): balance con palets ÷ 0,98.
 *   - Horas de personal solo reales (hoja RRHH). Sin hoja ⇒ SIN DATO, nunca estimadas por ritmo.
 *   - Mercadona se factura el lunes siguiente a 1,51 €/kg NOMINAL (cajas × 12 kg): si aún no hay factura,
 *     el ingreso va marcado ESTIMADO con la tarifa de la última semana facturada.
 *
 * USO:
 *   node scripts/analisis-semanal-empresa.mjs                       # semana ISO anterior, sin enviar
 *   node scripts/analisis-semanal-empresa.mjs --semana=2026-W37     # una semana concreta
 *   node scripts/analisis-semanal-empresa.mjs --enviar               # además manda el correo (Resend)
 *   node scripts/analisis-semanal-empresa.mjs --para=a@b.es,c@d.es  # destinatarios (por defecto soporte@)
 *
 * Deja rastro en sistema_ejecuciones (trabajo "analisis-semanal-empresa") y latido para el vigilante.
 * La tarea de Windows que lo lanza los lunes es scripts/tarea-analisis-semanal.cmd.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import ExcelJS from "exceljs";
import { createClient } from "@supabase/supabase-js";
import { conectarErp } from "./lib-palets-erp.mjs";
import { latido, anotarEjecucion } from "./lib-registro-ejecuciones.mjs";
import { fechasSemanaIso, semanaIsoAnterior, semanaIsoDe, fechaLocalISO } from "../supabase/functions/_shared/semanaIso.ts";

process.loadEnvFile(".env");
const INICIO = new Date();
const log = (m) => console.error(`[${((Date.now() - INICIO.getTime()) / 1000).toFixed(1)}s] ${m}`);
const args = Object.fromEntries(process.argv.slice(2).map((a) => { const m = /^--([^=]+)(?:=(.*))?$/.exec(a); return m ? [m[1], m[2] ?? true] : [a, true]; }));
const ENVIAR = args.enviar === true;
const PARA = String(args.para ?? process.env.ANALISIS_SEMANAL_PARA ?? "soporte@lasartesat.es").split(",").map((s) => s.trim()).filter(Boolean);
const E = "gdata001";
const CLIENTE_MERCADONA_ERP = "430000287";
const INICIO_SAF = "2026-08-27";                 // primera entrada de importación de la campaña SAF 25-26
const RENDIMIENTO = 0.98;                        // kg de palet (nominales ERP) por kg de fruta real: MEDIDO con el recuento del 15-09-2026
const TARIFA_MDNA_NOMINAL = 1.51;                // €/kg nominal (cajas × 12 kg) de la malla 3 kg, S35-S37/2026
const ENVASE_MALLA_EUR_KG = 0.0378, ENVASE_OTROS_EUR_KG = 0.04, SUMINISTROS_EUR_DIA = 600, SS_PCT = 0.35; // metodología v5 de la app
const COSTE_HORA_MEDIO_CON_SS = 9;              // €/hora MEDIO con Seguridad Social incluida: dato de Vadim (16-09-2026). Se aplica a las horas reales de la hoja de RRHH
const COSTE_HORA_DEFECTO = COSTE_HORA_MEDIO_CON_SS;
const LAN_CONTROLES = "//192.168.1.10/CompartidaOficina/DEPARTAMENTO CALIDAD/SUDAFRICA 25-26/CONTROLES CALIDAD";
const DIR_SALIDA = path.join("outputs", "analisis-semanal");

// ───────────────────────────── semana
const hoy = fechaLocalISO(new Date());
let semana;
if (typeof args.semana === "string") { const m = /^(\d{4})-W(\d{1,2})$/.exec(args.semana); if (!m) throw new Error("--semana debe ser AAAA-Wnn"); semana = { anio: Number(m[1]), semana: Number(m[2]) }; }
else semana = semanaIsoAnterior(hoy);
const ETIQ = `${semana.anio}-W${String(semana.semana).padStart(2, "0")}`;
const fechasSemana = fechasSemanaIso(semana.anio, semana.semana); // lunes a domingo, YYYY-MM-DD
const desde = fechasSemana[0], hasta = fechasSemana[6];
const hastaExcl = sumarDias(hasta, 1);
const anterior = semanaIsoAnterior(desde);
const fechasAnt = fechasSemanaIso(anterior.anio, anterior.semana); const desdeAnt = fechasAnt[0], hastaAnt = fechasAnt[6];
const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
function sumarDias(iso, n) { const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function diaLargo(iso) { const d = new Date(iso + "T00:00:00Z"); return `${DIAS[d.getUTCDay()]} ${d.getUTCDate()}`; }
const es = (n, dec = 0) => n == null || Number.isNaN(Number(n)) ? "—" : Number(n).toLocaleString("es-ES", { minimumFractionDigits: dec, maximumFractionDigits: dec });
const pct = (n, dec = 1) => n == null || !Number.isFinite(n) ? "—" : (n * 100).toLocaleString("es-ES", { minimumFractionDigits: dec, maximumFractionDigits: dec }) + " %";
const num = (v) => (v == null || v === "" ? 0 : Number(v)) || 0;
const sum = (arr, f = (x) => x) => arr.reduce((s, x) => s + num(f(x)), 0);
console.log(`Análisis de la empresa · semana ${ETIQ} (${desde} → ${hasta}) · leído el ${hoy}`);

const PESO_CACHE = new Map(); // hojas PESO de la LAN ya leídas (ruta → lotes)
let RRHH_CACHE = null;        // hoja semanal de RRHH, si está
const avisos = [];   // lo que falta o no cuadra, para la hoja Pendientes y el correo
const faltan = [];   // datos SIN DATO

// ───────────────────────────── conexiones
const sb = createClient(process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
async function todo(consulta) { // pagina PostgREST (recorta a 1.000 en silencio)
  const filas = []; const paso = 1000;
  for (let i = 0; ; i += paso) { const { data, error } = await consulta().range(i, i + paso - 1); if (error) throw new Error(error.message); filas.push(...(data ?? [])); if (!data || data.length < paso) break; }
  return filas;
}
let erp = null;
try { erp = await conectarErp(); } catch (e) { avisos.push(["ALTA", "ERP no accesible", `No se pudo abrir el ERP (${e.message}). Las hojas que dependen de él van SIN DATO.`]); }
const q = async (sql, p = []) => { if (!erp) return []; const [rows] = await erp.query(sql, p); return rows; };

log("conexiones listas");
// ═════════════════════════════ 1. LECTURA DE FUENTES
// ERP: palets por día (semana y anterior), por artículo, campaña SAF
const paletsDia = await q(`SELECT DATE(p.fecha_creacion) dia, COUNT(*) palets, ROUND(SUM(p.kilos_netos),0) kg, SUM(p.kilos_netos=0) sin_valorar,
   ROUND(SUM(IF(TRIM(p.formula_confeccion) LIKE 'MA%' OR ag.denominacion LIKE '%CAL4/5%', p.kilos_netos, 0)),0) kg_malla,
   ROUND(SUM(IF(ag.denominacion LIKE '%NAVEL%', p.kilos_netos, 0)),0) kg_navelate
   FROM ${E}.palets_cab p LEFT JOIN ${E}.articulo_general ag ON ag.codigo=p.articulo
   WHERE p.fecha_creacion >= ? AND p.fecha_creacion < ? GROUP BY 1 ORDER BY 1`, [desdeAnt, hastaExcl]);
const paletsArticulo = await q(`SELECT ag.denominacion articulo, TRIM(p.formula_confeccion) formula, ac.denominacion caja, COUNT(*) palets, SUM(p.num_cajas) cajas, ROUND(SUM(p.kilos_netos),0) kg FROM ${E}.palets_cab p LEFT JOIN ${E}.articulo_general ag ON ag.codigo=p.articulo LEFT JOIN ${E}.articulo_general ac ON ac.codigo=p.articulo_caja
   WHERE p.fecha_creacion >= ? AND p.fecha_creacion < ? AND p.kilos_netos > 0 GROUP BY 1,2,3 ORDER BY kg DESC`, [desde, hastaExcl]);
const frutaErpLote = await q(`SELECT m.lote, ag.denominacion articulo, ROUND(SUM(m.kilos),0) kg FROM ${E}.agri_produc_mp m LEFT JOIN ${E}.articulo_general ag ON ag.codigo=m.articulo WHERE m.fecha >= ? AND m.fecha < ? GROUP BY 1,2 ORDER BY kg DESC`, [desde, hastaExcl]);
const frutaErpDia = await q(`SELECT m.fecha, ROUND(SUM(m.kilos),0) kg, GROUP_CONCAT(DISTINCT m.lote ORDER BY m.lote) lotes FROM ${E}.agri_produc_mp m WHERE m.fecha >= ? AND m.fecha < ? GROUP BY 1 ORDER BY 1`, [desde, hastaExcl]);
const entradasSemana = await q(`SELECT cab.fecha_entrada fecha, cab.num_entrada, cab.tipo_entrada, COALESCE(NULLIF(tp.nombre_comercial,''), tp.razon_social, tp.nombre) proveedor, ag.denominacion articulo, ROUND(l.unidades_1,0) kg,
   ROUND(i.importe_bruto,2) importe, i.precio_compra precio, cab.imp_transporte porte
   FROM ${E}.ent_prov_cab_alb cab JOIN ${E}.ent_prov_lineas l ON l.num_entrada=cab.num_entrada AND l.serie_entrada=cab.serie_entrada AND l.unidades_1>0
   LEFT JOIN ${E}.ent_prov_lin_imp i ON i.num_entrada=cab.num_entrada AND i.num_linea=l.num_linea
   LEFT JOIN ${E}.articulo_general ag ON ag.codigo=l.articulo LEFT JOIN ${E}.terceros_proveedores tp ON tp.num_proveedor=cab.num_proveedor
   WHERE cab.fecha_entrada >= ? AND cab.fecha_entrada < ? ORDER BY cab.fecha_entrada, cab.num_entrada`, [desde, hastaExcl]);
const safCampana = await q(`SELECT cab.fecha_entrada fecha, cab.num_entrada, ag.denominacion articulo, ROUND(l.unidades_1,0) kg, ROUND(i.importe_bruto,2) importe, cab.imp_transporte porte
   FROM ${E}.ent_prov_cab_alb cab JOIN ${E}.ent_prov_lineas l ON l.num_entrada=cab.num_entrada AND l.unidades_1>0
   LEFT JOIN ${E}.ent_prov_lin_imp i ON i.num_entrada=cab.num_entrada AND i.num_linea=l.num_linea LEFT JOIN ${E}.articulo_general ag ON ag.codigo=l.articulo
   WHERE cab.tipo_entrada=21 AND cab.fecha_entrada >= ? AND cab.fecha_entrada < ? ORDER BY 1`, [INICIO_SAF, hastaExcl]);
// Estado real de los palets de la semana en el ERP: estado 4 = desmontado (la fruta vuelve a la línea, no es venta);
// un palet que está en el espejo de la app pero ya no en el ERP fue borrado allí.
const paletsEstado = await q(`SELECT numero, estado, ROUND(kilos_netos,0) kg FROM ${E}.palets_cab WHERE fecha_creacion >= ? AND fecha_creacion < ?`, [desde, hastaExcl]);
const paletsCampana = await q(`SELECT COUNT(*) n, ROUND(SUM(kilos_netos),0) kg FROM ${E}.palets_cab WHERE fecha_creacion >= ? AND fecha_creacion < ?`, [sumarDias(INICIO_SAF, 1), hastaExcl]);
const saldosErp = await q(`SELECT s.lote, ag.denominacion articulo, ROUND(s.unid_almac_1,0) kg FROM ${E}.stock_exist_lote s LEFT JOIN ${E}.articulo_general ag ON ag.codigo=s.articulo
   WHERE s.fecha='9999-12-31' AND s.lote REGEXP '^26(0[89]|1[0-2])[0-9]{4}$' AND s.lote >= ? AND s.unid_almac_1 <> 0 ORDER BY s.lote`, [INICIO_SAF.replace(/-/g, "").slice(2) + "00"]);
const mdnaFact = await q(`SELECT ROUND(SUM(unidades_1),0) kg_nominal, ROUND(SUM(importe),2) importe, COUNT(DISTINCT CONCAT(serie_factura,num_factura)) facturas, MIN(fecha_factura) primera_factura, COUNT(*) lineas
   FROM ${E}.fact_lin_alb WHERE num_cliente = ? AND fecha_albaran >= ? AND fecha_albaran < ?`, [CLIENTE_MERCADONA_ERP, desde, hastaExcl]);
const mdnaFactAnt = await q(`SELECT ROUND(SUM(unidades_1),0) kg_nominal, ROUND(SUM(importe),2) importe FROM ${E}.fact_lin_alb WHERE num_cliente = ? AND fecha_albaran >= ? AND fecha_albaran < ? AND importe > 0`, [CLIENTE_MERCADONA_ERP, desdeAnt, desde]);

log("ERP leído");
// App
const clasif = await todo(() => sb.from("clasificacion_lote").select("fecha, lote_codigo, lote_codigo_base, batch_id, clase, grupo_destino, peso_kg, reparto_metodo, fuente").gte("fecha", desde).lte("fecha", hasta).order("fecha").order("batch_id"));
const informes = await todo(() => sb.from("calibrador_informe").select("lote, fecha, comienzo, cartons, bins_ejecutados, rechazo_pct, recibido_at, batch_id").gte("fecha", desde).lte("fecha", hasta).order("fecha").order("comienzo"));
const erpPalet = await todo(() => sb.from("erp_palet").select("numero, fecha, cliente, num_cajas, kg_netos, importe_venta, num_factura, num_albaran_venta, articulo").gte("fecha", desde).lte("fecha", hasta).order("fecha"));
const erpPaletAnt = await todo(() => sb.from("erp_palet").select("cliente, kg_netos").gte("fecha", desdeAnt).lte("fecha", hastaAnt).order("fecha"));
const asistencia = await todo(() => sb.from("asistencia_detalle").select("date, trabajador_id, presente").gte("date", desde).lte("date", hasta).order("date"));
const trabajadores = await todo(() => sb.from("trabajadores").select("id, nombre, zona, activo, computa_kg_persona, coste_hora").order("nombre"));
const controles = await todo(() => sb.from("calidad_import_controles").select("fecha, fecha_descarga, referencia, nuestra_ref, proveedor, marca, calibre, peso_medio_cajas, conclusion, defectos_graves, defectos_leves, evaluador").gte("fecha", sumarDias(desde, -3)).lte("fecha", sumarDias(hasta, 1)).order("fecha"));
const hallazgos = await todo(() => sb.from("vigia_hallazgos").select("regla, severidad, titulo, detalle, eur, kg, creado_at").is("resuelto_at", null).order("creado_at", { ascending: false }));
const latidos = await todo(() => sb.from("sistema_latidos").select("trabajo, visto_a, estado, detalle").order("trabajo"));
const estandar = (await todo(() => sb.from("estandar_rendimiento").select("*")))[0] ?? { corte_plantilla_reducida: 35, completa_suelo: 1700, completa_objetivo: 2100, reducida_suelo: 2200, reducida_objetivo: 2600 };
const partes = await todo(() => sb.from("partes_diarios").select("date, estado, kg_palets_brutos, kg_produccion_calibrador").gte("date", desde).lte("date", hasta).order("date"));
// Para la cuenta: coste de la fruta por lote (compra + porte, espejo del ERP en la app), componentes de la malla,
// precios de cajas del ERP (stock de consumibles), contador de agua, tarifas y facturas reales de suministros, días de producción de la campaña
const entradasApp = await todo(() => sb.from("entradas_bascula").select("lote, fecha, kg_entrada, importe_compra, importe_transporte, precio_compra_kg, agricultor").gte("fecha", INICIO_SAF).lte("fecha", hasta).order("fecha"));
const empaque = await todo(() => sb.from("empaque_precios").select("tipo_malla, componente, precio_malla, vigente_desde, created_at").lte("vigente_desde", hasta).order("vigente_desde"));
const consumibles = await todo(() => sb.from("stock_consumibles").select("nombre, familia, precio_unitario, precio_fuente, erp_codigo").eq("activo", true).not("precio_unitario", "is", null).order("nombre"));
const aguaSemana = await todo(() => sb.from("consumos_fisicos").select("fecha_inicio, cantidad").eq("recurso", "agua").eq("referencia", "agua-contador-general").gte("fecha_inicio", desde).lte("fecha_inicio", hasta).order("fecha_inicio"));
const tarifas = await todo(() => sb.from("economico_precios").select("recurso, unidad, precio_por_unidad, vigente_desde").lte("vigente_desde", hasta).order("vigente_desde"));
const facturasSuministros = await todo(() => sb.from("cmv_costes_mensuales").select("mes, concepto, importe").eq("tipo", "suministros").order("mes"));
const partesCampana = await todo(() => sb.from("partes_diarios").select("date, kg_produccion_calibrador").gte("date", "2025-09-01").lt("date", desde).gt("kg_produccion_calibrador", 0).order("date"));

log("app leída");
// LAN: controles de descarga de Calidad (hojas PESO + Laadbon)
const sizerPorDiaTmp = agrupar(clasif, (r) => r.fecha, (r) => num(r.peso_kg)); const paletsPorDiaTmp = Object.fromEntries(paletsDia.map((r) => [String(r.dia).slice(0, 10), { kg: num(r.kg) }]));
await precargarPesos();
log("pesos LAN leídos");
await precargarRrhh();
const camionesLan = leerControlesLan();
log(`LAN leída: ${camionesLan.length} controles`);
// Papel: hoja de RRHH, notas, recuento
const personas = leerHojaRrhh();
const notas = leerNotas();
const recuento = leerRecuento();

log("papel leído");
// ═════════════════════════════ 2. CÁLCULOS
// Producción por día
const sizerPorDia = agrupar(clasif, (r) => r.fecha, (r) => num(r.peso_kg));
const paletsPorDia = Object.fromEntries(paletsDia.map((r) => [String(r.dia).slice(0, 10), r]));
const frutaPorDia = Object.fromEntries(frutaErpDia.map((r) => [String(r.fecha).slice(0, 10), r]));
const mdnaPorDia = agrupar(erpPalet.filter((p) => p.cliente === "MERCADONA S.A."), (p) => p.fecha, (p) => num(p.kg_netos));
const presentesPorDia = agrupar(asistencia.filter((a) => a.presente), (a) => a.date, () => 1);
const trabPorId = Object.fromEntries(trabajadores.map((t) => [t.id, t]));
const computablesPorDia = agrupar(asistencia.filter((a) => a.presente && trabPorId[a.trabajador_id]?.computa_kg_persona !== false), (a) => a.date, () => 1);
const partePorDia = Object.fromEntries(partes.map((p) => [p.date, p]));
const dias = fechasSemana.map((f) => {
  const p = paletsPorDia[f]; const sizer = sizerPorDia[f] ?? 0; const pers = personas?.porDia.get(f);
  const presentes = pers?.presentes ?? presentesPorDia[f] ?? null; const computables = pers?.computables ?? computablesPorDia[f] ?? null;
  const kgp = sizer && computables ? sizer / computables : null;
  return { fecha: f, dia: diaLargo(f), sizer, palets: num(p?.kg), npalets: num(p?.palets), sinValorar: num(p?.sin_valorar), malla: num(p?.kg_malla), navelate: num(p?.kg_navelate), frutaErp: num(frutaPorDia[f]?.kg), lotesErp: frutaPorDia[f]?.lotes ?? "", mdna: mdnaPorDia[f] ?? 0, presentes, computables, horas: pers?.horas ?? null, coste: pers?.coste ?? null, kgp, sem: kgp ? semaforo(kgp, presentes) : "", parte: partePorDia[f] };
});
const diasProd = dias.filter((d) => d.sizer > 0 || d.palets > 0);
const T = { sizer: sum(dias, (d) => d.sizer), palets: sum(dias, (d) => d.palets), npalets: sum(dias, (d) => d.npalets), malla: sum(dias, (d) => d.malla), navelate: sum(dias, (d) => d.navelate), frutaErp: sum(dias, (d) => d.frutaErp), mdna: sum(dias, (d) => d.mdna) };
const paletsAnt = paletsDia.filter((r) => String(r.dia).slice(0, 10) < desde);
const TA = { palets: sum(paletsAnt, (r) => r.kg), npalets: sum(paletsAnt, (r) => r.palets), mdna: sum(erpPaletAnt.filter((p) => p.cliente === "MERCADONA S.A."), (p) => p.kg_netos), dias: paletsAnt.length };
function semaforo(kgp, presentes) { const red = presentes != null && presentes <= num(estandar.corte_plantilla_reducida); const suelo = red ? estandar.reducida_suelo : estandar.completa_suelo, obj = red ? estandar.reducida_objetivo : estandar.completa_objetivo; return kgp >= obj ? "EN OBJETIVO" : kgp >= suelo ? "ENTRE SUELO Y OBJETIVO" : "BAJO EL SUELO"; }

// Calibrador: pasadas (por batch) y clases
const porBatch = new Map();
for (const r of clasif) { const k = `${r.fecha}|${r.batch_id}`; const b = porBatch.get(k) ?? { fecha: r.fecha, batch_id: r.batch_id, titulo: r.lote_codigo, base: r.lote_codigo_base, kg: 0, export: 0, metodo: r.reparto_metodo, fuente: r.fuente, lotes: new Set() }; b.kg += num(r.peso_kg); if (r.grupo_destino === "EXPORTACION") b.export += num(r.peso_kg); b.lotes.add(r.lote_codigo_base); porBatch.set(k, b); }
const pasadas = [...porBatch.values()].sort((a, b) => a.fecha.localeCompare(b.fecha) || String(a.titulo).localeCompare(String(b.titulo)));
const infoPorBatch = Object.fromEntries(informes.map((i) => [String(i.batch_id), i]));
const clases = agruparObj(clasif, (r) => r.clase, (r) => num(r.peso_kg));
const grupos = agrupar(clasif, (r) => r.grupo_destino, (r) => num(r.peso_kg));
const kgExport = grupos["EXPORTACION"] ?? 0, kgPodrido = clases["(J) Podrido"]?.kg ?? 0, kgMujeres = grupos["MUJERES"] ?? 0;

// Ventas: se quitan del espejo los palets desmontados (estado 4) y los que el ERP ya no tiene
const estadoPorNumero = Object.fromEntries(paletsEstado.map((p) => [String(p.numero), p]));
const erpPaletBorrados = paletsEstado.length ? erpPalet.filter((p) => !estadoPorNumero[String(p.numero)]) : [];
const erpPaletDesmontados = erpPalet.filter((p) => estadoPorNumero[String(p.numero)]?.estado === 4);
const erpPaletVivos = paletsEstado.length ? erpPalet.filter((p) => estadoPorNumero[String(p.numero)] && estadoPorNumero[String(p.numero)].estado !== 4 && num(p.kg_netos) > 0) : erpPalet.filter((p) => num(p.kg_netos) > 0);
if (erpPaletBorrados.length) avisos.push(["BAJA", `${erpPaletBorrados.length} palet(s) del espejo de la app ya no existen en el ERP`, `Números ${erpPaletBorrados.map((p) => p.numero).join(", ")} (${es(sum(erpPaletBorrados, (p) => p.kg_netos))} kg). Se borraron en el ERP después de sincronizarse; la sincronización de palets no quita filas. No se cuentan en ventas.`]);
const ventasCliente = Object.values(agruparObj(erpPaletVivos, (p) => p.cliente ?? "(sin cliente asignado)", (p) => num(p.kg_netos), (p, acc) => { acc.palets = (acc.palets ?? 0) + 1; acc.cajas = (acc.cajas ?? 0) + num(p.num_cajas); acc.importe = (acc.importe ?? 0) + num(p.importe_venta); acc.facturados = (acc.facturados ?? 0) + (p.num_factura ? 1 : 0); })).sort((a, b) => b.kg - a.kg);
const mf = mdnaFact[0] ?? {}; const mfa = mdnaFactAnt[0] ?? {};
const mdnaFacturado = num(mf.importe) > 0;
const tarifaAnt = num(mfa.kg_nominal) ? num(mfa.importe) / num(mfa.kg_nominal) : TARIFA_MDNA_NOMINAL;
const mdnaCajas = sum(erpPalet.filter((p) => p.cliente === "MERCADONA S.A."), (p) => p.num_cajas);
const ingMdna = mdnaFacturado ? num(mf.importe) : mdnaCajas * 12 * tarifaAnt;
const ingOtros = sum(ventasCliente.filter((v) => v.clave !== "MERCADONA S.A."), (v) => v.importe);
const kgSinValorar = sum(erpPaletVivos.filter((p) => p.cliente !== "MERCADONA S.A." && !num(p.importe_venta)), (p) => p.kg_netos);
const kgVendidoSinPrecio = sum(erpPaletVivos.filter((p) => p.cliente && p.cliente !== "MERCADONA S.A." && p.num_albaran_venta && !num(p.importe_venta)), (p) => p.kg_netos);
const kgSinCliente = kgSinValorar - kgVendidoSinPrecio;
const ingresos = ingMdna + ingOtros;

// ═══ CUENTA DE LA SEMANA v2 (encargo de José María, 16-09-2026): kg comprados, kg usados y dónde, envase real, suministros reales, personal por actividad
// 3a. Fruta COMPRADA esta semana (entradas de la app = ERP, con porte si el ERP lo lleva)
const compradaSemana = entradasApp.filter((e) => e.fecha >= desde && e.fecha <= hasta && num(e.kg_entrada) > 0);
const compradaKg = sum(compradaSemana, (e) => e.kg_entrada), compradaEur = sum(compradaSemana, (e) => num(e.importe_compra) + num(e.importe_transporte));
// 3b. Fruta USADA esta semana: kg reales = palets ÷ 0,98, repartidos por lote según lo que pesó el Sizer de cada lote (repartos manuales incluidos)
const kgFrutaConsumida = T.palets / RENDIMIENTO;
const sizerPorLote = agrupar(clasif.filter((r) => r.lote_codigo_base), (r) => r.lote_codigo_base, (r) => num(r.peso_kg));
const sizerLotesTotal = sum(Object.values(sizerPorLote));
const costeLote = {}; // lote → { eurKg, kgEntrada, eur, porte, fuente }
for (const e of entradasApp) { if (!num(e.kg_entrada)) continue; const eur = num(e.importe_compra), porte = num(e.importe_transporte); if (!eur) continue; costeLote[e.lote] = { eurKg: (eur + porte) / num(e.kg_entrada), kgEntrada: num(e.kg_entrada), eur, porte, fuente: porte ? "alta ERP + porte" : "alta ERP (sin porte cargado)" }; }
const kgSaf = sum(safCampana, (e) => e.kg), eurSaf = sum(safCampana, (e) => e.importe) + sum(safCampana, (e) => e.porte);
const precioFrutaErp = kgSaf ? eurSaf / kgSaf : null; // media de campaña (altas + portes), solo como respaldo
// La Navelate se confecciona a mano sin pasar por el calibrador: sus kg de palets ÷ 0,98 se valoran con los lotes de Navelate que el ERP descargó esa semana; el resto se reparte por el Sizer
const kgPaletsNavelate = T.navelate, kgFrutaNavelate = kgPaletsNavelate / RENDIMIENTO, kgFrutaSizer = kgFrutaConsumida - kgFrutaNavelate;
const lotesNavelateErp = frutaErpLote.filter((l) => /NAVEL/i.test(l.articulo ?? "") && num(l.kg) > 0); const kgNavErp = sum(lotesNavelateErp, (l) => l.kg);
const frutaLotes = [
  ...Object.entries(sizerPorLote).map(([lote, kgSizer]) => { const kgUsado = sizerLotesTotal ? kgFrutaSizer * kgSizer / sizerLotesTotal : 0; const c = costeLote[lote]; return { lote, kgSizer, kgUsado, eurKg: c?.eurKg ?? precioFrutaErp, eur: kgUsado * (c?.eurKg ?? precioFrutaErp ?? 0), fuente: c ? c.fuente + " · reparto por el Sizer" : "SIN alta en la app: media de campaña (ESTIMADO)", conPrecio: !!c }; }),
  ...(kgFrutaNavelate > 0 ? (lotesNavelateErp.length ? lotesNavelateErp.map((l) => { const kgUsado = kgFrutaNavelate * num(l.kg) / kgNavErp; const c = costeLote[l.lote]; return { lote: l.lote, kgSizer: 0, kgUsado, eurKg: c?.eurKg ?? precioFrutaErp, eur: kgUsado * (c?.eurKg ?? precioFrutaErp ?? 0), fuente: (c ? c.fuente : "SIN alta: media de campaña (ESTIMADO)") + " · Navelate a mano, reparto por las descargas del ERP", conPrecio: !!c }; }) : [{ lote: "Navelate (lote sin descargar en el ERP)", kgSizer: 0, kgUsado: kgFrutaNavelate, eurKg: precioFrutaErp, eur: kgFrutaNavelate * (precioFrutaErp ?? 0), fuente: "media de campaña (ESTIMADO)", conPrecio: false }]) : []),
].sort((a, b) => b.kgUsado - a.kgUsado);
const fruta = frutaLotes.length ? sum(frutaLotes, (l) => l.eur) : (precioFrutaErp != null ? kgFrutaConsumida * precioFrutaErp : null);
const frutaEurKgMedio = kgFrutaConsumida ? fruta / kgFrutaConsumida : null;
const kgSinPrecioLote = sum(frutaLotes.filter((l) => !l.conPrecio), (l) => l.kgUsado);
// Contraste: precio según los Laadbon de HG (cajas × €/caja + porte) de los controles con bon completo
const conBon = camionesLan.filter((c) => c.bon && c.bon.total > 0 && !c.bon.sinPrecio);
const kgBon = sum(conBon, (c) => sum(c.lotes, (l) => l.kg)), eurBon = sum(conBon, (c) => c.bon.total + (c.bon.porte ?? 0));
const precioFrutaBon = kgBon ? eurBon / kgBon : null;
// 3c. DÓNDE se ha usado: salidas por producto y envase (palets del ERP) + destrío del calibrador
const destinoDe = (g) => { const a = String(g.articulo ?? "").toUpperCase(), f = String(g.formula ?? "").toUpperCase(), c = String(g.caja ?? "").toUpperCase(); if (f.startsWith("MA") || c.includes("LOGIFRUIT")) return "Malla 3 kg Mercadona"; if (c.includes("BOX PLASTICO")) return "Box propio (cítrica, industria, precalibrado)"; if (a.includes("NAVEL")) return "Navelate a mano (cartón, madera o EPS)"; if (c.includes("EPS") || c.includes("IFCO")) return "Cajas de pool (EPS/IFCO)"; if (c.includes("MADERA")) return "Cajas de madera"; return "Cajas de cartón otros clientes"; };
const salidas = Object.values(paletsArticulo.reduce((acc, g) => { const k = destinoDe(g); const a = acc[k] ?? (acc[k] = { destino: k, palets: 0, cajas: 0, kg: 0, grupos: [] }); a.palets += num(g.palets); a.cajas += num(g.cajas); a.kg += num(g.kg); a.grupos.push(g); return acc; }, {})).sort((a, b) => b.kg - a.kg);
const destrio = { podrido: kgPodrido, industria: clases["(I) Industria"]?.kg ?? 0, mujeres: kgMujeres, cat23: (clases["(F) Cat 2"]?.kg ?? 0) + (clases["(G) Cat 3"]?.kg ?? 0) };
// 3d. ENVASE a precio real: malla = componentes de empaque_precios (vigentes); cajas = precio del ERP en stock de consumibles, casado por el nombre del artículo del ERP
const ultimoVigente = (filas) => { const m = new Map(); for (const f of filas) { const k = f.componente; const prev = m.get(k); if (!prev || f.vigente_desde > prev.vigente_desde || (f.vigente_desde === prev.vigente_desde && f.created_at > prev.created_at)) m.set(k, f); } return [...m.values()]; };
const comp3 = ultimoVigente(empaque.filter((e) => e.tipo_malla === "3kg"));
const eurPorMalla3 = sum(comp3, (c) => c.precio_malla);
const precioCajaErp = (nombreErp) => { if (!nombreErp) return null; const n = String(nombreErp).trim().toUpperCase(); const hit = consumibles.find((c) => (c.precio_fuente ?? "").toUpperCase().includes(`«${n}»`)) ?? consumibles.find((c) => (c.precio_fuente ?? "").toUpperCase().includes(n.slice(0, 28))); if (hit) return { precio: num(hit.precio_unitario), nombre: hit.nombre, estimado: false };
  // Sin precio propio: caja PARECIDA (mismo material y mismos kg) del stock de consumibles, marcada ESTIMADO
  const kgm = /(\d{2}) ?KG/.exec(n)?.[1]; const material = /MADERA/.test(n) ? "MADERA" : /CARTON/.test(n) ? "CART" : /EPS|IFCO|LOGIFRUIT|PLASTICO/.test(n) ? "PL" : null;
  const parecidas = consumibles.filter((c) => /caja/i.test(c.nombre) && (!kgm || new RegExp("(?<!\d)0?" + Number(kgm) + " ?KG", "i").test(c.nombre)) && (!material || new RegExp(material, "i").test(c.nombre)) && num(c.precio_unitario) > 0 && num(c.precio_unitario) < 3);
  if (!parecidas.length) return null; const precios = parecidas.map((c) => num(c.precio_unitario)).sort((x, y) => x - y); return { precio: precios[Math.floor(precios.length / 2)], nombre: `caja parecida: ${parecidas[0].nombre}${parecidas.length > 1 ? ` y ${parecidas.length - 1} más, mediana` : ""}`, estimado: true }; };
const PALET_MADERA_EUR = 6.5, ETIQUETA_CAJA_EUR = 0.011, POOL_USO_EUR = 0.25; // ESTIMADOS: palet de madera un solo uso, etiqueta de cartón por caja, uso de caja de pool no separado de la fianza en el ERP
const envaseLineas = [];
for (const g of paletsArticulo) {
  const d = destinoDe(g); const cajas = num(g.cajas), palets = num(g.palets), kg = num(g.kg); let eur = 0, como = "";
  if (d === "Malla 3 kg Mercadona") { const mallas = cajas * 4; eur = mallas * eurPorMalla3; como = `${es(cajas)} cajas × 4 mallas = ${es(mallas)} mallas × ${es(eurPorMalla3, 4)} €/malla (${comp3.map((c) => `${c.componente} ${es(c.precio_malla, 4)}`).join(", ")}; incluye caja Logifruit, palet doble y etiqueta). MEDIDO: precios de empaque_precios.`; }
  else if (d === "Box propio (cítrica, industria, precalibrado)") { eur = 0; como = "Box de plástico propio, reutilizable: 0 €."; }
  else { const pc = precioCajaErp(g.caja); const pool = /EPS|IFCO/i.test(g.caja ?? ""); const precioCaja = pool ? POOL_USO_EUR : (pc?.precio ?? null); const eurCajas = precioCaja != null ? cajas * precioCaja : 0; const eurPalet = pool ? 0 : palets * PALET_MADERA_EUR; const eurEtiq = cajas * ETIQUETA_CAJA_EUR; eur = eurCajas + eurPalet + eurEtiq; como = precioCaja != null ? `${es(cajas)} cajas × ${es(precioCaja, 4)} € (${pool ? "uso de caja de pool, ESTIMADO" : pc.estimado ? `sin precio propio en consumibles; ${pc.nombre}, ESTIMADO` : `«${pc.nombre}», precio ERP consumibles`}) + ${palets} palet(s) × ${PALET_MADERA_EUR} € (ESTIMADO) + etiquetas ${es(cajas)} × ${ETIQUETA_CAJA_EUR} € (ESTIMADO)` : `SIN PRECIO en consumibles para «${g.caja}»: solo palet y etiquetas (${palets} × ${PALET_MADERA_EUR} + ${es(cajas)} × ${ETIQUETA_CAJA_EUR}), ESTIMADO`; if (precioCaja == null) faltan.push(`Precio de la caja «${g.caja}» en el stock de consumibles`); else if (pc?.estimado) avisos.push(["BAJA", `Caja sin precio propio en consumibles: «${g.caja}»`, `Se usa el de una caja parecida (${pc.nombre}). Enlazar la caja en /consumibles para que salga su precio real.`]); }
  envaseLineas.push({ destino: d, articulo: g.articulo, caja: g.caja, palets, cajas, kg, eur, eurKg: kg ? eur / kg : null, como });
}
const envase = sum(envaseLineas, (l) => l.eur);
// 3e. SUMINISTROS: luz + agua + gasoil. Central = facturas reales de la campaña 25-26 ÷ días de producción (la luz se paga por día de fábrica encendida, no por kilo). Contraste: agua del contador de la semana × tarifa real.
const tarifa = (rec) => { const t = tarifas.filter((x) => x.recurso === rec).sort((a, b) => b.vigente_desde.localeCompare(a.vigente_desde))[0]; return t ? num(t.precio_por_unidad) : null; };
const mesesFact = [...new Set(facturasSuministros.map((f) => f.mes))];
const diasProdMes = agrupar(partesCampana, (p) => p.date.slice(0, 7), () => 1);
const diasConFactura = sum(mesesFact, (m) => diasProdMes[m] ?? 0), eurFacturas = sum(facturasSuministros, (f) => f.importe);
const suministrosDia = diasConFactura ? eurFacturas / diasConFactura : SUMINISTROS_EUR_DIA;
const suministros = diasProd.length * suministrosDia;
const aguaL = sum(aguaSemana, (a) => a.cantidad), aguaEur = tarifa("agua") != null ? (aguaL / 1000) * tarifa("agua") : null;
// 3f. PERSONAL: horas reales de RRHH × 9 €/h (Seg. Social incluida), por actividad
const ACT_ARRANQUE = /ENCARGAD|PRODUCCI|AEREO|TRIA|VOLCADOR|PUNTA|MECANIC|MOZO|PRE-POST/i, ACT_CONFECCION = /ENVASAD|ENMALLAD|CONFECCION$/i;
const personalPorActividad = personas ? Object.values([...personas.porPersona.values()].reduce((acc, p) => { const k = p.actividad || "(sin actividad)"; const a = acc[k] ?? (acc[k] = { actividad: k, personas: 0, horas: 0, coste: 0 }); a.personas++; a.horas += p.horas; a.coste += p.coste; return acc; }, {})).sort((a, b) => b.horas - a.horas) : [];
const grupoDe = (act) => ACT_CONFECCION.test(act) ? "Confección (envasadoras, enmalladoras)" : ACT_ARRANQUE.test(act) ? "Arranque y línea (encargada, volcador, tría, punta, aéreo, mecánica, mozo, pre-post)" : "Otros (segunda, limpieza)";
const personalGrupos = Object.values(personalPorActividad.reduce((acc, a) => { const k = grupoDe(a.actividad); const g = acc[k] ?? (acc[k] = { grupo: k, horas: 0, coste: 0, actividades: [] }); g.horas += a.horas; g.coste += a.coste; g.actividades.push(`${a.actividad} ${es(a.horas, 0)} h`); return acc; }, {}));
const personal = personas ? personas.costeTotal : null;
const ss = personal != null ? 0 : null; // la Seguridad Social va dentro de los 9 €/h
const margen = fruta != null && personal != null ? ingresos - fruta - envase - suministros - personal : null;

// Stock por balance (campaña SAF) + saldos ERP + recuento
const paletsCamp = num(paletsCampana[0]?.kg);
const stockBalance = kgSaf - paletsCamp / RENDIMIENTO;
const saldoErpPositivo = sum(saldosErp.filter((s) => num(s.kg) > 0), (s) => s.kg), saldoErpNegativo = sum(saldosErp.filter((s) => num(s.kg) < 0), (s) => s.kg);

// Camiones de la semana: ERP ↔ LAN (por fecha y kg ±1,5 %)
const camiones = entradasSemana.filter((e) => e.tipo_entrada === 21).map((e) => {
  const f = String(e.fecha).slice(0, 10); const kg = num(e.kg);
  const lan = camionesLan.find((c) => (c.fecha === f || c.fecha === sumarDias(f, -1) || c.fecha === sumarDias(f, 1)) && c.lotes.some((l) => Math.abs(l.kg - kg) / kg < 0.015)) ?? camionesLan.find((c) => c.fecha === f);
  const lote = lan?.lotes.find((l) => Math.abs(l.kg - kg) / kg < 0.015);
  return { ...e, fecha: f, lan, lote };
});
if (args.depurar) { console.error("LAN:", JSON.stringify(camionesLan.map((c) => ({ f: c.fecha, bon: c.bon?.numero, lotes: c.lotes.map((l) => `${l.lote} ${l.kg} ${l.palets}p`) })))); console.error("CRUCE:", JSON.stringify(camiones.map((c) => ({ e: c.num_entrada, f: c.fecha, kg: c.kg, lan: c.lan?.carpeta, lote: c.lote?.lote })))); }
const kgEntradasNacional = sum(entradasSemana.filter((e) => e.tipo_entrada !== 21), (e) => e.kg);

// Sistema
const horasDesde = (t) => (Date.now() - new Date(t).getTime()) / 3.6e6;
const POCO_FRECUENTE = /mensual|restauracion|semanal|precios|asistencia|analisis/i;
const latidosMal = latidos.filter((l) => l.estado === "error" || (!POCO_FRECUENTE.test(l.trabajo) && horasDesde(l.visto_a) > 24 * 8));

// ═════════════════════════════ 3. EXCEL
const AZUL = "FF1F4E78", GRIS = "FFF2F2F2", ROJO = "FFFDE9E7", VERDE = "FFE8F5E9", AMBAR = "FFFFF4E0", CELESTE = "FFDDEBF7";
const libro = new ExcelJS.Workbook(); libro.creator = "Lasarte Cítricos S.L.";
function hoja(nombre, columnas) {
  const h = libro.addWorksheet(nombre); h.columns = columnas.map((c) => ({ header: c.header, key: c.key, width: c.width ?? 16 }));
  const f = h.getRow(1); f.font = { bold: true, color: { argb: "FFFFFFFF" } }; f.fill = { type: "pattern", pattern: "solid", fgColor: { argb: AZUL } }; f.alignment = { vertical: "middle", wrapText: true }; f.height = 36;
  h.views = [{ state: "frozen", ySplit: 1 }];
  for (const c of columnas) { if (c.numFmt) h.getColumn(c.key).numFmt = c.numFmt; h.getColumn(c.key).alignment = { vertical: "top", wrapText: true }; }
  return h;
}
const fila = (h, d, color) => { const r = h.addRow(d); if (color) r.fill = { type: "pattern", pattern: "solid", fgColor: { argb: color } }; return r; };
const total = (h, d) => { const r = fila(h, d, GRIS); r.font = { bold: true }; return r; };
const colorSem = (s) => s === "EN OBJETIVO" ? VERDE : s === "BAJO EL SUELO" ? ROJO : s ? AMBAR : undefined;

// — Resumen (se rellena al final) y Para José María
const hR = hoja("Resumen", [{ header: `Semana ${semana.semana}/${semana.anio} · del ${diaLargo(desde)} al ${diaLargo(hasta)} de ${mes(desde)}`, key: "k", width: 44 }, { header: "Dato", key: "v", width: 26 }, { header: "Qué significa y de dónde sale", key: "q", width: 100 }]);
const hJ = hoja("Para José María", [{ header: `Lasarte Cítricos · semana ${semana.semana} (${diaLargo(desde)} al ${diaLargo(hasta)} de ${mes(desde)})`, key: "k", width: 40 }, { header: "Dato", key: "v", width: 28 }, { header: "En una frase", key: "q", width: 100 }]);

// — Producción por día
const hP = hoja("Producción por día", [
  { header: "Día", key: "dia", width: 14 }, { header: "Kg calibrados (Sizer)", key: "sizer", width: 12, numFmt: "#,##0" }, { header: "Kg de palets (ERP)", key: "palets", width: 12, numFmt: "#,##0" }, { header: "Nº palets", key: "npalets", width: 8 },
  { header: "Palets ÷ Sizer", key: "ratio", width: 9, numFmt: "0%" }, { header: "De ellos malla Mercadona (kg, palets asignados al cliente)", key: "mdna", width: 14, numFmt: "#,##0" }, { header: "Navelate / otros a mano (kg)", key: "navelate", width: 12, numFmt: "#,##0" },
  { header: "Fruta descargada en el ERP (kg)", key: "frutaErp", width: 13, numFmt: "#,##0" }, { header: "Personas presentes", key: "presentes", width: 9 }, { header: "Horas (hoja RRHH)", key: "horas", width: 9, numFmt: "#,##0.0" },
  { header: "Kg por persona (Sizer ÷ personas que computan)", key: "kgp", width: 12, numFmt: "#,##0" }, { header: "Semáforo (estándar por régimen)", key: "sem", width: 20 }, { header: "Lotes descargados (ERP)", key: "lotesErp", width: 40 }, { header: "Parte diario (app)", key: "parte", width: 22 },
]);
for (const d of dias) fila(hP, { ...d, ratio: d.sizer ? d.palets / d.sizer : null, parte: d.parte ? `${d.parte.estado} · palets ${es(d.parte.kg_palets_brutos)}` : (d.sizer || d.palets ? "sin parte" : "") }, d.sizer === 0 && d.palets === 0 ? GRIS : colorSem(d.sem));
total(hP, { dia: `SEMANA ${semana.semana}`, sizer: T.sizer, palets: T.palets, npalets: T.npalets, ratio: T.sizer ? T.palets / T.sizer : null, mdna: T.mdna, navelate: T.navelate, frutaErp: T.frutaErp, presentes: personas ? personas.mediaPresentes.toFixed(1) : (diasProd.length ? (sum(diasProd, (d) => d.presentes) / diasProd.length).toFixed(1) : null), horas: personas?.horasTotal ?? null, kgp: personas || Object.keys(presentesPorDia).length ? T.sizer / Math.max(1, sum(diasProd, (d) => d.computables)) : null, sem: "" });
total(hP, { dia: `Semana ${anterior.semana}`, palets: TA.palets, npalets: TA.npalets, mdna: TA.mdna, lotesErp: `${TA.dias} días con palets` });
fila(hP, { dia: "Cómo leerlo", lotesErp: `Sizer: informes Word del calibrador en la app (vista clasificacion_lote). Palets: palets_cab del ERP, kilos netos nominales por caja (un día cierra a las 09:00 del siguiente). Un día con palets ÷ Sizer > 110 % gastó fruta sobrante del día anterior o el Sizer pesó de menos (en la SAF pesa un 12-20 % de menos). Personas: hoja semanal de RRHH si está en scripts/informe-produccion; si no, presentes de la app (sin horas). Estándar kg/persona: plantilla ≤ ${estandar.corte_plantilla_reducida} = reducida (suelo ${es(estandar.reducida_suelo)}, objetivo ${es(estandar.reducida_objetivo)}); más = completa (${es(estandar.completa_suelo)}/${es(estandar.completa_objetivo)}). Con fruta SAF en cajas el estándar no aplica igual: se enseña, no se juzga.` });

// — Calibrador (pasadas)
const hC = hoja("Calibrador (pasadas)", [
  { header: "Día", key: "dia", width: 14 }, { header: "Título del lote en el Sizer (lo teclea el operario)", key: "titulo", width: 44 }, { header: "Comienzo", key: "comienzo", width: 16 }, { header: "Kg calibrados", key: "kg", width: 12, numFmt: "#,##0" },
  { header: "% exportación", key: "exp", width: 10, numFmt: "0.0%" }, { header: "Cajas (Sizer)", key: "cartons", width: 9, numFmt: "#,##0" }, { header: "Lotes a los que se reparte", key: "lotes", width: 30 }, { header: "Método de reparto", key: "metodo", width: 14 }, { header: "Informe recibido", key: "recibido", width: 18 }, { header: "Aviso", key: "aviso", width: 50 },
]);
for (const p of pasadas) {
  const inf = infoPorBatch[String(p.batch_id)]; const lotes = [...p.lotes].filter(Boolean); const raro = lotes.some((l) => !/^\d{8}$/.test(l) || l.slice(2, 4) < "01" || l.slice(2, 4) > "12" || l.slice(4, 6) > "31") || (p.titulo && (p.titulo.match(/\d{8}/g) ?? []).length > lotes.length && p.metodo !== "manual");
  const aviso = raro ? "Título con lote inexistente o varios lotes repartidos a uno solo: revisar y repartir a mano con el cuaderno" : (p.metodo === "manual" ? "reparto grabado a mano con el cuaderno" : "");
  fila(hC, { dia: diaLargo(p.fecha), titulo: p.titulo, comienzo: inf?.comienzo ?? "", kg: p.kg, exp: p.kg ? p.export / p.kg : null, cartons: num(inf?.cartons) || null, lotes: lotes.join(", "), metodo: p.metodo ?? "—", recibido: inf?.recibido_at ? String(inf.recibido_at).slice(0, 16).replace("T", " ") : "", aviso }, raro ? AMBAR : undefined);
  if (raro) avisos.push(["MEDIA", `Pasada del ${diaLargo(p.fecha)} con título dudoso`, `«${p.titulo}» (${es(p.kg)} kg) se reparte a ${lotes.join(", ") || "ningún lote válido"}. Repartir a mano con el cuaderno de la encargada.`]);
}
total(hC, { dia: "TOTAL", kg: T.sizer, exp: T.sizer ? kgExport / T.sizer : null, lotes: `${pasadas.length} pasadas` });
if (!pasadas.length) faltan.push("Ningún informe del calibrador en la semana (¿buzón parado? ¿lotes sin cerrar en el Sizer?)");

// — Cuadre día a día
const hCu = hoja("Cuadre día a día", [
  { header: "Día", key: "dia", width: 14 }, { header: "Sizer (kg)", key: "sizer", width: 11, numFmt: "#,##0" }, { header: "Palets ERP (kg)", key: "palets", width: 11, numFmt: "#,##0" }, { header: "Fruta descargada ERP (kg)", key: "erp", width: 12, numFmt: "#,##0" }, { header: "Palets ÷ Sizer", key: "ratio", width: 9, numFmt: "0%" }, { header: "Lectura", key: "lec", width: 100 },
]);
let acumS = 0, acumP = 0;
for (const d of diasProd) {
  acumS += d.sizer; acumP += d.palets; const ratio = d.sizer ? d.palets / d.sizer : null;
  let lec, color;
  if (!d.sizer && d.palets) { lec = "Palets sin informe del calibrador ese día: falta el Word del Sizer, o la fruta se confeccionó a mano (Navelate) sin pasar por el calibrador."; color = ROJO; }
  else if (ratio > 1.15) { lec = `Palets = ${pct(ratio, 0)} del Sizer: se gastó fruta sobrante del día anterior, o el Sizer pesó de menos (habitual en SAF). Acumulado de la semana: ${pct(acumP / acumS, 0)}.`; color = AMBAR; }
  else if (ratio < 0.85) { lec = `Palets = ${pct(ratio, 0)} del Sizer: quedó fruta calibrada sin paletizar para el día siguiente. Acumulado: ${pct(acumP / acumS, 0)}.`; color = AMBAR; }
  else lec = `Cuadra: palets = ${pct(ratio, 0)} del Sizer.`;
  if (d.frutaErp && d.sizer && Math.abs(d.frutaErp - d.sizer) / d.sizer > 0.25) lec += ` El ERP descarga ${es(d.frutaErp)} kg de fruta ese día (${pct(d.frutaErp / d.sizer, 0)} del Sizer): la oficina descarga por lotes enteros y a ojo.`;
  fila(hCu, { dia: d.dia, sizer: d.sizer, palets: d.palets, erp: d.frutaErp, ratio, lec }, color);
}
total(hCu, { dia: "SEMANA", sizer: T.sizer, palets: T.palets, erp: T.frutaErp, ratio: T.sizer ? T.palets / T.sizer : null, lec: T.sizer ? (T.palets / T.sizer > 1.05 ? "La semana saca más kilos de palet que de Sizer: el Sizer pesa de menos la fruta SAF (sesgo de su báscula, no fruta que aparezca). Para fruta consumida se usan los palets ÷ 0,98." : "La semana cuadra: los palets son el " + pct(T.palets / T.sizer, 0) + " de lo calibrado; el resto es destrío (mujeres, cat 2 y 3, podrido, industria) y sobrepeso del Sizer.") : "Sin datos del calibrador." });

// — Calidad al calibrar
const hQ = hoja("Calidad al calibrar", [{ header: "Clase del calibrador", key: "clase", width: 22 }, { header: "Kg de la semana", key: "kg", width: 14, numFmt: "#,##0" }, { header: "% del total", key: "pct", width: 10, numFmt: "0.0%" }, { header: "Destino", key: "dest", width: 30 }]);
for (const c of Object.values(clases).sort((a, b) => a.clave.localeCompare(b.clave))) fila(hQ, { clase: c.clave, kg: c.kg, pct: T.sizer ? c.kg / T.sizer : null, dest: c.extra?.grupo ?? "" });
total(hQ, { clase: "TOTAL", kg: T.sizer, pct: T.sizer ? 1 : null });
fila(hQ, { clase: "Lectura", dest: T.sizer ? `Exportación ${pct(kgExport / T.sizer)} · podrido ${pct(kgPodrido / T.sizer, 2)} · mujeres (lo que sacó el triaje a mano) ${pct(kgMujeres / T.sizer, 2)}. Fuente: vista clasificacion_lote de la app (informes del Sizer).` : "Sin datos." });

// — Camiones y entradas
const hS = hoja("Camiones y entradas", [
  { header: "Fecha", key: "fecha", width: 11 }, { header: "Entrada ERP", key: "num_entrada", width: 9 }, { header: "Tipo", key: "tipo", width: 11 }, { header: "Proveedor", key: "proveedor", width: 24 }, { header: "Artículo", key: "articulo", width: 24 },
  { header: "Lote(s) según Calidad", key: "lotes", width: 20 }, { header: "Laadbon (bon de HG)", key: "bon", width: 11 }, { header: "Kg netos (alta ERP = peso real de Calidad)", key: "kg", width: 12, numFmt: "#,##0" }, { header: "Marcas y palets (hoja PESO de Calidad)", key: "marcas", width: 44 },
  { header: "€/kg del alta", key: "precio", width: 9, numFmt: "0.0000" }, { header: "Alta ERP (€)", key: "importe", width: 11, numFmt: "#,##0.00" }, { header: "Porte ERP (€)", key: "porte", width: 9, numFmt: "#,##0" }, { header: "Fruta según el bon (cajas × €/caja)", key: "frutaBon", width: 12, numFmt: "#,##0.00" }, { header: "Porte según el bon", key: "porteBon", width: 12 }, { header: "Alta − (fruta + porte del bon)", key: "dif", width: 12, numFmt: "#,##0.00" }, { header: "Aviso", key: "aviso", width: 44 },
]);
for (const e of entradasSemana) {
  if (e.tipo_entrada !== 21) { fila(hS, { fecha: String(e.fecha).slice(0, 10), num_entrada: e.num_entrada, tipo: "nacional", proveedor: e.proveedor, articulo: e.articulo, kg: num(e.kg), precio: num(e.precio) || null, importe: num(e.importe) || null }); continue; }
  const c = camiones.find((x) => x.num_entrada === e.num_entrada); const lan = c?.lan; const lote = c?.lote;
  const frutaBon = lan?.bon?.total ?? null; const porteBon = lan?.bon?.porte ?? null;
  const dif = frutaBon != null && lan?.lotes.length === 1 ? num(e.importe) - (frutaBon + (porteBon ?? 0)) : null;
  let aviso = "";
  if (!lan) aviso = "Sin control de descarga de Calidad en la LAN (o con otra fecha)";
  else if (lan.bon?.sinPrecio) aviso = `${lan.bon.sinPrecio} línea(s) del bon a 0,00 €: HG tiene que confirmar el precio antes de facturar`;
  if (dif != null && Math.abs(dif) > 1500) aviso += (aviso ? " · " : "") + `El alta del ERP vale ${es(dif, 0)} € ${dif > 0 ? "más" : "menos"} que fruta + porte del bon`;
  fila(hS, { fecha: c?.fecha ?? String(e.fecha).slice(0, 10), num_entrada: e.num_entrada, tipo: "importación", proveedor: e.proveedor, articulo: e.articulo, lotes: lote ? lote.lote : lan?.lotes.map((l) => l.lote).join(" + ") ?? "", bon: lan?.bon?.numero ?? lan?.bonNombre ?? "", kg: num(e.kg), marcas: lote ? lote.marcas : lan?.lotes.map((l) => `${l.lote}: ${l.marcas}`).join(" · ") ?? "", precio: num(e.precio) || null, importe: num(e.importe) || null, porte: num(e.porte) || null, frutaBon: lan?.lotes.length === 1 ? frutaBon : null, porteBon: porteBon != null ? `${es(porteBon)} € (${lan.bon.porteTexto})` : (lan?.bon ? "no figura en el bon" : ""), dif, aviso }, aviso ? AMBAR : undefined);
  if (aviso) avisos.push(["MEDIA", `Camión ${e.num_entrada} (${lote?.lote ?? e.articulo})`, aviso]);
}
total(hS, { fecha: "SEMANA", tipo: `${camiones.length} camiones SAF`, kg: sum(entradasSemana, (e) => e.kg), importe: sum(entradasSemana, (e) => e.importe), lotes: kgEntradasNacional ? `+ ${es(kgEntradasNacional)} kg nacionales` : "" });
fila(hS, { fecha: "Cómo leerlo", marcas: "El kilo del alta del ERP es el peso real que Calidad pesa palet a palet al descargar (bruto − 22 kg de palet − 0,72/0,79 kg por caja), no cajas × 15. El bon de HG cobra POR CAJA (13,50-15,00 €) y el porte va en «Uw Ref». Si un bon trae dos lotes (Midknight + Navelate) el reparto del importe es por lote y no se calcula la diferencia. Las marcas y calibres sirven para saber qué hay en la cámara (ver Stock)." });

// — Calidad de entrada (controles de Raquel en la app)
const hQe = hoja("Calidad de entrada", [{ header: "Fecha", key: "fecha", width: 11 }, { header: "Descarga", key: "desc", width: 11 }, { header: "Referencia / lote", key: "ref", width: 18 }, { header: "Proveedor", key: "prov", width: 16 }, { header: "Marca", key: "marca", width: 18 }, { header: "Calibres", key: "cal", width: 16 }, { header: "Peso medio caja", key: "peso", width: 9 }, { header: "Defectos graves", key: "graves", width: 30 }, { header: "Conclusión del técnico", key: "concl", width: 70 }]);
for (const c of controles) { const rech = /no (se )?acepta|rechaz|no apto/i.test(c.conclusion ?? ""); fila(hQe, { fecha: c.fecha, desc: c.fecha_descarga ?? "", ref: [c.nuestra_ref, c.referencia].filter(Boolean).join(" / "), prov: c.proveedor, marca: c.marca, cal: c.calibre, peso: c.peso_medio_cajas, graves: resumirDefectos(c.defectos_graves), concl: c.conclusion ?? "" }, rech ? ROJO : undefined); if (rech) avisos.push(["ALTA", `Rechazo de Calidad en ${c.nuestra_ref ?? c.referencia} (${c.marca})`, c.conclusion]); }
if (!controles.length) { fila(hQe, { concl: "Ningún control de entrada tecleado en la app esta semana. Los controles en papel/Word de Calidad están en la LAN (SUDAFRICA 25-26\\CONTROLES CALIDAD)." }); faltan.push("Controles de calidad de entrada en la app (Raquel)"); }

// — Stock
const hK = hoja("Stock de fruta", [{ header: "Cómo se cuenta", key: "c", width: 48 }, { header: "kg", key: "v", width: 13, numFmt: "#,##0" }, { header: "Medido o estimado", key: "m", width: 18 }, { header: "Qué es y de dónde sale", key: "q", width: 100 }]);
fila(hK, { c: `Balance de la campaña SAF a cierre del ${diaLargo(hasta)}`, v: stockBalance, m: "ESTIMADO", q: `Entradas SAF desde el ${INICIO_SAF} (${es(kgSaf)} kg, peso real de Calidad en el ERP) − palets hechos (${es(paletsCamp)} kg) ÷ ${RENDIMIENTO}. El 0,98 está medido con el recuento de cámara del 15-09-2026. Vale para el orden de magnitud; no dice de qué lote es cada kilo.` }, AMBAR);
fila(hK, { c: "Saldo por lote del ERP (lotes en positivo)", v: saldoErpPositivo, m: "NO FIABLE", q: `stock_exist_lote. La oficina descarga la fruta a ojo y por lotes enteros: hay ${saldosErp.filter((s) => num(s.kg) < 0).length} lotes en negativo (${es(saldoErpNegativo)} kg). Lotes en positivo: ${saldosErp.filter((s) => num(s.kg) > 0).map((s) => `${s.lote} ${es(s.kg)}`).join(" · ") || "ninguno"}.` }, AMBAR);
if (recuento) {
  fila(hK, { c: `RECUENTO FÍSICO del ${recuento.fecha}`, v: recuento.total, m: "MEDIDO", q: `${recuento.origen}. ${recuento.resumen}` }, VERDE);
  for (const l of recuento.lineas ?? []) fila(hK, { c: `   ${l.estado}`, v: l.kg, m: l.medido, q: l.detalle });
  if (recuento.fecha < desde) avisos.push(["MEDIA", "El último recuento de cámara es anterior a la semana", `Del ${recuento.fecha}. Para saber el stock real hace falta contar de nuevo (una hora de la encargada) o descargar en el ERP con las fichas de los palets desmontados.`]);
} else { fila(hK, { c: "Recuento físico", v: null, m: "SIN DATO", q: "No hay recuento de cámara guardado en outputs/analisis-semanal/recuento-<fecha>.json. El del 15-09-2026 (74.836 kg) se hizo a mano con las fichas de los palets y los pesos de Calidad." }, GRIS); faltan.push("Recuento físico de la cámara (stock real)"); }

// — Ventas
const hV = hoja("Ventas de la semana", [{ header: "Cliente", key: "clave", width: 34 }, { header: "Palets", key: "palets", width: 8 }, { header: "Cajas", key: "cajas", width: 9, numFmt: "#,##0" }, { header: "Kg netos", key: "kg", width: 11, numFmt: "#,##0" }, { header: "Importe en el ERP (€)", key: "importe", width: 13, numFmt: "#,##0.00" }, { header: "€/kg", key: "eurkg", width: 8, numFmt: "0.000" }, { header: "Palets ya facturados", key: "facturados", width: 9 }, { header: "Nota", key: "nota", width: 70 }]);
for (const v of ventasCliente) {
  const esM = v.clave === "MERCADONA S.A.";
  fila(hV, { ...v, importe: esM ? (mdnaFacturado ? num(mf.importe) : null) : v.importe || null, eurkg: esM ? (mdnaFacturado ? num(mf.importe) / v.kg : null) : (v.importe ? v.importe / v.kg : null), nota: esM ? (mdnaFacturado ? `FACTURADO: ${mf.facturas} facturas del ${String(mf.primera_factura).slice(0, 10)}, ${es(mf.kg_nominal)} kg nominales × ${es(num(mf.importe) / num(mf.kg_nominal), 4)} €/kg nominal (cajas × 12 kg). Sobre kilo real: ${es(num(mf.importe) / v.kg, 3)} €/kg.` : `SIN FACTURAR todavía (Mercadona factura el lunes siguiente). Estimación: ${es(mdnaCajas)} cajas × 12 kg × ${es(tarifaAnt, 4)} €/kg nominal (tarifa de la semana anterior) = ${es(ingMdna)} €.`) : (v.importe ? "" : v.clave === "(sin cliente asignado)" ? "Confeccionado y todavía sin albarán de venta" : "Vendido con albarán pero a 0,00 € en el ERP (consignación o precio pendiente): no se suma a ingresos hasta que se facture") }, esM ? CELESTE : (!v.importe && v.clave !== "(sin cliente asignado)" ? AMBAR : undefined));
}
if (erpPaletDesmontados.length) fila(hV, { clave: "(desmontados: vuelven a la línea, no es venta)", palets: erpPaletDesmontados.length, cajas: sum(erpPaletDesmontados, (p) => p.num_cajas), kg: sum(erpPaletDesmontados, (p) => p.kg_netos), nota: "Estado 4 en el ERP. Fruta en cajas de cítrica que se desmontó para la línea o industria. Fuera del total." }, GRIS);
if (erpPaletBorrados.length) fila(hV, { clave: "(borrados en el ERP después de copiarse a la app)", palets: erpPaletBorrados.length, kg: sum(erpPaletBorrados, (p) => p.kg_netos), nota: `Números ${erpPaletBorrados.map((p) => p.numero).join(", ")}. Ya no existen en el ERP; la copia de la app no los quitó. Fuera del total.` }, GRIS);
total(hV, { clave: "TOTAL", palets: sum(ventasCliente, (v) => v.palets), cajas: sum(ventasCliente, (v) => v.cajas), kg: sum(ventasCliente, (v) => v.kg), importe: ingresos, nota: `Ingresos contados: Mercadona ${es(ingMdna)} (${mdnaFacturado ? "facturado" : "ESTIMADO"}) + otros con importe ${es(ingOtros)}. Vendido a 0,00 €: ${es(kgVendidoSinPrecio)} kg · sin cliente: ${es(kgSinCliente)} kg.` });
if (!mdnaFacturado) avisos.push(["MEDIA", "Mercadona de la semana sin facturar en el ERP", `Los ingresos de Mercadona (${es(ingMdna)} €) van ESTIMADOS con la tarifa de la semana anterior (${es(tarifaAnt, 4)} €/kg nominal). Volver a sacar el análisis cuando la oficina facture (normalmente el lunes).`]);

// — Fruta: comprada, usada y dónde
const hF = hoja("Fruta comprada y usada", [{ header: "Lote", key: "lote", width: 14 }, { header: "Kg que pesó el Sizer de ese lote esta semana", key: "kgSizer", width: 14, numFmt: "#,##0" }, { header: "Kg reales usados (palets ÷ 0,98 repartidos por lote)", key: "kgUsado", width: 14, numFmt: "#,##0" }, { header: "€/kg del lote (compra + porte)", key: "eurKg", width: 11, numFmt: "0.0000" }, { header: "€ de fruta usada", key: "eur", width: 12, numFmt: "#,##0.00" }, { header: "De dónde sale el precio", key: "fuente", width: 44 }]);
for (const l of frutaLotes) fila(hF, l, l.conPrecio ? undefined : AMBAR);
total(hF, { lote: "TOTAL USADA", kgSizer: sizerLotesTotal, kgUsado: kgFrutaConsumida, eurKg: frutaEurKgMedio, eur: fruta });
fila(hF, { lote: "Cómo leerlo", fuente: `Kg usados = kg de palets de la semana (${es(T.palets)}) ÷ 0,98 (rendimiento medido con el recuento del 15-09), repartidos entre los lotes según lo que el Sizer pesó de cada uno (${es(sizerLotesTotal)} kg en total; el Sizer pesa de menos la SAF, por eso solo se usa para la proporción). €/kg de cada lote = (importe de compra + porte) ÷ kg de entrada, del alta del ERP copiada en la app.${kgSinPrecioLote ? ` ${es(kgSinPrecioLote)} kg van a la media de campaña porque su lote no tiene alta con importe.` : ""}` });
fila(hF, { lote: "COMPRADA esta semana", kgUsado: compradaKg, eur: compradaEur, fuente: compradaSemana.length ? compradaSemana.map((e) => `${e.lote} ${es(e.kg_entrada)} kg ${es(num(e.importe_compra) + num(e.importe_transporte))} €${num(e.importe_transporte) ? "" : " (sin porte en el ERP)"}`).join(" · ") : "ninguna entrada de fruta esta semana" }, CELESTE);
fila(hF, { lote: "Balance", fuente: `Stock al empezar la semana (balance) ${es(stockBalance - compradaKg + kgFrutaConsumida)} + comprada ${es(compradaKg)} − usada ${es(kgFrutaConsumida)} = ${es(stockBalance)} kg al cerrar el ${diaLargo(hasta)}. ${recuento ? `Recuento del ${recuento.fecha}: ${es(recuento.total)} kg.` : "Sin recuento físico."}` });
fila(hF, { lote: "DÓNDE (salidas)", fuente: salidas.map((sl) => `${sl.destino}: ${sl.palets} palets, ${es(sl.cajas)} cajas, ${es(sl.kg)} kg`).join(" · ") }, GRIS);
fila(hF, { lote: "Destrío al calibrar", fuente: `Podrido ${es(destrio.podrido)} kg · industria ${es(destrio.industria)} · mujeres (triaje a mano) ${es(destrio.mujeres)} · cat 2 y 3 ${es(destrio.cat23)} kg (según las clases del Sizer). La diferencia entre fruta usada (${es(kgFrutaConsumida)}) y palets (${es(T.palets)}) son ${es(kgFrutaConsumida - T.palets)} kg: destrío más restos que quedan en box.` });

// — Cuenta
const hE = hoja("Cuenta de la semana", [{ header: "Concepto", key: "c", width: 44 }, { header: "Cómo se calcula (MEDIDO o ESTIMADO, y de dónde sale)", key: "como", width: 120 }, { header: "€", key: "eur", width: 14, numFmt: "#,##0.00" }, { header: "€/kg calibrado", key: "eurkg", width: 11, numFmt: "0.0000" }]);
const ekg = (v) => (v != null && T.sizer ? v / T.sizer : null);
fila(hE, { c: "INGRESOS" }).font = { bold: true };
fila(hE, { c: `Mercadona (${mdnaFacturado ? "FACTURADO" : "ESTIMADO"})`, como: mdnaFacturado ? `${es(mf.kg_nominal)} kg nominales facturados a ${es(num(mf.importe) / num(mf.kg_nominal), 4)} €/kg (fact_lin_alb del ERP, cliente ${CLIENTE_MERCADONA_ERP}, por fecha de albarán). Sobre kilo real: ${es(ingMdna / Math.max(1, T.mdna), 3)} €/kg.` : `${es(mdnaCajas)} cajas × 12 kg × ${es(tarifaAnt, 4)} €/kg nominal (tarifa de la semana ${anterior.semana})`, eur: ingMdna, eurkg: ekg(ingMdna) }, mdnaFacturado ? VERDE : AMBAR);
fila(hE, { c: "Otros clientes con importe en el ERP", como: ventasCliente.filter((v) => v.clave !== "MERCADONA S.A." && v.importe).map((v) => `${v.clave.split(" ")[0]} ${es(v.importe)}`).join(" + ") || "ninguno", eur: ingOtros, eurkg: ekg(ingOtros) });
const vendidosSinPrecio = erpPaletVivos.filter((p) => p.cliente && p.cliente !== "MERCADONA S.A." && p.num_albaran_venta && !num(p.importe_venta));
const sinCliente = erpPaletVivos.filter((p) => (!p.cliente || !p.num_albaran_venta) && p.cliente !== "MERCADONA S.A." && !num(p.importe_venta));
fila(hE, { c: "Vendido con albarán pero a 0,00 € (no se suma)", como: kgVendidoSinPrecio ? `${es(kgVendidoSinPrecio)} kg en ${vendidosSinPrecio.length} palets: ${[...new Set(vendidosSinPrecio.map((p) => p.cliente))].join(", ")} (albaranes ${[...new Set(vendidosSinPrecio.map((p) => p.num_albaran_venta))].join(", ")}). Consignación o precio pendiente: entran en ingresos la semana en que la oficina los valore.` : "ninguno", eur: 0 }, kgVendidoSinPrecio ? AMBAR : undefined);
fila(hE, { c: "Confeccionado sin cliente todavía (no se suma)", como: kgSinCliente ? `${es(kgSinCliente)} kg en ${sinCliente.length} palets sin albarán de venta: siguen en la nave como producto terminado.` : "ninguno", eur: 0 }, kgSinCliente ? AMBAR : undefined);
fila(hE, { c: "Palets desmontados (no son venta)", como: erpPaletDesmontados.length ? `${erpPaletDesmontados.length} palets, ${es(sum(erpPaletDesmontados, (p) => p.kg_netos))} kg (estado 4 en el ERP): fruta que volvió a la línea o a industria.` : "ninguno", eur: 0 });
fila(hE, { c: "Palets borrados en el ERP después de copiarse a la app", como: erpPaletBorrados.length ? `${erpPaletBorrados.length} palets, ${es(sum(erpPaletBorrados, (p) => p.kg_netos))} kg (números ${erpPaletBorrados.map((p) => p.numero).join(", ")}). No existen: se descartan.` : "ninguno", eur: 0 }, erpPaletBorrados.length ? AMBAR : undefined);
total(hE, { c: "Total ingresos", eur: ingresos, eurkg: ekg(ingresos) });

fila(hE, { c: "FRUTA" }).font = { bold: true };
fila(hE, { c: "Fruta COMPRADA esta semana", como: compradaSemana.length ? `${es(compradaKg)} kg en ${compradaSemana.length} entradas, ${es(compradaEur)} € (alta del ERP${compradaSemana.some((e) => !num(e.importe_transporte)) ? "; OJO: hay entradas sin porte cargado en el ERP" : " + porte"}). Es lo que ha entrado, no lo que se ha gastado.` : "ninguna", eur: compradaEur, eurkg: null }, CELESTE);
fila(hE, { c: "Fruta USADA esta semana (la que va a la cuenta)", como: `${es(kgFrutaConsumida)} kg reales (palets ${es(T.palets)} ÷ 0,98) repartidos por lote y valorados con el €/kg de cada lote (compra + porte del alta del ERP): ${frutaLotes.slice(0, 6).map((l) => `${l.lote} ${es(l.kgUsado)} kg × ${es(l.eurKg, 3)}`).join(" · ")}${frutaLotes.length > 6 ? " · …" : ""}. Media ${es(frutaEurKgMedio, 4)} €/kg. Detalle en la hoja «Fruta comprada y usada».${kgSinPrecioLote ? ` ${es(kgSinPrecioLote)} kg a la media de campaña (ESTIMADO).` : ""}`, eur: fruta, eurkg: ekg(fruta) });
if (precioFrutaBon != null) fila(hE, { c: "   Contraste: la misma fruta al precio del Laadbon de HG", como: `${es(kgFrutaConsumida)} kg × ${es(precioFrutaBon, 4)} €/kg (cajas × €/caja + porte de ${conBon.length} bons completos de la LAN: ${es(eurBon)} € ÷ ${es(kgBon)} kg de Calidad). El alta del ERP valora la fruta un ${pct(frutaEurKgMedio / precioFrutaBon - 1)} por encima del papel de HG: ${es(fruta - kgFrutaConsumida * precioFrutaBon)} € de diferencia.`, eur: kgFrutaConsumida * precioFrutaBon }, AMBAR);
fila(hE, { c: "   Dónde ha ido", como: salidas.map((sl) => `${sl.destino}: ${es(sl.kg)} kg (${sl.palets} palets)`).join(" · ") + ` · destrío al calibrar: podrido ${es(destrio.podrido)}, industria ${es(destrio.industria)}, mujeres ${es(destrio.mujeres)}, cat 2-3 ${es(destrio.cat23)} kg`, eur: null }, GRIS);

fila(hE, { c: "ENVASE (a precio real de cada caja)" }).font = { bold: true };
for (const l of envaseLineas.sort((a, b) => b.eur - a.eur)) fila(hE, { c: `   ${l.destino} · ${l.articulo ?? "(sin artículo)"}`, como: `${l.palets} palets, ${es(l.cajas)} cajas, ${es(l.kg)} kg. ${l.como}`, eur: l.eur, eurkg: l.kg ? l.eur / l.kg : null }, /SIN PRECIO|sin precio propio/.test(l.como) ? AMBAR : undefined);
total(hE, { c: "Total envase", como: `Malla Mercadona a ${es(eurPorMalla3 / 3, 4)} €/kg (${es(eurPorMalla3, 4)} €/malla, precios reales de sus 7 componentes); el resto de cajas al precio que el ERP de consumibles tiene de cada caja, más palet y etiqueta estimados.`, eur: envase, eurkg: ekg(envase) });

fila(hE, { c: "SUMINISTROS (luz, agua, gasoil)" }).font = { bold: true };
fila(hE, { c: "Suministros de la semana", como: `${diasProd.length} días de producción × ${es(suministrosDia)} €/día. El €/día sale de las facturas reales de la campaña 25-26 cargadas en la app (${es(eurFacturas)} € de luz, agua y gasoil en ${mesesFact.length} meses, ${mesesFact[0]} a ${mesesFact.at(-1)}) ÷ ${diasConFactura} días de producción de esos meses. ESTIMADO: la fábrica gasta por día encendida más que por kilo, por eso se reparte por día y no por kilo (por kilo saldrían ${es(eurFacturas / Math.max(1, sum(partesCampana.filter((p) => mesesFact.includes(p.date.slice(0, 7))), (p) => p.kg_produccion_calibrador)) * T.sizer)} €).`, eur: suministros, eurkg: ekg(suministros) }, AMBAR);
fila(hE, { c: "   Contraste: agua del contador de la semana", como: aguaSemana.length ? `${es(aguaL)} litros en ${aguaSemana.length} lecturas del contador general × ${es(tarifa("agua"), 4)} €/m³ (tarifa real de facturas) = ${es(aguaEur)} €. MEDIDO. Es solo el agua; la luz no tiene contador en la app.` : "Sin lecturas del contador general esta semana en la app (fotos de los contadores sin subir).", eur: aguaEur }, aguaSemana.length ? undefined : GRIS);

fila(hE, { c: "PERSONAL (Seguridad Social incluida)" }).font = { bold: true };
if (personas) { for (const g of personalGrupos) fila(hE, { c: `   ${g.grupo}`, como: `${es(g.horas, 1)} horas reales de la hoja de RRHH × ${COSTE_HORA_MEDIO_CON_SS} €/h. Actividades: ${g.actividades.join(", ")}.`, eur: g.coste, eurkg: ekg(g.coste) }); }
fila(hE, { c: "Total personal", como: personas ? `${es(personas.horasTotal, 1)} horas × ${COSTE_HORA_MEDIO_CON_SS} €/h (coste medio con Seguridad Social, fijado por Vadim y administración el 16-09-2026). Hoja ${personas.archivo}. Referencia: la hoja marca ${es(personas.pagadoHoras)} € pagados por horas.` : "SIN DATO: falta la hoja semanal de RRHH en scripts/informe-produccion. Las horas no se estiman.", eur: personal, eurkg: ekg(personal) }, personas ? undefined : ROJO);
if (personas) { const horasConf = sum(personalGrupos.filter((g) => /Confecci/.test(g.grupo)), (g) => g.horas); fila(hE, { c: "   Personal por kilo y por palet", como: `Por kilo calibrado ${es(personal / Math.max(1, T.sizer), 4)} €/kg · por kilo de palet ${es(personal / Math.max(1, T.palets), 4)} €/kg · por palet ${es(personal / Math.max(1, T.npalets), 2)} € · por caja de Mercadona ${es(personal / Math.max(1, mdnaCajas), 3)} € · confección sola: ${es(horasConf, 0)} h = ${es(horasConf * COSTE_HORA_MEDIO_CON_SS)} € = ${es(horasConf * COSTE_HORA_MEDIO_CON_SS / Math.max(1, T.palets), 4)} €/kg de palet.`, eur: null }); }

fila(hE, { c: "RESULTADO" }).font = { bold: true };
total(hE, { c: margen != null ? "MARGEN ANTES DE GASTOS FIJOS (ESTIMADO)" : "MARGEN: SIN DATO (falta personal o fruta)", como: margen != null ? `${es(ingresos)} − fruta ${es(fruta)} − envase ${es(envase)} − suministros ${es(suministros)} − personal ${es(personal)}. Faltan los gastos fijos (alquiler, amortizaciones, oficina, gestoría) y la limpieza de box.${precioFrutaBon != null ? ` Con la fruta al precio del bon de HG: ${es(margen + fruta - kgFrutaConsumida * precioFrutaBon)} €.` : ""}` : "", eur: margen, eurkg: ekg(margen) });
if (margen != null) { fila(hE, { c: "Ese margen por kilo vendido a Mercadona", como: `${es(margen)} ÷ ${es(T.mdna)} kg`, eur: T.mdna ? margen / T.mdna : null }); fila(hE, { c: "Coste total por kilo calibrado (fruta + envase + suministros + personal)", como: `${es(fruta + envase + suministros + personal)} ÷ ${es(T.sizer)} kg`, eur: T.sizer ? (fruta + envase + suministros + personal) / T.sizer : null }); }

// — Personas
const hG = hoja("Personas", [{ header: "Día", key: "dia", width: 14 }, { header: "Presentes", key: "presentes", width: 9 }, { header: "Computan en kg/persona", key: "computables", width: 10 }, { header: "Horas (RRHH)", key: "horas", width: 10, numFmt: "#,##0.0" }, { header: "Coste (€)", key: "coste", width: 11, numFmt: "#,##0.00" }, { header: "Kg calibrados", key: "sizer", width: 11, numFmt: "#,##0" }, { header: "Kg por persona", key: "kgp", width: 11, numFmt: "#,##0" }, { header: "Semáforo", key: "sem", width: 22 }, { header: "Fuente", key: "fuente", width: 50 }]);
for (const d of dias) if (d.presentes) fila(hG, { ...d, fuente: personas?.porDia.get(d.fecha) ? "hoja semanal de RRHH" : "asistencia de la app (sin horas)" }, colorSem(d.sem));
total(hG, { dia: "SEMANA", presentes: personas ? personas.mediaPresentes.toFixed(1) : null, horas: personas?.horasTotal ?? null, coste: personal, sizer: T.sizer, kgp: sum(diasProd, (d) => d.computables) ? T.sizer / sum(diasProd, (d) => d.computables) : null, fuente: personas ? "" : "SIN HOJA DE RRHH: solo presentes de la app" });
if (personas) { const hGp = hoja("Personas detalle", [{ header: "Persona", key: "nombre", width: 34 }, { header: "Actividad", key: "actividad", width: 22 }, { header: "Días", key: "dias", width: 6 }, { header: "Horas", key: "horas", width: 9, numFmt: "#,##0.0" }, { header: "Coste semana (€, Seg. Social incluida)", key: "coste", width: 14, numFmt: "#,##0.00" }, { header: "De dónde sale el coste", key: "origen", width: 40 }]); for (const p of [...personas.porPersona.values()].sort((a, b) => a.actividad.localeCompare(b.actividad) || a.nombre.localeCompare(b.nombre))) fila(hGp, p, /sin coste/.test(p.origen) ? AMBAR : undefined); total(hGp, { nombre: "TOTAL", horas: personas.horasTotal, coste: personal }); }
else faltan.push("Hoja semanal de RRHH (horas y coste de personal)");

// — Pendientes y sistema
const hX = hoja("Pendientes y sistema", [{ header: "Prioridad", key: "p", width: 10 }, { header: "Asunto", key: "a", width: 40 }, { header: "Detalle", key: "d", width: 110 }]);
for (const h of hallazgos.slice(0, 25)) fila(hX, { p: (h.severidad ?? "media").toUpperCase(), a: `Vigía · ${h.titulo}`, d: `${h.detalle ?? ""}${h.eur ? ` · ${es(h.eur)} €` : ""}${h.kg ? ` · ${es(h.kg)} kg` : ""} (desde ${String(h.creado_at).slice(0, 10)})` }, /alta/i.test(h.severidad) ? ROJO : AMBAR);
for (const [p, a, d] of avisos) fila(hX, { p, a, d }, p === "ALTA" ? ROJO : AMBAR);
for (const f of faltan) fila(hX, { p: "SIN DATO", a: f, d: "No se inventa: la hoja correspondiente lo dice." }, GRIS);
fila(hX, { p: "SISTEMA", a: "Trabajos automáticos (latidos)", d: latidos.map((l) => `${l.trabajo}: ${l.estado} hace ${Math.round(horasDesde(l.visto_a))} h`).join(" · ") });
for (const l of latidosMal) fila(hX, { p: "ALTA", a: `Sistema · ${l.trabajo} en ${l.estado}`, d: `${l.detalle ?? ""} (último latido hace ${Math.round(horasDesde(l.visto_a))} h)` }, ROJO);

// — Notas manuales
const hN = hoja("Notas de la semana", [{ header: "Notas aportadas a mano (chat de calidad, cuaderno, decisiones)", key: "t", width: 160 }]);
if (notas) for (const linea of notas.split(/\r?\n/)) fila(hN, { t: linea }); else fila(hN, { t: `Sin notas. Para añadirlas, dejar un fichero de texto en ${path.join(DIR_SALIDA, `notas-${ETIQ}.md`)} (una línea por nota, con quién lo dijo y cuándo) y volver a lanzar el análisis.` }, GRIS);

// — Resumen
const R = (k, v, q, c) => fila(hR, { k, v, q }, c);
R("Días de producción", `${diasProd.length} (${diasProd.map((d) => d.dia.split(" ")[0].slice(0, 3)).join(", ")})`, `Días con kilos en el calibrador o palets en el ERP. Semana ${anterior.semana}: ${TA.dias} días con palets.`);
R("Kg que pasaron por el calibrador", `${es(T.sizer)} kg`, `Informes del Sizer en la app. ${diasProd.length ? es(T.sizer / diasProd.length) + " kg por día de trabajo." : ""}`);
R("Kg de palets hechos", `${es(T.palets)} kg en ${T.npalets} palets`, `ERP. Semana ${anterior.semana}: ${es(TA.palets)} kg en ${TA.npalets} palets (${TA.palets ? (T.palets >= TA.palets ? "+" : "") + pct(T.palets / TA.palets - 1, 0) : "—"}).`);
R("De ellos a Mercadona", `${es(T.mdna)} kg · ${ventasCliente.find((v) => v.clave === "MERCADONA S.A.")?.palets ?? 0} palets · ${es(mdnaCajas)} cajas`, `${T.palets ? pct(T.mdna / T.palets, 0) : "—"} de la semana. Semana ${anterior.semana}: ${es(TA.mdna)} kg.`);
R("Calidad al calibrar", T.sizer ? `${pct(kgExport / T.sizer)} exportación · podrido ${pct(kgPodrido / T.sizer, 2)}` : "SIN DATO", "Clases del calibrador (hoja Calidad al calibrar).");
R("Calidad de entrada", controles.length ? `${controles.length} controles · ${controles.filter((c) => /no (se )?acepta|rechaz|no apto/i.test(c.conclusion ?? "")).length} con rechazo` : "SIN DATO en la app", "Controles de Raquel tecleados en la app (hoja Calidad de entrada).", controles.some((c) => /no (se )?acepta|rechaz|no apto/i.test(c.conclusion ?? "")) ? ROJO : undefined);
R("Camiones recibidos", `${camiones.length} de importación · ${es(sum(camiones, (c) => c.kg))} kg${kgEntradasNacional ? ` + ${es(kgEntradasNacional)} kg nacionales` : ""}`, "Entradas del ERP (kilos reales de Calidad). Detalle y cuadre con el bon de HG en la hoja Camiones.");
R("Stock de fruta SAF", recuento && recuento.fecha >= sumarDias(desde, -2) ? `${es(recuento.total)} kg contados el ${recuento.fecha}` : `${es(stockBalance)} kg por balance (ESTIMADO)`, recuento ? recuento.resumen : "Entradas − palets ÷ 0,98. Sin recuento físico esta semana: el balance solo da el orden de magnitud.", AMBAR);
R("Ingresos", `${es(ingresos)} €${mdnaFacturado ? "" : " (Mercadona ESTIMADO)"}`, mdnaFacturado ? `Mercadona facturado ${es(ingMdna)} € (${mf.facturas} facturas) + otros ${es(ingOtros)} €.` : `Mercadona sin facturar aún: ${es(ingMdna)} € a la tarifa de la semana anterior + otros ${es(ingOtros)} €.`, mdnaFacturado ? VERDE : AMBAR);
R("Fruta usada", fruta != null ? `${es(fruta)} € · ${es(kgFrutaConsumida)} kg` : "SIN DATO", fruta != null ? `Kg reales (palets ÷ 0,98) valorados lote a lote con su alta del ERP (compra + porte): media ${es(frutaEurKgMedio, 3)} €/kg.${precioFrutaBon != null ? ` Al precio del Laadbon de HG (${es(precioFrutaBon, 3)} €/kg) serían ${es(kgFrutaConsumida * precioFrutaBon)} €.` : ""} Comprada esta semana: ${es(compradaKg)} kg, ${es(compradaEur)} €.` : "");
R("Personal (con Seguridad Social)", personal != null ? `${es(personal)} € · ${es(personas.horasTotal, 0)} horas · ${personas.mediaPresentes.toFixed(1)} personas/día` : "SIN DATO (falta la hoja de RRHH)", personal != null ? `Horas reales de RRHH × ${COSTE_HORA_MEDIO_CON_SS} €/h (media con Seg. Social incluida). Personal por kilo calibrado: ${es(personal / Math.max(1, T.sizer), 4)} €/kg.` : "Las horas no se estiman: en cuanto RRHH deje la hoja en su carpeta, el análisis se vuelve a sacar completo.", personal != null ? undefined : ROJO);
R("Margen antes de gastos fijos", margen != null ? `${es(margen)} € (estimado)` : "SIN DATO", margen != null ? `Ingresos ${es(ingresos)} − fruta ${es(fruta)} − envase ${es(envase)} − suministros ${es(suministros)} − personal ${es(personal)} (Seg. Social incluida). Coste total ${es((fruta + envase + suministros + personal) / Math.max(1, T.sizer), 3)} €/kg calibrado. Faltan alquiler, amortizaciones, oficina y limpieza de box.${precioFrutaBon != null ? ` Con la fruta al precio del bon de HG el margen sería ${es(margen + fruta - kgFrutaConsumida * precioFrutaBon)} €.` : ""}` : "Se calcula cuando haya personal y fruta.", margen == null ? GRIS : margen > 0 ? VERDE : ROJO);
R("Sistema", latidosMal.length ? `${latidosMal.length} trabajo(s) en error o parados` : "todo con señal", latidosMal.length ? latidosMal.map((l) => l.trabajo).join(", ") : "Todos los trabajos automáticos han latido en los últimos 8 días.", latidosMal.length ? ROJO : VERDE);
R("Pendientes", `${hallazgos.length} hallazgos del vigía abiertos · ${avisos.length} avisos de este análisis · ${faltan.length} datos que faltan`, "Hoja Pendientes y sistema.");

// — Para José María (negocio, sin sistema)
const J = (k, v, q, c) => fila(hJ, { k, v, q }, c);
J("Producción", `${es(T.sizer)} kg calibrados · ${es(T.palets)} kg de palets (${T.npalets})`, `${diasProd.length} días de trabajo. Semana anterior: ${es(TA.palets)} kg de palets.`);
J("Mercadona", `${es(T.mdna)} kg · ${es(mdnaCajas)} cajas`, mdnaFacturado ? `Facturado: ${es(ingMdna)} € (${es(num(mf.importe) / num(mf.kg_nominal), 2)} €/kg nominal).` : `Pendiente de facturar: unos ${es(ingMdna)} € a la tarifa de la semana anterior.`);
J("Calidad", T.sizer ? `${pct(kgExport / T.sizer)} exportación · podrido ${pct(kgPodrido / T.sizer, 2)}` : "SIN DATO", controles.filter((c) => /no (se )?acepta|rechaz|no apto/i.test(c.conclusion ?? "")).map((c) => `Rechazo en ${c.nuestra_ref ?? c.referencia} (${c.marca}): ${String(c.conclusion).split(String.fromCharCode(10))[0].slice(0, 120)}`).join(" · ") || "Sin rechazos de entrada tecleados esta semana.");
J("Fruta recibida", `${camiones.length} camiones · ${es(sum(camiones, (c) => c.kg))} kg`, camiones.map((c) => c.lote ? `${c.lote.lote}: ${c.lote.marcas}` : c.lan ? `${String(c.fecha).slice(5)} ${c.articulo}: ${c.lan.lotes.map((l) => l.marcas).join("; ")}` : `${String(c.fecha).slice(5)} ${c.articulo} ${es(c.kg)} kg (sin control de Calidad en la LAN)`).join(" · "));
J("Stock", recuento && recuento.fecha >= sumarDias(desde, -2) ? `${es(recuento.total)} kg (contado el ${recuento.fecha})` : `unos ${es(stockBalance)} kg (balance, estimado)`, recuento ? recuento.resumen : "Sin recuento esta semana.");
J("Cuenta de la semana", margen != null ? `margen ${es(margen)} € antes de gastos fijos (estimado)` : "incompleta", `Ingresos ${es(ingresos)} · fruta usada ${fruta != null ? es(fruta) : "SIN DATO"} (${es(kgFrutaConsumida)} kg, comprada ${es(compradaKg)} kg) · envase ${es(envase)} · suministros ${es(suministros)} · personal ${personal != null ? es(personal) : "SIN DATO"}. Coste ${fruta != null && personal != null ? es((fruta + envase + suministros + personal) / Math.max(1, T.sizer), 3) : "—"} €/kg calibrado.`, margen == null ? GRIS : margen > 0 ? VERDE : ROJO);
J("Personas", personal != null ? `${personas.mediaPresentes.toFixed(1)} personas/día · ${es(personal)} € (Seg. Social incluida)` : "SIN DATO de horas", personal != null ? `${es(personas.horasTotal, 0)} horas × 9 €/h. ${es(personal / Math.max(1, T.sizer), 3)} € de personal por kilo calibrado.` : "RRHH aún no ha pasado la hoja de la semana.");
if (avisos.filter((a) => a[0] === "ALTA").length) J("Avisos", `${avisos.filter((a) => a[0] === "ALTA").length} de prioridad alta`, avisos.filter((a) => a[0] === "ALTA").map((a) => a[1]).join(" · "), ROJO);
if (notas) J("Notas de la semana", "", notas.split(/\r?\n/).filter(Boolean).slice(0, 8).join(" · "));
libro.worksheets.splice(libro.worksheets.indexOf(hJ), 1); libro.worksheets.unshift(hJ); hJ.orderNo = 0.5;
libro.worksheets.splice(libro.worksheets.indexOf(hR), 1); libro.worksheets.unshift(hR); hR.orderNo = 0;

fs.mkdirSync(DIR_SALIDA, { recursive: true });
const ruta = path.join(DIR_SALIDA, `Analisis_Empresa_${ETIQ}.xlsx`);
await libro.xlsx.writeFile(ruta);
console.log(`Excel: ${ruta} · Sizer ${es(T.sizer)} · palets ${es(T.palets)} · MDNA ${es(T.mdna)} · ingresos ${es(ingresos)} · fruta ${fruta != null ? es(fruta) : "—"} · personal ${personal != null ? es(personal) : "—"} · margen ${margen != null ? es(margen) : "—"}`);
if (faltan.length) console.log("SIN DATO:", faltan.join(" | "));

log("Excel escrito");
// ═════════════════════════════ 4. CORREO
const li = (b, t) => `<li><b>${b}:</b> ${t}</li>`;
const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#222">
<p>Análisis de la empresa de la <b>semana ${semana.semana}</b> (del ${diaLargo(desde)} al ${diaLargo(hasta)} de ${mes(desde)}). Excel adjunto: primera hoja «Para José María», segunda «Resumen», y el detalle detrás con cómo se calcula cada cifra.</p><ul>
${li("Producción", `${es(T.sizer)} kg por el calibrador en ${diasProd.length} días; ${es(T.palets)} kg de palets (${T.npalets}); ${es(T.mdna)} kg a Mercadona (${es(mdnaCajas)} cajas). Semana anterior: ${es(TA.palets)} kg de palets.`)}
${li("Calidad", T.sizer ? `${pct(kgExport / T.sizer)} de exportación al calibrar, podrido ${pct(kgPodrido / T.sizer, 2)}.` : "sin informes del calibrador.")} ${controles.filter((c) => /no (se )?acepta|rechaz|no apto/i.test(c.conclusion ?? "")).length ? `Rechazos de entrada: ${controles.filter((c) => /no (se )?acepta|rechaz|no apto/i.test(c.conclusion ?? "")).map((c) => c.marca ?? c.referencia).join(", ")}.` : ""}
${li("Fruta recibida", `${camiones.length} camiones de importación, ${es(sum(camiones, (c) => c.kg))} kg${kgEntradasNacional ? `, más ${es(kgEntradasNacional)} kg nacionales` : ""}.`)}
${li("Stock", recuento && recuento.fecha >= sumarDias(desde, -2) ? `${es(recuento.total)} kg contados el ${recuento.fecha}.` : `unos ${es(stockBalance)} kg por balance (estimado; sin recuento físico esta semana).`)}
${li("Cuenta", margen != null ? `ingresos ${es(ingresos)} €${mdnaFacturado ? "" : " (Mercadona estimado)"} − fruta usada ${es(fruta)} (${es(kgFrutaConsumida)} kg lote a lote; comprada esta semana ${es(compradaKg)} kg por ${es(compradaEur)} €) − envase ${es(envase)} (precio real de cada caja) − suministros ${es(suministros)} (facturas reales ÷ días) − personal ${es(personal)} (horas reales × 9 €/h con Seg. Social) = <b>${es(margen)} € antes de gastos fijos</b> (estimado). Coste total ${es((fruta + envase + suministros + personal) / Math.max(1, T.sizer), 3)} €/kg calibrado, personal ${es(personal / Math.max(1, T.sizer), 3)} €/kg.` : `incompleta: ${faltan.join("; ")}.`)}
${li("Personas", personal != null ? `${personas.mediaPresentes.toFixed(1)} personas al día, ${es(personas.horasTotal, 0)} horas × 9 €/h = ${es(personal)} € con Seguridad Social; ${es(personal / Math.max(1, T.sizer), 3)} €/kg calibrado.` : "SIN DATO de horas: RRHH no ha dejado la hoja de la semana.")}
${avisos.length ? li("Avisos", avisos.map((a) => `${a[1]}`).join(" · ")) : ""}
${latidosMal.length ? li("Sistema", `${latidosMal.map((l) => l.trabajo).join(", ")} en error o parados.`) : ""}
${notas ? li("Notas de la semana", notas.split(/\r?\n/).filter(Boolean).slice(0, 6).join(" · ")) : ""}
</ul><p style="font-size:12px;color:#666">Generado automáticamente el ${hoy} por scripts/analisis-semanal-empresa.mjs. Fuentes: ERP (palets, entradas, facturas), app (calibrador, ventas, asistencia, calidad, vigía), carpeta de Calidad en la LAN (pesos y Laadbon)${personas ? ", hoja semanal de RRHH" : ""}${recuento ? ", recuento de cámara" : ""}. Lo que no está en ninguna fuente va como SIN DATO, no se inventa.</p></div>`;
fs.writeFileSync(path.join(DIR_SALIDA, `correo-${ETIQ}.html`), html, "utf8");
let envio = "sin-enviar";
if (ENVIAR) {
  if (!process.env.RESEND_API_KEY) { console.log("(sin RESEND_API_KEY: no se envía)"); envio = "sin-clave"; }
  else {
    const res = await fetch("https://api.resend.com/emails", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
      body: JSON.stringify({ from: "Informes Lasarte <informes@comunicaciones.lasartesat.com>", to: PARA, reply_to: "soporte@lasartesat.es", subject: `Análisis de la empresa · semana ${semana.semana}/${semana.anio} (${diaLargo(desde)} al ${diaLargo(hasta)} de ${mes(desde)})`, html,
        text: `Análisis de la empresa, semana ${semana.semana}. Producción ${es(T.sizer)} kg, Mercadona ${es(T.mdna)} kg, ingresos ${es(ingresos)} €, margen ${margen != null ? es(margen) : "SIN DATO"} €.`,
        attachments: [{ filename: path.basename(ruta), content: fs.readFileSync(ruta).toString("base64") }] }) });
    if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 300)}`);
    console.log("Correo enviado a", PARA.join(", "), "id", (await res.json()).id); envio = "enviado";
  }
}
const estado = faltan.length || latidosMal.length ? "aviso" : "ok";
const detalle = `${ETIQ}: Sizer ${es(T.sizer)} · palets ${es(T.palets)} · MDNA ${es(T.mdna)} · margen ${margen != null ? es(margen) + " €" : "SIN DATO"} · ${envio}${faltan.length ? " · falta: " + faltan.join(", ") : ""}`;
await anotarEjecucion({ trabajo: "analisis-semanal-empresa", inicio: INICIO, estado, detalle, datos: { semana: ETIQ, sizer: T.sizer, palets: T.palets, mdna: T.mdna, ingresos, fruta, personal, margen, envio, faltan } });
await latido("analisis-semanal-empresa", { estado, detalle });
if (erp) await erp.end();

// ═════════════════════════════ ayudantes
function mes(iso) { return ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"][Number(iso.slice(5, 7)) - 1]; }
function agrupar(arr, clave, valor) { const o = {}; for (const x of arr) { const k = clave(x); o[k] = (o[k] ?? 0) + valor(x); } return o; }
function agruparObj(arr, clave, valor, extra) { const o = {}; for (const x of arr) { const k = clave(x) ?? "—"; const acc = o[k] ?? (o[k] = { clave: k, kg: 0, extra: {} }); acc.kg += valor(x); if (extra) extra(x, acc); else acc.extra.grupo = x.grupo_destino; } return o; }
function resumirDefectos(j) { if (!j) return ""; try { const o = typeof j === "string" ? JSON.parse(j) : j; if (Array.isArray(o)) return o.map((d) => (typeof d === "string" ? d : `${d.nombre ?? d.defecto ?? ""} ${d.pct ?? d.valor ?? ""}`)).join(", "); return Object.entries(o).filter(([, v]) => v).map(([k, v]) => `${k} ${v}`).join(", "); } catch { return String(j); } }

/** Hojas PESO y Laadbon de la carpeta de Calidad: un objeto por carpeta de control. */
function leerControlesLan() {
  const out = [];
  let carpetas; try { carpetas = fs.readdirSync(LAN_CONTROLES); } catch (e) { avisos.push(["MEDIA", "Carpeta de Calidad en la LAN no accesible", `${LAN_CONTROLES}: ${e.message}. Las hojas Camiones y Stock van sin marcas ni bon.`]); return out; }
  for (const c of carpetas) {
    const m = /^(\d{2})-(\d{2})-(\d{4}) CONTROL SAF ENTRADA (\S+)/i.exec(c); if (!m) continue;
    const fecha = `${m[3]}-${m[2]}-${m[1]}`; const bonNombre = m[4]; const dir = path.join(LAN_CONTROLES, c);
    let ficheros = []; try { ficheros = fs.readdirSync(dir, { recursive: true }).map(String); } catch { continue; }
    const item = { fecha, bonNombre, carpeta: c, lotes: [], bon: null };
    for (const f of ficheros) {
      const fp = path.join(dir, f); const n = path.basename(f).toLowerCase();
      if (n.endsWith(".xlsx") && (n.includes("peso") || n.includes("pesos")) && !n.startsWith("~$")) item.lotes.push(...leerPesoXlsxSync(fp, c));
      else if (n.endsWith(".pdf") && n.includes("laad")) item.bon = leerLaadbon(fp);
    }
    if (item.lotes.length) out.push(item);
  }
  return out;
}
/** Una hoja PESO → un objeto por lote (variedad) con kg neto total, palets y marcas/calibres. Síncrono vía workbook cacheado en un paso previo. */
function leerPesoXlsxSync(fp, carpeta) { return PESO_CACHE.get(fp) ?? []; }
async function precargarPesos() {
  let carpetas; try { carpetas = fs.readdirSync(LAN_CONTROLES); } catch { return; }
  for (const c of carpetas) {
    if (!/CONTROL SAF ENTRADA/i.test(c)) continue; const dir = path.join(LAN_CONTROLES, c);
    let ficheros = []; try { ficheros = fs.readdirSync(dir, { recursive: true }).map(String); } catch { continue; }
    for (const f of ficheros) {
      const n = path.basename(f).toLowerCase(); if (!(n.endsWith(".xlsx") && (n.includes("peso")) && !n.startsWith("~$"))) continue;
      const fp = path.join(dir, f);
      try {
        const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(fp); const ws = wb.worksheets[0];
        const porLote = new Map(); const lotesCarpeta = (c.match(/\b(26\d{6})(?:\s*y\s*(\d{2}))?/g) ?? []);
        ws.eachRow((row) => {
          const v = row.values.map((x) => (x && typeof x === "object" && "result" in x ? x.result : x)); if (typeof v[1] !== "number" || typeof v[2] !== "string" || v.length < 8) return;
          const marca = String(v[2]).split("/").pop().trim(); const cajas = num(v[3]); const cal = String(v[5] ?? ""); const variedad = v.length > 11 ? String(v[10] ?? "") : "";
          const neto = [...v].reverse().find((x) => typeof x === "number");
          const k = variedad || "único"; const l = porLote.get(k) ?? { variedad: k, kg: 0, palets: 0, cajas: 0, marcas: new Map() }; l.kg += neto; l.palets++; l.cajas += cajas;
          const mk = `${marca} ${cal}`; const mm = l.marcas.get(mk) ?? { marca, cal, palets: 0, kg: 0 }; mm.palets++; mm.kg += neto; l.marcas.set(mk, mm); porLote.set(k, l);
        });
        const lotes = [...porLote.values()].map((l, i) => ({ lote: asignarLote(c, l.variedad, i), variedad: l.variedad, kg: Math.round(l.kg), palets: l.palets, cajas: l.cajas, marcas: [...l.marcas.values()].map((m) => `${m.palets} ${m.marca} ${m.cal} (${es(m.kg)} kg)`).join(", ") }));
        PESO_CACHE.set(fp, lotes);
      } catch (e) { avisos.push(["BAJA", `Hoja PESO ilegible: ${path.basename(fp)}`, e.message]); }
    }
  }
}
function asignarLote(carpeta, variedad, i) { // "11-09-2026 CONTROL SAF ENTRADA 1189269-26091101 y 02" → 26091101 / 26091102 (Midknight primero, Navelate segundo)
  const m = /(26\d{6})(?:\s*y\s*(\d{2}))?/.exec(carpeta); if (!m) return variedad;
  if (/navel/i.test(variedad) && m[2]) return m[1].slice(0, 6) + m[2]; return m[1];
}
/** Laadbon (PDF de HG) leído con Python/pymupdf: cajas, € por línea, total y porte. */
function leerLaadbon(fp) {
  const py = spawnSync("python", [path.join("scripts", "lib-leer-pdf-texto.py"), fp], { encoding: "utf8", timeout: 30000 });
  if (py.status !== 0) return { numero: path.basename(fp).replace(/\D/g, ""), error: "PDF no legible (¿python/pymupdf?)" };
  let txt; try { txt = JSON.parse(py.stdout); } catch { return null; }
  const lineas = txt.split("\n").map((s) => s.trim());
  const bon = { numero: path.basename(fp).replace(/\D/g, "") || (((/Bonnummer[\s\S]*?(1\d{6})/.exec(txt) ?? [])[1]) ?? ""), cajas: 0, total: 0, sinPrecio: 0, porte: null, porteTexto: "", articulos: [] };
  const ref = /Uw Ref\s*:\s*([^\n]*)/.exec(txt)?.[1] ?? ""; const mp = /([\d.]+),-/.exec(ref); if (mp) { bon.porte = Number(mp[1].replace(/\./g, "")); bon.porteTexto = ref.trim(); }
  for (let i = 0; i < lineas.length; i++) {
    const m = /^(\d{2,4}) ([A-Z].*15KG.*)$/.exec(lineas[i]); if (!m) continue;
    const cajas = Number(m[1]); let precio = null;
    for (let j = i + 1; j < Math.min(i + 7, lineas.length); j++) { const p = /^(\d{1,2},\d{2})(?:\s|$)/.exec(lineas[j]); if (p && p[1] !== "1,00") { precio = Number(p[1].replace(",", ".")); break; } } // el "1,00" es la columna Lvh (unidad), no el precio
    bon.cajas += cajas; if (precio) bon.total += cajas * precio; else bon.sinPrecio++; bon.articulos.push({ cajas, articulo: m[2].trim(), precio });
  }
  return bon;
}
/** Hoja semanal de RRHH (scripts/informe-produccion/asistencias-semana_NN.xlsx o semana_NN.xlsx). */
function leerHojaRrhh() { return RRHH_CACHE; }
async function precargarRrhh() {
  const dir = "scripts/informe-produccion"; const nn = String(semana.semana);
  const cand = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /\.xlsx$/i.test(f) && new RegExp(`semana[_ -]?0?${nn}(\\D|$)`, "i").test(f)) : [];
  if (!cand.length) return;
  const ruta = path.join(dir, cand[0]); const w = new ExcelJS.Workbook(); await w.xlsx.readFile(ruta); const s = w.worksheets[0];
  const claveNombre = (x) => String(x ?? "").toUpperCase().replace(/[.,]/g, " ").replace(/\s+/g, " ").trim();
  const costePorNombre = new Map(trabajadores.map((t) => [claveNombre(t.nombre), t])); const noComputa = new Set(trabajadores.filter((t) => t.computa_kg_persona === false).map((t) => claveNombre(t.nombre)));
  const porDia = new Map(), porPersona = new Map(), sinFicha = new Set(); let pagadoHoras = 0;
  const cab = s.getRow(1).values.map((v) => String(v ?? "").toUpperCase()); const col = (re, def) => { const i = cab.findIndex((c) => re.test(c)); return i > 0 ? i : def; };
  const cNombre = col(/PRODUCTOR|NOMBRE|TRABAJADOR/, 1), cAct = col(/ACTIVIDAD/, 2), cFecha = col(/FECHA/, 3), cHN = col(/^HN$|H\.?\s*NORM/, 10), cHE = col(/^HE$|H\.?\s*EXTRA/, 13), cImp = col(/IMPORTE|PAGADO/, 17);
  for (let i = 2; i <= s.rowCount; i++) {
    const v = s.getRow(i).values; const nombre = claveNombre(v[cNombre]), act = String(v[cAct] ?? "").trim(); const fv = v[cFecha]; let fecha = null;
    if (fv instanceof Date) fecha = fechaLocalISO(fv); else { const m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(String(fv ?? "")); if (m) fecha = `${m[3]}-${m[2]}-${m[1]}`; }
    if (!nombre || !fecha || fecha < desde || fecha > hasta) continue;
    const horas = num(v[cHN]) + num(v[cHE]); if (horas < 1) continue; const pagado = num(v[cImp]);
    // Coste = horas reales × 9 €/h (media con Seguridad Social incluida, dato de Vadim 16-09-2026). Lo pagado por horas de la hoja se guarda solo como referencia.
    const coste = horas * COSTE_HORA_MEDIO_CON_SS, origen = `horas × ${COSTE_HORA_MEDIO_CON_SS} €/h (media con Seg. Social incluida)`; if (pagado > 0) pagadoHoras += pagado; void costePorNombre;
    const d = porDia.get(fecha) ?? { presentes: 0, computables: 0, horas: 0, coste: 0 }; d.presentes++; if (!noComputa.has(nombre)) d.computables++; d.horas += horas; d.coste += coste; porDia.set(fecha, d);
    const p = porPersona.get(nombre) ?? { nombre, actividad: act, dias: 0, horas: 0, coste: 0, origen }; p.dias++; p.horas += horas; p.coste += coste; porPersona.set(nombre, p);
  }
  if (!porDia.size) return;
  RRHH_CACHE = { archivo: cand[0], porDia, porPersona, sinFicha, pagadoHoras, horasTotal: sum([...porDia.values()], (d) => d.horas), costeTotal: sum([...porDia.values()], (d) => d.coste), mediaPresentes: (() => { const dp = [...porDia.entries()].filter(([f]) => (sizerPorDiaTmp[f] ?? 0) > 0 || (paletsPorDiaTmp[f]?.kg ?? 0) > 0); const base = dp.length ? dp : [...porDia.entries()]; return sum(base, ([, d]) => d.presentes) / base.length; })() };
}
function leerNotas() { const f = path.join(DIR_SALIDA, `notas-${ETIQ}.md`); return fs.existsSync(f) ? fs.readFileSync(f, "utf8").trim() : null; }
/** Último recuento físico guardado (outputs/analisis-semanal/recuento-AAAA-MM-DD.json). */
function leerRecuento() {
  if (!fs.existsSync(DIR_SALIDA)) return null;
  const fs_ = fs.readdirSync(DIR_SALIDA).filter((f) => /^recuento-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
  if (!fs_.length) return null;
  try { const j = JSON.parse(fs.readFileSync(path.join(DIR_SALIDA, fs_.at(-1)), "utf8")); return { fecha: fs_.at(-1).slice(9, 19), ...j }; } catch { return null; }
}

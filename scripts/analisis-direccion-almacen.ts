/**
 * analisis-direccion-almacen.ts — ¿hacia dónde conviene llevar el almacén?
 *
 * PARA QUÉ (16-09-2026, encargo de José María a través de Vadim). El dueño
 * quiere decidir en qué emplea a la gente del almacén y necesita, EN NÚMEROS:
 *   1. Qué deja cada formato de confección por kilo, una vez cobrado de verdad
 *      (descontando la comisión y el transporte del cliente), pagado el envase
 *      y pagada la gente que lo hace.
 *   2. Cuánta gente se come cada zona de trabajo: kg por persona y día MEDIDOS.
 *   3. Un suelo con el que medir el almacén día a día y una regla para decidir
 *      a qué zona mandar la naranja.
 *
 * DE DÓNDE SALE CADA COSA (nada se inventa; lo que no está sale como SIN DATO):
 *   - Kilos y euros por formato .... ERP: palets_cab.formula_confeccion (con qué
 *     formato se hizo cada palet) + espejo erp_palet de la app, que lleva el
 *     importe de la línea de venta. Campaña = 01-09-2025 a 31-08-2026.
 *   - Nombre del formato ........... ERP: agri_confeccion_cab (denominación y
 *     kilos de fruta del palet estándar).
 *   - Comisión y transporte ........ app: ventas_categoria_clientes_ajustes
 *     (la ficha por cliente de Comercial → Ventas por categoría).
 *   - Envase ....................... SOLO LA CAJA, que es el componente gordo:
 *     precio de la caja en stock_consumibles ÷ los kilos que lleva esa caja de
 *     verdad (kilos del palet ÷ cajas del palet, medido en los palets reales).
 *     Es una división sin trampa de unidades.
 *     LA FÓRMULA ENTERA DEL ERP (agri_confeccion_lineas) NO SE USA PARA COSTEAR:
 *     sus "unidades" no están todas referidas al palet estándar (la fórmula de
 *     la malla 5 kg pide 600 bandas y 300 mallas para un palet de 48 mallas) y
 *     hay precios en otra unidad (papel de seda al peso, fleje por bobina). Con
 *     eso salían costes de 37 €/kg. Queda como pendiente de arreglar, artículo a
 *     artículo, en la hoja «Lo que falta».
 *   - Envase completo de la malla .. app: empaque_precios (la ficha validada de
 *     la malla de Mercadona, 3 kg y 5 kg, con caja, malla, banda, etiqueta,
 *     palet, fleje y asa). Es el único envase que está cerrado del todo.
 *   - Kg por zona de trabajo ....... app: producto_dia (informe de producto del
 *     calibrador) clasificado con clasificarProductoInforme, el mismo criterio
 *     que usa el rendimiento por zonas de RRHH.
 *   - Personas por zona ............ app: asistencia_detalle (presente sí/no) +
 *     trabajadores.zona, agrupadas con grupoRendimientoTrabajador de la app.
 *     SOLO hay asistencia desde el 18-05-2026: el kg/persona se mide en esa
 *     ventana, no en toda la campaña.
 *   - Coste de la gente ............ 9,00 €/hora CON Seguridad Social incluida
 *     (Beatriz, 16-09-2026) × 8 horas de jornada = 72 € por persona y día.
 *   - Coste de la fruta ............ app: entradas_bascula de la campaña
 *     (importe_total = compra + recolección + transporte + comisión) ÷ kilos.
 *   - Suelo y objetivo de kg/persona  app: estandar_rendimiento (lo fijó el dueño
 *     el 27-08-2026).
 *
 * HORARIO — REGLA DE VADIM (16-09-2026): de 06:00 a 15:00 el ERP es de la
 * oficina. Este script lee palets_cab y las fórmulas enteras, así que se niega
 * a correr en esa franja salvo --forzar.
 *
 * SOLO LECTURA del ERP. No escribe nada en ninguna base: deja un Excel.
 *
 * Uso:  node node_modules/vite-node/vite-node.mjs scripts/analisis-direccion-almacen.ts
 *       opciones: --forzar  --desde=2025-09-01  --hasta=2026-08-31
 */
import fs from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";
import { createClient } from "@supabase/supabase-js";
import { conectarErp } from "./lib-palets-erp.mjs";
import { clasificarProductoInforme } from "../src/lib/asistenciaProductoClasificacion";
import { grupoRendimientoTrabajador } from "../src/lib/asistenciaRendimiento";

process.loadEnvFile(".env");
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a); return m ? [m[1], m[2] ?? true] : [a, true];
}));
const DESDE = String(args.desde ?? "2025-09-01");
const HASTA = String(args.hasta ?? "2026-08-31");
const E = "gdata001";
const COSTE_HORA = 9;                              // €/hora CON Seguridad Social (Beatriz, 16-09-2026)
const JORNADA_H = 8;                               // jornada base de la planta
const EUR_PERSONA_DIA = COSTE_HORA * JORNADA_H;    // 72 € por persona y día
const TOPE_LINEA_EUR_KG = 0.15;                    // por encima de esto el precio está en otra unidad que la fórmula
const HOY = new Date().toISOString().slice(0, 10);
const SALIDA = path.join("outputs", `Direccion_Almacen_${HOY}.xlsx`);

const hora = new Date().getHours();
if (hora >= 6 && hora < 15 && !args.forzar) {
  console.error(`Son las ${hora}:00. De 06:00 a 15:00 el ERP es de la oficina (regla de Vadim, 16-09-2026).`);
  console.error(`Lánzalo después de las 15:00, o con --forzar si sabes que la oficina no lo está usando.`);
  process.exit(1);
}
const log = (m: string) => console.error(`· ${m}`);
const num = (v: unknown) => Number(v) || 0;
const es = (n: number | null | undefined, d = 0) =>
  n == null || !Number.isFinite(n) ? "SIN DATO" : n.toLocaleString("es-ES", { minimumFractionDigits: d, maximumFractionDigits: d });

// ═══════════════════════════════════════════════════════════════ datos
const sb = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
/** PostgREST recorta a 1.000 filas en silencio: toda lectura pagina con un orden estable. */
async function todo(tabla: string, cols: string, filtro: (q: any) => any = (q) => q, orden = "id"): Promise<any[]> {
  const out: any[] = [];
  const paso = 1000;
  for (let d = 0; ; d += paso) {
    const { data, error } = await filtro(sb.from(tabla).select(cols)).order(orden, { ascending: true }).range(d, d + paso - 1);
    if (error) throw new Error(`${tabla}: ${error.message}`);
    out.push(...(data as any[]));
    if ((data as any[]).length < paso) break;
  }
  return out;
}

log("ERP: fórmulas de confección, palets de la campaña y material de cada fórmula…");
const erp = await conectarErp({ maxSegundos: 120 });
const [cabRaw] = await erp.query(`SELECT TRIM(formula) formula, denominacion, kilos_formula, confeccion FROM ${E}.agri_confeccion_cab`);
const [palFormula] = await erp.query(
  `SELECT numero, TRIM(formula_confeccion) f FROM ${E}.palets_cab
    WHERE fecha_creacion >= ? AND fecha_creacion < DATE_ADD(?, INTERVAL 1 DAY) AND num_cajas > 0`, [DESDE, HASTA]);
const [lineasRaw] = await erp.query(`SELECT TRIM(formula) formula, TRIM(articulo) articulo, unidades FROM ${E}.agri_confeccion_lineas`);
const [artRaw] = await erp.query(
  `SELECT TRIM(codigo) codigo, denominacion FROM ${E}.articulo_general
    WHERE codigo IN (SELECT DISTINCT articulo FROM ${E}.agri_confeccion_lineas)`);
await erp.end();
log(`ERP: ${cabRaw.length} fórmulas · ${palFormula.length} palets · ${lineasRaw.length} líneas de material`);

log("app: palets con su venta, ficha de cliente, producción por zona y asistencia…");
const [mirror, ajustes, consumibles, empaque, partes, prod, trab, asis, entradas, estandarRows] = await Promise.all([
  todo("erp_palet", "numero,fecha,kg_netos,num_cajas,importe_venta,cliente,cliente_codigo", (q: any) => q.gte("fecha", DESDE).lte("fecha", HASTA), "numero"),
  todo("ventas_categoria_clientes_ajustes", "cliente_codigo,cliente_nombre,comision_pct,comision_cent_kg,transporte_pct,transporte_cent_kg"),
  todo("stock_consumibles", "nombre,unidad,precio_unitario,erp_codigo,erp_factor,erp_codigo_extra,erp_factor_extra"),
  todo("empaque_precios", "tipo_malla,componente,precio_malla,vigente_desde,created_at"),
  todo("partes_diarios", "id,date", (q: any) => q.gte("date", DESDE).lte("date", HASTA)),
  todo("producto_dia", "part_id,producto,formato_caja,grupo_destino,linea,kg"),
  todo("trabajadores", "id,nombre,zona,activo,computa_kg_persona"),
  todo("asistencia_detalle", "date,trabajador_id,presente", (q: any) => q.gte("date", DESDE).lte("date", HASTA)),
  todo("entradas_bascula", "fecha,kg_entrada,importe_compra,importe_total", (q: any) => q.gte("fecha", DESDE).lte("fecha", HASTA)),
  todo("estandar_rendimiento", "corte_plantilla_reducida,completa_suelo,completa_objetivo,reducida_suelo,reducida_objetivo,decidido_por,fecha"),
]);
const estandar = estandarRows[0];

// ═══════════════════════════════════════════════ 1. kilos y euros por formato
const ficha = new Map<string, any>((cabRaw as any[]).map((f) => [f.formula, f]));
const formulaDe = new Map<string, string>((palFormula as any[]).map((p) => [String(p.numero), String(p.f ?? "")]));
const ajusteDe = new Map<string, any>(ajustes.map((a) => [String(a.cliente_codigo), a]));

const porFormula = new Map<string, any>();
let kgSinFormula = 0;
for (const p of mirror) {
  const f = formulaDe.get(String(p.numero));
  const kg = num(p.kg_netos);
  if (!f) { kgSinFormula += kg; continue; }
  const a = porFormula.get(f) ?? porFormula.set(f, {
    f, kg: 0, palets: 0, cajas: 0, eurBruto: 0, kgConPrecio: 0, descuento: 0, kgConFicha: 0, clientes: new Map<string, number>(),
  }).get(f);
  a.kg += kg; a.palets++; a.cajas += num(p.num_cajas);
  if (p.importe_venta == null) continue;
  const bruto = num(p.importe_venta);
  a.eurBruto += bruto; a.kgConPrecio += kg;
  const aj = ajusteDe.get(String(p.cliente_codigo));
  if (aj) {
    a.descuento += bruto * (num(aj.comision_pct) + num(aj.transporte_pct)) / 100
      + kg * (num(aj.comision_cent_kg) + num(aj.transporte_cent_kg)) / 100;
    a.kgConFicha += kg;
  }
  const clave = p.cliente ?? "(sin cliente)";
  a.clientes.set(clave, (a.clientes.get(clave) ?? 0) + kg);
}

// ═══════════════════════════════════════════════ 2. la caja de cada formato
// Solo la caja: precio de la caja ÷ kilos que lleva esa caja. No se expande la
// fórmula entera del ERP porque sus unidades no están todas por palet estándar.
const precioErp = new Map<string, any>();
for (const c of consumibles) {
  if (c.erp_codigo) precioErp.set(String(c.erp_codigo), c);
  if (c.erp_codigo_extra) precioErp.set(String(c.erp_codigo_extra), c);
}
const nombreArt = new Map<string, string>((artRaw as any[]).map((a) => [a.codigo, a.denominacion]));
const ES_CAJA = /\bcaja|\bbox\b|cajon|bandeja/i;
/** Cajas de pool (Logifruit, IFCO, EPS, CHEP, Prosol): no se compran, se pagan por uso.
 *  Lo que hay en stock de consumibles es el precio de la caja con su fianza, que vuelve:
 *  cargarlo como coste por palet multiplicaría el envase por diez. Van como SIN DATO. */
const ES_POOL = /logifruit|ifco|\beps\b|chep|prosol|pool/i;
const cajaDeFormula = new Map<string, { nombre: string; precio: number } | null>();
const cajaSinPrecio = new Map<string, string[]>();
for (const l of lineasRaw as any[]) {
  const f = String(l.formula), a = String(l.articulo);
  const nombreOficial = nombreArt.get(a) ?? a;
  if (!ES_CAJA.test(nombreOficial)) continue;
  const c = precioErp.get(a);
  if (ES_POOL.test(nombreOficial)) {
    cajaSinPrecio.set(f, [...(cajaSinPrecio.get(f) ?? []), `${nombreOficial} — caja de pool: se paga por uso, no se compra`]);
    continue;
  }
  if (c?.precio_unitario == null) {
    cajaSinPrecio.set(f, [...(cajaSinPrecio.get(f) ?? []), `${nombreOficial} — sin precio en el stock de consumibles`]);
    continue;
  }
  const actual = cajaDeFormula.get(f);
  const precio = num(c.precio_unitario);
  if (!actual || precio > actual.precio) cajaDeFormula.set(f, { nombre: c.nombre ?? nombreOficial, precio });
}
// Envase COMPLETO de la malla de Mercadona: la ficha validada de la app.
const empaqueMalla = new Map<string, { eurMalla: number; kgMalla: number; detalle: string }>();
{
  const vigente = new Map<string, any>();
  for (const e of empaque) {
    const k = `${e.tipo_malla}|${e.componente}`;
    const prev = vigente.get(k);
    if (!prev || e.vigente_desde > prev.vigente_desde || (e.vigente_desde === prev.vigente_desde && e.created_at > prev.created_at)) vigente.set(k, e);
  }
  for (const tipo of ["3kg", "5kg"]) {
    const comps = [...vigente.values()].filter((e) => e.tipo_malla === tipo);
    if (!comps.length) continue;
    empaqueMalla.set(tipo, {
      eurMalla: comps.reduce((s, c) => s + num(c.precio_malla), 0),
      kgMalla: Number(tipo.replace("kg", "")),
      detalle: comps.map((c) => `${c.componente} ${es(num(c.precio_malla), 4)}`).join(" + "),
    });
  }
}

// ═══════════════════════════════════════════════ 3. kg por zona y personas por zona
const fechaParte = new Map<string, string>(partes.map((p) => [p.id, p.date]));
type Zona = "Mallas" | "Graneleras" | "Envasado" | "Industria" | "Otros";
const ZONA_CERO = (): Record<Zona, number> => ({ Mallas: 0, Graneleras: 0, Envasado: 0, Industria: 0, Otros: 0 });
const kgZonaDia = new Map<string, Record<Zona, number>>();
for (const r of prod) {
  const f = fechaParte.get(r.part_id); if (!f) continue;
  const { zona, motivo } = clasificarProductoInforme(r as any);
  const z: Zona | null = zona === "Mesas" ? "Envasado"
    : zona === "Excluir" ? (motivo === "fuera_rendimiento" ? "Otros" : null)
    : (zona as Zona);
  if (!z) continue;                                   // filas TOTAL del informe: duplicarían el día
  const acc = kgZonaDia.get(f) ?? kgZonaDia.set(f, ZONA_CERO()).get(f)!;
  acc[z] += num(r.kg);
}
const FUERA = ["Oficina", "Segunda", "Carga y descarga"];
const grupoDe = new Map<string, string>();
for (const t of trab) {
  const g = grupoRendimientoTrabajador(t as any);
  grupoDe.set(t.id, g === "Envasadoras" ? "Envasado"
    : g ?? (FUERA.includes(String(t.zona)) ? "Fuera" : "Línea general"));
}
const persDia = new Map<string, Record<string, number>>();
for (const a of asis) {
  if (!a.presente) continue;
  const g = grupoDe.get(a.trabajador_id) ?? "Línea general";
  const acc = persDia.get(a.date) ?? persDia.set(a.date, {}).get(a.date)!;
  acc[g] = (acc[g] ?? 0) + 1;
}
const dias = [...persDia.keys()].filter((d) => kgZonaDia.has(d)).sort();
const sumP = (g: string) => dias.reduce((s, d) => s + (persDia.get(d)![g] ?? 0), 0);
const sumK = (z: Zona) => dias.reduce((s, d) => s + kgZonaDia.get(d)![z], 0);
const ZONAS = (["Mallas", "Graneleras", "Envasado", "Industria"] as const).map((zona) => ({
  zona, kg: sumK(zona), diasPersona: sumP(zona),
  kgPersonaDia: sumP(zona) ? sumK(zona) / sumP(zona) : null,
  diasConActividad: dias.filter((d) => kgZonaDia.get(d)![zona] > 0).length,
  mejorDia: Math.max(0, ...dias.map((d) => kgZonaDia.get(d)![zona])),
  personasMax: Math.max(0, ...dias.map((d) => persDia.get(d)![zona] ?? 0)),
}));
const kgPersonaZona = new Map<string, number>(ZONAS.filter((z) => z.kgPersonaDia).map((z) => [z.zona, z.kgPersonaDia!]));
const kgVentana = ZONAS.reduce((s, z) => s + z.kg, 0) + sumK("Otros");
const diasPersonaLinea = sumP("Línea general");
const arranqueEurKg = kgVentana ? (diasPersonaLinea * EUR_PERSONA_DIA) / kgVentana : null;

// plantilla de hoy, por zona
const plantilla = new Map<string, number>();
for (const t of trab) if (t.activo) plantilla.set(grupoDe.get(t.id)!, (plantilla.get(grupoDe.get(t.id)!) ?? 0) + 1);

// ═══════════════════════════════════════════════ 4. fruta
const kgEntrada = entradas.reduce((s, e) => s + num(e.kg_entrada), 0);
const kgConImporte = entradas.filter((e) => num(e.importe_total) > 0).reduce((s, e) => s + num(e.kg_entrada), 0);
const frutaEurKg = kgConImporte ? entradas.reduce((s, e) => s + num(e.importe_total), 0) / kgConImporte : null;

// ═══════════════════════════════════════════════ 5. una fila por formato
function zonaDeFormula(f: string) {
  const t = `${ficha.get(f)?.denominacion ?? ""} ${ficha.get(f)?.confeccion ?? ""}`.toUpperCase();
  if (/INDUSTRIA/.test(t)) return "Industria";
  if (/GIRSAC|D-PACK|DPACK|MALLA|C2C/.test(t)) return "Mallas";
  if (/GRANEL|GRANDEL|BOX/.test(t)) return "Graneleras";
  if (/EMPAQUETADO|EMP |ENCAJADO|MANTO|MAD|CARTON/.test(t)) return "Envasado";
  return "Sin clasificar";
}
const formatos = [...porFormula.values()].map((a) => {
  const fi = ficha.get(a.f);
  const zona = zonaDeFormula(a.f);
  const cobradoBruto = a.kgConPrecio ? a.eurBruto / a.kgConPrecio : null;
  const descuentoKg = a.kgConPrecio ? a.descuento / a.kgConPrecio : 0;
  const cobradoNeto = cobradoBruto == null ? null : cobradoBruto - descuentoKg;
  const kgp = kgPersonaZona.get(zona) ?? null;
  const personalKg = kgp ? EUR_PERSONA_DIA / kgp : null;
  const trasGente = cobradoNeto != null && personalKg != null ? cobradoNeto - personalKg : null;
  // envase: la malla de Mercadona lleva la ficha completa de la app; el resto, solo la caja
  const tipoMalla = /D-PACK 4 X 3|4 X 3 KG/.test(fi?.denominacion ?? "") ? "3kg"
    : /D-PACK 2 X 5|2 X 5 KG/.test(fi?.denominacion ?? "") ? "5kg" : null;
  const emp = tipoMalla ? empaqueMalla.get(tipoMalla) : null;
  const kgPorCaja = a.cajas ? a.kg / a.cajas : null;
  const caja = cajaDeFormula.get(a.f) ?? null;
  const envaseKg = emp ? emp.eurMalla / emp.kgMalla : caja && kgPorCaja ? caja.precio / kgPorCaja : null;
  const envaseQue = emp ? `envase COMPLETO de la malla ${tipoMalla}, ficha validada de la app: ${emp.detalle}`
    : caja && kgPorCaja ? `SOLO la caja: ${caja.nombre} a ${es(caja.precio, 4)} € ÷ ${es(kgPorCaja, 1)} kg que lleva de verdad. Faltan palet, fleje, etiquetas y, si la lleva, la malla: el envase real es algo mayor.`
    : `SIN DATO. ${(cajaSinPrecio.get(a.f) ?? []).join(" · ") || "la fórmula del ERP no dice qué caja lleva"}`;
  const trasCaja = trasGente != null && envaseKg != null ? trasGente - envaseKg : null;
  const clientes = [...(a.clientes as Map<string, number>).entries()].sort((x, y) => y[1] - x[1]);
  return {
    ...a, den: fi?.denominacion ?? "(sin ficha en el ERP)", kilosPalet: num(fi?.kilos_formula), zona,
    cobradoBruto, descuentoKg, cobradoNeto, kgp, personalKg, trasGente, envaseKg, envaseQue, envaseCompleto: !!emp, trasCaja, kgPorCaja,
    queda: trasGente,
    eurPersonaDia: trasGente != null && kgp ? trasGente * kgp : null,
    cliente: clientes[0]?.[0] ?? "(sin venta)",
    clientesTexto: clientes.slice(0, 3).map(([c, k]) => `${c} (${es(k)} kg)`).join(" · "),
    pctConFicha: a.kgConPrecio ? a.kgConFicha / a.kgConPrecio : 0,
  };
}).sort((x, y) => y.kg - x.kg);
const kgPaletizados = formatos.reduce((s, f) => s + f.kg, 0);

// ═══════════════════════════════════════════════ consola
console.error(`\nkg paletizados de la campaña: ${es(kgPaletizados)} (palets sin fórmula en el ERP: ${es(kgSinFormula)})`);
console.error(`ventana con asistencia: ${dias.length} días (${dias[0]} → ${dias.at(-1)})`);
for (const z of ZONAS) console.error(`  ${z.zona}: ${es(z.kg)} kg · ${z.diasPersona} días-persona · ${es(z.kgPersonaDia)} kg por persona y día`);
console.error(`  Línea general (arranque): ${diasPersonaLinea} días-persona = ${es(arranqueEurKg, 4)} €/kg sobre todo lo que pasa por la línea`);
console.error(`fruta: ${es(kgEntrada)} kg de entrada · ${es(frutaEurKg, 4)} €/kg puesta en el almacén`);

// ═══════════════════════════════════════════════ Excel
const libro = new ExcelJS.Workbook();
libro.creator = "Lasarte Cítricos S.L.";
const GRIS = "FFF2F2F2", VERDE = "FFE8F5E9", AMBAR = "FFFFF8E1", ROJO = "FFFFEBEE", CAB = "FF1B5E20";
function hoja(nombre: string, columnas: { header: string; key: string; width?: number; numFmt?: string }[]) {
  const h = libro.addWorksheet(nombre);
  h.columns = columnas.map((c) => ({ header: c.header, key: c.key, width: c.width ?? 16 }));
  h.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  h.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: CAB } };
  h.getRow(1).alignment = { vertical: "middle", wrapText: true };
  h.views = [{ state: "frozen", ySplit: 1 }];
  for (const c of columnas) if (c.numFmt) h.getColumn(c.key).numFmt = c.numFmt;
  return h;
}
function fila(h: ExcelJS.Worksheet, datos: Record<string, unknown>, color?: string) {
  const r = h.addRow(datos);
  if (color) r.fill = { type: "pattern", pattern: "solid", fgColor: { argb: color } };
  r.alignment = { vertical: "top", wrapText: true };
  return r;
}
function total(h: ExcelJS.Worksheet, datos: Record<string, unknown>) {
  const r = h.addRow(datos); r.font = { bold: true };
  r.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GRIS } };
  return r;
}

// ── Hoja 1: Para José María
const mallas = ZONAS.find((z) => z.zona === "Mallas")!, granel = ZONAS.find((z) => z.zona === "Graneleras")!, envas = ZONAS.find((z) => z.zona === "Envasado")!;
const hJ = hoja("Para José María", [
  { header: `Lasarte Cítricos S.L. · hacia dónde llevar el almacén (${HOY})`, key: "k", width: 52 },
  { header: "Dato", key: "v", width: 30 },
  { header: "Qué significa, con la cuenta escrita", key: "q", width: 118 },
]);
const eurDiaZona = (z: typeof mallas) => {
  const fs_ = formatos.filter((f) => f.zona === z.zona && f.eurPersonaDia != null && f.kg > 50000);
  const kg = fs_.reduce((s, f) => s + f.kg, 0);
  return kg ? fs_.reduce((s, f) => s + f.eurPersonaDia! * f.kg, 0) / kg : null;
};
fila(hJ, { k: "1. Lo que produce una persona en un día, según dónde la pongas", v: "", q: `Medido en los ${dias.length} días que tienen parte del calibrador Y asistencia apuntada, del ${dias[0]} al ${dias.at(-1)}. Kilos del informe de producto del calibrador ÷ días-persona presentes en esa zona.` }, GRIS);
for (const z of [mallas, granel, envas]) {
  fila(hJ, {
    k: `   ${z.zona}`, v: `${es(z.kgPersonaDia)} kg por persona y día`,
    q: `${es(z.kg)} kg hechos en esa zona ÷ ${z.diasPersona} días-persona presentes = ${es(z.kgPersonaDia)} kg. A 72 € por persona y día (9 €/h con Seguridad Social × 8 h), la mano de obra de esa zona cuesta 72 ÷ ${es(z.kgPersonaDia)} = ${es(z.kgPersonaDia ? EUR_PERSONA_DIA / z.kgPersonaDia : null, 4)} € por kilo.`,
  }, z.zona === "Envasado" ? ROJO : VERDE);
}
fila(hJ, { k: "   La comparación en una frase", v: `${mallas.kgPersonaDia && envas.kgPersonaDia ? es(mallas.kgPersonaDia / envas.kgPersonaDia, 1) : "SIN DATO"} veces`, q: `Una persona en mallas saca ${es(mallas.kgPersonaDia)} kg al día y en envasado ${es(envas.kgPersonaDia)} kg: ${es(mallas.kgPersonaDia && envas.kgPersonaDia ? mallas.kgPersonaDia / envas.kgPersonaDia : null, 1)} veces más. En graneleras, ${es(granel.kgPersonaDia)} kg.` }, VERDE);
fila(hJ, {});
fila(hJ, { k: "2. Lo que deja cada zona por persona y día, con todo pagado menos la fruta", v: "", q: "Precio cobrado de verdad (lo que factura el ERP menos la comisión y el transporte del cliente) − la caja − la gente de la zona, multiplicado por los kilos que saca una persona en un día. Solo formatos de más de 50 t en la campaña." }, GRIS);
for (const z of [mallas, granel, envas]) {
  const v = eurDiaZona(z);
  fila(hJ, { k: `   ${z.zona}`, v: `${es(v, 0)} € por persona y día`, q: `Media de los formatos grandes de la zona, ponderada por kilos. Es lo que esa persona deja en caja en una jornada para pagar la fruta y la casa. La fruta cuesta ${es(frutaEurKg, 4)} €/kg: a ${es(z.kgPersonaDia)} kg por persona y día, la fruta que mueve esa persona vale ${es((frutaEurKg ?? 0) * (z.kgPersonaDia ?? 0), 0)} €.` }, z.zona === "Envasado" ? ROJO : VERDE);
}
fila(hJ, { k: "   Lo que esto significa", v: "", q: `Con la gente de hoy, una jornada en mallas o en graneleras paga su fruta y sobra; una jornada en envasado deja ${es(eurDiaZona(envas), 0)} € para una fruta que cuesta ${es((frutaEurKg ?? 0) * (envas.kgPersonaDia ?? 0), 0)} €. Por eso el envasado, como norma, no se sostiene.` }, ROJO);
fila(hJ, {});
fila(hJ, { k: "3. Lo que cuesta la fruta, para comparar", v: `${es(frutaEurKg, 4)} € por kilo`, q: `${es(kgEntrada)} kg entrados en la campaña; el importe total de las entradas (compra + recolección + transporte + comisión) ÷ los kilos que tienen importe = ${es(frutaEurKg, 4)} €/kg puesta en el almacén. Fuente: entradas de báscula de la app.` });
fila(hJ, {});
fila(hJ, { k: "4. El caso más claro de todos: la misma fruta de segunda, dos formatos", v: "", q: "Las dos fórmulas MPF llevan la misma caja de plástico reutilizable del mismo proveedor y la misma fruta. La única diferencia es que una se llena a granel y la otra se coloca a mano en la caja." }, GRIS);
for (const f of formatos.filter((x) => ["LN211", "LN314"].includes(x.f))) {
  fila(hJ, {
    k: `   ${f.f} · ${f.den}`, v: `${es(f.trasCaja ?? f.queda, 4)} € por kilo`,
    q: `${es(f.kg)} kg en la campaña. Factura ${es(f.cobradoBruto, 4)} − comisión y transporte del cliente ${es(f.descuentoKg, 4)} = ${es(f.cobradoNeto, 4)} € que entran de verdad. Menos la gente ${es(f.personalKg, 4)} (zona ${f.zona}: ${es(f.kgp)} kg por persona y día) y menos la caja ${es(f.envaseKg, 4)} = ${es(f.trasCaja, 4)} € por kilo para la fruta y la casa. Una persona haciendo esto deja ${es(f.eurPersonaDia, 0)} € en una jornada antes del envase.`,
  }, f.zona === "Envasado" ? ROJO : VERDE);
}
const mpfG = formatos.find((f) => f.f === "LN211"), mpfE = formatos.find((f) => f.f === "LN314");
if (mpfG?.trasCaja != null && mpfE?.trasCaja != null) {
  const d = mpfG.trasCaja - mpfE.trasCaja;
  fila(hJ, { k: "   Diferencia", v: `${es(d, 4)} € por kilo`, q: `Colocar a mano esa fruta en vez de echarla a granel cuesta ${es(d, 4)} € por kilo: ${es(mpfE.personalKg! - mpfG.personalKg!, 4)} € de gente de más y ${es(mpfE.envaseKg! - mpfG.envaseKg!, 4)} € de caja de más, contra ${es(mpfE.cobradoNeto! - mpfG.cobradoNeto!, 4)} € que se cobra de más. Sobre los ${es(mpfE.kg)} kg que se hicieron a mano son ${es(d * mpfE.kg)} € en la campaña. Y además, al ritmo medido de la mesa, ocupó unas ${es(Math.round(mpfE.kg / (mpfE.kgp ?? 1)))} jornadas de persona que no estuvieron en mallas.` }, ROJO);
}
fila(hJ, {});
fila(hJ, { k: "5. Qué pasaría si esa gente estuviera en mallas", v: `${es(envas.diasPersona * (mallas.kgPersonaDia ?? 0))} kg`, q: `Los ${envas.diasPersona} días-persona que se gastaron en envasado, a los ${es(mallas.kgPersonaDia)} kg por persona y día de mallas, darían ${es(envas.diasPersona * (mallas.kgPersonaDia ?? 0))} kg en vez de los ${es(envas.kg)} kg que dieron. CUIDADO: esto solo vale si hay pedido de malla y si la malladora da abasto — la máquina tiene su tope (el mejor día de mallas fueron ${es(mallas.mejorDia)} kg).` }, AMBAR);
fila(hJ, {});
fila(hJ, { k: "6. La regla para medir el almacén cada día", v: `suelo ${es(estandar?.completa_suelo)} / objetivo ${es(estandar?.completa_objetivo)} kg por persona`, q: `Es el estándar que ya fijaste (${estandar?.decidido_por ?? "—"}, ${estandar?.fecha ?? "—"}): con más de ${estandar?.corte_plantilla_reducida} personas, suelo ${es(estandar?.completa_suelo)} y objetivo ${es(estandar?.completa_objetivo)} kg por persona; con ${estandar?.corte_plantilla_reducida} o menos, suelo ${es(estandar?.reducida_suelo)} y objetivo ${es(estandar?.reducida_objetivo)}. En la hoja «El suelo del almacén» está traducido a euros y a kilos al día.` });

// ── Hoja 2: Qué deja cada formato
const hF = hoja("Qué deja cada formato", [
  { header: "Fórmula del ERP", key: "f", width: 11 },
  { header: "Formato (nombre en el ERP)", key: "den", width: 42 },
  { header: "Zona que lo hace", key: "zona", width: 13 },
  { header: "Cliente principal", key: "cliente", width: 30 },
  { header: "Kg de la campaña", key: "kg", width: 13, numFmt: "#,##0" },
  { header: "% de los kilos", key: "pct", width: 9, numFmt: "0.0%" },
  { header: "€/kg que factura el ERP", key: "bruto", width: 11, numFmt: "0.0000" },
  { header: "€/kg de comisión y transporte del cliente", key: "desc", width: 11, numFmt: "0.0000" },
  { header: "€/kg que entran de verdad", key: "neto", width: 11, numFmt: "0.0000" },
  { header: "€/kg de la gente que lo hace", key: "pers", width: 11, numFmt: "0.0000" },
  { header: "€/kg que QUEDAN tras pagar la gente (antes del envase)", key: "queda", width: 13, numFmt: "0.0000" },
  { header: "€ que deja UNA PERSONA en UN DÍA haciendo esto (antes del envase)", key: "dia", width: 14, numFmt: "#,##0" },
  { header: "€/kg del envase que se ha podido calcular", key: "env", width: 11, numFmt: "0.0000" },
  { header: "€/kg que quedan tras la gente y ese envase", key: "trasCaja", width: 12, numFmt: "0.0000" },
  { header: "Qué envase se ha contado y qué falta", key: "estado", width: 72 },
]);
for (const f of formatos.filter((x) => x.kg >= 20000)) {
  const ref = f.trasCaja ?? f.queda;
  const color = ref == null ? GRIS : frutaEurKg != null && ref >= frutaEurKg ? VERDE : ref > 0 ? AMBAR : ROJO;
  fila(hF, {
    f: f.f, den: f.den, zona: f.zona, cliente: f.cliente, kg: Math.round(f.kg), pct: f.kg / kgPaletizados,
    bruto: f.cobradoBruto, desc: f.descuentoKg, neto: f.cobradoNeto, pers: f.personalKg, queda: f.queda,
    dia: f.eurPersonaDia == null ? null : Math.round(f.eurPersonaDia),
    env: f.envaseKg, trasCaja: f.trasCaja, estado: f.envaseQue,
  }, color);
}
total(hF, { f: "TOTAL", den: `${formatos.length} formatos usados en la campaña`, kg: Math.round(kgPaletizados), pct: 1, estado: `Palets sin fórmula de confección en el ERP (cítricas, precalibrado, box de industria): ${es(kgSinFormula)} kg, fuera de esta tabla.` });
fila(hF, { f: "Cómo leerlo", den: `Verde = lo que queda pasa de los ${es(frutaEurKg, 4)} €/kg que cuesta la fruta puesta en el almacén. Ámbar = queda algo, pero no llega a pagar esa fruta. Rojo = no cubre ni su gente ni su caja. Gris = falta algún dato.`, estado: "La columna que manda para decidir es «€ que deja UNA PERSONA en UN DÍA»: se calcula igual para todos los formatos (precio que entra de verdad − la gente) y por eso son comparables entre sí. El envase va aparte porque solo está cerrado del todo en la malla de Mercadona; en el resto es solo la caja, y las cajas de pool (Logifruit, IFCO, EPS, Chep, Prosol) van SIN DATO porque se pagan por uso y lo que hay guardado es el precio con fianza, que vuelve." }, GRIS);
fila(hF, { f: "Aviso", den: "Cada formato lleva la fruta que lleva: el granel de Mercadona se hace con fruta gorda y la segunda va a la caja de plástico. Esta tabla NO dice «cambia toda la malla a granel»; dice qué deja cada formato con la fruta que hoy le entra, y sobre todo qué pasa cuando la MISMA fruta puede ir por dos sitios.", estado: "" }, AMBAR);

// ── Hoja 3: La gente que come cada zona
const hZ = hoja("La gente de cada zona", [
  { header: "Zona de trabajo", key: "z", width: 18 },
  { header: "Personas en plantilla hoy", key: "hoy", width: 11 },
  { header: "Días con actividad (de los medidos)", key: "act", width: 11 },
  { header: "Días-persona gastados", key: "dp", width: 11 },
  { header: "Kg hechos", key: "kg", width: 13, numFmt: "#,##0" },
  { header: "Kg por persona y día", key: "kgp", width: 12, numFmt: "#,##0" },
  { header: "€ de mano de obra por kilo", key: "eur", width: 11, numFmt: "0.0000" },
  { header: "Día con más kilos de la zona", key: "max", width: 12, numFmt: "#,##0" },
  { header: "Qué es", key: "q", width: 100 },
]);
for (const z of ZONAS) {
  fila(hZ, {
    z: z.zona, hoy: plantilla.get(z.zona) ?? 0, act: z.diasConActividad, dp: z.diasPersona, kg: Math.round(z.kg),
    kgp: z.kgPersonaDia == null ? null : Math.round(z.kgPersonaDia),
    eur: z.kgPersonaDia == null ? null : EUR_PERSONA_DIA / z.kgPersonaDia,
    max: Math.round(z.mejorDia),
    q: z.zona === "Industria" ? "No tiene gente propia: la llena la línea. Sus kilos no llevan mano de obra directa."
      : z.zona === "Envasado" ? `Con ${z.personasMax} personas como mucho en un día. El día más gordo fueron ${es(z.mejorDia)} kg, pero CUIDADO: esta zona se lleva por defecto todo el producto del informe que no es malla, ni granel, ni industria, así que ese día puede llevar dentro producto que no se colocó a mano. La media de ${es(z.kgPersonaDia)} kg por persona sí es representativa, y si acaso se queda corta a favor del envasado.`
      : `Con ${z.personasMax} personas como mucho en un día. El día más gordo fueron ${es(z.mejorDia)} kg: ese es el techo PROBADO de la zona con la máquina y la gente de hoy (el tope real de máquina lo tiene que decir producción).`,
  }, z.zona === "Envasado" ? ROJO : z.zona === "Industria" ? GRIS : VERDE);
}
fila(hZ, { z: "Línea general (arranque)", hoy: plantilla.get("Línea general") ?? 0, dp: diasPersonaLinea, kg: Math.round(kgVentana), kgp: diasPersonaLinea ? Math.round(kgVentana / diasPersonaLinea) : null, eur: arranqueEurKg, q: "Volcador, punta, carretilleros, transpaletas, tría de podrido, encargadas, mantenimiento. Hay que ponerla se haga lo que se haga: su coste se reparte entre TODOS los kilos que pasan por la línea." }, AMBAR);
fila(hZ, { z: "Fuera del kg/persona", hoy: plantilla.get("Fuera") ?? 0, q: "Oficina, carga y descarga y la limpiadora de tardes: no entran en el kg por persona (decisión ya tomada en la app)." }, GRIS);
total(hZ, { z: "TOTAL PLANTILLA HOY", hoy: [...plantilla.values()].reduce((s, n) => s + n, 0), q: `Trabajadores con la ficha activa en la app el ${HOY}.` });
fila(hZ, { z: "De dónde sale", q: `Kilos: informe de producto del calibrador (producto_dia), clasificado con el mismo criterio que el rendimiento por zonas de RRHH. Personas: asistencia apuntada en la app, contando solo a los presentes. Ventana medida: ${dias.length} días, del ${dias[0]} al ${dias.at(-1)} (antes del 18-05-2026 no hay asistencia cargada).` }, GRIS);

// ── Hoja 4: El suelo del almacén
const kgDiaMedio = dias.length ? kgVentana / dias.length : 0;
const personasDiaMedia = dias.length ? dias.reduce((s, d) => s + Object.entries(persDia.get(d)!).filter(([g]) => g !== "Fuera").reduce((t, [, n]) => t + n, 0), 0) / dias.length : 0;
const costeDiaMedio = personasDiaMedia * EUR_PERSONA_DIA;
const hS = hoja("El suelo del almacén", [
  { header: "Qué se mide", key: "k", width: 44 },
  { header: "Número", key: "v", width: 22 },
  { header: "Cómo se calcula y qué hacer con él", key: "q", width: 120 },
]);
fila(hS, { k: "LO QUE YA ESTÁ DECIDIDO (no lo cambio, lo traduzco)", v: "", q: `Estándar de kg por persona fijado por ${estandar?.decidido_por ?? "—"} el ${estandar?.fecha ?? "—"}.` }, GRIS);
fila(hS, { k: `Plantilla de más de ${estandar?.corte_plantilla_reducida} personas`, v: `suelo ${es(estandar?.completa_suelo)} · objetivo ${es(estandar?.completa_objetivo)} kg/persona`, q: `Con ${es(estandar?.completa_suelo)} kg por persona, la gente cuesta 72 ÷ ${es(estandar?.completa_suelo)} = ${es(EUR_PERSONA_DIA / num(estandar?.completa_suelo), 4)} € por kilo. En el objetivo, ${es(EUR_PERSONA_DIA / num(estandar?.completa_objetivo), 4)} € por kilo.` });
fila(hS, { k: `Plantilla de ${estandar?.corte_plantilla_reducida} personas o menos`, v: `suelo ${es(estandar?.reducida_suelo)} · objetivo ${es(estandar?.reducida_objetivo)} kg/persona`, q: `Con ${es(estandar?.reducida_suelo)} kg por persona la gente cuesta ${es(EUR_PERSONA_DIA / num(estandar?.reducida_suelo), 4)} € por kilo; en el objetivo, ${es(EUR_PERSONA_DIA / num(estandar?.reducida_objetivo), 4)} €.` });
fila(hS, {});
fila(hS, { k: "LO QUE SE ESTÁ HACIENDO DE VERDAD", v: "", q: `Medido en los ${dias.length} días con parte y con asistencia (del ${dias[0]} al ${dias.at(-1)}).` }, GRIS);
fila(hS, { k: "Kilos que pasan por la línea al día", v: `${es(kgDiaMedio)} kg`, q: `${es(kgVentana)} kg ÷ ${dias.length} días.` });
fila(hS, { k: "Personas al día (las que cuentan)", v: `${es(personasDiaMedia, 1)} personas`, q: "Presentes cada día, sin oficina ni carga y descarga." });
fila(hS, { k: "Kilos por persona y día", v: `${es(personasDiaMedia ? kgDiaMedio / personasDiaMedia : null)} kg`, q: `${es(kgDiaMedio)} ÷ ${es(personasDiaMedia, 1)}. Comparado con el suelo de arriba es el semáforo del día.` });
fila(hS, { k: "Lo que cuesta un día de almacén, solo en gente", v: `${es(costeDiaMedio)} €`, q: `${es(personasDiaMedia, 1)} personas × 72 € (9 €/h con Seguridad Social × 8 h).` });
const diasBajoSuelo = dias.filter((d) => {
  const p = Object.entries(persDia.get(d)!).filter(([g]) => g !== "Fuera").reduce((t, [, n]) => t + n, 0);
  const k = Object.values(kgZonaDia.get(d)!).reduce((t, n) => t + n, 0);
  return p > 0 && k / p < (p <= num(estandar?.corte_plantilla_reducida) ? num(estandar?.reducida_suelo) : num(estandar?.completa_suelo));
}).length;
fila(hS, { k: "Días por debajo del suelo", v: `${diasBajoSuelo} de ${dias.length}`, q: `Uno de cada ${dias.length && diasBajoSuelo ? es(dias.length / diasBajoSuelo, 1) : "—"} días el almacén no llegó al suelo que tú mismo pusiste.` }, diasBajoSuelo > dias.length / 4 ? ROJO : AMBAR);
fila(hS, {});
fila(hS, { k: "EL SEGUNDO TERMÓMETRO: euros de margen por persona y día", v: "", q: "El kg/persona dice si se corre. Esto dice si se corre donde hay que correr: dos días con el mismo kg/persona dejan dinero muy distinto según en qué zona esté la gente." }, GRIS);
for (const z of [mallas, granel, envas]) fila(hS, { k: `   Una persona en ${z.zona}`, v: `${es(eurDiaZona(z), 0)} € de margen al día`, q: `${es(z.kgPersonaDia)} kg × ${es(eurDiaZona(z) && z.kgPersonaDia ? eurDiaZona(z)! / z.kgPersonaDia! : null, 4)} € que deja el kilo tras pagar a esa persona.` }, z.zona === "Envasado" ? ROJO : VERDE);
const margenDia = ZONAS.reduce((s, z) => { const v = eurDiaZona(z as any); return s + (v != null && z.kgPersonaDia ? (z.kg / dias.length) * (v / z.kgPersonaDia) : 0); }, 0);
fila(hS, { k: "   Toda la planta, tal y como está hoy", v: `${es(personasDiaMedia ? margenDia / personasDiaMedia : null, 0)} € por persona y día`, q: `${es(margenDia)} € de margen al día ÷ ${es(personasDiaMedia, 1)} personas. Subir este número es el objetivo: se sube moviendo gente de envasado a mallas y graneleras, no corriendo más en la mesa.` }, AMBAR);
fila(hS, {});
fila(hS, { k: "EL SUELO EN EUROS: cuántos kilos hay que mover para no perder", v: "", q: "Un día de almacén se paga con lo que dejan los kilos que salen. Con la mezcla de hoy, esto es lo que hace falta." }, GRIS);
const quedaMedio = (() => {
  const con = formatos.filter((f) => f.queda != null && f.kg > 50000);
  const kg = con.reduce((s, f) => s + f.kg, 0);
  return kg ? con.reduce((s, f) => s + f.queda! * f.kg, 0) / kg : null;
})();
fila(hS, { k: "Lo que deja de media un kilo que sale (ya pagada la gente, antes del envase)", v: `${es(quedaMedio, 4)} € por kilo`, q: "Media de los formatos de más de 50 t, ponderada por kilos. De aquí tienen que salir la fruta, el envase y la estructura de la casa." });
fila(hS, { k: "Margen que deja un kilo por encima de la fruta", v: `${es(quedaMedio != null && frutaEurKg != null ? quedaMedio - frutaEurKg : null, 4)} € por kilo`, q: `${es(quedaMedio, 4)} € que deja el kilo − ${es(frutaEurKg, 4)} € que cuesta la fruta. Es lo que va quedando para el envase y para la casa.` });
fila(hS, { k: "Kilos al día que hacen falta solo para pagar la fruta y la gente", v: frutaEurKg != null && quedaMedio != null && quedaMedio > frutaEurKg ? `${es(costeDiaMedio / (quedaMedio - frutaEurKg))} kg` : "no salen las cuentas con la mezcla de hoy", q: frutaEurKg != null && quedaMedio != null ? `${es(costeDiaMedio)} € que cuesta la gente de un día ÷ ${es(quedaMedio - frutaEurKg, 4)} € de margen por kilo. Por debajo de ahí, el día no se paga solo. Ojo: es un suelo de MÍNIMOS — todavía no lleva dentro el envase ni la estructura de la casa.` : "SIN DATO" }, AMBAR);
fila(hS, {});
fila(hS, { k: "LO QUE FALTA PARA CERRAR EL SUELO DEL TODO", v: "", q: "" }, GRIS);
fila(hS, { k: "Estructura de la casa (luz, alquiler, seguros, amortizaciones, oficina)", v: "SIN DATO en la app", q: "El módulo Económico → CMV tiene cinco partidas mensuales y solo una cargada (suministros). Mientras no estén, este suelo cubre fruta y gente, no la casa entera. El forfait viejo del Departamento de Control (0,1598 €/kg de almacén, campaña 17-18) es de hace ocho años y no se usa aquí para no mezclar." }, ROJO);

// ── Hoja 5: La regla del desvío
const hR = hoja("La regla del desvío", [
  { header: "Situación", key: "k", width: 40 },
  { header: "Qué se hace con la naranja", key: "v", width: 40 },
  { header: "Por qué, con el número delante", key: "q", width: 118 },
]);
const umbralEnvasado = (() => {
  const e = kgPersonaZona.get("Envasado"), refDia = eurDiaZona(granel);
  return e && refDia != null ? refDia / e + (kgPersonaZona.get("Envasado") ? EUR_PERSONA_DIA / kgPersonaZona.get("Envasado")! : 0) : null;
})();
const extraGenteMesa = kgPersonaZona.get("Envasado") && kgPersonaZona.get("Graneleras")
  ? EUR_PERSONA_DIA / kgPersonaZona.get("Envasado")! - EUR_PERSONA_DIA / kgPersonaZona.get("Graneleras")! : null;
fila(hR, { k: "SITUACIÓN A · hay pedido de malla o de granel sin cubrir", v: "Nadie en mesas. Todo a mallas y graneleras.", q: `Una persona deja ${es(eurDiaZona(mallas), 0)} € al día en mallas y ${es(eurDiaZona(granel), 0)} € en graneleras, contra ${es(eurDiaZona(envas), 0)} € en envasado. Cada jornada que se pone en una mesa teniendo malla o granel sin servir cuesta ${es((eurDiaZona(granel) ?? 0) - (eurDiaZona(envas) ?? 0), 0)} €. Con eso no hay precio de papel que compense: para empatar, el pedido de mesa tendría que dejar ${es(umbralEnvasado, 2)} € por kilo, y el formato mejor pagado de toda la campaña se queda en ${es(Math.max(...formatos.filter((f) => f.cobradoNeto != null && f.kg > 50000).map((f) => f.cobradoNeto!)), 2)} €.` }, VERDE);
fila(hR, { k: "SITUACIÓN B · malla y granel llenos, y sobra gente", v: "Mesa solo si el papel paga la mesa", q: `Aquí la gente ya está pagada, así que la pregunta es otra: ¿paga el papel más que mandar ESA MISMA fruta a granel? La mesa cuesta ${es(extraGenteMesa, 4)} € por kilo más de mano de obra que la granelera, y su caja suele costar más. Regla: el papel tiene que pagar al menos ${es(extraGenteMesa, 2)} € por kilo POR ENCIMA del granel equivalente. En el caso MPF de la campaña, el papel pagó ${es(mpfE && mpfG ? mpfE.cobradoNeto! - mpfG.cobradoNeto! : null, 4)} € más por kilo y la mesa costó ${es(mpfE && mpfG ? mpfE.personalKg! - mpfG.personalKg! : null, 4)} € más: no llegaba ni de lejos.` }, AMBAR);
fila(hR, { k: "SITUACIÓN C · el día va por debajo del suelo de kg/persona", v: "Lo primero que se para es la mesa", q: `Bajar de ${es(estandar?.completa_suelo)} kg por persona (o ${es(estandar?.reducida_suelo)} con plantilla corta) casi siempre es que hay gente colocando a mano lo que podría ir a granel o a malla. Cerrar una mesa sube el kg/persona del día entero.` }, AMBAR);
fila(hR, { k: "SITUACIÓN D · fruta que no vale para malla ni para granel", v: "Industria, sin pasarla por mesa", q: "La industria no lleva mano de obra propia (la llena la línea). Colocar a mano fruta que va a acabar en zumo es el gasto más caro que hay." });
fila(hR, {});
fila(hR, { k: "EL MATIZ DE LA SEGUNDA", v: "vender segunda barata NO es perder dinero", q: `En la tabla de formatos, la segunda (las fórmulas MPF) queda por debajo de los ${es(frutaEurKg, 4)} €/kg que cuesta la fruta de media. Eso NO quiere decir que haya que dejar de venderla: esa fruta ya está comprada y la alternativa es la industria, que paga bastante menos. Lo que sí dice el número es POR QUÉ FORMATO sacarla: a granel, no colocada a mano. El precio al que se vende la industria no está en la app y haría falta para cerrar esta cuenta.` }, AMBAR);
fila(hR, {});
fila(hR, { k: "LO QUE ESTA REGLA NO SABE", v: "", q: "" }, GRIS);
fila(hR, { k: "El tope de la máquina", v: `Mejor día de mallas: ${es(mallas.mejorDia)} kg`, q: "Mandar más fruta a malla solo funciona hasta donde dé la malladora. Por encima de ese tope, la alternativa a la mesa es el granel, no la malla." });
fila(hR, { k: "El pedido del cliente", v: "manda sobre todo lo anterior", q: "Mercadona pide malla y granel en el formato que quiere; un cliente de exportación pide su caja. Esta regla dice qué conviene, no lo que se puede vender." });
fila(hR, { k: "La calidad de la fruta", v: "manda sobre todo lo anterior", q: "Un calibre o una clase solo entra donde la admiten. La regla se aplica dentro de lo que la fruta permite." });

// ── Hoja 6: Cómo se ha calculado
const hC = hoja("Cómo se ha calculado", [
  { header: "Dato", key: "k", width: 38 }, { header: "Fuente exacta", key: "v", width: 54 }, { header: "Método y avisos", key: "q", width: 110 },
]);
const C = (k: string, v: string, q: string, color?: string) => fila(hC, { k, v, q }, color);
C("Periodo de los euros y los kilos", `Campaña ${DESDE} → ${HASTA}`, `${es(kgPaletizados)} kg paletizados en ${formatos.reduce((s, f) => s + f.palets, 0)} palets.`);
C("Con qué formato se hizo cada palet", "ERP · palets_cab.formula_confeccion", `${es(kgSinFormula)} kg de palets no tienen fórmula en el ERP y quedan fuera de la tabla de formatos.`);
C("Nombre y kilos del palet estándar", "ERP · agri_confeccion_cab", "La denominación que se ve en la tabla es la del propio ERP, sin tocar.");
C("Euros de venta", "app · erp_palet.importe_venta (espejo de la línea de venta del ERP)", "Un palet sin importe es que todavía no está valorado: no cuenta ni en los kilos ni en los euros del precio medio.");
C("Comisión y transporte por cliente", "app · Comercial → Ventas por categoría (ficha del cliente)", `Hay ficha para el ${es(mirror.filter((p) => ajusteDe.has(String(p.cliente_codigo))).reduce((s, p) => s + num(p.kg_netos), 0) / mirror.reduce((s, p) => s + num(p.kg_netos), 0) * 100)} % de los kilos. Al resto no se le descuenta nada: su precio sale un poco más alto de lo real.`, AMBAR);
C("Envase", "precio de la caja en stock_consumibles ÷ kilos que lleva esa caja", `La fórmula entera del ERP NO se usa para costear: sus unidades no están todas por palet estándar (la fórmula de la malla 5 kg pide 600 bandas y 300 mallas para un palet de 48 mallas) y hay precios en otra unidad (papel de seda al peso, fleje por bobina). Expandiéndola salían costes de 37 €/kg. Aquí solo se cuenta la CAJA, dividiendo su precio entre los kilos que lleva de verdad. La malla 3 kg y 5 kg de Mercadona sí llevan el envase completo, de la ficha validada de la app.`, AMBAR);
C("Lo que eso implica", "el envase de las cajas está infravalorado", "Faltan palet, fleje, etiquetas y papel. Cuando se calculen, restarán MÁS a los formatos de caja que a la malla (que ya va completa): la diferencia a favor de malla y granel será mayor que la que sale aquí, nunca menor.", AMBAR);
C("Kilos por zona de trabajo", "app · producto_dia (informe de producto del calibrador)", "Clasificado con clasificarProductoInforme, el mismo criterio del rendimiento por zonas de RRHH. Las filas TOTAL del informe se descartan porque duplicarían el día.");
C("Personas por zona", "app · asistencia_detalle + trabajadores.zona", `Solo hay asistencia desde el 18-05-2026: los kg por persona se miden en ${dias.length} días (${dias[0]} → ${dias.at(-1)}), no en toda la campaña.`, AMBAR);
C("Coste de la gente", "9,00 €/hora CON Seguridad Social × 8 horas = 72 €/persona y día", "Lo fijó Beatriz el 16-09-2026 e igual para todas las fichas. Es PROVISIONAL hasta que entren las nóminas reales por persona.", AMBAR);
C("Coste de la fruta", "app · entradas de báscula de la campaña", `${es(kgEntrada)} kg; importe total (compra + recolección + transporte + comisión) ÷ kilos con importe = ${es(frutaEurKg, 4)} €/kg.`);
C("Suelo y objetivo de kg/persona", "app · estándar de rendimiento", `Lo fijó ${estandar?.decidido_por ?? "—"} el ${estandar?.fecha ?? "—"}. Aquí no se cambia: se traduce a euros.`);

// ── Hoja 7: Lo que falta
const hP = hoja("Lo que falta", [{ header: "Prioridad", key: "p", width: 10 }, { header: "Qué falta", key: "a", width: 46 }, { header: "Qué se gana arreglándolo", key: "d", width: 120 }]);
fila(hP, { p: "ALTA", a: "La fórmula de confección del ERP, artículo a artículo", d: `Hoy no se puede sacar el coste de envase de un formato multiplicando la fórmula por los precios: las "unidades" de agri_confeccion_lineas no están todas referidas al palet estándar (la malla 5 kg pide 600 bandas y 300 mallas para un palet de 48 mallas) y varios precios están en otra unidad (papel de seda al peso, fleje por bobina, caja de pool por lote). Salían costes de 37 €/kg. Por eso aquí solo se cuenta la caja. De los ${formatos.filter((f) => f.kg >= 20000).length} formatos grandes, solo ${formatos.filter((f) => f.kg >= 20000 && f.envaseCompleto).length} (la malla de Mercadona) tienen el envase completo. Arreglarlo = poder poner precio de verdad a cada confección.` }, ROJO);
fila(hP, { p: "ALTA", a: "El coste real de la estructura de la casa", d: "Económico → CMV tiene cinco partidas mensuales y solo suministros cargada. Sin personal real de nómina, transporte de salida y estructura, el suelo cubre fruta y gente, pero no dice a partir de qué kilo gana dinero la empresa entera." }, ROJO);
fila(hP, { p: "MEDIA", a: "Asistencia de toda la campaña", d: "Solo hay apuntada desde el 18-05-2026. Con la campaña entera, el kg por persona de cada zona se mediría también en plena Navelina, no solo en Valencia y Midknight." }, AMBAR);
fila(hP, { p: "MEDIA", a: "Ficha de comisión y transporte de todos los clientes", d: "Al que no la tiene no se le descuenta nada y su precio sale más alto de lo que de verdad entra en caja." }, AMBAR);
fila(hP, { p: "BAJA", a: "El tope real de la malladora y de la granelera", d: "Aquí se usa el mejor día medido como techo. Si producción dice el tope de máquina de verdad, la cuenta de «cuánta gente cabe en cada zona» se cierra sola." }, GRIS);

libro.worksheets.splice(libro.worksheets.indexOf(hJ), 1); libro.worksheets.unshift(hJ);
fs.mkdirSync("outputs", { recursive: true });
await libro.xlsx.writeFile(SALIDA);
console.error(`\nExcel: ${SALIDA}`);


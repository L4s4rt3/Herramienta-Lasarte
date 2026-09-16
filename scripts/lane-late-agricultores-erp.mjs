/**
 * Excel de agricultores de una variedad (por defecto Lane Late) leído del ERP.
 *
 * Qué saca, por campaña (septiembre → agosto):
 *   - Hoja "Agricultores <campaña>": una fila por agricultor con sus entradas,
 *     kilos de báscula, dinero de compra, precio medio, y si tiene contrato de
 *     COMPRA (tipo 9) y/o de RECOLECCIÓN (tipo 8) de esa variedad. Con filtro
 *     automático en la cabecera y ordenada por kilos.
 *   - Hoja "Fincas <campaña>": lo mismo desglosado por finca.
 *   - Hoja "Entradas <campaña>": el detalle, una fila por pesada de báscula.
 *   - Hoja "Cómo leer": qué es cada columna y de dónde sale.
 *
 * Fuente: MySQL del ERP (solo SELECT). Tablas: basculas_pesadas (tipo_dcmto 25),
 * ent_prov_lineas / ent_prov_cab_alb / ent_prov_lin_imp, terceros_proveedores,
 * agricultura_fincas, articulo_general, compras_contratos_cab/_lin.
 *
 * Uso:
 *   node scripts/lane-late-agricultores-erp.mjs                 → outputs/Agricultores_Lane_Late_<fecha>.xlsx
 *   node scripts/lane-late-agricultores-erp.mjs --enviar        → además lo manda por correo (Resend)
 *   node scripts/lane-late-agricultores-erp.mjs --variedad="NAVELINA" --campanas=2025,2024
 *   node scripts/lane-late-agricultores-erp.mjs --para=alguien@lasartesat.es
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";
import { conectarErp } from "./lib-palets-erp.mjs";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.loadEnvFile(path.join(RAIZ, ".env"));

const EMPRESA = "gdata001";
const TIPO_DCMTO_ENTRADA_FRUTA = 25;
const TIPO_ENTRADA_PRECALIBRADO = 23;

const arg = (nombre, defecto) => {
  const a = process.argv.find((x) => x.startsWith(`--${nombre}=`));
  return a ? a.slice(nombre.length + 3) : defecto;
};
const VARIEDAD = arg("variedad", "LANE LATE").toUpperCase();
const CAMPANAS = arg("campanas", "2025,2024").split(",").map((s) => Number(s.trim())).filter(Boolean);
const ENVIAR = process.argv.includes("--enviar");
const PARA = arg("para", "soporte@lasartesat.es").split(",").map((s) => s.trim()).filter(Boolean);

const etiquetaCampana = (c) => `${c}/${String(c + 1).slice(2)}`;
const inicioCampana = (c) => `${c}-09-01`;
const finCampana = (c) => `${c + 1}-08-31`;

// -------------------------------------------------------------- consultas ERP
// Misma receta que sincronizar-entradas-erp.mjs (subconsultas para no duplicar
// filas), filtrada por la denominación del artículo de la línea 1 de la entrada.
const SQL_ENTRADAS = `
  SELECT DATE(bp.fecha)                AS fecha,
         bp.lote                       AS lote,
         bp.num_dcmto_relacionado      AS num_entrada,
         bp.tercero                    AS num_proveedor,
         tp.razon_social               AS agricultor,
         af.denominacion               AS finca,
         ag.denominacion               AS articulo,
         cab.tipo_entrada              AS tipo_entrada,
         bp.kilos                      AS kg,
         (SELECT SUM(i.importe_bruto)
            FROM ${EMPRESA}.ent_prov_lin_imp i
           WHERE i.num_entrada = bp.num_dcmto_relacionado)   AS importe_compra,
         (SELECT i.precio_compra
            FROM ${EMPRESA}.ent_prov_lin_imp i
           WHERE i.num_entrada = bp.num_dcmto_relacionado
           ORDER BY i.num_linea LIMIT 1)                     AS precio_compra_kg
    FROM ${EMPRESA}.basculas_pesadas bp
    LEFT JOIN ${EMPRESA}.ent_prov_lineas  epl ON epl.num_entrada = bp.num_dcmto_relacionado AND epl.num_linea = 1
    LEFT JOIN ${EMPRESA}.ent_prov_cab_alb cab ON cab.num_entrada = bp.num_dcmto_relacionado
    LEFT JOIN ${EMPRESA}.terceros_proveedores tp ON tp.num_proveedor = bp.tercero
    LEFT JOIN ${EMPRESA}.agricultura_fincas   af ON af.finca = bp.zona_origen AND af.num_proveedor = bp.tercero
    LEFT JOIN ${EMPRESA}.articulo_general     ag ON ag.codigo = epl.articulo
   WHERE bp.tipo_dcmto = ${TIPO_DCMTO_ENTRADA_FRUTA}
     AND bp.fecha >= ? AND bp.fecha <= ?
     AND UPPER(ag.denominacion) LIKE ?
   ORDER BY bp.fecha, bp.orden`;

// Contratos de la variedad en la campaña: tipo 9 = COMPRA de la fruta,
// tipo 8 = RECOLECCIÓN (la cuadrilla de Lasarte corta la fruta y se cobra por kg).
const SQL_CONTRATOS = `
  SELECT c.num_proveedor, c.tipo_contrato, c.fecha_contrato, c.num_contrato, c.serie_contrato,
         c.provincia_carga AS finca_codigo, af.denominacion AS finca,
         l.precio_compra, ag.denominacion AS articulo
    FROM ${EMPRESA}.compras_contratos_cab c
    -- OJO: el número de contrato se repite entre tipos (el 1174 existe como
    -- compra de un agricultor y como recolección de otro). Sin tipo_contrato y
    -- num_proveedor en el JOIN se mezclan líneas de contratos ajenos.
    JOIN ${EMPRESA}.compras_contratos_lin l ON l.num_contrato = c.num_contrato AND l.serie_contrato = c.serie_contrato
                                            AND l.tipo_contrato = c.tipo_contrato AND l.num_proveedor = c.num_proveedor
    JOIN ${EMPRESA}.articulo_general ag ON ag.codigo = l.articulo
    LEFT JOIN ${EMPRESA}.agricultura_fincas af ON af.finca = c.provincia_carga AND af.num_proveedor = c.num_proveedor
   WHERE c.tipo_contrato IN (8, 9)
     AND c.fecha_contrato >= ? AND c.fecha_contrato <= ?
     AND UPPER(ag.denominacion) LIKE ?
   ORDER BY c.num_proveedor, c.tipo_contrato, c.fecha_contrato`;

const num = (v) => (v === null || v === undefined || v === "" ? null : Number(v));
const txt = (v) => String(v ?? "").trim();
const esPrecalibrado = (e) => Number(e.tipo_entrada) === TIPO_ENTRADA_PRECALIBRADO || /PRECALIBRADO/i.test(e.agricultor) || /PRE ?C?[12]\b|PRECALIBRADO/i.test(e.articulo);

async function leerCampana(conn, campana) {
  const patron = `%${VARIEDAD}%`;
  const [entradas] = await conn.query(SQL_ENTRADAS, [inicioCampana(campana), finCampana(campana), patron]);
  const [contratos] = await conn.query(SQL_CONTRATOS, [inicioCampana(campana), finCampana(campana), patron]);
  return {
    campana,
    entradas: entradas.map((r) => ({
      fecha: txt(r.fecha), lote: txt(r.lote), num_entrada: txt(r.num_entrada), num_proveedor: txt(r.num_proveedor),
      agricultor: txt(r.agricultor) || "(sin nombre en el ERP)", finca: txt(r.finca) || "(sin finca)", articulo: txt(r.articulo),
      tipo_entrada: num(r.tipo_entrada), kg: num(r.kg) ?? 0, importe_compra: num(r.importe_compra), precio_compra_kg: num(r.precio_compra_kg),
    })),
    contratos: contratos.map((r) => ({
      num_proveedor: txt(r.num_proveedor), tipo: Number(r.tipo_contrato), fecha: txt(r.fecha_contrato), num: `${txt(r.serie_contrato)}${txt(r.num_contrato)}`,
      finca: txt(r.finca) || txt(r.finca_codigo), precio: num(r.precio_compra), articulo: txt(r.articulo),
    })),
  };
}

// ------------------------------------------------------------------ agregado
function agrupar(filas, clave) {
  const m = new Map();
  for (const f of filas) {
    const k = clave(f);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(f);
  }
  return m;
}

function resumenContratos(contratos, numProveedor) {
  const propios = contratos.filter((c) => c.num_proveedor === numProveedor);
  const compra = propios.filter((c) => c.tipo === 9 && c.precio != null && c.precio > 0);
  // Un contrato de recolección A 0 € significa que el agricultor entrega la
  // fruta cortada por su cuenta (Gesfrumed, Seasoncrops…): NO cortamos nosotros.
  // Solo cuenta como "cortamos" el contrato tipo 8 con tarifa mayor que 0.
  const recol = propios.filter((c) => c.tipo === 8 && c.precio != null && c.precio > 0);
  const recolCero = propios.filter((c) => c.tipo === 8 && !(c.precio > 0));
  const rango = (xs) => {
    const ps = xs.map((c) => c.precio).filter((p) => p != null && p > 0);
    if (ps.length === 0) return null;
    const mn = Math.min(...ps), mx = Math.max(...ps);
    return mn === mx ? mn : `${mn.toFixed(3)} a ${mx.toFixed(3)}`;
  };
  return {
    tieneCompra: compra.length > 0, nCompra: compra.length, precioCompra: rango(compra),
    tieneRecol: recol.length > 0, nRecol: recol.length, tarifaRecol: rango(recol),
    recolCero: recolCero.length,
  };
}

/** Texto de la columna "¿Cortamos nosotros?" a partir del resumen de contratos. */
function textoCortamos(c) {
  if (c.tieneRecol) return `Sí (${c.nRecol} contrato${c.nRecol > 1 ? "s" : ""} de recolección)`;
  if (c.recolCero > 0) return "No (contrato de recolección a 0 €: la entrega cortada él)";
  return "No (sin contrato de recolección)";
}

function filasAgricultores({ entradas, contratos }) {
  const reales = entradas.filter((e) => !esPrecalibrado(e));
  const porAgri = agrupar(reales, (e) => e.num_proveedor || e.agricultor);
  const filas = [];
  for (const [, es] of porAgri) {
    const kg = es.reduce((s, e) => s + e.kg, 0);
    const conPrecio = es.filter((e) => e.importe_compra != null && e.importe_compra > 0);
    const kgConPrecio = conPrecio.reduce((s, e) => s + e.kg, 0);
    const importe = conPrecio.reduce((s, e) => s + e.importe_compra, 0);
    const fincas = [...new Set(es.map((e) => e.finca))].sort();
    const c = resumenContratos(contratos, es[0].num_proveedor);
    // "Cortamos" = tiene contrato de recolección (tipo 8) de la variedad esa campaña.
    // "Compramos" = hay importe de compra en sus entradas o contrato de compra (tipo 9).
    const compramos = importe > 0 || c.tieneCompra;
    filas.push({
      agricultor: es[0].agricultor, num_proveedor: es[0].num_proveedor,
      entradas: es.length, kg, kgConPrecio, importe,
      precioMedio: kgConPrecio > 0 ? importe / kgConPrecio : null,
      compramos: compramos ? "Sí" : "No",
      contratoCompra: c.tieneCompra ? `Sí (${c.nCompra})` : "No",
      precioContratoCompra: c.precioCompra,
      cortamos: textoCortamos(c),
      tarifaRecol: c.tarifaRecol,
      nFincas: fincas.length, fincas: fincas.join("; "),
      desde: es.reduce((a, e) => (e.fecha < a ? e.fecha : a), es[0].fecha),
      hasta: es.reduce((a, e) => (e.fecha > a ? e.fecha : a), es[0].fecha),
    });
  }
  filas.sort((a, b) => b.kg - a.kg);
  const precal = entradas.filter(esPrecalibrado);
  return { filas, precal: { entradas: precal.length, kg: precal.reduce((s, e) => s + e.kg, 0) } };
}

function filasFincas({ entradas, contratos }) {
  const reales = entradas.filter((e) => !esPrecalibrado(e));
  const porFinca = agrupar(reales, (e) => `${e.num_proveedor}|${e.finca}`);
  const filas = [];
  for (const [, es] of porFinca) {
    const kg = es.reduce((s, e) => s + e.kg, 0);
    const conPrecio = es.filter((e) => e.importe_compra != null && e.importe_compra > 0);
    const importe = conPrecio.reduce((s, e) => s + e.importe_compra, 0);
    const kgConPrecio = conPrecio.reduce((s, e) => s + e.kg, 0);
    const conTarifa = (c) => c.tipo === 8 && c.num_proveedor === es[0].num_proveedor && c.precio > 0;
    const recolFinca = contratos.filter((c) => conTarifa(c) && c.finca && c.finca === es[0].finca);
    const recolAgri = contratos.filter(conTarifa);
    filas.push({
      agricultor: es[0].agricultor, finca: es[0].finca, entradas: es.length, kg,
      importe, precioMedio: kgConPrecio > 0 ? importe / kgConPrecio : null,
      cortamos: recolFinca.length > 0 ? "Sí (contrato de esta finca)" : recolAgri.length > 0 ? "Sí (contrato del agricultor)" : textoCortamos(resumenContratos(contratos, es[0].num_proveedor)),
      desde: es.reduce((a, e) => (e.fecha < a ? e.fecha : a), es[0].fecha),
      hasta: es.reduce((a, e) => (e.fecha > a ? e.fecha : a), es[0].fecha),
    });
  }
  filas.sort((a, b) => a.agricultor.localeCompare(b.agricultor, "es") || b.kg - a.kg);
  return filas;
}

// --------------------------------------------------------------------- Excel
const AZUL = "FF1F4E78";
const GRIS = "FFF2F2F2";

function cabecera(hoja, columnas) {
  hoja.columns = columnas.map((c) => ({ header: c.header, key: c.key, width: c.width ?? 16 }));
  const fila = hoja.getRow(1);
  fila.font = { bold: true, color: { argb: "FFFFFFFF" } };
  fila.fill = { type: "pattern", pattern: "solid", fgColor: { argb: AZUL } };
  fila.alignment = { vertical: "middle", wrapText: true };
  fila.height = 34;
  hoja.views = [{ state: "frozen", ySplit: 1 }];
  hoja.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columnas.length } };
  for (const c of columnas) if (c.numFmt) hoja.getColumn(c.key).numFmt = c.numFmt;
}

function filaTotal(hoja, etiquetaCol, sumas) {
  const fila = hoja.addRow({ [etiquetaCol]: "TOTAL", ...sumas });
  fila.font = { bold: true };
  fila.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GRIS } };
  return fila;
}

function construirLibro(datosCampanas) {
  const libro = new ExcelJS.Workbook();
  libro.creator = "Lasarte Cítricos S.L.";
  libro.created = new Date();

  const leer = libro.addWorksheet("Cómo leer");
  leer.columns = [{ width: 34 }, { width: 110 }];
  const explicar = (a, b, negrita = false) => {
    const f = leer.addRow([a, b]);
    f.alignment = { vertical: "top", wrapText: true };
    if (negrita) f.font = { bold: true };
  };
  explicar(`Agricultores de ${VARIEDAD}`, `Sacado del ERP (base gdata001) el ${new Date().toLocaleDateString("es-ES")}. Solo lectura.`, true);
  explicar("", "");
  explicar("Qué fruta cuenta", `Todas las pesadas de báscula (tipo de documento 25 del ERP) cuya línea de entrada tiene un artículo con "${VARIEDAD}" en el nombre. Se quitan las re-entradas de precalibrado (fruta nuestra que vuelve a entrar): su total va en la fila de aviso de cada hoja.`);
  explicar("Campaña", "De septiembre a agosto. La 2025/26 va del 1-09-2025 al 31-08-2026.");
  explicar("Kg de báscula", "Suma de los kilos que marcó la báscula en cada entrada (columna kilos de basculas_pesadas).");
  explicar("Kg con precio", "Kilos de las entradas que ya tienen importe de compra en el ERP. Si es menor que los kg de báscula, el resto está sin valorar todavía.");
  explicar("Dinero de compra (€)", "Suma del importe bruto de las líneas de compra (ent_prov_lin_imp.importe_bruto) de esas entradas. Sin IVA.");
  explicar("Precio medio €/kg", "Dinero de compra dividido por los kg con precio. Es lo pagado de media por kilo de fruta comprada.");
  explicar("¿Compramos la fruta?", "Sí cuando hay dinero de compra en sus entradas o un contrato de compra (tipo 9) de la variedad en la campaña.");
  explicar("Contrato de compra", "Número de contratos de tipo 9 (compra) de la variedad firmados esa campaña, y el precio por kg que ponen.");
  explicar("¿Cortamos nosotros?", "Sí cuando el agricultor tiene contrato de RECOLECCIÓN (tipo 8) de la variedad esa campaña con una tarifa mayor que 0: la cuadrilla de Lasarte corta la fruta y se cobra por kg. Un contrato de recolección a 0 € quiere decir que el agricultor la entrega ya cortada por su cuenta, y se marca como No.");
  explicar("Tarifa recolección €/kg", "Precio por kg del contrato de recolección. Si hay varios contratos con precios distintos, se ponen el menor y el mayor.");
  explicar("Ojo", "El importe REAL de recolección de cada entrada no está en la base de datos del ERP (lo calcula el programa al imprimir). Aquí solo se dice si hay contrato y a qué tarifa.");
  explicar("Filtros", "Cada hoja tiene el filtro automático puesto en la cabecera: en la flecha de Agricultor se eligen uno o varios, y en la de Kg de báscula se puede filtrar por mayor o menor que una cifra. Las filas ya vienen ordenadas de más a menos kilos.");

  for (const d of datosCampanas) {
    const et = etiquetaCampana(d.campana);
    const { filas, precal } = filasAgricultores(d);

    const hA = libro.addWorksheet(`Agricultores ${et.replace("/", "-")}`);
    cabecera(hA, [
      { header: "Agricultor (razón social en el ERP)", key: "agricultor", width: 46 },
      { header: "Nº proveedor ERP", key: "num_proveedor", width: 12 },
      { header: "Nº de entradas", key: "entradas", width: 11, numFmt: "#,##0" },
      { header: "Kg de báscula", key: "kg", width: 14, numFmt: "#,##0" },
      { header: "Kg con precio", key: "kgConPrecio", width: 13, numFmt: "#,##0" },
      { header: "Dinero de compra (€, sin IVA)", key: "importe", width: 16, numFmt: "#,##0.00" },
      { header: "Precio medio €/kg (dinero ÷ kg con precio)", key: "precioMedio", width: 16, numFmt: "0.000" },
      { header: "¿Compramos la fruta?", key: "compramos", width: 12 },
      { header: "Contrato de compra (tipo 9)", key: "contratoCompra", width: 14 },
      { header: "Precio del contrato de compra €/kg", key: "precioContratoCompra", width: 16 },
      { header: "¿Cortamos nosotros? (contrato recolección tipo 8)", key: "cortamos", width: 18 },
      { header: "Tarifa recolección €/kg", key: "tarifaRecol", width: 14 },
      { header: "Nº fincas", key: "nFincas", width: 9 },
      { header: "Fincas", key: "fincas", width: 50 },
      { header: "Primera entrada", key: "desde", width: 12 },
      { header: "Última entrada", key: "hasta", width: 12 },
    ]);
    for (const f of filas) hA.addRow(f);
    filaTotal(hA, "agricultor", {
      entradas: filas.reduce((s, f) => s + f.entradas, 0),
      kg: filas.reduce((s, f) => s + f.kg, 0),
      kgConPrecio: filas.reduce((s, f) => s + f.kgConPrecio, 0),
      importe: filas.reduce((s, f) => s + f.importe, 0),
      nFincas: filas.reduce((s, f) => s + f.nFincas, 0),
    });
    if (precal.entradas > 0) {
      const aviso = hA.addRow({ agricultor: `Aparte: ${precal.entradas} re-entradas de precalibrado (fruta nuestra que vuelve a entrar), ${Math.round(precal.kg).toLocaleString("es-ES")} kg. No son compra.` });
      aviso.font = { italic: true, color: { argb: "FF7F7F7F" } };
    }

    const hF = libro.addWorksheet(`Fincas ${et.replace("/", "-")}`);
    cabecera(hF, [
      { header: "Agricultor", key: "agricultor", width: 46 },
      { header: "Finca (como está en el ERP)", key: "finca", width: 36 },
      { header: "Nº de entradas", key: "entradas", width: 11, numFmt: "#,##0" },
      { header: "Kg de báscula", key: "kg", width: 14, numFmt: "#,##0" },
      { header: "Dinero de compra (€, sin IVA)", key: "importe", width: 16, numFmt: "#,##0.00" },
      { header: "Precio medio €/kg", key: "precioMedio", width: 13, numFmt: "0.000" },
      { header: "¿Cortamos nosotros?", key: "cortamos", width: 26 },
      { header: "Primera entrada", key: "desde", width: 12 },
      { header: "Última entrada", key: "hasta", width: 12 },
    ]);
    for (const f of filasFincas(d)) hF.addRow(f);

    const hE = libro.addWorksheet(`Entradas ${et.replace("/", "-")}`);
    cabecera(hE, [
      { header: "Fecha", key: "fecha", width: 11 },
      { header: "Lote", key: "lote", width: 10 },
      { header: "Nº entrada ERP", key: "num_entrada", width: 12 },
      { header: "Agricultor", key: "agricultor", width: 46 },
      { header: "Finca", key: "finca", width: 34 },
      { header: "Artículo", key: "articulo", width: 24 },
      { header: "Kg de báscula", key: "kg", width: 13, numFmt: "#,##0" },
      { header: "Precio compra €/kg", key: "precio_compra_kg", width: 13, numFmt: "0.000" },
      { header: "Importe compra (€, sin IVA)", key: "importe_compra", width: 15, numFmt: "#,##0.00" },
      { header: "Tipo", key: "tipo", width: 14 },
    ]);
    for (const e of d.entradas) hE.addRow({ ...e, tipo: esPrecalibrado(e) ? "Precalibrado (interno)" : "Fruta de campo" });
  }
  return libro;
}

// -------------------------------------------------------------------- correo
async function enviarCorreo(ruta, datosCampanas) {
  if (!process.env.RESEND_API_KEY) throw new Error("Falta RESEND_API_KEY en el .env: no se puede enviar el correo.");
  const principal = datosCampanas[0];
  const { filas, precal } = filasAgricultores(principal);
  const et = etiquetaCampana(principal.campana);
  const kg = filas.reduce((s, f) => s + f.kg, 0);
  const cortan = filas.filter((f) => f.cortamos === "Sí").length;
  const fmt = (n) => Math.round(n).toLocaleString("es-ES");
  const top = filas.slice(0, 8).map((f) => `<tr><td style="padding:2px 8px">${f.agricultor}</td><td style="padding:2px 8px;text-align:right">${fmt(f.kg)}</td><td style="padding:2px 8px;text-align:center">${f.compramos}</td><td style="padding:2px 8px;text-align:center">${f.cortamos}</td></tr>`).join("");
  const html = `
  <div style="font-family:Arial,sans-serif;font-size:14px;color:#222">
    <p>Adjunto el Excel con los agricultores de <b>${VARIEDAD}</b>, sacado del ERP.</p>
    <p><b>Campaña ${et}:</b> ${filas.length} agricultores, ${principal.entradas.length - precal.entradas} entradas de campo y <b>${fmt(kg)} kg</b> de báscula.
    ${cortan} de los ${filas.length} tienen contrato de recolección (los cortamos nosotros).</p>
    <table style="border-collapse:collapse;font-size:13px"><tr style="background:#1F4E78;color:#fff"><th style="padding:4px 8px;text-align:left">Agricultor</th><th style="padding:4px 8px">Kg báscula</th><th style="padding:4px 8px">¿Compramos?</th><th style="padding:4px 8px">¿Cortamos?</th></tr>${top}</table>
    <p style="font-size:12px;color:#666">El Excel lleva ${datosCampanas.length} campaña(s): ${datosCampanas.map((d) => etiquetaCampana(d.campana)).join(" y ")}. Cada hoja tiene filtro en la cabecera (agricultor, kilos) y va ordenada de más a menos kilos. La hoja "Cómo leer" explica cada columna.</p>
  </div>`;
  const cuerpo = {
    from: "Informes Lasarte <informes@comunicaciones.lasartesat.com>",
    to: PARA,
    reply_to: "soporte@lasartesat.es",
    subject: `Agricultores ${VARIEDAD} — campaña ${et} (ERP)`,
    html,
    text: `Adjunto el Excel con los agricultores de ${VARIEDAD} (ERP). Campaña ${et}: ${filas.length} agricultores, ${fmt(kg)} kg.`,
    attachments: [{ filename: path.basename(ruta), content: fs.readFileSync(ruta).toString("base64") }],
  };
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
    body: JSON.stringify(cuerpo),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text().catch(() => "")).slice(0, 300)}`);
  const id = (await res.json().catch(() => null))?.id ?? null;
  console.log(`Correo enviado a ${PARA.join(", ")} (id Resend ${id})`);
}

// ---------------------------------------------------------------------- main
async function main() {
  const conn = await conectarErp();
  let datos;
  try {
    datos = [];
    for (const c of CAMPANAS) {
      const d = await leerCampana(conn, c);
      console.log(`Campaña ${etiquetaCampana(c)}: ${d.entradas.length} entradas, ${d.contratos.length} líneas de contrato`);
      datos.push(d);
    }
  } finally {
    await conn.end();
  }
  const libro = construirLibro(datos);
  const carpeta = path.join(RAIZ, "outputs");
  fs.mkdirSync(carpeta, { recursive: true });
  const nombre = `Agricultores_${VARIEDAD.replace(/\s+/g, "_")}_${new Date().toISOString().slice(0, 10)}.xlsx`;
  const ruta = path.join(carpeta, nombre);
  await libro.xlsx.writeFile(ruta);
  console.log(`Excel: ${ruta}`);

  for (const d of datos) {
    const { filas, precal } = filasAgricultores(d);
    console.log(`\n${etiquetaCampana(d.campana)} — ${filas.length} agricultores, ${Math.round(filas.reduce((s, f) => s + f.kg, 0)).toLocaleString("es-ES")} kg (precalibrado aparte: ${precal.entradas} entradas, ${Math.round(precal.kg).toLocaleString("es-ES")} kg)`);
    for (const f of filas) console.log(`  ${f.agricultor.padEnd(52)} ${String(Math.round(f.kg)).padStart(10)} kg  compra ${f.compramos}  corta ${f.cortamos}  ${f.tarifaRecol ?? ""}`);
  }
  if (ENVIAR) await enviarCorreo(ruta, datos);
}

main().catch((e) => { console.error("ERROR:", e.message ?? e); process.exit(1); });

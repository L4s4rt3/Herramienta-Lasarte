// Consulta de SOLO LECTURA al ERP: la entrada de un camión de importación
// (cambiar NUM_ENTRADA para el siguiente camión; el primero fue la 16986,
// su ref 1184057, lote 26082701, 27-08-2026).
// Ejecutar: node scripts/consulta-entrada-saf.mjs

import { conectarErp } from "./lib-palets-erp.mjs";

const EMPRESA = "gdata001";
const NUM_ENTRADA = 16986;

// Quita las columnas vacías para que se pueda leer
const limpiar = (fila) =>
  Object.fromEntries(
    Object.entries(fila).filter(
      ([, v]) => v !== null && v !== "" && v !== 0 && v !== "0.0000" && v !== "0.00"
    )
  );

const conn = await conectarErp();
try {
  const consultas = [
    ["CABECERA (ent_prov_cab_alb)",
      `SELECT * FROM ${EMPRESA}.ent_prov_cab_alb WHERE num_entrada = ? LIMIT 5`, [NUM_ENTRADA]],
    ["LÍNEAS (ent_prov_lineas)",
      `SELECT * FROM ${EMPRESA}.ent_prov_lineas WHERE num_entrada = ? LIMIT 30`, [NUM_ENTRADA]],
    ["PROVEEDOR Y AGENCIA (terceros_proveedores)",
      `SELECT num_proveedor, razon_social, nombre_comercial FROM ${EMPRESA}.terceros_proveedores WHERE num_proveedor IN ('400001090','410000089')`, []],
    ["ENVASES DE LA PESADA (basculas_pesadas_envases)",
      `SELECT e.*, ag.denominacion FROM ${EMPRESA}.basculas_pesadas_envases e
        LEFT JOIN ${EMPRESA}.articulo_general ag ON ag.codigo = e.codigo
       WHERE e.num_dcmto = ? LIMIT 30`, [NUM_ENTRADA]],
  ];

  for (const [titulo, sql, params] of consultas) {
    console.log(`\n=== ${titulo} ===`);
    try {
      const [filas] = await conn.query(sql, params);
      if (!filas.length) { console.log("(sin filas)"); continue; }
      for (const f of filas) console.log(JSON.stringify(limpiar(f)));
    } catch (e) {
      console.log("ERROR:", e.message);
    }
  }
} finally {
  await conn.end();
}

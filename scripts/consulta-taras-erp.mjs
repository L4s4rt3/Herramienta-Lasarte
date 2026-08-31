// SOLO LECTURA: ¿dónde guarda el ERP las taras de la entrada SAF 16986?
// Ejecutar: node scripts/consulta-taras-erp.mjs

import { conectarErp } from "./lib-palets-erp.mjs";

const EMPRESA = "gdata001";

const limpiar = (fila) =>
  Object.fromEntries(
    Object.entries(fila).filter(
      ([, v]) => v !== null && v !== "" && v !== 0 && v !== "0.0000" && v !== "0.00" && v !== "0.000" && v !== "0.000000"
    )
  );

const conn = await conectarErp();
try {
  const consultas = [
    ["TABLAS DE ENVASES", `SHOW TABLES FROM ${EMPRESA} LIKE '%envas%'`, []],
    ["ARTÍCULOS DE LA ENTRADA (fruta, característica y envase)",
      `SELECT * FROM ${EMPRESA}.articulo_general WHERE codigo IN ('10003806','10003770','100000698')`, []],
    ["COLUMNAS DE basculas_pesadas_envases", `SHOW COLUMNS FROM ${EMPRESA}.basculas_pesadas_envases`, []],
    ["ENVASES DE LA PESADA (por num_dcmto, sin filtro de tipo)",
      `SELECT * FROM ${EMPRESA}.basculas_pesadas_envases WHERE num_dcmto IN ('16986','37016','1271') LIMIT 30`, []],
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

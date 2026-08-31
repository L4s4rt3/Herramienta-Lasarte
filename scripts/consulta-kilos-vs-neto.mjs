// SOLO LECTURA: ¿el "kilos" de báscula coincide con el neto del albarán?
// Compara las últimas entradas (nacionales vs la importación SAF).
// Ejecutar: node scripts/consulta-kilos-vs-neto.mjs

import { conectarErp } from "./lib-palets-erp.mjs";

const EMPRESA = "gdata001";
const conn = await conectarErp();
try {
  const [filas] = await conn.query(`
    SELECT bp.fecha, bp.num_dcmto_relacionado AS num_entrada, bp.lote,
           bp.carga, bp.tara, bp.kilos,
           epl.unidades_1 AS neto_albaran, LEFT(epl.texto, 35) AS texto,
           cab.tipo_entrada
      FROM ${EMPRESA}.basculas_pesadas bp
      LEFT JOIN ${EMPRESA}.ent_prov_lineas epl
             ON epl.num_entrada = bp.num_dcmto_relacionado AND epl.num_linea = 1
      LEFT JOIN ${EMPRESA}.ent_prov_cab_alb cab
             ON cab.num_entrada = bp.num_dcmto_relacionado
     WHERE bp.tipo_dcmto = 25 AND bp.fecha >= '2026-08-01'
     ORDER BY bp.fecha DESC
     LIMIT 15`);
  for (const f of filas) {
    const kilos = Number(f.kilos), neto = Number(f.neto_albaran);
    console.log(
      `${String(f.fecha).slice(0, 10)} entrada ${f.num_entrada} lote ${f.lote} ` +
      `tipo ${f.tipo_entrada} | bascula ${kilos} vs neto albaran ${neto} ` +
      `(dif ${(kilos - neto).toFixed(0)}) | ${f.texto}`
    );
  }
} finally {
  await conn.end();
}

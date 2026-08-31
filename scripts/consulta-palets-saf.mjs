// SOLO LECTURA: los palets confeccionados del 27/28-08 (arranque SAF) con su
// artículo, cajas y kilos — para medir el sobrellenado real de la malla.
// Ejecutar: node scripts/consulta-palets-saf.mjs

import { conectarErp } from "./lib-palets-erp.mjs";

const EMPRESA = "gdata001";
const conn = await conectarErp();
try {
  const [filas] = await conn.query(`
    SELECT DATE(p.fecha_creacion) AS dia, p.articulo, ag.denominacion,
           COUNT(*) AS palets, SUM(p.num_cajas) AS cajas,
           ROUND(SUM(p.kilos_netos), 1) AS kg,
           ROUND(SUM(p.kilos_netos) / NULLIF(SUM(p.num_cajas), 0), 3) AS kg_por_caja,
           ROUND(AVG(p.kilos_netos), 1) AS kg_por_palet,
           ROUND(AVG(p.num_cajas), 1) AS cajas_por_palet
      FROM ${EMPRESA}.palets_cab p
      LEFT JOIN ${EMPRESA}.articulo_general ag ON ag.codigo = p.articulo
     WHERE DATE(p.fecha_creacion) IN ('2026-08-27', '2026-08-28')
     GROUP BY DATE(p.fecha_creacion), p.articulo, ag.denominacion
     ORDER BY dia, kg DESC`);
  for (const f of filas) {
    console.log(`${f.dia} | ${String(f.denominacion ?? f.articulo).trim()} | ${f.palets} palets | ${f.cajas} cajas | ${f.kg} kg | ${f.kg_por_caja} kg/caja | ${f.cajas_por_palet} cajas/palet`);
  }
  // Detalle palet a palet de la malla de hoy, para ver la dispersión
  const [detalle] = await conn.query(`
    SELECT p.kilos_netos, p.num_cajas,
           ROUND(p.kilos_netos / NULLIF(p.num_cajas, 0), 3) AS kg_caja
      FROM ${EMPRESA}.palets_cab p
      LEFT JOIN ${EMPRESA}.articulo_general ag ON ag.codigo = p.articulo
     WHERE DATE(p.fecha_creacion) = '2026-08-28'
       AND ag.denominacion LIKE '%MIDKNIGHT CAL4/5%'
     ORDER BY p.kilos_netos
     LIMIT 40`);
  console.log("\n--- detalle malla de hoy (kg_caja por palet) ---");
  console.log(detalle.map((f) => `${f.kilos_netos}kg/${f.num_cajas}c=${f.kg_caja}`).join(" | "));
} finally {
  await conn.end();
}

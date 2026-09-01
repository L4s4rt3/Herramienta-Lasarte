// SOLO LECTURA: kg/caja de la malla Mercadona por PEDIDO de cliente, palet a
// palet, para medir si los cambios de TOLERANCIA de la enmalladora se notan.
// Mercadona factura 12,00 kg/caja y exige entregar >=12,24 (4 mallas x 3,06):
// todo lo que la media supere 12,24 son kilos regalados.
//
// El pedido sale de palets_cab.serie_pedido_clte/num_pedido_clte (P9 nnnnn).
// El pedido que carga al dia siguiente (Madrid) se confecciona ANTES de tener
// pedido asignado: aparece como "(sin pedido)" y se distingue por el tramo de
// numeros de palet, que son secuenciales dentro del dia.
//
// Ejecutar: node scripts/merma-malla-por-pedido.mjs [fecha ...]
//           (sin argumentos: hoy)

import { conectarErp } from "./lib-palets-erp.mjs";

const EMPRESA = "gdata001";
const KG_CAJA_EXIGIDO = 12.24;

const fechas = process.argv.slice(2).length
  ? process.argv.slice(2)
  : [new Date().toISOString().slice(0, 10)];

const conn = await conectarErp();
try {
  const [filas] = await conn.query(
    `
    SELECT DATE(p.fecha_creacion) AS dia,
           IF(p.num_pedido_clte > 0, CONCAT(TRIM(p.serie_pedido_clte), ' ', p.num_pedido_clte), '(sin pedido)') AS pedido,
           IF(p.num_dcmto_vta > 0, CONCAT(TRIM(p.serie_dcmto_vta), ' ', p.num_dcmto_vta), '-') AS albaran,
           MIN(p.numero) AS palet_min, MAX(p.numero) AS palet_max,
           COUNT(*) AS palets, SUM(p.num_cajas) AS cajas, SUM(p.kilos_netos) AS kg,
           ROUND(SUM(p.kilos_netos) / NULLIF(SUM(p.num_cajas), 0), 3) AS kg_caja,
           ROUND(MIN(p.kilos_netos / NULLIF(p.num_cajas, 0)), 3) AS kg_caja_min,
           ROUND(MAX(p.kilos_netos / NULLIF(p.num_cajas, 0)), 3) AS kg_caja_max
      FROM ${EMPRESA}.palets_cab p
      LEFT JOIN ${EMPRESA}.articulo_general ag ON ag.codigo = p.articulo
     WHERE DATE(p.fecha_creacion) IN (?)
       AND ag.denominacion LIKE '%CAL4/5%'
       AND p.num_cajas > 0
       -- Mientras un palet está abierto el ERP guarda una fila con kilos en
       -- negativo (visto -127 kg el 31-08 y el 01-09): fuera de la media.
       AND p.kilos_netos > 0
     GROUP BY dia, pedido, albaran
     ORDER BY dia, palet_min`,
    [fechas],
  );
  if (filas.length === 0) {
    console.log(`Sin palets de malla en ${fechas.join(", ")}`);
  }
  for (const f of filas) {
    const regalado = Number(f.kg) - Number(f.cajas) * KG_CAJA_EXIGIDO;
    console.log(
      `${f.dia} | ${String(f.pedido).padEnd(12)} | albaran ${String(f.albaran).padEnd(8)} | ` +
        `palets ${f.palet_min}-${f.palet_max} (${f.palets}) | ${String(f.cajas).padStart(5)} cajas | ` +
        `${f.kg_caja} kg/caja (rango ${f.kg_caja_min}-${f.kg_caja_max}) | ` +
        `regalado vs 12,24: ${regalado >= 0 ? "+" : ""}${regalado.toFixed(0)} kg`,
    );
  }
} finally {
  await conn.end();
}

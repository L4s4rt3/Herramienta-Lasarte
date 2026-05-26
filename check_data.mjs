const PROJECT_REF = process.env.SUPABASE_PROJECT_REF;
const MGMT_TOKEN = process.env.SUPABASE_MGMT_TOKEN;

async function query(sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${MGMT_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status}: ${text}`);
  }
  return res.json();
}

async function main() {
  // Get all archivos
  let r = await query(`SELECT id, file_name, file_type, part_id FROM partes_archivos ORDER BY id`);
  console.log('=== PARTES ARCHIVOS ===');
  for (const f of r) {
    console.log(`${f.id}\t${f.file_type ?? 'null'}\t${f.part_id}\t${f.file_name}`);
  }

  // Get resumen_ia sample  
  r = await query(`SELECT id, date, resumen_ia FROM partes_diarios WHERE resumen_ia IS NOT NULL LIMIT 3`);
  console.log('\n=== RESUMEN IA SAMPLE ===');
  for (const p of r) {
    const keys = p.resumen_ia ? Object.keys(p.resumen_ia).join(', ') : 'null';
    console.log(`${p.id}\t${p.date}\tkeys: ${keys}`);
    if (p.resumen_ia?.calibres_detalle) {
      console.log(`  calibres_detalle: ${JSON.stringify(p.resumen_ia.calibres_detalle).slice(0,200)}`);
    }
    if (p.resumen_ia?.producto_detalle) {
      console.log(`  producto_detalle: ${JSON.stringify(p.resumen_ia.producto_detalle).slice(0,200)}`);
    }
    if (p.resumen_ia?._tamanosWarning) {
      console.log(`  _tamanosWarning: ${p.resumen_ia._tamanosWarning}`);
    }
  }

  // Check calibres_dia  
  r = await query(`SELECT count(*) as cnt FROM calibres_dia`);
  console.log(`\n=== CALIBRES_DIA: ${r[0]?.cnt || 0} rows ===`);

  // Check lotes_dia
  r = await query(`SELECT count(*) as cnt FROM lotes_dia`);
  console.log(`=== LOTES_DIA: ${r[0]?.cnt || 0} rows ===`);
  
  // Check producto_dia  
  r = await query(`SELECT count(*) as cnt FROM producto_dia`);
  console.log(`=== PRODUCTO_DIA: ${r[0]?.cnt || 0} rows ===`);

  // Check what values exist in resumen_ia for calibres_detalle
  r = await query(`
    SELECT id, date, 
      resumen_ia->>'calibres_detalle' as calibres,
      resumen_ia->>'producto_detalle' as producto,
      resumen_ia->>'kg_mujeres_l' as kg_mujeres,
      resumen_ia->>'kg_podrido_calibrador' as kg_podrido
    FROM partes_diarios 
    WHERE resumen_ia IS NOT NULL 
    ORDER BY date DESC
    LIMIT 10
  `);
  console.log('\n=== CALIBRES DETALLE FROM RESUMEN_IA ===');
  for (const p of r) {
    console.log(`${p.date}: mujeres=${p.kg_mujeres ?? '?'} podrido=${p.kg_podrido ?? '?'} calibres=${(p.calibres || '').slice(0,50)} producto=${(p.producto || '').slice(0,50)}`);
  }
}

main().catch(e => console.error('FATAL:', e));

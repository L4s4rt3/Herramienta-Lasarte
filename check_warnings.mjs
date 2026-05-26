async function query(sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${process.env.SUPABASE_PROJECT_REF}/database/query`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${process.env.SUPABASE_MGMT_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return res.json();
}

async function main() {
  // Check resumen_ia for all partes - specifically the _ai_warning
  let r = await query(`
    SELECT id, date, resumen_ia->>'_ai_warning' as warning
    FROM partes_diarios 
    WHERE resumen_ia IS NOT NULL
    ORDER BY date DESC
    LIMIT 20
  `);
  console.log('=== AI WARNINGS ===');
  for (const p of r) {
    console.log(`${p.date}: ${(p.warning || '').slice(0,150)}`);
  }
  
  // Check if there are edges function env vars
  r = await query(`
    SELECT id, date, 
      (resumen_ia->>'kg_mujeres_l')::numeric as kg_mujeres,
      (resumen_ia->>'kg_podrido_calibrador')::numeric as kg_podrido,
      (resumen_ia->>'lotes_detalle')::text as lotes_len,
      (resumen_ia->>'calibres_detalle')::text as calibres_len
    FROM partes_diarios 
    WHERE resumen_ia IS NOT NULL
    ORDER BY date DESC
    LIMIT 20
  `);
  console.log('\n=== DATA LENS ===');
  for (const p of r) {
    const lLen = p.lotes_len?.length ? 'has_lotes' : 'no_lotes';
    const cLen = p.calibres_len?.length ? 'has_calibres' : 'no_calibres';
    console.log(`${p.date}: mujeres=${p.kg_mujeres} podrido=${p.kg_podrido} ${lLen} ${cLen}`);
  }
}

main().catch(e => console.error('FATAL:', e));

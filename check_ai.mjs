const PROJECT_REF = process.env.SUPABASE_PROJECT_REF;
const MGMT_TOKEN = process.env.SUPABASE_MGMT_TOKEN;

async function query(sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${MGMT_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return res.json();
}

async function main() {
  // Get full resumen_ia for one parte to see AI warning and structure
  let r = await query(`
    SELECT id, date, resumen_ia 
    FROM partes_diarios 
    WHERE resumen_ia IS NOT NULL 
    LIMIT 3
  `);
  for (const p of r) {
    console.log(`\n=== PARTE ${p.date} (${p.id}) ===`);
    const ri = p.resumen_ia;
    console.log('_ai_warning:', ri._ai_warning);
    console.log('_server_side:', JSON.stringify(ri._server_side).slice(0,200));
    
    // Check tamanos sub-agent result
    // The resumen_ia is merged from all sub-agents
    // Let's see what tamanos returned
    console.log('kg_mujeres_l:', ri.kg_mujeres_l, '(source:', typeof ri.kg_mujeres_l === 'number' ? 'AI/server' : 'unknown', ')');
    console.log('kg_podrido_calibrador:', ri.kg_podrido_calibrador);
    
    // Check if there's tamanos data in _server_side
    if (ri._server_side) {
      const ss = typeof ri._server_side === 'string' ? JSON.parse(ri._server_side) : ri._server_side;
      console.log('_server_side.tamanos:', JSON.stringify(ss.tamanos).slice(0,200));
    }
    
    // Check if AI actually returned data for each sub-agent
    console.log('Has AI results by key presence:');
    console.log('  calibres_detalle:', ri.calibres_detalle?.length ?? 'missing', 'items');
    console.log('  producto_detalle:', ri.producto_detalle?.length ?? 'missing', 'items');
    console.log('  lotes_detalle:', ri.lotes_detalle?.length ?? 'missing', 'items');
    console.log('  palets_detalle:', ri.palets_detalle?.length ?? 'missing', 'items');
  }
  
  // Check what kg_produccion_calibrador and kg_mujeres_calibrador look like in partes_diarios columns vs resumen_ia
  r = await query(`
    SELECT id, date, 
      kg_produccion_calibrador, kg_mujeres_calibrador,
      (resumen_ia->>'kg_produccion_total')::numeric as ri_prod,
      (resumen_ia->>'kg_mujeres_l')::numeric as ri_mujeres
    FROM partes_diarios 
    WHERE resumen_ia IS NOT NULL 
    ORDER BY date DESC
    LIMIT 10
  `);
  console.log('\n=== COLUMNS VS RESUMEN_IA ===');
  for (const p of r) {
    console.log(`${p.date}: col_prod=${p.kg_produccion_calibrador} ri_prod=${p.ri_prod} | col_mujeres=${p.kg_mujeres_calibrador} ri_mujeres=${p.ri_mujeres}`);
  }
}

main().catch(e => console.error('FATAL:', e));

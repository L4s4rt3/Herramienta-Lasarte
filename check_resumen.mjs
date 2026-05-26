import { createClient } from '@supabase/supabase-js';

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_ANON_KEY;

const supabase = createClient(URL, KEY);

async function main() {
  const { data: partes, error } = await supabase
    .from('partes_diarios')
    .select('id, date, kg_produccion_calibrador, kg_mujeres_calibrador')
    .order('date', { ascending: false })
    .limit(25);
  
  if (error) { console.log('ERROR:', JSON.stringify(error)); return; }
  console.log(`Count: ${partes?.length || 0}`);
  for (const p of partes || []) {
    console.log(`${p.id}\t${p.date}\tprod=${p.kg_produccion_calibrador ?? 0}\tmujeres=${p.kg_mujeres_calibrador ?? 0}`);
  }
}

main().catch(e => console.error(e));

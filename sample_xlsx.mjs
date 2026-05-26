const PROJECT_REF = process.env.SUPABASE_PROJECT_REF;
const MGMT_TOKEN = process.env.SUPABASE_MGMT_TOKEN;
const SRV_KEY = process.env.SUPABASE_SERVICE_KEY;
import { createClient } from '@supabase/supabase-js';
import * as XLSX from 'xlsx';

const supabase = createClient(process.env.SUPABASE_URL, SRV_KEY);

async function main() {
  // Get a sample file with full format
  const { data: files } = await supabase
    .from('partes_archivos')
    .select('id, file_name, file_path')
    .eq('part_id', 'b1e79d12-5928-45d6-aeee-c0918d9f3ae8');
  
  for (const f of files) {
    const name = f.file_name;
    if (!/tamaño|tamano|clase|calidad/i.test(name) && !/variedad/i.test(name)) continue;
    
    const { data: blob } = await supabase.storage.from('partes-archivos').download(f.file_path);
    if (!blob) continue;
    
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const wb = XLSX.read(bytes, { type: 'array' });
    const rowsAll = [];
    for (const sn of wb.SheetNames) {
      const ws = wb.Sheets[sn];
      rowsAll.push(...XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: null }));
    }
    
    console.log(`\n=== ${name} (${rowsAll.length} rows) ===`);
    // Print first 15 rows to see structure
    for (let i = 0; i < Math.min(rowsAll.length, 15); i++) {
      const r = rowsAll[i] ?? [];
      console.log(`Row ${i}:`, r.slice(0, 10).map(c => String(c ?? '').slice(0, 30)).join(' | '));
    }
    break; // just one file for now
  }
}

main().catch(e => console.error(e));

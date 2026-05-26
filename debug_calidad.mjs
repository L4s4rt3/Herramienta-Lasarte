import { createClient } from '@supabase/supabase-js';
import * as XLSX from 'xlsx';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

function norm(s) { return String(s ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim(); }

const { data: files } = await supabase.from('partes_archivos').select('id, file_name, file_path')
  .eq('part_id', 'b1e79d12-5928-45d6-aeee-c0918d9f3ae8');

for (const f of files) {
  if (!f.file_name.includes('calidad') && !f.file_name.includes('variedad')) continue;
  
  const { data: blob } = await supabase.storage.from('partes-archivos').download(f.file_path);
  if (!blob) continue;
  
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const wb = XLSX.read(bytes, { type: 'array' });
  const rowsAll = [];
  for (const sn of wb.SheetNames) {
    const ws = wb.Sheets[sn];
    rowsAll.push(...XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: null }));
  }

  console.log(`FILE: ${f.file_name} (${rowsAll.length} rows)`);
  
  // Print rows 5-15
  for (let i = 5; i <= 15; i++) {
    const r = rowsAll[i] ?? [];
    // Show columns with non-null values only
    const cols = [];
    for (let j = 0; j < r.length; j++) {
      if (r[j] != null && r[j] !== '') cols.push(`[${j}]:${JSON.stringify(r[j])}`);
    }
    console.log(`  Row ${i}: ${cols.join(', ') || '(empty)'}`);
  }
  
  // Now test parseCalidad logic
  console.log('\n  Testing parseCalidad logic:');
  let currentClase = null;
  let inTamanos = false;
  
  for (let i = 0; i < rowsAll.length; i++) {
    const r = rowsAll[i] ?? [];
    const c1 = norm(r[1] ?? '');
    const c3 = norm(r[3] ?? '');
    const c6 = norm(r[6] ?? '');
    const c7 = norm(r[7] ?? '');
    
    if (c1 === 'variedad:') {
      console.log(`  Row ${i}: variedad=${r[2]}`);
    }
    if (c1 === 'calidad:' && c7 !== '') {
      const nextRow = rowsAll[i + 1] ?? [];
      const calidadName = String(nextRow[6] ?? '').trim();
      currentClase = calidadName.replace(/^\([A-Z]\)\s*/, '').trim();
      console.log(`  Row ${i}: Calidad detected, name=${calidadName} clase=${currentClase}`);
    }
    if (c3 === 'clase:') { inTamanos = false; }
    if (c3 === 'tamano') { inTamanos = true; }
    if (inTamanos && currentClase && c3 && String(r[3]).startsWith('(')) {
      console.log(`  Row ${i}: Data row, calibre=${r[3]}, clase=${currentClase}`);
    }
  }
}

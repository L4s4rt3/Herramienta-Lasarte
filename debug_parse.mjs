import { createClient } from '@supabase/supabase-js';
import * as XLSX from 'xlsx';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

function norm(s) { return String(s ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim(); }
function toNum(v) {
  if (v == null) return 0;
  if (typeof v === 'number') return isFinite(v) ? v : 0;
  let s = String(v).trim().replace(/\s/g, '');
  if (!s) return 0;
  if (s.includes(',') && s.includes('.')) s = s.replace(/\./g, '').replace(',', '.');
  else if (s.includes(',')) s = s.replace(',', '.');
  return parseFloat(s) || 0;
}

const { data: files } = await supabase.from('partes_archivos').select('id, file_name, file_path')
  .eq('part_id', 'b1e79d12-5928-45d6-aeee-c0918d9f3ae8');

for (const f of files) {
  if (!f.file_name.includes('tamaños.xlsx') || f.file_name.includes('variedad')) continue;
  
  const { data: blob } = await supabase.storage.from('partes-archivos').download(f.file_path);
  if (!blob) continue;
  
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const wb = XLSX.read(bytes, { type: 'array' });
  const rowsAll = [];
  for (const sn of wb.SheetNames) {
    const ws = wb.Sheets[sn];
    rowsAll.push(...XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: null }));
  }

  console.log(`TESTING: ${f.file_name} (${rowsAll.length} rows)`);
  
  // Manually test detection
  let groupFound = false;
  let headerFound = false;
  let dataRows = 0;
  
  for (let i = 0; i < rowsAll.length; i++) {
    const r = rowsAll[i] ?? [];
    const c1 = norm(r[1] ?? '');
    const c5 = norm(r[5] ?? '');
    
    if (c1 === 'exportacion' && norm(r[2] ?? '') === '' && norm(r[3] ?? '') === '' && norm(r[4] ?? '') === '') {
      console.log(`  Row ${i}: EXPORTACION detected! r[2]=${JSON.stringify(r[2])} r[3]=${JSON.stringify(r[3])} r[4]=${JSON.stringify(r[4])}`);
      groupFound = true;
    }
    if (c1 === 'tamano' && c5 === 'piezas') {
      console.log(`  Row ${i}: Header Tamaño+Piezas detected!`);
      headerFound = true;
    }
    if (groupFound && headerFound && r[1] && String(r[1]).startsWith('(')) {
      dataRows++;
      if (dataRows <= 3) console.log(`  Row ${i}: Data row, calibre=${r[1]}, piezas=${r[5]}`);
    }
  }
  
  console.log(`  groupFound=${groupFound}, headerFound=${headerFound}, dataRows=${dataRows}`);
  
  for (let idx = 7; idx <= 9; idx++) {
    const r = rowsAll[idx] ?? [];
    console.log(`  Row ${idx} columns:`);
    for (let j = 0; j < 8; j++) {
      const val = r[j];
      if (val != null) console.log(`    [${j}]: ${JSON.stringify(val)}`);
    }
  }
}

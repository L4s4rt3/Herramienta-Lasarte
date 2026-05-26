import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

// Create admin client (bypasses RLS with service role)
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function main() {
  // 1. Find archivos de "tamaños" 
  const { data: archivos, error } = await supabase
    .from('partes_archivos')
    .select('id, file_name, file_path, part_id')
    .or('file_name.ilike.%tamaño%,file_name.ilike.%tamaños%,file_name.ilike.%clase%,file_name.ilike.%calidad%,file_name.ilike.%variedad%')
    .limit(20);
  
  if (error) { console.error('Error fetching archivos:', error); return; }
  console.log(`Found ${archivos?.length || 0} calibre files`);
  
  for (const f of archivos || []) {
    console.log(`\n--- ${f.file_name} (part_id: ${f.part_id}) ---`);
    
    // 2. Download from storage
    const { data: blob, error: dlErr } = await supabase.storage
      .from('partes-archivos')
      .download(f.file_path);
    
    if (dlErr || !blob) {
      console.log(`  Download error: ${dlErr?.message || 'no blob'}`);
      continue;
    }
    
    // 3. Parse with xlsx
    const XLSX = await import('xlsx');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let wb;
    try {
      wb = XLSX.read(bytes, { type: 'array' });
    } catch (e) {
      console.log(`  XLSX parse error: ${e.message}`);
      continue;
    }
    
    // 4. Extract first sheet data (first 20 rows)
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
    console.log(`  Sheet: ${wb.SheetNames[0]}, rows: ${rows.length}`);
    console.log('  Headers:', rows[0]?.slice(0, 8));
    console.log('  Row 1:', rows[1]?.slice(0, 8));
    console.log('  Row 2:', rows[2]?.slice(0, 8));
    if (rows.length > 3) console.log('  Row 3:', rows[3]?.slice(0, 8));
    if (rows.length > 5) console.log('  ... more rows available');
    
    // 5. Try to find clase and grupo columns
    const headerRow = rows[0] || [];
    const claseIdx = headerRow.findIndex(h => /clase|clas[eé]|categoria|categor[ií]a|calidad|extra/i.test(String(h)));
    const grupoIdx = headerRow.findIndex(h => /grupo|destino|exportac|mercado/i.test(String(h)));
    const kgIdx = headerRow.findIndex(h => /peso|kg|kilos|total/i.test(String(h)));
    const calibreIdx = headerRow.findIndex(h => /tamaño|tamano|calibre|size|talla/i.test(String(h)));
    
    console.log(`  Column indices - clase:${claseIdx} grupo:${grupoIdx} kg:${kgIdx} calibre:${calibreIdx}`);
    
    // 6. Extract data rows
    const dataRows = [];
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.every(c => !c)) continue;
      const kg = Number(row[kgIdx]) || 0;
      if (kg === 0) continue;
      dataRows.push({
        clase: row[claseIdx] || null,
        grupo: row[grupoIdx] || null,
        kg,
        calibre: row[calibreIdx] || null,
        fullRow: row.slice(0, 8),
      });
    }
    console.log(`  Data rows with kg>0: ${dataRows.length}`);
    if (dataRows.length > 0) {
      console.log('  Sample:', JSON.stringify(dataRows[0]));
      console.log('  All clases:', [...new Set(dataRows.map(r => r.clase))]);
      console.log('  All grupos:', [...new Set(dataRows.map(r => r.grupo))]);
    }
    break; // just first file for now
  }
}

main().catch(e => console.error('Fatal:', e.message));

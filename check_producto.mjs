import { createClient } from '@supabase/supabase-js';
import * as XLSX from 'xlsx';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function main() {
  const { data: files } = await supabase.from('partes_archivos').select('id, file_name, file_path')
    .eq('part_id', 'b1e79d12-5928-45d6-aeee-c0918d9f3ae8');

  for (const f of files) {
    if (f.file_name !== 'Informe 1505 producto.xlsx') continue;
    const { data: blob } = await supabase.storage.from('partes-archivos').download(f.file_path);
    if (!blob) continue;
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const wb = XLSX.read(bytes, { type: 'array' });
    const rowsAll = [];
    for (const sn of wb.SheetNames) {
      const ws = wb.Sheets[sn];
      rowsAll.push(...XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: null }));
    }
    for (let i = 0; i < Math.min(rowsAll.length, 40); i++) {
      const r = rowsAll[i] ?? [];
      console.log(i.toString().padStart(2,' ') + ': ' + r.slice(0,10).map(c => String(c ?? '').slice(0,30)).join(' | '));
    }
  }
}
main().catch(e => console.error(e));

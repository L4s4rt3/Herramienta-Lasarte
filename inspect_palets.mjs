import { createClient } from '@supabase/supabase-js';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import * as XLSX from 'xlsx';

// Cargar .env manualmente (sin dependencia dotenv)
const envTxt = readFile('.env', 'utf8').catch(() => '');
const env = Object.fromEntries(
  (await envTxt).split('\n')
    .map(l => l.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"]*)"?\s*$/i))
    .filter(Boolean)
    .map(m => [m[1], m[2]])
);

const URL = env.SUPABASE_URL ?? env.VITE_SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY ?? env.SUPABASE_ANON_KEY ?? env.VITE_SUPABASE_ANON_KEY;

console.log('URL:', URL);
console.log('KEY length:', KEY?.length);
const supabase = createClient(URL, KEY);

async function main() {
  const targetName = 'palets 28 mayo.xlsx';
  console.log('Buscando archivo en storage...');

  // Probar varios buckets
  const buckets = ['partes', 'partes-archivos', 'archivos', 'uploads', 'files'];
  for (const bucket of buckets) {
    const { data: files, error: listErr } = await supabase
      .storage
      .from(bucket)
      .list('', { limit: 1000 });
    if (listErr) continue;
    console.log(`Bucket "${bucket}": ${files?.length ?? 0} items`);
    if (files && files.length) {
      for (const f of files.slice(0, 5)) {
        console.log(`  - ${f.name} (id=${f.id})`);
      }
      // Buscar en raíz
      const match = files.find(f => f.name === targetName);
      if (match) {
        console.log(`Match en bucket ${bucket}:`, match.name);
        const { data: blob, error: dlErr } = await supabase.storage.from(bucket).download(match.name);
        if (!dlErr) { await saveAndInspect(blob, match.name); return; }
      }
      // Buscar en subcarpetas
      for (const f of files) {
        if (!f.name.includes('.')) {
          const { data: nested } = await supabase.storage.from(bucket).list(f.name, { limit: 1000 });
          if (nested) {
            const found = nested.find(x => x.name === targetName);
            if (found) {
              console.log(`Match en ${bucket}/${f.name}:`, found.name);
              const { data: blob, error: dlErr } = await supabase.storage.from(bucket).download(`${f.name}/${found.name}`);
              if (!dlErr) { await saveAndInspect(blob, `${f.name}/${found.name}`); return; }
            }
          }
        }
      }
    }
  }

  // También buscar en la DB por el file_name
  console.log('\nBuscando en tabla partes_archivos...');
  for (const name of ['partes_archivos', 'archivos', 'partes_files', 'files']) {
    const { data: rows, error: dbErr } = await supabase
      .from(name)
      .select('*')
      .limit(1);
    console.log(`Tabla "${name}":`, dbErr ? dbErr.message : `OK, cols: ${Object.keys(rows?.[0] || {}).join(', ')}`);
  }
  const { data: rows, error: dbErr } = await supabase
    .from('partes_archivos')
    .select('*')
    .limit(3);
  if (!dbErr && rows) {
    console.log('Sample filas:');
    for (const r of rows) console.log(JSON.stringify(r, null, 2));
  }
}

async function saveAndInspect(blob, name) {
  const tmpDir = 'C:/Users/luiso/AppData/Local/Temp/opencode/xlsx-inspect';
  if (!existsSync(tmpDir)) await mkdir(tmpDir, { recursive: true });
  const outPath = `${tmpDir}/${name.replace(/[/\\]/g, '_')}`;
  const buf = Buffer.from(await blob.arrayBuffer());
  await writeFile(outPath, buf);
  console.log(`Guardado: ${outPath} (${buf.length} bytes)`);
  console.log('Primeros 32 bytes (hex):', buf.subarray(0, 32).toString('hex'));
  console.log('Primeros 200 chars (texto):');
  const head = buf.subarray(0, 200).toString('utf8').replace(/[^\x20-\x7e\n]/g, '.');
  console.log(head);

  console.log('\n--- Probando parse con XLSX.read (modo normal) ---');
  try {
    const wb = XLSX.read(buf, { type: 'buffer' });
    console.log('Hojas:', wb.SheetNames);
    for (const sn of wb.SheetNames) {
      const ws = wb.Sheets[sn];
      const json = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: true });
      console.log(`Hoja "${sn}": ${json.length} filas`);
      const first5 = json.slice(0, 5).map(r => Array.isArray(r) ? r.map(c => String(c).slice(0, 40)) : r);
      console.log(JSON.stringify(first5, null, 2));
    }
  } catch (e) {
    console.error('XLSX.read error:', e.message);
  }
}

main().catch(e => console.error('FATAL:', e));

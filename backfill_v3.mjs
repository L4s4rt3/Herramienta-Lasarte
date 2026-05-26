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

// Parse "tamaños.xlsx" — section-based: EXPORTACION / MUJERES / NO COMERCIAL / NO EXPORTACION
// Col 1 = Tamaño, Col 6 = Piezas, Col 7 = Peso(kg) maybe
function parseTamanos(rows) {
  const items = [];
  let currentGrupo = null;
  let inTamanos = false;
  let tamCol = -1;
  let piezasCol = -1;
  let pesoCol = -1;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] ?? [];
    const c1 = norm(r[1] ?? '');

    // Detect section header in column 1
    if ((c1 === 'exportacion' || c1 === 'mujeres' || c1 === 'no comercial' || c1 === 'no exportacion') &&
        norm(r[2] ?? '') === '' && norm(r[3] ?? '') === '' && norm(r[4] ?? '') === '') {
      currentGrupo = c1;
      inTamanos = false;
      tamCol = -1; piezasCol = -1; pesoCol = -1;
      continue;
    }

    // Detect header row: look for Tamaño + column names
    if (inTamanos === false && currentGrupo && c1 === 'tamano') {
      tamCol = 1;
      for (let j = 2; j < Math.min(r.length, 10); j++) {
        const cj = norm(r[j] ?? '');
        if (cj === 'piezas') piezasCol = j;
        if (cj.includes('peso')) pesoCol = j;
      }
      // If Piezas not found by name, try common positions
      if (piezasCol < 0 && norm(r[6] ?? '') === 'piezas') piezasCol = 6;
      if (pesoCol < 0 && norm(r[7] ?? '') === 'peso (kg)') pesoCol = 7;
      if (piezasCol >= 0) inTamanos = true;
      continue;
    }

    if (inTamanos && currentGrupo && tamCol >= 0) {
      const calibreVal = String(r[tamCol] ?? '').trim();
      if (!calibreVal) continue;
      if (/^(total|subtotal)/i.test(calibreVal)) continue;
      if (!calibreVal.startsWith('(')) continue;
      const piezas = piezasCol >= 0 ? toNum(r[piezasCol]) : 0;
      const kg = pesoCol >= 0 ? toNum(r[pesoCol]) : 0;
      if (piezas > 0 || kg > 0) {
        items.push({ calibre: calibreVal, grupo_destino: currentGrupo, piezas, kg });
      }
    }

    // Blank row = end of section
    if (inTamanos && !c1 && !norm(r[6] ?? '') && !norm(r[7] ?? '')) {
      inTamanos = false;
    }
  }
  return items;
}

// Parse "tamaños, calidad y clase por variedad.xlsx"
// Dynamic column detection: scans all rows/columns for known markers
function parseCalidad(rows) {
  const items = [];
  let currentClase = null;
  let currentGrupo = null;
  let inTable = false;
  let sectionsFound = 0;
  const nextValue = (r, j) => {
    for (let k = j + 1; k < Math.min(j + 20, r.length); k++) {
      const v = r[k]; if (v != null && v !== '') return String(v).trim();
    }
    return null;
  };

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] ?? [];

    // Detect calidad/clase name: "(A) Extra 1", "(B) Extra 2", etc.
    for (let j = 0; j < Math.min(r.length, 20); j++) {
      const v = String(r[j] ?? '').trim();
      if (/^\([A-Za-z]\)\s+\w/.test(v)) {
        currentClase = v.replace(/^\([A-Za-z]\)\s*/, '').trim();
        currentGrupo = null;
        inTable = false;
        sectionsFound++;
        break;
      }
    }

    // Detect "Grupo de Clasificación:" anywhere (up to col 50) → group value is next non-empty
    for (let j = 0; j < Math.min(r.length, 55); j++) {
      if (norm(r[j]) === 'grupo de clasificacion:') {
        const gv = nextValue(r, j);
        if (gv) currentGrupo = norm(gv);
        break;
      }
    }

    // Detect header row: "Tamaño" and "Piezas" and "Peso (kg)" anywhere
    let tamCol = -1, piezasCol = -1, pesoCol = -1, pctCol = -1;
    for (let j = 0; j < Math.min(r.length, 40); j++) {
      const raw = String(r[j] ?? '').trim();
      const cj = norm(raw);
      // norm() strips accents/ñ, so compare both raw and normalized
      if (cj === 'tamano' || raw.toLowerCase() === 'tamaño') tamCol = j;
      if (cj === 'piezas') piezasCol = j;
      if (cj === 'peso (kg)') pesoCol = j;
      if (cj === '% piezas' || cj === '% peso') { if (pctCol < 0) pctCol = j; }
    }

    if (currentClase && tamCol >= 0 && (piezasCol >= 0 || pesoCol >= 0)) {
      inTable = true;
      for (let di = i + 1; di < rows.length; di++) {
        const dr = rows[di] ?? [];
        const calibreVal = String(dr[tamCol] ?? '').trim();
        if (!calibreVal) { inTable = false; break; }
        if (/^(total|subtotal)/i.test(calibreVal)) continue;
        if (!calibreVal.startsWith('(')) { inTable = false; break; }
        const piezas = piezasCol >= 0 ? toNum(dr[piezasCol]) : 0;
        const kg = pesoCol >= 0 ? toNum(dr[pesoCol]) : 0;
        const pct = pctCol >= 0 ? toNum(dr[pctCol]) : 0;
        if (piezas > 0 || kg > 0) {
          items.push({ calibre: calibreVal, clase: currentClase, grupo_destino: currentGrupo, piezas, kg, pct });
        }
      }
      continue;
    }
  }
  if (items.length > 0) console.log(`  calidad: ${items.length} items (${sectionsFound} sections)`);
  return items;
}

// Parse "producto.xlsx" — Producto + Peso(kg)
function parseProducto(rows) {
  const items = [];
  let prodCol = -1, empCol = -1, empqCol = -1, pesoCol = -1, frutaCol = -1;

  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const r = rows[i] ?? [];
    for (let j = 0; j < r.length; j++) {
      const c = norm(r[j]);
      if (/^producto$/.test(c)) prodCol = j;
      if (/^empaque$/.test(c)) empCol = j;
      if (/^empaques$/.test(c)) empqCol = j;
      if (/^peso\s*\(?\s*kg\s*\)?\s*$/.test(c)) pesoCol = j;
      if (/^fruta$/.test(c)) frutaCol = j;
    }
  }
  if (prodCol < 0 || pesoCol < 0) return items;

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i] ?? [];
    const prod = String(r[prodCol] ?? '').trim();
    const kg = toNum(r[pesoCol]);
    if (!prod || kg <= 0) continue;
    if (/^(total|subtotal)/i.test(prod)) continue;
    items.push({ producto: prod, empaque: empCol >= 0 ? String(r[empCol] ?? '').trim() : null, empaques: empqCol >= 0 ? toNum(r[empqCol]) : 0, kg, fruta: frutaCol >= 0 ? toNum(r[frutaCol]) : 0 });
  }
  return items;
}

async function main() {
  await supabase.from('calibres_dia').delete().neq('part_id', '00000000-0000-0000-0000-000000000000');
  await supabase.from('producto_dia').delete().neq('part_id', '00000000-0000-0000-0000-000000000000');
  console.log('Cleared old data');

  const { data: partes } = await supabase.from('partes_diarios').select('id, date, user_id').order('date', { ascending: false });
  console.log(`Found ${partes.length} partes`);

  for (const parte of partes) {
    const { data: archivos } = await supabase.from('partes_archivos').select('id, file_name, file_path').eq('part_id', parte.id);

    let calibres = [], producto = [];

    for (const f of archivos) {
      const name = f.file_name ?? '';
      const { data: blob } = await supabase.storage.from('partes-archivos').download(f.file_path);
      if (!blob) continue;

      const bytes = new Uint8Array(await blob.arrayBuffer());
      let wb;
      try { wb = XLSX.read(bytes, { type: 'array' }); } catch { continue; }
      const rowsAll = [];
      for (const sn of wb.SheetNames) {
        const ws = wb.Sheets[sn];
        rowsAll.push(...XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: null }));
      }

      const lower = name.toLowerCase();

      // Full calibre+clase+grupo file: "tamaños, calidad y clase por variedad"
      if (lower.includes('tamaño') && (lower.includes('calidad') || lower.includes('clase') || lower.includes('variedad'))) {
        const items = parseCalidad(rowsAll);
        calibres.push(...items);
      }
      // Simple tamaños file: "tamaños.xlsx" only
      else if (/\.xlsx$/.test(name) && lower.includes('tamaño') && !lower.includes('calidad') && !lower.includes('clase') && !lower.includes('variedad')) {
        const items = parseTamanos(rowsAll);
        calibres.push(...items);
      }
      // Producto file
      else if (lower.includes('producto')) {
        producto = parseProducto(rowsAll);
      }
    }

    if (calibres.length > 0) {
      // Dedup: calidad entries (with kg+clase) are parsed first; 
      // skip duplicate (grupo, calibre, clase) from simple tamanos files
      const seen = new Set();
      const deduped = [];
      for (const c of calibres) {
        const key = (c.grupo_destino || '') + '|' + (c.calibre || '') + '|' + (c.clase || '');
        if (!seen.has(key)) { seen.add(key); deduped.push(c); }
      }

      await supabase.from('calibres_dia').delete().eq('part_id', parte.id).eq('source', 'ia');
      const rows = deduped.map(i => ({
        part_id: parte.id, user_id: parte.user_id, source: 'ia',
        calibre: i.calibre || '—', clase: i.clase || null,
        kg: i.kg || 0, piezas: i.piezas || 0, pct: i.pct || 0,
        grupo_destino: i.grupo_destino || null,
      }));
      const { error } = await supabase.from('calibres_dia').insert(rows);
      if (error) console.error(`  Error calibres (${parte.date}): ${error.message}`);
      else console.log(`  ${parte.date}: ${rows.length} calibres (deduped from ${calibres.length})`);
    }

    if (producto.length > 0) {
      await supabase.from('producto_dia').delete().eq('part_id', parte.id).eq('source', 'ia');
      const rows = producto.map(i => ({
        part_id: parte.id, user_id: parte.user_id, source: 'ia',
        linea: null, producto: i.producto || null,
        formato_caja: i.empaque || null,
        kg: i.kg || 0, n_cajas: i.empaques || 0,
        grupo_destino: null,
      }));
      const { error } = await supabase.from('producto_dia').insert(rows);
      if (error) console.error(`  Error producto (${parte.date}): ${error.message}`);
      else console.log(`  ${parte.date}: ${rows.length} productos`);
    }
  }

  const { count: cc } = await supabase.from('calibres_dia').select('*', { count: 'exact', head: true });
  const { count: pc } = await supabase.from('producto_dia').select('*', { count: 'exact', head: true });
  console.log(`\nTotal: calibres_dia=${cc}, producto_dia=${pc}`);
}

main().catch(e => console.error('FATAL:', e));

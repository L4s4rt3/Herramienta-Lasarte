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
  const n = parseFloat(s);
  return isFinite(n) ? n : 0;
}

// Parse "tamaños.xlsx" — section-based: EXPORTACION / MUJERES / NO COMERCIAL / NO EXPORTACION
// Each section has Tamaño + Piezas columns
function parseTamanos(rows) {
  const items = [];
  let currentGrupo = null;
  let inTamanos = false;
  let piezasCol = -1;
  let tamCol = -1;
  
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] ?? [];
    const c1 = norm(r[1] ?? '');
    const c6 = norm(r[6] ?? '');
    
    // Detect section header in column 1: EXPORTACION, MUJERES, NO COMERCIAL, NO EXPORTACION
    if ((c1 === 'exportacion' || c1 === 'mujeres' || c1 === 'no comercial' || c1 === 'no exportacion') &&
        norm(r[2] ?? '') === '' && norm(r[3] ?? '') === '' && norm(r[4] ?? '') === '') {
      currentGrupo = c1;
      inTamanos = false;
      piezasCol = -1;
      tamCol = -1;
      continue;
    }
    
    // Detect header row: Tamaño (col 1) + Piezas (col 6)
    if (c1 === 'tamano' && c6 === 'piezas') {
      inTamanos = true;
      piezasCol = 6;
      tamCol = 1;
      continue;
    }
    
    // Extract data rows within a section
    if (inTamanos && currentGrupo) {
      const calibreVal = String(r[tamCol] ?? '').trim();
      if (!calibreVal) continue;
      if (/^(total|subtotal)/i.test(calibreVal)) continue;
      const piezas = toNum(r[piezasCol]);
      if (calibreVal.startsWith('(') && piezas > 0) {
        items.push({ calibre: calibreVal, grupo_destino: currentGrupo, piezas });
      }
    }
    
    // End of section: blank row resets
    if (inTamanos && !c1 && !norm(r[6] ?? '')) {
      inTamanos = false;
    }
  }
  return items;
}

// Parse "tamaños, calidad y clase por variedad.xlsx"
// Calidad (Extra, I, II...) sections with Tamaño entries
function parseCalidad(rows) {
  const items = [];
  let currentCalidad = null;
  let currentClase = null;
  let inTamanos = false;
  let variedad = '';
  
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] ?? [];
    const c1 = norm(r[1] ?? '');
    const c3 = norm(r[3] ?? '');
    const c6 = norm(r[6] ?? '');
    const c7 = norm(r[7] ?? '');
    
    // Extract variety
    if (c1 === 'variedad:') {
      variedad = String(r[2] ?? '').trim();
      continue;
    }
    
    // Extract calidad number
    if (c1 === 'calidad:' && norm(r[7] ?? '') !== '') {
      const calNum = String(r[7] ?? '').trim();
      // Next row has the quality name like "(A) Extra 1"
      if (i + 1 < rows.length) {
        const nextRow = rows[i + 1] ?? [];
        const calidadName = String(nextRow[6] ?? '').trim();
        if (calidadName) {
          currentCalidad = calidadName;
          currentClase = calidadName.replace(/^\([A-Z]\)\s*/, '').trim(); // "Extra 1", "Extra 2", "Cat1 A", etc.
          inTamanos = false;
        }
      }
      continue;
    }
    
    // Detect "Clase:" header
    if (c3 === 'clase:') {
      inTamanos = false;
      continue;
    }
    
    // Detect "Tamaño" header
    if (c3 === 'tamano') {
      inTamanos = true;
      continue;
    }
    
    // Extract calibre entries within this calidad
    if (inTamanos && currentClase && c3) {
      const calibre = String(r[3] ?? '').trim();
      if (calibre && calibre.startsWith('(')) {
        items.push({ calibre, clase: currentClase, calidad: currentCalidad, variedad });
      }
    }
  }
  return items;
}

// Parse "producto.xlsx" — Producto + Peso(kg)
// Headers: Producto, Empaque, Empaques, Peso(kg), Fruta
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
    items.push({
      producto: prod,
      empaque: empCol >= 0 ? String(r[empCol] ?? '').trim() : null,
      empaques: empqCol >= 0 ? toNum(r[empqCol]) : 0,
      kg,
      fruta: frutaCol >= 0 ? toNum(r[frutaCol]) : 0,
    });
  }
  return items;
}

async function main() {
  // First, clear old data
  await supabase.from('calibres_dia').delete().neq('part_id', '00000000-0000-0000-0000-000000000000');
  await supabase.from('producto_dia').delete().neq('part_id', '00000000-0000-0000-0000-000000000000');
  console.log('Cleared old data');

  const { data: partes } = await supabase.from('partes_diarios').select('id, date, user_id').order('date', { ascending: false });
  console.log(`Found ${partes.length} partes`);

  for (const parte of partes) {
    const { data: archivos } = await supabase.from('partes_archivos')
      .select('id, file_name, file_path').eq('part_id', parte.id);

    let calibresItems = [];
    let productoItems = [];

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
      
      if (/tamaño|tamano|clase|calidad|calibre/i.test(lower)) {
        if (/tamaños?\.xlsx$/.test(name) && !/clase|calidad|calibre|variedad/i.test(name)) {
          // Simple tamaños file - group + piezas
          console.log(`  [${name}] rows: ${rowsAll.length}, sample row7:`, (rowsAll[7] ?? []).slice(0,6).map(c => JSON.stringify(c)).join('|'));
          const items = parseTamanos(rowsAll);
          console.log(`  [${name}] parseTamanos: ${items.length} items`);
          calibresItems.push(...items.map(i => ({ ...i, source_file: 'tamanos' })));
        } else {
          // Full calidad file - clase + calibre
          console.log(`  [${name}] rows: ${rowsAll.length}, sample row8:`, (rowsAll[8] ?? []).slice(0,8).map(c => JSON.stringify(c)).join('|'));
          const items = parseCalidad(rowsAll);
          console.log(`  [${name}] parseCalidad: ${items.length} items`);
          calibresItems.push(...items.map(i => ({ ...i, source_file: 'calidad' })));
        }
      } else if (/producto/i.test(name)) {
        productoItems = parseProducto(rowsAll);
      }
    }

    // Merge: for each calibre in 'calidad', try to find matching group in 'tamanos'
    // We can't directly merge here, so we store what we have
    // calibresItems has items from both sources
    // We'll store each calibre with its available data

    if (calibresItems.length > 0) {
      // Delete old data for this parte
      await supabase.from('calibres_dia').delete().eq('part_id', parte.id).eq('source', 'ia');
      
      // Insert from 'tamanos' source (has grupo + piezas)
      const tamanosItems = calibresItems.filter(i => i.source_file === 'tamanos');
      if (tamanosItems.length > 0) {
        const rows = tamanosItems.map(i => ({
          part_id: parte.id, user_id: parte.user_id, source: 'ia',
          calibre: i.calibre || '—', clase: null,
          kg: 0, piezas: i.piezas || 0, pct: 0,
          grupo_destino: i.grupo_destino || null,
        }));
        const { error } = await supabase.from('calibres_dia').insert(rows);
        if (error) console.error(`  Error insert calibres(tamanos): ${error.message}`);
      }
      
      // Insert from 'calidad' source (has clase + calibre)
      const calidadItems = calibresItems.filter(i => i.source_file === 'calidad');
      if (calidadItems.length > 0) {
        const rows = calidadItems.map(i => ({
          part_id: parte.id, user_id: parte.user_id, source: 'ia',
          calibre: i.calibre || '—', clase: i.clase || null,
          kg: 0, piezas: 0, pct: 0,
          grupo_destino: null,
        }));
        const { error } = await supabase.from('calibres_dia').insert(rows);
        if (error) console.error(`  Error insert calibres(calidad): ${error.message}`);
      }
      
      console.log(`  ${parte.date}: ${tamanosItems.length} tamanos + ${calidadItems.length} calidad calibres`);
    }

    if (productoItems.length > 0) {
      await supabase.from('producto_dia').delete().eq('part_id', parte.id).eq('source', 'ia');
      const rows = productoItems.map(i => ({
        part_id: parte.id, user_id: parte.user_id, source: 'ia',
        linea: null, producto: i.producto || null,
        formato_caja: i.empaque || null,
        kg: i.kg || 0, n_cajas: i.empaques || null,
        grupo_destino: null,
      }));
      const { error } = await supabase.from('producto_dia').insert(rows);
      if (error) console.error(`  Error insert producto: ${error.message}`);
      console.log(`  ${parte.date}: ${productoItems.length} productos`);
    }
  }
  
  // Verify
  const { data: calCount } = await supabase.from('calibres_dia').select('id', { count: 'exact' });
  const { data: prodCount } = await supabase.from('producto_dia').select('id', { count: 'exact' });
  console.log(`\nTotal: calibres_dia=${calCount?.length || 0}, producto_dia=${prodCount?.length || 0}`);
}

main().catch(e => console.error('FATAL:', e));

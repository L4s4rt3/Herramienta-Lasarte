import { createClient } from '@supabase/supabase-js';
import * as XLSX from 'xlsx';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

function norm(s) { return String(s ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim(); }
function toNum(v) {
  if (v == null) return 0;
  if (typeof v === 'number') return isFinite(v) ? v : 0;
  let s = String(v).trim().replace(/\s/g, '');
  if (!s) return 0;
  const hasComma = s.includes(',');
  const hasDot = s.includes('.');
  if (hasComma && hasDot) s = s.replace(/\./g, '').replace(',', '.');
  else if (hasComma) s = s.replace(',', '.');
  const n = parseFloat(s);
  return isFinite(n) ? n : 0;
}

function extractCalibresDetalle(rows) {
  let claseCol = -1, grupoCol = -1, pesoKgCol = -1, calibreCol = -1, piezasCol = -1, pctCol = -1;
  for (let i = 0; i < Math.min(rows.length, 80); i++) {
    const r = rows[i] ?? [];
    for (let j = 0; j < r.length; j++) {
      const c = norm(r[j]);
      if (/^(clase|calidad|categoria|category)$/.test(c)) claseCol = j;
      if (/^(grupo|destino|clasificacion|denominacion)$/.test(c)) grupoCol = j;
      if (/^peso\s*\(?\s*kg\s*\)?\s*$|^total\s*kg$|^kg$|^kilos$/.test(c)) pesoKgCol = j;
      if (/^(tamaño|tamano|calibre|talla|size)$/.test(c)) calibreCol = j;
      if (/^(piezas|cantidad|unidades)$/.test(c)) piezasCol = j;
      if (/^(%|pct|porcentaje|percent)$/.test(c)) pctCol = j;
    }
  }
  if (claseCol < 0 && grupoCol < 0 && calibreCol < 0) return [];
  if (pesoKgCol < 0) pesoKgCol = 100;
  const items = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i] ?? [];
    if (r.every(c => c == null || String(c).trim() === '')) continue;
    const kg = pesoKgCol < r.length ? toNum(r[pesoKgCol]) : 0;
    if (kg <= 0 && claseCol < 0 && grupoCol < 0) continue;
    const clase = claseCol >= 0 && claseCol < r.length ? String(r[claseCol] ?? '').trim() : null;
    const grupo = grupoCol >= 0 && grupoCol < r.length ? String(r[grupoCol] ?? '').trim() : null;
    const calibre = calibreCol >= 0 && calibreCol < r.length ? String(r[calibreCol] ?? '').trim() : null;
    const piezas = piezasCol >= 0 && piezasCol < r.length ? toNum(r[piezasCol]) : 0;
    const pct = pctCol >= 0 && pctCol < r.length ? toNum(r[pctCol]) : 0;
    if (!clase && !grupo && !calibre && kg <= 0) continue;
    const esHeader = /^(clase|calidad|variedad|grupo|destino|peso|kg|total|calibre|tamaño|piezas|%)$/i.test(clase || '');
    if (esHeader) continue;
    if (clase && /\b(total|subtotal)\b/i.test(clase)) continue;
    if (kg > 0 || (clase && !/^\d+$/.test(clase))) {
      items.push({ calibre: calibre || '—', clase: clase || null, kg, piezas, pct, grupo_destino: grupo || null });
    }
  }
  return items;
}

function extractProductoDetalle(rows) {
  let productoCol = -1, formatoCol = -1, pesoKgCol = -1, cajasCol = -1, grupoCol = -1, lineaCol = -1;
  for (let i = 0; i < Math.min(rows.length, 80); i++) {
    const r = rows[i] ?? [];
    for (let j = 0; j < r.length; j++) {
      const c = norm(r[j]);
      if (/^(producto|articulo|descripcion)$/.test(c)) productoCol = j;
      if (/^(empaque|formato|formato_caja|tipo_caja|envase|packaging)$/.test(c)) formatoCol = j;
      if (/^peso\s*\(?\s*kg\s*\)?\s*$|^total\s*kg$|^kg$|^kilos$/.test(c)) pesoKgCol = j;
      if (/^(cajas|empaques|bultos|unidades)$/.test(c)) cajasCol = j;
      if (/^(grupo|destino|grupo_destino|clasificacion|mercado)$/.test(c)) grupoCol = j;
      if (/^(linea|line|maquina|linea_envasado)$/.test(c)) lineaCol = j;
    }
  }
  if (productoCol < 0 && formatoCol < 0) return [];
  if (pesoKgCol < 0) return [];
  const items = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i] ?? [];
    if (r.every(c => c == null || String(c).trim() === '')) continue;
    const kg = toNum(r[pesoKgCol]);
    if (kg <= 0) continue;
    const producto = productoCol >= 0 ? String(r[productoCol] ?? '').trim() : null;
    const formato = formatoCol >= 0 ? String(r[formatoCol] ?? '').trim() : null;
    const cajas = cajasCol >= 0 ? toNum(r[cajasCol]) : 0;
    const grupo = grupoCol >= 0 ? String(r[grupoCol] ?? '').trim() : null;
    const linea = lineaCol >= 0 ? String(r[lineaCol] ?? '').trim() : null;
    if (producto && /\b(total|subtotal)\b/i.test(producto)) continue;
    if (producto && /^(producto|articulo|descripcion|empaque|formato|peso|cajas|grupo|destino|linea)$/i.test(producto)) continue;
    items.push({ linea: linea || null, producto: producto || null, formato_caja: formato || null, kg, n_cajas: cajas || null, grupo_destino: grupo || null });
  }
  return items;
}

async function main() {
  // Get all partes that have pending/analizado state
  const { data: partes, error: pErr } = await supabase
    .from('partes_diarios')
    .select('id, date, user_id')
    .order('date', { ascending: false });
  if (pErr) { console.error('Error getting partes:', pErr); return; }
  console.log(`Found ${partes.length} partes`);

  for (const parte of partes) {
    console.log(`\n=== ${parte.date} (${parte.id}) ===`);
    
    // Get files for this parte
    const { data: archivos, error: aErr } = await supabase
      .from('partes_archivos')
      .select('id, file_name, file_path, file_type')
      .eq('part_id', parte.id);
    if (aErr) { console.error('  Error getting files:', aErr); continue; }
    
    let calibres = [];
    let producto = [];
    
    for (const f of archivos) {
      const name = (f.file_name ?? '').toLowerCase();
      if (!/tamaño|tamano|clase|calidad|producto|empaque|envase|packing|formato/i.test(name)) continue;
      
      const { data: blob, error: dlErr } = await supabase.storage.from('partes-archivos').download(f.file_path);
      if (dlErr || !blob) { console.log(`  Cannot download ${f.file_name}: ${dlErr?.message}`); continue; }
      
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let wb;
      try { wb = XLSX.read(bytes, { type: 'array' }); } catch (e) { console.log(`  XLSX error ${f.file_name}: ${e.message}`); continue; }
      
      const rowsAll = [];
      for (const sn of wb.SheetNames) {
        const ws = wb.Sheets[sn];
        rowsAll.push(...XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: null }));
      }
      
      const cal = extractCalibresDetalle(rowsAll);
      if (cal.length > 0) { calibres = calibres.concat(cal); console.log(`  ${f.file_name}: ${cal.length} calibres`); }
      
      const prod = extractProductoDetalle(rowsAll);
      if (prod.length > 0) { producto = producto.concat(prod); console.log(`  ${f.file_name}: ${prod.length} productos`); }
    }
    
    if (calibres.length === 0 && producto.length === 0) {
      console.log('  No data extracted');
      continue;
    }
    
    // Delete old data
    await supabase.from('calibres_dia').delete().eq('part_id', parte.id).eq('source', 'ia');
    await supabase.from('producto_dia').delete().eq('part_id', parte.id).eq('source', 'ia');
    
    // Insert new data
    if (calibres.length > 0) {
      const rows = calibres.map(r => ({
        part_id: parte.id, user_id: parte.user_id, source: 'ia',
        calibre: r.calibre || '—', clase: r.clase || null,
        kg: r.kg || 0, piezas: r.piezas || 0, pct: r.pct || 0,
        grupo_destino: r.grupo_destino || null,
      }));
      const { error: insErr } = await supabase.from('calibres_dia').insert(rows);
      if (insErr) console.error(`  Error inserting calibres: ${insErr.message}`);
      else console.log(`  Inserted ${rows.length} calibres`);
    }
    
    if (producto.length > 0) {
      const rows = producto.map(r => ({
        part_id: parte.id, user_id: parte.user_id, source: 'ia',
        linea: r.linea || null, producto: r.producto || null,
        formato_caja: r.formato_caja || null,
        kg: r.kg || 0, n_cajas: r.n_cajas || null,
        grupo_destino: r.grupo_destino || null,
      }));
      const { error: insErr } = await supabase.from('producto_dia').insert(rows);
      if (insErr) console.error(`  Error inserting producto: ${insErr.message}`);
      else console.log(`  Inserted ${rows.length} productos`);
    }
  }
  
  console.log('\n=== DONE ===');
}

main().catch(e => console.error('FATAL:', e));

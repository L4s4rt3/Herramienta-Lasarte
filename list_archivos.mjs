import { createClient } from '@supabase/supabase-js';

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_ANON_KEY;

const supabase = createClient(URL, KEY);

async function main() {
  console.log('Testing connection...');
  const { data: files, error } = await supabase
    .from('partes_archivos')
    .select('id, file_name, file_type, part_id')
    .limit(100);
  
  if (error) {
    console.log('ERROR:', JSON.stringify(error, null, 2));
    return;
  }
  console.log(`Count: ${files?.length || 0}`);
  for (const f of files || []) {
    console.log(`${f.id}\t${f.file_type ?? 'null'}\t${f.part_id}\t${f.file_name}`);
  }
}

main().catch(e => console.error(e));

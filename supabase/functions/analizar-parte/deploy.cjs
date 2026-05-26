const fs = require('fs');
const path = require('path');

const PROJECT_REF = process.env.SUPABASE_PROJECT_REF;
const MGMT_TOKEN = process.env.SUPABASE_MGMT_TOKEN;
const FUNCTION_SLUG = 'analizar-parte';

async function main() {
  const filePath = path.resolve(__dirname, 'supabase', 'functions', 'analizar-parte', 'index.ts');
  // Resolve from CWD
  const p = 'C:\\Users\\luiso\\OneDrive\\Escritorio\\Herramienta-Lasarte-main\\supabase\\functions\\analizar-parte\\index.ts';
  const code = fs.readFileSync(p, 'utf-8');
  
  console.log(`Read ${code.length} bytes from local file`);
  
  const url = `https://api.supabase.com/v1/projects/${PROJECT_REF}/functions/${FUNCTION_SLUG}/deploy`;
  
  const body = {
    name: FUNCTION_SLUG,
    verify_jwt: true,
    entrypoint_path: 'supabase/functions/analizar-parte/index.ts',
    body: code,
  };
  
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${MGMT_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  
  if (res.ok) {
    const result = await res.json();
    console.log('Deploy successful!');
    console.log('Version:', result.version);
    console.log('Status:', result.status);
  } else {
    const errText = await res.text();
    console.log('Deploy failed:', res.status, errText.slice(0, 500));
  }
}

main().catch(e => console.error('FATAL:', e));

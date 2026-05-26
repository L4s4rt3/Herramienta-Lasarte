async function main() {
  // Check Supabase edge function secrets/variables
  const headers = { 'Authorization': `Bearer ${process.env.SUPABASE_MGMT_TOKEN}` };
  
  // Try to get function details
  let res = await fetch(`https://api.supabase.com/v1/projects/${process.env.SUPABASE_PROJECT_REF}/functions/analizar-parte`, { headers });
  if (res.ok) {
    const data = await res.json();
    console.log('Function:', JSON.stringify(data, null, 2));
  } else {
    console.log(`Function details: ${res.status} ${await res.text()}`);
  }
  
  // Check secrets (variable names only, values are hidden)
  res = await fetch(`https://api.supabase.com/v1/projects/${process.env.SUPABASE_PROJECT_REF}/secrets`, { headers });
  if (res.ok) {
    const data = await res.json();
    console.log('Secrets:', JSON.stringify(data, null, 2));
  } else {
    console.log(`Secrets check: ${res.status} ${await res.text()}`);
  }
  
  // Check if the edge function has been deployed
  res = await fetch(`https://${process.env.SUPABASE_PROJECT_REF}.supabase.co/functions/v1/analizar-parte`, {
    method: 'GET',
    headers: { 'Authorization': `Bearer ${process.env.SUPABASE_ANON_KEY}` },
  });
  console.log(`\nEdge function HTTP GET: ${res.status}`);
}

main().catch(e => console.error('FATAL:', e));

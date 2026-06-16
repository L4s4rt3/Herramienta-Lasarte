import * as XLSX from "https://esm.sh/xlsx@0.18.5";
import { unzipSync, zipSync } from "https://esm.sh/fflate@0.8.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { data_base64 } = await req.json();
    if (!data_base64 || typeof data_base64 !== "string") {
      return json({ error: "data_base64 requerido" }, 400);
    }

    const bytes = base64ToBytes(data_base64);
    // Convertir DEFLATE64 real a DEFLATE
    let converted = deflate64ToDeflate(bytes);
    if (converted === bytes) converted = repairXlsx(bytes);
    const wb = XLSX.read(converted, { type: "array" });

    const result: Record<string, unknown[][]> = {};
    for (const sn of wb.SheetNames) {
      const ws = wb.Sheets[sn];
      result[sn] = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, blankrows: false, defval: null });
    }

    return json({ sheet_names: wb.SheetNames, data: result });
  } catch (e) {
    console.error("parse-excel", e);
    return json({ error: e instanceof Error ? e.message : "Error" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function deflate64ToDeflate(bytes: Uint8Array): Uint8Array {
  try {
    const unzipped = unzipSync(bytes);
    return zipSync(unzipped, { level: 6 });
  } catch { return bytes; }
}

function repairXlsx(bytes: Uint8Array): Uint8Array {
  let start = 0;
  for (let i = 0; i < Math.min(bytes.length - 4, 65536); i++) {
    if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 0x03 && bytes[i + 3] === 0x04) {
      start = i; break;
    }
  }
  const buf = start === 0 ? new Uint8Array(bytes) : new Uint8Array(bytes.slice(start));
  for (let i = 0; i < buf.length - 30; i++) {
    if (buf[i] === 0x50 && buf[i + 1] === 0x4b && buf[i + 2] === 0x03 && buf[i + 3] === 0x04) {
      const method = buf[i + 8] | (buf[i + 9] << 8);
      if (method !== 0 && method !== 8) { buf[i + 8] = 8; buf[i + 9] = 0; }
      const fnLen = buf[i + 26] | (buf[i + 27] << 8);
      const exLen = buf[i + 28] | (buf[i + 29] << 8);
      i += 30 + fnLen + exLen - 1;
    }
  }
  for (let i = 0; i < buf.length - 46; i++) {
    if (buf[i] === 0x50 && buf[i + 1] === 0x4b && buf[i + 2] === 0x01 && buf[i + 3] === 0x02) {
      const method = buf[i + 10] | (buf[i + 11] << 8);
      if (method !== 0 && method !== 8) { buf[i + 10] = 8; buf[i + 11] = 0; }
      const fnLen = buf[i + 28] | (buf[i + 29] << 8);
      const exLen = buf[i + 30] | (buf[i + 31] << 8);
      const cmLen = buf[i + 32] | (buf[i + 33] << 8);
      i += 46 + fnLen + exLen + cmLen - 1;
    }
  }
  return buf;
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface PaletDetalle {
  producto?: unknown;
  es_campo?: boolean;
  kg_neto?: unknown;
}

interface ResumenIa {
  palets_detalle?: PaletDetalle[];
}

interface ParteConResumen {
  id: string;
  resumen_ia: string | ResumenIa | null;
}

interface PaletDb {
  id: string;
  producto?: unknown;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "No autorizado" }, 401);

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

    // 1. Obtener todos los partes con resumen_ia
    const { data: partesData, error: pErr } = await admin
      .from("partes_diarios")
      .select("id, resumen_ia, kg_palets_brutos, kg_palets_campo")
      .not("resumen_ia", "is", null);

    if (pErr) return json({ error: pErr.message }, 500);
    const partes = (partesData ?? []) as ParteConResumen[];
    if (!partes || partes.length === 0) return json({ message: "No hay partes con resumen_ia" });

    const re = /CAMPO|DEL CAMPO|DE CAMPO|CAMPI/i;
    let paletsMarcados = 0;
    let partesActualizados = 0;

    for (const parte of partes) {
      const ia = typeof parte.resumen_ia === "string" ? JSON.parse(parte.resumen_ia) : parte.resumen_ia;
      if (!ia || !Array.isArray(ia.palets_detalle)) continue;

      let changed = false;
      let kgCampo = 0;

      for (const palet of ia.palets_detalle) {
        const prod = String(palet.producto ?? "");
        if (re.test(prod) && !palet.es_campo) {
          palet.es_campo = true;
          changed = true;
          paletsMarcados++;
          kgCampo += Number(palet.kg_neto) || 0;
        }
      }

      if (changed) {
        const updates: Record<string, unknown> = { resumen_ia: ia };
        if (kgCampo > 0) updates.kg_palets_campo = kgCampo;
        await admin.from("partes_diarios").update(updates).eq("id", parte.id);
        partesActualizados++;
      }

      // 2. Tambien actualizar palets_dia si existen
      const { data: paletsDbData } = await admin
        .from("palets_dia")
        .select("id, producto")
        .eq("part_id", parte.id)
        .is("campo", false);
      const paletsDb = (paletsDbData ?? []) as PaletDb[];
      if (paletsDb) {
        const ids = paletsDb.filter((p) => re.test(String(p.producto ?? ""))).map((p) => p.id);
        if (ids.length > 0) {
          await admin.from("palets_dia").update({ campo: true }).in("id", ids);
        }
      }
    }

    return json({
      message: `Backfill completado`,
      palets_marcados: paletsMarcados,
      partes_actualizados: partesActualizados,
    });
  } catch (e) {
    console.error("backfill-campo", e);
    return json({ error: e instanceof Error ? e.message : "Error" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "No autorizado" }, 401);

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

    // 1. Marcar palets existentes como campo si producto contiene CAMPO
    const { data: palets, error: pErr } = await admin
      .from("palets_dia")
      .select("id, part_id, producto, kg_neto")
      .or("producto.ilike.%CAMPO%,producto.ilike.%DEL CAMPO%,producto.ilike.%DE CAMPO%")
      .is("campo", false);

    if (pErr) return json({ error: pErr.message }, 500);
    if (!palets || palets.length === 0) return json({ message: "No hay palets de campo pendientes", actualizados: 0 });

    // 2. Actualizar flag campo=true en palets_dia
    const ids = palets.map((p: any) => p.id);
    const { error: upErr } = await admin.from("palets_dia").update({ campo: true }).in("id", ids);
    if (upErr) return json({ error: upErr.message }, 500);

    // 3. Agrupar por part_id para actualizar partes_diarios
    const porParte: Record<string, number> = {};
    for (const p of palets) {
      porParte[p.part_id] = (porParte[p.part_id] || 0) + (Number(p.kg_neto) || 0);
    }

    let actualizados = 0;
    for (const [partId, kgCampo] of Object.entries(porParte)) {
      const updates: Record<string, any> = { kg_palets_campo: kgCampo };

      // 4. También actualizar resumen_ia.palets_detalle[].es_campo para el análisis diario
      const { data: parte } = await admin.from("partes_diarios").select("id, resumen_ia").eq("id", partId).maybeSingle();
      if (parte?.resumen_ia) {
        const ia = typeof parte.resumen_ia === "string" ? JSON.parse(parte.resumen_ia) : parte.resumen_ia;
        if (Array.isArray(ia.palets_detalle)) {
          let changed = false;
          for (const palet of ia.palets_detalle) {
            const prod = String(palet.producto ?? "");
            if (/CAMPO|DEL CAMPO|DE CAMPO|CAMPI/i.test(prod) && !palet.es_campo) {
              palet.es_campo = true;
              changed = true;
            }
          }
          if (changed) updates.resumen_ia = ia;
        }
      }

      const { error: up2Err } = await admin.from("partes_diarios").update(updates).eq("id", partId);
      if (!up2Err) actualizados++;
    }

    return json({
      message: `Backfill completado`,
      palets_marcados: palets.length,
      partes_actualizados: actualizados,
    });
  } catch (e) {
    console.error("backfill-campo", e);
    return json({ error: e instanceof Error ? e.message : "Error" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

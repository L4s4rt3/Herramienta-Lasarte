/**
 * AnalizeWithAI.tsx — Botón "Analizar con IA"
 *
 * Corrige:
 * 1. Edge function ahora GUARDA los datos (no solo devuelve)
 * 2. No sobreescribe datos manuales que el usuario ya ingresó
 * 3. Recalcula cascada después de actualizar
 * 4. Actualiza análisis diario
 */

import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { computeCascade } from "@/lib/cascade";
import { toast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Loader2, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

interface AnalysisSuccessPayload {
  parte: unknown;
  cascada: ReturnType<typeof computeCascade>;
  detalles: unknown;
}

interface Props {
  parte_id: string;
  current_data: {
    kg_produccion_calibrador: number;
    kg_mujeres_calibrador: number;
    kg_palets_brutos: number;
    kg_podrido_calibrador_auto: number;
    kg_industria_manual: number;
    kg_reciclado_malla_z1: number;
    kg_reciclado_malla_z2: number;
    kg_inventario_sin_alta: number;
    kg_podrido_bolsa_basura: number;
    kg_inventario_anterior_sin_alta: number;
  };
  on_success?: (updated_data: AnalysisSuccessPayload) => void;
}

export function AnalizeWithAI({ parte_id, current_data, on_success }: Props) {
  const [loading, setLoading] = useState(false);

  async function handleAnalyze() {
    setLoading(true);
    try {
      // ── 1. Llamar edge function ──────────────────────────────────────────
      const { data: edgeResp, error: edgeErr } = await supabase.functions.invoke(
        "analizar-parte",
        { body: { part_id: parte_id } }
      );

      if (edgeErr || !edgeResp?.parte_actualizado) {
        toast({
          title: "Error del análisis IA",
          description: edgeResp?.error || edgeErr?.message,
          variant: "destructive",
        });
        return;
      }

      // ── 2. Re-fetch parte para tener datos actualizados ───────────────────
      const { data: parte, error: fetchErr } = await supabase
        .from("partes_diarios")
        .select("*")
        .eq("id", parte_id)
        .maybeSingle();

      if (fetchErr || !parte) {
        toast({
          title: "Error al cargar datos actualizados",
          variant: "destructive",
        });
        return;
      }

      // ── 3. Calcular cascada con datos actualizados ────────────────────────
      const paletsCascada = (parte.kg_palets_brutos || 0) - (parte.kg_palets_egipto || 0);
      const cascada = computeCascade({
        kg_produccion_calibrador: parte.kg_produccion_calibrador || 0,
        kg_mujeres_calibrador: parte.kg_mujeres_calibrador || 0,
        kg_palets_brutos: paletsCascada,
        kg_podrido_calibrador: parte.kg_podrido_calibrador_auto || 0,
        kg_industria_manual: parte.kg_industria_manual || 0,
        kg_reciclado_malla_z1: parte.kg_reciclado_malla_z1 || 0,
        kg_reciclado_malla_z2: parte.kg_reciclado_malla_z2 || 0,
        kg_inventario_sin_alta: parte.kg_inventario_sin_alta || 0,
        kg_podrido_bolsa_basura: parte.kg_podrido_bolsa_basura || 0,
        kg_inventario_anterior_sin_alta: parte.kg_inventario_anterior_sin_alta || 0,
        kg_exportacion: parte.kg_exportacion || 0,
        kg_mercado: parte.kg_mercado || 0,
        kg_industria_destino: parte.kg_industria_destino || 0,
        tph_promedio: parte.tph_promedio || undefined,
      });

      // ── 4. Actualizar resumen_ia con cascada calculada ────────────────────
      const updated_ia = {
        ...(parte.resumen_ia || {}),
        cascada: {
          produccion_real: cascada.produccion_real,
          palets_ajustados: cascada.palets_ajustados,
          diferencia_bruta: cascada.diferencia_bruta,
          mermas_totales: cascada.mermas_totales,
          dsj: cascada.dsj,
          dsj_pct: cascada.dsj_pct,
          semaforo: cascada.semaforo,
          rendimiento_comercial: cascada.rendimiento_comercial_pct,
        },
      };

      const { error: updateErr } = await supabase
        .from("partes_diarios")
        .update({ resumen_ia: updated_ia })
        .eq("id", parte_id);

      if (updateErr) {
        console.error("Error guardando cascada:", updateErr);
        // No mostrar error al usuario, los datos se actualizaron igual
      }

      // ── 5. Callback para que padre actualice UI ──────────────────────────
      if (on_success) {
        on_success({
          parte,
          cascada,
          detalles: edgeResp.detalles_insertados,
        });
      }

      toast({
        title: "✅ Análisis completado",
        description: `${edgeResp.datos_guardados} campos actualizados, ${edgeResp.detalles_insertados.lotes} lotes detectados`,
      });
    } catch (e: unknown) {
      toast({
        title: "Error inesperado",
        description: e instanceof Error ? e.message : "Error inesperado",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button
      onClick={handleAnalyze}
      disabled={loading}
      className="gap-2"
      variant="default"
    >
      {loading ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" />
          Analizando archivos…
        </>
      ) : (
        <>
          <Sparkles className="h-4 w-4" />
          Analizar con IA
        </>
      )}
    </Button>
  );
}

export default AnalizeWithAI;

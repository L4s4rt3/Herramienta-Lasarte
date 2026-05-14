/**
 * CascadeDisplay.tsx — Muestra cascada en tiempo real
 *
 * Se suscribe a cambios en partes_diarios y actualiza automáticamente
 * cuando se hace "Analizar con IA" o se modifican datos manuales.
 */

import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { computeCascade } from "@/lib/cascade";
import { CascadeView } from "@/components/CascadeView";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, AlertCircle, CheckCircle } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  parte_id: string;
  class_name?: string;
}

export function CascadeDisplay({ parte_id, class_name }: Props) {
  const [cascada, setCascada] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  async function fetchAndCompute() {
    try {
      setLoading(true);
      setError(null);

      const { data: parte, error: fetchErr } = await supabase
        .from("partes_diarios")
        .select("*")
        .eq("id", parte_id)
        .maybeSingle();

      if (fetchErr) {
        setError(`Error: ${fetchErr.message}`);
        return;
      }

      if (!parte) {
        setError("Parte no encontrado");
        return;
      }

      // Calcular cascada
      const result = computeCascade({
        kg_produccion_calibrador: parte.kg_produccion_calibrador || 0,
        kg_mujeres_calibrador: parte.kg_mujeres_calibrador || 0,
        kg_palets_brutos: parte.kg_palets_brutos || 0,
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

      setCascada(result);
      setLastUpdate(new Date());
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  // Cargar inicial
  useEffect(() => {
    fetchAndCompute();
  }, [parte_id]);

  // Suscribirse a cambios en tiempo real
  useEffect(() => {
    const channel = supabase
      .channel(`parte:${parte_id}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "partes_diarios",
          filter: `id=eq.${parte_id}`,
        },
        () => {
          // Refetch cuando el parte cambio
          fetchAndCompute();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [parte_id]);

  if (loading && !cascada) {
    return (
      <div className={cn("flex items-center justify-center py-8", class_name)}>
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground mr-2" />
        <span className="text-sm text-muted-foreground">Calculando cascada…</span>
      </div>
    );
  }

  if (error) {
    return (
      <Card className={cn("border-destructive/50 bg-destructive/5", class_name)}>
        <CardContent className="flex items-center gap-3 py-4">
          <AlertCircle className="h-5 w-5 text-destructive shrink-0" />
          <span className="text-sm text-destructive">{error}</span>
        </CardContent>
      </Card>
    );
  }

  if (!cascada) {
    return null;
  }

  return (
    <Card className={class_name}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <CardTitle className="text-base">Cascada DJPMN</CardTitle>
            {lastUpdate && (
              <span className="text-xs text-muted-foreground">
                Actualizado hace {getTimeAgo(lastUpdate)}
              </span>
            )}
          </div>
          {cascada.semaforo === "verde" && (
            <CheckCircle className="h-5 w-5 text-success" />
          )}
        </div>
      </CardHeader>
      <CardContent>
        <CascadeView result={cascada} />
      </CardContent>
    </Card>
  );
}

function getTimeAgo(date: Date): string {
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins === 0) return "justo ahora";
  if (mins === 1) return "1 minuto";
  if (mins < 60) return `${mins} minutos`;
  const hours = Math.floor(mins / 60);
  if (hours === 1) return "1 hora";
  return `${hours} horas`;
}

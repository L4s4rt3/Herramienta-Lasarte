/**
 * useCalidadProductores — indexa TODOS los controles de calidad (calidad_lotes)
 * por productor/finca para poder contrastarlos con el aprovechamiento Mercadona
 * en la pestaña de "Aprovechamiento por productor".
 *
 * El cruce productor↔calidad se hace por nombre normalizado (normalizeNombre:
 * minúsculas + sin acentos + trim), igual criterio que el resto de cruces
 * calidad↔productor de la app, porque lotes_dia.productor viene en mayúsculas
 * ("INVERMARMELO") y calidad_lotes.productor_finca_nombre con capitalización
 * normal ("Invermarmelo").
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { normalizeNombre } from "@/hooks/useProductores";
import type { CalidadEstado, CalidadInformeEstado } from "@/lib/calidad";
import type { CalidadInformeLote } from "@/components/CalidadInformeDialog";

export interface CalidadControlProductor {
  id: string;
  fecha: string;
  numeroLote: string;
  productor: string;
  producto: string;
  variedad: string;
  calidad: string;
  defectos: string[];
  observacion: string;
  accionRecomendada: string;
  /** Shape completo para <CalidadInformeDialog>. */
  informe: CalidadInformeLote;
}

/** Índice de controles de calidad agrupados por productor normalizado. */
export type CalidadPorProductor = Map<string, CalidadControlProductor[]>;

function useCalidadControles() {
  const query = useQuery({
    queryKey: ["calidad-controles-todos"],
    queryFn: async (): Promise<CalidadControlProductor[]> => {
      const { data, error } = await supabase
        .from("calidad_lotes")
        .select(
          "id, fecha, numero_lote, productor_finca_nombre, producto, variedad, cantidad, hora, calidad, defectos, defecto_otro, observacion, accion_recomendada, informe_generado, informe_estado, aerobotics_realizado, validado_at, validado_by",
        )
        .order("fecha", { ascending: false });
      if (error) throw error;

      return (data ?? []).map((row): CalidadControlProductor => {
        const defectos = row.defectos ?? [];
        return {
          id: row.id,
          fecha: row.fecha,
          numeroLote: row.numero_lote,
          productor: row.productor_finca_nombre || "Sin productor",
          producto: row.producto || "Sin producto",
          variedad: row.variedad || "",
          calidad: row.calidad,
          defectos,
          observacion: row.observacion || "",
          accionRecomendada: row.accion_recomendada || "",
          informe: {
            id: row.id,
            fecha: row.fecha,
            numero_lote: row.numero_lote ?? "",
            productor_finca_nombre: row.productor_finca_nombre ?? "",
            producto: row.producto,
            variedad: row.variedad,
            cantidad: row.cantidad,
            hora: row.hora,
            calidad: row.calidad as CalidadEstado,
            defectos,
            defecto_otro: row.defecto_otro,
            observacion: row.observacion,
            accion_recomendada: row.accion_recomendada,
            informe_estado: (row.informe_estado as CalidadInformeEstado) ?? "borrador",
            informe_generado: row.informe_generado,
            aerobotics_realizado: row.aerobotics_realizado,
            validado_at: row.validado_at,
            validado_by: row.validado_by,
          },
        };
      });
    },
  });

  return { controles: query.data ?? [], isLoading: query.isLoading, error: query.error };
}

export function useCalidadProductores() {
  const { controles, isLoading } = useCalidadControles();

  const porProductor = useMemo<CalidadPorProductor>(() => {
    const map: CalidadPorProductor = new Map();
    for (const c of controles) {
      const key = normalizeNombre(c.productor);
      if (!key) continue;
      const list = map.get(key) ?? [];
      list.push(c);
      map.set(key, list);
    }
    return map;
  }, [controles]);

  return { porProductor, isLoading };
}

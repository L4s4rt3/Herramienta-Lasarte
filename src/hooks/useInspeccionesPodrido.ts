/**
 * useInspeccionesPodrido — muestreos manuales de podrido por lote
 * (podrido_inspecciones, migración 20260727120000). Cálculo determinista en
 * src/lib/podridoInspecciones.ts; aquí solo lectura por lote y alta/baja.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthProvider";
import { supabase } from "@/integrations/supabase/client";
import { toError } from "@/lib/errorMessage";
import { esErrorTablaOColumnaInexistente } from "@/lib/productoresCanonicos";
import { normalizarLoteCodigo } from "@/lib/loteCodigo";
import type { InspeccionPodridoCalculo } from "@/lib/podridoInspecciones";

// Tabla nueva sin tipos generados: mismo cast puntual que el resto de hooks.

export interface InspeccionPodridoRow {
  id: string;
  lote: string;
  fecha: string;
  peso_naranja_g: number | null;
  kg_por_box: number | null;
  naranjas_por_box: number | null;
  podridas_por_box: number[];
  naranjas_inspeccionadas: number;
  naranjas_podridas: number;
  /** Fracción 0-1. */
  pct_podrido: number;
  notas: string | null;
}

export function useInspeccionesPodrido(lote: string) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const lote8 = normalizarLoteCodigo(lote) ?? lote;
  const key = ["podrido-inspecciones", lote8] as const;

  const query = useQuery({
    queryKey: key,
    queryFn: async (): Promise<InspeccionPodridoRow[]> => {
      try {
        const { data, error } = await supabase
          .from("podrido_inspecciones")
          .select("*")
          .eq("lote", lote8)
          .order("fecha", { ascending: false })
          .order("created_at", { ascending: false });
        if (error) throw toError(error);
        return (data ?? []).map((r: Record<string, unknown>) => ({
          id: String(r.id),
          lote: String(r.lote),
          fecha: String(r.fecha),
          peso_naranja_g: r.peso_naranja_g == null ? null : Number(r.peso_naranja_g),
          kg_por_box: r.kg_por_box == null ? null : Number(r.kg_por_box),
          naranjas_por_box: r.naranjas_por_box == null ? null : Number(r.naranjas_por_box),
          podridas_por_box: Array.isArray(r.podridas_por_box) ? (r.podridas_por_box as number[]).map(Number) : [],
          naranjas_inspeccionadas: Number(r.naranjas_inspeccionadas) || 0,
          naranjas_podridas: Number(r.naranjas_podridas) || 0,
          pct_podrido: Number(r.pct_podrido) || 0,
          notas: (r.notas as string | null) ?? null,
        }));
      } catch (e) {
        // Migración 20260727120000 sin aplicar: la sección queda vacía sin romper la ficha.
        if (esErrorTablaOColumnaInexistente(e)) return [];
        throw e;
      }
    },
    enabled: Boolean(user) && Boolean(lote8),
  });

  const crear = useMutation({
    mutationFn: async (params: {
      fecha: string;
      pesoNaranjaG: number;
      kgPorBox: number;
      calculo: InspeccionPodridoCalculo;
      notas: string | null;
    }) => {
      if (!user) throw new Error("No auth");
      const { error } = await supabase.from("podrido_inspecciones").insert({
        user_id: user.id,
        lote: lote8,
        fecha: params.fecha,
        peso_naranja_g: params.pesoNaranjaG,
        kg_por_box: params.kgPorBox,
        naranjas_por_box: params.calculo.naranjasPorBox,
        podridas_por_box: params.calculo.porBox.map((b) => b.podridas),
        naranjas_inspeccionadas: params.calculo.naranjasInspeccionadas,
        naranjas_podridas: params.calculo.naranjasPodridas,
        pct_podrido: params.calculo.pctPodrido,
        notas: params.notas,
      });
      if (error) {
        if (esErrorTablaOColumnaInexistente(error)) {
          throw new Error("La tabla podrido_inspecciones todavía no existe: aplica primero la migración 20260727120000_podrido_bateas_e_inspecciones.sql.");
        }
        throw toError(error);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: key });
    },
  });

  const eliminar = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("podrido_inspecciones").delete().eq("id", id);
      if (error) throw toError(error);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: key });
    },
  });

  return {
    inspecciones: query.data ?? [],
    isLoading: query.isLoading,
    crear,
    eliminar,
  };
}

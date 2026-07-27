/**
 * useCamarasExternas — camiones en cámaras externas (Guadex/Zamexfruit).
 * Lee camara_externa_camiones (migración 20260727100000) y expone el import
 * del registro de la cámara (upsert por procedencia + s_ref: reimportar el
 * mismo registro actualiza en vez de duplicar). El ESTADO de cada camión no
 * vive aquí ni en la BD: se deriva en src/lib/camarasExternas.ts con las
 * señales del resto de la app (pasadas de calibrador, salidas de cámara).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useAuth } from "@/contexts/AuthProvider";
import { supabase } from "@/integrations/supabase/client";
import { toError } from "@/lib/errorMessage";
import { fetchAllRows } from "@/lib/fetchAllRows";
import { esErrorTablaOColumnaInexistente } from "@/lib/productoresCanonicos";
import type { CamionCamaraExterna } from "@/lib/camarasExternas";

// camara_externa_camiones aún no está en los tipos generados (types.ts):
// mismo patrón de cast puntual que useEntradasBascula.ts.
const SUPA = supabase as unknown as SupabaseClient<any>;

export type CamionCamaraExternaRow = CamionCamaraExterna & { id: string };

const CHUNK = 200;

export function useCamarasExternas() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const key = ["camara_externa_camiones"] as const;

  const query = useQuery({
    queryKey: key,
    queryFn: async (): Promise<CamionCamaraExternaRow[]> => {
      try {
        return await fetchAllRows<CamionCamaraExternaRow>((from, to) =>
          SUPA
            .from("camara_externa_camiones")
            .select("*")
            .order("fecha_almacenamiento", { ascending: true })
            .order("id", { ascending: true })
            .range(from, to),
        );
      } catch (e) {
        // Migración 20260727100000 sin aplicar: la sección simplemente no
        // muestra datos (sin romper la pestaña de stock).
        if (esErrorTablaOColumnaInexistente(e)) return [];
        throw e;
      }
    },
    enabled: Boolean(user),
  });

  const importar = useMutation({
    mutationFn: async (registros: CamionCamaraExterna[]): Promise<{ importados: number }> => {
      if (!user) throw new Error("No auth");
      if (registros.length === 0) throw new Error("El archivo no contiene camiones importables.");
      for (let i = 0; i < registros.length; i += CHUNK) {
        const chunk = registros.slice(i, i + CHUNK).map((r) => ({ ...r, user_id: user.id, updated_at: new Date().toISOString() }));
        const { error } = await SUPA
          .from("camara_externa_camiones")
          .upsert(chunk, { onConflict: "procedencia,s_ref" });
        if (error) {
          if (esErrorTablaOColumnaInexistente(error)) {
            throw new Error("La tabla camara_externa_camiones todavía no existe: aplica primero la migración 20260727100000_camara_externa_camiones.sql.");
          }
          throw toError(error);
        }
      }
      return { importados: registros.length };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: key });
    },
  });

  return {
    camiones: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error,
    importar,
  };
}

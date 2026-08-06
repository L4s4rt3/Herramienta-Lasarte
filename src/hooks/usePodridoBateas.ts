/**
 * usePodridoBateas — vaciados de las bateas de la tría de un periodo, ya
 * valorados al coste medio de compra de la fruta (encargo del dueño
 * 06-ago-2026). Toda la lógica vive en src/lib/podridoBateas.ts; aquí solo
 * está el fetch.
 *
 * El €/kg medio se lo pasa quien llama (EconomicoCostes ya tiene el agregado
 * de useCosteFruta del MISMO periodo): así no se hace dos veces la consulta
 * de entradas de báscula ni se reimplementa la regla de importe.
 *
 * Degradado: si la columna kg_podrido_bateas todavía no existe (migración
 * 20260727120000 sin aplicar), la query cae a lista vacía y la tarjeta
 * simplemente no enseña nada — nunca rompe la página de costes.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthProvider";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/fetchAllRows";
import { esErrorTablaOColumnaInexistente } from "@/lib/productoresCanonicos";
import {
  agregarPodridoBateas, type CostePodridoBateas, type VaciadoBateaInput,
} from "@/lib/podridoBateas";

export function usePodridoBateas(
  desde: string,
  hasta: string,
  costeMedioKg: number | null,
): { data: CostePodridoBateas; isLoading: boolean } {
  const { user } = useAuth();

  const query = useQuery({
    queryKey: ["podrido-bateas", desde, hasta] as const,
    queryFn: async (): Promise<VaciadoBateaInput[]> => {
      try {
        return await fetchAllRows<VaciadoBateaInput>((from, to) =>
          supabase
            .from("partes_diarios")
            .select("date, kg_podrido_bateas")
            .gte("date", desde)
            .lte("date", hasta)
            .order("date")
            .range(from, to) as unknown as PromiseLike<{ data: VaciadoBateaInput[] | null; error: unknown }>,
        );
      } catch (e) {
        if (esErrorTablaOColumnaInexistente(e)) return [];
        throw e;
      }
    },
    enabled: Boolean(user),
  });

  const data = useMemo(
    () => agregarPodridoBateas(query.data ?? [], desde, hasta, costeMedioKg),
    [query.data, desde, hasta, costeMedioKg],
  );

  return { data, isLoading: query.isLoading };
}

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useDebounce } from "@/hooks/useDebounce";

export type SearchResult = {
  id: string;
  type: "parte" | "productor" | "pagina";
  label: string;
  subtitle: string;
  to: string;
};

export function useGlobalSearch(query: string) {
  const debounced = useDebounce(query, 300);

  return useQuery({
    queryKey: ["global-search", debounced],
    queryFn: async (): Promise<SearchResult[]> => {
      if (!debounced || debounced.length < 2) return [];

      const results: SearchResult[] = [];

      const { data: productores } = await supabase
        .from("productores")
        .select("id, nombre, apellidos")
        .or(`nombre.ilike.%${debounced}%,apellidos.ilike.%${debounced}%`)
        .limit(5);

      if (productores) {
        for (const p of productores) {
          results.push({
            id: p.id,
            type: "productor",
            label: `${p.nombre} ${p.apellidos}`,
            subtitle: "Productor",
            to: `/productores/${p.id}`,
          });
        }
      }

      const { data: partes } = await supabase
        .from("partes_diarios")
        .select("id, date")
        .ilike("date", `%${debounced}%`)
        .limit(5);

      if (partes) {
        for (const p of partes) {
          results.push({
            id: p.id,
            type: "parte",
            label: `Parte ${p.date}`,
            subtitle: `Parte diario`,
            to: `/partes/${p.id}`,
          });
        }
      }

      return results;
    },
    enabled: debounced.length >= 2,
    staleTime: 30_000,
  });
}

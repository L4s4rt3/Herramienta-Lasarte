import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useDebounce } from "@/hooks/useDebounce";
import { toISODateLocal } from "@/lib/format";

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
        .from("calidad_productores")
        .select("id, nombre")
        .ilike("nombre", `%${debounced}%`)
        .limit(5);

      if (productores) {
        for (const p of productores) {
          results.push({
            id: p.id,
            type: "productor",
            label: p.nombre,
            subtitle: "Productor",
            // No existe ruta de detalle /productores/:id; se enlaza al listado.
            to: `/productores`,
          });
        }
      }

      // partes_diarios.date es una columna DATE: no admite `ilike` (operador de texto).
      // Si el texto buscado parece una fecha (YYYY, YYYY-MM o YYYY-MM-DD) se consulta por rango.
      const dateMatch = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/.exec(debounced.trim());
      if (dateMatch) {
        const [, y, mo, d] = dateMatch;
        let from: string;
        let toExclusive: string;
        if (mo && d) {
          from = `${y}-${mo}-${d}`;
          toExclusive = toISODateLocal(new Date(Number(y), Number(mo) - 1, Number(d) + 1));
        } else if (mo) {
          from = `${y}-${mo}-01`;
          toExclusive = toISODateLocal(new Date(Number(y), Number(mo), 1));
        } else {
          from = `${y}-01-01`;
          toExclusive = `${Number(y) + 1}-01-01`;
        }

        const { data: partes } = await supabase
          .from("partes_diarios")
          .select("id, date")
          .gte("date", from)
          .lt("date", toExclusive)
          .order("date", { ascending: false })
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
      }

      return results;
    },
    enabled: debounced.length >= 2,
    staleTime: 30_000,
  });
}

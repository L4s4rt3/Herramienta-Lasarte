import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useDebounce } from "@/hooks/useDebounce";
import { formatDate, toISODateLocal } from "@/lib/format";

export type SearchResult = {
  id: string;
  type: "parte" | "productor" | "pagina" | "lote";
  label: string;
  subtitle: string;
  to: string;
};

// Tope de resultados por tipo en el desplegable de búsqueda global (Ctrl+K):
// es un top-N deliberado para que la lista quepa en la paleta, NO el recorte
// silencioso de PostgREST a 1.000 filas (ese es cosa de SELECTs sin acotar —
// ver fetchAllRows/src/lib/fetchAllRows.ts). Cada consulta de aquí ya pide
// como mucho esto con .limit(), a propósito.
const TOP_POR_TIPO = 6;

export function useGlobalSearch(query: string) {
  const debounced = useDebounce(query, 300);

  return useQuery({
    queryKey: ["global-search", debounced],
    queryFn: async (): Promise<SearchResult[]> => {
      if (!debounced || debounced.length < 2) return [];

      const results: SearchResult[] = [];

      // LOTES por código: entradas_bascula.lote es el código canónico
      // (AAMMDDNN) que consume /trazabilidad?lote= — mismo campo que usan
      // TrazabilidadLote.tsx / useTrazabilidadLote.ts para abrir la ficha
      // (.eq("lote", codigo)). El código es siempre numérico: si el texto no
      // trae ningún dígito no puede coincidir con nada y nos ahorramos la
      // consulta (mismo espíritu que el date-match de más abajo para partes).
      if (/\d/.test(debounced)) {
        const { data: lotes } = await supabase
          .from("entradas_bascula")
          .select("lote, finca, articulo, fecha")
          .ilike("lote", `%${debounced}%`)
          .order("fecha", { ascending: false })
          .limit(TOP_POR_TIPO);

        if (lotes) {
          for (const l of lotes) {
            results.push({
              id: l.lote,
              type: "lote",
              label: `Lote ${l.lote}`,
              subtitle: [l.finca, l.articulo, formatDate(l.fecha)].filter(Boolean).join(" · ") || "Entrada de fruta",
              to: `/trazabilidad?lote=${encodeURIComponent(l.lote)}`,
            });
          }
        }
      }

      const { data: productores } = await supabase
        .from("calidad_productores")
        .select("id, nombre")
        .ilike("nombre", `%${debounced}%`)
        .limit(TOP_POR_TIPO);

      if (productores) {
        for (const p of productores) {
          results.push({
            id: p.id,
            type: "productor",
            label: p.nombre,
            subtitle: "Productor",
            // La página soporta ?productor= para preseleccionar el dossier
            // (ver Productores.tsx: queryProductor = searchParams.get("productor")).
            to: `/productores?productor=${encodeURIComponent(p.nombre)}`,
          });
        }
      }

      // partes_diarios.date es una columna DATE: no admite `ilike` (operador de texto).
      // Si el texto buscado parece una fecha (YYYY, YYYY-MM o YYYY-MM-DD) se consulta por rango.
      // Nota: NO se busca parte por texto de productor. partes_diarios es un
      // resumen por día sin columna de productor/agricultor; cruzarlo exigiría
      // calidad_productores -> entradas_bascula.agricultor (o
      // lotes_dia.productor_id) -> fecha -> partes_diarios, un cruce de 3
      // pasos poco fiable para relanzar en cada tecla de la búsqueda. Se deja
      // fuera (anotado aquí en vez de adivinar un cruce).
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
          .limit(TOP_POR_TIPO);

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

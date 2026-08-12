/**
 * useDestinoFrutaProductor — a qué clientes fue la fruta de un productor, según
 * el ERP.
 *
 * CÓMO SE CASA LA IDENTIDAD, QUE ES LO DELICADO. No se compara ni un nombre. La
 * `productorKey` del dossier (ver resolveProductorGroupKey en
 * productoresCanonicos.ts) es `id:<uuid>` cuando el productor está en el
 * catálogo, y entonces se filtra `entradas_bascula` por `productor_id`, que es
 * exactamente la columna que rellenan los triggers canónicos. Solo si la clave
 * es `nombre:<texto>` —productor sin resolver en el catálogo— se filtra por el
 * texto crudo, que es justo lo que esa clave significa.
 *
 * De ahí salen los CÓDIGOS DE LOTE del productor, y el código de lote es el
 * puente con el ERP: es único en `entradas_bascula` y es el mismo que el ERP
 * guarda en `agri_produc_mp_pt.lote_mp`.
 *
 * Comprobado contra las dos bases el 10-08-2026: de los 775 lotes que el ERP usa
 * como origen, 765 están en la app y los 765 tienen `productor_id` (99,95% de
 * los kilos); y el mapeo proveedor-del-ERP ↔ productor-de-la-app es una
 * biyección (43 ↔ 43), sin ninguno partido ni juntado. Ver
 * docs/ERP_LR_INFORMATICA.md.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/fetchAllRows";
import {
  fichaDestinoLotes,
  type FichaDestinoEntrada,
  type OrigenConfeccionFila,
  type PaletErpFila,
} from "@/lib/trazabilidadErp";

const TANDA = 200;
const COLUMNAS_PALET = "numero, lote_confeccion, kg_netos, cliente, importe_venta, fecha_venta";

/** Trocea los `.in(...)`: una lista larga revienta la URL de PostgREST. */
async function enTandas<T>(valores: string[], consulta: (trozo: string[]) => Promise<T[]>): Promise<T[]> {
  const salida: T[] = [];
  for (let i = 0; i < valores.length; i += TANDA) {
    salida.push(...(await consulta(valores.slice(i, i + TANDA))));
  }
  return salida;
}

export function useDestinoFrutaProductor(productorKey: string | null) {
  const query = useQuery({
    queryKey: ["destino-fruta-productor", productorKey],
    enabled: Boolean(productorKey),
    queryFn: async (): Promise<FichaDestinoEntrada | null> => {
      const key = productorKey as string;

      // 1. Los lotes de entrada del productor, por identidad canónica.
      const filtro = supabase.from("entradas_bascula").select("lote");
      const { data: entradas, error: errEntradas } = key.startsWith("id:")
        ? await filtro.eq("productor_id", key.slice(3))
        : await filtro.eq("agricultor", key.slice("nombre:".length));
      if (errEntradas) throw new Error(errEntradas.message);
      const lotes = (entradas ?? []).map((e) => e.lote as string);
      if (lotes.length === 0) return null;

      // 2. En qué lotes de confección se usaron.
      const enlaces = await enTandas(lotes, async (trozo) => {
        const { data, error } = await supabase
          .from("erp_confeccion_origen").select("lote_confeccion").in("lote_entrada", trozo);
        if (error) throw new Error(error.message);
        return (data ?? []) as { lote_confeccion: string }[];
      });
      const lotesConf = [...new Set(enlaces.map((e) => e.lote_confeccion))];
      if (lotesConf.length === 0) return null;

      // 3. TODOS los orígenes de esos lotes (el reparto necesita el
      //    denominador completo) y sus palets, paginados.
      const [origenes, palets] = await Promise.all([
        enTandas(lotesConf, async (trozo) => {
          const { data, error } = await supabase
            .from("erp_confeccion_origen").select("*").in("lote_confeccion", trozo);
          if (error) throw new Error(error.message);
          return (data ?? []) as OrigenConfeccionFila[];
        }),
        enTandas(lotesConf, (trozo) =>
          fetchAllRows<PaletErpFila>((from, to) =>
            supabase
              .from("erp_palet")
              .select(COLUMNAS_PALET)
              .in("lote_confeccion", trozo)
              .order("numero")
              .range(from, to) as unknown as PromiseLike<{ data: PaletErpFila[] | null; error: unknown }>,
          ),
        ),
      ]);

      return fichaDestinoLotes(lotes, origenes, palets);
    },
  });

  return { ficha: query.data ?? null, isLoading: query.isLoading, error: query.error };
}

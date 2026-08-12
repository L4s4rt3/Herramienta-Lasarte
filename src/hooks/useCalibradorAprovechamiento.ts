/**
 * useCalibradorAprovechamiento — aprovechamiento del calibrador por productor.
 *
 * De dónde salen los datos: del volcado SQL del Compac Sizer
 * (calibrador_clasificacion, ver docs/ERP_LR_INFORMATICA.md y
 * scripts/README-receptor-calibrador.md). La agregación la hace la RPC
 * `calibrador_aprovechamiento_productor` en la base: son ~228.000 filas y no
 * tiene sentido traerlas al navegador para sumarlas aquí.
 *
 * DOS COSAS QUE LA RPC RESUELVE Y CONVIENE SABER:
 *
 * 1. Solo cuenta `batch_id > 0`, es decir el volcado SQL completo. Las filas
 *    con batch_id = 0 vienen de un informe DOCX suelto y solo cubren la ÚLTIMA
 *    pasada del lote — 225 de 864 lotes pasan por la máquina más de una vez, así
 *    que mezclarlas dejaría los kilos cortos.
 *
 * 2. El productor se resuelve por CÓDIGO DE LOTE contra entradas_bascula y su
 *    productor_id canónico, nunca por nombre (los alias de finca darían
 *    atribuciones falsas — ver src/lib/productoresCanonicos.ts).
 *
 * LOS KILOS QUE NO SE PUEDEN ATRIBUIR SE VEN (migración 20260812090000). Hay
 * pasadas cuyo BatchName no lleva ningún grupo de 8 dígitos ("22/07 22 BOX -
 * 23/07 43 BOX"): son kilos reales que la máquina clasificó, pero sin lote no
 * hay productor al que apuntarlos. La RPC los devuelve agrupados y este hook
 * los separa en `sinAtribuir` para que la pantalla los enseñe aparte — antes se
 * perdían en un JOIN y el total salía 142.073 kg corto sin decirlo.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  aplicarReparto,
  type CapacidadLote,
  type DuenoLote,
  type FilaProductor,
  type PasadaConDesglose,
  type PasadaEnCola,
} from "@/lib/calibradorReparto";

export interface AprovechamientoProductor {
  productor_id: string | null;
  productor: string;
  lotes: number;
  kg_total: number;
  kg_exportacion: number;
  kg_no_exportacion: number;
  kg_industria: number;
  kg_mujeres: number;
  kg_otros: number;
  pct_exportacion: number | null;
}

const num = (v: unknown): number => Number(v) || 0;

/**
 * La fila del hueco no es un productor: no debe competir en el ranking ni
 * ensuciar la media de exportación, pero SÍ tiene que verse (se saca aparte).
 */
const esHueco = (p: AprovechamientoProductor) =>
  p.productor_id == null && p.productor.startsWith("(sin lote legible");

/** Pasadas cuyo nombre dice que se echó algo más, atribuidas enteras al primer lote. */
export interface DesgloseSinRepartir {
  pasadas: number;
  kg: number;
  pasadas_varios_lotes: number;
}

export function useCalibradorAprovechamiento(desde?: string | null, hasta?: string | null) {
  const desglose = useQuery({
    queryKey: ["calibrador-desglose-sin-repartir", desde ?? null, hasta ?? null],
    queryFn: async (): Promise<DesgloseSinRepartir | null> => {
      const { data, error } = await supabase.rpc("calibrador_desglose_sin_repartir", {
        desde: desde ?? null,
        hasta: hasta ?? null,
      });
      if (error) throw new Error(error.message);
      const r = data?.[0];
      if (!r || num(r.pasadas) === 0) return null;
      return {
        pasadas: num(r.pasadas),
        kg: num(r.kg),
        pasadas_varios_lotes: num(r.pasadas_varios_lotes),
      };
    },
  });

  const query = useQuery({
    queryKey: ["calibrador-aprovechamiento", desde ?? null, hasta ?? null],
    queryFn: async (): Promise<AprovechamientoProductor[]> => {
      const { data, error } = await supabase.rpc("calibrador_aprovechamiento_productor", {
        desde: desde ?? null,
        hasta: hasta ?? null,
      });
      if (error) throw new Error(error.message);
      return (data ?? []).map((r) => ({
        productor_id: r.productor_id ?? null,
        productor: r.productor ?? "—",
        lotes: num(r.lotes),
        kg_total: num(r.kg_total),
        kg_exportacion: num(r.kg_exportacion),
        kg_no_exportacion: num(r.kg_no_exportacion),
        kg_industria: num(r.kg_industria),
        kg_mujeres: num(r.kg_mujeres),
        kg_otros: num(r.kg_otros),
        pct_exportacion: r.pct_exportacion == null ? null : Number(r.pct_exportacion),
      }));
    },
  });

  // Las pasadas con desglose, y a quién pertenece cada lote que nombran: hace
  // falta para poder mover los kilos al productor correcto.
  const reparto = useQuery({
    queryKey: ["calibrador-reparto", desde ?? null, hasta ?? null],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("calibrador_pasadas_con_desglose", {
        desde: desde ?? null,
        hasta: hasta ?? null,
      });
      if (error) throw new Error(error.message);
      const pasadas: PasadaConDesglose[] = (data ?? []).map((p) => ({
        batch_id: num(p.batch_id), batch_name: String(p.batch_name ?? ""),
        lote: String(p.lote ?? ""), fecha: String(p.fecha ?? ""),
        kg_total: num(p.kg_total), kg_exportacion: num(p.kg_exportacion),
        kg_no_exportacion: num(p.kg_no_exportacion), kg_industria: num(p.kg_industria),
        kg_mujeres: num(p.kg_mujeres), kg_otros: num(p.kg_otros),
      }));

      const codigos = new Set<string>();
      for (const p of pasadas) {
        codigos.add(p.lote);
        for (const m of p.batch_name.matchAll(/\d{8}/g)) codigos.add(m[0]);
      }
      // Un lote puede tener VARIOS dueños: si es una re-entrada de precalibrado,
      // la RPC devuelve una fila por finca de origen con su fracción.
      const dueno = new Map<string, DuenoLote>();
      const lista = [...codigos];
      for (let i = 0; i < lista.length; i += 200) {
        const { data: d } = await supabase.rpc("productor_por_lote", { lotes: lista.slice(i, i + 200) });
        for (const r of d ?? []) {
          const lote = String(r.lote);
          dueno.set(lote, [...(dueno.get(lote) ?? []), {
            productor_id: r.productor_id ?? null,
            productor: String(r.productor ?? ""),
            fraccion: num(r.fraccion) || 1,
          }]);
        }
      }

      // Capacidad pendiente de cada lote, para repartir las pasadas que nombran
      // varios sin box. Paginado: son ~2.000 lotes y PostgREST recorta a 1.000.
      const capacidad = new Map<string, CapacidadLote>();
      for (let d = 0; ; d += 1000) {
        const { data: c, error: e } = await supabase
          .rpc("calibrador_capacidad_lotes").range(d, d + 999);
        if (e) throw new Error(e.message);
        for (const r of c ?? []) {
          capacidad.set(String(r.lote), {
            kgEntrada: num(r.kg_entrada),
            kgAtribuidoSimple: num(r.kg_atribuido_simple),
          });
        }
        if (!c || c.length < 1000) break;
      }
      return { pasadas, dueno, capacidad };
    },
  });

  const filas = query.data;

  const ajustado = useMemo(() => {
    const base = (filas ?? []).filter((p) => !esHueco(p));
    if (!reparto.data) {
      return {
        productores: base, noProductores: [] as FilaProductor[],
        kgLiberados: 0, pasadasRepartidas: 0, cola: [] as PasadaEnCola[],
      };
    }
    return aplicarReparto(base, reparto.data.pasadas, reparto.data.dueno, reparto.data.capacidad);
  }, [filas, reparto.data]);

  return {
    productores: ajustado.productores,
    /** Filas que no son un productor (precalibrado sin origen, huecos). */
    noProductores: ajustado.noProductores,
    /** Kilos que la máquina clasificó pero no se pueden atribuir a nadie. */
    sinAtribuir: filas?.find(esHueco) ?? null,
    /** Kilos atribuidos al primer lote cuando el nombre dice que hubo más. */
    desgloseSinRepartir: desglose.data ?? null,
    /** Pasadas repartidas solas y kilos que el reparto deja sin dueño. */
    pasadasRepartidas: ajustado.pasadasRepartidas,
    kgLiberadosPorReparto: ajustado.kgLiberados,
    /** Las que necesitan que alguien diga algo, con el porqué de cada una. */
    colaDesglose: ajustado.cola,
    isLoading: query.isLoading || reparto.isLoading,
    error: query.error ?? reparto.error,
  };
}

/**
 * useDiaTrazabilidad — la foto completa de UN día para el modo "Por día" del
 * selector de Trazabilidad (rediseño 21-jul-2026): qué se volcó al calibrador
 * (lotes_dia de los partes de esa fecha, en orden de hora) y qué se
 * confeccionó/expidió (palets_dia agrupados por lote de confección, con sus
 * clientes). Es el flujo real de una reclamación: "compra el día X, la fruta
 * lleva ≤3 días → mira qué se procesó y expidió el X−1..X−3".
 */
import { useQuery } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { toError } from "@/lib/errorMessage";
import { numeroDeCodigoLote, ordenarVolcadosCandidatos, type VolcadoCandidato } from "@/lib/origenConfeccion";
import { esErrorTablaOColumnaInexistente, esPaletPrecalibrado, esProductorPrecalibrado } from "@/lib/productoresCanonicos";

// palets_dia.lote_codigo puede no existir aún (migración 20260715110000):
// mismo patrón de cast/degradado que useTrazabilidadLote.ts.
const SUPA = supabase as unknown as SupabaseClient<any>;

export interface ExpedicionClienteDia {
  cliente: string;
  paletsCount: number;
  kg: number;
}

export interface ExpedicionLoteDia {
  /** Código canónico del lote de confección (AAMMDDNN), o null si los palets no traen lote. */
  lote_codigo: string | null;
  /** NN del código: nº de lote de confección del día (informativo). */
  numeroDelDia: number | null;
  paletsCount: number;
  kg: number;
  cajas: number;
  clientes: ExpedicionClienteDia[];
}

export interface DiaTrazabilidad {
  fecha: string;
  /** Volcados del calibrador ese día, en orden de hora (numerados 1..N). */
  volcados: VolcadoCandidato[];
  kgVolcados: number;
  /** Confección del día agrupada por lote de confección (null al final), mayor kg primero. paletsPrecalibrado aparte. */
  expedicion: ExpedicionLoteDia[];
  kgExpedidos: number;
  paletsCount: number;
  paletsPrecalibrado: number;
  /** false si la columna palets_dia.lote_codigo no existe todavía (bloque de expedición oculto). */
  expedicionDisponible: boolean;
  /** ids de los partes del día (enlace "ver parte"). */
  partIds: string[];
}

export function useDiaTrazabilidad(fecha: string | null) {
  const query = useQuery({
    queryKey: ["dia-trazabilidad", fecha],
    enabled: Boolean(fecha),
    queryFn: async (): Promise<DiaTrazabilidad> => {
      const dia = fecha as string;

      const { data: partes, error: partesError } = await supabase
        .from("partes_diarios")
        .select("id")
        .eq("date", dia);
      if (partesError) throw toError(partesError);
      const partIds = (partes ?? []).map((p) => p.id as string);

      if (partIds.length === 0) {
        return {
          fecha: dia, volcados: [], kgVolcados: 0, expedicion: [], kgExpedidos: 0,
          paletsCount: 0, paletsPrecalibrado: 0, expedicionDisponible: true, partIds: [],
        };
      }

      const [lotesRes, paletsRes] = await Promise.all([
        SUPA.from("lotes_dia")
          .select("lote_codigo, productor, producto, kg_peso_total, hora_inicio, created_at, kg_industria, notas")
          .in("part_id", partIds)
          .limit(500),
        SUPA.from("palets_dia")
          .select("lote_codigo, cliente, kg_neto, n_cajas, producto")
          .in("part_id", partIds)
          .limit(5000),
      ]);
      if (lotesRes.error) throw toError(lotesRes.error);

      const volcados = ordenarVolcadosCandidatos(
        ((lotesRes.data ?? []) as Array<{
          lote_codigo: string | null; productor: string | null; producto: string | null;
          kg_peso_total: number | null; hora_inicio: string | null; created_at: string | null;
          kg_industria: number | null; notas: string | null;
        }>).map((l) => ({
          lote_codigo: l.lote_codigo,
          productor: l.productor,
          producto: l.producto,
          kg: Number(l.kg_peso_total) || 0,
          hora_inicio: l.hora_inicio,
          created_at: l.created_at,
          esPrecalibrado: esProductorPrecalibrado(l.productor),
          kg_industria: Number(l.kg_industria) || 0,
          notas: l.notas,
        })),
      );

      // Expedición: degrada a "no disponible" si falta palets_dia.lote_codigo.
      let expedicion: ExpedicionLoteDia[] = [];
      let paletsPrecalibrado = 0;
      let expedicionDisponible = true;
      if (paletsRes.error) {
        if (!esErrorTablaOColumnaInexistente(paletsRes.error)) throw toError(paletsRes.error);
        expedicionDisponible = false;
      } else {
        const rows = (paletsRes.data ?? []) as Array<{
          lote_codigo: string | null; cliente: string | null; kg_neto: number | null;
          n_cajas: number | null; producto: string | null;
        }>;
        const porLote = new Map<string, ExpedicionLoteDia & { clientesMap: Map<string, ExpedicionClienteDia> }>();
        for (const row of rows) {
          if (esPaletPrecalibrado(row.producto)) { paletsPrecalibrado += 1; continue; }
          const key = row.lote_codigo ?? "";
          let acc = porLote.get(key);
          if (!acc) {
            acc = {
              lote_codigo: row.lote_codigo,
              numeroDelDia: numeroDeCodigoLote(row.lote_codigo),
              paletsCount: 0, kg: 0, cajas: 0, clientes: [], clientesMap: new Map(),
            };
            porLote.set(key, acc);
          }
          const kg = Number(row.kg_neto) || 0;
          acc.paletsCount += 1;
          acc.kg += kg;
          acc.cajas += Number(row.n_cajas) || 0;
          const cliente = row.cliente?.trim() || "Sin cliente asignado";
          const c = acc.clientesMap.get(cliente) ?? { cliente, paletsCount: 0, kg: 0 };
          c.paletsCount += 1;
          c.kg += kg;
          acc.clientesMap.set(cliente, c);
        }
        expedicion = Array.from(porLote.values())
          .map(({ clientesMap, ...resto }) => ({
            ...resto,
            clientes: Array.from(clientesMap.values()).sort((a, b) => b.kg - a.kg),
          }))
          .sort((a, b) => (a.lote_codigo === null ? 1 : 0) - (b.lote_codigo === null ? 1 : 0) || b.kg - a.kg);
      }

      return {
        fecha: dia,
        volcados,
        kgVolcados: volcados.reduce((s, v) => s + v.kg, 0),
        expedicion,
        kgExpedidos: expedicion.reduce((s, e) => s + e.kg, 0),
        paletsCount: expedicion.reduce((s, e) => s + e.paletsCount, 0),
        paletsPrecalibrado,
        expedicionDisponible,
        partIds,
      };
    },
  });

  return {
    data: query.data ?? null,
    isLoading: query.isLoading,
    error: query.error,
  };
}

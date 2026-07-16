/**
 * useMermaLote — merma natural, podrido (real/estimado) y coste real por
 * lote (ver src/lib/mermaLote.ts para las fórmulas puras y sus decisiones).
 *
 * Reutiliza useEntradasBascula() para las entradas (evita un segundo fetch de
 * la misma tabla; React Query dedupe por queryKey lo comparte con la página
 * de Entradas). Además carga en bloque:
 *   - lotes_dia: TODOS los kg de TODOS los lotes de cada parte (hace falta el
 *     total del parte, no solo el de un lote, para el denominador del
 *     prorrateo de podrido).
 *   - lote_clasificacion: para saber qué lotes tienen Informe LOTE (cualquier
 *     clase) y sumar la(s) clase(s) "Podrido" reales.
 *   - partes_diarios: solo los dos contadores de podrido del DSJ.
 *
 * Un único hook "bulk" (`useMermaLotes`) sirve tanto a la tabla "Mermas y
 * coste" (EntradasBascula.tsx) como a la ficha de un lote (TrazabilidadLote,
 * vía `useMermaLote(lote)`, que filtra el resultado en memoria).
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthProvider";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/fetchAllRows";
import { useEntradasBascula } from "@/hooks/useEntradasBascula";
import { normalizarLoteCodigo } from "@/lib/loteCodigo";
import {
  agregarMermaLotes,
  computeMermaLotes,
  type ClasificacionLoteInput,
  type EntradaLoteInput,
  type LoteDiaKgInput,
  type MermaLote,
  type ParteMermaInput,
} from "@/lib/mermaLote";

function toNum(value: unknown): number {
  return Number(value) || 0;
}
function toNumOrNull(value: unknown): number | null {
  return value == null ? null : Number(value) || 0;
}

export function useMermaLotes() {
  const { user } = useAuth();
  // `entradas` ya viene SIN los movimientos internos de precalibrado (filtro
  // aplicado dentro de useEntradasBascula.ts, cierre definitivo jul-2026: ver
  // esEntradaPrecalibrado en src/lib/productoresCanonicos.ts) — cascada
  // automática, no hace falta filtrar aquí también. Distinto de lotesDiaQuery
  // más abajo, que SÍ sigue contando las pasadas PREC del calibrador (regla
  // de esta mañana, sin cambios).
  const { entradas, isLoading: entradasLoading, error: entradasError } = useEntradasBascula();

  const lotesDiaQuery = useQuery({
    queryKey: ["merma-lote", "lotes-dia"],
    queryFn: async (): Promise<LoteDiaKgInput[]> => {
      // lotes_dia ya supera las 1.000 filas (1.187 tras el histórico de
      // campaña): .limit(50000) NO protege nada, PostgREST recorta a su
      // max-rows en silencio. Paginar con fetchAllRows (orden estable por id).
      const rows = await fetchAllRows<{ lote_codigo: string | null; kg_peso_total: number; part_id: string }>(
        (from, to) => supabase.from("lotes_dia").select("lote_codigo, kg_peso_total, part_id").order("id").range(from, to),
      );
      // El PRECALIBRADO SÍ cuenta aquí (regla revisada 2026-07-16, ver
      // src/lib/mermaLote.ts y src/lib/productoresCanonicos.ts): CERO lotes
      // de la BD tienen pasadas de ambos tipos (real y PRECALIBRADO) a la
      // vez, así que contar la pasada PREC con código de lote real no puede
      // duplicar kgCalibrador con los datos actuales, y para 52 lotes esa
      // pasada PREC es su ÚNICO registro de procesado (excluirla dejaba
      // stock/merma fantasma). Ya no se filtra por productor: cuenta TODA
      // fila de lotes_dia (y por tanto también entra en el denominador del
      // prorrateo de podrido, como cualquier otra fila).
      return rows.map((l) => ({
        lote_codigo: l.lote_codigo ?? null,
        kg_peso_total: toNum(l.kg_peso_total),
        part_id: l.part_id,
      }));
    },
    enabled: Boolean(user),
  });

  const clasificacionQuery = useQuery({
    queryKey: ["merma-lote", "clasificacion"],
    queryFn: async (): Promise<ClasificacionLoteInput[]> => {
      // lote_clasificacion tiene 8.685 filas tras el histórico: muy por
      // encima del max-rows del servidor. Mismo motivo, fetchAllRows.
      const rows = await fetchAllRows<{ lote_codigo: string | null; clase: string | null; peso_kg: number }>(
        (from, to) => supabase.from("lote_clasificacion").select("lote_codigo, clase, peso_kg").order("id").range(from, to),
      );
      return rows.map((c) => ({
        lote_codigo: c.lote_codigo ?? null,
        clase: c.clase ?? null,
        peso_kg: toNum(c.peso_kg),
      }));
    },
    enabled: Boolean(user),
  });

  const partesQuery = useQuery({
    queryKey: ["merma-lote", "partes"],
    queryFn: async (): Promise<ParteMermaInput[]> => {
      // partes_diarios va camino de las 1.000 filas (207 y creciendo): sin
      // filtro de fecha (se quiere el histórico completo), así que se pagina
      // igual por seguridad de cara al futuro en vez de esperar a que rompa.
      const partes = await fetchAllRows<{
        id: string;
        date: string | null;
        kg_podrido_calibrador_auto: number | null;
        kg_podrido_bolsa_basura: number | null;
      }>((from, to) =>
        supabase
          .from("partes_diarios")
          .select("id, date, kg_podrido_calibrador_auto, kg_podrido_bolsa_basura")
          .order("id")
          .range(from, to),
      );
      // toNumOrNull (NO toNum): un parte histórico importado (migración
      // 20260716090000) puede traer estas dos columnas a NULL a propósito
      // ("no hay dato", ver mermaLote.ts) — toNum las convertiría en un 0
      // real falso. El null se propaga tal cual para que computeMermaLotes
      // decida "desconocido".
      return partes.map((p) => ({
        part_id: p.id,
        date: p.date ?? null,
        kg_podrido_calibrador_auto: toNumOrNull(p.kg_podrido_calibrador_auto),
        kg_podrido_bolsa_basura: toNumOrNull(p.kg_podrido_bolsa_basura),
      }));
    },
    enabled: Boolean(user),
  });

  const entradasInput: EntradaLoteInput[] = useMemo(
    () => entradas.map((e) => ({
      lote: e.lote,
      fecha: e.fecha,
      kg_entrada: toNum(e.kg_entrada),
      kg_ajuste_stock: toNumOrNull(e.kg_ajuste_stock),
      importe_compra: toNumOrNull(e.importe_compra),
      coste_recoleccion: toNumOrNull(e.coste_recoleccion),
      importe_transporte: toNumOrNull(e.importe_transporte),
      importe_comision: toNumOrNull(e.importe_comision),
      importe_total: toNumOrNull(e.importe_total),
      cerrado_at: e.cerrado_at ?? null,
      cierre_modo: e.cierre_modo ?? null,
    })),
    [entradas],
  );

  const lotes: MermaLote[] = useMemo(
    () => computeMermaLotes(
      entradasInput,
      lotesDiaQuery.data ?? [],
      clasificacionQuery.data ?? [],
      partesQuery.data ?? [],
    ),
    [entradasInput, lotesDiaQuery.data, clasificacionQuery.data, partesQuery.data],
  );

  const agregado = useMemo(() => agregarMermaLotes(lotes), [lotes]);

  return {
    lotes,
    agregado,
    isLoading: entradasLoading || lotesDiaQuery.isLoading || clasificacionQuery.isLoading || partesQuery.isLoading,
    error: entradasError ?? lotesDiaQuery.error ?? clasificacionQuery.error ?? partesQuery.error,
  };
}

/** Merma/coste de UN lote (busca en el resultado bulk por código normalizado). `null` mientras carga o si el lote no tiene entrada de báscula. */
export function useMermaLote(loteInput: string | null) {
  const lote = normalizarLoteCodigo(loteInput);
  const { lotes, isLoading, error } = useMermaLotes();

  const data = useMemo(
    () => (lote ? lotes.find((l) => l.lote === lote) ?? null : null),
    [lotes, lote],
  );

  return { data, isLoading, error };
}

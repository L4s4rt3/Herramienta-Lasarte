// La CAMPAÑA por productor y finca: pérdida (merma de cámara, podrido de tría,
// podrido de calibrador, euros) y aprovechamiento de Mercadona por formato.
//
// POR QUÉ EXISTE (03-09-2026). Este análisis era scripts/analisis-mermas-
// mercadona.ts, un Excel que se regeneraba a mano cada vez que dirección
// preguntaba (cinco veces en tres semanas). Ahora es una pestaña de Entradas.
// Las funciones que hacen los números son LAS MISMAS que las del script
// (_shared/mermaMdnaAgregado.ts y _shared/mdnaMix.ts): misma cifra aquí y en
// el Excel.
//
// DE DÓNDE SALE CADA COSA
// - Merma por lote: useMermaLotes() — el mismo hook que la pestaña "Mermas y
//   coste" (React Query lo comparte, no se vuelve a cargar).
// - Identidad de cada lote (productor, finca, variedad): las entradas de
//   báscula de useEntradasBascula() + el catálogo canónico de productores.
// - Mix de clasificación por lote (destinos, clases aptas, formatos MDNA): la
//   vista materializada clasificacion_lote_mix_mv vía la RPC
//   clasificacion_mix_lotes (una sola llamada, ~15.000 filas ya pivotadas).
//   La vista se refresca cada hora; se enseña cuándo fue la última vez.
//
// LO QUE NO HACE (todavía). El script simula la campaña CERRADA (todos los
// lotes abiertos cerrados en memoria, regla del dueño 28-08) porque el
// almacén está vacío; aquí los lotes abiertos se cuentan como "sin merma
// calculable" y se listan. Cuando se cierren en la base (Entradas → cierre
// de lote), la pestaña y el Excel coincidirán al kilo.
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthProvider";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/fetchAllRows";
import { useEntradasBascula } from "@/hooks/useEntradasBascula";
import { useMermaLotes } from "@/hooks/useMermaLote";
import { esEntradaImportacion } from "@/lib/productoresCanonicos";
import { mixPorLoteDesdePivot, type FilaMixPivot, type MixLote } from "@/lib/mdnaMix";
import {
  agruparMermaMdna,
  construirFilasMermaMdna,
  esLoteImposible,
  ordenarPorMdna,
  ordenarPorPerdida,
  podridoPorMesDeProceso,
  totalMermaMdna,
  type DimensionMermaMdna,
  type FilaLoteMermaMdna,
  type FilaPodridoMes,
  type GrupoMermaMdna,
} from "@/lib/mermaMdnaAgregado";

export interface CampanaMermaMdnaOpciones {
  /** La importación (Egipto, SAF) es otro negocio: fuera por defecto (regla del dueño 28-08-2026). */
  incluirImportacion?: boolean;
}

export interface CampanaMermaMdna {
  filas: FilaLoteMermaMdna[];
  total: GrupoMermaMdna;
  porProductor: GrupoMermaMdna[];
  porFinca: GrupoMermaMdna[];
  porProductorMdna: GrupoMermaMdna[];
  porFincaMdna: GrupoMermaMdna[];
  podridoPorMes: FilaPodridoMes[];
  /** Lotes que perderían más de lo que entró (ajuste negativo a mano): apartados del año. */
  imposibles: FilaLoteMermaMdna[];
  /** Movimientos internos (precalibrado, confección): fuera de los rankings. */
  internas: FilaLoteMermaMdna[];
  /** Lotes de importación dejados fuera (o dentro, si se pidió). */
  importacion: FilaLoteMermaMdna[];
  /** Lotes sin merma calculable: siguen abiertos en la base. */
  abiertos: FilaLoteMermaMdna[];
  mixRefrescadoEn: string | null;
  lotesConMix: number;
}

/**
 * La RPC devuelve las filas como arrays POSICIONALES (5,9 MB con nombres de
 * campo → ~1,5 MB). El orden es el contrato con la migración
 * clasificacion_mix_lotes_compacta: 0 lote8, 1 producto, 2 kg_clasificado,
 * 3 kg_exportacion, 4 kg_no_exportacion, 5 kg_mujeres, 6 kg_no_comercial,
 * 7 kg_clase_apta, 8 kg_clase_podrido, 9 kg_clase_industria, 10 n_filas, 11 con_docx.
 */
type FilaMixPosicional = [string, string | null, number, number, number, number, number, number, number, number, number, boolean];

interface RespuestaMix {
  refrescado_en: string | null;
  filas: FilaMixPosicional[];
}

function aFilaPivot(f: FilaMixPosicional): FilaMixPivot {
  return {
    lote8: f[0], producto: f[1], kg_clasificado: f[2], kg_exportacion: f[3], kg_no_exportacion: f[4],
    kg_mujeres: f[5], kg_no_comercial: f[6], kg_clase_apta: f[7], kg_clase_podrido: f[8], kg_clase_industria: f[9],
  };
}

function agruparYOrdenar(filas: FilaLoteMermaMdna[], dimension: DimensionMermaMdna) {
  const grupos = agruparMermaMdna(filas, dimension);
  return { perdida: ordenarPorPerdida(grupos), mdna: ordenarPorMdna(grupos) };
}

export function useCampanaMermaMdna(opciones: CampanaMermaMdnaOpciones = {}) {
  const { user } = useAuth();
  const incluirImportacion = opciones.incluirImportacion ?? false;
  const { lotes: mermaLotes, isLoading: mermaLoading, error: mermaError } = useMermaLotes();
  const { entradas, isLoading: entradasLoading } = useEntradasBascula();

  const mixQuery = useQuery({
    queryKey: ["campana-merma-mdna", "mix"],
    queryFn: async (): Promise<{ mixPorLote: Map<string, MixLote>; refrescadoEn: string | null }> => {
      const { data, error } = await supabase.rpc("clasificacion_mix_lotes");
      if (error) throw new Error(error.message);
      const r = (data ?? { refrescado_en: null, filas: [] }) as unknown as RespuestaMix;
      return { mixPorLote: mixPorLoteDesdePivot((r.filas ?? []).map(aFilaPivot)), refrescadoEn: r.refrescado_en ?? null };
    },
    enabled: Boolean(user),
    staleTime: 15 * 60_000,
  });

  const catalogoQuery = useQuery({
    queryKey: ["campana-merma-mdna", "catalogo-productores"],
    queryFn: async () => {
      const [productores, alias] = await Promise.all([
        fetchAllRows<{ id: string; nombre: string }>((from, to) =>
          supabase.from("calidad_productores").select("id, nombre").order("id").range(from, to)),
        fetchAllRows<{ alias_normalizado: string; productor_id: string }>((from, to) =>
          supabase.from("productores_alias").select("alias_normalizado, productor_id").order("productor_id").range(from, to)),
      ]);
      return {
        nombrePorProductorId: new Map(productores.map((p) => [p.id, p.nombre])),
        aliasPorNombre: new Map(alias.map((a) => [a.alias_normalizado, a.productor_id])),
      };
    },
    enabled: Boolean(user),
    staleTime: 15 * 60_000,
  });

  const partesQuery = useQuery({
    queryKey: ["campana-merma-mdna", "partes-podrido"],
    queryFn: () => fetchAllRows<{ date: string | null; kg_podrido_bolsa_basura: number | null; kg_podrido_bateas: number | null }>(
      (from, to) => supabase.from("partes_diarios").select("date, kg_podrido_bolsa_basura, kg_podrido_bateas").order("id").range(from, to)),
    enabled: Boolean(user),
    staleTime: 15 * 60_000,
  });

  const data: CampanaMermaMdna | null = useMemo(() => {
    if (!mixQuery.data || !catalogoQuery.data) return null;
    // `entradas` ya viene sin precalibrado ni CAMPO/CIT (useEntradasBascula).
    const todas = construirFilasMermaMdna({
      mermaLotes,
      entradas: entradas.map((e) => ({
        lote: e.lote,
        agricultor: e.agricultor,
        productor_id: (e as { productor_id?: string | null }).productor_id ?? null,
        finca: e.finca,
        articulo: e.articulo,
        kg_entrada: e.kg_entrada,
      })),
      mixPorLote: mixQuery.data.mixPorLote,
      nombrePorProductorId: catalogoQuery.data.nombrePorProductorId,
      aliasPorNombre: catalogoQuery.data.aliasPorNombre,
    });
    const esImportacion = (f: FilaLoteMermaMdna) => esEntradaImportacion({ finca: f.finca, articulo: f.variedad });
    const importacion = todas.filter(esImportacion);
    const internas = todas.filter((f) => f.interno && !esImportacion(f));
    const imposibles = todas.filter((f) => !f.interno && !esImportacion(f) && esLoteImposible(f));
    const filas = todas.filter((f) => !f.interno && !esLoteImposible(f) && (incluirImportacion || !esImportacion(f)));

    const productor = agruparYOrdenar(filas, "productor");
    const finca = agruparYOrdenar(filas, "productor_finca");
    return {
      filas,
      total: totalMermaMdna(filas),
      porProductor: productor.perdida,
      porFinca: finca.perdida,
      porProductorMdna: productor.mdna,
      porFincaMdna: finca.mdna,
      podridoPorMes: podridoPorMesDeProceso(filas, partesQuery.data ?? []),
      imposibles,
      internas,
      importacion,
      abiertos: filas.filter((f) => f.mermaMedidaKg == null),
      mixRefrescadoEn: mixQuery.data.refrescadoEn,
      lotesConMix: filas.filter((f) => f.mix).length,
    };
  }, [mermaLotes, entradas, mixQuery.data, catalogoQuery.data, partesQuery.data, incluirImportacion]);

  return {
    data,
    isLoading: mermaLoading || entradasLoading || mixQuery.isLoading || catalogoQuery.isLoading || partesQuery.isLoading,
    error: mermaError ?? mixQuery.error ?? catalogoQuery.error ?? partesQuery.error,
  };
}

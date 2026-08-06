/**
 * usePasadaBoxLineas — desglose por BOX de las pasadas del calibrador
 * (tabla pasada_box_lineas, migración 20260806120000).
 *
 * Encargo del dueño 06-08-2026: introducir a mano los varios lotes que se
 * echaron en una misma pasada, con los box de cada uno, para saber cuántos kg
 * se han echado de cada lote. El cálculo vive en src/lib/desgloseBox.ts
 * (módulo puro); aquí solo está la persistencia.
 *
 * La query es GLOBAL (todas las pasadas, no las de un parte) por dos motivos:
 * el volumen es diminuto — unas pocas líneas por pasada desglosada — y el
 * cableado a la conciliación (useEntradasBascula) las necesita todas a la vez.
 * Filtrar por parte se hace en el cliente con `lineasPorLoteDia`.
 *
 * Degradado si la migración no está aplicada: TODA lectura cae a lista vacía
 * (esErrorTablaOColumnaInexistente) y la app se comporta exactamente igual que
 * antes de existir esta función; solo al intentar GUARDAR se avisa con un
 * mensaje que dice qué migración falta. Mismo patrón que las anotaciones de
 * pasada (useEntradasBascula.ts).
 */
import { useCallback, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useAuth } from "@/contexts/AuthProvider";
import { supabase } from "@/integrations/supabase/client";
import { toError } from "@/lib/errorMessage";
import { escribirConReintentos, fetchAllRows } from "@/lib/fetchAllRows";
import { esEntradaPrecalibrado, esErrorTablaOColumnaInexistente } from "@/lib/productoresCanonicos";
import {
  normalizarBoxTamano,
  type BoxTamano,
  type LineaDesglose,
  type ReentradaPrecCandidata,
  type TipoLineaDesglose,
} from "@/lib/desgloseBox";

// pasada_box_lineas aún no está en el Database generado (migración pendiente
// de aplicar): cliente sin esquema tipado, mismo patrón que pasada_anotaciones.
const SUPA = supabase as unknown as SupabaseClient<any>;

export const MENSAJE_MIGRACION_BOX_LINEAS =
  "La tabla pasada_box_lineas todavía no existe: aplica primero la migración 20260806120000_pasada_box_lineas.sql.";

export interface PasadaBoxLineaRow {
  id: string;
  user_id: string;
  lote_dia_id: string;
  posicion: number;
  tipo: TipoLineaDesglose;
  lote_codigo: string | null;
  prec_fecha: string | null;
  box: number | null;
  box_tamano: BoxTamano;
  nota: string | null;
}

/** Fila de báscula que necesita el desglose: validar códigos y contrastar kg/box. */
export interface EntradaParaDesglose extends ReentradaPrecCandidata {
  agricultor: string | null;
  articulo: string | null;
}

/** Una fila guardada, en la forma que consume el motor de reparto. */
export function lineaDesdeRow(row: PasadaBoxLineaRow): LineaDesglose {
  return {
    tipo: row.tipo,
    lote_codigo: row.lote_codigo,
    prec_fecha: row.prec_fecha,
    box: row.box == null ? null : Number(row.box),
    box_tamano: normalizarBoxTamano(row.box_tamano),
    nota: row.nota,
  };
}

/**
 * Clave y fetch compartidos: useEntradasBascula los reutiliza para inyectar el
 * desglose en el motor de conciliación, así que ambos hooks comparten UNA sola
 * caché de react-query (mismo array, un solo viaje a red).
 */
export const PASADA_BOX_LINEAS_KEY = ["pasada_box_lineas"] as const;

export async function fetchPasadaBoxLineas(): Promise<PasadaBoxLineaRow[]> {
  try {
    return await fetchAllRows<PasadaBoxLineaRow>((from, to) =>
      SUPA.from("pasada_box_lineas")
        .select("id, user_id, lote_dia_id, posicion, tipo, lote_codigo, prec_fecha, box, box_tamano, nota")
        .order("lote_dia_id")
        .order("posicion")
        .range(from, to),
    );
  } catch (e) {
    // Migración sin aplicar: lista vacía y todo se comporta como antes.
    if (esErrorTablaOColumnaInexistente(e)) return [];
    throw e;
  }
}

/** lote_dia_id → sus líneas, ordenadas por posición. */
export function agruparLineasBoxPorLoteDia(filas: PasadaBoxLineaRow[]): Map<string, PasadaBoxLineaRow[]> {
  const mapa = new Map<string, PasadaBoxLineaRow[]>();
  for (const fila of filas) {
    const arr = mapa.get(fila.lote_dia_id) ?? [];
    arr.push(fila);
    mapa.set(fila.lote_dia_id, arr);
  }
  for (const arr of mapa.values()) arr.sort((a, b) => a.posicion - b.posicion);
  return mapa;
}

export function usePasadaBoxLineas() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const lineasQuery = useQuery({
    queryKey: PASADA_BOX_LINEAS_KEY,
    queryFn: fetchPasadaBoxLineas,
    enabled: Boolean(user),
  });

  // Báscula: para validar los códigos que se teclean, resolver un precalibrado
  // por su fecha (PREC 1/2 ALMACEN) y poder contrastar el reparto con el kg
  // por box real de cada entrada. Paginado: entradas_bascula pasa de 1.000.
  const entradasQuery = useQuery({
    queryKey: ["entradas_bascula", "para-desglose-box"] as const,
    queryFn: async (): Promise<EntradaParaDesglose[]> => {
      const rows = await fetchAllRows<{
        lote: string; fecha: string; finca: string | null; agricultor: string | null;
        articulo: string | null; kg_entrada: number; envases: number | null;
      }>((from, to) =>
        supabase
          .from("entradas_bascula")
          .select("lote, fecha, finca, agricultor, articulo, kg_entrada, envases")
          .order("fecha", { ascending: false })
          .order("lote", { ascending: false })
          .range(from, to) as unknown as PromiseLike<{ data: never[] | null; error: unknown }>,
      );
      return rows.map((r) => ({
        lote: r.lote,
        fecha: r.fecha,
        finca: r.finca,
        agricultor: r.agricultor,
        articulo: r.articulo,
        kg_entrada: Number(r.kg_entrada) || 0,
        envases: r.envases == null ? null : Number(r.envases),
      }));
    },
    enabled: Boolean(user),
  });

  const lineasPorLoteDia = useMemo(
    () => agruparLineasBoxPorLoteDia(lineasQuery.data ?? []),
    [lineasQuery.data],
  );

  // Referencia estable: si no, cada render crearía un array nuevo y los tres
  // useMemo de abajo se recalcularían siempre.
  const entradas = useMemo(() => entradasQuery.data ?? [], [entradasQuery.data]);

  /**
   * Re-entradas del almacén de precalibrado: candidatas para resolver "22/07".
   * Con `esEntradaPrecalibrado` (regla canónica del proyecto), NO por finca: las
   * re-entradas sembradas desde el informe de stock de lotes llegan con
   * `finca` a null y solo se reconocen por el agricultor "LASARTE ALMACEN
   * PRECALIBRADO" — filtrando por finca se perdían todas las del 21-jul en
   * adelante, justo las que hacen falta para los partes de agosto.
   */
  const reentradasPrec = useMemo(
    () => entradas.filter((e) => esEntradaPrecalibrado({ agricultor: e.agricultor, finca: e.finca })),
    [entradas],
  );

  /** Códigos que existen en báscula (lotes reales y re-entradas PREC): valida lo tecleado. */
  const codigosBascula = useMemo(() => new Set(entradas.map((e) => e.lote)), [entradas]);

  const entradaPorCodigo = useMemo(() => {
    const mapa = new Map<string, EntradaParaDesglose>();
    // Un mismo lote puede tener varias entradas (camiones): se acumulan kg y
    // envases para que el kg/box de referencia sea el del lote entero.
    for (const e of entradas) {
      const previa = mapa.get(e.lote);
      if (!previa) mapa.set(e.lote, { ...e });
      else {
        previa.kg_entrada += e.kg_entrada;
        previa.envases = (previa.envases ?? 0) + (e.envases ?? 0);
      }
    }
    return mapa;
  }, [entradas]);

  /**
   * Reemplaza el desglose COMPLETO de una pasada: borra lo que hubiera y
   * escribe las líneas nuevas con posición 1..n. Reemplazar (en vez de hacer
   * un diff fila a fila) mantiene el guardado idempotente y evita huecos de
   * posición; una lista vacía equivale a borrar el desglose.
   */
  const guardarDesglose = useMutation({
    mutationFn: async ({ loteDiaId, lineas }: { loteDiaId: string; lineas: LineaDesglose[] }) => {
      if (!user) throw new Error("No auth");

      const { error: errorBorrado } = await escribirConReintentos(() =>
        SUPA.from("pasada_box_lineas").delete().eq("lote_dia_id", loteDiaId),
      );
      if (errorBorrado) {
        if (esErrorTablaOColumnaInexistente(errorBorrado)) throw new Error(MENSAJE_MIGRACION_BOX_LINEAS);
        throw toError(errorBorrado);
      }

      if (lineas.length === 0) return { guardadas: 0 };

      const filas = lineas.map((l, i) => ({
        user_id: user.id,
        lote_dia_id: loteDiaId,
        posicion: i + 1,
        tipo: l.tipo,
        lote_codigo: l.tipo === "reciclaje" ? null : l.lote_codigo || null,
        prec_fecha: l.tipo === "precalibrado" ? l.prec_fecha || null : null,
        box: l.box == null ? null : Number(l.box),
        box_tamano: normalizarBoxTamano(l.box_tamano),
        nota: l.nota?.trim() ? l.nota.trim() : null,
      }));

      const { error } = await escribirConReintentos(() => SUPA.from("pasada_box_lineas").insert(filas));
      if (error) {
        if (esErrorTablaOColumnaInexistente(error)) throw new Error(MENSAJE_MIGRACION_BOX_LINEAS);
        throw toError(error);
      }
      return { guardadas: filas.length };
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["pasada_box_lineas"] });
    },
  });

  const lineasDe = useCallback(
    (loteDiaId: string): LineaDesglose[] => (lineasPorLoteDia.get(loteDiaId) ?? []).map(lineaDesdeRow),
    [lineasPorLoteDia],
  );

  return {
    /** lote_dia_id → filas guardadas, ordenadas por posición. */
    lineasPorLoteDia,
    /** Atajo: las líneas de una pasada en la forma que consume repartirPasadaPorBox. */
    lineasDe,
    reentradasPrec,
    codigosBascula,
    entradaPorCodigo,
    guardarDesglose,
    isLoading: lineasQuery.isLoading || entradasQuery.isLoading,
    error: lineasQuery.error ?? entradasQuery.error,
  };
}

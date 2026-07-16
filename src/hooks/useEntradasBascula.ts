/**
 * useEntradasBascula — entradas de fruta por báscula + stock de fruta sin
 * procesar. El stock cruza las entradas con lotes_dia (kg que el calibrador
 * ya ha procesado de cada lote) vía el código de lote normalizado.
 * Ver src/lib/entradasBascula.ts.
 */
import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useAuth } from "@/contexts/AuthProvider";
import { supabase } from "@/integrations/supabase/client";
import { toError } from "@/lib/errorMessage";
import { fetchAllRows } from "@/lib/fetchAllRows";
import { buildStockEntradas, type CierreModo, type EntradaBasculaParsed, type LoteProcesadoInput } from "@/lib/entradasBascula";
import { esEntradaCampoCit, esEntradaPrecalibrado, esErrorTablaOColumnaInexistente } from "@/lib/productoresCanonicos";
import { today } from "@/lib/format";
import type { Tables } from "@/integrations/supabase/types";

// entradas_bascula.cerrado_at / cierre_modo todavia no estan en el Database
// generado (migraciones 20260715090000_entradas_bascula_cierre_manual.sql y
// 20260716120000_entradas_bascula_cierre_modo.sql pendientes de aplicar).
// select("*") no necesita cast (una columna nueva simplemente no aparece si
// falta); los .update() de cerrarLote/reabrirLote/cerrarLotesEnBloque sí lo
// necesitan para poder pedir esas columnas con degradado si la migración aún
// no se aplicó. Mismo patrón que useTrazabilidadLote.ts / useProductoresCatalogo.ts.
const SUPA = supabase as unknown as SupabaseClient<any>;

/** entradas_bascula.* tipado + cerrado_at/cierre_modo (columnas nuevas, aún no generadas). */
export type EntradaBasculaRow = Tables<"entradas_bascula"> & { cerrado_at?: string | null; cierre_modo?: CierreModo | null };

const CHUNK = 200;

const MENSAJE_MIGRACION_CIERRE = "La columna cerrado_at todavía no existe: aplica primero la migración 20260715090000_entradas_bascula_cierre_manual.sql.";
const MENSAJE_MIGRACION_CIERRE_MODO = "La columna cierre_modo todavía no existe: aplica primero la migración 20260716120000_entradas_bascula_cierre_modo.sql.";

export function useEntradasBascula() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const entradasKey = ["entradas_bascula"] as const;

  const entradasQuery = useQuery({
    queryKey: entradasKey,
    queryFn: async (): Promise<EntradaBasculaRow[]> => {
      // entradas_bascula ya supera las 1.000 filas (histórico de campaña
      // importado): un .limit() por alto que sea NO basta, PostgREST recorta
      // a su max-rows en silencio. Paginar con fetchAllRows (ver cabecera).
      // Orden estable: fecha desc + id como desempate único.
      const rows = await fetchAllRows<EntradaBasculaRow>((from, to) =>
        supabase
          .from("entradas_bascula")
          .select("*")
          .order("fecha", { ascending: false })
          .order("id", { ascending: false })
          .range(from, to) as unknown as PromiseLike<{ data: EntradaBasculaRow[] | null; error: unknown }>,
      );
      return rows;
    },
    enabled: Boolean(user),
  });

  // Kg procesados por lote: todos los lotes del calibrador con la fecha de su parte.
  const procesadosQuery = useQuery({
    queryKey: ["entradas_bascula", "lotes-procesados"],
    queryFn: async (): Promise<LoteProcesadoInput[]> => {
      // lotes_dia ya supera las 1.000 filas (1.187 tras el histórico): mismo
      // motivo que arriba, paginar con fetchAllRows en vez de .limit(50000).
      const [lotes, partes] = await Promise.all([
        fetchAllRows<{ lote_codigo: string | null; kg_peso_total: number; part_id: string }>((from, to) =>
          supabase.from("lotes_dia").select("lote_codigo, kg_peso_total, part_id").order("id").range(from, to),
        ),
        fetchAllRows<{ id: string; date: string }>((from, to) =>
          supabase.from("partes_diarios").select("id, date").order("id").range(from, to),
        ),
      ]);
      const fechaPorParte = new Map(partes.map((p) => [p.id, p.date]));
      // El PRECALIBRADO SÍ cuenta aquí (regla revisada 2026-07-16, ver
      // src/lib/productoresCanonicos.ts): CERO lotes de la BD tienen pasadas
      // de ambos tipos (real y PRECALIBRADO) a la vez, así que contar la
      // pasada PREC con código de lote real no puede duplicar kg con los
      // datos actuales, y para 52 lotes esa pasada PREC es su ÚNICO registro
      // de procesado (excluirla dejaba stock fantasma). Ya no se filtra por
      // productor: cuenta TODA fila de lotes_dia, sea el productor el que sea.
      return lotes.map((l) => ({
        lote_codigo: l.lote_codigo,
        kg_peso_total: Number(l.kg_peso_total) || 0,
        date: fechaPorParte.get(l.part_id) ?? null,
      }));
    },
    enabled: Boolean(user),
  });

  const importar = useMutation({
    mutationFn: async (entradas: EntradaBasculaParsed[]) => {
      if (!user) throw new Error("No auth");
      if (entradas.length === 0) throw new Error("El archivo no contiene entradas importables.");
      // Upsert por lote: reimportar el mismo día (o un rango que solape) actualiza
      // en vez de duplicar.
      for (let i = 0; i < entradas.length; i += CHUNK) {
        const chunk = entradas.slice(i, i + CHUNK).map((e) => ({ ...e, user_id: user.id }));
        const { error } = await supabase
          .from("entradas_bascula")
          .upsert(chunk, { onConflict: "lote" });
        if (error) throw toError(error);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: entradasKey });
    },
  });

  const importarStock = useMutation({
    mutationFn: async (entradas: EntradaBasculaParsed[]) => {
      if (!user) throw new Error("No auth");
      if (entradas.length === 0) throw new Error("El informe no contiene lotes importables.");
      // Sembrado del stock inicial: SOLO se crean lotes que no existan ya
      // (ignoreDuplicates), para no machacar entradas reales de báscula.
      for (let i = 0; i < entradas.length; i += CHUNK) {
        const chunk = entradas.slice(i, i + CHUNK).map((e) => ({ ...e, user_id: user.id }));
        const { error } = await supabase
          .from("entradas_bascula")
          .upsert(chunk, { onConflict: "lote", ignoreDuplicates: true });
        if (error) throw toError(error);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: entradasKey });
    },
  });

  const eliminar = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("entradas_bascula").delete().eq("id", id);
      if (error) throw toError(error);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: entradasKey });
    },
  });

  // ─── Cierre manual de lote (decisión del dueño, 2026-07-15/16) ─────────────
  // Ver src/lib/mermaLote.ts / src/lib/entradasBascula.ts (estadoLotePorProcesado,
  // criterioCierreModo) para qué significa cerrado_at/cierre_modo. Degradan
  // con gracia si las columnas aún no existen (migraciones 20260715090000 /
  // 20260716120000 pendientes de aplicar).
  const cerrarLote = useMutation({
    mutationFn: async ({ id, cierreModo }: { id: string; cierreModo: CierreModo }) => {
      const { error } = await SUPA
        .from("entradas_bascula")
        .update({ cerrado_at: new Date().toISOString(), cierre_modo: cierreModo })
        .eq("id", id);
      if (error) {
        if (esErrorTablaOColumnaInexistente(error)) throw new Error(MENSAJE_MIGRACION_CIERRE_MODO);
        throw toError(error);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: entradasKey });
    },
  });

  const reabrirLote = useMutation({
    mutationFn: async (id: string) => {
      // Reabrir limpia AMBOS campos: un lote reabierto y vuelto a cerrar más
      // adelante no debe heredar un cierre_modo obsoleto de la vez anterior.
      const { error } = await SUPA.from("entradas_bascula").update({ cerrado_at: null, cierre_modo: null }).eq("id", id);
      if (error) {
        if (esErrorTablaOColumnaInexistente(error)) throw new Error(MENSAJE_MIGRACION_CIERRE);
        throw toError(error);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: entradasKey });
    },
  });

  // ─── Cierre masivo (solo admin, decisión del dueño 2026-07-16) ─────────────
  // Cierra en bloque los lotes activos antiguos: agrupa por cierreModo (2
  // grupos como mucho) para hacer un UPDATE .in(ids) por chunk y modo en vez
  // de un UPDATE por lote — mismo espíritu de "un solo .update().in() por
  // valor compartido" que el backfill de palets en useHistoricoImport.ts.
  const cerrarLotesEnBloque = useMutation({
    mutationFn: async ({ items, onProgress }: {
      items: Array<{ id: string; cierreModo: CierreModo }>;
      onProgress?: (hecho: number, total: number) => void;
    }): Promise<{ cerrados: number }> => {
      if (!user) throw new Error("No auth");
      if (items.length === 0) return { cerrados: 0 };

      const ahora = new Date().toISOString();
      const idsPorModo = new Map<CierreModo, string[]>();
      for (const item of items) {
        const arr = idsPorModo.get(item.cierreModo) ?? [];
        arr.push(item.id);
        idsPorModo.set(item.cierreModo, arr);
      }

      const total = items.length;
      let hecho = 0;
      onProgress?.(hecho, total);

      for (const [cierreModo, ids] of idsPorModo) {
        for (let i = 0; i < ids.length; i += CHUNK) {
          const chunk = ids.slice(i, i + CHUNK);
          const { error } = await SUPA
            .from("entradas_bascula")
            .update({ cerrado_at: ahora, cierre_modo: cierreModo })
            .in("id", chunk);
          if (error) {
            if (esErrorTablaOColumnaInexistente(error)) throw new Error(MENSAJE_MIGRACION_CIERRE_MODO);
            throw toError(error);
          }
          hecho += chunk.length;
          onProgress?.(hecho, total);
        }
      }

      return { cerrados: hecho };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: entradasKey });
    },
  });

  // ─── Reapertura masiva (conciliación con el informe de cámara, 2026-07-16) ─
  // Mismo espíritu que cerrarLotesEnBloque pero al revés: limpia cerrado_at +
  // cierre_modo de golpe para los lotes que el cierre por fecha cerró mal (el
  // informe real del programa de báscula dice que siguen en cámara). No hay
  // que agrupar por modo (reabrir siempre pone ambos campos a null), así que
  // es un único .update().in(ids) por chunk.
  const reabrirLotesEnBloque = useMutation({
    mutationFn: async ({ ids, onProgress }: {
      ids: string[];
      onProgress?: (hecho: number, total: number) => void;
    }): Promise<{ reabiertos: number }> => {
      if (!user) throw new Error("No auth");
      if (ids.length === 0) return { reabiertos: 0 };

      const total = ids.length;
      let hecho = 0;
      onProgress?.(hecho, total);

      for (let i = 0; i < ids.length; i += CHUNK) {
        const chunk = ids.slice(i, i + CHUNK);
        const { error } = await SUPA
          .from("entradas_bascula")
          .update({ cerrado_at: null, cierre_modo: null })
          .in("id", chunk);
        if (error) {
          if (esErrorTablaOColumnaInexistente(error)) throw new Error(MENSAJE_MIGRACION_CIERRE);
          throw toError(error);
        }
        hecho += chunk.length;
        onProgress?.(hecho, total);
      }

      return { reabiertos: hecho };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: entradasKey });
    },
  });

  // ─── Movimientos internos de precalibrado (cierre definitivo, jul-2026) ────
  // La báscula registra el movimiento al almacén de precalibrado como si
  // fuera una entrada normal (278 filas, 764.846 kg verificados en BD): es
  // fruta que ya entró y se aparta para volver a pasarla, no una entrada
  // nueva. Regla del dueño (textual): "no cuenta para la entrada ni stock".
  //
  // ─── CAMPO/CIT: derivado a Cítrica, no se procesa en la central (2026-07-16) ─
  // Los lotes cuyo artículo lleva "CAMPO/CIT" (esEntradaCampoCit, ver la nota
  // de evidencia en productoresCanonicos.ts) son fruta comprada que se
  // deriva a Cítrica sin pasar por el calibrador: 13 lotes / 304.090 kg, cero
  // pasadas de calibrador en toda la campaña. No cuentan como stock (nunca se
  // van a procesar aquí) ni como merma/forfait (no es una pérdida, se vendió
  // por otro canal) — pero SÍ son compra real, así que se guardan aparte
  // (`derivadosCampoCit`, con las filas para poder listarlas en la UI) en
  // vez de descartarse sin más como el precalibrado.
  //
  // Ambos filtros se aplican aquí, en el único sitio que hace el fetch
  // crudo, para que la exclusión cascada automáticamente a TODO lo que
  // consume `entradas` de este hook (stock, listas, KPIs, entradasPorDia en
  // EntradasBascula.tsx; useMermaLotes; EconomicoFruta.tsx;
  // EconomicoCostes.tsx) sin que cada consumidor tenga que acordarse de
  // filtrar.
  const { entradas, movimientosPrecalibrado, derivadosCampoCit } = useMemo(() => {
    const entradasTodas = entradasQuery.data ?? [];
    const externas: EntradaBasculaRow[] = [];
    const internas: EntradaBasculaRow[] = [];
    const campoCit: EntradaBasculaRow[] = [];
    for (const e of entradasTodas) {
      if (esEntradaPrecalibrado(e)) internas.push(e);
      else if (esEntradaCampoCit(e)) campoCit.push(e);
      else externas.push(e);
    }
    return {
      entradas: externas,
      movimientosPrecalibrado: {
        count: internas.length,
        kg: internas.reduce((s, e) => s + (Number(e.kg_entrada) || 0), 0),
      },
      derivadosCampoCit: {
        count: campoCit.length,
        kg: campoCit.reduce((s, e) => s + (Number(e.kg_entrada) || 0), 0),
        filas: campoCit,
      },
    };
  }, [entradasQuery.data]);

  const stock = useMemo(
    () => buildStockEntradas(
      entradas.map((e) => ({
        lote: e.lote,
        fecha: e.fecha,
        kg_entrada: Number(e.kg_entrada) || 0,
        kg_ajuste_stock: Number(e.kg_ajuste_stock) || 0,
        finca: e.finca,
        articulo: e.articulo,
        agricultor: e.agricultor,
        cerrado_at: e.cerrado_at ?? null,
        cierre_modo: e.cierre_modo ?? null,
      })),
      procesadosQuery.data ?? [],
      today(),
    ),
    [entradas, procesadosQuery.data],
  );

  return {
    entradas,
    stock,
    procesados: procesadosQuery.data ?? [],
    movimientosPrecalibrado,
    derivadosCampoCit,
    isLoading: entradasQuery.isLoading || procesadosQuery.isLoading,
    error: entradasQuery.error ?? procesadosQuery.error,
    importar,
    importarStock,
    eliminar,
    cerrarLote,
    reabrirLote,
    cerrarLotesEnBloque,
    reabrirLotesEnBloque,
  };
}

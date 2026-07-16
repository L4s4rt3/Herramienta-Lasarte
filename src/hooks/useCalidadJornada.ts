/**
 * useCalidadJornada — carga de datos de la página "Jornada de Calidad"
 * (src/pages/CalidadJornada.tsx): jornada del día, sus lotes y adjuntos,
 * productores/fincas (propios + los importados de lotes_dia), los lotes del
 * parte de producción del mismo día (para "Importar lotes del parte" y el
 * autocompletar de número de lote) y el histórico de lotes previos del mismo
 * usuario (para "Histórico similar" y el comentario sugerido).
 *
 * Todo eso se resuelve en UNA sola query (`useCalidadJornadaDia`) porque el
 * flujo original (`load()` en la página) es secuencial y con una dependencia
 * real entre pasos: primero un Promise.all de lecturas + "obtener o crear" la
 * jornada del día (si no existe, se inserta), y solo entonces se pueden leer
 * sus lotes y, si hay lotes, sus adjuntos (con URL firmada para imágenes).
 * Partir esto en varias queries encadenadas cambiaría el orden de carga
 * observable; se mantiene como una única queryFn que reproduce el mismo
 * orden paso a paso que el `load()` que sustituye.
 *
 * IMPORTANTE (retry: false en useCalidadJornadaDia): la queryFn puede
 * INSERTAR una fila en calidad_jornadas si todavía no existe para la fecha
 * (mismo comportamiento que el `load()` original). Con el retry global de la
 * app (1, ver src/lib/queryClient.ts) un fallo transitorio DESPUÉS del insert
 * (p. ej. al leer calidad_lotes) reintentaría la queryFn completa desde cero
 * y crearía una SEGUNDA jornada duplicada para el mismo día. Por eso esta
 * query fuerza `retry: false`, igual que el `load()` original (que tampoco
 * reintentaba).
 *
 * El tab "Histórico" (comparativa de toda la campaña, todos los usuarios) es
 * un dominio aparte con su propia queryFn/queryKey (`useCalidadHistoricoRango`),
 * activada solo cuando la página abre esa pestaña — igual que el `useEffect`
 * original ligado a `tab === "historico"`.
 *
 * Las escrituras (jornada, lotes, productores, adjuntos) se exponen como
 * `useMutation` en `useCalidadJornadaMutaciones`, con invalidación del
 * namespace `["calidad-jornada"]` en las acciones "de verdad" (guardar
 * jornada, guardar lote, añadir/importar/eliminar lote, subir/eliminar
 * adjunto, crear/borrar productor).
 *
 * EXCEPCIÓN a propósito: `updateLoteMutation` (el UPDATE genérico de
 * calidad_lotes) NO invalida por sí sola. La usan tanto el autoguardado con
 * debounce (`persistLote` en la página, que dispara un UPDATE cada ~2s
 * mientras el usuario escribe) como el guardado explícito del botón
 * "Guardar lote". Si invalidara en cada UPDATE, cada autoguardado
 * dispararía un refetch completo del bundle del día MIENTRAS el usuario
 * sigue editando — algo que la página original nunca hacía (el estado local
 * ya queda actualizado con la fila que devuelve el propio UPDATE). Por eso
 * la invalidación para este caso se dispara a mano, solo en el guardado
 * explícito (ver `saveLote()` en la página), no en el autoguardado.
 *
 * La página conserva su copia local editable (lotes/adjuntos/productores en
 * useState) para el autoguardado y el feedback optimista inmediato, igual
 * que antes: este hook solo sustituye el `fetch`/escritura manual contra
 * Supabase, no la gestión de la edición en curso.
 */
import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthProvider";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { campanaStartYear } from "@/lib/consumoPeriodoView";
import { fetchAllRows } from "@/lib/fetchAllRows";
import {
  normalizeCalidadName,
  type CalidadAdjunto,
  type CalidadJornada,
  type CalidadLote,
  type CalidadProductor,
  type LoteDiaImportable,
} from "@/lib/calidad";

const NS = "calidad-jornada" as const;

export function calidadJornadaDiaQueryKey(fecha: string, userId: string | undefined | null) {
  return [NS, "dia", fecha, userId ?? null] as const;
}

const HISTORICO_RANGO_QUERY_KEY = [NS, "historico-rango"] as const;

export interface CalidadJornadaDiaBundle {
  jornada: CalidadJornada;
  lotes: CalidadLote[];
  adjuntos: CalidadAdjunto[];
  lotesDia: LoteDiaImportable[];
  productores: CalidadProductor[];
  /** Lotes anteriores del mismo usuario (hasta 300, antes de `fecha`), para "Histórico similar". */
  historicalLotes: CalidadLote[];
}

/** Payload de insert de calidad_lotes: todo CalidadLote salvo el `id` (lo genera la base de datos). */
export type CalidadLoteInsert = Omit<CalidadLote, "id">;

/** Payload de update de calidad_lotes: los campos editables desde la ficha de lote (persistLote/saveLote). */
export type CalidadLoteUpdatePayload = Partial<CalidadLoteInsert>;

/** Bundle del día: jornada + lotes + adjuntos + lotes del parte + productores + histórico del usuario. */
export function useCalidadJornadaDia(fecha: string) {
  const { user } = useAuth();

  const query = useQuery({
    queryKey: calidadJornadaDiaQueryKey(fecha, user?.id),
    queryFn: async (): Promise<CalidadJornadaDiaBundle> => {
      if (!user) throw new Error("Debes iniciar sesión.");

      const [
        { data: calidadProductoresData },
        parteProductoresData,
        jornadaResponse,
        historicoResponse,
        parteDelDiaResponse,
      ] = await Promise.all([
        supabase.from("calidad_productores").select("*").order("nombre", { ascending: true }),
        // lotes_dia tiene 1.187 filas tras el histórico: el .limit(5000) no
        // protegía nada (PostgREST recorta a su max-rows en silencio), así
        // que se perdían productores de la lista de sugerencias. Se pagina
        // con fetchAllRows.
        fetchAllRows<{ productor: string | null }>((from, to) =>
          supabase.from("lotes_dia").select("productor").not("productor", "is", null).order("id").range(from, to),
        ),
        supabase.from("calidad_jornadas").select("*").eq("fecha", fecha).maybeSingle(),
        supabase
          .from("calidad_lotes")
          .select("*")
          .eq("user_id", user.id)
          .lt("fecha", fecha)
          .order("fecha", { ascending: false })
          .limit(300),
        supabase.from("partes_diarios").select("id").eq("date", fecha).maybeSingle(),
      ]);

      // El cliente Supabase tipado no siempre infiere bien el resultado de
      // `.maybeSingle()`/`.select("*")` en tablas nuevas: se castea vía
      // `unknown` para recuperar el shape real de la fila (CalidadJornada).
      let currentJornada = jornadaResponse.data as unknown as CalidadJornada | null;
      if (jornadaResponse.error) throw jornadaResponse.error;
      if (historicoResponse.error) throw historicoResponse.error;

      if (!currentJornada) {
        const fallbackResponsible = "Eusebio Rodríguez";
        const { data: inserted, error } = await supabase
          .from("calidad_jornadas")
          .insert({ user_id: user.id, fecha, responsable: fallbackResponsible })
          .select("*")
          .single();
        if (error) throw error;
        currentJornada = inserted as unknown as CalidadJornada;
      }

      const { data: lotesData, error: lotesError } = await supabase
        .from("calidad_lotes")
        .select("*")
        .eq("jornada_id", currentJornada.id)
        .order("created_at", { ascending: true });
      if (lotesError) throw lotesError;

      const loadedLotes = (lotesData ?? []) as unknown as CalidadLote[];
      let loadedAdjuntos: CalidadAdjunto[] = [];
      if (loadedLotes.length > 0) {
        const { data: adjuntosData, error: adjuntosError } = await supabase
          .from("calidad_adjuntos")
          .select("*")
          .in("lote_id", loadedLotes.map((lote) => lote.id))
          .order("created_at", { ascending: false });
        if (adjuntosError) throw adjuntosError;

        loadedAdjuntos = await Promise.all(
          ((adjuntosData ?? []) as unknown as CalidadAdjunto[]).map(async (adjunto) => {
            if (!adjunto.mime_type?.startsWith("image/")) return adjunto;
            const { data } = await supabase.storage.from("partes-archivos").createSignedUrl(adjunto.file_path, 60 * 60);
            return { ...adjunto, signedUrl: data?.signedUrl };
          }),
        );
      }

      // Lotes del parte de producción del mismo día, para "Importar lotes del
      // parte" y el autocompletar de número de lote.
      let lotesDiaDelParte: LoteDiaImportable[] = [];
      const parteId = (parteDelDiaResponse.data as unknown as { id: string } | null)?.id;
      if (parteId) {
        const { data: lotesDiaData, error: lotesDiaError } = await supabase
          .from("lotes_dia")
          .select("lote_codigo, productor, producto, kg_peso_total, hora_inicio")
          .eq("part_id", parteId)
          .order("hora_inicio", { ascending: true });
        if (lotesDiaError) throw lotesDiaError;
        lotesDiaDelParte = (lotesDiaData ?? []) as LoteDiaImportable[];
      }

      const calidadProductores = (calidadProductoresData ?? []) as CalidadProductor[];
      const importedProductores = ((parteProductoresData ?? []) as Array<{ productor: string | null }>).flatMap((row) => {
        const nombre = normalizeCalidadName(row.productor ?? "");
        return nombre ? [{ id: `db-${nombre}`, nombre }] : [];
      });

      return {
        jornada: currentJornada,
        lotes: loadedLotes,
        adjuntos: loadedAdjuntos,
        lotesDia: lotesDiaDelParte,
        productores: [...calidadProductores, ...importedProductores],
        historicalLotes: (historicoResponse.data ?? []) as unknown as CalidadLote[],
      };
    },
    enabled: Boolean(user),
    retry: false,
  });

  useEffect(() => {
    if (user && query.error instanceof Error && !query.isFetching) {
      toast({ title: "Error cargando Calidad", description: query.error.message, variant: "destructive" });
    }
  }, [user, query.error, query.isFetching]);

  return query;
}

/**
 * Histórico de toda la campaña (todos los usuarios) para el tab "Histórico".
 * Calidad es dato de empresa (RLS SELECT = todos los autenticados): se cargan
 * TODOS los controles desde el inicio de la campaña citrícola actual (1 sep),
 * sin filtrar por usuario, para poder navegarlos por semana/mes/campaña.
 */
export function useCalidadHistoricoRango(enabled: boolean) {
  const { user } = useAuth();

  const query = useQuery({
    queryKey: HISTORICO_RANGO_QUERY_KEY,
    queryFn: async (): Promise<CalidadLote[]> => {
      const startYear = campanaStartYear(new Date());
      const desde = `${startYear}-09-01`;
      // TODA la campaña, sin filtrar por usuario: puede superar de sobra las
      // 1.000 filas (volumen comparable a lotes_dia, 1.187 tras el histórico).
      // Se pagina con fetchAllRows; se añade "id" como desempate del orden
      // por fecha (puede haber varios controles el mismo día).
      const data = await fetchAllRows<CalidadLote>((from, to) =>
        supabase
          .from("calidad_lotes")
          .select("*")
          .gte("fecha", desde)
          .order("fecha", { ascending: true })
          .order("id", { ascending: true })
          .range(from, to) as unknown as PromiseLike<{ data: CalidadLote[] | null; error: unknown }>,
      );
      return data;
    },
    enabled: enabled && Boolean(user),
  });

  useEffect(() => {
    if (enabled && user && query.error instanceof Error && !query.isFetching) {
      toast({ title: "Error cargando histórico", description: query.error.message, variant: "destructive" });
    }
  }, [enabled, user, query.error, query.isFetching]);

  return query;
}

/**
 * Fecha de la última jornada de calidad guardada (para el resumen barato del
 * dashboard de producción — FASE 2 del rediseño, "La sección"): una sola fila
 * (`limit(1)`), nada que ver con el bundle completo de `useCalidadJornadaDia`.
 * `null` mientras carga o si todavía no hay ninguna jornada guardada.
 */
export function useUltimaJornadaCalidad() {
  const { user } = useAuth();

  const query = useQuery({
    queryKey: [NS, "ultima-guardada"] as const,
    queryFn: async (): Promise<string | null> => {
      const { data, error } = await supabase
        .from("calidad_jornadas")
        .select("fecha")
        .eq("estado", "guardada")
        .order("fecha", { ascending: false })
        .limit(1);
      if (error) throw error;
      return data?.[0]?.fecha ?? null;
    },
    enabled: Boolean(user),
  });

  return { fecha: query.data ?? null, isLoading: query.isLoading };
}

/** Escrituras de la jornada de calidad: jornada, lotes, productores y adjuntos. */
export function useCalidadJornadaMutaciones() {
  const queryClient = useQueryClient();

  /** Invalida el bundle del día (todas las fechas/usuarios) y el histórico de campaña. */
  const invalidate = () => queryClient.invalidateQueries({ queryKey: [NS] });

  const updateJornadaMutation = useMutation({
    mutationFn: async (input: { id: string; responsable: string }) => {
      const { error } = await supabase
        .from("calidad_jornadas")
        .update({ responsable: input.responsable, estado: "guardada" })
        .eq("id", input.id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  // Ver cabecera del archivo: NO invalida a propósito (lo usa también el
  // autoguardado con debounce). El guardado explícito invalida a mano.
  const updateLoteMutation = useMutation({
    mutationFn: async (input: { id: string; payload: CalidadLoteUpdatePayload }): Promise<CalidadLote> => {
      const { data, error } = await supabase
        .from("calidad_lotes")
        .update(input.payload)
        .eq("id", input.id)
        .select("*")
        .single();
      if (error) throw error;
      return data as unknown as CalidadLote;
    },
  });

  const insertProductorMutation = useMutation({
    mutationFn: async (input: { userId: string; nombre: string }): Promise<CalidadProductor> => {
      const { data, error } = await supabase
        .from("calidad_productores")
        .insert({ user_id: input.userId, nombre: input.nombre })
        .select("*")
        .single();
      if (error) throw error;
      return data as unknown as CalidadProductor;
    },
    onSuccess: invalidate,
  });

  const deleteProductorMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("calidad_productores").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const insertLoteMutation = useMutation({
    mutationFn: async (payload: CalidadLoteInsert): Promise<CalidadLote> => {
      const { data, error } = await supabase.from("calidad_lotes").insert(payload).select("*").single();
      if (error) throw error;
      return data as unknown as CalidadLote;
    },
    onSuccess: invalidate,
  });

  const insertLotesBatchMutation = useMutation({
    mutationFn: async (payload: CalidadLoteInsert[]): Promise<CalidadLote[]> => {
      const { data, error } = await supabase.from("calidad_lotes").insert(payload).select("*");
      if (error) throw error;
      return (data ?? []) as unknown as CalidadLote[];
    },
    onSuccess: invalidate,
  });

  const deleteLoteMutation = useMutation({
    mutationFn: async (input: { id: string; filePaths: string[] }) => {
      if (input.filePaths.length > 0) {
        await supabase.storage.from("partes-archivos").remove(input.filePaths);
      }
      const { error } = await supabase.from("calidad_lotes").delete().eq("id", input.id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const uploadAdjuntosMutation = useMutation({
    mutationFn: async (input: {
      files: File[];
      userId: string;
      jornadaId: string;
      loteId: string;
      cleanFileName: (name: string) => string;
    }): Promise<CalidadAdjunto[]> => {
      const created: CalidadAdjunto[] = [];
      for (const file of input.files) {
        const path = `${input.userId}/calidad/${input.jornadaId}/${input.loteId}/${crypto.randomUUID()}-${input.cleanFileName(file.name)}`;
        const { error: uploadError } = await supabase.storage.from("partes-archivos").upload(path, file);
        if (uploadError) throw uploadError;
        const { data, error } = await supabase
          .from("calidad_adjuntos")
          .insert({ lote_id: input.loteId, user_id: input.userId, file_name: file.name, file_path: path, mime_type: file.type, file_size: file.size })
          .select("*")
          .single();
        if (error) throw error;
        const adjunto = data as unknown as CalidadAdjunto;
        if (adjunto.mime_type?.startsWith("image/")) {
          const { data: signed } = await supabase.storage.from("partes-archivos").createSignedUrl(adjunto.file_path, 60 * 60);
          created.push({ ...adjunto, signedUrl: signed?.signedUrl });
        } else {
          created.push(adjunto);
        }
      }
      return created;
    },
    onSuccess: invalidate,
  });

  const deleteAdjuntoMutation = useMutation({
    mutationFn: async (input: { id: string; filePath: string }) => {
      await supabase.storage.from("partes-archivos").remove([input.filePath]);
      const { error } = await supabase.from("calidad_adjuntos").delete().eq("id", input.id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  return {
    invalidate,
    updateJornadaMutation,
    updateLoteMutation,
    insertProductorMutation,
    deleteProductorMutation,
    insertLoteMutation,
    insertLotesBatchMutation,
    deleteLoteMutation,
    uploadAdjuntosMutation,
    deleteAdjuntoMutation,
  };
}

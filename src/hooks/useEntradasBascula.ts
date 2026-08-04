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
import { escribirConReintentos, fetchAllRows } from "@/lib/fetchAllRows";
import { buildStockEntradas, esCandidatoCierreAutomatico, esCandidatoCierreCompuesto, type CierreModo, type EntradaBasculaParsed, type LoteProcesadoInput } from "@/lib/entradasBascula";
import { capacidadFraccionEstimada, conciliarKgProcesados, detectarLotesEnPasadaCompuesta, type EntradaConciliacion, type ReciclajeDiaInput } from "@/lib/conciliacionKg";
import { codigosEnCamaraExterna, type SenalesRecepcion } from "@/lib/camarasExternas";
import { camaraConfirmadaVigentePorLote, unirLotesConfirmadosEnCamara, type EntradaConCamaraConfirmada } from "@/lib/camaraConfirmada";
import { useCamarasExternas } from "@/hooks/useCamarasExternas";
import { normalizarLoteCodigo } from "@/lib/loteCodigo";
import { esEntradaCampoCit, esEntradaPrecalibrado, esErrorTablaOColumnaInexistente } from "@/lib/productoresCanonicos";
import { esNotaOperarioLote } from "@/lib/trazabilidadSelector";

/** Pasada de lotes_dia con los extras de calidad que consume Trazabilidad (notas del operario y destrío a industria). */
export type LoteProcesadoConCalidad = LoteProcesadoInput & { kg_industria: number; notas: string | null };

/** Señales de calidad por lote derivadas de las pasadas: % a industria (destrío medible) y notas del operario. */
export interface CalidadLotesDerivada {
  /** kg a industria acumulados por lote (solo lotes con dato > 0). */
  industriaKgPorLote: Map<string, number>;
  /** kg_industria / kg procesado crudo, 0..1 (solo lotes con base > 0). */
  pctIndustriaPorLote: Map<string, number>;
  /** Media PONDERADA de % industria por variedad (articulo): Σ industria / Σ procesado de sus lotes. */
  mediaIndustriaPorVariedad: Map<string, number>;
  /** Notas del OPERARIO por lote (boilerplate de imports excluido), concatenadas con " · ". */
  notasPorLote: Map<string, string>;
}
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

/**
 * entradas_bascula.* tipado + columnas nuevas aún no generadas: cerrado_at/
 * cierre_modo (cierre manual) y camara_confirmada_nombre/camara_confirmada_fecha
 * (confirmación FÍSICA por inventario, migración 20260804120000_camara_confirmada.sql
 * — ver src/lib/camaraConfirmada.ts). Se tipan aquí (en vez de casts puntuales
 * como merma_camara_kg) porque se leen en varios consumidores (este hook, el
 * diálogo de admin y el badge de la pestaña Stock).
 */
export type EntradaBasculaRow = Tables<"entradas_bascula"> & {
  cerrado_at?: string | null;
  cierre_modo?: CierreModo | null;
  camara_confirmada_nombre?: string | null;
  camara_confirmada_fecha?: string | null;
};

const CHUNK = 200;

const MENSAJE_MIGRACION_CIERRE = "La columna cerrado_at todavía no existe: aplica primero la migración 20260715090000_entradas_bascula_cierre_manual.sql.";
const MENSAJE_MIGRACION_CIERRE_MODO = "La columna cierre_modo todavía no existe: aplica primero la migración 20260716120000_entradas_bascula_cierre_modo.sql.";
const MENSAJE_MIGRACION_CAMARA_CONFIRMADA = "La columna camara_confirmada_nombre todavía no existe: aplica primero la migración 20260804120000_camara_confirmada.sql.";

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
  // Trae además el nº de box de reciclaje diario de cada parte (migración
  // 20260721140000; con degradado si la columna aún no existe) — lo consume
  // la conciliación de kg para descontar la fruta que vuelve de la línea.
  const procesadosQuery = useQuery({
    queryKey: ["entradas_bascula", "lotes-procesados"],
    queryFn: async (): Promise<{ procesados: LoteProcesadoConCalidad[]; reciclajePorDia: ReciclajeDiaInput[] }> => {
      // lotes_dia ya supera las 1.000 filas (1.187 tras el histórico): mismo
      // motivo que arriba, paginar con fetchAllRows en vez de .limit(50000).
      type ParteReciclaje = {
        id: string;
        date: string;
        kg_reciclado_malla_z1?: number | null;
        kg_reciclado_malla_z2?: number | null;
        box_reciclaje?: number | null;
      };
      const fetchPartes = async (): Promise<ParteReciclaje[]> => {
        try {
          return await fetchAllRows<ParteReciclaje>((from, to) =>
            SUPA.from("partes_diarios").select("id, date, kg_reciclado_malla_z1, kg_reciclado_malla_z2, box_reciclaje").order("id").range(from, to),
          );
        } catch (e) {
          if (!esErrorTablaOColumnaInexistente(e)) throw e;
          return fetchAllRows<ParteReciclaje>((from, to) =>
            supabase.from("partes_diarios").select("id, date, kg_reciclado_malla_z1, kg_reciclado_malla_z2").order("id").range(from, to),
          );
        }
      };
      const [lotes, partes] = await Promise.all([
        fetchAllRows<{ lote_codigo: string | null; kg_peso_total: number; part_id: string; kg_industria: number | null; notas: string | null }>((from, to) =>
          supabase.from("lotes_dia").select("lote_codigo, kg_peso_total, part_id, kg_industria, notas").order("id").range(from, to),
        ),
        fetchPartes(),
      ]);
      const fechaPorParte = new Map(partes.map((p) => [p.id, p.date]));
      // El PRECALIBRADO SÍ cuenta aquí (regla revisada 2026-07-16, ver
      // src/lib/productoresCanonicos.ts): CERO lotes de la BD tienen pasadas
      // de ambos tipos (real y PRECALIBRADO) a la vez, así que contar la
      // pasada PREC con código de lote real no puede duplicar kg con los
      // datos actuales, y para 52 lotes esa pasada PREC es su ÚNICO registro
      // de procesado (excluirla dejaba stock fantasma). Ya no se filtra por
      // productor: cuenta TODA fila de lotes_dia, sea el productor el que sea.
      return {
        procesados: lotes.map((l) => ({
          lote_codigo: l.lote_codigo,
          kg_peso_total: Number(l.kg_peso_total) || 0,
          date: fechaPorParte.get(l.part_id) ?? null,
          kg_industria: Number(l.kg_industria) || 0,
          notas: l.notas,
        })),
        // Reciclado del parte: Z1+Z2 ya se guardan netos de tara. El nº de
        // box se conserva para trazabilidad y reparto entre pasadas.
        reciclajePorDia: partes
          .map((p) => ({
            fecha: p.date,
            kgBruto: (Number(p.kg_reciclado_malla_z1) || 0) + (Number(p.kg_reciclado_malla_z2) || 0),
            nBox: Number(p.box_reciclaje) || 0,
          }))
          .filter((p) => p.kgBruto > 0),
      };
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
          // Reintentos (escribirConReintentos, src/lib/fetchAllRows.ts): esta
          // mutación también sirve al cierre AUTOMÁTICO (refuerzo 2026-08-03,
          // ver esCandidatoCierreAutomatico), que en su primera pasada puede
          // tener que cerrar hasta ~819 lotes atrasados de golpe — el mismo
          // riesgo de "statement timeout" que el import histórico.
          const { error } = await escribirConReintentos(() => SUPA
            .from("entradas_bascula")
            .update({ cerrado_at: ahora, cierre_modo: cierreModo })
            .in("id", chunk));
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

  // ─── Confirmación FÍSICA de lote en cámara (solo admin, refuerzo 04-08-2026) ─
  // Dirección inventaría una cámara a pie y confirma que un lote sigue
  // intacto: escribe camara_confirmada_nombre/camara_confirmada_fecha
  // (migración 20260804120000_camara_confirmada.sql). Es una SEÑAL, no un
  // movimiento — ver src/lib/camaraConfirmada.ts para la vigencia (caduca
  // sola con una pasada propia posterior a la fecha, no hace falta limpiarla
  // a mano salvo que se quiera corregir un dato mal introducido). El mismo
  // update sirve para LIMPIAR la señal: nombre/fecha `null` en el item.
  // Mismo patrón que cerrarLotesEnBloque (agrupar + chunk + reintentos, ya
  // que puede aplicar a los 26 lotes de golpe).
  const actualizarCamaraConfirmada = useMutation({
    mutationFn: async ({ items, onProgress }: {
      items: Array<{ id: string; nombre: string | null; fecha: string | null }>;
      onProgress?: (hecho: number, total: number) => void;
    }): Promise<{ actualizados: number }> => {
      if (!user) throw new Error("No auth");
      if (items.length === 0) return { actualizados: 0 };

      const total = items.length;
      let hecho = 0;
      onProgress?.(hecho, total);

      // Agrupa por (nombre, fecha) para poder hacer un .update().in(ids) por
      // combinación en vez de uno por lote — en la práctica el diálogo aplica
      // el mismo nombre/fecha a toda la tanda (o null/null para limpiar), así
      // que normalmente es un único grupo.
      const grupos = new Map<string, { nombre: string | null; fecha: string | null; ids: string[] }>();
      for (const item of items) {
        const clave = `${item.nombre ?? ""}|${item.fecha ?? ""}`;
        const grupo = grupos.get(clave) ?? { nombre: item.nombre, fecha: item.fecha, ids: [] };
        grupo.ids.push(item.id);
        grupos.set(clave, grupo);
      }

      for (const { nombre, fecha, ids } of grupos.values()) {
        for (let i = 0; i < ids.length; i += CHUNK) {
          const chunk = ids.slice(i, i + CHUNK);
          const { error } = await escribirConReintentos(() => SUPA
            .from("entradas_bascula")
            .update({ camara_confirmada_nombre: nombre, camara_confirmada_fecha: fecha })
            .in("id", chunk));
          if (error) {
            if (esErrorTablaOColumnaInexistente(error)) throw new Error(MENSAJE_MIGRACION_CAMARA_CONFIRMADA);
            throw toError(error);
          }
          hecho += chunk.length;
          onProgress?.(hecho, total);
        }
      }

      return { actualizados: hecho };
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
  const { entradas, entradasPrecalibrado, movimientosPrecalibrado, derivadosCampoCit } = useMemo(() => {
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
      /** Las filas PREC completas: la conciliación de kg las necesita como tope de las re-pasadas (ver conciliacionKg.ts), aunque sigan fuera del stock. */
      entradasPrecalibrado: internas,
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

  // ─── Conciliación de kg procesados (reglas del dueño, 21-jul-2026) ─────────
  // El calibrador atribuye cada pasada al primer código de su nombre, pero en
  // línea se mezclan lotes (647 lotes con proc>entrada, 1,87 M kg de exceso;
  // 3,5 M kg de "stock fantasma" en lotes cuya fruta se procesó bajo otro
  // código). conciliarKgProcesados reparte multi-códigos, descuenta boxes de
  // reciclaje (~30 kg/box), acota el PREC y derrama los excesos a lotes con
  // pendiente (misma finca+variedad, luego misma variedad) — ver
  // src/lib/conciliacionKg.ts. El stock se construye con el resultado; los
  // datos crudos de lotes_dia no se tocan.
  // ─── Señal de cámara EXTERNA confirmada (Guadex/Zamexfruit) ────────────────
  // Ground truth del dueño 04-08-2026 (nº2, PRIORIDAD MÁXIMA): "un lote cuya
  // señal de cámara externa diga que SIGUE EN CÁMARA NO PUEDE recibir
  // derrames de exceso — es físicamente imposible que fruta que está en
  // Guadex haya pasado por el calibrador". Caso real que lo destapó: 4 lotes
  // de Guadex (26050809/26051106/26052207/26052506, Invermarmelo) recibían
  // kg del derrame por misma finca/variedad de otros lotes reales de
  // Invermarmelo y el auto-cierre por edad los cerraba "con_analisis" — el
  // accidente exacto que esto impide. Se calcula AQUÍ (no en la página) para
  // que conciliarKgProcesados pueda excluir estos lotes de sus candidatos al
  // derrame (fase 2) directamente — ver codigosEnCamaraExterna en
  // camarasExternas.ts. Reutiliza useCamarasExternas() (misma queryKey que la
  // página, sin fetch duplicado por el dedupe de React Query).
  const { camiones: camionesCamaraExterna } = useCamarasExternas();
  const codigosCamaraExterna = useMemo(() => {
    const salidaPorLote = new Map<string, string | null>();
    for (const e of entradas) {
      const salida = (e as { fecha_salida_camara?: string | null }).fecha_salida_camara ?? null;
      const merma = (e as { merma_camara_kg?: number | null }).merma_camara_kg ?? null;
      if (salida == null && merma == null) continue;
      const lote8 = normalizarLoteCodigo(e.lote);
      if (lote8) salidaPorLote.set(lote8, salida);
    }
    const lotesProcesados = new Set<string>();
    for (const p of procesadosQuery.data?.procesados ?? []) {
      const lote8 = normalizarLoteCodigo(p.lote_codigo);
      if (lote8) lotesProcesados.add(lote8);
    }
    const senales: SenalesRecepcion = { salidaPorLote, lotesProcesados };
    return codigosEnCamaraExterna(camionesCamaraExterna, senales, today());
  }, [entradas, procesadosQuery.data, camionesCamaraExterna]);

  // ─── Señal de CONFIRMACIÓN FÍSICA en cámara (refuerzo 04-08-2026) ──────────
  // Generalización de la protección anterior: el dueño puede confirmar a pie
  // de cámara (inventario físico) que un lote sigue intacto, sin depender de
  // ningún registro de cámara externa — columnas entradas_bascula.
  // camara_confirmada_nombre/camara_confirmada_fecha (migración
  // 20260804120000_camara_confirmada.sql). Origen: el dueño inventarió la
  // cámara 5 y encontró 26 lotes intactos a los que el derrame había
  // atribuido 310 t fantasma (9 ya cerrados solos). Ver camaraConfirmada.ts
  // para la vigencia: caduca sola en cuanto aparece una pasada PROPIA
  // posterior a la fecha de confirmación (misma detección "nombrado en
  // cualquier posición" que el resto del motor, nunca por LIKE/substring).
  const camaraConfirmadaPorLote = useMemo(() => {
    const entradasConSenal: EntradaConCamaraConfirmada[] = entradas.map((e) => ({
      lote: e.lote,
      camara_confirmada_nombre: e.camara_confirmada_nombre ?? null,
      camara_confirmada_fecha: e.camara_confirmada_fecha ?? null,
    }));
    return camaraConfirmadaVigentePorLote(entradasConSenal, procesadosQuery.data?.procesados ?? []);
  }, [entradas, procesadosQuery.data]);

  // Unión de ambas señales VIGENTES: el Set que conciliarKgProcesados y
  // buildStockEntradas reciben como `lotesConfirmadosEnCamara` (antes de este
  // refuerzo, ese parámetro solo cubría la señal de cámara externa — ver
  // los docstrings de conciliacionKg.ts/entradasBascula.ts para el porqué del
  // renombrado).
  const lotesConfirmadosEnCamara = useMemo(
    () => unirLotesConfirmadosEnCamara(codigosCamaraExterna, camaraConfirmadaPorLote),
    [codigosCamaraExterna, camaraConfirmadaPorLote],
  );

  const conciliacionKg = useMemo(() => {
    const aConciliacion = (e: EntradaBasculaRow, esPrec: boolean): EntradaConciliacion => ({
      lote: e.lote,
      fecha: e.fecha,
      finca: e.finca,
      articulo: e.articulo,
      kg_entrada: Number(e.kg_entrada) || 0,
      kg_preasignado: Math.max(0, Number(e.kg_ajuste_stock) || 0),
      esPrecalibrado: esPrec,
      cerrado: Boolean(e.cerrado_at),
      // Merma real de cámara (migración 20260721150000, sin tipos generados):
      // acota la capacidad del lote en la conciliación.
      kg_merma_camara: (e as { merma_camara_kg?: number | null }).merma_camara_kg ?? null,
    });
    return conciliarKgProcesados(
      [...entradas.map((e) => aConciliacion(e, false)), ...entradasPrecalibrado.map((e) => aConciliacion(e, true))],
      procesadosQuery.data?.procesados ?? [],
      procesadosQuery.data?.reciclajePorDia ?? [],
      lotesConfirmadosEnCamara,
    );
  }, [entradas, entradasPrecalibrado, procesadosQuery.data, lotesConfirmadosEnCamara]);

  // ─── Señales de calidad por lote: % industria y notas del operario ─────────
  // (para la ficha, la tabla del selector y la búsqueda por síntoma —
  // "densidad", "podrido"…). La media por variedad es ponderada: Σ kg
  // industria / Σ kg procesado de los lotes de ese articulo con dato.
  const calidadLotes = useMemo((): CalidadLotesDerivada => {
    const industriaKgPorLote = new Map<string, number>();
    const kgCrudoPorLote = new Map<string, number>();
    const notasPorLote = new Map<string, string>();
    for (const p of procesadosQuery.data?.procesados ?? []) {
      const clave = normalizarLoteCodigo(p.lote_codigo);
      if (!clave) continue;
      kgCrudoPorLote.set(clave, (kgCrudoPorLote.get(clave) ?? 0) + (Number(p.kg_peso_total) || 0));
      if (p.kg_industria > 0) industriaKgPorLote.set(clave, (industriaKgPorLote.get(clave) ?? 0) + p.kg_industria);
      if (esNotaOperarioLote(p.notas)) {
        const nota = (p.notas as string).trim();
        const previa = notasPorLote.get(clave);
        notasPorLote.set(clave, previa ? `${previa} · ${nota}` : nota);
      }
    }

    const pctIndustriaPorLote = new Map<string, number>();
    for (const [lote, kgInd] of industriaKgPorLote) {
      const base = kgCrudoPorLote.get(lote) ?? 0;
      if (base > 0) pctIndustriaPorLote.set(lote, Math.min(1, kgInd / base));
    }

    const acumuladoVariedad = new Map<string, { ind: number; base: number }>();
    for (const e of entradas) {
      const articulo = (e.articulo ?? "").trim();
      if (!articulo) continue;
      const kgInd = industriaKgPorLote.get(e.lote);
      if (kgInd == null) continue; // sin dato de industria: no cuenta en la media (no es un 0 medido)
      const base = kgCrudoPorLote.get(e.lote) ?? 0;
      if (base <= 0) continue;
      const acc = acumuladoVariedad.get(articulo) ?? { ind: 0, base: 0 };
      acc.ind += kgInd;
      acc.base += base;
      acumuladoVariedad.set(articulo, acc);
    }
    const mediaIndustriaPorVariedad = new Map<string, number>();
    for (const [articulo, acc] of acumuladoVariedad) {
      if (acc.base > 0) mediaIndustriaPorVariedad.set(articulo, acc.ind / acc.base);
    }

    return { industriaKgPorLote, pctIndustriaPorLote, mediaIndustriaPorVariedad, notasPorLote };
  }, [procesadosQuery.data, entradas]);

  const hoy = today();

  // ─── Lotes vistos como código NO-primero de una pasada compuesta ───────────
  // (refuerzo 2026-08-03/04-08: ver detectarLotesEnPasadaCompuesta en
  // conciliacionKg.ts): evidencia textual, no reparto de kg. Se calcula sobre
  // los datos CRUDOS de lotes_dia (procesadosQuery.data.procesados, con su
  // lote_codigo tal cual, ANTES de la conciliación) porque el patrón
  // "loteA+loteB" solo existe en el texto original. Se declara ANTES de
  // `stock` porque buildStockEntradas ya la consume (refuerzo 04-08-2026:
  // "procesado en compuesto" — ver la cabecera de entradasBascula.ts).
  const lotesEnPasadaCompuesta = useMemo(
    () => detectarLotesEnPasadaCompuesta(
      (procesadosQuery.data?.procesados ?? []).map((p) => ({ lote_codigo: p.lote_codigo, kg_peso_total: p.kg_peso_total, date: p.date })),
    ),
    [procesadosQuery.data],
  );

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
      conciliacionKg.procesados,
      hoy,
      lotesEnPasadaCompuesta,
      // Umbral de "COMPLETO" ajustado por edad (ground truth del dueño
      // 04-08-2026: 3 lotes de Guadex ~90 días con 87-95% procesado,
      // confirmados FÍSICAMENTE vacíos — el 97% plano es demasiado exigente
      // para lotes viejos). Misma fórmula que capacidad() usa para topar el
      // reparto, inyectada aquí en vez de importada en entradasBascula.ts
      // para no crear un ciclo de imports.
      capacidadFraccionEstimada,
      // Ground truth 04-08-2026 (nº2), generalizado el mismo día a la
      // confirmación física: protección simétrica en el propio StockLoteRow
      // (enCamaraConfirmada) para que ningún candidato de cierre recoja un
      // lote con señal vigente (cámara externa o confirmación física),
      // aunque algo más (derrame, ajuste de stock…) le haya dado kg — ver
      // esCandidatoCierreAutomatico/esCandidatoCierreCompuesto.
      lotesConfirmadosEnCamara,
      // Detalle (nombre + fecha) de la confirmación física vigente, solo
      // para pintar el badge en la pestaña Stock (StockLoteRow.confirmacionCamara).
      camaraConfirmadaPorLote,
    ),
    [entradas, conciliacionKg, hoy, lotesEnPasadaCompuesta, lotesConfirmadosEnCamara, camaraConfirmadaPorLote],
  );

  // ─── Candidatos al cierre automático PERSISTIDO (refuerzo 2026-08-03) ──────
  // esCandidatoCierreAutomatico (src/lib/entradasBascula.ts) decide sobre
  // StockLoteRow; aquí solo se junta con el `id` real de entradas_bascula
  // (StockLoteRow no lo trae) para poder disparar cerrarLotesEnBloque. La
  // página (EntradasBascula.tsx) es quien dispara la mutación al cargar la
  // pestaña Stock — este hook solo calcula QUIÉN es candidato, no escribe
  // nada por su cuenta (mismo principio que el resto de estados derivados).
  const candidatosCierreAutomatico = useMemo(() => {
    const entradaPorLote = new Map(entradas.map((e) => [e.lote, e]));
    const items: Array<{ id: string; lote: string }> = [];
    for (const fila of stock.filas) {
      if (!esCandidatoCierreAutomatico(fila, hoy)) continue;
      const entrada = entradaPorLote.get(fila.lote);
      if (entrada) items.push({ id: entrada.id, lote: fila.lote });
    }
    return items;
  }, [stock.filas, entradas, hoy]);

  // ─── Candidatos al cierre automático por evidencia de COMPUESTA (refuerzo
  // 04-08-2026, ver esCandidatoCierreCompuesto/StockLoteRow.procesadoEnCompuesto
  // en entradasBascula.ts): mismo patrón que candidatosCierreAutomatico, pero
  // el cierre_modo SIEMPRE es "sin_registro" — su kg no consta bajo su
  // código, no es una pérdida real medible.
  const candidatosCierreCompuesto = useMemo(() => {
    const entradaPorLote = new Map(entradas.map((e) => [e.lote, e]));
    const items: Array<{ id: string; lote: string }> = [];
    for (const fila of stock.filas) {
      if (!esCandidatoCierreCompuesto(fila, hoy)) continue;
      const entrada = entradaPorLote.get(fila.lote);
      if (entrada) items.push({ id: entrada.id, lote: fila.lote });
    }
    return items;
  }, [stock.filas, entradas, hoy]);

  return {
    entradas,
    stock,
    /** Re-entradas de PRECALIBRADO (filas completas): alimentan el "Stock de precalibrado" visible (src/lib/stockPrecalibrado.ts) — regla del dueño 2026-07-28: el precalibrado se ve siempre. */
    entradasPrecalibrado,
    procesados: procesadosQuery.data?.procesados ?? [],
    /** Reciclaje diario CRUDO del parte (Z1+Z2 netos + nº box), tal cual lo consume conciliarKgProcesados — expuesto para que otros consumidores (p.ej. useAsentamientoDia.ts) puedan re-ejecutar la MISMA conciliación sobre un prefijo de pasadas sin repetir el fetch de partes_diarios. */
    reciclajePorDia: procesadosQuery.data?.reciclajePorDia ?? [],
    /** Reparto de kg entre lotes hecho por conciliarKgProcesados (movimientos, cola de revisión, reciclaje, delta por lote) — para auditar y para los avisos de la ficha. */
    conciliacionKg,
    /** % industria y notas del operario por lote (señales de calidad para Trazabilidad). */
    calidadLotes,
    movimientosPrecalibrado,
    derivadosCampoCit,
    /** Candidatos (id + lote) al cierre automático persistido: COMPLETO (≥97% o calibrador>entrada) y ≥2 días sin pasada nueva. Ver esCandidatoCierreAutomatico. */
    candidatosCierreAutomatico,
    /** Candidatos (id + lote) al cierre automático por evidencia de COMPUESTA (refuerzo 04-08-2026): 0 kg propios pero nombrados como no-primero en una pasada compuesta, ≥2 días desde la última mención. Cierre SIEMPRE "sin_registro". Ver esCandidatoCierreCompuesto. */
    candidatosCierreCompuesto,
    /** lote -> evidencia (primeros códigos + última fecha) con la que apareció en una pasada compuesta (ver detectarLotesEnPasadaCompuesta). Alimenta tanto el Stock de lotes reales como el Stock de precalibrado (mismo mecanismo, dos superficies). */
    lotesEnPasadaCompuesta,
    /** lote (8 dígitos) -> confirmación FÍSICA vigente (nombre + fecha), ver camaraConfirmadaVigentePorLote en camaraConfirmada.ts. Ya está inyectada en `stock` (StockLoteRow.confirmacionCamara); se expone aparte para el diálogo de admin (ver ConfirmarLotesEnCamaraDialog.tsx), que necesita saber qué lotes están YA confirmados sin recorrer stock.filas. */
    camaraConfirmadaPorLote,
    isLoading: entradasQuery.isLoading || procesadosQuery.isLoading,
    error: entradasQuery.error ?? procesadosQuery.error,
    importar,
    importarStock,
    eliminar,
    cerrarLote,
    reabrirLote,
    cerrarLotesEnBloque,
    reabrirLotesEnBloque,
    actualizarCamaraConfirmada,
  };
}

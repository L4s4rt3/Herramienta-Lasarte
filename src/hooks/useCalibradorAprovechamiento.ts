/**
 * useCalibradorAprovechamiento — aprovechamiento del calibrador por productor.
 *
 * De dónde salen los datos: del volcado SQL del Compac Sizer
 * (calibrador_clasificacion, ver docs/ERP_LR_INFORMATICA.md y
 * scripts/README-receptor-calibrador.md). La agregación la hace la RPC
 * `calibrador_aprovechamiento_productor` en la base, que desde el 04-09-2026
 * lee la VISTA CANÓNICA clasificacion_lote: son ~228.000 filas y no tiene
 * sentido traerlas al navegador para sumarlas aquí.
 *
 * TRES COSAS QUE LA RPC RESUELVE Y CONVIENE SABER:
 *
 * 1. La regla de frescura por lote-día de la vista: si ese lote-día está en el
 *    volcado SQL manda el SQL (todas las pasadas del día); si no, el Word de
 *    lote (solo la última pasada del día) y, si tampoco, el Excel manual. Los
 *    kilos que no vienen del volcado se cuentan en `kg_provisional`: 225 de 864
 *    lotes pasan por la máquina más de una vez y el Word los deja cortos.
 *
 * 2. El productor se resuelve por CÓDIGO DE LOTE contra entradas_bascula y su
 *    productor_id canónico, nunca por nombre (los alias de finca darían
 *    atribuciones falsas — ver src/lib/productoresCanonicos.ts). Y por el lote
 *    que RECIBE los kilos (lote_codigo_base), no por el primero del nombre.
 *
 * 3. EL REPARTO DE LAS PASADAS COMPUESTAS ES CANÓNICO (nota 04-09-2026). El
 *    Sizer atribuye toda una pasada "26013107+26012608" al primer código; hasta
 *    hoy el reparto entre los lotes nombrados se hacía AQUÍ, en el navegador
 *    (aplicarReparto con box y capacidad sobre tres RPC auxiliares), y ninguna
 *    otra pantalla lo veía: esta tabla daba un número y la trazabilidad, las
 *    mermas o el aprovechamiento por parcela daban otro. Ahora lo calcula una
 *    edge function en el servidor, lo guarda en calibrador_pasada_reparto
 *    (fracción y kg por lote, método manual/box/capacidad) y la cola de lo que
 *    no se puede repartir solo en calibrador_pasada_sin_repartir, y la vista lo
 *    aplica fila a fila. Las filas de la RPC llegan YA repartidas; este hook
 *    solo lee las dos tablas para poder decir cuántas pasadas se repartieron,
 *    cuántos kilos cambiaron de lote y por qué método, y cuáles siguen en cola
 *    con su motivo.
 *
 * LOS KILOS QUE NO SE PUEDEN ATRIBUIR SE VEN (migración 20260812090000). Hay
 * pasadas cuyo BatchName no lleva ningún grupo de 8 dígitos ("22/07 22 BOX -
 * 23/07 43 BOX"): son kilos reales que la máquina clasificó, pero sin lote no
 * hay productor al que apuntarlos. La RPC los devuelve agrupados y este hook
 * los separa en `sinAtribuir` para que la pantalla los enseñe aparte — antes se
 * perdían en un JOIN y el total salía 142.073 kg corto sin decirlo.
 *
 * Las dos tablas del reparto no están todavía en types.ts (los tipos se
 * regeneran aparte): se leen con supabaseLibre (el MISMO cliente y sesión, sin
 * el tipo Database) y las filas se tipan aquí, como hace useEstandarRendimiento.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase, supabaseLibre } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/fetchAllRows";
import {
  esAgricultorMovimientoInterno,
  esEntradaPrecalibrado,
  esProductorPrecalibrado,
} from "@/lib/productoresCanonicos";

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
  /**
   * De esos kilos, los que salen de informes DOCX (o del Excel manual) y no del
   * volcado SQL. De un lote con varias pasadas EL MISMO DÍA el DOCX solo trae
   * la última (2,9% de los pares lote-día en la campaña), así que un total con
   * esto por encima de cero puede quedarse corto. Se enseña para que nadie
   * juzgue por lo bajo a un productor sin saberlo.
   */
  kg_provisional: number;
}

const num = (v: unknown): number => Number(v) || 0;

/**
 * La fila del hueco no es un productor: no debe competir en el ranking ni
 * ensuciar la media de exportación, pero SÍ tiene que verse (se saca aparte).
 */
const esHueco = (p: AprovechamientoProductor) =>
  p.productor_id == null && p.productor.startsWith("(sin lote legible");

/**
 * ¿Esta fila es un productor de verdad?
 *
 * Regla ya establecida (productoresCanonicos.ts, revisada 2026-07-16): los
 * RANKINGS y dossiers de productores excluyen el pseudo-productor PRECALIBRADO
 * y los movimientos internos de confección/sobrante — no son productores, son
 * fruta de la casa volviendo a pasar. Sus kilos siguen contando para el cruce
 * de kg procesado, pero mezclarlos en un ranking de "quién aprovecha mejor" es
 * comparar una finca con un almacén. Los huecos propios de esta pantalla van
 * entre paréntesis y tampoco lo son.
 */
export function esProductorReal(p: { productor_id: string | null; productor: string }): boolean {
  const n = p.productor ?? "";
  if (n.startsWith("(")) return false;
  if (esProductorPrecalibrado(n)) return false;
  if (esAgricultorMovimientoInterno(n)) return false;
  return !esEntradaPrecalibrado({ agricultor: n, finca: null });
}

/**
 * Pasadas cuyo nombre dice que se echó algo más (RPC
 * calibrador_desglose_sin_repartir): el UNIVERSO del problema, esté ya
 * repartido o no. Sirve para decir "de estas N, tantas repartidas y tantas en
 * cola"; el nombre de la RPC es anterior al reparto canónico.
 */
export interface DesgloseSinRepartir {
  pasadas: number;
  kg: number;
  pasadas_varios_lotes: number;
}

// ─── El reparto canónico: qué se guarda y cómo se resume ─────────────────────

/** Fila de public.calibrador_pasada_reparto: un lote que recibe parte de una pasada compuesta. */
export interface FilaPasadaReparto {
  batch_id: number;
  lote8: string | null;
  fraccion: number | string | null;
  kg: number | string | null;
  /** 'manual' | 'box' | 'capacidad'. */
  metodo: string | null;
  /** 1 = el primer código del nombre (donde el Sizer lo había puesto todo); >1 = los lotes que reciben lo movido. */
  orden: number | string | null;
}

/** Fila de public.calibrador_pasada_sin_repartir: la cola, con el porqué tal cual se enseña. */
export interface PasadaEnCola {
  batch_id: number;
  batch_name: string;
  fecha: string;
  kg_total: number;
  motivo: string;
}

export const LABEL_METODO_REPARTO: Record<string, string> = {
  manual: "a mano",
  box: "por los box que escribió el operario",
  capacidad: "por la capacidad pendiente de cada lote",
};

export interface RepartoPorMetodo {
  metodo: string;
  etiqueta: string;
  pasadas: number;
  kgMovidos: number;
}

export interface ResumenReparto {
  /** Pasadas compuestas repartidas: batch_id distintos en calibrador_pasada_reparto. */
  pasadas: number;
  /** Kilos que cambiaron de lote: Σ kg de las filas con orden > 1 (lo que NO se quedó en el primer código). */
  kgMovidos: number;
  /** Lo mismo, por método, de más a menos kilos movidos. */
  porMetodo: RepartoPorMetodo[];
}

/**
 * Resume las filas del reparto (pura, sin red). Cada pasada se cuenta una vez
 * y sus kilos movidos son los de las filas con orden > 1; el método es el de la
 * pasada (todas sus filas llevan el mismo; si no, manda la primera).
 */
export function resumirReparto(filas: FilaPasadaReparto[]): ResumenReparto {
  const porPasada = new Map<number, { metodo: string; kgMovidos: number }>();
  for (const f of filas) {
    const p = porPasada.get(f.batch_id) ?? { metodo: f.metodo ?? "?", kgMovidos: 0 };
    if (num(f.orden) > 1) p.kgMovidos += num(f.kg);
    porPasada.set(f.batch_id, p);
  }
  const porMetodo = new Map<string, RepartoPorMetodo>();
  let kgMovidos = 0;
  for (const p of porPasada.values()) {
    const m = porMetodo.get(p.metodo) ?? {
      metodo: p.metodo,
      etiqueta: LABEL_METODO_REPARTO[p.metodo] ?? `por «${p.metodo}»`,
      pasadas: 0,
      kgMovidos: 0,
    };
    m.pasadas += 1;
    m.kgMovidos += p.kgMovidos;
    porMetodo.set(p.metodo, m);
    kgMovidos += p.kgMovidos;
  }
  return {
    pasadas: porPasada.size,
    kgMovidos,
    porMetodo: [...porMetodo.values()].sort((a, b) => b.kgMovidos - a.kgMovidos),
  };
}

/** Día (YYYY-MM-DD) en Madrid de un instante ISO: la misma regla que la vista para la fecha de una pasada. */
function diaMadrid(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("sv-SE", { timeZone: "Europe/Madrid" });
}

/**
 * batch_id de las pasadas repartidas que caen en [desde, hasta]. La tabla del
 * reparto no lleva fecha (la pasada la tiene en calibrador_batch), así que solo
 * se consulta cuando la pantalla acota el rango; sin rango es toda la campaña y
 * devuelve null (= no filtrar).
 */
async function batchIdsEnRango(ids: number[], desde: string | null, hasta: string | null): Promise<Set<number> | null> {
  if (!desde && !hasta) return null;
  const dentro = new Set<number>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await supabase
      .from("calibrador_batch")
      .select("batch_id, inicio")
      .in("batch_id", ids.slice(i, i + 200));
    if (error) throw new Error(error.message);
    for (const b of data ?? []) {
      const dia = diaMadrid(b.inicio);
      if (!dia) continue;
      if (desde && dia < desde) continue;
      if (hasta && dia > hasta) continue;
      dentro.add(b.batch_id);
    }
  }
  return dentro;
}

interface FilaColaCruda {
  batch_id: number | string | null;
  batch_name: string | null;
  fecha: string | null;
  kg_total: number | string | null;
  motivo: string | null;
}

export function useCalibradorAprovechamiento(desde?: string | null, hasta?: string | null) {
  const d = desde ?? null;
  const h = hasta ?? null;

  const desglose = useQuery({
    queryKey: ["calibrador-desglose-sin-repartir", d, h],
    queryFn: async (): Promise<DesgloseSinRepartir | null> => {
      const { data, error } = await supabase.rpc("calibrador_desglose_sin_repartir", {
        desde: d ?? undefined,
        hasta: h ?? undefined,
      });
      if (error) {
        // Es contexto, no el dato: si esta RPC no está, la pantalla sigue.
        console.warn(`[calibrador] no se pudo leer calibrador_desglose_sin_repartir (${error.message})`);
        return null;
      }
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
    queryKey: ["calibrador-aprovechamiento", d, h],
    queryFn: async (): Promise<AprovechamientoProductor[]> => {
      const { data, error } = await supabase.rpc("calibrador_aprovechamiento_productor", {
        desde: d ?? undefined,
        hasta: h ?? undefined,
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
        kg_provisional: num(r.kg_provisional),
      }));
    },
  });

  // Las dos tablas del reparto canónico. Van en una consulta APARTE de la RPC a
  // propósito: si el SQL del reparto no estuviera aplicado, la tabla de
  // productores se enseña igual (ya viene repartida de la vista) y aquí se
  // dice que falta el detalle, en vez de tumbar la pantalla entera.
  const reparto = useQuery({
    queryKey: ["calibrador-reparto-canonico", d, h],
    queryFn: async (): Promise<{ resumen: ResumenReparto; cola: PasadaEnCola[] }> => {
      // Pocas filas (una por lote de cada pasada compuesta), pero la regla del
      // repo es paginar todo SELECT no acotado por diseño. (batch_id, orden) es
      // único: orden estable.
      const filas = await fetchAllRows<FilaPasadaReparto>((from, to) =>
        supabaseLibre
          .from("calibrador_pasada_reparto")
          .select("batch_id, lote8, fraccion, kg, metodo, orden")
          .order("batch_id")
          .order("orden")
          .range(from, to),
      );
      const ids = [...new Set(filas.map((f) => num(f.batch_id)))];
      const enRango = await batchIdsEnRango(ids, d, h);
      const filasRango = enRango ? filas.filter((f) => enRango.has(num(f.batch_id))) : filas;

      // La cola sí lleva fecha: el rango de la pantalla se aplica en servidor.
      // El constructor se crea DENTRO del callback: fetchAllRows lo llama una
      // vez por página y un builder de supabase-js reutilizado acumularía
      // .order()/.range().
      const colaCruda = await fetchAllRows<FilaColaCruda>((from, to) => {
        let q = supabaseLibre
          .from("calibrador_pasada_sin_repartir")
          .select("batch_id, batch_name, fecha, kg_total, motivo");
        if (d) q = q.gte("fecha", d);
        if (h) q = q.lte("fecha", h);
        return q.order("batch_id").range(from, to);
      });

      return {
        resumen: resumirReparto(filasRango.map((f) => ({ ...f, batch_id: num(f.batch_id) }))),
        cola: colaCruda.map((c) => ({
          batch_id: num(c.batch_id),
          batch_name: String(c.batch_name ?? ""),
          fecha: String(c.fecha ?? ""),
          kg_total: num(c.kg_total),
          motivo: String(c.motivo ?? ""),
        })),
      };
    },
    retry: 1,
  });

  const filas = query.data;

  // Sin el reparto en cliente, la tabla es la de la RPC tal cual: solo se
  // separa lo que no es un productor (precalibrado, movimientos internos,
  // huecos) y se ordena por kilos, que es como se lee el ranking.
  const separadas = useMemo(() => {
    const sinHueco = (filas ?? []).filter((p) => !esHueco(p)).sort((a, b) => b.kg_total - a.kg_total);
    return {
      productores: sinHueco.filter(esProductorReal),
      noProductores: sinHueco.filter((p) => !esProductorReal(p)),
    };
  }, [filas]);

  return {
    productores: separadas.productores,
    /** Filas que no son un productor (precalibrado sin origen, movimientos internos). */
    noProductores: separadas.noProductores,
    /** Kilos que la máquina clasificó pero no se pueden atribuir a nadie. */
    sinAtribuir: filas?.find(esHueco) ?? null,
    /** De todo lo anterior, cuántos kilos salen del Word/Excel y no del volcado SQL. */
    kgProvisional: (filas ?? []).reduce((s, f) => s + f.kg_provisional, 0),
    /** El universo de pasadas cuyo nombre dice que se echó algo más (repartidas o no). */
    desgloseSinRepartir: desglose.data ?? null,
    /** El reparto canónico del rango: null mientras carga o si no se pudo leer (ver repartoError). */
    reparto: reparto.data?.resumen ?? null,
    /** Las que necesitan que alguien diga algo, con el porqué de cada una. */
    cola: reparto.data?.cola ?? [],
    /** Motivo por el que no se pudo leer el reparto canónico; null si se leyó. */
    repartoError: reparto.error ? (reparto.error instanceof Error ? reparto.error.message : String(reparto.error)) : null,
    isLoading: query.isLoading,
    repartoLoading: reparto.isLoading,
    error: query.error,
  };
}

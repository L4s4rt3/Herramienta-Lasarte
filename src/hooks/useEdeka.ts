/**
 * useEdeka — resumen comercial de lo enviado al cliente EDEKA, sacado
 * palet a palet de los partes diarios (tabla palets_dia, cliente ilike
 * "%edeka%"; el valor real en la base es "EDEKA EINKAUFSKONTOR GMBH").
 *
 * ⚠️ AVISO DE NEGOCIO (mismo aprendizaje que useMercadonaExpediciones): no
 * existe un Excel de ventas de Edeka como el de Mercadona. Todo lo que hay
 * son los palets apuntados en los partes, y ese registro es PARCIAL — no
 * todos los envíos se apuntan. Cualquier pantalla que use este hook debe
 * dejarlo claro (banner/nota), nunca presentarlo como el total real vendido.
 *
 * palets_dia no tiene columna de fecha propia: se llega a la fecha vía
 * part_id -> partes_diarios.date, igual que useMercadonaExpediciones. Como
 * el volumen de palets Edeka es muy bajo (~18 en toda la base a día de hoy),
 * basta con UNA query a todos los partes con fecha, cruzando en cliente
 * contra los palets Edeka (en vez de acotar por rango, que aquí no aplica:
 * queremos el histórico completo).
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getISOWeek, getISOWeekYear, startOfISOWeek } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/fetchAllRows";
import { toISODateLocal } from "@/lib/format";

const IN_CHUNK_SIZE = 200;

interface PaletRow {
  part_id: string;
  palet_id: string | null;
  producto: string | null;
  destino: string | null;
  kg_neto: number;
  n_cajas: number | null;
  situacion: string | null;
}

export interface EdekaEnvio {
  date: string;
  palet_id: string | null;
  producto: string;
  destino: string | null;
  situacion: string | null;
  kg: number;
  cajas: number;
}

export interface EdekaProducto {
  producto: string;
  palets: number;
  kg: number;
  cajas: number;
  pct: number;
}

export interface EdekaDestino {
  destino: string;
  palets: number;
  kg: number;
}

export interface EdekaSemana {
  anio: number;
  semana: number;
  /** Fecha (lunes) de inicio de la semana ISO, para etiquetar el eje. */
  inicio: string;
  kg: number;
  palets: number;
}

async function fetchTodosLosPartes(): Promise<Map<string, string>> {
  // partes_diarios sin filtro (histórico completo): va camino de las 1.000
  // filas (creciendo), se pagina por seguridad de cara al futuro; el
  // .limit(100000) no era una protección real (PostgREST recorta a su
  // max-rows en silencio).
  const data = await fetchAllRows<{ id: string; date: string }>((from, to) =>
    supabase.from("partes_diarios").select("id, date").order("id").range(from, to),
  );
  return new Map(data.map((p) => [p.id, p.date]));
}

async function fetchPaletsEdekaEnChunks(partIds: string[]): Promise<PaletRow[]> {
  // El volumen de palets Edeka es bajo (~18 en toda la base), pero el
  // ilike("cliente") se aplica DESPUÉS del filtro por chunk de partes: cada
  // chunk de 200 partes barre TODOS sus palets antes de filtrar, así que se
  // pagina igual que el resto de hooks de este patrón por si acaso.
  const rows: PaletRow[] = [];
  for (let i = 0; i < partIds.length; i += IN_CHUNK_SIZE) {
    const chunk = partIds.slice(i, i + IN_CHUNK_SIZE);
    const chunkRows = await fetchAllRows<PaletRow>((from, to) =>
      supabase
        .from("palets_dia")
        .select("part_id, palet_id, producto, destino, kg_neto, n_cajas, situacion")
        .in("part_id", chunk)
        .ilike("cliente", "%edeka%")
        .order("id")
        .range(from, to),
    );
    rows.push(...chunkRows);
  }
  return rows;
}

export interface EdekaResumen {
  n_palets: number;
  kg_total: number;
  n_cajas: number;
  kg_por_palet: number;
  primer_envio: string | null;
  ultimo_envio: string | null;
  por_producto: EdekaProducto[];
  por_destino: EdekaDestino[];
  por_semana: EdekaSemana[];
  envios: EdekaEnvio[];
}

const RESUMEN_VACIO: EdekaResumen = {
  n_palets: 0,
  kg_total: 0,
  n_cajas: 0,
  kg_por_palet: 0,
  primer_envio: null,
  ultimo_envio: null,
  por_producto: [],
  por_destino: [],
  por_semana: [],
  envios: [],
};

/**
 * Histórico completo de palets enviados a Edeka. Sin parámetros: no hay
 * rango de fechas que filtrar porque el volumen es bajo y se quiere ver
 * todo el histórico de una vez (a diferencia de Mercadona, que navega
 * semana a semana sobre un volumen mucho mayor).
 */
export function useEdeka() {
  const query = useQuery({
    queryKey: ["edeka-envios"],
    queryFn: async (): Promise<{ palets: PaletRow[]; partesById: Map<string, string> }> => {
      const partesById = await fetchTodosLosPartes();
      if (partesById.size === 0) return { palets: [], partesById };
      const palets = await fetchPaletsEdekaEnChunks(Array.from(partesById.keys()));
      return { palets, partesById };
    },
  });

  const resumen = useMemo<EdekaResumen>(() => {
    const { palets, partesById } = query.data ?? { palets: [] as PaletRow[], partesById: new Map<string, string>() };
    if (palets.length === 0) return RESUMEN_VACIO;

    const envios: EdekaEnvio[] = palets
      .map((p) => ({
        date: partesById.get(p.part_id) ?? "",
        palet_id: p.palet_id,
        producto: (p.producto ?? "").trim() || "Sin producto",
        destino: p.destino ? p.destino.trim() || null : null,
        situacion: p.situacion ? p.situacion.trim() || null : null,
        kg: Number(p.kg_neto) || 0,
        cajas: Number(p.n_cajas) || 0,
      }))
      .filter((e) => e.date)
      .sort((a, b) => b.date.localeCompare(a.date));

    const n_palets = envios.length;
    const kg_total = envios.reduce((s, e) => s + e.kg, 0);
    const n_cajas = envios.reduce((s, e) => s + e.cajas, 0);
    const kg_por_palet = n_palets > 0 ? kg_total / n_palets : 0;

    const fechasOrdenadas = envios.map((e) => e.date).sort();
    const primer_envio = fechasOrdenadas[0] ?? null;
    const ultimo_envio = fechasOrdenadas[fechasOrdenadas.length - 1] ?? null;

    const porProductoMap = new Map<string, { palets: number; kg: number; cajas: number }>();
    for (const e of envios) {
      const entry = porProductoMap.get(e.producto) ?? { palets: 0, kg: 0, cajas: 0 };
      entry.palets += 1;
      entry.kg += e.kg;
      entry.cajas += e.cajas;
      porProductoMap.set(e.producto, entry);
    }
    const por_producto: EdekaProducto[] = Array.from(porProductoMap.entries())
      .map(([producto, v]) => ({
        producto,
        palets: v.palets,
        kg: v.kg,
        cajas: v.cajas,
        pct: kg_total > 0 ? (v.kg / kg_total) * 100 : 0,
      }))
      .sort((a, b) => b.kg - a.kg);

    const porDestinoMap = new Map<string, { palets: number; kg: number }>();
    for (const e of envios) {
      if (!e.destino) continue;
      const entry = porDestinoMap.get(e.destino) ?? { palets: 0, kg: 0 };
      entry.palets += 1;
      entry.kg += e.kg;
      porDestinoMap.set(e.destino, entry);
    }
    const por_destino: EdekaDestino[] = Array.from(porDestinoMap.entries())
      .map(([destino, v]) => ({ destino, ...v }))
      .sort((a, b) => b.kg - a.kg);

    const porSemanaMap = new Map<string, { anio: number; semana: number; inicio: string; kg: number; palets: number }>();
    for (const e of envios) {
      const fecha = new Date(`${e.date}T12:00:00`);
      if (Number.isNaN(fecha.getTime())) continue;
      const anio = getISOWeekYear(fecha);
      const semana = getISOWeek(fecha);
      const key = `${anio}-${semana}`;
      const entry = porSemanaMap.get(key) ?? {
        anio,
        semana,
        inicio: toISODateLocal(startOfISOWeek(fecha)),
        kg: 0,
        palets: 0,
      };
      entry.kg += e.kg;
      entry.palets += 1;
      porSemanaMap.set(key, entry);
    }
    const por_semana: EdekaSemana[] = Array.from(porSemanaMap.values()).sort((a, b) => a.inicio.localeCompare(b.inicio));

    return { n_palets, kg_total, n_cajas, kg_por_palet, primer_envio, ultimo_envio, por_producto, por_destino, por_semana, envios };
  }, [query.data]);

  return {
    ...resumen,
    isLoading: query.isLoading,
    error: query.error,
  };
}

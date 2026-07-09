/**
 * useMercadonaLotes — "Lotes y productores" de Mercadona: qué fruta y qué
 * productores rinden de verdad para el cliente, cruzando lotes_dia,
 * producto_dia y calidad_lotes.
 *
 * METODOLOGÍA de aprovechamiento MDNA por productor (aproximación honesta,
 * NO hay trazabilidad lote → formato exacta en los datos de planta):
 *   1. % MDNA de cada DÍA = kg de productos MDNA en producto_dia / kg totales
 *      del día (excluyendo siempre la fila TOTAL, que trae producto = null).
 *   2. Aprovechamiento estimado de un productor =
 *        Σ (kg del lote × % MDNA del día del lote) / Σ kg de sus lotes
 *      es decir, un reparto proporcional del % MDNA de cada día entre todos
 *      los lotes servidos ese día (no sabemos qué lote concreto acabó en qué
 *      formato). Se etiqueta siempre en la UI como "estimado por reparto diario".
 *
 * Fuentes:
 * - lotes_dia: lotes de producción (part_id, productor, lote_codigo, producto,
 *   kg_peso_total, toneladas_hora, duracion_min, peso_fruta_promedio_g).
 * - producto_dia: confección por línea (part_id, producto, kg); el % MDNA
 *   del día sale de aquí (productos cuyo nombre contiene "MDNA").
 * - calidad_lotes: control de calidad por fecha (no por cliente: el cruce con
 *   Mercadona es solo por fecha dentro de la semana, por eso es "orientativo").
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import type { MercadonaSemanaConMetodos } from "@/hooks/useMercadonaVentas";
import { normalizeNombre } from "@/hooks/useProductores";
import { mercadonaWeekDateRange } from "@/lib/mercadonaVentas";
import { esProductoMdna } from "@/hooks/useMercadona";
import type { CalidadEstado, CalidadInformeEstado } from "@/lib/calidad";
import type { CalidadInformeLote } from "@/components/CalidadInformeDialog";

const IN_CHUNK_SIZE = 200;
const MIN_LOTES_RANKING = 3;

type LoteDiaRow = Pick<
  Tables<"lotes_dia">,
  "part_id" | "productor" | "lote_codigo" | "producto" | "kg_peso_total" | "toneladas_hora" | "duracion_min" | "peso_fruta_promedio_g"
>;

interface ProductoDiaRow {
  part_id: string;
  producto: string | null;
  kg: number;
}

export interface MercadonaLoteSemana {
  key: string;
  loteCodigo: string;
  productor: string;
  producto: string;
  date: string;
  kg: number;
  tph: number | null;
  duracionMin: number | null;
  pesoFrutaG: number | null;
  pctMdnaDia: number | null;
}

export interface MercadonaCalidadSemana {
  id: string;
  fecha: string;
  numeroLote: string;
  productor: string;
  producto: string;
  variedad: string;
  calidad: string;
  defectos: string[];
  observacion: string;
  /** Shape completo listo para <CalidadInformeDialog>, con todos los campos del informe. */
  informe: CalidadInformeLote;
}

export interface MercadonaProductorHistorico {
  productor: string;
  kg: number;
  nLotes: number;
  pctMdnaEstimado: number;
}

async function fetchPartesEnRango(desde: string, hasta: string): Promise<Map<string, string>> {
  const { data, error } = await supabase
    .from("partes_diarios")
    .select("id, date")
    .gte("date", desde)
    .lte("date", hasta);
  if (error) throw error;
  return new Map((data ?? []).map((p) => [p.id as string, p.date as string]));
}

async function fetchLotesDiaByPartIds(ids: string[]): Promise<LoteDiaRow[]> {
  const rows: LoteDiaRow[] = [];
  for (let i = 0; i < ids.length; i += IN_CHUNK_SIZE) {
    const chunk = ids.slice(i, i + IN_CHUNK_SIZE);
    const { data, error } = await supabase
      .from("lotes_dia")
      .select("part_id, productor, lote_codigo, producto, kg_peso_total, toneladas_hora, duracion_min, peso_fruta_promedio_g")
      .in("part_id", chunk)
      .limit(100000);
    if (error) throw error;
    rows.push(...((data ?? []) as LoteDiaRow[]));
  }
  return rows;
}

async function fetchProductoDiaByPartIds(ids: string[]): Promise<ProductoDiaRow[]> {
  const rows: ProductoDiaRow[] = [];
  for (let i = 0; i < ids.length; i += IN_CHUNK_SIZE) {
    const chunk = ids.slice(i, i + IN_CHUNK_SIZE);
    const { data, error } = await supabase
      .from("producto_dia")
      .select("part_id, producto, kg")
      .in("part_id", chunk)
      .limit(100000);
    if (error) throw error;
    rows.push(...((data ?? []) as ProductoDiaRow[]));
  }
  return rows;
}

/** % MDNA por fecha (día) a partir de producto_dia, excluyendo la fila TOTAL (producto null/vacío). */
export function pctMdnaPorDia(productos: ProductoDiaRow[], partesById: Map<string, string>): Map<string, number> {
  const porDia = new Map<string, { total: number; mdna: number }>();
  for (const p of productos) {
    const nombre = (p.producto ?? "").trim();
    if (!nombre) continue; // fila TOTAL del día
    const date = partesById.get(p.part_id);
    if (!date) continue;
    const entry = porDia.get(date) ?? { total: 0, mdna: 0 };
    const kg = Number(p.kg) || 0;
    entry.total += kg;
    // El precalibrado (PREC) NO cuenta como MDNA en el aprovechamiento.
    if (esProductoMdna(nombre)) entry.mdna += kg;
    porDia.set(date, entry);
  }
  const pctPorDia = new Map<string, number>();
  for (const [date, v] of porDia.entries()) {
    pctPorDia.set(date, v.total > 0 ? (v.mdna / v.total) * 100 : 0);
  }
  return pctPorDia;
}

export interface CalidadIndex {
  porLote: Map<string, MercadonaCalidadSemana>;
  porProductorFecha: Map<string, MercadonaCalidadSemana>;
}

/**
 * Índice de controles de calidad de la semana para poder cruzarlos con los
 * lotes de producción: por número de lote (match exacto, prioritario) y por
 * productor + fecha (fallback "orientativo", igual que el resto de cruces
 * de esta pestaña). Si hay varios controles para la misma clave se queda con
 * el primero (la query ya viene ordenada por fecha desc).
 */
export function buildCalidadIndex(controles: MercadonaCalidadSemana[]): CalidadIndex {
  const porLote = new Map<string, MercadonaCalidadSemana>();
  const porProductorFecha = new Map<string, MercadonaCalidadSemana>();
  for (const c of controles) {
    const codigo = c.numeroLote.trim();
    if (codigo && !porLote.has(codigo)) porLote.set(codigo, c);
    const key = `${normalizeNombre(c.productor)}__${c.fecha}`;
    if (!porProductorFecha.has(key)) porProductorFecha.set(key, c);
  }
  return { porLote, porProductorFecha };
}

/**
 * Empareja un lote de producción (lotes_dia) con su control de calidad
 * (calidad_lotes): primero por número de lote (lote_codigo === numero_lote),
 * y si no hay match, por productor + fecha. Devuelve null si no hay ningún
 * control de calidad asociado a ese lote.
 */
export function matchCalidadParaLote(
  lote: Pick<MercadonaLoteSemana, "loteCodigo" | "productor" | "date">,
  index: CalidadIndex,
): MercadonaCalidadSemana | null {
  const codigo = lote.loteCodigo.trim();
  if (codigo && codigo !== "Sin código") {
    const match = index.porLote.get(codigo);
    if (match) return match;
  }
  if (lote.productor === "Sin productor") return null;
  const key = `${normalizeNombre(lote.productor)}__${lote.date}`;
  return index.porProductorFecha.get(key) ?? null;
}

/**
 * Lotes de la semana activa: kg, T/h, peso medio de fruta y % MDNA del día
 * correspondiente a cada lote.
 */
function useMercadonaLotesSemana(desde: string | null, hasta: string | null) {
  const query = useQuery({
    queryKey: ["mercadona-lotes-semana", desde, hasta],
    queryFn: async (): Promise<MercadonaLoteSemana[]> => {
      if (!desde || !hasta) return [];
      const partesById = await fetchPartesEnRango(desde, hasta);
      if (partesById.size === 0) return [];
      const ids = Array.from(partesById.keys());

      const [lotes, productos] = await Promise.all([
        fetchLotesDiaByPartIds(ids),
        fetchProductoDiaByPartIds(ids),
      ]);

      const pctPorDia = pctMdnaPorDia(productos, partesById);

      return lotes
        .map((l, i): MercadonaLoteSemana => {
          const date = partesById.get(l.part_id) ?? "";
          return {
            key: `${l.part_id}-${l.lote_codigo ?? "sin-codigo"}-${i}`,
            loteCodigo: (l.lote_codigo ?? "").trim() || "Sin código",
            productor: (l.productor ?? "").trim() || "Sin productor",
            producto: (l.producto ?? "").trim() || "Sin producto",
            date,
            kg: Number(l.kg_peso_total) || 0,
            tph: l.toneladas_hora != null ? Number(l.toneladas_hora) : null,
            duracionMin: l.duracion_min != null ? Number(l.duracion_min) : null,
            pesoFrutaG: l.peso_fruta_promedio_g != null ? Number(l.peso_fruta_promedio_g) : null,
            pctMdnaDia: pctPorDia.get(date) ?? null,
          };
        })
        .sort((a, b) => b.kg - a.kg);
    },
    enabled: Boolean(desde && hasta),
  });

  return { lotes: query.data ?? [], isLoading: query.isLoading, error: query.error };
}

/**
 * Agrega lotes por productor y calcula el aprovechamiento MDNA estimado de
 * cada uno: Σ (kg del lote × % MDNA de su día) / Σ kg de sus lotes. Excluye
 * productores con menos de MIN_LOTES_RANKING lotes. Función pura (testable
 * sin red/React Query): recibe ya resueltos los lotes, el % MDNA por día y
 * el mapa part_id → fecha.
 */
export function computeProductoresHistorico(
  lotes: LoteDiaRow[],
  pctPorDia: Map<string, number>,
  partesById: Map<string, string>,
): MercadonaProductorHistorico[] {
  const porProductor = new Map<string, { kg: number; nLotes: number; kgPonderadoMdna: number }>();
  for (const l of lotes) {
    const nombre = (l.productor ?? "").trim() || "Sin productor";
    const date = partesById.get(l.part_id) ?? "";
    const kg = Number(l.kg_peso_total) || 0;
    const pctDia = pctPorDia.get(date) ?? 0;

    const entry = porProductor.get(nombre) ?? { kg: 0, nLotes: 0, kgPonderadoMdna: 0 };
    entry.kg += kg;
    entry.nLotes += 1;
    entry.kgPonderadoMdna += kg * (pctDia / 100);
    porProductor.set(nombre, entry);
  }

  return Array.from(porProductor.entries())
    .map(([productor, v]): MercadonaProductorHistorico => ({
      productor,
      kg: v.kg,
      nLotes: v.nLotes,
      pctMdnaEstimado: v.kg > 0 ? (v.kgPonderadoMdna / v.kg) * 100 : 0,
    }))
    .filter((p) => p.nLotes >= MIN_LOTES_RANKING)
    .sort((a, b) => b.pctMdnaEstimado - a.pctMdnaEstimado);
}

/**
 * Ranking histórico de productores (toda la campaña, todos los partes) por
 * aprovechamiento MDNA estimado. Mínimo 3 lotes para aparecer en el ranking.
 */
function useMercadonaProductoresHistorico() {
  const query = useQuery({
    queryKey: ["mercadona-productores-historico"],
    queryFn: async (): Promise<MercadonaProductorHistorico[]> => {
      const { data: partes, error: partesError } = await supabase
        .from("partes_diarios")
        .select("id, date");
      if (partesError) throw partesError;
      if (!partes || partes.length === 0) return [];

      const partesById = new Map(partes.map((p) => [p.id as string, p.date as string]));
      const ids = Array.from(partesById.keys());

      const [lotes, productos] = await Promise.all([
        fetchLotesDiaByPartIds(ids),
        fetchProductoDiaByPartIds(ids),
      ]);

      const pctPorDia = pctMdnaPorDia(productos, partesById);
      return computeProductoresHistorico(lotes, pctPorDia, partesById);
    },
  });

  return { productores: query.data ?? [], isLoading: query.isLoading, error: query.error };
}

/** Controles de calidad (calidad_lotes) con fecha dentro del rango de la semana activa. */
function useMercadonaCalidadSemana(desde: string | null, hasta: string | null) {
  const query = useQuery({
    queryKey: ["mercadona-calidad-semana", desde, hasta],
    queryFn: async (): Promise<MercadonaCalidadSemana[]> => {
      if (!desde || !hasta) return [];
      const { data, error } = await supabase
        .from("calidad_lotes")
        .select(
          "id, fecha, numero_lote, productor_finca_nombre, producto, variedad, cantidad, hora, calidad, defectos, defecto_otro, observacion, accion_recomendada, informe_generado, informe_estado, aerobotics_realizado, validado_at, validado_by",
        )
        .gte("fecha", desde)
        .lte("fecha", hasta)
        .order("fecha", { ascending: false });
      if (error) throw error;

      return (data ?? []).map((row): MercadonaCalidadSemana => {
        const defectos = row.defectos ?? [];
        return {
          id: row.id,
          fecha: row.fecha,
          numeroLote: row.numero_lote,
          productor: row.productor_finca_nombre || "Sin productor",
          producto: row.producto || "Sin producto",
          variedad: row.variedad || "",
          calidad: row.calidad,
          // `defectos` en calidad_lotes es un array de texto (text[] en Postgres),
          // no jsonb: llega ya tipado como string[] desde el cliente de Supabase.
          defectos,
          observacion: row.observacion || "",
          informe: {
            id: row.id,
            fecha: row.fecha,
            numero_lote: row.numero_lote ?? "",
            productor_finca_nombre: row.productor_finca_nombre ?? "",
            producto: row.producto,
            variedad: row.variedad,
            cantidad: row.cantidad,
            hora: row.hora,
            calidad: row.calidad as CalidadEstado,
            defectos,
            defecto_otro: row.defecto_otro,
            observacion: row.observacion,
            accion_recomendada: row.accion_recomendada,
            informe_estado: (row.informe_estado as CalidadInformeEstado) ?? "borrador",
            informe_generado: row.informe_generado,
            aerobotics_realizado: row.aerobotics_realizado,
            validado_at: row.validado_at,
            validado_by: row.validado_by,
          },
        };
      });
    },
    enabled: Boolean(desde && hasta),
  });

  return { controles: query.data ?? [], isLoading: query.isLoading, error: query.error };
}

/**
 * Hook principal de la pestaña "Lotes y productores": combina lotes de la
 * semana activa, ranking histórico de productores y calidad de la semana.
 */
export function useMercadonaLotes(activeSemana: MercadonaSemanaConMetodos | null) {
  const rango = useMemo(
    () => (activeSemana ? mercadonaWeekDateRange(activeSemana.anio, activeSemana.semana) : null),
    [activeSemana],
  );

  const lotesSemana = useMercadonaLotesSemana(rango?.desde ?? null, rango?.hasta ?? null);
  const productoresHistorico = useMercadonaProductoresHistorico();
  const calidadSemana = useMercadonaCalidadSemana(rango?.desde ?? null, rango?.hasta ?? null);

  return {
    lotesSemana: lotesSemana.lotes,
    isLoadingLotesSemana: lotesSemana.isLoading,
    productoresHistorico: productoresHistorico.productores,
    isLoadingProductoresHistorico: productoresHistorico.isLoading,
    calidadSemana: calidadSemana.controles,
    isLoadingCalidadSemana: calidadSemana.isLoading,
  };
}

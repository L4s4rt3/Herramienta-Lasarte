/**
 * useMercadonaExpediciones — lo que realmente SALIO del almacen hacia Mercadona,
 * palet a palet (tabla palets_dia, cliente ilike "%mercadona%").
 *
 * ⚠️ AVISO DE NEGOCIO: kg_neto de palets_dia es un peso BRUTO/orientativo. No
 * descuenta el trabajo de las mujeres en el calibrador (a diferencia de la
 * cascada DJPMN, que si lo descuenta), asi que va ALGO INFLADO respecto a la
 * produccion real. Cualquier pantalla que use estos hooks debe dejarlo claro
 * (banner/label), nunca presentarlo como dato exacto de produccion.
 *
 * palets_dia no tiene columna de fecha propia: se llega a la fecha via
 * part_id -> partes_diarios.date, igual que hace useMercadona.ts con
 * producto_dia. Mismo patron de "fetch en chunks de IN" para no pasarnos del
 * limite de la clausula IN de PostgREST.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { MercadonaSemanaConMetodos } from "@/hooks/useMercadonaVentas";
import { mercadonaWeekDateRange } from "@/lib/mercadonaVentas";

const IN_CHUNK_SIZE = 200;

interface PaletRow {
  part_id: string;
  producto: string | null;
  kg_neto: number;
  n_cajas: number | null;
  situacion: string | null;
}

export interface MercadonaExpedicionDia {
  date: string;
  kg: number;
  palets: number;
  cajas: number;
}

export interface MercadonaExpedicionProducto {
  producto: string;
  kg: number;
  palets: number;
  cajas: number;
  pct: number;
}

export interface MercadonaExpedicionSituacion {
  situacion: string;
  kg: number;
  palets: number;
}

export interface MercadonaExpedicionesResumen {
  kg_total: number;
  n_palets: number;
  n_cajas: number;
  kg_por_palet: number;
  por_dia: MercadonaExpedicionDia[];
  por_producto: MercadonaExpedicionProducto[];
  por_situacion: MercadonaExpedicionSituacion[];
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

async function fetchPaletsMercadonaEnChunks(partIds: string[]): Promise<PaletRow[]> {
  const rows: PaletRow[] = [];
  for (let i = 0; i < partIds.length; i += IN_CHUNK_SIZE) {
    const chunk = partIds.slice(i, i + IN_CHUNK_SIZE);
    const { data, error } = await supabase
      .from("palets_dia")
      .select("part_id, producto, kg_neto, n_cajas, situacion")
      .in("part_id", chunk)
      .ilike("cliente", "%mercadona%")
      .limit(100000);
    if (error) throw error;
    rows.push(...((data ?? []) as PaletRow[]));
  }
  return rows;
}

/**
 * Palets expedidos a Mercadona en un rango de fechas [desde, hasta] (usar
 * mercadonaWeekDateRange para una semana Mercadona L-S). Devuelve totales y
 * desgloses por dia/producto/situacion.
 */
export function useMercadonaExpediciones(desde: string, hasta: string) {
  const query = useQuery({
    queryKey: ["mercadona-expediciones", desde, hasta],
    queryFn: async (): Promise<{ palets: PaletRow[]; partesById: Map<string, string> }> => {
      const partesById = await fetchPartesEnRango(desde, hasta);
      if (partesById.size === 0) return { palets: [], partesById };
      const palets = await fetchPaletsMercadonaEnChunks(Array.from(partesById.keys()));
      return { palets, partesById };
    },
    enabled: Boolean(desde && hasta),
  });

  const resumen = useMemo<MercadonaExpedicionesResumen>(() => {
    const { palets, partesById } = query.data ?? { palets: [] as PaletRow[], partesById: new Map<string, string>() };

    const kg_total = palets.reduce((s, p) => s + (Number(p.kg_neto) || 0), 0);
    const n_palets = palets.length;
    const n_cajas = palets.reduce((s, p) => s + (Number(p.n_cajas) || 0), 0);
    const kg_por_palet = n_palets > 0 ? kg_total / n_palets : 0;

    const porDiaMap = new Map<string, { kg: number; palets: number; cajas: number }>();
    for (const p of palets) {
      const date = partesById.get(p.part_id);
      if (!date) continue;
      const entry = porDiaMap.get(date) ?? { kg: 0, palets: 0, cajas: 0 };
      entry.kg += Number(p.kg_neto) || 0;
      entry.palets += 1;
      entry.cajas += Number(p.n_cajas) || 0;
      porDiaMap.set(date, entry);
    }
    const por_dia: MercadonaExpedicionDia[] = Array.from(porDiaMap.entries())
      .map(([date, v]) => ({ date, ...v }))
      .sort((a, b) => a.date.localeCompare(b.date));

    const porProductoMap = new Map<string, { kg: number; palets: number; cajas: number }>();
    for (const p of palets) {
      const nombre = (p.producto ?? "").trim() || "Sin producto";
      const entry = porProductoMap.get(nombre) ?? { kg: 0, palets: 0, cajas: 0 };
      entry.kg += Number(p.kg_neto) || 0;
      entry.palets += 1;
      entry.cajas += Number(p.n_cajas) || 0;
      porProductoMap.set(nombre, entry);
    }
    const por_producto: MercadonaExpedicionProducto[] = Array.from(porProductoMap.entries())
      .map(([producto, v]) => ({
        producto,
        kg: v.kg,
        palets: v.palets,
        cajas: v.cajas,
        pct: kg_total > 0 ? (v.kg / kg_total) * 100 : 0,
      }))
      .sort((a, b) => b.kg - a.kg);

    const porSituacionMap = new Map<string, { kg: number; palets: number }>();
    for (const p of palets) {
      const situacion = (p.situacion ?? "").trim();
      if (!situacion) continue;
      const entry = porSituacionMap.get(situacion) ?? { kg: 0, palets: 0 };
      entry.kg += Number(p.kg_neto) || 0;
      entry.palets += 1;
      porSituacionMap.set(situacion, entry);
    }
    const por_situacion: MercadonaExpedicionSituacion[] = Array.from(porSituacionMap.entries())
      .map(([situacion, v]) => ({ situacion, ...v }))
      .sort((a, b) => b.kg - a.kg);

    return { kg_total, n_palets, n_cajas, kg_por_palet, por_dia, por_producto, por_situacion };
  }, [query.data]);

  return {
    ...resumen,
    isLoading: query.isLoading,
    error: query.error,
  };
}

// ─── Serie semanal (para el cruce confeccionado / expedido / vendido) ────────

export interface MercadonaExpedicionSemana {
  anio: number;
  semana: number;
  kg: number;
  palets: number;
  cajas: number;
}

/**
 * Kg/palets expedidos por cada semana de `semanas` (anio, semana), en UNA sola
 * consulta al rango completo [minima fecha, maxima fecha] de todas las
 * semanas Mercadona (mercadonaWeekDateRange), agrupando despues en cliente por
 * semana — evita hacer N queries (una por semana) contra Supabase.
 */
export function useMercadonaExpedicionesSemanales(semanas: MercadonaSemanaConMetodos[]) {
  const rangos = useMemo(
    () => semanas.map((s) => ({ anio: s.anio, semana: s.semana, ...mercadonaWeekDateRange(s.anio, s.semana) })),
    [semanas],
  );

  const desdeGlobal = useMemo(
    () => (rangos.length > 0 ? rangos.reduce((min, r) => (r.desde < min ? r.desde : min), rangos[0].desde) : null),
    [rangos],
  );
  const hastaGlobal = useMemo(
    () => (rangos.length > 0 ? rangos.reduce((max, r) => (r.hasta > max ? r.hasta : max), rangos[0].hasta) : null),
    [rangos],
  );

  const query = useQuery({
    queryKey: ["mercadona-expediciones-semanales", desdeGlobal, hastaGlobal],
    queryFn: async (): Promise<{ palets: PaletRow[]; partesById: Map<string, string> }> => {
      if (!desdeGlobal || !hastaGlobal) return { palets: [], partesById: new Map() };
      const partesById = await fetchPartesEnRango(desdeGlobal, hastaGlobal);
      if (partesById.size === 0) return { palets: [], partesById };
      const palets = await fetchPaletsMercadonaEnChunks(Array.from(partesById.keys()));
      return { palets, partesById };
    },
    enabled: Boolean(desdeGlobal && hastaGlobal),
  });

  const porSemana = useMemo<MercadonaExpedicionSemana[]>(() => {
    const { palets, partesById } = query.data ?? { palets: [] as PaletRow[], partesById: new Map<string, string>() };
    if (palets.length === 0 || rangos.length === 0) {
      return rangos.map((r) => ({ anio: r.anio, semana: r.semana, kg: 0, palets: 0, cajas: 0 }));
    }

    return rangos.map((r) => {
      let kg = 0;
      let n_palets = 0;
      let cajas = 0;
      for (const p of palets) {
        const date = partesById.get(p.part_id);
        if (!date || date < r.desde || date > r.hasta) continue;
        kg += Number(p.kg_neto) || 0;
        n_palets += 1;
        cajas += Number(p.n_cajas) || 0;
      }
      return { anio: r.anio, semana: r.semana, kg, palets: n_palets, cajas };
    });
  }, [query.data, rangos]);

  return {
    porSemana,
    isLoading: query.isLoading,
    error: query.error,
  };
}

// ─── Serie semanal de kg CONFECCIONADOS MDNA (para el cruce de las 3 patas) ──

interface ProductoDiaRow {
  part_id: string;
  producto: string | null;
  kg: number;
}

export interface MercadonaConfeccionadoSemana {
  anio: number;
  semana: number;
  kg: number;
}

async function fetchProductoDiaMdnaEnChunks(partIds: string[]): Promise<ProductoDiaRow[]> {
  const rows: ProductoDiaRow[] = [];
  for (let i = 0; i < partIds.length; i += IN_CHUNK_SIZE) {
    const chunk = partIds.slice(i, i + IN_CHUNK_SIZE);
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

/**
 * Kg confeccionados MDNA por cada semana de `semanas`, replicando el filtro de
 * useMercadona.ts (producto_dia, productos que contienen "MDNA", excluyendo la
 * fila TOTAL con producto null) pero en UNA sola query al rango completo
 * min-max de todas las semanas, agrupando despues en cliente — evita N queries
 * (una por semana, que es lo que haria llamar a useMercadona por cada semana).
 */
export function useMercadonaConfeccionadoSemanal(semanas: MercadonaSemanaConMetodos[]) {
  const rangos = useMemo(
    () => semanas.map((s) => ({ anio: s.anio, semana: s.semana, ...mercadonaWeekDateRange(s.anio, s.semana) })),
    [semanas],
  );

  const desdeGlobal = useMemo(
    () => (rangos.length > 0 ? rangos.reduce((min, r) => (r.desde < min ? r.desde : min), rangos[0].desde) : null),
    [rangos],
  );
  const hastaGlobal = useMemo(
    () => (rangos.length > 0 ? rangos.reduce((max, r) => (r.hasta > max ? r.hasta : max), rangos[0].hasta) : null),
    [rangos],
  );

  const query = useQuery({
    queryKey: ["mercadona-confeccionado-semanal", desdeGlobal, hastaGlobal],
    queryFn: async (): Promise<{ productos: ProductoDiaRow[]; partesById: Map<string, string> }> => {
      if (!desdeGlobal || !hastaGlobal) return { productos: [], partesById: new Map() };
      const partesById = await fetchPartesEnRango(desdeGlobal, hastaGlobal);
      if (partesById.size === 0) return { productos: [], partesById };
      const productos = await fetchProductoDiaMdnaEnChunks(Array.from(partesById.keys()));
      return { productos, partesById };
    },
    enabled: Boolean(desdeGlobal && hastaGlobal),
  });

  const porSemana = useMemo<MercadonaConfeccionadoSemana[]>(() => {
    const { productos: productosRaw, partesById } = query.data ?? { productos: [] as ProductoDiaRow[], partesById: new Map<string, string>() };
    // Igual que useMercadona.ts: excluye la fila TOTAL (producto vacio/null).
    const productos = productosRaw.filter((p) => (p.producto ?? "").trim() !== "" && (p.producto ?? "").toUpperCase().includes("MDNA"));

    if (rangos.length === 0) return [];

    return rangos.map((r) => {
      let kg = 0;
      for (const p of productos) {
        const date = partesById.get(p.part_id);
        if (!date || date < r.desde || date > r.hasta) continue;
        kg += Number(p.kg) || 0;
      }
      return { anio: r.anio, semana: r.semana, kg };
    });
  }, [query.data, rangos]);

  return {
    porSemana,
    isLoading: query.isLoading,
    error: query.error,
  };
}

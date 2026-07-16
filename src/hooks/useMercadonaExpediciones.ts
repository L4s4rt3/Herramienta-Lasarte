/**
 * useMercadonaExpediciones — los palets a Mercadona registrados en los partes
 * (tabla palets_dia), con reparacion de cliente perdido (ver
 * repararPaletsMercadona): el extractor de los partes deja parte de las filas
 * Mercadona sin cliente, y se recuperan por producto identico dentro del mismo
 * parte. Con la reparacion, los kg por semana cubren el 90-105% del vendido
 * real del Excel de Mercadona (verificado en todas las semanas importadas).
 *
 * palets_dia no tiene columna de fecha propia: se llega a la fecha via
 * part_id -> partes_diarios.date, igual que hace useMercadona.ts con
 * producto_dia. Mismo patron de "fetch en chunks de IN" para no pasarnos del
 * limite de la clausula IN de PostgREST.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/fetchAllRows";
import type { MercadonaSemanaConMetodos } from "@/hooks/useMercadonaVentas";
import { mercadonaWeekDateRange } from "@/lib/mercadonaVentas";

const IN_CHUNK_SIZE = 200;

interface PaletRow {
  part_id: string;
  producto: string | null;
  cliente: string | null;
  kg_neto: number;
  n_cajas: number | null;
  situacion: string | null;
}

/**
 * Repara los palets Mercadona a los que el extractor del parte no propago el
 * cliente. Hallazgo verificado (jul 2026): en los partes de junio/julio, parte
 * de las filas de palets Mercadona llegan con cliente vacio pero con EXACTAMENTE
 * el mismo producto (p.ej. "NAR VALENCIA LATE CAL6/8") que otras filas del MISMO
 * parte que si dicen "MERCADONA S.A.". Regla: un palet sin cliente cuenta como
 * Mercadona si en su mismo parte existe un palet del mismo producto con cliente
 * Mercadona. Validado semana a semana contra el vendido real del Excel: la
 * cobertura pasa de ~50% a 90-105% en todas las semanas (S27: 154.187 kg vs
 * 157.165 vendidos).
 */
export function repararPaletsMercadona(rows: PaletRow[]): PaletRow[] {
  const esMercadona = (cliente: string | null) => (cliente ?? "").toLowerCase().includes("mercadona");
  const productosMercadonaPorParte = new Set(
    rows
      .filter((r) => esMercadona(r.cliente))
      .map((r) => `${r.part_id}|${(r.producto ?? "").trim().toUpperCase()}`),
  );
  return rows.filter((r) => {
    if (esMercadona(r.cliente)) return true;
    if ((r.cliente ?? "").trim() !== "") return false;
    return productosMercadonaPorParte.has(`${r.part_id}|${(r.producto ?? "").trim().toUpperCase()}`);
  });
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
  // partes_diarios va camino de las 1.000 filas (creciendo): se pagina por
  // seguridad de cara al futuro.
  const data = await fetchAllRows<{ id: string; date: string }>((from, to) =>
    supabase.from("partes_diarios").select("id, date").gte("date", desde).lte("date", hasta).order("id").range(from, to),
  );
  return new Map(data.map((p) => [p.id, p.date]));
}

async function fetchPaletsMercadonaEnChunks(partIds: string[]): Promise<PaletRow[]> {
  // Se traen TODOS los palets de esos partes (no solo cliente=Mercadona) para
  // poder reparar en cliente las filas con cliente vacio (ver repararPaletsMercadona).
  // palets_dia tiene 39.716 filas: cada chunk de 200 partes puede devolver
  // por sí solo miles de filas, muy por encima del max-rows del servidor
  // (el .limit(100000) no protegía nada). Se pagina cada chunk con fetchAllRows.
  const rows: PaletRow[] = [];
  for (let i = 0; i < partIds.length; i += IN_CHUNK_SIZE) {
    const chunk = partIds.slice(i, i + IN_CHUNK_SIZE);
    const chunkRows = await fetchAllRows<PaletRow>((from, to) =>
      supabase
        .from("palets_dia")
        .select("part_id, producto, cliente, kg_neto, n_cajas, situacion")
        .in("part_id", chunk)
        .order("id")
        .range(from, to),
    );
    rows.push(...chunkRows);
  }
  return repararPaletsMercadona(rows);
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
  /** Kg MDNA ajustados a produccion real (descontadas mujeres y reciclado, ver factor). */
  kg: number;
  /** Kg MDNA tal cual salen del informe de producto (brutos de calibrador). */
  kg_bruto: number;
}

interface ParteCascada {
  date: string;
  /**
   * Factor de ajuste del dia = produccion real / kg calibrador. El informe de
   * producto (producto_dia) suma practicamente el kg del CALIBRADOR (verificado
   * contra datos reales: coinciden al kilo), es decir, NO descuenta el trabajo
   * de mujeres ni el reciclado Z1/Z2 que la cascada DJPMN si descuenta. Por eso
   * el "confeccionado MDNA" bruto sale inflado (~7-12% segun el dia) frente al
   * vendido real. Multiplicar el MDNA del dia por este factor reparte el
   * descuento proporcionalmente entre todos los productos del dia.
   */
  factor: number;
}

async function fetchPartesConCascada(desde: string, hasta: string): Promise<Map<string, ParteCascada>> {
  // partes_diarios va camino de las 1.000 filas (creciendo): se pagina por
  // seguridad de cara al futuro.
  const data = await fetchAllRows<{
    id: string;
    date: string;
    kg_produccion_calibrador: number;
    kg_mujeres_calibrador: number;
    kg_reciclado_malla_z1: number;
    kg_reciclado_malla_z2: number;
  }>((from, to) =>
    supabase
      .from("partes_diarios")
      .select("id, date, kg_produccion_calibrador, kg_mujeres_calibrador, kg_reciclado_malla_z1, kg_reciclado_malla_z2")
      .gte("date", desde)
      .lte("date", hasta)
      .order("id")
      .range(from, to),
  );
  return new Map(
    data.map((p) => {
      const calibrador = Number(p.kg_produccion_calibrador) || 0;
      const real = calibrador
        - (Number(p.kg_mujeres_calibrador) || 0)
        - (Number(p.kg_reciclado_malla_z1) || 0)
        - (Number(p.kg_reciclado_malla_z2) || 0);
      const factor = calibrador > 0 ? Math.min(1, Math.max(0, real / calibrador)) : 1;
      return [p.id as string, { date: p.date as string, factor }];
    }),
  );
}

async function fetchProductoDiaMdnaEnChunks(partIds: string[]): Promise<ProductoDiaRow[]> {
  // Mismo motivo que fetchPaletsMercadonaEnChunks: cada chunk de 200 partes
  // puede devolver por sí solo más de 1.000 filas de producto_dia.
  const rows: ProductoDiaRow[] = [];
  for (let i = 0; i < partIds.length; i += IN_CHUNK_SIZE) {
    const chunk = partIds.slice(i, i + IN_CHUNK_SIZE);
    const chunkRows = await fetchAllRows<ProductoDiaRow>((from, to) =>
      supabase.from("producto_dia").select("part_id, producto, kg").in("part_id", chunk).order("id").range(from, to),
    );
    rows.push(...chunkRows);
  }
  return rows;
}

/**
 * Kg confeccionados MDNA por cada semana de `semanas`, replicando el filtro de
 * useMercadona.ts (producto_dia, productos que contienen "MDNA", excluyendo la
 * fila TOTAL con producto null) pero en UNA sola query al rango completo
 * min-max de todas las semanas, agrupando despues en cliente — evita N queries
 * (una por semana, que es lo que haria llamar a useMercadona por cada semana).
 *
 * Dos correcciones sobre el bruto del informe (peticion del dueño, jul 2026,
 * "el numero inflado es el confeccionado"):
 * - Se excluyen los PRECALIBRADOS ("PREC ..."): son producto a medio confeccionar
 *   que volveria a contarse otro dia como MDNA terminado (doble conteo).
 * - Cada dia se multiplica por el factor de la cascada (produccion real /
 *   calibrador), porque el informe de producto no descuenta mujeres ni
 *   reciclado. Ver ParteCascada.factor.
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
    queryFn: async (): Promise<{ productos: ProductoDiaRow[]; partesById: Map<string, ParteCascada> }> => {
      if (!desdeGlobal || !hastaGlobal) return { productos: [], partesById: new Map() };
      const partesById = await fetchPartesConCascada(desdeGlobal, hastaGlobal);
      if (partesById.size === 0) return { productos: [], partesById };
      const productos = await fetchProductoDiaMdnaEnChunks(Array.from(partesById.keys()));
      return { productos, partesById };
    },
    enabled: Boolean(desdeGlobal && hastaGlobal),
  });

  const porSemana = useMemo<MercadonaConfeccionadoSemana[]>(() => {
    const { productos: productosRaw, partesById } = query.data ?? { productos: [] as ProductoDiaRow[], partesById: new Map<string, ParteCascada>() };
    // Igual que useMercadona.ts: excluye la fila TOTAL (producto vacio/null).
    // Ademas excluye precalibrados "PREC ..." (a medio confeccionar, doble conteo).
    const productos = productosRaw.filter((p) => {
      const nombre = (p.producto ?? "").trim().toUpperCase();
      return nombre !== "" && nombre.includes("MDNA") && !nombre.includes("PREC");
    });

    if (rangos.length === 0) return [];

    return rangos.map((r) => {
      let kg = 0;
      let kg_bruto = 0;
      for (const p of productos) {
        const parte = partesById.get(p.part_id);
        if (!parte || parte.date < r.desde || parte.date > r.hasta) continue;
        const bruto = Number(p.kg) || 0;
        kg_bruto += bruto;
        kg += bruto * parte.factor;
      }
      return { anio: r.anio, semana: r.semana, kg, kg_bruto };
    });
  }, [query.data, rangos]);

  return {
    porSemana,
    isLoading: query.isLoading,
    error: query.error,
  };
}

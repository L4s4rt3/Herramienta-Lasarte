import { useState, useEffect } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/fetchAllRows";
import { calcularTphOperativa } from "@/lib/velocidadOperativa";
import {
  calcularProduccionRealParteAnalisis,
  calcularProduccionRealPartesAnalisis,
} from "@/lib/analisisDiarioProduccion";
import { detectarTipoClasificacion as detectarGrupoDestinoLote } from "@/lib/destinoClasificacion";
import { prefijoNumericoLote } from "@/lib/loteCodigo";
import { esErrorTablaOColumnaInexistente } from "@/lib/productoresCanonicos";

// Cast local: lotes_dia.productor_id aun no esta en el Database generado
// (migracion 20260714090000_productores_canonicos.sql). Mismo patron que
// useProductores.ts / useTrazabilidadLote.ts para poder pedir esa columna con
// degradado si el select explicito falla por no existir todavia.
const SUPA = supabase as unknown as SupabaseClient<any>;

// ─── Tipos ──────────────────────────────────────────────────────────────────

export interface LoteClasificacionResumen {
  kg_clasificado: number;
  por_grupo: Record<string, number>; // clave = detectarTipoClasificacion(grupo_destino), valor = kg
  top_clases: Array<{ clase: string; kg: number }>; // top 5 desc por kg
}

/** Fila cruda de lote_clasificacion — detalle completo clase × tamaño de un lote. */
export interface LoteClasificacionRow {
  lote_codigo: string;
  lote_codigo_base: string | null;
  productor: string | null;
  producto: string;
  calidad: string | null;
  clase: string;
  grupo_destino: string | null;
  tamano: string;
  piezas: number | null;
  pct_piezas: number | null;
  peso_kg: number;
  pct_peso: number | null;
  cartons: number | null;
  pct_cartons: number | null;
  part_id: string;
  fecha?: string;
}

export interface LoteResumen {
  fecha: string;
  lote_codigo: string;
  productor: string;
  producto: string;
  kg_peso_total: number;
  toneladas_hora: number | null;
  duracion_min: number | null;
  peso_fruta_promedio_g: number | null;
  produccion_real_part: number | null; // Producción real del parte para este día
  // Opcionales para no romper fixtures antiguos; el hook siempre los rellena.
  part_id?: string;
  kg_industria?: number;
  notas?: string | null;
  hora_inicio?: string | null;
  /**
   * Catálogo de productores (migración 20260714090000_productores_canonicos.sql):
   * id directo si esta fila ya lo tiene resuelto (trigger/backfill/asignación
   * manual desde la cola de revisión); undefined si la columna aún no existe
   * en este entorno. Permite a la página comparar por CLAVE canónica
   * (resolveProductorGroupKey) en vez de por el texto crudo exacto — ver el
   * filtro de productor en AnalisisDiario.tsx.
   */
  productor_id?: string | null;
  /** Desglose por lote desde lote_clasificacion, si el lote tiene "Informe LOTE" cargado. */
  clasificacion?: LoteClasificacionResumen;
  /** Detalle completo clase × tamaño de lote_clasificacion para este lote. */
  detalle?: LoteClasificacionRow[];
  /** Calidad predominante del lote (de lote_clasificacion), si existe. */
  calidad?: string | null;
}

export interface ClaseResumen {
  clase: string;
  kg_total: number;
  n_registros: number;
  n_dias: number;
  grupos: Record<string, number>;
  /** kg por fecha (para la evolución día a día). */
  por_dia?: Record<string, number>;
}

export interface GrupoClasificacionResumen {
  grupo: string;
  kg_total: number;
  n_registros: number;
  n_dias: number;
  por_dia?: Record<string, number>;
}

export interface CalibreResumen {
  calibre: string;
  kg_total: number;
  /** kg por categoría comercial (clase). */
  por_clase: Record<string, number>;
  por_dia: Record<string, number>;
}

export interface ProductorResumen {
  productor: string;
  kg_total: number;
  n_lotes: number;
  /** T/h media ponderada por duración (mismo criterio que Productores). */
  tph_promedio: number | null;
  peso_fruta_promedio_g: number | null;
  kg_industria: number;
  productos: string[];
  ultimo_dia: string | null;
  por_dia: Record<string, number>;
}

/**
 * Agrega una lista de lotes por productor. Compartida entre el hook (lotes sin
 * filtrar) y la página (lotes filtrados por búsqueda/productor/producto), para
 * que ambos usen exactamente el mismo criterio de cálculo.
 */
export function buildProductoresResumen(lotesAll: LoteResumen[]): ProductorResumen[] {
  const productoresMap = new Map<string, LoteResumen[]>();
  for (const l of lotesAll) {
    const key = l.productor || "Sin productor";
    if (!productoresMap.has(key)) productoresMap.set(key, []);
    productoresMap.get(key)!.push(l);
  }
  return Array.from(productoresMap.entries())
    .map(([productor, ls]) => {
      const conTph = ls.filter((l) => l.toneladas_hora && l.toneladas_hora > 0);
      const minTph = conTph.reduce((s, l) => s + (l.duracion_min ?? 0), 0);
      const tph_promedio = conTph.length > 0
        ? minTph > 0
          ? conTph.reduce((s, l) => s + (l.toneladas_hora ?? 0) * (l.duracion_min ?? 1), 0) / minTph
          : conTph.reduce((s, l) => s + (l.toneladas_hora ?? 0), 0) / conTph.length
        : null;
      const conPeso = ls.filter((l) => l.peso_fruta_promedio_g && l.peso_fruta_promedio_g > 0);
      const peso_fruta_promedio_g = conPeso.length > 0
        ? conPeso.reduce((s, l) => s + (l.peso_fruta_promedio_g ?? 0), 0) / conPeso.length
        : null;
      const porDia = new Map<string, number>();
      for (const l of ls) {
        if (l.fecha && l.fecha !== "—") porDia.set(l.fecha, (porDia.get(l.fecha) ?? 0) + l.kg_peso_total);
      }
      const fechas = ls.map((l) => l.fecha).filter((f) => f && f !== "—").sort();
      return {
        productor,
        kg_total: ls.reduce((s, l) => s + l.kg_peso_total, 0),
        n_lotes: ls.length,
        tph_promedio,
        peso_fruta_promedio_g,
        kg_industria: ls.reduce((s, l) => s + (l.kg_industria ?? 0), 0),
        productos: Array.from(new Set(ls.map((l) => l.producto).filter((p) => p && p !== "—"))),
        ultimo_dia: fechas.length > 0 ? fechas[fechas.length - 1] : null,
        por_dia: Object.fromEntries(porDia),
      };
    })
    .sort((a, b) => b.kg_total - a.kg_total);
}

function detectarTipoClasificacion(valor: string | null): string {
  if (!valor) return "Otro";
  const v = valor.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  if (v.includes("no_export") || v.includes("no export") || v.includes("no_exportac") || v.includes("no exportac")) return "No exportación";
  if (v.includes("no_comerc") || v.includes("no comerc") || v.includes("industria") || v.includes("ind")) return "No comercial";
  if (v.includes("export") || v.includes("ext")) return "Exportación";
  if (v.includes("mujer")) return "Mujeres";
  if (v.includes("mercado") || v.includes("nac") || v.includes("interior") || v.includes("int")) return "Mercado";
  return valor;
}

/**
 * Recalcula clases y grupos desde filas de lote_clasificacion (por-lote), para
 * usarse cuando hay un filtro activo (texto/productor/producto) y por tanto
 * calibres_dia (agregado a nivel día, sin productor/lote) ya no es fiable.
 * Es una fuente menos completa que calibres_dia (solo lotes con "Informe LOTE"
 * cargado), de ahí el aviso "Filtrado según informes de lote" en la UI.
 */
export function buildClasesYGruposDesdeClasificacion(rows: LoteClasificacionRow[]): {
  clases: ClaseResumen[];
  grupos: GrupoClasificacionResumen[];
} {
  const clasesMap = new Map<string, {
    kg: number;
    n_registros: number;
    fechas: Set<string>;
    grupos: Map<string, number>;
    porDia: Map<string, number>;
  }>();
  const gruposMap = new Map<string, {
    kg: number;
    n_registros: number;
    fechas: Set<string>;
    porDia: Map<string, number>;
  }>();

  for (const r of rows) {
    const kg = r.peso_kg;
    const clase = r.clase || "Sin clase";
    const grupo = detectarGrupoDestinoLote(r.grupo_destino);
    const fecha = r.fecha ?? "";

    if (!clasesMap.has(clase)) {
      clasesMap.set(clase, { kg: 0, n_registros: 0, fechas: new Set(), grupos: new Map(), porDia: new Map() });
    }
    const cl = clasesMap.get(clase)!;
    cl.kg += kg;
    cl.n_registros += 1;
    if (fecha) {
      cl.fechas.add(fecha);
      cl.porDia.set(fecha, (cl.porDia.get(fecha) ?? 0) + kg);
    }
    cl.grupos.set(grupo, (cl.grupos.get(grupo) ?? 0) + kg);

    if (!gruposMap.has(grupo)) {
      gruposMap.set(grupo, { kg: 0, n_registros: 0, fechas: new Set(), porDia: new Map() });
    }
    const gr = gruposMap.get(grupo)!;
    gr.kg += kg;
    gr.n_registros += 1;
    if (fecha) {
      gr.fechas.add(fecha);
      gr.porDia.set(fecha, (gr.porDia.get(fecha) ?? 0) + kg);
    }
  }

  const clases: ClaseResumen[] = Array.from(clasesMap.entries())
    .map(([clase, vals]) => ({
      clase,
      kg_total: vals.kg,
      n_registros: vals.n_registros,
      n_dias: vals.fechas.size,
      grupos: Object.fromEntries(vals.grupos),
      por_dia: Object.fromEntries(vals.porDia),
    }))
    .sort((a, b) => b.kg_total - a.kg_total);

  const grupos: GrupoClasificacionResumen[] = Array.from(gruposMap.entries())
    .map(([grupo, vals]) => ({
      grupo,
      kg_total: vals.kg,
      n_registros: vals.n_registros,
      n_dias: vals.fechas.size,
      por_dia: Object.fromEntries(vals.porDia),
    }))
    .sort((a, b) => b.kg_total - a.kg_total);

  return { clases, grupos };
}

/**
 * Recalcula calibres (por "tamano") desde filas de lote_clasificacion, para el
 * mismo escenario de filtro activo que buildClasesYGruposDesdeClasificacion.
 */
export function buildCalibresDesdeClasificacion(rows: LoteClasificacionRow[]): CalibreResumen[] {
  const calibresMap = new Map<string, {
    kg: number;
    porClase: Map<string, number>;
    porDia: Map<string, number>;
  }>();

  for (const r of rows) {
    const kg = r.peso_kg;
    const clase = r.clase || "Sin clase";
    const calibre = r.tamano?.trim() || "Sin calibre";
    const fecha = r.fecha ?? "";

    if (!calibresMap.has(calibre)) {
      calibresMap.set(calibre, { kg: 0, porClase: new Map(), porDia: new Map() });
    }
    const ca = calibresMap.get(calibre)!;
    ca.kg += kg;
    ca.porClase.set(clase, (ca.porClase.get(clase) ?? 0) + kg);
    if (fecha) ca.porDia.set(fecha, (ca.porDia.get(fecha) ?? 0) + kg);
  }

  return Array.from(calibresMap.entries())
    .map(([calibre, vals]) => ({
      calibre,
      kg_total: vals.kg,
      por_clase: Object.fromEntries(vals.porClase),
      por_dia: Object.fromEntries(vals.porDia),
    }))
    .sort((a, b) => b.kg_total - a.kg_total);
}

export interface AnalisisDiarioData {
  totals: {
    n_dias: number;
    n_lotes: number;
    kg_lotes: number;
    kg_calibres: number;
    kg_produccion_real: number;
    kg_industria: number;
    avg_tph: number | null;
    total_min: number;
    total_horas: number;
    n_lotes_lentos: number;
  };
  /** Fechas (ISO) con datos en el periodo, ordenadas ascendente. */
  days: string[];
  lotes: LoteResumen[];
  clases: ClaseResumen[];
  grupos: GrupoClasificacionResumen[];
  calibres: CalibreResumen[];
  productores: ProductorResumen[];
  /** Filas crudas de lote_clasificacion del periodo (detalle completo por lote). */
  clasificacionRows: LoteClasificacionRow[];
}

const EMPTY_DATA: AnalisisDiarioData = {
  totals: { n_dias: 0, n_lotes: 0, kg_lotes: 0, kg_calibres: 0, kg_produccion_real: 0, kg_industria: 0, avg_tph: null, total_min: 0, total_horas: 0, n_lotes_lentos: 0 },
  days: [],
  lotes: [],
  clases: [],
  grupos: [],
  calibres: [],
  productores: [],
  clasificacionRows: [],
};

export function useAnalisisDiario(desde: string, hasta: string) {
  const [data, setData] = useState<AnalisisDiarioData>(EMPTY_DATA);
  // Arranca en true para evitar el flash de "sin datos" en primera carga
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function fetchData() {
    setLoading(true);
    setError(null);
    try {
      // ── 1. Partes en el rango ──────────────────────────────────────────────
      // partes_diarios va camino de las 1.000 filas (creciendo un registro
      // por día): el rango puede cubrir toda la campaña, así que se pagina
      // con fetchAllRows por seguridad de cara al futuro. Orden estable:
      // fecha desc + id como desempate único.
      let partes: Array<{
        id: string;
        date: string;
        resumen_ia: unknown;
        kg_produccion_calibrador: number;
        kg_mujeres_calibrador: number;
        kg_reciclado_malla_z1: number;
        kg_reciclado_malla_z2: number;
      }>;
      try {
        partes = await fetchAllRows((from, to) =>
          supabase
            .from("partes_diarios")
            .select("id, date, resumen_ia, kg_produccion_calibrador, kg_mujeres_calibrador, kg_reciclado_malla_z1, kg_reciclado_malla_z2")
            .gte("date", desde)
            .lte("date", hasta)
            .order("date", { ascending: false })
            .order("id", { ascending: false })
            .range(from, to),
        );
      } catch (pErr) {
        console.error("Error fetching partes:", pErr);
        setLoading(false);
        return;
      }

      const partIds = (partes ?? []).map((p) => p.id);
      const diasSet = new Set((partes ?? []).map((p) => p.date));

      if (partIds.length === 0) {
        setData(EMPTY_DATA);
        setLoading(false);
        return;
      }

      // Mapa part_id -> date
      const parteDateMap = new Map((partes ?? []).map((p) => [p.id, p.date]));

      // ── 2. Calibres desde calibres_dia ─────────────────────────────────────
      // El rango de partIds puede cubrir toda la campaña: calibres_dia puede
      // devolver muchas más de 1.000 filas (varias líneas por día), así que
      // se pagina con fetchAllRows en vez de confiar en .limit(100000) (que
      // PostgREST recorta a su max-rows real en silencio).
      let calibresRaw: Array<{ calibre: string; clase: string | null; grupo_destino: string | null; kg: number; part_id: string }>;
      try {
        calibresRaw = await fetchAllRows((from, to) =>
          supabase
            .from("calibres_dia")
            .select("calibre, clase, grupo_destino, kg, part_id")
            .in("part_id", partIds)
            .order("id")
            .range(from, to),
        );
      } catch (cErr) {
        console.error("Error fetching calibres_dia:", cErr);
        setLoading(false);
        return;
      }

      const clasesMap = new Map<string, {
        kg: number;
        n_registros: number;
        fechas: Set<string>;
        grupos: Map<string, number>;
        porDia: Map<string, number>;
      }>();

      const gruposMap = new Map<string, {
        kg: number;
        n_registros: number;
        fechas: Set<string>;
        porDia: Map<string, number>;
      }>();

      const calibresMap = new Map<string, {
        kg: number;
        porClase: Map<string, number>;
        porDia: Map<string, number>;
      }>();

      for (const c of calibresRaw ?? []) {
        const kg = Number(c.kg) || 0;
        const clase = c.clase ?? "Sin clase";
        const grupo = detectarTipoClasificacion(c.grupo_destino);
        const calibre = c.calibre?.trim() || "Sin calibre";
        const fecha = parteDateMap.get(c.part_id) ?? "";

        if (!clasesMap.has(clase)) {
          clasesMap.set(clase, { kg: 0, n_registros: 0, fechas: new Set(), grupos: new Map(), porDia: new Map() });
        }
        const cl = clasesMap.get(clase)!;
        cl.kg += kg;
        cl.n_registros += 1;
        if (fecha) {
          cl.fechas.add(fecha);
          cl.porDia.set(fecha, (cl.porDia.get(fecha) ?? 0) + kg);
        }
        cl.grupos.set(grupo, (cl.grupos.get(grupo) ?? 0) + kg);

        if (!gruposMap.has(grupo)) {
          gruposMap.set(grupo, { kg: 0, n_registros: 0, fechas: new Set(), porDia: new Map() });
        }
        const gr = gruposMap.get(grupo)!;
        gr.kg += kg;
        gr.n_registros += 1;
        if (fecha) {
          gr.fechas.add(fecha);
          gr.porDia.set(fecha, (gr.porDia.get(fecha) ?? 0) + kg);
        }

        if (!calibresMap.has(calibre)) {
          calibresMap.set(calibre, { kg: 0, porClase: new Map(), porDia: new Map() });
        }
        const ca = calibresMap.get(calibre)!;
        ca.kg += kg;
        ca.porClase.set(clase, (ca.porClase.get(clase) ?? 0) + kg);
        if (fecha) ca.porDia.set(fecha, (ca.porDia.get(fecha) ?? 0) + kg);
      }

      const kgCalibres = Array.from(clasesMap.values()).reduce((s, c) => s + c.kg, 0);

      const clases: ClaseResumen[] = Array.from(clasesMap.entries())
        .map(([clase, vals]) => ({
          clase,
          kg_total: vals.kg,
          n_registros: vals.n_registros,
          n_dias: vals.fechas.size,
          grupos: Object.fromEntries(vals.grupos),
          por_dia: Object.fromEntries(vals.porDia),
        }))
        .sort((a, b) => b.kg_total - a.kg_total);

      const grupos: GrupoClasificacionResumen[] = Array.from(gruposMap.entries())
        .map(([grupo, vals]) => ({
          grupo,
          kg_total: vals.kg,
          n_registros: vals.n_registros,
          n_dias: vals.fechas.size,
          por_dia: Object.fromEntries(vals.porDia),
        }))
        .sort((a, b) => b.kg_total - a.kg_total);

      const calibres: CalibreResumen[] = Array.from(calibresMap.entries())
        .map(([calibre, vals]) => ({
          calibre,
          kg_total: vals.kg,
          por_clase: Object.fromEntries(vals.porClase),
          por_dia: Object.fromEntries(vals.porDia),
        }))
        .sort((a, b) => b.kg_total - a.kg_total);

      // ── 3. Lotes desde lotes_dia ───────────────────────────────────────────
      // lotes_dia tiene 1.187 filas tras el histórico: un rango amplio de
      // partIds puede devolver más de 1.000, se pagina con fetchAllRows.
      // Se pide también productor_id (migración 20260714090000_productores_canonicos.sql)
      // para poder comparar/agrupar por CLAVE canónica (alias) en vez de por el
      // texto crudo exacto: el ?productor= entrante puede traer el nombre
      // CANÓNICO (llega desde "Ver sus lotes en Análisis diario" del dossier de
      // Productores), que no siempre coincide con este texto crudo. Columna
      // nueva: si todavía no existe en este entorno, se reintenta sin ella
      // (degrada a resolver solo por alias-de-nombre, sin el id directo).
      type LoteDiaAnalisisRow = {
        lote_codigo: string | null;
        productor: string | null;
        producto: string | null;
        kg_peso_total: number;
        toneladas_hora: number | null;
        duracion_min: number | null;
        peso_fruta_promedio_g: number | null;
        kg_industria: number | null;
        notas: string | null;
        hora_inicio: string | null;
        part_id: string;
        productor_id?: string | null;
      };
      const LOTES_DIA_COLUMNAS_ANALISIS =
        "lote_codigo, productor, producto, kg_peso_total, toneladas_hora, duracion_min, peso_fruta_promedio_g, kg_industria, notas, hora_inicio, part_id";
      let lotesRaw: LoteDiaAnalisisRow[];
      try {
        try {
          lotesRaw = await fetchAllRows<LoteDiaAnalisisRow>((from, to) =>
            SUPA
              .from("lotes_dia")
              .select(`${LOTES_DIA_COLUMNAS_ANALISIS}, productor_id`)
              .in("part_id", partIds)
              .order("id")
              .range(from, to),
          );
        } catch (conIdErr) {
          if (!esErrorTablaOColumnaInexistente(conIdErr)) throw conIdErr;
          lotesRaw = await fetchAllRows<LoteDiaAnalisisRow>((from, to) =>
            SUPA
              .from("lotes_dia")
              .select(LOTES_DIA_COLUMNAS_ANALISIS)
              .in("part_id", partIds)
              .order("id")
              .range(from, to),
          );
        }
      } catch (lErr) {
        console.error("Error fetching lotes_dia:", lErr);
        setLoading(false);
        return;
      }

      // ── 3b. Clasificación por lote (opcional) desde lote_clasificacion ─────
      // Mejora no crítica: si falla, seguimos sin clasificaciones sin bloquear el resto del hook.
      type ClasifAcumulado = {
        kg: number;
        porGrupo: Map<string, number>;
        porClase: Map<string, number>;
      };
      const clasifPorLoteCodigo = new Map<string, ClasifAcumulado>();
      const clasifPorLoteCodigoBase = new Map<string, ClasifAcumulado>();
      const detallePorLoteCodigo = new Map<string, LoteClasificacionRow[]>();
      const detallePorLoteCodigoBase = new Map<string, LoteClasificacionRow[]>();
      const clasificacionRows: LoteClasificacionRow[] = [];

      try {
        // lote_clasificacion tiene 8.685 filas tras el histórico: muy por
        // encima del max-rows del servidor para un rango amplio de partIds,
        // se pagina con fetchAllRows en vez de .limit(100000).
        const clasifRaw = await fetchAllRows((from, to) =>
          supabase
            .from("lote_clasificacion")
            .select("lote_codigo, lote_codigo_base, productor, producto, calidad, clase, grupo_destino, tamano, piezas, pct_piezas, peso_kg, pct_peso, cartons, pct_cartons, part_id")
            .in("part_id", partIds)
            .order("id")
            .range(from, to),
        );

        for (const c of clasifRaw) {
            const kg = Number(c.peso_kg) || 0;
            const grupo = detectarGrupoDestinoLote(c.grupo_destino);
            const clase = c.clase ?? "Sin clase";

            const acumular = (map: Map<string, ClasifAcumulado>, key: string) => {
              if (!key) return;
              if (!map.has(key)) {
                map.set(key, { kg: 0, porGrupo: new Map(), porClase: new Map() });
              }
              const acc = map.get(key)!;
              acc.kg += kg;
              acc.porGrupo.set(grupo, (acc.porGrupo.get(grupo) ?? 0) + kg);
              acc.porClase.set(clase, (acc.porClase.get(clase) ?? 0) + kg);
            };

            const codigoKey = c.lote_codigo ? `${c.part_id}|${c.lote_codigo.trim().toLowerCase()}` : "";
            acumular(clasifPorLoteCodigo, codigoKey);

            const codigoBaseKey = c.lote_codigo_base ? `${c.part_id}|${c.lote_codigo_base}` : "";
            acumular(clasifPorLoteCodigoBase, codigoBaseKey);

            const row: LoteClasificacionRow = {
              lote_codigo: c.lote_codigo ?? "—",
              lote_codigo_base: c.lote_codigo_base ?? null,
              productor: c.productor ?? null,
              producto: c.producto ?? "—",
              calidad: c.calidad ?? null,
              clase,
              grupo_destino: c.grupo_destino ?? null,
              tamano: c.tamano ?? "—",
              piezas: c.piezas != null ? Number(c.piezas) : null,
              pct_piezas: c.pct_piezas != null ? Number(c.pct_piezas) : null,
              peso_kg: kg,
              pct_peso: c.pct_peso != null ? Number(c.pct_peso) : null,
              cartons: c.cartons != null ? Number(c.cartons) : null,
              pct_cartons: c.pct_cartons != null ? Number(c.pct_cartons) : null,
              part_id: c.part_id,
              fecha: parteDateMap.get(c.part_id) ?? undefined,
            };
            clasificacionRows.push(row);

            const addDetalle = (map: Map<string, LoteClasificacionRow[]>, key: string) => {
              if (!key) return;
              if (!map.has(key)) map.set(key, []);
              map.get(key)!.push(row);
            };
            addDetalle(detallePorLoteCodigo, codigoKey);
            addDetalle(detallePorLoteCodigoBase, codigoBaseKey);
        }
      } catch (clasifCatchErr) {
        console.error("Error inesperado fetching lote_clasificacion:", clasifCatchErr);
      }

      function toClasificacionResumen(acc: ClasifAcumulado): LoteClasificacionResumen {
        const top_clases = Array.from(acc.porClase.entries())
          .map(([clase, kg]) => ({ clase, kg }))
          .sort((a, b) => b.kg - a.kg)
          .slice(0, 5);
        return {
          kg_clasificado: acc.kg,
          por_grupo: Object.fromEntries(acc.porGrupo),
          top_clases,
        };
      }

      const lotesAll: LoteResumen[] = (lotesRaw ?? []).map((l) => {
        const partId = l.part_id;
        const parte = partes?.find(p => p.id === partId);

        let clasificacion: LoteClasificacionResumen | undefined;
        let detalle: LoteClasificacionRow[] | undefined;
        const loteCodigoKey = `${partId}|${(l.lote_codigo ?? "").trim().toLowerCase()}`;
        const acumuladoExacto = clasifPorLoteCodigo.get(loteCodigoKey);
        if (acumuladoExacto) {
          clasificacion = toClasificacionResumen(acumuladoExacto);
          detalle = detallePorLoteCodigo.get(loteCodigoKey);
        } else {
          const prefijo = prefijoNumericoLote(l.lote_codigo);
          if (prefijo) {
            const codigoBaseKey = `${partId}|${prefijo}`;
            const acumuladoBase = clasifPorLoteCodigoBase.get(codigoBaseKey);
            if (acumuladoBase) {
              clasificacion = toClasificacionResumen(acumuladoBase);
              detalle = detallePorLoteCodigoBase.get(codigoBaseKey);
            }
          }
        }

        // Calidad predominante: la de mayor kg entre las filas de detalle del lote.
        let calidad: string | null = null;
        if (detalle && detalle.length > 0) {
          const porCalidad = new Map<string, number>();
          for (const row of detalle) {
            if (!row.calidad) continue;
            porCalidad.set(row.calidad, (porCalidad.get(row.calidad) ?? 0) + row.peso_kg);
          }
          const ordenada = Array.from(porCalidad.entries()).sort((a, b) => b[1] - a[1]);
          calidad = ordenada.length > 0 ? ordenada[0][0] : null;
        }

        return {
          fecha: parteDateMap.get(l.part_id) ?? "—",
          lote_codigo: l.lote_codigo ?? "—",
          productor: l.productor ?? "—",
          producto: l.producto ?? "—",
          kg_peso_total: Number(l.kg_peso_total) || 0,
          toneladas_hora: l.toneladas_hora ? Number(l.toneladas_hora) : null,
          duracion_min: l.duracion_min ? Number(l.duracion_min) : null,
          peso_fruta_promedio_g: l.peso_fruta_promedio_g ? Number(l.peso_fruta_promedio_g) : null,
          produccion_real_part: parte ? calcularProduccionRealParteAnalisis(parte) || null : null,
          part_id: l.part_id,
          kg_industria: Number(l.kg_industria) || 0,
          notas: l.notas ?? null,
          hora_inicio: l.hora_inicio ?? null,
          productor_id: l.productor_id ?? null,
          clasificacion,
          detalle,
          calidad,
        };
      });

      const kg_lotes = lotesAll.reduce((s, l) => s + l.kg_peso_total, 0);
      const kg_industria = lotesAll.reduce((s, l) => s + (l.kg_industria ?? 0), 0);
      const lotesConTph = lotesAll.filter((l) => l.toneladas_hora !== null && l.toneladas_hora > 0);
      const totalMin = lotesConTph.reduce((s, l) => s + (l.duracion_min ?? 0), 0);
      const totalHoras = totalMin / 60;

      // ── 4. Agregado por productor (absorbe la vista de Productores) ───────
      const productores: ProductorResumen[] = buildProductoresResumen(lotesAll);

      // Calcular producción real total desde los partes
      const kg_produccion_real = calcularProduccionRealPartesAnalisis(partes ?? []);
      // T/h promedio con la jornada de cada día (8 h hasta 1 jul 2026, 7 h después),
      // usando producción real, o kg_lotes si no hay datos.
      const kgParaCalculo = kg_produccion_real > 0 ? kg_produccion_real : kg_lotes;
      const avgTph = calcularTphOperativa(kgParaCalculo, Array.from(diasSet));

      setData({
        totals: {
          n_dias: diasSet.size,
          n_lotes: lotesAll.length,
          kg_lotes,
          kg_calibres: kgCalibres,
          kg_produccion_real,
          kg_industria,
          avg_tph: avgTph,
          total_min: totalMin,
          total_horas: totalHoras,
          n_lotes_lentos: lotesConTph.filter((l) => (l.toneladas_hora ?? 0) < 12.5).length,
        },
        days: Array.from(diasSet).sort(),
        lotes: lotesAll.sort((a, b) => b.fecha.localeCompare(a.fecha)),
        clases,
        grupos,
        calibres,
        productores,
        clasificacionRows,
      });
    } catch (e) {
      console.error("useAnalisisDiario error:", e);
      setError(e instanceof Error ? e.message : "Error al cargar los datos");
      setData(EMPTY_DATA);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchData();
    // fetchData usa desde/hasta del closure — se actualiza correctamente
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desde, hasta]);

  return { data, loading, error, refetch: fetchData };
}

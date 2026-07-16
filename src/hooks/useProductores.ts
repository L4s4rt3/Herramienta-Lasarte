// src/hooks/useProductores.ts
import { useCallback, useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { CalidadEstado, CalidadInformeEstado } from "@/lib/calidad";
import { detectarTipoClasificacion } from "@/lib/destinoClasificacion";
import { fetchAllRows } from "@/lib/fetchAllRows";
import { normalizarTexto } from "@/lib/format";
import { esProductorPrecalibrado, resolveProductorGroupKey } from "@/lib/productoresCanonicos";
import { esProductoMdna } from "@/hooks/useMercadona";

// Cast local: productores_alias y lotes_dia.productor_id aun no estan en el
// Database generado (migracion 20260714090000_productores_canonicos.sql
// pendiente de aplicar). Ver useProductoresCatalogo.ts para el plan de retirada.
const SUPA = supabase as unknown as SupabaseClient<any>;

// ─── Tipos ──────────────────────────────────────────────────────────────────

export interface LoteDossier {
  fecha: string;
  lote_codigo: string;
  productor: string;
  producto: string;
  kg_peso_total: number;
  toneladas_hora: number | null;
  duracion_min: number | null;
  peso_fruta_promedio_g: number | null;
  hora_inicio: string | null;
  part_id: string;
  kg_industria: number;
  notas: string | null;
}

export interface CalidadResumenProductor {
  total: number;
  porEstado: Record<CalidadEstado, number>;
  /** Top 5 defectos más frecuentes: [defecto, nº de veces]. */
  defectosFrecuentes: [string, number][];
  /** Nº de registros Regular/Deficiente/Pésimo o con al menos un defecto anotado. */
  incidencias: number;
  /** Listado cronológico (desc) de notas de calidad para este productor. */
  historial: CalidadNotaProductor[];
}

export interface CalidadNotaProductor {
  id: string;
  fecha: string;
  numero_lote: string;
  calidad: CalidadEstado;
  defectos: string[];
  hora: string | null;
  /** Campos adicionales para poder abrir la ficha completa (CalidadInformeDialog). */
  productor_finca_nombre: string;
  producto: string;
  variedad: string;
  cantidad: string;
  observacion: string;
  accion_recomendada: string;
  informe_generado: string;
  informe_estado: CalidadInformeEstado;
  aerobotics_realizado: boolean;
  defecto_otro: string;
}

/** Desglose de calibre/clase/grupo de destino de un productor, derivado del "Informe LOTE" (lote_clasificacion). */
export interface PerfilDestino {
  kg_clasificado: number;
  /** Clave = categoría canónica (detectarTipoClasificacion), valor = kg. */
  por_grupo: Record<string, number>;
  /** Top 5 clases más producidas, desc por kg. */
  top_clases: Array<{ clase: string; kg: number; pct: number }>;
}

/** Distribución de kg por calibre (tamaño) de un productor. */
export interface CalibreProductor {
  tamano: string;
  kg: number;
  pct: number;
  piezas: number;
}

/** Fila de la tabla completa de clases (no solo el top 5). */
export interface ClaseCompletaProductor {
  clase: string;
  grupo: string;
  kg: number;
  pct: number;
  piezas: number;
  cartons: number;
}

/** kg por producto del productor, para el desglose "por_producto". */
export interface ProductoProductor {
  producto: string;
  kg: number;
  n_lotes: number;
  pct: number;
}

/** Métricas de aprovechamiento comercial derivadas de lote_clasificacion. */
export interface AprovechamientoProductor {
  kg_clasificado: number;
  pct_exportacion: number;
  pct_mercado: number;
  pct_no_export: number;
  pct_no_comercial: number;
  pct_mujeres: number;
  /** kg_industria / kg_total (de lotes_dia), no depende de lote_clasificacion. */
  pct_industria: number;
}

export interface ProductorDossier {
  productor: string;
  /**
   * Clave de agrupación canónica ya resuelta (ver resolveProductorGroupKey en
   * productoresCanonicos.ts): "id:<uuid>" si se resolvió un productor del
   * catálogo (directo o vía alias), "nombre:<texto crudo>" si no. Permite
   * cruzar este dossier con agregados calculados sobre OTRA fuente (p. ej.
   * merma/podrido de useMermaLotes, vía entradas_bascula) usando la misma
   * identidad canónica, sin tener que volver a resolverla.
   */
  productorKey: string;
  kg_total: number;
  n_lotes: number;
  n_dias: number;
  ultimo_dia: string | null;
  productos: string[];
  /** T/h media ponderada por duración del lote (fallback: media simple). */
  tph_promedio: number | null;
  /** % de lotes con T/h por debajo del umbral lento (12.5), sobre los lotes con T/h conocido. */
  pct_lotes_lentos: number | null;
  peso_fruta_promedio_g: number | null;
  kg_industria: number;
  /** kg_industria / kg_total * 100. Métrica clave: cuánto de lo traído acaba en industria. */
  pct_industria: number;
  /**
   * Aprovechamiento Mercadona ESTIMADO (0-100): % de los kg del productor que
   * acaban en formato MDNA, repartiendo el % MDNA de cada día (producto_dia)
   * entre los lotes servidos ese día. No hay vínculo exacto lote → formato,
   * así que es una aproximación (misma metodología que useMercadonaLotes /
   * computeProductoresHistorico). Lotes sin fecha resoluble cuentan como 0%.
   */
  aprovechamientoMercadonaPct: number;
  calidad: CalidadResumenProductor | null;
  /** Desglose de calibre/clase/grupo de destino (Informe LOTE). null si no hay dato para este productor. */
  perfil_destino: PerfilDestino | null;
  lotes: LoteDossier[];
  por_dia: Record<string, number>;
  /** Distribución de kg por calibre (tamano), todos (no solo top 5), desc por kg. */
  calibres: CalibreProductor[];
  /** TODAS las clases del productor (no solo el top 5 de perfil_destino.top_clases). */
  clases_completas: ClaseCompletaProductor[];
  /** kg por combinación tamano×clase, para pintar una matriz tipo AnalisisCalibres. */
  matriz_calibre_clase: Record<string, Record<string, number>>;
  /** Métricas de aprovechamiento comercial (% exportación, mercado, etc). null si no hay Informe LOTE. */
  aprovechamiento: AprovechamientoProductor | null;
  /** kg por producto, desc. */
  por_producto: ProductoProductor[];
}

export interface MediasPlanta {
  tph_media: number | null;
  pct_industria_media: number;
  peso_fruta_medio: number | null;
  /** % de cada grupo canónico de destino sobre el total de kg clasificado en TODA la planta del periodo. null si no hay datos de lote_clasificacion. */
  pct_grupo_medio: Record<string, number> | null;
}

export interface ProductoresData {
  productores: ProductorDossier[];
  medias: MediasPlanta;
  days: string[];
}

const EMPTY_DATA: ProductoresData = {
  productores: [],
  medias: { tph_media: null, pct_industria_media: 0, peso_fruta_medio: null, pct_grupo_medio: null },
  days: [],
};

const CALIDAD_ESTADOS: CalidadEstado[] = ["Excelente", "Bueno", "Regular", "Deficiente", "Pésimo"];
const SLOW_TPH_THRESHOLD = 12.5;
const IN_CHUNK_SIZE = 200;

// A diferencia del normalizarTexto "plano" usado para buscar (que no recorta
// espacios), este SÍ hace trim: el resultado se usa como clave de igualdad
// (Map de productor) en useMercadonaLotes, useCalidadProductores, etc., y un
// espacio de borde en el dato de origen rompería el emparejamiento.
export function normalizeNombre(value: string | null | undefined): string {
  return normalizarTexto(value, { trim: true });
}

type LoteDiaRow = {
  lote_codigo: string | null;
  productor: string | null;
  producto: string | null;
  kg_peso_total: number;
  toneladas_hora: number | null;
  duracion_min: number | null;
  peso_fruta_promedio_g: number | null;
  hora_inicio: string | null;
  kg_industria: number | null;
  notas: string | null;
  part_id: string;
  partes_diarios?: { date?: string | null } | null;
  /**
   * Catálogo de productores (migración 20260714090000_productores_canonicos.sql,
   * pendiente de aplicar): undefined mientras la columna no exista en BD (el
   * select("*") simplemente no la trae), poblada por el trigger/backfill o una
   * asignación manual una vez aplicada.
   */
  productor_id?: string | null;
};

type CalidadLoteRow = {
  id: string;
  numero_lote: string;
  productor_finca_nombre: string;
  calidad: string;
  defectos: string[] | null;
  fecha: string;
  hora: string | null;
  producto: string | null;
  variedad: string | null;
  cantidad: string | null;
  observacion: string | null;
  accion_recomendada: string | null;
  informe_generado: string | null;
  informe_estado: string | null;
  aerobotics_realizado: boolean | null;
  defecto_otro: string | null;
};

type ClasificacionRow = {
  productor: string | null;
  grupo_destino: string | null;
  clase: string | null;
  peso_kg: number | null;
  tamano: string | null;
  piezas: number | null;
  cartons: number | null;
};

type ProductoDiaRow = {
  part_id: string;
  producto: string | null;
  kg: number | null;
};

/**
 * % MDNA por fecha (día), para el aprovechamiento Mercadona de cada
 * productor. MISMA metodología que pctMdnaPorDia en useMercadonaLotes.ts:
 * kg de productos MDNA (esProductoMdna, excluye precalibrado) / kg totales
 * de producto_dia del día, excluyendo siempre la fila TOTAL (producto
 * null/vacío). Se carga aparte (no se reutiliza pctMdnaPorDia) para evitar un
 * import circular entre useProductores.ts y useMercadonaLotes.ts (que ya
 * importa normalizeNombre desde aquí).
 */
async function fetchPctMdnaPorDia(desde: string, hasta: string): Promise<Map<string, number>> {
  // partes_diarios: rango de fechas potencialmente amplio (toda la campaña);
  // se pagina por seguridad de cara al futuro (207 filas hoy, creciendo).
  const partesRaw = await fetchAllRows<{ id: string; date: string }>((from, to) =>
    supabase.from("partes_diarios").select("id, date").gte("date", desde).lte("date", hasta).order("id").range(from, to),
  );

  const partesById = new Map(partesRaw.map((p) => [p.id, p.date]));
  const partIds = Array.from(partesById.keys());
  if (partIds.length === 0) return new Map();

  // producto_dia: el chunking de IN_CHUNK_SIZE evita pasarnos del límite de
  // longitud de URL de la cláusula IN, pero CADA chunk puede devolver más de
  // 1.000 filas por sí solo (varias líneas de producto por día × 200 días) —
  // el .limit(100000) no protegía nada, PostgREST recorta a su max-rows en
  // silencio. Se pagina el fetch de cada chunk con fetchAllRows.
  const productoDiaRows: ProductoDiaRow[] = [];
  for (let i = 0; i < partIds.length; i += IN_CHUNK_SIZE) {
    const chunk = partIds.slice(i, i + IN_CHUNK_SIZE);
    const rows = await fetchAllRows<ProductoDiaRow>((from, to) =>
      supabase.from("producto_dia").select("part_id, producto, kg").in("part_id", chunk).order("id").range(from, to),
    );
    productoDiaRows.push(...rows);
  }

  const porDia = new Map<string, { total: number; mdna: number }>();
  for (const p of productoDiaRows) {
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

/**
 * Alias aprendidos (nombre normalizado → productor_id) del catálogo de
 * productores. Se usan para agrupar por id incluso cuando la fila de
 * lotes_dia todavía no tiene su propio productor_id resuelto (p. ej. si el
 * alias se creó después de importar ese lote). Degrada a mapa vacío si la
 * tabla productores_alias todavía no existe (migración pendiente de aplicar):
 * en ese caso la agrupación cae al texto crudo, igual que antes del catálogo.
 */
async function fetchAliasPorNombreNormalizado(): Promise<Map<string, string>> {
  try {
    const { data, error } = await SUPA.from("productores_alias").select("alias_normalizado, productor_id");
    if (error) throw error;
    return new Map((data ?? []).map((r: any) => [r.alias_normalizado as string, r.productor_id as string]));
  } catch (e) {
    console.warn("useProductores: productores_alias no disponible todavía (se agrupa por texto crudo):", e);
    return new Map();
  }
}

/** Nombre canónico por id de productor, para mostrar el nombre del catálogo en vez del texto crudo cuando se resuelve un id. */
async function fetchNombrePorProductorId(): Promise<Map<string, string>> {
  try {
    const { data, error } = await supabase.from("calidad_productores").select("id, nombre");
    if (error) throw error;
    return new Map((data ?? []).map((r) => [r.id, r.nombre]));
  } catch (e) {
    console.error("useProductores: fallo al cargar el catálogo de productores (se usa el texto crudo):", e);
    return new Map();
  }
}

/**
 * Trae y agrega los lotes de producción (lotes_dia) y las notas de calidad
 * (calidad_lotes) del rango [desde, hasta], calculando un "dossier" de
 * eficiencia por productor.
 */
export function useProductores(desde: string, hasta: string) {
  const [data, setData] = useState<ProductoresData>(EMPTY_DATA);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // ── 1. Lotes de producción en el rango (patrón de la página vieja),
      //      en paralelo con el % MDNA por día (producto_dia) para el
      //      aprovechamiento Mercadona, y el alias/catálogo de productores
      //      para poder agrupar por id (con fallback a texto crudo). ──────
      // lotes_dia ya tiene 1.187 filas tras el histórico de campaña: un rango
      // amplio de fechas puede superar de sobra las 1.000 filas que PostgREST
      // devuelve por respuesta, así que se pagina con fetchAllRows. El orden
      // por created_at deja de pedirse (el consumidor no depende de él: cada
      // productor vuelve a ordenar sus propios lotes por fecha más abajo) y
      // se sustituye por "id" para una paginación determinista.
      const [lotesRaw, pctMdnaPorDia, aliasPorNombreNormalizado, nombrePorProductorId] = await Promise.all([
        fetchAllRows<LoteDiaRow>((from, to) =>
          supabase
            .from("lotes_dia")
            .select("*, partes_diarios!inner(date)")
            .gte("partes_diarios.date", desde)
            .lte("partes_diarios.date", hasta)
            .order("id")
            .range(from, to) as unknown as PromiseLike<{ data: LoteDiaRow[] | null; error: unknown }>,
        ),
        fetchPctMdnaPorDia(desde, hasta),
        fetchAliasPorNombreNormalizado(),
        fetchNombrePorProductorId(),
      ]);

      // ── 2. Notas de calidad en el rango ──────────────────────────────
      // calidad_lotes: mismo riesgo que lotes_dia para rangos amplios (una
      // nota por lote, volumen comparable) — se pagina igual.
      const calidadRaw = await fetchAllRows<CalidadLoteRow>((from, to) =>
        supabase
          .from("calidad_lotes")
          .select(
            "id, numero_lote, productor_finca_nombre, calidad, defectos, fecha, hora, producto, variedad, cantidad, observacion, accion_recomendada, informe_generado, informe_estado, aerobotics_realizado, defecto_otro",
          )
          .gte("fecha", desde)
          .lte("fecha", hasta)
          .order("id")
          .range(from, to),
      );

      // ── 3. Desglose de calibre/clase/destino (Informe LOTE) ──────────
      // Tabla nueva y no siempre disponible por productor: si falla o no
      // devuelve nada, no debe romper el resto del dossier (calidad, KPIs...).
      // lote_clasificacion tiene 8.685 filas tras el histórico: muy por
      // encima del max-rows del servidor para un rango amplio, se pagina.
      let clasifRows: ClasificacionRow[] = [];
      try {
        clasifRows = await fetchAllRows<ClasificacionRow>((from, to) =>
          supabase
            .from("lote_clasificacion")
            .select("productor, grupo_destino, clase, peso_kg, tamano, piezas, cartons")
            .gte("fecha", desde)
            .lte("fecha", hasta)
            .order("id")
            .range(from, to),
        );
      } catch (clasifEx) {
        console.error("useProductores: fallo al cargar lote_clasificacion (se omite el perfil de destino):", clasifEx);
        clasifRows = [];
      }

      const clasifPorNombre = new Map<string, ClasificacionRow[]>();
      for (const c of clasifRows) {
        const nombre = normalizeNombre(c.productor);
        if (!nombre) continue;
        const arr = clasifPorNombre.get(nombre) ?? [];
        arr.push(c);
        clasifPorNombre.set(nombre, arr);
      }

      // El PRECALIBRADO no es un productor real (decisión del dueño,
      // 2026-07-15): son segundas pasadas de fruta ya contada a nombre de sus
      // productores reales. Fuera de rankings, dossiers y medias de planta.
      // OJO: solo se excluye de la agregación por predicado; si el backfill
      // del catálogo creó "PRECALIBRADO" en calidad_productores, en BD se queda.
      const lotesRawTyped = ((lotesRaw ?? []) as LoteDiaRow[]).filter((r) => !esProductorPrecalibrado(r.productor));
      const lotes: LoteDossier[] = lotesRawTyped.map((r) => ({
        fecha: r.partes_diarios?.date ?? "—",
        lote_codigo: r.lote_codigo ?? "—",
        productor: r.productor ?? "Sin productor",
        producto: r.producto ?? "—",
        kg_peso_total: Number(r.kg_peso_total) || 0,
        toneladas_hora: r.toneladas_hora ? Number(r.toneladas_hora) : null,
        duracion_min: r.duracion_min ? Number(r.duracion_min) : null,
        peso_fruta_promedio_g: r.peso_fruta_promedio_g ? Number(r.peso_fruta_promedio_g) : null,
        hora_inicio: r.hora_inicio ?? null,
        part_id: r.part_id,
        kg_industria: Number(r.kg_industria) || 0,
        notas: r.notas ?? null,
      }));

      // Resolución de identidad canónica por fila (misma posición que `lotes`):
      // id directo de la columna productor_id si existe, si no por alias
      // aprendido, si no fallback al texto crudo — ver resolveProductorGroupKey.
      // Con productor_id inexistente (migración sin aplicar) y alias vacío,
      // esto resuelve EXACTAMENTE igual que el agrupado por texto crudo de
      // antes del catálogo (paridad).
      const resolucionPorFila = lotesRawTyped.map((r) =>
        resolveProductorGroupKey(r.productor ?? "Sin productor", r.productor_id ?? null, aliasPorNombreNormalizado),
      );

      const calidadRows = (calidadRaw ?? []) as CalidadLoteRow[];

      // Índices para el match calidad → productor: por nº de lote primero,
      // por nombre normalizado como fallback.
      const calidadPorLote = new Map<string, CalidadLoteRow[]>();
      const calidadPorNombre = new Map<string, CalidadLoteRow[]>();
      for (const c of calidadRows) {
        const codigo = (c.numero_lote ?? "").trim();
        if (codigo) {
          const arr = calidadPorLote.get(codigo) ?? [];
          arr.push(c);
          calidadPorLote.set(codigo, arr);
        }
        const nombre = normalizeNombre(c.productor_finca_nombre);
        if (nombre) {
          const arr = calidadPorNombre.get(nombre) ?? [];
          arr.push(c);
          calidadPorNombre.set(nombre, arr);
        }
      }

      // Agrupar lotes por productor: por id resuelto (directo o vía alias)
      // cuando existe, si no por el texto crudo tal cual (fallback = mismo
      // comportamiento que antes del catálogo, ver resolveProductorGroupKey).
      const porProductor = new Map<string, LoteDossier[]>();
      const productorIdPorKey = new Map<string, string | null>();
      lotes.forEach((l, i) => {
        const { key, productorId } = resolucionPorFila[i];
        const arr = porProductor.get(key) ?? [];
        arr.push(l);
        porProductor.set(key, arr);
        productorIdPorKey.set(key, productorId);
      });

      const days = Array.from(new Set(lotes.map((l) => l.fecha).filter((f) => f && f !== "—"))).sort();

      const productores: ProductorDossier[] = Array.from(porProductor.entries())
        .map(([key, ls]) => {
          // Nombre a mostrar: el canónico del catálogo si se resolvió un id
          // (con fallback al texto crudo si el catálogo aún no cargó), o el
          // propio texto crudo del grupo (todas sus filas comparten el mismo,
          // por construcción de la clave "nombre:<texto>") si no hay id.
          const productorId = productorIdPorKey.get(key) ?? null;
          const productor = productorId
            ? nombrePorProductorId.get(productorId) ?? ls[0].productor
            : ls[0].productor;
          const conTph = ls.filter((l) => l.toneladas_hora !== null && l.toneladas_hora > 0);
          const minTph = conTph.reduce((s, l) => s + (l.duracion_min ?? 0), 0);
          const tph_promedio = conTph.length > 0
            ? minTph > 0
              ? conTph.reduce((s, l) => s + (l.toneladas_hora ?? 0) * (l.duracion_min ?? 1), 0) / minTph
              : conTph.reduce((s, l) => s + (l.toneladas_hora ?? 0), 0) / conTph.length
            : null;

          const pct_lotes_lentos = conTph.length > 0
            ? (conTph.filter((l) => (l.toneladas_hora ?? 0) < SLOW_TPH_THRESHOLD).length / conTph.length) * 100
            : null;

          const conPeso = ls.filter((l) => l.peso_fruta_promedio_g && l.peso_fruta_promedio_g > 0);
          const peso_fruta_promedio_g = conPeso.length > 0
            ? conPeso.reduce((s, l) => s + (l.peso_fruta_promedio_g ?? 0), 0) / conPeso.length
            : null;

          const kg_total = ls.reduce((s, l) => s + l.kg_peso_total, 0);
          const kg_industria = ls.reduce((s, l) => s + (l.kg_industria ?? 0), 0);
          const pct_industria = kg_total > 0 ? (kg_industria / kg_total) * 100 : 0;

          const porDia = new Map<string, number>();
          const fechasSet = new Set<string>();
          // Aprovechamiento Mercadona estimado: Σ (kg del lote × %MDNA del día
          // del lote) / Σ kg de sus lotes. Lotes sin fecha resoluble (fecha
          // "—") cuentan como 0% (no aportan al numerador, sí al denominador).
          let kgPonderadoMdna = 0;
          for (const l of ls) {
            if (l.fecha && l.fecha !== "—") {
              porDia.set(l.fecha, (porDia.get(l.fecha) ?? 0) + l.kg_peso_total);
              fechasSet.add(l.fecha);
              kgPonderadoMdna += l.kg_peso_total * ((pctMdnaPorDia.get(l.fecha) ?? 0) / 100);
            }
          }
          const fechasOrdenadas = Array.from(fechasSet).sort();
          const aprovechamientoMercadonaPct = kg_total > 0 ? (kgPonderadoMdna / kg_total) * 100 : 0;

          // Calidad: match por lote_codigo, si no por nombre normalizado.
          const nombreNorm = normalizeNombre(productor);
          const matches = new Map<CalidadLoteRow, true>();
          for (const l of ls) {
            const porLote = calidadPorLote.get(l.lote_codigo.trim());
            if (porLote) {
              for (const c of porLote) matches.set(c, true);
            }
          }
          const porNombre = calidadPorNombre.get(nombreNorm);
          if (porNombre) {
            for (const c of porNombre) matches.set(c, true);
          }
          const calidadDelProductor = Array.from(matches.keys());

          let calidad: CalidadResumenProductor | null = null;
          if (calidadDelProductor.length > 0) {
            const porEstado = Object.fromEntries(CALIDAD_ESTADOS.map((e) => [e, 0])) as Record<CalidadEstado, number>;
            const defectosCount = new Map<string, number>();
            let incidencias = 0;
            for (const c of calidadDelProductor) {
              const estado = c.calidad as CalidadEstado;
              if (estado in porEstado) porEstado[estado] += 1;
              const defectos = c.defectos ?? [];
              for (const d of defectos) {
                defectosCount.set(d, (defectosCount.get(d) ?? 0) + 1);
              }
              if (estado === "Regular" || estado === "Deficiente" || estado === "Pésimo" || defectos.length > 0) {
                incidencias += 1;
              }
            }
            const defectosFrecuentes = Array.from(defectosCount.entries())
              .sort((a, b) => b[1] - a[1])
              .slice(0, 5);
            const historial: CalidadNotaProductor[] = calidadDelProductor
              .map((c) => ({
                id: c.id,
                fecha: c.fecha,
                numero_lote: c.numero_lote,
                calidad: c.calidad as CalidadEstado,
                defectos: c.defectos ?? [],
                hora: c.hora ?? null,
                productor_finca_nombre: c.productor_finca_nombre ?? "",
                producto: c.producto ?? "",
                variedad: c.variedad ?? "",
                cantidad: c.cantidad ?? "",
                observacion: c.observacion ?? "",
                accion_recomendada: c.accion_recomendada ?? "",
                informe_generado: c.informe_generado ?? "",
                informe_estado: (c.informe_estado as CalidadInformeEstado) ?? "borrador",
                aerobotics_realizado: c.aerobotics_realizado ?? false,
                defecto_otro: c.defecto_otro ?? "",
              }))
              .sort((a, b) => (b.fecha + (b.hora ?? "")).localeCompare(a.fecha + (a.hora ?? "")));
            calidad = {
              total: calidadDelProductor.length,
              porEstado,
              defectosFrecuentes,
              incidencias,
              historial,
            };
          }

          // Perfil de calidad y destino: desglose de calibre/clase/grupo
          // de destino a partir del Informe LOTE, cruzado por nombre normalizado.
          const clasifDelProductor = clasifPorNombre.get(nombreNorm) ?? [];
          let perfil_destino: PerfilDestino | null = null;
          let calibres: CalibreProductor[] = [];
          let clases_completas: ClaseCompletaProductor[] = [];
          let matriz_calibre_clase: Record<string, Record<string, number>> = {};
          let aprovechamiento: AprovechamientoProductor | null = null;
          if (clasifDelProductor.length > 0) {
            const kg_clasificado = clasifDelProductor.reduce((s, c) => s + (Number(c.peso_kg) || 0), 0);
            const porGrupo = new Map<string, number>();
            const porClase = new Map<string, { grupo: string; kg: number; piezas: number; cartons: number }>();
            const porTamano = new Map<string, { kg: number; piezas: number }>();
            const matriz = new Map<string, Map<string, number>>();
            for (const c of clasifDelProductor) {
              const kg = Number(c.peso_kg) || 0;
              const piezas = Number(c.piezas) || 0;
              const cartons = Number(c.cartons) || 0;
              const grupo = detectarTipoClasificacion(c.grupo_destino);
              porGrupo.set(grupo, (porGrupo.get(grupo) ?? 0) + kg);

              const clase = c.clase ?? "Sin clase";
              const claseAcc = porClase.get(clase) ?? { grupo, kg: 0, piezas: 0, cartons: 0 };
              claseAcc.kg += kg;
              claseAcc.piezas += piezas;
              claseAcc.cartons += cartons;
              porClase.set(clase, claseAcc);

              const tamano = c.tamano ?? "Sin calibre";
              const tamanoAcc = porTamano.get(tamano) ?? { kg: 0, piezas: 0 };
              tamanoAcc.kg += kg;
              tamanoAcc.piezas += piezas;
              porTamano.set(tamano, tamanoAcc);

              const filaMatriz = matriz.get(tamano) ?? new Map<string, number>();
              filaMatriz.set(clase, (filaMatriz.get(clase) ?? 0) + kg);
              matriz.set(tamano, filaMatriz);
            }
            const top_clases = Array.from(porClase.entries())
              .map(([clase, v]) => ({ clase, kg: v.kg, pct: kg_clasificado > 0 ? (v.kg / kg_clasificado) * 100 : 0 }))
              .sort((a, b) => b.kg - a.kg)
              .slice(0, 5);
            perfil_destino = {
              kg_clasificado,
              por_grupo: Object.fromEntries(porGrupo),
              top_clases,
            };

            calibres = Array.from(porTamano.entries())
              .map(([tamano, v]) => ({ tamano, kg: v.kg, pct: kg_clasificado > 0 ? (v.kg / kg_clasificado) * 100 : 0, piezas: v.piezas }))
              .sort((a, b) => b.kg - a.kg);

            clases_completas = Array.from(porClase.entries())
              .map(([clase, v]) => ({
                clase,
                grupo: v.grupo,
                kg: v.kg,
                pct: kg_clasificado > 0 ? (v.kg / kg_clasificado) * 100 : 0,
                piezas: v.piezas,
                cartons: v.cartons,
              }))
              .sort((a, b) => b.kg - a.kg);

            matriz_calibre_clase = Object.fromEntries(
              Array.from(matriz.entries()).map(([tamano, claseMap]) => [tamano, Object.fromEntries(claseMap)])
            );

            const kgExport = porGrupo.get("Exportación") ?? 0;
            const kgMercado = porGrupo.get("Mercado") ?? 0;
            const kgNoExport = porGrupo.get("No exportación") ?? 0;
            const kgNoComercial = porGrupo.get("No comercial") ?? 0;
            const kgMujeres = porGrupo.get("Mujeres") ?? 0;
            aprovechamiento = {
              kg_clasificado,
              pct_exportacion: kg_clasificado > 0 ? (kgExport / kg_clasificado) * 100 : 0,
              pct_mercado: kg_clasificado > 0 ? (kgMercado / kg_clasificado) * 100 : 0,
              pct_no_export: kg_clasificado > 0 ? (kgNoExport / kg_clasificado) * 100 : 0,
              pct_no_comercial: kg_clasificado > 0 ? (kgNoComercial / kg_clasificado) * 100 : 0,
              pct_mujeres: kg_clasificado > 0 ? (kgMujeres / kg_clasificado) * 100 : 0,
              pct_industria,
            };
          }

          // Desglose por producto (a partir de los propios lotes del productor).
          const porProducto = new Map<string, { kg: number; n_lotes: number }>();
          for (const l of ls) {
            if (!l.producto || l.producto === "—") continue;
            const acc = porProducto.get(l.producto) ?? { kg: 0, n_lotes: 0 };
            acc.kg += l.kg_peso_total;
            acc.n_lotes += 1;
            porProducto.set(l.producto, acc);
          }
          const por_producto: ProductoProductor[] = Array.from(porProducto.entries())
            .map(([producto, v]) => ({ producto, kg: v.kg, n_lotes: v.n_lotes, pct: kg_total > 0 ? (v.kg / kg_total) * 100 : 0 }))
            .sort((a, b) => b.kg - a.kg);

          return {
            productor,
            productorKey: key,
            kg_total,
            n_lotes: ls.length,
            n_dias: fechasOrdenadas.length,
            ultimo_dia: fechasOrdenadas.length > 0 ? fechasOrdenadas[fechasOrdenadas.length - 1] : null,
            productos: Array.from(new Set(ls.map((l) => l.producto).filter((p) => p && p !== "—"))),
            tph_promedio,
            pct_lotes_lentos,
            peso_fruta_promedio_g,
            kg_industria,
            pct_industria,
            aprovechamientoMercadonaPct,
            calidad,
            perfil_destino,
            lotes: [...ls].sort((a, b) => b.fecha.localeCompare(a.fecha)),
            por_dia: Object.fromEntries(porDia),
            calibres,
            clases_completas,
            matriz_calibre_clase,
            aprovechamiento,
            por_producto,
          };
        })
        .sort((a, b) => b.kg_total - a.kg_total);

      // Medias de planta del periodo
      const todosConTph = lotes.filter((l) => l.toneladas_hora !== null && l.toneladas_hora > 0);
      const minTotal = todosConTph.reduce((s, l) => s + (l.duracion_min ?? 0), 0);
      const tph_media = todosConTph.length > 0
        ? minTotal > 0
          ? todosConTph.reduce((s, l) => s + (l.toneladas_hora ?? 0) * (l.duracion_min ?? 1), 0) / minTotal
          : todosConTph.reduce((s, l) => s + (l.toneladas_hora ?? 0), 0) / todosConTph.length
        : null;

      const kgTotalPlanta = lotes.reduce((s, l) => s + l.kg_peso_total, 0);
      const kgIndustriaPlanta = lotes.reduce((s, l) => s + (l.kg_industria ?? 0), 0);
      const pct_industria_media = kgTotalPlanta > 0 ? (kgIndustriaPlanta / kgTotalPlanta) * 100 : 0;

      const todosConPeso = lotes.filter((l) => l.peso_fruta_promedio_g && l.peso_fruta_promedio_g > 0);
      const peso_fruta_medio = todosConPeso.length > 0
        ? todosConPeso.reduce((s, l) => s + (l.peso_fruta_promedio_g ?? 0), 0) / todosConPeso.length
        : null;

      // Media de planta del % por grupo de destino, sobre TODAS las filas de
      // lote_clasificacion del periodo (no solo las que matchean un productor
      // del ranking), para poder comparar cada productor contra la planta.
      let pct_grupo_medio: Record<string, number> | null = null;
      if (clasifRows.length > 0) {
        const kgPorGrupoPlanta = new Map<string, number>();
        let kgClasificadoPlanta = 0;
        for (const c of clasifRows) {
          const kg = Number(c.peso_kg) || 0;
          const grupo = detectarTipoClasificacion(c.grupo_destino);
          kgPorGrupoPlanta.set(grupo, (kgPorGrupoPlanta.get(grupo) ?? 0) + kg);
          kgClasificadoPlanta += kg;
        }
        pct_grupo_medio = kgClasificadoPlanta > 0
          ? Object.fromEntries(
              Array.from(kgPorGrupoPlanta.entries()).map(([grupo, kg]) => [grupo, (kg / kgClasificadoPlanta) * 100])
            )
          : null;
      }

      setData({
        productores,
        medias: { tph_media, pct_industria_media, peso_fruta_medio, pct_grupo_medio },
        days,
      });
    } catch (e) {
      console.error("useProductores error:", e);
      setError(e instanceof Error ? e.message : "Error al cargar los productores");
      setData(EMPTY_DATA);
    } finally {
      setLoading(false);
    }
  }, [desde, hasta]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { data, loading, error, refetch: fetchData };
}

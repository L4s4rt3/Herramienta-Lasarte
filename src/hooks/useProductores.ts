// src/hooks/useProductores.ts
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { CalidadEstado } from "@/lib/calidad";
import { detectarTipoClasificacion } from "@/lib/destinoClasificacion";

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
  fecha: string;
  numero_lote: string;
  calidad: CalidadEstado;
  defectos: string[];
  hora: string | null;
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

export function normalizeNombre(value: string | null | undefined): string {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim();
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
};

type CalidadLoteRow = {
  numero_lote: string;
  productor_finca_nombre: string;
  calidad: string;
  defectos: string[] | null;
  fecha: string;
  hora: string | null;
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
      // ── 1. Lotes de producción en el rango (patrón de la página vieja) ──
      const { data: lotesRaw, error: lErr } = await supabase
        .from("lotes_dia")
        .select("*, partes_diarios!inner(date)")
        .gte("partes_diarios.date", desde)
        .lte("partes_diarios.date", hasta)
        .order("created_at", { ascending: false });

      if (lErr) throw lErr;

      // ── 2. Notas de calidad en el rango ──────────────────────────────
      const { data: calidadRaw, error: cErr } = await supabase
        .from("calidad_lotes")
        .select("numero_lote, productor_finca_nombre, calidad, defectos, fecha, hora")
        .gte("fecha", desde)
        .lte("fecha", hasta);

      if (cErr) throw cErr;

      // ── 3. Desglose de calibre/clase/destino (Informe LOTE) ──────────
      // Tabla nueva y no siempre disponible por productor: si falla o no
      // devuelve nada, no debe romper el resto del dossier (calidad, KPIs...).
      let clasifRows: ClasificacionRow[] = [];
      try {
        const { data: clasifRaw, error: clasifErr } = await supabase
          .from("lote_clasificacion")
          .select("productor, grupo_destino, clase, peso_kg, tamano, piezas, cartons")
          .gte("fecha", desde)
          .lte("fecha", hasta);
        if (clasifErr) throw clasifErr;
        clasifRows = (clasifRaw ?? []) as ClasificacionRow[];
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

      const lotes: LoteDossier[] = ((lotesRaw ?? []) as LoteDiaRow[]).map((r) => ({
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

      // Agrupar lotes por productor
      const porProductor = new Map<string, LoteDossier[]>();
      for (const l of lotes) {
        const key = l.productor;
        const arr = porProductor.get(key) ?? [];
        arr.push(l);
        porProductor.set(key, arr);
      }

      const days = Array.from(new Set(lotes.map((l) => l.fecha).filter((f) => f && f !== "—"))).sort();

      const productores: ProductorDossier[] = Array.from(porProductor.entries())
        .map(([productor, ls]) => {
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
          for (const l of ls) {
            if (l.fecha && l.fecha !== "—") {
              porDia.set(l.fecha, (porDia.get(l.fecha) ?? 0) + l.kg_peso_total);
              fechasSet.add(l.fecha);
            }
          }
          const fechasOrdenadas = Array.from(fechasSet).sort();

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
                fecha: c.fecha,
                numero_lote: c.numero_lote,
                calidad: c.calidad as CalidadEstado,
                defectos: c.defectos ?? [],
                hora: c.hora ?? null,
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

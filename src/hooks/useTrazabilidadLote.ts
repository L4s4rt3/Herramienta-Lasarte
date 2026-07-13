/**
 * useTrazabilidadLote — la cadena completa de un lote (código AAMMDDNN):
 *
 *   1. ENTRADA (entradas_bascula): finca, parcela, agricultor, camión, kg.
 *   2. PROCESADO (lotes_dia + fecha del parte): cuándo y cuánto pasó por el
 *      calibrador, con T/h.
 *   3. CLASIFICACIÓN (lote_clasificacion): calibre × clase × grupo de destino.
 *   4. CALIDAD (calidad_lotes): notas del responsable de calidad.
 *
 * Cada fuente puede faltar (lote antiguo sin báscula, sin Informe LOTE, sin
 * nota de calidad): la ficha lo indica en vez de romperse.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toError } from "@/lib/errorMessage";
import { normalizarLoteCodigo } from "@/lib/entradasBascula";
import type { Tables } from "@/integrations/supabase/types";

export type EntradaBasculaRow = Tables<"entradas_bascula">;

export interface ProcesadoLote {
  part_id: string;
  fecha: string | null;
  kg: number;
  toneladas_hora: number | null;
  duracion_min: number | null;
  producto: string | null;
  productor: string | null;
}

export interface ClasificacionGrupo {
  grupo: string;
  kg: number;
  pct: number;
}

export interface ClasificacionClase {
  clase: string;
  grupo: string;
  kg: number;
  pct: number;
}

export interface ClasificacionCalibre {
  tamano: string;
  kg: number;
  pct: number;
}

export interface CalidadNotaLote {
  numero_lote: string;
  fecha: string;
  hora: string | null;
  calidad: string;
  defectos: string[];
  observacion: string | null;
  productor_finca_nombre: string | null;
  variedad: string | null;
  cantidad: number | null;
}

export interface TrazabilidadLote {
  lote: string;
  entrada: EntradaBasculaRow | null;
  procesado: ProcesadoLote[];
  kgProcesado: number;
  clasificacion: {
    kgClasificado: number;
    grupos: ClasificacionGrupo[];
    clases: ClasificacionClase[];
    calibres: ClasificacionCalibre[];
  };
  calidad: CalidadNotaLote[];
}

export function useTrazabilidadLote(loteInput: string | null) {
  const lote = normalizarLoteCodigo(loteInput);

  const query = useQuery({
    queryKey: ["trazabilidad-lote", lote],
    enabled: Boolean(lote),
    queryFn: async (): Promise<TrazabilidadLote> => {
      const codigo = lote as string;

      const [entradaRes, lotesRes, clasifRes, calidadRes] = await Promise.all([
        supabase.from("entradas_bascula").select("*").eq("lote", codigo).maybeSingle(),
        supabase.from("lotes_dia").select("part_id, lote_codigo, kg_peso_total, toneladas_hora, duracion_min, producto, productor").ilike("lote_codigo", `%${codigo}%`).limit(200),
        supabase.from("lote_clasificacion").select("clase, grupo_destino, tamano, peso_kg").or(`lote_codigo_base.eq.${codigo},lote_codigo.ilike.%${codigo}%`).limit(5000),
        supabase.from("calidad_lotes").select("numero_lote, fecha, hora, calidad, defectos, observacion, productor_finca_nombre, variedad, cantidad").ilike("numero_lote", `%${codigo}%`).order("fecha", { ascending: false }).limit(50),
      ]);

      if (entradaRes.error) throw toError(entradaRes.error);
      if (lotesRes.error) throw toError(lotesRes.error);
      if (clasifRes.error) throw toError(clasifRes.error);
      if (calidadRes.error) throw toError(calidadRes.error);

      // Fechas de los partes donde se procesó el lote.
      const partIds = Array.from(new Set((lotesRes.data ?? []).map((l) => l.part_id as string)));
      let fechaPorParte = new Map<string, string>();
      if (partIds.length > 0) {
        const { data: partes, error } = await supabase.from("partes_diarios").select("id, date").in("id", partIds);
        if (error) throw toError(error);
        fechaPorParte = new Map((partes ?? []).map((p) => [p.id as string, p.date as string]));
      }

      const procesado: ProcesadoLote[] = (lotesRes.data ?? [])
        .filter((l) => normalizarLoteCodigo(l.lote_codigo as string) === codigo)
        .map((l) => ({
          part_id: l.part_id as string,
          fecha: fechaPorParte.get(l.part_id as string) ?? null,
          kg: Number(l.kg_peso_total) || 0,
          toneladas_hora: l.toneladas_hora == null ? null : Number(l.toneladas_hora),
          duracion_min: l.duracion_min == null ? null : Number(l.duracion_min),
          producto: (l.producto as string | null) ?? null,
          productor: (l.productor as string | null) ?? null,
        }))
        .sort((a, b) => (a.fecha ?? "").localeCompare(b.fecha ?? ""));

      // Clasificación agregada (calibre × clase × grupo) del Informe LOTE.
      const gruposMap = new Map<string, number>();
      const clasesMap = new Map<string, { grupo: string; kg: number }>();
      const calibresMap = new Map<string, number>();
      let kgClasificado = 0;
      for (const row of clasifRes.data ?? []) {
        const kg = Number(row.peso_kg) || 0;
        if (kg <= 0) continue;
        kgClasificado += kg;
        const grupo = (row.grupo_destino as string | null) ?? "Otro";
        gruposMap.set(grupo, (gruposMap.get(grupo) ?? 0) + kg);
        const clase = (row.clase as string | null) ?? "Sin clase";
        const claseAcc = clasesMap.get(clase) ?? { grupo, kg: 0 };
        claseAcc.kg += kg;
        clasesMap.set(clase, claseAcc);
        const tamano = (row.tamano as string | null) ?? "—";
        calibresMap.set(tamano, (calibresMap.get(tamano) ?? 0) + kg);
      }
      const pct = (kg: number) => (kgClasificado > 0 ? (kg / kgClasificado) * 100 : 0);

      return {
        lote: codigo,
        entrada: (entradaRes.data as EntradaBasculaRow | null) ?? null,
        procesado,
        kgProcesado: procesado.reduce((s, p) => s + p.kg, 0),
        clasificacion: {
          kgClasificado,
          grupos: Array.from(gruposMap.entries()).map(([grupo, kg]) => ({ grupo, kg, pct: pct(kg) })).sort((a, b) => b.kg - a.kg),
          clases: Array.from(clasesMap.entries()).map(([clase, v]) => ({ clase, grupo: v.grupo, kg: v.kg, pct: pct(v.kg) })).sort((a, b) => b.kg - a.kg),
          calibres: Array.from(calibresMap.entries()).map(([tamano, kg]) => ({ tamano, kg, pct: pct(kg) })).sort((a, b) => b.kg - a.kg),
        },
        calidad: (calidadRes.data ?? []).map((c) => ({
          numero_lote: c.numero_lote as string,
          fecha: c.fecha as string,
          hora: (c.hora as string | null) ?? null,
          calidad: c.calidad as string,
          defectos: (c.defectos as string[] | null) ?? [],
          observacion: (c.observacion as string | null) ?? null,
          productor_finca_nombre: (c.productor_finca_nombre as string | null) ?? null,
          variedad: (c.variedad as string | null) ?? null,
          cantidad: c.cantidad == null ? null : Number(c.cantidad),
        })),
      };
    },
  });

  return {
    lote,
    data: query.data ?? null,
    isLoading: query.isLoading,
    error: query.error,
  };
}

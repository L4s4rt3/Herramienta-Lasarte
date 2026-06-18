import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { calcularTphOperativa } from "@/lib/velocidadOperativa";

// ─── Tipos ──────────────────────────────────────────────────────────────────

export interface LoteResumen {
  fecha: string;
  lote_codigo: string;
  productor: string;
  producto: string;
  kg_peso_total: number;
  toneladas_hora: number | null;
  duracion_min: number | null;
  peso_fruta_promedio_g: number | null;
}

export interface ClaseResumen {
  clase: string;
  kg_total: number;
  n_registros: number;
  n_dias: number;
  grupos: Record<string, number>;
}

export interface GrupoClasificacionResumen {
  grupo: string;
  kg_total: number;
  n_registros: number;
  n_dias: number;
}

function detectarTipoClasificacion(valor: string | null): string {
  if (!valor) return "Otro";
  const v = valor.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (v.includes("no_export") || v.includes("no export") || v.includes("no_exportac") || v.includes("no exportac")) return "No exportación";
  if (v.includes("no_comerc") || v.includes("no comerc") || v.includes("industria") || v.includes("ind")) return "No comercial";
  if (v.includes("export") || v.includes("ext")) return "Exportación";
  if (v.includes("mujer")) return "Mujeres";
  if (v.includes("mercado") || v.includes("nac") || v.includes("interior") || v.includes("int")) return "Mercado";
  return valor;
}

export interface AnalisisDiarioData {
  totals: {
    n_dias: number;
    n_lotes: number;
    kg_lotes: number;
    kg_calibres: number;
    avg_tph: number | null;
    total_min: number;
    total_horas: number;
    n_lotes_lentos: number;
  };
  lotes: LoteResumen[];
  clases: ClaseResumen[];
  grupos: GrupoClasificacionResumen[];
}

const EMPTY_DATA: AnalisisDiarioData = {
  totals: { n_dias: 0, n_lotes: 0, kg_lotes: 0, kg_calibres: 0, avg_tph: null, total_min: 0, total_horas: 0, n_lotes_lentos: 0 },
  lotes: [],
  clases: [],
  grupos: [],
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
      const { data: partes, error: pErr } = await supabase
        .from("partes_diarios")
        .select("id, date")
        .gte("date", desde)
        .lte("date", hasta)
        .order("date", { ascending: false });

      if (pErr) {
        console.error("Error fetching partes:", pErr);
        setLoading(false);
        return;
      }

      const partIds = (partes ?? []).map((p) => p.id);
      const diasSet = new Set((partes ?? []).map((p) => p.date));

      if (partIds.length === 0) {
        setData({
          totals: { n_dias: 0, n_lotes: 0, kg_lotes: 0, kg_calibres: 0, avg_tph: null, total_min: 0, n_lotes_lentos: 0 },
          lotes: [],
          clases: [],
          grupos: [],
        });
        setLoading(false);
        return;
      }

      // Mapa part_id -> date
      const parteDateMap = new Map((partes ?? []).map((p) => [p.id, p.date]));

      // ── 2. Calibres desde calibres_dia ─────────────────────────────────────
      const { data: calibres, error: cErr } = await supabase
        .from("calibres_dia")
        .select("clase, grupo_destino, kg, part_id")
        .in("part_id", partIds)
        .limit(100000);

      if (cErr) {
        console.error("Error fetching calibres_dia:", cErr);
        setLoading(false);
        return;
      }

      const clasesMap = new Map<string, {
        kg: number;
        n_registros: number;
        fechas: Set<string>;
        grupos: Map<string, number>;
      }>();

      const gruposMap = new Map<string, {
        kg: number;
        n_registros: number;
        fechas: Set<string>;
      }>();

      for (const c of calibres ?? []) {
        const kg = Number(c.kg) || 0;
        const clase = c.clase ?? "Sin clase";
        const grupo = detectarTipoClasificacion(c.grupo_destino);
        const fecha = parteDateMap.get(c.part_id) ?? "";

        if (!clasesMap.has(clase)) {
          clasesMap.set(clase, { kg: 0, n_registros: 0, fechas: new Set(), grupos: new Map() });
        }
        const cl = clasesMap.get(clase)!;
        cl.kg += kg;
        cl.n_registros += 1;
        if (fecha) cl.fechas.add(fecha);
        cl.grupos.set(grupo, (cl.grupos.get(grupo) ?? 0) + kg);

        if (!gruposMap.has(grupo)) {
          gruposMap.set(grupo, { kg: 0, n_registros: 0, fechas: new Set() });
        }
        const gr = gruposMap.get(grupo)!;
        gr.kg += kg;
        gr.n_registros += 1;
        if (fecha) gr.fechas.add(fecha);
      }

      const kgCalibres = Array.from(clasesMap.values()).reduce((s, c) => s + c.kg, 0);

      const clases: ClaseResumen[] = Array.from(clasesMap.entries())
        .map(([clase, vals]) => ({
          clase,
          kg_total: vals.kg,
          n_registros: vals.n_registros,
          n_dias: vals.fechas.size,
          grupos: Object.fromEntries(vals.grupos),
        }))
        .sort((a, b) => b.kg_total - a.kg_total);

      const grupos: GrupoClasificacionResumen[] = Array.from(gruposMap.entries())
        .map(([grupo, vals]) => ({
          grupo,
          kg_total: vals.kg,
          n_registros: vals.n_registros,
          n_dias: vals.fechas.size,
        }))
        .sort((a, b) => b.kg_total - a.kg_total);

      // ── 3. Lotes desde lotes_dia ───────────────────────────────────────────
      const { data: lotesRaw, error: lErr } = await supabase
        .from("lotes_dia")
        .select("lote_codigo, productor, producto, kg_peso_total, toneladas_hora, duracion_min, peso_fruta_promedio_g, part_id")
        .in("part_id", partIds);

      if (lErr) {
        console.error("Error fetching lotes_dia:", lErr);
        setLoading(false);
        return;
      }

      const lotesAll: LoteResumen[] = (lotesRaw ?? []).map((l) => ({
        fecha: parteDateMap.get(l.part_id) ?? "—",
        lote_codigo: l.lote_codigo ?? "—",
        productor: l.productor ?? "—",
        producto: l.producto ?? "—",
        kg_peso_total: Number(l.kg_peso_total) || 0,
        toneladas_hora: l.toneladas_hora ? Number(l.toneladas_hora) : null,
        duracion_min: l.duracion_min ? Number(l.duracion_min) : null,
        peso_fruta_promedio_g: l.peso_fruta_promedio_g ? Number(l.peso_fruta_promedio_g) : null,
      }));

      const kg_lotes = lotesAll.reduce((s, l) => s + l.kg_peso_total, 0);
      const lotesConTph = lotesAll.filter((l) => l.toneladas_hora !== null && l.toneladas_hora > 0);
      const totalMin = lotesConTph.reduce((s, l) => s + (l.duracion_min ?? 0), 0);
      const totalHoras = totalMin / 60;
      // Usar exactamente 8 horas por día como base fija
      const avgTph = calcularTphOperativa(kg_lotes, diasSet.size);

      setData({
        totals: {
          n_dias: diasSet.size,
          n_lotes: lotesAll.length,
          kg_lotes,
          kg_calibres: kgCalibres,
          avg_tph: avgTph,
          total_min: totalMin,
          total_horas: totalHoras,
          n_lotes_lentos: lotesConTph.filter((l) => (l.toneladas_hora ?? 0) < 12.5).length,
        },
        lotes: lotesAll.sort((a, b) => b.fecha.localeCompare(a.fecha)),
        clases,
        grupos,
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

import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

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
  if (v.includes("exportac") || v.includes("export") || v.includes("ext")) return "Exportación";
  if (v.includes("mujer")) return "Mujeres";
  if (v.includes("no_exportac") || v.includes("no exportac") || v.includes("no export")) return "No exportación";
  if (v.includes("no_comerc") || v.includes("no comerc") || v.includes("industria") || v.includes("ind")) return "No comercial";
  if (v.includes("mercado") || v.includes("nac") || v.includes("interior") || v.includes("int")) return "Mercado";
  return valor;
}

export interface AnalisisDiarioData {
  totals: {
    n_dias: number;
    n_lotes: number;
    kg_lotes: number;
    kg_calibres: number;
  };
  lotes: LoteResumen[];
  clases: ClaseResumen[];
  grupos: GrupoClasificacionResumen[];
}

export function useAnalisisDiario(desde: string, hasta: string) {
  const [data, setData] = useState<AnalisisDiarioData>({
    totals: { n_dias: 0, n_lotes: 0, kg_lotes: 0, kg_calibres: 0 },
    lotes: [],
    clases: [],
    grupos: [],
  });
  const [loading, setLoading] = useState(false);

  async function fetchData() {
    setLoading(true);
    try {
      const { data: partes, error: pErr } = await supabase
        .from("partes_diarios")
        .select("id,date,user_id,resumen_ia")
        .gte("date", desde)
        .lte("date", hasta)
        .order("date", { ascending: false });

      if (pErr) {
        console.error("Error fetching partes:", pErr);
        setLoading(false);
        return;
      }

      const diasSet = new Set<string>();
      const lotesAll: (LoteResumen & { fecha: string })[] = [];

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

      for (const parte of partes ?? []) {
        const ia = parte.resumen_ia as any;
        const hasCalibres = Array.isArray(ia?.calibres_detalle) && ia.calibres_detalle.length > 0;
        const hasLotes = Array.isArray(ia?.lotes_detalle) && ia.lotes_detalle.length > 0;
        const hasIaData = ia && (hasCalibres || hasLotes);

        if (!hasIaData) continue;

        diasSet.add(parte.date);

        // ── Lotes ──────────────────────────────────────────────────────────
        if (Array.isArray(ia.lotes_detalle)) {
          for (const lote of ia.lotes_detalle) {
            lotesAll.push({
              fecha: parte.date,
              lote_codigo: lote.lote_codigo ?? "—",
              productor: lote.productor ?? "—",
              producto: lote.producto ?? "—",
              kg_peso_total: Number(lote.kg_peso_total) || 0,
              toneladas_hora: lote.toneladas_hora ? Number(lote.toneladas_hora) : null,
              duracion_min: lote.duracion_min ? Number(lote.duracion_min) : null,
              peso_fruta_promedio_g: lote.peso_fruta_promedio_g ? Number(lote.peso_fruta_promedio_g) : null,
            });
          }
        }

        // ── Calibres ──────────────────────────────────────────────────────
        if (Array.isArray(ia.calibres_detalle)) {
          for (const c of ia.calibres_detalle) {
            const kg = Number(c.kg) || 0;
            const clase = c.clase ?? "Sin clase";
            const grupo = detectarTipoClasificacion(c.grupo_destino);

            if (!clasesMap.has(clase)) {
              clasesMap.set(clase, { kg: 0, n_registros: 0, fechas: new Set(), grupos: new Map() });
            }
            const cl = clasesMap.get(clase)!;
            cl.kg += kg;
            cl.n_registros += 1;
            cl.fechas.add(parte.date);
            cl.grupos.set(grupo, (cl.grupos.get(grupo) ?? 0) + kg);

            if (!gruposMap.has(grupo)) {
              gruposMap.set(grupo, { kg: 0, n_registros: 0, fechas: new Set() });
            }
            const gr = gruposMap.get(grupo)!;
            gr.kg += kg;
            gr.n_registros += 1;
            gr.fechas.add(parte.date);
          }
        }
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

      const kg_lotes = lotesAll.reduce((s, l) => s + l.kg_peso_total, 0);

      setData({
        totals: {
          n_dias: diasSet.size,
          n_lotes: lotesAll.length,
          kg_lotes,
          kg_calibres: kgCalibres,
        },
        lotes: lotesAll.sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime()),
        clases,
        grupos,
      });
    } catch (e) {
      console.error("useAnalisisDiario error:", e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchData();
  }, [desde, hasta]);

  return { data, loading, refetch: fetchData };
}

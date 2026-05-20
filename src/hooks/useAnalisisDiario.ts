/**
 * useAnalisisDiario.ts — Hook para Análisis Diario
 *
 * Lee datos de resumen_ia (almacenado en partes_diarios) en lugar de
 * tablas separadas lotes_dia / palets_dia / producto_dia.
 *
 * Estructura:
 *   partes_diarios.resumen_ia = {
 *     lotes_detalle: [{lote_codigo, productor, kg, t_h, ...}],
 *     palets_detalle: [{palet_id, producto, cliente, kg_neto, ...}],
 *     producto_detalle: [{producto, kg, grupo_destino, ...}],
 *     calibres_detalle: [{calibre, kg, pct, ...}],
 *     ...
 *   }
 */

import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface ProveedorResumen {
  productor: string;
  kg_total: number;
  n_lotes: number;
  n_dias: number;
  tph_avg: number | null;
  peso_fruta_avg_g: number | null;
  fechas: string[];
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
}

export interface ProductoResumen {
  producto: string;
  kg_total: number;
  n_lineas: number;
  n_dias: number;
  grupo_destino: string | null;
  formatos: string[];
}

export interface ClienteResumen {
  cliente: string;
  n_palets: number;
  kg_total: number;
  n_dias: number;
  productos: string[];
  destinos: string[];
}

export interface AnalisisDiarioData {
  totals: {
    n_dias: number;
    n_proveedores: number;
    n_lotes: number;
    kg_lotes: number;
    n_palets: number;
    kg_palets: number;
    n_clientes: number;
    kg_producto: number;
  };
  proveedores: ProveedorResumen[];
  lotes: LoteResumen[];
  productos: ProductoResumen[];
  clientes: ClienteResumen[];
}

export function useAnalisisDiario(desde: string, hasta: string) {
  const [data, setData] = useState<AnalisisDiarioData>({
    totals: {
      n_dias: 0, n_proveedores: 0, n_lotes: 0, kg_lotes: 0,
      n_palets: 0, kg_palets: 0, n_clientes: 0, kg_producto: 0,
    },
    proveedores: [],
    lotes: [],
    productos: [],
    clientes: [],
  });
  const [loading, setLoading] = useState(false);

  async function fetchData() {
    setLoading(true);
    try {
      // ── 1. Obtener todos los partes en el rango ────────────────────────────
      const { data: partes, error: pErr } = await supabase
        .from("partes_diarios")
        .select("id,date,user_id,resumen_ia,kg_produccion_calibrador,kg_palets_brutos,kg_mujeres_calibrador,kg_podrido_calibrador_auto")
        .gte("date", desde)
        .lte("date", hasta)
        .order("date", { ascending: false });

      if (pErr) {
        console.error("Error fetching partes:", pErr);
        setLoading(false);
        return;
      }

      // ── 2. Extraer datos de resumen_ia ────────────────────────────────────
      const proveedoresMap = new Map<string, {
        kg: number;
        n_lotes: number;
        fechas: Set<string>;
        t_hs: number[];
        pesos: number[];
      }>();

      const lotesAll: (LoteResumen & { fecha: string })[] = [];
      const productosMap = new Map<string, {
        kg: number;
        n_lineas: number;
        fechas: Set<string>;
        formatos: Set<string>;
        grupo_destino: string | null;
      }>();

      const clientesMap = new Map<string, {
        n_palets: number;
        kg: number;
        fechas: Set<string>;
        productos: Set<string>;
        destinos: Set<string>;
      }>();

      const diasSet = new Set<string>();

      for (const parte of partes ?? []) {
        const ia = parte.resumen_ia as any;
        const hasLotes = Array.isArray(ia?.lotes_detalle) && ia.lotes_detalle.length > 0;
        const hasPalets = Array.isArray(ia?.palets_detalle) && ia.palets_detalle.length > 0;
        const hasProductos = (Array.isArray(ia?.producto_detalle) && ia.producto_detalle.length > 0) ||
          (Array.isArray(ia?.palets_detalle) && ia.palets_detalle.some((p: any) => p.producto));
        const hasCalibres = Array.isArray(ia?.calibres_detalle) && ia.calibres_detalle.length > 0;
        const hasIaData = ia && (hasLotes || hasPalets || hasProductos || hasCalibres);

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

            // Agregar a proveedores
            const key = lote.productor ?? "—";
            if (!proveedoresMap.has(key)) {
              proveedoresMap.set(key, { kg: 0, n_lotes: 0, fechas: new Set(), t_hs: [], pesos: [] });
            }
            const p = proveedoresMap.get(key)!;
            p.kg += Number(lote.kg_peso_total) || 0;
            p.n_lotes += 1;
            p.fechas.add(parte.date);
            if (lote.toneladas_hora) p.t_hs.push(Number(lote.toneladas_hora));
            if (lote.peso_fruta_promedio_g) p.pesos.push(Number(lote.peso_fruta_promedio_g));
          }
        }

        // ── Palets ────────────────────────────────────────────────────────
        if (Array.isArray(ia.palets_detalle)) {
          for (const palet of ia.palets_detalle) {
            const cliente = palet.cliente ?? "Sin cliente";
            if (!clientesMap.has(cliente)) {
              clientesMap.set(cliente, { n_palets: 0, kg: 0, fechas: new Set(), productos: new Set(), destinos: new Set() });
            }
            const c = clientesMap.get(cliente)!;
            c.n_palets += 1;
            c.kg += Number(palet.kg_neto) || 0;
            c.fechas.add(parte.date);
            if (palet.producto) c.productos.add(String(palet.producto));
            if (palet.destino) c.destinos.add(String(palet.destino));
          }
        }

        // ── Productos (desde denominacion_producto de los palets) ──────────
        if (Array.isArray(ia.palets_detalle)) {
          for (const palet of ia.palets_detalle) {
            if (!palet.producto) continue;
            const pkey = palet.producto;
            if (!productosMap.has(pkey)) {
              productosMap.set(pkey, { kg: 0, n_lineas: 0, fechas: new Set(), formatos: new Set(), grupo_destino: null });
            }
            const p = productosMap.get(pkey)!;
            p.kg += Number(palet.kg_neto) || 0;
            p.n_lineas += 1;
            p.fechas.add(parte.date);
          }
        }
      }

      // ── 3. Construir arrays finales ────────────────────────────────────────
      const proveedores: ProveedorResumen[] = Array.from(proveedoresMap.entries()).map(
        ([productor, vals]) => ({
          productor,
          kg_total: vals.kg,
          n_lotes: vals.n_lotes,
          n_dias: vals.fechas.size,
          tph_avg: vals.t_hs.length > 0 ? vals.t_hs.reduce((a, b) => a + b, 0) / vals.t_hs.length : null,
          peso_fruta_avg_g: vals.pesos.length > 0 ? vals.pesos.reduce((a, b) => a + b, 0) / vals.pesos.length : null,
          fechas: Array.from(vals.fechas).sort(),
        })
      );

      const productos: ProductoResumen[] = Array.from(productosMap.entries()).map(
        ([producto, vals]) => ({
          producto,
          kg_total: vals.kg,
          n_lineas: vals.n_lineas,
          n_dias: vals.fechas.size,
          grupo_destino: vals.grupo_destino,
          formatos: Array.from(vals.formatos),
        })
      );

      const clientes: ClienteResumen[] = Array.from(clientesMap.entries()).map(
        ([cliente, vals]) => ({
          cliente,
          n_palets: vals.n_palets,
          kg_total: vals.kg,
          n_dias: vals.fechas.size,
          productos: Array.from(vals.productos),
          destinos: Array.from(vals.destinos),
        })
      );

      // Calcular totales
      const kg_lotes = Array.from(proveedoresMap.values()).reduce((s, p) => s + p.kg, 0);
      const kg_palets = Array.from(clientesMap.values()).reduce((s, c) => s + c.kg, 0);
      const kg_producto = Array.from(productosMap.values()).reduce((s, p) => s + p.kg, 0);

      setData({
        totals: {
          n_dias: diasSet.size,
          n_proveedores: proveedoresMap.size,
          n_lotes: lotesAll.length,
          kg_lotes,
          n_palets: Array.from(clientesMap.values()).reduce((s, c) => s + c.n_palets, 0),
          kg_palets,
          n_clientes: clientesMap.size,
          kg_producto,
        },
        proveedores: proveedores.sort((a, b) => b.kg_total - a.kg_total),
        lotes: lotesAll.sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime()),
        productos: productos.sort((a, b) => b.kg_total - a.kg_total),
        clientes: clientes.sort((a, b) => b.kg_total - a.kg_total),
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

/**
 * useAnalisisDiario.ts
 *
 * Hook que consulta las tablas de detalle (lotes_dia, palets_dia, producto_dia)
 * para un rango de fechas. Incluye la fecha del parte en cada fila para dar
 * contexto temporal claro.
 */
import { useEffect, useMemo, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

// ─── Tipos de fila cruda (con fecha del parte) ─────────────────────────────

export interface LoteRow {
  id: string;
  part_id: string;
  fecha: string; // date del parte
  lote_codigo: string | null;
  productor: string | null;
  producto: string | null;
  kg_peso_total: number;
  toneladas_hora: number | null;
  duracion_min: number | null;
  peso_fruta_promedio_g: number | null;
  hora_inicio: string | null;
  source: string;
}

export interface PaletRow {
  id: string;
  part_id: string;
  fecha: string;
  palet_id: string | null;
  producto: string | null;
  cliente: string | null;
  destino: string | null;
  kg_neto: number;
  situacion: string | null;
  n_cajas: number | null;
  source: string;
}

export interface ProductoRow {
  id: string;
  part_id: string;
  fecha: string;
  linea: string | null;
  producto: string | null;
  formato_caja: string | null;
  kg: number;
  n_cajas: number | null;
  grupo_destino: string | null;
  source: string;
}

// ─── Tipos de resumen agrupado ──────────────────────────────────────────────

export interface ProveedorResumen {
  productor: string;
  kg_total: number;
  n_lotes: number;
  n_dias: number;
  fechas: string[];
  tph_avg: number | null;
  peso_fruta_avg_g: number | null;
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
  hora_inicio: string | null;
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
  proveedores: ProveedorResumen[];
  lotes: LoteResumen[];
  productos: ProductoResumen[];
  clientes: ClienteResumen[];
  totals: {
    kg_lotes: number;
    kg_palets: number;
    kg_producto: number;
    n_lotes: number;
    n_palets: number;
    n_proveedores: number;
    n_clientes: number;
    n_dias: number;
  };
}

// ─── Hook principal ─────────────────────────────────────────────────────────

export function useAnalisisDiario(desde: string, hasta: string) {
  const [lotes, setLotes] = useState<LoteRow[]>([]);
  const [palets, setPalets] = useState<PaletRow[]>([]);
  const [productos, setProductos] = useState<ProductoRow[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);

    // Obtener partes en el rango con su fecha
    const { data: partes, error: pErr } = await supabase
      .from("partes_diarios")
      .select("id, date")
      .gte("date", desde)
      .lte("date", hasta);

    if (pErr) {
      toast({ title: "Error cargando partes", description: pErr.message, variant: "destructive" });
      setLoading(false);
      return;
    }

    const partesArr = partes ?? [];
    if (partesArr.length === 0) {
      setLotes([]);
      setPalets([]);
      setProductos([]);
      setLoading(false);
      return;
    }

    const partIds = partesArr.map((p) => p.id);
    const dateMap: Record<string, string> = {};
    for (const p of partesArr) dateMap[p.id] = p.date;

    // Fetch en paralelo
    const [lotesRes, paletsRes, productosRes] = await Promise.all([
      supabase.from("lotes_dia").select("*").in("part_id", partIds),
      supabase.from("palets_dia").select("*").in("part_id", partIds),
      supabase.from("producto_dia").select("*").in("part_id", partIds),
    ]);

    if (lotesRes.error) {
      toast({ title: "Error lotes_dia", description: lotesRes.error.message, variant: "destructive" });
    }
    if (paletsRes.error) {
      toast({ title: "Error palets_dia", description: paletsRes.error.message, variant: "destructive" });
    }
    if (productosRes.error) {
      toast({ title: "Error producto_dia", description: productosRes.error.message, variant: "destructive" });
    }

    // Enriquecer con fecha
    setLotes((lotesRes.data ?? []).map((r: any) => ({ ...r, fecha: dateMap[r.part_id] ?? "—" })));
    setPalets((paletsRes.data ?? []).map((r: any) => ({ ...r, fecha: dateMap[r.part_id] ?? "—" })));
    setProductos((productosRes.data ?? []).map((r: any) => ({ ...r, fecha: dateMap[r.part_id] ?? "—" })));
    setLoading(false);
  }, [desde, hasta]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // ── Computar resúmenes agrupados ────────────────────────────────────────

  const data = useMemo<AnalisisDiarioData>(() => {
    // Proveedores (agrupados desde lotes)
    const mapProv: Record<string, { kg: number; n: number; fechas: Set<string>; tphs: number[]; pesos: number[] }> = {};
    for (const l of lotes) {
      const key = l.productor ?? "Sin productor";
      if (!mapProv[key]) mapProv[key] = { kg: 0, n: 0, fechas: new Set(), tphs: [], pesos: [] };
      mapProv[key].kg += l.kg_peso_total;
      mapProv[key].n += 1;
      mapProv[key].fechas.add(l.fecha);
      if (l.toneladas_hora && l.toneladas_hora > 0) mapProv[key].tphs.push(l.toneladas_hora);
      if (l.peso_fruta_promedio_g && l.peso_fruta_promedio_g > 0) mapProv[key].pesos.push(l.peso_fruta_promedio_g);
    }
    const proveedores: ProveedorResumen[] = Object.entries(mapProv)
      .map(([productor, d]) => ({
        productor,
        kg_total: d.kg,
        n_lotes: d.n,
        n_dias: d.fechas.size,
        fechas: Array.from(d.fechas).sort(),
        tph_avg: d.tphs.length > 0 ? d.tphs.reduce((a, b) => a + b, 0) / d.tphs.length : null,
        peso_fruta_avg_g: d.pesos.length > 0 ? d.pesos.reduce((a, b) => a + b, 0) / d.pesos.length : null,
      }))
      .sort((a, b) => b.kg_total - a.kg_total);

    // Lotes (lista plana con fecha, ordenados por fecha desc)
    const lotesResumen: LoteResumen[] = lotes.map((l) => ({
      fecha: l.fecha,
      lote_codigo: l.lote_codigo ?? "—",
      productor: l.productor ?? "—",
      producto: l.producto ?? "—",
      kg_peso_total: l.kg_peso_total,
      toneladas_hora: l.toneladas_hora,
      duracion_min: l.duracion_min,
      peso_fruta_promedio_g: l.peso_fruta_promedio_g,
      hora_inicio: l.hora_inicio,
    })).sort((a, b) => b.fecha.localeCompare(a.fecha) || b.kg_peso_total - a.kg_peso_total);

    // Productos (agrupados)
    const mapProd: Record<string, { kg: number; n: number; fechas: Set<string>; grupo: string | null; formatos: Set<string> }> = {};
    for (const p of productos) {
      const key = p.producto ?? "Sin producto";
      if (!mapProd[key]) mapProd[key] = { kg: 0, n: 0, fechas: new Set(), grupo: p.grupo_destino, formatos: new Set() };
      mapProd[key].kg += p.kg;
      mapProd[key].n += 1;
      mapProd[key].fechas.add(p.fecha);
      if (p.formato_caja) mapProd[key].formatos.add(p.formato_caja);
    }
    const productosResumen: ProductoResumen[] = Object.entries(mapProd)
      .map(([producto, d]) => ({
        producto,
        kg_total: d.kg,
        n_lineas: d.n,
        n_dias: d.fechas.size,
        grupo_destino: d.grupo,
        formatos: Array.from(d.formatos),
      }))
      .sort((a, b) => b.kg_total - a.kg_total);

    // Clientes (agrupados desde palets)
    const mapCli: Record<string, { n: number; kg: number; fechas: Set<string>; productos: Set<string>; destinos: Set<string> }> = {};
    for (const p of palets) {
      const key = p.cliente ?? "Sin cliente";
      if (!mapCli[key]) mapCli[key] = { n: 0, kg: 0, fechas: new Set(), productos: new Set(), destinos: new Set() };
      mapCli[key].n += 1;
      mapCli[key].kg += p.kg_neto;
      mapCli[key].fechas.add(p.fecha);
      if (p.producto) mapCli[key].productos.add(p.producto);
      if (p.destino) mapCli[key].destinos.add(p.destino);
    }
    const clientes: ClienteResumen[] = Object.entries(mapCli)
      .map(([cliente, d]) => ({
        cliente,
        n_palets: d.n,
        kg_total: d.kg,
        n_dias: d.fechas.size,
        productos: Array.from(d.productos),
        destinos: Array.from(d.destinos),
      }))
      .sort((a, b) => b.kg_total - a.kg_total);

    // Días únicos
    const allFechas = new Set<string>();
    lotes.forEach((l) => allFechas.add(l.fecha));
    palets.forEach((p) => allFechas.add(p.fecha));
    productos.forEach((p) => allFechas.add(p.fecha));

    const totals = {
      kg_lotes: lotes.reduce((s, l) => s + l.kg_peso_total, 0),
      kg_palets: palets.reduce((s, p) => s + p.kg_neto, 0),
      kg_producto: productos.reduce((s, p) => s + p.kg, 0),
      n_lotes: lotes.length,
      n_palets: palets.length,
      n_proveedores: proveedores.length,
      n_clientes: clientes.length,
      n_dias: allFechas.size,
    };

    return { proveedores, lotes: lotesResumen, productos: productosResumen, clientes, totals };
  }, [lotes, palets, productos]);

  return { data, loading, refetch: fetchData };
}

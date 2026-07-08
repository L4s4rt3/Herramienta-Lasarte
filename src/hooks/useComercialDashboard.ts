/**
 * useComercialDashboard — agrega los datos del "Panel comercial" (portada del
 * espacio Comercial): último resumen de ventas de Mercadona (vendido,
 * cumplimiento, €/kg medio si hay base_iva) + evolución semanal, kg/importe
 * del periodo de las dos categorías de venta ("Categoria segunda"/"Categoria
 * primera", ver useVentasCategoria) y el ranking de clientes por kg expedido
 * en el último mes.
 *
 * El ranking de clientes se calcula sobre palets_dia (mismo patrón de
 * "fecha vía part_id -> partes_diarios.date" + fetch en chunks de IN que usa
 * useMercadonaExpediciones.ts), pero SIN restringir a Mercadona ni aplicar su
 * reparación de cliente vacío: aquí interesan TODOS los clientes con nombre,
 * agrupados en cliente, en una única query al rango completo del último mes
 * (no una consulta por cliente).
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthProvider";
import { supabase } from "@/integrations/supabase/client";
import { toError } from "@/lib/errorMessage";
import { toISODateLocal, today } from "@/lib/format";
import { useMercadonaVentas, type MercadonaSemanaConMetodos } from "@/hooks/useMercadonaVentas";
import { useVentasCategoria } from "@/hooks/useVentasCategoria";

const IN_CHUNK_SIZE = 200;
/** Ventana rodante del "último mes" para el ranking de clientes por kg. */
const TOP_CLIENTES_RANGE_DAYS = 30;
const TOP_CLIENTES_LIMIT = 8;

interface PaletClienteRow {
  part_id: string;
  cliente: string | null;
  kg_neto: number;
  n_cajas: number | null;
}

export interface ComercialClienteResumen {
  cliente: string;
  kg: number;
  palets: number;
  cajas: number;
}

export interface ComercialEvolucionSemana {
  label: string;
  vendido: number;
  planificado: number;
}

export interface ComercialCategoriaResumen {
  hasAccess: boolean;
  isLoading: boolean;
  kg: number;
  baseIva: number;
}

async function fetchPartIdsEnRango(desde: string, hasta: string): Promise<string[]> {
  const { data, error } = await supabase
    .from("partes_diarios")
    .select("id")
    .gte("date", desde)
    .lte("date", hasta);
  if (error) throw toError(error);
  return (data ?? []).map((p) => p.id as string);
}

async function fetchPaletsEnChunks(partIds: string[]): Promise<PaletClienteRow[]> {
  const rows: PaletClienteRow[] = [];
  for (let i = 0; i < partIds.length; i += IN_CHUNK_SIZE) {
    const chunk = partIds.slice(i, i + IN_CHUNK_SIZE);
    const { data, error } = await supabase
      .from("palets_dia")
      .select("part_id, cliente, kg_neto, n_cajas")
      .in("part_id", chunk)
      .limit(100000);
    if (error) throw toError(error);
    rows.push(...((data ?? []) as PaletClienteRow[]));
  }
  return rows;
}

export function useComercialDashboard() {
  const { user } = useAuth();

  // ─── Mercadona: última semana + evolución (una sola query, ver useMercadonaVentas) ─
  const ventas = useMercadonaVentas();
  const semanas = ventas.semanas;
  const ultimaSemana: MercadonaSemanaConMetodos | null = semanas.length > 0 ? semanas[semanas.length - 1] : null;

  const mercadonaKpis = useMemo(() => {
    if (!ultimaSemana) {
      return { vendidoKg: 0, planificadoKg: 0, pctCumplimiento: 0, eurosPorKg: 0, tieneBaseIva: false };
    }
    const vendido = ultimaSemana.vendido_kg ?? 0;
    const planificado = ultimaSemana.planificado_semana_kg ?? 0;
    const pctCumplimiento = planificado > 0 ? (vendido / planificado) * 100 : 0;
    const tieneBaseIva = ultimaSemana.metodos.some((m) => m.base_iva != null) || ultimaSemana.ajustes_base_iva != null;
    const facturacionMetodos = ultimaSemana.metodos.reduce((s, m) => s + (m.base_iva ?? 0), 0);
    const facturacionTotal = facturacionMetodos + (ultimaSemana.ajustes_base_iva ?? 0);
    const eurosPorKg = vendido > 0 ? facturacionTotal / vendido : 0;
    return { vendidoKg: vendido, planificadoKg: planificado, pctCumplimiento, eurosPorKg, tieneBaseIva };
  }, [ultimaSemana]);

  const evolucionSemanal: ComercialEvolucionSemana[] = useMemo(
    () => semanas.map((s) => ({ label: `S${s.semana}`, vendido: s.vendido_kg ?? 0, planificado: s.planificado_semana_kg ?? 0 })),
    [semanas],
  );

  // ─── Ventas por categoría (kg/importe del periodo) ───────────────────────
  const categoriaSegundaHook = useVentasCategoria("Categoria segunda");
  const categoriaPrimeraHook = useVentasCategoria("Categoria primera");

  const categoriaSegunda: ComercialCategoriaResumen = {
    hasAccess: categoriaSegundaHook.hasAccess,
    isLoading: categoriaSegundaHook.resumenQuery.isLoading,
    kg: categoriaSegundaHook.resumenQuery.data?.kilos ?? 0,
    baseIva: categoriaSegundaHook.resumenQuery.data?.base_iva ?? 0,
  };
  const categoriaPrimera: ComercialCategoriaResumen = {
    hasAccess: categoriaPrimeraHook.hasAccess,
    isLoading: categoriaPrimeraHook.resumenQuery.isLoading,
    kg: categoriaPrimeraHook.resumenQuery.data?.kilos ?? 0,
    baseIva: categoriaPrimeraHook.resumenQuery.data?.base_iva ?? 0,
  };

  // ─── Top clientes por kg (palets_dia, último mes) — una sola query al rango ─
  const hasta = today();
  const desde = useMemo(
    () => toISODateLocal(new Date(Date.now() - TOP_CLIENTES_RANGE_DAYS * 24 * 60 * 60 * 1000)),
    [hasta],
  );

  const clientesQuery = useQuery({
    queryKey: ["comercial-dashboard", "top-clientes", desde, hasta],
    queryFn: async (): Promise<PaletClienteRow[]> => {
      const partIds = await fetchPartIdsEnRango(desde, hasta);
      if (partIds.length === 0) return [];
      return fetchPaletsEnChunks(partIds);
    },
    enabled: Boolean(user),
  });

  const { topClientes, totalClientesActivos } = useMemo(() => {
    const porCliente = new Map<string, { kg: number; palets: number; cajas: number }>();
    for (const p of clientesQuery.data ?? []) {
      const nombre = (p.cliente ?? "").trim();
      if (!nombre) continue;
      const entry = porCliente.get(nombre) ?? { kg: 0, palets: 0, cajas: 0 };
      entry.kg += Number(p.kg_neto) || 0;
      entry.palets += 1;
      entry.cajas += Number(p.n_cajas) || 0;
      porCliente.set(nombre, entry);
    }
    const ordenados: ComercialClienteResumen[] = Array.from(porCliente.entries())
      .map(([cliente, v]) => ({ cliente, ...v }))
      .sort((a, b) => b.kg - a.kg);
    return { topClientes: ordenados.slice(0, TOP_CLIENTES_LIMIT), totalClientesActivos: ordenados.length };
  }, [clientesQuery.data]);

  const isLoading =
    ventas.isLoading ||
    categoriaSegundaHook.resumenQuery.isLoading ||
    categoriaPrimeraHook.resumenQuery.isLoading ||
    clientesQuery.isLoading;

  const hasError = Boolean(clientesQuery.error);

  return {
    isLoading,
    hasError,

    // Mercadona
    tablesMissing: ventas.tablesMissing,
    ultimaSemana,
    ...mercadonaKpis,
    evolucionSemanal,

    // Ventas por categoría
    categoriaSegunda,
    categoriaPrimera,

    // Clientes
    topClientes,
    totalClientesActivos,
    clientesRango: { desde, hasta },
  };
}

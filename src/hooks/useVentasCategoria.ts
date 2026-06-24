import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthProvider";
import { supabase } from "@/integrations/supabase/client";
import { toError } from "@/lib/errorMessage";
import type {
  ParseVentasCategoriaWorkbookResult,
  VentasCategoriaDetalleFilters,
  VentasCategoriaLinea,
} from "@/lib/ventasCategoria";
import { buildVentasCategoriaFilterOptions } from "@/lib/ventasCategoria";
import type {
  VentasCategoriaClienteAjusteRow,
  VentasCategoriaLineaRow,
  VentasCategoriaProductoRow,
  VentasCategoriaRow,
} from "@/lib/types";

export interface VentasCategoriaDetalleOptions {
  filters: VentasCategoriaDetalleFilters;
  page: number;
  pageSize: number;
  enabled?: boolean;
}

export interface VentasCategoriaAjusteInput {
  cliente_codigo: string;
  cliente_nombre: string;
  comision_pct: number;
  comision_cent_kg: number;
  transporte_pct: number;
  transporte_cent_kg: number;
}

export function useVentasCategoriaAccess() {
  const { user, role } = useAuth();
  const baseKey = ["ventas-categoria"] as const;

  const accessQuery = useQuery({
    queryKey: [...baseKey, "access", user?.email, role],
    queryFn: async () => {
      if (role === "admin") return true;
      const { data, error } = await supabase.rpc("can_access_ventas_categoria");
      if (error) throw toError(error);
      return Boolean(data);
    },
    enabled: Boolean(user),
  });

  const hasAccess = role === "admin" || accessQuery.data === true;

  return {
    accessQuery,
    hasAccess,
    isLoading: accessQuery.isLoading,
    role,
    isAdmin: role === "admin",
  };
}

export function useVentasCategoria() {
  const { user, role } = useAuth();
  const queryClient = useQueryClient();
  const baseKey = ["ventas-categoria"] as const;
  const access = useVentasCategoriaAccess();
  const hasAccess = access.hasAccess;

  const categoriasQuery = useQuery({
    queryKey: [...baseKey, "categorias"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ventas_categorias")
        .select("*")
        .order("nombre");
      if (error) throw toError(error);
      return (data ?? []) as VentasCategoriaRow[];
    },
    enabled: Boolean(user && hasAccess),
  });

  const categoria = useMemo(
    () => categoriasQuery.data?.find((row) => normalizeName(row.nombre) === "categoria-segunda") ?? categoriasQuery.data?.[0] ?? null,
    [categoriasQuery.data],
  );
  const categoriaId = categoria?.id ?? null;

  const resumenQuery = useQuery({
    queryKey: [...baseKey, categoriaId, "resumen"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ventas_categoria_resumen")
        .select("*")
        .eq("categoria_id", categoriaId)
        .maybeSingle();
      if (error) throw toError(error);
      return data;
    },
    enabled: Boolean(user && categoriaId && hasAccess),
  });

  const mensualClienteQuery = useQuery({
    queryKey: [...baseKey, categoriaId, "mensual-cliente"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ventas_categoria_mensual_cliente")
        .select("*")
        .eq("categoria_id", categoriaId)
        .order("mes", { ascending: true });
      if (error) throw toError(error);
      return data ?? [];
    },
    enabled: Boolean(user && categoriaId && hasAccess),
  });

  const mensualProductoQuery = useQuery({
    queryKey: [...baseKey, categoriaId, "mensual-producto"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ventas_categoria_mensual_producto")
        .select("*")
        .eq("categoria_id", categoriaId)
        .order("mes", { ascending: true });
      if (error) throw toError(error);
      return data ?? [];
    },
    enabled: Boolean(user && categoriaId && hasAccess),
  });

  const rankingClientesQuery = useQuery({
    queryKey: [...baseKey, categoriaId, "ranking-clientes"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ventas_categoria_ranking_clientes")
        .select("*")
        .eq("categoria_id", categoriaId)
        .order("kilos", { ascending: false });
      if (error) throw toError(error);
      return data ?? [];
    },
    enabled: Boolean(user && categoriaId && hasAccess),
  });

  const articulosQuery = useQuery({
    queryKey: [...baseKey, categoriaId, "articulos"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ventas_categoria_resumen_articulo")
        .select("*")
        .eq("categoria_id", categoriaId)
        .order("kilos", { ascending: false })
        .limit(2000);
      if (error) throw toError(error);
      return data ?? [];
    },
    enabled: Boolean(user && categoriaId && hasAccess),
  });

  const catalogoQuery = useQuery({
    queryKey: [...baseKey, categoriaId, "catalogo"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ventas_categoria_productos")
        .select("*")
        .eq("categoria_id", categoriaId)
        .order("kilos", { ascending: false });
      if (error) throw toError(error);
      return (data ?? []) as VentasCategoriaProductoRow[];
    },
    enabled: Boolean(user && categoriaId && hasAccess),
  });

  const ajustesQuery = useQuery({
    queryKey: [...baseKey, categoriaId, "ajustes"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ventas_categoria_clientes_ajustes")
        .select("*")
        .eq("categoria_id", categoriaId)
        .order("cliente_nombre");
      if (error) throw toError(error);
      return (data ?? []) as VentasCategoriaClienteAjusteRow[];
    },
    enabled: Boolean(user && categoriaId && hasAccess),
  });

  const validacionQuery = useQuery({
    queryKey: [...baseKey, categoriaId, "validacion"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ventas_categoria_validacion_catalogo")
        .select("*")
        .eq("categoria_id", categoriaId)
        .order("kilos_catalogo", { ascending: false });
      if (error) throw toError(error);
      return data ?? [];
    },
    enabled: Boolean(user && categoriaId && hasAccess),
  });

  const filterOptionsQuery = useQuery({
    queryKey: [...baseKey, categoriaId, "filter-options"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ventas_categoria_lineas")
        .select("campana, mes, cliente_codigo, cliente_nombre, metodo_producto, kilos")
        .eq("categoria_id", categoriaId)
        .range(0, 19999);
      if (error) throw toError(error);
      return buildVentasCategoriaFilterOptions(data ?? []);
    },
    enabled: Boolean(user && categoriaId && hasAccess),
    staleTime: 5 * 60 * 1000,
  });

  const updateAjuste = useMutation({
    mutationFn: async (input: VentasCategoriaAjusteInput) => {
      if (!categoriaId || !hasAccess) throw new Error("No tienes acceso a esta seccion.");
      const { error } = await supabase
        .from("ventas_categoria_clientes_ajustes")
        .upsert({
          categoria_id: categoriaId,
          ...input,
        }, { onConflict: "categoria_id,cliente_codigo" });
      if (error) throw toError(error);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: baseKey });
    },
  });

  const importWorkbook = useMutation({
    mutationFn: async (parsed: ParseVentasCategoriaWorkbookResult) => {
      if (!categoriaId || !hasAccess) throw new Error("No tienes acceso a esta seccion.");
      if (parsed.lineas.length === 0) throw new Error("El Excel no contiene lineas diarias importables.");
      if (parsed.catalogo.length === 0) throw new Error("El Excel no contiene catalogo de productos importable.");

      const { error: deleteLineasError } = await supabase
        .from("ventas_categoria_lineas")
        .delete()
        .eq("categoria_id", categoriaId);
      if (deleteLineasError) throw toError(deleteLineasError);

      const { error: deleteProductosError } = await supabase
        .from("ventas_categoria_productos")
        .delete()
        .eq("categoria_id", categoriaId);
      if (deleteProductosError) throw toError(deleteProductosError);

      await insertInChunks("ventas_categoria_productos", parsed.catalogo.map((row) => ({
        categoria_id: categoriaId,
        metodo: row.metodo,
        descripcion: row.descripcion,
        lineas: row.lineas,
        kilos: row.kilos,
        base_iva: row.base_iva,
      })));

      await insertInChunks("ventas_categoria_lineas", parsed.lineas.map((row) => toLineaInsert(categoriaId, row)));

      const clientes = Array.from(new Map(parsed.lineas.map((row) => [
        row.cliente_codigo,
        {
          categoria_id: categoriaId,
          cliente_codigo: row.cliente_codigo,
          cliente_nombre: row.cliente_nombre,
          comision_pct: 0,
          comision_cent_kg: 0,
          transporte_pct: 0,
          transporte_cent_kg: 0,
        },
      ])).values());

      await upsertInChunks("ventas_categoria_clientes_ajustes", clientes, "categoria_id,cliente_codigo");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: baseKey });
    },
  });

  return {
    categoria,
    categoriaId,
    accessQuery: access.accessQuery,
    hasAccess,
    role,
    isAdmin: role === "admin",
    categoriasQuery,
    resumenQuery,
    mensualClienteQuery,
    mensualProductoQuery,
    rankingClientesQuery,
    articulosQuery,
    catalogoQuery,
    ajustesQuery,
    validacionQuery,
    filterOptionsQuery,
    updateAjuste,
    importWorkbook,
  };
}

export function useVentasCategoriaDetalle(categoriaId: string | null, options: VentasCategoriaDetalleOptions) {
  const { user } = useAuth();
  const from = options.page * options.pageSize;
  const to = from + options.pageSize - 1;

  return useQuery({
    queryKey: ["ventas-categoria", categoriaId, "detalle", options.filters, options.page, options.pageSize],
    queryFn: async () => {
      let query = supabase
        .from("ventas_categoria_lineas")
        .select("*", { count: "exact" })
        .eq("categoria_id", categoriaId)
        .order("fecha", { ascending: false })
        .range(from, to);

      if (options.filters.campana) query = query.eq("campana", options.filters.campana);
      if (options.filters.mes) query = query.eq("mes", options.filters.mes);
      if (options.filters.cliente) query = query.eq("cliente_codigo", options.filters.cliente);
      if (options.filters.metodo) query = query.eq("metodo_producto", options.filters.metodo);
      if (options.filters.articulo) query = query.ilike("articulo", `%${options.filters.articulo}%`);

      const { data, error, count } = await query;
      if (error) throw toError(error);
      return {
        rows: (data ?? []) as VentasCategoriaLineaRow[],
        count: count ?? 0,
      };
    },
    enabled: Boolean(user && categoriaId && options.enabled),
  });
}

function toLineaInsert(categoriaId: string, row: VentasCategoriaLinea) {
  return {
    categoria_id: categoriaId,
    fecha: row.fecha,
    campana: row.campana,
    mes: row.mes,
    cliente_codigo: row.cliente_codigo,
    cliente_nombre: row.cliente_nombre,
    referencia: row.referencia,
    articulo: row.articulo,
    metodo_producto: row.metodo_producto,
    kilos: row.kilos,
    pvp: row.pvp,
    base_iva: row.base_iva,
    pm_venta: row.pm_venta,
  };
}

async function insertInChunks(table: "ventas_categoria_productos" | "ventas_categoria_lineas", rows: Record<string, unknown>[]) {
  for (let index = 0; index < rows.length; index += 500) {
    const chunk = rows.slice(index, index + 500);
    const { error } = await supabase.from(table).insert(chunk as never[]);
    if (error) throw toError(error);
  }
}

async function upsertInChunks(table: "ventas_categoria_clientes_ajustes", rows: Record<string, unknown>[], onConflict: string) {
  for (let index = 0; index < rows.length; index += 500) {
    const chunk = rows.slice(index, index + 500);
    const { error } = await supabase.from(table).upsert(chunk as never[], { onConflict });
    if (error) throw toError(error);
  }
}

function normalizeName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

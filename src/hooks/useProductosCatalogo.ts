/**
 * useProductosCatalogo — el catálogo de fichas de producto (productos_catalogo
 * + productos_alias), con su CRUD.
 *
 * La tabla ronda las 1.000 filas (978 productos sembrados por la migración) y
 * va a crecer con cada producto nuevo que teclee el calibrador: el SELECT va
 * SIEMPRE con fetchAllRows. Un `.limit(5000)` no protege de nada — PostgREST
 * recorta a max-rows en silencio (regla del repo, ver src/lib/fetchAllRows.ts).
 *
 * La resolución texto crudo → ficha pasa por los alias, no por la clave
 * directa: así una fusión manual (dos claves apuntando a la misma ficha) se
 * respeta en todo el módulo sin tocar los datos del calibrador.
 */
import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthProvider";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/fetchAllRows";
import { toError } from "@/lib/errorMessage";
import { claveProducto } from "@/lib/productosCanonicos";
import type { FichaProducto } from "@/lib/cmvProducto";

// productos_catalogo / productos_alias son posteriores al Database generado.

const PERMISSION_ERROR_CODES = new Set(["42501", "PGRST301", "PGRST302"]);

function isPermissionError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const record = error as { code?: string; message?: string; status?: number };
  if (record.code && PERMISSION_ERROR_CODES.has(record.code)) return true;
  if (record.status === 401 || record.status === 403) return true;
  const message = (record.message ?? "").toLowerCase();
  return (
    message.includes("permission denied") ||
    message.includes("row-level security") ||
    message.includes("row level security")
  );
}

export interface ProductoCatalogoRow extends FichaProducto {
  id: string;
  notas: string | null;
  editado_at: string | null;
  editado_por: string | null;
}

interface AliasRow {
  producto_id: string;
  alias_clave: string;
}

/** Campos de la ficha que edita el dueño. Todos opcionales: se hace patch parcial. */
export interface FichaProductoPatch {
  kg_por_bulto?: number | null;
  coste_material_bulto?: number | null;
  coste_material_pieza?: number | null;
  indice_confeccion?: number | null;
  precio_venta_eur_kg?: number | null;
  metodo_venta?: string | null;
  zona_override?: string | null;
  activo?: boolean;
  notas?: string | null;
}

export function useProductosCatalogo() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const baseKey = ["productos-catalogo"] as const;

  const query = useQuery({
    queryKey: baseKey,
    enabled: Boolean(user),
    retry: (failureCount, error) => (isPermissionError(error) ? false : failureCount < 2),
    queryFn: async (): Promise<{ fichas: ProductoCatalogoRow[]; alias: AliasRow[] }> => {
      const [fichas, alias] = await Promise.all([
        fetchAllRows<ProductoCatalogoRow>((from, to) =>
          supabase.from("productos_catalogo").select("*").order("id").range(from, to),
        ),
        fetchAllRows<AliasRow>((from, to) =>
          supabase.from("productos_alias").select("producto_id, alias_clave").order("id").range(from, to),
        ),
      ]);
      return { fichas, alias };
    },
  });

  const sinPermiso = isPermissionError(query.error);
  const fichas = useMemo(() => query.data?.fichas ?? [], [query.data]);

  /**
   * Clave canónica → ficha. Se construye desde los ALIAS (no desde
   * ficha.clave) para que las fusiones manuales manden: si el dueño repuntó la
   * clave X a la ficha Y, un producto que llegue como X resuelve a Y.
   * Las fichas sin alias (no debería pasar tras la migración) se indexan por
   * su propia clave para no desaparecer del cálculo.
   */
  const porClave = useMemo(() => {
    const porId = new Map(fichas.map((f) => [f.id, f]));
    const map = new Map<string, ProductoCatalogoRow>();
    for (const f of fichas) map.set(f.clave, f);
    for (const a of query.data?.alias ?? []) {
      const ficha = porId.get(a.producto_id);
      if (ficha) map.set(a.alias_clave, ficha);
    }
    return map;
  }, [fichas, query.data?.alias]);

  /** Cuántas fichas siguen sin coste de material o sin precio: la cola de trabajo. */
  const pendientes = useMemo(() => {
    let sinMaterial = 0;
    let sinPrecio = 0;
    let sinTocar = 0;
    for (const f of fichas) {
      if (!f.activo) continue;
      if (f.coste_material_bulto == null && f.coste_material_pieza == null) sinMaterial += 1;
      if (f.precio_venta_eur_kg == null && !f.metodo_venta) sinPrecio += 1;
      if (!f.editado_at) sinTocar += 1;
    }
    return { sinMaterial, sinPrecio, sinTocar, total: fichas.length };
  }, [fichas]);

  const guardar = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: FichaProductoPatch }) => {
      if (!user) throw new Error("Debes iniciar sesión para editar una ficha de producto.");
      const { error } = await supabase
        .from("productos_catalogo")
        .update({ ...patch, editado_por: user.id, editado_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw toError(error);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: baseKey });
    },
  });

  /**
   * Crea la ficha de un producto que el calibrador ha tecleado hoy por primera
   * vez y que la migración no sembró. El alias se crea a la vez: sin él, el
   * producto no resolvería a su propia ficha.
   */
  const crear = useMutation({
    mutationFn: async (nombre: string) => {
      if (!user) throw new Error("Debes iniciar sesión para crear una ficha de producto.");
      const limpio = nombre.trim().replace(/\s+/g, " ");
      if (!claveProducto(limpio)) throw new Error("El nombre del producto está vacío.");
      const { data, error } = await supabase
        .from("productos_catalogo")
        .insert({ nombre: limpio })
        .select("id, clave")
        .single();
      if (error) throw toError(error);
      const { error: errAlias } = await supabase
        .from("productos_alias")
        .insert({ producto_id: data.id, alias_clave: data.clave, alias: limpio, origen: "auto" });
      // Un alias duplicado (23505) significa que la clave ya estaba resuelta:
      // no es un fallo, la ficha queda creada igual.
      if (errAlias && (errAlias as { code?: string }).code !== "23505") throw toError(errAlias);
      return data.id as string;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: baseKey });
    },
  });

  return {
    fichas,
    porClave,
    pendientes,
    isLoading: query.isLoading,
    sinPermiso,
    error: query.error,
    guardar,
    crear,
  };
}

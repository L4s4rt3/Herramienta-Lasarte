/**
 * useCalidadReferencias — cargas y mutaciones de
 * `calidad_referencias_productor` (referencias de podrido REAL por productor
 * y variedad, importadas desde el informe "Totales de Tamaños, Clase y
 * Calidad por Variedad" del calibrador — ver src/lib/calidadReferencias.ts
 * para el parser puro y src/pages/EconomicoFruta.tsx para la UI de import).
 *
 * IMPORTANTE: calidad_referencias_productor NO está todavía en
 * src/integrations/supabase/types.ts (la migración supabase/migrations/
 * 20260715120000_calidad_referencias_productor.sql está pendiente de aplicar
 * por el orquestador). Mientras tanto se usa el cast SUPA de más abajo (mismo
 * patrón que useLimpiezaBox.ts / useProductoresCatalogo.ts) y cualquier query
 * puede fallar con "relation does not exist": se detecta con
 * esErrorTablaOColumnaInexistente y se expone `migracionPendiente` para que
 * la página muestre "pendiente de aplicar migración" en vez de un error
 * crudo. Cuando se aplique y se regeneren los tipos, sustituir
 * CalidadReferenciaRow por `Tables<"calidad_referencias_productor">` y
 * retirar el cast.
 *
 * Dataset COMPARTIDO entre usuarios (UNIQUE(productor_nombre, variedad)):
 * las lecturas no filtran por user_id; la RLS permite editar/borrar solo lo
 * propio (o todo a un admin).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useAuth } from "@/contexts/AuthProvider";
import { supabase } from "@/integrations/supabase/client";
import { toError } from "@/lib/errorMessage";
import { esErrorTablaOColumnaInexistente } from "@/lib/productoresCanonicos";

// Cast local: calidad_referencias_productor aún no está en el Database
// generado. Ver comentario de cabecera para el plan de retirada.
const SUPA = supabase as unknown as SupabaseClient<any>;

/** Fuente por defecto (única existente hoy): el informe de tamaños/clase/calidad del calibrador. */
export const FUENTE_INFORME_CALIBRADOR = "informe_calibrador";

export interface CalidadReferenciaRow {
  id: string;
  productor_id: string | null;
  productor_nombre: string;
  variedad: string | null;
  kg_total: number;
  kg_podrido: number;
  fuente: string;
  rango_desde: string | null;
  rango_hasta: string | null;
  created_at: string;
  user_id: string;
}

export interface CalidadReferenciaInput {
  productorId: string | null;
  productorNombre: string;
  variedad: string | null;
  kgTotal: number;
  kgPodrido: number;
  fuente?: string;
  rangoDesde?: string | null;
  rangoHasta?: string | null;
}

export const CALIDAD_REFERENCIAS_KEY = ["calidad-referencias-productor"] as const;

interface CalidadReferenciasData {
  filas: CalidadReferenciaRow[];
  /** true si calidad_referencias_productor aún no existe (migración 20260715120000 pendiente). */
  migracionPendiente: boolean;
}

async function fetchReferencias(): Promise<CalidadReferenciasData> {
  const { data, error } = await SUPA
    .from("calidad_referencias_productor")
    .select("*")
    .order("productor_nombre", { ascending: true })
    .order("variedad", { ascending: true });
  if (error) {
    if (esErrorTablaOColumnaInexistente(error)) {
      console.warn("useCalidadReferencias: calidad_referencias_productor aún no existe (migración 20260715120000 pendiente de aplicar).", error);
      return { filas: [], migracionPendiente: true };
    }
    throw toError(error);
  }
  return { filas: (data ?? []) as CalidadReferenciaRow[], migracionPendiente: false };
}

export function useCalidadReferencias() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: CALIDAD_REFERENCIAS_KEY,
    queryFn: fetchReferencias,
    enabled: Boolean(user),
  });

  const invalidar = () => queryClient.invalidateQueries({ queryKey: CALIDAD_REFERENCIAS_KEY });

  /** Upsert por (productor_nombre, variedad): reimportar el mismo productor/variedad sustituye la referencia anterior. */
  const guardarReferencia = useMutation({
    mutationFn: async (input: CalidadReferenciaInput) => {
      if (!user) throw new Error("Debes iniciar sesión para guardar una referencia.");
      const { error } = await SUPA
        .from("calidad_referencias_productor")
        .upsert(
          {
            productor_id: input.productorId,
            productor_nombre: input.productorNombre,
            variedad: input.variedad,
            kg_total: input.kgTotal,
            kg_podrido: input.kgPodrido,
            fuente: input.fuente ?? FUENTE_INFORME_CALIBRADOR,
            rango_desde: input.rangoDesde ?? null,
            rango_hasta: input.rangoHasta ?? null,
            user_id: user.id,
          },
          { onConflict: "productor_nombre,variedad" },
        );
      if (error) {
        if (esErrorTablaOColumnaInexistente(error)) {
          throw new Error("La tabla calidad_referencias_productor todavía no existe: aplica primero la migración 20260715120000_calidad_referencias_productor.sql.");
        }
        throw toError(error);
      }
    },
    onSuccess: invalidar,
  });

  /** Guarda varias referencias (un informe puede traer varias variedades del mismo productor) en secuencia. */
  const guardarReferencias = useMutation({
    mutationFn: async (inputs: CalidadReferenciaInput[]) => {
      for (const input of inputs) {
        await guardarReferencia.mutateAsync(input);
      }
    },
    onSuccess: invalidar,
  });

  const eliminarReferencia = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await SUPA.from("calidad_referencias_productor").delete().eq("id", id);
      if (error) throw toError(error);
    },
    onSuccess: invalidar,
  });

  return {
    referencias: query.data?.filas ?? [],
    migracionPendiente: query.data?.migracionPendiente ?? false,
    isLoading: query.isLoading,
    error: query.error,
    guardarReferencia,
    guardarReferencias,
    eliminarReferencia,
  };
}

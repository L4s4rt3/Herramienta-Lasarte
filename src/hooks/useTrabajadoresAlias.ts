/**
 * useTrabajadoresAlias — alias aprendidos para el resolutor de nombres de
 * asistencia (src/lib/asistenciaTrabajadores.ts).
 *
 * IMPORTANTE: la tabla trabajadores_alias (id, trabajador_id fk, alias text
 * UNIQUE, user_id) aun no esta en src/integrations/supabase/types.ts. Se usa
 * el mismo patron de cast que src/hooks/useMercadonaVentas.ts
 * (`supabase as unknown as SupabaseClient<any>`) hasta que se regeneren los
 * tipos; cuando se apliquen, sustituir por `Tables<"trabajadores_alias">` y
 * quitar el cast SUPA de aqui.
 *
 * El Map expuesto usa como clave el alias ya normalizado (mismo formato que
 * normalizeTrabajadorName/tokenSetKey en asistenciaTrabajadores.ts: sin
 * tildes, minusculas, espacios colapsados) para que resolveTrabajadoresPorNombre
 * / resolveTrabajadoresPorLista puedan hacer `.get(normalized)` directamente.
 */
import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useAuth } from "@/contexts/AuthProvider";
import { supabase } from "@/integrations/supabase/client";
import { toError } from "@/lib/errorMessage";

// Cast local: la tabla trabajadores_alias aun no esta en el Database generado.
// Ver comentario de cabecera para el plan de retirada de este cast.
const SUPA = supabase as unknown as SupabaseClient<any>;

export interface TrabajadorAliasRow {
  id: string;
  trabajador_id: string;
  alias: string;
  user_id: string;
}

function normalizeAlias(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[.,;]/g, " ")
    .toLocaleLowerCase("es")
    .trim()
    .replace(/\s+/g, " ");
}

export function useTrabajadoresAlias() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const baseKey = ["trabajadores-alias"] as const;

  const aliasQuery = useQuery({
    queryKey: baseKey,
    queryFn: async (): Promise<TrabajadorAliasRow[]> => {
      const { data, error } = await SUPA.from("trabajadores_alias").select("*");
      if (error) throw toError(error);
      return (data ?? []) as TrabajadorAliasRow[];
    },
    enabled: Boolean(user),
  });

  const aliasPorNombre = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of aliasQuery.data ?? []) {
      map.set(normalizeAlias(row.alias), row.trabajador_id);
    }
    return map;
  }, [aliasQuery.data]);

  /** Aprende un alias nuevo: la proxima importacion resolvera ese nombre para siempre. */
  const guardarAlias = useMutation({
    mutationFn: async (input: { trabajadorId: string; alias: string }) => {
      if (!user) throw new Error("Debes iniciar sesion para guardar un alias.");
      const alias = input.alias.trim();
      if (!alias) throw new Error("El alias no puede estar vacio.");

      const { error } = await SUPA
        .from("trabajadores_alias")
        .upsert(
          { trabajador_id: input.trabajadorId, alias, user_id: user.id },
          { onConflict: "alias" },
        );
      if (error) throw toError(error);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: baseKey });
    },
  });

  return {
    aliasPorNombre,
    aliasQuery,
    isLoading: aliasQuery.isLoading,
    guardarAlias,
  };
}

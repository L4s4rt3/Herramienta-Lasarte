// El estándar de kg/persona por régimen de plantilla, leído de la tabla
// estandar_rendimiento (la FUENTE ÚNICA desde el 04-09-2026) y guardado desde
// la app por el admin.
//
// POR QUÉ UN HOOK Y NO LA CONSTANTE. El dueño revisa el listón cada 4-6 semanas
// ("si se clava el objetivo un mes, subir suelo y objetivo"); hasta ahora
// subirlo era tocar código en dos sitios y desplegar. Ahora la vista "Por tipo
// de día" (y quien monte este hook) lee la fila y, si la tabla está vacía o no
// se puede leer, cae al respaldo ESTANDAR_RENDIMIENTO avisando por consola y
// con `esRespaldo`: la página no se rompe por un estándar, pero tampoco se calla.
//
// La tabla no está todavía en types.ts (los tipos se regeneran aparte), así que
// se consulta con supabaseLibre (el MISMO cliente y sesión, sin el tipo
// Database) y la fila se tipa aquí con FilaEstandarRendimiento. Cuando se
// regeneren los tipos, pasar a supabase.from("estandar_rendimiento") es cambiar
// una constante.
import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthProvider";
import { supabaseLibre } from "@/integrations/supabase/client";
import { toError } from "@/lib/errorMessage";
import {
  estandarDesdeFila,
  filaDesdeEstandar,
  validarEstandarRendimiento,
  type EstandarRendimiento,
  type FilaEstandarRendimiento,
} from "@/lib/estandarRendimiento";

export const ESTANDAR_RENDIMIENTO_QUERY_KEY = ["estandar-rendimiento"] as const;
const TABLA = "estandar_rendimiento";

interface LecturaEstandar {
  fila: FilaEstandarRendimiento | null;
  /** Por qué no hay fila (tabla vacía o error), para el aviso; null si se leyó bien. */
  motivo: string | null;
}

/**
 * Lee la única fila. NUNCA lanza: un fallo aquí no puede tumbar la página que
 * lo usa; se avisa por consola y el que llama enseña el respaldo.
 */
async function leerFila(): Promise<LecturaEstandar> {
  const { data, error } = await supabaseLibre.from(TABLA).select("*").eq("id", true).maybeSingle();
  if (error) {
    console.warn(`[estandar-rendimiento] no se pudo leer la tabla (${error.message}): se usa el estándar por defecto del 27-08-2026`);
    return { fila: null, motivo: error.message };
  }
  if (!data) {
    console.warn("[estandar-rendimiento] la tabla está vacía: se usa el estándar por defecto del 27-08-2026");
    return { fila: null, motivo: "la tabla no tiene fila" };
  }
  return { fila: data as FilaEstandarRendimiento, motivo: null };
}

export function useEstandarRendimiento() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ESTANDAR_RENDIMIENTO_QUERY_KEY,
    queryFn: leerFila,
    enabled: Boolean(user),
    // Cambia cada 4-6 semanas: una lectura por sesión basta, y al guardar se
    // pone la fila nueva en la caché a mano.
    staleTime: 60 * 60_000,
    gcTime: 24 * 60 * 60_000,
    retry: 1,
  });

  const fila = query.data?.fila ?? null;
  // Memo a propósito: quien lo pase a useTipoDia (opciones.estandar) recalcula
  // por identidad, y sin esto cada render sería un objeto nuevo.
  const estandar = useMemo(() => estandarDesdeFila(fila), [fila]);

  const guardar = useMutation({
    mutationFn: async (nuevo: EstandarRendimiento): Promise<FilaEstandarRendimiento> => {
      // Las mismas reglas que los CHECK de la tabla, pero en castellano y antes
      // de salir a la red.
      const problemas = validarEstandarRendimiento(nuevo);
      if (problemas.length > 0) throw new Error(problemas.join(" "));
      const { data, error } = await supabaseLibre
        .from(TABLA)
        .update(filaDesdeEstandar(nuevo))
        .eq("id", true)
        .select("*")
        .maybeSingle();
      if (error) throw toError(error);
      // Con RLS, un UPDATE sin permiso no da error: afecta a 0 filas y vuelve
      // vacío. Se dice claro en vez de fingir que se guardó.
      if (!data) throw new Error("No se guardó el estándar: hace falta ser admin (o la fila de la tabla no existe).");
      return data as FilaEstandarRendimiento;
    },
    onSuccess: (filaGuardada) => {
      queryClient.setQueryData<LecturaEstandar>(ESTANDAR_RENDIMIENTO_QUERY_KEY, { fila: filaGuardada, motivo: null });
    },
  });

  return {
    /** El estándar a aplicar: el de la tabla o, si no se pudo leer, el respaldo del 27-08. */
    estandar,
    /** La fila tal cual (nota, updated_at, updated_by); null si se está en respaldo. */
    fila,
    isLoading: query.isLoading,
    /** true cuando se enseña el respaldo y no la tabla (vacía o ilegible). */
    esRespaldo: Boolean(user) && !query.isLoading && fila === null,
    motivoRespaldo: query.data?.motivo ?? null,
    /** Mutación (valida antes de escribir; el que llama pone los toasts). */
    guardar,
  };
}

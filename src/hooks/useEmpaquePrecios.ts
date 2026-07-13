import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useAuth } from "@/contexts/AuthProvider";
import { supabase } from "@/integrations/supabase/client";
import { toError } from "@/lib/errorMessage";
import { today } from "@/lib/format";
import {
  agregarCosteEmpaque,
  precioVigenteEmpaque,
  type CosteEmpaqueTipoMalla,
  type EmpaqueComponente,
  type EmpaquePrecioInput,
  type TipoMalla,
} from "@/lib/costeEmpaque";

const SUPA = supabase as unknown as SupabaseClient<any>;

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

export interface EmpaquePrecioRow extends EmpaquePrecioInput {
  id: string;
  user_id: string;
  notas: string | null;
}

export interface NuevoEmpaquePrecioInput {
  tipo_malla: TipoMalla;
  componente: EmpaqueComponente;
  precio_malla: number;
  vigente_desde: string;
  notas: string | null;
}

const COMPONENTES: EmpaqueComponente[] = [
  "etiqueta", "caja_logifruit", "palet_doble", "malla_roja",
  "banda", "fleje", "asa",
];

export function useEmpaquePrecios() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const baseKey = ["empaque-precios"] as const;

  const query = useQuery({
    queryKey: baseKey,
    queryFn: async (): Promise<EmpaquePrecioRow[]> => {
      const { data, error } = await SUPA
        .from("empaque_precios")
        .select("*")
        .order("tipo_malla", { ascending: true })
        .order("componente", { ascending: true })
        .order("vigente_desde", { ascending: false });
      if (error) throw error;
      return (data ?? []) as EmpaquePrecioRow[];
    },
    enabled: Boolean(user),
    retry: (failureCount, error) => (isPermissionError(error) ? false : failureCount < 2),
  });

  const sinPermiso = isPermissionError(query.error);
  const precios = useMemo(() => query.data ?? [], [query.data]);

  const tiposMalla: TipoMalla[] = ["3kg", "5kg"];

  const vigentePorTipo = useMemo(() => {
    const map = new Map<TipoMalla, Map<EmpaqueComponente, EmpaquePrecioRow>>();
    const hoy = today();
    for (const tipo of tiposMalla) {
      const compMap = new Map<EmpaqueComponente, EmpaquePrecioRow>();
      for (const comp of COMPONENTES) {
        const vigente = precioVigenteEmpaque(precios, tipo, comp, hoy);
        if (vigente) compMap.set(comp, vigente as EmpaquePrecioRow);
      }
      map.set(tipo, compMap);
    }
    return map;
  }, [precios]);

  const historicoPorTipo = useMemo(() => {
    const map = new Map<string, EmpaquePrecioRow[]>();
    for (const p of precios) {
      const key = `${p.tipo_malla}-${p.componente}`;
      const list = map.get(key) ?? [];
      list.push(p);
      map.set(key, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => b.vigente_desde.localeCompare(a.vigente_desde));
    }
    return map;
  }, [precios]);

  const hayPrecioCero = useMemo(
    () => tiposMalla.some((tipo) =>
      COMPONENTES.some((comp) => (vigentePorTipo.get(tipo)?.get(comp)?.precio_malla ?? 0) === 0)
    ),
    [tiposMalla, vigentePorTipo],
  );

  const costesVigentes = useMemo<CosteEmpaqueTipoMalla[]>(
    () => agregarCosteEmpaque(precios, today()),
    [precios],
  );

  const crear = useMutation({
    mutationFn: async (input: NuevoEmpaquePrecioInput) => {
      if (!user) throw new Error("Debes iniciar sesion para registrar un precio de envasado.");
      const { error } = await SUPA.from("empaque_precios").insert({
        user_id: user.id,
        tipo_malla: input.tipo_malla,
        componente: input.componente,
        precio_malla: input.precio_malla,
        vigente_desde: input.vigente_desde,
        notas: input.notas,
      });
      if (error) throw toError(error);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: baseKey });
    },
  });

  const editar = useMutation({
    mutationFn: async (input: EmpaquePrecioRow) => {
      const { id } = input;
      const { error } = await SUPA
        .from("empaque_precios")
        .update({
          tipo_malla: input.tipo_malla,
          componente: input.componente,
          precio_malla: input.precio_malla,
          vigente_desde: input.vigente_desde,
          notas: input.notas,
        })
        .eq("id", id);
      if (error) throw toError(error);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: baseKey });
    },
  });

  const borrar = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await SUPA.from("empaque_precios").delete().eq("id", id);
      if (error) throw toError(error);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: baseKey });
    },
  });

  return {
    precios,
    vigentePorTipo,
    historicoPorTipo,
    hayPrecioCero,
    costesVigentes,
    isLoading: query.isLoading,
    sinPermiso,
    crear,
    editar,
    borrar,
  };
}

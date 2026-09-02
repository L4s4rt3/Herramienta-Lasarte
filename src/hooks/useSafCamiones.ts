// Datos de la pantalla "Importación SAF: Laadbon y cuadre" (Datos, admin).
//
// POR QUÉ EXISTE (02-09-2026). El vigía de negocio cuadra cada camión SAF con
// su Laadbon (saf_camiones) y avisa de las entradas sin Laadbon con el texto
// "registrar cajas y €/caja en la tabla saf_camiones" — y eso solo se podía
// hacer con SQL. Era el último dato del flujo SAF que se tecleaba a mano fuera
// de la app. Aquí también se ven y se ACEPTAN las discrepancias ERP ↔ app que
// el sincronizador no pisa (erp_correcciones): sin poder aceptarlas, el vigía
// recordaría cada lunes, para siempre, que la importación entra por neto y el
// ERP pesa bruto.
//
// Las tres tablas son pequeñas (decenas de filas) pero se leen con fetchAllRows
// igual: regla de la casa contra el recorte silencioso a 1.000.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Tables, TablesInsert } from "@/integrations/supabase/types";
import { fetchAllRows } from "@/lib/fetchAllRows";
import { toError } from "@/lib/errorMessage";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthProvider";

export type SafCamion = Tables<"saf_camiones">;
export type ErpCorreccion = Tables<"erp_correcciones">;

export interface EntradaSaf {
  lote: string;
  fecha: string;
  kg_entrada: number | null;
  importe_compra: number | null;
  agricultor: string | null;
}

/** Misma ventana y mismo filtro que la edge function vigia-negocio (SAF_DESDE). */
export const SAF_DESDE = "2026-08-25";
const PATRON_PROVEEDOR_SAF = "%goesten%";

export const SAF_QUERY_KEY = ["saf-camiones"] as const;

export function useSafCamiones() {
  return useQuery({
    queryKey: SAF_QUERY_KEY,
    queryFn: async () => {
      const [camiones, entradas, correcciones] = await Promise.all([
        fetchAllRows<SafCamion>((from, to) =>
          supabase.from("saf_camiones").select("*").order("fecha", { ascending: false }).order("lote").range(from, to),
        ),
        fetchAllRows<EntradaSaf>((from, to) =>
          supabase
            .from("entradas_bascula")
            .select("lote, fecha, kg_entrada, importe_compra, agricultor")
            .gte("fecha", SAF_DESDE)
            .ilike("agricultor", PATRON_PROVEEDOR_SAF)
            .order("fecha", { ascending: false })
            .order("lote")
            .range(from, to),
        ),
        fetchAllRows<ErpCorreccion>((from, to) =>
          supabase.from("erp_correcciones").select("*").order("lote").order("campo").range(from, to),
        ),
      ]);
      return { camiones, entradas, correcciones };
    },
    staleTime: 60_000,
  });
}

export type CamionInput = Pick<TablesInsert<"saf_camiones">,
  "lote" | "fecha" | "proveedor" | "cajas" | "eur_caja" | "porte_eur" | "kg_neto_laadbon" | "laadbon_ref" | "notas">;

export function useSafCamionesMutations() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const invalidar = () => void qc.invalidateQueries({ queryKey: SAF_QUERY_KEY });
  const fallo = (titulo: string) => (e: unknown) =>
    toast({ title: titulo, description: toError(e).message, variant: "destructive" });

  const guardarCamion = useMutation({
    mutationFn: async (input: CamionInput) => {
      const fila = { ...input, updated_at: new Date().toISOString() };
      const { error } = await supabase.from("saf_camiones").upsert(fila, { onConflict: "lote" });
      if (error) throw toError(error);
    },
    onSuccess: () => { toast({ title: "Camión guardado" }); invalidar(); },
    onError: fallo("No se pudo guardar el camión"),
  });

  const borrarCamion = useMutation({
    mutationFn: async (lote: string) => {
      const { error } = await supabase.from("saf_camiones").delete().eq("lote", lote);
      if (error) throw toError(error);
    },
    onSuccess: () => { toast({ title: "Camión eliminado" }); invalidar(); },
    onError: fallo("No se pudo eliminar el camión"),
  });

  // Solo admin puede (política erp_correcciones_aceptar_admin) y solo estas
  // tres columnas (privilegio por columna): el resto lo escribe el sincronizador.
  const aceptarCorreccion = useMutation({
    mutationFn: async (input: { lote: string; campo: string; nota: string | null; aceptar: boolean }) => {
      const patch = input.aceptar
        ? { aceptada_en: new Date().toISOString(), aceptada_por: user?.email ?? user?.id ?? null, nota: input.nota }
        : { aceptada_en: null, aceptada_por: null, nota: input.nota };
      const { error } = await supabase.from("erp_correcciones").update(patch).eq("lote", input.lote).eq("campo", input.campo);
      if (error) throw toError(error);
    },
    onSuccess: (_d, v) => { toast({ title: v.aceptar ? "Diferencia aceptada: el vigía deja de avisar de ella" : "Diferencia de nuevo bajo vigilancia" }); invalidar(); },
    onError: fallo("No se pudo cambiar la diferencia"),
  });

  return { guardarCamion, borrarCamion, aceptarCorreccion };
}

/** €/kg puesto en almacén: (cajas × €/caja + porte) / kg neto del Laadbon. Misma cuenta que el vigía. */
export function eurKgPuesto(c: Pick<SafCamion, "cajas" | "eur_caja" | "porte_eur" | "kg_neto_laadbon">): number | null {
  const kg = Number(c.kg_neto_laadbon) || 0;
  const cajas = Number(c.cajas) || 0;
  const eur = Number(c.eur_caja) || 0;
  if (kg <= 0 || cajas <= 0 || eur <= 0) return null;
  return (cajas * eur + (Number(c.porte_eur) || 0)) / kg;
}

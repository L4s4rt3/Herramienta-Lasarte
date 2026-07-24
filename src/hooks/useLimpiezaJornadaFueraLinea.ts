/**
 * useLimpiezaJornadaFueraLinea — fracción de jornada (0..1) que cada
 * trabajador pasó limpiando box en una fecha, para descontarla del
 * rendimiento por zonas (calcularRendimientoZonasAlmacen).
 *
 * Mismo cast SUPA que useLimpiezaBox: limpieza_partes /
 * limpieza_parte_trabajadores aún no están en los tipos generados. Si las
 * tablas no existen todavía (migración pendiente) devuelve {} en silencio:
 * el rendimiento simplemente no descuenta nada.
 */
import { useQuery } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { jornadaFueraLineaPorLimpieza, type LimpiezaHorasTrabajadorRow } from "@/lib/limpiezaBox";

const SUPA = supabase as unknown as SupabaseClient<any>;

export function useLimpiezaJornadaFueraLinea(date: string | null | undefined) {
  return useQuery({
    queryKey: ["limpieza-jornada-fuera-linea", date],
    enabled: Boolean(date),
    queryFn: async (): Promise<Record<string, number>> => {
      const { data: partes, error: partesError } = await SUPA
        .from("limpieza_partes")
        .select("id")
        .eq("fecha", date!);
      if (partesError || !partes || partes.length === 0) return {};

      const { data: filas, error: filasError } = await SUPA
        .from("limpieza_parte_trabajadores")
        .select("trabajador_id, horas")
        .in("parte_id", partes.map((p: { id: string }) => p.id));
      if (filasError) return {};

      return jornadaFueraLineaPorLimpieza((filas ?? []) as LimpiezaHorasTrabajadorRow[]);
    },
  });
}

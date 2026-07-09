/**
 * useMercadonaProduccion — soporte para la pagina "Mercadona · Produccion"
 * (src/pages/MercadonaProduccion.tsx): un selector de semana INDEPENDIENTE del
 * Excel de ventas (mercadona_semanas), porque produccion no depende de si el
 * dueno ha importado la planificacion comercial de esa semana o no.
 *
 * Aqui solo se resuelve "que semana mostrar por defecto" y "como navegar a la
 * semana anterior/siguiente": el resto de datos (aprovechamiento MDNA, lotes,
 * productores) se piden con los hooks ya existentes (useMercadona,
 * useMercadonaLotes) sobre el rango de fechas de la semana elegida.
 */
import { useMemo } from "react";
import { addWeeks, getISOWeek, getISOWeekYear, setISOWeek, setISOWeekYear } from "date-fns";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface MercadonaProduccionSemana {
  anio: number;
  semana: number;
}

/** Semana ISO (anio, semana) correspondiente a una fecha "YYYY-MM-DD" o Date. */
function semanaDeFecha(fecha: string | Date): MercadonaProduccionSemana {
  const d = typeof fecha === "string" ? new Date(`${fecha}T12:00:00`) : fecha;
  return { anio: getISOWeekYear(d), semana: getISOWeek(d) };
}

/** Suma/resta `delta` semanas ISO a (anio, semana), resolviendo el cambio de año. */
export function shiftSemanaMercadona(anio: number, semana: number, delta: number): MercadonaProduccionSemana {
  const base = setISOWeekYear(setISOWeek(new Date(anio, 0, 4, 12, 0, 0), semana), anio);
  const shifted = addWeeks(base, delta);
  return semanaDeFecha(shifted);
}

/** Semana ISO actual (hoy), para usarla como fallback cuando no hay ninguna produccion registrada todavia. */
export function semanaActualMercadona(): MercadonaProduccionSemana {
  return semanaDeFecha(new Date());
}

/**
 * Ultima fecha con un parte diario registrado (cualquier produccion, no solo
 * Mercadona): se usa para que la pagina abra por defecto en la ultima semana
 * con datos reales en vez de en la semana ISO actual si esta todavia esta vacia
 * (p. ej. lunes a primera hora, antes de subir el parte del dia).
 */
export function useUltimaSemanaConProduccion() {
  const query = useQuery({
    queryKey: ["mercadona-produccion-ultima-semana"],
    queryFn: async (): Promise<MercadonaProduccionSemana | null> => {
      const { data, error } = await supabase
        .from("partes_diarios")
        .select("date")
        .order("date", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      if (!data?.date) return null;
      return semanaDeFecha(data.date as string);
    },
  });

  return { semana: query.data ?? null, isLoading: query.isLoading };
}

/**
 * Semana efectiva a mostrar: la seleccionada manualmente por el usuario si la
 * hay, o el valor por defecto (ultima semana con produccion; si no hay ninguna
 * todavia, la semana actual) mientras se resuelve. `isDefaultLoading` indica si
 * ese valor por defecto aun se esta calculando (para no parpadear a la semana
 * actual antes de saber la ultima con datos).
 */
export function useSemanaProduccionEfectiva(seleccionada: MercadonaProduccionSemana | null) {
  const { semana: ultimaConDatos, isLoading } = useUltimaSemanaConProduccion();

  const porDefecto = useMemo(
    () => ultimaConDatos ?? semanaActualMercadona(),
    [ultimaConDatos],
  );

  return {
    efectiva: seleccionada ?? porDefecto,
    porDefecto,
    isDefaultLoading: isLoading && !seleccionada,
  };
}

// Análisis económico por TIPO DE DÍA (plantilla completa/reducida × día
// bueno/medio/malo) para Económico → Rentabilidad → "Por tipo de día".
//
// POR QUÉ EXISTE (03-09-2026). Era tmp/analisis-tipo-dia.ts, un Excel fuera
// del repo que dependía de dos ficheros locales. Los números los hace
// _shared/tipoDia.ts (misma función que el script scripts/analisis-tipo-dia.ts)
// sobre computeRentabilidadDia, la misma cuenta que la pestaña del día.
//
// DE DÓNDE SALE CADA COSA
// - Filas del calibrador por día: RPC rentabilidad_filas_dias(desde, hasta)
//   sobre la materializada de la vista canónica (lote × producto × clase con
//   duración y t/h de la pasada). Desde el 13-08 la rentabilidad lee la vista
//   (la máquina, todas las pasadas), no el Word.
// - Presentes por día y su coste/hora: asistencia_detalle + trabajadores.
// - Fruta por lote: entradas de báscula (importe_total / kg_entrada).
// - Tarifa Mercadona por semana: mercadona_semanas + sus métodos (base_iva).
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthProvider";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/fetchAllRows";
import { useEntradasBascula } from "@/hooks/useEntradasBascula";
import type { FilaClasifRentabilidad } from "@/lib/rentabilidadDia";
import {
  agregarDias,
  construirDiasTipo,
  filasPorDiaDesde,
  frutaPorLoteDesdeEntradas,
  presentesPorDiaDesde,
  resumenPorTipo,
  semanasPrecio,
  type DiaTipo,
  type FilaTipoDia,
  type OpcionesTipoDia,
  type SemanaPrecio,
} from "@/lib/tipoDia";

/**
 * Filas POSICIONALES (contrato con la migración rentabilidad_filas_dias):
 * 0 fecha, 1 lote_codigo, 2 productor, 3 producto, 4 clase, 5 kg,
 * 6 duracion_min, 7 toneladas_hora.
 */
type FilaPosicional = [string, string | null, string | null, string | null, string | null, number | string | null, number | string | null, number | string | null];

interface RespuestaFilas {
  refrescado_en: string | null;
  filas: FilaPosicional[];
}

const n = (v: number | string | null): number | null => (v == null ? null : Number(v));

function aFila(f: FilaPosicional): FilaClasifRentabilidad & { fecha: string | null } {
  return { fecha: f[0], lote_codigo: f[1], productor: f[2], producto: f[3], clase: f[4], peso_kg: n(f[5]), toneladas_hora: n(f[7]), duracion_min: n(f[6]) };
}

export interface TipoDiaResultado {
  dias: DiaTipo[];
  /** Una fila por tipo presente (estructura: kg, personas, personal). */
  porTipo: FilaTipoDia[];
  total: FilaTipoDia;
  /** Solo los días con tarifa Mercadona real: la cuenta entera. */
  porTipoCuenta: FilaTipoDia[];
  totalCuenta: FilaTipoDia | null;
  sinAsistencia: string[];
  descartadosPorKg: Array<{ fecha: string; kg: number }>;
  semanas: SemanaPrecio[];
  refrescadoEn: string | null;
}

export interface UseTipoDiaArgs {
  desde: string;
  hasta: string;
  opciones?: OpcionesTipoDia;
}

export function useTipoDia({ desde, hasta, opciones }: UseTipoDiaArgs) {
  const { user } = useAuth();
  const { entradas, entradasPrecalibrado, isLoading: entradasLoading } = useEntradasBascula();
  const rangoValido = Boolean(desde && hasta && desde <= hasta);

  const filasQuery = useQuery({
    queryKey: ["tipo-dia", "filas", desde, hasta],
    queryFn: async (): Promise<RespuestaFilas> => {
      const { data, error } = await supabase.rpc("rentabilidad_filas_dias", { desde, hasta });
      if (error) throw new Error(error.message);
      return (data as unknown as RespuestaFilas | null) ?? { refrescado_en: null, filas: [] };
    },
    enabled: Boolean(user) && rangoValido,
    staleTime: 15 * 60_000,
  });

  const asistenciaQuery = useQuery({
    queryKey: ["tipo-dia", "asistencia", desde, hasta],
    queryFn: () => fetchAllRows<{ date: string; trabajador_id: string }>((from, to) =>
      supabase.from("asistencia_detalle").select("date, trabajador_id").eq("presente", true)
        .gte("date", desde).lte("date", hasta).order("id").range(from, to)),
    enabled: Boolean(user) && rangoValido,
    staleTime: 15 * 60_000,
  });

  const trabajadoresQuery = useQuery({
    queryKey: ["tipo-dia", "trabajadores-coste"],
    queryFn: () => fetchAllRows<{ id: string; coste_hora: number | null }>((from, to) =>
      supabase.from("trabajadores").select("id, coste_hora").order("id").range(from, to)),
    enabled: Boolean(user),
    staleTime: 15 * 60_000,
  });

  const semanasQuery = useQuery({
    queryKey: ["tipo-dia", "semanas-mdna"],
    queryFn: async () => {
      const filas = await fetchAllRows<{ anio: number; semana: number; metodos: Array<{ metodo: string | null; kilos: number | null; base_iva: number | null }> | null }>((from, to) =>
        supabase.from("mercadona_semanas").select("anio, semana, metodos:mercadona_semana_metodos(metodo, kilos, base_iva)")
          .order("anio").order("semana").range(from, to));
      return semanasPrecio(filas.map((s) => ({ anio: s.anio, semana: s.semana, metodos: s.metodos ?? [] })));
    },
    enabled: Boolean(user),
    staleTime: 15 * 60_000,
  });

  const data: TipoDiaResultado | null = useMemo(() => {
    if (!filasQuery.data || !asistenciaQuery.data || !trabajadoresQuery.data || !semanasQuery.data) return null;
    const frutaPorLote = frutaPorLoteDesdeEntradas(
      [...entradas, ...entradasPrecalibrado].map((e) => ({ lote: e.lote, kg_entrada: e.kg_entrada, importe_total: (e as { importe_total?: number | null }).importe_total ?? null })),
    );
    const r = construirDiasTipo({
      filasPorDia: filasPorDiaDesde(filasQuery.data.filas.map(aFila)),
      presentesPorDia: presentesPorDiaDesde(asistenciaQuery.data),
      costeHoraPorTrabajador: new Map(trabajadoresQuery.data.map((t) => [t.id, t.coste_hora])),
      frutaPorLote,
      semanas: semanasQuery.data,
      opciones,
    });
    const conCuenta = r.dias.filter((d) => d.conCuenta);
    return {
      dias: r.dias,
      porTipo: resumenPorTipo(r.dias),
      total: agregarDias("Todos los días", r.dias),
      porTipoCuenta: resumenPorTipo(conCuenta),
      totalCuenta: conCuenta.length ? agregarDias("Todos (con tarifa real)", conCuenta) : null,
      sinAsistencia: r.sinAsistencia,
      descartadosPorKg: r.descartadosPorKg,
      semanas: semanasQuery.data,
      refrescadoEn: filasQuery.data.refrescado_en,
    };
  }, [filasQuery.data, asistenciaQuery.data, trabajadoresQuery.data, semanasQuery.data, entradas, entradasPrecalibrado, opciones]);

  return {
    data,
    isLoading: entradasLoading || filasQuery.isLoading || asistenciaQuery.isLoading || trabajadoresQuery.isLoading || semanasQuery.isLoading,
    error: filasQuery.error ?? asistenciaQuery.error ?? trabajadoresQuery.error ?? semanasQuery.error,
    rangoValido,
  };
}

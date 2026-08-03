// src/hooks/useRentabilidadDia.ts — datos de "Económico → Rentabilidad del día".
//
// Trae, para UNA fecha: las filas de lote_clasificacion (Informe LOTE del
// calibrador), la fruta de báscula de esos lotes (importe_total/kg_entrada),
// la asistencia con coste/hora, y los precios Mercadona de la semana de la
// fecha (con fallback a la última semana anterior con base facturada). El
// cálculo en sí vive en la lib pura src/lib/rentabilidadDia.ts.
import { useQuery } from "@tanstack/react-query";
import { getISOWeek, getISOWeekYear } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/fetchAllRows";
import { normalizarLoteCodigo } from "@/lib/loteCodigo";
import type { FilaClasifRentabilidad, FrutaLoteRentabilidad, PersonalDiaRentabilidad, PreciosRentabilidad } from "@/lib/rentabilidadDia";
import { preciosMdnaDesdeSemana } from "@/lib/rentabilidadDia";

// trabajadores.coste_hora no está en el Database generado (mismo cast local
// que useCostePersonal.ts — ver su cabecera).
interface TrabajadorCosteRow {
  id: string;
  coste_hora: number | null;
}

export interface SemanaPreciosMdna {
  anio: number;
  semana: number;
  /** true si es la semana de la propia fecha; false si es un fallback anterior. */
  esLaSemanaDeLaFecha: boolean;
  precios: Partial<Pick<PreciosRentabilidad, "mdna3" | "mdna4" | "mdna5" | "mdnaGranel">>;
}

export interface DatosRentabilidadDia {
  filas: FilaClasifRentabilidad[];
  frutaPorLote: Map<string, FrutaLoteRentabilidad>;
  /** Lotes del día cuya entrada de báscula no se encontró por su clave de 8 dígitos. */
  lotesSinEntrada: string[];
  personal: PersonalDiaRentabilidad;
  semanaMdna: SemanaPreciosMdna | null;
}

/** Última fecha con Informe LOTE cargado: el día por defecto de la página. */
export function useUltimaFechaConInformes() {
  return useQuery({
    queryKey: ["rentabilidad-dia", "ultima-fecha"],
    queryFn: async (): Promise<string | null> => {
      const { data, error } = await supabase
        .from("lote_clasificacion")
        .select("fecha")
        .not("fecha", "is", null)
        .order("fecha", { ascending: false })
        .limit(1);
      if (error) throw error;
      return data?.[0]?.fecha ?? null;
    },
  });
}

async function fetchPreciosSemanaMdna(fecha: string): Promise<SemanaPreciosMdna | null> {
  const date = new Date(`${fecha}T12:00:00`);
  const anioObjetivo = getISOWeekYear(date);
  const semanaObjetivo = getISOWeek(date);

  const { data: semanas, error } = await supabase
    .from("mercadona_semanas")
    .select("id, anio, semana")
    .order("anio", { ascending: false })
    .order("semana", { ascending: false });
  if (error) throw error;

  // Candidatas: la semana de la fecha y anteriores, de más reciente a más
  // antigua. Se prueba hasta encontrar una con base facturada (una semana
  // importada solo con la planificación tiene base_iva 0 y no fija precios).
  const candidatas = (semanas ?? [])
    .filter((s) => s.anio < anioObjetivo || (s.anio === anioObjetivo && s.semana <= semanaObjetivo))
    .slice(0, 6);

  for (const s of candidatas) {
    const { data: metodos, error: errMetodos } = await supabase
      .from("mercadona_semana_metodos")
      .select("metodo, kilos, base_iva")
      .eq("semana_id", s.id);
    if (errMetodos) throw errMetodos;
    const precios = preciosMdnaDesdeSemana(metodos ?? []);
    if (Object.keys(precios).length > 0) {
      return {
        anio: s.anio,
        semana: s.semana,
        esLaSemanaDeLaFecha: s.anio === anioObjetivo && s.semana === semanaObjetivo,
        precios,
      };
    }
  }
  return null;
}

export function useRentabilidadDia(fecha: string | null) {
  return useQuery({
    queryKey: ["rentabilidad-dia", fecha],
    enabled: !!fecha,
    queryFn: async (): Promise<DatosRentabilidadDia> => {
      const dia = fecha!;

      // 1) Clasificación del día (un día ronda las 1.000-1.500 filas: paginado
      //    con fetchAllRows por la regla max-rows del repo).
      const filas = await fetchAllRows<FilaClasifRentabilidad>((from, to) =>
        supabase
          .from("lote_clasificacion")
          .select("lote_codigo, productor, producto, clase, peso_kg, toneladas_hora, duracion_min")
          .eq("fecha", dia)
          .order("id")
          .range(from, to),
      );

      const clavesLote = [...new Set(
        filas.map((f) => normalizarLoteCodigo(f.lote_codigo)).filter((c): c is string => !!c),
      )];

      // 2) Fruta de báscula + 3) asistencia con coste/hora, en paralelo.
      const [entradasRes, presentesRes, trabajadoresRes, semanaMdna] = await Promise.all([
        clavesLote.length > 0
          ? supabase.from("entradas_bascula").select("lote, kg_entrada, importe_total").in("lote", clavesLote)
          : Promise.resolve({ data: [], error: null } as { data: Array<{ lote: string | null; kg_entrada: number | null; importe_total: number | null }>; error: null }),
        supabase.from("asistencia_detalle").select("trabajador_id").eq("date", dia).eq("presente", true),
        supabase.from("trabajadores").select("id, coste_hora"),
        fetchPreciosSemanaMdna(dia),
      ]);
      if (entradasRes.error) throw entradasRes.error;
      if (presentesRes.error) throw presentesRes.error;
      if (trabajadoresRes.error) throw trabajadoresRes.error;

      // Fruta: €/kg all-in = Σ importe_total / Σ kg_entrada del lote (una
      // entrada por lote en la práctica; si hubiera varias, se agregan).
      // importe_total nulo o 0 = lote sin liquidar → eurKg null (null ≠ 0).
      const acumulado = new Map<string, { kg: number; importe: number; conImporte: boolean }>();
      for (const e of entradasRes.data ?? []) {
        const clave = normalizarLoteCodigo(e.lote);
        if (!clave) continue;
        const acc = acumulado.get(clave) ?? { kg: 0, importe: 0, conImporte: false };
        acc.kg += e.kg_entrada ?? 0;
        if (e.importe_total != null && e.importe_total > 0) {
          acc.importe += e.importe_total;
          acc.conImporte = true;
        }
        acumulado.set(clave, acc);
      }
      const frutaPorLote = new Map<string, FrutaLoteRentabilidad>();
      for (const [clave, acc] of acumulado) {
        frutaPorLote.set(clave, { eurKg: acc.conImporte && acc.kg > 0 ? acc.importe / acc.kg : null });
      }
      const lotesSinEntrada = clavesLote.filter((c) => !acumulado.has(c));

      const costePorTrabajador = new Map(
        ((trabajadoresRes.data ?? []) as TrabajadorCosteRow[]).map((t) => [t.id, t.coste_hora]),
      );
      let sumaCosteHoraConocida = 0;
      let presentesSinCoste = 0;
      const presentes = presentesRes.data ?? [];
      for (const p of presentes) {
        const coste = costePorTrabajador.get(p.trabajador_id);
        if (coste != null) sumaCosteHoraConocida += coste;
        else presentesSinCoste += 1;
      }

      return {
        filas,
        frutaPorLote,
        lotesSinEntrada,
        personal: { presentes: presentes.length, sumaCosteHoraConocida, presentesSinCoste },
        semanaMdna,
      };
    },
  });
}

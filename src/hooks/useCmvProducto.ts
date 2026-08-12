/**
 * useCmvProducto — datos de "Económico → Coste por producto".
 *
 * Trabaja sobre un RANGO de fechas, no sobre un día suelto: el dueño quiere
 * arrancar por semanas (la del 27-jul al 2-ago de 2026 es la primera) y bajar
 * a día cuando algo llame la atención (07-ago-2026). Un día es simplemente el
 * rango [d, d], así que no hay dos caminos de cálculo que puedan divergir.
 *
 * El coste de TRATAMIENTO se acumula día a día dentro del rango, nunca se
 * extrapola: cada jornada aporta su propia asistencia (presentes × horas ×
 * su nómina) y su cuota de suministros. Una semana con un festivo cuesta lo
 * que cuestan sus días con gente, no 7 × un día tipo. Los suministros solo se
 * cobran los días CON producción, por el mismo motivo.
 *
 * El cálculo vive en la lib pura src/lib/cmvProducto.ts.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getISOWeek, getISOWeekYear } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/fetchAllRows";
import { normalizarLoteCodigo } from "@/lib/loteCodigo";
import { claveProducto } from "@/lib/productosCanonicos";
import {
  computeCmvProductoDia,
  type CmvDiaResultado,
  type FichaProducto,
  type FilaClasifProducto,
  type FrutaLoteProducto,
} from "@/lib/cmvProducto";
import {
  COSTE_HORA_MEDIO_DEFECTO,
  HORAS_JORNADA_DEFECTO,
  SUMINISTROS_DIA_DEFECTO_EUR,
} from "@/lib/rentabilidadDia";
import { useProductosCatalogo } from "@/hooks/useProductosCatalogo";
import type { SupabaseClient } from "@supabase/supabase-js";

// Cast local: cmv_costes_mensuales no está en el Database generado (mismo
// patrón que useCmv.ts / useEmpaquePrecios.ts — ver sus cabeceras).
const SUPA = supabase as unknown as SupabaseClient<any>;

// trabajadores.coste_hora no está en el Database generado (mismo cast local
// que useCostePersonal.ts / useRentabilidadDia.ts — ver sus cabeceras).
interface TrabajadorCosteRow {
  id: string;
  coste_hora: number | null;
}

// ─── Empaque conocido por producto (Informe PRODUCTO) ────────────────────────

/**
 * Empaque de cada producto, indexado por clave canónica. Sale de producto_dia
 * (Informe PRODUCTO), que es el único sitio donde el empaque existe — el
 * Informe LOTE no lo trae.
 *
 * COBERTURA PARCIAL CONOCIDA: producto_dia solo cubre desde el 21-may-2026
 * (482 de los 978 productos del catálogo). Los productos anteriores salen sin
 * empaque y, por tanto, sin kg por bulto deducido: su ficha necesita que el
 * dueño teclee el kg/bulto a mano, o que se importen los Informe PRODUCTO
 * antiguos. La página lo dice en vez de imputar material 0.
 *
 * Gana el empaque con más kg de cada producto: uno puede haberse envasado en
 * dos cajas distintas a lo largo de la campaña y hay que quedarse con la
 * habitual (y de forma determinista, ver el desempate).
 */
export function useEmpaquePorProducto() {
  return useQuery({
    queryKey: ["productos-empaque"],
    staleTime: 30 * 60 * 1000,
    queryFn: async (): Promise<Map<string, string>> => {
      const filas = await fetchAllRows<{ producto: string | null; formato_caja: string | null; kg: number | null }>(
        (from, to) =>
          supabase
            .from("producto_dia")
            .select("producto, formato_caja, kg")
            .not("producto", "is", null)
            .not("formato_caja", "is", null)
            .order("id")
            .range(from, to),
      );

      const acc = new Map<string, Map<string, number>>();
      for (const f of filas) {
        const clave = claveProducto(f.producto);
        const empaque = (f.formato_caja ?? "").trim();
        if (!clave || !empaque) continue;
        const porEmpaque = acc.get(clave) ?? new Map<string, number>();
        porEmpaque.set(empaque, (porEmpaque.get(empaque) ?? 0) + (f.kg ?? 0));
        acc.set(clave, porEmpaque);
      }

      const out = new Map<string, string>();
      for (const [clave, porEmpaque] of acc) {
        let mejor: { empaque: string; kg: number } | null = null;
        for (const [empaque, kg] of porEmpaque) {
          // Desempate determinista: más kg, luego alfabético.
          if (!mejor || kg > mejor.kg || (kg === mejor.kg && empaque < mejor.empaque)) {
            mejor = { empaque, kg };
          }
        }
        if (mejor) out.set(clave, mejor.empaque);
      }
      return out;
    },
  });
}

// ─── Precio real por método de venta ─────────────────────────────────────────

export interface PreciosMetodo {
  precios: Map<string, number>;
  /** Semana Mercadona de la que salieron los precios MA*, para poder decirlo en la UI. */
  semanaMdna: { anio: number; semana: number; esLaSemanaDeLaFecha: boolean } | null;
}

/**
 * €/kg REAL por método: base_iva / kilos.
 *
 * - Mercadona (MA3KGC…): de la semana del FIN del rango, con fallback a la
 *   última semana anterior CON base facturada (una semana importada solo con
 *   la planificación tiene base_iva 0 y no debe fijar un precio de 0 €).
 * - ERP (LN211, LN314…): del acumulado de ventas_categoria_productos. Es un
 *   precio medio de campaña, no del periodo: el catálogo de métodos no llega
 *   con granularidad diaria. Sirve como referencia hasta que el dueño ponga
 *   uno manual en la ficha, y la UI lo marca como tal.
 */
export function usePreciosPorMetodo(hasta: string | null) {
  return useQuery({
    queryKey: ["productos-precios-metodo", hasta],
    enabled: !!hasta,
    queryFn: async (): Promise<PreciosMetodo> => {
      const date = new Date(`${hasta}T12:00:00`);
      const anioObjetivo = getISOWeekYear(date);
      const semanaObjetivo = getISOWeek(date);

      const [semanasRes, erpRes] = await Promise.all([
        supabase
          .from("mercadona_semanas")
          .select("id, anio, semana")
          .order("anio", { ascending: false })
          .order("semana", { ascending: false }),
        supabase.from("ventas_categoria_productos").select("metodo, kilos, base_iva"),
      ]);
      if (semanasRes.error) throw semanasRes.error;
      if (erpRes.error) throw erpRes.error;

      const precios = new Map<string, number>();

      // ERP primero: Mercadona lo pisa si coincidiera (hoy no coinciden, pero
      // el precio semanal es más fresco que el acumulado de campaña).
      for (const p of erpRes.data ?? []) {
        const metodo = (p.metodo ?? "").trim().toUpperCase();
        const kilos = p.kilos ?? 0;
        const base = p.base_iva ?? 0;
        if (metodo && kilos > 0 && base > 0) precios.set(metodo, base / kilos);
      }

      let semanaMdna: PreciosMetodo["semanaMdna"] = null;
      const candidatas = (semanasRes.data ?? [])
        .filter((s) => s.anio < anioObjetivo || (s.anio === anioObjetivo && s.semana <= semanaObjetivo))
        .slice(0, 6);
      for (const s of candidatas) {
        const { data: metodos, error } = await supabase
          .from("mercadona_semana_metodos")
          .select("metodo, kilos, base_iva")
          .eq("semana_id", s.id);
        if (error) throw error;
        const utiles = (metodos ?? []).filter(
          (m) => (m.kilos ?? 0) > 0 && (m.base_iva ?? 0) > 0 && m.metodo,
        );
        if (utiles.length === 0) continue;
        for (const m of utiles) {
          precios.set((m.metodo ?? "").trim().toUpperCase(), (m.base_iva ?? 0) / (m.kilos ?? 1));
        }
        semanaMdna = {
          anio: s.anio,
          semana: s.semana,
          esLaSemanaDeLaFecha: s.anio === anioObjetivo && s.semana === semanaObjetivo,
        };
        break;
      }

      return { precios, semanaMdna };
    },
  });
}

// ─── Estructura y transporte de salida (apuntes mensuales) ──────────────────

/**
 * Tipos de `cmv_costes_mensuales` que este módulo imputa como ESTRUCTURA.
 *
 * - `estructura`: alquiler, seguros, amortización, gestoría, financieros.
 * - `transporte_salida`: los portes a cliente que NO van ya descontados del
 *   precio. Ojo: el transporte pactado por cliente vive en
 *   `ventas_categoria_clientes_ajustes` y sale restado del precio de venta;
 *   aquí solo entra lo que se factura aparte, para no contarlo dos veces.
 * - `otros`: cualquier coste del mes que no capture ningún módulo.
 *
 * NO se imputan `personal_real` ni `suministros`: este módulo ya los calcula
 * por su cuenta desde la asistencia y desde el parámetro de suministros/día.
 * Sumarlos aquí los contaría dos veces.
 */
const TIPOS_ESTRUCTURA = ["estructura", "transporte_salida", "otros"] as const;

export interface EstructuraPeriodo {
  /** € imputados al periodo, prorrateados desde los meses que solapa. */
  importeEur: number;
  /** Desglose por tipo, para poder enseñarlo en vez de un total opaco. */
  porTipo: Array<{ tipo: string; importeEur: number }>;
  /** Meses que solapan el periodo y NO tienen ningún apunte de estos tipos. */
  mesesSinApuntes: string[];
}

/** Nº de días del mes "YYYY-MM". */
function diasDelMes(mes: string): number {
  const [y, m] = mes.split("-").map(Number);
  return new Date(y, m, 0).getDate();
}

/** Días del mes `mes` que caen dentro de [desde, hasta]. */
function diasSolapados(mes: string, desde: string, hasta: string): number {
  const ini = `${mes}-01`;
  const fin = `${mes}-${String(diasDelMes(mes)).padStart(2, "0")}`;
  const a = desde > ini ? desde : ini;
  const b = hasta < fin ? hasta : fin;
  if (a > b) return 0;
  const ms = new Date(`${b}T12:00:00`).getTime() - new Date(`${a}T12:00:00`).getTime();
  return Math.round(ms / 86400000) + 1;
}

/**
 * Estructura del periodo: los apuntes mensuales prorrateados por DÍAS
 * NATURALES del mes que caen dentro del rango.
 *
 * Por días naturales y no por días de producción a propósito: el alquiler y el
 * seguro corren los siete días de la semana, se calibre o no. Prorratear por
 * días trabajados le cargaría a la semana de producción la estructura del fin
 * de semana, y una semana con festivo saldría artificialmente cara.
 */
export function useEstructuraPeriodo(desde: string | null, hasta: string | null) {
  return useQuery({
    queryKey: ["cmv-producto-estructura", desde, hasta],
    enabled: !!desde && !!hasta,
    queryFn: async (): Promise<EstructuraPeriodo> => {
      const meses = new Set<string>();
      for (let m = desde!.slice(0, 7); m <= hasta!.slice(0, 7); ) {
        meses.add(m);
        const [y, mm] = m.split("-").map(Number);
        const next = mm === 12 ? `${y + 1}-01` : `${y}-${String(mm + 1).padStart(2, "0")}`;
        m = next;
      }

      const { data, error } = await SUPA
        .from("cmv_costes_mensuales")
        .select("mes, tipo, importe")
        .in("mes", [...meses])
        .in("tipo", [...TIPOS_ESTRUCTURA]);
      // La tabla puede no existir todavía en algún entorno: se trata como
      // "sin apuntes" en vez de reventar la página entera.
      if (error) return { importeEur: 0, porTipo: [], mesesSinApuntes: [...meses] };

      const porTipo = new Map<string, number>();
      const mesesConApuntes = new Set<string>();
      let total = 0;
      for (const fila of (data ?? []) as Array<{ mes: string; tipo: string; importe: number | null }>) {
        const importe = fila.importe ?? 0;
        if (importe === 0) continue;
        const dias = diasSolapados(fila.mes, desde!, hasta!);
        if (dias === 0) continue;
        const cuota = importe * (dias / diasDelMes(fila.mes));
        porTipo.set(fila.tipo, (porTipo.get(fila.tipo) ?? 0) + cuota);
        mesesConApuntes.add(fila.mes);
        total += cuota;
      }

      return {
        importeEur: total,
        porTipo: [...porTipo.entries()].map(([tipo, importeEur]) => ({ tipo, importeEur }))
          .sort((a, b) => b.importeEur - a.importeEur),
        mesesSinApuntes: [...meses].filter((m) => !mesesConApuntes.has(m)),
      };
    },
  });
}

// ─── Datos crudos del rango ──────────────────────────────────────────────────

export interface DatosRangoProducto {
  filas: FilaClasifProducto[];
  frutaPorLote: Map<string, FrutaLoteProducto>;
  /** Lotes del rango cuya entrada de báscula no se encontró por su clave de 8 dígitos. */
  lotesSinEntrada: string[];
  /** Días del rango con producción (filas de calibrador). */
  diasConProduccion: string[];
  /** Σ (presentes × su coste/hora conocido) de cada día, ya acumulado sobre el rango. */
  sumaCosteHoraRango: number;
  /** Σ presentes SIN coste/hora en su ficha, de todos los días del rango. */
  presentesSinCosteRango: number;
  /** Σ presentes de todos los días del rango (para poder decirlo en la UI). */
  presentesTotal: number;
  /** Días del rango con asistencia marcada. */
  diasConAsistencia: number;
}

export function useDatosRangoProducto(desde: string | null, hasta: string | null) {
  return useQuery({
    queryKey: ["cmv-producto-rango", desde, hasta],
    enabled: !!desde && !!hasta,
    queryFn: async (): Promise<DatosRangoProducto> => {
      // Una semana ronda las 7.000 filas de clasificación: fetchAllRows
      // obligatorio (PostgREST recorta a 1.000 en silencio, regla del repo).
      const filasRaw = await fetchAllRows<FilaClasifProducto & { fecha: string | null }>((from, to) =>
        supabase
          .from("lote_clasificacion")
          .select("lote_codigo, producto, clase, peso_kg, fecha")
          .gte("fecha", desde!)
          .lte("fecha", hasta!)
          .order("id")
          .range(from, to),
      );

      const diasConProduccion = [...new Set(filasRaw.map((f) => f.fecha).filter((d): d is string => !!d))].sort();
      const clavesLote = [...new Set(
        filasRaw.map((f) => normalizarLoteCodigo(f.lote_codigo)).filter((c): c is string => !!c),
      )];

      const [entradasRes, presentesRes, trabajadoresRes] = await Promise.all([
        clavesLote.length > 0
          ? fetchAllRows<{ lote: string | null; kg_entrada: number | null; importe_total: number | null }>((from, to) =>
              supabase
                .from("entradas_bascula")
                .select("lote, kg_entrada, importe_total")
                .in("lote", clavesLote)
                .order("id")
                .range(from, to),
            )
          : Promise.resolve([]),
        fetchAllRows<{ trabajador_id: string; date: string }>((from, to) =>
          supabase
            .from("asistencia_detalle")
            .select("trabajador_id, date")
            .gte("date", desde!)
            .lte("date", hasta!)
            .eq("presente", true)
            .order("id")
            .range(from, to),
        ),
        supabase.from("trabajadores").select("id, coste_hora"),
      ]);
      if (trabajadoresRes.error) throw trabajadoresRes.error;

      // Fruta: €/kg all-in = Σ importe_total / Σ kg_entrada del lote.
      // importe_total nulo o 0 = lote sin liquidar → eurKg null (null ≠ 0).
      const acumulado = new Map<string, { kg: number; importe: number; conImporte: boolean }>();
      for (const e of entradasRes) {
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
      const frutaPorLote = new Map<string, FrutaLoteProducto>();
      for (const [clave, acc] of acumulado) {
        frutaPorLote.set(clave, { eurKg: acc.conImporte && acc.kg > 0 ? acc.importe / acc.kg : null });
      }

      const costePorTrabajador = new Map(
        ((trabajadoresRes.data ?? []) as TrabajadorCosteRow[]).map((t) => [t.id, t.coste_hora]),
      );
      let sumaCosteHoraRango = 0;
      let presentesSinCosteRango = 0;
      const diasAsistencia = new Set<string>();
      for (const p of presentesRes) {
        diasAsistencia.add(p.date);
        const coste = costePorTrabajador.get(p.trabajador_id);
        if (coste != null) sumaCosteHoraRango += coste;
        else presentesSinCosteRango += 1;
      }

      return {
        filas: filasRaw.map(({ lote_codigo, producto, clase, peso_kg }) => ({
          lote_codigo, producto, clase, peso_kg,
        })),
        frutaPorLote,
        lotesSinEntrada: clavesLote.filter((c) => !acumulado.has(c)),
        diasConProduccion,
        sumaCosteHoraRango,
        presentesSinCosteRango,
        presentesTotal: presentesRes.length,
        diasConAsistencia: diasAsistencia.size,
      };
    },
  });
}

// ─── El rango completo ───────────────────────────────────────────────────────

/**
 * Recargo de Seguridad Social a cuenta de la empresa, como fracción del
 * salario bruto (0,35 = 35 %).
 *
 * Hace falta porque `trabajadores.coste_hora` es el **bruto por hora**, no el
 * coste empresa: los 31 trabajadores con coste cargado van de 8,00 a 10,80
 * €/h (mediana 8,10), y un coste empresa real estaría entre 11 y 14. Sin este
 * recargo, el personal —y con él el CMV— sale corto en más de un tercio.
 *
 * Es una decisión del dueño (07-ago-2026: "incluye Seguridad Social"). El 35 %
 * es la horquilla habitual del régimen general con contingencias comunes,
 * desempleo, FOGASA y formación; es editable en la página porque el tipo real
 * depende del convenio y de las bonificaciones de cada contrato.
 *
 * OJO: `src/lib/rentabilidadDia.ts` sigue SIN Seguridad Social a propósito —
 * su metodología está validada contra los informes entregados al dueño y
 * cambiarla movería números ya dados por buenos. Por eso la constante vive
 * aquí y no allí: los dos módulos NO tienen que dar el mismo beneficio, y la
 * diferencia entre ambos es exactamente este recargo.
 */
export const PCT_SEGURIDAD_SOCIAL_DEFECTO = 0.35;

export interface OpcionesCmvProductoRango {
  /** Horas de jornada para el coste de personal (mismo default que Rentabilidad). */
  horasJornada: number;
  /** €/h BRUTOS de los presentes sin coste de nómina cargado. */
  costeHoraMedio: number;
  /** Recargo de Seguridad Social sobre el bruto (fracción, no %). */
  pctSeguridadSocial: number;
  /** Suministros + consumibles POR DÍA con producción, en €. */
  suministrosDiaEur: number;
}

export const OPCIONES_DEFECTO: OpcionesCmvProductoRango = {
  horasJornada: HORAS_JORNADA_DEFECTO,
  costeHoraMedio: COSTE_HORA_MEDIO_DEFECTO,
  pctSeguridadSocial: PCT_SEGURIDAD_SOCIAL_DEFECTO,
  suministrosDiaEur: SUMINISTROS_DIA_DEFECTO_EUR,
};

export interface CmvProductoRangoHook {
  resultado: CmvDiaResultado | null;
  /** Desglose del tratamiento repartido, para poder explicarlo línea a línea. */
  tratamiento: {
    /** Salario bruto: Σ presentes × su €/h × horas de jornada. */
    personalBrutoEur: number;
    /** Recargo de Seguridad Social sobre el bruto. */
    seguridadSocialEur: number;
    /** bruto + Seguridad Social: el coste empresa. */
    personalEur: number;
    suministrosEur: number;
    totalEur: number;
    presentesTotal: number;
    diasConProduccion: number;
    diasConAsistencia: number;
    presentesSinCoste: number;
  };
  /** Estructura imputada al periodo, con su desglose y los meses sin apuntes. */
  estructura: EstructuraPeriodo;
  semanaMdna: PreciosMetodo["semanaMdna"];
  /** Productos del rango que todavía no tienen ficha en el catálogo. */
  productosSinFicha: string[];
  /** true si algún producto del rango no tiene empaque conocido. */
  sinEmpaqueConocido: boolean;
  lotesSinEntrada: string[];
  isLoading: boolean;
  sinPermiso: boolean;
  error: unknown;
}

export function useCmvProductoRango(
  desde: string | null,
  hasta: string | null,
  opciones: OpcionesCmvProductoRango = OPCIONES_DEFECTO,
): CmvProductoRangoHook {
  const datos = useDatosRangoProducto(desde, hasta);
  const catalogo = useProductosCatalogo();
  const empaques = useEmpaquePorProducto();
  const preciosMetodo = usePreciosPorMetodo(hasta);
  const estructura = useEstructuraPeriodo(desde, hasta);

  // Personal del RANGO: la suma de los presentes de cada día ya viene
  // acumulada, así que basta multiplicar por las horas de jornada una vez.
  // `coste_hora` es BRUTO, así que encima va el recargo de Seguridad Social
  // (ver PCT_SEGURIDAD_SOCIAL_DEFECTO). Se guardan las dos piezas por separado
  // para poder enseñar el desglose en vez de un total opaco.
  const personalBrutoEur = useMemo(() => {
    if (!datos.data) return 0;
    const { sumaCosteHoraRango, presentesSinCosteRango } = datos.data;
    return (sumaCosteHoraRango + presentesSinCosteRango * opciones.costeHoraMedio) * opciones.horasJornada;
  }, [datos.data, opciones.costeHoraMedio, opciones.horasJornada]);

  const seguridadSocialEur = personalBrutoEur * opciones.pctSeguridadSocial;
  const personalEur = personalBrutoEur + seguridadSocialEur;

  // Suministros: solo los días CON producción. Un domingo sin calibrador no
  // gasta luz de línea, y cobrárselo al rango encarecería el CMV sin motivo.
  const suministrosEur = useMemo(
    () => (datos.data?.diasConProduccion.length ?? 0) * opciones.suministrosDiaEur,
    [datos.data?.diasConProduccion.length, opciones.suministrosDiaEur],
  );

  const resultado = useMemo(() => {
    if (!datos.data) return null;
    const fichas = new Map<string, FichaProducto>();
    for (const [clave, f] of catalogo.porClave) fichas.set(clave, f);

    return computeCmvProductoDia(datos.data.filas, fichas, datos.data.frutaPorLote, {
      tratamientoDiaEur: personalEur + suministrosEur,
      empaquePorClave: empaques.data,
      precioPorMetodo: preciosMetodo.data?.precios,
      estructuraPeriodoEur: estructura.data?.importeEur ?? 0,
    });
  }, [datos.data, catalogo.porClave, personalEur, suministrosEur, empaques.data, preciosMetodo.data, estructura.data]);

  const productosSinFicha = useMemo(() => {
    if (!resultado) return [];
    return resultado.productos.filter((p) => !catalogo.porClave.has(p.clave)).map((p) => p.nombre);
  }, [resultado, catalogo.porClave]);

  const sinEmpaqueConocido = useMemo(() => {
    if (!resultado || !empaques.data) return false;
    return resultado.productos.some((p) => !p.excluido && !empaques.data!.has(p.clave));
  }, [resultado, empaques.data]);

  return {
    resultado,
    tratamiento: {
      personalBrutoEur,
      seguridadSocialEur,
      personalEur,
      suministrosEur,
      totalEur: personalEur + suministrosEur,
      presentesTotal: datos.data?.presentesTotal ?? 0,
      diasConProduccion: datos.data?.diasConProduccion.length ?? 0,
      diasConAsistencia: datos.data?.diasConAsistencia ?? 0,
      presentesSinCoste: datos.data?.presentesSinCosteRango ?? 0,
    },
    estructura: estructura.data ?? { importeEur: 0, porTipo: [], mesesSinApuntes: [] },
    semanaMdna: preciosMetodo.data?.semanaMdna ?? null,
    productosSinFicha,
    sinEmpaqueConocido,
    lotesSinEntrada: datos.data?.lotesSinEntrada ?? [],
    isLoading: datos.isLoading || catalogo.isLoading || empaques.isLoading || preciosMetodo.isLoading || estructura.isLoading,
    sinPermiso: catalogo.sinPermiso,
    error: datos.error ?? catalogo.error ?? empaques.error ?? preciosMetodo.error,
  };
}

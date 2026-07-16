/**
 * useEconomico — acceso a public.economico_precios (tarifas de recursos del
 * "modo económico") y cálculo de costes de un periodo cruzando esas tarifas
 * con los consumos físicos ya existentes.
 *
 * IMPORTANTE: economico_precios es una tabla NUEVA que NO existe todavia en
 * src/integrations/supabase/types.ts. Se usa el mismo patron que
 * src/hooks/useMercadonaVentas.ts / src/hooks/useRrhhDocs.ts: cast local
 * `SUPA` a SupabaseClient<any>. Cuando se regeneren los tipos, sustituir los
 * `as any`/`SUPA` por `Tables<"economico_precios">` y eliminar el cast.
 *
 * RLS: economico_precios SOLO es legible/editable por administración (incluso
 * el SELECT esta restringido). Si el usuario actual no es admin, Postgres
 * devuelve un error de permiso (42501) o PostgREST oculta la tabla
 * (PGRST301/302) — en ambos casos se detecta con `isPermissionError` y las
 * paginas degradan mostrando "Solo administración" en vez de un error crudo.
 *
 * REPARTO DE CONSUMOS (ver cabecera de src/lib/economico.ts para el porque):
 * - Agua: consumos_fisicos (recurso "agua"), reutilizando
 *   `buildDailyConsumptionRows` de src/lib/consumosFisicos.ts para heredar la
 *   regla de subcontadores (tratamiento/tratamiento+jabon no suman) y el
 *   reparto de lecturas multi-dia — NO se reimplementa esa logica aqui.
 * - Gasoil/electricidad/quimicos: sesiones_consumo, repartida por solape de
 *   dias con el rango pedido via `solapeCantidadEnRango` (src/lib/economico.ts).
 * - Kg producidos: partes_diarios, produccion real via `kgProducidosParte`
 *   (misma formula que usa consumosFisicos.ts: kg_produccion_calibrador menos
 *   mujeres y reciclado de mallas Z1/Z2).
 * - Compra de fruta: entradas_bascula (precio_compra/recoleccion/transporte/
 *   comision/importe_total), ver `useCosteFruta` mas abajo y la logica pura
 *   en `agregarCosteFruta` (src/lib/economico.ts).
 */
import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useAuth } from "@/contexts/AuthProvider";
import { supabase } from "@/integrations/supabase/client";
import { toError } from "@/lib/errorMessage";
import { fetchAllRows } from "@/lib/fetchAllRows";
import { today } from "@/lib/format";
import {
  buildDailyConsumptionRows,
  kgProducidosParte,
  type ParteKgInput,
} from "@/lib/consumosFisicos";
import {
  agregarCosteFruta,
  agregarCostesPorRecurso,
  agregarCostesPorSemana,
  importeEntradaFruta,
  mesesEnRango,
  solapeCantidadEnRango,
  tarifaVigente,
  type AgregadoCosteFruta,
  type CosteEntrada,
  type CostePorRecurso,
  type CosteSemana,
} from "@/lib/economico";
import type { ConsumoFisicoRow, SesionConsumoRow } from "@/lib/types";
import { esEntradaCampoCit, esEntradaPrecalibrado } from "@/lib/productoresCanonicos";
import { useMercadonaVentas, type MercadonaSemanaConMetodos } from "@/hooks/useMercadonaVentas";
import { useCosteMallas, type CosteMallasPeriodo } from "@/hooks/useCosteMallas";
import { type GastoMallasSemana } from "@/lib/costeMallas";
import { mercadonaWeekDateRange } from "@/lib/mercadonaVentas";
import { METODOS_ORDEN } from "@/components/mercadona/mercadonaAnalisis.helpers";
import { useCostePersonal, type CostePersonal } from "@/hooks/useCostePersonal";
import { useEmpaquePrecios } from "@/hooks/useEmpaquePrecios";
import { useVentasCategoria } from "@/hooks/useVentasCategoria";

// Cast local: la tabla economico_precios aun no esta en el Database generado.
// Ver comentario de cabecera para el plan de retirada de este cast.
const SUPA = supabase as unknown as SupabaseClient<any>;

const PERMISSION_ERROR_CODES = new Set(["42501", "PGRST301", "PGRST302"]);

/** Distingue "sin permiso RLS" (degradar con aviso) de otros errores (relanzar). */
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

export type EconomicoRecurso = "agua" | "electricidad" | "gasoil" | "quimicos";

export interface EconomicoPrecioRow {
  id: string;
  user_id: string;
  recurso: string;
  unidad: string;
  precio_por_unidad: number;
  vigente_desde: string;
  notas: string | null;
}

export interface NuevaTarifaInput {
  recurso: string;
  unidad: string;
  precio_por_unidad: number;
  vigente_desde: string;
  notas: string | null;
}

export type EditarTarifaInput = NuevaTarifaInput & { id: string };

// ─── Tarifas ─────────────────────────────────────────────────────────────────

/**
 * Listado de tarifas + altas/edicion/borrado. Editar/borrar una fila existente
 * solo tiene sentido para corregir una errata: para un cambio real de precio
 * hay que dar de alta una fila nueva con `vigente_desde` en la fecha del
 * cambio (ver `crear`), nunca editar la tarifa anterior.
 */
export function usePreciosRecursos() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const baseKey = ["economico-precios"] as const;

  const query = useQuery({
    queryKey: baseKey,
    queryFn: async (): Promise<EconomicoPrecioRow[]> => {
      const { data, error } = await SUPA
        .from("economico_precios")
        .select("*")
        .order("recurso", { ascending: true })
        .order("vigente_desde", { ascending: false });
      if (error) throw error;
      return (data ?? []) as EconomicoPrecioRow[];
    },
    enabled: Boolean(user),
    retry: (failureCount, error) => (isPermissionError(error) ? false : failureCount < 2),
  });

  const sinPermiso = isPermissionError(query.error);
  const precios = useMemo(() => query.data ?? [], [query.data]);

  const recursos = useMemo(
    () => Array.from(new Set(precios.map((p) => p.recurso))).sort(),
    [precios],
  );

  /** Tarifa vigente HOY por recurso, para la tabla "tarifas vigentes". */
  const vigentesPorRecurso = useMemo(() => {
    const map = new Map<string, EconomicoPrecioRow>();
    const hoy = today();
    for (const recurso of recursos) {
      const vigente = tarifaVigente(precios, recurso, hoy);
      if (vigente) map.set(recurso, vigente);
    }
    return map;
  }, [precios, recursos]);

  /** Historico completo por recurso, mas reciente primero. */
  const historicoPorRecurso = useMemo(() => {
    const map = new Map<string, EconomicoPrecioRow[]>();
    for (const p of precios) {
      const list = map.get(p.recurso) ?? [];
      list.push(p);
      map.set(p.recurso, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => b.vigente_desde.localeCompare(a.vigente_desde));
    }
    return map;
  }, [precios]);

  const hayPrecioCero = useMemo(
    () => recursos.some((recurso) => (vigentesPorRecurso.get(recurso)?.precio_por_unidad ?? 0) === 0),
    [recursos, vigentesPorRecurso],
  );

  const crear = useMutation({
    mutationFn: async (input: NuevaTarifaInput) => {
      if (!user) throw new Error("Debes iniciar sesion para registrar una tarifa.");
      const { error } = await SUPA.from("economico_precios").insert({
        user_id: user.id,
        recurso: input.recurso,
        unidad: input.unidad,
        precio_por_unidad: input.precio_por_unidad,
        vigente_desde: input.vigente_desde,
        notas: input.notas,
      });
      if (error) throw toError(error);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: baseKey });
    },
  });

  /** Editar una tarifa existente: pensado para corregir una errata, no para un cambio de precio real. */
  const editar = useMutation({
    mutationFn: async (input: EditarTarifaInput) => {
      const { id, ...patch } = input;
      const { error } = await SUPA
        .from("economico_precios")
        .update({
          recurso: patch.recurso,
          unidad: patch.unidad,
          precio_por_unidad: patch.precio_por_unidad,
          vigente_desde: patch.vigente_desde,
          notas: patch.notas,
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
      const { error } = await SUPA.from("economico_precios").delete().eq("id", id);
      if (error) throw toError(error);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: baseKey });
    },
  });

  return {
    precios,
    recursos,
    vigentesPorRecurso,
    historicoPorRecurso,
    hayPrecioCero,
    isLoading: query.isLoading,
    sinPermiso,
    crear,
    editar,
    borrar,
  };
}

// ─── Costes de un periodo ────────────────────────────────────────────────────

export interface CostesPeriodo {
  porRecurso: CostePorRecurso[];
  costeTotal: number;
  kgProducidos: number;
  costePorKg: number | null;
  hayPreciosACero: boolean;
  serieSemanal: CosteSemana[];
  isLoading: boolean;
  sinPermiso: boolean;
}

/**
 * Costes de [desde, hasta] cruzando consumos fisicos (agua via
 * consumos_fisicos, resto via sesiones_consumo) con las tarifas vigentes en
 * cada fecha. `sinPermiso` refleja el mismo acceso restringido que
 * `usePreciosRecursos` (sin tarifas visibles no hay coste que calcular).
 */
export function useCostesPeriodo(desde: string, hasta: string): CostesPeriodo {
  const { user } = useAuth();
  const { precios, sinPermiso, isLoading: loadingPrecios } = usePreciosRecursos();

  const consumosAguaQuery = useQuery({
    queryKey: ["economico-consumos-agua", user?.id, desde, hasta],
    queryFn: async (): Promise<ConsumoFisicoRow[]> => {
      const { data, error } = await supabase
        .from("consumos_fisicos")
        .select("*")
        .eq("recurso", "agua")
        .lte("fecha_inicio", hasta)
        .gte("fecha_fin", desde);
      if (error) throw toError(error);
      return (data ?? []) as ConsumoFisicoRow[];
    },
    enabled: Boolean(user) && !sinPermiso,
  });

  const sesionesQuery = useQuery({
    queryKey: ["economico-sesiones-consumo", user?.id, desde, hasta],
    queryFn: async (): Promise<SesionConsumoRow[]> => {
      const { data, error } = await supabase
        .from("sesiones_consumo")
        .select("*")
        .lte("fecha_inicio", hasta)
        .gte("fecha_fin", desde);
      if (error) throw toError(error);
      return (data ?? []) as SesionConsumoRow[];
    },
    enabled: Boolean(user) && !sinPermiso,
  });

  const partesQuery = useQuery({
    queryKey: ["economico-partes-diarios", user?.id, desde, hasta],
    queryFn: async (): Promise<ParteKgInput[]> => {
      // partes_diarios va camino de las 1.000 filas (creciendo): un rango
      // "toda la campaña" ya podría acercarse, se pagina por seguridad.
      return fetchAllRows<ParteKgInput & { id?: string }>((from, to) =>
        supabase
          .from("partes_diarios")
          .select("date, resumen_ia, kg_produccion_calibrador, kg_mujeres_calibrador, kg_reciclado_malla_z1, kg_reciclado_malla_z2, id")
          .gte("date", desde)
          .lte("date", hasta)
          .order("id")
          .range(from, to),
      );
    },
    enabled: Boolean(user) && !sinPermiso,
  });

  const partes = partesQuery.data ?? [];

  // Agua: reutiliza el reparto diario ya existente (subcontadores excluidos,
  // reparto de lecturas multi-dia por kg de produccion real del tramo).
  const aguaDailyRows = useMemo(() => {
    if (!consumosAguaQuery.data) return [];
    return buildDailyConsumptionRows({
      rangeStart: desde,
      rangeEnd: hasta,
      consumos: consumosAguaQuery.data,
      basesKg: [],
      partes,
    });
  }, [consumosAguaQuery.data, partes, desde, hasta]);

  const entradas = useMemo<CosteEntrada[]>(() => {
    const lista: CosteEntrada[] = [];

    for (const row of aguaDailyRows) {
      if (row.aguaL > 0) {
        lista.push({ recurso: "agua", fecha: row.periodo, cantidad: row.aguaL, unidadConsumo: "l" });
      }
    }

    for (const sesion of sesionesQuery.data ?? []) {
      // Dia de referencia para resolver la tarifa vigente: el fin de la sesion.
      const fecha = sesion.fecha_fin;

      const gasoilL = solapeCantidadEnRango(sesion.fecha_inicio, sesion.fecha_fin, sesion.gasoil_l, desde, hasta);
      if (gasoilL > 0) lista.push({ recurso: "gasoil", fecha, cantidad: gasoilL, unidadConsumo: "l" });

      const electricidadKwh = solapeCantidadEnRango(sesion.fecha_inicio, sesion.fecha_fin, sesion.electricidad_total_kwh, desde, hasta);
      if (electricidadKwh > 0) lista.push({ recurso: "electricidad", fecha, cantidad: electricidadKwh, unidadConsumo: "kwh" });

      const quimicosL = solapeCantidadEnRango(sesion.fecha_inicio, sesion.fecha_fin, sesion.quimicos_drencher_l, desde, hasta);
      if (quimicosL > 0) lista.push({ recurso: "quimicos", fecha, cantidad: quimicosL, unidadConsumo: "l" });
    }

    return lista;
  }, [aguaDailyRows, sesionesQuery.data, desde, hasta]);

  const porRecurso = useMemo(() => agregarCostesPorRecurso(entradas, precios), [entradas, precios]);
  const serieSemanal = useMemo(() => agregarCostesPorSemana(entradas, precios), [entradas, precios]);

  const costeTotal = useMemo(() => porRecurso.reduce((total, r) => total + r.coste, 0), [porRecurso]);
  const kgProducidos = useMemo(() => partes.reduce((total, p) => total + kgProducidosParte(p), 0), [partes]);
  const costePorKg = kgProducidos > 0 ? costeTotal / kgProducidos : null;
  const hayPreciosACero = porRecurso.some((r) => r.cantidad > 0 && r.coste === 0);

  const isLoading = loadingPrecios || consumosAguaQuery.isLoading || sesionesQuery.isLoading || partesQuery.isLoading;

  return {
    porRecurso,
    costeTotal,
    kgProducidos,
    costePorKg,
    hayPreciosACero,
    serieSemanal,
    isLoading,
    sinPermiso,
  };
}

// ─── Coste de compra de fruta (entradas_bascula) ────────────────────────────

interface EntradaBasculaFrutaRow {
  fecha: string;
  origen: string;
  kg_entrada: number;
  agricultor: string | null;
  finca: string | null;
  articulo: string | null;
  importe_compra: number | null;
  coste_recoleccion: number | null;
  importe_transporte: number | null;
  importe_comision: number | null;
  importe_total: number | null;
}

export interface CosteFrutaCampoCit {
  kg: number;
  importe: number;
  /** Nº de entradas (lotes) CAMPO/CIT del periodo. */
  lotes: number;
}

export interface CosteFrutaPeriodo extends AgregadoCosteFruta {
  isLoading: boolean;
  /** true si hay kg comprados por báscula en el periodo pero el importe total sale a 0 (export sin precios cargados). */
  faltanImportes: boolean;
  /**
   * Fruta "CAMPO/CIT" (esEntradaCampoCit, ver src/lib/productoresCanonicos.ts):
   * comprada pero derivada a Cítrica sin procesarse en la central (decisión
   * del dueño, 2026-07-16). Su kg/importe ya está INCLUIDO en `kgTotales`/
   * `totalImporte`/`desglose` de arriba (el gasto es real) — este campo es
   * solo el desglose para que Económico → Fruta la muestre como categoría
   * propia, sin que quede escondida dentro del total.
   */
  campoCit: CosteFrutaCampoCit;
}

/**
 * Coste de compra de fruta de [desde, hasta]: entradas_bascula del rango
 * (campo `fecha`), usando `importe_total` si el export lo trae relleno o la
 * suma de sus componentes en caso contrario (ver `importeEntradaFruta` en
 * src/lib/economico.ts). entradas_bascula ya está en el Database generado
 * (a diferencia de economico_precios/economico_mallas_config), así que no
 * hace falta el cast `SUPA`.
 *
 * CRITERIO stock_inicial: las filas sembradas desde el informe de stock
 * (`origen='stock_inicial'`, migración 20260713100000_entradas_bascula_origen.sql)
 * reconstruyen kg de cámara que YA estaban en planta antes de empezar a
 * registrar entradas reales (ver `buildEntradasDesdeStock` en
 * src/lib/entradasBascula.ts) — nunca traen precio/importe (siempre null)
 * porque no representan una compra real dentro de ningún periodo. Se
 * EXCLUYEN aquí: sumar su kg_entrada sin coste asociado inflaría los kg
 * "comprados" del periodo sin el importe correspondiente, distorsionando
 * cualquier €/kg calculado a partir de este coste (y atribuyendo stock
 * histórico a la fecha de creación del lote, que puede caer en cualquier
 * periodo consultado). Sus importes son 0 en la práctica, pero se filtran
 * explícitamente por si algún día se les carga un importe retroactivo.
 *
 * CRITERIO precalibrado (cierre definitivo, jul-2026): esta query es propia
 * (NO pasa por useEntradasBascula.ts), así que el filtro de
 * `esEntradaPrecalibrado` (src/lib/productoresCanonicos.ts) se repite aquí
 * sobre las mismas columnas agricultor/finca — las 278 filas de movimiento
 * interno al almacén de precalibrado no son una compra real, son fruta que
 * ya se contó en su entrada original volviendo a pasar por el almacén.
 * Contarlas aquí también inflaría kg y (si algún día llevan importe
 * cargado) €, duplicando el coste de la misma fruta.
 *
 * CRITERIO CAMPO/CIT (decisión del dueño, 2026-07-16): a diferencia del
 * precalibrado, estas filas NO se excluyen de `entradas` — su compra es un
 * gasto real (se le pagó al agricultor), así que kgTotales/totalImporte/
 * desglose deben seguir contándolas. Se calculan aparte en `campoCit` (con
 * `esEntradaCampoCit`, mismo criterio que useEntradasBascula.ts) solo para
 * poder mostrarlas como categoría propia en Económico → Fruta.
 */
export function useCosteFruta(desde: string, hasta: string): CosteFrutaPeriodo {
  const { user } = useAuth();

  const query = useQuery({
    queryKey: ["economico-entradas-bascula", user?.id, desde, hasta],
    queryFn: async (): Promise<EntradaBasculaFrutaRow[]> => {
      // entradas_bascula ya tiene 1.276 filas tras el histórico de campaña:
      // un rango amplio (p. ej. "toda la campaña" en el selector de periodo)
      // puede devolver más de 1.000. Se pagina con fetchAllRows.
      return fetchAllRows<EntradaBasculaFrutaRow>((from, to) =>
        supabase
          .from("entradas_bascula")
          .select("fecha, origen, kg_entrada, agricultor, finca, articulo, importe_compra, coste_recoleccion, importe_transporte, importe_comision, importe_total")
          .gte("fecha", desde)
          .lte("fecha", hasta)
          .order("id")
          .range(from, to),
      );
    },
    enabled: Boolean(user),
  });

  const entradas = useMemo(
    () => (query.data ?? []).filter((row) => row.origen !== "stock_inicial" && !esEntradaPrecalibrado(row)),
    [query.data],
  );

  const agregado = useMemo(() => agregarCosteFruta(entradas), [entradas]);
  const faltanImportes = agregado.kgTotales > 0 && agregado.totalImporte === 0;

  const campoCit = useMemo<CosteFrutaCampoCit>(() => {
    const filas = entradas.filter((row) => esEntradaCampoCit(row));
    return {
      kg: filas.reduce((s, row) => s + (Number(row.kg_entrada) || 0), 0),
      importe: filas.reduce((s, row) => s + importeEntradaFruta(row), 0),
      lotes: filas.length,
    };
  }, [entradas]);

  return {
    ...agregado,
    isLoading: query.isLoading,
    faltanImportes,
    campoCit,
  };
}

// ─── Panel económico: costes + facturación Mercadona del periodo ────────────
//
// Composición de usePreciosRecursos/useCostesPeriodo (ya usados por
// Costes/Precios) con useMercadonaVentas (ya usado por Facturación) para dar
// el cruce facturación-vs-coste que necesita el dashboard de portada. No
// sustituye a ninguno de los hooks anteriores: EconomicoFacturacion/Costes/
// Precios siguen llamando a los suyos tal cual.

/**
 * true si la semana trae base_iva real (formato semanal real, v2), no el
 * histórico. Exportado: src/hooks/useDireccionDashboard.ts reutiliza esta
 * misma función en vez de mantener una copia local (mismo criterio).
 */
export function tieneBaseIvaSemana(semana: MercadonaSemanaConMetodos): boolean {
  return semana.metodos.some((m) => m.base_iva != null) || semana.ajustes_base_iva != null;
}

/**
 * true si el rango [desde, hasta] de la semana solapa con [rangoStart, rangoEnd].
 * Exportado por el mismo motivo que `tieneBaseIvaSemana` (ver useDireccionDashboard.ts).
 */
export function solapaRango(desde: string, hasta: string, rangoStart: string, rangoEnd: string): boolean {
  return desde <= rangoEnd && hasta >= rangoStart;
}

export interface EconomicoSemanaFacturacion {
  id: string;
  anio: number;
  semana: number;
  /** Base IVA de métodos + ajustes/abonos de la semana. */
  neto: number;
  vendidoKg: number;
  /** Lunes de la semana (rango L-S de Mercadona). */
  desde: string;
  /** Sábado de la semana. */
  hasta: string;
}

/** Exportado por el mismo motivo que `tieneBaseIvaSemana`/`solapaRango` (ver useDireccionDashboard.ts). */
export function buildSemanaFacturacion(s: MercadonaSemanaConMetodos): EconomicoSemanaFacturacion {
  const facturacionMetodos = s.metodos.reduce((sum, m) => sum + (m.base_iva ?? 0), 0);
  const neto = facturacionMetodos + (s.ajustes_base_iva ?? 0);
  const { desde, hasta } = mercadonaWeekDateRange(s.anio, s.semana);
  return { id: s.id, anio: s.anio, semana: s.semana, neto, vendidoKg: s.vendido_kg ?? 0, desde, hasta };
}

export interface EconomicoMetodoResumen {
  metodo: string;
  kilos: number;
  baseIva: number;
  eurosPorKg: number | null;
}

/** Facturación agregada por método (kg + base IVA) de las semanas dadas, en el orden habitual de METODOS_ORDEN. */
function buildMetodosResumen(semanas: MercadonaSemanaConMetodos[]): EconomicoMetodoResumen[] {
  const acc = new Map<string, { kilos: number; baseIva: number }>();
  for (const semana of semanas) {
    for (const m of semana.metodos) {
      if (m.base_iva == null) continue;
      const entry = acc.get(m.metodo) ?? { kilos: 0, baseIva: 0 };
      entry.kilos += m.kilos ?? 0;
      entry.baseIva += m.base_iva;
      acc.set(m.metodo, entry);
    }
  }
  const codigos = Array.from(new Set([...METODOS_ORDEN, ...acc.keys()])).filter((codigo) => acc.has(codigo));
  return codigos.map((codigo) => {
    const entry = acc.get(codigo)!;
    return {
      metodo: codigo,
      kilos: entry.kilos,
      baseIva: entry.baseIva,
      eurosPorKg: entry.kilos > 0 ? entry.baseIva / entry.kilos : null,
    };
  });
}

export interface EconomicoSerieSemanaCombinada {
  /** Lunes de la semana (clave común entre facturación Mercadona y coste de consumos). */
  semanaInicio: string;
  facturacion: number;
  /** Coste de consumos (agua/gasoil/electricidad/quimicos), sin mallas. */
  costeConsumos: number;
  /** Gasto de mallas rotas de la semana (serie propia para que se vea en el grafico). */
  mallas: number;
  /** costeConsumos + mallas, para el dominio del eje y el margen. */
  coste: number;
  margen: number;
}

/**
 * Combina la facturación semanal de Mercadona (clave = lunes de su rango L-S)
 * con `serieSemanal` de `useCostesPeriodo` (clave = lunes ISO) para el gráfico
 * de evolución. Ambas claves son el mismo lunes local, así que casan sin
 * conversión adicional.
 */
function buildSerieCombinada(
  facturacionSemanas: EconomicoSemanaFacturacion[],
  costesSerie: CosteSemana[],
  mallasSerie: GastoMallasSemana[] = [],
): EconomicoSerieSemanaCombinada[] {
  const map = new Map<string, { facturacion: number; costeConsumos: number; mallas: number }>();
  for (const s of facturacionSemanas) {
    const entry = map.get(s.desde) ?? { facturacion: 0, costeConsumos: 0, mallas: 0 };
    entry.facturacion += s.neto;
    map.set(s.desde, entry);
  }
  for (const c of costesSerie) {
    const entry = map.get(c.semanaInicio) ?? { facturacion: 0, costeConsumos: 0, mallas: 0 };
    entry.costeConsumos += c.coste;
    map.set(c.semanaInicio, entry);
  }
  // El gasto de mallas rotas tiene su propia serie (misma clave: lunes local) para
  // que se vea diferenciado en el grafico en vez de fundirse con el resto de costes.
  for (const m of mallasSerie) {
    const entry = map.get(m.semanaInicio) ?? { facturacion: 0, costeConsumos: 0, mallas: 0 };
    entry.mallas += m.gasto;
    map.set(m.semanaInicio, entry);
  }
  return Array.from(map.entries())
    .map(([semanaInicio, v]) => ({
      semanaInicio,
      facturacion: v.facturacion,
      costeConsumos: v.costeConsumos,
      mallas: v.mallas,
      coste: v.costeConsumos + v.mallas,
      margen: v.facturacion - v.costeConsumos - v.mallas,
    }))
    .sort((a, b) => a.semanaInicio.localeCompare(b.semanaInicio));
}

export interface EconomicoFacturacionSegunda {
  /** Suma de base_iva de "Categoria segunda" (importador mensual) de los meses que solapan el periodo. */
  total: number;
  isLoading: boolean;
  /** true si la categoría "Categoria segunda" ya existe (se ha importado alguna vez con el importador mensual). */
  disponible: boolean;
  /** Meses ("YYYY-MM") incluidos en `total` — informativo, para el labelInfo del KPI. */
  meses: string[];
}

export interface EconomicoPanelData {
  isLoading: boolean;
  /** Igual que `usePreciosRecursos().sinPermiso`: sin esto, ni tarifas ni costes se pueden calcular. */
  sinPermiso: boolean;
  hayPrecioCero: boolean;
  /** true si a la tarifa vigente de envasado (empaque_precios) le falta algún componente a precio 0. */
  hayPrecioCeroEmpaque: boolean;
  /** Las tablas mercadona_* aun no existen en esta instancia (ver useMercadonaVentas). */
  tablesMissingVentas: boolean;
  costes: CostesPeriodo;
  /** Gasto de mallas rotas del periodo (precio = coste total de envasado por malla). */
  mallas: CosteMallasPeriodo;
  /** Coste de compra de fruta del periodo (entradas_bascula). */
  costeFruta: CosteFrutaPeriodo;
  /** Coste de personal del periodo (mismo cálculo que Económico → Costes, ver useCostePersonal). */
  costePersonal: CostePersonal;
  /** costes.costeTotal + mallas.totalGasto. */
  costeTotalConMallas: number;
  /** costeTotalConMallas + costeFruta.totalImporte + costePersonal.total: coste total usado en margenBruto. */
  costeTotalPeriodo: number;
  /** Facturación Mercadona (base IVA de semanas que solapan el periodo). */
  facturacionRango: number;
  /** Ventas de categoría segunda (clientes fijos, NO Mercadona) de los meses que solapan el periodo. */
  facturacionSegunda: EconomicoFacturacionSegunda;
  /** facturacionRango + facturacionSegunda.total: facturación total usada en margenBruto. */
  facturacionTotalRango: number;
  vendidoKgRango: number;
  /** Base IVA Mercadona / vendido del periodo. Null si no hay kg vendidos con base IVA. */
  eurosPorKgMedio: number | null;
  /** facturacionTotalRango - consumos - mallas rotas - fruta - personal. No incluye envasado de la fruta buena vendida ni amortizaciones. */
  margenBruto: number;
  /** Semanas de Mercadona con base IVA que solapan el periodo, más reciente primero. */
  semanasEnRango: EconomicoSemanaFacturacion[];
  /** Facturación por método (MA12KGC/MA3KGC/...) agregada del periodo. */
  metodosDelPeriodo: EconomicoMetodoResumen[];
  /** Un punto por semana (lunes) con facturación, coste y margen, para el gráfico de evolución. */
  serieCombinada: EconomicoSerieSemanaCombinada[];
  /** `costes.porRecurso` con el coste/kg producido añadido. */
  porRecursoConKg: (CostePorRecurso & { costePorKg: number | null })[];
}

/**
 * Datos del dashboard de portada del Económico: cruza `useCostesPeriodo`
 * (agua/gasoil/electricidad/quimicos vs tarifas), `useCosteMallas`,
 * `useCosteFruta` y `useCostePersonal` (costes) con `useMercadonaVentas` +
 * `useVentasCategoria("Categoria segunda")` (facturación) para el periodo
 * [desde, hasta]. Pensado solo para EconomicoPanel — el resto de páginas del
 * espacio siguen usando los hooks de coste/facturación directamente.
 */
export function useEconomicoPanel(desde: string, hasta: string): EconomicoPanelData {
  const { hayPrecioCero, sinPermiso } = usePreciosRecursos();
  const costes = useCostesPeriodo(desde, hasta);
  const mallas = useCosteMallas(desde, hasta);
  const costeFruta = useCosteFruta(desde, hasta);
  const costePersonal = useCostePersonal(desde, hasta);
  const empaque = useEmpaquePrecios();
  const ventas = useMercadonaVentas();
  const segunda = useVentasCategoria("Categoria segunda");

  const semanasConBaseIva = useMemo(
    () => ventas.semanas.filter(tieneBaseIvaSemana),
    [ventas.semanas],
  );

  const semanasEnRangoRaw = useMemo(
    () => semanasConBaseIva.filter((s) => {
      const { desde: d, hasta: h } = mercadonaWeekDateRange(s.anio, s.semana);
      return solapaRango(d, h, desde, hasta);
    }),
    [semanasConBaseIva, desde, hasta],
  );

  const semanasEnRango = useMemo(
    () => semanasEnRangoRaw
      .map(buildSemanaFacturacion)
      .sort((a, b) => (b.anio - a.anio) || (b.semana - a.semana)),
    [semanasEnRangoRaw],
  );

  const facturacionRango = useMemo(() => semanasEnRango.reduce((sum, s) => sum + s.neto, 0), [semanasEnRango]);
  const vendidoKgRango = useMemo(() => semanasEnRango.reduce((sum, s) => sum + s.vendidoKg, 0), [semanasEnRango]);
  const eurosPorKgMedio = vendidoKgRango > 0 ? facturacionRango / vendidoKgRango : null;

  // Ventas de categoría segunda (dato MENSUAL del importador, no semanal, ver
  // ventasMensualImport.ts): se incluyen los meses que solapan el periodo,
  // enteros (ver mesesEnRango). No incluye Mercadona (MA* va siempre a la
  // categoría "mercadona" del importador), así que se suma sin doble conteo.
  const mesesDelRango = useMemo(() => mesesEnRango(desde, hasta), [desde, hasta]);
  const facturacionSegunda = useMemo<EconomicoFacturacionSegunda>(() => {
    const mesesSet = new Set(mesesDelRango);
    const filas = (segunda.mensualClienteQuery.data ?? []).filter((r) => r.mes != null && mesesSet.has(r.mes));
    return {
      total: filas.reduce((sum, r) => sum + (r.base_iva ?? 0), 0),
      isLoading: segunda.categoriasQuery.isLoading || segunda.mensualClienteQuery.isLoading,
      disponible: segunda.categoriaId != null,
      meses: mesesDelRango,
    };
  }, [segunda.mensualClienteQuery.data, segunda.categoriasQuery.isLoading, segunda.categoriaId, mesesDelRango]);

  const facturacionTotalRango = facturacionRango + facturacionSegunda.total;

  // El gasto de mallas rotas (envasado perdido) forma parte del coste del periodo.
  const costeTotalConMallas = costes.costeTotal + mallas.totalGasto;
  // Coste total usado en el margen: consumos + mallas + compra de fruta + personal.
  // Fuera quedan el envasado de la fruta BUENA vendida y las amortizaciones (ver
  // disclaimer del Panel).
  const costeTotalPeriodo = costeTotalConMallas + costeFruta.totalImporte + costePersonal.total;
  const margenBruto = facturacionTotalRango - costeTotalPeriodo;

  const metodosDelPeriodo = useMemo(() => buildMetodosResumen(semanasEnRangoRaw), [semanasEnRangoRaw]);

  const serieCombinada = useMemo(
    () => buildSerieCombinada(semanasEnRango, costes.serieSemanal, mallas.gastoPorSemana),
    [semanasEnRango, costes.serieSemanal, mallas.gastoPorSemana],
  );

  const porRecursoConKg = useMemo(
    () => costes.porRecurso.map((r) => ({
      ...r,
      costePorKg: costes.kgProducidos > 0 ? r.coste / costes.kgProducidos : null,
    })),
    [costes.porRecurso, costes.kgProducidos],
  );

  const isLoading = costes.isLoading || ventas.isLoading || mallas.isLoading
    || costeFruta.isLoading || costePersonal.isLoading || facturacionSegunda.isLoading || empaque.isLoading;

  return {
    isLoading,
    sinPermiso,
    hayPrecioCero,
    hayPrecioCeroEmpaque: empaque.hayPrecioCero,
    tablesMissingVentas: ventas.tablesMissing,
    costes,
    mallas,
    costeFruta,
    costePersonal,
    costeTotalConMallas,
    costeTotalPeriodo,
    facturacionRango,
    facturacionSegunda,
    facturacionTotalRango,
    vendidoKgRango,
    eurosPorKgMedio,
    margenBruto,
    semanasEnRango,
    metodosDelPeriodo,
    serieCombinada,
    porRecursoConKg,
  };
}

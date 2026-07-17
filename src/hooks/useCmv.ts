// src/hooks/useCmv.ts — datos de la página "Económico → CMV" (coste medio por
// kg VENDIDO del mes). Ver las reglas conceptuales en la cabecera de
// src/lib/cmv.ts (merma vía denominador, comparación contra pm_real).
//
// COMPOSICIÓN: este hook NO reimplementa ningún cálculo de coste — reutiliza
// los hooks del modo económico tal cual (useCostesPeriodo, useCosteMallas,
// useCosteFruta, useCostePersonal, useEmpaquePrecios) y les añade lo que
// faltaba para cerrar el escandallo:
//   - el denominador kg VENDIDOS del mes (Mercadona prorrateada por solape de
//     días + categorías 1ª y 2ª del importador mensual),
//   - el envasado de la fruta BUENA vendida (empaque_precios × mallas
//     vendidas por método — hasta ahora solo se costeaban las mallas ROTAS),
//   - los apuntes manuales mensuales (cmv_costes_mensuales: personal real de
//     gestoría, transporte de salida, estructura, otros).
//
// IMPORTANTE: cmv_costes_mensuales es una tabla NUEVA que no está en
// src/integrations/supabase/types.ts. Mismo patrón de cast local SUPA que
// useEconomico.ts/useEmpaquePrecios.ts; si la migración aún no está aplicada
// se expone `tablesMissing` y el CMV se calcula con 0 € manuales (avisando).
import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useAuth } from "@/contexts/AuthProvider";
import { supabase } from "@/integrations/supabase/client";
import { toError } from "@/lib/errorMessage";
import { fetchAllRows } from "@/lib/fetchAllRows";
import { today } from "@/lib/format";
import {
  calcularCmv,
  envasadoVendido,
  facturacionNetaCategoriasDelMes,
  fechaReferenciaEnvasadoDelMes,
  mesRango,
  ventasCategoriaDelMes,
  type CmvResultado,
  type CmvTipoCosteManual,
  type EnvasadoVendido,
  type VentasCategoriaMes,
} from "@/lib/cmv";
import { agregarCosteEmpaque } from "@/lib/costeEmpaque";
import {
  prorratearVentasMercadonaEnRango,
  type VentaMercadonaSemanaProrrateoInput,
} from "@/lib/economico";
import {
  solapaRango,
  tieneBaseIvaSemana,
  useCosteFruta,
  useCostesPeriodo,
  usePreciosRecursos,
  type CosteFrutaPeriodo,
  type CostesPeriodo,
} from "@/hooks/useEconomico";
import { useCostePersonal, type CostePersonal } from "@/hooks/useCostePersonal";
import { useCosteMallas, type CosteMallasPeriodo } from "@/hooks/useCosteMallas";
import { useEmpaquePrecios } from "@/hooks/useEmpaquePrecios";
import { useMercadonaVentas } from "@/hooks/useMercadonaVentas";
import { mercadonaWeekDateRange } from "@/lib/mercadonaVentas";
import { useVentasCategoria } from "@/hooks/useVentasCategoria";
import { esErrorTablaOColumnaInexistente } from "@/lib/productoresCanonicos";
import { isPermissionError } from "@/lib/supabaseErrors";

// Cast local: cmv_costes_mensuales aún no está en el Database generado.
const SUPA = supabase as unknown as SupabaseClient<any>;

// isPermissionError/esErrorTablaOColumnaInexistente: antes vivían como copias
// locales de este módulo (hallazgo #10). Se sustituyen por las versiones
// consolidadas: `isPermissionError` en src/lib/supabaseErrors.ts (mismo
// criterio 42501/PGRST301-302/401/403 — useRrhhDocs.ts la re-exporta pero se
// importa aquí directo de supabaseErrors.ts para no arrastrar pdf-lib/
// pdfjs-dist al bundle de Económico) y `esErrorTablaOColumnaInexistente` en
// src/lib/productoresCanonicos.ts (mismo criterio que el isTableMissingError
// local que sustituye, con más códigos: 42703/PGRST204 además de 42P01/PGRST205).
// El resto de hooks del modo económico (useEconomico.ts, useCosteMallas.ts,
// useEmpaquePrecios.ts) siguen con su propia copia de isPermissionError —
// consolidarlas queda para otra pasada.

// ─── Costes manuales mensuales (cmv_costes_mensuales) ───────────────────────

export interface CmvCosteMensualRow {
  id: string;
  user_id: string | null;
  mes: string;
  tipo: CmvTipoCosteManual;
  concepto: string | null;
  importe: number;
  notas: string | null;
  created_at: string;
}

export interface NuevoCmvCosteMensualInput {
  mes: string;
  tipo: CmvTipoCosteManual;
  concepto: string | null;
  importe: number;
  notas: string | null;
}

export type EditarCmvCosteMensualInput = NuevoCmvCosteMensualInput & { id: string };

/**
 * CRUD de los apuntes manuales del CMV. Se cargan TODOS los meses de una vez
 * (tabla pequeña: pocos apuntes al mes) y se filtra por mes en cliente, para
 * que el histórico y la navegación entre meses no relancen queries.
 */
export function useCmvCostesMensuales() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const baseKey = ["cmv-costes-mensuales"] as const;

  const query = useQuery({
    queryKey: baseKey,
    queryFn: async (): Promise<CmvCosteMensualRow[]> => {
      // Tabla pequeña hoy, pero sin fetchAllRows un SELECT sin filtro se
      // recorta en silencio a las 1.000 filas de PostgREST (ver cabecera de
      // fetchAllRows.ts) — con años de apuntes manuales podría superarlas.
      // Orden estable: mes desc (histórico reciente primero) + id como
      // desempate, para que la paginación no duplique/salte filas.
      return fetchAllRows<CmvCosteMensualRow>((from, to) =>
        SUPA
          .from("cmv_costes_mensuales")
          .select("*")
          .order("mes", { ascending: false })
          .order("id", { ascending: true })
          .range(from, to),
      );
    },
    enabled: Boolean(user),
    retry: (failureCount, error) =>
      (isPermissionError(error) || esErrorTablaOColumnaInexistente(error) ? false : failureCount < 2),
  });

  const sinPermiso = isPermissionError(query.error);
  const tablesMissing = esErrorTablaOColumnaInexistente(query.error);
  const rows = useMemo(() => query.data ?? [], [query.data]);

  const crear = useMutation({
    mutationFn: async (input: NuevoCmvCosteMensualInput) => {
      if (!user) throw new Error("Debes iniciar sesión para registrar un coste.");
      const { error } = await SUPA.from("cmv_costes_mensuales").insert({
        user_id: user.id,
        mes: input.mes,
        tipo: input.tipo,
        concepto: input.concepto,
        importe: input.importe,
        notas: input.notas,
      });
      if (error) throw toError(error);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: baseKey });
    },
  });

  const editar = useMutation({
    mutationFn: async (input: EditarCmvCosteMensualInput) => {
      const { id, ...patch } = input;
      const { error } = await SUPA
        .from("cmv_costes_mensuales")
        .update({
          mes: patch.mes,
          tipo: patch.tipo,
          concepto: patch.concepto,
          importe: patch.importe,
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
      const { error } = await SUPA.from("cmv_costes_mensuales").delete().eq("id", id);
      if (error) throw toError(error);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: baseKey });
    },
  });

  return {
    rows,
    isLoading: query.isLoading,
    sinPermiso,
    tablesMissing,
    crear,
    editar,
    borrar,
  };
}

/**
 * Tipo del hook de arriba, para pasarlo por props en vez de instanciarlo más
 * de una vez (antes EconomicoCmv.tsx lo llamaba 3 veces: la página,
 * `useCmvMes` y `CostesManualesCard` — react-query dedupe la query por clave,
 * pero no las mutaciones ni la suscripción del componente).
 */
export type CmvCostesMensuales = ReturnType<typeof useCmvCostesMensuales>;

// ─── CMV del mes ─────────────────────────────────────────────────────────────

export interface CmvVentasMercadonaMes {
  /** Kg vendidos del mes (vendido_kg semanal prorrateado por solape de días). */
  kg: number;
  /** Base IVA + ajustes/abonos, prorrateado igual. */
  facturacion: number;
  /** Nº de semanas con base IVA que solapan el mes. */
  semanas: number;
}

export interface CmvMesData {
  isLoading: boolean;
  /** Sin permiso en CUALQUIERA de las fuentes económicas (todo el CMV es solo-admin). */
  sinPermiso: boolean;
  /** La tabla cmv_costes_mensuales aún no existe (migración pendiente). */
  manualesTablesMissing: boolean;
  resultado: CmvResultado;
  /** Detalle del envasado calculado (por método) para el desglose de la UI. */
  envasado: EnvasadoVendido;
  mercadona: CmvVentasMercadonaMes;
  primera: VentasCategoriaMes;
  segunda: VentasCategoriaMes;
  /** Apuntes manuales del mes, para la tabla de gestión. */
  manualesDelMes: CmvCosteMensualRow[];
  /** Fuentes crudas, por si la página quiere enseñar detalle/avisos. */
  costes: CostesPeriodo;
  mallas: CosteMallasPeriodo;
  costeFruta: CosteFrutaPeriodo;
  costePersonal: CostePersonal;
  avisos: {
    /** Kg comprados sin importe en báscula (lotes pendientes de factura). */
    faltanImportesFruta: boolean;
    /** Alguna tarifa de recursos vigente a 0. */
    hayPrecioCeroTarifas: boolean;
    /** Algún componente de envasado vigente a 0. */
    hayPrecioCeroEmpaque: boolean;
    /** Kg vendidos en métodos sin envase configurado (granel 12 kg, girsac 4 kg). */
    kgEnvaseSinPrecio: number;
    /** No hay apunte de personal real: se usa la estimación por asistencia. */
    personalEstimado: boolean;
    /** El mes no tiene NINGÚN apunte manual (estructura/transporte salida sin registrar). */
    sinApuntesManuales: boolean;
    /** Nº de semanas de Mercadona del mes SIN base_iva (excluidas de kg/facturación). */
    semanasMercadonaSinBaseIva: number;
  };
}

/**
 * CMV completo del mes natural "YYYY-MM": compone los costes ya existentes
 * del modo económico con las ventas del mes y los apuntes manuales, y delega
 * el cálculo puro en calcularCmv (src/lib/cmv.ts).
 *
 * `manuales` se recibe por parámetro (instancia ÚNICA de
 * `useCmvCostesMensuales` creada por la página, ver EconomicoCmv.tsx) en vez
 * de llamarse aquí dentro: antes este hook, la página y `CostesManualesCard`
 * lo instanciaban cada uno por su cuenta (hallazgo #11).
 */
export function useCmvMes(mes: string, manuales: CmvCostesMensuales): CmvMesData {
  const { desde, hasta } = mesRango(mes);

  const costes = useCostesPeriodo(desde, hasta);
  const mallas = useCosteMallas(desde, hasta);
  const costeFruta = useCosteFruta(desde, hasta);
  const costePersonal = useCostePersonal(desde, hasta);
  const { hayPrecioCero } = usePreciosRecursos();
  const empaque = useEmpaquePrecios();
  const ventasMercadona = useMercadonaVentas();
  const primeraHook = useVentasCategoria("Categoria primera");
  const segundaHook = useVentasCategoria("Categoria segunda");

  // Mercadona es semanal (rango L-S): kg, facturación y kilos por método se
  // prorratean por solape de días con el mes con la función compartida de
  // economico.ts (extraída de aquí, ver su cabecera para el porqué de las
  // opciones — el CMV filtra por base_iva porque necesita €, a diferencia de
  // kgVendidosDerivados en consumosFisicos.ts, que mide kg físicos).
  const { mercadona, kilosPorMetodo } = useMemo(() => {
    const semanasInput: VentaMercadonaSemanaProrrateoInput[] = ventasMercadona.semanas.map((semana) => {
      const rango = mercadonaWeekDateRange(semana.anio, semana.semana);
      return {
        desde: rango.desde,
        hasta: rango.hasta,
        tieneBaseIva: tieneBaseIvaSemana(semana),
        vendidoKg: semana.vendido_kg ?? 0,
        baseIvaMetodos: semana.metodos.reduce((sum, m) => sum + (m.base_iva ?? 0), 0),
        ajustesBaseIva: semana.ajustes_base_iva ?? 0,
        metodos: semana.metodos.map((m) => ({ metodo: m.metodo, kilos: m.kilos ?? 0 })),
      };
    });
    const prorrateo = prorratearVentasMercadonaEnRango(
      semanasInput,
      desde,
      hasta,
      { soloConBaseIva: true, conFacturacion: true },
    );
    return {
      mercadona: { kg: prorrateo.kg, facturacion: prorrateo.facturacion, semanas: prorrateo.semanas } satisfies CmvVentasMercadonaMes,
      kilosPorMetodo: prorrateo.kilosPorMetodo,
    };
  }, [ventasMercadona.semanas, desde, hasta]);

  // Semanas del mes SIN base_iva (histórico o pendientes de importar): el
  // prorrateo de arriba ya las excluye (soloConBaseIva=true) — este conteo es
  // solo para avisar en la UI de que el mes está incompleto (hallazgo #3).
  const semanasMercadonaSinBaseIva = useMemo(() => {
    let count = 0;
    for (const semana of ventasMercadona.semanas) {
      if (tieneBaseIvaSemana(semana)) continue;
      const rango = mercadonaWeekDateRange(semana.anio, semana.semana);
      if (solapaRango(rango.desde, rango.hasta, desde, hasta)) count += 1;
    }
    return count;
  }, [ventasMercadona.semanas, desde, hasta]);

  // Categorías 1ª y 2ª: dato mensual del importador, valorado a pm_real (neto
  // de comisión/transporte de venta). No solapan con Mercadona: los métodos
  // MA* van siempre a la categoría "mercadona" del importador y esa no se
  // importa (ver ventasMensualImport.ts).
  const primera = useMemo(
    () => ventasCategoriaDelMes(primeraHook.mensualClienteQuery.data ?? [], mes),
    [primeraHook.mensualClienteQuery.data, mes],
  );
  const segunda = useMemo(
    () => ventasCategoriaDelMes(segundaHook.mensualClienteQuery.data ?? [], mes),
    [segundaHook.mensualClienteQuery.data, mes],
  );
  const categorias = useMemo(() => facturacionNetaCategoriasDelMes(primera, segunda), [primera, segunda]);

  // Envasado de la fruta vendida: mallas 3/5 kg de Mercadona, valoradas con la
  // vigencia de precio del MES consultado (fin de mes, u hoy si el mes llega
  // al futuro) — no con la vigente HOY (empaque.costesVigentes), para que el
  // escandallo de un mes CERRADO no cambie cada vez que sube el envasado
  // (hallazgo #1). Las ventas de categoría no llevan envase imputado
  // (formatos desconocidos) — limitación declarada de la Fase 1, visible en
  // la nota metodológica de la página.
  const fechaReferenciaEnvasado = fechaReferenciaEnvasadoDelMes(hasta, today());
  const costesEmpaqueDelMes = useMemo(
    () => agregarCosteEmpaque(empaque.precios, fechaReferenciaEnvasado),
    [empaque.precios, fechaReferenciaEnvasado],
  );
  const envasado = useMemo(
    () => envasadoVendido(
      kilosPorMetodo,
      costesEmpaqueDelMes.map((c) => ({ tipoMalla: c.tipoMalla, totalPorMalla: c.totalPorMalla })),
    ),
    [kilosPorMetodo, costesEmpaqueDelMes],
  );

  const manualesDelMes = useMemo(
    () => manuales.rows.filter((row) => row.mes === mes),
    [manuales.rows, mes],
  );

  const resultado = useMemo(() => {
    const sumaManual = (tipo: CmvTipoCosteManual): number =>
      manualesDelMes.filter((r) => r.tipo === tipo).reduce((sum, r) => sum + (Number(r.importe) || 0), 0);
    const hayPersonalReal = manualesDelMes.some((r) => r.tipo === "personal_real");
    return calcularCmv({
      fruta: costeFruta.totalImporte,
      consumos: costes.costeTotal,
      mallasRotas: mallas.totalGasto,
      personalEstimado: costePersonal.total,
      personalReal: hayPersonalReal ? sumaManual("personal_real") : null,
      envasado: envasado.total,
      transporteSalida: sumaManual("transporte_salida"),
      estructura: sumaManual("estructura"),
      otros: sumaManual("otros"),
      kgVendidos: mercadona.kg + categorias.kilos,
      facturacionReal: mercadona.facturacion + categorias.facturacionReal,
    });
  }, [
    manualesDelMes, costeFruta.totalImporte, costes.costeTotal, mallas.totalGasto,
    costePersonal.total, envasado.total, mercadona, categorias,
  ]);

  const isLoading = costes.isLoading || mallas.isLoading || costeFruta.isLoading
    || costePersonal.isLoading || empaque.isLoading || ventasMercadona.isLoading
    || primeraHook.mensualClienteQuery.isLoading || segundaHook.mensualClienteQuery.isLoading
    || manuales.isLoading;

  const sinPermiso = costes.sinPermiso || costePersonal.sinPermiso || mallas.sinPermiso
    || empaque.sinPermiso || manuales.sinPermiso;

  return {
    isLoading,
    sinPermiso,
    manualesTablesMissing: manuales.tablesMissing,
    resultado,
    envasado,
    mercadona,
    primera,
    segunda,
    manualesDelMes,
    costes,
    mallas,
    costeFruta,
    costePersonal,
    avisos: {
      faltanImportesFruta: costeFruta.faltanImportes,
      hayPrecioCeroTarifas: hayPrecioCero,
      hayPrecioCeroEmpaque: empaque.hayPrecioCero,
      kgEnvaseSinPrecio: envasado.kgSinPrecio,
      personalEstimado: !resultado.usaPersonalReal && costePersonal.total > 0,
      semanasMercadonaSinBaseIva,
      sinApuntesManuales: manualesDelMes.length === 0,
    },
  };
}

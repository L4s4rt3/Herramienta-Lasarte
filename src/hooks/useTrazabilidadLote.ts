/**
 * useTrazabilidadLote — la cadena completa de un lote (código AAMMDDNN):
 *
 *   1. ENTRADA (entradas_bascula): finca, parcela, agricultor, camión, kg.
 *   2. PROCESADO (lotes_dia + fecha del parte): cuándo y cuánto pasó por el
 *      calibrador, con T/h.
 *   3. CLASIFICACIÓN (lote_clasificacion): calibre × clase × grupo de destino.
 *   4. CALIDAD (calidad_lotes): notas del responsable de calidad.
 *   5. EXPEDICIÓN (palets_dia.lote_codigo): en qué palets acabó el lote y a
 *      qué cliente(s) fueron. Columna nueva (migración
 *      20260715110000_palets_dia_lote_codigo.sql, pendiente de aplicar) que
 *      SOLO rellenan los palets importados desde el histórico de campaña
 *      (ver src/lib/historicoPalets.ts): los palets capturados a mano en el
 *      parte del día no traen lote, así que este paso solo tiene datos para
 *      lotes de la campaña ya importada.
 *
 * Cada fuente puede faltar (lote antiguo sin báscula, sin Informe LOTE, sin
 * nota de calidad, sin palets importados): la ficha lo indica en vez de
 * romperse. Expedición además puede estar OCULTA por completo (no `vacía`,
 * directamente `null`) si la columna palets_dia.lote_codigo todavía no
 * existe en la base de datos.
 */
import { useQuery } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { toError } from "@/lib/errorMessage";
import { normalizarLoteCodigo } from "@/lib/entradasBascula";
import {
  esEntradaCampoCit,
  esEntradaPrecalibrado,
  esErrorTablaOColumnaInexistente,
  esPaletPrecalibrado,
  esProductorPrecalibrado,
} from "@/lib/productoresCanonicos";
import type { Tables } from "@/integrations/supabase/types";

// entradas_bascula.productor_id, entradas_bascula.cerrado_at y
// lotes_dia.productor_id todavia no estan en el Database generado
// (migraciones 20260714090000_productores_canonicos.sql y
// 20260715090000_entradas_bascula_cierre_manual.sql pendientes de aplicar).
// select("*") en entradas_bascula no necesita cast (una columna nueva
// simplemente no aparece); el select explicito de lotes_dia si necesita este
// cast para poder pedir "productor_id" con degradado si falla.
const SUPA = supabase as unknown as SupabaseClient<any>;

/** entradas_bascula.* tipado + productor_id / cerrado_at (columnas nuevas, aun no generadas). */
export type EntradaBasculaRow = Tables<"entradas_bascula"> & { productor_id?: string | null; cerrado_at?: string | null };

export interface ProcesadoLote {
  part_id: string;
  fecha: string | null;
  kg: number;
  toneladas_hora: number | null;
  duracion_min: number | null;
  producto: string | null;
  productor: string | null;
  /** Catálogo de productores (migración 20260714090000, pendiente de aplicar): undefined si la columna aún no existe. */
  productor_id?: string | null;
  /**
   * true si esta pasada es de PRECALIBRADO (fruta apartada que se vuelve a
   * pasar por el calibrador). Puramente informativo (badge en la lista del
   * paso 2): SÍ suma en kgProcesado (regla revisada 2026-07-16, coherente con
   * el cruce de stock/mermas — ver src/lib/productoresCanonicos.ts).
   */
  esPrecalibrado: boolean;
}

export interface ClasificacionGrupo {
  grupo: string;
  kg: number;
  pct: number;
}

export interface ClasificacionClase {
  clase: string;
  grupo: string;
  kg: number;
  pct: number;
}

export interface ClasificacionCalibre {
  tamano: string;
  kg: number;
  pct: number;
}

export interface ExpedicionCliente {
  cliente: string;
  paletsCount: number;
  kg: number;
}

export interface ExpedicionLote {
  /** Palets de VENTA (excluye los internos de precalibrado). */
  paletsCount: number;
  kgNeto: number;
  cajas: number;
  clientes: ExpedicionCliente[];
  /**
   * Palets internos de precalibrado (esPaletPrecalibrado): fruta apartada en
   * almacenaje interno para volver a pasarla, NO venta (decisión del dueño,
   * 2026-07-15). Se cuentan aparte para poder mostrarlos como línea discreta
   * sin mezclarlos con los kg/clientes de expedición.
   */
  paletsPrecalibrado: number;
  kgPrecalibrado: number;
}

export interface CalidadNotaLote {
  numero_lote: string;
  fecha: string;
  hora: string | null;
  calidad: string;
  defectos: string[];
  observacion: string | null;
  productor_finca_nombre: string | null;
  variedad: string | null;
  cantidad: number | null;
}

export interface TrazabilidadLote {
  lote: string;
  entrada: EntradaBasculaRow | null;
  procesado: ProcesadoLote[];
  /** Σ kg de TODAS las pasadas de `procesado`, incluidas las de precalibrado (regla revisada 2026-07-16: ver src/lib/productoresCanonicos.ts). */
  kgProcesado: number;
  clasificacion: {
    kgClasificado: number;
    grupos: ClasificacionGrupo[];
    clases: ClasificacionClase[];
    calibres: ClasificacionCalibre[];
  };
  calidad: CalidadNotaLote[];
  /** null = columna palets_dia.lote_codigo aún no existe (paso oculto); si existe, siempre un objeto (paletsCount 0 = sin palets para este lote). */
  expedicion: ExpedicionLote | null;
  /**
   * true si `entrada` es el movimiento interno de báscula al almacén de
   * precalibrado (esEntradaPrecalibrado, ver la nota de evidencia en
   * src/lib/productoresCanonicos.ts), NO una entrada de campo. Se sigue
   * dejando accesible por código de lote (por si alguien llega por enlace o
   * lo busca a mano) pero la ficha debe marcarlo con un badge junto a la
   * cabecera para que no se confunda con un lote real — este lote ya está
   * excluido del stock/coste en useEntradasBascula.ts / useCosteFruta.
   */
  entradaEsPrecalibrado: boolean;
  /**
   * true si `entrada` es fruta "CAMPO/CIT" (esEntradaCampoCit, ver la nota de
   * evidencia en src/lib/productoresCanonicos.ts): comprada pero derivada a
   * Cítrica sin procesarse en la central (decisión del dueño, 2026-07-16).
   * Este lote nunca va a tener pasadas de calibrador ni clasificación — no es
   * un error de datos, es esperado. Se marca con un badge junto a la cabecera
   * para que no se confunda con un lote real sin procesar todavía; ya está
   * excluido del stock/merma/forfait en useEntradasBascula.ts / useMermaLote.ts
   * (aunque su coste de compra sí cuenta en Económico → Fruta, ver useCosteFruta).
   */
  entradaEsCampoCit: boolean;
}

const LOTES_DIA_COLUMNAS_BASE = "part_id, lote_codigo, kg_peso_total, toneladas_hora, duracion_min, producto, productor";

interface LotesDiaProcesadoRawRow {
  part_id: string;
  lote_codigo: string | null;
  kg_peso_total: number | null;
  toneladas_hora: number | null;
  duracion_min: number | null;
  producto: string | null;
  productor: string | null;
  /** Columna nueva (migración 20260714090000 pendiente de aplicar): undefined si aún no existe. */
  productor_id?: string | null;
}

/**
 * Pide lotes_dia incluyendo productor_id (columna nueva, migración
 * 20260714090000 pendiente de aplicar); si la columna todavía no existe,
 * reintenta sin ella para no romper la ficha (degrada: sin id, solo texto).
 */
async function fetchLotesDiaConProductorId(
  codigo: string,
): Promise<{ data: LotesDiaProcesadoRawRow[] | null; error: unknown }> {
  const conId = await SUPA
    .from("lotes_dia")
    .select(`${LOTES_DIA_COLUMNAS_BASE}, productor_id`)
    .ilike("lote_codigo", `%${codigo}%`)
    .limit(200);
  if (!conId.error) return conId;
  if (!esErrorTablaOColumnaInexistente(conId.error)) return conId;
  return SUPA.from("lotes_dia").select(LOTES_DIA_COLUMNAS_BASE).ilike("lote_codigo", `%${codigo}%`).limit(200);
}

interface PaletDiaExpedicionRawRow {
  cliente: string | null;
  kg_neto: number | null;
  n_cajas: number | null;
  producto: string | null;
}

/**
 * Palets (histórico importado) cuyo lote_codigo casa con el código dado,
 * agregados por cliente. Degrada a `null` (paso oculto en la ficha) si la
 * columna todavía no existe (migración 20260715110000 pendiente de aplicar).
 */
async function fetchExpedicionLote(codigo: string): Promise<ExpedicionLote | null> {
  const { data, error } = await SUPA
    .from("palets_dia")
    .select("cliente, kg_neto, n_cajas, producto")
    .eq("lote_codigo", codigo)
    .limit(5000);
  if (error) {
    if (esErrorTablaOColumnaInexistente(error)) return null;
    throw toError(error);
  }

  // Los palets de precalibrado son almacenaje interno (fruta apartada para
  // volver a pasarla; decisión del dueño, 2026-07-15: no cuenta), NO venta:
  // fuera de los kg/clientes de expedición, contados aparte para mostrarlos
  // como línea discreta en la ficha.
  const todas = (data ?? []) as PaletDiaExpedicionRawRow[];
  const internos = todas.filter((row) => esPaletPrecalibrado(row.producto));
  const rows = todas.filter((row) => !esPaletPrecalibrado(row.producto));

  const porCliente = new Map<string, { paletsCount: number; kg: number }>();
  let kgNeto = 0;
  let cajas = 0;
  for (const row of rows) {
    const kg = Number(row.kg_neto) || 0;
    kgNeto += kg;
    cajas += Number(row.n_cajas) || 0;
    const cliente = row.cliente ?? "Sin cliente asignado";
    const acc = porCliente.get(cliente) ?? { paletsCount: 0, kg: 0 };
    acc.paletsCount += 1;
    acc.kg += kg;
    porCliente.set(cliente, acc);
  }

  return {
    paletsCount: rows.length,
    kgNeto,
    cajas,
    paletsPrecalibrado: internos.length,
    kgPrecalibrado: internos.reduce((s, row) => s + (Number(row.kg_neto) || 0), 0),
    clientes: Array.from(porCliente.entries())
      .map(([cliente, v]) => ({ cliente, paletsCount: v.paletsCount, kg: v.kg }))
      .sort((a, b) => b.kg - a.kg),
  };
}

export function useTrazabilidadLote(loteInput: string | null) {
  const lote = normalizarLoteCodigo(loteInput);

  const query = useQuery({
    queryKey: ["trazabilidad-lote", lote],
    enabled: Boolean(lote),
    queryFn: async (): Promise<TrazabilidadLote> => {
      const codigo = lote as string;

      const [entradaRes, lotesRes, clasifRes, calidadRes, expedicion] = await Promise.all([
        supabase.from("entradas_bascula").select("*").eq("lote", codigo).maybeSingle(),
        fetchLotesDiaConProductorId(codigo),
        supabase.from("lote_clasificacion").select("clase, grupo_destino, tamano, peso_kg, lote_codigo, lote_codigo_base").or(`lote_codigo_base.eq.${codigo},lote_codigo.ilike.%${codigo}%`).limit(5000),
        supabase.from("calidad_lotes").select("numero_lote, fecha, hora, calidad, defectos, observacion, productor_finca_nombre, variedad, cantidad").ilike("numero_lote", `%${codigo}%`).order("fecha", { ascending: false }).limit(50),
        fetchExpedicionLote(codigo),
      ]);

      if (entradaRes.error) throw toError(entradaRes.error);
      if (lotesRes.error) throw toError(lotesRes.error);
      if (clasifRes.error) throw toError(clasifRes.error);
      if (calidadRes.error) throw toError(calidadRes.error);

      // Fechas de los partes donde se procesó el lote.
      const partIds = Array.from(new Set((lotesRes.data ?? []).map((l) => l.part_id as string)));
      let fechaPorParte = new Map<string, string>();
      if (partIds.length > 0) {
        const { data: partes, error } = await supabase.from("partes_diarios").select("id, date").in("id", partIds);
        if (error) throw toError(error);
        fechaPorParte = new Map((partes ?? []).map((p) => [p.id as string, p.date as string]));
      }

      const procesado: ProcesadoLote[] = (lotesRes.data ?? [])
        .filter((l) => normalizarLoteCodigo(l.lote_codigo as string) === codigo)
        .map((l) => ({
          part_id: l.part_id as string,
          fecha: fechaPorParte.get(l.part_id as string) ?? null,
          kg: Number(l.kg_peso_total) || 0,
          toneladas_hora: l.toneladas_hora == null ? null : Number(l.toneladas_hora),
          duracion_min: l.duracion_min == null ? null : Number(l.duracion_min),
          producto: (l.producto as string | null) ?? null,
          productor: (l.productor as string | null) ?? null,
          productor_id: (l.productor_id as string | null | undefined) ?? undefined,
          esPrecalibrado: esProductorPrecalibrado(l.productor as string | null),
        }))
        .sort((a, b) => (a.fecha ?? "").localeCompare(b.fecha ?? ""));

      // Clasificación agregada (calibre × clase × grupo) del Informe LOTE.
      // Filtro estricto en cliente: el ilike de la query es solo un pre-filtro
      // laxo en servidor; hay lote_codigo compuestos reales tipo
      // "26042411+PREC 26063001+…" donde el ilike matchearía por casualidad un
      // código que aparece en mitad del texto. Solo cuenta si el código es el
      // lote_codigo_base o el primer grupo de 8 dígitos (mismo criterio
      // estricto que src/lib/mermaLote.ts).
      const clasifFilas = (clasifRes.data ?? []).filter((row) => {
        const base = (row as { lote_codigo_base?: string | null }).lote_codigo_base;
        const cod = (row as { lote_codigo?: string | null }).lote_codigo;
        return base === codigo || normalizarLoteCodigo(cod) === codigo;
      });
      const gruposMap = new Map<string, number>();
      const clasesMap = new Map<string, { grupo: string; kg: number }>();
      const calibresMap = new Map<string, number>();
      let kgClasificado = 0;
      for (const row of clasifFilas) {
        const kg = Number(row.peso_kg) || 0;
        if (kg <= 0) continue;
        kgClasificado += kg;
        const grupo = (row.grupo_destino as string | null) ?? "Otro";
        gruposMap.set(grupo, (gruposMap.get(grupo) ?? 0) + kg);
        const clase = (row.clase as string | null) ?? "Sin clase";
        const claseAcc = clasesMap.get(clase) ?? { grupo, kg: 0 };
        claseAcc.kg += kg;
        clasesMap.set(clase, claseAcc);
        const tamano = (row.tamano as string | null) ?? "—";
        calibresMap.set(tamano, (calibresMap.get(tamano) ?? 0) + kg);
      }
      const pct = (kg: number) => (kgClasificado > 0 ? (kg / kgClasificado) * 100 : 0);

      const entrada = (entradaRes.data as EntradaBasculaRow | null) ?? null;

      return {
        lote: codigo,
        entrada,
        entradaEsPrecalibrado: entrada ? esEntradaPrecalibrado(entrada) : false,
        entradaEsCampoCit: entrada ? esEntradaCampoCit(entrada) : false,
        procesado,
        // El precalibrado SÍ cuenta (regla revisada 2026-07-16): las pasadas
        // de precalibrado se VEN en la lista (con etiqueta informativa) y
        // suman kg procesado — coherente con el cruce de stock
        // (useEntradasBascula) y mermas (useMermaLotes), que ya no las
        // excluyen (ver src/lib/productoresCanonicos.ts).
        kgProcesado: procesado.reduce((s, p) => s + p.kg, 0),
        clasificacion: {
          kgClasificado,
          grupos: Array.from(gruposMap.entries()).map(([grupo, kg]) => ({ grupo, kg, pct: pct(kg) })).sort((a, b) => b.kg - a.kg),
          clases: Array.from(clasesMap.entries()).map(([clase, v]) => ({ clase, grupo: v.grupo, kg: v.kg, pct: pct(v.kg) })).sort((a, b) => b.kg - a.kg),
          calibres: Array.from(calibresMap.entries()).map(([tamano, kg]) => ({ tamano, kg, pct: pct(kg) })).sort((a, b) => b.kg - a.kg),
        },
        calidad: (calidadRes.data ?? []).map((c) => ({
          numero_lote: c.numero_lote as string,
          fecha: c.fecha as string,
          hora: (c.hora as string | null) ?? null,
          calidad: c.calidad as string,
          defectos: (c.defectos as string[] | null) ?? [],
          observacion: (c.observacion as string | null) ?? null,
          productor_finca_nombre: (c.productor_finca_nombre as string | null) ?? null,
          variedad: (c.variedad as string | null) ?? null,
          cantidad: c.cantidad == null ? null : Number(c.cantidad),
        })),
        expedicion,
      };
    },
  });

  return {
    lote,
    data: query.data ?? null,
    isLoading: query.isLoading,
    error: query.error,
  };
}

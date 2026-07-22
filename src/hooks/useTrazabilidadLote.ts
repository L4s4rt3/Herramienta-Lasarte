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
  evaluarCoherenciaExpedicion,
  fechaDeCodigoLote,
  interpretarCodigoLote,
  numeroDeCodigoLote,
  ordenarVolcadosCandidatos,
  type MotivoIncoherenciaExpedicion,
  type VolcadoCandidato,
  type VolcadoDelDiaInput,
} from "@/lib/origenConfeccion";
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
  /** Destrío a industria de esta pasada (kg_industria del parte; 0 = sin dato o sin destrío). */
  kg_industria: number;
  /** Kg apartados a PRECALIBRADO 1+2 desde esta pasada (manual del parte / foto diaria; 0 = sin dato). */
  kg_precalibrado: number;
  /** Nota del parte para esta pasada, tal cual (el filtro de boilerplate lo hace la UI con esNotaOperarioLote). */
  notas: string | null;
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

/**
 * El origen probable de la fruta cuando el cruce palets↔entrada por código es
 * IMPOSIBLE (ver src/lib/origenConfeccion.ts: el NN del programa de palets es
 * el lote de CONFECCIÓN del día, que solo coincide con el de entrada si la
 * fruta se volcó el mismo día que entró — con fruta de cámara el volteo cae
 * en una entrada ajena, en precalibrado o en ningún sitio). En esos casos se
 * ofrecen los volcados del día de confección como candidatos, con el NN-ésimo
 * destacado. Es null cuando el cruce por código es coherente (lo normal).
 */
export interface OrigenConfeccionLote {
  motivo: MotivoIncoherenciaExpedicion;
  /** Día de confección: el AAMMDD del propio código (fallback: fecha del parte de los palets). */
  fecha: string | null;
  /**
   * NN del código consultado. Es el nº de ENTRADA en báscula de ese día (se
   * asigna al dar entrada al camión — corrección del dueño, 21-jul-2026), NO
   * el nº de volcado: con fruta de cámara apunta a una entrada interna y no
   * identifica la fruta. Solo informativo para el texto del aviso.
   */
  numeroDelDia: number | null;
  /** Volcados de ese día (lotes_dia de todos los partes de la fecha), ordenados por hora. Puede ser [] si ese día no tiene procesado registrado. */
  volcados: VolcadoCandidato[];
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
  /** Solo cuando el cruce palets↔entrada es incoherente (ver OrigenConfeccionLote); null en el caso normal. */
  origenConfeccion: OrigenConfeccionLote | null;
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

const LOTES_DIA_COLUMNAS_BASE = "part_id, lote_codigo, kg_peso_total, toneladas_hora, duracion_min, producto, productor, kg_industria, kg_precalibrado_z1, kg_precalibrado_z2, notas";

interface LotesDiaProcesadoRawRow {
  part_id: string;
  lote_codigo: string | null;
  kg_peso_total: number | null;
  toneladas_hora: number | null;
  duracion_min: number | null;
  producto: string | null;
  productor: string | null;
  kg_industria: number | null;
  kg_precalibrado_z1: number | null;
  kg_precalibrado_z2: number | null;
  notas: string | null;
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
  part_id: string | null;
}

/**
 * Palets (histórico importado) cuyo lote_codigo casa con el código dado,
 * agregados por cliente. Degrada a `null` (paso oculto en la ficha) si la
 * columna todavía no existe (migración 20260715110000 pendiente de aplicar).
 * Devuelve también los part_id de esos palets: son la pista de la FECHA de
 * confección para el cruce de coherencia (ver fetchOrigenConfeccion).
 */
async function fetchExpedicionLote(codigo: string): Promise<{ expedicion: ExpedicionLote | null; partIds: string[] }> {
  const { data, error } = await SUPA
    .from("palets_dia")
    .select("cliente, kg_neto, n_cajas, producto, part_id")
    .eq("lote_codigo", codigo)
    .limit(5000);
  if (error) {
    if (esErrorTablaOColumnaInexistente(error)) return { expedicion: null, partIds: [] };
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
    expedicion: {
      paletsCount: rows.length,
      kgNeto,
      cajas,
      paletsPrecalibrado: internos.length,
      kgPrecalibrado: internos.reduce((s, row) => s + (Number(row.kg_neto) || 0), 0),
      clientes: Array.from(porCliente.entries())
        .map(([cliente, v]) => ({ cliente, paletsCount: v.paletsCount, kg: v.kg }))
        .sort((a, b) => b.kg - a.kg),
    },
    // Solo los palets de VENTA: los internos de precalibrado no son la
    // expedición cuyo origen se busca.
    partIds: Array.from(new Set(rows.map((r) => r.part_id).filter((id): id is string => Boolean(id)))),
  };
}

/**
 * Los volcados del día de confección como origen probable, cuando el cruce
 * palets↔entrada es incoherente. La fecha sale del propio código (AAMMDD) y,
 * si no es legible, de los partes de los palets. Se cargan los lotes_dia de
 * TODOS los partes de esa(s) fecha(s) — puede haber un parte real y otro
 * sintético del histórico el mismo día — y se ordenan por hora_inicio (las
 * filas del histórico importadas sin hora van al final por created_at, que
 * conserva el orden del Excel del calibrador).
 */
async function fetchOrigenConfeccion(
  codigo: string,
  motivo: MotivoIncoherenciaExpedicion,
  partIdsExpedicion: string[],
): Promise<OrigenConfeccionLote> {
  let fechas: string[] = [];
  const fechaDelCodigo = fechaDeCodigoLote(codigo);
  if (fechaDelCodigo) {
    fechas = [fechaDelCodigo];
  } else if (partIdsExpedicion.length > 0) {
    const { data, error } = await supabase.from("partes_diarios").select("date").in("id", partIdsExpedicion);
    if (error) throw toError(error);
    fechas = Array.from(new Set((data ?? []).map((p) => p.date as string)));
  }

  const numeroDelDia = numeroDeCodigoLote(codigo);
  if (fechas.length === 0) return { motivo, fecha: null, numeroDelDia, volcados: [] };

  const { data: partes, error: partesError } = await supabase.from("partes_diarios").select("id").in("date", fechas);
  if (partesError) throw toError(partesError);
  const partIds = (partes ?? []).map((p) => p.id as string);
  if (partIds.length === 0) return { motivo, fecha: fechas[0], numeroDelDia, volcados: [] };

  const { data: lotes, error: lotesError } = await SUPA
    .from("lotes_dia")
    .select("lote_codigo, productor, producto, kg_peso_total, hora_inicio, created_at, kg_industria, notas")
    .in("part_id", partIds)
    .limit(500);
  if (lotesError) throw toError(lotesError);

  const volcados: VolcadoDelDiaInput[] = ((lotes ?? []) as Array<{
    lote_codigo: string | null;
    productor: string | null;
    producto: string | null;
    kg_peso_total: number | null;
    hora_inicio: string | null;
    created_at: string | null;
    kg_industria: number | null;
    notas: string | null;
  }>).map((l) => ({
    lote_codigo: l.lote_codigo,
    productor: l.productor,
    producto: l.producto,
    kg: Number(l.kg_peso_total) || 0,
    hora_inicio: l.hora_inicio,
    created_at: l.created_at,
    esPrecalibrado: esProductorPrecalibrado(l.productor),
    kg_industria: Number(l.kg_industria) || 0,
    notas: l.notas,
  }));

  return {
    motivo,
    fecha: fechas[0],
    numeroDelDia,
    volcados: ordenarVolcadosCandidatos(volcados),
  };
}

export function useTrazabilidadLote(loteInput: string | null) {
  // Acepta también el código tal cual va impreso en el palet/malla
  // (NN+AAMMDD): interpretarCodigoLote lo voltea al canónico y deja
  // constancia para que la UI pueda avisar de la lectura.
  const { codigo: lote, eraFormatoPalet } = interpretarCodigoLote(loteInput);

  const query = useQuery({
    queryKey: ["trazabilidad-lote", lote],
    enabled: Boolean(lote),
    queryFn: async (): Promise<TrazabilidadLote> => {
      const codigo = lote as string;

      const [entradaRes, lotesRes, clasifRes, calidadRes, expedicionRes] = await Promise.all([
        supabase.from("entradas_bascula").select("*").eq("lote", codigo).maybeSingle(),
        fetchLotesDiaConProductorId(codigo),
        supabase.from("lote_clasificacion").select("clase, grupo_destino, tamano, peso_kg, lote_codigo, lote_codigo_base").or(`lote_codigo_base.eq.${codigo},lote_codigo.ilike.%${codigo}%`).limit(5000),
        supabase.from("calidad_lotes").select("numero_lote, fecha, hora, calidad, defectos, observacion, productor_finca_nombre, variedad, cantidad").ilike("numero_lote", `%${codigo}%`).order("fecha", { ascending: false }).limit(50),
        fetchExpedicionLote(codigo),
      ]);
      const expedicion = expedicionRes.expedicion;

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
          kg_industria: Number(l.kg_industria) || 0,
          kg_precalibrado: (Number(l.kg_precalibrado_z1) || 0) + (Number(l.kg_precalibrado_z2) || 0),
          notas: (l.notas as string | null) ?? null,
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

      // Coherencia palets↔entrada: si el cruce por código es imposible, se
      // busca el origen probable en los volcados del día de confección (ver
      // src/lib/origenConfeccion.ts — caso real: mallas Mercadona jul-2026
      // con fruta de cámara de abril).
      let origenConfeccion: OrigenConfeccionLote | null = null;
      if (expedicion) {
        const motivo = evaluarCoherenciaExpedicion({
          entradaExiste: Boolean(entrada),
          entradaEsPrecalibrado: entrada ? esEntradaPrecalibrado(entrada) : false,
          kgEntrada: entrada ? Number(entrada.kg_entrada) || 0 : 0,
          kgExpedido: expedicion.kgNeto,
        });
        if (motivo) {
          origenConfeccion = await fetchOrigenConfeccion(codigo, motivo, expedicionRes.partIds);
        }
      }
      // Código de CONFECCIÓN "huérfano" (caso real: 26070803, tecleado como
      // 03260708 desde la etiqueta de la malla): sin entrada de báscula, sin
      // pasadas propias y sin palets vinculados, la ficha quedaba en blanco
      // aunque sí sabemos qué se procesó ese día. Si el código lleva una
      // fecha válida, se ofrecen los volcados de esa fecha igualmente.
      if (!origenConfeccion && !entrada && procesado.length === 0 && fechaDeCodigoLote(codigo)) {
        const candidato = await fetchOrigenConfeccion(codigo, "sin_entrada", expedicionRes.partIds);
        if (candidato.volcados.length > 0) origenConfeccion = candidato;
      }

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
        origenConfeccion,
      };
    },
  });

  return {
    lote,
    /** true si el código tecleado venía en formato palet (NN+AAMMDD) y se ha leído volteado. */
    eraFormatoPalet,
    data: query.data ?? null,
    isLoading: query.isLoading,
    error: query.error,
  };
}

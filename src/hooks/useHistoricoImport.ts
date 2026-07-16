/**
 * useHistoricoImport — importa el histórico de PRODUCCIÓN y de PALETS de
 * toda la campaña a partes_diarios/lotes_dia/palets_dia.
 *
 * ── Producción (export "Informe PRODUCCION" del calibrador, ver
 * src/lib/historicoProduccion.ts) ───────────────────────────────────────────
 * Idempotencia / dedup — REVISADO 2026-07-16, de nivel-DÍA a nivel-FILA: el
 * dedup anterior saltaba el DÍA ENTERO si ya existía algún parte_diario (de
 * cualquier usuario) con al menos una fila en lotes_dia. Evidencia real: el
 * lote 26050101 (productor TORRE DEL JUDIO) tiene pasadas en el Excel del
 * informe el 2026-05-06 y el 2026-05-11, pero esos dos días YA tenían partes
 * reales con lotes_dia de OTROS lotes → el día entero se saltaba y las
 * pasadas de este lote nunca se insertaban → 125 lotes de mayo aparecían sin
 * procesar (1,97 M kg de "stock" fantasma). El dedup correcto es por FILA:
 *
 *   - Cada fila del Excel se identifica por (fecha, código de 8 dígitos del
 *     lote — o el texto crudo si no tiene 8 dígitos reconocibles, ver
 *     `claveLoteDedup`). Se salta SOLO si ya existe una fila de lotes_dia con
 *     esa MISMA fecha (vía part→date) y esa MISMA clave — no todo el día.
 *   - Las filas nuevas de un día que YA tiene parte (real o sintético de un
 *     import anterior) se cuelgan de ese parte existente; si el día no tiene
 *     ningún parte, se crea uno sintético, igual que antes.
 *   - Duplicados REALES dentro del propio Excel: el mismo lote puede
 *     legítimamente tener DOS pasadas el mismo día (dos filas reales, no un
 *     error del export). Para no perderlas NI duplicarlas en reimports, las
 *     filas del Excel se agrupan por (fecha, clave) SUMANDO kg (y algunos
 *     campos más, ver `agruparFilasProduccionPorFechaLote`) ANTES de
 *     comparar/insertar: se inserta UNA fila agregada por (fecha, clave), no
 *     una por fila cruda. Así la unidad de dedup e inserción es siempre la
 *     misma y reimportar el mismo archivo (o uno que solape) sigue sin
 *     duplicar nada.
 *
 * Los dos contadores de podrido del parte sintético quedan explícitamente
 * `null` (no 0: no hay ese dato en el export de producción) — ver
 * src/lib/mermaLote.ts para qué significa eso downstream (FuentePodrido
 * "desconocido"). Requiere la migración
 * 20260715100000_partes_diarios_podrido_nullable.sql (columnas nullable).
 *
 * ── Palets (export del programa de palets, ver src/lib/historicoPalets.ts) ─
 * Dedup a DOS niveles, por FECHA de confección del palet (sin cambios en esta
 * revisión — solo se tocó producción):
 *   a) Fechas SIN palets_dia existentes: se cuelgan los palets del parte de
 *      esa fecha (el sintético que haya creado el import de producción, o un
 *      parte real sin palets) o, si no existe ningún parte para esa fecha,
 *      se crea uno sintético nuevo (mismo patrón que producción).
 *   b) Fechas CON palets_dia existentes (abril 2026 en adelante, importados
 *      junto a los partes diarios reales): NO se inserta nada nuevo — se
 *      hace BACKFILL: se casa cada fila del Excel con la fila de palets_dia
 *      existente por (palet_id, fecha del parte) y se rellena `lote_codigo`
 *      SOLO si estaba NULL. Lo que no case se cuenta y se reporta (nunca se
 *      inserta, para no arriesgar duplicados). Requiere la migración
 *      20260715110000_palets_dia_lote_codigo.sql (columna `lote_codigo`).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useAuth } from "@/contexts/AuthProvider";
import { supabase } from "@/integrations/supabase/client";
import { toError } from "@/lib/errorMessage";
import { fetchAllRows } from "@/lib/fetchAllRows";
import { esErrorTablaOColumnaInexistente } from "@/lib/productoresCanonicos";
import { normalizarLoteCodigo } from "@/lib/loteCodigo";
import { PARTES_QUERY_KEY } from "@/hooks/usePartes";
import type { FilaInformeProduccion } from "@/lib/historicoProduccion";
import { normalizarPaletIdParaCasar, type FilaInformePalets } from "@/lib/historicoPalets";

const CHUNK = 200;
const NOTA_PARTE_HISTORICO = "Histórico de campaña importado (Informe PRODUCCION del calibrador).";
const NOTA_LOTE_HISTORICO = "Import histórico de campaña";
const NOTA_PARTE_HISTORICO_PALETS = "Histórico de campaña importado (export de palets; sin Informe PRODUCCION asociado para este día).";

// palets_dia.lote_codigo todavía no está en el Database generado (migración
// 20260715110000_palets_dia_lote_codigo.sql pendiente de aplicar). Mismo
// patrón de cast que src/hooks/useTrazabilidadLote.ts.
const SUPA = supabase as unknown as SupabaseClient<any>;

// ─── Helpers compartidos por producción y palets ────────────────────────────

interface ParteDiario {
  id: string;
  date: string;
}

/**
 * TODOS los partes_diarios (sin filtro): el dedup del import histórico
 * necesita ver la tabla completa para no reprocesar una fecha ya cubierta.
 * partes_diarios va camino de las 1.000 filas (207 y creciendo) — si algún
 * día el .select() sin paginar se recortara en silencio a max-rows, el
 * dedup del próximo import se rompería (fechas ya cubiertas dejarían de
 * verse como cubiertas y se duplicarían lotes/palets). Se pagina con
 * fetchAllRows por seguridad, no porque hoy ya haya roto el límite.
 */
async function fetchPartesDiarios(): Promise<ParteDiario[]> {
  return fetchAllRows<ParteDiario>((from, to) =>
    supabase.from("partes_diarios").select("id, date").order("id").range(from, to),
  );
}

/** Índices id->fecha y fecha->ids[] a partir de la misma lista de partes (una sola pasada). */
function indexarPartesPorFecha(partes: ParteDiario[]): { fechaPorParte: Map<string, string>; partesPorFecha: Map<string, string[]> } {
  const fechaPorParte = new Map<string, string>();
  const partesPorFecha = new Map<string, string[]>();
  for (const p of partes) {
    fechaPorParte.set(p.id, p.date);
    const arr = partesPorFecha.get(p.date);
    if (arr) arr.push(p.id);
    else partesPorFecha.set(p.date, [p.id]);
  }
  return { fechaPorParte, partesPorFecha };
}

/** Crea un parte sintético para una fecha sin parte (mismo patrón para producción y palets). */
async function crearParteSintetico(fecha: string, userId: string, notas: string): Promise<string> {
  const { data, error } = await supabase
    .from("partes_diarios")
    .insert({
      date: fecha,
      user_id: userId,
      estado: "Validado",
      kg_podrido_calibrador_auto: null,
      kg_podrido_bolsa_basura: null,
      notas_generales: notas,
    })
    .select("id")
    .single();
  if (error) throw toError(error);
  return (data as { id: string }).id;
}

// ─── Producción: dedup por FILA (fecha + código de lote) ────────────────────

/**
 * Clave de dedup de una fila de producción: el código de 8 dígitos
 * (normalizarLoteCodigo, misma convención A que el resto del repo — ver
 * src/lib/loteCodigo.ts) si el texto trae uno reconocible, o el texto crudo
 * (recortado) con el prefijo "raw:" si no. Las filas sin 8 dígitos (p. ej.
 * "PREC DIA 08/11/25") no casan con ningún lote de todas formas, pero aun así
 * se identifican por su propio texto para no reinsertarlas si el mismo
 * archivo se reimporta.
 */
export function claveLoteDedup(loteCodigo: string | null | undefined): string {
  const codigo = normalizarLoteCodigo(loteCodigo);
  if (codigo) return codigo;
  return `raw:${String(loteCodigo ?? "").trim()}`;
}

/** Una fila agregada de producción: varias filas del Excel con la misma (fecha, clave) colapsadas en una sola, con kg sumado. */
export interface FilaProduccionAgregada {
  fecha: string;
  clave: string;
  /** Texto de lote a persistir en lotes_dia.lote_codigo: el de la PRIMERA fila del grupo en el orden del Excel (representativo, no se intenta fusionar textos distintos). */
  lote_codigo: string;
  producto: string | null;
  productor: string | null;
  /** Σ kg de todas las filas agrupadas. */
  kg: number;
  /** De la PRIMERA fila del grupo: es una tasa (t/h), no se resuma sumando ni promediando entre pasadas distintas (campo informativo). */
  toneladas_hora: number | null;
  /** Σ duracion_min de todas las filas agrupadas SOLO si TODAS traen dato; si alguna es null, el total queda null (no se inventa un 0 parcial). */
  duracion_min: number | null;
  /** Cuántas filas crudas del Excel se agregaron en esta fila (>1 si había pasadas duplicadas reales el mismo día para el mismo lote). */
  nFilasOriginales: number;
}

/**
 * Agrupa las filas crudas del Excel por (fecha, clave de lote) SUMANDO kg
 * antes de comparar/insertar (ver cabecera del archivo: el mismo lote puede
 * tener legítimamente dos pasadas reales el mismo día, y agregarlas es lo
 * que permite que la unidad de dedup —una fila por fecha+lote— sea estable
 * entre imports sin perder ni duplicar esos kg). Función PURA, sin acceso a
 * red: mismo resultado la use la preview de la página o la mutación de
 * import, así que ambas ven exactamente la misma unidad de trabajo.
 */
export function agruparFilasProduccionPorFechaLote(filas: FilaInformeProduccion[]): FilaProduccionAgregada[] {
  const grupos = new Map<string, { fecha: string; clave: string; filas: FilaInformeProduccion[] }>();
  for (const fila of filas) {
    const clave = claveLoteDedup(fila.lote_codigo);
    const key = `${fila.fecha}::${clave}`;
    const grupo = grupos.get(key);
    if (grupo) grupo.filas.push(fila);
    else grupos.set(key, { fecha: fila.fecha, clave, filas: [fila] });
  }
  return Array.from(grupos.values()).map(({ fecha, clave, filas: filasGrupo }): FilaProduccionAgregada => {
    const primera = filasGrupo[0];
    const kg = filasGrupo.reduce((s, f) => s + f.kg, 0);
    const todasConDuracion = filasGrupo.every((f) => f.duracion_min != null);
    const duracion_min = todasConDuracion
      ? filasGrupo.reduce((s, f) => s + (f.duracion_min ?? 0), 0)
      : null;
    return {
      fecha,
      clave,
      lote_codigo: primera.lote_codigo,
      producto: primera.producto,
      productor: primera.productor,
      kg,
      toneladas_hora: primera.toneladas_hora,
      duracion_min,
      nFilasOriginales: filasGrupo.length,
    };
  });
}

export interface ClavesProduccionCubiertas {
  /** fecha (YYYY-MM-DD) -> Set de claves (claveLoteDedup) de filas de lotes_dia YA existentes ese día (de cualquier usuario/parte). Es la fuente de verdad del dedup por fila. */
  clavesPorFecha: Map<string, Set<string>>;
  /** Fechas con AL MENOS una fila de lotes_dia ya existente: solo informativo (para distinguir "día ya tocado, puede tener alguna fila nueva" de "día completamente nuevo" en la preview); el dedup real es por fila, no por esto. */
  fechasCubiertas: Set<string>;
}

/** Claves (fecha+lote) que YA existen en lotes_dia (de cualquier usuario): lo que el importador de producción debe saltar fila a fila. */
export function useClavesProduccionCubiertas() {
  return useQuery({
    queryKey: ["historico-produccion", "claves-cubiertas"],
    queryFn: async (): Promise<ClavesProduccionCubiertas> => {
      // lotes_dia tiene 1.187 filas tras el histórico: por encima del
      // max-rows del servidor, se pagina con fetchAllRows.
      const [partes, lotes] = await Promise.all([
        fetchPartesDiarios(),
        fetchAllRows<{ part_id: string; lote_codigo: string | null }>((from, to) =>
          supabase.from("lotes_dia").select("part_id, lote_codigo").order("id").range(from, to),
        ),
      ]);

      const { fechaPorParte } = indexarPartesPorFecha(partes);
      const clavesPorFecha = new Map<string, Set<string>>();
      const fechasCubiertas = new Set<string>();
      for (const l of lotes) {
        const fecha = fechaPorParte.get(l.part_id);
        if (!fecha) continue;
        fechasCubiertas.add(fecha);
        const set = clavesPorFecha.get(fecha) ?? new Set<string>();
        set.add(claveLoteDedup(l.lote_codigo));
        clavesPorFecha.set(fecha, set);
      }
      return { clavesPorFecha, fechasCubiertas };
    },
  });
}

/** Fechas (YYYY-MM-DD) que YA tienen al menos un palets_dia (de cualquier parte/usuario): esas fechas van por BACKFILL, no por insert. */
export function useFechasPaletsCubiertas() {
  return useQuery({
    queryKey: ["historico-palets", "fechas-cubiertas"],
    queryFn: async (): Promise<Set<string>> => {
      // palets_dia tiene 39.716 filas: muy por encima del max-rows del
      // servidor, .limit(100000) no protegía nada. Se pagina con fetchAllRows.
      const [partes, palets] = await Promise.all([
        fetchPartesDiarios(),
        fetchAllRows<{ part_id: string }>((from, to) =>
          supabase.from("palets_dia").select("part_id").order("id").range(from, to),
        ),
      ]);

      const { partesPorFecha } = indexarPartesPorFecha(partes);
      const partIdsConPalets = new Set(palets.map((p) => p.part_id));
      const fechas = new Set<string>();
      for (const [fecha, ids] of partesPorFecha) {
        if (ids.some((id) => partIdsConPalets.has(id))) fechas.add(fecha);
      }
      return fechas;
    },
  });
}

export interface ImportarHistoricoVariables {
  filas: FilaInformeProduccion[];
  /** Progreso por FECHA procesada (no por fila): útil para una barra de progreso simple en la UI. */
  onProgress?: (diasProcesados: number, diasTotales: number) => void;
}

export interface ImportarHistoricoResumen {
  /** Fechas con al menos una fila NUEVA insertada (fecha+lote que no existía todavía). */
  diasNuevos: number;
  /** Fechas cuyas filas (agregadas por fecha+lote) YA existían TODAS: no se insertó nada para ellas. */
  diasSinNuevas: number;
  /** Filas agregadas por (fecha, lote) — con kg ya sumado, ver agruparFilasProduccionPorFechaLote — insertadas en lotes_dia. */
  filasInsertadas: number;
  /** Filas agregadas por (fecha, lote) que ya existían y se saltaron (dedup por fila, no por día). */
  filasExistentes: number;
}

export function useHistoricoImport() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const clavesCubiertasQuery = useClavesProduccionCubiertas();

  const importar = useMutation({
    mutationFn: async ({ filas, onProgress }: ImportarHistoricoVariables): Promise<ImportarHistoricoResumen> => {
      if (!user) throw new Error("No auth");
      if (filas.length === 0) throw new Error("No hay filas para importar.");

      // Lectura fresca (no la cache de React Query) justo antes de escribir,
      // para minimizar la ventana de condición de carrera si alguien más
      // importa/edita partes al mismo tiempo. lotes_dia ya supera las 1.000
      // filas: se pagina con fetchAllRows (si esto se recortara en silencio,
      // el dedup fallaría y se duplicarían lotes en el próximo import).
      const [partes, lotesExist] = await Promise.all([
        fetchPartesDiarios(),
        fetchAllRows<{ part_id: string; lote_codigo: string | null }>((from, to) =>
          supabase.from("lotes_dia").select("part_id, lote_codigo").order("id").range(from, to),
        ),
      ]);

      const { fechaPorParte, partesPorFecha } = indexarPartesPorFecha(partes);
      const clavesPorFecha = new Map<string, Set<string>>();
      for (const l of lotesExist) {
        const fecha = fechaPorParte.get(l.part_id);
        if (!fecha) continue;
        const set = clavesPorFecha.get(fecha) ?? new Set<string>();
        set.add(claveLoteDedup(l.lote_codigo));
        clavesPorFecha.set(fecha, set);
      }

      // Dedup por FILA (fecha + lote), no por día (ver cabecera del archivo):
      // se agregan primero las filas duplicadas reales del propio Excel
      // (mismo lote, mismo día) sumando kg, y esa fila agregada es la unidad
      // que se compara/inserta.
      const agregadas = agruparFilasProduccionPorFechaLote(filas);
      const agregadasPorFecha = new Map<string, FilaProduccionAgregada[]>();
      for (const fila of agregadas) {
        const arr = agregadasPorFecha.get(fila.fecha) ?? [];
        arr.push(fila);
        agregadasPorFecha.set(fila.fecha, arr);
      }
      const fechasOrdenadas = Array.from(agregadasPorFecha.keys()).sort();

      let diasNuevos = 0;
      let diasSinNuevas = 0;
      let filasInsertadas = 0;
      let filasExistentes = 0;

      for (let i = 0; i < fechasOrdenadas.length; i++) {
        const fecha = fechasOrdenadas[i];
        onProgress?.(i, fechasOrdenadas.length);

        const filasDelDia = agregadasPorFecha.get(fecha)!;
        const clavesExistentesDelDia = clavesPorFecha.get(fecha) ?? new Set<string>();
        const nuevas = filasDelDia.filter((f) => !clavesExistentesDelDia.has(f.clave));
        filasExistentes += filasDelDia.length - nuevas.length;

        if (nuevas.length === 0) {
          diasSinNuevas += 1;
          continue;
        }

        // Reutiliza el parte de la fecha si ya existe (real o sintético de un
        // import anterior, de producción o de palets) y crea uno nuevo solo
        // si no hay ninguno — así las filas nuevas de un día ya cubierto se
        // cuelgan del parte existente en vez de crear uno duplicado (violaría
        // el UNIQUE (user_id, date) si fuera del mismo usuario).
        let partId = (partesPorFecha.get(fecha) ?? [])[0];
        if (!partId) {
          partId = await crearParteSintetico(fecha, user.id, NOTA_PARTE_HISTORICO);
          partesPorFecha.set(fecha, [partId]);
        }

        const lotesRows = nuevas.map((f) => ({
          part_id: partId,
          user_id: user.id,
          source: "manual" as const,
          producto: f.producto,
          lote_codigo: f.lote_codigo,
          kg_peso_total: f.kg,
          toneladas_hora: f.toneladas_hora,
          duracion_min: f.duracion_min,
          productor: f.productor,
          notas: f.nFilasOriginales > 1
            ? `${NOTA_LOTE_HISTORICO} (agregada de ${f.nFilasOriginales} filas duplicadas del Excel, mismo lote y día)`
            : NOTA_LOTE_HISTORICO,
        }));

        for (let j = 0; j < lotesRows.length; j += CHUNK) {
          const chunk = lotesRows.slice(j, j + CHUNK);
          const { error: insertLotesError } = await supabase.from("lotes_dia").insert(chunk);
          if (insertLotesError) throw toError(insertLotesError);
        }

        filasInsertadas += lotesRows.length;
        diasNuevos += 1;
        // Las claves recién insertadas no deben volver a insertarse dentro de
        // la misma corrida (no debería repetirse una fecha+clave en
        // agregadasPorFecha —ya se agregó arriba—, pero por si acaso).
        const setFinal = clavesPorFecha.get(fecha) ?? new Set<string>();
        for (const f of nuevas) setFinal.add(f.clave);
        clavesPorFecha.set(fecha, setFinal);
      }

      onProgress?.(fechasOrdenadas.length, fechasOrdenadas.length);

      return { diasNuevos, diasSinNuevas, filasInsertadas, filasExistentes };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: PARTES_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: ["historico-produccion"] });
      queryClient.invalidateQueries({ queryKey: ["merma-lote"] });
      queryClient.invalidateQueries({ queryKey: ["entradas_bascula"] });
    },
  });

  return {
    clavesCubiertas: clavesCubiertasQuery.data ?? null,
    isLoadingClavesCubiertas: clavesCubiertasQuery.isLoading,
    importar,
  };
}

// ─── Palets ──────────────────────────────────────────────────────────────

export interface ImportarHistoricoPaletsVariables {
  filas: FilaInformePalets[];
  /** Progreso por FECHA procesada (no por fila). */
  onProgress?: (diasProcesados: number, diasTotales: number) => void;
}

export interface ImportarHistoricoPaletsResumen {
  /** Fechas sin palets_dia previos: se creó/reutilizó un parte y se insertaron palets. */
  diasNuevos: number;
  /** Fechas con palets_dia previos: no se insertó nada, solo backfill de lote_codigo. */
  diasBackfill: number;
  paletsInsertados: number;
  /** Filas de palets_dia existentes a las que se les rellenó lote_codigo (estaba NULL). */
  paletsBackfilled: number;
  /** Filas del Excel en fecha de backfill que no casaron con ningún palets_dia existente (ni se insertan ni se tocan). */
  paletsSinCasar: number;
}

/** Comprueba que la columna palets_dia.lote_codigo ya existe (migración 20260715110000); si no, falla con un mensaje claro en vez de un error críptico a mitad de import. */
async function asegurarColumnaLoteCodigo(): Promise<void> {
  const { error } = await SUPA.from("palets_dia").select("lote_codigo").limit(1);
  if (error) {
    if (esErrorTablaOColumnaInexistente(error)) {
      throw new Error(
        "La columna palets_dia.lote_codigo todavía no existe en la base de datos: aplica la migración 20260715110000_palets_dia_lote_codigo.sql antes de importar el histórico de palets.",
      );
    }
    throw toError(error);
  }
}

export function useHistoricoImportPalets() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const fechasCubiertasQuery = useFechasPaletsCubiertas();

  const importar = useMutation({
    mutationFn: async ({ filas, onProgress }: ImportarHistoricoPaletsVariables): Promise<ImportarHistoricoPaletsResumen> => {
      if (!user) throw new Error("No auth");
      if (filas.length === 0) throw new Error("No hay filas para importar.");

      await asegurarColumnaLoteCodigo();

      // Lectura fresca justo antes de escribir (mismo motivo que el import de
      // producción). palets_dia tiene 39.716 filas: se pagina con fetchAllRows.
      const [partes, paletsExist] = await Promise.all([
        fetchPartesDiarios(),
        fetchAllRows<{ part_id: string }>((from, to) =>
          supabase.from("palets_dia").select("part_id").order("id").range(from, to),
        ),
      ]);

      const { partesPorFecha } = indexarPartesPorFecha(partes);
      const partIdsConPalets = new Set(paletsExist.map((p) => p.part_id));
      const fechaEsCubierta = (fecha: string) => (partesPorFecha.get(fecha) ?? []).some((id) => partIdsConPalets.has(id));

      const filasPorFecha = new Map<string, FilaInformePalets[]>();
      for (const fila of filas) {
        const arr = filasPorFecha.get(fila.fecha);
        if (arr) arr.push(fila);
        else filasPorFecha.set(fila.fecha, [fila]);
      }
      const fechasOrdenadas = Array.from(filasPorFecha.keys()).sort();
      const fechasCubiertas = fechasOrdenadas.filter(fechaEsCubierta);

      // Índice de palets_dia EXISTENTES en las fechas cubiertas (para el
      // backfill): fecha -> (palet_id normalizado -> {id, loteCodigo actual}).
      const partIdsCubiertos = Array.from(new Set(fechasCubiertas.flatMap((f) => partesPorFecha.get(f) ?? [])));
      const fechaPorPartIdCubierto = new Map<string, string>();
      for (const fecha of fechasCubiertas) {
        for (const partId of partesPorFecha.get(fecha) ?? []) fechaPorPartIdCubierto.set(partId, fecha);
      }

      const existingIndex = new Map<string, Map<string, { id: string; loteCodigo: string | null }>>();
      for (let i = 0; i < partIdsCubiertos.length; i += CHUNK) {
        const chunk = partIdsCubiertos.slice(i, i + CHUNK);
        if (chunk.length === 0) continue;
        // Un chunk de 200 días puede traer bastantes más de 1.000 palets
        // (39.716 palets / ~207 partes ≈ 192 de media por día): se pagina
        // cada chunk con fetchAllRows en vez de confiar en el .in() a secas.
        const data = await fetchAllRows<{ id: string; part_id: string; palet_id: string | null; lote_codigo: string | null }>(
          (from, to) => SUPA
            .from("palets_dia")
            .select("id, part_id, palet_id, lote_codigo")
            .in("part_id", chunk)
            .order("id")
            .range(from, to),
        );
        for (const row of data) {
          const fecha = fechaPorPartIdCubierto.get(row.part_id);
          if (!fecha || !row.palet_id) continue;
          let inner = existingIndex.get(fecha);
          if (!inner) { inner = new Map(); existingIndex.set(fecha, inner); }
          inner.set(normalizarPaletIdParaCasar(row.palet_id), { id: row.id, loteCodigo: row.lote_codigo });
        }
      }

      let diasNuevos = 0;
      let diasBackfill = 0;
      let paletsInsertados = 0;
      let paletsBackfilled = 0;
      let paletsSinCasar = 0;
      // UPDATEs de backfill agrupados por valor de lote_codigo: un solo
      // .update().in(ids) por lote en vez de una llamada por palet (muchos
      // palets comparten el mismo lote).
      const idsPorLote = new Map<string, string[]>();

      for (let i = 0; i < fechasOrdenadas.length; i++) {
        const fecha = fechasOrdenadas[i];
        onProgress?.(i, fechasOrdenadas.length);
        const filasDia = filasPorFecha.get(fecha)!;

        if (fechaEsCubierta(fecha)) {
          diasBackfill += 1;
          const inner = existingIndex.get(fecha);
          for (const fila of filasDia) {
            const match = inner?.get(normalizarPaletIdParaCasar(fila.palet_id));
            if (!match) { paletsSinCasar += 1; continue; }
            if (match.loteCodigo != null) continue; // ya tenía lote_codigo: no se toca
            if (!fila.lote_codigo) continue; // esta fila del Excel tampoco trae lote: nada que rellenar
            const ids = idsPorLote.get(fila.lote_codigo);
            if (ids) ids.push(match.id);
            else idsPorLote.set(fila.lote_codigo, [match.id]);
            paletsBackfilled += 1;
          }
          continue;
        }

        // Fecha SIN palets existentes: se cuelgan del parte de esa fecha (el
        // sintético de producción, o uno real sin palets) o se crea uno nuevo.
        diasNuevos += 1;
        let partId = (partesPorFecha.get(fecha) ?? [])[0];
        if (!partId) {
          partId = await crearParteSintetico(fecha, user.id, NOTA_PARTE_HISTORICO_PALETS);
          partesPorFecha.set(fecha, [partId]);
        }

        const paletsRows = filasDia.map((f) => ({
          part_id: partId,
          user_id: user.id,
          source: "manual" as const,
          palet_id: f.palet_id,
          producto: f.producto,
          cliente: f.cliente,
          kg_neto: f.kg_neto,
          n_cajas: f.n_cajas,
          situacion: f.situacion,
          lote_codigo: f.lote_codigo,
        }));

        for (let j = 0; j < paletsRows.length; j += CHUNK) {
          const chunk = paletsRows.slice(j, j + CHUNK);
          const { error: insertError } = await SUPA.from("palets_dia").insert(chunk);
          if (insertError) throw toError(insertError);
        }

        paletsInsertados += paletsRows.length;
      }

      for (const [loteCodigo, ids] of idsPorLote) {
        for (let i = 0; i < ids.length; i += CHUNK) {
          const chunk = ids.slice(i, i + CHUNK);
          const { error } = await SUPA.from("palets_dia").update({ lote_codigo: loteCodigo }).in("id", chunk);
          if (error) throw toError(error);
        }
      }

      onProgress?.(fechasOrdenadas.length, fechasOrdenadas.length);

      return { diasNuevos, diasBackfill, paletsInsertados, paletsBackfilled, paletsSinCasar };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: PARTES_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: ["historico-palets"] });
      queryClient.invalidateQueries({ queryKey: ["trazabilidad-lote"] });
    },
  });

  return {
    fechasCubiertas: fechasCubiertasQuery.data ?? null,
    isLoadingFechasCubiertas: fechasCubiertasQuery.isLoading,
    importar,
  };
}

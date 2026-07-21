/**
 * useHistoricoImport — importa el histórico de PRODUCCIÓN, de PALETS y de
 * INFORMES DE LOTE de toda la campaña a partes_diarios/lotes_dia/palets_dia/
 * lote_clasificacion.
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
 *
 * ── Informes de lote ("Informe LOTE" del calibrador, uno por PASADA de lote;
 * ver src/lib/informeLote.ts para el formato) ───────────────────────────────
 * El dueño extrae a mano ~962 informes (a ~50/día) con doble objetivo:
 * (1) podrido REAL y clasificación por destino de cada lote (lote_clasificacion
 * — mermaLote.ts ya prefiere la fuente "real" sobre el prorrateo con solo que
 * exista alguna fila) y (2) REPARAR los lotes con expedición pero sin registro
 * de procesado: el informe trae la fecha de comienzo y el kg de la pasada, que
 * es la prueba de procesado que les falta.
 *
 * La identidad de un informe es (fecha de comienzo, lote de 8 dígitos vía
 * claveLoteDedup) — NUNCA solo el lote: un lote puede tener varios informes
 * (pasadas en días distintos, micro-pasadas de pocos kg incluidas). Dedup
 * INDEPENDIENTE por tabla, ambas por esa misma clave (ver
 * planImportInformesLote, función PURA compartida por preview y mutación):
 *   a) lote_clasificacion: si YA hay filas para (fecha, clave) — fecha por la
 *      columna `fecha` del informe original, part→date solo como fallback
 *      (ver indexarClasificacionPorFecha) — no se inserta clasificación
 *      (contador "ya tenía informe"); si no, se insertan
 *      las filas del informe con las MISMAS columnas que la edge function
 *      analizar-lote-excel (lote_codigo_base = prefijoNumericoLote, fecha,
 *      productor, toneladas_hora…), colgadas del parte de esa fecha
 *      (existente o sintético, mismos helpers que producción/palets).
 *   b) lotes_dia: SOLO si esa (fecha, clave) no tiene NINGUNA fila (ni real ni
 *      histórica) se inserta UNA fila con kg = Σ Peso(kg) del informe — esto
 *      es lo que repara los expedidos-sin-procesado. Si ya hay filas NO se
 *      toca lotes_dia (el informe no debe duplicar kg ya contados).
 *   El trigger lotes_dia_asignar_productor_id de la BD (migración
 *   20260714090000) enlaza el productor canónico solo, como en producción.
 * Reimportar la misma tanda es idempotente: ambas claves ya existen y no se
 * inserta nada.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useAuth } from "@/contexts/AuthProvider";
import { supabase } from "@/integrations/supabase/client";
import { toError } from "@/lib/errorMessage";
import { fetchAllRows } from "@/lib/fetchAllRows";
import { esErrorTablaOColumnaInexistente } from "@/lib/productoresCanonicos";
import { normalizarLoteCodigo, prefijoNumericoLote } from "@/lib/loteCodigo";
import { PARTES_QUERY_KEY } from "@/hooks/usePartes";
import type { FilaInformeProduccion } from "@/lib/historicoProduccion";
import { normalizarPaletIdParaCasar, type FilaInformePalets } from "@/lib/historicoPalets";
import type { InformeLote } from "@/lib/informeLote";

const CHUNK = 200;
const NOTA_PARTE_HISTORICO = "Histórico de campaña importado (Informe PRODUCCION del calibrador).";
const NOTA_LOTE_HISTORICO = "Import histórico de campaña";
const NOTA_PARTE_HISTORICO_PALETS = "Histórico de campaña importado (export de palets; sin Informe PRODUCCION asociado para este día).";
const NOTA_PARTE_HISTORICO_INFORMES = "Histórico de campaña importado (Informe LOTE del calibrador; sin parte previo para este día).";
const NOTA_LOTE_REPARADO_INFORME = "Procesado reconstruido desde Informe LOTE (import histórico): kg = suma de Peso (kg) del informe de esta fecha.";

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
  /** La MÍNIMA hora entre las pasadas agrupadas (la primera del día): es la que ordena los volcados para el cruce con el nº de lote del palet (src/lib/origenConfeccion.ts). null si ninguna fila trae hora. */
  hora: string | null;
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
    const horas = filasGrupo.map((f) => f.hora).filter((h): h is string => h != null).sort();
    return {
      fecha,
      clave,
      lote_codigo: primera.lote_codigo,
      producto: primera.producto,
      productor: primera.productor,
      kg,
      toneladas_hora: primera.toneladas_hora,
      duracion_min,
      hora: horas[0] ?? null,
      nFilasOriginales: filasGrupo.length,
    };
  });
}

export interface ClavesProduccionCubiertas {
  /** fecha (YYYY-MM-DD) -> Set de claves (claveLoteDedup) de filas de lotes_dia YA existentes ese día (de cualquier usuario/parte). Es la fuente de verdad del dedup por fila. */
  clavesPorFecha: Map<string, Set<string>>;
  /** Fechas con AL MENOS una fila de lotes_dia ya existente: solo informativo (para distinguir "día ya tocado, puede tener alguna fila nueva" de "día completamente nuevo" en la preview); el dedup real es por fila, no por esto. */
  fechasCubiertas: Set<string>;
  /**
   * "fecha::clave" -> horas_inicio actuales de las filas existentes (null =
   * sin hora). Candidatas al BACKFILL/CORRECCIÓN de hora: los imports
   * anteriores a jul-2026 la tiraban (null) y la IA del parte diario metía la
   * "Hora de la Máquina" (duración) como hora de inicio (valor incorrecto).
   * El "Tiempo de Inicio" del informe del calibrador es la fuente
   * autoritativa: la preview usa este índice para permitir un reimport que no
   * inserta nada pero SÍ repara horas.
   */
  horasPorFechaClave: Map<string, Array<string | null>>;
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
        fetchAllRows<{ part_id: string; lote_codigo: string | null; hora_inicio: string | null }>((from, to) =>
          supabase.from("lotes_dia").select("part_id, lote_codigo, hora_inicio").order("id").range(from, to),
        ),
      ]);

      const { fechaPorParte } = indexarPartesPorFecha(partes);
      const clavesPorFecha = new Map<string, Set<string>>();
      const fechasCubiertas = new Set<string>();
      const horasPorFechaClave = new Map<string, Array<string | null>>();
      for (const l of lotes) {
        const fecha = fechaPorParte.get(l.part_id);
        if (!fecha) continue;
        fechasCubiertas.add(fecha);
        const clave = claveLoteDedup(l.lote_codigo);
        const set = clavesPorFecha.get(fecha) ?? new Set<string>();
        set.add(clave);
        clavesPorFecha.set(fecha, set);
        const key = `${fecha}::${clave}`;
        const horas = horasPorFechaClave.get(key) ?? [];
        horas.push(l.hora_inicio);
        horasPorFechaClave.set(key, horas);
      }
      return { clavesPorFecha, fechasCubiertas, horasPorFechaClave };
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
  /** BACKFILL/CORRECCIÓN: filas ya existentes cuya hora_inicio se rellenó (estaba NULL: los imports anteriores a jul-2026 la tiraban) o se corrigió (difería: la IA del parte metía la duración como hora). El orden de volcados la necesita — src/lib/origenConfeccion.ts. */
  horasRellenadas: number;
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
        fetchAllRows<{ id: string; part_id: string; lote_codigo: string | null; hora_inicio: string | null }>((from, to) =>
          supabase.from("lotes_dia").select("id, part_id, lote_codigo, hora_inicio").order("id").range(from, to),
        ),
      ]);

      const { fechaPorParte, partesPorFecha } = indexarPartesPorFecha(partes);
      const clavesPorFecha = new Map<string, Set<string>>();
      // Para el BACKFILL/CORRECCIÓN de hora_inicio: TODAS las filas
      // existentes con su hora actual, indexadas por (fecha, clave). Se
      // corrige tanto la hora NULL (imports antiguos la tiraban) como la
      // DISTINTA (la IA del parte metía la duración como hora de inicio):
      // el "Tiempo de Inicio" del calibrador es la fuente autoritativa.
      const filasHoraPorFechaClave = new Map<string, Array<{ id: string; hora_inicio: string | null }>>();
      for (const l of lotesExist) {
        const fecha = fechaPorParte.get(l.part_id);
        if (!fecha) continue;
        const clave = claveLoteDedup(l.lote_codigo);
        const set = clavesPorFecha.get(fecha) ?? new Set<string>();
        set.add(clave);
        clavesPorFecha.set(fecha, set);
        const key = `${fecha}::${clave}`;
        const filasKey = filasHoraPorFechaClave.get(key) ?? [];
        filasKey.push({ id: l.id, hora_inicio: l.hora_inicio });
        filasHoraPorFechaClave.set(key, filasKey);
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
      const actualizacionesHora: Array<{ id: string; hora: string }> = [];

      for (let i = 0; i < fechasOrdenadas.length; i++) {
        const fecha = fechasOrdenadas[i];
        onProgress?.(i, fechasOrdenadas.length);

        const filasDelDia = agregadasPorFecha.get(fecha)!;
        const clavesExistentesDelDia = clavesPorFecha.get(fecha) ?? new Set<string>();
        const nuevas = filasDelDia.filter((f) => !clavesExistentesDelDia.has(f.clave));
        filasExistentes += filasDelDia.length - nuevas.length;

        // BACKFILL/CORRECCIÓN de hora_inicio: se repara la hora NULL (los
        // imports anteriores a jul-2026 la tiraban) Y la hora DISTINTA (la IA
        // del parte diario metía la "Hora de la Máquina" —una duración— como
        // hora de inicio). El "Tiempo de Inicio" del informe del calibrador
        // es la fuente autoritativa: sin hora buena no se pueden ordenar los
        // volcados del día (src/lib/origenConfeccion.ts). Va ANTES del
        // `continue`: un reimport del mismo archivo no inserta nada pero sí
        // repara horas.
        for (const f of filasDelDia) {
          if (f.hora == null) continue;
          const filasKey = filasHoraPorFechaClave.get(`${fecha}::${f.clave}`);
          if (!filasKey?.length) continue;
          for (const filaExistente of filasKey) {
            // El time de Postgres vuelve como "HH:MM:SS" (a veces con sufijo):
            // se compara sobre los 8 primeros caracteres.
            if ((filaExistente.hora_inicio ?? "").slice(0, 8) === f.hora.slice(0, 8)) continue;
            actualizacionesHora.push({ id: filaExistente.id, hora: f.hora });
          }
          filasHoraPorFechaClave.delete(`${fecha}::${f.clave}`);
        }

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
          hora_inicio: f.hora,
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

      // El backfill se ejecuta al final, en tandas pequeñas de updates
      // individuales (cada fila puede llevar una hora distinta, no hay update
      // masivo posible). Son como mucho ~1.200 filas la primera vez (todo el
      // histórico importado sin hora) y 0 en reimports posteriores.
      let horasRellenadas = 0;
      const CHUNK_UPDATES = 10;
      for (let j = 0; j < actualizacionesHora.length; j += CHUNK_UPDATES) {
        const chunk = actualizacionesHora.slice(j, j + CHUNK_UPDATES);
        const resultados = await Promise.all(
          chunk.map((u) => supabase.from("lotes_dia").update({ hora_inicio: u.hora }).eq("id", u.id)),
        );
        for (const r of resultados) {
          if (r.error) throw toError(r.error);
        }
        horasRellenadas += chunk.length;
      }

      return { diasNuevos, diasSinNuevas, filasInsertadas, filasExistentes, horasRellenadas };
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
  /**
   * REEMPLAZO de palets sin identificar (evidencia real, 21-jul-2026: el
   * analizador del parte diario no reconocía la cabecera "NºPalet" y guardó
   * ~12.000 palets con palet_id NULL — el backfill por nº de palet no podía
   * casar nada: 11.871 "sin casar" de un import completo). Con esta opción,
   * en cada fecha cubierta se BORRAN los palets_dia existentes con palet_id
   * NULL y se insertan en su lugar las filas del export que no casaron
   * (mismo programa de origen, pero con nº de palet y lote). Los palets que
   * SÍ tienen palet_id no se tocan nunca: siguen el backfill normal.
   */
  reemplazarSinId?: boolean;
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
  /** Filas del Excel en fecha de backfill que no casaron con ningún palets_dia existente (ni se insertan ni se tocan; si reemplazarSinId está activo, las reemplazadas NO cuentan aquí). */
  paletsSinCasar: number;
  /** Con reemplazarSinId: palets_dia existentes SIN palet_id eliminados. */
  paletsReemplazadosEliminados: number;
  /** Con reemplazarSinId: filas del export insertadas en su lugar (con nº de palet y lote). */
  paletsReemplazadosInsertados: number;
  /** Fechas donde hubo reemplazo. */
  diasReemplazo: number;
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
    mutationFn: async ({ filas, reemplazarSinId = false, onProgress }: ImportarHistoricoPaletsVariables): Promise<ImportarHistoricoPaletsResumen> => {
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
      // Filas existentes SIN palet_id por fecha (con su part_id): el analizador
      // del parte las dejó anónimas y el backfill por nº no puede casarlas —
      // son las candidatas al reemplazo si reemplazarSinId está activo.
      const sinIdPorFecha = new Map<string, Array<{ id: string; part_id: string }>>();
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
          if (!fecha) continue;
          if (!row.palet_id) {
            const arr = sinIdPorFecha.get(fecha) ?? [];
            arr.push({ id: row.id, part_id: row.part_id });
            sinIdPorFecha.set(fecha, arr);
            continue;
          }
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
      let paletsReemplazadosEliminados = 0;
      let paletsReemplazadosInsertados = 0;
      let diasReemplazo = 0;
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
          const sinCasarDia: FilaInformePalets[] = [];
          for (const fila of filasDia) {
            const match = inner?.get(normalizarPaletIdParaCasar(fila.palet_id));
            if (!match) { sinCasarDia.push(fila); continue; }
            if (match.loteCodigo != null) continue; // ya tenía lote_codigo: no se toca
            if (!fila.lote_codigo) continue; // esta fila del Excel tampoco trae lote: nada que rellenar
            const ids = idsPorLote.get(fila.lote_codigo);
            if (ids) ids.push(match.id);
            else idsPorLote.set(fila.lote_codigo, [match.id]);
            paletsBackfilled += 1;
          }

          // REEMPLAZO (opt-in): las filas del export que no casaron sustituyen
          // a los palets anónimos (palet_id NULL) de esa fecha. Solo si hay
          // AMBAS cosas: borrar anónimos sin meter su versión identificada
          // perdería kg, e insertar sin borrar los duplicaría. Los kg del día
          // pasan a ser los del export — mismo programa de origen, así que la
          // diferencia real es mínima y a cambio cada palet queda con su nº y
          // su lote (lo que necesita la trazabilidad).
          const anonimos = sinIdPorFecha.get(fecha) ?? [];
          if (reemplazarSinId && sinCasarDia.length > 0 && anonimos.length > 0) {
            const idsABorrar = anonimos.map((a) => a.id);
            for (let j = 0; j < idsABorrar.length; j += CHUNK) {
              const { error } = await SUPA.from("palets_dia").delete().in("id", idsABorrar.slice(j, j + CHUNK));
              if (error) throw toError(error);
            }
            const partIdDestino = anonimos[0].part_id;
            const rows = sinCasarDia.map((f) => ({
              part_id: partIdDestino,
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
            for (let j = 0; j < rows.length; j += CHUNK) {
              const { error } = await SUPA.from("palets_dia").insert(rows.slice(j, j + CHUNK));
              if (error) throw toError(error);
            }
            paletsReemplazadosEliminados += idsABorrar.length;
            paletsReemplazadosInsertados += rows.length;
            diasReemplazo += 1;
          } else {
            paletsSinCasar += sinCasarDia.length;
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

      return {
        diasNuevos,
        diasBackfill,
        paletsInsertados,
        paletsBackfilled,
        paletsSinCasar,
        paletsReemplazadosEliminados,
        paletsReemplazadosInsertados,
        diasReemplazo,
      };
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

// ─── Informes de lote ("Informe LOTE" del calibrador) ───────────────────────
// Ver el bloque "Informes de lote" de la cabecera del archivo para el diseño
// (identidad (fecha, clave), dedup independiente clasificación/lotes_dia,
// reparación de expedidos-sin-procesado).

/** Un archivo ya parseado por parseInformeLoteRows (src/lib/informeLote.ts), con su nombre para poder reportar por archivo. */
export interface ArchivoInformeLote {
  fileName: string;
  informe: InformeLote;
}

export interface PlanInformeLoteItem {
  fileName: string;
  /** Fecha de comienzo del informe (fecha del PROCESADO de la pasada). */
  fecha: string;
  /** claveLoteDedup del código crudo del informe (8 dígitos, o "raw:" si no los trae). */
  clave: string;
  loteCodigo: string;
  /** true si (fecha, clave) NO tenía todavía filas en lote_clasificacion: se insertará la clasificación. */
  insertaClasificacion: boolean;
  /** true si (fecha, clave) NO tenía NINGUNA fila en lotes_dia: se insertará UNA fila con el kg del informe (reparación de expedido-sin-procesado). */
  reparaLotesDia: boolean;
  nFilasClasificacion: number;
  kgTotal: number;
  kgPodrido: number;
  informe: InformeLote;
}

export interface PlanImportInformesLote {
  items: PlanInformeLoteItem[];
  /** Archivos que no se pueden importar, con motivo (sin fecha, sin filas…). Los descartes de PARSE (archivo no reconocido) los reporta la página aparte. */
  descartados: Array<{ fileName: string; motivo: string }>;
  /** Informes cuya clasificación se insertará ((fecha, clave) sin filas previas en lote_clasificacion). */
  nClasificacionesNuevas: number;
  /** Informes que ya tenían clasificación para su (fecha, clave): no tocan lote_clasificacion. */
  nYaTenianInforme: number;
  /** Informes que insertarán la fila de lotes_dia que faltaba (reparación de procesado). */
  nReparaciones: number;
  /** Σ kgTotal de los informes que reparan lotes_dia: kg que saldrán del "stock fantasma". */
  kgReparados: number;
  /** Σ kgPodrido de los informes con clasificación nueva: podrido REAL que ganará el análisis de mermas. */
  kgPodridoRealNuevo: number;
}

/**
 * Decide qué hará el import con cada informe parseado, contra el estado
 * actual de lote_clasificacion y lotes_dia (ambos como fecha→Set<clave>).
 * Función PURA y sin efectos sobre sus argumentos (copia los sets antes de
 * marcar): la preview de la página y la mutación usan EXACTAMENTE esta misma
 * lógica, así que ven la misma unidad de trabajo. Dos informes de la misma
 * (fecha, clave) dentro de la MISMA tanda: el primero decide, el segundo se
 * trata como "ya tenía" (dedup también dentro de la tanda).
 */
export function planImportInformesLote(
  archivos: ArchivoInformeLote[],
  clasificacionPorFecha: Map<string, Set<string>>,
  lotesDiaPorFecha: Map<string, Set<string>>,
): PlanImportInformesLote {
  // Copias locales: el plan no debe mutar la cache de React Query.
  const clasif = new Map<string, Set<string>>();
  for (const [f, s] of clasificacionPorFecha) clasif.set(f, new Set(s));
  const lotes = new Map<string, Set<string>>();
  for (const [f, s] of lotesDiaPorFecha) lotes.set(f, new Set(s));

  const items: PlanInformeLoteItem[] = [];
  const descartados: Array<{ fileName: string; motivo: string }> = [];

  for (const { fileName, informe } of archivos) {
    if (!informe.fechaComienzo) {
      descartados.push({ fileName, motivo: "El informe no trae 'Fecha y Hora de Comienzo' legible." });
      continue;
    }
    if (informe.clasificacion.length === 0 || informe.kgTotal <= 0) {
      descartados.push({ fileName, motivo: "El informe no trae ninguna fila de clasificación con kg." });
      continue;
    }
    const fecha = informe.fechaComienzo;
    const clave = claveLoteDedup(informe.loteCodigo);

    const setClasif = clasif.get(fecha) ?? new Set<string>();
    clasif.set(fecha, setClasif);
    const insertaClasificacion = !setClasif.has(clave);
    if (insertaClasificacion) setClasif.add(clave);

    const setLotes = lotes.get(fecha) ?? new Set<string>();
    lotes.set(fecha, setLotes);
    const reparaLotesDia = !setLotes.has(clave);
    if (reparaLotesDia) setLotes.add(clave);

    items.push({
      fileName,
      fecha,
      clave,
      loteCodigo: informe.loteCodigo,
      insertaClasificacion,
      reparaLotesDia,
      nFilasClasificacion: informe.clasificacion.length,
      kgTotal: informe.kgTotal,
      kgPodrido: informe.kgPodrido,
      informe,
    });
  }

  const nuevas = items.filter((i) => i.insertaClasificacion);
  const reparan = items.filter((i) => i.reparaLotesDia);
  return {
    items,
    descartados,
    nClasificacionesNuevas: nuevas.length,
    nYaTenianInforme: items.length - nuevas.length,
    nReparaciones: reparan.length,
    kgReparados: reparan.reduce((s, i) => s + i.kgTotal, 0),
    kgPodridoRealNuevo: nuevas.reduce((s, i) => s + i.kgPodrido, 0),
  };
}

interface FilaClasificacionExistente {
  part_id: string;
  lote_codigo: string | null;
  lote_codigo_base: string | null;
  /** lote_clasificacion.fecha: la fecha de COMIENZO del informe original (la puso la edge function o este import). */
  fecha: string | null;
}

/**
 * fecha -> Set<clave> de las filas YA existentes en lote_clasificacion. La
 * fecha preferente es la columna `fecha` (la de comienzo del informe): las
 * filas subidas vía edge function (analizar-lote-excel) cuelgan del parte al
 * que se adjuntó el ARCHIVO, que puede no ser el día del informe — usar solo
 * part→date dejaría de ver esos ~28 lotes y reimportarlos duplicaría su
 * podrido real. part→date queda como fallback si `fecha` viniera null.
 * Se añade también la clave del código base (defensivo: normalmente coincide
 * con la del crudo, pero cubre crudos sin 8 dígitos reconocibles).
 */
function indexarClasificacionPorFecha(
  clasif: FilaClasificacionExistente[],
  fechaPorParte: Map<string, string>,
): Map<string, Set<string>> {
  const porFecha = new Map<string, Set<string>>();
  for (const c of clasif) {
    const fecha = c.fecha ?? fechaPorParte.get(c.part_id);
    if (!fecha) continue;
    const set = porFecha.get(fecha) ?? new Set<string>();
    set.add(claveLoteDedup(c.lote_codigo));
    if (c.lote_codigo_base) set.add(claveLoteDedup(c.lote_codigo_base));
    porFecha.set(fecha, set);
  }
  return porFecha;
}

export interface ClavesInformesLoteCubiertas {
  /** fecha (columna `fecha` del informe, o part→date como fallback) -> Set de claves (claveLoteDedup) con filas YA existentes en lote_clasificacion. */
  clasificacionPorFecha: Map<string, Set<string>>;
}

/** Claves (fecha+lote) que YA tienen filas en lote_clasificacion (de cualquier usuario): lo que el import de informes debe saltar. */
export function useClavesInformesLoteCubiertas() {
  return useQuery({
    queryKey: ["historico-informes-lote", "claves-cubiertas"],
    queryFn: async (): Promise<ClavesInformesLoteCubiertas> => {
      // lote_clasificacion tiene 8.685+ filas: muy por encima del max-rows
      // del servidor, se pagina con fetchAllRows (ver src/lib/fetchAllRows.ts).
      const [partes, clasif] = await Promise.all([
        fetchPartesDiarios(),
        fetchAllRows<FilaClasificacionExistente>(
          (from, to) => supabase.from("lote_clasificacion").select("part_id, lote_codigo, lote_codigo_base, fecha").order("id").range(from, to),
        ),
      ]);
      const { fechaPorParte } = indexarPartesPorFecha(partes);
      return { clasificacionPorFecha: indexarClasificacionPorFecha(clasif, fechaPorParte) };
    },
  });
}

export interface ImportarInformesLoteVariables {
  archivos: ArchivoInformeLote[];
  /** Progreso por INFORME procesado (útil con tandas de 50+ archivos). */
  onProgress?: (hechos: number, total: number) => void;
}

export interface ImportarInformesLoteResumen {
  /** Informes válidos procesados (con o sin nada que insertar). */
  informesProcesados: number;
  /** Archivos descartados por el plan (sin fecha / sin filas), con motivo. */
  descartados: Array<{ fileName: string; motivo: string }>;
  /** Informes cuya clasificación se insertó. */
  clasificacionesInsertadas: number;
  /** Filas de lote_clasificacion insertadas en total. */
  filasClasificacion: number;
  /** Informes que ya tenían clasificación para su (fecha, lote): saltados. */
  yaTenianInforme: number;
  /** Filas de lotes_dia insertadas (lotes reparados: tenían expedición pero no registro de procesado en esa fecha). */
  lotesDiaReparados: number;
  /** Σ kg de esas filas: kg que salen del "stock fantasma". */
  kgReparados: number;
  /** Σ kg de podrido REAL de los informes con clasificación insertada. */
  kgPodridoReal: number;
}

export function useInformesLoteImport() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const clasificacionCubiertaQuery = useClavesInformesLoteCubiertas();
  // lotes_dia por (fecha, clave): la MISMA query que usa el import de
  // producción (React Query la dedupe por queryKey — no es un fetch extra).
  const lotesCubiertosQuery = useClavesProduccionCubiertas();

  const importar = useMutation({
    mutationFn: async ({ archivos, onProgress }: ImportarInformesLoteVariables): Promise<ImportarInformesLoteResumen> => {
      if (!user) throw new Error("No auth");
      if (archivos.length === 0) throw new Error("No hay informes para importar.");

      // Lectura FRESCA (no la cache de React Query) justo antes de escribir,
      // mismo motivo que producción/palets: minimizar la ventana de carrera.
      // Se piden también los ids de lotes_dia para el enlace best-effort
      // lote_clasificacion.lote_dia_id (mismo criterio que la edge function
      // analizar-lote-excel: emparejar por código dentro del mismo parte/fecha).
      const [partes, lotesExist, clasifExist] = await Promise.all([
        fetchPartesDiarios(),
        fetchAllRows<{ id: string; part_id: string; lote_codigo: string | null }>((from, to) =>
          supabase.from("lotes_dia").select("id, part_id, lote_codigo").order("id").range(from, to),
        ),
        fetchAllRows<FilaClasificacionExistente>((from, to) =>
          supabase.from("lote_clasificacion").select("part_id, lote_codigo, lote_codigo_base, fecha").order("id").range(from, to),
        ),
      ]);

      const { fechaPorParte, partesPorFecha } = indexarPartesPorFecha(partes);

      const lotesPorFecha = new Map<string, Set<string>>();
      const loteDiaIdPorFechaClave = new Map<string, string>(); // `${fecha}::${clave}` -> primer id (best-effort)
      for (const l of lotesExist) {
        const fecha = fechaPorParte.get(l.part_id);
        if (!fecha) continue;
        const clave = claveLoteDedup(l.lote_codigo);
        const set = lotesPorFecha.get(fecha) ?? new Set<string>();
        set.add(clave);
        lotesPorFecha.set(fecha, set);
        const key = `${fecha}::${clave}`;
        if (!loteDiaIdPorFechaClave.has(key)) loteDiaIdPorFechaClave.set(key, l.id);
      }

      const clasifPorFecha = indexarClasificacionPorFecha(clasifExist, fechaPorParte);

      // El MISMO plan puro que vio la preview, recalculado con datos frescos.
      const plan = planImportInformesLote(archivos, clasifPorFecha, lotesPorFecha);

      let clasificacionesInsertadas = 0;
      let filasClasificacion = 0;
      let lotesDiaReparados = 0;
      let kgReparados = 0;
      let kgPodridoReal = 0;

      for (let i = 0; i < plan.items.length; i++) {
        const item = plan.items[i];
        onProgress?.(i, plan.items.length);
        if (!item.insertaClasificacion && !item.reparaLotesDia) continue;

        const inf = item.informe;

        // Parte del día del informe: existente (real o sintético de cualquier
        // import anterior) o sintético nuevo — mismos helpers que producción.
        let partId = (partesPorFecha.get(item.fecha) ?? [])[0];
        if (!partId) {
          partId = await crearParteSintetico(item.fecha, user.id, NOTA_PARTE_HISTORICO_INFORMES);
          partesPorFecha.set(item.fecha, [partId]);
        }

        // b) Reparación de lotes_dia ANTES de la clasificación, para poder
        //    enlazar lote_dia_id con la fila recién creada.
        let loteDiaId = loteDiaIdPorFechaClave.get(`${item.fecha}::${item.clave}`) ?? null;
        if (item.reparaLotesDia) {
          const { data: nuevoLote, error: loteErr } = await supabase
            .from("lotes_dia")
            .insert({
              part_id: partId,
              user_id: user.id,
              source: "manual" as const,
              producto: inf.variedad,
              lote_codigo: inf.loteCodigo,
              kg_peso_total: inf.kgTotal,
              toneladas_hora: inf.toneladasHora,
              duracion_min: inf.duracionLoteMin,
              peso_fruta_promedio_g: inf.pesoFrutaPromedioG,
              productor: inf.productorNombre,
              notas: NOTA_LOTE_REPARADO_INFORME,
            })
            .select("id")
            .single();
          if (loteErr) throw toError(loteErr);
          loteDiaId = (nuevoLote as { id: string }).id;
          loteDiaIdPorFechaClave.set(`${item.fecha}::${item.clave}`, loteDiaId);
          lotesDiaReparados += 1;
          kgReparados += inf.kgTotal;
        }

        // a) Clasificación: mismas columnas que la edge function
        //    analizar-lote-excel (part_id/lote_codigo/lote_codigo_base/fecha/
        //    productor/toneladas_hora/…); archivo_id queda null (no hay
        //    partes_archivos: el Excel no se sube al bucket en este flujo).
        if (item.insertaClasificacion) {
          const rows = inf.clasificacion.map((f) => ({
            part_id: partId,
            user_id: user.id,
            archivo_id: null,
            lote_dia_id: loteDiaId,
            lote_codigo: inf.loteCodigo,
            lote_codigo_base: prefijoNumericoLote(inf.loteCodigo),
            productor: inf.productorNombre,
            fecha: item.fecha,
            toneladas_hora: inf.toneladasHora,
            peso_fruta_promedio_g: inf.pesoFrutaPromedioG,
            duracion_min: inf.duracionLoteMin,
            producto: f.producto,
            calidad: f.calidad,
            clase: f.clase,
            grupo_destino: f.grupoDestino,
            tamano: f.tamano,
            piezas: f.piezas,
            pct_piezas: f.pctPiezas,
            peso_kg: f.pesoKg,
            pct_peso: f.pctPeso,
            cartons: f.cartons,
            pct_cartons: f.pctCartons,
          }));
          for (let j = 0; j < rows.length; j += CHUNK) {
            const chunk = rows.slice(j, j + CHUNK);
            const { error: clasifErr } = await supabase.from("lote_clasificacion").insert(chunk);
            if (clasifErr) throw toError(clasifErr);
          }
          clasificacionesInsertadas += 1;
          filasClasificacion += rows.length;
          kgPodridoReal += inf.kgPodrido;
        }
      }

      onProgress?.(plan.items.length, plan.items.length);

      return {
        informesProcesados: plan.items.length,
        descartados: plan.descartados,
        clasificacionesInsertadas,
        filasClasificacion,
        yaTenianInforme: plan.nYaTenianInforme,
        lotesDiaReparados,
        kgReparados,
        kgPodridoReal,
      };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: PARTES_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: ["historico-informes-lote"] });
      // lotes_dia nuevas cambian dedup de producción, stock y mermas.
      queryClient.invalidateQueries({ queryKey: ["historico-produccion"] });
      queryClient.invalidateQueries({ queryKey: ["merma-lote"] });
      queryClient.invalidateQueries({ queryKey: ["entradas_bascula"] });
      queryClient.invalidateQueries({ queryKey: ["trazabilidad-lote"] });
    },
  });

  return {
    clasificacionCubierta: clasificacionCubiertaQuery.data ?? null,
    isLoadingClasificacionCubierta: clasificacionCubiertaQuery.isLoading,
    lotesCubiertos: lotesCubiertosQuery.data ?? null,
    isLoadingLotesCubiertos: lotesCubiertosQuery.isLoading,
    importar,
  };
}

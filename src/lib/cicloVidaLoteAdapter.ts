/**
 * cicloVidaLoteAdapter — puente de SOLO LECTURA entre los datos que
 * useEntradasBascula()/useCamarasExternas() YA cargan y el motor nuevo
 * (eventosLote.ts + cicloVidaLote.ts, ver docs/TRAZABILIDAD_REFUNDACION.md).
 *
 * FASE 3a de la refundación: primer consumidor del motor nuevo (la ficha de
 * lote de Trazabilidad). Este módulo NO hace fetch, NO decide nada de negocio
 * (eso ya lo hacen eventosLote.ts/cicloVidaLote.ts) — solo REORGANIZA la
 * forma de los datos crudos que los hooks existentes exponen en el
 * `ConstruirEventosLoteInput` que pide el motor, y compara (sin persistir
 * nada) el estado nuevo con el que ya enseña el motor VIEJO
 * (buildStockEntradas/StockLoteRow) para poder avisar con una nota corta
 * cuando discrepan — nunca para elegir uno u otro: el viejo sigue mandando en
 * stock/cierres en esta fase (regla del encargo, no tocar eso).
 *
 * Funciones puras (testeadas en cicloVidaLoteAdapter.test.ts): la única parte
 * con React es el hook que las llama (useCicloVidaLoteEvidencia.ts).
 */
import {
  construirEventosLote,
  type ConstruirEventosLoteInput,
  type EntradaBasculaEventoInput,
  type EventoLote,
  type PasadaAnotacionInput,
} from "@/lib/eventosLote";
import type { EntradaConciliacion, PasadaConciliacion, ReciclajeDiaInput } from "@/lib/conciliacionKg";
import { derivarCicloVidaLote, type EstadoLote, type LoteCiclo } from "@/lib/cicloVidaLote";
import type { CamionCamaraExterna, SenalesRecepcion } from "@/lib/camarasExternas";
import type { CierreModo, StockLoteRow } from "@/lib/entradasBascula";
import { normalizarLoteCodigo } from "@/lib/loteCodigo";

// ─── 1) Adaptación de forma: filas de hooks → input del motor nuevo ─────────

/**
 * Forma mínima de una fila de entradas_bascula que necesita el motor nuevo —
 * duck-typing contra `EntradaBasculaRow` (useEntradasBascula.ts), sin acoplar
 * este módulo al tipo generado de Supabase.
 */
export interface EntradaParaEventos {
  lote: string;
  fecha: string;
  finca: string | null;
  articulo: string | null;
  agricultor: string | null;
  kg_entrada: number;
  kg_ajuste_stock: number;
  merma_camara_kg?: number | null;
  cerrado_at?: string | null;
  cierre_modo?: CierreModo | null;
  camara_confirmada_nombre?: string | null;
  camara_confirmada_fecha?: string | null;
}

/** Pasada cruda de lotes_dia (LoteProcesadoConCalidad de useEntradasBascula.ts), con el `id` real de la fila para poder cruzar las anotaciones por lote_dia_id. */
interface PasadaParaEventos {
  id: string;
  lote_codigo: string | null;
  kg_peso_total: number | null;
  date: string | null;
}

/** Fila de pasada_anotaciones (PasadaAnotacionRow, pasadaAnotaciones.ts) tal cual la agrupa useEntradasBascula().anotacionesPorLoteDia. */
interface AnotacionParaEventos {
  lote_dia_id: string;
  codigo_extra: string;
  nota: string | null;
}

export interface ConstruirInputEventosParams {
  /**
   * Entradas reales + precalibrado + CAMPO/CIT juntas: eventosDeEntradaBascula
   * (eventosLote.ts) reutiliza esEntradaPrecalibrado/esEntradaCampoCit para
   * clasificar cada una por sí solo, así que aquí basta con juntarlas TODAS
   * (mismo criterio que usa el banco dorado, cicloVidaLote.golden.test.ts).
   */
  entradas: EntradaParaEventos[];
  /** Solo las que conciliarKgProcesados debe repartir de verdad: reales (esPrecalibrado=false). Nunca CAMPO/CIT — igual que useEntradasBascula.ts. */
  entradasConciliacionReales: EntradaParaEventos[];
  /** Igual que las anteriores pero de precalibrado (esPrecalibrado=true): topan el reparto sin contar como stock. */
  entradasConciliacionPrecalibrado: EntradaParaEventos[];
  pasadas: PasadaParaEventos[];
  reciclajePorDia: ReciclajeDiaInput[];
  anotaciones: AnotacionParaEventos[];
  camionesCamaraExterna: CamionCamaraExterna[];
  /** Señal YA UNIDA (externa + confirmación física) que useEntradasBascula.ts inyecta en conciliarKgProcesados — se reconstruye en el hook a partir de `stock.filas.enCamaraConfirmada` (mismo patrón que useAsentamientoDia.ts). */
  lotesConfirmadosEnCamara: Set<string>;
  senalesCamaraExterna: SenalesRecepcion;
  hoy: string;
}

function aEventoEntrada(e: EntradaParaEventos): EntradaBasculaEventoInput {
  return {
    lote: e.lote,
    fecha: e.fecha,
    kg_entrada: e.kg_entrada,
    finca: e.finca,
    articulo: e.articulo,
    agricultor: e.agricultor,
    kg_ajuste_stock: e.kg_ajuste_stock,
    merma_camara_kg: e.merma_camara_kg ?? null,
    cerrado_at: e.cerrado_at ?? null,
    cierre_modo: e.cierre_modo ?? null,
  };
}

/** Mismo cálculo que el `aConciliacion` inline de useEntradasBascula.ts — no se duplica la fórmula, solo el shape. */
function aEntradaConciliacion(e: EntradaParaEventos, esPrecalibrado: boolean): EntradaConciliacion {
  return {
    lote: e.lote,
    fecha: e.fecha,
    finca: e.finca,
    articulo: e.articulo,
    kg_entrada: e.kg_entrada,
    kg_preasignado: Math.max(0, Number(e.kg_ajuste_stock) || 0),
    esPrecalibrado,
    cerrado: Boolean(e.cerrado_at),
    kg_merma_camara: e.merma_camara_kg ?? null,
  };
}

/**
 * Construye el input completo del motor nuevo a partir de los datos YA
 * cargados por useEntradasBascula()/useCamarasExternas() — ningún fetch
 * nuevo, mismo reparto que el motor viejo (conciliarKgProcesados se reutiliza
 * tal cual dentro de eventosLote.ts, no se reimplementa aquí).
 */
function construirInputEventosLote(params: ConstruirInputEventosParams): ConstruirEventosLoteInput {
  const entradasEvento: EntradaBasculaEventoInput[] = params.entradas.map(aEventoEntrada);

  const entradasConciliacion: EntradaConciliacion[] = [
    ...params.entradasConciliacionReales.map((e) => aEntradaConciliacion(e, false)),
    ...params.entradasConciliacionPrecalibrado.map((e) => aEntradaConciliacion(e, true)),
  ];

  const pasadas: PasadaConciliacion[] = params.pasadas.map((p) => ({
    lote_codigo: p.lote_codigo,
    kg_peso_total: p.kg_peso_total,
    date: p.date,
  }));

  // Fecha de cada pasada por su id (lote_dia_id): pasada_anotaciones no tiene
  // columna de fecha propia (ver pasadaAnotaciones.ts) — hereda la del parte
  // de la pasada que anota. Sin fecha fiable o sin código de 8 dígitos
  // reconocible, se descarta (eventosLote.ts exige lote/fecha, no se inventa
  // ninguno de los dos).
  const fechaPorPasadaId = new Map(params.pasadas.map((p) => [p.id, p.date]));
  const anotacionesPasada: PasadaAnotacionInput[] = params.anotaciones
    .map((a): PasadaAnotacionInput | null => {
      const lote = normalizarLoteCodigo(a.codigo_extra);
      const fecha = fechaPorPasadaId.get(a.lote_dia_id) ?? null;
      if (!lote || !fecha) return null;
      return { lote, fecha, kg: null, nota: a.nota };
    })
    .filter((a): a is PasadaAnotacionInput => a !== null);

  const entradasConCamaraConfirmada = params.entradas.map((e) => ({
    lote: e.lote,
    camara_confirmada_nombre: e.camara_confirmada_nombre ?? null,
    camara_confirmada_fecha: e.camara_confirmada_fecha ?? null,
  }));

  return {
    entradas: entradasEvento,
    entradasConciliacion,
    pasadas,
    reciclajePorDia: params.reciclajePorDia,
    lotesConfirmadosEnCamara: params.lotesConfirmadosEnCamara,
    camionesCamaraExterna: params.camionesCamaraExterna,
    senalesCamaraExterna: params.senalesCamaraExterna,
    entradasConCamaraConfirmada,
    anotacionesPasada,
    hoy: params.hoy,
  };
}

interface CicloVidaCampana {
  eventos: EventoLote[];
  ciclo: LoteCiclo[];
}

/** Atajo: adapta + construye eventos + deriva el ciclo de vida de TODA la campaña de una vez (el motor conciliarKgProcesados reparte a nivel de campaña, no se puede acotar a un solo lote). */
export function construirCicloVidaCampana(params: ConstruirInputEventosParams): CicloVidaCampana {
  const eventos = construirEventosLote(construirInputEventosLote(params));
  const ciclo = derivarCicloVidaLote(eventos, params.hoy);
  return { eventos, ciclo };
}

// ─── 2) Comparación honesta con el motor VIEJO (buildStockEntradas) ─────────

type EstadoViejoResumen = "cerrado" | "procesado" | "parcial" | "pendiente";

/**
 * Traduce la fila del motor VIEJO (buildStockEntradas/StockLoteRow) al mismo
 * lenguaje de "resuelto o no" que el motor nuevo, para poder comparar. No es
 * un estado nuevo: es una lectura de lo que la ficha YA enseña hoy (badge
 * "Procesado" / cerrado_at / StockEstado).
 */
function estadoViejoDeFila(
  fila: Pick<StockLoteRow, "cerrado_at" | "estado"> | null | undefined,
): EstadoViejoResumen | null {
  if (!fila) return null;
  if (fila.cerrado_at) return "cerrado";
  return fila.estado;
}

const RESUELTO_VIEJO: Record<EstadoViejoResumen, boolean> = {
  cerrado: true,
  procesado: true,
  parcial: false,
  pendiente: false,
};

const RESUELTO_NUEVO: Record<EstadoLote, boolean> = {
  cerrado: true,
  completo_pendiente_cierre: true,
  // Explicaciones TERMINALES en las que ambos motores coinciden en dar el
  // lote por resuelto (no es objeto de la comparación: nunca discrepan).
  venta_directa: true,
  derivado_citrica: true,
  parcial: false,
  en_camara_externa: false,
  en_camara_confirmada: false,
  sin_rastro: false,
  sin_evidencia_suficiente: false,
};

const ESTADO_VIEJO_LABEL: Record<EstadoViejoResumen, string> = {
  cerrado: "cerrado a mano",
  procesado: "procesado (completo)",
  parcial: "parcial",
  pendiente: "pendiente",
};

/**
 * Explicación textual del motivo más específico disponible — prioriza la
 * contradicción de primera clase si la hay, luego la señal de ubicación, y
 * por último la regla de oro genérica. Exportada (además de usarse en
 * `compararConMotorViejo`) porque el CINTURÓN Y TIRANTES del cierre
 * automático (fase 3b, ver `aplicarCinturonYTirantes` más abajo) necesita la
 * MISMA razón para explicar por qué el motor nuevo veta un candidato del
 * motor viejo — una sola función, dos consumidores.
 */
export function motivoDiscrepancia(ciclo: LoteCiclo): string {
  const excesoSinDueno = ciclo.contradicciones.find((c) => c.tipo === "exceso_sin_dueno");
  if (excesoSinDueno) return excesoSinDueno.detalle;
  const pasadaVsFoto = ciclo.contradicciones.find((c) => c.tipo === "pasada_vs_foto_stock");
  if (pasadaVsFoto) return pasadaVsFoto.detalle;
  if (ciclo.estado === "en_camara_externa" || ciclo.estado === "en_camara_confirmada") {
    return `hay una señal vigente de que la fruta sigue en cámara (${ciclo.destino}) — esa señal veta el cierre aunque el reparto le hubiera dado kg`;
  }
  if (ciclo.kgPorClase.nombrado === 0 && ciclo.kgPorClase.anotado === 0) {
    return "no hay ninguna mención NOMBRADA ni ANOTADA de este lote en los partes — la regla de oro no deja que solo lo medido o el derrame completen o cierren un lote";
  }
  return `solo llega al ${(ciclo.pctConEvidenciaDura * 100).toFixed(0)}% con evidencia dura (nombrada + anotada)`;
}

export interface DiscrepanciaMotor {
  estadoViejo: EstadoViejoResumen;
  estadoNuevo: EstadoLote;
  nota: string;
}

/**
 * Compara el estado que YA enseña la ficha (motor viejo) con el que deriva el
 * motor nuevo. Solo informa cuando los dos discrepan en si el lote está
 * RESUELTO (cerrado/completo/terminal) o no — el detalle interno (p. ej.
 * "parcial" vs "sin_rastro", ambos "sin resolver") no cuenta como discrepancia
 * relevante, para no generar ruido en lotes donde los dos motores están de
 * acuerdo en lo que importa. Nunca decide cuál de los dos manda: es
 * información para revisar, el viejo sigue mandando en stock/cierres.
 */
export function compararConMotorViejo(
  fila: Pick<StockLoteRow, "cerrado_at" | "estado"> | null | undefined,
  ciclo: LoteCiclo,
): DiscrepanciaMotor | null {
  const viejo = estadoViejoDeFila(fila);
  if (viejo == null) return null;
  if (RESUELTO_VIEJO[viejo] === RESUELTO_NUEVO[ciclo.estado]) return null;
  const resueltoViejoTxt = RESUELTO_VIEJO[viejo] ? "resuelto" : "sin resolver";
  const resueltoNuevoTxt = RESUELTO_NUEVO[ciclo.estado] ? "resuelto" : "sin resolver";
  return {
    estadoViejo: viejo,
    estadoNuevo: ciclo.estado,
    nota: `El motor de evidencia lo deja en "${ciclo.destino}" (${resueltoNuevoTxt}) mientras el motor anterior lo marca "${ESTADO_VIEJO_LABEL[viejo]}" (${resueltoViejoTxt}) porque ${motivoDiscrepancia(ciclo)}.`,
  };
}

// ─── 3) CINTURÓN Y TIRANTES del cierre automático (fase 3b + TAREA 0) ───────
// Decisión de diseño central del encargo (no negociable, ver
// docs/TRAZABILIDAD_REFUNDACION.md fase 3): un lote solo es candidato a
// cierre automático (normal o compuesto) si LOS DOS motores están de acuerdo.
// El motor viejo (esCandidatoCierreAutomatico/esCandidatoCierreCompuesto,
// entradasBascula.ts, con su propio puente de la regla de oro —
// completoConEvidencia, commit 15eb711) sigue siendo quien decide en primera
// instancia (useEntradasBascula.ts sigue montando `stock.filas` y llamando a
// esas dos funciones tal cual); esto solo AÑADE el veto del motor nuevo.
//
// TAREA 0 (hueco documentado de la 3b): el cinturón cubría solo DOS de los
// TRES orígenes del auto-cierre — faltaba el candidato de PRECALIBRADO
// (stockPrecalibrado.candidatosCierre, buildStockPrecalibrado en
// stockPrecalibrado.ts). Caso real que lo motivó: el barrido del 04-08 a las
// 07:28 cerró 5 re-entradas PREC (26030507/26031908/26032309/26070801/
// 26070802) SIN ninguna indicación real en los informes — solo tenían una
// MENCIÓN textual sin kg cuantificable en una pasada compuesta (evidencia
// "nombrado" pero kg:null, ver eventosLote.ts), que el motor viejo tomaba
// igualmente como "consumido" (motivo "compuesto") sin pasar por la regla de
// oro. `aplicarCinturonYTirantes` es genérica en `T`/`tipo` precisamente para
// poder aplicarse también a este tercer origen sin duplicar el bucle ni la
// redacción de la razón (ver useEntradasBascula.ts, tercera llamada).

/**
 * ¿El motor NUEVO también daría este lote por completo? El vocabulario de
 * cicloVidaLote.ts no distingue "completo por pasada propia" de "completo
 * por evidencia de pasada compuesta" (ambos son, para el motor nuevo,
 * simplemente "la evidencia nombrada/anotada+medida, con la puerta abierta,
 * alcanza el umbral") — por eso un único estado (`completo_pendiente_cierre`)
 * sirve para intersecar TANTO los candidatos normales como los compuestos
 * del motor viejo (ver el encargo: "el equivalente compuesto de
 * cicloVidaLote" es este mismo estado, no hay uno aparte).
 *
 * TAREA 0 (tercer origen del cinturón, PRECALIBRADO): para ese tipo en
 * concreto también se acepta el estado "cerrado" — SOLO para "precalibrado",
 * no para "completo"/"compuesto" (ver `tipo` más abajo). Motivo —
 * `eventosPorLote` (eventosLote.ts) agrupa TODOS los eventos de un mismo
 * código de 8 dígitos normalizado, así que una re-entrada de PRECALIBRADO
 * puede compartir código con una entrada que YA tiene un cierre manual
 * (ANOTADO) legítimo de otro origen: en ese caso el GRUPO entero ya es
 * "cerrado" para el motor de evidencia, y vetar el candidato PREC solo porque
 * su propio kg no llegó a "completo_pendiente_cierre" sería MÁS estricto que
 * el propio veredicto del motor nuevo (que ya dio el código por resuelto vía
 * evidencia ANOTADA). Se restringe a "precalibrado" (no se generaliza a los
 * otros dos orígenes) porque esCandidatoCierreAutomatico/esCandidatoCierreCompuesto
 * YA excluyen cualquier fila con `cerrado_at` propio (entradasBascula.ts) —
 * el único camino real hacia un "cerrado" heredado es el código COMPARTIDO
 * con una re-entrada PREC, y ensanchar el criterio para los otros dos tipos
 * sin ese caso de uso solo aumentaría la superficie de cierres automáticos
 * sin ningún caso real que lo pida. OJO: esto NO relaja el caso que motivó la
 * tarea — los 5 PREC "sin indicación" del barrido 04-08
 * (26030507/26031908/26032309/26070801/26070802) evaluados ANTES de escribir
 * su propio cierre siguen dando "sin_rastro" (mención textual sin kg
 * cuantificable, sin cierre_manual todavía) y por tanto SIGUEN VETADOS — ver
 * cicloVidaLoteAdapter.precalibrado.test.ts.
 */
function esCandidatoSegunMotorNuevo(ciclo: LoteCiclo | null | undefined, tipo: DiscrepanciaCierre["tipo"]): boolean {
  if (ciclo?.estado === "completo_pendiente_cierre") return true;
  return tipo === "precalibrado" && ciclo?.estado === "cerrado";
}

export interface DiscrepanciaCierre {
  lote: string;
  /** Qué candidatura del motor viejo vetó el motor nuevo: "completo" = esCandidatoCierreAutomatico; "compuesto" = esCandidatoCierreCompuesto; "precalibrado" = stockPrecalibrado.candidatosCierre (TAREA 0, tercer origen del auto-cierre). */
  tipo: "completo" | "compuesto" | "precalibrado";
  /** Estado que le da el motor nuevo a este lote — `null` si el motor nuevo no tiene ningún evento para él (no debería pasar con datos reales: toda fila de stock viene de una entrada de báscula, que siempre genera al menos el evento `entrada_bascula`). */
  estadoNuevo: EstadoLote | null;
  /** Por qué el motor nuevo no lo ve completo — misma explicación que `compararConMotorViejo` (motivoDiscrepancia), para no mantener dos redacciones distintas del mismo hecho. */
  razon: string;
}

/**
 * Aplica el cinturón y tirantes a una lista de candidatos YA filtrados por el
 * motor VIEJO (esCandidatoCierreAutomatico o esCandidatoCierreCompuesto): los
 * separa en `confirmados` (los dos motores de acuerdo — estos SÍ se cierran)
 * y `discrepancias` (el viejo dice sí, el nuevo veta — estos NO se cierran,
 * quedan en la cola de revisión `discrepanciasCierre` del hook). Función PURA
 * y genérica en `T` porque el hook llama a esto dos veces con formas de
 * candidato ligeramente distintas (candidatosCierreAutomatico y
 * candidatosCierreCompuesto, ambos `{id, lote}`), sin duplicar el bucle.
 */
export function aplicarCinturonYTirantes<T extends { lote: string }>(
  candidatosMotorViejo: T[],
  tipo: DiscrepanciaCierre["tipo"],
  cicloPorLote: Map<string, LoteCiclo>,
): { confirmados: T[]; discrepancias: DiscrepanciaCierre[] } {
  const confirmados: T[] = [];
  const discrepancias: DiscrepanciaCierre[] = [];
  for (const candidato of candidatosMotorViejo) {
    const ciclo = cicloPorLote.get(candidato.lote) ?? null;
    if (esCandidatoSegunMotorNuevo(ciclo, tipo)) {
      confirmados.push(candidato);
      continue;
    }
    discrepancias.push({
      lote: candidato.lote,
      tipo,
      estadoNuevo: ciclo?.estado ?? null,
      razon: ciclo
        ? motivoDiscrepancia(ciclo)
        : "el motor de evidencia no tiene ningún evento para este lote (sin entrada de báscula reconocida) — revisar manualmente antes de cerrar.",
    });
  }
  return { confirmados, discrepancias };
}

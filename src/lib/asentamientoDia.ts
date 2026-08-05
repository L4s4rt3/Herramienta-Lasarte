/**
 * asentamientoDia.ts — "asentamiento" día a día de la campaña: replay
 * cronológico de las pasadas del calibrador para dejar, por lote, su ciclo de
 * vida asentado (primera/última pasada, día en que quedó COMPLETO según las
 * reglas ya existentes) y una clasificación de EVIDENCIA de con qué solidez
 * sabemos qué pasó con sus kg.
 *
 * ENCARGO (dueño, 04-ago-2026): "analizar parte de cada día desde el inicio
 * de la campaña para que los informes de lotes se asienten". Corrección
 * textual del dueño sobre cómo clasificar: "nada de FIFO por conveniencia:
 * cada lote de precalibrado SE INDICA en los informes, se usa el que se
 * indique".
 *
 * FASE 3c de la refundación (docs/TRAZABILIDAD_REFUNDACION.md, "mismo número
 * ⇒ misma función pura"): la CLASIFICACIÓN de evidencia (dura/derivada/sin
 * rastro) ya NO es un cálculo paralelo de este módulo — sale de
 * `kgPorClase` del motor único (cicloVidaLote.ts), el mismo que consumen
 * Stock/Trazabilidad. Se recibe ya calculado (`AsentamientoInput.cicloPorLote`,
 * reutilizando `cicloPorLote` del hook de entradas — cero cálculos
 * duplicados, ver useAsentamientoDia.ts) y se traduce así:
 *   (a) DURA = kgPorClase.nombrado + kgPorClase.anotado (evidencia NOMBRADA o
 *       ANOTADA — la REGLA DE ORO dice que ambas "pueden todo": mover kg,
 *       completar, cerrar).
 *   (b) DERIVADA = kgPorClase.derivado (derrame de exceso, misma finca/
 *       variedad — SOLO sugerencia, la regla de oro prohíbe que cuente como
 *       evidencia real).
 *   (c) SIN RASTRO = el resto: kgPorClase.medido + kgPorClase.sinRastro. OJO
 *       (cambio de comportamiento respecto a ANTES de la 3c, documentado caso
 *       a caso en asentamientoDia.test.ts): antes, un informe de stock REAL
 *       (kg_ajuste_stock) contaba aquí como evidencia "dura" por sí solo (una
 *       medición física, "no una asunción"). La REGLA DE ORO del motor nuevo
 *       es más estricta: lo MEDIDO (foto de stock, merma real, cámara
 *       externa, venta directa) fija cantidad/ubicación pero NUNCA prueba por
 *       sí solo que el lote se procesó — así que ahora cuenta como "sin
 *       rastro" salvo que ADEMÁS haya una mención NOMBRADA/ANOTADA (en cuyo
 *       caso ya suma dentro de (a) vía kgPorClase.medido, que cicloVidaLote.ts
 *       solo deja sumar con la "puerta" abierta). Es MÁS honesto: la card ya
 *       no puede confundir "alguien midió esto" con "sabemos qué pasó con
 *       ello". El invariante de conservación (a + b + c === kg_entrada) se
 *       mantiene EXACTO porque reutiliza el propio invariante de
 *       `crearKgPorClase` (cicloVidaLote.ts): medido + sinRastro
 *       === kg_entrada − nombrado − anotado − derivado, incluido el caso raro
 *       de un `medido` NEGATIVO por contradicción (foto de stock que anula
 *       una pasada propia, FASE 3b) — ese negativo se conserva con signo
 *       dentro de "sin rastro" (nunca se capa a 0), la misma magnitud de aviso
 *       que ya expone cicloVidaLote.ts.
 * Nunca se inventa un casado (ni FIFO, ni antigüedad, ni proximidad): la
 * clasificación sale del motor único; el REPLAY (más abajo) sigue leyendo
 * datos ya existentes (pasadas nombradas, conciliación, informe de stock).
 *
 * MOTOR REUTILIZADO (regla del repo: no duplicar fórmulas) — TODO el cálculo
 * de reparto/capacidad/cierre sale de módulos ya existentes:
 *   - cicloVidaLote.ts (kgPorClase) — la CLASIFICACIÓN de evidencia (3c)
 *   - conciliarKgProcesados / detectarLotesEnPasadaCompuesta (conciliacionKg.ts)
 *   - buildStockEntradas / capacidadFraccionEstimada (entradasBascula.ts)
 * Este módulo NO reimplementa ninguna de esas fórmulas: solo las invoca sobre
 * prefijos crecientes de pasadas (el "replay") y organiza su salida por lote.
 *
 * REPLAY DÍA A DÍA (SE CONSERVA tal cual en la 3c: es el eje TIEMPO que
 * cicloVidaLote.ts no calcula — "el día en que un lote quedó completo" no es
 * evidencia, es cuándo se alcanzó el umbral) — cómo se consigue "kg acumulado
 * a fecha X" sin duplicar la fórmula de reparto: se llama a
 * `conciliarKgProcesados` UNA VEZ POR CADA FECHA DISTINTA que trae alguna
 * pasada (no una vez por día de calendario), cada vez con el prefijo de
 * pasadas hasta esa fecha (inclusive). Es el MISMO motor, exacto, aplicado a
 * una "foto" cada vez más completa de la campaña — no una aproximación. Con
 * la campaña real (~215 fechas con parte, ~1.300 pasadas, ~1.300 entradas,
 * verificado contra la BD 04-08-2026) esto tarda del orden de segundos,
 * aceptable para un cálculo en segundo plano (useMemo) que no se repite en
 * cada render. Si la campaña creciera mucho más, la siguiente optimización
 * sería exponer la atribución por-pasada directamente desde conciliacionKg.ts
 * (fuera de alcance de este encargo).
 */
import {
  capacidadFraccionEstimada,
  conciliarKgProcesados,
  detectarLotesEnPasadaCompuesta,
  type EntradaConciliacion,
  type EvidenciaLotePasadaCompuesta,
  type PasadaConciliacion,
  type ReciclajeDiaInput,
} from "@/lib/conciliacionKg";
import {
  buildStockEntradas,
  diffDias,
  estadoLotePorProcesado,
  type CierreModo,
  type StockEstado,
} from "@/lib/entradasBascula";
import type { ReentradaPrecalibradoInput } from "@/lib/stockPrecalibrado";
import type { LoteCiclo } from "@/lib/cicloVidaLote";

// ─── Entradas del módulo (superset de lo que piden conciliarKgProcesados / ──
// buildStockEntradas / buildStockPrecalibrado, para no repetir el mapeo tres
// veces en el caller) ────────────────────────────────────────────────────────

/** Entrada real (no PREC, no Campo/Cit) — mismo shape que ya monta useEntradasBascula. */
export interface EntradaRealAsentamiento {
  lote: string;
  fecha: string;
  finca: string | null;
  articulo: string | null;
  agricultor?: string | null;
  kg_entrada: number;
  kg_ajuste_stock?: number | null;
  cerrado_at?: string | null;
  cierre_modo?: CierreModo | null;
  kg_merma_camara?: number | null;
}

/** Re-entrada interna de precalibrado — mismo shape que ReentradaPrecalibradoInput. */
export type EntradaPrecalibradoAsentamiento = ReentradaPrecalibradoInput;

export interface AsentamientoInput {
  entradas: EntradaRealAsentamiento[];
  entradasPrecalibrado: EntradaPrecalibradoAsentamiento[];
  /** Pasadas crudas del calibrador (lotes_dia + fecha del parte), TODA la campaña. */
  pasadas: PasadaConciliacion[];
  reciclajePorDia?: ReciclajeDiaInput[];
  /** Códigos con señal VIGENTE de "sigue en cámara" ahora mismo — la UNIÓN de cámara EXTERNA (camarasExternas.ts) y confirmación FÍSICA (camaraConfirmada.ts, refuerzo 04-08-2026): se pasa tal cual a conciliarKgProcesados/buildStockEntradas — nunca reciben derrame ni cierran solos. Se llamó `lotesEnCamaraExterna` cuando solo cubría la primera señal. */
  lotesConfirmadosEnCamara?: Set<string>;
  /**
   * FASE 3c: lote (8 dígitos normalizado) → ciclo de vida derivado por el
   * motor único (cicloVidaLote.ts) — de aquí sale la CLASIFICACIÓN de
   * evidencia (kgPorClase), ver cabecera del archivo. El caller (useAsentamientoDia.ts)
   * reutiliza el `cicloPorLote` que useEntradasBascula() YA calcula — cero
   * cálculos duplicados, este módulo nunca vuelve a construir eventos ni a
   * derivar el ciclo por su cuenta.
   */
  cicloPorLote: Map<string, LoteCiclo>;
  /** Fecha de referencia ("hoy", ISO) para antigüedad/estado final. */
  hoy: string;
}

type EvidenciaLote = "dura" | "derivada" | "sin_rastro";

interface LoteAsentado {
  codigo: string;
  esPrecalibrado: boolean;
  fechaEntrada: string;
  kgEntrada: number;
  /** kg con evidencia DURA — FASE 3c: kgPorClase.nombrado + kgPorClase.anotado del motor único (cicloVidaLote.ts). Ya NO incluye kg_ajuste_stock por sí solo (ver cabecera del archivo: lo MEDIDO nunca prueba por sí solo que el lote se procesó). */
  kgEvidenciaDura: number;
  /** kg recibido por derrame de exceso (misma finca / misma variedad) — FASE 3c: kgPorClase.derivado. Nunca aplica a precalibrado (conciliarKgProcesados excluye el PREC del derrame). */
  kgDerivada: number;
  /** kg_entrada − (kgEvidenciaDura + kgDerivada): sin ningún rastro todavía — FASE 3c: kgPorClase.medido + kgPorClase.sinRastro (conserva el invariante de crearKgPorClase, ver cabecera). */
  kgSinRastro: number;
  /** Etiqueta única (la evidencia más fuerte que tenga el lote: dura > derivada > sin_rastro). */
  evidencia: EvidenciaLote;
  /** Primera fecha (de cualquier pasada, propia o compuesta) que nombra este código. null si nunca se nombró. */
  fechaPrimeraPasada: string | null;
  /** Última fecha que lo nombra. */
  fechaUltimaPasada: string | null;
  /** Primer día del replay en que el lote alcanzó el estado "procesado" (reglas existentes). null si nunca lo alcanzó a fecha `hoy`. */
  diaCompleto: string | null;
  estadoFinal: StockEstado;
  diasEnCamara: number;
}

export interface CoberturaCampana {
  kgTotales: number;
  kgEvidenciaDura: number;
  kgDerivada: number;
  kgSinRastro: number;
  nLotes: number;
  nLotesEvidenciaDura: number;
  nLotesDerivada: number;
  nLotesSinRastro: number;
  /** De "sin rastro", los que además ya están CERRADOS (estadoFinal "procesado"): el hueco no es "todavía no le toca", es un hueco real sin explicación textual ni de derrame. */
  kgSinRastroCerrado: number;
  nLotesSinRastroCerrado: number;
  porLote: LoteAsentado[];
}

// ─── Convención A (primer/todos los grupos de 8 dígitos) reutilizada tal ───
// cual la usa conciliacionKg.ts (detectarLotesEnPasadaCompuesta, fase 1 de
// conciliarKgProcesados): no se inventa otra forma de leer el texto.
function codigosDeLaPasada(texto: string | null | undefined): string[] {
  return String(texto ?? "").match(/\d{8}/g) ?? [];
}

/** Primera y última fecha (de cualquier pasada con kg>0, propia o compuesta) que nombra cada código. Evidencia puramente TEXTUAL: no reparte kg, solo constata que el código se mencionó. */
function fechasNombradoPorLote(pasadas: PasadaConciliacion[]): { primera: Map<string, string>; ultima: Map<string, string> } {
  const primera = new Map<string, string>();
  const ultima = new Map<string, string>();
  for (const p of pasadas) {
    const kg = Number(p.kg_peso_total) || 0;
    if (kg <= 0 || !p.date) continue;
    for (const code of new Set(codigosDeLaPasada(p.lote_codigo))) {
      if (!primera.has(code) || p.date < primera.get(code)!) primera.set(code, p.date);
      if (!ultima.has(code) || p.date > ultima.get(code)!) ultima.set(code, p.date);
    }
  }
  return { primera, ultima };
}

// ─── Clasificación de evidencia — FASE 3c: sale del motor único ─────────────
// (cicloVidaLote.ts), NO de un cálculo paralelo. Función compartida por
// clasificarLotesReales/clasificarLotesPrecalibrado para no repetir la
// traducción kgPorClase → {dura, derivada, sinRastro, evidencia} dos veces
// (mismo código, mismo número, ver docs/TRAZABILIDAD_REFUNDACION.md).
function clasificarEvidenciaDesdeCiclo(
  ciclo: LoteCiclo | undefined,
  kgEntradaSiFalta: number,
): Pick<LoteAsentado, "kgEvidenciaDura" | "kgDerivada" | "kgSinRastro" | "evidencia"> {
  if (!ciclo) {
    // Defensivo, no debería pasar con datos reales: toda fila de esta función
    // viene de una entrada de báscula, y esa entrada SIEMPRE genera al menos
    // el evento `entrada_bascula` en el motor nuevo (eventosLote.ts) — así
    // que cicloPorLote.get(código) nunca debería faltar. Si faltara de
    // verdad (p.ej. un caller de test con datos a medio construir), se deja
    // "sin_rastro" en vez de inventar evidencia — null ≠ 0, pero aquí no hay
    // ningún dato de kg que perder: se declara TODO sin rastro, nunca 0 kg
    // "procesados" por defecto.
    return { kgEvidenciaDura: 0, kgDerivada: 0, kgSinRastro: kgEntradaSiFalta, evidencia: "sin_rastro" };
  }
  // (a) DURA = nombrado + anotado (evidencia NOMBRADA/ANOTADA, "puede todo").
  const kgEvidenciaDura = ciclo.kgPorClase.nombrado + ciclo.kgPorClase.anotado;
  // (b) DERIVADA = derrame de exceso (DERIVADO, solo sugerencia — regla de oro).
  const kgDerivada = ciclo.kgPorClase.derivado;
  // (c) SIN RASTRO = el resto: medido + sinRastro (ver cabecera del archivo
  // para el porqué de incluir `medido` aquí y no en "dura"). Se conserva CON
  // SIGNO (nunca Math.max(0, …)): si `medido` sale negativo por una
  // contradicción grande (foto de stock que anula una pasada propia, FASE
  // 3b), esa magnitud de aviso debe seguir siendo visible en la card en vez
  // de esconderse capando a 0 — exactamente el mismo criterio que
  // cicloVidaLote.ts aplica a su propio `kgPorClase.sinRastro`.
  const kgSinRastro = ciclo.kgPorClase.medido + ciclo.kgPorClase.sinRastro;
  const evidencia: EvidenciaLote = kgEvidenciaDura > 0 ? "dura" : kgDerivada > 0 ? "derivada" : "sin_rastro";
  return { kgEvidenciaDura, kgDerivada, kgSinRastro, evidencia };
}

// ─── Replay cronológico por fecha ───────────────────────────────────────────

interface SnapshotFecha {
  fecha: string;
  /** lote → kg conciliado ACUMULADO hasta esa fecha (inclusive), sin kg_preasignado — mismo shape que ConciliacionKg.procesados, en Map para lookup O(1). */
  porLote: Map<string, number>;
}

/**
 * Replay cronológico: llama a `conciliarKgProcesados` una vez por cada fecha
 * DISTINTA de las pasadas (orden ascendente), cada vez con el prefijo de
 * pasadas hasta esa fecha. Cada `SnapshotFecha` es exactamente lo que
 * `conciliarKgProcesados` habría devuelto si la campaña se hubiera cortado
 * ahí — no una aproximación. Exportado para poder auditar/testear el
 * "acumulado por día" de un lote concreto sin pasar por todo el agregado de
 * cobertura.
 */
function replayConciliacionPorFecha(
  entradas: EntradaConciliacion[],
  pasadas: PasadaConciliacion[],
  reciclajePorDia: ReciclajeDiaInput[] = [],
  lotesConfirmadosEnCamara?: Set<string>,
): SnapshotFecha[] {
  const fechas = Array.from(
    new Set(pasadas.filter((p) => p.date && (Number(p.kg_peso_total) || 0) > 0).map((p) => p.date as string)),
  ).sort();

  const snapshots: SnapshotFecha[] = [];
  for (const fecha of fechas) {
    const pasadasHasta = pasadas.filter((p) => p.date && p.date <= fecha);
    const parcial = conciliarKgProcesados(entradas, pasadasHasta, reciclajePorDia, lotesConfirmadosEnCamara);
    snapshots.push({ fecha, porLote: new Map(parcial.procesados.map((p) => [p.lote_codigo, p.kg_peso_total])) });
  }
  return snapshots;
}

/**
 * Primer día del replay en que un lote REAL (no precalibrado) alcanza el
 * estado "procesado" según `estadoLotePorProcesado` (mismo umbral dinámico
 * por edad que usa buildStockEntradas, vía `capacidadFraccionEstimada` — no
 * se duplica el umbral). `null` si nunca lo alcanza dentro de los snapshots
 * disponibles.
 */
function diaCompletoPorUmbral(
  entrada: EntradaConciliacion,
  kgPreasignado: number,
  snapshots: SnapshotFecha[],
): string | null {
  // Ya nace COMPLETO solo con el ajuste de stock (sin necesitar ninguna
  // pasada): el día de referencia es la propia fecha de entrada, nunca la
  // fecha de un snapshot ajeno (que podría ser incluso anterior a que este
  // lote existiera).
  const estadoDia0 = estadoLotePorProcesado(entrada.kg_entrada, kgPreasignado, false, 0, capacidadFraccionEstimada);
  if (estadoDia0 === "procesado") return entrada.fecha;

  for (const s of snapshots) {
    if (s.fecha < entrada.fecha) continue; // el lote aún no existía en esa fecha
    const kgConciliado = s.porLote.get(entrada.lote) ?? 0;
    const totalAsignado = kgPreasignado + kgConciliado;
    const dias = diffDias(entrada.fecha, s.fecha);
    const estado = estadoLotePorProcesado(entrada.kg_entrada, totalAsignado, false, dias, capacidadFraccionEstimada);
    if (estado === "procesado") return s.fecha;
  }
  return null;
}

// ─── Adaptadores a los tipos de conciliacionKg/entradasBascula (sin duplicar shape) ─

function aEntradaConciliacion(e: EntradaRealAsentamiento, esPrecalibrado: boolean): EntradaConciliacion {
  return {
    lote: e.lote,
    fecha: e.fecha,
    finca: e.finca ?? null,
    articulo: e.articulo ?? null,
    kg_entrada: Number(e.kg_entrada) || 0,
    kg_preasignado: Math.max(0, Number(e.kg_ajuste_stock) || 0),
    esPrecalibrado,
    cerrado: Boolean(e.cerrado_at),
    kg_merma_camara: e.kg_merma_camara ?? null,
  };
}

function aEntradaConciliacionPrec(e: EntradaPrecalibradoAsentamiento): EntradaConciliacion {
  return {
    lote: e.lote,
    fecha: e.fecha,
    finca: e.finca,
    articulo: null,
    kg_entrada: Number(e.kg_entrada) || 0,
    esPrecalibrado: true,
    cerrado: Boolean(e.cerrado_at),
  };
}

// ─── Clasificación de lotes REALES ──────────────────────────────────────────

function clasificarLotesReales(
  entradas: EntradaRealAsentamiento[],
  final: ReturnType<typeof conciliarKgProcesados>,
  evidenciaCompuesta: Map<string, EvidenciaLotePasadaCompuesta>,
  fechasNombrado: { primera: Map<string, string>; ultima: Map<string, string> },
  snapshots: SnapshotFecha[],
  hoy: string,
  lotesConfirmadosEnCamara: Set<string> | undefined,
  cicloPorLote: Map<string, LoteCiclo>,
): LoteAsentado[] {
  // PODA 3c: antes aquí se calculaba `kgConciliadoPorLote`/`derramaRecibida`
  // para la clasificación de evidencia propia de este módulo — ya no hace
  // falta (sale de `cicloPorLote`, ver clasificarEvidenciaDesdeCiclo más
  // arriba). `final.procesados` sigue entrando en buildStockEntradas (estado/
  // eje tiempo, no se toca) y en diaCompletoPorUmbral vía los `snapshots` del
  // replay (que se calculan aparte, ver construirAsentamientoCampana).
  const stock = buildStockEntradas(
    entradas.map((e) => ({
      lote: e.lote,
      fecha: e.fecha,
      kg_entrada: Number(e.kg_entrada) || 0,
      kg_ajuste_stock: Number(e.kg_ajuste_stock) || 0,
      finca: e.finca,
      articulo: e.articulo,
      agricultor: e.agricultor ?? null,
      cerrado_at: e.cerrado_at ?? null,
      cierre_modo: e.cierre_modo ?? null,
    })),
    final.procesados,
    hoy,
    evidenciaCompuesta,
    capacidadFraccionEstimada,
    lotesConfirmadosEnCamara,
  );

  const entradaPorLote = new Map(entradas.map((e) => [e.lote, e]));

  return stock.filas.map((fila): LoteAsentado => {
    const original = entradaPorLote.get(fila.lote);
    const kgPreasignado = Math.max(0, Number(original?.kg_ajuste_stock) || 0);

    // Día completo: primero se intenta el cruce "natural" de umbral vía el
    // replay; si el lote solo cierra por evidencia de compuesta o cierre
    // manual (nunca cruza el umbral por sí solo), se usa la fecha de esa
    // evidencia — nunca se inventa una fecha que no exista en los datos.
    let diaCompleto: string | null = original ? diaCompletoPorUmbral(aEntradaConciliacion(original, false), kgPreasignado, snapshots) : null;
    if (!diaCompleto && fila.estado === "procesado") {
      diaCompleto = fila.procesadoEnCompuesto?.ultimaFecha
        ?? fila.ultima_fecha_procesado
        ?? (fila.cerrado_at ? fila.cerrado_at.slice(0, 10) : null);
    }

    const { kgEvidenciaDura, kgDerivada, kgSinRastro, evidencia } = clasificarEvidenciaDesdeCiclo(cicloPorLote.get(fila.lote), fila.kg_entrada);

    return {
      codigo: fila.lote,
      esPrecalibrado: false,
      fechaEntrada: fila.fecha_entrada,
      kgEntrada: fila.kg_entrada,
      kgEvidenciaDura,
      kgDerivada,
      kgSinRastro,
      evidencia,
      fechaPrimeraPasada: fechasNombrado.primera.get(fila.lote) ?? null,
      fechaUltimaPasada: fechasNombrado.ultima.get(fila.lote) ?? null,
      diaCompleto,
      estadoFinal: fila.estado,
      diasEnCamara: fila.dias_en_camara,
    };
  });
}

// ─── Clasificación de re-entradas de PRECALIBRADO ───────────────────────────
// El circuito PREC nunca recibe derrame (conciliarKgProcesados lo excluye a
// propósito, ver su cabecera): la EVIDENCIA (dura/derivada/sin_rastro) sale
// ahora de cicloPorLote (motor único, FASE 3c) — lo que este bloque calcula
// (directo/compuesta/pendiente) sigue vivo SOLO para el EJE TIEMPO
// (estadoFinal/diaCompleto: "¿en qué fecha se dio por resuelta esta
// re-entrada?"), que cicloVidaLote.ts no expone por fecha.
function clasificarLotesPrecalibrado(
  reentradas: EntradaPrecalibradoAsentamiento[],
  final: ReturnType<typeof conciliarKgProcesados>,
  evidenciaCompuesta: Map<string, EvidenciaLotePasadaCompuesta>,
  fechasNombrado: { primera: Map<string, string>; ultima: Map<string, string> },
  hoy: string,
  cicloPorLote: Map<string, LoteCiclo>,
): LoteAsentado[] {
  // buildStockPrecalibrado ya hace exactamente esta clasificación (directo vs
  // compuesta vs pendiente) pero solo devuelve LISTADOS parciales (pendientes,
  // resueltasPorCompuesta) pensados para la UI, no una fila por cada
  // re-entrada. Se reutiliza aquí para no repetir el criterio "directo primero,
  // compuesta si no cubre del todo", una re-entrada a la vez.
  const conciliadoPorLote = new Map<string, { kg: number; ultimaFecha: string | null }>();
  for (const p of final.procesados) {
    const acc = conciliadoPorLote.get(p.lote_codigo) ?? { kg: 0, ultimaFecha: null };
    acc.kg += p.kg_peso_total;
    if (p.date && (!acc.ultimaFecha || p.date > acc.ultimaFecha)) acc.ultimaFecha = p.date;
    conciliadoPorLote.set(p.lote_codigo, acc);
  }

  return reentradas.map((r): LoteAsentado => {
    const kg = Number(r.kg_entrada) || 0;
    const directo = conciliadoPorLote.get(r.lote);
    const reprocesadoDirecto = Math.min(kg, directo?.kg ?? 0);
    const pendienteDirecto = Math.max(0, kg - reprocesadoDirecto);
    const cerrada = Boolean(r.cerrado_at);
    const evidenciaComp = !cerrada && pendienteDirecto > 0 ? evidenciaCompuesta.get(r.lote) ?? null : null;

    // "Resuelta del todo" — SOLO estado/tiempo, ya NO alimenta la evidencia de
    // la card (antes esta misma condición se llamaba `kgSinRastro <= 0.5` y
    // hacía ambas cosas a la vez): cerrada a mano, o la evidencia de compuesta
    // la da por consumida entera, o el directo ya cubrió el kg reintroducido.
    const resueltaDelTodo = cerrada || Boolean(evidenciaComp) || pendienteDirecto <= 0.5;
    const estadoFinal: StockEstado = resueltaDelTodo ? "procesado" : reprocesadoDirecto > 0 ? "parcial" : "pendiente";
    const diasEnCamara = diffDias(r.fecha, hoy);

    const diaCompleto = cerrada
      ? (r.cerrado_at ? r.cerrado_at.slice(0, 10) : null)
      : evidenciaComp
        ? evidenciaComp.ultimaFecha
        : pendienteDirecto <= 0.5
          ? (directo?.ultimaFecha ?? null)
          : null;

    const { kgEvidenciaDura, kgDerivada, kgSinRastro, evidencia } = clasificarEvidenciaDesdeCiclo(cicloPorLote.get(r.lote), kg);

    return {
      codigo: r.lote,
      esPrecalibrado: true,
      fechaEntrada: r.fecha,
      kgEntrada: kg,
      kgEvidenciaDura,
      kgDerivada,
      kgSinRastro,
      evidencia,
      fechaPrimeraPasada: fechasNombrado.primera.get(r.lote) ?? null,
      fechaUltimaPasada: fechasNombrado.ultima.get(r.lote) ?? null,
      diaCompleto,
      estadoFinal,
      diasEnCamara,
    };
  });
}

// ─── Punto de entrada ───────────────────────────────────────────────────────

/**
 * Construye el asentamiento de TODA la campaña: por lote (real o
 * precalibrado) su ciclo de vida (primera/última pasada, día completo,
 * evidencia) y el agregado de cobertura para la card de Análisis diario.
 * Función PURA: no hace fetch ni escribe nada — el hook (useAsentamientoDia)
 * es quien carga los datos con fetchAllRows y se los pasa ya listos.
 */
export function construirAsentamientoCampana(input: AsentamientoInput): CoberturaCampana {
  const { entradas, entradasPrecalibrado, pasadas, reciclajePorDia = [], lotesConfirmadosEnCamara, cicloPorLote, hoy } = input;

  const entradasConciliacion = [
    ...entradas.map((e) => aEntradaConciliacion(e, false)),
    ...entradasPrecalibrado.map(aEntradaConciliacionPrec),
  ];

  const final = conciliarKgProcesados(entradasConciliacion, pasadas, reciclajePorDia, lotesConfirmadosEnCamara);
  const evidenciaCompuesta = detectarLotesEnPasadaCompuesta(pasadas);
  const fechasNombrado = fechasNombradoPorLote(pasadas);
  const snapshots = replayConciliacionPorFecha(entradasConciliacion, pasadas, reciclajePorDia, lotesConfirmadosEnCamara);

  const porLoteReal = clasificarLotesReales(entradas, final, evidenciaCompuesta, fechasNombrado, snapshots, hoy, lotesConfirmadosEnCamara, cicloPorLote);
  const porLotePrec = clasificarLotesPrecalibrado(entradasPrecalibrado, final, evidenciaCompuesta, fechasNombrado, hoy, cicloPorLote);
  const porLote = [...porLoteReal, ...porLotePrec];

  let kgTotales = 0;
  let kgEvidenciaDura = 0;
  let kgDerivada = 0;
  let kgSinRastro = 0;
  let nLotesEvidenciaDura = 0;
  let nLotesDerivada = 0;
  let nLotesSinRastro = 0;
  let kgSinRastroCerrado = 0;
  let nLotesSinRastroCerrado = 0;

  for (const l of porLote) {
    kgTotales += l.kgEntrada;
    kgEvidenciaDura += l.kgEvidenciaDura;
    kgDerivada += l.kgDerivada;
    kgSinRastro += l.kgSinRastro;
    if (l.evidencia === "dura") nLotesEvidenciaDura += 1;
    else if (l.evidencia === "derivada") nLotesDerivada += 1;
    else {
      nLotesSinRastro += 1;
      if (l.estadoFinal === "procesado") {
        nLotesSinRastroCerrado += 1;
        kgSinRastroCerrado += l.kgSinRastro;
      }
    }
  }

  return {
    kgTotales,
    kgEvidenciaDura,
    kgDerivada,
    kgSinRastro,
    nLotes: porLote.length,
    nLotesEvidenciaDura,
    nLotesDerivada,
    nLotesSinRastro,
    kgSinRastroCerrado,
    nLotesSinRastroCerrado,
    porLote,
  };
}

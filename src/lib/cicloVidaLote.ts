/**
 * cicloVidaLote.ts — FASE 1 de la refundación de trazabilidad (ver
 * docs/TRAZABILIDAD_REFUNDACION.md). El DERIVADOR: dado el conjunto de
 * eventos de la campaña (eventosLote.ts), decide por lote su estado,
 * ubicación, kg por clase de evidencia, % con evidencia dura, destino y
 * contradicciones. Función PURA — no persiste nada, no decide nada que el
 * documento rector no autorice explícitamente.
 *
 * REGLA DE ORO (aprobada por el dueño 04-08-2026, textual): "Ningún estado
 * persistido (cierre, procesado, salida) sin evidencia nombrada o anotada."
 * Implementación concreta en este módulo:
 *
 *   1. El derrame (clase DERIVADO) nunca cuenta para alcanzar un umbral de
 *      completitud ni para legitimar un cierre. Puede aparecer como
 *      SUGERENCIA (kgPorClase.derivado, visible) pero jamás mueve `estado`
 *      hacia "cerrado"/"completo_pendiente_cierre" por sí solo.
 *   2. Lo MEDIDO (foto de stock, merma real, cámara externa, venta directa)
 *      fija cantidades y ubicaciones, pero tampoco basta por sí solo para
 *      completar/cerrar: hace falta que exista ADEMÁS una mención NOMBRADA
 *      (aunque esa mención no traiga kg cuantificable, ver
 *      EventoPasadaNombrada.kg=null en eventosLote.ts) o un evento ANOTADO.
 *      Es la "puerta": nombrado/anotado ABREN la puerta, medido solo puede
 *      sumar UNA VEZ que la puerta está abierta.
 *   3. Un cierre manual (ANOTADO) sí puede cerrar un lote sin ningún otro
 *      rastro (indicación humana explícita, "Cerrado sin registro" del banco
 *      dorado) — SALVO que la ÚNICA razón por la que el lote parecía
 *      "completo" fuera el derrame (DERIVADO): eso es exactamente el
 *      accidente que motivó la refundación (310 t fantasma, 8 cierres
 *      falsos), así que un cierre respaldado ÚNICAMENTE por derrame se
 *      degrada a "sin_evidencia_suficiente" con la contradicción
 *      "exceso_sin_dueno" — nunca se hereda como "cerrado" limpio.
 *   4. Las estimaciones por edad (capacidadFraccionEstimada/umbralCompletoPorEdad,
 *      REUTILIZADAS de conciliacionKg.ts/entradasBascula.ts, no duplicadas)
 *      solo relajan el UMBRAL necesario para completar sobre kg que YA tienen
 *      evidencia nombrada/anotada+medida; nunca inventan kilos nuevos.
 */
import {
  eventosPorLote,
  type EventoLote,
} from "@/lib/eventosLote";
import {
  diffDias,
  umbralCompletoPorEdad,
} from "@/lib/entradasBascula";
import { capacidadFraccionEstimada } from "@/lib/conciliacionKg";

// ─── Salidas ─────────────────────────────────────────────────────────────

export type EstadoLote =
  /** Cierre (ANOTADO) con respaldo legítimo: nombrado/anotado propio, o ningún rastro contradictorio (ver corolario 3 más arriba). */
  | "cerrado"
  /** Alcanza el umbral de completo con kg nombrado/anotado(+medido, con la puerta abierta), pero SIN evento de cierre todavía: candidato a cerrar, pendiente de la acción (fase 2/consumidor). */
  | "completo_pendiente_cierre"
  /** Hay evidencia nombrada/anotada/medida real, pero no alcanza el umbral. */
  | "parcial"
  /** Señal MEDIDO vigente de cámara EXTERNA: ubicación conocida, nunca candidato a completar/cerrar. */
  | "en_camara_externa"
  /** Señal ANOTADA vigente de confirmación física a pie de cámara: mismo veto que en_camara_externa. */
  | "en_camara_confirmada"
  /** Venta directa (MEDIDO): la fruta nunca llega a la central. */
  | "venta_directa"
  /** CAMPO/CIT: fruta comprada que se deriva a Cítrica, fuera del alcance de la central. */
  | "derivado_citrica"
  /** Ni una mención ni un derrame lo tocan: "sin rastro", cola manual (puede ser un lote joven que aún no le toca, o stock fantasma si además es viejo — ver contradicción "sin_rastro_con_edad"). */
  | "sin_rastro"
  /**
   * REGLA DE ORO: había un cierre o un estado "completo" que SOLO se
   * explicaba por derrame (DERIVADO) — se degrada aquí en vez de heredar el
   * cierre/completitud del dato crudo. Ver contradicción "exceso_sin_dueno".
   */
  | "sin_evidencia_suficiente";

export interface KgPorClase {
  /** Mención propia del calibrador (pasada propia o compuesta), incluida la "mención sin kg" cuando abrió la puerta de completitud (ver docstring del módulo). */
  nombrado: number;
  /** Cierre/reapertura manual, confirmación física, anotación de pasada — SOLO la parte que aporta un kg real o que "rellena" un cierre legítimo (ver corolario 3). */
  anotado: number;
  /**
   * Foto de stock, merma real de cámara, cámara externa, venta directa.
   * FASE 3b: en la rama "parcial" puede salir NEGATIVO cuando la foto de
   * stock es una corrección a la baja (kg_ajuste_stock < 0) — ES una
   * medición negativa real (el programa de báscula dice "hay menos de lo
   * que muestran los partes"), no un error a esconder ni a capar a 0: capar
   * el ajuste negativo escondería la magnitud de la contradicción con
   * `nombrado` (ver `pasada_vs_foto_stock` en `contradicciones`) y obligaría
   * a sacrificar el kg NOMBRADO real para que la suma cuadrase (el bug real
   * del caso 26042810/26042313, ver cicloVidaLote.golden.test.ts). En el
   * resto de ramas (cerrado, venta directa, cámara externa/confirmada) sigue
   * capado a ≥0 — esas ramas ya tienen su propia forma de repartir el resto
   * (p. ej. "anotado" en un cierre legítimo) y no está verificado que
   * soporten un negativo aquí sin resultados absurdos.
   */
  medido: number;
  /** Derrame de exceso (misma finca/variedad) — SOLO sugerencia, nunca cuenta para completar. */
  derivado: number;
  /**
   * kg_entrada − (las cuatro anteriores): lo que ninguna fuente explica
   * todavía. Quinta cifra IMPLÍCITA (no es una clase de evidencia del
   * documento, es el resto) para que la suma cierre EXACTAMENTE con
   * kg_entrada — invariante de conservación que el banco dorado verifica lote
   * a lote. null ≠ 0: que salga 0 aquí significa "todo explicado", no que no
   * se haya mirado. FASE 3b: cuando `medido` sale negativo por una
   * contradicción grande (ver arriba), `sinRastro` puede superar el 100% de
   * kg_entrada — es la propia magnitud de la contradicción haciéndose
   * visible como aviso numérico (nunca se absorbe en silencio), no un lote
   * con más kg de los que entraron.
   */
  sinRastro: number;
}

export type ContradiccionLote =
  /** Foto de stock (MEDIDO) con ajuste NEGATIVO que anula (parcial o totalmente) una pasada propia (NOMBRADO) del mismo lote — caso real 26042313. */
  | { tipo: "pasada_vs_foto_stock"; kgAjusteStock: number; detalle: string }
  /**
   * El único respaldo de un cierre/estado "completo" era derrame (DERIVADO):
   * REGLA DE ORO, se degrada la completitud/cierre y se deja la sugerencia
   * visible como cola de revisión con 1 clic ("¿quién es el dueño real de
   * este kg?").
   */
  | { tipo: "exceso_sin_dueno"; kgDerivado: number; detalle: string }
  /** Precalibrado sin NINGUNA mención en los informes: fruta física en la nave sin indicación de consumo (regla del dueño: nunca se asume, solo lo que se indique). */
  | { tipo: "prec_sin_indicacion"; kgPendiente: number; dias: number }
  /** Lote real (no precalibrado) sin ninguna evidencia y ya con edad sospechosa: candidato a "stock fantasma" (ver conciliacionKg.ts). */
  | { tipo: "sin_rastro_con_edad"; dias: number };

export interface LoteCiclo {
  lote: string;
  fechaEntrada: string;
  kgEntrada: number;
  esPrecalibrado: boolean;
  esCampoCit: boolean;
  estado: EstadoLote;
  kgPorClase: KgPorClase;
  /** (nombrado + anotado) / kgEntrada, en [0,1] — SOLO evidencia dura, el derrame nunca entra aquí (REGLA DE ORO). */
  pctConEvidenciaDura: number;
  /** Descripción legible del destino (para UI/tests) — un resumen de `estado` con el contexto (precalibrado, campo/cit, procedencia de cámara externa...). */
  destino: string;
  contradicciones: ContradiccionLote[];
  diasEnCamara: number;
}

/** Umbral (fracción, sobre kg_ajuste_stock negativo respecto a kg_entrada) a partir del cual una foto de stock negativa se considera CONTRADICCIÓN con una pasada propia, no un simple redondeo. Calibrado contra el banco dorado: los ajustes negativos "de ruido" observados son ≤3% de la entrada; los 9 casos reales de contradicción son ≥100%. 0,5 deja un margen amplio entre ambos grupos sin caer en un umbral de "% de acierto" (es un criterio de MAGNITUD del propio dato, no de cuántos lotes acierta el motor). */
const UMBRAL_CONTRADICCION_AJUSTE_NEGATIVO = 0.5;

/** Días de "sin rastro" a partir de los cuales un lote real (no precalibrado) sin ninguna evidencia se marca como contradicción "sin_rastro_con_edad" (ya no es plausible que "todavía no le toque"). Mismo margen que el aviso "probablemente terminado" existente (DIAS_SIN_ACTIVIDAD_TERMINADO, entradasBascula.ts) para no inventar un número nuevo sin motivo. */
const DIAS_SOSPECHA_SIN_RASTRO = 7;

function crearKgPorClase(kgEntrada: number, nombrado: number, anotado: number, medido: number, derivado: number): KgPorClase {
  const sinRastro = kgEntrada - nombrado - anotado - medido - derivado;
  return { nombrado, anotado, medido, derivado, sinRastro };
}

/**
 * Deriva el ciclo de vida de UN lote a partir de sus eventos. Función interna
 * — el punto de entrada público es `derivarCicloVidaLote` (procesa toda la
 * campaña de una vez).
 */
function derivarLote(lote: string, eventos: EventoLote[], hoy: string): LoteCiclo | null {
  const entradaEv = eventos.find((e): e is Extract<EventoLote, { tipo: "entrada_bascula" }> => e.tipo === "entrada_bascula");
  if (!entradaEv) return null; // sin evento de entrada no hay lote que derivar (no debería pasar con datos reales)

  const kgEntrada = entradaEv.kg;
  // eventosDeEntradaBascula siempre rellena `fecha` con la fecha real de la
  // entrada (nunca null) — el tipo es string|null porque EventoBase lo
  // comparte con eventos que sí pueden no tener fecha fiable (p. ej. una
  // pasada compuesta sin fecha en el parte).
  const fechaEntrada = entradaEv.fecha ?? "";
  const contradicciones: ContradiccionLote[] = [];

  // ── CAMPO/CIT: fuera del alcance de la central, no se deriva nada más ────
  if (entradaEv.esCampoCit) {
    return {
      lote,
      fechaEntrada,
      kgEntrada,
      esPrecalibrado: entradaEv.esPrecalibrado,
      esCampoCit: true,
      estado: "derivado_citrica",
      kgPorClase: crearKgPorClase(kgEntrada, 0, 0, kgEntrada, 0),
      pctConEvidenciaDura: 0,
      destino: "Derivado a Cítrica (CAMPO/CIT) — no se procesa en la central",
      contradicciones,
      diasEnCamara: diffDias(fechaEntrada, hoy),
    };
  }

  // ── Recuento de eventos por tipo ──────────────────────────────────────────
  const pasadas = eventos.filter((e): e is Extract<EventoLote, { tipo: "pasada_nombrada" }> => e.tipo === "pasada_nombrada");
  const fotoStock = eventos.find((e): e is Extract<EventoLote, { tipo: "foto_stock" }> => e.tipo === "foto_stock");
  const mermaCamara = eventos.find((e): e is Extract<EventoLote, { tipo: "merma_camara" }> => e.tipo === "merma_camara");
  const cierre = eventos.find((e): e is Extract<EventoLote, { tipo: "cierre_manual" }> => e.tipo === "cierre_manual");
  const camaraExterna = eventos.find((e): e is Extract<EventoLote, { tipo: "camara_externa" }> => e.tipo === "camara_externa" && e.estadoCamion !== "recibido");
  const ventaDirecta = eventos.find((e): e is Extract<EventoLote, { tipo: "venta_directa" }> => e.tipo === "venta_directa");
  const confirmacionFisica = eventos.find((e): e is Extract<EventoLote, { tipo: "confirmacion_fisica" }> => e.tipo === "confirmacion_fisica");
  const derrames = eventos.filter((e): e is Extract<EventoLote, { tipo: "derrame_exceso" }> => e.tipo === "derrame_exceso");
  const anotacionesPasada = eventos.filter((e): e is Extract<EventoLote, { tipo: "anotacion_pasada" }> => e.tipo === "anotacion_pasada");

  // ── kg nombrado: suma de las pasadas CON kg cuantificado (el "kg: null" de ─
  // una mención sin reparto NO suma número, pero SÍ actúa de puerta, ver abajo).
  const kgNombradoNumerico = pasadas.reduce((s, p) => s + (p.kg ?? 0), 0);
  const huboMencionPropia = pasadas.length > 0; // incluye las de kg:null: mención en cualquier posición = NOMBRADO
  const kgAnotacionPasada = anotacionesPasada.reduce((s, a) => s + (a.kg ?? 0), 0);

  // La foto de stock (con signo) cuenta hacia el umbral de completitud: si es
  // POSITIVA representa kg ya procesados por un canal distinto a los partes
  // (mismo concepto que nombrado, solo que medido); si es NEGATIVA es una
  // corrección a la baja real (caso 26051310: -735 kg, por debajo del umbral
  // de contradicción pero suficiente para que el lote NO llegue al umbral de
  // completo) — por eso se usa con signo aquí, no solo cuando es positiva. La
  // merma REAL de cámara, en cambio, es una PÉRDIDA (kg que jamás llegarán al
  // calibrador): el umbral de completitud (umbralCompletoPorEdad) YA relaja
  // el % exigido para dar cabida a la merma esperada, así que sumarla
  // TAMBIÉN al numerador sería contarla dos veces (caso real: los lotes "A
  // medias" del banco dorado tienen merma real de cámara y no deben
  // completar solo por eso).
  const kgAjusteStockSigned = fotoStock?.kg ?? 0;
  const kgMedidoParaUmbral = kgAjusteStockSigned;
  // OJO: el kg de cámara EXTERNA queda FUERA de `kgMedidoBase` a propósito.
  // Representa "sigue confirmado fuera, sin procesar" — es evidencia EN
  // CONTRA de que el lote esté resuelto, nunca a favor: si se sumara aquí,
  // un cierre manual posterior (ANOTADO) lo heredaría como "respaldo legítimo"
  // y taparía justo la contradicción que se quiere destapar (caso real:
  // 26051906/26051907/26052005/26052006, cerrados el mismo día que su
  // registro de cámara externa seguía "en_camara" sin ninguna otra
  // evidencia — el inventario físico del dueño confirma que NO hay evidencia
  // dura de procesado). Se agrega SOLO en la rama `en_camara_externa` de más
  // abajo, que tiene su propio cálculo de kgPorClase.
  const kgMedidoBase = Math.max(0, kgAjusteStockSigned) + (mermaCamara?.kg ?? 0) + (ventaDirecta?.kg ?? 0);
  const kgDerivadoBase = derrames.reduce((s, d) => s + d.kg, 0);

  // ── Contradicción: foto de stock negativa que anula una pasada propia ────
  if (fotoStock && fotoStock.kg < 0 && Math.abs(fotoStock.kg) >= kgEntrada * UMBRAL_CONTRADICCION_AJUSTE_NEGATIVO) {
    contradicciones.push({
      tipo: "pasada_vs_foto_stock",
      kgAjusteStock: fotoStock.kg,
      detalle: `Foto de stock de ${fotoStock.kg.toFixed(0)} kg contradice ${kgNombradoNumerico.toFixed(0)} kg nombrados en pasadas propias — revisar cuál de las dos fuentes es correcta.`,
    });
  }

  const diasEnCamara = diffDias(fechaEntrada, hoy);

  // ── Venta directa (MEDIDO): explicación TERMINAL, compatible con un cierre ─
  // posterior (el caso real 26051411 tiene ambos: se comprueba antes que el
  // cierre para que el destino cuente el motivo, no solo que está cerrado).
  if (ventaDirecta) {
    return {
      lote,
      fechaEntrada,
      kgEntrada,
      esPrecalibrado: entradaEv.esPrecalibrado,
      esCampoCit: false,
      estado: "venta_directa",
      kgPorClase: crearKgPorClase(kgEntrada, kgNombradoNumerico, kgAnotacionPasada, kgMedidoBase, 0),
      pctConEvidenciaDura: kgEntrada > 0 ? Math.min(1, (kgNombradoNumerico + kgAnotacionPasada) / kgEntrada) : 0,
      destino: `Venta directa (${ventaDirecta.detalle})`,
      contradicciones,
      diasEnCamara,
    };
  }

  // ── "Puerta" de completitud: hace falta NOMBRADO o ANOTADO real para que ──
  // lo MEDIDO pueda sumar hacia el umbral (REGLA DE ORO, corolario 2). Sin
  // puerta abierta, lo medido solo fija cantidad — no completa nada. OJO: la
  // mención (huboMencionPropia) cuenta como puerta AUNQUE su kg salga null
  // (ver eventosLote.ts, caso "mención sin kg") — por eso la puerta usa el
  // booleano `huboMencionPropia`, no la suma numérica `kgNombradoNumerico`.
  const hayEvidenciaNombradaOAnotada = huboMencionPropia || kgAnotacionPasada > 0;
  const puertaAbierta = hayEvidenciaNombradaOAnotada || Boolean(cierre);
  const kgHaciaUmbral = puertaAbierta ? kgNombradoNumerico + kgAnotacionPasada + kgMedidoParaUmbral : kgNombradoNumerico + kgAnotacionPasada;
  /**
   * FASE 3b (edge case documentado en cicloVidaLote.golden.test.ts, caso real
   * 26042810/26042313): `kgHaciaUmbral` neteA nombrado/anotado con el ajuste
   * de stock CON SIGNO — si la foto de stock es muy negativa (contradice una
   * pasada propia grande, ver `pasada_vs_foto_stock` más arriba) el neto puede
   * salir ≤0 aunque haya kilos NOMBRADOS reales y cuantiosos. Antes, la rama
   * "parcial" de más abajo comprobaba `kgHaciaUmbral > 0` y ese neto negativo
   * la saltaba entera: el lote caía en las ramas de "nada" (kgPorClase.nombrado
   * forzado a 0), contradiciendo la propia timeline de eventos (que SÍ muestra
   * la pasada nombrada con su kg). La REGLA DE ORO nunca pidió borrar
   * evidencia nombrada/anotada por una contradicción de OTRA fuente — la
   * contradicción ya queda señalada aparte (`contradicciones`); esta variable
   * solo decide si hay ALGO cuantificable que enseñar como "a medias", usando
   * cada fuente por separado (nunca neteada) para que una corrección negativa
   * grande no pueda "tapar" evidencia nombrada/anotada real.
   */
  const hayEvidenciaCuantificablePorFuente = kgNombradoNumerico > 0 || kgAnotacionPasada > 0 || kgMedidoParaUmbral > 0;

  // ── Cierre manual (ANOTADO) ────────────────────────────────────────────────
  if (cierre) {
    // Regla de oro, corolario 3: si el ÚNICO respaldo del lote es derrame
    // (nada de nombrado/anotado — ni siquiera una mención sin kg — ni medido
    // real), el cierre no hereda legitimidad — exactamente el patrón
    // "Procesado vía reparto (derrame)" del banco dorado (lotes cerrados en
    // bloque confiando en el derrame antiguo). Usa el booleano
    // `hayEvidenciaNombradaOAnotada` (no la suma numérica): una mención sin
    // kg (huérfano de compuesta, caso real 26030604) YA es respaldo nombrado
    // legítimo aunque no aporte un número.
    //
    // Se degrada TAMBIÉN cuando, sin ningún derrame, hay una contra-señal de
    // ubicación (cámara externa) que sigue diciendo "confirmado fuera, sin
    // procesar" en el momento del cierre — caso real verificado por el dueño:
    // 26051906/26051907/26052005/26052006 se cerraron el mismo día que su
    // registro de Guadex seguía "en_camara" y sin ningún otro rastro (ni
    // nombrado ni medido propio): el inventario físico del dueño confirma que
    // NO hay evidencia dura de procesado para esos lotes, así que el cierre
    // no puede heredar legitimidad solo por existir — es la MISMA
    // contradicción que el derrame (un cierre sin dueño real detrás), solo
    // que la contra-señal es de ubicación en vez de kg de exceso.
    const sinRespaldoReal = !hayEvidenciaNombradaOAnotada && kgMedidoBase <= 0.5;
    const soloDerivado = sinRespaldoReal && kgDerivadoBase > 0.5;
    const cierreContraCamaraExterna = sinRespaldoReal && !soloDerivado && Boolean(camaraExterna);
    if (soloDerivado || cierreContraCamaraExterna) {
      contradicciones.push({
        tipo: "exceso_sin_dueno",
        kgDerivado: kgDerivadoBase,
        detalle: soloDerivado
          ? "El cierre de este lote solo se explica por un derrame de exceso (misma finca/variedad): la REGLA DE ORO no permite que el derrame cierre lotes. Revisar manualmente quién es el dueño real de ese kg."
          : "El cierre de este lote no tiene ningún respaldo real (ni nombrado ni medido propio) y su registro de cámara externa seguía confirmando la fruta fuera en el momento del cierre: revisar manualmente antes de darlo por procesado.",
      });
      // El kg de cámara externa (si lo hay) SÍ se muestra aquí como "medido":
      // en esta rama ya no legitima ningún cierre, así que no hay riesgo de
      // que "financie" una completitud — solo informa dónde sigue la fruta.
      const kgMedidoConUbicacion = Math.max(0, kgMedidoBase) + (camaraExterna?.kg ?? 0);
      const derivadoCapado = Math.min(kgDerivadoBase, Math.max(0, kgEntrada - kgMedidoConUbicacion));
      return {
        lote,
        fechaEntrada,
        kgEntrada,
        esPrecalibrado: entradaEv.esPrecalibrado,
        esCampoCit: false,
        estado: "sin_evidencia_suficiente",
        kgPorClase: crearKgPorClase(kgEntrada, 0, 0, kgMedidoConUbicacion, derivadoCapado),
        pctConEvidenciaDura: 0,
        destino: soloDerivado
          ? "Sin evidencia suficiente para el cierre (solo derrame — regla de oro)"
          : "Sin evidencia suficiente para el cierre (cámara externa seguía confirmando la fruta fuera)",
        contradicciones,
        diasEnCamara,
      };
    }

    // Cierre legítimo: nombrado/anotado/medido explican algo (o no hay nada
    // que lo contradiga) — el cierre (ANOTADO, "indicación humana explícita")
    // explica el resto, tal como permite la tabla de clases del documento
    // rector ("anotado: puede todo, equivale a nombrado").
    const derivadoCapado = Math.min(kgDerivadoBase, Math.max(0, kgEntrada - kgNombradoNumerico - kgMedidoBase));
    const anotadoRelleno = Math.max(0, kgEntrada - kgNombradoNumerico - kgMedidoBase - derivadoCapado);
    return {
      lote,
      fechaEntrada,
      kgEntrada,
      esPrecalibrado: entradaEv.esPrecalibrado,
      esCampoCit: false,
      estado: "cerrado",
      kgPorClase: crearKgPorClase(kgEntrada, kgNombradoNumerico, kgAnotacionPasada + anotadoRelleno, kgMedidoBase, derivadoCapado),
      pctConEvidenciaDura: 1, // cerrado = "todo" por definición de ANOTADO (equivale a nombrado)
      destino: cierre.cierreModo === "sin_registro"
        ? "Cerrado sin registro (la fruta salió sin dejar rastro bajo este código)"
        : "Procesado con su código — cerrado",
      contradicciones,
      diasEnCamara,
    };
  }

  // ── Señales de ubicación "sigue en otro sitio" (solo si no hubo cierre): ──
  // se comprueban DESPUÉS del cierre a propósito. Caso real del banco dorado
  // (26042010/26051306): el registro de cámara externa quedó con columnas de
  // llegada a medias (envases parciales sin actualizar) mientras una
  // reconciliación posterior YA cerró el lote (cerrado_at, misma fecha que la
  // nota "Conciliado como cámara vacía" del registro) — el cierre (ANOTADO,
  // indicación humana explícita) pesa más que un registro MEDIDO que puede
  // haberse quedado desactualizado. Sin cierre, estas señales SÍ mandan
  // (jamás candidatean a completar/cerrar mientras estén vigentes).
  if (camaraExterna) {
    // Aquí SÍ se suma el kg de cámara externa al bucket "medido" (fija
    // cantidad y ubicación, ver eventosLote.ts) — es la única rama donde
    // corresponde, precisamente porque aquí NO se usa para legitimar ningún
    // cierre (el estado ya es "en_camara_externa", no "cerrado").
    const kgMedidoConUbicacion = kgMedidoBase + camaraExterna.kg;
    return {
      lote,
      fechaEntrada,
      kgEntrada,
      esPrecalibrado: entradaEv.esPrecalibrado,
      esCampoCit: false,
      estado: "en_camara_externa",
      kgPorClase: crearKgPorClase(kgEntrada, kgNombradoNumerico, kgAnotacionPasada, kgMedidoConUbicacion, Math.min(kgDerivadoBase, Math.max(0, kgEntrada - kgNombradoNumerico - kgAnotacionPasada - kgMedidoConUbicacion))),
      pctConEvidenciaDura: kgEntrada > 0 ? Math.min(1, (kgNombradoNumerico + kgAnotacionPasada) / kgEntrada) : 0,
      destino: `En cámara externa (${camaraExterna.procedencia})`,
      contradicciones,
      diasEnCamara,
    };
  }
  if (confirmacionFisica) {
    return {
      lote,
      fechaEntrada,
      kgEntrada,
      esPrecalibrado: entradaEv.esPrecalibrado,
      esCampoCit: false,
      estado: "en_camara_confirmada",
      kgPorClase: crearKgPorClase(kgEntrada, kgNombradoNumerico, kgAnotacionPasada, kgMedidoBase, 0),
      pctConEvidenciaDura: kgEntrada > 0 ? Math.min(1, (kgNombradoNumerico + kgAnotacionPasada) / kgEntrada) : 0,
      destino: `En cámara confirmada físicamente (${confirmacionFisica.nombreCamara})`,
      contradicciones,
      diasEnCamara,
    };
  }

  // ── Sin cierre: ¿alcanza el umbral de completo? ───────────────────────────
  const umbral = umbralCompletoPorEdad(diasEnCamara, capacidadFraccionEstimada);
  const pct = kgEntrada > 0 ? kgHaciaUmbral / kgEntrada : 0;

  if (pct >= umbral) {
    const derivadoCapado = Math.min(kgDerivadoBase, Math.max(0, kgEntrada - kgNombradoNumerico - kgAnotacionPasada - kgMedidoBase));
    return {
      lote,
      fechaEntrada,
      kgEntrada,
      esPrecalibrado: entradaEv.esPrecalibrado,
      esCampoCit: false,
      estado: "completo_pendiente_cierre",
      kgPorClase: crearKgPorClase(kgEntrada, kgNombradoNumerico, kgAnotacionPasada, kgMedidoBase, derivadoCapado),
      pctConEvidenciaDura: Math.min(1, Math.max(0, pct)),
      destino: "Procesado con su código — completo (cierre pendiente)",
      contradicciones,
      diasEnCamara,
    };
  }

  if (puertaAbierta && hayEvidenciaCuantificablePorFuente) {
    /**
     * `kgMedidoConSigno` (no `kgMedidoBase`, que capa el ajuste a ≥0):
     * cuando la foto de stock es una corrección negativa, ES una medición
     * negativa real (no un error a esconder) — se conserva con signo para
     * que kgPorClase.nombrado NO tenga que sacrificarse para que la suma
     * cuadre. El invariante de conservación (Σ clases = kg_entrada) se
     * mantiene igual: `sinRastro` (crearKgPorClase) absorbe la diferencia
     * como residuo, aunque eso implique que sinRastro supere el 100% de
     * kg_entrada cuando la contradicción es grande (caso 26042810: -27.713 kg
     * de ajuste sobre 20.600 kg de entrada) — es justo la señal de que hay
     * una contradicción gorda por revisar (ya viene marcada aparte en
     * `contradicciones`), nunca se absorbe en silencio. La UI (BarraKgPorClase,
     * CicloVidaEvidenciaSection.tsx) no necesita cambios: el segmento con
     * pct≤0 ya se omite en la barra (nunca se dibuja un ancho imposible) y
     * flexbox reescala proporcionalmente los segmentos cuando la suma pasa
     * de 100%; la lista de cifras bajo la barra muestra el kg/% negativo o
     * >100% tal cual, como aviso numérico.
     */
    const kgMedidoConSigno = kgAjusteStockSigned + (mermaCamara?.kg ?? 0);
    const derivadoCapado = Math.min(kgDerivadoBase, Math.max(0, kgEntrada - kgNombradoNumerico - kgAnotacionPasada - kgMedidoConSigno));
    return {
      lote,
      fechaEntrada,
      kgEntrada,
      esPrecalibrado: entradaEv.esPrecalibrado,
      esCampoCit: false,
      estado: "parcial",
      kgPorClase: crearKgPorClase(kgEntrada, kgNombradoNumerico, kgAnotacionPasada, kgMedidoConSigno, derivadoCapado),
      pctConEvidenciaDura: Math.min(1, Math.max(0, pct)),
      destino: "A medias — cola pendiente",
      contradicciones,
      diasEnCamara,
    };
  }

  // ── Nada de nombrado/anotado; puede haber SOLO derrame (sugerencia, nunca ─
  // cuenta) o absolutamente nada. ────────────────────────────────────────────
  if (kgDerivadoBase > 0.5) {
    contradicciones.push({
      tipo: "exceso_sin_dueno",
      kgDerivado: kgDerivadoBase,
      detalle: "Este lote solo tiene kg de derrame (sugerencia estadística): la REGLA DE ORO no deja que eso cuente como evidencia. Sigue abierto y sin evidencia suficiente.",
    });
    return {
      lote,
      fechaEntrada,
      kgEntrada,
      esPrecalibrado: entradaEv.esPrecalibrado,
      esCampoCit: false,
      estado: "sin_evidencia_suficiente",
      kgPorClase: crearKgPorClase(kgEntrada, 0, 0, kgMedidoBase, Math.min(kgDerivadoBase, Math.max(0, kgEntrada - kgMedidoBase))),
      pctConEvidenciaDura: 0,
      destino: "Sin evidencia suficiente (solo derrame — regla de oro)",
      contradicciones,
      diasEnCamara,
    };
  }

  // Sin rastro de ningún tipo. OJO: "prec_sin_indicacion" es literalmente eso
  // — SIN ninguna indicación en los informes (ni mención ni anotación) — así
  // que solo se marca cuando `huboMencionPropia` es falso; un precalibrado
  // mencionado pero con 0 kg cuantificable (mención sin kg y sin nada más que
  // la complete) no es "sin indicación", solo insuficiente para completar.
  if (entradaEv.esPrecalibrado && !hayEvidenciaNombradaOAnotada) {
    contradicciones.push({ tipo: "prec_sin_indicacion", kgPendiente: kgEntrada, dias: diasEnCamara });
  } else if (!entradaEv.esPrecalibrado && diasEnCamara >= DIAS_SOSPECHA_SIN_RASTRO) {
    contradicciones.push({ tipo: "sin_rastro_con_edad", dias: diasEnCamara });
  }
  return {
    lote,
    fechaEntrada,
    kgEntrada,
    esPrecalibrado: entradaEv.esPrecalibrado,
    esCampoCit: false,
    estado: "sin_rastro",
    kgPorClase: crearKgPorClase(kgEntrada, 0, 0, kgMedidoBase, 0),
    pctConEvidenciaDura: 0,
    destino: entradaEv.esPrecalibrado
      ? "Precalibrado sin indicación (cola manual)"
      : "Sin rastro (abierto, sin ninguna evidencia)",
    contradicciones,
    diasEnCamara,
  };
}

/**
 * Deriva el ciclo de vida de TODOS los lotes de la campaña a partir de la
 * lista completa de eventos (ver eventosLote.ts). Función PURA — no hace
 * fetch ni escribe nada; el caller (hook o test) construye los eventos y se
 * los pasa ya listos.
 */
export function derivarCicloVidaLote(eventos: EventoLote[], hoy: string): LoteCiclo[] {
  const porLote = eventosPorLote(eventos);
  const resultado: LoteCiclo[] = [];
  for (const [lote, eventosDelLote] of porLote) {
    const ciclo = derivarLote(lote, eventosDelLote, hoy);
    if (ciclo) resultado.push(ciclo);
  }
  resultado.sort((a, b) => a.lote.localeCompare(b.lote));
  return resultado;
}

/**
 * ¿Tiene este lote la contradicción "pasada_vs_foto_stock" VIGENTE ahora
 * mismo (según los eventos actuales)? Corolario de la REGLA DE ORO, decisión
 * del dueño 05-08-2026 (ver docs/TRAZABILIDAD_REFUNDACION.md, FASE 3d): la
 * pasada del calibrador y la foto de stock del lote se contradicen de forma
 * grande (≥50% de la entrada, ver UMBRAL_CONTRADICCION_AJUSTE_NEGATIVO) — su
 * merma/coste es INCALCULABLE mientras el dueño no resuelva la contradicción
 * FÍSICAMENTE (no se puede repartir en silencio entre productores un kg que
 * ni siquiera se sabe si está en la báscula o en la cámara). No se decide
 * aquí NADA de negocio nuevo: solo se expone el mismo criterio que ya
 * calcula `derivarCicloVidaLote` (la contradicción ya existe en
 * `contradicciones`) como una función con nombre, para que
 * mermaPorProductor.ts (y cualquier otro ranking por productor futuro) no
 * tenga que repetir el `.some(c => c.tipo === ...)` en cada sitio. "Vigente
 * ahora mismo" porque es una función DERIVADA, no un estado guardado: en
 * cuanto el dueño aporte el evento que resuelve la contradicción (una
 * corrección de la foto de stock, una anotación, etc.), el próximo cálculo
 * deja de marcar el lote sin que nadie tenga que "reabrirlo" a mano.
 */
export function tieneContradiccionPasadaVsFotoStock(ciclo: LoteCiclo | null | undefined): boolean {
  return ciclo?.contradicciones.some((c) => c.tipo === "pasada_vs_foto_stock") ?? false;
}

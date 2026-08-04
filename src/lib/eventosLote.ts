/**
 * eventosLote.ts — FASE 1 de la refundación de trazabilidad (ver
 * docs/TRAZABILIDAD_REFUNDACION.md, aprobado por el dueño 04-08-2026).
 *
 * "Todo lo que le pasa a un lote es un evento fechado con su fuente y su
 * clase de evidencia" (nombrado / anotado / medido / derivado / nada). Este
 * módulo SOLO construye esa lista de eventos a partir de las fuentes crudas
 * ya existentes — no decide nada (eso es cicloVidaLote.ts), no hace fetch, no
 * escribe en BD. Funciones puras, comentarios en español explicando el
 * PORQUÉ de cada regla.
 *
 * MOTOR REUTILIZADO (regla del repo: no duplicar fórmulas) — el reparto de
 * kilos entre lotes (multi-código, derrame por finca/variedad, capacidad por
 * merma/podrido) sigue siendo EXACTAMENTE `conciliarKgProcesados`
 * (conciliacionKg.ts): este módulo solo reorganiza su salida (procesados +
 * movimientos) como eventos con clase de evidencia, y añade la detección de
 * "mención sin kg" que la propia REGLA DE ORO exige (ver más abajo).
 *
 * IMPORTANTE (alcance de esta fase): este archivo es NUEVO y no se cablea a
 * ningún consumidor todavía — el motor viejo (conciliacionKg/entradasBascula/
 * asentamientoDia) sigue mandando en la UI. No toca useEntradasBascula.ts,
 * EntradasBascula.tsx ni el panel de conciliación (los está tocando otro
 * agente en paralelo).
 */
import {
  conciliarKgProcesados,
  type EntradaConciliacion,
  type PasadaConciliacion,
  type ReciclajeDiaInput,
} from "@/lib/conciliacionKg";
import type { CierreModo } from "@/lib/entradasBascula";
import { normalizarLoteCodigo } from "@/lib/loteCodigo";
import {
  estadoCamionExterno,
  type CamionCamaraExterna,
  type SenalesRecepcion,
} from "@/lib/camarasExternas";
import {
  camaraConfirmadaVigentePorLote,
  type EntradaConCamaraConfirmada,
} from "@/lib/camaraConfirmada";
import { esEntradaCampoCit, esEntradaPrecalibrado } from "@/lib/productoresCanonicos";

// ─── Clase de evidencia (tabla del documento rector) ────────────────────────

export type ClaseEvidencia = "nombrado" | "anotado" | "medido" | "derivado";

/** Campos comunes a todo evento: a qué lote pertenece, con qué clase de evidencia y cuándo. */
interface EventoBase {
  /** Código de lote normalizado a 8 dígitos (Convención A, normalizarLoteCodigo — NUNCA por LIKE/substring). */
  lote: string;
  clase: ClaseEvidencia;
  /** Fecha ISO "YYYY-MM-DD" del evento; null si la fuente no trae una fecha fiable para ESTE evento en concreto. */
  fecha: string | null;
}

/** La entrada de báscula en sí: el kg de partida del lote. MEDIDO — fija la cantidad, no basta para cerrar. */
export interface EventoEntradaBascula extends EventoBase {
  tipo: "entrada_bascula";
  clase: "medido";
  kg: number;
  esPrecalibrado: boolean;
  esCampoCit: boolean;
}

/**
 * "Foto de stock" (entradas_bascula.kg_ajuste_stock): kg contados fuera de
 * los partes por conciliación con el informe de la báscula. MEDIDO — puede
 * ser negativo (ver 26042313 en el banco dorado: un ajuste negativo que casi
 * cancela una pasada propia real, contradicción de primera clase).
 */
export interface EventoFotoStock extends EventoBase {
  tipo: "foto_stock";
  clase: "medido";
  /** Con signo: positivo = más procesado de lo que muestran los partes; negativo = corrección a la baja. */
  kg: number;
}

/** Merma REAL de cámara (entradas_bascula.merma_camara_kg, peso inicial − peso final). MEDIDO. */
export interface EventoMermaCamara extends EventoBase {
  tipo: "merma_camara";
  clase: "medido";
  /** Siempre ≥ 0: kg que se evaporaron, nunca llegaron al calibrador. */
  kg: number;
}

/**
 * Cierre/reapertura manual (entradas_bascula.cerrado_at/cierre_modo). ANOTADO
 * — "indicación humana explícita": por sí solo puede cerrar un lote aunque no
 * haya ningún otro rastro (ver "Cerrado sin registro" en el banco dorado, 7
 * lotes con evidencia "ninguna" que el dueño dio igualmente por cerrados).
 * `kg` es siempre null: el cierre no aporta un número, es una declaración de
 * estado — cicloVidaLote.ts decide cuánto kg "explica" ese cierre.
 */
export interface EventoCierreManual extends EventoBase {
  tipo: "cierre_manual";
  clase: "anotado";
  kg: null;
  cierreModo: CierreModo | null;
}

/**
 * Mención propia en una pasada del calibrador, en CUALQUIER posición del
 * texto (Convención A). NOMBRADO — "todo: mover kg, completar, cerrar".
 *
 * `kg`: el reparto de `conciliarKgProcesados` ya decide cuánto kg absorbe
 * cada código (capado a su capacidad); ese es el número que se usa aquí. Pero
 * la mención en sí es evidencia aunque el reparto le dé 0 (dos casos reales
 * verificados contra el banco dorado):
 *   (a) pasada COMPUESTA cuyo código no-primero se queda sin nada porque los
 *       códigos anteriores ya agotaron el pendiente de la pasada (huérfanos
 *       de compuesta, ver conciliacionKg.ts/stockPrecalibrado.ts);
 *   (b) pasada de código SIMPLE (single-código) cuyo lote ya tenía la
 *       capacidad llena vía `kg_ajuste_stock` (foto de stock MEDIDA): el
 *       reparto no le da ni un kg extra, pero el calibrador SÍ lo nombró.
 * En ambos casos `kg` sale `null` (mención sin kg cuantificable) en vez de 0:
 * null ≠ 0 — "sin kg atribuido por el reparto" no es lo mismo que "0 kg
 * procesados". `cicloVidaLote.ts` usa la sola PRESENCIA de la mención como
 * puerta para dejar que el resto de evidencia (medida) complete el lote —
 * nunca al revés (medido nunca abre la puerta él solo).
 */
export interface EventoPasadaNombrada extends EventoBase {
  tipo: "pasada_nombrada";
  clase: "nombrado";
  kg: number | null;
  /** "principal" = el lote fue el PRIMER código de esa pasada (el que más probablemente se hizo entero); "no_principal" = nombrado junto a otro(s) código(s). */
  posicion: "principal" | "no_principal";
}

/**
 * Derrame de exceso (misma finca/variedad, conciliarKgProcesados fase 2).
 * DERIVADO — "solo sugerir y explicar huecos; JAMÁS persistir estados": este
 * evento existe para que la UI pueda mostrar la sugerencia, pero
 * cicloVidaLote.ts nunca lo deja completar ni cerrar un lote (REGLA DE ORO).
 */
export interface EventoDerrameExceso extends EventoBase {
  tipo: "derrame_exceso";
  clase: "derivado";
  kg: number;
  motivo: "exceso_misma_finca" | "exceso_misma_variedad";
  /** Lote del que salió el exceso (donante) — para poder explicar la sugerencia en la UI. */
  loteDonante: string;
}

/**
 * Registro de una cámara EXTERNA (Guadex/Zamexfruit/…, camarasExternas.ts).
 * MEDIDO — fija cantidad y ubicación ("sigue en cámara ahí fuera"), pero
 * jamás cierra ni completa: es físicamente imposible que haya pasado por el
 * calibrador mientras sigue fuera (ground truth del dueño 04-08-2026 nº2).
 */
export interface EventoCamaraExterna extends EventoBase {
  tipo: "camara_externa";
  clase: "medido";
  kg: number;
  procedencia: string;
  /** Mismo vocabulario que EstadoCamionExterno (camarasExternas.ts), sin el caso "venta_directa" (ese sale como su propio evento, ver EventoVentaDirecta). */
  estadoCamion: "en_camara" | "parcial" | "recibido";
}

/** Venta directa detectada en el registro de cámara externa. MEDIDO: la fruta nunca llega a la central, así que su kg no es stock ni procesado. */
export interface EventoVentaDirecta extends EventoBase {
  tipo: "venta_directa";
  clase: "medido";
  kg: number;
  detalle: string;
}

/**
 * Confirmación FÍSICA de que un lote sigue en cámara (inventario a pie,
 * camaraConfirmada.ts). ANOTADO — "indicación humana explícita" (dirección
 * vio el lote físicamente), pero su CONTENIDO es "sigue en cámara": actúa
 * como veto de cierre/derrame, nunca como kg a favor de completar. `kg` es
 * siempre null (no es una medición de cantidad, solo de ubicación).
 */
export interface EventoConfirmacionFisica extends EventoBase {
  tipo: "confirmacion_fisica";
  clase: "anotado";
  kg: null;
  nombreCamara: string;
}

/**
 * HUECO TIPADO para la futura tabla `pasada_anotaciones` (otro agente la está
 * creando en paralelo: anotación de dirección sobre una pasada — "qué más se
 * echó"). ANOTADO por definición del documento rector. El constructor de más
 * abajo (`eventosDeAnotacionesPasada`) acepta filas de esa tabla; mientras no
 * exista, se llama con el array vacío por defecto y no aporta ningún evento.
 */
export interface PasadaAnotacionInput {
  /** Código de lote de 8 dígitos al que se refiere la anotación. */
  lote: string;
  fecha: string;
  /** kg que la anotación confirma para este lote; null si es solo una nota sin cantidad. */
  kg?: number | null;
  nota?: string | null;
}

export interface EventoAnotacionPasada extends EventoBase {
  tipo: "anotacion_pasada";
  clase: "anotado";
  kg: number | null;
  nota: string | null;
}

export type EventoLote =
  | EventoEntradaBascula
  | EventoFotoStock
  | EventoMermaCamara
  | EventoCierreManual
  | EventoPasadaNombrada
  | EventoDerrameExceso
  | EventoCamaraExterna
  | EventoVentaDirecta
  | EventoConfirmacionFisica
  | EventoAnotacionPasada;

// ─── 1) Eventos desde entradas de báscula ───────────────────────────────────

export interface EntradaBasculaEventoInput {
  lote: string;
  fecha: string;
  kg_entrada: number;
  finca?: string | null;
  articulo?: string | null;
  agricultor?: string | null;
  kg_ajuste_stock?: number | null;
  merma_camara_kg?: number | null;
  cerrado_at?: string | null;
  cierre_modo?: CierreModo | null;
}

/**
 * Construye los eventos "propios" de cada fila de entradas_bascula: la
 * entrada en sí (medido), la foto de stock si la hay (medido, puede ser
 * negativa), la merma real de cámara si la hay (medido) y el cierre manual si
 * lo hay (anotado). Ninguno de los cuatro depende de las pasadas del
 * calibrador — por eso es un constructor aparte de `eventosDePasadasCalibrador`.
 */
export function eventosDeEntradaBascula(entradas: EntradaBasculaEventoInput[]): EventoLote[] {
  const eventos: EventoLote[] = [];
  for (const e of entradas) {
    const lote = normalizarLoteCodigo(e.lote) ?? e.lote;
    const esPrecalibrado = esEntradaPrecalibrado({ agricultor: e.agricultor, finca: e.finca });
    const esCampoCit = esEntradaCampoCit({ articulo: e.articulo });

    eventos.push({
      tipo: "entrada_bascula",
      clase: "medido",
      lote,
      fecha: e.fecha,
      kg: Number(e.kg_entrada) || 0,
      esPrecalibrado,
      esCampoCit,
    });

    const ajuste = Number(e.kg_ajuste_stock) || 0;
    if (ajuste !== 0) {
      eventos.push({ tipo: "foto_stock", clase: "medido", lote, fecha: e.fecha, kg: ajuste });
    }

    if (e.merma_camara_kg != null) {
      const merma = Math.max(0, Number(e.merma_camara_kg) || 0);
      if (merma > 0) {
        eventos.push({ tipo: "merma_camara", clase: "medido", lote, fecha: e.fecha, kg: merma });
      }
    }

    if (e.cerrado_at) {
      eventos.push({
        tipo: "cierre_manual",
        clase: "anotado",
        lote,
        fecha: e.cerrado_at.slice(0, 10),
        kg: null,
        cierreModo: e.cierre_modo ?? null,
      });
    }
  }
  return eventos;
}

// ─── 2) Eventos desde las pasadas del calibrador (reutiliza conciliarKgProcesados) ─

/** Primer/todos los grupos de 8 dígitos del texto de una pasada — misma Convención A que el resto del motor (conciliacionKg.ts, camaraConfirmada.ts, asentamientoDia.ts). */
function codigosDeLaPasada(texto: string | null | undefined): string[] {
  return String(texto ?? "").match(/\d{8}/g) ?? [];
}

/**
 * Mención textual de cada código en las pasadas, TENGA O NO kg atribuido por
 * el reparto: primera/última fecha en que aparece y si alguna vez fue el
 * código PRINCIPAL (primero) de una pasada. Evidencia puramente textual (no
 * reparte kg) — el mismo tipo de detección que ya usan
 * `detectarLotesEnPasadaCompuesta` (conciliacionKg.ts), `ultimaMencionPropiaPorLote`
 * (camaraConfirmada.ts) y `fechasNombradoPorLote` (asentamientoDia.ts), pero
 * generalizada a CUALQUIER posición (no solo "no-primero de una compuesta")
 * porque la REGLA DE ORO dice que la mención cuenta como NOMBRADO en
 * cualquier posición — incluida una pasada de código SIMPLE cuyo reparto le
 * dio 0 kg porque la capacidad ya estaba llena por otra vía (ver
 * EventoPasadaNombrada, caso (b)).
 */
function construirMencionesPorLote(pasadas: PasadaConciliacion[]): Map<string, { primera: string; ultima: string; fuePrincipalAlgunaVez: boolean }> {
  const menciones = new Map<string, { primera: string; ultima: string; fuePrincipalAlgunaVez: boolean }>();
  for (const p of pasadas) {
    const kg = Number(p.kg_peso_total) || 0;
    if (kg <= 0 || !p.date) continue;
    const codes = codigosDeLaPasada(p.lote_codigo);
    if (codes.length === 0) continue;
    const primero = codes[0]!;
    for (const code of new Set(codes)) {
      const acc = menciones.get(code) ?? { primera: p.date, ultima: p.date, fuePrincipalAlgunaVez: false };
      if (p.date < acc.primera) acc.primera = p.date;
      if (p.date > acc.ultima) acc.ultima = p.date;
      if (code === primero) acc.fuePrincipalAlgunaVez = true;
      menciones.set(code, acc);
    }
  }
  return menciones;
}

/**
 * Construye los eventos NOMBRADO (mención propia en pasadas) y DERIVADO
 * (derrame de exceso) para todos los lotes de la campaña, reutilizando
 * `conciliarKgProcesados` para el reparto real de kilos — este módulo NO
 * reimplementa esa fórmula, solo reorganiza su salida (`procesados` +
 * `movimientos`) como eventos con clase de evidencia:
 *
 *   - kg auto-absorbido (el lote fue el código PRINCIPAL de alguna pasada y
 *     el reparto le dio kg directamente, sin pasar por un `movimiento`) →
 *     EventoPasadaNombrada posición "principal".
 *   - kg recibido vía `movimientos` con motivo "multi_codigo"/"reentrada_nombrados"
 *     (el lote SÍ estaba nombrado en esa misma pasada compuesta) →
 *     EventoPasadaNombrada posición "no_principal".
 *   - kg recibido vía `movimientos` con motivo "exceso_misma_finca"/
 *     "exceso_misma_variedad" (derrame: el lote NO estaba nombrado en la
 *     pasada donante) → EventoDerrameExceso.
 *   - mención textual (`construirMencionesPorLote`) sin ningún kg de los tres
 *     puntos anteriores → EventoPasadaNombrada con `kg: null` (ver su
 *     docstring): la mención por sí sola sigue siendo NOMBRADO.
 *
 * Las fechas de los eventos derivados de `movimientos` usan la última fecha
 * conciliada del lote RECEPTOR (`conciilarKgProcesados` no fecha cada
 * movimiento individualmente) — limitación conocida y aceptada: es la mejor
 * fecha disponible sin reinventar el reparto.
 */
export function eventosDePasadasCalibrador(
  entradas: EntradaConciliacion[],
  pasadas: PasadaConciliacion[],
  reciclajePorDia: ReciclajeDiaInput[] = [],
  lotesConfirmadosEnCamara?: Set<string>,
): EventoLote[] {
  const resultado = conciliarKgProcesados(entradas, pasadas, reciclajePorDia, lotesConfirmadosEnCamara);
  const menciones = construirMencionesPorLote(pasadas);

  const conciliadoPorLote = new Map<string, { kg: number; fecha: string | null }>();
  for (const p of resultado.procesados) conciliadoPorLote.set(p.lote_codigo, { kg: p.kg_peso_total, fecha: p.date });

  // Σ de TODO lo que un lote recibió vía movimientos (nombrado o derivado),
  // para poder despejar cuánto absorbió DIRECTAMENTE como código principal
  // (conciliado.kg − esta suma): conciliarKgProcesados no registra un
  // "movimiento" cuando un código absorbe de SU PROPIA pasada como primero.
  const incomingTotalPorLote = new Map<string, number>();
  const incomingNombradoPorLote = new Map<string, number>();
  for (const m of resultado.movimientos) {
    incomingTotalPorLote.set(m.a, (incomingTotalPorLote.get(m.a) ?? 0) + m.kg);
    if (m.motivo === "multi_codigo" || m.motivo === "reentrada_nombrados") {
      incomingNombradoPorLote.set(m.a, (incomingNombradoPorLote.get(m.a) ?? 0) + m.kg);
    }
  }

  const eventos: EventoLote[] = [];
  const lotesConEntrada = new Set(entradas.map((e) => e.lote));

  for (const lote of lotesConEntrada) {
    const conciliado = conciliadoPorLote.get(lote);
    const kgConciliado = conciliado?.kg ?? 0;
    const incomingTotal = incomingTotalPorLote.get(lote) ?? 0;
    const kgAutoAbsorbido = Math.max(0, kgConciliado - incomingTotal);
    const kgIncomingNombrado = incomingNombradoPorLote.get(lote) ?? 0;
    const mencion = menciones.get(lote);

    if (kgAutoAbsorbido > 0.01) {
      eventos.push({
        tipo: "pasada_nombrada",
        clase: "nombrado",
        lote,
        fecha: conciliado?.fecha ?? mencion?.ultima ?? null,
        kg: kgAutoAbsorbido,
        posicion: "principal",
      });
    }
    if (kgIncomingNombrado > 0.01) {
      eventos.push({
        tipo: "pasada_nombrada",
        clase: "nombrado",
        lote,
        fecha: conciliado?.fecha ?? mencion?.ultima ?? null,
        kg: kgIncomingNombrado,
        posicion: "no_principal",
      });
    }
    // Mención textual sin ningún kg real detrás (ni auto-absorbido ni vía
    // movimiento nombrado): la mención en sí sigue siendo evidencia NOMBRADO
    // (ver docstring de EventoPasadaNombrada, casos (a) y (b)).
    if (mencion && kgAutoAbsorbido <= 0.01 && kgIncomingNombrado <= 0.01) {
      eventos.push({
        tipo: "pasada_nombrada",
        clase: "nombrado",
        lote,
        fecha: mencion.ultima,
        kg: null,
        posicion: mencion.fuePrincipalAlgunaVez ? "principal" : "no_principal",
      });
    }
  }

  for (const m of resultado.movimientos) {
    if (m.motivo !== "exceso_misma_finca" && m.motivo !== "exceso_misma_variedad") continue;
    const receptor = conciliadoPorLote.get(m.a);
    eventos.push({
      tipo: "derrame_exceso",
      clase: "derivado",
      lote: m.a,
      fecha: receptor?.fecha ?? null,
      kg: m.kg,
      motivo: m.motivo,
      loteDonante: m.de,
    });
  }

  return eventos;
}

// ─── 3) Eventos desde el registro de cámara externa ─────────────────────────

/**
 * Construye eventos MEDIDO (ubicación en cámara externa / recibido) y, si el
 * registro lo indica, el evento de venta directa — reutilizando
 * `estadoCamionExterno` (camarasExternas.ts) para no duplicar la derivación
 * de estado (venta directa / recibido / parcial / en cámara).
 *
 * Solo se emite evento cuando el camión sigue aportando información viva
 * (en_camara, parcial o venta_directa): un camión ya "recibido" no aporta
 * ubicación nueva — su fruta ya se ve por otras vías (pasadas, ajuste).
 */
export function eventosDeCamaraExterna(
  camiones: CamionCamaraExterna[],
  senales: SenalesRecepcion,
  hoy: string,
): EventoLote[] {
  const eventos: EventoLote[] = [];
  for (const camion of camiones) {
    const lote8 = normalizarLoteCodigo(camion.lote);
    const estado = estadoCamionExterno(camion, senales, hoy);

    if (estado.estado === "venta_directa") {
      // Sin lote reconocible no hay a quién atribuir el evento (venta directa
      // sin código de lote en el registro): se descarta en silencio, igual
      // que hace el resto del motor con datos sin código.
      if (lote8) {
        eventos.push({
          tipo: "venta_directa",
          clase: "medido",
          lote: lote8,
          fecha: camion.fecha_almacenamiento,
          kg: camion.kg,
          detalle: estado.detalle,
        });
      }
      continue;
    }
    if (!lote8) continue;
    if (estado.estado === "en_camara") {
      eventos.push({
        tipo: "camara_externa",
        clase: "medido",
        lote: lote8,
        fecha: camion.fecha_almacenamiento,
        kg: camion.kg,
        procedencia: camion.procedencia,
        estadoCamion: "en_camara",
      });
    } else if (estado.estado === "parcial") {
      eventos.push({
        tipo: "camara_externa",
        clase: "medido",
        lote: lote8,
        fecha: camion.fecha_almacenamiento,
        kg: estado.kgRestante,
        procedencia: camion.procedencia,
        estadoCamion: "parcial",
      });
    }
    // estado "recibido": el camión ya salió de cámara según el propio
    // registro — no aporta ubicación viva, no genera evento.
  }
  return eventos;
}

// ─── 4) Eventos desde la confirmación FÍSICA en cámara ──────────────────────

/**
 * Construye el evento ANOTADO de confirmación física vigente (inventario a
 * pie de dirección), reutilizando `camaraConfirmadaVigentePorLote`
 * (camaraConfirmada.ts) — esa función ya decide la vigencia (caduca si el
 * lote tiene una pasada propia posterior a la fecha de confirmación).
 */
export function eventosDeConfirmacionFisica(
  entradas: EntradaConCamaraConfirmada[],
  pasadas: PasadaConciliacion[],
): EventoLote[] {
  const vigentes = camaraConfirmadaVigentePorLote(entradas, pasadas);
  const eventos: EventoLote[] = [];
  for (const [lote, confirmacion] of vigentes) {
    eventos.push({
      tipo: "confirmacion_fisica",
      clase: "anotado",
      lote,
      fecha: confirmacion.fecha,
      kg: null,
      nombreCamara: confirmacion.nombre,
    });
  }
  return eventos;
}

// ─── 5) Hueco tipado: anotaciones de pasada (tabla futura) ──────────────────

/**
 * Convierte filas de la futura tabla `pasada_anotaciones` (otro agente la
 * está creando en paralelo) en eventos ANOTADO. Mientras la tabla no exista,
 * se llama con el array vacío por defecto y no aporta ningún evento — el
 * resto del motor (cicloVidaLote.ts) ya sabe convivir con clase "anotado" sin
 * kg (ver EventoConfirmacionFisica/EventoCierreManual), así que enchufar esta
 * fuente de verdad más adelante no debería requerir tocar el derivador.
 */
export function eventosDeAnotacionesPasada(anotaciones: PasadaAnotacionInput[] = []): EventoLote[] {
  return anotaciones.map((a) => ({
    tipo: "anotacion_pasada" as const,
    clase: "anotado" as const,
    lote: normalizarLoteCodigo(a.lote) ?? a.lote,
    fecha: a.fecha,
    kg: a.kg != null ? Number(a.kg) || 0 : null,
    nota: a.nota ?? null,
  }));
}

// ─── Punto de entrada: todos los eventos de la campaña ──────────────────────

export interface ConstruirEventosLoteInput {
  entradas: EntradaBasculaEventoInput[];
  /** Mismo shape que `entradas` pero adaptado a EntradaConciliacion (ver conciliacionKg.ts) — normalmente construido por el caller a partir de `entradas` + `entradasPrecalibrado` juntas. */
  entradasConciliacion: EntradaConciliacion[];
  pasadas: PasadaConciliacion[];
  reciclajePorDia?: ReciclajeDiaInput[];
  /** Unión de cámara EXTERNA + confirmación FÍSICA vigentes (ver camaraConfirmada.ts unirLotesConfirmadosEnCamara) — se pasa tal cual a conciliarKgProcesados. */
  lotesConfirmadosEnCamara?: Set<string>;
  camionesCamaraExterna?: CamionCamaraExterna[];
  senalesCamaraExterna?: SenalesRecepcion;
  entradasConCamaraConfirmada?: EntradaConCamaraConfirmada[];
  anotacionesPasada?: PasadaAnotacionInput[];
  hoy: string;
}

/**
 * Construye TODOS los eventos de la campaña, de todas las fuentes. Función
 * PURA — el caller (un hook, o el test del banco dorado) es quien carga los
 * datos y los adapta a estos tipos.
 */
export function construirEventosLote(input: ConstruirEventosLoteInput): EventoLote[] {
  const eventos: EventoLote[] = [
    ...eventosDeEntradaBascula(input.entradas),
    ...eventosDePasadasCalibrador(input.entradasConciliacion, input.pasadas, input.reciclajePorDia, input.lotesConfirmadosEnCamara),
    ...eventosDeAnotacionesPasada(input.anotacionesPasada),
  ];
  if (input.camionesCamaraExterna && input.senalesCamaraExterna) {
    eventos.push(...eventosDeCamaraExterna(input.camionesCamaraExterna, input.senalesCamaraExterna, input.hoy));
  }
  if (input.entradasConCamaraConfirmada) {
    eventos.push(...eventosDeConfirmacionFisica(input.entradasConCamaraConfirmada, input.pasadas));
  }
  return eventos;
}

/** Agrupa una lista de eventos por lote — utilidad pequeña que reutiliza cicloVidaLote.ts y los tests. */
export function eventosPorLote(eventos: EventoLote[]): Map<string, EventoLote[]> {
  const porLote = new Map<string, EventoLote[]>();
  for (const e of eventos) {
    const arr = porLote.get(e.lote) ?? [];
    arr.push(e);
    porLote.set(e.lote, arr);
  }
  return porLote;
}

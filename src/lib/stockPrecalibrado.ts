/**
 * stockPrecalibrado.ts — stock VISIBLE del precalibrado (regla del dueño,
 * 2026-07-28: "el precalibrado se ve siempre, en cualquier cosa").
 *
 * El circuito PREC es cerrado: fruta ya comprada se aparta al almacén de
 * precalibrado y la báscula registra su RE-ENTRADA como movimiento interno
 * (esEntradaPrecalibrado, una fila por re-entrada con su propio código de
 * lote); el calibrador registra sus re-pasadas. Lo único medible con
 * fiabilidad es lo REINTRODUCIDO y cuánto de ello sigue sin re-pasar por
 * línea (fruta física en la nave esperando calibrador): lo APARTADO hacia el
 * almacén no siempre se pesa (verificado 22-jul-2026: apartado registrado
 * 506 t < reintroducido 792 t), así que el "contenido del almacén PREC" NO
 * se calcula — saldría negativo (misma nota que
 * conciliacionKg.precalibradoPendienteKg).
 *
 * Pendiente por re-entrada = kg re-entrada − kg conciliado a su código
 * (conciliarKgProcesados ya acota lo asignado a la capacidad de la
 * re-entrada). El Σ de estos pendientes coincide con el
 * precalibradoPendienteKg agregado de la conciliación; aquí se desglosa por
 * re-entrada y por almacén (PREC 1 / PREC 2, de la finca de báscula).
 *
 * REFUERZO 04-ago-2026 (encargo del dueño: "hay lotes de precalibrado con
 * +100 días y estoy segurísimo de que se han usado, pero no lo has
 * detectado"). Antes de tocar nada se auditó la BD real (ver el informe
 * intermedio de la conversación): 304 entradas internas activas, 846,7 t.
 * De ellas:
 *   - 89 aparecen referenciadas por su código EXACTO en alguna pasada del
 *     calibrador (lotes_dia.lote_codigo). De esas, 52 alguna vez como PRIMER
 *     código de su pasada: YA reciben su kg correctamente vía
 *     conciliarKgProcesados, sin bug — no necesitan ningún cambio aquí.
 *   - 37 (94,8 t) SOLO aparecen como código NO-primero de una pasada
 *     COMPUESTA (p. ej. "25111002+25111001+PREC 25111901"): el reparto por
 *     capacidad de conciliarKgProcesados agota el pasada entera en los
 *     códigos anteriores y estas quedan con 0 kg bajo su propio código —
 *     pero el calibrador SÍ las nombró explícitamente. Esto es EXACTAMENTE
 *     la misma evidencia textual que detectarLotesEnPasadaCompuesta
 *     (conciliacionKg.ts) ya calcula para los lotes reales huérfanos de
 *     compuesta — se reutiliza aquí tal cual, sin inventar ningún FIFO ni
 *     heurística de reparto por antigüedad (el dueño fue explícito: "no
 *     asumas nada... cada lote de precalibrado SE INDICA, así que mientras
 *     se indique en los informes, se usa el que se indique").
 *   - 215 (539,9 t, 159 de ellas >60 días / 407 t) NO tienen NINGUNA mención
 *     textual en ninguna pasada. Para esas NO se inventa nada: quedan
 *     visibles en `pendientes` (fruta sin indicación de consumo) con su
 *     antigüedad, para cierre MANUAL 1-clic — nunca automático.
 */
import { diffDias, DIAS_SIN_ACTIVIDAD_AUTOCIERRE } from "@/lib/entradasBascula";
import { normalizarLoteCodigo } from "@/lib/loteCodigo";
import { normalizarTexto } from "@/lib/format";

export interface ReentradaPrecalibradoInput {
  lote: string;
  /** Fecha de la re-entrada por báscula (cuando la fruta apartada volvió a registrarse). */
  fecha: string;
  /** Finca de báscula del movimiento interno: "PREC 1 ALMACEN" / "PREC 2 ALMACEN". */
  finca: string | null;
  kg_entrada: number;
  /** id real de entradas_bascula: hace falta para poder cerrarla (cierre automático o manual). `null`/ausente si no se tiene a mano (la re-entrada simplemente no será candidata a cierre). */
  id?: string | null;
  /** entradas_bascula.cerrado_at: no null si esta re-entrada ya está cerrada — se excluye de `pendientes`, `resueltasPorCompuesta` y `candidatosCierre`. */
  cerrado_at?: string | null;
}

/** Filas sintéticas de la conciliación (conciliacionKg.procesados). `date` es la última fecha de esa pasada — margen del cierre automático de "consumida del todo". */
interface ProcesadoConciliadoInput {
  lote_codigo: string;
  kg_peso_total: number;
  date?: string | null;
}

/** lote (interno o real) → evidencia de pasada COMPUESTA que lo nombra como código no-primero (detectarLotesEnPasadaCompuesta, conciliacionKg.ts). */
type EvidenciaCompuestaPorLote = Map<string, { primeros: string[]; ultimaFecha: string | null }>;

interface ReentradaPrecalibradoPendiente {
  lote: string;
  fecha: string;
  almacen: string;
  kg: number;
  kgReprocesado: number;
  kgPendiente: number;
  /** Días desde la re-entrada hasta hoy: cuánto lleva esa fruta esperando línea. */
  dias: number;
  /** id real de entradas_bascula (para el botón de cierre manual 1-clic); null si no se tenía a mano. */
  id: string | null;
}

/** Re-entrada SIN pasada bajo su propio código pero nombrada como no-primero en una pasada compuesta (ver cabecera del archivo): se da por usada aunque no se le pueda atribuir un kg exacto. */
interface ReentradaResueltaPorCompuesta {
  lote: string;
  fecha: string;
  almacen: string;
  kg: number;
  /** Códigos que la nombraron (detectarLotesEnPasadaCompuesta). */
  primeros: string[];
  ultimaFecha: string | null;
  /** Días desde la re-entrada hasta hoy: mismo criterio que ReentradaPrecalibradoPendiente.dias. */
  dias: number;
}

interface CandidatoCierrePrecalibrado {
  id: string;
  lote: string;
  /** "consumido" = re-pasada bajo su propio código llegó a cubrir su kg; "compuesto" = evidencia de pasada compuesta (ver ReentradaResueltaPorCompuesta). Ambos cierran con cierre_modo "sin_registro": su kg no consta como pérdida real. */
  motivo: "consumido" | "compuesto";
}

export interface StockPrecalibrado {
  nReentradas: number;
  kgReintroducido: number;
  kgReprocesado: number;
  /** Fruta física en la nave esperando línea (la única parte del PREC medible con fiabilidad). */
  kgPendiente: number;
  porAlmacen: Array<{ almacen: string; nReentradas: number; kg: number; kgPendiente: number }>;
  /** Re-entradas con pendiente relevante y SIN indicación de consumo en ningún informe: las más antiguas primero. Candidatas a cierre MANUAL únicamente. */
  pendientes: ReentradaPrecalibradoPendiente[];
  /** Re-entradas resueltas por evidencia de pasada compuesta (ver cabecera del archivo), más antiguas primero. */
  resueltasPorCompuesta: ReentradaResueltaPorCompuesta[];
  /** Candidatas al cierre automático PERSISTIDO (consumidas del todo bajo su propio código, o resueltas por compuesta) con el margen de DIAS_SIN_ACTIVIDAD_AUTOCIERRE ya aplicado. */
  candidatosCierre: CandidatoCierrePrecalibrado[];
}

/** Pendiente mínimo por re-entrada para listarla (los residuos menores son redondeos de pesada, pero SÍ suman en los totales). */
export const UMBRAL_PENDIENTE_PREC_KG = 100;

/** "PREC 1 ALMACEN" → "PREC 1"; sin número reconocible → "PREC". */
export function extraerAlmacenPrec(finca: string | null): string {
  const m = normalizarTexto(String(finca ?? "")).match(/prec\s*(\d+)/);
  return m ? `PREC ${m[1]}` : "PREC";
}

export function buildStockPrecalibrado(
  reentradas: ReentradaPrecalibradoInput[],
  procesadosConciliados: ProcesadoConciliadoInput[],
  hoy: string,
  /**
   * Evidencia de pasada compuesta (ver cabecera del archivo): 37 de las 304
   * re-entradas activas SOLO aparecen así, nunca como primer código de su
   * propia pasada, así que conciliarKgProcesados les deja 0 kg bajo su
   * código aunque el calibrador SÍ las nombrara. Opcional para no romper
   * llamadas existentes (tests, o mientras el caller no tenga esta evidencia
   * calculada).
   */
  huerfanosCompuesta?: EvidenciaCompuestaPorLote,
): StockPrecalibrado {
  const conciliadoPorLote = new Map<string, { kg: number; ultimaFecha: string | null }>();
  for (const p of procesadosConciliados) {
    const lote = normalizarLoteCodigo(p.lote_codigo) ?? String(p.lote_codigo ?? "").trim();
    if (!lote) continue;
    const acc = conciliadoPorLote.get(lote) ?? { kg: 0, ultimaFecha: null };
    acc.kg += Number(p.kg_peso_total) || 0;
    if (p.date && (!acc.ultimaFecha || p.date > acc.ultimaFecha)) acc.ultimaFecha = p.date;
    conciliadoPorLote.set(lote, acc);
  }

  let kgReintroducido = 0;
  let kgReprocesado = 0;
  let kgPendiente = 0;
  const acc = new Map<string, { nReentradas: number; kg: number; kgPendiente: number }>();
  const pendientes: ReentradaPrecalibradoPendiente[] = [];
  const resueltasPorCompuesta: ReentradaResueltaPorCompuesta[] = [];
  const candidatosCierre: CandidatoCierrePrecalibrado[] = [];

  for (const r of reentradas) {
    const kg = Number(r.kg_entrada) || 0;
    const lote = normalizarLoteCodigo(r.lote) ?? r.lote;
    const cerrada = Boolean(r.cerrado_at);
    const directo = conciliadoPorLote.get(lote);
    // La conciliación acota lo asignado a la capacidad de la re-entrada, pero
    // el min defiende la invariante (reprocesado ≤ reintroducido) ante datos
    // crudos sin conciliar.
    const reprocesadoDirecto = Math.min(kg, directo?.kg ?? 0);
    const pendienteDirecto = Math.max(0, kg - reprocesadoDirecto);

    // Solo se busca evidencia de compuesta si el directo no la cubrió del
    // todo: una re-entrada ya cubierta por su propio código no necesita más
    // evidencia (y así nunca se pisa un reprocesado real con la evidencia
    // textual, que no trae kg).
    const evidenciaCompuesta = !cerrada && pendienteDirecto > 0
      ? huerfanosCompuesta?.get(lote) ?? null
      : null;

    // Regla del dueño 04-08-2026: "mientras se indique en los informes, se
    // usa el que se indique" — con evidencia de compuesta se da por
    // consumida ENTERA aunque el reparto por capacidad no le atribuyera kg
    // bajo su propio código. Nunca se inventa un kg intermedio: o cubre el
    // directo, o (con evidencia) cubre el total, o queda pendiente tal cual.
    const pendiente = evidenciaCompuesta ? 0 : pendienteDirecto;
    const reprocesado = kg - pendiente;
    const almacen = extraerAlmacenPrec(r.finca);

    kgReintroducido += kg;
    kgReprocesado += reprocesado;
    kgPendiente += pendiente;

    const a = acc.get(almacen) ?? { nReentradas: 0, kg: 0, kgPendiente: 0 };
    a.nReentradas += 1;
    a.kg += kg;
    a.kgPendiente += pendiente;
    acc.set(almacen, a);

    const dias = r.fecha ? diffDias(r.fecha, hoy) : 0;

    if (evidenciaCompuesta) {
      resueltasPorCompuesta.push({
        lote,
        fecha: r.fecha,
        almacen,
        kg,
        primeros: evidenciaCompuesta.primeros,
        ultimaFecha: evidenciaCompuesta.ultimaFecha,
        dias,
      });
    } else if (pendiente >= UMBRAL_PENDIENTE_PREC_KG) {
      pendientes.push({ lote, fecha: r.fecha, almacen, kg, kgReprocesado: reprocesado, kgPendiente: pendiente, dias, id: r.id ?? null });
    }

    // Candidatas al cierre automático persistido: nunca sin `id`, nunca ya
    // cerradas, y solo cuando el margen de DIAS_SIN_ACTIVIDAD_AUTOCIERRE
    // (mismo que el cierre de completos/compuestos reales) ya pasó desde la
    // ÚLTIMA evidencia que la tocó — deja asentarse un parte con retraso.
    if (!cerrada && r.id) {
      if (evidenciaCompuesta) {
        if (evidenciaCompuesta.ultimaFecha && diffDias(evidenciaCompuesta.ultimaFecha, hoy) >= DIAS_SIN_ACTIVIDAD_AUTOCIERRE) {
          candidatosCierre.push({ id: r.id, lote, motivo: "compuesto" });
        }
      } else if (pendiente <= 0.5 && directo?.ultimaFecha && diffDias(directo.ultimaFecha, hoy) >= DIAS_SIN_ACTIVIDAD_AUTOCIERRE) {
        candidatosCierre.push({ id: r.id, lote, motivo: "consumido" });
      }
    }
  }

  pendientes.sort((a, b) => a.fecha.localeCompare(b.fecha) || a.lote.localeCompare(b.lote));
  resueltasPorCompuesta.sort((a, b) => a.fecha.localeCompare(b.fecha) || a.lote.localeCompare(b.lote));

  return {
    nReentradas: reentradas.length,
    kgReintroducido,
    kgReprocesado,
    kgPendiente,
    porAlmacen: [...acc.entries()]
      .map(([almacen, a]) => ({ almacen, ...a }))
      .sort((a, b) => b.kg - a.kg),
    pendientes,
    resueltasPorCompuesta,
    candidatosCierre,
  };
}

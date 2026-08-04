/**
 * conciliarCamaraVacia.ts — acción "Conciliar cámara vacía" (Guadex/Zamexfruit).
 *
 * Encargo del dueño (03-08-2026, literal): "ya no hay nada en cámaras
 * externas, y aún así eso no se ha contabilizado". Las cámaras externas están
 * FÍSICAMENTE VACÍAS pero la app sigue derivando camiones "en cámara" porque
 * su lote no aparece en NINGUNA pasada de lotes_dia (ni como compuesto) ni en
 * lote_clasificacion: su fruta salió sin dejar rastro con su código
 * (reidentificada, mezclada o vendida sin registrar). Casarlos automáticamente
 * con otro lote sería INVENTAR un cruce que no existe — la única salida
 * honesta es una conciliación EXPLÍCITA por procedencia, con el usuario
 * confirmando antes de tocar nada.
 *
 * Al confirmar, por cada camión que la propia procedencia sigue mostrando
 * "en cámara"/"parcial" (ver estadoCamionExterno, src/lib/camarasExternas.ts):
 *   1. si tiene una entradas_bascula localizable por su lote: se le pone
 *      fecha_salida_camara (la fecha declarada) para que el estado derivado
 *      pase a "recibido" y se cierra esa entrada como 'sin_registro' (mismo
 *      significado que en entradas_bascula.ts: su procesado no consta bajo
 *      este código, así que sale del stock SIN contar como merma/pérdida real);
 *   2. si NO tiene entrada de báscula localizable (rareza real: el lote del
 *      registro de cámara no existe en entradas_bascula), no hay báscula que
 *      cerrar — se marca solo LA SEÑAL DEL CAMIÓN: entrada_lst_1 (el mismo
 *      campo que ya usa estadoCamionExterno como "recibido según el
 *      registro") pasa a la fecha declarada, para que ese camión también deje
 *      de contar como "en cámara" sin inventar una entrada de báscula que no
 *      existe;
 *   3. en ambos casos se añade una nota rastreable en nota_entrada (se
 *      concatena con lo que ya hubiera, nunca se pisa) para poder auditar
 *      después QUÉ se concilió y CUÁNDO — la propia nota es la señal que usa
 *      este módulo para reconocer más tarde "esto se conciliado como cámara
 *      vacía" sin necesitar una columna nueva.
 *
 * Nada se casa a ciegas ni se persiste un "estado": todo sigue derivándose en
 * cada lectura, igual que el resto de camarasExternas.ts.
 */
import { normalizarLoteCodigo } from "@/lib/loteCodigo";
import {
  estadoCamionExterno, kgEnCamaraDeEstado,
  type CamionCamaraExterna, type EstadoCamionExterno, type SenalesRecepcion,
} from "@/lib/camarasExternas";
import type { CierreModo } from "@/lib/entradasBascula";

/** Entrada de báscula mínima que necesita esta conciliación para casar por lote. */
export interface EntradaBasculaParaConciliacion {
  id: string;
  lote: string;
  cerradoAt: string | null;
}

export interface CamionPendienteConciliacion<T extends CamionCamaraExterna = CamionCamaraExterna> {
  camion: T;
  estado: EstadoCamionExterno;
  /** kg que aún cuentan como "en cámara" para este camión (prorrateado si es parcial). */
  kgPendiente: number;
  /** id real de entradas_bascula resuelto por lote; null si no hay entrada localizable (rareza). */
  entradaId: string | null;
  /** la entrada de báscula ya estaba cerrada a mano (raro si sigue "en cámara", pero por si acaso no se reabre ni se pisa su modo). */
  entradaYaCerrada: boolean;
}

export interface PreviewConciliacionCamaraVacia<T extends CamionCamaraExterna = CamionCamaraExterna> {
  procedencia: string;
  pendientes: CamionPendienteConciliacion<T>[];
  kgTotal: number;
  /** Subconjunto de `pendientes` sin entrada de báscula localizable: rareza, solo se toca la señal del camión. */
  sinEntradaBascula: CamionPendienteConciliacion<T>[];
  /** Subconjunto de `pendientes` cuya entrada YA estaba cerrada a mano: no se recierra ni se pisa su cierre_modo, solo se marca la salida. */
  entradaYaCerrada: CamionPendienteConciliacion<T>[];
}

/**
 * Camiones de `procedencia` que siguen derivándose "en cámara"/"parcial":
 * candidatos a la conciliación. Resuelve el id real de entradas_bascula por
 * lote (normalizado a 8 dígitos, misma convención que el resto de la app).
 * Genérica en `T` (además de `CamionCamaraExterna`) para que el llamador
 * pueda pasar la fila con `id` (CamionCamaraExternaRow) y recuperarlo después
 * sin castear.
 */
export function previsualizarConciliacionCamaraVacia<T extends CamionCamaraExterna>(
  procedencia: string,
  camiones: T[],
  senales: SenalesRecepcion,
  entradas: EntradaBasculaParaConciliacion[],
  hoy: string,
): PreviewConciliacionCamaraVacia<T> {
  const entradaPorLote = new Map<string, EntradaBasculaParaConciliacion>();
  for (const e of entradas) {
    const lote8 = normalizarLoteCodigo(e.lote);
    if (lote8 && !entradaPorLote.has(lote8)) entradaPorLote.set(lote8, e);
  }

  const pendientes: CamionPendienteConciliacion<T>[] = camiones
    .filter((c) => c.procedencia === procedencia)
    .map((camion) => ({ camion, estado: estadoCamionExterno(camion, senales, hoy) }))
    .filter((c): c is { camion: T; estado: Extract<EstadoCamionExterno, { estado: "en_camara" | "parcial" }> } =>
      c.estado.estado === "en_camara" || c.estado.estado === "parcial")
    .map(({ camion, estado }) => {
      const lote8 = normalizarLoteCodigo(camion.lote);
      const entrada = lote8 ? entradaPorLote.get(lote8) ?? null : null;
      return {
        camion,
        estado,
        kgPendiente: kgEnCamaraDeEstado(camion, estado),
        entradaId: entrada?.id ?? null,
        entradaYaCerrada: entrada?.cerradoAt != null,
      };
    })
    .sort((a, b) => a.camion.fecha_almacenamiento.localeCompare(b.camion.fecha_almacenamiento) || a.camion.s_ref.localeCompare(b.camion.s_ref));

  return {
    procedencia,
    pendientes,
    kgTotal: pendientes.reduce((s, p) => s + p.kgPendiente, 0),
    sinEntradaBascula: pendientes.filter((p) => p.entradaId == null),
    entradaYaCerrada: pendientes.filter((p) => p.entradaId != null && p.entradaYaCerrada),
  };
}

/** Modo de cierre que usa esta conciliación: su procesado no consta bajo su código, no se inventa pérdida. */
export const CIERRE_MODO_CONCILIACION_CAMARA_VACIA: CierreModo = "sin_registro";

/** Texto de la marca de la nota rastreable (nota_entrada) — también sirve para reconocer después qué se conciliado (ver `esConciliadoCamaraVacia`). */
export const MARCADOR_CONCILIACION_CAMARA_VACIA = "Conciliado como cámara vacía el";

/** Nota rastreable completa para un camión conciliado en la fecha dada. */
export function notaConciliacionCamaraVacia(fecha: string): string {
  return `${MARCADOR_CONCILIACION_CAMARA_VACIA} ${fecha} (sin rastro de procesado con su código)`;
}

/** Concatena una nota nueva con la que ya hubiera (nunca se pisa lo existente). */
export function combinarNotaEntrada(notaExistente: string | null, notaNueva: string): string {
  return notaExistente ? `${notaExistente} · ${notaNueva}` : notaNueva;
}

/** ¿Este camión fue conciliado como "cámara vacía" (por esta acción, en cualquier momento)? Se reconoce por la marca en nota_entrada — no hace falta una columna nueva. */
export function esConciliadoCamaraVacia(camion: CamionCamaraExterna): boolean {
  return Boolean(camion.nota_entrada && camion.nota_entrada.includes(MARCADOR_CONCILIACION_CAMARA_VACIA));
}

/** Camiones ya conciliados como "cámara vacía" (para el desplegable "conciliados sin registro" de la card), del más reciente al más antiguo por fecha de almacenamiento. */
export function conciliadosCamaraVacia(camiones: CamionCamaraExterna[]): CamionCamaraExterna[] {
  return camiones
    .filter(esConciliadoCamaraVacia)
    .sort((a, b) => b.fecha_almacenamiento.localeCompare(a.fecha_almacenamiento) || a.s_ref.localeCompare(b.s_ref));
}

export interface ResumenConciliacionCamaraVacia {
  procedencia: string;
  camiones: number;
  kg: number;
}

/** Resumen por procedencia de lo ya conciliado como "cámara vacía", de mayor a menor kg. */
export function resumenConciliacionCamaraVacia(camiones: CamionCamaraExterna[]): ResumenConciliacionCamaraVacia[] {
  const acc = new Map<string, { camiones: number; kg: number }>();
  for (const c of camiones) {
    if (!esConciliadoCamaraVacia(c)) continue;
    const a = acc.get(c.procedencia) ?? { camiones: 0, kg: 0 };
    a.camiones += 1;
    a.kg += c.kg;
    acc.set(c.procedencia, a);
  }
  return [...acc.entries()]
    .map(([procedencia, a]) => ({ procedencia, ...a }))
    .sort((a, b) => b.kg - a.kg);
}

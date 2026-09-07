/**
 * calibradorReparto.ts — reparte entre sus lotes (y por tanto entre sus
 * productores) las pasadas del calibrador cuyo nombre dice que se echó más de
 * un lote.
 *
 * EL PROBLEMA. El Sizer atribuye TODA la pasada al primer código que encuentra
 * en el BatchName, pero el operario escribe ahí lo que echó de verdad:
 * "26013107+26012608", "26051904 +7 BOX DE RECICLAJE". Al cierre de la campaña
 * 25/26 eran 73 pasadas compuestas y 1,22 M kg —el 5,6 %— atribuidos enteros a
 * un solo productor cuando la fruta era de varios.
 *
 * QUÉ HACE Y QUÉ NO. Aplica `repartirPasadaPorBox` (desgloseBox.ts, la MISMA
 * función que usa el desglose de los partes: aquí no se reimplementa ni una
 * regla del parser) SOLO a las pasadas que no necesitan que decida una persona.
 * El resto va a una cola visible.
 *
 * QUÉ ES "CLARA", y por qué cada corte:
 *   1. El parser saca 2 o más líneas. Con una sola no hay nada que repartir.
 *   2. TODAS las líneas llevan sus box escritos. Sin box no hay con qué
 *      ponderar, y `repartirPasadaPorBox` les da 0 kg a propósito ("repartirles
 *      algo sería inventarse el dato"): aplicarlo igual movería toda la pasada
 *      a la otra línea, que es peor que no tocar nada.
 *   3. Ninguna línea es un precalibrado por fecha sin resolver. Esas exigen
 *      decir a QUÉ re-entrada corresponde "22/07", y la regla del dueño es que
 *      cada PREC se usa según se indique, jamás por FIFO ni por tamaño
 *      (stockPrecalibrado.ts). Eso es una decisión humana.
 *   4. El reparto acaba tocando a más de un código. Si no, no cambia nada.
 *
 * DÓNDE VIVE EL RESULTADO. Hasta el 07-09-2026 este reparto solo se derivaba en
 * el navegador, en una pantalla (useCalibradorAprovechamiento), y la vista
 * canónica clasificacion_lote seguía dando el 100 % al primer código. Desde
 * entonces la edge function reparto-pasadas lo calcula UNA vez por hora con
 * `calcularRepartoPasadas` (abajo) y lo deja en calibrador_pasada_reparto, que
 * la vista multiplica fila a fila. Sigue siendo un estado DERIVADO (regla de
 * oro de docs/TRAZABILIDAD_REFUNDACION.md): la tabla se recalcula entera desde
 * los hechos en cada pasada y es idempotente; nadie la edita a mano.
 *
 * DOS SEMÁNTICAS PARA EL RECICLAJE, a propósito. En la pantalla del navegador
 * (`aplicarReparto`) los kilos de reciclaje SALEN de la atribución y se cuentan
 * como "sin productor", porque el reciclado es incasable por naturaleza (regla
 * del dueño 04-08-2026). En el reparto canónico (`calcularRepartoPasadas`) se
 * QUEDAN en el primer código, porque la vista tiene que conservar los kg
 * totales del día: quitarlos de ahí los haría desaparecer del calibrado diario.
 *
 * Módulo compartido (patrón fotoLotesCoherencia): lo importan la edge function
 * y, vía el shim src/lib/calibradorReparto.ts, la app. Sin red ni Supabase.
 */
import {
  parsearDesgloseTexto,
  repartirPasadaPorBox,
  type LineaDesglose,
} from "./desgloseBox.ts";
import {
  esAgricultorMovimientoInterno,
  esEntradaPrecalibrado,
  esProductorPrecalibrado,
} from "./productoresCanonicos.ts";

/** Una pasada con desglose y sus kg ya separados por destino (RPC calibrador_pasadas_con_desglose). */
export interface PasadaConDesglose {
  batch_id: number;
  batch_name: string;
  /** El código al que el Sizer atribuyó TODA la pasada. */
  lote: string;
  fecha: string;
  kg_total: number;
  kg_exportacion: number;
  kg_no_exportacion: number;
  kg_industria: number;
  kg_mujeres: number;
  kg_otros: number;
}

/** Las cinco columnas de kg que se mueven juntas, en proporción. */
export const GRUPOS = [
  "kg_total", "kg_exportacion", "kg_no_exportacion",
  "kg_industria", "kg_mujeres", "kg_otros",
] as const;
export type Grupo = (typeof GRUPOS)[number];

export interface PasadaEnCola {
  batch_id: number;
  batch_name: string;
  fecha: string;
  kg_total: number;
  /** Por qué no se ha repartido sola. Se enseña tal cual al usuario. */
  motivo: string;
}

/** Cuántos kg pasan de un código a otro (o a nadie, si `hacia` es null). */
export interface Movimiento {
  batch_id: number;
  desde: string;
  hacia: string | null;
  kg: Partial<Record<Grupo, number>>;
}

export interface RepartoPasada {
  estado: "repartida" | "cola";
  movimientos: Movimiento[];
  cola?: PasadaEnCola;
}

const enCola = (p: PasadaConDesglose, motivo: string): RepartoPasada => ({
  estado: "cola",
  movimientos: [],
  cola: { batch_id: p.batch_id, batch_name: p.batch_name, fecha: p.fecha, kg_total: p.kg_total, motivo },
});

/** Un precalibrado nombrado solo por su fecha, que nadie ha resuelto todavía. */
const esPrecSinResolver = (l: LineaDesglose) =>
  l.tipo === "precalibrado" && !l.lote_codigo;

/**
 * Decide si una pasada se puede repartir sola y, si sí, cuántos kg se mueven.
 * Función pura: no lee nada, no escribe nada.
 */
export function repartirPasada(pasada: PasadaConDesglose): RepartoPasada {
  const lineas = parsearDesgloseTexto(pasada.batch_name, pasada.fecha);
  if (lineas.length < 2) return enCola(pasada, "el nombre no se puede trocear en varias lineas");
  if (lineas.some(esPrecSinResolver)) {
    return enCola(pasada, "nombra un precalibrado por su fecha: hay que indicar de que re-entrada era");
  }

  const reparto = repartirPasadaPorBox(pasada.kg_total, lineas);
  if (reparto.lineasSinBox > 0) {
    return enCola(pasada, `${reparto.lineasSinBox} linea(s) sin box escritos: no hay con que repartir`);
  }
  if (reparto.kgPasada <= 0) return enCola(pasada, "la pasada no tiene kilos");

  // Todo lo que NO le toca al código al que hoy se atribuye la pasada entera.
  const movimientos: Movimiento[] = [];
  for (const linea of reparto.lineas) {
    const hacia = linea.codigoAtribuido;
    if (hacia === pasada.lote) continue;      // se queda donde ya estaba
    if (linea.kg <= 0) continue;

    const fraccion = linea.kg / reparto.kgPasada;
    const kg: Partial<Record<Grupo, number>> = {};
    for (const g of GRUPOS) kg[g] = (pasada[g] ?? 0) * fraccion;
    movimientos.push({ batch_id: pasada.batch_id, desde: pasada.lote, hacia, kg });
  }

  if (movimientos.length === 0) {
    return enCola(pasada, "el reparto deja todo en el mismo lote: no cambia nada");
  }
  return { estado: "repartida", movimientos };
}

/**
 * Segunda estrategia, para las pasadas que nombran varios lotes SIN box.
 *
 * Es la fase 1 de `conciliarKgProcesados` (regla del dueño 21-jul-2026) aplicada
 * al calibrador: se recorren los códigos EN EL ORDEN DEL TEXTO y cada uno absorbe
 * hasta donde le quede pendiente. No hay derrame ni reparto proporcional: si el
 * primer código todavía tiene mucho pendiente se lleva toda la pasada y los
 * siguientes no reciben nada — así está documentado en conciliacionKg.ts y así se
 * mantiene aquí, porque repartir "a partes iguales" sería inventarse el dato.
 *
 * Lo que no encuentra hueco se queda donde estaba (el primer código) y se cuenta
 * en `sinColocar`: nunca se fuerza un cuadre.
 */
export interface CapacidadLote {
  /** Kg que entraron por báscula. */
  kgEntrada: number;
  /** Kg que ya se llevó por pasadas que solo le nombran a él (no se discuten). */
  kgAtribuidoSimple: number;
}

/** Qué pasó con UNA pasada dentro del reparto por capacidad: sirve para explicar por qué no se movió nada. */
export interface DetalleCapacidadPasada {
  batch_id: number;
  /** Lo que absorbió cada código nombrado (incluido el primero), en el orden del texto. */
  absorbido: Array<{ codigo: string; kg: number }>;
  /** Códigos nombrados sin entrada de báscula: no pueden absorber nada. */
  sinEntrada: string[];
  /** Kg que no cupieron en ningún lote nombrado: se quedan en el primero. */
  kgSinColocar: number;
}

export interface RepartoPorCapacidad {
  movimientos: Movimiento[];
  pasadasRepartidas: number;
  /** Kg que ningún lote nombrado podía absorber: se quedan en el primero. */
  kgSinColocar: number;
  /** Una entrada por pasada con dos códigos o más, en el orden en que se procesaron. */
  porPasada: DetalleCapacidadPasada[];
}

/** Los códigos de 8 dígitos del texto, en orden y sin repetir. */
export function codigosDelNombre(texto: string): string[] {
  const vistos = new Set<string>();
  const out: string[] = [];
  for (const m of String(texto ?? "").matchAll(/\d{8}/g)) {
    if (vistos.has(m[0])) continue;
    vistos.add(m[0]);
    out.push(m[0]);
  }
  return out;
}

export function repartirPorCapacidad(
  pasadas: PasadaConDesglose[],
  capacidad: Map<string, CapacidadLote>,
): RepartoPorCapacidad {
  // El pendiente se va gastando pasada a pasada, así que hay que recorrerlas en
  // el orden en que ocurrieron: al revés, una pasada tardía se comería el hueco
  // de una temprana.
  const orden = [...pasadas].sort((a, b) =>
    a.fecha.localeCompare(b.fecha) || a.batch_id - b.batch_id);

  const pendiente = new Map<string, number>();
  for (const [lote, c] of capacidad) {
    pendiente.set(lote, Math.max(0, c.kgEntrada - c.kgAtribuidoSimple));
  }

  const movimientos: Movimiento[] = [];
  const porPasada: DetalleCapacidadPasada[] = [];
  let pasadasRepartidas = 0;
  let kgSinColocar = 0;

  for (const pasada of orden) {
    const codigos = codigosDelNombre(pasada.batch_name);
    if (codigos.length < 2) continue;

    const detalle: DetalleCapacidadPasada = { batch_id: pasada.batch_id, absorbido: [], sinEntrada: [], kgSinColocar: 0 };
    let restante = pasada.kg_total;
    let movidoAqui = 0;
    for (const codigo of codigos) {
      const hueco = pendiente.get(codigo);
      if (hueco == null) detalle.sinEntrada.push(codigo);           // sin entrada de báscula
      if (restante <= 0) break;
      if (hueco == null || hueco <= 0) continue;                      // sin entrada, o lleno
      const absorbe = Math.min(restante, hueco);
      pendiente.set(codigo, hueco - absorbe);
      restante -= absorbe;
      detalle.absorbido.push({ codigo, kg: absorbe });
      if (codigo === pasada.lote) continue;                           // ya estaba ahí

      const fraccion = absorbe / pasada.kg_total;
      const kg: Partial<Record<Grupo, number>> = {};
      for (const g of GRUPOS) kg[g] = (pasada[g] ?? 0) * fraccion;
      movimientos.push({ batch_id: pasada.batch_id, desde: pasada.lote, hacia: codigo, kg });
      movidoAqui += absorbe;
    }
    if (movidoAqui > 0) pasadasRepartidas += 1;
    detalle.kgSinColocar = Math.max(0, restante);
    kgSinColocar += detalle.kgSinColocar;
    porPasada.push(detalle);
  }

  return { movimientos, pasadasRepartidas, kgSinColocar, porPasada };
}

/** Fila de aprovechamiento, tal como la devuelve la RPC (y como se pinta). */
export interface FilaProductor {
  productor_id: string | null;
  productor: string;
  lotes: number;
  kg_total: number;
  kg_exportacion: number;
  kg_no_exportacion: number;
  kg_industria: number;
  kg_mujeres: number;
  kg_otros: number;
  pct_exportacion: number | null;
}

/**
 * A quién pertenece un lote. Es una LISTA porque un lote de re-entrada de
 * precalibrado puede venir de varias fincas a la vez: la trazabilidad del ERP
 * dice en qué proporción (ver erp_precalibrado_origen). Un lote normal trae una
 * sola entrada con fraccion = 1.
 */
export type DuenoLote = Array<{ productor_id: string | null; productor: string; fraccion: number }>;

export interface ResultadoReparto {
  productores: FilaProductor[];
  /** Kg que el reparto deja sin dueño (reciclaje, y lotes sin entrada de báscula). */
  kgLiberados: number;
  pasadasRepartidas: number;
  cola: PasadaEnCola[];
  /** Filas que NO son un productor: se enseñan aparte, nunca en el ranking. */
  noProductores: FilaProductor[];
}

/**
 * ¿Esta fila es un productor de verdad?
 *
 * Regla ya establecida (productoresCanonicos.ts, revisada 2026-07-16): los
 * RANKINGS y dossiers de productores excluyen el pseudo-productor PRECALIBRADO
 * y los movimientos internos de confección/sobrante — no son productores, son
 * fruta de la casa volviendo a pasar. Sus kilos siguen contando para el cruce de
 * kg procesado, pero mezclarlos en un ranking de "quién aprovecha mejor" es
 * comparar una finca con un almacén.
 *
 * Se añaden aquí los dos huecos propios de esta pantalla, que tampoco son
 * productores: sin lote legible, y lote sin entrada de báscula.
 */
export function esProductorReal(p: { productor_id: string | null; productor: string }): boolean {
  const n = p.productor ?? "";
  if (n.startsWith("(")) return false;                       // los huecos, entre paréntesis
  if (esProductorPrecalibrado(n)) return false;
  if (esAgricultorMovimientoInterno(n)) return false;
  return !esEntradaPrecalibrado({ agricultor: n, finca: null });
}

/**
 * Aplica los repartos sobre las filas ya agregadas por productor.
 *
 * @param duenoDeLote  código de lote → productor. Un lote que no esté aquí no
 *                     tiene entrada de báscula: sus kg se liberan en vez de
 *                     inventarle un dueño.
 */
export function aplicarReparto(
  productores: FilaProductor[],
  pasadas: PasadaConDesglose[],
  duenoDeLote: Map<string, DuenoLote>,
  /** Capacidad pendiente por lote. Sin ella solo se aplica el reparto por box. */
  capacidad?: Map<string, CapacidadLote>,
): ResultadoReparto {
  // Copia por valor: esta función no muta lo que le dan.
  const porClave = new Map<string, FilaProductor>();
  const claveDe = (p: { productor_id: string | null; productor: string }) =>
    p.productor_id ?? `nombre:${p.productor}`;
  for (const p of productores) porClave.set(claveDe(p), { ...p });

  /** Suma (o resta) los kg de un movimiento a los dueños de un lote, por su fracción. */
  const mover = (duenos: DuenoLote | undefined, kg: Partial<Record<Grupo, number>>, signo: 1 | -1) => {
    if (!duenos?.length) return false;
    for (const d of duenos) {
      const clave = claveDe(d);
      let fila = porClave.get(clave);
      if (!fila) {
        if (signo < 0) continue;      // no se crea una fila para restarle algo
        fila = {
          productor_id: d.productor_id, productor: d.productor, lotes: 0,
          kg_total: 0, kg_exportacion: 0, kg_no_exportacion: 0,
          kg_industria: 0, kg_mujeres: 0, kg_otros: 0, pct_exportacion: null,
        };
        porClave.set(clave, fila);
      }
      for (const g of GRUPOS) fila[g] = (fila[g] ?? 0) + signo * (kg[g] ?? 0) * d.fraccion;
    }
    return true;
  };

  const cola: PasadaEnCola[] = [];
  let kgLiberados = 0;
  let pasadasRepartidas = 0;

  // 1) Las que traen box: reparto proporcional (desgloseBox).
  const movimientos: Movimiento[] = [];
  const yaRepartidas = new Set<number>();
  for (const pasada of pasadas) {
    const r = repartirPasada(pasada);
    if (r.estado === "cola") {
      if (r.cola) cola.push(r.cola);
      continue;
    }
    pasadasRepartidas += 1;
    yaRepartidas.add(pasada.batch_id);
    movimientos.push(...r.movimientos);
  }

  // 2) Las que nombran varios lotes SIN box: por capacidad pendiente. Solo las
  //    que no se hayan repartido ya arriba, para no contarlas dos veces.
  if (capacidad) {
    const pendientes = pasadas.filter((p) => !yaRepartidas.has(p.batch_id));
    const porCap = repartirPorCapacidad(pendientes, capacidad);
    movimientos.push(...porCap.movimientos);
    pasadasRepartidas += porCap.pasadasRepartidas;
    const movidas = new Set(porCap.movimientos.map((m) => m.batch_id));
    // Las que sí se han colocado por capacidad salen de la cola.
    for (let i = cola.length - 1; i >= 0; i -= 1) {
      if (movidas.has(cola[i].batch_id)) cola.splice(i, 1);
    }
  }

  for (const mov of movimientos) {
    // Sale del productor de origen siempre (aunque no haya destino conocido:
    // esos kilos no eran suyos, y regalárselos es justo el error a corregir).
    mover(duenoDeLote.get(mov.desde), mov.kg, -1);
    const colocado = mover(mov.hacia ? duenoDeLote.get(mov.hacia) : undefined, mov.kg, 1);
    if (!colocado) kgLiberados += mov.kg.kg_total ?? 0;
  }

  const filas = [...porClave.values()]
    .map((f) => ({
      ...f,
      pct_exportacion: f.kg_total > 0 ? (f.kg_exportacion / f.kg_total) * 100 : null,
    }))
    // Un productor que se queda a cero tras el reparto no tenía nada suyo.
    .filter((f) => f.kg_total > 0.5)
    .sort((a, b) => b.kg_total - a.kg_total);

  return {
    productores: filas.filter(esProductorReal),
    noProductores: filas.filter((f) => !esProductorReal(f)),
    kgLiberados,
    pasadasRepartidas,
    cola,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Reparto CANÓNICO (servidor). Lo que la edge function reparto-pasadas escribe
// en calibrador_pasada_reparto y calibrador_pasada_sin_repartir (07-09-2026).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Mismo criterio que la RPC calibrador_capacidad_lotes: dos grupos de 8 dígitos
 * en el nombre = pasada compuesta, y su kg NO está en `kgAtribuidoSimple`. Se
 * usa aquí para saber qué pasadas hay que descontar del pendiente a mano.
 */
export function esNombreCompuesto(texto: string | null | undefined): boolean {
  return /\d{8}.*\d{8}/.test(String(texto ?? ""));
}

export type MetodoReparto = "manual" | "box" | "capacidad";

/** Lo mínimo de una pasada para repartirla. */
export interface PasadaReparto {
  /** > 0: pasada del volcado SQL (calibrador_batch). < 0: informe Word de lote (calibrador_informe). */
  batch_id: number;
  /** El nombre crudo tal como lo escribió el operario. */
  batch_name: string;
  /** Primer código de 8 dígitos del nombre: el que hoy recibe TODA la pasada. */
  lote: string;
  /** Fecha de la pasada (Madrid), ISO. */
  fecha: string;
  kg_total: number;
}

/** Las líneas de pasada_box_lineas que una persona tecleó para UNA pasada, ya casadas con su batch_id. */
export interface DesgloseManual {
  batch_id: number;
  lineas: LineaDesglose[];
}

export interface EntradaRepartoPasadas {
  pasadas: PasadaReparto[];
  /** Capacidad por lote (clave: código de 8 dígitos), tal como la da calibrador_capacidad_lotes. */
  capacidad: Map<string, CapacidadLote>;
  desglosesManuales: DesgloseManual[];
}

/** Una fila de calibrador_pasada_reparto. */
export interface FilaReparto {
  batch_id: number;
  /** Código de 8 dígitos que RECIBE kg. */
  lote8: string;
  /** Parte de la pasada que se lleva. Las fracciones de una pasada suman 1. */
  fraccion: number;
  /** fraccion × kg de la pasada, informativo. */
  kg: number;
  metodo: MetodoReparto;
  /** Posición del código en el nombre (1 = el primero). Los que no están en el nombre van detrás. */
  orden: number;
}

/** Una fila de calibrador_pasada_sin_repartir. */
export interface PasadaSinRepartir {
  batch_id: number;
  batch_name: string;
  fecha: string;
  kg_total: number;
  /** Por qué no se ha repartido sola. Se enseña tal cual. */
  motivo: string;
}

export interface ResumenRepartoPasadas {
  /** Pasadas que entraron a decidir. */
  pasadas: number;
  repartidas: Record<MetodoReparto, number>;
  /** Kg que salen del primer código hacia otros lotes nombrados. */
  kgMovidos: number;
  enCola: number;
}

export interface ResultadoRepartoPasadas {
  filas: FilaReparto[];
  sinRepartir: PasadaSinRepartir[];
  resumen: ResumenRepartoPasadas;
}

/** Fracciones por debajo de esto son ruido de coma flotante, no un reparto. */
const FRACCION_MINIMA = 1e-9;

/** La misma precisión con la que el calibrador da sus kg (4 decimales). */
const redondearKg = (kg: number): number => Math.round(kg * 1e4) / 1e4;

/**
 * Las funciones de arriba trabajan con los kg por destino; para el reparto
 * canónico solo importa el total, porque la vista multiplica CADA fila de la
 * pasada por la fracción y con ella viajan todos los destinos a la vez.
 */
function comoPasadaConDesglose(p: PasadaReparto): PasadaConDesglose {
  return {
    batch_id: p.batch_id, batch_name: p.batch_name, lote: p.lote, fecha: p.fecha,
    kg_total: p.kg_total, kg_exportacion: 0, kg_no_exportacion: 0, kg_industria: 0, kg_mujeres: 0, kg_otros: 0,
  };
}

/**
 * Kg por código atribuido de un desglose por box (manual o el del nombre).
 * El reciclaje y los precalibrados sin resolver no atribuyen a nadie: sus kg
 * se quedan con el primer código (la vista tiene que conservar el total).
 * Las líneas sin box pesan 0, como en `repartirPasadaPorBox`: nunca se les
 * inventa un reparto.
 */
function kgPorCodigoDesdeLineas(kgTotal: number, lineas: LineaDesglose[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const l of repartirPasadaPorBox(kgTotal, lineas).lineas) {
    if (!l.codigoAtribuido || l.kg <= 0) continue;
    out.set(l.codigoAtribuido, (out.get(l.codigoAtribuido) ?? 0) + l.kg);
  }
  return out;
}

/** Posición (1..n) de cada código en el nombre; los que no aparecen, detrás y en el orden dado. */
function ordenDeCodigos(p: PasadaReparto, codigos: Iterable<string>): Map<string, number> {
  const orden = new Map<string, number>();
  orden.set(p.lote, 1);
  for (const c of codigosDelNombre(p.batch_name)) if (!orden.has(c)) orden.set(c, orden.size + 1);
  for (const c of codigos) if (!orden.has(c)) orden.set(c, orden.size + 1);
  return orden;
}

/**
 * Convierte "kg por código" en filas cuyas fracciones suman EXACTAMENTE 1: los
 * otros códigos se llevan lo suyo y el primero se queda el resto (lo que le
 * tocaba, más el reciclaje y lo que no cupo en nadie). Devuelve null si ningún
 * otro código recibe nada: entonces la pasada no cambia y no hay fila que
 * escribir (sin filas = 100 % al primero).
 */
function filasDesdeKg(p: PasadaReparto, kgPorCodigo: Map<string, number>, metodo: MetodoReparto): FilaReparto[] | null {
  const orden = ordenDeCodigos(p, kgPorCodigo.keys());
  const otros: FilaReparto[] = [];
  let sumaOtros = 0;
  for (const [codigo, kg] of kgPorCodigo) {
    if (codigo === p.lote) continue;
    const fraccion = Math.min(1, kg / p.kg_total);
    if (fraccion <= FRACCION_MINIMA) continue;
    otros.push({ batch_id: p.batch_id, lote8: codigo, fraccion, kg: redondearKg(kg), metodo, orden: orden.get(codigo) ?? 99 });
    sumaOtros += fraccion;
  }
  if (otros.length === 0) return null;

  // Los repartos de origen nunca dan más kg de los que tiene la pasada; si la
  // coma flotante lo rozara, se recorta a escala para que la suma sea 1 y nunca
  // se invente un gramo.
  if (sumaOtros > 1) {
    for (const f of otros) {
      f.fraccion /= sumaOtros;
      f.kg = redondearKg(f.fraccion * p.kg_total);
    }
    sumaOtros = 1;
  }
  const restoPrimero = 1 - sumaOtros;
  const filas = [...otros];
  if (restoPrimero > FRACCION_MINIMA) {
    filas.push({ batch_id: p.batch_id, lote8: p.lote, fraccion: restoPrimero, kg: redondearKg(restoPrimero * p.kg_total), metodo, orden: 1 });
  }
  return filas.sort((a, b) => a.orden - b.orden);
}

/** Por qué el reparto por capacidad no movió nada en esta pasada, con palabras. */
function explicarCapacidad(p: PasadaReparto, d: DetalleCapacidadPasada | undefined): string {
  if (!d) return "sin datos de capacidad";
  const otros = codigosDelNombre(p.batch_name).filter((c) => c !== p.lote);
  const partes: string[] = [];
  const primero = d.absorbido.find((a) => a.codigo === p.lote);
  if (primero && primero.kg >= p.kg_total - 0.5) {
    partes.push(`el primer lote (${p.lote}) aun tenia hueco para toda la pasada`);
  } else if (primero) {
    partes.push(`el primer lote (${p.lote}) absorbe ${Math.round(primero.kg)} kg`);
  }
  const sinEntrada = otros.filter((c) => d.sinEntrada.includes(c));
  if (sinEntrada.length > 0) partes.push(`sin entrada de bascula: ${sinEntrada.join(", ")}`);
  const llenos = otros.filter((c) => !d.sinEntrada.includes(c) && !d.absorbido.some((a) => a.codigo === c));
  if (llenos.length > 0) partes.push(`ya completos: ${llenos.join(", ")}`);
  if (d.kgSinColocar > 0.5) {
    partes.push(`${Math.round(d.kgSinColocar)} kg no caben en ningun lote nombrado y se quedan en el primero`);
  }
  return partes.join("; ") || "ningun otro lote nombrado recibe nada";
}

/**
 * El reparto canónico de TODAS las pasadas candidatas, de una vez.
 *
 * PRECEDENCIA, por pasada:
 *   1. Desglose MANUAL (pasada_box_lineas): lo tecleó una persona, manda. Se
 *      aplica tal cual con `repartirPasadaPorBox`, como hace la conciliación de
 *      la app (expandirPasadaPorDesglose). Si solo atribuye al primer código se
 *      escribe una única fila con fracción 1: la pasada queda igual, pero consta
 *      que la resolvió una persona. Si no atribuye nada (líneas sin box, solo
 *      reciclaje o PREC sin resolver) es como si no existiera y se sigue.
 *   2. BOX escritos en el nombre (`repartirPasada`): solo si todas las líneas
 *      traen box y no hay PREC por fecha.
 *   3. CAPACIDAD pendiente (`repartirPorCapacidad`), solo para las que nombran
 *      dos lotes distintos o más. Se ejecuta UNA vez con todas, en orden
 *      cronológico, porque comparten el pendiente de cada lote.
 *   4. COLA: lo que queda, con el motivo del paso que lo rechazó (los textos de
 *      `repartirPasada`) y, si llegó a capacidad, por qué tampoco ahí.
 *
 * LAS FRACCIONES DE UNA PASADA SUMAN 1: los otros códigos reciben lo suyo y el
 * primero se queda el resto — lo que le tocaba, el reciclaje/descarte (que en
 * pantalla se "liberaba") y lo que no cabe en ningún lote nombrado. Así la
 * vista conserva los kg totales del día.
 *
 * CAPACIDAD Y CERTEZA. `kgAtribuidoSimple` (RPC calibrador_capacidad_lotes)
 * deja fuera a TODAS las pasadas de nombre compuesto, porque son justo lo que
 * se va a redistribuir. Pero lo que aquí se resuelve por manual o por box, o se
 * encola entero en el primero, ya no está en discusión: se descuenta del
 * pendiente ANTES de la fase por capacidad, para no dar a un lote un hueco que
 * en realidad ya está ocupado.
 *
 * Función pura: no lee nada, no escribe nada. Determinista para la misma entrada.
 */
export function calcularRepartoPasadas(entrada: EntradaRepartoPasadas): ResultadoRepartoPasadas {
  const pasadas = [...entrada.pasadas].sort((a, b) =>
    a.fecha.localeCompare(b.fecha) || a.batch_id - b.batch_id);

  const manualPorPasada = new Map<number, LineaDesglose[]>();
  for (const d of entrada.desglosesManuales) if (d.lineas.length > 0) manualPorPasada.set(d.batch_id, d.lineas);

  // Copia de trabajo de la capacidad: se le descuenta lo que queda decidido
  // antes de la fase 3 (ver cabecera). No se muta lo que nos dan.
  const capacidad = new Map<string, CapacidadLote>();
  for (const [lote, c] of entrada.capacidad) capacidad.set(lote, { ...c });
  const descontar = (codigo: string, kg: number) => {
    const c = capacidad.get(codigo);
    if (c) c.kgAtribuidoSimple += kg;
  };

  const filas: FilaReparto[] = [];
  const sinRepartir: PasadaSinRepartir[] = [];
  const repartidas: Record<MetodoReparto, number> = { manual: 0, box: 0, capacidad: 0 };
  let kgMovidos = 0;

  const anotar = (p: PasadaReparto, nuevas: FilaReparto[], metodo: MetodoReparto, descontarCapacidad: boolean) => {
    filas.push(...nuevas);
    repartidas[metodo] += 1;
    for (const f of nuevas) {
      if (f.lote8 !== p.lote) kgMovidos += f.kg;
      if (descontarCapacidad && esNombreCompuesto(p.batch_name)) descontar(f.lote8, f.kg);
    }
  };
  const encolar = (p: PasadaReparto, motivo: string, descontarCapacidad: boolean) => {
    sinRepartir.push({ batch_id: p.batch_id, batch_name: p.batch_name, fecha: p.fecha, kg_total: p.kg_total, motivo });
    // Se queda entera en el primero: eso tampoco se discute ya.
    if (descontarCapacidad && esNombreCompuesto(p.batch_name)) descontar(p.lote, p.kg_total);
  };

  const paraCapacidad: Array<{ pasada: PasadaReparto; motivo: string }> = [];

  for (const p of pasadas) {
    if (!/^\d{8}$/.test(p.lote)) {
      encolar(p, "sin codigo de lote de 8 digitos que reciba la pasada", false);
      continue;
    }
    if (!(p.kg_total > 0)) {
      encolar(p, "la pasada no tiene kilos", true);
      continue;
    }

    // 1) Manual.
    let notaManual = "";
    const manual = manualPorPasada.get(p.batch_id);
    if (manual) {
      const kgPorCodigo = kgPorCodigoDesdeLineas(p.kg_total, manual);
      const kgAtribuido = [...kgPorCodigo.values()].reduce((s, kg) => s + kg, 0);
      if (kgAtribuido > 0) {
        const nuevas = filasDesdeKg(p, kgPorCodigo, "manual")
          // Todo al primero: fila única con fracción 1, para que conste la decisión.
          ?? [{ batch_id: p.batch_id, lote8: p.lote, fraccion: 1, kg: redondearKg(p.kg_total), metodo: "manual" as const, orden: 1 }];
        anotar(p, nuevas, "manual", true);
        continue;
      }
      notaManual = "el desglose manual no atribuye kg a ningun lote (lineas sin box, o solo reciclaje/PREC sin resolver); ";
    }

    // 2) Box escritos en el nombre.
    const r = repartirPasada(comoPasadaConDesglose(p));
    let motivo: string;
    if (r.estado === "repartida") {
      const kgPorCodigo = new Map<string, number>();
      for (const m of r.movimientos) {
        if (!m.hacia) continue;   // reciclaje/descarte: se queda en el primero
        kgPorCodigo.set(m.hacia, (kgPorCodigo.get(m.hacia) ?? 0) + (m.kg.kg_total ?? 0));
      }
      const nuevas = filasDesdeKg(p, kgPorCodigo, "box");
      if (nuevas) {
        anotar(p, nuevas, "box", true);
        continue;
      }
      motivo = "el reparto por box deja todo en el primer codigo (el reciclaje o descarte no se atribuye a nadie)";
    } else {
      motivo = r.cola?.motivo ?? "no se puede repartir";
    }
    motivo = notaManual + motivo;

    // 3) Capacidad, solo si nombra dos lotes distintos o más.
    if (codigosDelNombre(p.batch_name).length >= 2) paraCapacidad.push({ pasada: p, motivo });
    else encolar(p, motivo, true);
  }

  // 3) Capacidad, de una sola vez: comparten el pendiente y se gasta en orden.
  if (paraCapacidad.length > 0) {
    const porCap = repartirPorCapacidad(paraCapacidad.map((x) => comoPasadaConDesglose(x.pasada)), capacidad);
    const kgPorPasada = new Map<number, Map<string, number>>();
    for (const m of porCap.movimientos) {
      if (!m.hacia) continue;
      const mapa = kgPorPasada.get(m.batch_id) ?? new Map<string, number>();
      mapa.set(m.hacia, (mapa.get(m.hacia) ?? 0) + (m.kg.kg_total ?? 0));
      kgPorPasada.set(m.batch_id, mapa);
    }
    const detallePorPasada = new Map(porCap.porPasada.map((d) => [d.batch_id, d]));
    for (const { pasada, motivo } of paraCapacidad) {
      const kgPorCodigo = kgPorPasada.get(pasada.batch_id);
      const nuevas = kgPorCodigo ? filasDesdeKg(pasada, kgPorCodigo, "capacidad") : null;
      if (nuevas) anotar(pasada, nuevas, "capacidad", false);
      else encolar(pasada, `${motivo}; por capacidad: ${explicarCapacidad(pasada, detallePorPasada.get(pasada.batch_id))}`, false);
    }
  }

  return {
    filas,
    sinRepartir,
    resumen: {
      pasadas: pasadas.length,
      repartidas,
      kgMovidos: redondearKg(kgMovidos),
      enCola: sinRepartir.length,
    },
  };
}

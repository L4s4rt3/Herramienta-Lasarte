/**
 * calibradorReparto.ts — reparte entre sus productores las pasadas del
 * calibrador cuyo nombre dice que se echó más de un lote.
 *
 * EL PROBLEMA. El Sizer atribuye TODA la pasada al primer código que encuentra
 * en el BatchName, pero el operario escribe ahí lo que echó de verdad:
 * "26013107+26012608", "26051904 +7 BOX DE RECICLAJE". Son 114 pasadas y
 * 1.953.320 kg — el 8,9% de la campaña 25/26 — atribuidos enteros a un solo
 * productor cuando la fruta era de varios.
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
 * NO PERSISTE NADA. El reparto se deriva en cada lectura, como manda la regla
 * de oro de docs/TRAZABILIDAD_REFUNDACION.md: los estados no se guardan.
 *
 * LOS KILOS DE RECICLAJE SALEN DE LA ATRIBUCIÓN, no se le regalan a nadie: el
 * reciclado es incasable por naturaleza (regla del dueño 04-08-2026) y su parte
 * pasa a contarse como "sin productor", que ya es una cifra visible en pantalla.
 */
import {
  parsearDesgloseTexto,
  repartirPasadaPorBox,
  type LineaDesglose,
} from "@/lib/desgloseBox";
import {
  esAgricultorMovimientoInterno,
  esEntradaPrecalibrado,
  esProductorPrecalibrado,
} from "@/lib/productoresCanonicos";

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

export interface RepartoPorCapacidad {
  movimientos: Movimiento[];
  pasadasRepartidas: number;
  /** Kg que ningún lote nombrado podía absorber: se quedan en el primero. */
  kgSinColocar: number;
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
  let pasadasRepartidas = 0;
  let kgSinColocar = 0;

  for (const pasada of orden) {
    const codigos = codigosDelNombre(pasada.batch_name);
    if (codigos.length < 2) continue;

    let restante = pasada.kg_total;
    let movidoAqui = 0;
    for (const codigo of codigos) {
      if (restante <= 0) break;
      const hueco = pendiente.get(codigo);
      if (hueco == null || hueco <= 0) continue;      // sin entrada de báscula, o lleno
      const absorbe = Math.min(restante, hueco);
      pendiente.set(codigo, hueco - absorbe);
      restante -= absorbe;
      if (codigo === pasada.lote) continue;           // ya estaba ahí

      const fraccion = absorbe / pasada.kg_total;
      const kg: Partial<Record<Grupo, number>> = {};
      for (const g of GRUPOS) kg[g] = (pasada[g] ?? 0) * fraccion;
      movimientos.push({ batch_id: pasada.batch_id, desde: pasada.lote, hacia: codigo, kg });
      movidoAqui += absorbe;
    }
    if (movidoAqui > 0) pasadasRepartidas += 1;
    kgSinColocar += Math.max(0, restante);
  }

  return { movimientos, pasadasRepartidas, kgSinColocar };
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

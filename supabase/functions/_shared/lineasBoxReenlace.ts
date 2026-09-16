/**
 * lineasBoxReenlace.ts — conservar los desgloses manuales por box cuando el
 * análisis del parte borra y vuelve a insertar `lotes_dia`.
 *
 * POR QUÉ. `pasada_box_lineas` (el desglose que una persona teclea: tantos box
 * de tal lote, tantos de reciclaje…) cuelga de `lotes_dia.id` con ON DELETE
 * CASCADE. La edge `analizar-parte` limpia las filas `source = 'ia'` de
 * `lotes_dia` y las reinserta con IDs nuevos cada vez que llega un informe:
 * el 14-09-2026 eso borró el reparto manual grabado el 11-09 y el reparto
 * automático volvió a cargar 4.023 kg enteros al primer lote. Aquí está la
 * lógica pura (sin red) para: guardar las líneas antes de borrar, emparejar
 * cada fila vieja de `lotes_dia` con su fila nueva y recolocar las líneas.
 *
 * EMPAREJAMIENTO, por orden:
 *   1. mismo título del lote (sin espacios repetidos, sin mayúsculas);
 *   2. mismo código base de 8 dígitos y kg iguales (±1 %, que es el redondeo
 *      entre un informe y su reenvío);
 *   3. mismo código base y es la ÚNICA fila nueva con ese código;
 *   4. mismo código base y kg más cercano dentro de ±10 %.
 * Si nada casa, la línea no se recoloca y se devuelve en `sinDestino` para
 * avisar: recolocarla a ciegas sería inventarse a qué pasada pertenece.
 */

export interface LoteDiaMin {
  id: string;
  lote_codigo: string | null;
  kg_peso_total: number | string | null;
}

export interface LineaBoxGuardada {
  user_id: string;
  lote_dia_id: string;
  posicion: number;
  tipo: string;
  lote_codigo: string | null;
  prec_fecha: string | null;
  box: number | string | null;
  box_tamano: string;
  nota: string | null;
}

export interface LineaBoxRecolocada {
  user_id: string;
  lote_dia_id: string;
  posicion: number;
  tipo: string;
  lote_codigo: string | null;
  prec_fecha: string | null;
  box: number | string | null;
  box_tamano: string;
  nota: string | null;
}

export interface ResultadoReenlace {
  /** Filas listas para insertar en pasada_box_lineas, ya con el lote_dia_id nuevo. */
  filas: LineaBoxRecolocada[];
  /** Filas viejas de lotes_dia que tenían líneas y no han encontrado fila nueva. */
  sinDestino: Array<{ lote_dia_id: string; lote_codigo: string | null; lineas: number }>;
  /** Cuántas filas viejas se han emparejado. */
  emparejados: number;
}

const TOLERANCIA_IGUAL = 0.01;
const TOLERANCIA_CERCANO = 0.10;

export function normalizarTituloLote(v: string | null | undefined): string {
  return String(v ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

export function codigoBase8(v: string | null | undefined): string | null {
  const m = /(\d{8})/.exec(String(v ?? ""));
  return m ? m[1] : null;
}

const kgDe = (l: LoteDiaMin) => Number(l.kg_peso_total) || 0;

function difRelativa(a: number, b: number): number {
  const base = Math.max(Math.abs(a), Math.abs(b));
  return base === 0 ? 0 : Math.abs(a - b) / base;
}

/**
 * Empareja cada fila vieja con una nueva. Una fila nueva solo se usa una vez.
 * Devuelve Map idViejo → idNuevo (o null si no hay pareja).
 */
export function emparejarLotesDia(previos: LoteDiaMin[], nuevos: LoteDiaMin[]): Map<string, string | null> {
  const libres = new Set(nuevos.map((n) => n.id));
  const resultado = new Map<string, string | null>();
  const tomar = (viejo: LoteDiaMin, nuevo: LoteDiaMin | undefined) => {
    if (!nuevo) return false;
    libres.delete(nuevo.id);
    resultado.set(viejo.id, nuevo.id);
    return true;
  };
  const candidatos = () => nuevos.filter((n) => libres.has(n.id));

  // 1. título exacto
  for (const v of previos) {
    const t = normalizarTituloLote(v.lote_codigo);
    if (!t) continue;
    tomar(v, candidatos().find((n) => normalizarTituloLote(n.lote_codigo) === t));
  }
  // 2-4. código base
  for (const v of previos) {
    if (resultado.has(v.id)) continue;
    const base = codigoBase8(v.lote_codigo);
    if (!base) { resultado.set(v.id, null); continue; }
    const mismos = candidatos().filter((n) => codigoBase8(n.lote_codigo) === base);
    const kgV = kgDe(v);
    const iguales = mismos.filter((n) => difRelativa(kgDe(n), kgV) <= TOLERANCIA_IGUAL);
    if (tomar(v, iguales[0])) continue;
    if (mismos.length === 1 && tomar(v, mismos[0])) continue;
    const cercanos = mismos
      .filter((n) => difRelativa(kgDe(n), kgV) <= TOLERANCIA_CERCANO)
      .sort((a, b) => difRelativa(kgDe(a), kgV) - difRelativa(kgDe(b), kgV));
    if (tomar(v, cercanos[0])) continue;
    resultado.set(v.id, null);
  }
  return resultado;
}

/** Recoloca las líneas guardadas sobre las filas nuevas según el emparejamiento. */
export function recolocarLineasBox(
  lineas: LineaBoxGuardada[],
  previos: LoteDiaMin[],
  nuevos: LoteDiaMin[],
): ResultadoReenlace {
  if (lineas.length === 0) return { filas: [], sinDestino: [], emparejados: 0 };
  const conLineas = new Set(lineas.map((l) => l.lote_dia_id));
  const previosConLineas = previos.filter((p) => conLineas.has(p.id));
  const mapa = emparejarLotesDia(previosConLineas, nuevos);
  const filas: LineaBoxRecolocada[] = [];
  const sinDestino: ResultadoReenlace["sinDestino"] = [];
  let emparejados = 0;
  for (const p of previosConLineas) {
    const destino = mapa.get(p.id) ?? null;
    const suyas = lineas.filter((l) => l.lote_dia_id === p.id);
    if (!destino) { sinDestino.push({ lote_dia_id: p.id, lote_codigo: p.lote_codigo, lineas: suyas.length }); continue; }
    emparejados += 1;
    for (const l of suyas) {
      filas.push({
        user_id: l.user_id, lote_dia_id: destino, posicion: Number(l.posicion), tipo: l.tipo,
        lote_codigo: l.lote_codigo ?? null, prec_fecha: l.prec_fecha ?? null, box: l.box ?? null,
        box_tamano: l.box_tamano ?? "grande", nota: l.nota ?? null,
      });
    }
  }
  return { filas, sinDestino, emparejados };
}

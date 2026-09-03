/**
 * aprovechamientoReal.ts — aprovechamiento REAL (medido, no estimado) de un
 * conjunto de lotes: una parcela, una finca, un productor.
 *
 * POR QUÉ EXISTE (03-09-2026). Era scripts/informe-aprovechamiento-invermarmelo.ts,
 * un Excel clavado a dos parcelas de un productor. Dirección lo quería para
 * cualquier parcela, así que el cálculo vive aquí y lo comparten la vista
 * "Aprovechamiento real por parcela" (Análisis → Por productor) y el script.
 *
 * ─── Por qué esto SÍ puede decir "real" ──────────────────────────────────────
 * El análisis de campaña (mermaMdnaAgregado.ts) tiene que ESTIMAR el destino de
 * la fruta de cada productor: toma el mix del Informe LOTE y lo aplica a los kg
 * conciliados, porque el calibrador atribuye cada pasada al primer código de su
 * nombre y muchas pasadas mezclan lotes. Aquí no se estima nada: cada kg que
 * clasificó la máquina se atribuye al lote de su pasada. Eso solo vale si
 * NINGUNA pasada de los lotes analizados nombra dos códigos — se comprueba
 * (pasadasCompuestas) y se enseña, no se supone.
 *
 * ─── La base de los porcentajes, y por qué NO es la entrada de báscula ───────
 * El calibrador pesa sistemáticamente MÁS que la báscula (+7,80 % en los 904
 * lotes de la campaña con volcado). No es fruta de otro sitio: es desfase de
 * tara/calibración entre las dos básculas. Por eso los porcentajes van sobre
 * los KG QUE PESÓ LA MÁQUINA, que es lo único medido de punta a punta; la
 * entrada de báscula se enseña al lado para que el desfase se vea, nunca
 * mezclada en el mismo porcentaje.
 *
 * ─── Cobertura: lo que no está, se dice ──────────────────────────────────────
 * Los lotes sin ninguna pasada no se rellenan ni se prorratean: se listan uno a
 * uno con su motivo (sigue en cámara confirmada a pie, entrada que es ajuste de
 * stock, cerrado sin registro, o PROCESADO según el parte pero sin volcado
 * todavía). Aprendido a la mala el 18-08-2026: un informe dijo que un lote
 * "seguía en cámara" cuando llevaba cuatro días procesado, porque el volcado
 * del Sizer estaba parado y nada lo decía. Por eso la frescura de cada fuente
 * va en cabecera y se cruza con los partes diarios.
 *
 * ─── Las fuentes ─────────────────────────────────────────────────────────────
 * Las filas llegan de la vista canónica clasificacion_lote (o de su
 * materializada clasificacion_lote_detalle_mv), que ya aplica la regla POR LOTE
 * Y DÍA: si ese lote-día está en el volcado SQL, manda el SQL (trae TODAS las
 * pasadas del día); si no, entra el Word de lote (solo la última pasada del
 * día); y si tampoco, el Excel manual del Informe LOTE. Cada kg lleva su fuente
 * y aquí se cuenta cuántos vienen de cada una: un dato de respaldo no se
 * presenta como si fuera el canónico.
 */
import { normalizarLoteCodigo } from "./loteCodigo.ts";
import {
  claseCanonica,
  destinoNormalizado,
  esClaseAptaMdna,
  letraClase,
  METODOS_MDNA,
  metodoMdnaDeProducto,
  type MetodoMdna,
} from "./mdnaMix.ts";

const num = (v: unknown): number => Number(v) || 0;
const pctDe = (parte: number, total: number): number | null => (total > 0 ? (parte / total) * 100 : null);
const fmtKg = (n: number): string => Math.round(n).toLocaleString("es-ES");
const maxONull = (xs: Array<string | null | undefined>): string | null =>
  xs.filter((x): x is string => Boolean(x)).sort().at(-1) ?? null;

/** Código de 8 dígitos del lote (misma regla que el resto del motor). */
export const lote8De = (v: string | null | undefined): string | null => normalizarLoteCodigo(v);

// ─── Filas y acumulado ───────────────────────────────────────────────────────

/**
 * Una fila del detalle del calibrador tal y como la dan la vista canónica o su
 * materializada: una pasada × producto × clase × calibre. `destino` puede venir
 * crudo (grupo_destino) o ya normalizado; `nombrePasada` es el código tal y
 * como lo tecleó el operario ("26081302-12 BOX + 26081202-9 BOX" existe).
 */
export interface FilaDetalleReal {
  lote8: string;
  fecha: string | null;
  /** batch_id del Sizer (>0 volcado SQL, <0 Word), null en el Excel manual. */
  batchId: number | null;
  /** "calibrador" | "docx" | "parte". */
  fuente: string | null;
  nombrePasada: string | null;
  producto: string | null;
  clase: string | null;
  destino: string | null;
  tamano: string | null;
  kg: number | string | null;
}

export interface ClaseAcumulada {
  kg: number;
  destino: string;
  apta: boolean;
  letra: string | null;
}

export interface AcumuladoReal {
  /** Kg que pesó el calibrador: LA BASE de todos los porcentajes. */
  kgSizer: number;
  /** De los kgSizer, los que salen del Word de lote (respaldo) o del Excel manual. */
  kgDocx: number;
  kgParte: number;
  pasadas: number;
  pasadasDocx: number;
  pasadasParte: number;
  porDestino: Map<string, number>;
  porClase: Map<string, ClaseAcumulada>;
  /** Kg de clases aptas para Mercadona por calibre (tamaño del Sizer). */
  porCalibreApta: Map<string, number>;
  mdna: Record<MetodoMdna, number>;
  mdnaSinFormato: number;
  mdnaTotal: number;
  kgApta: number;
}

export function acumuladoRealVacio(): AcumuladoReal {
  return {
    kgSizer: 0, kgDocx: 0, kgParte: 0, pasadas: 0, pasadasDocx: 0, pasadasParte: 0,
    porDestino: new Map(), porClase: new Map(), porCalibreApta: new Map(),
    mdna: { MA3KGC: 0, MA4KGC: 0, MA5KGC: 0, MA12KGC: 0 }, mdnaSinFormato: 0, mdnaTotal: 0, kgApta: 0,
  };
}

/** Identidad de una pasada: su batch_id; el Excel manual no lo tiene y se identifica por nombre y día. */
export function clavePasada(f: Pick<FilaDetalleReal, "batchId" | "fuente" | "nombrePasada" | "fecha">): string {
  return f.batchId != null ? `b${f.batchId}` : `${f.fuente ?? "?"}|${f.nombrePasada ?? ""}|${f.fecha ?? ""}`;
}

/**
 * Acumula las filas por la clave que se quiera (parcela, lote, finca…). Las
 * filas cuya clave sea null/undefined se ignoran. Las pasadas se cuentan una
 * vez por clave aunque tengan cientos de filas.
 */
export function acumularDetalleReal<K extends string>(
  filas: Iterable<FilaDetalleReal>,
  claveDe: (f: FilaDetalleReal) => K | null | undefined,
): Map<K, AcumuladoReal> {
  const out = new Map<K, AcumuladoReal>();
  const pasadasVistas = new Map<K, Set<string>>();
  const metodoPorProducto = new Map<string, MetodoMdna | "SIN_FORMATO" | null>();
  for (const f of filas) {
    const k = claveDe(f);
    if (!k) continue;
    let acc = out.get(k);
    if (!acc) {
      acc = acumuladoRealVacio();
      out.set(k, acc);
      pasadasVistas.set(k, new Set());
    }
    const esDocx = f.fuente === "docx";
    const esParte = f.fuente === "parte";
    const vistas = pasadasVistas.get(k)!;
    const cp = clavePasada(f);
    if (!vistas.has(cp)) {
      vistas.add(cp);
      acc.pasadas += 1;
      if (esDocx) acc.pasadasDocx += 1;
      if (esParte) acc.pasadasParte += 1;
    }

    const kg = num(f.kg);
    const clase = claseCanonica(f.clase) || "(SIN CLASE)";
    const destino = destinoNormalizado(f.destino, f.clase);
    const apta = esClaseAptaMdna(f.clase);
    const calibre = String(f.tamano ?? "").trim() || "—";

    acc.kgSizer += kg;
    if (esDocx) acc.kgDocx += kg;
    if (esParte) acc.kgParte += kg;
    acc.porDestino.set(destino, (acc.porDestino.get(destino) ?? 0) + kg);
    const ent = acc.porClase.get(clase) ?? { kg: 0, destino, apta, letra: letraClase(f.clase) };
    ent.kg += kg;
    acc.porClase.set(clase, ent);
    if (apta) {
      acc.kgApta += kg;
      acc.porCalibreApta.set(calibre, (acc.porCalibreApta.get(calibre) ?? 0) + kg);
    }

    const producto = f.producto ?? "";
    let metodo = metodoPorProducto.get(producto);
    if (metodo === undefined) {
      metodo = metodoMdnaDeProducto(producto);
      metodoPorProducto.set(producto, metodo);
    }
    if (metodo === "SIN_FORMATO") {
      acc.mdnaSinFormato += kg;
      acc.mdnaTotal += kg;
    } else if (metodo) {
      acc.mdna[metodo] += kg;
      acc.mdnaTotal += kg;
    }
  }
  return out;
}

export interface PasadaCompuesta {
  clave: string;
  lote8: string;
  nombre: string;
  fuente: string;
}

/**
 * Las pasadas que nombran MÁS DE UN lote: si hay alguna, sus kg no son
 * atribuibles y el análisis deja de poder llamarse "real" para esos lotes.
 * El nombre lo escribe el operario en todas las fuentes, así que se miran igual.
 */
export function pasadasCompuestas(filas: Iterable<FilaDetalleReal>): PasadaCompuesta[] {
  const vistas = new Map<string, PasadaCompuesta>();
  for (const f of filas) {
    const clave = clavePasada(f);
    if (vistas.has(clave)) continue;
    const nombre = String(f.nombrePasada ?? "");
    if ((nombre.match(/\d{8}/g) ?? []).length > 1) {
      vistas.set(clave, { clave, lote8: f.lote8, nombre, fuente: f.fuente ?? "?" });
    }
  }
  return [...vistas.values()];
}

// ─── Frescura de las fuentes ─────────────────────────────────────────────────

export interface FrescuraFuentes {
  /** Día (YYYY-MM-DD) de la última pasada en el volcado SQL del Sizer. */
  ultimaPasadaSizer: string | null;
  ultimaSincronizacion: string | null;
  ultimoInformeDocx: string | null;
  ultimoParte: string | null;
  /** Los partes diarios llegan más allá del volcado: lo procesado después entra por el Word o no entra. */
  volcadoAtrasado: boolean;
}

export function frescuraFuentes(x: {
  ultimaPasadaSql?: string | null;
  ultimaSincronizacion?: string | null;
  ultimoDocx?: string | null;
  ultimoParte?: string | null;
}): FrescuraFuentes {
  const dia = (v: string | null | undefined) => (v ? String(v).slice(0, 10) : null);
  const ultimaPasadaSizer = dia(x.ultimaPasadaSql);
  const ultimoParte = dia(x.ultimoParte);
  return {
    ultimaPasadaSizer,
    ultimaSincronizacion: dia(x.ultimaSincronizacion),
    ultimoInformeDocx: dia(x.ultimoDocx),
    ultimoParte,
    volcadoAtrasado: Boolean(ultimaPasadaSizer && ultimoParte && ultimoParte > ultimaPasadaSizer),
  };
}

// ─── Cobertura: cada lote, con dato o con motivo ─────────────────────────────

export interface EntradaReal {
  lote: string;
  fecha: string;
  parcela: string | null;
  kgEntrada: number;
  kgAjuste: number;
  cerradoAt: string | null;
  camaraConfirmadaNombre: string | null;
  camaraConfirmadaFecha: string | null;
}

export interface PasadaParteReal {
  fecha: string | null;
  kg: number;
  codigo: string;
}

/**
 * Las pasadas del parte diario que NOMBRAN cada lote de interés, en cualquier
 * posición del código (mismo criterio que el resto del motor: nunca por LIKE).
 * El parte llega antes que el volcado del Sizer: es lo que destapa un lote ya
 * procesado cuyo desglose todavía no ha volcado.
 */
export function pasadasDelPartePorLote(
  lotesDia: Iterable<{ lote_codigo: string | null; kg_peso_total: number | string | null; part_id?: string | null; fecha?: string | null }>,
  fechaPorParte: Map<string, string | null>,
  lotesInteres: Set<string>,
): Map<string, PasadaParteReal[]> {
  const out = new Map<string, PasadaParteReal[]>();
  for (const p of lotesDia) {
    const codigo = String(p.lote_codigo ?? "");
    for (const m of codigo.matchAll(/\d{8}/g)) {
      if (!lotesInteres.has(m[0])) continue;
      const arr = out.get(m[0]) ?? [];
      arr.push({ fecha: p.fecha ?? (p.part_id ? fechaPorParte.get(p.part_id) ?? null : null), kg: num(p.kg_peso_total), codigo });
      out.set(m[0], arr);
    }
  }
  return out;
}

export type EstadoDatoReal = "sql" | "respaldo" | "mixto" | "pendiente_volcado" | "sin_dato";

export const LABEL_ESTADO_DATO: Record<EstadoDatoReal, string> = {
  sql: "SÍ",
  respaldo: "SÍ (Word)",
  mixto: "SÍ (SQL+Word)",
  pendiente_volcado: "pendiente volcado",
  sin_dato: "no",
};

export interface FilaCoberturaReal {
  lote8: string;
  parcela: string | null;
  fecha: string;
  kgEntrada: number;
  estado: EstadoDatoReal;
  conDato: boolean;
  pasadas: number;
  kgSizer: number | null;
  /** De los kgSizer, los que vienen del Word o del Excel manual (respaldo). */
  kgRespaldo: number | null;
  /** Kg que el parte diario registra para el lote cuando no hay ninguna fuente de desglose. */
  kgEnParte: number | null;
  ultimaEnParte: string | null;
  /** (kg calibrador / kg báscula − 1) × 100. */
  desfase: number | null;
  motivo: string;
}

export function coberturaReal(
  entradas: EntradaReal[],
  porLote: Map<string, AcumuladoReal>,
  pasadasParte: Map<string, PasadaParteReal[]>,
  frescura: FrescuraFuentes,
): FilaCoberturaReal[] {
  const filas = entradas.map((e): FilaCoberturaReal | null => {
    const l = lote8De(e.lote);
    if (!l) return null;
    const acc = porLote.get(l);
    const enParte = pasadasParte.get(l) ?? [];
    const ultimaEnParte = maxONull(enParte.map((p) => p.fecha));
    const kgEnParte = enParte.reduce((s, p) => s + p.kg, 0);
    const procesadoSinVolcado = !acc && enParte.length > 0;
    const kgRespaldo = acc ? acc.kgDocx + acc.kgParte : 0;
    const soloRespaldo = Boolean(acc && kgRespaldo > 0 && kgRespaldo >= acc.kgSizer - 0.5);
    const mixto = Boolean(acc && kgRespaldo > 0 && !soloRespaldo);
    const estado: EstadoDatoReal = acc
      ? soloRespaldo ? "respaldo" : mixto ? "mixto" : "sql"
      : procesadoSinVolcado ? "pendiente_volcado" : "sin_dato";

    const motivo = acc
      ? soloRespaldo
        ? `Con dato del INFORME WORD de lote (el volcado SQL no cubre este lote todavía). El Word trae solo la última pasada de cada día: hay ${acc.pasadasDocx + acc.pasadasParte} informe(s) y el parte registra ${fmtKg(kgEnParte)} kg`
        : mixto
          ? `Mezcla de volcado SQL y Word de lote: ${fmtKg(acc.kgSizer - kgRespaldo)} kg del volcado y ${fmtKg(kgRespaldo)} kg del Word (días que el volcado aún no trae)`
          : "Con dato real del calibrador (volcado SQL, todas las pasadas)"
      : procesadoSinVolcado
        ? `PROCESADO el ${ultimaEnParte} según el parte diario (${fmtKg(kgEnParte)} kg), pero el volcado del calibrador todavía no lo trae${frescura.ultimaPasadaSizer ? ` (volcado parado en el ${frescura.ultimaPasadaSizer})` : ""}: no hay desglose de clases que analizar`
        : e.camaraConfirmadaNombre
          ? `Sigue en cámara — ${e.camaraConfirmadaNombre}, confirmado a pie el ${e.camaraConfirmadaFecha}`
          : e.kgAjuste >= e.kgEntrada && e.kgEntrada > 0
            ? "La entrada se registró entera como ajuste de stock: no hay pasada que analizar"
            : e.cerradoAt
              ? "Cerrado a mano SIN ningún registro de procesado bajo su código"
              : "Sin pasada y sin señal de cámara: pendiente de aclarar";

    return {
      lote8: l,
      parcela: e.parcela,
      fecha: e.fecha,
      kgEntrada: e.kgEntrada,
      estado,
      conDato: Boolean(acc),
      pasadas: acc?.pasadas ?? enParte.length,
      kgSizer: acc?.kgSizer ?? null,
      kgRespaldo: acc && kgRespaldo > 0 ? kgRespaldo : null,
      kgEnParte: procesadoSinVolcado ? kgEnParte : null,
      ultimaEnParte,
      desfase: acc && e.kgEntrada > 0 ? (acc.kgSizer / e.kgEntrada - 1) * 100 : null,
      motivo,
    };
  });
  return filas
    .filter((f): f is FilaCoberturaReal => f != null)
    .sort((a, b) => String(a.parcela ?? "").localeCompare(String(b.parcela ?? "")) || a.fecha.localeCompare(b.fecha) || a.lote8.localeCompare(b.lote8));
}

// ─── Resumen de un acumulado ─────────────────────────────────────────────────

export interface ResumenReal {
  kgSizer: number;
  pasadas: number;
  pasadasRespaldo: number;
  kgRespaldo: number;
  kgExportacion: number;
  kgNoExportacion: number;
  kgMujeres: number;
  kgNoComercial: number;
  pctExportacion: number | null;
  pctNoExportacion: number | null;
  pctMujeres: number | null;
  pctNoComercial: number | null;
  kgPodrido: number;
  pctPodrido: number | null;
  kgApta: number;
  pctApta: number | null;
  mdna: Record<MetodoMdna, number>;
  pctMdnaFormato: Record<MetodoMdna, number | null>;
  mdnaSinFormato: number;
  pctMdnaSinFormato: number | null;
  mdnaTotal: number;
  pctMdna: number | null;
  /** Fruta con calidad de Mercadona (A–F) vendida a otros clientes. */
  kgAptoFuera: number;
  pctAptoFuera: number | null;
  kgNoApta: number;
  pctNoApta: number | null;
  /** Σ destinos − kgSizer: debe ser 0. */
  cuadreDestinos: number;
}

export function resumenReal(a: AcumuladoReal): ResumenReal {
  const dest = (d: string) => a.porDestino.get(d) ?? 0;
  const kgPodrido = [...a.porClase.values()].filter((c) => c.letra === "J").reduce((s, c) => s + c.kg, 0);
  const kgAptoFuera = Math.max(0, a.kgApta - a.mdnaTotal);
  const pctMdnaFormato = Object.fromEntries(METODOS_MDNA.map((m) => [m, pctDe(a.mdna[m], a.kgSizer)])) as Record<MetodoMdna, number | null>;
  return {
    kgSizer: a.kgSizer,
    pasadas: a.pasadas,
    pasadasRespaldo: a.pasadasDocx + a.pasadasParte,
    kgRespaldo: a.kgDocx + a.kgParte,
    kgExportacion: dest("EXPORTACION"),
    kgNoExportacion: dest("NO EXPORTACION"),
    kgMujeres: dest("MUJERES"),
    kgNoComercial: dest("NO COMERCIAL"),
    pctExportacion: pctDe(dest("EXPORTACION"), a.kgSizer),
    pctNoExportacion: pctDe(dest("NO EXPORTACION"), a.kgSizer),
    pctMujeres: pctDe(dest("MUJERES"), a.kgSizer),
    pctNoComercial: pctDe(dest("NO COMERCIAL"), a.kgSizer),
    kgPodrido,
    pctPodrido: pctDe(kgPodrido, a.kgSizer),
    kgApta: a.kgApta,
    pctApta: pctDe(a.kgApta, a.kgSizer),
    mdna: { ...a.mdna },
    pctMdnaFormato,
    mdnaSinFormato: a.mdnaSinFormato,
    pctMdnaSinFormato: pctDe(a.mdnaSinFormato, a.kgSizer),
    mdnaTotal: a.mdnaTotal,
    pctMdna: pctDe(a.mdnaTotal, a.kgSizer),
    kgAptoFuera,
    pctAptoFuera: pctDe(kgAptoFuera, a.kgSizer),
    kgNoApta: a.kgSizer - a.kgApta,
    pctNoApta: pctDe(a.kgSizer - a.kgApta, a.kgSizer),
    cuadreDestinos: [...a.porDestino.values()].reduce((s, v) => s + v, 0) - a.kgSizer,
  };
}

export interface FilaClaseReal {
  clase: string;
  letra: string | null;
  destino: string;
  apta: boolean;
  kg: number;
  pct: number | null;
}

/** Qué salió de la máquina, clase a clase, de más a menos kg. */
export function clasesReal(a: AcumuladoReal): FilaClaseReal[] {
  return [...a.porClase.entries()]
    .sort((x, y) => y[1].kg - x[1].kg)
    .map(([clase, v]) => ({ clase, letra: v.letra, destino: v.destino, apta: v.apta, kg: v.kg, pct: pctDe(v.kg, a.kgSizer) }));
}

/**
 * A qué tornillo de Mercadona puede ir cada calibre (mapeo confirmado con lo
 * empacado del 3 al 5 de agosto de 2026). Los rangos SE SOLAPAN a propósito: un
 * 3/54 vale para la malla de 5 kg y para el granel, y quien decide es la
 * programación de la semana. Por eso esto no reparte kg — solo dice para qué
 * sirve cada calibre.
 */
export const TORNILLOS_POR_CALIBRE: Record<string, string> = {
  "7/110": "exprimidor", "7-110": "exprimidor", "7/100": "exprimidor", "6/90": "exprimidor",
  "5/80": "exprimidor", "4/70": "exprimidor + malla 3",
  "3/60": "malla 5 + malla 3", "3/54": "malla 5 + malla 3 + granel",
  "2/48": "malla 3 + granel", "1/42": "malla 3 + granel",
  "1/36": "granel", "1/30": "granel",
};

export const TORNILLO_DESCONOCIDO = "— (calibre fuera de los tornillos de Mercadona)";

export interface FilaCalibreReal {
  calibre: string;
  kg: number;
  pctApta: number | null;
  tornillos: string;
}

/** Calibre de la fruta apta para Mercadona y a qué tornillo puede ir, de más a menos kg. */
export function calibresReal(a: AcumuladoReal): FilaCalibreReal[] {
  return [...a.porCalibreApta.entries()]
    .sort((x, y) => y[1] - x[1])
    .map(([calibre, kg]) => ({ calibre, kg, pctApta: pctDe(kg, a.kgApta), tornillos: TORNILLOS_POR_CALIBRE[calibre] ?? TORNILLO_DESCONOCIDO }));
}

/** "Parcela Nº2 Delta Seedless" → "Parcela 2" (el dueño las llama por el número). */
export function etiquetaParcela(parcela: string | null | undefined): string {
  const t = String(parcela ?? "").trim();
  if (!t) return "(sin parcela)";
  const m = /N[ºo°]?\s*(\d+)/i.exec(t);
  return m ? `Parcela ${m[1]}` : t;
}

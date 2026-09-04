/**
 * mercadonaFacturacionErp.ts — la facturación REAL de Mercadona por semana ISO
 * y formato, leída de las líneas de venta del ERP, y la regla que decide qué se
 * escribe en mercadona_semanas / mercadona_semana_metodos. Lógica pura: el
 * script scripts/mercadona-facturacion-erp.mjs le da las filas del ERP y de la
 * base y ella devuelve el agrupado y la decisión; los tests viven en
 * src/lib/mercadonaFacturacionErp.test.ts (shim src/lib/mercadonaFacturacionErp.ts).
 *
 * POR QUÉ EXISTE (04-09-2026). La tarifa real de Mercadona (base_iva por método
 * y semana) se cargaba a mano subiendo cada lunes un Excel que es, en realidad,
 * un listado del propio ERP ("ventas por método de confección" del cliente
 * Mercadona, la semana ISO). Como los albaranes de Mercadona se valoran al
 * FACTURAR, ese listado sacado el lunes salía a medias: las semanas 27-29 y 32
 * de 2026 quedaron en la base a 0,38-0,47 €/kg cuando la tarifa real es ~1,02.
 * Leyendo el ERP hoy, con todo facturado, el número sale entero y sin nadie
 * delante.
 *
 * DE DÓNDE SALE CADA COSA (comprobado contra las semanas 30 y 31 de 2026, que
 * estaban bien cargadas y cuadran al céntimo):
 * - Línea = fila de gdata001.fact_lin_alb del cliente 430000287 (MERCADONA S.A.).
 *   La semana es la ISO de `fecha_albaran` (lunes a domingo): por fecha de
 *   FACTURA la S30 daba 15/15/14/14 líneas y otros importes; por albarán da
 *   18/18/18/16 y los euros exactos de la base. La base sin IVA es `importe`
 *   (= bruto_linea = neto_neto; tipo_iva 4 %); los kilos, `unidades_1`; las
 *   "líneas" del Excel son el número de filas.
 * - El método de venta (MA3KGC/MA4KGC/MA5KGC/MA12KGC) NO está en la línea ni en
 *   el nombre del artículo ("NAR VALENCIA LATE CAL6/8"): es la fórmula de
 *   confección de los PALETS de la línea (palets_cab.formula_confeccion, con
 *   palets_cab apuntando a la línea exacta por tipo/serie/num/num_linea_vta).
 *   Es un campo directo del ERP, y no es 1:1 con el artículo: el CAL6/8 se ha
 *   vendido alguna vez en malla de 3 kg. Si una línea no tuviera palets, se
 *   deduce del texto de la línea ("D-PACK 4 X 3 KG"), con las mismas reglas
 *   de mdnaMix.ts, y se avisa.
 * - La fila de AJUSTES/ABONOS del Excel (método vacío, 0 kg, base negativa) son
 *   las líneas de la serie R (abonos, tipo_linea 8): no tienen palets, luego no
 *   tienen método. S31: 5 líneas R = −11.011,18 €, lo que dice la base.
 * - `importe = 0` con kilos es "todavía sin facturar", no cero: mientras una
 *   semana tenga líneas así, el ERP está incompleto y NO se escribe nada.
 * - fact_lin_alb_hist NO añade líneas: es un histórico de VERSIONES (la S30 tiene
 *   92 copias por artículo con importe 0). Se lee solo la tabla principal.
 *
 * QUÉ SE ESCRIBE Y QUÉ NO. Solo base_iva y lineas de los métodos (y los ajustes
 * de la cabecera), y solo en semanas cuya base está vacía o claramente parcial
 * (< 80 % de la del ERP). kilos/palets/cajas de una fila existente no se tocan:
 * vienen del Excel y pueden diferir en unos kilos (correcciones posteriores).
 * Una semana que no existe en la base se puede CREAR entera desde el ERP, pero
 * eso es una decisión aparte (opción explícita): nace sin planificación.
 */
import { semanaIsoDe, fechasSemanaIso, lunesDeSemanaIso } from "./semanaIso.ts";
import { deducirMetodoVentaMdna } from "./mdnaMix.ts";

/** terceros_clientes.num_cliente de MERCADONA S.A. en gdata001 (único cliente; las plataformas son centro_cliente). */
export const CLIENTE_MERCADONA_ERP = "430000287";

/** Serie de los abonos/rectificativas en fact_lin_alb (sin palets, base negativa). */
export const SERIE_ABONO = "R";

/** tipo_documento de los albaranes de venta (la factura es el 51 en fact_facturas). */
export const TIPO_DOCUMENTO_ALBARAN = 40;

/**
 * Por debajo de esta fracción de la base del ERP, la base guardada se considera
 * PARCIAL (listado sacado antes de facturar) y se sustituye. Las semanas 27-29 y
 * 32 de 2026 estaban al 37-46 %; una base buena con una corrección posterior del
 * ERP queda por encima y no se toca (se informa).
 */
export const UMBRAL_BASE_PARCIAL = 0.8;

/** Dos importes son "iguales" si difieren menos de un céntimo (sumas de decimales). */
export const TOLERANCIA_EUR = 0.01;

/** Etiqueta del cajón de líneas de venta con kilos a las que no se les encuentra método. */
export const SIN_METODO = "SIN_METODO";

export interface SemanaIsoRef {
  anio: number;
  semana: number;
}

/** Una línea de fact_lin_alb ya convertida a tipos JS (el script hace los Number/TRIM). */
export interface LineaVentaErp {
  tipoDocumento: number;
  /** 'C' ventas, 'R' abonos (TRIM de serie_dcmto). */
  serie: string;
  numDcmto: number;
  numLinea: number;
  /** YYYY-MM-DD de fecha_albaran. */
  fechaAlbaran: string;
  articulo: string;
  denominacion: string | null;
  texto: string | null;
  /** unidades_1 (kg facturados; en malla/D-Pack es cajas × kg nominales). */
  kg: number;
  /** importe = base sin IVA. 0 con kilos significa "sin valorar". */
  importe: number;
  numFactura: number | null;
  /** Plataforma de Mercadona (terceros_centros_cliente): 04 Antequera, 07 San Isidro (Madrid). */
  centroCliente: string | null;
}

/** Palets de una línea de venta agrupados por fórmula de confección. */
export interface PaletsLineaErp {
  metodo: string;
  palets: number;
  kg: number;
  cajas: number;
}

export type OrigenMetodo = "palets" | "texto" | "abono" | "ninguno";

export interface MetodoSemanaErp {
  metodo: string;
  lineas: number;
  kg: number;
  base: number;
  /** Líneas con kilos e importe 0: aún sin facturar. */
  sinValorar: number;
  /** Líneas cuyo método salió del texto porque no tenían palets. */
  porTexto: number;
  palets: number;
  cajas: number;
}

export interface AjustesSemanaErp {
  lineas: number;
  base: number;
  /** Casi siempre 0; un abono con kilos (−130 kg en la S34) se ve aquí. */
  kg: number;
}

export interface CentroSemanaErp {
  centro: string;
  lineas: number;
  kg: number;
  base: number;
}

export interface SemanaErp extends SemanaIsoRef {
  /** "2026-W30". */
  clave: string;
  /** Por método, en el orden en que aparecen; SIN_METODO aparte en `sinMetodo`. */
  metodos: MetodoSemanaErp[];
  ajustes: AjustesSemanaErp;
  /** Líneas de venta con kilos a las que no se encontró método: la semana no cuadra. */
  sinMetodo: MetodoSemanaErp | null;
  /** Líneas con kilos e importe 0 (todas las de la semana, sumando métodos). */
  lineasSinValorar: number;
  /** Líneas de un tipo_documento distinto de 40: no se cuentan y bloquean la escritura. */
  otrosTipos: number;
  porCentro: CentroSemanaErp[];
  /** Suma de la base de los métodos (sin ajustes). */
  baseMetodos: number;
  kgMetodos: number;
  lineasMetodos: number;
}

/** Lo que hay en la base para una semana (mercadona_semanas + sus métodos). */
export interface MetodoSemanaBase {
  id: string;
  metodo: string;
  kilos: number | null;
  baseIva: number | null;
  lineas: number | null;
}

export interface SemanaBase extends SemanaIsoRef {
  id: string;
  ajustesBaseIva: number | null;
  ajustesLineas: number | null;
  metodos: MetodoSemanaBase[];
}

export type AccionSemana =
  | "sin-cambios"
  | "actualizar"
  | "crear"
  | "erp-incompleto"
  | "no-cuadra"
  | "difiere-sin-tocar"
  | "sin-datos";

export interface DecisionSemana {
  clave: string;
  accion: AccionSemana;
  motivo: string;
  baseErp: number | null;
  baseDb: number | null;
  /** baseDb / baseErp, o null si alguno falta. */
  fraccion: number | null;
  ajustesErp: number | null;
  ajustesDb: number | null;
  avisos: string[];
}

export interface OpcionesDecision {
  umbralParcial?: number;
  toleranciaEur?: number;
}

// ─── Utilidades ──────────────────────────────────────────────────────────────

export function claveSemana(ref: SemanaIsoRef): string {
  return `${ref.anio}-W${String(ref.semana).padStart(2, "0")}`;
}

/** Identidad de una línea de venta: (serie, documento, línea); la usan líneas y palets. */
export function claveLineaVenta(serie: string, numDcmto: number, numLinea: number): string {
  return `${serie.trim().toUpperCase()}|${numDcmto}|${numLinea}`;
}

/** Redondeo a céntimos, para sumar importes sin arrastrar ruido binario. */
export function aCentimos(n: number): number {
  return Math.round(n * 100) / 100;
}

export function igualesEnEuros(a: number | null, b: number | null, tolerancia = TOLERANCIA_EUR): boolean {
  if (a == null || b == null) return a == null && b == null;
  return Math.abs(a - b) < tolerancia + 1e-9;
}

/**
 * "2026-W27" o "27" (con el año ISO por defecto) → { anio, semana }. null si no
 * se entiende: el que llama decide si eso es un error.
 */
export function parsearSemanaArg(texto: string | null | undefined, anioPorDefecto: number): SemanaIsoRef | null {
  const t = String(texto ?? "").trim().toUpperCase();
  let m = /^(\d{4})-?W(\d{1,2})$/.exec(t);
  if (m) return validarSemana({ anio: Number(m[1]), semana: Number(m[2]) });
  m = /^(\d{1,2})$/.exec(t);
  if (m) return validarSemana({ anio: anioPorDefecto, semana: Number(m[1]) });
  return null;
}

function validarSemana(ref: SemanaIsoRef): SemanaIsoRef | null {
  if (!Number.isInteger(ref.anio) || !Number.isInteger(ref.semana) || ref.semana < 1 || ref.semana > 53) return null;
  // La semana 53 solo existe algunos años: fechasSemanaIso la devolvería como la
  // 1 del año siguiente; se comprueba mirando a qué semana pertenece su lunes.
  const lunes = fechasSemanaIso(ref.anio, ref.semana)[0];
  const real = semanaIsoDe(lunes);
  return real.anio === ref.anio && real.semana === ref.semana ? ref : null;
}

/** Las semanas ISO de `desde` a `hasta`, ambas incluidas, cruzando años si hace falta. */
export function semanasEntre(desde: SemanaIsoRef, hasta: SemanaIsoRef): SemanaIsoRef[] {
  const salida: SemanaIsoRef[] = [];
  let lunes = fechasSemanaIso(desde.anio, desde.semana)[0];
  const lunesFin = fechasSemanaIso(hasta.anio, hasta.semana)[0];
  let guarda = 0;
  while (lunes <= lunesFin && guarda++ < 400) {
    salida.push(semanaIsoDe(lunes));
    lunes = sumarDias(lunes, 7);
  }
  return salida;
}

/** Rango de fechas [lunes de `desde`, lunes siguiente al domingo de `hasta`) para la consulta SQL. */
export function rangoFechas(desde: SemanaIsoRef, hasta: SemanaIsoRef): { desdeISO: string; hastaExclusivoISO: string } {
  const desdeISO = lunesDeSemanaIso(fechasSemanaIso(desde.anio, desde.semana)[0]);
  const hastaExclusivoISO = sumarDias(fechasSemanaIso(hasta.anio, hasta.semana)[6], 1);
  return { desdeISO, hastaExclusivoISO };
}

function sumarDias(fechaISO: string, dias: number): string {
  const [y, m, d] = fechaISO.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + dias)).toISOString().slice(0, 10);
}

// ─── Método de cada línea ────────────────────────────────────────────────────

/**
 * Método de venta de una línea. Manda la fórmula de confección de sus palets
 * (mayoría por kilos si hubiera mezcla, que se avisa fuera); si no hay palets,
 * el texto de la línea; los abonos (serie R) no tienen método por definición:
 * son la fila de ajustes.
 */
export function metodoDeLineaVenta(
  linea: Pick<LineaVentaErp, "serie" | "texto">,
  palets: PaletsLineaErp[] | undefined,
): { metodo: string | null; origen: OrigenMetodo } {
  if (linea.serie.trim().toUpperCase() === SERIE_ABONO) return { metodo: null, origen: "abono" };

  const conMetodo = (palets ?? []).filter((p) => p.metodo && p.metodo.trim() !== "");
  if (conMetodo.length > 0) {
    // Mayoría por kilos: una línea con palets de dos fórmulas es rarísima, y si
    // pasa, el listado del ERP tampoco la partiría.
    const ganador = [...conMetodo].sort((a, b) => b.kg - a.kg || b.palets - a.palets)[0];
    return { metodo: ganador.metodo.trim().toUpperCase(), origen: "palets" };
  }

  // Sin palets: el texto de la línea lleva el formato ("NAR VALENCIA LATE
  // CAL5/6 D-PACK 2 X 5 KG"). deducirMetodoVentaMdna exige que el nombre diga
  // "MDNA"/"MERCADONA" porque en general solo ahí el nombre dice el método; aquí
  // el cliente YA es Mercadona (se filtró por num_cliente), así que se le dice
  // explícitamente en vez de duplicar sus reglas de formato.
  const porTexto = deducirMetodoVentaMdna(`MDNA ${linea.texto ?? ""}`);
  return porTexto ? { metodo: porTexto, origen: "texto" } : { metodo: null, origen: "ninguno" };
}

// ─── Agrupado por semana ─────────────────────────────────────────────────────

function nuevoMetodo(metodo: string): MetodoSemanaErp {
  return { metodo, lineas: 0, kg: 0, base: 0, sinValorar: 0, porTexto: 0, palets: 0, cajas: 0 };
}

/**
 * Agrupa las líneas del ERP por semana ISO (de fecha_albaran) y método. Los
 * palets van indexados por claveLineaVenta. Devuelve las semanas ordenadas.
 */
export function agruparFacturacionErp(
  lineas: LineaVentaErp[],
  paletsPorLinea: Map<string, PaletsLineaErp[]>,
): SemanaErp[] {
  const semanas = new Map<string, SemanaErp>();
  const metodosPorSemana = new Map<string, Map<string, MetodoSemanaErp>>();
  const centrosPorSemana = new Map<string, Map<string, CentroSemanaErp>>();

  for (const l of lineas) {
    const ref = semanaIsoDe(l.fechaAlbaran);
    const clave = claveSemana(ref);
    let s = semanas.get(clave);
    if (!s) {
      s = {
        ...ref, clave, metodos: [], ajustes: { lineas: 0, base: 0, kg: 0 }, sinMetodo: null,
        lineasSinValorar: 0, otrosTipos: 0, porCentro: [], baseMetodos: 0, kgMetodos: 0, lineasMetodos: 0,
      };
      semanas.set(clave, s);
      metodosPorSemana.set(clave, new Map());
      centrosPorSemana.set(clave, new Map());
    }
    // Una fila vacía del todo no es nada: ni línea, ni ajuste.
    if (l.kg === 0 && l.importe === 0) continue;

    if (l.tipoDocumento !== TIPO_DOCUMENTO_ALBARAN) {
      s.otrosTipos += 1;
      continue;
    }

    const palets = paletsPorLinea.get(claveLineaVenta(l.serie, l.numDcmto, l.numLinea));
    const { metodo, origen } = metodoDeLineaVenta(l, palets);

    if (origen === "abono") {
      s.ajustes.lineas += 1;
      s.ajustes.base = aCentimos(s.ajustes.base + l.importe);
      s.ajustes.kg += l.kg;
      continue;
    }

    const centros = centrosPorSemana.get(clave)!;
    const codigoCentro = (l.centroCliente ?? "").trim() || "?";
    const c = centros.get(codigoCentro) ?? { centro: codigoCentro, lineas: 0, kg: 0, base: 0 };
    c.lineas += 1;
    c.kg += l.kg;
    c.base = aCentimos(c.base + l.importe);
    centros.set(codigoCentro, c);

    const sinValorar = l.kg !== 0 && l.importe === 0;
    if (sinValorar) s.lineasSinValorar += 1;

    let destino: MetodoSemanaErp;
    if (metodo) {
      const mapa = metodosPorSemana.get(clave)!;
      destino = mapa.get(metodo) ?? nuevoMetodo(metodo);
      mapa.set(metodo, destino);
    } else {
      destino = s.sinMetodo ?? (s.sinMetodo = nuevoMetodo(SIN_METODO));
    }
    destino.lineas += 1;
    destino.kg += l.kg;
    destino.base = aCentimos(destino.base + l.importe);
    if (sinValorar) destino.sinValorar += 1;
    if (origen === "texto") destino.porTexto += 1;
    for (const p of palets ?? []) {
      destino.palets += p.palets;
      destino.cajas += p.cajas;
    }
  }

  const salida = [...semanas.values()].sort((a, b) => a.clave.localeCompare(b.clave));
  for (const s of salida) {
    s.metodos = [...metodosPorSemana.get(s.clave)!.values()].sort((a, b) => a.metodo.localeCompare(b.metodo));
    s.porCentro = [...centrosPorSemana.get(s.clave)!.values()].sort((a, b) => a.centro.localeCompare(b.centro));
    s.baseMetodos = aCentimos(s.metodos.reduce((acc, m) => acc + m.base, 0));
    s.kgMetodos = s.metodos.reduce((acc, m) => acc + m.kg, 0);
    s.lineasMetodos = s.metodos.reduce((acc, m) => acc + m.lineas, 0);
  }
  return salida;
}

// ─── La decisión ─────────────────────────────────────────────────────────────

/** Suma de base_iva de los métodos guardados, o null si ninguno la tiene (semana solo con planificación). */
export function baseGuardada(base: SemanaBase): number | null {
  const conBase = base.metodos.filter((m) => m.baseIva != null);
  if (conBase.length === 0) return null;
  return aCentimos(conBase.reduce((acc, m) => acc + (m.baseIva ?? 0), 0));
}

/**
 * Qué hacer con una semana, comparando el ERP con la base. Solo decide; no
 * escribe. El script aplica "actualizar" (y "crear" solo si se lo piden).
 */
export function decidirSemana(
  erp: SemanaErp | null,
  base: SemanaBase | null,
  opciones: OpcionesDecision = {},
): DecisionSemana {
  const umbral = opciones.umbralParcial ?? UMBRAL_BASE_PARCIAL;
  const tolerancia = opciones.toleranciaEur ?? TOLERANCIA_EUR;
  const clave = erp?.clave ?? (base ? claveSemana(base) : "?");
  const avisos: string[] = [];
  const baseDb = base ? baseGuardada(base) : null;
  const ajustesDb = base?.ajustesBaseIva ?? null;
  const baseErp = erp && (erp.metodos.length > 0 || erp.ajustes.lineas > 0) ? erp.baseMetodos : null;
  const ajustesErp = erp && erp.ajustes.lineas > 0 ? erp.ajustes.base : null;
  const fraccion = baseDb != null && baseErp ? baseDb / baseErp : null;
  const comun = { clave, baseErp, baseDb, fraccion, ajustesErp, ajustesDb, avisos };

  if (!erp || (erp.metodos.length === 0 && erp.ajustes.lineas === 0 && !erp.sinMetodo && erp.otrosTipos === 0)) {
    return { ...comun, accion: "sin-datos", motivo: base ? "el ERP no tiene líneas de esta semana; la base sí" : "sin líneas en el ERP ni fila en la base" };
  }

  for (const m of erp.metodos) {
    if (m.porTexto > 0) avisos.push(`${m.metodo}: ${m.porTexto} línea(s) sin palets, método deducido del texto`);
  }
  if (erp.ajustes.kg !== 0) avisos.push(`los abonos llevan ${erp.ajustes.kg} kg (se cuentan en ajustes, no en métodos)`);
  if (base) {
    const enErp = new Set(erp.metodos.map((m) => m.metodo));
    for (const m of base.metodos) {
      if (!enErp.has(m.metodo.trim().toUpperCase())) avisos.push(`la base tiene ${m.metodo} y el ERP no: se deja como está`);
    }
    if (ajustesDb != null || ajustesErp != null) {
      if (!igualesEnEuros(ajustesDb, ajustesErp, tolerancia)) avisos.push(`ajustes: base ${fmtNull(ajustesDb)} vs ERP ${fmtNull(ajustesErp)}`);
    }
  }

  if (erp.otrosTipos > 0) {
    return { ...comun, accion: "no-cuadra", motivo: `${erp.otrosTipos} línea(s) con tipo_documento distinto de 40: hay que mirarlas antes de escribir` };
  }
  if (erp.sinMetodo) {
    return { ...comun, accion: "no-cuadra", motivo: `${erp.sinMetodo.lineas} línea(s) de venta con ${erp.sinMetodo.kg} kg sin método (ni palets ni formato en el texto)` };
  }
  if (erp.lineasSinValorar > 0) {
    return { ...comun, accion: "erp-incompleto", motivo: `${erp.lineasSinValorar} línea(s) con kilos y sin valorar: aún no está todo facturado` };
  }
  if (!base) {
    return { ...comun, accion: "crear", motivo: "la semana no existe en la base (solo se crea con --crear-semanas)" };
  }
  if (baseDb == null) {
    return { ...comun, accion: "actualizar", motivo: "la base tiene la semana sin base_iva (solo planificación)" };
  }
  if (baseErp == null) {
    return { ...comun, accion: "sin-cambios", motivo: "el ERP no aporta base para esta semana" };
  }
  if (igualesEnEuros(baseDb, baseErp, tolerancia)) {
    return { ...comun, accion: "sin-cambios", motivo: "la base ya tiene lo que dice el ERP" };
  }
  if (baseDb < umbral * baseErp) {
    return { ...comun, accion: "actualizar", motivo: `base parcial: ${Math.round((fraccion ?? 0) * 100)} % de la del ERP` };
  }
  return { ...comun, accion: "difiere-sin-tocar", motivo: `difiere ${aCentimos(baseErp - baseDb)} € pero la base tiene ≥ ${Math.round(umbral * 100)} % del ERP` };
}

function fmtNull(n: number | null): string {
  return n == null ? "—" : String(n);
}

/**
 * Los cambios concretos que "actualizar" haría en una semana existente: qué
 * métodos cambian de base/líneas y qué métodos del ERP faltan en la base.
 */
export interface CambioMetodo {
  metodo: string;
  idBase: string | null;
  baseAntes: number | null;
  baseDespues: number;
  lineasAntes: number | null;
  lineasDespues: number;
}

export function cambiosDeSemana(erp: SemanaErp, base: SemanaBase, tolerancia = TOLERANCIA_EUR): {
  metodos: CambioMetodo[];
  ajustes: { antes: { base: number | null; lineas: number | null }; despues: { base: number | null; lineas: number | null } } | null;
} {
  const porMetodo = new Map(base.metodos.map((m) => [m.metodo.trim().toUpperCase(), m]));
  const metodos: CambioMetodo[] = [];
  for (const m of erp.metodos) {
    const fila = porMetodo.get(m.metodo);
    const cambiaBase = !igualesEnEuros(fila?.baseIva ?? null, m.base, tolerancia);
    const cambiaLineas = (fila?.lineas ?? null) !== m.lineas;
    if (!fila || cambiaBase || cambiaLineas) {
      metodos.push({
        metodo: m.metodo, idBase: fila?.id ?? null,
        baseAntes: fila?.baseIva ?? null, baseDespues: m.base,
        lineasAntes: fila?.lineas ?? null, lineasDespues: m.lineas,
      });
    }
  }
  const ajustesDespues = erp.ajustes.lineas > 0
    ? { base: erp.ajustes.base, lineas: erp.ajustes.lineas }
    : { base: null, lineas: null };
  const ajustesAntes = { base: base.ajustesBaseIva, lineas: base.ajustesLineas };
  const cambianAjustes = !igualesEnEuros(ajustesAntes.base, ajustesDespues.base, tolerancia) || ajustesAntes.lineas !== ajustesDespues.lineas;
  return { metodos, ajustes: cambianAjustes ? { antes: ajustesAntes, despues: ajustesDespues } : null };
}

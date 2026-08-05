/**
 * Entradas de fruta por báscula: parseo del export del programa de báscula y
 * cálculo del stock de fruta sin procesar (cámara/patio).
 *
 * La clave de trazabilidad es el código de LOTE (AAMMDD + nº de entrada del
 * día, p. ej. "26040604"): es el mismo código que llega al calibrador y se
 * guarda en lotes_dia.lote_codigo (a veces con texto pegado, p. ej.
 * "26042712 + 7 BOX DE RECICLAJE" — por eso se normaliza a los 8 dígitos).
 *
 * Stock = kg entrados por báscula − kg procesados por el calibrador para el
 * mismo lote. El calibrador pesa distinto que la báscula (deshidratación,
 * destrío en cámara), así que un lote se considera "procesado" cuando el
 * calibrador ha pasado ≥ 97% de sus kg de entrada.
 */
import { normalizarLoteCodigo } from "@/lib/loteCodigo";

export interface EntradaBasculaParsed {
  fecha: string; // ISO "YYYY-MM-DD"
  /** "bascula" = export normal de entradas; "stock_inicial" = sembrado desde el informe de stock. */
  origen?: "bascula" | "stock_inicial";
  num_entrada: string | null;
  finca: string | null;
  parcela: string | null;
  lote: string;
  agricultor: string | null;
  articulo: string | null;
  tipo_envase: string | null;
  envases: number | null;
  kg_entrada: number;
  recol_kg: number | null;
  coste_recoleccion: number | null;
  importe_transporte: number | null;
  precio_compra_kg: number | null;
  importe_compra: number | null;
  comision_kg: number | null;
  importe_comision: number | null;
  importe_total: number | null;
  certificada: boolean;
  certificado_ggn: string | null;
}

export interface ParseEntradasBasculaResult {
  entradas: EntradaBasculaParsed[];
  /** Filas saltadas (sin fecha, sin lote o sin kg) con su motivo. */
  descartadas: Array<{ fila: number; motivo: string }>;
}

export const UMBRAL_PROCESADO = 0.97;

/**
 * Un resto en cámara es "relevante" (el lote sigue activo, no se pinta como
 * procesado) cuando supera el margen de tolerancia del calibrador
 * (deshidratación / destrío): el mismo criterio 1 - UMBRAL_PROCESADO que usa
 * buildStockEntradas más abajo, expuesto como helper para que otras
 * pantallas (p. ej. TrazabilidadLote) no repitan el 0.03 a mano.
 */
export function esRestoEnCamaraRelevante(kgEnCamara: number, kgEntrada: number): boolean {
  return kgEnCamara > kgEntrada * (1 - UMBRAL_PROCESADO);
}

function normalizeHeader(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Nº de días entre el epoch de fecha de Excel (1899-12-30, con el bug del año
 * bisiesto 1900 incluido) y el epoch de Unix (1970-01-01). Constante estándar
 * usada por cualquier lector de xlsx para convertir un serial numérico.
 */
const EXCEL_EPOCH_OFFSET_DIAS = 25569;

/**
 * Convierte un serial de fecha de Excel (nº de días desde 1899-12-30) a
 * "YYYY-MM-DD" en UTC. Se usa como año/mes/día puro, sin hora: el informe
 * "APROVECHAMIENTO STOCK LOTES" mezcla, para la misma columna Creación,
 * celdas con formato de texto ("28/04/2026") y celdas con formato de fecha de
 * Excel de verdad, que sheet_to_json({raw:true}) devuelve como el nº crudo
 * (p.ej. 46136) en vez de como texto o Date — sin este caso, esas filas se
 * descartaban por "Sin fecha de creación" (4 de los 117 lotes reales del
 * informe de referencia).
 */
function excelSerialToIso(serial: number): string {
  const utcDays = Math.floor(serial - EXCEL_EPOCH_OFFSET_DIAS);
  const d = new Date(utcDays * 86400 * 1000);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/** Convierte "DD/MM/YYYY" (o Date/ISO/serial numérico de Excel) a "YYYY-MM-DD"; null si no es fecha. */
export function parseFechaBascula(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${value.getFullYear()}-${pad2(value.getMonth() + 1)}-${pad2(value.getDate())}`;
  }
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return excelSerialToIso(value);
  }
  const text = String(value ?? "").trim();
  const dmy = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (dmy) {
    return `${dmy[3]}-${pad2(Number(dmy[2]))}-${pad2(Number(dmy[1]))}`;
  }
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    return `${iso[1]}-${iso[2]}-${iso[3]}`;
  }
  return null;
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  const text = String(value ?? "").trim();
  if (!text) return null;
  // El export usa punto decimal sin separador de miles ("0.085", "22500").
  const parsed = Number(text.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function toText(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text ? text : null;
}

/**
 * Parsea las filas (header:1 de sheet_to_json, con raw:true) del export de la
 * báscula. Localiza la fila de cabecera por nombre ("Fecha" + "Lote" + "Kg
 * Entrada") y mapea columnas por nombre, tolerando cambios de orden.
 */
export function parseEntradasBasculaRows(rows: unknown[][]): ParseEntradasBasculaResult {
  const headerIndex = rows.findIndex((row) => {
    const headers = row.map(normalizeHeader);
    return headers.includes("fecha") && headers.includes("lote") && headers.includes("kg entrada");
  });

  if (headerIndex === -1) {
    return { entradas: [], descartadas: [{ fila: 0, motivo: "No se encontró la cabecera (Fecha / Lote / Kg Entrada)" }] };
  }

  const headers = rows[headerIndex].map(normalizeHeader);
  const col = (...names: string[]) => {
    for (const name of names) {
      const index = headers.indexOf(name);
      if (index !== -1) return index;
    }
    return -1;
  };

  const iFecha = col("fecha");
  const iEntrada = col("entrada");
  const iFinca = col("finca");
  const iParcela = col("parcela");
  const iLote = col("lote");
  const iAgricultor = col("agricultor");
  const iArticulo = col("articulo");
  const iTipoEnvase = col("tipo de envase");
  const iEnvases = col("envases");
  const iKg = col("kg entrada");
  const iRecolKg = col("recol kg");
  const iCosteRecol = col("coste recolec", "coste recoleccion");
  const iImporteTte = col("importe tte");
  const iPrecCompra = col("prec compra", "precio compra");
  const iImporteComp = col("importe comp", "importe compra");
  const iComisKg = col("comis kg");
  const iImpComision = col("imp comision", "importe comision");
  const iImporteTotal = col("importe total");
  const iCertificada = col("c");
  const iGgn = col("certificado ggn");

  const entradas: EntradaBasculaParsed[] = [];
  const descartadas: Array<{ fila: number; motivo: string }> = [];

  rows.slice(headerIndex + 1).forEach((row, offset) => {
    const fila = headerIndex + offset + 2; // 1-based, como lo vería el usuario en Excel
    const vacia = row.every((cell) => String(cell ?? "").trim() === "");
    if (vacia) return;

    const fecha = parseFechaBascula(row[iFecha]);
    const lote = toText(row[iLote]);
    const kg = toNumber(row[iKg]);

    if (!fecha) {
      descartadas.push({ fila, motivo: "Sin fecha reconocible" });
      return;
    }
    if (!lote) {
      descartadas.push({ fila, motivo: "Sin código de lote" });
      return;
    }
    if (kg == null || kg <= 0) {
      descartadas.push({ fila, motivo: "Sin kg de entrada" });
      return;
    }

    entradas.push({
      fecha,
      num_entrada: iEntrada === -1 ? null : toText(row[iEntrada]),
      finca: iFinca === -1 ? null : toText(row[iFinca]),
      parcela: iParcela === -1 ? null : toText(row[iParcela]),
      lote,
      agricultor: iAgricultor === -1 ? null : toText(row[iAgricultor]),
      articulo: iArticulo === -1 ? null : toText(row[iArticulo]),
      tipo_envase: iTipoEnvase === -1 ? null : toText(row[iTipoEnvase]),
      envases: iEnvases === -1 ? null : toNumber(row[iEnvases]),
      kg_entrada: kg,
      recol_kg: iRecolKg === -1 ? null : toNumber(row[iRecolKg]),
      coste_recoleccion: iCosteRecol === -1 ? null : toNumber(row[iCosteRecol]),
      importe_transporte: iImporteTte === -1 ? null : toNumber(row[iImporteTte]),
      precio_compra_kg: iPrecCompra === -1 ? null : toNumber(row[iPrecCompra]),
      importe_compra: iImporteComp === -1 ? null : toNumber(row[iImporteComp]),
      comision_kg: iComisKg === -1 ? null : toNumber(row[iComisKg]),
      importe_comision: iImpComision === -1 ? null : toNumber(row[iImpComision]),
      importe_total: iImporteTotal === -1 ? null : toNumber(row[iImporteTotal]),
      certificada: iCertificada === -1 ? false : String(row[iCertificada] ?? "").trim() === "1",
      certificado_ggn: iGgn === -1 ? null : toText(row[iGgn]),
    });
  });

  return { entradas, descartadas };
}

// ─── Informe de stock ("APROVECHAMIENTO STOCK LOTES") ───────────────────────
// El programa de báscula también exporta el stock actual por lote (columna
// "Kgr.Exist."). Sirve para SEMBRAR el arranque: los lotes se empezaron a
// registrar a medias (21-abr-2026), así que para los lotes que ya estaban en
// cámara no tenemos su entrada real. La reconstrucción es:
//   kg_entrada = kg existentes ahora + kg que el calibrador ya procesó del lote
// De ese modo el stock calculado (entrada − procesado) devuelve exactamente el
// stock del informe, y el procesado futuro descuenta bien.

interface StockLoteParsed {
  fecha: string; // fecha de creación del lote
  lote: string;
  articulo: string | null;
  agricultor: string | null;
  kg_existentes: number;
  envases: number | null;
}

export interface ParseStockLotesResult {
  lotes: StockLoteParsed[];
  descartadas: Array<{ fila: number; motivo: string }>;
}

/**
 * Parsea las filas (header:1) del informe de stock. Solo cuentan las filas de
 * detalle (fecha + lote de 8 dígitos + kg); las filas de agrupación por
 * producto/agricultor (sin fecha ni lote) y la leyenda final se descartan en
 * silencio.
 */
export function parseStockLotesRows(rows: unknown[][]): ParseStockLotesResult {
  const headerIndex = rows.findIndex((row) => {
    const headers = row.map(normalizeHeader);
    return headers.includes("lote") && headers.some((h) => h.startsWith("kgr exist"));
  });

  if (headerIndex === -1) {
    return { lotes: [], descartadas: [{ fila: 0, motivo: "No se encontró la cabecera (Lote / Kgr.Exist.)" }] };
  }

  const headers = rows[headerIndex].map(normalizeHeader);
  const col = (...names: string[]) => {
    for (const name of names) {
      const index = headers.findIndex((h) => h === name || h.startsWith(name));
      if (index !== -1) return index;
    }
    return -1;
  };

  const iFecha = col("creacion", "fecha");
  const iLote = col("lote");
  const iProducto = col("producto");
  const iAgricultor = col("agricultor");
  const iKg = col("kgr exist");
  const iEnvases = col("envses", "envases");

  const lotes: StockLoteParsed[] = [];
  const descartadas: Array<{ fila: number; motivo: string }> = [];

  rows.slice(headerIndex + 1).forEach((row, offset) => {
    const fila = headerIndex + offset + 2;
    const lote = String(row[iLote] ?? "").trim();
    const fecha = parseFechaBascula(row[iFecha]);
    const kg = toNumber(row[iKg]);

    // Filas de agrupación (producto/agricultor sin lote) y leyenda: se saltan sin avisar.
    if (!lote && !fecha) return;

    if (!/^\d{8}$/.test(lote)) {
      descartadas.push({ fila, motivo: `Lote no reconocible ("${lote}")` });
      return;
    }
    if (!fecha) {
      descartadas.push({ fila, motivo: "Sin fecha de creación" });
      return;
    }
    if (kg == null || kg <= 0) {
      descartadas.push({ fila, motivo: "Sin kg existentes" });
      return;
    }

    lotes.push({
      fecha,
      lote,
      articulo: iProducto === -1 ? null : toText(row[iProducto]),
      agricultor: iAgricultor === -1 ? null : toText(row[iAgricultor]),
      kg_existentes: kg,
      envases: iEnvases === -1 ? null : toNumber(row[iEnvases]),
    });
  });

  return { lotes, descartadas };
}

// ─── Conciliación con el informe de cámara ("APROVECHAMIENTO STOCK LOTES") ──
// Motivada por el cierre masivo por fecha del 2026-07-16 que cerró 97 lotes
// que en realidad seguían físicamente en cámara (fruta que puede llevar 2-3
// meses en cámara de forma legítima) y hubo que reabrir a mano contra el
// informe real del programa de báscula. `parseInformeAprovechamientoStock` +
// `conciliarStockConInforme` automatizan ese cuadre para que no vuelva a
// pasar por las buenas: importar el informe real y ver qué no cuadra ANTES
// de cerrar nada en bloque por fecha.

export interface InformeAprovechamientoLote {
  lote: string;
  kgExistencia: number;
  producto: string | null;
  agricultor: string | null;
  /** Fecha de creación del lote según el informe (ISO). */
  fechaCreacion: string;
}

interface ParseInformeAprovechamientoResult {
  lotes: InformeAprovechamientoLote[];
  descartadas: Array<{ fila: number; motivo: string }>;
}

/**
 * Parsea el informe "APROVECHAMIENTO STOCK LOTES" del programa de báscula
 * (columnas Creación/Lote/Producto/Agricultor/Kgr.Exist., con filas de
 * subtotal por producto+agricultor —Creación y Lote en blanco— y una leyenda
 * de colores al final, ambas descartadas en silencio). Es el MISMO layout que
 * `parseStockLotesRows` (usado para sembrar el stock inicial de arranque), así
 * que delega en él para no duplicar la localización de cabecera ni el
 * criterio de fila válida — pero es una función aparte, con su propio nombre
 * y forma de salida (camelCase, pensada para conciliación puntual, no para
 * sembrar entradas), para no confundir los dos USOS: sembrado inicial
 * (`buildEntradasDesdeStock`, escribe entradas_bascula nuevas) vs conciliación
 * periódica (esta, solo compara contra lo que ya hay en la tabla).
 */
export function parseInformeAprovechamientoStock(rows: unknown[][]): ParseInformeAprovechamientoResult {
  const { lotes, descartadas } = parseStockLotesRows(rows);
  return {
    lotes: lotes.map((l) => ({
      lote: l.lote,
      kgExistencia: l.kg_existentes,
      producto: l.articulo,
      agricultor: l.agricultor,
      fechaCreacion: l.fecha,
    })),
    descartadas,
  };
}

interface ConciliacionCuadraItem {
  lote: string;
  articulo: string | null;
  agricultor: string | null;
  /** Kg en cámara según la herramienta (kg_entrada − procesado). */
  kgHerramienta: number;
  /** Kg existentes según el informe. */
  kgInforme: number;
  /** kgHerramienta − kgInforme (informativo; no dispara ninguna acción). */
  deltaKg: number;
}

interface ConciliacionSobranteItem {
  lote: string;
  articulo: string | null;
  agricultor: string | null;
  fechaEntrada: string;
  kgEntrada: number;
  kgProcesado: number;
  kgEnCamara: number;
  diasEnCamara: number;
  /** Modo de cierre sugerido (criterioCierreModo) para cuando se cierre en bloque. */
  modoSugerido: CierreModo;
}

interface ConciliacionReabrirItem {
  lote: string;
  articulo: string | null;
  agricultor: string | null;
  kgEntrada: number;
  /** Hueco (kg_entrada − procesado) que volvería a cámara si se reabre. */
  kgHuecoNatural: number;
  kgInforme: number;
  cierreModo: CierreModo | null;
}

interface ConciliacionConflictoItem {
  lote: string;
  articulo: string | null;
  agricultor: string | null;
  kgEntrada: number;
  kgProcesado: number;
  kgInforme: number;
  ultimaFechaProcesado: string | null;
}

interface ConciliacionSinEntradaItem {
  lote: string;
  producto: string | null;
  agricultor: string | null;
  kgInforme: number;
  fechaCreacion: string;
}

export interface ConciliacionResultado {
  /** Activos en la herramienta y presentes en el informe: solo delta informativo. */
  cuadran: ConciliacionCuadraItem[];
  /** Activos en la herramienta pero AUSENTES del informe: candidatos a cerrar. */
  sobranEnHerramienta: ConciliacionSobranteItem[];
  faltanEnHerramienta: {
    /** En el informe y cerrados A MANO en la herramienta: candidatos a reabrir. */
    reabrir: ConciliacionReabrirItem[];
    /**
     * En el informe pero "procesado" en la herramienta SIN cierre manual (el
     * calibrador ya llegó al umbral por kg). Solo informativo: el informe
     * puede ser de hace días y el lote haberse procesado DESPUÉS de la foto,
     * así que esto no se reabre nunca automáticamente — solo se avisa del
     * conflicto para que alguien lo revise a mano si hace falta.
     */
    conflicto: ConciliacionConflictoItem[];
    /**
     * En el informe pero sin ninguna fila en la herramienta (ni activa ni
     * cerrada). Puramente informativo: no se puede reabrir lo que no existe.
     * Incluye el caso de precalibrado/campo-cit (esas entradas se excluyen
     * aguas arriba en useEntradasBascula, así que si el informe trae uno de
     * esos lotes cae aquí, no en "reabrir" ni en "conflicto").
     */
    sinEntrada: ConciliacionSinEntradaItem[];
  };
}

/**
 * Concilia el stock calculado por la herramienta (`stockFilas`, tal cual sale
 * de `buildStockEntradas`/`useEntradasBascula().stock.filas` — YA excluye
 * precalibrado y campo/cit, ver la nota de useEntradasBascula.ts) contra el
 * informe real de cámara del programa de báscula. Función PURA: no decide
 * nada por sí sola, solo clasifica en los tres grupos que la UI necesita para
 * proponer acciones (cerrar los que sobran, reabrir los cerrados que sí
 * están) — el usuario confirma cada acción a mano.
 */
export function conciliarStockConInforme(
  stockFilas: StockLoteRow[],
  informeLotes: InformeAprovechamientoLote[],
): ConciliacionResultado {
  const informePorLote = new Map(informeLotes.map((l) => [l.lote, l]));
  const stockPorLote = new Map(stockFilas.map((f) => [f.lote, f]));

  const cuadran: ConciliacionCuadraItem[] = [];
  const sobranEnHerramienta: ConciliacionSobranteItem[] = [];

  for (const fila of stockFilas) {
    if (fila.estado === "procesado") continue; // (a)/(b) son solo lotes activos
    const informeLote = informePorLote.get(fila.lote);
    if (informeLote) {
      cuadran.push({
        lote: fila.lote,
        articulo: fila.articulo,
        agricultor: fila.agricultor,
        kgHerramienta: fila.kg_en_camara,
        kgInforme: informeLote.kgExistencia,
        deltaKg: fila.kg_en_camara - informeLote.kgExistencia,
      });
    } else {
      sobranEnHerramienta.push({
        lote: fila.lote,
        articulo: fila.articulo,
        agricultor: fila.agricultor,
        fechaEntrada: fila.fecha_entrada,
        kgEntrada: fila.kg_entrada,
        kgProcesado: fila.kg_procesado,
        kgEnCamara: fila.kg_en_camara,
        diasEnCamara: fila.dias_en_camara,
        modoSugerido: criterioCierreModo(fila.kg_entrada, fila.kg_procesado),
      });
    }
  }

  const reabrir: ConciliacionReabrirItem[] = [];
  const conflicto: ConciliacionConflictoItem[] = [];
  const sinEntrada: ConciliacionSinEntradaItem[] = [];

  for (const informeLote of informeLotes) {
    const fila = stockPorLote.get(informeLote.lote);
    if (!fila) {
      sinEntrada.push({
        lote: informeLote.lote,
        producto: informeLote.producto,
        agricultor: informeLote.agricultor,
        kgInforme: informeLote.kgExistencia,
        fechaCreacion: informeLote.fechaCreacion,
      });
      continue;
    }
    if (fila.estado !== "procesado") continue; // ya está activo → cuenta en (a)/(b), no aquí
    if (fila.cerrado_at) {
      reabrir.push({
        lote: fila.lote,
        articulo: fila.articulo,
        agricultor: fila.agricultor,
        kgEntrada: fila.kg_entrada,
        kgHuecoNatural: Math.max(0, fila.kg_entrada - fila.kg_procesado),
        kgInforme: informeLote.kgExistencia,
        cierreModo: fila.cierre_modo,
      });
    } else {
      conflicto.push({
        lote: fila.lote,
        articulo: fila.articulo,
        agricultor: fila.agricultor,
        kgEntrada: fila.kg_entrada,
        kgProcesado: fila.kg_procesado,
        kgInforme: informeLote.kgExistencia,
        ultimaFechaProcesado: fila.ultima_fecha_procesado,
      });
    }
  }

  return { cuadran, sobranEnHerramienta, faltanEnHerramienta: { reabrir, conflicto, sinEntrada } };
}

/**
 * Convierte los lotes del informe de stock en entradas sembradas:
 * kg_entrada = stock actual + kg ya procesados por el calibrador para ese lote.
 */
export function buildEntradasDesdeStock(
  lotes: StockLoteParsed[],
  procesados: LoteProcesadoInput[],
): EntradaBasculaParsed[] {
  const procesadoPorLote = new Map<string, number>();
  for (const p of procesados) {
    const clave = normalizarLoteCodigo(p.lote_codigo);
    if (!clave) continue;
    procesadoPorLote.set(clave, (procesadoPorLote.get(clave) ?? 0) + (Number(p.kg_peso_total) || 0));
  }

  return lotes.map((l) => ({
    fecha: l.fecha,
    origen: "stock_inicial" as const,
    num_entrada: null,
    finca: null,
    parcela: null,
    lote: l.lote,
    agricultor: l.agricultor,
    articulo: l.articulo,
    tipo_envase: null,
    envases: l.envases,
    kg_entrada: l.kg_existentes + (procesadoPorLote.get(l.lote) ?? 0),
    recol_kg: null,
    coste_recoleccion: null,
    importe_transporte: null,
    precio_compra_kg: null,
    importe_compra: null,
    comision_kg: null,
    importe_comision: null,
    importe_total: null,
    certificada: false,
    certificado_ggn: null,
  }));
}

/**
 * Código de lote normalizado: los primeros 8 dígitos seguidos (AAMMDDNN).
 * El calibrador a veces guarda el lote con texto pegado ("26042712 + 7 BOX DE
 * RECICLAJE"); la báscula lo guarda limpio.
 *
 * Movida a src/lib/loteCodigo.ts (junto a la convención B, prefijoNumericoLote)
 * para documentar en un único sitio por qué hay dos normalizaciones de lote
 * distintas; se reexporta aquí para no romper los imports existentes.
 */
export { normalizarLoteCodigo };

export interface LoteProcesadoInput {
  lote_codigo: string | null;
  kg_peso_total: number | null;
  /** Fecha del parte en que se procesó (si se conoce). */
  date?: string | null;
}

export type StockEstado = "pendiente" | "parcial" | "procesado";

/**
 * Estado de un lote según qué fracción de sus kg de entrada ha "procesado"
 * el calibrador (kg de lotes_dia + kg_ajuste_stock de conciliación). Mismo
 * criterio (y mismo UMBRAL_PROCESADO) que usa buildStockEntradas; extraído
 * como helper para que otros consumidores (p. ej. src/lib/mermaLote.ts) no
 * dupliquen el umbral ni la fórmula de las 3 franjas.
 *
 * `cerradoManualmente` (entradas_bascula.cerrado_at, migración
 * 20260715090000): el dueño puede dar un lote por terminado aunque no llegue
 * al umbral normal (hay lotes que se quedan a ~94% para siempre porque parte
 * del hueco es podrido de un contenedor que no se pesa a diario). Si es
 * true, el lote siempre cuenta como "procesado" — el resto se reclasifica
 * como merma en src/lib/mermaLote.ts y deja de contar como stock. Esto NO
 * cambia según `cierre_modo` (ver más abajo): cerrado = procesado/0 en
 * cámara en CUALQUIER modo, la distinción de modo solo afecta a si el hueco
 * cuenta como pérdida real o se excluye del análisis (mermaLote.ts).
 */
export function estadoLotePorProcesado(
  kgEntrada: number,
  kgProcesadoTotal: number,
  cerradoManualmente = false,
  /**
   * Días desde la entrada (para el umbral dinámico por edad, ver
   * umbralCompletoPorEdad más abajo). Opcional y sin `fraccionEsperadaPorEdad`
   * no cambia nada: se sigue usando el umbral plano UMBRAL_PROCESADO de
   * siempre (compatibilidad con todas las llamadas existentes).
   */
  diasEnCamara?: number,
  /**
   * Callback que da la fracción de entrada esperable a esa antigüedad —
   * normalmente `capacidadFraccionEstimada` de conciliacionKg.ts, inyectada
   * por el caller (useEntradasBascula.ts) para que este módulo no tenga que
   * importar conciliacionKg.ts/mermaLote.ts (evita un ciclo de imports).
   */
  fraccionEsperadaPorEdad?: (dias: number) => number,
): StockEstado {
  if (cerradoManualmente) return "procesado";
  const pct = kgEntrada > 0 ? kgProcesadoTotal / kgEntrada : 0;
  const umbral = diasEnCamara != null ? umbralCompletoPorEdad(diasEnCamara, fraccionEsperadaPorEdad) : UMBRAL_PROCESADO;
  return pct >= umbral ? "procesado" : pct > 0 ? "parcial" : "pendiente";
}

/**
 * Umbral mínimo de seguridad para considerar un lote COMPLETO por edad
 * (ground truth del dueño, 04-08-2026): nunca por debajo del 85 % procesado
 * real, por muy viejo que sea el lote — un hueco mayor ya no es
 * razonablemente "solo merma y podrido habitual".
 */
export const UMBRAL_COMPLETO_MINIMO = 0.85;

/**
 * Umbral EFECTIVO de "COMPLETO" para un lote con `dias` en cámara: el plano
 * UMBRAL_PROCESADO (97 %) de siempre para lotes jóvenes, relajado hacia el
 * rendimiento esperado por edad (`fraccionEsperadaPorEdad`, normalmente
 * `capacidadFraccionEstimada` de conciliacionKg.ts) para lotes viejos, pero
 * nunca por debajo de UMBRAL_COMPLETO_MINIMO (85 %).
 *
 * Refuerzo 04-08-2026 (ground truth del dueño, verificado físicamente): 3
 * lotes de Guadex de ~90 días con 87-95 % procesado tenían la cámara VACÍA
 * de verdad — el umbral plano del 97 % es demasiado exigente para lotes
 * viejos (merma natural + podrido pre-calibrador habitual ya explican varios
 * puntos del hueco a esa antigüedad). Sin `fraccionEsperadaPorEdad` (o sin
 * `dias`) se comporta EXACTAMENTE como antes (siempre UMBRAL_PROCESADO): no
 * rompe ninguna llamada existente.
 */
export function umbralCompletoPorEdad(dias: number, fraccionEsperadaPorEdad?: (dias: number) => number): number {
  if (!fraccionEsperadaPorEdad) return UMBRAL_PROCESADO;
  const esperado = fraccionEsperadaPorEdad(dias);
  return Math.min(UMBRAL_PROCESADO, Math.max(UMBRAL_COMPLETO_MINIMO, esperado));
}

// ─── Modo del cierre manual (entradas_bascula.cierre_modo, migración ────────
// 20260716120000_entradas_bascula_cierre_modo.sql) ───────────────────────────
// Un lote cerrado a mano (cerrado_at) puede estarlo por dos motivos muy
// distintos: (a) SÍ se procesó, solo que no llegó al umbral normal (el hueco
// es merma/podrido real: "con_analisis"), o (b) su procesado NO consta bajo
// este código —códigos compuestos que acreditan a otro lote, venta sin
// procesar en la central— y el hueco no es una pérdida real, es un artefacto
// de trazabilidad ("sin_registro"). Ver src/lib/mermaLote.ts para qué hace
// cada modo con el hueco; este archivo solo aporta el tipo y el criterio de
// preselección que usa la UI del diálogo de cierre.

export type CierreModo = "con_analisis" | "sin_registro";

/**
 * Umbral (fracción de kg procesado sobre kg entrada) para sugerir
 * "con_analisis" en el diálogo de cierre. NO es un umbral de negocio estricto
 * como UMBRAL_PROCESADO (ese decide si un lote sigue en stock); este es solo
 * una SUGERENCIA editable por el usuario en el momento de cerrar: por debajo
 * del 85% procesado es más probable que el resto no sea pérdida real sino
 * procesado que nunca se registró bajo este código.
 */
export const UMBRAL_CIERRE_CON_ANALISIS = 0.85;

/**
 * Preselección del modo de cierre: "con_analisis" si el lote ya lleva
 * procesado el 85% o más de su entrada (el hueco restante es plausible como
 * merma/podrido real), "sin_registro" en caso contrario (con tan poco
 * procesado bajo su código, lo más probable es que el resto pasara por otro
 * sitio, no que se perdiera). Función PURA: la UI la usa para sugerir, nunca
 * para decidir sola — el usuario siempre puede elegir el otro modo.
 */
export function criterioCierreModo(kgEntrada: number, kgProcesadoTotal: number): CierreModo {
  const pct = kgEntrada > 0 ? kgProcesadoTotal / kgEntrada : 0;
  return pct >= UMBRAL_CIERRE_CON_ANALISIS ? "con_analisis" : "sin_registro";
}

// ─── "Probablemente terminado": aviso derivado, sin cierre automático ──────
// Queja textual del dueño: "hay lotes que ya han pasado por producción y
// siguen contando como en cámara... hay que reforzar el proceso para que no
// pase". Causa estructural: el hueco natural (merma + podrido no pesado,
// 3-7%) impide llegar al UMBRAL_PROCESADO (97%) automático, así que el lote
// solo sale del stock con un cierre MANUAL — y nadie se acuerda de cerrarlo.
//
// Por qué esto NO se auto-cierra: en BD hay 37 lotes que reanudaron pasadas
// del calibrador DESPUÉS de pasar por encima del 85% procesado (7 de ellos
// tras ≥5 días parados), con un gap máximo observado de 12 días entre la
// última pasada "antigua" y la que reanudó. Cerrar a ciegas con cualquier
// umbral de días clasificaría esa fruta que vuelve a línea como merma real.
//
// UMBRAL_PROBABLE_TERMINADO / DIAS_SIN_ACTIVIDAD_TERMINADO: parámetros
// elegidos por análisis de clasificación sobre TODA la campaña (jul 2026, 80
// lotes terminados reales como verdad, hecho por el orquestador contra la
// BD a petición del dueño): con ≥7 días de inactividad hay CERO reanudaciones
// históricas a cualquier umbral de % (el parón máximo observado antes de
// reanudar es 12 días); bajar el umbral de % a 80% captura 63/80 terminados
// reales (79%) frente a 55/80 con 85%, sin ningún falso positivo. Los DÍAS
// hacen el trabajo de seguridad, no el %. Margen para un futuro auto-cierre a
// 14 días si el dueño lo pide.
//
// Sea cual sea el ajuste futuro, el falso positivo sigue teniendo COSTE CERO:
// es un estado derivado que se desmarca solo en cuanto llega una pasada nueva
// del calibrador, no escribe nada en la BD.
export const UMBRAL_PROBABLE_TERMINADO = 0.80;
export const DIAS_SIN_ACTIVIDAD_TERMINADO = 7;

// ─── Cierre automático PERSISTIDO de lotes COMPLETOS (refuerzo 2026-08-03) ──
// Encargo textual del dueño: "Cuando se detecte un lote que pasa por el
// calibrador, se debe restar lo que haya pasado y cuando pasa todo, se debe
// cerrar el lote y contarlo como procesado [...] hace que el control de stock
// y mermas confunda más." El cálculo derivado (estadoLotePorProcesado /
// buildStockEntradas) YA trata un lote ≥UMBRAL_LOTE_COMPLETO como "procesado"
// en stock/mermas/KPIs sin esperar a ningún cierre manual — pero la fila de
// entradas_bascula se queda con cerrado_at=null para siempre si nadie pulsa
// "cerrar" a mano, y eso es justo el backlog real detectado el 03-08-2026:
// 819 lotes activos (cerrado_at null) con ≥97% ya procesado, 17.364 t.
//
// A diferencia de "probablemente terminado" (UMBRAL_PROBABLE_TERMINADO/
// DIAS_SIN_ACTIVIDAD_TERMINADO, más arriba), aquí NO hay incertidumbre sobre
// el % — el lote YA está COMPLETO por definición — así que el margen de
// seguridad solo tiene que cubrir que la última pasada "se asiente" (un parte
// con retraso del mismo lote al día siguiente) antes de persistir el cierre,
// no el riesgo de clasificar mal un % todavía dudoso. Por eso el margen es
// mucho más corto (2 días, no 7).
export const DIAS_SIN_ACTIVIDAD_AUTOCIERRE = 2;

/**
 * Guardia inversa: un lote cerrado a mano (`cerrado_at`) cuyo calibrador
 * registró una pasada DESPUÉS de la fecha de cierre. Es la señal de que el
 * cierre fue prematuro/erróneo — la fruta "cerrada" volvió a línea — así que
 * hay que avisar para revisarlo/reabrirlo, nunca reabrir solo automáticamente
 * (mismo espíritu que faltanEnHerramienta.conflicto en conciliarStockConInforme:
 * se avisa, no se actúa sola).
 */
function pasadasPosterioresAlCierre(cerradoAt: string | null, ultimaPasada: string | null): boolean {
  if (!cerradoAt || !ultimaPasada) return false;
  const fechaCierre = cerradoAt.slice(0, 10); // "YYYY-MM-DDTHH:mm:ss..." -> "YYYY-MM-DD"
  return ultimaPasada > fechaCierre;
}

export interface StockLoteRow {
  lote: string;
  fecha_entrada: string;
  finca: string | null;
  articulo: string | null;
  agricultor: string | null;
  kg_entrada: number;
  kg_procesado: number;
  kg_en_camara: number;
  /** Última fecha en que el calibrador procesó parte del lote (si consta). */
  ultima_fecha_procesado: string | null;
  /** Días desde la entrada hasta hoy (pendiente/parcial) o hasta el último procesado. */
  dias_en_camara: number;
  estado: StockEstado;
  /** entradas_bascula.cerrado_at (migración 20260715090000), o null si el lote sigue abierto. Cuando no es null, `estado` es siempre "procesado" y `kg_en_camara` es 0 (ver estadoLotePorProcesado). */
  cerrado_at: string | null;
  /** entradas_bascula.cierre_modo (migración 20260716120000): solo informativo aquí (para el badge), no cambia estado/kg_en_camara — ver src/lib/mermaLote.ts para el efecto real del modo. `null` si el lote está abierto o si se cerró antes de que existiera esta columna (tratado como "con_analisis" en mermaLote.ts). */
  cierre_modo: CierreModo | null;
  /**
   * Ver UMBRAL_PROBABLE_TERMINADO/DIAS_SIN_ACTIVIDAD_TERMINADO más abajo:
   * true cuando el lote está "parcial" (nunca "procesado"/cerrado — esos ya
   * no cuentan como stock), lleva ≥UMBRAL_PROBABLE_TERMINADO (80%) procesado
   * y el calibrador no le ha tocado en ≥DIAS_SIN_ACTIVIDAD_TERMINADO (7)
   * días. Es un AVISO, no un cierre: no cambia `estado` ni `kg_en_camara`,
   * solo señala en la UI el hueco que el auto-cierre NO puede asumir (ver la
   * cabecera de este archivo/PROBLEMA en el diseño) para que alguien lo
   * revise y cierre a mano si procede.
   */
  probablementeTerminado: boolean;
  /**
   * Guardia inversa (ver pasadasPosterioresAlCierre): true cuando el lote
   * está cerrado a mano (cerrado_at) pero el calibrador registró una pasada
   * DESPUÉS de la fecha de cierre — la fruta volvió a línea tras cerrarse, así
   * que cerrarlo fue (probablemente) un error y hay que revisarlo/reabrirlo.
   */
  cerradoConActividadPosterior: boolean;
  /**
   * Evidencia de "procesado en compuesto" (refuerzo 04-ago-2026, encargo del
   * dueño, AJUSTADO tras la validación en real del commit ae30f5a). No null
   * cuando el lote sigue ACTIVO (no cerrado a mano), `detectarLotesEnPasadaCompuesta`
   * (conciliacionKg.ts) lo vio nombrado como código no-primero en alguna
   * pasada compuesta, Y su PENDIENTE (kg_entrada − kg conciliado, ya con
   * kg_ajuste_stock incluido) cabe dentro del hueco que la edad del lote ya
   * explica (merma natural + podrido pre-calibrador habitual —
   * capacidadFraccionEstimada de conciliacionKg.ts, inyectada como
   * `fraccionEsperadaPorEdad`, nunca duplicada aquí).
   *
   * Primera versión (exigía 0 kg EXACTOS bajo su propio código) casi nunca
   * disparaba en real: verificado contra la BD que la fase 1 de
   * conciliarKgProcesados YA reparte algo de kg a los códigos nombrados (o,
   * en los 3 casos reales encontrados aún activos — 26041702/26042109/
   * 26050104 —, `kg_ajuste_stock` ya cubre el 100% de la entrada), así que
   * el pendiente casi nunca era EXACTAMENTE 0 aunque fuera perfectamente
   * explicable por la edad. `primeros` son los códigos que lo nombraron y
   * `ultimaFecha` la pasada compuesta más reciente que lo menciona — la
   * fecha de referencia del margen de 2 días (no la de una pasada bajo su
   * propio código, que puede no existir).
   *
   * Cuando no es null, `estado` se fuerza a "procesado" (igual que un cierre
   * manual) y `kg_en_camara` es 0. Si el pendiente SUPERA el hueco explicable
   * por edad (el hueco es mayor de lo que la edad por sí sola justifica),
   * este campo es null y el lote se queda "parcial"/"pendiente" sin tocar.
   */
  procesadoEnCompuesto: { primeros: string[]; ultimaFecha: string | null } | null;
  /**
   * true si alguna señal VIGENTE confirma que este lote SIGUE físicamente en
   * cámara ahora mismo: cámara EXTERNA (Guadex/Zamexfruit,
   * codigosEnCamaraExterna en camarasExternas.ts) o confirmación FÍSICA por
   * inventario a pie (camaraConfirmadaVigentePorLote en camaraConfirmada.ts,
   * refuerzo 04-08-2026: 26 lotes de la cámara 5 confirmados por el dueño,
   * ver el docstring de ese módulo). Antes de ese refuerzo este campo se
   * llamaba `enCamaraExterna` y solo cubría la primera señal; se renombra
   * para no mentir sobre lo que representa ahora que el caller
   * (useEntradasBascula.ts) inyecta la UNIÓN de ambas en `lotesConfirmadosEnCamara`.
   * Ground truth del dueño 04-08-2026 (nº2, prioridad máxima): es
   * físicamente imposible que haya pasado por el calibrador, así que NUNCA
   * es candidato a cierre automático (ni completo ni compuesto) aunque algo
   * más (un derrame, un ajuste de stock…) le haya dado kg — protección
   * simétrica a la de conciliarKgProcesados, que ya excluye estos lotes del
   * derrame por exceso. `false` por defecto (sin la señal inyectada, no
   * cambia nada del comportamiento existente).
   */
  enCamaraConfirmada: boolean;
  /**
   * REGLA DE ORO de la refundación de trazabilidad (aprobada por el dueño
   * 04-08-2026, ver docs/TRAZABILIDAD_REFUNDACION.md — fase 2 puente): true
   * cuando el lote alcanza el umbral de COMPLETO contando SOLO kg con
   * evidencia (pasadas nombradas/anotadas + ajuste de stock medido), es
   * decir, SIN los kg recibidos por derrame de la conciliación
   * (exceso_misma_finca/variedad — una suposición estadística, clase
   * "derivado"). El derrame puede seguir pintando kg_procesado/estado (vista
   * derivada, útil para investigar), pero NO puntúa para cerrar: en la
   * Cámara 5 el derrame atribuyó 310 t fantasma a 18 lotes intactos y 8 se
   * cerraron solos. Sin `kgDerramePorLote` inyectado (llamadas/tests
   * antiguos) es equivalente a `estado === "procesado"` sobre el lote
   * abierto: compatibilidad total.
   */
  completoConEvidencia: boolean;
  /**
   * Detalle de la confirmación FÍSICA vigente (nombre de cámara + fecha del
   * inventario, ver camaraConfirmadaVigentePorLote en camaraConfirmada.ts):
   * solo para pintar el badge "En cámara · {nombre} (confirmado {fecha})" en
   * la pestaña Stock. `null` si no hay confirmación física vigente para este
   * lote (aunque sí pueda estar en cámara EXTERNA — esa señal no trae
   * nombre/fecha de confirmación, solo procedencia, ya visible en
   * CamarasExternasCard). No decide nada por sí solo: el veto de cierre usa
   * `enCamaraConfirmada` (la unión), no este campo.
   */
  confirmacionCamara: { nombre: string; fecha: string } | null;
}

interface StockResumen {
  filas: StockLoteRow[];
  /** Total en cámara (firme + probablemente terminado), igual que antes de introducir la partición — mantiene compatibilidad con el resto de la app y los tests existentes. */
  kgEnCamara: number;
  /** Subconjunto "firme" de kgEnCamara: lotes activos que NO cumplen la regla de probablementeTerminado. */
  kgEnCamaraFirme: number;
  /** Subconjunto de kgEnCamara en lotes marcados probablementeTerminado. */
  kgProbablementeTerminados: number;
  /** Nº de lotes con probablementeTerminado=true (para el aviso/KPI). */
  lotesProbablementeTerminados: number;
  lotesPendientes: number;
  lotesParciales: number;
  /** Días del lote pendiente/parcial más antiguo. */
  antiguedadMaxDias: number;
  /** Lotes cerrados a mano con una pasada del calibrador posterior a su cierre (ver pasadasPosterioresAlCierre): candidatos a reabrir por error de cierre. */
  lotesCerradosConActividadPosterior: StockLoteRow[];
}

/** Días naturales entre dos fechas ISO "YYYY-MM-DD" (hasta − desde, nunca negativo). Exportada para src/lib/mermaLote.ts (diasEnCamara). */
export function diffDias(desde: string, hasta: string): number {
  const [y1, m1, d1] = desde.split("-").map(Number);
  const [y2, m2, d2] = hasta.split("-").map(Number);
  const ms = Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1);
  return Math.max(0, Math.round(ms / 86400000));
}

export function buildStockEntradas(
  entradas: Array<
    Pick<EntradaBasculaParsed, "lote" | "fecha" | "kg_entrada" | "finca" | "articulo" | "agricultor"> & {
      kg_ajuste_stock?: number | null;
      /** Cierre manual (entradas_bascula.cerrado_at, migración 20260715090000): no-null fuerza estado "procesado" y kg_en_camara=0, aunque el calibrador no llegue al umbral normal. Opcional para no romper llamadas existentes. */
      cerrado_at?: string | null;
      /** entradas_bascula.cierre_modo (migración 20260716120000): pasa de largo a StockLoteRow.cierre_modo, no afecta a este cálculo (ver cabecera de estadoLotePorProcesado). Opcional para no romper llamadas existentes. */
      cierre_modo?: CierreModo | null;
    }
  >,
  procesados: LoteProcesadoInput[],
  hoy: string,
  /**
   * lote → evidencia de pasada COMPUESTA que lo nombra como código
   * no-primero (detectarLotesEnPasadaCompuesta, conciliacionKg.ts). Refuerzo
   * 04-ago-2026: un lote activo con 0 kg conciliados bajo su propio código
   * que aparece aquí pasa a "procesado en compuesto" (ver
   * StockLoteRow.procesadoEnCompuesto) en vez de seguir contando como stock.
   * Opcional para no romper llamadas existentes (tests, sitios sin esta
   * evidencia a mano).
   */
  huerfanosCompuesta?: Map<string, { primeros: string[]; ultimaFecha: string | null }>,
  /**
   * Umbral dinámico de "COMPLETO" por edad (ver umbralCompletoPorEdad más
   * arriba): normalmente `capacidadFraccionEstimada` de conciliacionKg.ts,
   * inyectada por el caller para no crear un ciclo de imports. Sin ella, el
   * umbral sigue siendo el plano UMBRAL_PROCESADO de siempre.
   */
  fraccionEsperadaPorEdad?: (dias: number) => number,
  /**
   * Códigos con alguna señal VIGENTE de "sigue en cámara" ahora mismo: la
   * UNIÓN de cámara EXTERNA (codigosEnCamaraExterna, camarasExternas.ts) y
   * confirmación FÍSICA por inventario a pie (camaraConfirmadaVigentePorLote,
   * camaraConfirmada.ts — refuerzo 04-08-2026, 26 lotes de la cámara 5).
   * Ground truth del dueño 04-08-2026 (nº2): fuerza `enCamaraConfirmada=true`
   * en la fila — protección de cinturón y tirantes para que ningún candidato
   * de cierre (completo o compuesto) los recoja, aunque algo les haya dado
   * kg por error. Se llamó `lotesEnCamaraExterna` cuando solo cubría la
   * primera señal (ver conciliarKgProcesados en conciliacionKg.ts, mismo
   * renombrado). Opcional.
   */
  lotesConfirmadosEnCamara?: Set<string>,
  /**
   * Detalle (nombre de cámara + fecha) de la confirmación FÍSICA vigente por
   * lote (ver camaraConfirmadaVigentePorLote en camaraConfirmada.ts): solo
   * alimenta `StockLoteRow.confirmacionCamara` para el badge de la UI, no
   * cambia ningún cálculo. Opcional; sin ella el campo sale `null` siempre.
   */
  confirmacionCamaraPorLote?: Map<string, { nombre: string; fecha: string }>,
  /**
   * Kg recibidos por DERRAME (motivos exceso_misma_finca/exceso_misma_variedad
   * de conciliarKgProcesados) por lote normalizado. REGLA DE ORO (fase 2
   * puente, docs/TRAZABILIDAD_REFUNDACION.md): estos kg son clase "derivado"
   * (suposición estadística) y no puntúan ni para `completoConEvidencia` ni
   * para el pendiente del candidato compuesto. Opcional: sin él, ningún kg se
   * descuenta (comportamiento previo, tests antiguos intactos).
   */
  kgDerramePorLote?: Map<string, number>,
): StockResumen {
  const procesadoPorLote = new Map<string, { kg: number; ultimaFecha: string | null }>();
  for (const p of procesados) {
    const clave = normalizarLoteCodigo(p.lote_codigo);
    if (!clave) continue;
    const acc = procesadoPorLote.get(clave) ?? { kg: 0, ultimaFecha: null };
    acc.kg += Number(p.kg_peso_total) || 0;
    if (p.date && (!acc.ultimaFecha || p.date > acc.ultimaFecha)) acc.ultimaFecha = p.date;
    procesadoPorLote.set(clave, acc);
  }

  const filas: StockLoteRow[] = entradas.map((entrada) => {
    const clave = normalizarLoteCodigo(entrada.lote) ?? entrada.lote;
    const procesado = procesadoPorLote.get(clave);
    // kg_ajuste_stock: conciliación con el informe de stock de la báscula
    // (procesado anterior a que hubiera partes registrados). Se suma al
    // procesado conocido; negativo devuelve stock.
    const kgProcesado = (procesado?.kg ?? 0) + (Number(entrada.kg_ajuste_stock) || 0);
    const kgEnCamara = Math.max(0, entrada.kg_entrada - kgProcesado);
    const cerradoManualmente = Boolean(entrada.cerrado_at);
    // Antigüedad DESDE LA ENTRADA hasta hoy: referencia del umbral dinámico
    // por edad (ground truth 04-08-2026, ver umbralCompletoPorEdad). Se usa
    // "hoy" (no la última pasada) porque el umbral decide si el lote sigue
    // ACTIVO, y su antigüedad como stock se cuenta hasta hoy mientras siga
    // abierto.
    const diasDesdeEntrada = diffDias(entrada.fecha, hoy);
    /**
     * Refuerzo 04-08-2026 (validación en real, commit ae30f5a): la
     * precondición original ("0 kg propios") casi nunca se cumplía —
     * confirmado contra la BD real (26041702/26042109/26050104, los 3
     * huérfanos reales que seguían activos): la fase 1 de
     * conciliarKgProcesados YA reparte kg a los códigos nombrados (o, en
     * estos 3 casos concretos, kg_ajuste_stock ya cubre el 100% de la
     * entrada), así que el hueco restante casi nunca es EXACTAMENTE 0 aunque
     * sea perfectamente explicable por la edad del lote. Nuevo criterio: el
     * lote nombrado en compuesta es candidato si su PENDIENTE (lo que de
     * verdad le falta, ya con ajuste de stock incluido) cabe dentro del
     * hueco que la edad ya explica (capacidadFraccionEstimada, inyectada vía
     * `fraccionEsperadaPorEdad` — no se duplica la fórmula). Sin esa función
     * inyectada, el hueco explicable es 0 y el criterio se reduce al
     * original (compatibilidad con las llamadas/tests que no la pasan).
     * Caso de control verificado: 26042109 (nombrado en "26042010-
     * 26042109", cámara física vacía confirmada) tiene pendiente 0 (cubierto
     * por kg_ajuste_stock) → 0 ≤ cualquier hueco → sale candidato.
     */
    // REGLA DE ORO (fase 2 puente): los kg de derrame no puntúan. El pendiente
    // que decide el candidato compuesto y el "completo con evidencia" se
    // calculan sobre el procesado SIN derrame (pasadas nombradas/anotadas +
    // ajuste medido); kg_procesado/estado siguen mostrando la vista conciliada.
    const kgDerrame = kgDerramePorLote?.get(clave) ?? 0;
    const kgProcesadoConEvidencia = kgProcesado - kgDerrame;
    const pendienteActual = Math.max(0, entrada.kg_entrada - kgProcesadoConEvidencia);
    const huecoExplicablePorEdad = fraccionEsperadaPorEdad
      ? Math.max(0, entrada.kg_entrada * (1 - Math.min(1, Math.max(0, fraccionEsperadaPorEdad(diasDesdeEntrada)))))
      : 0;
    const procesadoEnCompuesto = !cerradoManualmente && pendienteActual <= huecoExplicablePorEdad
      ? huerfanosCompuesta?.get(clave) ?? null
      : null;
    const estado: StockEstado = estadoLotePorProcesado(
      entrada.kg_entrada,
      kgProcesado,
      cerradoManualmente || procesadoEnCompuesto != null,
      diasDesdeEntrada,
      fraccionEsperadaPorEdad,
    );
    const finDeCuenta = estado === "procesado"
      ? (procesado?.ultimaFecha ?? procesadoEnCompuesto?.ultimaFecha ?? hoy)
      : hoy;
    const ultimaFechaProcesado = procesado?.ultimaFecha ?? null;

    const pctProcesado = entrada.kg_entrada > 0 ? kgProcesado / entrada.kg_entrada : 0;
    const diasSinActividad = ultimaFechaProcesado ? diffDias(ultimaFechaProcesado, hoy) : null;
    const probablementeTerminado = estado === "parcial"
      && pctProcesado >= UMBRAL_PROBABLE_TERMINADO
      && diasSinActividad != null
      && diasSinActividad >= DIAS_SIN_ACTIVIDAD_TERMINADO;

    return {
      lote: entrada.lote,
      fecha_entrada: entrada.fecha,
      finca: entrada.finca ?? null,
      articulo: entrada.articulo ?? null,
      agricultor: entrada.agricultor ?? null,
      kg_entrada: entrada.kg_entrada,
      kg_procesado: kgProcesado,
      kg_en_camara: estado === "procesado" ? 0 : kgEnCamara,
      ultima_fecha_procesado: ultimaFechaProcesado,
      dias_en_camara: diffDias(entrada.fecha, finDeCuenta),
      estado,
      cerrado_at: entrada.cerrado_at ?? null,
      cierre_modo: entrada.cierre_modo ?? null,
      probablementeTerminado,
      cerradoConActividadPosterior: pasadasPosterioresAlCierre(entrada.cerrado_at ?? null, ultimaFechaProcesado),
      procesadoEnCompuesto,
      enCamaraConfirmada: Boolean(lotesConfirmadosEnCamara?.has(clave)),
      confirmacionCamara: confirmacionCamaraPorLote?.get(clave) ?? null,
      // Sin forzar por cierre/compuesto: refleja SOLO si la evidencia (kg sin
      // derrame) alcanza el umbral por edad. Es lo único que el candidato de
      // cierre automático acepta como "completo" (regla de oro).
      completoConEvidencia: estadoLotePorProcesado(
        entrada.kg_entrada,
        kgProcesadoConEvidencia,
        false,
        diasDesdeEntrada,
        fraccionEsperadaPorEdad,
      ) === "procesado",
    };
  });

  const activos = filas.filter((f) => f.estado !== "procesado");
  const probables = activos.filter((f) => f.probablementeTerminado);
  const firmes = activos.filter((f) => !f.probablementeTerminado);

  return {
    filas,
    kgEnCamara: activos.reduce((s, f) => s + f.kg_en_camara, 0),
    kgEnCamaraFirme: firmes.reduce((s, f) => s + f.kg_en_camara, 0),
    kgProbablementeTerminados: probables.reduce((s, f) => s + f.kg_en_camara, 0),
    lotesProbablementeTerminados: probables.length,
    lotesPendientes: filas.filter((f) => f.estado === "pendiente").length,
    lotesParciales: filas.filter((f) => f.estado === "parcial").length,
    antiguedadMaxDias: activos.reduce((max, f) => Math.max(max, f.dias_en_camara), 0),
    lotesCerradosConActividadPosterior: filas.filter((f) => f.cerradoConActividadPosterior),
  };
}

/**
 * Candidatos al cierre automático PERSISTIDO (refuerzo 2026-08-03, encargo
 * del dueño: "cuando pasa todo, se debe cerrar el lote y contarlo como
 * procesado"). Un lote es candidato cuando:
 *   - su estado derivado ya es "procesado"/COMPLETO (≥ UMBRAL_LOTE_COMPLETO,
 *     o calibradorSuperaEntrada — el pct ya lo cubre estadoLotePorProcesado:
 *     kgProcesado > kgEntrada da pct > 1 ≥ umbral, así que un lote inflado
 *     por un error de reparto también cierra, nunca se queda "colgado" solo
 *     por eso);
 *   - todavía NO está cerrado en BD (cerrado_at null) — si ya lo está, no hay
 *     nada que hacer;
 *   - tiene una última fecha de procesado CONOCIDA y lleva
 *     ≥ DIAS_SIN_ACTIVIDAD_AUTOCIERRE días sin ninguna pasada nueva.
 *
 * Los lotes SIN ultima_fecha_procesado (llegaron al umbral solo por
 * kg_ajuste_stock de conciliación con el informe de cámara, sin ninguna fila
 * de lotes_dia) se EXCLUYEN a propósito: sin una fecha de pasada no se puede
 * demostrar "sin actividad reciente", así que se dejan fuera del cierre
 * automático (quedan como procesados en el cálculo derivado igualmente, solo
 * que sin persistir cerrado_at) en vez de cerrarlos a ciegas.
 *
 * Función PURA: no escribe nada, solo decide. El caller (useEntradasBascula)
 * junta el resultado con el `id` real de entradas_bascula (StockLoteRow no lo
 * trae) y dispara la mutación de cierre existente (cerrarLotesEnBloque, modo
 * "con_analisis" fijo: a ≥97% procesado el hueco siempre es plausible como
 * merma/podrido real, ver criterioCierreModo).
 */
export function esCandidatoCierreAutomatico(
  fila: Pick<StockLoteRow, "estado" | "cerrado_at" | "ultima_fecha_procesado" | "enCamaraConfirmada" | "completoConEvidencia">,
  hoy: string,
): boolean {
  // Ground truth del dueño 04-08-2026 (nº2, prioridad máxima): un lote con
  // señal VIGENTE de "sigue en cámara" (externa o confirmación física) nunca
  // es candidato, aunque algo más (derrame, ajuste de stock...) le haya dado
  // kg y su estado ya sea "procesado" — es físicamente imposible que haya
  // pasado por el calibrador mientras sigue en Guadex/Zamexfruit o en la
  // cámara 5.
  if (fila.enCamaraConfirmada) return false;
  if (fila.estado !== "procesado") return false;
  // REGLA DE ORO (dueño, 04-08-2026, docs/TRAZABILIDAD_REFUNDACION.md): el
  // derrame no cierra lotes. Si el umbral solo se alcanza gracias a kg de
  // derrame (clase "derivado"), el lote NO es candidato aunque su estado
  // derivado pinte "procesado" — se queda visible en stock/cola manual.
  if (!fila.completoConEvidencia) return false;
  if (fila.cerrado_at) return false;
  if (!fila.ultima_fecha_procesado) return false;
  return diffDias(fila.ultima_fecha_procesado, hoy) >= DIAS_SIN_ACTIVIDAD_AUTOCIERRE;
}

/**
 * Candidatos al cierre automático PERSISTIDO por evidencia de pasada
 * COMPUESTA (refuerzo 04-ago-2026, encargo del dueño verificado contra la BD
 * real antes de escribir esta función — ver StockLoteRow.procesadoEnCompuesto
 * / detectarLotesEnPasadaCompuesta en conciliacionKg.ts): un lote con esa
 * evidencia, aún sin cerrar, con ≥ DIAS_SIN_ACTIVIDAD_AUTOCIERRE días desde
 * la ÚLTIMA pasada compuesta que lo menciona (deja asentarse un parte con
 * retraso, mismo margen que esCandidatoCierreAutomatico).
 *
 * A diferencia de esCandidatoCierreAutomatico, el cierre SIEMPRE debe ser
 * cierre_modo "sin_registro" (nunca "con_analisis"): su kg no consta bajo su
 * propio código — no es una pérdida real medible, es un artefacto de
 * trazabilidad — así que forzar "con_analisis" inventaría una merma que no
 * existe. El caller (useEntradasBascula) es quien fija ese modo al construir
 * el ítem para cerrarLotesEnBloque.
 *
 * Sin `ultimaFecha` (evidencia sin fecha en ninguna pasada) NUNCA es
 * candidato: no se puede demostrar el margen de 2 días, así que se deja para
 * revisión manual en vez de cerrar a ciegas.
 */
export function esCandidatoCierreCompuesto(
  fila: Pick<StockLoteRow, "cerrado_at" | "procesadoEnCompuesto" | "enCamaraConfirmada">,
  hoy: string,
): boolean {
  // Misma protección que esCandidatoCierreAutomatico (ground truth nº2,
  // 04-08-2026): un lote con señal vigente de cámara (externa o confirmación
  // física) nunca cierra solo.
  if (fila.enCamaraConfirmada) return false;
  if (fila.cerrado_at) return false;
  const evidencia = fila.procesadoEnCompuesto;
  if (!evidencia || !evidencia.ultimaFecha) return false;
  return diffDias(evidencia.ultimaFecha, hoy) >= DIAS_SIN_ACTIVIDAD_AUTOCIERRE;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

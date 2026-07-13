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

export interface EntradaBasculaParsed {
  fecha: string; // ISO "YYYY-MM-DD"
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

const UMBRAL_PROCESADO = 0.97;

function normalizeHeader(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Convierte "DD/MM/YYYY" (o Date/ISO) a "YYYY-MM-DD"; null si no es fecha. */
export function parseFechaBascula(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${value.getFullYear()}-${pad2(value.getMonth() + 1)}-${pad2(value.getDate())}`;
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

/**
 * Código de lote normalizado: los primeros 8 dígitos seguidos (AAMMDDNN).
 * El calibrador a veces guarda el lote con texto pegado ("26042712 + 7 BOX DE
 * RECICLAJE"); la báscula lo guarda limpio.
 */
export function normalizarLoteCodigo(value: string | null | undefined): string | null {
  const match = String(value ?? "").match(/\d{8}/);
  return match ? match[0] : null;
}

export interface LoteProcesadoInput {
  lote_codigo: string | null;
  kg_peso_total: number | null;
  /** Fecha del parte en que se procesó (si se conoce). */
  date?: string | null;
}

export type StockEstado = "pendiente" | "parcial" | "procesado";

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
}

export interface StockResumen {
  filas: StockLoteRow[];
  kgEnCamara: number;
  lotesPendientes: number;
  lotesParciales: number;
  /** Días del lote pendiente/parcial más antiguo. */
  antiguedadMaxDias: number;
}

function diffDias(desde: string, hasta: string): number {
  const [y1, m1, d1] = desde.split("-").map(Number);
  const [y2, m2, d2] = hasta.split("-").map(Number);
  const ms = Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1);
  return Math.max(0, Math.round(ms / 86400000));
}

export function buildStockEntradas(
  entradas: Array<Pick<EntradaBasculaParsed, "lote" | "fecha" | "kg_entrada" | "finca" | "articulo" | "agricultor">>,
  procesados: LoteProcesadoInput[],
  hoy: string,
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
    const kgProcesado = procesado?.kg ?? 0;
    const kgEnCamara = Math.max(0, entrada.kg_entrada - kgProcesado);
    const pct = entrada.kg_entrada > 0 ? kgProcesado / entrada.kg_entrada : 0;
    const estado: StockEstado = pct >= UMBRAL_PROCESADO ? "procesado" : pct > 0 ? "parcial" : "pendiente";
    const finDeCuenta = estado === "procesado" && procesado?.ultimaFecha ? procesado.ultimaFecha : hoy;

    return {
      lote: entrada.lote,
      fecha_entrada: entrada.fecha,
      finca: entrada.finca ?? null,
      articulo: entrada.articulo ?? null,
      agricultor: entrada.agricultor ?? null,
      kg_entrada: entrada.kg_entrada,
      kg_procesado: kgProcesado,
      kg_en_camara: estado === "procesado" ? 0 : kgEnCamara,
      ultima_fecha_procesado: procesado?.ultimaFecha ?? null,
      dias_en_camara: diffDias(entrada.fecha, finDeCuenta),
      estado,
    };
  });

  const activos = filas.filter((f) => f.estado !== "procesado");

  return {
    filas,
    kgEnCamara: activos.reduce((s, f) => s + f.kg_en_camara, 0),
    lotesPendientes: filas.filter((f) => f.estado === "pendiente").length,
    lotesParciales: filas.filter((f) => f.estado === "parcial").length,
    antiguedadMaxDias: activos.reduce((max, f) => Math.max(max, f.dias_en_camara), 0),
  };
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

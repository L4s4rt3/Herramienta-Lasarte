/**
 * historicoPalets.ts — parser del export histórico del programa de PALETS de
 * toda la campaña (archivo real: "palets 1sep 14 jul.xlsx", hoja "Sheet 1",
 * ~39.147 filas + cabecera en la fila 0):
 *
 *   [TipoPalet, NºPalet, Fecha, Denominación Producto, Lote, DcmtoVta,
 *    Fecha, Cliente, Cajas, TipoCaja, Netos, Fact., Sit]
 *
 * OJO: hay DOS columnas "Fecha" (verificado contra el archivo real): la
 * PRIMERA es la fecha de CONFECCIÓN del palet (la que importa aquí — es la
 * que se cruza con partes_diarios.date) y la SEGUNDA es la fecha de VENTA
 * (del albarán, puede ser posterior). Se localizan por ORDEN de aparición de
 * la cabecera "Fecha" (primera / segunda), no por posición fija, para que un
 * cambio de columnas en un futuro export no rompa el import en silencio.
 *
 * El código de LOTE viene en formato NN+AAMMDD (p.ej. "01251024" = lote 01
 * del 24/10/2025, verificado con 39.087 filas de 8 dígitos + 60 vacías; NN va
 * de "00" a "41" en el archivo real, no un rango pequeño fijo — un día puede
 * tener más de 15 lotes) y se convierte al formato canónico AAMMDD+NN
 * ("25102401") usado en el resto del repo (ver src/lib/loteCodigo.ts) con
 * `convertirLotePaletACanonico`. Las filas sin lote (60 en el archivo real)
 * NO se descartan: se importan igual con `lote_codigo: null` (el palet
 * existe, solo falta el dato de lote).
 */
import { parseFechaBascula } from "@/lib/entradasBascula";

export interface FilaInformePalets {
  /** NºPalet, como texto (id del palet en el programa de gestión). */
  palet_id: string;
  /** ISO "YYYY-MM-DD" — fecha de CONFECCIÓN (primera columna "Fecha"), no la de venta. */
  fecha: string;
  producto: string | null;
  /** Texto tal cual viene en la columna "Lote" (NN+AAMMDD), null si la fila no trae lote. */
  lote_codigo_crudo: string | null;
  /** Canónico AAMMDD+NN vía convertirLotePaletACanonico; null si no hay lote o no son 8 dígitos. */
  lote_codigo: string | null;
  /** null si la fila no trae cliente (palet aún no vendido/asignado). */
  cliente: string | null;
  n_cajas: number;
  kg_neto: number;
  /** "F" (facturado), "S" (sin facturar/stock), "A", o null si viene vacío. */
  situacion: string | null;
}

export interface ParseInformePaletsResult {
  filas: FilaInformePalets[];
  descartadas: Array<{ fila: number; motivo: string }>;
}

function normalizeHeader(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const text = String(value ?? "").trim();
  if (!text) return null;
  const parsed = Number(text.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function toText(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text ? text : null;
}

/**
 * Convención de lote del programa de palets: NN (2 dígitos, nº de lote del
 * día — va de "00" a "41" en el archivo real, no un rango fijo pequeño como
 * "01"-"15") + AAMMDD (6 dígitos) = 8 dígitos totales, p.ej. "01251024" (lote
 * 01 del 24/10/2025). Se reordena al canónico AAMMDD+NN ("25102401") que usa
 * el resto del repo (src/lib/loteCodigo.ts, entradas_bascula.lote,
 * lotes_dia.lote_codigo). Cualquier texto que no sean EXACTAMENTE 8 dígitos
 * (vacío, con letras, con separadores, longitud distinta) devuelve null: no
 * se adivina un código a partir de basura.
 */
export function convertirLotePaletACanonico(value: string | null | undefined): string | null {
  const text = String(value ?? "").trim();
  if (!/^\d{8}$/.test(text)) return null;
  const nn = text.slice(0, 2);
  const yymmdd = text.slice(2);
  return `${yymmdd}${nn}`;
}

/**
 * Parsea las filas (header:1, raw:true, workbook leído con cellDates:true)
 * del export histórico de palets. Localiza la cabecera por texto (tolerante
 * a que cambie el orden de columnas) y distingue las dos columnas "Fecha"
 * por orden de aparición: la primera es confección, la segunda es venta (no
 * se usa aquí).
 */
export function parseInformePaletsRows(rows: unknown[][]): ParseInformePaletsResult {
  const headerIndex = rows.findIndex((row) => {
    const headers = row.map(normalizeHeader);
    return (
      headers.includes("lote")
      && headers.includes("netos")
      && headers.includes("cajas")
      && headers.some((h) => h === "fecha")
    );
  });

  if (headerIndex === -1) {
    return {
      filas: [],
      descartadas: [{ fila: 0, motivo: "No se encontró la cabecera (Lote / Netos / Cajas / Fecha)" }],
    };
  }

  const headers = rows[headerIndex].map(normalizeHeader);
  const col = (name: string) => headers.indexOf(name);
  const fechaIndices: number[] = [];
  headers.forEach((h, i) => { if (h === "fecha") fechaIndices.push(i); });

  // Primera "Fecha" = confección (la que importa); segunda = venta (se
  // ignora hoy, pero se documenta el índice por si hiciera falta más
  // adelante en vez de tener que volver a buscarlo).
  const iFechaConfeccion = fechaIndices[0] ?? -1;
  const iNumPalet = col("n palet");
  const iProducto = col("denominacion producto");
  const iLote = col("lote");
  const iCliente = col("cliente");
  const iCajas = col("cajas");
  const iNetos = col("netos");
  const iSit = col("sit");

  const filas: FilaInformePalets[] = [];
  const descartadas: Array<{ fila: number; motivo: string }> = [];

  rows.slice(headerIndex + 1).forEach((row, offset) => {
    const filaNum = headerIndex + offset + 2; // 1-based, como lo ve el usuario en Excel
    const vacia = row.every((cell) => cell == null || String(cell).trim() === "");
    if (vacia) return;

    const paletIdRaw = iNumPalet === -1 ? null : row[iNumPalet];
    const paletId = paletIdRaw == null || String(paletIdRaw).trim() === "" ? null : String(paletIdRaw).trim();
    if (!paletId) {
      descartadas.push({ fila: filaNum, motivo: "Sin nº de palet" });
      return;
    }

    const fecha = iFechaConfeccion === -1 ? null : parseFechaBascula(row[iFechaConfeccion]);
    if (!fecha) {
      descartadas.push({ fila: filaNum, motivo: "Sin fecha de confección" });
      return;
    }

    const kgNeto = iNetos === -1 ? null : toNumber(row[iNetos]);
    if (kgNeto == null) {
      descartadas.push({ fila: filaNum, motivo: "Sin kg netos" });
      return;
    }

    const loteCrudo = iLote === -1 ? null : toText(row[iLote]);

    filas.push({
      palet_id: paletId,
      fecha,
      producto: iProducto === -1 ? null : toText(row[iProducto]),
      lote_codigo_crudo: loteCrudo,
      lote_codigo: convertirLotePaletACanonico(loteCrudo),
      cliente: iCliente === -1 ? null : toText(row[iCliente]),
      n_cajas: iCajas === -1 ? 0 : (toNumber(row[iCajas]) ?? 0),
      kg_neto: kgNeto,
      situacion: iSit === -1 ? null : toText(row[iSit]),
    });
  });

  return { filas, descartadas };
}

// ─── Resumen (preview de import y script de validación) ─────────────────────

export interface ResumenInformePalets {
  filasValidas: number;
  filasDescartadas: number;
  descartadasPorMotivo: Record<string, number>;
  kgNetoTotal: number;
  paletsUnicos: number;
  paletsConLote: number;
  paletsSinLote: number;
  clientesDistintos: number;
  fechaDesde: string | null;
  fechaHasta: string | null;
}

export function resumirInformePalets(resultado: ParseInformePaletsResult): ResumenInformePalets {
  const { filas, descartadas } = resultado;
  const fechas = filas.map((f) => f.fecha).sort();
  const paletsUnicos = new Set(filas.map((f) => f.palet_id)).size;
  const paletsConLote = filas.filter((f) => f.lote_codigo != null).length;
  const clientes = new Set(filas.filter((f) => f.cliente).map((f) => f.cliente as string));
  const descartadasPorMotivo: Record<string, number> = {};
  for (const d of descartadas) {
    descartadasPorMotivo[d.motivo] = (descartadasPorMotivo[d.motivo] ?? 0) + 1;
  }
  return {
    filasValidas: filas.length,
    filasDescartadas: descartadas.length,
    descartadasPorMotivo,
    kgNetoTotal: filas.reduce((s, f) => s + f.kg_neto, 0),
    paletsUnicos,
    paletsConLote,
    paletsSinLote: filas.length - paletsConLote,
    clientesDistintos: clientes.size,
    fechaDesde: fechas[0] ?? null,
    fechaHasta: fechas[fechas.length - 1] ?? null,
  };
}

/**
 * Normaliza un palet_id para CASAR con un registro existente (backfill):
 * quita ceros a la izquierda por si acaso (el export los trae siempre como
 * número puro, pero un id guardado a mano en palets_dia podría venir con
 * padding). No toca el resto del texto.
 */
export function normalizarPaletIdParaCasar(value: string | null | undefined): string {
  const text = String(value ?? "").trim();
  return text.replace(/^0+(?=\d)/, "");
}

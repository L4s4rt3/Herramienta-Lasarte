/**
 * mercadonaVentas.ts — parseo puro de los dos formatos de Excel que maneja Mercadona:
 *
 * 1) HISTORICO: "VENTAS SEMANA X PLATAFORMA ANTEQUERA.xlsx", una hoja por semana
 *    ("SEMANA 21".."SEMANA N"), con planificacion quincenal/semanal. Ver
 *    parseSemanaSheet mas abajo para el detalle fila a fila.
 *
 * 2) SEMANAL REAL: el que se sube cada semana en adelante (ej. "mercadona s27.xlsx"),
 *    UNA sola hoja ("Sheet 1" u otro nombre) con solo esta tabla, sin planificacion:
 *      Fila 0 (cabecera): Método | Descripción | Líneas | KILOS | UNID | LITROS | Base Iva
 *      Fila 1: metodo vacio, 4 lineas, 0 kg, Base Iva NEGATIVA -> fila de AJUSTES/ABONOS
 *      Filas 2-5: MA12KGC/MA3KGC/MA4KGC/MA5KGC con lineas, kilos y base_iva
 *    El numero de semana NO figura en la hoja: se infiere del nombre de archivo
 *    (regex /s(\d{1,2})/i, p.ej. "mercadona s27.xlsx" -> 27) y se confirma/edita en
 *    el preview de importacion. vendidoKg = suma de kilos de los metodos (sin la
 *    fila de ajustes, que no tiene kg). El planificado queda a null (se teclea a
 *    mano via el flujo "planificacion manual" ya existente).
 *
 * Los numeros vienen con formato es/en mezclado ("215,260" = 215260, con o sin
 * espacios) y porcentajes como texto ("19%", "-2%"). Algunas hojas no tienen la
 * columna "COMPARATIVA SEMANA ANTERIOR" y traen celdas basura sueltas en columnas
 * altas que deben ignorarse.
 */
import { endOfISOWeek, setISOWeek, setISOWeekYear, startOfISOWeek, subDays } from "date-fns";
import { formatDate, toISODateLocal } from "@/lib/format";

export type SheetRow = Array<string | number | null | undefined>;
export type SheetRows = SheetRow[];

export interface MetodoVenta {
  metodo: string;
  descripcion: string;
  pct: number | null;
  kilos: number;
  palets: number;
  cajas: number;
  comparativaAnteriorPct: number | null;
  /** Solo formato semanal real: nº de líneas de pedido del método. */
  lineas?: number | null;
  /** Solo formato semanal real: base IVA (€) facturada de ese método. */
  baseIva?: number | null;
}

export type MercadonaFormatoOrigen = "historico" | "semanal_real";

export interface ParsedSemana {
  anio: number;
  semana: number;
  rangoPlanificacion: string | null;
  planificadoQuincenaKg: number | null;
  planificadoSemanaKg: number | null;
  vendidoKg: number | null;
  diferenciaPct: number | null;
  notas: string[];
  metodos: MetodoVenta[];
  totales: { kilos: number; palets: number; cajas: number } | null;
  /** Formato de origen del Excel importado. */
  origen?: MercadonaFormatoOrigen;
  /** Solo formato semanal real: base IVA (€, negativa) de la fila de ajustes/abonos. */
  ajustesBaseIva?: number | null;
  /** Solo formato semanal real: nº de líneas de la fila de ajustes/abonos. */
  ajustesLineas?: number | null;
}

export interface ParseMercadonaWorkbookResult {
  semanas: ParsedSemana[];
  hojasIgnoradas: string[];
}

const METODOS_CONOCIDOS = ["MA12KGC", "MA3KGC", "MA4KGC", "MA5KGC"];

/**
 * Convierte un valor crudo de celda numerica a number, tolerando formatos
 * es/en mezclados: "215,260" -> 215260, " 40,703 " -> 40703, "1.234,56" -> 1234.56,
 * "19%" / "-2%" -> 19 / -2 (el signo % se ignora, se interpreta ya como valor pct).
 */
export function parseNumeroVentas(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;

  let text = String(value).trim();
  if (!text) return null;

  const isPercent = text.includes("%");
  text = text.replace(/%/g, "").trim();
  if (!text) return null;

  // Quita espacios (incluidos los "no-break") usados como separador de miles.
  text = text.replace(/[\s ]/g, "");
  if (!text) return null;

  const hasComma = text.includes(",");
  const hasDot = text.includes(".");

  let normalized = text;
  if (hasComma && hasDot) {
    // El separador decimal es el que aparece en ultima posicion.
    const lastComma = text.lastIndexOf(",");
    const lastDot = text.lastIndexOf(".");
    if (lastComma > lastDot) {
      // Formato es: "." miles, "," decimal -> "1.234,56"
      normalized = text.replace(/\./g, "").replace(",", ".");
    } else {
      // Formato en: "," miles, "." decimal -> "1,234.56"
      normalized = text.replace(/,/g, "");
    }
  } else if (hasComma) {
    // Solo coma: en estos excels la coma es SIEMPRE separador de miles
    // ("215,260" = 215260), nunca decimal (no hay ",5" en la fuente real).
    normalized = text.replace(/,/g, "");
  }
  // Solo punto (o ninguno): se deja tal cual (punto decimal estandar).

  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return null;
  return isPercent ? parsed : parsed;
}

/** Como parseNumeroVentas pero fuerza 0 en vez de null (para acumulados/sumas). */
export function parseNumeroVentasOrZero(value: unknown): number {
  return parseNumeroVentas(value) ?? 0;
}

/** Extrae el numero de semana de un nombre de hoja tipo "SEMANA 21" (case-insensitive). */
export function parseNombreHojaSemana(sheetName: string): number | null {
  const match = /semana\s*(\d{1,2})/i.exec(sheetName.trim());
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isFinite(n) && n >= 1 && n <= 53 ? n : null;
}

function cellText(row: SheetRow | undefined, index: number): string {
  const value = row?.[index];
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

/** Busca en una fila la primera celda (a partir de `from`) que parsee como numero. */
function firstNumberInRow(row: SheetRow | undefined, from = 0): number | null {
  if (!row) return null;
  for (let i = from; i < row.length; i++) {
    const n = parseNumeroVentas(row[i]);
    if (n !== null) return n;
  }
  return null;
}

/**
 * Parsea una hoja "SEMANA N" ya convertida a array-of-arrays (xlsx sheet_to_json
 * con header:1) al modelo ParsedSemana. anio se pasa desde fuera (el Excel no lo
 * declara, lo elige el usuario en el importador).
 */
export function parseSemanaSheet(rows: SheetRows, semana: number, anio: number): ParsedSemana {
  // Guiado por ETIQUETAS, no por índices de fila: el Excel real intercala filas
  // en blanco de forma distinta en cada hoja y los índices fijos leían celdas
  // equivocadas (p. ej. "ANTEQUERA II" como planificado o la cabecera como método).
  let rangoPlanificacion: string | null = null;
  let planificadoQuincenaKg: number | null = null;
  let planificadoSemanaDerivado: number | null = null;
  let planificadoSemanaEtiqueta: number | null = null;
  let vendidoKg: number | null = null;
  let diferenciaPct: number | null = null;
  let headerIdx = -1;
  const metodos: MetodoVenta[] = [];
  let totales: ParsedSemana["totales"] = null;
  const notas: string[] = [];

  rows.forEach((row, i) => {
    if (!row) return;
    const c0 = cellText(row, 0);
    const label = c0.toUpperCase();

    if (label.includes("NARANJAS TOTALES")) {
      rangoPlanificacion = cellText(row, 1) || null;
    } else if (label === "TOTAL GENERAL") {
      // Coincidencia exacta: la nota "EL TOTAL GENERAL SE DIVIDE ENTRE 2..."
      // también contiene la etiqueta pero no lleva número.
      planificadoQuincenaKg = firstNumberInRow(row, 1) ?? planificadoQuincenaKg;
    } else if (label.includes("HEMOS VENDIDO")) {
      vendidoKg = firstNumberInRow(row, 1);
    } else if (label.includes("HABIA PLANIFICADO")) {
      // La fila "SEMANA N HABIA PLANIFICADO | kg" es la fuente autorizada del
      // planificado semanal.
      planificadoSemanaEtiqueta = firstNumberInRow(row, 1);
    } else if (label.includes("AUMENTO") || label.includes("DESCENSO")) {
      diferenciaPct = firstNumberInRow(row, 1);
    } else if (label.startsWith("NOTA")) {
      const texto = row
        .map((cell) => (cell === null || cell === undefined ? "" : String(cell).trim()))
        .filter(Boolean)
        .join(" ")
        .trim();
      if (texto) notas.push(texto);
    } else if (label === "MÉTODO" || label === "METODO") {
      headerIdx = i;
    } else if (isMetodoConocido(c0)) {
      metodos.push({
        metodo: c0,
        descripcion: cellText(row, 1),
        pct: parseNumeroVentas(row[2]),
        kilos: parseNumeroVentasOrZero(row[3]),
        palets: parseNumeroVentasOrZero(row[4]),
        cajas: parseNumeroVentasOrZero(row[5]),
        comparativaAnteriorPct: parseNumeroVentas(row[6]),
      });
    } else if (!label && headerIdx === -1 && planificadoQuincenaKg !== null && planificadoSemanaDerivado === null) {
      // Entre "Total general" y la cabecera de métodos hay una fila sin etiqueta
      // con el total/2 (la planificación llega por quincenas).
      planificadoSemanaDerivado = firstNumberInRow(row, 0);
    } else if (!label && headerIdx !== -1 && metodos.length > 0 && totales === null) {
      // Fila de totales de la tabla de métodos (sin etiqueta en las 3 primeras
      // columnas, kilos en la 4ª).
      const kilos = parseNumeroVentas(row[3]);
      if (kilos !== null && kilos > 0) {
        totales = {
          kilos,
          palets: parseNumeroVentasOrZero(row[4]),
          cajas: parseNumeroVentasOrZero(row[5]),
        };
      }
    }
  });

  const planificadoSemanaKg = planificadoSemanaEtiqueta
    ?? planificadoSemanaDerivado
    ?? (planificadoQuincenaKg !== null ? planificadoQuincenaKg / 2 : null);

  return {
    anio,
    semana,
    rangoPlanificacion,
    planificadoQuincenaKg,
    planificadoSemanaKg,
    vendidoKg,
    diferenciaPct,
    notas,
    metodos,
    totales,
    origen: "historico",
  };
}

// ─── Formato SEMANAL REAL (una sola hoja, sin planificación) ─────────────────

/**
 * Detecta si una hoja es del formato "semanal real": cabecera con Método +
 * Descripción + Líneas + KILOS (en cualquiera de las primeras filas, por si
 * hay alguna fila en blanco antes). Devuelve el índice de la fila de cabecera
 * o null si no matchea.
 */
export function detectarCabeceraSemanalReal(rows: SheetRows): number | null {
  for (let i = 0; i < Math.min(rows.length, 5); i++) {
    const row = rows[i];
    if (!row) continue;
    const cells = row.map((c) => cellTextValue(c).toUpperCase());
    const hasMetodo = cells.some((c) => c.startsWith("MÉTODO") || c.startsWith("METODO"));
    const hasDescripcion = cells.some((c) => c.startsWith("DESCRIP"));
    const hasLineas = cells.some((c) => c.startsWith("LÍNEA") || c.startsWith("LINEA"));
    const hasKilos = cells.some((c) => c.startsWith("KILOS") || c === "KG");
    if (hasMetodo && hasDescripcion && hasLineas && hasKilos) return i;
  }
  return null;
}

function cellTextValue(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

/** Extrae el nº de semana de un nombre de archivo tipo "mercadona s27.xlsx" (case-insensitive). */
export function parseNombreArchivoSemana(fileName: string): number | null {
  const match = /s[\s_-]?(\d{1,2})(?!\d)/i.exec(fileName);
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isFinite(n) && n >= 1 && n <= 53 ? n : null;
}

/**
 * Parsea la hoja unica del formato "semanal real": Método | Descripción | Líneas |
 * KILOS | UNID | LITROS | Base Iva. La primera fila de datos (metodo vacio, 0 kg,
 * base iva negativa) es la fila de AJUSTES/ABONOS y se extrae aparte; el resto de
 * filas son los metodos conocidos (o cualquier codigo con kilos > 0).
 * semana/anio se pasan desde fuera: el Excel no declara el numero de semana,
 * se infiere del nombre de archivo (parseNombreArchivoSemana) y se confirma a
 * mano en el preview de importacion.
 */
export function parseSemanaSheetSemanalReal(rows: SheetRows, semana: number, anio: number): ParsedSemana {
  const headerIdx = detectarCabeceraSemanalReal(rows) ?? 0;
  const header = rows[headerIdx] ?? [];
  const colIndex = (predicate: (upper: string) => boolean, fallback: number): number => {
    const idx = header.findIndex((c) => predicate(cellTextValue(c).toUpperCase()));
    return idx === -1 ? fallback : idx;
  };

  const colMetodo = colIndex((c) => c.startsWith("MÉTODO") || c.startsWith("METODO"), 0);
  const colDescripcion = colIndex((c) => c.startsWith("DESCRIP"), 1);
  const colLineas = colIndex((c) => c.startsWith("LÍNEA") || c.startsWith("LINEA"), 2);
  const colKilos = colIndex((c) => c.startsWith("KILOS") || c === "KG", 3);
  const colBaseIva = colIndex((c) => c.startsWith("BASE"), 6);

  const metodos: MetodoVenta[] = [];
  let ajustesBaseIva: number | null = null;
  let ajustesLineas: number | null = null;

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;
    const metodoRaw = cellText(row, colMetodo);
    const lineas = parseNumeroVentas(row[colLineas]);
    const kilos = parseNumeroVentasOrZero(row[colKilos]);
    const baseIva = parseNumeroVentas(row[colBaseIva]);

    // Si toda la fila esta vacia, se ignora (filas en blanco al final).
    if (!metodoRaw && lineas === null && kilos === 0 && baseIva === null) continue;

    if (!metodoRaw && kilos === 0) {
      // Fila de ajustes/abonos: sin metodo, sin kg, base iva (normalmente negativa).
      ajustesBaseIva = baseIva;
      ajustesLineas = lineas;
      continue;
    }

    if (!metodoRaw) continue;

    metodos.push({
      metodo: metodoRaw,
      descripcion: cellText(row, colDescripcion),
      pct: null,
      kilos,
      palets: 0,
      cajas: 0,
      comparativaAnteriorPct: null,
      lineas,
      baseIva,
    });
  }

  const vendidoKg = metodos.reduce((s, m) => s + (m.kilos || 0), 0);
  const totales = metodos.length > 0 ? { kilos: vendidoKg, palets: 0, cajas: 0 } : null;

  return {
    anio,
    semana,
    rangoPlanificacion: null,
    planificadoQuincenaKg: null,
    planificadoSemanaKg: null,
    vendidoKg,
    diferenciaPct: null,
    notas: [],
    metodos,
    totales,
    origen: "semanal_real",
    ajustesBaseIva,
    ajustesLineas,
  };
}

/**
 * Parsea un libro completo autodetectando el formato de cada hoja:
 *  - hojas cuyo nombre matchea "SEMANA N" -> formato historico (parseSemanaSheet).
 *  - hoja unica (o varias) con cabecera Método/Descripción/Líneas/KILOS -> formato
 *    semanal real (parseSemanaSheetSemanalReal); el numero de semana se infiere de
 *    fileNameHint (nombre del archivo subido) y puede no coincidir siempre, por eso
 *    el importador debe dejarlo editable en el preview.
 * Cualquier otra hoja (portadas, resumenes) se descarta.
 */
export function parseMercadonaWorkbook(
  sheets: Record<string, SheetRows>,
  anio: number,
  fileNameHint?: string,
): ParseMercadonaWorkbookResult {
  const semanas: ParsedSemana[] = [];
  const hojasIgnoradas: string[] = [];
  const semanaDelArchivo = fileNameHint ? parseNombreArchivoSemana(fileNameHint) : null;

  for (const [sheetName, rows] of Object.entries(sheets)) {
    const semanaHistorico = parseNombreHojaSemana(sheetName);
    if (semanaHistorico !== null) {
      semanas.push(parseSemanaSheet(rows, semanaHistorico, anio));
      continue;
    }

    if (detectarCabeceraSemanalReal(rows) !== null) {
      const semana = semanaDelArchivo ?? parseNombreHojaSemana(sheetName) ?? 0;
      semanas.push(parseSemanaSheetSemanalReal(rows, semana, anio));
      continue;
    }

    hojasIgnoradas.push(sheetName);
  }

  semanas.sort((a, b) => a.semana - b.semana);
  return { semanas, hojasIgnoradas };
}

export function isMetodoConocido(metodo: string): boolean {
  return METODOS_CONOCIDOS.includes(metodo.toUpperCase());
}

/**
 * Rango de fechas [desde, hasta] ("YYYY-MM-DD") de una semana ISO dada. Se usa
 * para cruzar una semana de Mercadona con partes_diarios/producto_dia (que estan
 * indexados por fecha calendario) via useMercadona/useAnalisisDiario.
 */
export function isoWeekDateRange(anio: number, semana: number): { desde: string; hasta: string } {
  const base = setISOWeekYear(setISOWeek(new Date(anio, 0, 4, 12, 0, 0), semana), anio);
  const desde = startOfISOWeek(base);
  const hasta = endOfISOWeek(base);
  return { desde: toISODateLocal(desde), hasta: toISODateLocal(hasta) };
}

/**
 * Rango de fechas [desde, hasta] ("YYYY-MM-DD") de la semana de MERCADONA, que va
 * de LUNES A SABADO (6 dias, sin domingo) — a diferencia de la semana ISO completa
 * (lunes a domingo) que usa isoWeekDateRange. Usar esta version en cualquier cruce
 * con datos internos (aprovechamiento MDNA, mejores dias, top productores): el
 * domingo no cuenta para Mercadona y no debe filtrarse ni promediarse con el.
 */
export function mercadonaWeekDateRange(anio: number, semana: number): { desde: string; hasta: string } {
  const { desde } = isoWeekDateRange(anio, semana);
  const base = setISOWeekYear(setISOWeek(new Date(anio, 0, 4, 12, 0, 0), semana), anio);
  const hasta = subDays(endOfISOWeek(base), 1); // domingo - 1 dia = sabado
  return { desde, hasta: toISODateLocal(hasta) };
}

/**
 * Etiqueta legible del rango semanal de Mercadona, p.ej. "30 jun – 5 jul (L-S)".
 */
export function formatMercadonaWeekRangeLabel(anio: number, semana: number): string {
  const { desde, hasta } = mercadonaWeekDateRange(anio, semana);
  // formatDate da "30 jun 2026": se quita el año y el cero inicial del día ("30 jun", "5 jul").
  const stripYear = (s: string) => s.replace(/\s+\d{4}$/, "").replace(/^0/, "");
  const desdeLabel = stripYear(formatDate(desde));
  const hastaLabel = stripYear(formatDate(hasta));
  return `${desdeLabel} – ${hastaLabel} (L-S)`;
}

// ─── Export: reconstruir el Excel original a partir de una semana guardada ────

export interface MercadonaSemanaExport {
  anio: number;
  semana: number;
  rangoPlanificacion: string | null;
  planificadoQuincenaKg: number | null;
  planificadoSemanaKg: number | null;
  vendidoKg: number | null;
  diferenciaPct: number | null;
  notas: string[];
  metodos: MetodoVenta[];
}

/**
 * Reconstruye las filas (array-of-arrays) con la MISMA disposicion que el Excel
 * original de Mercadona, para exportar un libro fiel a la fuente. Usado por
 * mercadona export junto con appendAoaSheet (src/lib/exportWorkbook.ts).
 */
export function buildSemanaExportRows(data: MercadonaSemanaExport): SheetRows {
  const rows: SheetRows = [];
  rows.push(["PLANIFICACION VENTAS RECIBIDA DE MERCADONA"]);
  rows.push(["NARANJAS TOTALES", data.rangoPlanificacion ?? ""]);
  rows.push(["ANTEQUERA II", null]);
  rows.push(["ANTEQUERA VERDURA", null]);
  rows.push(["Total general", data.planificadoQuincenaKg ?? null]);
  rows.push([null, data.planificadoSemanaKg ?? null]);
  rows.push(["EL TOTAL GENERAL SE DIVIDE ENTRE 2 YA QUE LA PLANIFICACION LLEGA POR QUINCENAS"]);
  rows.push(["Metodo", "Descripcion", "PORCENTAJE", "KILOS", "PALETS", "CAJAS", "COMPARATIVA SEMANA ANTERIOR"]);

  const metodoByCodigo = new Map(data.metodos.map((m) => [m.metodo.toUpperCase(), m]));
  for (const codigo of METODOS_CONOCIDOS) {
    const m = metodoByCodigo.get(codigo);
    rows.push([
      codigo,
      m?.descripcion ?? "",
      m?.pct ?? null,
      m?.kilos ?? null,
      m?.palets ?? null,
      m?.cajas ?? null,
      m?.comparativaAnteriorPct ?? null,
    ]);
  }

  const totalKilos = data.metodos.reduce((s, m) => s + (m.kilos || 0), 0);
  const totalPalets = data.metodos.reduce((s, m) => s + (m.palets || 0), 0);
  const totalCajas = data.metodos.reduce((s, m) => s + (m.cajas || 0), 0);
  rows.push([null, "TOTAL", null, totalKilos, totalPalets, totalCajas, null]);

  rows.push([`SEMANA ${data.semana} HEMOS VENDIDO`, data.vendidoKg ?? null]);
  rows.push([`SEMANA ${data.semana} HABIA PLANIFICADO`, data.planificadoSemanaKg ?? null]);
  const diferenciaKg = (data.vendidoKg ?? 0) - (data.planificadoSemanaKg ?? 0);
  const tendencia = (data.diferenciaPct ?? 0) >= 0 ? "AUMENTO DEL" : "DESCENSO DEL";
  rows.push([tendencia, data.diferenciaPct ?? null, diferenciaKg]);

  for (const nota of data.notas) {
    rows.push([nota]);
  }

  return rows;
}

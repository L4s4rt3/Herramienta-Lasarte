/**
 * mercadonaVentas.ts — parseo puro del Excel semanal "VENTAS SEMANA X PLATAFORMA
 * ANTEQUERA.xlsx" que el dueño importa cada semana. Una hoja por semana ("SEMANA 21"..).
 *
 * Estructura real de cada hoja (0-indexed):
 *  0: "PLANIFICACION VENTAS RECIBIDA DE MERCADONA"
 *  1: "NARANJAS TOTALES" + rango quincenal ("18 May - 31 May")
 *  2: "ANTEQUERA II" + kg
 *  3: "ANTEQUERA VERDURA" + kg
 *  4: "Total general" + kg (planificacion QUINCENAL)
 *  5: total/2 (planificacion SEMANAL, la planificacion llega por quincenas)
 *  6: nota "EL TOTAL GENERAL SE DIVIDE ENTRE 2..."
 *  7: cabecera tabla: Metodo | Descripcion | PORCENTAJE | KILOS | PALETS | CAJAS | COMPARATIVA SEMANA ANTERIOR
 *  8-11: MA12KGC / MA3KGC / MA4KGC / MA5KGC con pct, kilos, palets, cajas, comparativa pct
 *  12: totales (kilos, palets, cajas)
 *  13-15: "...HEMOS VENDIDO" kg | "...HABIA PLANIFICADO" kg | "AUMENTO DEL/DESCENSO DEL" pct + diferencia kg
 *  resto: "NOTA; ..." texto libre
 *
 * Los numeros vienen con formato es/en mezclado ("215,260" = 215260, con o sin
 * espacios) y porcentajes como texto ("19%", "-2%"). Algunas hojas no tienen la
 * columna "COMPARATIVA SEMANA ANTERIOR" y traen celdas basura sueltas en columnas
 * altas que deben ignorarse.
 */
import { endOfISOWeek, setISOWeek, setISOWeekYear, startOfISOWeek } from "date-fns";
import { toISODateLocal } from "@/lib/format";

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
}

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
  // Fila 1: rango de planificacion quincenal ("NARANJAS TOTALES" | "18 May - 31 May").
  const rangoPlanificacion = cellText(rows[1], 1) || null;

  // Fila 4: "Total general" + kg quincenal.
  const planificadoQuincenaKg = firstNumberInRow(rows[4], 1);

  // Fila 5: total/2 -> planificacion semanal. Si no esta escrita explicitamente
  // se deriva de la quincenal.
  const planificadoSemanaKgFila = firstNumberInRow(rows[5], 1);
  const planificadoSemanaKg = planificadoSemanaKgFila ?? (
    planificadoQuincenaKg !== null ? planificadoQuincenaKg / 2 : null
  );

  // Fila 7: cabecera de la tabla de metodos (puede o no traer "COMPARATIVA...").
  // Filas 8-11: los 4 metodos conocidos, en ese orden fijo.
  const metodos: MetodoVenta[] = [];
  for (let i = 8; i <= 11; i++) {
    const row = rows[i];
    if (!row) continue;
    const metodo = cellText(row, 0);
    if (!metodo) continue;
    metodos.push({
      metodo,
      descripcion: cellText(row, 1),
      pct: parseNumeroVentas(row[2]),
      kilos: parseNumeroVentasOrZero(row[3]),
      palets: parseNumeroVentasOrZero(row[4]),
      cajas: parseNumeroVentasOrZero(row[5]),
      comparativaAnteriorPct: parseNumeroVentas(row[6]),
    });
  }

  // Fila 12: totales de la tabla de metodos.
  const totalesRow = rows[12];
  const totales = totalesRow
    ? {
        kilos: parseNumeroVentasOrZero(totalesRow[3]),
        palets: parseNumeroVentasOrZero(totalesRow[4]),
        cajas: parseNumeroVentasOrZero(totalesRow[5]),
      }
    : null;

  // Filas 13-15: vendido / planificado / aumento-descenso. Se buscan por
  // contenido (no por indice fijo) porque alguna hoja puede desplazar 1 fila.
  let vendidoKg: number | null = null;
  let planificadoSemanaKgFallback: number | null = null;
  let diferenciaPct: number | null = null;
  const notas: string[] = [];

  for (let i = 13; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;
    const label = cellText(row, 0).toUpperCase();
    if (!label) continue;

    if (label.includes("HEMOS VENDIDO")) {
      vendidoKg = firstNumberInRow(row, 1);
    } else if (label.includes("HABIA PLANIFICADO")) {
      // Respaldo: si la cabecera (fila 4/5) no trajo el dato, se usa esta fila.
      planificadoSemanaKgFallback = firstNumberInRow(row, 1);
    } else if (label.includes("AUMENTO") || label.includes("DESCENSO")) {
      diferenciaPct = firstNumberInRow(row, 1);
    } else if (label.startsWith("NOTA")) {
      const texto = row
        .map((cell) => (cell === null || cell === undefined ? "" : String(cell).trim()))
        .filter(Boolean)
        .join(" ")
        .trim();
      if (texto) notas.push(texto);
    }
  }

  return {
    anio,
    semana,
    rangoPlanificacion,
    planificadoQuincenaKg,
    planificadoSemanaKg: planificadoSemanaKg ?? planificadoSemanaKgFallback,
    vendidoKg,
    diferenciaPct,
    notas,
    metodos,
    totales,
  };
}

/**
 * Parsea un libro completo: recorre todas las hojas cuyo nombre matchea
 * "SEMANA N" y descarta el resto (hojas de portada, resumenes, etc. si las hubiera).
 */
export function parseMercadonaWorkbook(
  sheets: Record<string, SheetRows>,
  anio: number,
): ParseMercadonaWorkbookResult {
  const semanas: ParsedSemana[] = [];
  const hojasIgnoradas: string[] = [];

  for (const [sheetName, rows] of Object.entries(sheets)) {
    const semana = parseNombreHojaSemana(sheetName);
    if (semana === null) {
      hojasIgnoradas.push(sheetName);
      continue;
    }
    semanas.push(parseSemanaSheet(rows, semana, anio));
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

import type { StatusKey } from "./types";

const NUMERIC_RE = /^-?\d{1,3}([.,]\d{3})*([.,]\d+)?%?$|^-?\d+([.,]\d+)?%?$/;
const STATUS_HEADER_KEYWORDS = ["estado", "status", "situacion", "situación", "sit."];

const NUMERIC_HEADER_HINTS = [
  "kg", "peso", "kilo", "kilos", "cantidad", "cajas", "piezas", "palets",
  "neto", "bruto", "total", "subtotal", "importe", "€", "eur", "euro",
  "%", "precio", "valor", "media", "medio", "promedio", "ratio",
  "t/h", "kg/h", "th", "horas", "min", "minutos", "seg", "segundos",
  "fact", "facturad", "cobr", "pago", "cost", "gast",
];

const STATUS_KEYWORDS: Array<[string[], StatusKey]> = [
  [["activo", "validado", "aprobado", "ok", "completado"], "success"],
  [["cerrado", "finalizado", "hecho"], "info"],
  [["pendiente", "espera", "en curso", "procesando"], "warning"],
  [["error", "rechazado", "cancelado", "fallo", "falló"], "destructive"],
];

export function isNumericCell(value: string | null | undefined): boolean {
  if (!value) return false;
  return NUMERIC_RE.test(value.trim());
}

export function isNumericColumn(rows: string[][], colIdx: number): boolean {
  let numeric = 0;
  let total = 0;
  for (const row of rows) {
    const cell = row[colIdx];
    if (!cell || !cell.trim()) continue;
    total++;
    if (isNumericCell(cell)) numeric++;
  }
  if (total > 0 && numeric / total > 0.5) return true;
  return false;
}

export function numericHeaderHint(header: string): boolean {
  const normalized = header.trim().toLowerCase();
  if (!normalized) return false;
  return NUMERIC_HEADER_HINTS.some((hint) => normalized.includes(hint));
}

export function columnMaxWidth(
  header: string,
  rows: string[][],
  colIdx: number,
  cap = 14
): string {
  const lengths: number[] = [header.length];
  for (const row of rows) {
    const cell = row[colIdx];
    if (!cell) continue;
    lengths.push(cell.length);
  }
  if (lengths.length === 0) return `${Math.min(header.length * 0.45 + 1.5, cap)}rem`;
  lengths.sort((a, b) => a - b);
  // Usar percentil 90 en vez de máximo para evitar que un outlier estire la columna
  const p90Idx = Math.floor(lengths.length * 0.9);
  const p90Len = lengths[Math.min(p90Idx, lengths.length - 1)];
  const remBased = Math.min(p90Len * 0.45 + 1.5, cap);
  return `${remBased}rem`;
}

interface FormatNumberOptions {
  isPercent?: boolean;
}

export function formatNumber(
  value: number | null | undefined,
  options: FormatNumberOptions = {}
): string {
  if (value === null || value === undefined) return "";
  if (Number.isNaN(value)) return "";
  const suffix = options.isPercent ? "%" : "";
  const rounded = Math.round(value * 1000) / 1000;
  const fixed = rounded.toFixed(3);
  const trimmed = fixed
    .replace(/(\.\d*?)0+$/, "$1")
    .replace(/\.$/, "");
  const [intPart, decPart] = trimmed.split(".");
  const intFormatted = formatThousands(parseInt(intPart, 10));
  if (decPart && decPart.length > 0) {
    return `${intFormatted},${decPart}${suffix}`;
  }
  return `${intFormatted}${suffix}`;
}

function formatThousands(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  return sign + abs.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

export function formatDate(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return "";
    return formatDateParts(value);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return "";

    if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(trimmed)) {
      return trimmed.slice(0, 5);
    }

    const dateOnly = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(trimmed);
    if (dateOnly) {
      const [, y, m, d] = dateOnly;
      return `${d.padStart(2, "0")}/${m.padStart(2, "0")}/${y}`;
    }

    const dateTime = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})[T ](\d{1,2}):(\d{2})/.exec(trimmed);
    if (dateTime) {
      const [, y, m, d, h, min] = dateTime;
      const hNum = parseInt(h, 10);
      const mNum = parseInt(min, 10);
      const dateStr = `${d.padStart(2, "0")}/${m.padStart(2, "0")}/${y}`;
      if (hNum !== 0 || mNum !== 0) {
        return `${dateStr} ${h.padStart(2, "0")}:${min}`;
      }
      return dateStr;
    }

    return trimmed;
  }
  return String(value);
}

function formatDateParts(d: Date): string {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getFullYear()}`;
}

export function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return formatNumber(value);
  if (typeof value === "boolean") return value ? "Sí" : "No";
  if (value instanceof Date) return formatDate(value);
  return String(value);
}

export function isStatusColumn(header: string): boolean {
  const normalized = header.trim().toLowerCase();
  if (!normalized) return false;
  return STATUS_HEADER_KEYWORDS.some((kw) => normalized === kw || normalized.startsWith(kw + " "));
}

export function matchStatus(value: string): StatusKey {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return "muted";
  for (const [keywords, key] of STATUS_KEYWORDS) {
    if (keywords.some((kw) => normalized.includes(kw))) return key;
  }
  return "muted";
}

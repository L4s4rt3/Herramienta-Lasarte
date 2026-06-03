import * as XLSX from "xlsx";

export interface SheetData { name: string; headers: string[]; rows: string[][] }

export function formatSize(bytes: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatCell(cell: unknown): string {
  if (cell == null) return "";
  if (cell instanceof Date) {
    const d = cell as Date;
    if (!isNaN(d.getTime())) {
      return d.toLocaleDateString("es-ES", {
        day: "2-digit", month: "2-digit", year: "numeric",
      }) + " " + d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
    }
    return "";
  }
  return String(cell).trim();
}

export function repairXlsx(buf: Uint8Array): Uint8Array {
  let start = 0;
  while (start < buf.length - 4) {
    const b0 = buf[start], b1 = buf[start + 1], b2 = buf[start + 2], b3 = buf[start + 3];
    if (b0 === 0x50 && b1 === 0x4b && b2 === 0x03 && b3 === 0x04) break;
    start++;
  }
  const cleaned = start > 0 ? buf.slice(start) : buf;
  const bytes = new Uint8Array(cleaned);

  for (let i = 0; i < bytes.length - 30; i++) {
    if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && (bytes[i + 2] === 0x03 || bytes[i + 2] === 0x01) && bytes[i + 3] === 0x04) {
      const method = bytes[i + 8] | (bytes[i + 9] << 8);
      if (method === 9) { bytes[i + 8] = 8; bytes[i + 9] = 0; }
    }
  }

  let eocdPos = -1;
  const searchStart = Math.max(0, bytes.length - 66000);
  for (let i = bytes.length - 22; i >= searchStart; i--) {
    if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 0x05 && bytes[i + 3] === 0x06) {
      eocdPos = i; break;
    }
  }
  if (eocdPos < 0) {
    const eocd = new Uint8Array(22);
    eocd[0] = 0x50; eocd[1] = 0x4b; eocd[2] = 0x05; eocd[3] = 0x06;
    const out = new Uint8Array(bytes.length + 22);
    out.set(bytes); out.set(eocd, bytes.length);
    return out;
  }
  return bytes;
}

export function parseWorkbookToSheets(wb: XLSX.WorkBook): SheetData[] {
  return wb.SheetNames.map((name) => {
    const ws = wb.Sheets[name];
    const json = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "", raw: true });
    const headers = json.length > 0 ? json[0].map((h) => formatCell(h)) : [];
    const rows = json.slice(1).map((row) => row.map((c) => formatCell(c)));
    return { name, headers, rows };
  });
}

export function isValidContent(sheets: SheetData[]): boolean {
  if (sheets.length === 0) return false;
  for (const sheet of sheets) {
    let cellsWithContent = 0;
    let suspicious = 0;
    const check = (c: string) => {
      const t = c?.trim() ?? "";
      if (!t) return;
      cellsWithContent++;
      if (t.length > 80 || /^[A-F0-9]{16,}$/i.test(t) || /^[A-Za-z0-9+/=]{24,}$/.test(t)) {
        suspicious++;
      }
    };
    for (const h of sheet.headers) check(h);
    for (const row of sheet.rows) for (const cell of row) check(cell);
    if (cellsWithContent >= 3 && suspicious / cellsWithContent < 0.3) return true;
  }
  return false;
}

// Detecta si una columna es mayoritariamente numérica
export function isNumericColumn(rows: string[][], colIdx: number): boolean {
  let numeric = 0;
  let total = 0;
  for (const row of rows) {
    const cell = row[colIdx];
    if (!cell || !cell.trim()) continue;
    total++;
    if (/^-?\d{1,3}([.,]\d{3})*([.,]\d+)?%?$|^-?\d+([.,]\d+)?%?$/.test(cell.trim())) {
      numeric++;
    }
  }
  return total > 0 && numeric / total > 0.5;
}

const UI_CONTROL_RE = /filtros?|fecha de lote/i;

const MODULE_VARIANT_HEADERS: Record<string, string[]> = {
  palets: [
    "Tipo Palet", "N.º Palet", "Fecha", "Cliente", "Producto",
    "Lote", "Cajas", "Tipo caja", "Netos (kg)", "Facturación", "Situación",
  ],
  produccion: [
    "Lote", "Productor", "Variedad", "Inicio", "Hora máquina",
    "Peso (kg)", "T/h", "Peso medio fruta", "Estado",
  ],
  producto: [
    "Producto", "Empaque", "Empaques", "Peso (kg)", "Fruta",
    "Peso medio empaque", "Conteo medio", "Estado",
  ],
  tamanos: [
    "Grupo", "Total (kg)", "Exportación", "Mujeres(L)", "2ª", "3ª",
    "No comercial/Industria", "Podrido",
  ],
};

function detectModuleVariant(fileName: string): string | null {
  const name = fileName.toLowerCase();
  if (name.includes("palet")) return "palets";
  if (name.includes("produccion") || name.includes("producción") || name.includes("lotes")) return "produccion";
  if (name.includes("producto") || name.includes("empaque")) return "producto";
  if (name.includes("tamano") || name.includes("tamaño") || name.includes("calibre")) return "tamanos";
  return null;
}

function detectModuleVariantByRow(firstRow: string[]): string | null {
  const joined = firstRow.join(" ").toLowerCase();
  if (joined.includes("palet") && joined.includes("cliente")) return "palets";
  if (joined.includes("productor") && joined.includes("t/h")) return "produccion";
  if (joined.includes("empaque") && joined.includes("peso")) return "producto";
  if (joined.includes("grupo") && joined.includes("exportación")) return "tamanos";
  return null;
}

export interface Metric { label: string; value: string; priority: number }
export interface DataTable { section: string; headers: string[]; rows: string[][] }

export function parseSheetToStructured(sheet: SheetData, fileName: string): {
  metrics: Metric[]; tables: DataTable[]; title: string; subtitle: string;
} {
  const { headers, rows } = sheet;
  const metrics: Metric[] = [];
  const tables: DataTable[] = [];
  let title = sheet.name || "Hoja";
  let subtitle = "";

  if (headers.length > 0 && rows.length > 0) {
    const firstCell = headers[0] ?? "";
    const lastRow = rows[rows.length - 1];
    const lastRowJoined = lastRow.map((c) => c?.trim?.() ?? "").filter(Boolean).join(" ");
    if (
      /total|sum|promedio|media/i.test(lastRowJoined) &&
      rows.length > 1
    ) {
      subtitle = lastRowJoined;
    }
  }

  for (let ri = 0; ri < rows.length; ri++) {
    const row = rows[ri];
    const first = (row[0] ?? "").trim();
    const second = (row[1] ?? "").trim();
    if (first && second && !isNaN(Number(second.replace(/[.,]\s]/g, "").replace(",", "."))) && row.slice(2).every((c) => !c?.trim?.())) {
      metrics.push({ label: first, value: second, priority: 0 });
      rows.splice(ri, 1);
      ri--;
    }
  }

  if (metrics.length > 0) {
    metrics.sort((a, b) => a.priority - b.priority);
  }

  if (headers.length > 0) {
    tables.push({ section: "", headers: headers.map((h) => h || ""), rows });
  }

  return { metrics, tables, title, subtitle };
}

export async function loadExcelFile(filePath: string): Promise<{
  sheets: SheetData[]; blob: Blob; fileName: string; fileSize: number | null;
}> {
  const { supabase } = await import("@/integrations/supabase/client");

  const { data, error: dlError } = await supabase.storage
    .from("partes-archivos")
    .download(filePath);

  if (dlError || !data) throw new Error(dlError?.message ?? "No se pudo descargar el archivo");

  const blob = data;
  const buffer = await data.arrayBuffer();
  const bytes = new Uint8Array(buffer);

  const cleanBytes = repairXlsx(bytes);
  let parsed: SheetData[] = [];

  for (const opts of [
    { type: "array" } as const,
    { type: "array", cellDates: true, cellNF: false } as const,
    { type: "array", raw: true } as const,
    { type: "array", dense: true, cellDates: true, raw: true } as const,
  ]) {
    if (isValidContent(parsed)) break;
    try {
      const wb = XLSX.read(cleanBytes, opts);
      const result = parseWorkbookToSheets(wb);
      if (isValidContent(result)) parsed = result;
    } catch { /* next */ }
  }

  if (!isValidContent(parsed)) {
    const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    if (text.includes(",") || text.includes(";") || text.includes("\t")) {
      const sep = text.includes(";") ? ";" : text.includes("\t") ? "\t" : ",";
      const lines = text.split(/\r?\n/).filter((l) => l.trim());
      if (lines.length >= 2) {
        const headers = lines[0].split(sep).map((h) => h.trim());
        const dataRows = lines.slice(1).map((l) => l.split(sep).map((c) => c.trim()));
        parsed = [{ name: "CSV", headers, rows: dataRows }];
      }
    }
  }

  if (!isValidContent(parsed)) {
    const looksLikeZip = bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
    let hint = "";
    if (looksLikeZip) hint = " El archivo ZIP/XLSX está corrupto. Ábrelo en Excel y guárdalo de nuevo.";
    else hint = " El archivo no parece un Excel válido.";
    throw new Error(`No se pudo leer el archivo.${hint}`);
  }

  return {
    sheets: parsed,
    blob,
    fileName: filePath.split("/").pop() ?? "Archivo",
    fileSize: null,
  };
}

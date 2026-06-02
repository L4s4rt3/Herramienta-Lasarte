import { useState, useEffect, useCallback } from "react";
import * as XLSX from "xlsx";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Download, Loader2, FileSpreadsheet } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import ExcelPreviewer, {
  type ParsedExcel,
  type Metric,
  type DataTable,
} from "./ExcelPreviewer";

interface Archivo {
  file_name: string | null;
  file_path: string | null;
  mime_type: string | null;
  file_size: number | null;
}

interface ExcelViewerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  archivo: Archivo | null;
}

type SheetData = { name: string; headers: string[]; rows: string[][] };

function formatSize(bytes: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Detecta si una columna es mayoritariamente numérica (>50% de celdas válidas
// son números con separador decimal/punto/miles). Se usa para alinear a la
// derecha las columnas de cifras.
function isNumericColumn(rows: string[][], colIdx: number): boolean {
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

// Detecta si una fila es un control de UI de Excel (filtros, fechas, etc.)
const UI_CONTROL_RE = /filtros?|fecha de lote/i;

// Convierte una hoja cruda en una estructura limpia { metrics, tables, title, subtitle }.
// Estrategia:
//  1) Recortar filas/columnas vacías.
//  2) Localizar la fila de encabezados: primera fila con 2+ celdas de texto
//     (no numéricas) y sin ":" en ninguna celda (excluye filas de métrica).
//     También se saltan filas con controles de UI de Excel (filtros, etc.).
//  3) Las filas anteriores se clasifican como title/subtitle/métricas/sección.
//  4) Las filas posteriores son datos de la tabla.
function parseSheetToStructured(sheet: SheetData, filename: string): ParsedExcel {
  const result: ParsedExcel = { filename, metrics: [], tables: [] };

  // 1) Trim + drop filas vacías
  const clean = sheet.rows
    .map((r) => r.map((c) => (c ?? "").trim()))
    .filter((r) => r.some((c) => c.length > 0));
  if (clean.length === 0) return result;

  // 2) Detectar columnas con datos y recortar
  const maxCols = Math.max(...clean.map((r) => r.length));
  const usedCols: number[] = [];
  for (let c = 0; c < maxCols; c++) {
    if (clean.some((r) => r[c] && r[c].length > 0)) usedCols.push(c);
  }
  const rows = clean.map((r) => usedCols.map((c) => r[c] ?? ""));

  // 3) Localizar fila de encabezados (escanear TODO el archivo, no solo 30 filas,
  // porque algunos exportadores de GSTOCK tienen muchos metadatos arriba)
  let headerIdx = -1;
  let fallbackIdx = -1;
  let fallbackScore = -1;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const cells = row.filter((c) => c.length > 0);
    if (cells.length < 2) continue;
    // Saltar controles de UI de Excel (filtros, fecha de lote...)
    if (row.some((c) => UI_CONTROL_RE.test(c))) continue;
    // Una fila NO es header si tiene ":" (sería "Label: Value" de métrica)
    if (row.some((c) => c.includes(":"))) continue;
    // La mayoría de celdas deben ser texto, no números
    const numericCount = cells.filter((c) => /^-?\d+([.,]\d+)?%?$/.test(c)).length;
    if (numericCount < cells.length / 2) {
      headerIdx = i;
      break;
    }
    // Fallback: guardar la fila con más celdas de texto (menos numéricas) por si no hay header claro
    const textCount = cells.length - numericCount;
    if (textCount > fallbackScore) {
      fallbackScore = textCount;
      fallbackIdx = i;
    }
  }
  if (headerIdx === -1 && fallbackIdx >= 0) {
    headerIdx = fallbackIdx;
  }

  // 4) Clasificar filas previas al header
  const preRows = headerIdx > 0 ? rows.slice(0, headerIdx) : rows;
  const dataStartIdx = headerIdx >= 0 ? headerIdx + 1 : -1;
  const lastSingleCellText: string[] = [];

  for (const row of preRows) {
    const cells = row.filter((c) => c.length > 0);
    if (cells.length === 0) continue;

    // Saltar controles de UI de Excel en cualquier parte del pre-header
    if (cells.some((c) => UI_CONTROL_RE.test(c))) continue;

    // Métrica "Label: Value" en una celda
    if (cells.length === 1 && cells[0].includes(":")) {
      const idx = cells[0].indexOf(":");
      const label = cells[0].slice(0, idx).trim();
      const value = cells[0].slice(idx + 1).trim();
      if (label && value) result.metrics.push({ label, value });
      continue;
    }

    // Métrica "Label | Value" en dos celdas
    if (cells.length === 2) {
      result.metrics.push({ label: cells[0], value: cells[1] });
      continue;
    }

    // Texto de una sola celda → título, subtítulo, o nombre de sección
    if (cells.length === 1) {
      lastSingleCellText.push(cells[0]);
    }
  }

  // Asignar título/subtítulo (primeras dos filas de texto) y descartar el resto
  // (que probablemente son nombres de sección que mostraremos en la tabla)
  // También intenta formatear números de serie de fecha de Excel.
  function formatTitleText(text: string): string {
    const num = parseFloat(text);
    if (!isNaN(num) && num > 30000 && num < 60000) {
      const date = new Date(Math.round((num - 25569) * 86400 * 1000));
      if (!isNaN(date.getTime()) && date.getFullYear() > 1990 && date.getFullYear() < 2100) {
        return date.toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit", year: "numeric" });
      }
    }
    return text;
  }
  if (lastSingleCellText.length >= 1) result.title = formatTitleText(lastSingleCellText[0]);
  if (lastSingleCellText.length >= 2) result.subtitle = formatTitleText(lastSingleCellText[1]);

  // 5) Extraer tabla
  if (headerIdx >= 0) {
    const headers = rows[headerIdx].filter((c) => c.length > 0);
    if (headers.length > 0) {
      const dataRows: string[][] = [];
      for (let i = dataStartIdx; i < rows.length; i++) {
        const row = rows[i];
        if (row.every((c) => !c)) continue;
        dataRows.push(headers.map((_, ci) => row[ci] ?? ""));
      }

      // Sección: la última fila de texto de una sola celda antes del header
      // que no sea el título ni el subtítulo.
      let section = "";
      for (let i = lastSingleCellText.length - 1; i >= 0; i--) {
        const t = lastSingleCellText[i];
        if (t !== result.title && t !== result.subtitle) {
          section = t;
          break;
        }
      }

      // Filtrar filas que son puramente pares etiqueta-valor (metadatos)
      const filteredRows = dataRows.filter((row) => {
        const nonEmpty = row.filter((c) => c.length > 0);
        if (nonEmpty.length === 0) return false;
        const labelCount = nonEmpty.filter((c) => c.endsWith(":")).length;
        return labelCount / nonEmpty.length < 0.5;
      });

      // Mejorar nombre de sección: evitar "Datos" genérico, derivar del filename si es posible
      let finalSection = section;
      if (!finalSection || finalSection === "Datos") {
        // Intentar extraer módulo del nombre de archivo, ej: "Informe 0106 tamaños.xlsx" → "Tamaños"
        const match = filename.match(/informe.*\b(tamaños?|productos?|producciones?|palets?)\b/i);
        if (match) {
          finalSection = match[1].charAt(0).toUpperCase() + match[1].slice(1).toLowerCase();
        } else if (sheet.name && !/^hoja\s*\d+$/i.test(sheet.name)) {
          finalSection = sheet.name;
        } else {
          finalSection = "Datos";
        }
      }

      result.tables.push({
        section: finalSection,
        description: `${filteredRows.length} fila${filteredRows.length !== 1 ? "s" : ""} · ${headers.length} columna${headers.length !== 1 ? "s" : ""}`,
        headers,
        rows: filteredRows,
      });
    }
  }

  return result;
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number") {
    // Detectar serial de fecha de Excel (típicamente 30000-60000, con o sin decimal de hora)
    if (value > 30000 && value < 60000) {
      const date = new Date(Math.round((value - 25569) * 86400 * 1000));
      if (!isNaN(date.getTime()) && date.getFullYear() > 1990 && date.getFullYear() < 2100) {
        return date.toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit", year: "numeric" });
      }
    }
    return String(value);
  }
  if (typeof value === "boolean") return value ? "Sí" : "No";
  if (value instanceof Date) return value.toLocaleDateString("es-ES");
  return String(value);
}

function repairXlsx(bytes: Uint8Array): Uint8Array {
  // Detectar y eliminar cualquier prefijo basura antes del header ZIP.
  // Algunos exportadores añaden 4+ bytes (ej. "PK00") o BOMs (EF BB BF, FF FE, FE FF)
  // antes del magic ZIP real (PK\x03\x04). Si el primer PK\x03\x04 no está en
  // el offset 0, recortamos todo lo anterior.
  let start = 0;
  const scanLimit = Math.min(bytes.length - 4, 64);
  for (let i = 0; i <= scanLimit; i++) {
    if (
      bytes[i] === 0x50 &&
      bytes[i + 1] === 0x4b &&
      bytes[i + 2] === 0x03 &&
      bytes[i + 3] === 0x04
    ) {
      start = i;
      break;
    }
  }
  if (start > 0) {
    console.log(`repairXlsx: stripped ${start} garbage prefix bytes`);
    bytes = bytes.subarray(start);
  }

  // Now check the file starts with ZIP magic
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b || bytes[2] !== 0x03 || bytes[3] !== 0x04) {
    return bytes;
  }

  // Make a copy to avoid mutating the original
  const buf = new Uint8Array(bytes);
  let needsRepair = false;

  // Check local file headers (PK\x03\x04) for DEFLATE64 (method 9)
  for (let i = 0; i < buf.length - 30; i++) {
    if (buf[i] === 0x50 && buf[i + 1] === 0x4b && buf[i + 2] === 0x03 && buf[i + 3] === 0x04) {
      const method = buf[i + 8] | (buf[i + 9] << 8);
      if (method === 9) {
        needsRepair = true;
        buf[i + 8] = 8;
        buf[i + 9] = 0;
      }
      const fnLen = buf[i + 26] | (buf[i + 27] << 8);
      const exLen = buf[i + 28] | (buf[i + 29] << 8);
      i += 30 + fnLen + exLen - 1;
    }
  }

      // Only repair central directory if we found DEFLATE64
  if (needsRepair) {
    for (let i = 0; i < buf.length - 46; i++) {
      if (buf[i] === 0x50 && buf[i + 1] === 0x4b && buf[i + 2] === 0x01 && buf[i + 3] === 0x02) {
        const method = buf[i + 10] | (buf[i + 11] << 8);
        if (method === 9) {
          buf[i + 10] = 8;
          buf[i + 11] = 0;
        }
        const fnLen = buf[i + 28] | (buf[i + 29] << 8);
        const exLen = buf[i + 30] | (buf[i + 31] << 8);
        const cmLen = buf[i + 32] | (buf[i + 33] << 8);
        i += 46 + fnLen + exLen + cmLen - 1;
      }
    }
  }

  // Reconstruir EOCD si falta. El exportador de GSTOCK genera ZIPs sin
  // End Of Central Directory, lo que hace que xlsx.js calcule offsets
  // incorrectos y lea basura → "Compression method NaN".
  const eocdFixed = reconstructMissingEocd(buf);
  if (eocdFixed) {
    return eocdFixed;
  }

  return buf;
}

// Busca la siguiente firma ZIP (local header o central dir) desde `start`.
function findNextZipSignature(bytes: Uint8Array, start: number): number {
  for (let i = start; i < bytes.length - 3; i++) {
    const a = bytes[i], b = bytes[i + 1], c = bytes[i + 2], d = bytes[i + 3];
    if (a === 0x50 && b === 0x4b && (c === 0x03 || c === 0x01) && d === 0x04) {
      return i;
    }
  }
  return bytes.length;
}

// Reconstruye el Central Directory y el EOCD a partir de los local headers.
// Si el EOCD ya existe, devuelve los bytes sin tocar.
function reconstructMissingEocd(bytes: Uint8Array): Uint8Array | null {
  console.log(`reconstructMissingEocd: buf.length=${bytes.length}`);

  // 1. ¿Ya tiene EOCD? Buscar la firma PK\x05\x06. Validación ESTRICTA:
  // además de la firma y el commentLen, el número de entradas del CD debe
  // ser > 0, y el offset+size del CD debe caer dentro del archivo y apuntar
  // a una firma PK\x01\x02 real. Sin esto, basura al final del archivo
  // (como "PK\x05\x06...00 00") pasa como EOCD falso positivo.
  const maxComment = 65535;
  const searchStart = Math.max(0, bytes.length - 22 - maxComment);
  let eocdStart = -1;
  for (let i = bytes.length - 22; i >= searchStart; i--) {
    if (
      bytes[i] === 0x50 && bytes[i + 1] === 0x4b &&
      bytes[i + 2] === 0x05 && bytes[i + 3] === 0x06
    ) {
      const commentLen = bytes[i + 20] | (bytes[i + 21] << 8);
      if (i + 22 + commentLen !== bytes.length) continue;
      const cdEntries = bytes[i + 10] | (bytes[i + 11] << 8);
      if (cdEntries === 0) continue;
      const cdSize =
        (bytes[i + 12] | (bytes[i + 13] << 8) |
          (bytes[i + 14] << 16) | (bytes[i + 15] << 24)) >>> 0;
      const cdOffset =
        (bytes[i + 16] | (bytes[i + 17] << 8) |
          (bytes[i + 18] << 16) | (bytes[i + 19] << 24)) >>> 0;
      if (cdOffset === 0 || cdOffset + cdSize > bytes.length) continue;
      // Verificar que el primer byte del CD sea PK\x01\x02
      if (
        bytes[cdOffset] !== 0x50 || bytes[cdOffset + 1] !== 0x4b ||
        bytes[cdOffset + 2] !== 0x01 || bytes[cdOffset + 3] !== 0x02
      ) continue;
      eocdStart = i;
      break;
    }
  }
  if (eocdStart >= 0) {
    console.log(`reconstructMissingEocd: EOCD válido en offset ${eocdStart}, nada que hacer`);
    return bytes;
  }
  console.log(`reconstructMissingEocd: no se encontró EOCD válido, reconstruyendo...`);

  // 2. Recoger todos los local file headers (PK\x03\x04)
  type LH = {
    offset: number; version: number; flags: number; method: number;
    modTime: number; modDate: number; crc32: number;
    compSize: number; uncompSize: number;
    filenameLen: number; extraLen: number; dataStart: number; dataSize: number;
  };
  const headers: LH[] = [];
  let i = 0;
  while (i < bytes.length - 30) {
    if (
      bytes[i] === 0x50 && bytes[i + 1] === 0x4b &&
      bytes[i + 2] === 0x03 && bytes[i + 3] === 0x04
    ) {
      const flags = bytes[i + 6] | (bytes[i + 7] << 8);
      const compSize = bytes[i + 18] | (bytes[i + 19] << 8) | (bytes[i + 20] << 16) | (bytes[i + 21] << 24);
      const uncompSize = bytes[i + 22] | (bytes[i + 23] << 8) | (bytes[i + 24] << 16) | (bytes[i + 25] << 24);
      const filenameLen = bytes[i + 26] | (bytes[i + 27] << 8);
      const extraLen = bytes[i + 28] | (bytes[i + 29] << 8);
      const dataStart = i + 30 + filenameLen + extraLen;

      // Determinar tamaño de los datos. Si compSize > 0, usarlo. Si es 0
      // y no hay data descriptor, usar uncompSize. Si sigue siendo 0,
      // escanear hasta la siguiente firma ZIP.
      let dataSize = compSize;
      if (dataSize === 0 && (flags & 0x08) === 0) {
        dataSize = uncompSize;
      }
      if (dataSize === 0) {
        const nextSig = findNextZipSignature(bytes, dataStart);
        dataSize = nextSig - dataStart;
      }

      headers.push({
        offset: i,
        version: bytes[i + 4] | (bytes[i + 5] << 8),
        flags,
        method: bytes[i + 8] | (bytes[i + 9] << 8),
        modTime: bytes[i + 10] | (bytes[i + 11] << 8),
        modDate: bytes[i + 12] | (bytes[i + 13] << 8),
        crc32: (bytes[i + 14] | (bytes[i + 15] << 8) | (bytes[i + 16] << 16) | (bytes[i + 17] << 24)) >>> 0,
        compSize,
        uncompSize,
        filenameLen,
        extraLen,
        dataStart,
        dataSize,
      });
      i = dataStart + dataSize;
    } else {
      i++;
    }
  }

  if (headers.length === 0) return null;

  // 3. Construir central directory entries (46 bytes + filename cada uno)
  const cdEntries: Uint8Array[] = [];
  for (const h of headers) {
    const cd = new Uint8Array(46 + h.filenameLen);
    cd[0] = 0x50; cd[1] = 0x4b; cd[2] = 0x01; cd[3] = 0x02; // CD signature
    cd[4] = 0x14; cd[5] = 0x00;                              // version made by (2.0)
    cd[6] = h.version & 0xff; cd[7] = (h.version >> 8) & 0xff;
    cd[8] = h.flags & 0xff; cd[9] = (h.flags >> 8) & 0xff;
    cd[10] = h.method & 0xff; cd[11] = (h.method >> 8) & 0xff;
    cd[12] = h.modTime & 0xff; cd[13] = (h.modTime >> 8) & 0xff;
    cd[14] = h.modDate & 0xff; cd[15] = (h.modDate >> 8) & 0xff;
    cd[16] = h.crc32 & 0xff; cd[17] = (h.crc32 >> 8) & 0xff;
    cd[18] = (h.crc32 >> 16) & 0xff; cd[19] = (h.crc32 >> 24) & 0xff;
    cd[20] = h.compSize & 0xff; cd[21] = (h.compSize >> 8) & 0xff;
    cd[22] = (h.compSize >> 16) & 0xff; cd[23] = (h.compSize >> 24) & 0xff;
    cd[24] = h.uncompSize & 0xff; cd[25] = (h.uncompSize >> 8) & 0xff;
    cd[26] = (h.uncompSize >> 16) & 0xff; cd[27] = (h.uncompSize >> 24) & 0xff;
    cd[28] = h.filenameLen & 0xff; cd[29] = (h.filenameLen >> 8) & 0xff;
    cd[30] = 0; cd[31] = 0; // extra len
    cd[32] = 0; cd[33] = 0; // comment len
    cd[34] = 0; cd[35] = 0; // disk
    cd[36] = 0; cd[37] = 0; // internal attrs
    cd[38] = 0; cd[39] = 0; cd[40] = 0; cd[41] = 0; // external attrs
    cd[42] = h.offset & 0xff; cd[43] = (h.offset >> 8) & 0xff;
    cd[44] = (h.offset >> 16) & 0xff; cd[45] = (h.offset >> 24) & 0xff;
    cd.set(bytes.subarray(h.offset + 30, h.offset + 30 + h.filenameLen), 46);
    cdEntries.push(cd);
  }

  // 4. Calcular offset del central directory
  let cdOffset = 0;
  for (const h of headers) {
    cdOffset += 30 + h.filenameLen + h.extraLen + h.dataSize;
  }
  const cdSize = cdEntries.reduce((sum, cd) => sum + cd.length, 0);
  const cdCount = cdEntries.length;

  // 5. Construir EOCD (22 bytes)
  const eocd = new Uint8Array(22);
  eocd[0] = 0x50; eocd[1] = 0x4b; eocd[2] = 0x05; eocd[3] = 0x06;
  eocd[4] = 0; eocd[5] = 0; // disk number
  eocd[6] = 0; eocd[7] = 0; // disk where CD starts
  eocd[8] = cdCount & 0xff; eocd[9] = (cdCount >> 8) & 0xff;
  eocd[10] = cdCount & 0xff; eocd[11] = (cdCount >> 8) & 0xff;
  eocd[12] = cdSize & 0xff; eocd[13] = (cdSize >> 8) & 0xff;
  eocd[14] = (cdSize >> 16) & 0xff; eocd[15] = (cdSize >> 24) & 0xff;
  eocd[16] = cdOffset & 0xff; eocd[17] = (cdOffset >> 8) & 0xff;
  eocd[18] = (cdOffset >> 16) & 0xff; eocd[19] = (cdOffset >> 24) & 0xff;
  eocd[20] = 0; eocd[21] = 0; // comment length

  // 6. Concatenar: local headers + data + CD + EOCD
  const totalSize = cdOffset + cdSize + 22;
  const result = new Uint8Array(totalSize);
  let pos = 0;
  for (const h of headers) {
    const localEnd = h.offset + 30 + h.filenameLen + h.extraLen;
    result.set(bytes.subarray(h.offset, localEnd), pos);
    pos += 30 + h.filenameLen + h.extraLen;
    result.set(bytes.subarray(h.dataStart, h.dataStart + h.dataSize), pos);
    pos += h.dataSize;
  }
  for (const cd of cdEntries) {
    result.set(cd, pos);
    pos += cd.length;
  }
  result.set(eocd, pos);

  console.log(
    `reconstructMissingEocd: ${headers.length} archivos, CD en ${cdOffset}, EOCD reconstruido`
  );
  for (let idx = 0; idx < headers.length; idx++) {
    const h = headers[idx];
    const name = new TextDecoder("utf-8", { fatal: false }).decode(
      bytes.subarray(h.offset + 30, h.offset + 30 + h.filenameLen)
    );
    console.log(
      `  [${idx}] offset=${h.offset} name="${name}" method=${h.method} ` +
      `compSize=${h.compSize} uncompSize=${h.uncompSize} ` +
      `flags=${h.flags} dataStart=${h.dataStart} dataSize=${h.dataSize}`
    );
  }
  console.log(`  CD total bytes: ${cdSize}, archivo nuevo: ${totalSize} bytes`);
  return result;
}

export function ExcelViewerDialog({ open, onOpenChange, archivo }: ExcelViewerDialogProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sheets, setSheets] = useState<SheetData[]>([]);
  const [activeSheet, setActiveSheet] = useState("0");
  const [blob, setBlob] = useState<Blob | null>(null);

  const loadFile = useCallback(async () => {
    if (!archivo?.file_path) return;
    setLoading(true);
    setError(null);
    setSheets([]);
    setActiveSheet("0");
    setBlob(null);

    try {
      const { data, error: dlError } = await supabase.storage
        .from("partes-archivos")
        .download(archivo.file_path);

      if (dlError || !data) throw new Error(dlError?.message ?? "No se pudo descargar el archivo");

      setBlob(data);
      const buffer = await data.arrayBuffer();
      const bytes = new Uint8Array(buffer);

      // Función para verificar si el contenido parseado es válido.
      // Requiere al menos 3 celdas con contenido por hoja y que
      // menos del 30% parezcan "basura encriptada" (strings hex, base64, etc).
      const isValidContent = (sheets: SheetData[]): boolean => {
        if (sheets.length === 0) return false;
        for (const sheet of sheets) {
          let cellsWithContent = 0;
          let suspicious = 0;
          const check = (c: string) => {
            const t = c?.trim() ?? "";
            if (!t) return;
            cellsWithContent++;
            // heurística de "basura encriptada"
            if (
              t.length > 80 ||
              /^[A-F0-9]{16,}$/i.test(t) ||
              /^[A-Za-z0-9+/=]{24,}$/.test(t)
            ) {
              suspicious++;
            }
          };
          for (const h of sheet.headers) check(h);
          for (const row of sheet.rows) for (const cell of row) check(cell);
          if (cellsWithContent >= 3 && suspicious / cellsWithContent < 0.3) return true;
        }
        return false;
      };

      // Función para parsear el workbook. Usa raw: true para evitar
      // que xlsx aplique formatos raros a celdas corruptas (que es lo
      // que producía el efecto "encriptado").
      const parseWorkbook = (wb: XLSX.WorkBook): SheetData[] => {
        return wb.SheetNames.map((name) => {
          const ws = wb.Sheets[name];
          const json = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "", raw: true });
          const headers = json.length > 0 ? json[0].map((h) => formatCell(h)) : [];
          const rows = json.slice(1).map((row) => row.map((c) => formatCell(c)));
          return { name, headers, rows };
        });
      };

      let parsed: SheetData[] = [];

      // Limpiar prefijo basura (PK00, BOM, etc.) UNA VEZ antes de los intentos XLSX
      const cleanBytes = repairXlsx(bytes);

      // Intento 1: Parsear normalmente
      try {
        console.log("Intento 1: Parseo normal");
        const wb = XLSX.read(cleanBytes, { type: "array" });
        parsed = parseWorkbook(wb);
        console.log("Intento 1 exitoso, hojas:", parsed.length);
      } catch (e) {
        console.warn("Error en primer intento de parseo:", e);
      }

      // Intento 2: Si el contenido no es válido, intentar con reparación
      if (!isValidContent(parsed)) {
        console.log("Intento 2: Contenido inválido, intentando reparación DEFLATE64...");
        try {
          const wb = XLSX.read(cleanBytes, { type: "array" });
          const repairedParsed = parseWorkbook(wb);

          if (isValidContent(repairedParsed)) {
            parsed = repairedParsed;
            console.log("Intento 2 exitoso: Reparación DEFLATE64 funcionó");
          }
        } catch (e) {
          console.warn("Error en segundo intento de parseo:", e);
        }
      }

      // Intento 3: Si sigue sin funcionar, intentar con diferentes opciones de XLSX
      if (!isValidContent(parsed)) {
        console.log("Intento 3: Opciones alternativas (cellDates, cellNF)...");
        try {
          const wb = XLSX.read(cleanBytes, { type: "array", cellDates: true, cellNF: false });
          const altParsed = parseWorkbook(wb);

          if (isValidContent(altParsed)) {
            parsed = altParsed;
            console.log("Intento 3 exitoso: Opciones alternativas funcionaron");
          }
        } catch (e) {
          console.warn("Error en tercer intento de parseo:", e);
        }
      }

      // Intento 4: Último recurso - parsear con raw: true para obtener valores crudos
      if (!isValidContent(parsed)) {
        console.log("Intento 4: Último recurso con raw: true...");
        try {
          const wb = XLSX.read(cleanBytes, { type: "array", raw: true });
          const rawParsed = parseWorkbook(wb);

          if (isValidContent(rawParsed)) {
            parsed = rawParsed;
            console.log("Intento 4 exitoso: Parseo crudo funcionó");
          }
        } catch (e) {
          console.warn("Error en cuarto intento de parseo:", e);
        }
      }

      // Intento 5: dense mode para hojas con muchas celdas vacías
      if (!isValidContent(parsed)) {
        console.log("Intento 5: dense mode...");
        try {
          const wb = XLSX.read(cleanBytes, { type: "array", dense: true, cellDates: true, raw: true });
          const denseParsed = parseWorkbook(wb);

          if (isValidContent(denseParsed)) {
            parsed = denseParsed;
            console.log("Intento 5 exitoso: dense mode funcionó");
          }
        } catch (e) {
          console.warn("Error en quinto intento de parseo:", e);
        }
      }

      // Intento 6: Si todo falló, intentar como CSV (archivos mal etiquetados)
      if (!isValidContent(parsed)) {
        console.log("Intento 6: Probando como CSV...");
        try {
          const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
          if (!text.trim().startsWith("<") && (text.includes(",") || text.includes(";") || text.includes("\t"))) {
            const sep = text.includes(";") ? ";" : text.includes("\t") ? "\t" : ",";
            const lines = text.split(/\r?\n/).filter((l) => l.trim());
            if (lines.length >= 2) {
              const headers = lines[0].split(sep).map((h) => h.trim());
              const rows = lines.slice(1).map((l) => l.split(sep).map((c) => c.trim()));
              const csvParsed: SheetData[] = [{ name: "CSV", headers, rows }];
              if (isValidContent(csvParsed)) {
                parsed = csvParsed;
                console.log("Intento 6 exitoso: parseado como CSV");
              }
            }
          }
        } catch (e) {
          console.warn("Error en intento 6 (CSV):", e);
        }
      }

      // Intento 7: Si todo falló, intentar como tabla HTML
      if (!isValidContent(parsed)) {
        console.log("Intento 7: Probando como tabla HTML...");
        try {
          const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
          if (text.includes("<table")) {
            const doc = new DOMParser().parseFromString(text, "text/html");
            const tables = doc.querySelectorAll("table");
            if (tables.length) {
              const htmlParsed: SheetData[] = Array.from(tables).map((table, idx) => {
                const headerCells = Array.from(
                  table.querySelectorAll("thead th, tr:first-child th, tr:first-child td")
                );
                const headers = headerCells.map((th) => th.textContent?.trim() ?? "");
                const dataRows = Array.from(table.querySelectorAll("tbody tr, tr")).filter(
                  (tr) => !tr.querySelector("th")
                );
                const rows = dataRows.map((tr) =>
                  Array.from(tr.querySelectorAll("td")).map((td) => td.textContent?.trim() ?? "")
                );
                return { name: `Tabla ${idx + 1}`, headers, rows };
              });
              if (isValidContent(htmlParsed)) {
                parsed = htmlParsed;
                console.log("Intento 7 exitoso: parseado como HTML");
              }
            }
          }
        } catch (e) {
          console.warn("Error en intento 7 (HTML):", e);
        }
      }

      // Validación final
      if (!isValidContent(parsed)) {
        // Diagnóstico para ayudar a depurar (usar cleanBytes ya procesados)
        const firstBytes = Array.from(cleanBytes.slice(0, 16)).map((b) => b.toString(16).padStart(2, "0")).join(" ");
        const text = new TextDecoder("utf-8", { fatal: false }).decode(cleanBytes.slice(0, 200));
        const looksLikeZip = cleanBytes[0] === 0x50 && cleanBytes[1] === 0x4b && cleanBytes[2] === 0x03 && cleanBytes[3] === 0x04;
        const looksLikeHtml = /<html|<table|<!DOCTYPE/i.test(text);
        const looksLikeCsv = /^[\w\s,;:\t\-."']+$/m.test(text.split("\n")[0] ?? "");
        const strippedPrefix = cleanBytes.length !== bytes.length;
        // Detectar EOCD (End Of Central Directory) - si no está, el ZIP está corrupto
        const last4 = cleanBytes.subarray(cleanBytes.length - 22, cleanBytes.length - 18);
        const hasEocd = last4[0] === 0x50 && last4[1] === 0x4b && last4[2] === 0x05 && last4[3] === 0x06;
        // Buscar EOCD en los últimos 64 bytes
        let eocdFound = false;
        const searchStart = Math.max(0, cleanBytes.length - 64);
        for (let i = searchStart; i < cleanBytes.length - 3; i++) {
          if (cleanBytes[i] === 0x50 && cleanBytes[i+1] === 0x4b && cleanBytes[i+2] === 0x05 && cleanBytes[i+3] === 0x06) {
            eocdFound = true;
            break;
          }
        }
        console.error("Todos los intentos de parseo fallaron");
        console.error("Tamaño original:", bytes.length, "bytes, tras strip:", cleanBytes.length);
        console.error("Primeros 16 bytes (hex):", firstBytes);
        console.error("Primeros 200 chars:", text);
        console.error("¿ZIP?:", looksLikeZip, "¿HTML?:", looksLikeHtml, "¿CSV?:", looksLikeCsv, "Prefijo eliminado:", strippedPrefix, "EOCD presente:", eocdFound);
        let hint = "";
        if (looksLikeZip && !eocdFound) {
          hint = " Detectado: el archivo ZIP no tiene un registro EOCD (End Of Central Directory) al final — el XLSX está estructuralmente corrupto. Solución: abre el archivo en Excel/LibreOffice y guárdalo de nuevo como .xlsx.";
        } else if (!looksLikeZip) {
          hint = ` Detectado: no es un archivo ZIP/XLSX válido${looksLikeHtml ? " (parece HTML)" : ""}${looksLikeCsv ? " (parece CSV/texto)" : ""}.`;
        } else if (looksLikeHtml) {
          hint = " Detectado: parece HTML (no XLSX).";
        }
        throw new Error(
          `No se pudo parsear "${archivo.file_name || "archivo"}" ` +
          `(${formatSize(archivo.file_size || null)}).${hint} ` +
          `Si el problema persiste, descarga el archivo y verifica que sea un Excel válido.`
        );
      }

      setSheets(parsed);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error desconocido");
    } finally {
      setLoading(false);
    }
  }, [archivo?.file_path]);

  useEffect(() => {
    if (open && archivo) loadFile();
  }, [open, archivo, loadFile]);

  function handleDownload() {
    if (!blob || !archivo?.file_name) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = archivo.file_name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  const currentSheet = sheets[Number(activeSheet)];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl max-h-[95vh] flex flex-col">
        <DialogHeader className="shrink-0">
          <div className="flex items-center justify-between pr-8">
            <div className="flex items-center gap-2 min-w-0">
              <FileSpreadsheet className="h-5 w-5 text-primary shrink-0" />
              <div className="min-w-0">
                <DialogTitle className="truncate">{archivo?.file_name ?? "Archivo"}</DialogTitle>
                <DialogDescription>
                  {archivo?.file_size ? formatSize(archivo.file_size) : ""}
                  {sheets.length > 0 ? ` · ${sheets.length} hoja${sheets.length !== 1 ? "s" : ""}` : ""}
                </DialogDescription>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleDownload}
              disabled={!blob}
              className="shrink-0 glass glass-hover"
            >
              <Download className="h-3.5 w-3.5 mr-1.5" />
              Descargar
            </Button>
          </div>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-hidden">
          {loading && (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
              <span className="ml-2 text-sm text-muted-foreground">Cargando archivo…</span>
            </div>
          )}

          {error && (
            <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive">
              {error}
            </div>
          )}

          {!loading && !error && sheets.length > 0 && (
            <Tabs value={activeSheet} onValueChange={setActiveSheet} className="flex flex-col h-full">
              {sheets.length > 1 && (
                <TabsList className="shrink-0 self-start">
                  {sheets.map((s, i) => (
                    <TabsTrigger key={i} value={String(i)} className="text-xs">
                      {s.name}
                    </TabsTrigger>
                  ))}
                </TabsList>
              )}

              {sheets.map((s, i) => {
                const parsed = parseSheetToStructured(
                  s,
                  archivo?.file_name ?? "archivo"
                );
                if (parsed.tables.length === 1 && s.name) {
                  parsed.tables[0].section = s.name;
                }
                return (
                  <TabsContent
                    key={i}
                    value={String(i)}
                    className="mt-2 flex-1 min-h-0 outline-none"
                  >
                    <ExcelPreviewer data={parsed} />
                  </TabsContent>
                );
              })}
            </Tabs>
          )}

          {!loading && !error && sheets.length === 0 && !archivo && null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

import * as XLSX from "xlsx";

export const EXCEL_CELL_MAX = 32000;

export function createWorkbook(title: string, subject: string) {
  const wb = XLSX.utils.book_new();
  wb.Props = {
    Title: title,
    Subject: subject,
    Author: "Herramienta Lasarte SAT",
    Company: "Lasarte SAT",
  };
  return wb;
}

export function excelText(value: unknown, overflowSheetName = "Texto largo"): string {
  const text = String(value ?? "");
  if (text.length <= EXCEL_CELL_MAX) return text;
  return `${text.slice(0, EXCEL_CELL_MAX - 90)}\n\n[Texto recortado por limite de Excel. Ver hoja ${overflowSheetName}.]`;
}

export function splitExcelText(value: unknown, chunkSize = 30000): string[] {
  const text = String(value ?? "");
  if (!text) return [];
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += chunkSize) {
    chunks.push(text.slice(i, i + chunkSize));
  }
  return chunks;
}

type ExcelRowValue = string | number | boolean | Date | null | undefined | string[] | number[] | Record<string, unknown>;
type ExcelRow = Record<string, ExcelRowValue>;

export function sanitizeExcelRow(row: ExcelRow, overflowSheetName?: string) {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key,
      typeof value === "string" ? excelText(value, overflowSheetName) : value,
    ]),
  );
}

export function appendAoaSheet(
  wb: XLSX.WorkBook,
  name: string,
  rows: (string | number | boolean | null)[][],
  cols: number[],
) {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = cols.map((wch) => ({ wch }));
  XLSX.utils.book_append_sheet(wb, ws, name);
  return ws;
}

export function appendRowsSheet(
  wb: XLSX.WorkBook,
  name: string,
  rows: ExcelRow[],
  cols: number[],
  options: { overflowSheetName?: string; freezeHeader?: boolean } = {},
) {
  const safeRows = rows.map((row) => sanitizeExcelRow(row, options.overflowSheetName));
  const ws = safeRows.length > 0
    ? XLSX.utils.json_to_sheet(safeRows)
    : XLSX.utils.aoa_to_sheet([["Sin datos"]]);
  ws["!cols"] = cols.map((wch) => ({ wch }));
  if (safeRows.length > 0) {
    const headers = Object.keys(safeRows[0]);
    ws["!autofilter"] = {
      ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: safeRows.length, c: headers.length - 1 } }),
    };
    if (options.freezeHeader) {
      ws["!freeze"] = { xSplit: 0, ySplit: 1 };
    }
  }
  XLSX.utils.book_append_sheet(wb, ws, name);
  return ws;
}

export function appendDictionarySheet(
  wb: XLSX.WorkBook,
  rows: Array<{ Hoja: string; Campo: string; Descripcion: string; Uso?: string }>,
) {
  return appendRowsSheet(wb, "Diccionario", rows, [22, 28, 64, 36], { freezeHeader: true });
}

export function saveWorkbook(wb: XLSX.WorkBook, filename: string) {
  XLSX.writeFile(wb, filename, { bookType: "xlsx", compression: true });
}

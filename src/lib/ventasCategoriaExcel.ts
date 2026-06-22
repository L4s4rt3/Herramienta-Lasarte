import * as XLSX from "xlsx";
import { parseVentasCategoriaWorkbookRows, type ParseVentasCategoriaWorkbookResult } from "@/lib/ventasCategoria";

export async function parseVentasCategoriaExcelFile(file: File): Promise<ParseVentasCategoriaWorkbookResult> {
  const data = await file.arrayBuffer();
  const workbook = XLSX.read(data, { type: "array", cellDates: false });
  const sheets: Record<string, unknown[][]> = {};

  workbook.SheetNames.forEach((sheetName) => {
    sheets[sheetName] = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], {
      header: 1,
      raw: false,
      defval: "",
    });
  });

  return parseVentasCategoriaWorkbookRows(sheets);
}

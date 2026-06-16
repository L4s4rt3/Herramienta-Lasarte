import * as XLSX from "xlsx";
import type { ConsumoFisicoRow } from "@/lib/types";

export type FacturaConsumoRecurso = "agua" | "electricidad" | "gasoil" | "quimicos";
export type FacturaConsumoUnidad = "l" | "m3" | "kwh";

export interface FacturaConsumoValue {
  recurso: FacturaConsumoRecurso;
  fecha_inicio: string;
  fecha_fin: string;
  cantidad: number;
  unidad: FacturaConsumoUnidad;
  fuente: "factura_detallada";
  referencia: string | null;
  notas: string | null;
}

export interface FacturaConsumoParsedRow {
  id: string;
  fileName: string;
  rowNumber: number;
  status: "importable" | "skipped";
  recurso: FacturaConsumoRecurso | null;
  fecha: string | null;
  concepto: string;
  reason: string | null;
  consumo: FacturaConsumoValue | null;
}

export interface FacturaConsumoParseResult {
  fileName: string;
  recurso: FacturaConsumoRecurso | null;
  rows: FacturaConsumoParsedRow[];
  summary: {
    importable: number;
    skipped: number;
  };
}

type SheetRows = unknown[][];

const ACCOUNTING_ONLY_REASON: Record<FacturaConsumoRecurso, string> = {
  agua: "El extracto solo trae importe contable; falta m3 para consumo fisico.",
  electricidad: "El extracto solo trae importe contable; falta kWh para consumo fisico.",
  gasoil: "El extracto solo trae importe contable; falta litros para consumo fisico.",
  quimicos: "El extracto solo trae importe contable; falta litros para consumo fisico.",
};

export async function parseFacturaConsumoFile(file: File): Promise<FacturaConsumoParseResult> {
  const data = await file.arrayBuffer();
  const workbook = XLSX.read(data, { type: "array", cellDates: false });
  const rows = workbook.SheetNames.flatMap((sheetName) => (
    XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], {
      header: 1,
      raw: false,
      defval: "",
    })
  ));

  return parseFacturaConsumoRows(rows, file.name);
}

export function parseFacturaConsumoRows(rows: SheetRows, fileName: string): FacturaConsumoParseResult {
  const recurso = detectRecurso(rows, fileName);
  const parsedRows = recurso === "gasoil"
    ? parseGasoilRows(rows, fileName, recurso)
    : parseAccountingOnlyRows(rows, fileName, recurso);

  return {
    fileName,
    recurso,
    rows: parsedRows,
    summary: {
      importable: parsedRows.filter((row) => row.status === "importable").length,
      skipped: parsedRows.filter((row) => row.status === "skipped").length,
    },
  };
}

export function isDuplicateFacturaConsumo(
  consumo: FacturaConsumoValue,
  existing: Array<Pick<ConsumoFisicoRow, "recurso" | "fecha_inicio" | "fecha_fin" | "cantidad" | "unidad" | "referencia">>,
): boolean {
  return existing.some((row) => (
    row.recurso === consumo.recurso
    && row.fecha_inicio === consumo.fecha_inicio
    && row.fecha_fin === consumo.fecha_fin
    && row.unidad === consumo.unidad
    && Math.abs(Number(row.cantidad) - consumo.cantidad) < 0.0001
    && normalizeReference(row.referencia) === normalizeReference(consumo.referencia)
  ));
}

function parseGasoilRows(
  rows: SheetRows,
  fileName: string,
  recurso: FacturaConsumoRecurso,
): FacturaConsumoParsedRow[] {
  const headerIndex = rows.findIndex((row) => (
    row.some((cell) => compactCell(cell) === "fecha")
    && row.some((cell) => compactCell(cell) === "unidades")
  ));

  if (headerIndex < 0) {
    return [];
  }

  const header = rows[headerIndex];
  const fechaCol = findColumn(header, (cell) => compactCell(cell) === "fecha") ?? 0;
  const albaranCol = findColumn(header, (cell) => compactCell(cell).includes("albaran"));
  const facturaCol = findColumn(header, (cell) => compactCell(cell).includes("factura") && !compactCell(cell).startsWith("fec"));
  const articuloCol = findColumn(header, (cell) => compactCell(cell) === "articulo");
  const unidadesCol = findColumn(header, (cell) => compactCell(cell) === "unidades");
  const precioCol = findColumn(header, (cell) => compactCell(cell) === "precio");
  const importeCol = findColumn(header, (cell) => compactCell(cell) === "importe");

  if (unidadesCol == null) {
    return [];
  }

  return rows.slice(headerIndex + 1).flatMap((row, offset) => {
    const rowNumber = headerIndex + offset + 2;
    const fecha = parseDateCell(row[fechaCol]);
    const cantidad = parseNumberCell(row[unidadesCol]);

    if (!fecha || cantidad == null || cantidad <= 0) {
      return [];
    }

    const factura = valueAt(row, facturaCol);
    const albaran = valueAt(row, albaranCol);
    const articulo = articleDescription(row, articuloCol);
    const precio = formatNumberForNote(valueAt(row, precioCol));
    const importe = formatNumberForNote(valueAt(row, importeCol));
    const referencia = [factura, albaran].filter(Boolean).join(" / ") || null;
    const notasParts = [`Importado de ${fileName}.`];

    if (articulo) {
      notasParts.push(`Articulo: ${articulo}.`);
    }

    if (precio) {
      notasParts.push(`Precio: ${precio}.`);
    }

    if (importe) {
      notasParts.push(`Importe: ${importe}.`);
    }

    return [{
      id: `${fileName}:${rowNumber}`,
      fileName,
      rowNumber,
      status: "importable" as const,
      recurso,
      fecha,
      concepto: articulo || "Gasoil",
      reason: null,
      consumo: {
        recurso: "gasoil",
        fecha_inicio: fecha,
        fecha_fin: fecha,
        cantidad,
        unidad: "l",
        fuente: "factura_detallada",
        referencia,
        notas: notasParts.join(" "),
      },
    }];
  });
}

function parseAccountingOnlyRows(
  rows: SheetRows,
  fileName: string,
  recurso: FacturaConsumoRecurso | null,
): FacturaConsumoParsedRow[] {
  if (!recurso) {
    return [];
  }

  const headerIndex = rows.findIndex((row) => (
    row.some((cell) => compactCell(cell) === "fecha")
    && row.some((cell) => compactCell(cell) === "concepto")
    && row.some((cell) => compactCell(cell) === "cargos")
  ));

  if (headerIndex < 0) {
    return [];
  }

  const header = rows[headerIndex];
  const fechaCol = findColumn(header, (cell) => compactCell(cell) === "fecha") ?? 0;
  const conceptoCol = findColumn(header, (cell) => compactCell(cell) === "concepto") ?? 2;

  return rows.slice(headerIndex + 1).flatMap((row, offset) => {
    const rowNumber = headerIndex + offset + 2;
    const fecha = parseDateCell(row[fechaCol]);
    const concepto = valueAt(row, conceptoCol);

    if (!fecha || !concepto || isIgnoredAccountingConcept(concepto)) {
      return [];
    }

    return [{
      id: `${fileName}:${rowNumber}`,
      fileName,
      rowNumber,
      status: "skipped" as const,
      recurso,
      fecha,
      concepto,
      reason: ACCOUNTING_ONLY_REASON[recurso],
      consumo: null,
    }];
  });
}

function detectRecurso(rows: SheetRows, fileName: string): FacturaConsumoRecurso | null {
  const haystack = normalizeText(`${fileName} ${rows.slice(0, 12).flat().join(" ")}`);

  if (haystack.includes("gasoil") || haystack.includes("gasoleo")) {
    return "gasoil";
  }

  if (haystack.includes("electricidad") || haystack.includes("endesa")) {
    return "electricidad";
  }

  if (haystack.includes("agua") || haystack.includes("aqua")) {
    return "agua";
  }

  if (haystack.includes("quimic")) {
    return "quimicos";
  }

  return null;
}

function findColumn(row: unknown[], predicate: (cell: unknown) => boolean): number | null {
  const index = row.findIndex(predicate);
  return index >= 0 ? index : null;
}

function valueAt(row: unknown[], index: number | null | undefined): string {
  if (index == null) {
    return "";
  }

  return stringifyCell(row[index]);
}

function articleDescription(row: unknown[], index: number | null | undefined): string {
  const primary = valueAt(row, index);
  if (index == null) {
    return primary;
  }

  const nearbyText = row
    .slice(index + 1, index + 6)
    .map((value) => stringifyCell(value))
    .find((value) => /[a-z]/i.test(value) && !/^\d+$/.test(value));

  return nearbyText || primary;
}

function isIgnoredAccountingConcept(concepto: string): boolean {
  const normalized = normalizeText(concepto);
  return normalized.includes("saldo inicial") || normalized.includes("pase a cta");
}

function normalizeReference(value: string | null): string {
  return normalizeText(value ?? "").replace(/\s+/g, " ");
}

function parseDateCell(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return [
      value.getFullYear(),
      String(value.getMonth() + 1).padStart(2, "0"),
      String(value.getDate()).padStart(2, "0"),
    ].join("-");
  }

  const text = stringifyCell(value);
  const match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) {
    return null;
  }

  const [, day, month, year] = match;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function parseNumberCell(value: unknown): number | null {
  const text = stringifyCell(value).replace(/\s/g, "");
  if (!text) {
    return null;
  }

  const commaIndex = text.lastIndexOf(",");
  const dotIndex = text.lastIndexOf(".");
  const normalized = commaIndex > dotIndex
    ? text.replace(/\./g, "").replace(",", ".")
    : text.replace(/,/g, "");
  const parsed = Number(normalized);

  return Number.isFinite(parsed) ? parsed : null;
}

function formatNumberForNote(value: string): string {
  const parsed = parseNumberCell(value);
  if (parsed == null) {
    return "";
  }

  const decimals = decimalPlaces(value);
  return parsed.toFixed(decimals);
}

function decimalPlaces(value: string): number {
  const text = stringifyCell(value);
  const separatorIndex = Math.max(text.lastIndexOf(","), text.lastIndexOf("."));
  if (separatorIndex < 0) {
    return 0;
  }

  return text.length - separatorIndex - 1;
}

function compactCell(value: unknown): string {
  return normalizeText(value).replace(/\s/g, "");
}

function normalizeText(value: unknown): string {
  return stringifyCell(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function stringifyCell(value: unknown): string {
  return String(value ?? "").trim();
}

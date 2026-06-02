export type StatusKey =
  | "success"
  | "info"
  | "warning"
  | "destructive"
  | "muted";

export interface Metric {
  label: string;
  value: string | number;
  category?: string;
}

export interface DataTable {
  section: string;
  description?: string;
  headers: string[];
  rows: string[][];
}

export interface ParsedExcel {
  filename: string;
  title?: string;
  subtitle?: string;
  metrics: Metric[];
  tables: DataTable[];
}

export interface SheetData {
  name: string;
  headers: string[];
  rows: string[][];
}

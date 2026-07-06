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
  /** Fila de totales detectada al final de la tabla (se pinta como pie fijo). */
  totalRow?: string[];
}

/** Bloque de pares etiqueta→valor (cabecera tipo "ANTEQUERA VERDURA | 400.879"). */
export interface KeyValueBlock {
  /** Título opcional del bloque (p.ej. nombre de sección previo al bloque). */
  title?: string;
  pairs: Metric[];
}

export interface ParsedExcel {
  filename: string;
  title?: string;
  subtitle?: string;
  metrics: Metric[];
  tables: DataTable[];
  /** Bloques de pares clave-valor detectados antes/entre tablas (sección 2). */
  kvBlocks?: KeyValueBlock[];
  /** Filas-resumen tipo mini-KPI detectadas tras una tabla (sección 4). */
  summaryRows?: Metric[];
  /** Notas sueltas ("NOTA; ...") detectadas en cualquier punto de la hoja (sección 5). */
  notes?: string[];
}

export interface SheetData {
  name: string;
  headers: string[];
  rows: string[][];
}

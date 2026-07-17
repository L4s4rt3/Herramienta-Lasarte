export type StatusKey =
  | "success"
  | "info"
  | "warning"
  | "destructive"
  | "muted";

// El modelo de datos del visor vive en src/lib/excelPreview.ts (lógica pura,
// testeada contra fixtures de los archivos reales). Aquí solo se re-exportan
// los tipos para que los componentes del kit importen desde un único sitio.
// Son re-exports type-only: no crean ciclo de módulos en runtime aunque la
// lib importe a su vez los formateadores de este kit.
export type {
  ColumnType,
  DataTableRow,
  DiscardedRow,
  KeyValueBlock,
  Metric,
  ParsedColumn,
  ParsedSheet,
  ParsedTable,
} from "@/lib/excelPreview";

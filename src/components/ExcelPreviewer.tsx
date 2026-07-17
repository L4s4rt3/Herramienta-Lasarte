import { useMemo, useState } from "react";
import { Inbox, FileSearch, Table2 } from "lucide-react";
import {
  PreviewHeader,
  MetricsStrip,
  DataTable,
  RowDetailDrawer,
  KeyValueGrid,
  SummaryRowsStrip,
  NotesList,
  RawGridView,
} from "./excel-preview";
import type { ParsedSheet } from "./excel-preview";
import { cn } from "@/lib/utils";

export type { ParsedSheet, Metric, KeyValueBlock, ParsedTable } from "./excel-preview/types";

interface ExcelPreviewerProps {
  data: ParsedSheet;
  sheets?: Array<{ name: string }>;
  activeSheetIndex?: number;
  onSheetChange?: (index: number) => void;
  mimeType?: string | null;
  onDownload?: () => void;
  downloadDisabled?: boolean;
}

export default function ExcelPreviewer({
  data,
  sheets,
  activeSheetIndex = 0,
  onSheetChange,
  mimeType,
  onDownload,
  downloadDisabled,
}: ExcelPreviewerProps) {
  const [selectedRow, setSelectedRow] = useState<{
    tableIndex: number;
    rowIndex: number;
  } | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Modo crudo SIN heurísticas, para auditar el archivo original — la
  // robustez incluye poder desconfiar del propio visor.
  const [rawMode, setRawMode] = useState(false);

  const handleRowSelect = (tableIndex: number, rowIndex: number) => {
    setSelectedRow({ tableIndex, rowIndex });
    setDrawerOpen(true);
  };

  const sheetList = sheets?.map((s, i) => ({ name: s.name, index: i })) ?? [];

  const hasAnyData =
    data.metrics.length > 0 ||
    data.tables.length > 0 ||
    (data.kvBlocks?.length ?? 0) > 0 ||
    (data.summaryRows?.length ?? 0) > 0 ||
    (data.notes?.length ?? 0) > 0;

  const rowCount = data.tables.reduce((sum, t) => sum + t.rows.length, 0);
  const colCount = data.tables.reduce((max, t) => Math.max(max, t.columns.length), 0);

  // Métricas del informe + métricas automáticas (sumas de columnas numéricas,
  // etiquetadas con su columna de origen: "Σ Peso (kg)").
  const stripMetrics = useMemo(
    () => [...data.metrics, ...(data.autoMetrics ?? [])],
    [data.metrics, data.autoMetrics]
  );

  const autoMetrics = data.autoMetrics ?? [];
  const selectedTable = selectedRow !== null ? data.tables[selectedRow.tableIndex] : undefined;
  const selectedTableRow =
    selectedTable && selectedRow !== null
      ? selectedTable.rows.find((r) => r.rowIndex === selectedRow.rowIndex)
      : undefined;

  return (
    <div className="h-full flex flex-col gap-4 min-h-0">
      <PreviewHeader
        filename={data.filename}
        mimeType={mimeType}
        title={data.title}
        subtitle={data.subtitle}
        sheets={sheetList}
        activeSheetIndex={activeSheetIndex}
        onSheetChange={onSheetChange}
        rowCount={hasAnyData && !rawMode ? rowCount : undefined}
        colCount={hasAnyData && !rawMode ? colCount : undefined}
        onDownload={onDownload}
        downloadDisabled={downloadDisabled}
      />

      {data.rawGrid.length > 0 && (
        <div className="shrink-0 flex items-center justify-end -mt-2">
          <button
            type="button"
            onClick={() => setRawMode((v) => !v)}
            className={cn(
              "inline-flex h-7 items-center gap-1.5 px-2.5 rounded-lg text-[10px] font-semibold border transition-colors",
              rawMode
                ? "bg-primary/10 text-primary border-primary/30"
                : "bg-[var(--glass-bg)] text-muted-foreground border-[var(--glass-border)] hover:bg-[var(--glass-bg-strong)]"
            )}
            title={
              rawMode
                ? "Volver a la vista interpretada (cabeceras, tipos, filas descartadas)"
                : "Ver la hoja tal cual viene del archivo, sin ninguna heurística"
            }
          >
            {rawMode ? <Table2 className="h-3 w-3" /> : <FileSearch className="h-3 w-3" />}
            {rawMode ? "Vista interpretada" : "Ver todo en bruto"}
          </button>
        </div>
      )}

      {rawMode ? (
        <div className="flex-1 min-h-0 overflow-y-auto scrollbar-midas flex flex-col gap-4 pr-1">
          <RawGridView grid={data.rawGrid} />
        </div>
      ) : !hasAnyData ? (
        <div
          className={cn(
            "flex-1 min-h-0 flex flex-col items-center justify-center gap-2",
            "glass rounded-xl p-10",
            "text-sm text-muted-foreground"
          )}
        >
          <Inbox className="h-8 w-8 text-muted-foreground/40" />
          <p>El archivo no contiene datos legibles.</p>
        </div>
      ) : (
        <div className={cn("flex-1 min-h-0 overflow-y-auto scrollbar-midas", "flex flex-col gap-4 pr-1")}>
          {/* Sección 2: bloques clave-valor de la cabecera del informe. Si el
              parser no agrupó bloques (kvBlocks) pero sí hay métricas sueltas,
              se usa el strip plano como fallback. Las métricas automáticas
              (sumas por columna, etiqueta "Σ <columna>") van siempre en el strip. */}
          {data.kvBlocks && data.kvBlocks.length > 0 ? (
            <>
              <KeyValueGrid blocks={data.kvBlocks} />
              {autoMetrics.length > 0 && <MetricsStrip metrics={autoMetrics} />}
            </>
          ) : (
            stripMetrics.length > 0 && <MetricsStrip metrics={stripMetrics} />
          )}

          {/* Sección 3: tabla(s) principales, con fila de total como pie. */}
          {data.tables.map((table, i) => {
            const isSelectedTable = selectedRow?.tableIndex === i;
            return (
              <DataTable
                key={i}
                table={table}
                selectedRowIndex={isSelectedTable ? selectedRow!.rowIndex : null}
                onRowSelect={(rowIdx) => handleRowSelect(i, rowIdx)}
              />
            );
          })}

          {/* Sección 4: filas-resumen tipo mini-KPI tras la tabla. */}
          {data.summaryRows && data.summaryRows.length > 0 && <SummaryRowsStrip rows={data.summaryRows} />}

          {/* Sección 5: notas sueltas, al final. */}
          {data.notes && data.notes.length > 0 && <NotesList notes={data.notes} />}
        </div>
      )}

      {selectedTable && selectedTableRow && selectedRow && (
        <RowDetailDrawer
          open={drawerOpen}
          onOpenChange={setDrawerOpen}
          rowIndex={selectedRow.rowIndex}
          headers={selectedTable.columns.map((c) => c.header)}
          row={selectedTableRow.cells}
        />
      )}
    </div>
  );
}

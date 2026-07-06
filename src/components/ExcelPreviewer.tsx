import { useState } from "react";
import { Inbox } from "lucide-react";
import {
  PreviewHeader,
  MetricsStrip,
  DataTable,
  RowDetailDrawer,
  KeyValueGrid,
  SummaryRowsStrip,
  NotesList,
  type ParsedExcel,
  type SheetData,
} from "./excel-preview";
import { cn } from "@/lib/utils";

export type { ParsedExcel, Metric, DataTable, KeyValueBlock } from "./excel-preview/types";

interface ExcelPreviewerProps {
  data: ParsedExcel;
  sheets?: SheetData[];
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

  const handleRowSelect = (tableIndex: number, rowIndex: number) => {
    setSelectedRow({ tableIndex, rowIndex });
    setDrawerOpen(true);
  };

  const sheetList =
    sheets?.map((s, i) => ({ name: s.name, index: i })) ?? [];

  const hasAnyData =
    data.metrics.length > 0 ||
    data.tables.length > 0 ||
    (data.kvBlocks?.length ?? 0) > 0 ||
    (data.summaryRows?.length ?? 0) > 0 ||
    (data.notes?.length ?? 0) > 0;

  // Dimensiones de la hoja activa: filas × columnas totales sumando todas
  // las tablas detectadas en la hoja (normalmente hay una sola tabla por hoja).
  const rowCount = data.tables.reduce((sum, t) => sum + t.rows.length, 0);
  const colCount = data.tables.reduce((max, t) => Math.max(max, t.headers.length), 0);

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
        rowCount={hasAnyData ? rowCount : undefined}
        colCount={hasAnyData ? colCount : undefined}
        onDownload={onDownload}
        downloadDisabled={downloadDisabled}
      />

      {!hasAnyData ? (
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
        <div
          className={cn(
            "flex-1 min-h-0 overflow-y-auto scrollbar-midas",
            "flex flex-col gap-4 pr-1"
          )}
        >
          {/* Sección 2: bloques clave-valor de la cabecera del informe.
              Si el parser no agrupó bloques (kvBlocks) pero sí hay métricas
              sueltas (rutas legacy), se usa el strip plano como fallback. */}
          {data.kvBlocks && data.kvBlocks.length > 0 ? (
            <KeyValueGrid blocks={data.kvBlocks} />
          ) : (
            data.metrics.length > 0 && <MetricsStrip metrics={data.metrics} />
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
          {data.summaryRows && data.summaryRows.length > 0 && (
            <SummaryRowsStrip rows={data.summaryRows} />
          )}

          {/* Sección 5: notas sueltas, al final. */}
          {data.notes && data.notes.length > 0 && <NotesList notes={data.notes} />}
        </div>
      )}

      {selectedRow && data.tables[selectedRow.tableIndex] && (
        <RowDetailDrawer
          open={drawerOpen}
          onOpenChange={setDrawerOpen}
          rowIndex={selectedRow.rowIndex}
          headers={data.tables[selectedRow.tableIndex].headers}
          row={data.tables[selectedRow.tableIndex].rows[selectedRow.rowIndex]}
        />
      )}
    </div>
  );
}

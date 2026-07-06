import { useMemo, useState, useCallback } from "react";
import {
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  CheckCircle2,
  Eye,
  EyeOff,
  Rows3,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { StatusBadge } from "./StatusBadge";
import {
  columnMaxWidth,
  formatCell,
  isNumericColumn,
  isStatusColumn,
  matchStatus,
  numericHeaderHint,
} from "./formatters";
import type { DataTable as DataTableType } from "./types";

interface DataTableProps {
  table: DataTableType;
  selectedRowIndex?: number | null;
  onRowSelect?: (rowIndex: number, row: string[]) => void;
}

type SortDir = "asc" | "desc" | null;

interface ColumnMeta {
  index: number;
  header: string;
  numeric: boolean;
  status: boolean;
  width: string;
  populated: number;
  hideable: boolean;
}

function compareValues(a: string, b: string, numeric: boolean): number {
  if (numeric) {
    const an = parseFloat(a.replace(/[^\d.,-]/g, "").replace(/\./g, "").replace(",", "."));
    const bn = parseFloat(b.replace(/[^\d.,-]/g, "").replace(/\./g, "").replace(",", "."));
    if (!Number.isNaN(an) && !Number.isNaN(bn)) return an - bn;
  }
  return a.localeCompare(b, "es", { numeric: true, sensitivity: "base" });
}

// Detecta filas de resumen/total/subcategoría para darles estilo distinto
function isSummaryRow(row: string[]): "total" | "subcategory" | null {
  const nonEmpty = row.filter((c) => c && c.trim());
  if (nonEmpty.length === 0) return null;
  const first = nonEmpty[0].trim();
  if (/^total(es)?\b/i.test(first)) return "total";
  if (/^-\s/.test(first)) return "subcategory";
  // Si solo hay una celda con texto y el resto vacío, puede ser una subcategoría
  if (nonEmpty.length === 1 && first.length > 2 && !/^\d/.test(first)) return "subcategory";
  return null;
}

// Las cabeceras placeholder generadas por fillEmptyHeaders siguen el patrón
// "Col N" — se muestran atenuadas para diferenciarlas de nombres reales.
const PLACEHOLDER_HEADER_RE = /^Col \d+$/;

function colPopulated(rows: string[][], colIdx: number): number {
  let count = 0;
  for (const row of rows) {
    const cell = row[colIdx];
    if (cell && cell.trim()) count++;
  }
  return count;
}

export function DataTable({
  table,
  selectedRowIndex = null,
  onRowSelect,
}: DataTableProps) {
  const [sortCol, setSortCol] = useState<number | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>(null);
  const [hideEmpty, setHideEmpty] = useState(true);

  const allColumns: ColumnMeta[] = useMemo(
    () =>
      table.headers.map((h, i) => ({
        index: i,
        header: h,
        numeric: isNumericColumn(table.rows, i) || numericHeaderHint(h),
        status: isStatusColumn(h),
        width: columnMaxWidth(h, table.rows, i),
        populated: colPopulated(table.rows, i),
        hideable: colPopulated(table.rows, i) < table.rows.length * 0.2,
      })),
    [table.headers, table.rows]
  );

  const columns = useMemo(() => {
    if (!hideEmpty) return allColumns;
    const visible = allColumns.filter((c) => c.populated > 0);
    // Fallback: si todas las columnas estarían ocultas, mostrar todas
    return visible.length > 0 ? visible : allColumns;
  }, [allColumns, hideEmpty]);

  const sortedRows = useMemo(() => {
    if (sortCol === null || sortDir === null) return table.rows;
    const col = allColumns.find((c) => c.index === sortCol);
    if (!col) return table.rows;
    const indexed = table.rows.map((r, i) => ({ row: r, originalIndex: i }));
    indexed.sort((a, b) => {
      const av = a.row[sortCol] ?? "";
      const bv = b.row[sortCol] ?? "";
      const cmp = compareValues(av, bv, col.numeric);
      return sortDir === "asc" ? cmp : -cmp;
    });
    return indexed.map((x) => x.row);
  }, [table.rows, allColumns, sortCol, sortDir]);

  const handleHeaderClick = useCallback(
    (colIndex: number) => {
      if (sortCol !== colIndex) {
        setSortCol(colIndex);
        setSortDir("asc");
      } else if (sortDir === "asc") {
        setSortDir("desc");
      } else if (sortDir === "desc") {
        setSortCol(null);
        setSortDir(null);
      } else {
        setSortDir("asc");
      }
    },
    [sortCol, sortDir]
  );

  const handleCellClick = useCallback(async (value: string) => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      toast.success("Copiado al portapapeles", {
        description: value.length > 60 ? value.slice(0, 60) + "…" : value,
        duration: 1800,
      });
    } catch {
      toast.error("No se pudo copiar");
    }
  }, []);

  if (table.headers.length === 0 || table.rows.length === 0) {
    return (
      <div className="flex-1 min-h-0 flex items-center justify-center text-sm text-muted-foreground p-8">
        Esta sección no contiene datos.
      </div>
    );
  }

  const hiddenCount = allColumns.length - columns.length;

  return (
    <section className={cn("shrink-0 w-full glass rounded-xl overflow-hidden flex flex-col")}>
      <header className="shrink-0 flex items-center justify-between gap-3 px-4 py-3 border-b border-[var(--glass-border)]">
        <div className="min-w-0 flex items-center gap-3">
          <span className="hidden sm:inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg glass-strong text-muted-foreground">
            <Rows3 className="h-4 w-4" />
          </span>
          {table.section && (
            <h3 className="text-[11px] font-bold text-foreground uppercase tracking-widest truncate">
              {table.section}
            </h3>
          )}
          {table.description && (
            <p className="text-[11px] text-muted-foreground truncate">
              {table.description}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {allColumns.some((c) => c.hideable) && (
            <button
              onClick={() => setHideEmpty((v) => !v)}
              className={cn(
                "inline-flex h-7 items-center gap-1.5 px-2.5 rounded-lg text-[10px] font-semibold border transition-colors",
                hideEmpty
                  ? "bg-primary/10 text-primary border-primary/30"
                  : "bg-[var(--glass-bg)] text-muted-foreground border-[var(--glass-border)] hover:bg-[var(--glass-bg-strong)]"
              )}
              title={
                hideEmpty
                  ? "Mostrar todas las columnas"
                  : "Ocultar columnas con menos del 50% de datos"
              }
            >
              {hideEmpty ? (
                <EyeOff className="h-3 w-3" />
              ) : (
                <Eye className="h-3 w-3" />
              )}
              {hideEmpty ? `${columns.length} cols` : `${allColumns.length} cols`}
            </button>
          )}
          {table.rows.length > 0 && (
            <span className="inline-flex h-7 items-center gap-1.5 px-2.5 rounded-lg text-[10px] font-semibold bg-success/10 text-success border border-success/40">
              <CheckCircle2 className="h-3 w-3" />
              Validado
            </span>
          )}
        </div>
      </header>

      {hiddenCount > 0 && (
        <div className="shrink-0 px-4 py-1 text-[10px] text-muted-foreground bg-warning/10 border-b border-warning/30">
          {hiddenCount} columna{hiddenCount !== 1 ? "s" : ""} con poca
          información ocultada{hiddenCount !== 1 ? "s" : ""}.
        </div>
      )}

      <div className="overflow-x-auto overflow-y-auto scrollbar-midas max-h-[62vh]">
        <table className="min-w-full w-max table-fixed border-collapse text-[12.5px]">
          <colgroup>
            {columns.map((col) => (
              <col key={col.index} style={{ width: col.width }} />
            ))}
          </colgroup>
          <thead className="sticky top-0 z-20">
            <tr className="glass-strong">
              {columns.map((col) => {
                const isSorted = sortCol === col.index;
                const SortIcon =
                  isSorted && sortDir === "asc"
                    ? ArrowUp
                    : isSorted && sortDir === "desc"
                    ? ArrowDown
                    : ArrowUpDown;
                const isPlaceholder = PLACEHOLDER_HEADER_RE.test(col.header);
                return (
                  <th
                    key={col.index}
                    onClick={() => handleHeaderClick(col.index)}
                    className={cn(
                      "px-3 py-2.5 border-b border-[var(--glass-border)]",
                      "text-[11px] font-bold uppercase tracking-wider",
                      isPlaceholder ? "text-muted-foreground/60" : "text-foreground",
                      "cursor-pointer select-none whitespace-nowrap",
                      "hover:bg-[var(--glass-bg-strong)] transition-colors group bg-[var(--glass-bg-strong)]",
                      col.index === 0 && "sticky left-0 z-30",
                      col.numeric ? "text-right" : "text-left"
                    )}
                  >
                    <span
                      className={cn(
                        "inline-flex max-w-full items-center gap-1.5",
                        col.numeric && "flex-row-reverse"
                      )}
                    >
                      <span className="truncate">{col.header}</span>
                      <SortIcon
                        className={cn(
                          "h-3 w-3 shrink-0",
                          isSorted ? "text-primary" : "text-muted-foreground/40 group-hover:text-muted-foreground"
                        )}
                      />
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((row, ri) => {
              const originalIndex = table.rows.indexOf(row);
              const isSelected = selectedRowIndex === originalIndex;
              const summaryType = isSummaryRow(row);
              const isZebra = ri % 2 === 1 && !summaryType;
              return (
                <tr
                  key={ri}
                  onClick={() => onRowSelect?.(originalIndex, row)}
                    className={cn(
                      "transition-colors cursor-pointer",
                    isZebra && "bg-[var(--glass-bg)]",
                    summaryType === "total" && "bg-[var(--glass-bg-strong)] font-semibold",
                    summaryType === "subcategory" && "bg-[var(--glass-bg)] pl-6",
                    isSelected
                      ? "!bg-primary/10 border-l-2 border-l-primary"
                      : "border-l-2 border-l-transparent hover:!bg-primary/5"
                  )}
                >
                  {columns.map((col) => {
                    const raw = row[col.index] ?? "";
                    const isEmpty = !raw || !raw.trim();
                    const isFirstTextCol = col.index === 0 && !col.numeric;
                    return (
                      <td
                        key={col.index}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleCellClick(raw);
                        }}
                        className={cn(
                          "px-3 py-1.5 border-b border-[var(--glass-border)] align-middle",
                          "whitespace-nowrap overflow-hidden text-ellipsis",
                          isEmpty ? "select-none text-muted-foreground/40" : "text-foreground",
                          isFirstTextCol && !isEmpty && "font-semibold",
                          col.index === 0 && cn(
                            "sticky left-0 z-10",
                            summaryType === "total" ? "bg-[var(--glass-bg-strong)]" : isZebra ? "bg-[var(--glass-bg)]" : "bg-card"
                          ),
                          isSelected && col.index === 0 && "!bg-primary/10",
                          col.numeric ? "text-right tabular-nums" : "text-left"
                        )}
                        title={isEmpty ? "vacío" : raw}
                      >
                        {isEmpty ? (
                          <span aria-hidden="true">—</span>
                        ) : col.status ? (
                          <StatusBadge value={raw} status={matchStatus(raw)} />
                        ) : (
                          formatCell(raw)
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

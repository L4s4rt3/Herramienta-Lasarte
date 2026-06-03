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
      <div className="flex-1 min-h-0 flex items-center justify-center text-sm text-slate-500 p-8">
        Esta sección no contiene datos.
      </div>
    );
  }

  const hiddenCount = allColumns.length - columns.length;

  return (
    <section
      className={cn(
        "shrink-0 w-full rounded-xl border border-slate-200/70",
        "bg-white/85 backdrop-blur-sm shadow-[0_10px_28px_rgba(15,23,42,0.08)]",
        "overflow-hidden flex flex-col"
      )}
    >
      <header className="shrink-0 flex items-center justify-between gap-3 px-4 py-3 border-b border-slate-200/80 bg-gradient-to-r from-slate-50 via-white to-emerald-50/45">
        <div className="min-w-0 flex items-center gap-3">
          <span className="hidden sm:inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 shadow-sm">
            <Rows3 className="h-4 w-4" />
          </span>
          {table.section && (
            <h3 className="text-[11px] font-bold text-slate-800 uppercase tracking-widest truncate">
              {table.section}
            </h3>
          )}
          {table.description && (
            <p className="text-[11px] text-slate-500 truncate">
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
                  ? "bg-orange-500/10 text-orange-700 border-orange-500/30"
                  : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
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
            <span className="inline-flex h-7 items-center gap-1.5 px-2.5 rounded-lg text-[10px] font-semibold bg-emerald-500/10 text-emerald-700 border border-emerald-500/25">
              <CheckCircle2 className="h-3 w-3" />
              Validado
            </span>
          )}
        </div>
      </header>

      {hiddenCount > 0 && (
        <div className="shrink-0 px-4 py-1 text-[10px] text-slate-500 bg-amber-50/60 border-b border-amber-200/40">
          {hiddenCount} columna{hiddenCount !== 1 ? "s" : ""} con poca
          información ocultada{hiddenCount !== 1 ? "s" : ""}.
        </div>
      )}

      <div className="overflow-auto scrollbar-midas max-h-[62vh] bg-white">
        <table className="min-w-full w-max table-fixed border-collapse text-[12px]">
          <colgroup>
            {columns.map((col) => (
              <col key={col.index} style={{ width: col.width }} />
            ))}
          </colgroup>
          <thead className="sticky top-0 z-20">
            <tr className="bg-slate-100/95 backdrop-blur-sm shadow-[0_2px_8px_rgba(15,23,42,0.09)]">
              {columns.map((col) => {
                const isSorted = sortCol === col.index;
                const SortIcon =
                  isSorted && sortDir === "asc"
                    ? ArrowUp
                    : isSorted && sortDir === "desc"
                    ? ArrowDown
                    : ArrowUpDown;
                return (
                  <th
                    key={col.index}
                    onClick={() => handleHeaderClick(col.index)}
                    className={cn(
                      "px-3 py-3 font-bold border-b border-slate-300/80",
                      "text-slate-700 cursor-pointer select-none whitespace-nowrap",
                      "hover:bg-white transition-colors group",
                      col.index === 0 && "sticky left-0 z-30 bg-slate-100/95 shadow-[1px_0_0_rgba(148,163,184,0.35)]",
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
                          isSorted ? "text-orange-600" : "text-slate-300 group-hover:text-slate-400"
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
              return (
                <tr
                  key={ri}
                  onClick={() => onRowSelect?.(originalIndex, row)}
                    className={cn(
                      "transition-colors cursor-pointer",
                    ri % 2 === 1 && !summaryType && "bg-slate-50/55",
                    summaryType === "total" && "bg-slate-100/80 font-semibold",
                    summaryType === "subcategory" && "bg-slate-50/60 pl-6",
                    isSelected
                      ? "!bg-orange-50/70 border-l-2 border-l-orange-500"
                      : "border-l-2 border-l-transparent hover:!bg-orange-50/40"
                  )}
                >
                  {columns.map((col) => {
                    const raw = row[col.index] ?? "";
                    const isEmpty = !raw || !raw.trim();
                    return (
                      <td
                        key={col.index}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleCellClick(raw);
                        }}
                        className={cn(
                          "px-3 py-2.5 border-b border-slate-200/70 align-middle",
                          "whitespace-nowrap overflow-hidden text-ellipsis",
                          isEmpty ? "select-none" : "text-slate-800",
                          col.index === 0 && cn(
                            "sticky left-0 z-10 shadow-[1px_0_0_rgba(226,232,240,0.9)]",
                            summaryType === "total" ? "bg-slate-100" : ri % 2 === 1 ? "bg-slate-50" : "bg-white"
                          ),
                          isSelected && col.index === 0 && "!bg-orange-50",
                          col.numeric ? "text-right tabular-nums" : "text-left"
                        )}
                        title={isEmpty ? "vacío" : raw}
                      >
                        {isEmpty ? (
                          <span className="text-slate-200 text-base leading-none">·</span>
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

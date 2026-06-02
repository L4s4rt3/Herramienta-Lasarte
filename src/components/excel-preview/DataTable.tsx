import { useMemo, useState, useCallback } from "react";
import { ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { StatusBadge } from "./StatusBadge";
import {
  formatCell,
  isNumericColumn,
  isStatusColumn,
  matchStatus,
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
  width?: string;
}

function compareValues(a: string, b: string, numeric: boolean): number {
  if (numeric) {
    const an = parseFloat(a.replace(/[^\d.,-]/g, "").replace(/\./g, "").replace(",", "."));
    const bn = parseFloat(b.replace(/[^\d.,-]/g, "").replace(/\./g, "").replace(",", "."));
    if (!Number.isNaN(an) && !Number.isNaN(bn)) return an - bn;
  }
  return a.localeCompare(b, "es", { numeric: true, sensitivity: "base" });
}

export function DataTable({
  table,
  selectedRowIndex = null,
  onRowSelect,
}: DataTableProps) {
  const [sortCol, setSortCol] = useState<number | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>(null);

  const columns: ColumnMeta[] = useMemo(
    () =>
      table.headers.map((h, i) => ({
        index: i,
        header: h,
        numeric: isNumericColumn(table.rows, i),
        status: isStatusColumn(h),
      })),
    [table.headers, table.rows]
  );

  const sortedRows = useMemo(() => {
    if (sortCol === null || sortDir === null) return table.rows;
    const col = columns[sortCol];
    if (!col) return table.rows;
    const indexed = table.rows.map((r, i) => ({ row: r, originalIndex: i }));
    indexed.sort((a, b) => {
      const av = a.row[sortCol] ?? "";
      const bv = b.row[sortCol] ?? "";
      const cmp = compareValues(av, bv, col.numeric);
      return sortDir === "asc" ? cmp : -cmp;
    });
    return indexed.map((x) => x.row);
  }, [table.rows, columns, sortCol, sortDir]);

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

  const handleCellClick = useCallback(
    async (value: string) => {
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
    },
    []
  );

  if (table.headers.length === 0 || table.rows.length === 0) {
    return (
      <div className="flex-1 min-h-0 flex items-center justify-center text-sm text-slate-500 p-8">
        Esta sección no contiene datos.
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 rounded-xl border border-slate-200/60 bg-white/60 backdrop-blur-sm shadow-[0_4px_16px_rgba(15,23,42,0.06)] overflow-hidden flex flex-col">
      <div className="flex-1 min-h-0 overflow-auto scrollbar-midas">
        <table className="w-full text-xs border-collapse">
          <thead className="sticky top-0 z-20">
            <tr className="bg-slate-50/95 backdrop-blur-sm shadow-[0_2px_6px_rgba(15,23,42,0.06)]">
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
                      "px-3 py-2.5 font-semibold border-b border-slate-200/80",
                      "text-slate-700 cursor-pointer select-none whitespace-nowrap",
                      "hover:bg-slate-100/60 transition-colors group",
                      col.numeric ? "text-right" : "text-left"
                    )}
                  >
                    <span
                      className={cn(
                        "inline-flex items-center gap-1",
                        col.numeric && "flex-row-reverse"
                      )}
                    >
                      {col.header}
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
              return (
                <tr
                  key={ri}
                  onClick={() => onRowSelect?.(originalIndex, row)}
                  className={cn(
                    "transition-colors cursor-pointer",
                    isSelected
                      ? "bg-orange-50/70 border-l-2 border-l-orange-500"
                      : "border-l-2 border-l-transparent hover:bg-orange-50/40"
                  )}
                >
                  {columns.map((col) => {
                    const raw = row[col.index] ?? "";
                    return (
                      <td
                        key={col.index}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleCellClick(raw);
                        }}
                        className={cn(
                          "px-3 py-2.5 border-b border-slate-200/60",
                          "text-slate-800 whitespace-nowrap",
                          col.numeric ? "text-right tabular-nums" : "text-left"
                        )}
                        title={raw}
                      >
                        {col.status ? (
                          <StatusBadge
                            value={raw}
                            status={matchStatus(raw)}
                          />
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
    </div>
  );
}

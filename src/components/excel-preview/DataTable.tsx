import { useMemo, useState, useCallback, useEffect } from "react";
import {
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  Info,
  Rows3,
  Search,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { StatusBadge } from "./StatusBadge";
import { columnMaxWidth, isStatusColumn, matchStatus } from "./formatters";
import { DEFAULT_PAGE_SIZE, parseLooseNumber, totalPages } from "@/lib/excelPreview";
import type { ColumnType, DataTableRow, ParsedTable } from "./types";

interface DataTableProps {
  table: ParsedTable;
  selectedRowIndex?: number | null;
  onRowSelect?: (rowIndex: number, row: string[]) => void;
}

type SortDir = "asc" | "desc" | null;

interface ColumnMeta {
  /** Índice de columna dentro de table.columns / cells. */
  index: number;
  header: string;
  type: ColumnType;
  isPlaceholder: boolean;
  status: boolean;
  width: string;
  populated: number;
}

/** Clave ordenable para una celda ya formateada, según el tipo de su columna. */
function sortKey(cell: string, type: ColumnType): number | string {
  if (type === "number" || type === "percent") {
    const n = parseLooseNumber(cell.replace(/%$/, ""));
    return n === null ? Number.NEGATIVE_INFINITY : n;
  }
  if (type === "date") {
    const m = cell.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
    if (m) return `${m[3]}${m[2]}${m[1]}`;
    return cell;
  }
  return cell;
}

function compareCells(a: string, b: string, type: ColumnType): number {
  const ka = sortKey(a, type);
  const kb = sortKey(b, type);
  if (typeof ka === "number" && typeof kb === "number") return ka - kb;
  return String(ka).localeCompare(String(kb), "es", { numeric: true, sensitivity: "base" });
}

// Alineación por tipo: números a la derecha con tabular-nums, fechas
// centradas, texto a la izquierda.
function alignClass(type: ColumnType): string {
  if (type === "number" || type === "percent") return "text-right tabular-nums";
  if (type === "date") return "text-center tabular-nums";
  return "text-left";
}

export function DataTable({ table, selectedRowIndex = null, onRowSelect }: DataTableProps) {
  const [sortCol, setSortCol] = useState<number | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>(null);
  const [hideEmpty, setHideEmpty] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [showDiscarded, setShowDiscarded] = useState(false);

  const allColumns: ColumnMeta[] = useMemo(() => {
    const populated = table.columns.map(() => 0);
    for (const row of table.rows) {
      for (let i = 0; i < row.cells.length; i++) {
        if (row.cells[i] && row.cells[i].trim()) populated[i]++;
      }
    }
    const legacyRows = table.rows.map((r) => r.cells);
    return table.columns.map((col) => ({
      index: col.index,
      header: col.header,
      type: col.type,
      isPlaceholder: col.isPlaceholder,
      status: isStatusColumn(col.header),
      width: columnMaxWidth(col.header, legacyRows, col.index),
      populated: populated[col.index],
    }));
  }, [table.columns, table.rows]);

  const columns = useMemo(() => {
    if (!hideEmpty) return allColumns;
    const visible = allColumns.filter((c) => c.populated > 0);
    return visible.length > 0 ? visible : allColumns;
  }, [allColumns, hideEmpty]);

  // Buscador de texto en el contenido: filtra filas por subcadena sobre las
  // celdas ya formateadas (lo que el usuario ve es lo que busca).
  const normalizedSearch = search.trim().toLowerCase();
  const filteredRows: DataTableRow[] = useMemo(() => {
    if (!normalizedSearch) return table.rows;
    return table.rows.filter((row) => row.cells.some((c) => c.toLowerCase().includes(normalizedSearch)));
  }, [table.rows, normalizedSearch]);

  const sortedRows: DataTableRow[] = useMemo(() => {
    if (sortCol === null || sortDir === null) return filteredRows;
    const col = allColumns.find((c) => c.index === sortCol);
    if (!col) return filteredRows;
    const copy = filteredRows.slice();
    copy.sort((a, b) => {
      const cmp = compareCells(a.cells[sortCol] ?? "", b.cells[sortCol] ?? "", col.type);
      return sortDir === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [filteredRows, allColumns, sortCol, sortDir]);

  // Paginación: los archivos reales llegan a 39.000 filas — nunca se montan
  // más de DEFAULT_PAGE_SIZE filas de DOM a la vez.
  const pageCount = totalPages(sortedRows.length, DEFAULT_PAGE_SIZE);
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = useMemo(
    () => sortedRows.slice(safePage * DEFAULT_PAGE_SIZE, (safePage + 1) * DEFAULT_PAGE_SIZE),
    [sortedRows, safePage]
  );

  useEffect(() => {
    setPage(0);
  }, [normalizedSearch, sortCol, sortDir]);

  const handleHeaderClick = useCallback(
    (colIndex: number) => {
      if (sortCol !== colIndex) {
        setSortCol(colIndex);
        setSortDir("asc");
      } else if (sortDir === "asc") {
        setSortDir("desc");
      } else {
        setSortCol(null);
        setSortDir(null);
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

  if (table.columns.length === 0 || table.rows.length === 0) {
    return (
      <div className="flex-1 min-h-0 flex items-center justify-center text-sm text-muted-foreground p-8">
        Esta sección no contiene datos.
      </div>
    );
  }

  const hiddenCount = allColumns.length - columns.length;
  const discardedCount = table.discarded.length;

  return (
    <section className={cn("shrink-0 w-full glass rounded-xl overflow-hidden flex flex-col")}>
      <header className="shrink-0 flex items-center justify-between gap-3 px-4 py-3 border-b border-[var(--glass-border)] flex-wrap">
        <div className="min-w-0 flex items-center gap-3">
          <span className="hidden sm:inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg glass-strong text-muted-foreground">
            <Rows3 className="h-4 w-4" />
          </span>
          {table.section && (
            <h3 className="text-[11px] font-bold text-foreground uppercase tracking-widest truncate">
              {table.section}
            </h3>
          )}
          <p className="text-[11px] text-muted-foreground truncate tabular-nums">
            {table.rows.length} fila{table.rows.length !== 1 ? "s" : ""} · {table.columns.length} columna
            {table.columns.length !== 1 ? "s" : ""}
            {discardedCount > 0 && ` · ${discardedCount} descartada${discardedCount !== 1 ? "s" : ""} como decorativas`}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          <label className="relative inline-flex items-center">
            <Search className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-muted-foreground/60" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar en la tabla…"
              className={cn(
                "h-7 w-44 rounded-lg pl-8 pr-7 text-[11px]",
                "bg-[var(--glass-bg)] border border-[var(--glass-border)]",
                "text-foreground placeholder:text-muted-foreground/60",
                "focus:outline-none focus:ring-1 focus:ring-primary/40"
              )}
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="absolute right-2 text-muted-foreground/60 hover:text-foreground"
                aria-label="Limpiar búsqueda"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </label>
          {allColumns.some((c) => c.populated === 0) && (
            <button
              onClick={() => setHideEmpty((v) => !v)}
              className={cn(
                "inline-flex h-7 items-center gap-1.5 px-2.5 rounded-lg text-[10px] font-semibold border transition-colors",
                hideEmpty
                  ? "bg-primary/10 text-primary border-primary/30"
                  : "bg-[var(--glass-bg)] text-muted-foreground border-[var(--glass-border)] hover:bg-[var(--glass-bg-strong)]"
              )}
              title={hideEmpty ? "Mostrar también las columnas vacías" : "Ocultar columnas sin datos"}
            >
              {hideEmpty ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
              {columns.length}/{allColumns.length} cols
            </button>
          )}
          {discardedCount > 0 && (
            <button
              onClick={() => setShowDiscarded((v) => !v)}
              className={cn(
                "inline-flex h-7 items-center gap-1.5 px-2.5 rounded-lg text-[10px] font-semibold border transition-colors",
                showDiscarded
                  ? "bg-primary/10 text-primary border-primary/30"
                  : "bg-[var(--glass-bg)] text-muted-foreground border-[var(--glass-border)] hover:bg-[var(--glass-bg-strong)]"
              )}
              title="Ver qué filas se descartaron y por qué"
            >
              <Info className="h-3 w-3" />
              {discardedCount} descartada{discardedCount !== 1 ? "s" : ""}
            </button>
          )}
        </div>
      </header>

      {showDiscarded && discardedCount > 0 && (
        <div className="shrink-0 px-4 py-2 border-b border-[var(--glass-border)] bg-[var(--glass-bg)] max-h-40 overflow-y-auto scrollbar-midas">
          <ul className="space-y-1">
            {table.discarded.slice(0, 30).map((d, i) => (
              <li key={i} className="text-[11px] text-muted-foreground flex items-baseline gap-2">
                <span className="shrink-0 tabular-nums font-semibold">fila {d.rowNumber}</span>
                <span className="shrink-0">{d.reason}:</span>
                <span className="truncate italic">{d.preview || "(vacía)"}</span>
              </li>
            ))}
            {discardedCount > 30 && (
              <li className="text-[11px] text-muted-foreground/60">… y {discardedCount - 30} más</li>
            )}
          </ul>
        </div>
      )}

      {hiddenCount > 0 && (
        <div className="shrink-0 px-4 py-1 text-[10px] text-muted-foreground bg-[var(--glass-bg)] border-b border-[var(--glass-border)]">
          {hiddenCount} columna{hiddenCount !== 1 ? "s" : ""} sin datos ocultada{hiddenCount !== 1 ? "s" : ""}.
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
                  isSorted && sortDir === "asc" ? ArrowUp : isSorted && sortDir === "desc" ? ArrowDown : ArrowUpDown;
                const numeric = col.type === "number" || col.type === "percent";
                return (
                  <th
                    key={col.index}
                    onClick={() => handleHeaderClick(col.index)}
                    className={cn(
                      "px-3 py-2.5 border-b border-[var(--glass-border)]",
                      "text-[11px] font-bold uppercase tracking-wider",
                      col.isPlaceholder ? "text-muted-foreground/60" : "text-foreground",
                      "cursor-pointer select-none whitespace-nowrap",
                      // Fondo casi opaco: al hacer scroll, el contenido de las
                      // filas no debe leerse a través de la cabecera fija.
                      "hover:bg-[var(--glass-bg-solid)] transition-colors group bg-[var(--glass-bg-solid)]",
                      col.index === columns[0].index && "sticky left-0 z-30",
                      numeric ? "text-right" : col.type === "date" ? "text-center" : "text-left"
                    )}
                    title={`${col.header} · ${
                      col.type === "number"
                        ? "numérica"
                        : col.type === "percent"
                        ? "porcentaje"
                        : col.type === "date"
                        ? "fecha"
                        : "texto"
                    }`}
                  >
                    <span className={cn("inline-flex max-w-full items-center gap-1.5", numeric && "flex-row-reverse")}>
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
            {pageRows.map((row, ri) => {
              const isSelected = selectedRowIndex === row.rowIndex;
              const isZebra = ri % 2 === 1;
              return (
                <tr
                  key={row.rowIndex}
                  onClick={() => onRowSelect?.(row.rowIndex, row.cells)}
                  className={cn(
                    "transition-colors cursor-pointer",
                    isZebra && "bg-[var(--glass-bg)]",
                    isSelected
                      ? "!bg-primary/10 border-l-2 border-l-primary"
                      : "border-l-2 border-l-transparent hover:!bg-primary/5"
                  )}
                >
                  {columns.map((col, colPos) => {
                    const raw = row.cells[col.index] ?? "";
                    const isEmpty = !raw || !raw.trim();
                    const isFirstTextCol = colPos === 0 && col.type === "text";
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
                          // Fondo casi opaco en la columna fija: evita que el
                          // resto de columnas se transparente por debajo al
                          // hacer scroll horizontal.
                          colPos === 0 && "sticky left-0 z-10 bg-[var(--glass-bg-solid)]",
                          isSelected && colPos === 0 && "!bg-primary/10",
                          alignClass(col.type)
                        )}
                        title={isEmpty ? "vacío" : raw}
                      >
                        {isEmpty ? (
                          <span aria-hidden="true">—</span>
                        ) : col.status ? (
                          <StatusBadge value={raw} status={matchStatus(raw)} />
                        ) : (
                          raw
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
          {table.totalRow && (
            <tfoot className="sticky bottom-0 z-20">
              <tr className="bg-[var(--glass-bg-solid)] font-bold">
                {columns.map((col, colPos) => {
                  const raw = table.totalRow?.[col.index] ?? "";
                  const isEmpty = !raw || !raw.trim();
                  return (
                    <td
                      key={col.index}
                      className={cn(
                        "px-3 py-2 border-t-2 border-[var(--glass-border-accent)] align-middle",
                        "whitespace-nowrap overflow-hidden text-ellipsis text-foreground",
                        colPos === 0 && "sticky left-0 z-10 bg-[var(--glass-bg-solid)]",
                        alignClass(col.type)
                      )}
                      title={isEmpty ? "" : raw}
                    >
                      {isEmpty ? (colPos === 0 ? "Total" : "") : raw}
                    </td>
                  );
                })}
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {(pageCount > 1 || normalizedSearch) && (
        <footer className="shrink-0 flex items-center justify-between gap-3 px-4 py-2 border-t border-[var(--glass-border)]">
          <span className="text-[11px] text-muted-foreground tabular-nums">
            {normalizedSearch
              ? `${sortedRows.length} de ${table.rows.length} filas coinciden`
              : `${sortedRows.length} filas`}
          </span>
          {pageCount > 1 && (
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={safePage === 0}
                className={cn(
                  "inline-flex h-7 w-7 items-center justify-center rounded-lg border border-[var(--glass-border)]",
                  "text-muted-foreground hover:bg-[var(--glass-bg-strong)] disabled:opacity-40 disabled:pointer-events-none"
                )}
                aria-label="Página anterior"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
              <span className="text-[11px] text-muted-foreground tabular-nums px-1">
                {safePage + 1} / {pageCount}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                disabled={safePage >= pageCount - 1}
                className={cn(
                  "inline-flex h-7 w-7 items-center justify-center rounded-lg border border-[var(--glass-border)]",
                  "text-muted-foreground hover:bg-[var(--glass-bg-strong)] disabled:opacity-40 disabled:pointer-events-none"
                )}
                aria-label="Página siguiente"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </footer>
      )}
    </section>
  );
}

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { DEFAULT_PAGE_SIZE, totalPages } from "@/lib/excelPreview";

interface RawGridViewProps {
  /** Rejilla cruda de la hoja (tras rellenar celdas combinadas, SIN más heurísticas). */
  grid: string[][];
}

/** Letra de columna estilo Excel: 0→A, 25→Z, 26→AA... */
function columnLetter(index: number): string {
  let s = "";
  let n = index;
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

/**
 * Modo "ver todo en bruto": pinta la hoja tal cual viene del archivo, sin
 * detección de cabecera, sin tipado, sin descartar filas — para poder
 * auditar el archivo original y desconfiar del propio visor si hace falta.
 * Solo se pagina (los archivos reales llegan a 39.000 filas).
 */
export function RawGridView({ grid }: RawGridViewProps) {
  const [page, setPage] = useState(0);

  const colCount = useMemo(() => grid.reduce((max, r) => Math.max(max, r.length), 0), [grid]);
  const pageCount = totalPages(grid.length, DEFAULT_PAGE_SIZE);
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = useMemo(
    () => grid.slice(safePage * DEFAULT_PAGE_SIZE, (safePage + 1) * DEFAULT_PAGE_SIZE),
    [grid, safePage]
  );

  if (grid.length === 0) {
    return (
      <div className="flex-1 min-h-0 flex items-center justify-center text-sm text-muted-foreground p-8">
        La hoja está vacía.
      </div>
    );
  }

  return (
    <section className="shrink-0 w-full glass rounded-xl overflow-hidden flex flex-col">
      <header className="shrink-0 flex items-center justify-between gap-3 px-4 py-3 border-b border-[var(--glass-border)]">
        <p className="text-[11px] text-muted-foreground tabular-nums">
          Vista en bruto · {grid.length} fila{grid.length !== 1 ? "s" : ""} × {colCount} columna
          {colCount !== 1 ? "s" : ""} · sin heurísticas
        </p>
      </header>

      <div className="overflow-x-auto overflow-y-auto scrollbar-midas max-h-[62vh]">
        <table className="min-w-full w-max border-collapse text-[12px]">
          <thead className="sticky top-0 z-20">
            <tr>
              <th className="px-2 py-1.5 bg-[var(--glass-bg-solid)] border-b border-[var(--glass-border)] text-[10px] font-bold text-muted-foreground/60 sticky left-0 z-30 text-right tabular-nums">
                #
              </th>
              {Array.from({ length: colCount }, (_, c) => (
                <th
                  key={c}
                  className="px-3 py-1.5 bg-[var(--glass-bg-solid)] border-b border-[var(--glass-border)] text-[10px] font-bold text-muted-foreground/60 text-center"
                >
                  {columnLetter(c)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((row, ri) => {
              const rowNumber = safePage * DEFAULT_PAGE_SIZE + ri + 1;
              return (
                <tr key={rowNumber} className={cn(ri % 2 === 1 && "bg-[var(--glass-bg)]")}>
                  <td className="px-2 py-1 border-b border-[var(--glass-border)] text-[10px] text-muted-foreground/60 sticky left-0 z-10 bg-[var(--glass-bg-solid)] text-right tabular-nums select-none">
                    {rowNumber}
                  </td>
                  {Array.from({ length: colCount }, (_, c) => {
                    const cell = row[c] ?? "";
                    return (
                      <td
                        key={c}
                        className={cn(
                          "px-3 py-1 border-b border-[var(--glass-border)] align-middle",
                          "whitespace-nowrap overflow-hidden text-ellipsis max-w-[18rem]",
                          cell ? "text-foreground" : "text-muted-foreground/30 select-none"
                        )}
                        title={cell || undefined}
                      >
                        {cell || "·"}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {pageCount > 1 && (
        <footer className="shrink-0 flex items-center justify-end gap-1.5 px-4 py-2 border-t border-[var(--glass-border)]">
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
        </footer>
      )}
    </section>
  );
}

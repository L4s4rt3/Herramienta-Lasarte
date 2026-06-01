import React from "react";
import { FileSpreadsheet, CheckCircle2 } from "lucide-react";

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

interface ExcelPreviewerProps {
  data: ParsedExcel;
}

export default function ExcelPreviewer({ data }: ExcelPreviewerProps) {
  return (
    // Contenedor con scroll vertical. La tabla interior usa table-auto y
    // truncate para que NUNCA haya scroll horizontal — la amplitud del
    // dialog se encarga de acomodar todas las columnas.
    <div className="w-full max-h-[60vh] overflow-y-auto scrollbar-midas pr-1 -mr-1 space-y-5">
      {/* HEADER DEL ARCHIVO (glass) */}
      <div className="rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg)] backdrop-blur-xl shadow-[var(--glass-shadow)] p-4">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md font-bold text-[10px] uppercase tracking-wider bg-orange-500/10 text-orange-600 border border-orange-500/20">
            <FileSpreadsheet className="h-3 w-3" />
            XLSX
          </span>
          <h1 className="text-base font-bold text-foreground tracking-tight truncate">
            {data.filename}
          </h1>
        </div>
        {(data.title || data.subtitle) && (
          <p className="text-xs text-muted-foreground mt-1">
            {data.title && <span>{data.title}</span>}
            {data.title && data.subtitle && (
              <span className="mx-1.5 text-muted-foreground/50">•</span>
            )}
            {data.subtitle && (
              <span className="font-semibold text-foreground/80">{data.subtitle}</span>
            )}
          </p>
        )}
      </div>

      {/* GRID DE MÉTRICAS (glass) */}
      {data.metrics.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {data.metrics.map((metric, i) => (
            <div
              key={i}
              className="relative overflow-hidden rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg)] backdrop-blur-xl shadow-[var(--glass-shadow)] hover:bg-[var(--glass-bg-strong)] transition-colors p-4"
            >
              <div className="absolute top-0 left-0 w-1 h-full bg-gradient-to-b from-orange-500 to-orange-600" />
              {metric.category && (
                <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                  {metric.category}
                </p>
              )}
              <h3 className="text-xs font-medium text-foreground/80 mt-0.5">
                {metric.label}
              </h3>
              <p className="text-2xl font-bold text-foreground mt-1.5 tracking-tight tabular-nums">
                {metric.value}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* TABLAS (glass, sin scroll horizontal) */}
      {data.tables.length > 0 &&
        data.tables.map((table, i) => (
          <div key={i} className="rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg)] backdrop-blur-xl shadow-[var(--glass-shadow)] overflow-hidden">
            {/* Encabezado de la sección */}
            {(table.section || table.description) && (
              <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-[var(--glass-border)] bg-[var(--glass-bg-strong)]">
                <div className="min-w-0">
                  {table.section && (
                    <h2 className="text-xs font-bold text-foreground uppercase tracking-wider truncate">
                      {table.section}
                    </h2>
                  )}
                  {table.description && (
                    <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
                      {table.description}
                    </p>
                  )}
                </div>
                {table.rows.length > 0 && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold shrink-0 bg-emerald-500/10 text-emerald-600 border border-emerald-500/20">
                    <CheckCircle2 className="h-2.5 w-2.5" />
                    Validado
                  </span>
                )}
              </div>
            )}

            {table.headers.length > 0 && table.rows.length > 0 ? (
              // SIN overflow-x-auto: la tabla usa table-auto y las celdas
              // truncate para que se acomode al ancho del dialog sin
              // generar scroll horizontal.
              <div className="overflow-y-auto max-h-[40vh] scrollbar-midas">
                <table className="w-full text-xs border-collapse table-auto">
                  <thead className="sticky top-0 z-20">
                    <tr className="bg-[var(--glass-bg-strong)]/90 backdrop-blur-xl backdrop-saturate-150 shadow-[0_2px_8px_rgba(0,0,0,0.08)]">
                      <th className="sticky left-0 z-30 px-2 py-2 text-left font-semibold border-b border-r border-[var(--glass-border)] text-muted-foreground bg-[var(--glass-bg-strong)]/90 backdrop-blur-xl w-9 min-w-[2.25rem]">
                        #
                      </th>
                      {table.headers.map((h, ci) => (
                        <th
                          key={ci}
                          className="px-2.5 py-2 text-left font-semibold border-b border-[var(--glass-border)] whitespace-nowrap text-foreground/80"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {table.rows.map((row, ri) => (
                      <tr
                        key={ri}
                        className={ri % 2 === 0 ? "" : "bg-[var(--glass-bg)]/50"}
                      >
                        <td className="sticky left-0 z-[5] px-2 py-1.5 border-b border-r border-[var(--glass-border)] text-muted-foreground/50 font-mono text-[10px] bg-[var(--glass-bg-strong)]/70 backdrop-blur-sm">
                          {ri + 1}
                        </td>
                        {table.headers.map((_, ci) => (
                          <td
                            key={ci}
                            className="px-2.5 py-1.5 border-b border-[var(--glass-border)] whitespace-nowrap tabular-nums max-w-[280px] truncate"
                            title={row[ci] ?? ""}
                          >
                            {row[ci] ?? ""}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-center text-xs text-muted-foreground py-8">
                Esta sección no contiene datos.
              </p>
            )}
          </div>
        ))}

      {/* EMPTY STATE */}
      {data.metrics.length === 0 && data.tables.length === 0 && (
        <div className="rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg)] backdrop-blur-xl p-8 text-center text-sm text-muted-foreground">
          El archivo no contiene datos legibles.
        </div>
      )}
    </div>
  );
}

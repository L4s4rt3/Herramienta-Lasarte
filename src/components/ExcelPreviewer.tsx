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
    <div className="w-full max-h-[60vh] overflow-y-auto scrollbar-midas pr-1 -mr-1 space-y-5">
      {/* HEADER */}
      <div className="border-b border-[var(--glass-border)] pb-4">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md font-bold text-[10px] uppercase tracking-wider bg-orange-500/10 text-orange-600 border border-orange-500/20">
            <FileSpreadsheet className="h-3 w-3" />
            XLSX
          </span>
          <h1 className="text-lg font-bold text-foreground tracking-tight truncate">
            {data.filename}
          </h1>
        </div>
        {(data.title || data.subtitle) && (
          <p className="text-sm text-muted-foreground mt-1">
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

      {/* GRID DE MÉTRICAS (glassmorphism) */}
      {data.metrics.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {data.metrics.map((metric, i) => (
            <div
              key={i}
              className="relative overflow-hidden rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg)] backdrop-blur-xl shadow-[var(--glass-shadow)] hover:bg-[var(--glass-bg-strong)] transition-colors p-5"
            >
              <div className="absolute top-0 left-0 w-1 h-full bg-gradient-to-b from-orange-500 to-orange-600" />
              {metric.category && (
                <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                  {metric.category}
                </p>
              )}
              <h3 className="text-sm font-medium text-foreground/80 mt-1">
                {metric.label}
              </h3>
              <p className="text-3xl font-bold text-foreground mt-2 tracking-tight tabular-nums">
                {metric.value}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* TABLAS (glassmorphism simple, como antes) */}
      {data.tables.length > 0 &&
        data.tables.map((table, i) => (
          <div key={i}>
            {/* Etiqueta de sección (no rompe el glassmorphism del contenedor) */}
            {(table.section || table.description) && (
              <div className="flex items-center justify-between gap-3 mb-2 px-1">
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

            {/* Contenedor glassmorphism simple: borde + scroll interno */}
            <div className="rounded-xl border border-[var(--glass-border)] overflow-hidden">
              {table.headers.length > 0 && table.rows.length > 0 ? (
                <div className="overflow-auto max-h-[40vh] scrollbar-midas">
                  <table className="w-full text-xs border-collapse">
                    <thead className="sticky top-0 z-10">
                      <tr className="bg-[var(--glass-bg-strong)]">
                        <th className="sticky left-0 z-20 px-3 py-2 text-left font-semibold border-b border-r border-[var(--glass-border)] text-muted-foreground bg-[var(--glass-bg-strong)] w-10">
                          #
                        </th>
                        {table.headers.map((h, ci) => (
                          <th
                            key={ci}
                            className="px-3 py-2 text-left font-semibold border-b border-[var(--glass-border)] whitespace-nowrap text-foreground/80"
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
                          className={ri % 2 === 0 ? "" : "bg-[var(--glass-bg)]"}
                        >
                          <td className="sticky left-0 z-[5] px-3 py-1.5 border-b border-r border-[var(--glass-border)] text-muted-foreground/50 font-mono text-[10px] bg-inherit">
                            {ri + 1}
                          </td>
                          {table.headers.map((_, ci) => (
                            <td
                              key={ci}
                              className="px-3 py-1.5 border-b border-[var(--glass-border)] whitespace-nowrap tabular-nums"
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
          </div>
        ))}

      {/* EMPTY STATE */}
      {data.metrics.length === 0 && data.tables.length === 0 && (
        <div className="rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg)] p-8 text-center text-sm text-muted-foreground backdrop-blur-xl">
          El archivo no contiene datos legibles.
        </div>
      )}
    </div>
  );
}

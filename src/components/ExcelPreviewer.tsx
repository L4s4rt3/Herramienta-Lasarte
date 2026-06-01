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
    // max-h-[60vh] + overflow-y-auto = scroll fiable (mismo enfoque que antes)
    <div className="w-full max-h-[60vh] overflow-y-auto scrollbar-midas pr-1 -mr-1">
      {/* HEADER */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center border-b border-[var(--glass-border)] pb-5 mb-6 gap-4">
        <div className="min-w-0">
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
      </div>

      {/* GRID DE MÉTRICAS (glass) */}
      {data.metrics.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
          {data.metrics.map((metric, i) => (
            <div
              key={i}
              className="glass glass-hover relative overflow-hidden p-5"
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

      {/* TABLA (glass) */}
      {data.tables.length > 0 &&
        data.tables.map((table, i) => (
          <div key={i} className="glass overflow-hidden mb-4">
            <div className="px-5 py-4 border-b border-[var(--glass-border)] flex justify-between items-center gap-3 bg-[var(--glass-bg-strong)]">
              <div className="min-w-0">
                <h2 className="text-sm font-bold text-foreground uppercase tracking-wider truncate">
                  {table.section}
                </h2>
                {table.description && (
                  <p className="text-xs text-muted-foreground mt-0.5 truncate">
                    {table.description}
                  </p>
                )}
              </div>
              {table.rows.length > 0 && (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold shrink-0 bg-emerald-500/10 text-emerald-600 border border-emerald-500/20">
                  <CheckCircle2 className="h-3 w-3" />
                  Datos Validados
                </span>
              )}
            </div>

            {table.headers.length > 0 && table.rows.length > 0 ? (
              <div className="overflow-x-auto scrollbar-midas">
                <table className="w-full min-w-full divide-y divide-[var(--glass-border)] text-left border-collapse">
                  <thead className="bg-[var(--glass-bg)]">
                    <tr>
                      {table.headers.map((header, hIdx) => (
                        <th
                          key={hIdx}
                          className="px-6 py-3.5 text-[11px] font-bold text-muted-foreground uppercase tracking-wider border-b border-[var(--glass-border)]"
                        >
                          {header}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--glass-border)]">
                    {table.rows.map((row, rIdx) => (
                      <tr key={rIdx} className="hover:bg-[var(--glass-bg)] transition-colors">
                        {table.headers.map((_, cIdx) => (
                          <td
                            key={cIdx}
                            className="px-6 py-3.5 text-sm text-foreground/80 font-medium border-b border-[var(--glass-border)] tabular-nums"
                          >
                            {row[cIdx] ?? ""}
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
        <div className="glass p-8 text-center text-sm text-muted-foreground">
          El archivo no contiene datos legibles.
        </div>
      )}
    </div>
  );
}

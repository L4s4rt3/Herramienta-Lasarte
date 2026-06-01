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

function isNumericCell(value: string): boolean {
  if (!value) return false;
  return /^-?\d{1,3}([.,]\d{3})*([.,]\d+)?%?$|^-?\d+([.,]\d+)?%?$/.test(value.trim());
}

function isNumericColumn(rows: string[][], colIdx: number): boolean {
  let numeric = 0;
  let total = 0;
  for (const row of rows) {
    const cell = row[colIdx];
    if (!cell || !cell.trim()) continue;
    total++;
    if (isNumericCell(cell)) numeric++;
  }
  return total > 0 && numeric / total > 0.5;
}

export default function ExcelPreviewer({ data }: ExcelPreviewerProps) {
  return (
    // Layout flex vertical: header y resumen compactos arriba, tabla ocupa
    // el resto con scroll X+Y interno (único scroll del preview).
    <div className="h-full flex flex-col gap-3 min-h-0">
      {/* 1. CABECERA DEL ARCHIVO (glass) */}
      <div className="shrink-0 rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg)] backdrop-blur-xl shadow-[var(--glass-shadow)] p-4">
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

      {/* 2. RESUMEN (lista glass: cada métrica en su fila) */}
      {data.metrics.length > 0 && (
        <div className="shrink-0 rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg)] backdrop-blur-xl shadow-[var(--glass-shadow)] overflow-hidden">
          <div className="px-4 py-2 border-b border-[var(--glass-border)] bg-[var(--glass-bg-strong)]">
            <h2 className="text-[10px] font-bold text-foreground uppercase tracking-widest">
              Resumen
            </h2>
          </div>
          <ul className="divide-y divide-[var(--glass-border)]">
            {data.metrics.map((m, i) => (
              <li
                key={i}
                className="flex items-center justify-between gap-4 px-4 py-1.5 hover:bg-[var(--glass-bg-strong)] transition-colors"
              >
                <span className="text-xs text-foreground/80 font-medium flex items-center gap-2 min-w-0">
                  {m.category && (
                    <span className="text-[9px] font-bold text-orange-600 uppercase tracking-widest shrink-0">
                      {m.category}
                    </span>
                  )}
                  <span className="truncate">{m.label}</span>
                </span>
                <span className="text-sm font-bold text-foreground tabular-nums shrink-0">
                  {m.value}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 3. TABLAS (glass) — flex-1 para crecer y overflow-auto (X+Y) en la tabla */}
      {data.tables.length > 0 ? (
        <div className="flex-1 min-h-0 flex flex-col gap-3">
          {data.tables.map((table, i) => {
            const numericCols = table.headers.map((_, ci) =>
              isNumericCell(table.headers[ci]) || isNumericColumn(table.rows, ci)
            );

            return (
              <div
                key={i}
                className="flex-1 min-h-0 flex flex-col rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg)] backdrop-blur-xl shadow-[var(--glass-shadow)] overflow-hidden"
              >
                {/* Encabezado de la sección (sticky arriba) */}
                {(table.section || table.description) && (
                  <div className="shrink-0 flex items-center justify-between gap-3 px-4 py-2 border-b border-[var(--glass-border)] bg-[var(--glass-bg-strong)]">
                    <div className="min-w-0">
                      {table.section && (
                        <h2 className="text-[10px] font-bold text-foreground uppercase tracking-widest truncate">
                          {table.section}
                        </h2>
                      )}
                      {table.description && (
                        <p className="text-[10px] text-muted-foreground mt-0.5 truncate">
                          {table.description}
                        </p>
                      )}
                    </div>
                    {table.rows.length > 0 && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-semibold shrink-0 bg-emerald-500/10 text-emerald-600 border border-emerald-500/20">
                        <CheckCircle2 className="h-2.5 w-2.5" />
                        Validado
                      </span>
                    )}
                  </div>
                )}

                {table.headers.length > 0 && table.rows.length > 0 ? (
                  // ÚNICO SCROLL: overflow-auto = X+Y dentro de la tabla.
                  // El thead y la columna # son sticky.
                  <div className="flex-1 min-h-0 overflow-auto scrollbar-midas">
                    <table className="w-full text-xs border-collapse">
                      <thead className="sticky top-0 z-20">
                        <tr className="bg-[var(--glass-bg-strong)]/95 backdrop-blur-xl backdrop-saturate-150 shadow-[0_2px_8px_rgba(0,0,0,0.08)]">
                          <th className="sticky left-0 z-30 px-2.5 py-2 text-left font-semibold border-b border-r border-[var(--glass-border)] text-muted-foreground bg-[var(--glass-bg-strong)]/95 backdrop-blur-xl w-10 min-w-[2.5rem]">
                            #
                          </th>
                          {table.headers.map((h, ci) => (
                            <th
                              key={ci}
                              className={`px-3 py-2 font-semibold border-b border-[var(--glass-border)] whitespace-nowrap text-foreground/90 ${
                                numericCols[ci] ? "text-right" : "text-left"
                              }`}
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
                            className={ri % 2 === 0 ? "" : "bg-[var(--glass-bg)]/40"}
                          >
                            <td className="sticky left-0 z-[5] px-2.5 py-1.5 border-b border-r border-[var(--glass-border)] text-muted-foreground/60 font-mono text-[10px] bg-[var(--glass-bg-strong)]/85 backdrop-blur-sm">
                              {ri + 1}
                            </td>
                            {table.headers.map((_, ci) => {
                              const value = row[ci] ?? "";
                              // Celdas vacías: visualmente vacías (sin "—"),
                              // el row sigue presente para mantener la estructura.
                              return (
                                <td
                                  key={ci}
                                  className={`px-3 py-1.5 border-b border-[var(--glass-border)] whitespace-nowrap ${
                                    numericCols[ci]
                                      ? "text-right tabular-nums"
                                      : "text-left"
                                  }`}
                                  title={value}
                                >
                                  {value}
                                </td>
                              );
                            })}
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
            );
          })}
        </div>
      ) : (
        data.metrics.length === 0 && (
          <div className="flex-1 min-h-0 rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg)] backdrop-blur-xl p-8 text-center text-sm text-muted-foreground flex items-center justify-center">
            El archivo no contiene datos legibles.
          </div>
        )
      )}
    </div>
  );
}

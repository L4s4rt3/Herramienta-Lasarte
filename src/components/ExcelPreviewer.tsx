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

export default function ExcelPreviewer({ data }: ExcelPreviewerProps) {
  return (
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

      {/* TABLAS (glass, scroll lateral si hace falta) */}
      {data.tables.length > 0 &&
        data.tables.map((table, i) => {
          // Detectar columnas numéricas para alinearlas a la derecha
          const numericCols = table.headers.map((_, ci) =>
            isNumericCell(table.headers[ci])
              ? true
              : isNumericColumn(table.rows, ci)
          );

          return (
            <div
              key={i}
              className="rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg)] backdrop-blur-xl shadow-[var(--glass-shadow)] overflow-hidden"
            >
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
                // Scroll lateral habilitado: el contenedor permite overflow-x
                // cuando hay muchas columnas, y overflow-y para scroll vertical
                // dentro de la tabla.
                <div className="overflow-auto max-h-[40vh] scrollbar-midas">
                  <table className="w-full min-w-full text-xs border-collapse">
                    <thead className="sticky top-0 z-20">
                      <tr className="bg-[var(--glass-bg-strong)]/90 backdrop-blur-xl backdrop-saturate-150 shadow-[0_2px_8px_rgba(0,0,0,0.08)]">
                        <th className="sticky left-0 z-30 px-2.5 py-2 text-left font-semibold border-b border-r border-[var(--glass-border)] text-muted-foreground bg-[var(--glass-bg-strong)]/90 backdrop-blur-xl w-10 min-w-[2.5rem]">
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
                          <td className="sticky left-0 z-[5] px-2.5 py-1.5 border-b border-r border-[var(--glass-border)] text-muted-foreground/60 font-mono text-[10px] bg-[var(--glass-bg-strong)]/80 backdrop-blur-sm">
                            {ri + 1}
                          </td>
                          {table.headers.map((_, ci) => {
                            const value = row[ci] ?? "";
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
                                {value || (
                                  <span className="text-muted-foreground/30">—</span>
                                )}
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

      {/* EMPTY STATE */}
      {data.metrics.length === 0 && data.tables.length === 0 && (
        <div className="rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg)] backdrop-blur-xl p-8 text-center text-sm text-muted-foreground">
          El archivo no contiene datos legibles.
        </div>
      )}
    </div>
  );
}

// Detección de columna numérica para alineación a la derecha.
// (Definida fuera del componente para que sea reutilizable y no se
// re-evalúe en cada render.)
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

import React from "react";
import { Download, FileSpreadsheet, CheckCircle2 } from "lucide-react";

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
  onDownload?: () => void;
}

export default function ExcelPreviewer({ data, onDownload }: ExcelPreviewerProps) {
  return (
    <div className="w-full bg-[#f8fafc] text-[#1e293b] antialiased rounded-xl overflow-hidden">
      {/* HEADER DE ACCIÓN */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center border-b border-slate-200 pb-5 mb-6 gap-4 px-1">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1 px-2 py-1 bg-orange-50 text-orange-600 rounded-md font-bold text-[10px] uppercase tracking-wider">
              <FileSpreadsheet className="h-3 w-3" />
              XLSX
            </span>
            <h1 className="text-lg font-bold text-slate-900 tracking-tight truncate">
              {data.filename}
            </h1>
          </div>
          {(data.title || data.subtitle) && (
            <p className="text-sm text-slate-500 mt-1">
              {data.title && <span>{data.title}</span>}
              {data.title && data.subtitle && <span className="mx-1.5 text-slate-300">•</span>}
              {data.subtitle && <span className="font-semibold text-slate-700">{data.subtitle}</span>}
            </p>
          )}
        </div>
        {onDownload && (
          <button
            onClick={onDownload}
            className="inline-flex items-center gap-2 bg-slate-900 hover:bg-slate-800 text-white text-sm font-medium px-4 py-2 rounded-lg shadow-sm transition-colors shrink-0"
          >
            <Download className="h-4 w-4" />
            Descargar Archivo
          </button>
        )}
      </div>

      {/* DATOS AGREGADOS: GRID DE TARJETAS MODULARES */}
      {data.metrics.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-6 px-1">
          {data.metrics.map((metric, i) => (
            <div
              key={i}
              className="bg-white border border-slate-200/80 rounded-xl p-5 shadow-sm hover:border-slate-300 transition-all relative overflow-hidden"
            >
              <div className="absolute top-0 left-0 w-1 h-full bg-orange-500" />
              {metric.category && (
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                  {metric.category}
                </p>
              )}
              <h3 className="text-sm font-medium text-slate-600 mt-1">{metric.label}</h3>
              <p className="text-3xl font-bold text-slate-900 mt-2 tracking-tight tabular-nums">
                {metric.value}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* CONTENEDOR DE TABLA LIMPIA */}
      {data.tables.length > 0 &&
        data.tables.map((table, i) => (
          <div
            key={i}
            className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden mb-4"
          >
            <div className="bg-slate-50 px-5 py-4 border-b border-slate-200 flex justify-between items-center gap-3">
              <div className="min-w-0">
                <h2 className="text-sm font-bold text-slate-800 uppercase tracking-wider truncate">
                  {table.section}
                </h2>
                {table.description && (
                  <p className="text-xs text-slate-500 mt-0.5 truncate">{table.description}</p>
                )}
              </div>
              {table.rows.length > 0 && (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-emerald-50 text-emerald-700 rounded-full text-[11px] font-semibold shrink-0">
                  <CheckCircle2 className="h-3 w-3" />
                  Datos Validados
                </span>
              )}
            </div>

            {table.headers.length > 0 && table.rows.length > 0 ? (
              <div className="overflow-x-auto scrollbar-midas">
                <table className="w-full min-w-full divide-y divide-slate-200 text-left border-collapse">
                  <thead className="bg-slate-50/50">
                    <tr>
                      {table.headers.map((header, hIdx) => (
                        <th
                          key={hIdx}
                          className="px-6 py-3.5 text-[11px] font-bold text-slate-500 uppercase tracking-wider border-b border-slate-200"
                        >
                          {header}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 bg-white">
                    {table.rows.map((row, rIdx) => (
                      <tr key={rIdx} className="hover:bg-slate-50/80 transition-colors">
                        {table.headers.map((_, cIdx) => (
                          <td
                            key={cIdx}
                            className="px-6 py-3.5 text-sm text-slate-600 font-medium border-b border-slate-200 tabular-nums"
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
              <p className="text-center text-xs text-slate-400 py-8">
                Esta sección no contiene datos.
              </p>
            )}
          </div>
        ))}

      {/* EMPTY STATE: solo métricas o solo título sin nada */}
      {data.metrics.length === 0 && data.tables.length === 0 && (
        <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-sm text-slate-400">
          El archivo no contiene datos legibles.
        </div>
      )}
    </div>
  );
}

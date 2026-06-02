import { FileSpreadsheet, FileText } from "lucide-react";
import { cn } from "@/lib/utils";

interface PreviewHeaderProps {
  filename: string;
  mimeType?: string | null;
  title?: string;
  subtitle?: string;
  sheets?: Array<{ name: string; index: number }>;
  activeSheetIndex?: number;
  onSheetChange?: (index: number) => void;
}

function detectFileIcon(filename: string, mimeType?: string | null) {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  if (mimeType?.includes("spreadsheet") || ext === "xlsx" || ext === "xls" || ext === "csv") {
    return FileSpreadsheet;
  }
  return FileText;
}

export function PreviewHeader({
  filename,
  mimeType,
  title,
  subtitle,
  sheets = [],
  activeSheetIndex = 0,
  onSheetChange,
}: PreviewHeaderProps) {
  const Icon = detectFileIcon(filename, mimeType);
  const ext = filename.split(".").pop()?.toUpperCase() ?? "FILE";

  return (
    <header
      className={cn(
        "shrink-0 rounded-xl border border-slate-200/60",
        "bg-white/70 backdrop-blur-sm shadow-[0_4px_16px_rgba(15,23,42,0.06)]",
        "p-4 space-y-3"
      )}
    >
      <div className="flex items-center gap-3 min-w-0">
        <span
          className={cn(
            "inline-flex items-center gap-1.5 px-2 py-1 rounded-md shrink-0",
            "font-bold text-[10px] uppercase tracking-wider",
            "bg-orange-500/10 text-orange-700 border border-orange-500/25"
          )}
        >
          <Icon className="h-3 w-3" />
          {ext}
        </span>
        <h1 className="text-base font-bold text-slate-900 tracking-tight truncate min-w-0">
          {filename}
        </h1>
      </div>

      {(title || subtitle) && (
        <div className="flex items-baseline gap-2 flex-wrap text-sm">
          {title && (
            <span className="font-semibold text-slate-900">{title}</span>
          )}
          {title && subtitle && (
            <span className="text-slate-300">·</span>
          )}
          {subtitle && (
            <span className="text-slate-600 font-medium">{subtitle}</span>
          )}
        </div>
      )}

      {sheets.length > 1 && (
        <div className="flex items-center gap-1 overflow-x-auto -mx-1 px-1 pb-1 scrollbar-midas">
          {sheets.map((sheet) => {
            const active = sheet.index === activeSheetIndex;
            return (
              <button
                key={sheet.index}
                onClick={() => onSheetChange?.(sheet.index)}
                className={cn(
                  "shrink-0 px-3 py-1 rounded-md text-xs font-medium transition-colors",
                  "border",
                  active
                    ? "bg-orange-500/10 text-orange-700 border-orange-500/30"
                    : "bg-white/40 text-slate-600 border-slate-200/60 hover:bg-slate-50"
                )}
              >
                {sheet.name}
              </button>
            );
          })}
        </div>
      )}
    </header>
  );
}

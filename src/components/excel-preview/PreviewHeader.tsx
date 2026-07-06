import { Download, FileSpreadsheet, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface PreviewHeaderProps {
  filename: string;
  mimeType?: string | null;
  title?: string;
  subtitle?: string;
  sheets?: Array<{ name: string; index: number }>;
  activeSheetIndex?: number;
  onSheetChange?: (index: number) => void;
  rowCount?: number;
  colCount?: number;
  onDownload?: () => void;
  downloadDisabled?: boolean;
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
  rowCount,
  colCount,
  onDownload,
  downloadDisabled,
}: PreviewHeaderProps) {
  const Icon = detectFileIcon(filename, mimeType);
  const ext = filename.split(".").pop()?.toUpperCase() ?? "FILE";
  const hasDims = typeof rowCount === "number" && typeof colCount === "number";

  return (
    <header className={cn("shrink-0 glass rounded-xl p-4 space-y-3")}>
      <div className="flex items-center gap-3 min-w-0 flex-wrap">
        <span
          className={cn(
            "inline-flex h-8 items-center gap-1.5 px-2.5 rounded-lg shrink-0",
            "font-bold text-[10px] uppercase tracking-wider",
            "bg-primary/10 text-primary border border-primary/30 shadow-sm"
          )}
        >
          <Icon className="h-3 w-3" />
          {ext}
        </span>
        <h1 className="text-lg font-bold text-foreground tracking-tight truncate min-w-0 flex-1">
          {filename}
        </h1>
        {hasDims && (
          <span className="shrink-0 rounded-full border border-[var(--glass-border)] bg-[var(--glass-bg)] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground tabular-nums">
            {rowCount}×{colCount}
          </span>
        )}
        {onDownload && (
          <Button
            variant="outline"
            size="sm"
            onClick={onDownload}
            disabled={downloadDisabled}
            className="shrink-0 glass glass-hover"
          >
            <Download className="h-3.5 w-3.5 mr-1.5" />
            Descargar
          </Button>
        )}
      </div>

      {(title || subtitle) && (
        <div className="flex items-baseline gap-2 flex-wrap rounded-lg border border-[var(--glass-border)] bg-[var(--glass-bg)] px-3 py-2 text-sm">
          {title && (
            <span className="font-semibold text-foreground">{title}</span>
          )}
          {title && subtitle && (
            <span className="text-muted-foreground/50">·</span>
          )}
          {subtitle && (
            <span className="text-muted-foreground font-medium">{subtitle}</span>
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
                  "shrink-0 h-8 px-3 rounded-lg text-xs font-semibold transition-colors",
                  "border",
                  active
                    ? "bg-primary/10 text-primary border-primary/30 shadow-sm"
                    : "bg-[var(--glass-bg)] text-muted-foreground border-[var(--glass-border)] hover:bg-[var(--glass-bg-strong)]"
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

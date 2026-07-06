import { useState } from "react";
import { Copy, X, Check } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { StatusBadge } from "./StatusBadge";
import {
  isNumericCell,
  isStatusColumn,
  matchStatus,
} from "./formatters";

interface RowDetailDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rowIndex: number | null;
  headers: string[];
  row: string[];
}

function rowToTsv(headers: string[], row: string[]): string {
  return [headers.join("\t"), row.join("\t")].join("\n");
}

export function RowDetailDrawer({
  open,
  onOpenChange,
  rowIndex,
  headers,
  row,
}: RowDetailDrawerProps) {
  const [copied, setCopied] = useState(false);

  if (rowIndex === null) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="w-full sm:max-w-md" />
      </Sheet>
    );
  }

  const statusColumnIdx = headers.findIndex(isStatusColumn);
  const statusValue =
    statusColumnIdx >= 0 ? row[statusColumnIdx] ?? "" : "";
  const statusKey = statusValue ? matchStatus(statusValue) : null;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(rowToTsv(headers, row));
      setCopied(true);
      toast.success("Fila copiada al portapapeles");
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("No se pudo copiar la fila");
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-md flex flex-col p-0"
      >
        <SheetHeader className="px-6 py-4 border-b border-[var(--glass-border)] shrink-0">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <SheetTitle className="text-base font-semibold text-foreground">
                Fila {rowIndex + 1}
              </SheetTitle>
              <SheetDescription className="text-xs text-muted-foreground">
                {headers.length} campos · click fuera para cerrar
              </SheetDescription>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onOpenChange(false)}
              className="h-7 w-7 shrink-0"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
          {statusKey && statusKey !== "muted" && (
            <div className="pt-1">
              <StatusBadge value={statusValue} status={statusKey} />
            </div>
          )}
        </SheetHeader>

        <div className="flex-1 overflow-auto px-6 py-4 scrollbar-midas">
          <dl className="space-y-3">
            {headers.map((h, i) => {
              const value = row[i] ?? "";
              const numeric = isNumericCell(value);
              return (
                <div
                  key={i}
                  className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-3 items-baseline border-b border-[var(--glass-border)] pb-3 last:border-0"
                >
                  <dt className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider truncate">
                    {h}
                  </dt>
                  <dd
                    className={cnNumbered(
                      numeric,
                      "text-sm text-foreground break-words"
                    )}
                    title={value}
                  >
                    {value || (
                      <span className="text-muted-foreground/50 italic">vacío</span>
                    )}
                  </dd>
                </div>
              );
            })}
          </dl>
        </div>

        <SheetFooter className="px-6 py-3 border-t border-[var(--glass-border)] shrink-0 flex-row gap-2">
          <Button
            onClick={handleCopy}
            className="flex-1"
            size="sm"
          >
            {copied ? (
              <>
                <Check className="h-3.5 w-3.5 mr-1.5" />
                Copiado
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5 mr-1.5" />
                Copiar fila
              </>
            )}
          </Button>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            size="sm"
          >
            Cerrar
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function cnNumbered(numeric: boolean, base: string): string {
  return numeric ? `${base} tabular-nums text-right font-medium` : base;
}

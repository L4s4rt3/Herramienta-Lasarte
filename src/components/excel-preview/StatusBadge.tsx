import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { StatusKey } from "./types";

interface StatusBadgeProps {
  value: string;
  status: StatusKey;
  className?: string;
}

const STATUS_STYLES: Record<StatusKey, string> = {
  success:
    "bg-emerald-500/10 text-emerald-700 border-emerald-500/25 dark:text-emerald-300",
  info: "bg-sky-500/10 text-sky-700 border-sky-500/25 dark:text-sky-300",
  warning:
    "bg-amber-500/10 text-amber-700 border-amber-500/25 dark:text-amber-300",
  destructive:
    "bg-red-500/10 text-red-700 border-red-500/25 dark:text-red-300",
  muted: "bg-slate-500/10 text-slate-700 border-slate-500/25 dark:text-slate-300",
};

export function StatusBadge({ value, status, className }: StatusBadgeProps) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide border rounded-full whitespace-nowrap",
        STATUS_STYLES[status],
        className
      )}
    >
      {value || "—"}
    </Badge>
  );
}

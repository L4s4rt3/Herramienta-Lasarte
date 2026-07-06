import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { StatusKey } from "./types";

interface StatusBadgeProps {
  value: string;
  status: StatusKey;
  className?: string;
}

const STATUS_STYLES: Record<StatusKey, string> = {
  success: "bg-success/10 text-success border-success/40",
  info: "bg-info/10 text-info border-info/40",
  warning: "bg-warning/10 text-warning border-warning/40",
  destructive: "bg-destructive/10 text-destructive border-destructive/40",
  muted: "bg-[var(--glass-bg)] text-muted-foreground border-[var(--glass-border)]",
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

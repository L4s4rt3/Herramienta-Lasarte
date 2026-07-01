import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

function SemaforoCard({
  icon: Icon,
  label,
  count,
  total,
  color,
  description,
}: {
  icon: LucideIcon;
  label: string;
  count: number;
  total: number;
  color: "emerald" | "amber" | "red";
  description: string;
}) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;

  const colorClasses = {
    emerald: {
      bg: "bg-success/10",
      border: "border-success/30",
      icon: "text-success",
      count: "text-success",
      bar: "bg-success",
    },
    amber: {
      bg: "bg-warning/10",
      border: "border-warning/30",
      icon: "text-warning",
      count: "text-warning",
      bar: "bg-warning",
    },
    red: {
      bg: "bg-destructive/10",
      border: "border-destructive/30",
      icon: "text-destructive",
      count: "text-destructive",
      bar: "bg-destructive",
    },
  }[color];

  return (
    <div className={cn("rounded-xl border p-4 space-y-3 shadow-[var(--glass-shadow)] backdrop-blur-xl", colorClasses.bg, colorClasses.border)}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon className={cn("h-4 w-4", colorClasses.icon)} />
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>
        </div>
        <span className="text-xs text-muted-foreground">{pct}%</span>
      </div>
      <p className={cn("text-4xl font-semibold tabular-nums", colorClasses.count)}>{count}</p>
      <div className="space-y-1">
        <div className="h-1.5 w-full rounded-full bg-[var(--glass-bg-strong)] overflow-hidden">
          <div className={cn("h-full rounded-full transition-all", colorClasses.bar)} style={{ width: `${Math.min(pct, 100)}%` }} />
        </div>
        <p className="text-[10px] text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

export { SemaforoCard };

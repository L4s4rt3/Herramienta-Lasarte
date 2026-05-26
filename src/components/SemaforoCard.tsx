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
      bg: "bg-emerald-50/80 dark:bg-emerald-950/25",
      border: "border-emerald-200/80 dark:border-emerald-800/60",
      icon: "text-emerald-600 dark:text-emerald-400",
      count: "text-emerald-700 dark:text-emerald-300",
      bar: "bg-emerald-500",
    },
    amber: {
      bg: "bg-amber-50/80 dark:bg-amber-950/25",
      border: "border-amber-200/80 dark:border-amber-800/60",
      icon: "text-amber-600 dark:text-amber-400",
      count: "text-amber-700 dark:text-amber-300",
      bar: "bg-amber-500",
    },
    red: {
      bg: "bg-red-50/80 dark:bg-red-950/25",
      border: "border-red-200/80 dark:border-red-800/60",
      icon: "text-red-600 dark:text-red-400",
      count: "text-red-700 dark:text-red-300",
      bar: "bg-red-500",
    },
  }[color];

  return (
    <div className={cn("rounded-lg border p-4 space-y-3 shadow-[var(--shadow-card)]", colorClasses.bg, colorClasses.border)}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon className={cn("h-4 w-4", colorClasses.icon)} />
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>
        </div>
        <span className="text-xs text-muted-foreground">{pct}%</span>
      </div>
      <p className={cn("text-4xl font-semibold tabular-nums", colorClasses.count)}>{count}</p>
      <div className="space-y-1">
        <div className="h-1.5 w-full rounded-full bg-black/5 dark:bg-white/5 overflow-hidden">
          <div className={cn("h-full rounded-full transition-all", colorClasses.bar)} style={{ width: `${pct}%` }} />
        </div>
        <p className="text-[10px] text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

export { SemaforoCard };

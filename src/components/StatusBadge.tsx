import { cn } from "@/lib/utils";
import { CheckCircle2, Clock, AlertCircle, AlertTriangle } from "lucide-react";

type Estado =
  | "Borrador"
  | "Analizado"
  | "Con descuadre"
  | "Validado"
  | "Pendiente"
  | "Completado"
  | "Error"
  | string;

const statusConfig: Record<string, { bg: string; text: string; icon?: React.ComponentType<{ className?: string }> }> = {
  Borrador: {
    bg: "border border-border/70 bg-muted/80",
    text: "text-muted-foreground",
    icon: Clock,
  },
  Analizado: {
    bg: "border border-blue-200/70 bg-blue-50 dark:border-blue-900/60 dark:bg-blue-950/50",
    text: "text-blue-700 dark:text-blue-300",
  },
  "Con descuadre": {
    bg: "border border-amber-200/70 bg-amber-50 dark:border-amber-900/60 dark:bg-amber-950/50",
    text: "text-amber-700 dark:text-amber-300",
    icon: AlertTriangle,
  },
  Validado: {
    bg: "border border-emerald-200/70 bg-emerald-50 dark:border-emerald-900/60 dark:bg-emerald-950/50",
    text: "text-emerald-700 dark:text-emerald-300",
    icon: CheckCircle2,
  },
  Pendiente: {
    bg: "border border-slate-200/70 bg-slate-50 dark:border-slate-800/70 dark:bg-slate-900/60",
    text: "text-slate-700 dark:text-slate-300",
    icon: Clock,
  },
  Completado: {
    bg: "border border-emerald-200/70 bg-emerald-50 dark:border-emerald-900/60 dark:bg-emerald-950/50",
    text: "text-emerald-700 dark:text-emerald-300",
    icon: CheckCircle2,
  },
  Error: {
    bg: "border border-red-200/70 bg-red-50 dark:border-red-900/60 dark:bg-red-950/50",
    text: "text-red-700 dark:text-red-300",
    icon: AlertCircle,
  },
};

export function StatusBadge({ estado }: { estado: Estado }) {
  const config = statusConfig[estado] ?? statusConfig["Borrador"];
  const Icon = config.icon;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold shadow-sm",
        config.bg,
        config.text,
      )}
    >
      {Icon && <Icon className="h-3.5 w-3.5" />}
      {estado}
    </span>
  );
}

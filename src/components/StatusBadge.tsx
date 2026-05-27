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
    bg: "border border-[var(--glass-border)] bg-[var(--glass-bg)]",
    text: "text-muted-foreground",
    icon: Clock,
  },
  Analizado: {
    bg: "border border-info/40 bg-info/10",
    text: "text-info",
  },
  "Con descuadre": {
    bg: "border border-warning/40 bg-warning/10",
    text: "text-warning",
    icon: AlertTriangle,
  },
  Validado: {
    bg: "border border-success/40 bg-success/10",
    text: "text-success",
    icon: CheckCircle2,
  },
  Pendiente: {
    bg: "border border-[var(--glass-border)] bg-[var(--glass-bg)]",
    text: "text-muted-foreground",
    icon: Clock,
  },
  Completado: {
    bg: "border border-success/40 bg-success/10",
    text: "text-success",
    icon: CheckCircle2,
  },
  Error: {
    bg: "border border-destructive/40 bg-destructive/10",
    text: "text-destructive",
    icon: AlertCircle,
  },
};

export function StatusBadge({ estado }: { estado: Estado }) {
  const config = statusConfig[estado] ?? statusConfig["Borrador"];
  const Icon = config.icon;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-xl px-2.5 py-1 text-xs font-semibold shadow-[var(--glass-shadow)]",
        config.bg,
        config.text,
      )}
    >
      {Icon && <Icon className="h-3.5 w-3.5" />}
      {estado}
    </span>
  );
}

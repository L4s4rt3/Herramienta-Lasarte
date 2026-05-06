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
    bg: "bg-muted", 
    text: "text-muted-foreground",
    icon: Clock,
  },
  Analizado: { 
    bg: "bg-blue-50 dark:bg-blue-950", 
    text: "text-blue-700 dark:text-blue-300",
  },
  "Con descuadre": { 
    bg: "bg-amber-50 dark:bg-amber-950", 
    text: "text-amber-700 dark:text-amber-300",
    icon: AlertTriangle,
  },
  Validado: { 
    bg: "bg-emerald-50 dark:bg-emerald-950", 
    text: "text-emerald-700 dark:text-emerald-300",
    icon: CheckCircle2,
  },
  Pendiente: { 
    bg: "bg-slate-50 dark:bg-slate-900", 
    text: "text-slate-700 dark:text-slate-300",
    icon: Clock,
  },
  Completado: { 
    bg: "bg-emerald-50 dark:bg-emerald-950", 
    text: "text-emerald-700 dark:text-emerald-300",
    icon: CheckCircle2,
  },
  Error: { 
    bg: "bg-red-50 dark:bg-red-950", 
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
        "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium",
        config.bg,
        config.text,
      )}
    >
      {Icon && <Icon className="h-3.5 w-3.5" />}
      {estado}
    </span>
  );
}

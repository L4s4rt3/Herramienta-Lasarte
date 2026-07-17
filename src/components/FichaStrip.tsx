// src/components/FichaStrip.tsx
//
// Tira de ficha compacta (patrón Aerobotics: entidad + datos clave en una sola
// línea antes del contenido), estandarizada para no repetir el mismo glass +
// badges + fila de mini-KPIs en cada dossier/ficha de la app. Compone Badge +
// MiniKpi (variant="row"), ya compartidos por el resto del sistema.
//
// No sustituye tiras más especializadas ya existentes (p.ej. la tira de flujo
// de Trazabilidad, que tiene su propio recorrido paso a paso).
import type { LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { MiniKpi } from "@/components/MiniKpi";
import { cn } from "@/lib/utils";

export type FichaStripTone = "success" | "warning" | "destructive" | "neutral" | "primary";

export interface FichaStripBadge {
  label: string;
  tone?: FichaStripTone;
}

export interface FichaStripItem {
  label: string;
  value: string;
  /** Tono del valor (reutiliza los tonos de MiniKpi: success/warning/destructive/neutral). */
  tone?: "success" | "warning" | "destructive" | "neutral";
  sub?: string;
}

const BADGE_TONE_CLASS: Record<FichaStripTone, string> = {
  success: "border-success/40 bg-success/10 text-success",
  warning: "border-warning/40 bg-warning/10 text-warning",
  destructive: "border-destructive/40 bg-destructive/10 text-destructive",
  neutral: "border-[var(--glass-border)] bg-[var(--glass-bg)] text-muted-foreground",
  primary: "border-primary/40 bg-primary/10 text-primary",
};

export function FichaStrip({
  icon: Icon,
  title,
  subtitle,
  badges,
  items,
  actions,
  className,
}: {
  /** Icono de la entidad (opcional): productor, persona, lote... */
  icon?: LucideIcon;
  /** Nombre/identificador de la entidad. Si se omite (p.ej. ya hay un título justo encima), solo se renderiza la fila de datos clave. */
  title?: string;
  subtitle?: string;
  badges?: FichaStripBadge[];
  /** Pares label→valor compactos, en fila (MiniKpi variant="row"). */
  items?: FichaStripItem[];
  /** Acciones a la derecha de la línea de entidad (botones, enlaces). */
  actions?: React.ReactNode;
  className?: string;
}) {
  const hayEntidad = Boolean(title || Icon || (badges && badges.length > 0) || actions);
  return (
    <div className={cn("glass-accented overflow-hidden rounded-xl", className)}>
      {hayEntidad && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2.5">
          {Icon && <Icon className="h-4 w-4 shrink-0 text-primary" />}
          {title && <h2 className="truncate text-base font-bold">{title}</h2>}
          {subtitle && <span className="whitespace-nowrap text-xs text-muted-foreground">{subtitle}</span>}
          {badges?.map((b, i) => (
            <Badge key={i} variant="outline" className={cn("px-1.5 py-0 text-[10px]", BADGE_TONE_CLASS[b.tone ?? "neutral"])}>
              {b.label}
            </Badge>
          ))}
          {actions && <div className="ml-auto flex shrink-0 items-center gap-2">{actions}</div>}
        </div>
      )}
      {items && items.length > 0 && (
        <div
          className={cn(
            "grid grid-cols-2 gap-x-2 gap-y-2 px-3 py-2 sm:flex sm:flex-nowrap sm:items-stretch sm:gap-0 sm:px-0 sm:py-0",
            hayEntidad && "border-t border-[var(--glass-border)]",
          )}
        >
          {items.map((it, i) => (
            <MiniKpi
              key={i}
              label={it.label}
              value={it.value}
              sub={it.sub}
              subBlock
              tone={it.tone ?? "neutral"}
              last={i === items.length - 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

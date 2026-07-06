import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { InfoTooltip } from "@/components/InfoTooltip";
import { DeltaChip } from "@/components/DeltaChip";
import { cn } from "@/lib/utils";
import { LucideIcon, TrendingUp, TrendingDown } from "lucide-react";

type Trend = "up" | "down" | "neutral";
type Accent = "primary" | "success" | "warning" | "destructive";

interface KPICardProps {
  label: string;
  value: string;
  hint?: string;
  icon?: LucideIcon;
  trend?: Trend;
  /** Chip de variación (p. ej. "+3,2%"). Si se pasa, se muestra como píldora coloreada. */
  delta?: string;
  deltaTrend?: Trend;
  /** Color del acento superior y del icono (por defecto primary). */
  accent?: Accent;
  className?: string;
  to?: string;
  /** Explicación mostrada en un icono "?" junto a la etiqueta. */
  labelInfo?: ReactNode;
  /** Contenido extra bajo el valor/delta (mini-escala, sparkline...). */
  children?: ReactNode;
}

const TREND_COLOR: Record<Trend, string> = {
  up: "text-success",
  down: "text-destructive",
  neutral: "text-muted-foreground",
};

const ACCENT_BAR: Record<Accent, string> = {
  primary: "bg-gradient-to-r from-primary via-primary-glow to-transparent",
  success: "bg-gradient-to-r from-success to-transparent",
  warning: "bg-gradient-to-r from-warning to-transparent",
  destructive: "bg-gradient-to-r from-destructive to-transparent",
};

const ACCENT_ICON: Record<Accent, string> = {
  primary: "text-primary",
  success: "text-success",
  warning: "text-warning",
  destructive: "text-destructive",
};

export function KPICard({ label, value, hint, icon: Icon, trend, delta, deltaTrend, accent = "primary", className, to, labelInfo, children }: KPICardProps) {
  const TrendIcon = trend === "up" ? TrendingUp : trend === "down" ? TrendingDown : null;

  const content = (
    <CardContent className="relative p-4 sm:p-5">
      <div className={cn("absolute inset-x-0 top-0 h-0.5", ACCENT_BAR[accent])} />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p className="panel-kicker">{label}</p>
            {labelInfo && <InfoTooltip>{labelInfo}</InfoTooltip>}
          </div>
          <p className="mt-2 break-words text-2xl font-semibold tabular-nums leading-tight sm:text-3xl">{value}</p>
          {delta ? (
            <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1">
              <DeltaChip value={delta} trend={deltaTrend || "neutral"} />
              {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
            </div>
          ) : hint ? (
            <div className={cn("mt-2 flex min-w-0 items-start gap-1 text-xs font-semibold", TREND_COLOR[trend || "neutral"])}>
              {TrendIcon && <TrendIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
              <span className="min-w-0 break-words leading-snug">{hint}</span>
            </div>
          ) : null}
          {children}
        </div>
        {Icon && (
          <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl glass-strong sm:h-11 sm:w-11", ACCENT_ICON[accent])}>
            <Icon className="h-[18px] w-[18px] sm:h-5 sm:w-5" />
          </div>
        )}
      </div>
    </CardContent>
  );

  const card = (
    <Card className={cn("overflow-hidden transition-all duration-200", to && "cursor-pointer hover:-translate-y-0.5", className)}>
      {content}
    </Card>
  );

  return to ? <Link to={to}>{card}</Link> : card;
}

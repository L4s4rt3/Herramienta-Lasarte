import { Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { LucideIcon, TrendingUp, TrendingDown } from "lucide-react";

interface KPICardProps {
  label: string;
  value: string;
  hint?: string;
  icon?: LucideIcon;
  trend?: "up" | "down" | "neutral";
  className?: string;
  to?: string;
}

export function KPICard({ label, value, hint, icon: Icon, trend, className, to }: KPICardProps) {
  const trendColor = {
    up: "text-success",
    down: "text-destructive",
    neutral: "text-muted-foreground",
  }[trend || "neutral"];

  const TrendIcon = trend === "up" ? TrendingUp : trend === "down" ? TrendingDown : null;

  const content = (
    <CardContent className="relative p-4 sm:p-5">
      <div className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-primary via-primary-glow to-transparent" />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">{label}</p>
          <p className="mt-2 break-words text-2xl font-semibold tabular-nums leading-tight sm:text-3xl">{value}</p>
          {hint && (
            <div className={cn("mt-2 flex min-w-0 items-start gap-1 text-xs font-semibold", trendColor)}>
              {TrendIcon && <TrendIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
              <span className="min-w-0 break-words leading-snug">{hint}</span>
            </div>
          )}
        </div>
        {Icon && (
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl glass-strong text-primary sm:h-11 sm:w-11">
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

  if (to) {
    return <Link to={to}>{card}</Link>;
  }

  return card;
}

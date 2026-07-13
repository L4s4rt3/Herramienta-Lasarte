// MiniKpi — celda de la franja compacta de KPIs que comparten Análisis diario
// y Productores (antes cada página tenía su copia). En fila con separadores
// verticales en escritorio; rejilla en móvil la decide el contenedor.
import { cn } from "@/lib/utils";

const TONE_CLASS: Record<string, string> = {
  success: "text-success",
  warning: "text-warning",
  destructive: "text-destructive",
  neutral: "text-foreground",
};

export function MiniKpi({
  label, value, sub, tone = "neutral", last = false, labelInfo, onClick,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "success" | "warning" | "destructive" | "neutral";
  last?: boolean;
  labelInfo?: string;
  /** Si se pasa, el KPI es clicable (p.ej. abrir el dossier del productor). */
  onClick?: () => void;
}) {
  const Wrapper = onClick ? "button" : "div";
  return (
    <Wrapper
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={cn(
        "min-w-0 px-3 py-1.5 text-left sm:flex-1 sm:border-r sm:border-[var(--glass-border)]",
        last && "sm:border-r-0",
        onClick && "rounded-lg transition-colors hover:bg-[var(--glass-bg-strong)]"
      )}
      title={labelInfo}
    >
      <p className="panel-kicker truncate">{label}</p>
      <p className={cn("mt-0.5 text-[18px] font-semibold leading-tight tabular-nums sm:text-[20px]", TONE_CLASS[tone])}>
        {value}
        {sub && <span className="ml-1 text-xs font-medium text-muted-foreground">({sub})</span>}
      </p>
    </Wrapper>
  );
}

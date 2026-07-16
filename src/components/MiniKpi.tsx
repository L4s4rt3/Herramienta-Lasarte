// MiniKpi — celda de la franja compacta de KPIs que comparten Análisis diario
// y Productores (antes cada página tenía su copia, incluidas MiniMetric en
// VentasCategoriaSegunda.tsx y Stat en HistoricoImport.tsx, ya migradas aquí).
// variant="row" (por defecto): fila con separadores verticales en escritorio;
// rejilla en móvil la decide el contenedor.
// variant="card": tarjeta individual con borde propio (aspecto de Stat), para
// grids sueltas donde no hay una fila continua que dividir con separadores.
import { InfoTooltip } from "@/components/InfoTooltip";
import { cn } from "@/lib/utils";

const TONE_CLASS: Record<string, string> = {
  success: "text-success",
  warning: "text-warning",
  destructive: "text-destructive",
  neutral: "text-foreground",
};

export function MiniKpi({
  label, value, sub, tone = "neutral", last = false, labelInfo, labelInfoIcon = false, onClick,
  variant = "row", size = "md", subBlock = false,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "success" | "warning" | "destructive" | "neutral";
  /** Solo aplica a variant="row": el último de la fila no lleva separador derecho. */
  last?: boolean;
  labelInfo?: string;
  /**
   * Si true, `labelInfo` se muestra como icono "?" (InfoTooltip) junto a la
   * etiqueta, en vez de solo un `title` nativo sobre todo el bloque (que es
   * el comportamiento por defecto, false). Solo aplica a variant="row".
   */
  labelInfoIcon?: boolean;
  /** Si se pasa, el KPI es clicable (p.ej. abrir el dossier del productor). */
  onClick?: () => void;
  /** "row" (por defecto, fila con separadores) o "card" (tarjeta con borde propio, como Stat de HistoricoImport). */
  variant?: "row" | "card";
  /** Alto de la celda en variant="row": "md" (py-1.5, por defecto) o "lg" (py-2, como MiniMetric de VentasCategoriaSegunda). No aplica a variant="card". */
  size?: "md" | "lg";
  /**
   * Si true, `sub` se muestra en su propio párrafo debajo del valor (sin
   * paréntesis), en vez de inline junto al valor entre paréntesis (que es el
   * comportamiento por defecto, false). Solo aplica a variant="row".
   */
  subBlock?: boolean;
}) {
  const Wrapper = onClick ? "button" : "div";

  if (variant === "card") {
    return (
      <Wrapper
        type={onClick ? "button" : undefined}
        onClick={onClick}
        className={cn(
          "rounded-lg border border-[var(--glass-border)] bg-[var(--glass-bg)] p-2.5 text-left",
          onClick && "transition-colors hover:bg-[var(--glass-bg-strong)]"
        )}
        title={labelInfo}
      >
        <p className="text-[11px] text-muted-foreground">{label}</p>
        <p className={cn("text-sm font-semibold tabular-nums", TONE_CLASS[tone])}>
          {value}
          {sub && <span className="ml-1 text-xs font-medium text-muted-foreground">({sub})</span>}
        </p>
      </Wrapper>
    );
  }

  return (
    <Wrapper
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={cn(
        "min-w-0 px-3 text-left sm:flex-1 sm:border-r sm:border-[var(--glass-border)]",
        size === "lg" ? "py-2" : "py-1.5",
        last && "sm:border-r-0",
        onClick && "rounded-lg transition-colors hover:bg-[var(--glass-bg-strong)]"
      )}
      title={labelInfoIcon ? undefined : labelInfo}
    >
      {labelInfoIcon ? (
        <div className="flex items-center gap-1">
          <p className="panel-kicker truncate">{label}</p>
          {labelInfo && <InfoTooltip iconClassName="h-3 w-3">{labelInfo}</InfoTooltip>}
        </div>
      ) : (
        <p className="panel-kicker truncate">{label}</p>
      )}
      <p className={cn("mt-0.5 text-[18px] font-semibold leading-tight tabular-nums sm:text-[20px]", TONE_CLASS[tone])}>
        {value}
        {!subBlock && sub && <span className="ml-1 text-xs font-medium text-muted-foreground">({sub})</span>}
      </p>
      {subBlock && sub && <p className="mt-0.5 text-[11px] text-muted-foreground">{sub}</p>}
    </Wrapper>
  );
}

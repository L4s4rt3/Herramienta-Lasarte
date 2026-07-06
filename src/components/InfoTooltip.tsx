import type { ReactNode } from "react";
import { HelpCircle } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface InfoTooltipProps {
  children: ReactNode;
  className?: string;
  iconClassName?: string;
}

/** Icono "?" con tooltip explicativo. Úsalo junto a métricas que necesiten contexto. */
export function InfoTooltip({ children, className, iconClassName }: InfoTooltipProps) {
  return (
    <Tooltip delayDuration={150}>
      <TooltipTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-muted-foreground/12 text-muted-foreground outline-none transition-colors hover:bg-primary/15 hover:text-primary focus-visible:bg-primary/15 focus-visible:text-primary",
            className,
          )}
          aria-label="Más información"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
        >
          <HelpCircle className={cn("h-3.5 w-3.5", iconClassName)} />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-[300px] text-xs leading-relaxed">
        {children}
      </TooltipContent>
    </Tooltip>
  );
}

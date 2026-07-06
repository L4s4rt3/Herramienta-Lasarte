import { useState, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { ChevronDown, Calendar, FlaskConical, StickyNote } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  groupLotesByDay, calcularSubtotalesDia, getDiaSemana, formatFechaCorta,
  getTphBadge,
} from "@/lib/analisisDiarioView";
import type { LoteResumen } from "@/hooks/useAnalisisDiario";

function formatKg(v: number): string {
  if (v >= 1000) return (v / 1000).toFixed(1) + " t";
  return v.toFixed(0) + " kg";
}

const TPH_TEXT_CLASSES: Record<string, string> = {
  success: "text-success",
  warning: "text-warning",
  destructive: "text-destructive",
};

interface DaySectionProps {
  date: string;
  lotes: LoteResumen[];
  defaultOpen?: boolean;
  onLoteClick?: (lote: LoteResumen) => void;
}

function DaySection({ date, lotes, defaultOpen = false, onLoteClick }: DaySectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  const sub = useMemo(() => calcularSubtotalesDia(lotes), [lotes]);
  const diaSemana = getDiaSemana(date);
  const fechaCorta = formatFechaCorta(date);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="overflow-hidden rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg)]">
        <CollapsibleTrigger className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-[var(--glass-bg-strong)]">
          <ChevronDown
            className={cn(
              "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-200",
              open && "rotate-180"
            )}
          />
          {sub.nLentes > 0 && (
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-destructive" title={`${sub.nLentes} lote(s) lentos`} aria-hidden />
          )}
          <span className="shrink-0 text-sm font-semibold capitalize">
            {diaSemana.toLowerCase()} {fechaCorta}
          </span>
          <span className="truncate text-[12px] text-muted-foreground">
            {formatKg(sub.kg)} · {sub.nLotes} lote{sub.nLotes === 1 ? "" : "s"}
            {sub.avgTph !== null && <> · {sub.avgTph.toFixed(1)} T/h media</>}
            {sub.totalHoras > 0 && <> · {sub.totalHoras.toFixed(1)} h</>}
          </span>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="overflow-x-auto border-t border-[var(--glass-border)]">
            {/* Tabla densa — escritorio */}
            <table className="hidden w-full text-[13px] sm:table">
              <thead>
                <tr className="border-b border-[var(--glass-border)] text-left">
                  <th className="px-3 py-1.5 font-medium text-muted-foreground">Lote</th>
                  <th className="px-3 py-1.5 font-medium text-muted-foreground">Productor</th>
                  <th className="hidden px-3 py-1.5 text-left font-medium text-muted-foreground lg:table-cell">Producto</th>
                  <th className="px-3 py-1.5 text-right font-medium text-muted-foreground">Kg</th>
                  <th className="px-3 py-1.5 text-right font-medium text-muted-foreground">T/h</th>
                  <th className="px-3 py-1.5 text-right font-medium text-muted-foreground">Tiempo</th>
                  <th className="px-3 py-1.5 text-right font-medium text-muted-foreground">Industria</th>
                  <th className="w-8 px-3 py-1.5" />
                </tr>
              </thead>
              <tbody>
                {lotes.map((l, i) => {
                  const badge = getTphBadge(l.toneladas_hora);
                  const tieneClasificacion = !!l.clasificacion && l.clasificacion.kg_clasificado > 0;
                  return (
                    <tr
                      key={`${l.fecha}-${l.lote_codigo}-${i}`}
                      className={cn(
                        "border-b border-[var(--glass-border)] last:border-b-0",
                        i % 2 === 1 && "bg-[var(--glass-bg-strong)]/40",
                        onLoteClick && "cursor-pointer hover:bg-[var(--glass-bg-strong)]"
                      )}
                      onClick={() => onLoteClick?.(l)}
                    >
                      <td className="px-3 py-1.5 align-middle">
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono text-[12px]">{l.lote_codigo}</span>
                          {tieneClasificacion && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <FlaskConical className="h-3 w-3 shrink-0 text-primary" />
                              </TooltipTrigger>
                              <TooltipContent side="top">Tiene desglose de clasificación por lote</TooltipContent>
                            </Tooltip>
                          )}
                        </div>
                      </td>
                      <td className="max-w-[140px] truncate px-3 py-1.5 align-middle font-medium">{l.productor}</td>
                      <td className="hidden max-w-[160px] truncate px-3 py-1.5 align-middle text-muted-foreground lg:table-cell">{l.producto}</td>
                      <td className="px-3 py-1.5 text-right align-middle tabular-nums whitespace-nowrap">{formatKg(l.kg_peso_total)}</td>
                      <td className={cn("px-3 py-1.5 text-right align-middle tabular-nums whitespace-nowrap font-medium", badge && TPH_TEXT_CLASSES[badge])}>
                        {l.toneladas_hora !== null ? l.toneladas_hora.toFixed(1) : "—"}
                      </td>
                      <td className="px-3 py-1.5 text-right align-middle tabular-nums whitespace-nowrap text-muted-foreground">
                        {l.duracion_min != null ? `${(l.duracion_min / 60).toFixed(1)} h` : "—"}
                      </td>
                      <td className="px-3 py-1.5 text-right align-middle tabular-nums whitespace-nowrap">
                        {(l.kg_industria ?? 0) > 0 ? formatKg(l.kg_industria ?? 0) : <span className="text-muted-foreground/50">—</span>}
                      </td>
                      <td className="px-3 py-1.5 text-right align-middle">
                        {l.notas && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <StickyNote className="h-3 w-3 shrink-0 text-muted-foreground" onClick={(e) => e.stopPropagation()} />
                            </TooltipTrigger>
                            <TooltipContent side="left" className="max-w-[240px]">{l.notas}</TooltipContent>
                          </Tooltip>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {/* Tarjetas compactas — móvil */}
            <div className="grid grid-cols-2 gap-1.5 p-2 sm:hidden">
              {lotes.map((l, i) => {
                const badge = getTphBadge(l.toneladas_hora);
                const tieneClasificacion = !!l.clasificacion && l.clasificacion.kg_clasificado > 0;
                return (
                  <button
                    type="button"
                    key={`${l.fecha}-${l.lote_codigo}-m-${i}`}
                    onClick={() => onLoteClick?.(l)}
                    className={cn(
                      "flex flex-col gap-1 rounded-lg border border-[var(--glass-border)] bg-[var(--glass-bg)] px-2.5 py-2 text-left",
                      onLoteClick && "active:bg-[var(--glass-bg-strong)]"
                    )}
                  >
                    <div className="flex items-center gap-1 min-w-0">
                      <span className="truncate font-mono text-[11px]">{l.lote_codigo}</span>
                      {tieneClasificacion && <FlaskConical className="h-3 w-3 shrink-0 text-primary" />}
                    </div>
                    <span className="truncate text-[12px] font-medium">{l.productor}</span>
                    <div className="flex items-center justify-between">
                      <span className="tabular-nums text-[12px] text-muted-foreground">{formatKg(l.kg_peso_total)}</span>
                      <span className={cn("tabular-nums text-[12px] font-semibold", badge && TPH_TEXT_CLASSES[badge])}>
                        {l.toneladas_hora !== null ? `${l.toneladas_hora.toFixed(1)} T/h` : "—"}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

interface DailyListTableProps {
  lotes: LoteResumen[];
  defaultExpandFirst?: boolean;
  /** Al hacer clic en la fila de un lote (abre la ficha completa del lote). */
  onLoteClick?: (lote: LoteResumen) => void;
}

export function DailyListTable({ lotes, defaultExpandFirst = true, onLoteClick }: DailyListTableProps) {
  const grouped = useMemo(() => groupLotesByDay(lotes), [lotes]);
  const sortedDays = useMemo(
    () => Array.from(grouped.keys()).sort((a, b) => b.localeCompare(a)),
    [grouped]
  );

  const totalKg = useMemo(() => lotes.reduce((s, l) => s + l.kg_peso_total, 0), [lotes]);
  const totalLotes = lotes.length;

  if (sortedDays.length === 0) {
    return (
      <Card className="glass-accented">
        <CardContent className="py-12 text-center">
          <Calendar className="mx-auto mb-3 h-10 w-10 text-muted-foreground/30" />
          <p className="text-sm font-medium">Sin lotes en este periodo</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-2">
      {sortedDays.map((day, idx) => (
        <DaySection
          key={day}
          date={day}
          lotes={grouped.get(day) ?? []}
          defaultOpen={defaultExpandFirst && idx === 0}
          onLoteClick={onLoteClick}
        />
      ))}
      {/* Footer sticky */}
      <div className="sticky bottom-0 flex items-center justify-between rounded-lg border border-[var(--glass-border-accent)] bg-[var(--glass-bg-solid)] backdrop-blur-xl px-3 py-2 text-[13px] font-medium shadow-[var(--glass-shadow)]">
        <span className="panel-kicker">Total periodo</span>
        <div className="flex items-center gap-3">
          <span className="tabular-nums font-semibold">{formatKg(totalKg)}</span>
          <span className="text-muted-foreground">·</span>
          <span className="text-muted-foreground">{totalLotes} lotes</span>
        </div>
      </div>
    </div>
  );
}

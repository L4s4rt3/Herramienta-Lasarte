import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Badge } from "@/components/ui/badge";
import { ChevronDown, AlertTriangle, Calendar } from "lucide-react";
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

const TPH_BADGE_CLASSES: Record<string, string> = {
  success: "border-success/40 bg-success/10 text-success",
  warning: "border-warning/40 bg-warning/10 text-warning",
  destructive: "border-destructive/40 bg-destructive/10 text-destructive",
};

interface DaySectionProps {
  date: string;
  lotes: LoteResumen[];
  defaultOpen?: boolean;
}

function DaySection({ date, lotes, defaultOpen = false }: DaySectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  const sub = useMemo(() => calcularSubtotalesDia(lotes), [lotes]);
  const diaSemana = getDiaSemana(date);
  const fechaCorta = formatFechaCorta(date);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <Card className={cn(
        "overflow-hidden transition-shadow",
        sub.nLentes > 0
          ? "border-l-4 border-l-warning bg-warning/5"
          : "border-l-4 border-l-success bg-success/5"
      )}>
        <CollapsibleTrigger className="flex w-full items-center gap-4 px-4 py-3.5 text-left transition-colors hover:bg-[var(--glass-bg-strong)]">
          <ChevronDown
            className={cn(
              "h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200",
              open && "rotate-180"
            )}
          />

          {/* Fecha */}
          <div className="shrink-0 flex items-center gap-2 rounded-xl glass border border-[var(--glass-border)] px-3 py-1.5 shadow-[var(--glass-shadow)]">
            <Calendar className="h-4 w-4 text-primary/75 shrink-0" />
            <div className="flex flex-col">
              <span className="text-sm font-bold leading-tight">{diaSemana}</span>
              <span className="text-[10px] font-mono text-muted-foreground leading-tight">{fechaCorta}</span>
            </div>
          </div>

          {/* Métricas con labels */}
          <div className="flex items-center gap-5 ml-2">
            <div className="flex flex-col">
              <span className="text-base font-bold tabular-nums leading-tight">{formatKg(sub.kg)}</span>
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Kg</span>
            </div>
            <div className="w-px h-6 bg-[var(--glass-border)]" />
            <div className="flex flex-col">
              <span className="text-sm font-semibold tabular-nums leading-tight">
                {sub.avgTph !== null ? `${sub.avgTph.toFixed(1)}` : "—"}
              </span>
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider">T/h</span>
            </div>
            <div className="w-px h-6 bg-[var(--glass-border)]" />
            <div className="flex flex-col">
              <span className="text-sm font-semibold tabular-nums leading-tight">{sub.nLotes}</span>
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Lotes</span>
            </div>
          </div>

          {/* Alerta lotes lentos */}
          {sub.nLentes > 0 && (
            <span className="ml-auto flex items-center gap-1.5 text-xs font-semibold text-warning">
              <AlertTriangle className="h-3.5 w-3.5" />
              {sub.nLentes} lentos
            </span>
          )}
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="border-t border-[var(--glass-border)]">
            <table className="w-full text-sm data-table">
              <thead>
                <tr>
                  <th className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground sm:px-4">Lote</th>
                  <th className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground sm:px-4">Productor</th>
                  <th className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground sm:px-4">Producto</th>
                  <th className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground text-right sm:px-4">Kg</th>
                  <th className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground text-right sm:px-4">T/h</th>
                  <th className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground text-right sm:px-4">Min</th>
                  <th className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground text-right sm:px-4">Peso fruta</th>
                </tr>
              </thead>
              <tbody>
                {lotes.map((l, i) => {
                  const badge = getTphBadge(l.toneladas_hora);
                  return (
                    <tr key={`${l.fecha}-${l.lote_codigo}-${i}`}>
                      <td className="font-mono text-xs">{l.lote_codigo}</td>
                      <td className="font-medium">{l.productor}</td>
                      <td className="text-muted-foreground">{l.producto}</td>
                      <td className="text-right font-mono tabular-nums">{formatKg(l.kg_peso_total)}</td>
                      <td className="text-right">
                        {l.toneladas_hora !== null ? (
                          <Badge variant="outline" className={cn("text-xs font-mono", badge && TPH_BADGE_CLASSES[badge])}>
                            {l.toneladas_hora.toFixed(1)}
                          </Badge>
                        ) : "—"}
                      </td>
                      <td className="text-right tabular-nums">{l.duracion_min ?? "—"}</td>
                      <td className="text-right tabular-nums">{l.peso_fruta_promedio_g !== null ? `${l.peso_fruta_promedio_g.toFixed(0)}g` : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

interface DailyListTableProps {
  lotes: LoteResumen[];
  defaultExpandFirst?: boolean;
}

export function DailyListTable({ lotes, defaultExpandFirst = true }: DailyListTableProps) {
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
          <p className="text-sm text-muted-foreground">Sin lotes en este periodo</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {sortedDays.map((day, idx) => (
        <DaySection
          key={day}
          date={day}
          lotes={grouped.get(day) ?? []}
          defaultOpen={defaultExpandFirst && idx === 0}
        />
      ))}
      {/* Footer sticky */}
      <div className="sticky bottom-0 flex items-center justify-between rounded-xl border border-[var(--glass-border-accent)] bg-[var(--glass-bg-strong)] backdrop-blur-xl px-4 py-3 text-sm font-medium shadow-[var(--glass-shadow)]">
        <span className="panel-kicker">Total semana</span>
        <div className="flex items-center gap-4">
          <span className="tabular-nums font-semibold">{formatKg(totalKg)}</span>
          <span className="text-muted-foreground">·</span>
          <span className="text-muted-foreground">{totalLotes} lotes</span>
        </div>
      </div>
    </div>
  );
}

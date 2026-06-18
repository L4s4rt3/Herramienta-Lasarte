import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Badge } from "@/components/ui/badge";
import { ChevronDown, AlertTriangle } from "lucide-react";
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
      <Card className="glass overflow-hidden">
        <CollapsibleTrigger className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--glass-bg-strong)]">
          <ChevronDown
            className={cn(
              "h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200",
              open && "rotate-180"
            )}
          />
          <Badge variant="outline" className="font-mono text-xs shrink-0">
            {diaSemana} {fechaCorta}
          </Badge>
          <span className="text-sm font-semibold tabular-nums">{formatKg(sub.kg)}</span>
          <span className="text-xs text-muted-foreground">·</span>
          <span className="text-xs text-muted-foreground">
            {sub.avgTph !== null ? `${sub.avgTph.toFixed(1)} T/h` : "—"}
          </span>
          <span className="text-xs text-muted-foreground">·</span>
          <span className="text-xs text-muted-foreground">{sub.nLotes} lotes</span>
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
                  <th>Lote</th>
                  <th>Productor</th>
                  <th>Producto</th>
                  <th className="text-right">Kg</th>
                  <th className="text-right">T/h</th>
                  <th className="text-right">Min</th>
                  <th className="text-right">Peso fruta</th>
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

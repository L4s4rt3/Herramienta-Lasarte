import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { formatDate, formatKg, formatNumber } from "@/lib/format";
import type { VentasCategoriaLineaRow } from "@/lib/types";

interface DailyGroupTableProps {
  lines: VentasCategoriaLineaRow[];
  pageSize?: number;
}

interface DayGroup {
  fecha: string;
  lines: VentasCategoriaLineaRow[];
  totalKilos: number;
  totalBase: number;
}

function groupByDay(lines: VentasCategoriaLineaRow[]): DayGroup[] {
  const map = new Map<string, VentasCategoriaLineaRow[]>();
  lines.forEach((line) => {
    const existing = map.get(line.fecha) ?? [];
    existing.push(line);
    map.set(line.fecha, existing);
  });
  return Array.from(map.entries()).map(([fecha, dayLines]) => ({
    fecha,
    lines: dayLines,
    totalKilos: dayLines.reduce((sum, l) => sum + l.kilos, 0),
    totalBase: dayLines.reduce((sum, l) => sum + l.base_iva, 0),
  })).sort((a, b) => b.fecha.localeCompare(a.fecha));
}

export function DailyGroupTable({ lines, pageSize = 5 }: DailyGroupTableProps) {
  const [visibleDays, setVisibleDays] = useState(pageSize);
  const [expandedDays, setExpandedDays] = useState<Set<string>>(new Set());

  const dayGroups = useMemo(() => groupByDay(lines), [lines]);
  const visible = dayGroups.slice(0, visibleDays);
  const hasMore = visibleDays < dayGroups.length;

  const toggleDay = (fecha: string) => {
    setExpandedDays((prev) => {
      const next = new Set(prev);
      if (next.has(fecha)) next.delete(fecha);
      else next.add(fecha);
      return next;
    });
  };

  const loadMore = () => setVisibleDays((prev) => prev + pageSize);

  if (dayGroups.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        No hay lineas con estos filtros.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {visible.map((day) => {
        const isExpanded = expandedDays.has(day.fecha);
        return (
          <div key={day.fecha} className="rounded-lg border border-[var(--glass-border)] bg-[var(--glass-bg)] shadow-[var(--glass-shadow)] backdrop-blur-xl">
            <button
              onClick={() => toggleDay(day.fecha)}
              className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--glass-bg-strong)]"
            >
              {isExpanded ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
              <div className="min-w-0 flex-1">
                <span className="font-semibold">{formatDate(`${day.fecha}T12:00:00`)}</span>
                <span className="ml-2 text-xs text-muted-foreground">{day.lines.length} lineas</span>
              </div>
              <div className="flex items-center gap-4 text-sm tabular-nums">
                <span className="font-medium">{formatKg(day.totalKilos)}</span>
                <span className="text-muted-foreground">{formatNumber(day.totalBase, 2)} EUR</span>
              </div>
            </button>
            {isExpanded && (
              <div className="overflow-x-auto border-t border-[var(--glass-border)]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="sticky left-0 z-10 bg-[var(--glass-bg-solid)]">Cliente</TableHead>
                      <TableHead className="sticky left-[180px] z-10 bg-[var(--glass-bg-solid)] min-w-[280px]">Articulo</TableHead>
                      <TableHead>Metodo</TableHead>
                      <TableHead className="text-right">Kilos</TableHead>
                      <TableHead className="text-right">PM</TableHead>
                      <TableHead className="text-right">Base</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {day.lines.map((line) => (
                      <TableRow key={line.id}>
                        <TableCell className="sticky left-0 z-10 bg-[var(--glass-bg-solid)] min-w-[180px]">
                          <div className="font-medium truncate max-w-[170px]">{line.cliente_nombre}</div>
                        </TableCell>
                        <TableCell className="sticky left-[180px] z-10 bg-[var(--glass-bg-solid)] min-w-[280px]">
                          <div className="truncate max-w-[270px]">{line.articulo}</div>
                        </TableCell>
                        <TableCell>{line.metodo_producto ?? "Sin clasificar"}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatKg(line.kilos)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatNumber(line.pm_venta, 3)} EUR/kg</TableCell>
                        <TableCell className="text-right tabular-nums">{formatNumber(line.base_iva, 2)} EUR</TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="border-t border-[var(--glass-border-accent)] font-semibold">
                      <TableCell colSpan={3} className="text-xs text-muted-foreground">Subtotal dia</TableCell>
                      <TableCell className="text-right tabular-nums">{formatKg(day.totalKilos)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatNumber(day.totalKilos > 0 ? day.totalBase / day.totalKilos : 0, 3)} EUR/kg</TableCell>
                      <TableCell className="text-right tabular-nums">{formatNumber(day.totalBase, 2)} EUR</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        );
      })}
      {hasMore && (
        <div className="flex justify-center pt-2">
          <Button variant="outline" size="sm" onClick={loadMore}>
            Cargar mas dias ({dayGroups.length - visibleDays} restantes)
          </Button>
        </div>
      )}
    </div>
  );
}

import { Fragment, useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { formatDate, formatNumber } from "@/lib/format";
import { groupDailyRowsByWeek, sumMateriaTotales } from "@/lib/consumoPeriodoView";
import { waterBreakdownForRange, type ConsumoFisicoInput, type ConsumoPeriodoRow } from "@/lib/consumosFisicos";

type TablaModo = "totales" | "por_kg";

interface Columna {
  key: "agua" | "electricidad" | "gasoil" | "quimicos";
  label: string;
  unit: string;
  perKgUnit: string;
  perKgDigits: number;
  totalDigits: number;
  value: (row: ConsumoPeriodoRow) => number;
  perKg: (row: ConsumoPeriodoRow) => number;
}

const COLUMNAS: Columna[] = [
  {
    key: "agua", label: "Agua", unit: "L", perKgUnit: "L/kg", perKgDigits: 2, totalDigits: 0,
    value: (row) => row.aguaL,
    perKg: (row) => (row.kgBase > 0 ? row.aguaL / row.kgBase : 0),
  },
  {
    key: "electricidad", label: "Electricidad", unit: "kWh", perKgUnit: "Wh/kg", perKgDigits: 1, totalDigits: 1,
    value: (row) => row.electricidadKwh,
    perKg: (row) => (row.kgBase > 0 ? (row.electricidadKwh * 1000) / row.kgBase : 0),
  },
  {
    key: "gasoil", label: "Gasoil", unit: "L", perKgUnit: "mL/kg", perKgDigits: 1, totalDigits: 1,
    value: (row) => row.gasoilL,
    perKg: (row) => (row.kgBase > 0 ? (row.gasoilL * 1000) / row.kgBase : 0),
  },
  {
    key: "quimicos", label: "Tratamientos", unit: "L", perKgUnit: "mL/kg", perKgDigits: 1, totalDigits: 1,
    value: (row) => row.quimicosL,
    perKg: (row) => (row.kgBase > 0 ? (row.quimicosL * 1000) / row.kgBase : 0),
  },
];

interface ConsumoDiarioTableProps {
  rows: ConsumoPeriodoRow[];
  /** Cuando hay muchos dias (Mes/Campaña) se agrupan por semana con filas colapsables. */
  groupByWeek?: boolean;
  /** Consumos crudos, solo para mostrar el desglose de subcontadores de agua en tooltip. Opcional. */
  consumos?: ConsumoFisicoInput[];
}

function cellText(row: ConsumoPeriodoRow, col: Columna, modo: TablaModo): string {
  const hasAny = row.aguaL > 0 || row.electricidadKwh > 0 || row.gasoilL > 0 || row.quimicosL > 0;
  if (!hasAny) return "—";

  if (modo === "totales") {
    const value = col.value(row);
    return value > 0 ? `${formatNumber(value, col.totalDigits)}` : "—";
  }

  if (row.kgBase <= 0) return "—";
  const value = col.perKg(row);
  return value > 0 ? formatNumber(value, col.perKgDigits) : "—";
}

function unitFor(col: Columna, modo: TablaModo): string {
  return modo === "totales" ? col.unit : col.perKgUnit;
}

export function ConsumoDiarioTable({ rows, groupByWeek = false, consumos }: ConsumoDiarioTableProps) {
  const [modo, setModo] = useState<TablaModo>("totales");
  const [expandedWeeks, setExpandedWeeks] = useState<Set<string>>(new Set());

  const weekGroups = useMemo(
    () => (groupByWeek ? groupDailyRowsByWeek(rows) : []),
    [groupByWeek, rows],
  );

  const totals = useMemo(() => sumMateriaTotales(rows), [rows]);

  const toggleWeek = (id: string) => {
    setExpandedWeeks((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Desglose de subcontadores de agua por dia, solo para el tooltip informativo de la
  // celda "Agua" (no afecta a los totales, que ya excluyen los subcontadores).
  const aguaBreakdownByDay = useMemo(() => {
    if (!consumos) return null;
    const map = new Map<string, { tratamientoL: number; tratamientoJabonL: number; drencherL: number }>();
    rows.forEach((row) => {
      const breakdown = waterBreakdownForRange(consumos, row.periodo, row.periodo);
      if (breakdown.tratamientoL > 0 || breakdown.tratamientoJabonL > 0 || breakdown.drencherL > 0) {
        map.set(row.periodo, breakdown);
      }
    });
    return map;
  }, [consumos, rows]);

  const renderAguaCell = (row: ConsumoPeriodoRow, col: Columna) => {
    const text = cellText(row, col, modo);
    const breakdown = aguaBreakdownByDay?.get(row.periodo);

    if (!breakdown) {
      return text;
    }

    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="cursor-help underline decoration-dotted decoration-muted-foreground/50 underline-offset-2">
            {text}
          </span>
        </TooltipTrigger>
        <TooltipContent className="text-xs">
          <p className="font-semibold">Desglose del día (incluido en el total)</p>
          {breakdown.tratamientoL > 0 && <p>Línea tratamiento: {formatNumber(breakdown.tratamientoL, 0)} L</p>}
          {breakdown.tratamientoJabonL > 0 && <p>Tratamiento+jabón: {formatNumber(breakdown.tratamientoJabonL, 0)} L</p>}
          {breakdown.drencherL > 0 && <p>Drencher: {formatNumber(breakdown.drencherL, 0)} L</p>}
        </TooltipContent>
      </Tooltip>
    );
  };

  const renderRowCells = (row: ConsumoPeriodoRow) => (
    <>
      {COLUMNAS.map((col) => (
        <TableCell key={col.key} className="text-right tabular-nums">
          {col.key === "agua" ? renderAguaCell(row, col) : cellText(row, col, modo)}
        </TableCell>
      ))}
    </>
  );

  const renderSummaryCells = (rowsForSummary: ConsumoPeriodoRow[]) => {
    const summed = sumMateriaTotales(rowsForSummary);
    return (
      <>
        {COLUMNAS.map((col) => {
          if (modo === "totales") {
            const value = col.key === "agua" ? summed.aguaL
              : col.key === "electricidad" ? summed.electricidadKwh
              : col.key === "gasoil" ? summed.gasoilL
              : summed.quimicosL;
            return (
              <TableCell key={col.key} className="text-right tabular-nums font-semibold">
                {value > 0 ? formatNumber(value, col.totalDigits) : "—"}
              </TableCell>
            );
          }
          const value = col.key === "agua" ? (summed.kgBase > 0 ? summed.aguaL / summed.kgBase : 0)
            : col.key === "electricidad" ? (summed.kgBase > 0 ? (summed.electricidadKwh * 1000) / summed.kgBase : 0)
            : col.key === "gasoil" ? (summed.kgBase > 0 ? (summed.gasoilL * 1000) / summed.kgBase : 0)
            : (summed.kgBase > 0 ? (summed.quimicosL * 1000) / summed.kgBase : 0);
          return (
            <TableCell key={col.key} className="text-right tabular-nums font-semibold">
              {value > 0 ? formatNumber(value, col.perKgDigits) : "—"}
            </TableCell>
          );
        })}
      </>
    );
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {unitFor(COLUMNAS[0], modo) !== COLUMNAS[0].unit ? "Consumo por kg producido" : "Totales diarios"}
        </p>
        <div className="flex items-center gap-1 rounded-xl bg-[var(--glass-bg)] border border-[var(--glass-border)] p-1 shadow-[var(--glass-shadow)]">
          {([
            { value: "totales" as const, label: "Totales" },
            { value: "por_kg" as const, label: "Por kg" },
          ]).map((option) => {
            const active = modo === option.value;
            return (
              <Button
                key={option.value}
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setModo(option.value)}
                className={cn(
                  "h-7 rounded-lg px-3 text-xs transition-all",
                  active
                    ? "bg-[var(--glass-bg-strong)] text-foreground shadow-[var(--glass-shadow)] font-semibold"
                    : "text-muted-foreground hover:bg-[var(--glass-bg-strong)]/60 hover:text-foreground",
                )}
              >
                {option.label}
              </Button>
            );
          })}
        </div>
      </div>

      <div className="overflow-x-auto">
        <Table className="data-table [&_td]:py-1.5 [&_th]:py-2">
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-[110px]">Día</TableHead>
              {COLUMNAS.map((col) => (
                <TableHead key={col.key} className="text-right whitespace-nowrap">
                  {col.label} <span className="text-muted-foreground font-normal">({unitFor(col, modo)})</span>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={COLUMNAS.length + 1} className="text-center text-sm text-muted-foreground py-8">
                  No hay días en este periodo.
                </TableCell>
              </TableRow>
            )}

            {groupByWeek ? (
              weekGroups.map((group) => {
                const isExpanded = expandedWeeks.has(group.id);
                return (
                  <Fragment key={group.id}>
                    <TableRow
                      className="cursor-pointer bg-[var(--glass-bg-strong)]/60 hover:bg-[var(--glass-bg-strong)]"
                      onClick={() => toggleWeek(group.id)}
                    >
                      <TableCell className="font-medium">
                        <span className="flex items-center gap-1.5">
                          {isExpanded ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
                          {group.label}
                          <span className="text-[11px] font-normal text-muted-foreground">{group.detail}</span>
                        </span>
                      </TableCell>
                      {renderSummaryCells(group.rows)}
                    </TableRow>
                    {isExpanded && group.rows.map((row, rowIndex) => (
                      <TableRow
                        key={row.periodo}
                        className={cn(rowIndex % 2 === 1 && "bg-[var(--glass-bg)]/40")}
                      >
                        <TableCell className="pl-7 text-xs text-muted-foreground whitespace-nowrap">
                          {formatDate(row.periodo)}
                        </TableCell>
                        {renderRowCells(row)}
                      </TableRow>
                    ))}
                  </Fragment>
                );
              })
            ) : (
              rows.map((row, rowIndex) => (
                <TableRow
                  key={row.periodo}
                  className={cn(rowIndex % 2 === 1 && "bg-[var(--glass-bg)]/40")}
                >
                  <TableCell className="whitespace-nowrap font-medium">{formatDate(row.periodo)}</TableCell>
                  {renderRowCells(row)}
                </TableRow>
              ))
            )}
          </TableBody>
          {rows.length > 0 && (
            <tfoot>
              <TableRow className="border-t border-[var(--glass-border-accent)] bg-[var(--glass-bg-strong)] font-semibold">
                <TableCell>{modo === "totales" ? "Total" : "Media"}</TableCell>
                {renderSummaryCells(rows)}
              </TableRow>
            </tfoot>
          )}
        </Table>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Kg base del periodo: <span className="font-semibold text-foreground tabular-nums">{formatNumber(totals.kgBase)} kg</span>
      </p>
    </div>
  );
}

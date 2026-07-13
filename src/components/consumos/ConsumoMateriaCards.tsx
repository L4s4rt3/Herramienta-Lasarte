import { Droplet, Zap, Fuel, FlaskConical, type LucideIcon } from "lucide-react";
import { DeltaChip } from "@/components/DeltaChip";
import { Sparkline } from "@/components/Sparkline";
import { Button } from "@/components/ui/button";
import { C } from "@/lib/chartTheme";
import { formatNumber } from "@/lib/format";
import { deltaPct, type MateriaTotales } from "@/lib/consumoPeriodoView";
import type { ConsumoPeriodoRow, WaterBreakdown } from "@/lib/consumosFisicos";

export type MateriaId = "agua" | "electricidad" | "gasoil" | "quimicos";

interface MateriaDef {
  id: MateriaId;
  label: string;
  icon: LucideIcon;
  color: string;
  textClass: string;
  softClass: string;
  unit: string;
  totalDigits: number;
  perKg: (totales: MateriaTotales) => number | null;
  perKgUnit: string;
  perKgDigits: number;
  dailyValue: (row: ConsumoPeriodoRow) => number;
  total: (totales: MateriaTotales) => number;
}

const MATERIAS: MateriaDef[] = [
  {
    id: "agua",
    label: "Agua",
    icon: Droplet,
    color: C.info,
    textClass: "text-info",
    softClass: "bg-info/10 border-info/20",
    unit: "L",
    totalDigits: 0,
    total: (t) => t.aguaL,
    perKg: (t) => (t.kgBase > 0 ? t.aguaL / t.kgBase : null),
    perKgUnit: "L/kg",
    perKgDigits: 2,
    dailyValue: (row) => row.aguaL,
  },
  {
    id: "electricidad",
    label: "Electricidad",
    icon: Zap,
    color: C.warning,
    textClass: "text-warning",
    softClass: "bg-warning/10 border-warning/20",
    unit: "kWh",
    totalDigits: 1,
    total: (t) => t.electricidadKwh,
    perKg: (t) => (t.kgBase > 0 ? (t.electricidadKwh * 1000) / t.kgBase : null),
    perKgUnit: "Wh/kg",
    perKgDigits: 1,
    dailyValue: (row) => row.electricidadKwh,
  },
  {
    id: "gasoil",
    label: "Gasoil",
    icon: Fuel,
    color: C.primary,
    textClass: "text-primary",
    softClass: "bg-primary/10 border-primary/20",
    unit: "L",
    totalDigits: 1,
    total: (t) => t.gasoilL,
    perKg: (t) => (t.kgBase > 0 ? (t.gasoilL * 1000) / t.kgBase : null),
    perKgUnit: "mL/kg",
    perKgDigits: 1,
    dailyValue: (row) => row.gasoilL,
  },
  {
    id: "quimicos",
    label: "Tratamientos",
    icon: FlaskConical,
    color: C.destructive,
    textClass: "text-destructive",
    softClass: "bg-destructive/10 border-destructive/20",
    unit: "L",
    totalDigits: 1,
    total: (t) => t.quimicosL,
    perKg: (t) => (t.kgBase > 0 ? (t.quimicosL * 1000) / t.kgBase : null),
    perKgUnit: "mL/kg",
    perKgDigits: 1,
    dailyValue: (row) => row.quimicosL,
  },
];

interface ConsumoMateriaCardsProps {
  rows: ConsumoPeriodoRow[];
  totales: MateriaTotales;
  totalesAnterior: MateriaTotales | null;
  /** Desglose informativo de subcontadores de agua (tratamiento / tratamiento+jabon). No suman al total. */
  aguaBreakdown?: WaterBreakdown;
  onRegistrar: (materia: MateriaId) => void;
}

export function ConsumoMateriaCards({ rows, totales, totalesAnterior, aguaBreakdown, onRegistrar }: ConsumoMateriaCardsProps) {
  return (
    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {MATERIAS.map((materia) => {
        const Icon = materia.icon;
        const total = materia.total(totales);
        const perKg = materia.perKg(totales);
        const sparkValues = rows.map((row) => materia.dailyValue(row));
        const hasData = total > 0;
        const previousTotal = totalesAnterior ? materia.total(totalesAnterior) : null;
        const delta = previousTotal != null ? deltaPct(total, previousTotal) : null;
        const trend = delta == null ? "neutral" : delta > 0.5 ? "up" : delta < -0.5 ? "down" : "neutral";
        // Para consumos, "menos" es la mejora: invertimos semántica de color en el chip
        // dejando el icono de tendencia real (sube/baja) pero sin forzar verde/rojo aquí,
        // ya que DeltaChip ya usa success/destructive de forma neutra sobre sube/baja.

        if (!hasData) {
          return (
            <div
              key={materia.id}
              className="glass rounded-xl border border-dashed border-[var(--glass-border)] p-4 opacity-70"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{materia.label}</p>
                  <p className="mt-2 text-lg font-semibold text-muted-foreground">Sin datos</p>
                </div>
                <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-dashed border-[var(--glass-border)]">
                  <Icon className="h-5 w-5 text-muted-foreground" />
                </div>
              </div>
              <p className="mt-4 text-xs text-muted-foreground">
                Registra {materia.label.toLowerCase()} para ver el consumo de este periodo.
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-4 w-full glass-hover"
                onClick={() => onRegistrar(materia.id)}
              >
                Registrar {materia.label.toLowerCase()}
              </Button>
            </div>
          );
        }

        return (
          <div key={materia.id} className="glass-accented rounded-xl p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className={`text-xs font-semibold uppercase tracking-wider ${materia.textClass}`}>{materia.label}</p>
                <p className="mt-2 text-2xl font-semibold tabular-nums">
                  {formatNumber(total, materia.totalDigits)} <span className="text-sm font-medium text-muted-foreground">{materia.unit}</span>
                </p>
              </div>
              <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border ${materia.softClass}`}>
                <Icon className={`h-5 w-5 ${materia.textClass}`} />
              </div>
            </div>

            <div className="mt-3 flex items-center justify-between gap-2">
              <div className="text-sm font-semibold tabular-nums">
                {perKg != null ? `${formatNumber(perKg, materia.perKgDigits)} ${materia.perKgUnit}` : "Sin base kg"}
              </div>
              {delta != null && (
                <DeltaChip
                  value={`${delta > 0 ? "+" : ""}${formatNumber(delta, 1)}%`}
                  trend={trend}
                />
              )}
            </div>

            {sparkValues.length > 1 && (
              <div className="mt-3">
                <Sparkline values={sparkValues} color={materia.color} height={26} />
              </div>
            )}

            {materia.id === "agua" && aguaBreakdown && (aguaBreakdown.tratamientoL > 0 || aguaBreakdown.tratamientoJabonL > 0 || aguaBreakdown.drencherL > 0) && (
              <div className="mt-3 space-y-1 border-t border-[var(--glass-border)] pt-2">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Desglose (incluido en el total)</p>
                {aguaBreakdown.tratamientoL > 0 && (
                  <p className="text-xs text-muted-foreground">
                    Línea tratamiento: <span className="font-semibold text-foreground tabular-nums">{formatNumber(aguaBreakdown.tratamientoL, 0)} L</span>
                    {total > 0 && ` · ${formatNumber((aguaBreakdown.tratamientoL / total) * 100, 1)}% del total`}
                  </p>
                )}
                {aguaBreakdown.tratamientoJabonL > 0 && (
                  <p className="text-xs text-muted-foreground">
                    Tratamiento+jabón: <span className="font-semibold text-foreground tabular-nums">{formatNumber(aguaBreakdown.tratamientoJabonL, 0)} L</span>
                    {total > 0 && ` · ${formatNumber((aguaBreakdown.tratamientoJabonL / total) * 100, 1)}% del total`}
                  </p>
                )}
                {aguaBreakdown.drencherL > 0 && (
                  <p className="text-xs text-muted-foreground">
                    Drencher: <span className="font-semibold text-foreground tabular-nums">{formatNumber(aguaBreakdown.drencherL, 0)} L</span>
                    {total > 0 && ` · ${formatNumber((aguaBreakdown.drencherL / total) * 100, 1)}% del total`}
                  </p>
                )}
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}

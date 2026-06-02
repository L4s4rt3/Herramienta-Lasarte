import { cn } from "@/lib/utils";
import { StatusBadge } from "./StatusBadge";
import { matchStatus } from "./formatters";
import type { Metric } from "./types";

const NUMERIC_METRIC_RE = /^[-+]?\d/;

function isNumericMetric(value: string | number): boolean {
  if (typeof value === "number") return true;
  return NUMERIC_METRIC_RE.test(String(value).trim());
}

interface MetricCardProps {
  metric: Metric;
}

function MetricCard({ metric }: MetricCardProps) {
  const status = matchStatus(String(metric.value));
  const isStatus = !isNumericMetric(metric.value) && status !== "muted";

  return (
    <div
      className={cn(
        "rounded-lg border border-slate-200/60 bg-white/60 backdrop-blur-sm",
        "p-2.5 flex flex-col gap-0.5 min-w-0"
      )}
    >
      <div className="flex items-center gap-1.5 min-w-0">
        {metric.category && (
          <span className="text-[9px] font-bold text-orange-600 uppercase tracking-widest shrink-0">
            {metric.category}
          </span>
        )}
        <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider truncate">
          {metric.label}
        </span>
      </div>
      {isStatus ? (
        <div className="mt-0.5">
          <StatusBadge value={String(metric.value)} status={status} />
        </div>
      ) : (
        <span className="text-base font-bold text-slate-900 tabular-nums truncate">
          {metric.value}
        </span>
      )}
    </div>
  );
}

interface MetricsStripProps {
  metrics: Metric[];
  maxVisible?: number;
}

function prioritizeMetrics(metrics: Metric[], max: number): Metric[] {
  if (metrics.length <= max) return metrics;
  const scored = metrics.map((m, i) => {
    const val = String(m.value).trim();
    const isNumeric = isNumericMetric(val);
    const isKey =
      /kg|peso|kilo|€|eur|euro|%|total|cajas|piezas|palets|neto/i.test(
        m.label
      );
    return { metric: m, score: (isNumeric ? 2 : 0) + (isKey ? 3 : 0) + (metrics.length - i) * 0.01 };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, max).map((s) => s.metric);
}

export function MetricsStrip({ metrics, maxVisible = 5 }: MetricsStripProps) {
  if (metrics.length === 0) return null;
  const visible = prioritizeMetrics(metrics, maxVisible);
  const hidden = metrics.length - visible.length;

  return (
    <section className="shrink-0 space-y-2">
      <div className="flex items-center justify-between px-1">
        <h2 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">
          Resumen
        </h2>
        {hidden > 0 && (
          <span className="text-[10px] text-slate-400">
            +{hidden} más
          </span>
        )}
      </div>
      <div
        className={cn(
          "grid gap-2",
          "grid-cols-2 sm:grid-cols-3 md:grid-cols-4",
          visible.length >= 5 && "lg:grid-cols-5"
        )}
      >
        {visible.map((m, i) => (
          <MetricCard key={i} metric={m} />
        ))}
      </div>
    </section>
  );
}

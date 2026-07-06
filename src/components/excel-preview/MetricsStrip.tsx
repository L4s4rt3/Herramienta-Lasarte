import { useState } from "react";
import { ChevronDown } from "lucide-react";
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
    <div className={cn("glass rounded-xl p-3 flex flex-col gap-1 min-w-0")}>
      <div className="flex items-center gap-1.5 min-w-0">
        {metric.category && (
          <span className="text-[9px] font-bold text-primary uppercase tracking-widest shrink-0">
            {metric.category}
          </span>
        )}
        <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider truncate">
          {metric.label}
        </span>
      </div>
      {isStatus ? (
        <div className="mt-0.5">
          <StatusBadge value={String(metric.value)} status={status} />
        </div>
      ) : (
        <span className="text-2xl font-bold text-foreground tabular-nums truncate leading-tight">
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

export function MetricsStrip({ metrics, maxVisible = 6 }: MetricsStripProps) {
  const [expanded, setExpanded] = useState(false);
  if (metrics.length === 0) return null;

  const cappedMax = Math.min(maxVisible, 6);
  const prioritized = prioritizeMetrics(metrics, metrics.length);
  const visible = expanded ? prioritized : prioritized.slice(0, cappedMax);
  const hidden = prioritized.length - Math.min(cappedMax, prioritized.length);

  return (
    <section className="shrink-0 space-y-2">
      <div className="flex items-center justify-between px-1">
        <h2 className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest">
          Resumen
        </h2>
        {hidden > 0 && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary hover:underline"
          >
            {expanded ? "Ver menos" : `Ver más (+${hidden})`}
            <ChevronDown
              className={cn("h-3 w-3 transition-transform", expanded && "rotate-180")}
            />
          </button>
        )}
      </div>
      <div
        className={cn(
          "grid gap-2",
          "grid-cols-2 sm:grid-cols-3 md:grid-cols-4",
          cappedMax >= 5 && "lg:grid-cols-5",
          cappedMax >= 6 && "xl:grid-cols-6"
        )}
      >
        {visible.map((m, i) => (
          <MetricCard key={i} metric={m} />
        ))}
      </div>
    </section>
  );
}

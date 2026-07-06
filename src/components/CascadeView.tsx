import type { ReactNode } from "react";
import { CascadeResult } from "@/lib/cascade";
import { formatKg, formatPct } from "@/lib/format";
import { cn } from "@/lib/utils";
import { InfoTooltip } from "@/components/InfoTooltip";
import { DJPMN_HELP } from "@/lib/semaforo";
import {
  Factory, Package, TrendingDown,
  BarChart2, Minus, Layers, Check, AlertTriangle, X,
  Gauge,
} from "lucide-react";

export interface DestinoFrutaItem {
  grupo: string;
  kg: number;
  color: string;
}

// ─── Sub-componentes ──────────────────────────────────────────────────────────

function SectionLabel({ icon: Icon, label, info }: { icon: React.ElementType; label: string; info?: ReactNode }) {
  return (
    <div className="flex items-center gap-1.5 pt-3 pb-1 first:pt-0">
      <Icon className="h-3.5 w-3.5 text-muted-foreground" />
      <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
        {label}
      </span>
      {info && <InfoTooltip iconClassName="h-3 w-3">{info}</InfoTooltip>}
    </div>
  );
}

function Row({
  label,
  op,
  value,
  variant = "sub",
  icon: Icon,
  colorClass,
  format = "kg",
}: {
  label: string;
  op: "=" | "+" | "−" | "";
  value: number;
  variant?: "base" | "sub" | "total";
  icon?: React.ElementType;
  colorClass?: string;
  format?: "kg" | "pct";
}) {
  const isNegative = op === "−" && value !== 0;

  return (
    <div
      className={cn(
        "grid items-center gap-2 rounded-xl px-3 py-2 text-sm",
        "grid-cols-[1fr_auto_auto]",
        variant === "base"  && "border border-[var(--glass-border)] bg-[var(--glass-bg)]",
        variant === "sub"   && "pl-6",
        variant === "total" && "bg-[var(--glass-bg-strong)] border border-[var(--glass-border-accent)]",
      )}
    >
      <div className={cn("flex items-center gap-2", variant === "total" && "font-medium")}>
        {Icon && <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
        <span>{label}</span>
      </div>
      <span className="w-4 text-center text-xs font-medium text-muted-foreground">{op}</span>
      <span className={cn(
        "tabular-nums text-right whitespace-nowrap",
        isNegative && "text-destructive",
        variant === "total" && "font-semibold text-[13.5px]",
        colorClass,
      )}>
        {format === "pct" ? formatPct(value) : formatKg(value)}
      </span>
    </div>
  );
}

function Divider() {
  return <div className="my-1 h-px bg-[var(--glass-border)]" />;
}

// ─── Barra de destino de fruta (también usada por PartDetailDestino) ─────────

export function DestinoBar({
  label,
  kg,
  total,
  color,
}: {
  label: string;
  kg: number;
  total: number;
  color: string;
}) {
  const pct = total > 0 ? (kg / total) * 100 : 0;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <div className="flex items-center gap-1.5">
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />
          <span className="text-muted-foreground">{label}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="tabular-nums text-foreground font-medium">{formatKg(kg)}</span>
          <span className="tabular-nums font-semibold text-[11px]" style={{ color }}>
            {pct.toFixed(1)}%
          </span>
        </div>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full border border-[var(--glass-border)] bg-[var(--glass-bg-strong)]">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${Math.min(pct, 100)}%`, backgroundColor: color }}
        />
      </div>
    </div>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────

export function CascadeView({ result }: { result: CascadeResult }) {
  const semStyles = {
    verde: {
      box:   "bg-success/10 border border-success/30",
      label: "text-success",
      badge: "bg-success/20 text-success",
      pct:   "text-success",
      icon:  Check,
      hint:  "≤ 3% · OK",
    },
    amarillo: {
      box:   "bg-warning/10 border border-warning/30",
      label: "text-warning",
      badge: "bg-warning/20 text-warning",
      pct:   "text-warning",
      icon:  AlertTriangle,
      hint:  "3–5% · Revisar",
    },
    rojo: {
      box:   "bg-destructive/10 border border-destructive/30",
      label: "text-destructive",
      badge: "bg-destructive/20 text-destructive",
      pct:   "text-destructive",
      icon:  X,
      hint:  "> 5% · Crítico",
    },
  }[result.semaforo];

  const SemIcon = semStyles.icon;

  return (
    <div className="flex flex-col gap-1">

      {/* ── Producción real ──────────────────────────────────────── */}
      <SectionLabel
        icon={Factory}
        label="Producción real"
        info="Kg del calibrador, menos la fruta que las mujeres separan a mano y reintroducen (clase L, reciclado mallas Z1/Z2): el calibrador ya la cuenta, así que si no se resta, ese kg se contaría dos veces."
      />

      <Row label="Calibrador" op="=" value={result.produccion_calibrador} variant="base" icon={BarChart2} />
      <Row label="Mujeres clase L" op="−" value={result.mujeres} variant="sub" icon={Minus} />
      <Row label="Reciclado malla Z1" op="−" value={result.reciclado_z1} variant="sub" icon={Minus} />
      <Row label="Reciclado malla Z2" op="−" value={result.reciclado_z2} variant="sub" icon={Minus} />
      <Row label="Producción real" op="=" value={result.produccion_real} variant="total" />

      <Divider />

      {/* ── Palets e inventario ──────────────────────────────────── */}
      <SectionLabel
        icon={Package}
        label="Palets e inventario"
        info="Palets dados de alta en el sistema, menos el inventario que quedó pendiente de registrar el día anterior, para no volver a contarlo."
      />

      <Row label="Palets alta (bruto)" op="=" value={result.palets_brutos} variant="base" icon={Layers} />
      <Row label="Inv. día anterior (en palets)" op="−" value={result.inventario_anterior} variant="sub" icon={Minus} />
      <Row label="Palets alta ajustados" op="=" value={result.palets_ajustados} variant="total" />

      <Divider />

      {/* ── Mermas y DJPMN ───────────────────────────────────────── */}
      <SectionLabel
        icon={TrendingDown}
        label="Mermas y DJPMN"
        info="Compara la producción real con lo dado de alta en palets (y lo pendiente de registrar) para ver cuánto no cuadra. A eso se le resta el podrido manual (mermas) y el resultado es el DJPMN: cuanto más cerca de 0, mejor."
      />

      <Row label="Producción real" op="=" value={result.produccion_real} variant="base" />
      <Row label="Palets alta ajustados" op="−" value={result.palets_ajustados} variant="sub" icon={Minus} />
      <Row label="Inventario final sin alta" op="−" value={result.inventario_final} variant="sub" icon={Minus} />
      <Row label="Diferencia bruta" op="=" value={result.diferencia_bruta} variant="total" />
      <Row label="Podrido manual (bolsa basura)" op="−" value={result.podrido_manual} variant="sub" icon={Minus} />
      <Row label="Mermas totales" op="=" value={result.mermas_totales} variant="total" />
      <Row label="% Mermas / prod." op="=" value={result.produccion_real > 0 ? (result.mermas_totales / result.produccion_real) * 100 : 0} format="pct" variant="sub" />

      {/* ── Resultado DJPMN ──────────────────────────────────────── */}
      <div className={cn("rounded-xl px-4 py-4 mt-2 flex items-center justify-between gap-4", semStyles.box)}>
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5">
            <p className={cn("text-[10px] font-semibold uppercase tracking-widest", semStyles.label)}>DJPMN</p>
            <InfoTooltip iconClassName="h-3 w-3">{DJPMN_HELP}</InfoTooltip>
          </div>
          <p className={cn("text-2xl font-semibold tabular-nums", semStyles.pct)}>{formatKg(result.dsj)}</p>
          <span className={cn("inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full", semStyles.badge)}>
            <SemIcon className="h-3 w-3" />
            {semStyles.hint}
          </span>
        </div>
        <div className="text-right space-y-0.5">
          <p className={cn("text-[10px] font-semibold uppercase tracking-widest", semStyles.label)}>% DJPMN</p>
          <p className={cn("text-3xl font-semibold tabular-nums", semStyles.pct)}>
            {result.dsj_pct >= 0 ? "+" : ""}{result.dsj_pct.toFixed(2)}%
          </p>
          <p className={cn("text-xs", semStyles.label)}>sobre prod. real</p>
        </div>
      </div>

      {/* ── T/h ──────────────────────────────────────────────────── */}
      {result.tph_promedio !== null && result.tph_promedio > 0 && (
        <>
          <Divider />
          <div className="flex items-center justify-between rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg)] px-3 py-2.5 backdrop-blur-sm">
            <div className="flex items-center gap-2 text-sm">
              <Gauge className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-muted-foreground">Eficiencia máquina</span>
            </div>
            <span className="tabular-nums font-semibold text-foreground">
              {result.tph_promedio.toFixed(2)} T/h
            </span>
          </div>
        </>
      )}
    </div>
  );
}

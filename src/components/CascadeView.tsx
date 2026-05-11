import { CascadeResult } from "@/lib/cascade";
import { formatKg, formatPct } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  Factory, Package, TrendingDown,
  BarChart2, Plus, Minus, Layers, Check, AlertTriangle, X,
  Globe, ShoppingCart, Wrench, Flame, Gauge,
} from "lucide-react";

// ─── Sub-componentes ──────────────────────────────────────────────────────────

function SectionLabel({ icon: Icon, label }: { icon: React.ElementType; label: string }) {
  return (
    <div className="flex items-center gap-1.5 pt-3 pb-1 first:pt-0">
      <Icon className="h-3.5 w-3.5 text-muted-foreground" />
      <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
        {label}
      </span>
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
}: {
  label: string;
  op: "=" | "+" | "−" | "";
  value: number;
  variant?: "base" | "sub" | "total";
  icon?: React.ElementType;
  colorClass?: string;
}) {
  const isNegative = op === "−" && value !== 0;

  return (
    <div
      className={cn(
        "grid items-center gap-2 rounded-lg px-3 py-2 text-sm",
        "grid-cols-[1fr_auto_auto]",
        variant === "base"  && "bg-muted/40",
        variant === "sub"   && "pl-6",
        variant === "total" && "bg-background border border-border/60",
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
        {formatKg(value)}
      </span>
    </div>
  );
}

function Divider() {
  return <div className="h-px bg-border/50 my-1" />;
}

// ─── Barra de destino de fruta (M3) ──────────────────────────────────────────

function DestinoBar({
  label,
  kg,
  total,
  color,
  icon: Icon,
}: {
  label: string;
  kg: number;
  total: number;
  color: string;
  icon: React.ElementType;
}) {
  const pct = total > 0 ? (kg / total) * 100 : 0;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <div className="flex items-center gap-1.5">
          <Icon className="h-3 w-3 text-muted-foreground" />
          <span className="text-muted-foreground">{label}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="tabular-nums text-foreground font-medium">{formatKg(kg)}</span>
          <span className={cn("tabular-nums font-semibold text-[11px]", color)}>
            {pct.toFixed(1)}%
          </span>
        </div>
      </div>
      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
        <div
          className={cn("h-full rounded-full transition-all", color.replace("text-", "bg-"))}
          style={{ width: `${Math.min(pct, 100)}%` }}
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
      <SectionLabel icon={Factory} label="Producción real" />

      <Row label="Calibrador" op="=" value={result.produccion_calibrador} variant="base" icon={BarChart2} />
      <Row label="Industria / Cítricos manual" op="+" value={result.industria_manual} variant="sub" icon={Plus} />
      <Row label="Mujeres clase L" op="−" value={result.mujeres} variant="sub" icon={Minus} />
      <Row label="Reciclado malla Z1" op="−" value={result.reciclado_z1} variant="sub" icon={Minus} />
      <Row label="Reciclado malla Z2" op="−" value={result.reciclado_z2} variant="sub" icon={Minus} />
      <Row label="Producción real" op="=" value={result.produccion_real} variant="total" />

      <Divider />

      {/* ── Palets e inventario ──────────────────────────────────── */}
      <SectionLabel icon={Package} label="Palets e inventario" />

      <Row label="Palets alta (bruto)" op="=" value={result.palets_brutos} variant="base" icon={Layers} />
      <Row label="Inv. día anterior (en palets)" op="−" value={result.inventario_anterior} variant="sub" icon={Minus} />
      <Row label="Palets alta ajustados" op="=" value={result.palets_ajustados} variant="total" />

      <Divider />

      {/* ── Mermas y DJPMN ───────────────────────────────────────── */}
      <SectionLabel icon={TrendingDown} label="Mermas y DJPMN" />

      <Row label="Producción real" op="=" value={result.produccion_real} variant="base" />
      <Row label="Palets alta ajustados" op="−" value={result.palets_ajustados} variant="sub" icon={Minus} />
      <Row label="Inventario final sin alta" op="−" value={result.inventario_final} variant="sub" icon={Minus} />
      <Row label="Diferencia bruta" op="=" value={result.diferencia_bruta} variant="total" />
      <Row label="Podrido calibrador" op="−" value={result.podrido_calibrador} variant="sub" icon={Minus} />
      <Row label="Podrido manual (bolsa basura)" op="−" value={result.podrido_manual} variant="sub" icon={Minus} />
      <Row label="Mermas totales" op="=" value={result.mermas_totales} variant="total" />

      {/* ── Resultado DJPMN ──────────────────────────────────────── */}
      <div className={cn("rounded-xl px-4 py-4 mt-2 flex items-center justify-between gap-4", semStyles.box)}>
        <div className="space-y-1.5">
          <p className={cn("text-[10px] font-semibold uppercase tracking-widest", semStyles.label)}>DJPMN</p>
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

      {/* ── M6: T/h ──────────────────────────────────────────────── */}
      {result.tph_promedio !== null && result.tph_promedio > 0 && (
        <>
          <Divider />
          <div className="flex items-center justify-between rounded-lg bg-muted/40 px-3 py-2.5">
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

      {/* ── M3: Destino de fruta ──────────────────────────────────── */}
      {result.tiene_datos_destino && (
        <>
          <Divider />
          <SectionLabel icon={Globe} label="Destino de fruta" />

          <div className="rounded-lg border border-border/60 bg-background px-4 py-3 space-y-3">
            <DestinoBar
              label="Exportación"
              kg={result.kg_exportacion}
              total={result.produccion_real}
              color="text-success"
              icon={Globe}
            />
            <DestinoBar
              label="Mercado nacional"
              kg={result.kg_mercado}
              total={result.produccion_real}
              color="text-info"
              icon={ShoppingCart}
            />
            <DestinoBar
              label="Industria generada"
              kg={result.kg_industria_destino}
              total={result.produccion_real}
              color="text-warning"
              icon={Wrench}
            />
            {result.kg_perdida_real > 0 && (
              <DestinoBar
                label="Pérdida real (no justificada)"
                kg={result.kg_perdida_real}
                total={result.produccion_real}
                color="text-destructive"
                icon={Flame}
              />
            )}

            {/* Rendimiento comercial KPI */}
            <div className="pt-2 border-t border-border/50 flex items-center justify-between">
              <div className="space-y-0.5">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                  Rendimiento comercial
                </p>
                <p className="text-xs text-muted-foreground">
                  kg exportación / kg producción real
                </p>
              </div>
              <div className="text-right">
                <p className={cn(
                  "text-2xl font-bold tabular-nums",
                  result.rendimiento_comercial_pct >= 70
                    ? "text-success"
                    : result.rendimiento_comercial_pct >= 50
                    ? "text-warning"
                    : "text-destructive"
                )}>
                  {result.rendimiento_comercial_pct.toFixed(1)}%
                </p>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

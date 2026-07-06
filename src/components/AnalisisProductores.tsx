import { useNavigate } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/format";
import { Sprout } from "lucide-react";
import type { ProductorResumen } from "@/hooks/useAnalisisDiario";

const nf = new Intl.NumberFormat("es-ES", { maximumFractionDigits: 0 });

function formatKgT(v: number): string {
  if (v >= 1000) return (v / 1000).toFixed(1) + " t";
  return nf.format(v) + " kg";
}

function tphClass(tph: number | null) {
  if (tph === null) return "text-muted-foreground";
  return tph >= 14.5 ? "text-success" : tph >= 12.5 ? "text-warning" : "text-destructive";
}

interface AnalisisProductoresProps {
  productores: ProductorResumen[];
  days: string[];
  kgTotal: number;
}

export function AnalisisProductores({ productores, days, kgTotal }: AnalisisProductoresProps) {
  const navigate = useNavigate();

  if (productores.length === 0) {
    return (
      <Card className="glass-accented">
        <CardContent className="py-12 text-center">
          <Sprout className="mx-auto mb-3 h-10 w-10 text-muted-foreground/30" />
          <p className="text-sm font-medium">Sin productores en este periodo</p>
          <p className="mt-1 text-xs text-muted-foreground">Los productores salen de los lotes del Informe de producción.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-3 lg:grid-cols-2">
        {productores.map((p) => {
          const diasTrabajados = days.filter((d) => (p.por_dia[d] ?? 0) > 0);
          const pct = kgTotal > 0 ? (p.kg_total / kgTotal) * 100 : 0;
          return (
            <button
              key={p.productor}
              type="button"
              onClick={() => navigate(`/productores?productor=${encodeURIComponent(p.productor)}`)}
              className="rounded-2xl border border-[var(--glass-border)] bg-[var(--glass-bg)] p-4 text-left transition-all hover:-translate-y-0.5 hover:bg-[var(--glass-bg-strong)]"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{p.productor}</p>
                  <p className="mt-0.5 text-[11.5px] text-muted-foreground">
                    {p.n_lotes} lote{p.n_lotes === 1 ? "" : "s"}
                    {p.productos.length > 0 && ` · ${p.productos.join(", ")}`}
                    {p.ultimo_dia && ` · último: ${formatDate(p.ultimo_dia)}`}
                  </p>
                </div>
                <span className="shrink-0 text-sm font-bold tabular-nums text-primary">{pct.toFixed(1)}%</span>
              </div>

              <div className="mt-3 grid grid-cols-4 gap-2">
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Kg</p>
                  <p className="mt-0.5 text-base font-semibold tabular-nums">{formatKgT(p.kg_total)}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">T/h media</p>
                  <p className={cn("mt-0.5 text-base font-semibold tabular-nums", tphClass(p.tph_promedio))}>
                    {p.tph_promedio !== null ? p.tph_promedio.toFixed(1) : "—"}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Peso fruta</p>
                  <p className="mt-0.5 text-base font-semibold tabular-nums">
                    {p.peso_fruta_promedio_g !== null ? `${p.peso_fruta_promedio_g.toFixed(0)} g` : "—"}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Industria</p>
                  <p className="mt-0.5 text-base font-semibold tabular-nums">
                    {p.kg_industria > 0 ? formatKgT(p.kg_industria) : "—"}
                  </p>
                </div>
              </div>

              {days.length > 1 && (
                <div className="mt-3 border-t border-[var(--glass-border)] pt-3">
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    Días trabajados <span className="tabular-nums">({diasTrabajados.length}/{days.length})</span>
                  </p>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {days.map((d) => {
                      const kg = p.por_dia[d] ?? 0;
                      const trabajado = kg > 0;
                      return (
                        <span
                          key={d}
                          title={`${formatDate(d)}${trabajado ? ` · ${formatKgT(kg)}` : " · no trabajó"}`}
                          className={cn(
                            "flex h-6 w-6 items-center justify-center rounded-md text-[10px] font-semibold tabular-nums",
                            trabajado
                              ? "bg-primary text-primary-foreground"
                              : "bg-[var(--glass-bg-strong)] text-muted-foreground/40"
                          )}
                        >
                          {Number(d.slice(8, 10))}
                        </span>
                      );
                    })}
                  </div>
                </div>
              )}
            </button>
          );
        })}
      </div>
      <p className="rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg)] px-3 py-2 text-xs text-muted-foreground">
        Clic en un productor para abrir su dossier completo.
      </p>
    </div>
  );
}

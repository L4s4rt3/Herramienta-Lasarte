// src/components/mercadona/MercadonaLotes.tsx
// Pestaña "Lotes y productores" de Mercadona: qué fruta y qué productores
// rinden de verdad para el cliente — ranking histórico de aprovechamiento
// MDNA, lotes de la semana activa y calidad orientativa de esos días.
import { useMemo, useState } from "react";
import { AlertTriangle, ClipboardList, Package, ScrollText, TrendingUp, Trophy } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { InfoTooltip } from "@/components/InfoTooltip";
import { useMercadona } from "@/hooks/useMercadona";
import { useMercadonaLotes, type MercadonaLoteSemana } from "@/hooks/useMercadonaLotes";
import type { MercadonaSemanaConMetodos } from "@/hooks/useMercadonaVentas";
import { mercadonaWeekDateRange } from "@/lib/mercadonaVentas";
import { formatDate, formatKg, formatNumber, formatPct } from "@/lib/format";
import { tphColor } from "@/lib/chartTheme";
import { cn } from "@/lib/utils";

type SortKey = "kg" | "tph" | "pctMdnaDia" | "pesoFrutaG";

const SORT_LABEL: Record<SortKey, string> = {
  kg: "Kg",
  tph: "T/h",
  pctMdnaDia: "% MDNA día",
  pesoFrutaG: "Peso fruta",
};

export function MercadonaLotes({ activeSemana }: { activeSemana: MercadonaSemanaConMetodos | null }) {
  const rango = activeSemana ? mercadonaWeekDateRange(activeSemana.anio, activeSemana.semana) : null;
  const mercadona = useMercadona(rango?.desde ?? "1970-01-01", rango?.hasta ?? "1970-01-01");
  const {
    lotesSemana, isLoadingLotesSemana,
    productoresHistorico, isLoadingProductoresHistorico,
    calidadSemana, isLoadingCalidadSemana,
  } = useMercadonaLotes(activeSemana);

  if (!activeSemana) {
    return (
      <Card className="glass-accented">
        <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
          <Package className="h-10 w-10 text-muted-foreground/50" />
          <div>
            <h2 className="text-lg font-semibold">Sin semana seleccionada</h2>
            <p className="mt-1 max-w-md text-sm text-muted-foreground">
              Selecciona o importa una semana para ver sus lotes y productores.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <ResumenCompacto mercadona={mercadona} />
      <RankingHistoricoProductores productores={productoresHistorico} isLoading={isLoadingProductoresHistorico} />
      <LotesSemanaTabla lotes={lotesSemana} isLoading={isLoadingLotesSemana} />
      <CalidadSemana controles={calidadSemana} isLoading={isLoadingCalidadSemana} />
    </div>
  );
}

// ─── Resumen compacto (top formatos + mejor día, igual que la pestaña anterior) ──

function ResumenCompacto({ mercadona }: { mercadona: ReturnType<typeof useMercadona> }) {
  const mejorDia = [...mercadona.por_dia].sort((a, b) => b.pct - a.pct)[0] ?? null;
  const topFormatos = mercadona.por_formato.slice(0, 5);

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Card className="glass-accented overflow-hidden">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Package className="h-4 w-4 text-primary" /> Top formatos MDNA
          </CardTitle>
        </CardHeader>
        <CardContent>
          {mercadona.isLoading ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Cargando…</p>
          ) : topFormatos.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Sin datos de formato esta semana.</p>
          ) : (
            <ol className="space-y-2">
              {topFormatos.map((f, i) => (
                <li key={f.formato} className="flex items-center justify-between rounded-lg border border-[var(--glass-border)] bg-[var(--glass-bg)] px-3 py-2 text-xs">
                  <span className="flex items-center gap-2">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary">{i + 1}</span>
                    {f.formato}
                  </span>
                  <span className="tabular-nums font-medium">{formatKg(f.kg)}</span>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>

      <Card className="glass-accented overflow-hidden">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <TrendingUp className="h-4 w-4 text-success" /> Mejor día de aprovechamiento
          </CardTitle>
        </CardHeader>
        <CardContent>
          {mercadona.isLoading ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Cargando…</p>
          ) : !mejorDia ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Sin días con producción esta semana.</p>
          ) : (
            <div className="space-y-3">
              <div className="rounded-lg border border-success/30 bg-success/10 p-3 text-center">
                <p className="text-xs text-muted-foreground">{mejorDia.date}</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums text-success">{formatPct(mejorDia.pct)}</p>
                <p className="text-xs text-muted-foreground">{formatKg(mejorDia.kg_mercadona)} de {formatKg(mejorDia.kg_total)}</p>
              </div>
              <ul className="space-y-1.5">
                {[...mercadona.por_dia].sort((a, b) => b.pct - a.pct).slice(1, 4).map((d) => (
                  <li key={d.date} className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{d.date}</span>
                    <span className="tabular-nums">{formatPct(d.pct)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── 1. Ranking histórico de productores ─────────────────────────────────────

function RankingHistoricoProductores({
  productores, isLoading,
}: {
  productores: Array<{ productor: string; kg: number; nLotes: number; pctMdnaEstimado: number }>;
  isLoading: boolean;
}) {
  const top = productores.slice(0, 10);
  const maxPct = Math.max(1, ...top.map((p) => p.pctMdnaEstimado));

  return (
    <Card className="glass-accented overflow-hidden">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Trophy className="h-4 w-4 text-warning" /> Ranking histórico de productores para Mercadona
          <InfoTooltip>
            Aprovechamiento estimado por reparto diario: no existe trazabilidad lote → formato exacta, así que a
            cada lote se le asigna el % de kg MDNA que tuvo su día de producción (kg de productos MDNA / kg
            totales del día) y se pondera por los kg del lote. Solo aparecen productores con 3 lotes o más.
          </InfoTooltip>
        </CardTitle>
        <p className="text-xs text-muted-foreground">Toda la campaña · % MDNA estimado por reparto diario.</p>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Cargando…</p>
        ) : top.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Todavía no hay productores con al menos 3 lotes registrados.
          </p>
        ) : (
          <ol className="space-y-2.5">
            {top.map((p, i) => (
              <li key={p.productor} className="rounded-lg border border-[var(--glass-border)] bg-[var(--glass-bg)] px-3 py-2.5">
                <div className="flex items-center justify-between gap-3 text-xs">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-warning/10 text-[10px] font-semibold text-warning">{i + 1}</span>
                    <span className="truncate font-medium">{p.productor}</span>
                  </span>
                  <span className="shrink-0 tabular-nums font-semibold text-primary">{formatPct(p.pctMdnaEstimado)}</span>
                </div>
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[var(--glass-bg-strong)]">
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{ width: `${Math.min(100, (p.pctMdnaEstimado / maxPct) * 100)}%` }}
                  />
                </div>
                <div className="mt-1.5 flex items-center justify-between text-[11px] text-muted-foreground">
                  <span>{formatKg(p.kg)}</span>
                  <span>{p.nLotes} lote{p.nLotes === 1 ? "" : "s"}</span>
                </div>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

// ─── 2. Lotes de la semana activa ────────────────────────────────────────────

function LotesSemanaTabla({ lotes, isLoading }: { lotes: MercadonaLoteSemana[]; isLoading: boolean }) {
  const [sortKey, setSortKey] = useState<SortKey>("kg");

  const ordenados = useMemo(() => {
    const copia = [...lotes];
    copia.sort((a, b) => (b[sortKey] ?? -Infinity) - (a[sortKey] ?? -Infinity));
    return copia;
  }, [lotes, sortKey]);

  return (
    <Card className="glass-accented overflow-hidden">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <ScrollText className="h-4 w-4 text-primary" /> Lotes de la semana activa
          </CardTitle>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] text-muted-foreground">Ordenar por</span>
            {(Object.keys(SORT_LABEL) as SortKey[]).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setSortKey(key)}
                className={cn(
                  "rounded-md border px-2 py-0.5 text-[11px] font-medium transition-colors",
                  sortKey === key
                    ? "border-primary/40 bg-primary/10 text-primary"
                    : "border-[var(--glass-border)] bg-[var(--glass-bg)] text-muted-foreground hover:text-foreground",
                )}
              >
                {SORT_LABEL[key]}
              </button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <p className="py-10 text-center text-sm text-muted-foreground">Cargando…</p>
        ) : ordenados.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">Sin lotes registrados esta semana.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Lote</TableHead>
                  <TableHead>Productor</TableHead>
                  <TableHead>Producto</TableHead>
                  <TableHead className="text-right">Kg</TableHead>
                  <TableHead className="text-right">T/h</TableHead>
                  <TableHead className="text-right">
                    <span className="inline-flex items-center gap-1">
                      Peso fruta
                      <InfoTooltip>Peso medio de fruta por unidad, en gramos.</InfoTooltip>
                    </span>
                  </TableHead>
                  <TableHead className="text-right">
                    <span className="inline-flex items-center gap-1">
                      % MDNA día
                      <InfoTooltip>
                        % de kg MDNA sobre el total confeccionado ese día (producto_dia). No indica que este lote en
                        concreto fuera a Mercadona: es el aprovechamiento del día en el que se procesó.
                      </InfoTooltip>
                    </span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ordenados.map((l) => {
                  const color = l.tph != null ? tphColor(l.tph) : undefined;
                  return (
                    <TableRow key={l.key}>
                      <TableCell className="text-xs font-medium">{l.loteCodigo}</TableCell>
                      <TableCell className="max-w-[180px] truncate text-xs">{l.productor}</TableCell>
                      <TableCell className="max-w-[200px] truncate text-xs text-muted-foreground">{l.producto}</TableCell>
                      <TableCell className="text-right tabular-nums text-xs font-semibold">{formatKg(l.kg)}</TableCell>
                      <TableCell className="text-right tabular-nums text-xs font-semibold" style={color ? { color } : undefined}>
                        {l.tph != null ? formatNumber(l.tph, 1) : "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-xs text-muted-foreground">
                        {l.pesoFrutaG != null ? `${formatNumber(l.pesoFrutaG, 0)} g` : "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-xs">
                        {l.pctMdnaDia != null ? formatPct(l.pctMdnaDia) : "—"}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── 3. Calidad de la semana (orientativo) ───────────────────────────────────

const CALIDAD_BADGE_CLASS: Record<string, string> = {
  Excelente: "border-success/40 bg-success/10 text-success",
  Bueno: "border-success/40 bg-success/10 text-success",
  Regular: "border-warning/40 bg-warning/10 text-warning",
  Deficiente: "border-destructive/40 bg-destructive/10 text-destructive",
  Pésimo: "border-destructive/40 bg-destructive/10 text-destructive",
};

function CalidadSemana({
  controles, isLoading,
}: {
  controles: Array<{ id: string; fecha: string; numeroLote: string; productor: string; producto: string; variedad: string; calidad: string; defectos: string[]; observacion: string }>;
  isLoading: boolean;
}) {
  return (
    <Card className="glass-accented overflow-hidden">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <ClipboardList className="h-4 w-4 text-primary" /> Calidad de la semana
          </CardTitle>
          <Badge variant="outline" className="gap-1.5 border-warning/40 bg-warning/10 text-[11px] text-warning">
            <AlertTriangle className="h-3 w-3" /> Orientativo: los controles de calidad no marcan cliente; cruce por fecha
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Cargando…</p>
        ) : controles.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Sin controles de calidad registrados en los días de esta semana.
          </p>
        ) : (
          <ul className="space-y-2">
            {controles.map((c) => (
              <li key={c.id} className="rounded-lg border border-[var(--glass-border)] bg-[var(--glass-bg)] px-3 py-2.5 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="font-medium">{c.productor}</span>
                    <span className="text-muted-foreground">· {c.producto}{c.variedad ? ` (${c.variedad})` : ""}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <span className="text-[11px] text-muted-foreground">{formatDate(c.fecha)}</span>
                    <Badge variant="outline" className={cn("text-[11px]", CALIDAD_BADGE_CLASS[c.calidad] ?? "border-[var(--glass-border)] bg-[var(--glass-bg)] text-muted-foreground")}>
                      {c.calidad}
                    </Badge>
                  </span>
                </div>
                {(c.defectos.length > 0 || c.observacion) && (
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                    {c.defectos.map((d) => (
                      <span key={d} className="rounded-md border border-[var(--glass-border)] bg-[var(--glass-bg-strong)] px-1.5 py-0.5">{d}</span>
                    ))}
                    {c.observacion && <span className="truncate">{c.observacion}</span>}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

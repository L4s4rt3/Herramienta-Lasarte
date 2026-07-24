import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ArrowRight, ChevronDown, StickyNote } from "lucide-react";
import { cn } from "@/lib/utils";
import { getTphBadge } from "@/lib/analisisDiarioView";
import { GRUPO_COLORS, detectarTipoClasificacion } from "@/lib/destinoClasificacion";
import type { LoteResumen } from "@/hooks/useAnalisisDiario";
import { formatKgCompact as formatKg } from "@/lib/format";

const nf = new Intl.NumberFormat("es-ES", { maximumFractionDigits: 0 });

function formatFechaLarga(iso: string): string {
  if (!iso || iso === "—") return "—";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

const TPH_BADGE_CLASSES: Record<string, string> = {
  success: "border-success/40 bg-success/10 text-success",
  warning: "border-warning/40 bg-warning/10 text-warning",
  destructive: "border-destructive/40 bg-destructive/10 text-destructive",
};

const MAX_CLASES_VISIBLES = 4;

interface MetricProps {
  label: string;
  value: React.ReactNode;
}

function Metric({ label, value }: MetricProps) {
  return (
    <div className="rounded-lg border border-[var(--glass-border)] bg-[var(--glass-bg)] px-2.5 py-2">
      <p className="panel-kicker">{label}</p>
      <div className="mt-1 text-[17px] font-semibold tabular-nums leading-tight">{value}</div>
    </div>
  );
}

function SectionKicker({ children }: { children: React.ReactNode }) {
  return <p className="panel-kicker mb-2">{children}</p>;
}

interface TamanoAgg {
  tamano: string;
  peso_kg: number;
  piezas: number | null;
  cartons: number | null;
}

interface ClaseGrupo {
  clase: string;
  grupo: string;
  kg: number;
  filas: TamanoAgg[];
}

function TamanosTable({ filas, kgLote }: { filas: TamanoAgg[]; kgLote: number }) {
  return (
    <table className="w-full text-[12px]">
      <thead>
        <tr className="text-left text-muted-foreground">
          <th className="py-1 pl-3 font-medium">Tamaño</th>
          <th className="py-1 text-right font-medium">Kg</th>
          <th className="py-1 text-right font-medium">%</th>
          <th className="py-1 text-right font-medium">Piezas</th>
          <th className="py-1 pr-3 text-right font-medium">Cajas</th>
        </tr>
      </thead>
      <tbody>
        {filas.map((r, i) => (
          <tr key={`${r.tamano}-${i}`} className="border-t border-[var(--glass-border)]">
            <td className="py-1 pl-3 tabular-nums">{r.tamano}</td>
            <td className="py-1 text-right tabular-nums font-medium">{formatKg(r.peso_kg)}</td>
            <td className="py-1 text-right tabular-nums text-muted-foreground">
              {kgLote > 0 ? `${((r.peso_kg / kgLote) * 100).toFixed(1)}%` : "—"}
            </td>
            <td className="py-1 text-right tabular-nums text-muted-foreground">
              {r.piezas != null ? nf.format(Math.round(r.piezas)) : "—"}
            </td>
            <td className="py-1 pr-3 text-right tabular-nums text-muted-foreground">
              {r.cartons != null ? nf.format(Math.round(r.cartons)) : "—"}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ClaseBloque({ clase, grupo, kg, filas, pctLote, kgLote }: ClaseGrupo & { pctLote: number | null; kgLote: number }) {
  return (
    <div className="overflow-hidden rounded-lg border border-[var(--glass-border)]">
      <div className="flex items-center justify-between gap-2 bg-[var(--glass-bg)] px-3 py-1.5">
        <span className="inline-flex items-center gap-1.5 text-[13px] font-medium">
          <span
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ backgroundColor: GRUPO_COLORS[grupo] ?? GRUPO_COLORS.Otro }}
          />
          {clase}
        </span>
        <span className="flex items-center gap-2 text-[12px] tabular-nums text-muted-foreground">
          <span className="font-semibold text-foreground">{formatKg(kg)}</span>
          {pctLote != null && <span>{pctLote.toFixed(0)}%</span>}
        </span>
      </div>
      <TamanosTable filas={filas} kgLote={kgLote} />
    </div>
  );
}

function OtrasClasesCollapsible({ grupos, pctOf, kgLote }: { grupos: ClaseGrupo[]; pctOf: (kg: number) => number | null; kgLote: number }) {
  const [open, setOpen] = useState(false);
  const kgTotal = grupos.reduce((s, g) => s + g.kg, 0);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="overflow-hidden rounded-lg border border-[var(--glass-border)]">
        <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 bg-[var(--glass-bg)] px-3 py-1.5 text-left transition-colors hover:bg-[var(--glass-bg-strong)]">
          <span className="flex items-center gap-1.5 text-[13px] font-medium text-muted-foreground">
            <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 transition-transform duration-200", open && "rotate-180")} />
            Otras clases ({grupos.length})
          </span>
          <span className="text-[12px] tabular-nums font-semibold text-foreground">{formatKg(kgTotal)}</span>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="divide-y divide-[var(--glass-border)] border-t border-[var(--glass-border)]">
            {grupos.map((g) => (
              <ClaseBloque key={g.clase} {...g} pctLote={pctOf(g.kg)} kgLote={kgLote} />
            ))}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

interface LoteDetailSheetProps {
  lote: LoteResumen | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function LoteDetailSheet({ lote, open, onOpenChange }: LoteDetailSheetProps) {
  const detalle = lote?.detalle ?? [];

  const clasesAgrupadas = useMemo<ClaseGrupo[]>(() => {
    // El informe puede traer varias filas para la misma combinación clase+tamaño
    // (p. ej. distintas calidades): se agregan para mostrar una fila por tamaño.
    const map = new Map<string, { clase: string; grupo: string; kg: number; tamanos: Map<string, TamanoAgg> }>();
    for (const r of detalle) {
      const key = r.clase;
      const grupo = detectarTipoClasificacion(r.grupo_destino);
      const entry = map.get(key) ?? { clase: key, grupo, kg: 0, tamanos: new Map<string, TamanoAgg>() };
      entry.kg += r.peso_kg;
      const tKey = r.tamano ?? "—";
      const t = entry.tamanos.get(tKey) ?? { tamano: tKey, peso_kg: 0, piezas: null, cartons: null };
      t.peso_kg += r.peso_kg;
      if (r.piezas != null) t.piezas = (t.piezas ?? 0) + r.piezas;
      if (r.cartons != null) t.cartons = (t.cartons ?? 0) + r.cartons;
      entry.tamanos.set(tKey, t);
      map.set(key, entry);
    }
    return Array.from(map.values())
      .map(({ clase, grupo, kg, tamanos }) => ({
        clase,
        grupo,
        kg,
        filas: Array.from(tamanos.values()).sort((a, b) => b.peso_kg - a.peso_kg),
      }))
      .sort((a, b) => b.kg - a.kg);
  }, [detalle]);

  const totales = useMemo(() => {
    return detalle.reduce(
      (acc, r) => ({
        kg: acc.kg + r.peso_kg,
        piezas: acc.piezas + (r.piezas ?? 0),
        cartons: acc.cartons + (r.cartons ?? 0),
      }),
      { kg: 0, piezas: 0, cartons: 0 }
    );
  }, [detalle]);

  const gruposDistribucion = useMemo(() => {
    if (!lote?.clasificacion) return [];
    return Object.entries(lote.clasificacion.por_grupo).sort((a, b) => b[1] - a[1]);
  }, [lote]);

  if (!lote) return null;

  const badge = getTphBadge(lote.toneladas_hora);
  const tieneDetalle = clasesAgrupadas.length > 0;
  const kgClasificado = lote.clasificacion?.kg_clasificado ?? 0;
  const pctOf = (kg: number) => (totales.kg > 0 ? (kg / totales.kg) * 100 : null);
  // "—" es el marcador de "sin dato" que usa useAnalisisDiario cuando el campo viene null de origen.
  const loteCodigoValido = Boolean(lote.lote_codigo) && lote.lote_codigo !== "—";
  const productorValido = Boolean(lote.productor) && lote.productor !== "—";

  const clasesPrincipales = clasesAgrupadas.slice(0, MAX_CLASES_VISIBLES);
  const clasesMinoritarias = clasesAgrupadas.length > MAX_CLASES_VISIBLES
    ? clasesAgrupadas.slice(MAX_CLASES_VISIBLES)
    : [];

  const metricas: MetricProps[] = [
    { label: "Kg totales", value: formatKg(lote.kg_peso_total) },
    {
      label: "T/h",
      value: lote.toneladas_hora !== null ? (
        <Badge variant="outline" className={cn("text-sm tabular-nums", badge && TPH_BADGE_CLASSES[badge])}>
          {lote.toneladas_hora.toFixed(1)}
        </Badge>
      ) : null,
    },
    { label: "Duración", value: lote.duracion_min != null ? `${(lote.duracion_min / 60).toFixed(1)} h` : null },
    { label: "Hora inicio", value: lote.hora_inicio ?? null },
    { label: "Peso fruta", value: lote.peso_fruta_promedio_g != null ? `${lote.peso_fruta_promedio_g.toFixed(0)} g` : null },
    { label: "Kg industria", value: (lote.kg_industria ?? 0) > 0 ? formatKg(lote.kg_industria ?? 0) : null },
  ].filter((m) => m.value != null);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <div className="flex flex-wrap items-center gap-2">
            <SheetTitle className="font-mono text-xl">{lote.lote_codigo}</SheetTitle>
            {lote.calidad && (
              <Badge variant="outline" className="border-primary/40 bg-primary/10 text-primary">
                {lote.calidad}
              </Badge>
            )}
            {lote.toneladas_hora !== null && (
              <Badge variant="outline" className={cn("tabular-nums", badge && TPH_BADGE_CLASSES[badge])}>
                {lote.toneladas_hora.toFixed(1)} T/h
              </Badge>
            )}
          </div>
          <SheetDescription>
            {productorValido ? (
              <Link
                to={`/productores?productor=${encodeURIComponent(lote.productor)}`}
                className="hover:text-primary hover:underline"
                onClick={() => onOpenChange(false)}
              >
                {lote.productor}
              </Link>
            ) : lote.productor} · {lote.producto} · {formatFechaLarga(lote.fecha)}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-5 flex-1 space-y-5">
          {/* Métricas */}
          {metricas.length > 0 && (
            <div>
              <SectionKicker>Métricas</SectionKicker>
              <div className="grid grid-cols-3 gap-2">
                {metricas.map((m) => (
                  <Metric key={m.label} {...m} />
                ))}
              </div>
            </div>
          )}

          {/* Destino */}
          {gruposDistribucion.length > 0 && (
            <>
              <Separator />
              <div>
                <SectionKicker>Destino</SectionKicker>
                <div className="flex h-5 w-full overflow-hidden rounded-md border border-[var(--glass-border)]">
                  {gruposDistribucion.map(([grupo, kg]) => {
                    const pct = kgClasificado > 0 ? (kg / kgClasificado) * 100 : 0;
                    if (pct <= 0) return null;
                    return (
                      <div
                        key={grupo}
                        style={{ width: `${pct}%`, backgroundColor: GRUPO_COLORS[grupo] ?? GRUPO_COLORS.Otro }}
                        title={`${grupo}: ${formatKg(kg)} (${pct.toFixed(0)}%)`}
                      />
                    );
                  })}
                </div>
                <ul className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1">
                  {gruposDistribucion.map(([grupo, kg]) => {
                    const pct = kgClasificado > 0 ? (kg / kgClasificado) * 100 : 0;
                    return (
                      <li key={grupo} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <span
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{ backgroundColor: GRUPO_COLORS[grupo] ?? GRUPO_COLORS.Otro }}
                        />
                        <span className="truncate">{grupo}</span>
                        <span className="ml-auto shrink-0 font-semibold tabular-nums text-foreground">
                          {formatKg(kg)} · {pct.toFixed(0)}%
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </>
          )}

          {/* Clasificación */}
          <Separator />
          <div>
            <SectionKicker>Clasificación</SectionKicker>
            {tieneDetalle ? (
              <div className="space-y-2">
                {clasesPrincipales.map((g) => (
                  <ClaseBloque key={g.clase} {...g} pctLote={pctOf(g.kg)} kgLote={totales.kg} />
                ))}
                {clasesMinoritarias.length > 0 && (
                  <OtrasClasesCollapsible grupos={clasesMinoritarias} pctOf={pctOf} kgLote={totales.kg} />
                )}
                <div className="flex items-center justify-between rounded-lg border border-[var(--glass-border-accent)] bg-[var(--glass-bg-strong)] px-3 py-2 text-[13px] font-semibold">
                  <span>Total</span>
                  <span className="flex items-center gap-3 tabular-nums">
                    <span>{formatKg(totales.kg)}</span>
                    {totales.piezas > 0 && <span className="font-normal text-muted-foreground">{nf.format(Math.round(totales.piezas))} pzs</span>}
                    {totales.cartons > 0 && <span className="font-normal text-muted-foreground">{nf.format(Math.round(totales.cartons))} cajas</span>}
                  </span>
                </div>
              </div>
            ) : (
              <p className="rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg)] px-3 py-4 text-center text-xs text-muted-foreground">
                Este lote no tiene "Informe LOTE" cargado, así que no hay desglose clase × tamaño disponible.
              </p>
            )}
          </div>

          {/* Notas */}
          {lote.notas && (
            <>
              <Separator />
              <div>
                <SectionKicker>
                  <span className="inline-flex items-center gap-1.5">
                    <StickyNote className="h-3 w-3" /> Notas
                  </span>
                </SectionKicker>
                <p className="rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg)] px-3 py-2.5 text-sm text-foreground">
                  {lote.notas}
                </p>
              </div>
            </>
          )}
        </div>

        {/* Pie fijo */}
        {(loteCodigoValido || lote.part_id) && (
          <SheetFooter className="mt-5 gap-2 border-t border-[var(--glass-border)] pt-4">
            {loteCodigoValido && (
              <Button asChild variant="outline" className="glass glass-hover" onClick={() => onOpenChange(false)}>
                <Link to={`/trazabilidad?lote=${encodeURIComponent(lote.lote_codigo)}`}>
                  Ver trazabilidad <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
            )}
            {lote.part_id && (
              <Button asChild variant="outline" className="glass glass-hover" onClick={() => onOpenChange(false)}>
                <Link to={`/partes/${lote.part_id}`}>
                  Ver parte del día <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
            )}
          </SheetFooter>
        )}
      </SheetContent>
    </Sheet>
  );
}

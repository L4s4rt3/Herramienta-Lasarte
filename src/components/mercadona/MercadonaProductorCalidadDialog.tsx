// src/components/mercadona/MercadonaProductorCalidadDialog.tsx
// Ventana de contraste calidad ↔ aprovechamiento para un productor de Mercadona.
// Se abre al pulsar un productor en el ranking de aprovechamiento y resume, día a
// día, las calidades de sus controles y el % de aprovechamiento MDNA de ese día,
// para poder cruzar "qué calidad entró" con "cuánto se aprovechó para Mercadona".
import { useMemo, useState } from "react";
import { AlertTriangle, ClipboardList, FileSearch, Percent } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CalidadInformeDialog, type CalidadInformeLote } from "@/components/CalidadInformeDialog";
import { InfoTooltip } from "@/components/InfoTooltip";
import { normalizeNombre } from "@/hooks/useProductores";
import type { CalidadControlProductor, CalidadPorProductor } from "@/hooks/useCalidadProductores";
import { CALIDAD_OPTIONS, type CalidadEstado } from "@/lib/calidad";
import { formatDate, formatPct } from "@/lib/format";
import { cn } from "@/lib/utils";

const CALIDAD_BADGE_CLASS: Record<string, string> = {
  Excelente: "border-success/40 bg-success/10 text-success",
  Bueno: "border-success/40 bg-success/10 text-success",
  Regular: "border-warning/40 bg-warning/10 text-warning",
  Deficiente: "border-destructive/40 bg-destructive/10 text-destructive",
  Pésimo: "border-destructive/40 bg-destructive/10 text-destructive",
};

const badgeClass = (calidad: string) =>
  CALIDAD_BADGE_CLASS[calidad] ?? "border-[var(--glass-border)] bg-[var(--glass-bg)] text-muted-foreground";

interface DiaResumen {
  fecha: string;
  pctMdna: number | null;
  controles: CalidadControlProductor[];
}

export function MercadonaProductorCalidadDialog({
  productor,
  open,
  onOpenChange,
  porProductor,
  pctPorDia,
}: {
  productor: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  porProductor: CalidadPorProductor;
  pctPorDia: Map<string, number>;
}) {
  const [informeSeleccionado, setInformeSeleccionado] = useState<CalidadInformeLote | null>(null);
  const [informeAbierto, setInformeAbierto] = useState(false);

  const controles = useMemo(
    () => (productor ? porProductor.get(normalizeNombre(productor)) ?? [] : []),
    [productor, porProductor],
  );

  // Agrupa por día (desc) y adjunta el % MDNA estimado de ese día.
  const dias = useMemo<DiaResumen[]>(() => {
    const porDia = new Map<string, CalidadControlProductor[]>();
    for (const c of controles) {
      const list = porDia.get(c.fecha) ?? [];
      list.push(c);
      porDia.set(c.fecha, list);
    }
    return Array.from(porDia.entries())
      .map(([fecha, cs]) => ({
        fecha,
        pctMdna: pctPorDia.has(fecha) ? (pctPorDia.get(fecha) ?? null) : null,
        controles: cs.slice().sort((a, b) => a.numeroLote.localeCompare(b.numeroLote)),
      }))
      .sort((a, b) => b.fecha.localeCompare(a.fecha));
  }, [controles, pctPorDia]);

  // Distribución de calidad + aprovechamiento medio de los días con control.
  const resumen = useMemo(() => {
    const byQuality = Object.fromEntries(CALIDAD_OPTIONS.map((q) => [q, 0])) as Record<CalidadEstado, number>;
    for (const c of controles) {
      if (c.calidad in byQuality) byQuality[c.calidad as CalidadEstado] += 1;
    }
    const pcts = dias.map((d) => d.pctMdna).filter((v): v is number => v != null);
    const pctMedio = pcts.length > 0 ? pcts.reduce((a, b) => a + b, 0) / pcts.length : null;
    return { byQuality, pctMedio, totalInformes: controles.length, totalDias: dias.length };
  }, [controles, dias]);

  const abrirInforme = (informe: CalidadInformeLote) => {
    setInformeSeleccionado(informe);
    setInformeAbierto(true);
  };

  return (
    <>
      <Dialog open={open && !!productor} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ClipboardList className="h-4 w-4 text-primary" />
              Calidad · {productor}
              <InfoTooltip>
                Resumen de todos los controles de calidad de este productor cruzados con el aprovechamiento
                Mercadona (MDNA) estimado de cada día. El % de aprovechamiento es el del día completo (kg MDNA /
                kg totales, excluye precalibrado), no el de un lote concreto: no existe trazabilidad lote → formato
                exacta. Sirve para contrastar la calidad entrante con lo aprovechado para Mercadona.
              </InfoTooltip>
            </DialogTitle>
          </DialogHeader>

          {controles.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <FileSearch className="h-9 w-9 text-muted-foreground/50" />
              <p className="max-w-sm text-sm text-muted-foreground">
                No hay controles de calidad registrados para <span className="font-medium">{productor}</span>. El
                cruce se hace por nombre de finca; puede que sus informes estén con otro nombre.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Resumen */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="rounded-lg border border-[var(--glass-border)] bg-[var(--glass-bg)] p-3">
                  <p className="text-[11px] text-muted-foreground">Informes</p>
                  <p className="text-xl font-semibold tabular-nums">{resumen.totalInformes}</p>
                  <p className="text-[11px] text-muted-foreground">{resumen.totalDias} día{resumen.totalDias === 1 ? "" : "s"}</p>
                </div>
                <div className="rounded-lg border border-primary/30 bg-primary/5 p-3">
                  <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
                    <Percent className="h-3 w-3" /> Aprovech. medio
                  </p>
                  <p className="text-xl font-semibold tabular-nums text-primary">
                    {resumen.pctMedio != null ? formatPct(resumen.pctMedio) : "—"}
                  </p>
                  <p className="text-[11px] text-muted-foreground">MDNA de sus días</p>
                </div>
                <div className="col-span-2 rounded-lg border border-[var(--glass-border)] bg-[var(--glass-bg)] p-3">
                  <p className="mb-1.5 text-[11px] text-muted-foreground">Distribución de calidad</p>
                  <div className="flex flex-wrap gap-1.5">
                    {CALIDAD_OPTIONS.filter((q) => resumen.byQuality[q] > 0).map((q) => (
                      <Badge key={q} variant="outline" className={cn("text-[11px]", badgeClass(q))}>
                        {q}: {resumen.byQuality[q]}
                      </Badge>
                    ))}
                  </div>
                </div>
              </div>

              {/* Por día: calidad vs aprovechamiento */}
              <div className="space-y-2">
                {dias.map((d) => (
                  <div key={d.fecha} className="rounded-lg border border-[var(--glass-border)] bg-[var(--glass-bg)] p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm font-semibold">{formatDate(d.fecha)}</span>
                      <span className="flex items-center gap-1.5 text-xs">
                        <Percent className="h-3 w-3 text-primary" />
                        <span className="text-muted-foreground">Aprovech. MDNA del día:</span>
                        <span className="tabular-nums font-semibold text-primary">
                          {d.pctMdna != null ? formatPct(d.pctMdna) : "sin dato"}
                        </span>
                      </span>
                    </div>
                    <ul className="mt-2 space-y-1.5">
                      {d.controles.map((c) => (
                        <li
                          key={c.id}
                          role="button"
                          tabIndex={0}
                          onClick={() => abrirInforme(c.informe)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              abrirInforme(c.informe);
                            }
                          }}
                          className="flex cursor-pointer flex-wrap items-center justify-between gap-2 rounded-md border border-[var(--glass-border)] bg-[var(--glass-bg-strong)] px-2.5 py-1.5 text-xs transition-colors hover:border-primary/40"
                        >
                          <span className="flex min-w-0 items-center gap-2">
                            <span className="font-medium">{c.numeroLote}</span>
                            <span className="truncate text-muted-foreground">
                              {c.producto}{c.variedad ? ` · ${c.variedad}` : ""}
                            </span>
                          </span>
                          <span className="flex shrink-0 items-center gap-2">
                            <Badge variant="outline" className={cn("text-[11px]", badgeClass(c.calidad))}>
                              {c.calidad}
                            </Badge>
                            <FileSearch className="h-3.5 w-3.5 text-primary" />
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>

              <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <AlertTriangle className="h-3 w-3 text-warning" />
                Pulsa un lote para ver su informe de calidad completo.
              </p>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <CalidadInformeDialog lote={informeSeleccionado} open={informeAbierto} onOpenChange={setInformeAbierto} />
    </>
  );
}

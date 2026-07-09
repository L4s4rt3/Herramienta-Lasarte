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
import { CALIDAD_OPTIONS, isoWeekKey, type CalidadEstado } from "@/lib/calidad";
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

type Granularidad = "dia" | "semana" | "mes";

const GRANULARIDAD_OPTIONS: Array<{ value: Granularidad; label: string }> = [
  { value: "dia", label: "Día" },
  { value: "semana", label: "Semana" },
  { value: "mes", label: "Mes" },
];

const MONTH_LABELS = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

interface GrupoResumen {
  key: string;
  label: string;
  detail: string;
  pctMedio: number | null;
  controles: CalidadControlProductor[];
  byQuality: Record<CalidadEstado, number>;
}

/** Clave y etiqueta del grupo temporal de un control según la granularidad. */
function claveGrupo(fecha: string, gran: Granularidad): { key: string; label: string; detail: string } {
  if (gran === "dia") {
    return { key: fecha, label: formatDate(fecha), detail: "" };
  }
  if (gran === "semana") {
    const wk = isoWeekKey(fecha); // "2026-W27"
    const [anio, sem] = wk.split("-W");
    return { key: wk, label: `Semana ${Number(sem)}`, detail: anio };
  }
  const mes = fecha.slice(0, 7); // "2026-07"
  const [anio, m] = mes.split("-");
  return { key: mes, label: `${MONTH_LABELS[Number(m) - 1] ?? m}`, detail: anio };
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
  const [granularidad, setGranularidad] = useState<Granularidad>("dia");

  const controles = useMemo(
    () => (productor ? porProductor.get(normalizeNombre(productor)) ?? [] : []),
    [productor, porProductor],
  );

  // Agrupa los controles por la granularidad elegida (día/semana/mes), desc.
  // El aprovechamiento del grupo es la media del %MDNA de sus días distintos.
  const grupos = useMemo<GrupoResumen[]>(() => {
    const map = new Map<string, { label: string; detail: string; controles: CalidadControlProductor[]; fechas: Set<string> }>();
    for (const c of controles) {
      const { key, label, detail } = claveGrupo(c.fecha, granularidad);
      const entry = map.get(key) ?? { label, detail, controles: [], fechas: new Set<string>() };
      entry.controles.push(c);
      entry.fechas.add(c.fecha);
      map.set(key, entry);
    }
    return Array.from(map.entries())
      .map(([key, e]): GrupoResumen => {
        const byQuality = Object.fromEntries(CALIDAD_OPTIONS.map((q) => [q, 0])) as Record<CalidadEstado, number>;
        for (const c of e.controles) {
          if (c.calidad in byQuality) byQuality[c.calidad as CalidadEstado] += 1;
        }
        const pcts = Array.from(e.fechas)
          .map((f) => (pctPorDia.has(f) ? pctPorDia.get(f) ?? null : null))
          .filter((v): v is number => v != null);
        return {
          key,
          label: e.label,
          detail: e.detail,
          pctMedio: pcts.length > 0 ? pcts.reduce((a, b) => a + b, 0) / pcts.length : null,
          controles: e.controles.slice().sort((a, b) => b.fecha.localeCompare(a.fecha) || a.numeroLote.localeCompare(b.numeroLote)),
          byQuality,
        };
      })
      .sort((a, b) => b.key.localeCompare(a.key));
  }, [controles, granularidad, pctPorDia]);

  // Resumen global (independiente de la granularidad): distribución de calidad
  // y aprovechamiento medio de todos los días distintos con control.
  const resumen = useMemo(() => {
    const byQuality = Object.fromEntries(CALIDAD_OPTIONS.map((q) => [q, 0])) as Record<CalidadEstado, number>;
    const fechas = new Set<string>();
    for (const c of controles) {
      if (c.calidad in byQuality) byQuality[c.calidad as CalidadEstado] += 1;
      fechas.add(c.fecha);
    }
    const pcts = Array.from(fechas)
      .map((f) => (pctPorDia.has(f) ? pctPorDia.get(f) ?? null : null))
      .filter((v): v is number => v != null);
    const pctMedio = pcts.length > 0 ? pcts.reduce((a, b) => a + b, 0) / pcts.length : null;
    return { byQuality, pctMedio, totalInformes: controles.length, totalDias: fechas.size };
  }, [controles, pctPorDia]);

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

              {/* Selector de granularidad: Día · Semana · Mes */}
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-muted-foreground">Ver por</span>
                <div className="flex items-center gap-1 rounded-md border border-[var(--glass-border)] bg-[var(--glass-bg)] p-0.5">
                  {GRANULARIDAD_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setGranularidad(option.value)}
                      className={cn(
                        "rounded-md px-2.5 py-0.5 text-[11px] font-medium transition-colors",
                        granularidad === option.value
                          ? "bg-primary/10 text-primary"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Grupos (día/semana/mes): calidad vs aprovechamiento */}
              <div className="space-y-2">
                {grupos.map((g) => (
                  <div key={g.key} className="rounded-lg border border-[var(--glass-border)] bg-[var(--glass-bg)] p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="flex items-baseline gap-1.5">
                        <span className="text-sm font-semibold">{g.label}</span>
                        {g.detail && <span className="text-[11px] text-muted-foreground">{g.detail}</span>}
                        <span className="text-[11px] text-muted-foreground">· {g.controles.length} lote{g.controles.length === 1 ? "" : "s"}</span>
                      </span>
                      <span className="flex items-center gap-1.5 text-xs">
                        <Percent className="h-3 w-3 text-primary" />
                        <span className="text-muted-foreground">
                          {granularidad === "dia" ? "Aprovech. MDNA del día:" : "Aprovech. MDNA medio:"}
                        </span>
                        <span className="tabular-nums font-semibold text-primary">
                          {g.pctMedio != null ? formatPct(g.pctMedio) : "sin dato"}
                        </span>
                      </span>
                    </div>
                    {/* Distribución de calidad del grupo (útil al agrupar por semana/mes) */}
                    {granularidad !== "dia" && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {CALIDAD_OPTIONS.filter((q) => g.byQuality[q] > 0).map((q) => (
                          <Badge key={q} variant="outline" className={cn("text-[11px]", badgeClass(q))}>
                            {q}: {g.byQuality[q]}
                          </Badge>
                        ))}
                      </div>
                    )}
                    <ul className="mt-2 space-y-1.5">
                      {g.controles.map((c) => (
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
                            {granularidad !== "dia" && (
                              <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">{formatDate(c.fecha)}</span>
                            )}
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

// src/pages/EconomicoPanel.tsx
// Sección "Económico → Panel": portada del modo económico. Cruza la facturación
// de Mercadona (base IVA de mercadona_semanas/mercadona_semana_metodos, semanas
// cuyo rango L-S solapa el periodo elegido) con el coste de consumos del mismo
// periodo (useCostesPeriodo) para un margen bruto estimado. Fase 1: no incluye
// mano de obra ni fruta, solo agua/gasoil/electricidad/quimicos vs facturación.
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle, Droplet, Euro, FlaskConical, Fuel, Info, Receipt, Scale, ShieldAlert, TrendingUp, Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { KPICard } from "@/components/KPICard";
import { usePreciosRecursos, useCostesPeriodo } from "@/hooks/useEconomico";
import { useMercadonaVentas, type MercadonaSemanaConMetodos } from "@/hooks/useMercadonaVentas";
import { formatMercadonaWeekRangeLabel, mercadonaWeekDateRange } from "@/lib/mercadonaVentas";
import { buildPeriodoRange } from "@/lib/consumoPeriodoView";
import { formatDate, formatNumber, toISODateLocal } from "@/lib/format";
import { cn } from "@/lib/utils";

const RECURSO_LABEL: Record<string, string> = {
  agua: "Agua",
  electricidad: "Electricidad",
  gasoil: "Gasoil",
  quimicos: "Quimicos",
};

const RECURSO_ICON: Record<string, LucideIcon> = {
  agua: Droplet,
  electricidad: Zap,
  gasoil: Fuel,
  quimicos: FlaskConical,
};

function recursoLabel(recurso: string): string {
  return RECURSO_LABEL[recurso] ?? recurso.charAt(0).toUpperCase() + recurso.slice(1);
}

function formatEuro(value: number | null | undefined, digits = 2): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${formatNumber(value, digits)} €`;
}

// ─── Selector de rango sencillo (Este mes / Últimas 4 semanas / Campaña) ────────

type RangoPreset = "mes" | "ultimas4" | "campana";

interface RangoSimple {
  start: string; // ISO, inclusive
  end: string;   // ISO, inclusive
  label: string;
  detail: string;
}

const PRESETS: { value: RangoPreset; label: string }[] = [
  { value: "mes", label: "Este mes" },
  { value: "ultimas4", label: "Últimas 4 semanas" },
  { value: "campana", label: "Campaña" },
];

function buildRango(preset: RangoPreset): RangoSimple {
  if (preset === "mes") {
    const r = buildPeriodoRange("mes", 0);
    return { start: r.start, end: r.end, label: r.label, detail: r.detail };
  }
  if (preset === "campana") {
    const r = buildPeriodoRange("campana", 0);
    return { start: r.start, end: r.end, label: r.label, detail: r.detail };
  }
  // ultimas4: 4 semanas completas (28 dias) terminando hoy.
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 27);
  const startIso = toISODateLocal(start);
  const endIso = toISODateLocal(end);
  return {
    start: startIso,
    end: endIso,
    label: "Últimas 4 semanas",
    detail: `${formatDate(startIso)} – ${formatDate(endIso)}`,
  };
}

// ─── Facturación Mercadona del rango ─────────────────────────────────────────

/** true si la semana trae base_iva real (formato semanal real, v2), no el histórico. */
function tieneBaseIva(semana: MercadonaSemanaConMetodos): boolean {
  return semana.metodos.some((m) => m.base_iva != null) || semana.ajustes_base_iva != null;
}

interface SemanaFacturacion {
  id: string;
  anio: number;
  semana: number;
  neto: number;
  desde: string;
  hasta: string;
}

function buildSemanasFacturacion(semanas: MercadonaSemanaConMetodos[]): SemanaFacturacion[] {
  return semanas.filter(tieneBaseIva).map((s) => {
    const facturacionMetodos = s.metodos.reduce((sum, m) => sum + (m.base_iva ?? 0), 0);
    const neto = facturacionMetodos + (s.ajustes_base_iva ?? 0);
    const { desde, hasta } = mercadonaWeekDateRange(s.anio, s.semana);
    return { id: s.id, anio: s.anio, semana: s.semana, neto, desde, hasta };
  });
}

/** true si el rango [desde, hasta] de la semana solapa con [rangoStart, rangoEnd]. */
function solapaRango(desde: string, hasta: string, rangoStart: string, rangoEnd: string): boolean {
  return desde <= rangoEnd && hasta >= rangoStart;
}

export default function EconomicoPanel() {
  const [preset, setPreset] = useState<RangoPreset>("mes");
  const rango = useMemo(() => buildRango(preset), [preset]);

  const { hayPrecioCero, sinPermiso } = usePreciosRecursos();
  const costes = useCostesPeriodo(rango.start, rango.end);
  const ventas = useMercadonaVentas();

  const semanasFacturacion = useMemo(() => buildSemanasFacturacion(ventas.semanas), [ventas.semanas]);
  const semanasEnRango = useMemo(
    () => semanasFacturacion
      .filter((s) => solapaRango(s.desde, s.hasta, rango.start, rango.end))
      .sort((a, b) => (b.anio - a.anio) || (b.semana - a.semana)),
    [semanasFacturacion, rango],
  );

  const facturacionRango = useMemo(() => semanasEnRango.reduce((sum, s) => sum + s.neto, 0), [semanasEnRango]);
  const margenBruto = facturacionRango - costes.costeTotal;
  const topRecursos = useMemo(
    () => [...costes.porRecurso].sort((a, b) => b.coste - a.coste).slice(0, 4),
    [costes.porRecurso],
  );

  const isLoading = costes.isLoading || ventas.isLoading;

  if (sinPermiso) {
    return (
      <div className="page-shell">
        <header className="page-header">
          <div>
            <p className="panel-kicker">Económico</p>
            <h1 className="page-title">Panel económico</h1>
            <p className="page-subtitle">Facturación, costes y margen bruto estimado del periodo elegido.</p>
          </div>
        </header>
        <Card className="glass-accented">
          <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
            <ShieldAlert className="h-10 w-10 text-warning" />
            <div>
              <h2 className="text-xl font-semibold">Acceso restringido</h2>
              <p className="mt-2 max-w-md text-sm text-muted-foreground">
                Solo administración puede ver esta sección.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="page-shell">
      <header className="page-header">
        <div>
          <p className="panel-kicker">Económico</p>
          <h1 className="page-title">Panel económico</h1>
          <p className="page-subtitle">Facturación, costes y margen bruto estimado del periodo elegido.</p>
        </div>
      </header>

      <div className="section-toolbar flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="flex items-center gap-1 rounded-xl bg-[var(--glass-bg)] border border-[var(--glass-border)] p-1 shadow-[var(--glass-shadow)]">
          {PRESETS.map((option) => {
            const active = preset === option.value;
            return (
              <Button
                key={option.value}
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setPreset(option.value)}
                className={cn(
                  "h-7 rounded-lg px-3 text-xs transition-all",
                  active
                    ? "bg-[var(--glass-bg-strong)] text-foreground shadow-[var(--glass-shadow)] font-semibold"
                    : "text-muted-foreground hover:bg-[var(--glass-bg-strong)]/60 hover:text-foreground",
                )}
              >
                {option.label}
              </Button>
            );
          })}
        </div>
        <p className="text-xs text-muted-foreground">{rango.detail}</p>
      </div>

      {hayPrecioCero && (
        <Card className="glass border-warning/30 bg-warning/6">
          <CardContent className="flex flex-wrap items-center gap-3 pt-6">
            <AlertTriangle className="h-5 w-5 shrink-0 text-warning" />
            <p className="flex-1 text-sm">
              <span className="font-semibold">Hay tarifas a 0 en Precios:</span> los costes están incompletos.
            </p>
            <Button asChild size="sm" variant="outline" className="glass glass-hover">
              <Link to="/economico/precios">Ver tarifas</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-32" />)}
        </div>
      ) : (
        <section className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          <KPICard
            label="Facturación Mercadona"
            value={formatEuro(facturacionRango)}
            icon={Euro}
            hint={`${semanasEnRango.length} semana(s) con base IVA en el periodo`}
          />
          <KPICard
            label="Coste de consumos"
            value={formatEuro(costes.costeTotal)}
            icon={Receipt}
          />
          <KPICard
            label="Margen bruto estimado"
            value={formatEuro(margenBruto)}
            icon={TrendingUp}
            accent={margenBruto >= 0 ? "success" : "destructive"}
          />
          <KPICard
            label="Coste / kg"
            value={costes.costePorKg != null ? `${formatNumber(costes.costePorKg, 4)} €/kg` : "—"}
            icon={Scale}
          />
        </section>
      )}

      <div className="grid gap-3 sm:gap-4 lg:grid-cols-2">
        <Card className="glass-accented overflow-hidden">
          <CardHeader>
            <p className="panel-kicker">Costes</p>
            <CardTitle>Top recursos por coste</CardTitle>
          </CardHeader>
          <CardContent>
            {topRecursos.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Sin consumo registrado en este periodo.
              </p>
            ) : (
              <ul className="space-y-3">
                {topRecursos.map((r) => {
                  const Icon = RECURSO_ICON[r.recurso] ?? Droplet;
                  return (
                    <li key={r.recurso} className="flex items-center justify-between gap-3">
                      <span className="inline-flex items-center gap-2 text-sm font-medium">
                        <Icon className="h-4 w-4 text-muted-foreground" />
                        {recursoLabel(r.recurso)}
                      </span>
                      <span className="text-sm font-semibold tabular-nums">{formatEuro(r.coste)}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className="glass-accented overflow-hidden">
          <CardHeader>
            <p className="panel-kicker">Facturación</p>
            <CardTitle>Últimas semanas</CardTitle>
          </CardHeader>
          <CardContent>
            {semanasEnRango.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Sin semanas de facturación en este periodo.
              </p>
            ) : (
              <ul className="space-y-3">
                {semanasEnRango.slice(0, 5).map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium">S{s.semana} · {s.anio}</p>
                      <p className="text-xs text-muted-foreground">{formatMercadonaWeekRangeLabel(s.anio, s.semana)}</p>
                    </div>
                    <span className="text-sm font-semibold tabular-nums">{formatEuro(s.neto)}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="glass border-[var(--glass-border)] bg-[var(--glass-bg)]">
        <CardContent className="flex items-start gap-3 pt-6">
          <Info className="h-5 w-5 shrink-0 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            <span className="font-semibold text-foreground">Margen bruto estimado</span> = facturación Mercadona −
            coste de consumos. No incluye mano de obra, fruta ni otros costes (Fase 1).
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

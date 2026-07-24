// src/components/mercadona/MercadonaLotes.tsx
// Pestaña "Lotes y productores" de Mercadona: qué fruta y qué productores
// rinden de verdad para el cliente — ranking histórico de aprovechamiento
// MDNA, lotes de la semana activa y calidad orientativa de esos días.
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AlertTriangle, ChevronLeft, ChevronRight, ClipboardList, FileSearch, Package, ScrollText, TrendingUp, Trophy } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { InfoTooltip } from "@/components/InfoTooltip";
import { CalidadInformeDialog, type CalidadInformeLote } from "@/components/CalidadInformeDialog";
import { useMercadona } from "@/hooks/useMercadona";
import { useAuth } from "@/contexts/AuthProvider";
import {
  buildCalidadIndex,
  computeProductoresRango,
  matchCalidadParaLote,
  useMercadonaLotes,
  useMercadonaProductoresData,
  type MercadonaCalidadSemana,
  type MercadonaLoteSemana,
  type MercadonaProductoresData,
} from "@/hooks/useMercadonaLotes";
import { useCalidadProductores } from "@/hooks/useCalidadProductores";
import { normalizeNombre } from "@/hooks/useProductores";
import { MercadonaProductorCalidadDialog } from "@/components/mercadona/MercadonaProductorCalidadDialog";
import type { MercadonaSemanaConMetodos } from "@/hooks/useMercadonaVentas";
import { mercadonaWeekDateRange } from "@/lib/mercadonaVentas";
import { buildPeriodoRange } from "@/lib/consumoPeriodoView";
import { formatDate, formatKg, formatNumber, formatPct, toISODateLocal } from "@/lib/format";
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
    calidadSemana, isLoadingCalidadSemana,
  } = useMercadonaLotes(activeSemana);

  const [informeSeleccionado, setInformeSeleccionado] = useState<CalidadInformeLote | null>(null);
  const [informeAbierto, setInformeAbierto] = useState(false);

  const abrirInforme = (informe: CalidadInformeLote) => {
    setInformeSeleccionado(informe);
    setInformeAbierto(true);
  };

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
      <LotesSemanaTabla
        lotes={lotesSemana}
        isLoading={isLoadingLotesSemana}
        calidadSemana={calidadSemana}
        onAbrirInforme={abrirInforme}
      />
      <CalidadSemana controles={calidadSemana} isLoading={isLoadingCalidadSemana} onAbrirInforme={abrirInforme} />
      <CalidadInformeDialog lote={informeSeleccionado} open={informeAbierto} onOpenChange={setInformeAbierto} />
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
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
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
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
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

/**
 * Ranking de aprovechamiento Mercadona por productor como bloque autónomo,
 * pensado para vivir en su propia pestaña dentro de la sección de Mercadona.
 * Es independiente de la semana activa: carga sus propios datos históricos y
 * su selector de periodo (Día/Semana/Campaña/Total) manda sobre qué se muestra.
 */
export function MercadonaProductoresRanking() {
  const { data, isLoading } = useMercadonaProductoresData();
  return <RankingHistoricoProductores productoresData={data} isLoading={isLoading} />;
}

/** Presets de umbral de kg mínimos para no dejar que productores de poco volumen distorsionen el ranking. */
const KG_THRESHOLD_PRESETS: Array<{ label: string; value: number }> = [
  { label: "Todos", value: 0 },
  { label: "≥ 10.000 kg", value: 10_000 },
  { label: "≥ 50.000 kg", value: 50_000 },
];

const DEFAULT_MIN_KG = 10_000;

/** Periodo del ranking de aprovechamiento por productor: Día, Semana, Campaña o Total (todo el histórico). */
type ProductoresPeriodoTipo = "dia" | "semana" | "campana" | "total";

const PERIODO_OPTIONS: Array<{ value: ProductoresPeriodoTipo; label: string }> = [
  { value: "dia", label: "Día" },
  { value: "semana", label: "Semana" },
  { value: "campana", label: "Campaña" },
  { value: "total", label: "Total" },
];

/** Periodo por defecto: Total, para no alterar los números que ya se verificaron como vista de entrada. */
const DEFAULT_PERIODO_TIPO: ProductoresPeriodoTipo = "total";

interface ProductoresRango {
  desde: string | null;
  hasta: string | null;
  label: string;
  detail: string;
}

/**
 * Rango [desde, hasta] (ISO "yyyy-mm-dd") para el periodo activo del ranking
 * de productores, desplazado `offset` unidades desde hoy. "Total" no filtra
 * (desde/hasta null); "Día" es un único día (hoy + offset); "Semana" y
 * "Campaña" reutilizan `buildPeriodoRange` (misma campaña citrícola sep→ago
 * que el resto de la app).
 */
function buildProductoresRango(tipo: ProductoresPeriodoTipo, offset: number, today: Date = new Date()): ProductoresRango {
  if (tipo === "total") {
    return { desde: null, hasta: null, label: "Total", detail: "Todos los datos" };
  }
  if (tipo === "dia") {
    const dia = new Date(today);
    dia.setDate(dia.getDate() + offset);
    const iso = toISODateLocal(dia);
    return { desde: iso, hasta: iso, label: "Día", detail: formatDate(iso) };
  }
  const periodo = buildPeriodoRange(tipo, offset, today);
  return { desde: periodo.start, hasta: periodo.end, label: periodo.label, detail: periodo.detail };
}

function RankingHistoricoProductores({
  productoresData, isLoading,
}: {
  productoresData: MercadonaProductoresData;
  isLoading: boolean;
}) {
  const { role } = useAuth();
  // Igual que en la tabla de lotes: solo admin/operario llegan a /productores
  // (a "ventas" en /comercial/mercadona, RoleRoute lo rebota a su home), así
  // que para ese rol se conserva el modal de calidad de siempre.
  const puedeNavegarPlanta = role === "admin" || role === "operario";
  const navigate = useNavigate();
  const [minKg, setMinKg] = useState<number>(DEFAULT_MIN_KG);
  const [periodoTipo, setPeriodoTipo] = useState<ProductoresPeriodoTipo>(DEFAULT_PERIODO_TIPO);
  const [offset, setOffset] = useState(0);
  const [productorCalidad, setProductorCalidad] = useState<string | null>(null);
  const [calidadAbierta, setCalidadAbierta] = useState(false);

  const { porProductor: calidadPorProductor } = useCalidadProductores();

  const abrirCalidad = (productor: string) => {
    setProductorCalidad(productor);
    setCalidadAbierta(true);
  };

  const handleProductorClick = (productor: string) => {
    if (puedeNavegarPlanta) {
      navigate(`/productores?productor=${encodeURIComponent(productor)}`);
      return;
    }
    abrirCalidad(productor);
  };

  const rango = useMemo(() => buildProductoresRango(periodoTipo, offset), [periodoTipo, offset]);

  const todayIso = toISODateLocal(new Date());
  const siguienteRango = periodoTipo === "total" ? null : buildProductoresRango(periodoTipo, offset + 1);
  const canNavigateNext = siguienteRango !== null && siguienteRango.desde !== null && siguienteRango.desde <= todayIso;
  const isCurrent = offset === 0;

  const cambiarPeriodoTipo = (tipo: ProductoresPeriodoTipo) => {
    setPeriodoTipo(tipo);
    setOffset(0);
  };

  const productoresRango = useMemo(
    () => computeProductoresRango(productoresData.lotes, productoresData.pctPorDia, productoresData.partesById, rango.desde, rango.hasta, 0),
    [productoresData, rango.desde, rango.hasta],
  );

  const filtrados = useMemo(
    () => productoresRango.filter((p) => minKg <= 0 || p.kg >= minKg),
    [productoresRango, minKg],
  );
  const maxPct = Math.max(1, ...filtrados.map((p) => p.pctMdnaEstimado));
  const periodoDescripcion = periodoTipo === "total" ? "Toda la campaña" : `${rango.label} · ${rango.detail}`;

  return (
    <>
    <Card className="glass-accented overflow-hidden">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Trophy className="h-4 w-4 text-warning" /> Aprovechamiento Mercadona por productor
            <InfoTooltip>
              Se basa en la CONFECCIÓN MDNA (métrica de fábrica), no en el vendido real del informe semanal.
              Estimación por reparto diario: no existe trazabilidad lote → formato exacta, así que a cada lote se le
              asigna el % de kg MDNA que tuvo su día de producción (kg de productos MDNA / kg totales del día,
              excluye precalibrado) y se pondera por los kg del lote. Usa el umbral de kg mínimos para que los
              productores de poco volumen no distorsionen la comparación.
            </InfoTooltip>
          </CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            {/* Selector de periodo: Día · Semana · Campaña · Total */}
            <div className="flex flex-wrap items-center gap-1.5">
              <div className="flex items-center gap-1 rounded-md border border-[var(--glass-border)] bg-[var(--glass-bg)] p-0.5">
                {PERIODO_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => cambiarPeriodoTipo(option.value)}
                    className={cn(
                      "rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors",
                      periodoTipo === option.value
                        ? "bg-primary/10 text-primary"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              {periodoTipo !== "total" && (
                <>
                  <div className="flex items-center gap-1 rounded-md border border-[var(--glass-border)] bg-[var(--glass-bg)] px-1 py-0.5">
                    <button
                      type="button"
                      onClick={() => setOffset((o) => o - 1)}
                      className="rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
                      title="Periodo anterior"
                    >
                      <ChevronLeft className="h-3.5 w-3.5" />
                    </button>
                    <div className="min-w-[110px] px-1 text-center">
                      <p className="text-[11px] font-semibold leading-tight">{rango.label}</p>
                      <p className="text-[10px] leading-tight text-muted-foreground">{rango.detail}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setOffset((o) => o + 1)}
                      disabled={!canNavigateNext}
                      className="rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                      title="Periodo siguiente"
                    >
                      <ChevronRight className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => setOffset(0)}
                    disabled={isCurrent}
                    className="rounded-md border border-[var(--glass-border)] bg-[var(--glass-bg)] px-2 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Hoy
                  </button>
                </>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] text-muted-foreground">Umbral de kg</span>
              {KG_THRESHOLD_PRESETS.map((preset) => (
                <button
                  key={preset.value}
                  type="button"
                  onClick={() => setMinKg(preset.value)}
                  className={cn(
                    "rounded-md border px-2 py-0.5 text-[11px] font-medium transition-colors",
                    minKg === preset.value
                      ? "border-primary/40 bg-primary/10 text-primary"
                      : "border-[var(--glass-border)] bg-[var(--glass-bg)] text-muted-foreground hover:text-foreground",
                  )}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          {periodoDescripcion} · % MDNA estimado por reparto diario · ordenado de mayor a menor aprovechamiento ·{" "}
          {filtrados.length} productor{filtrados.length === 1 ? "" : "es"} mostrado{filtrados.length === 1 ? "" : "s"}
          {productoresRango.length !== filtrados.length ? ` de ${productoresRango.length}` : ""}
        </p>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="space-y-2 py-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : productoresRango.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {periodoTipo === "total"
              ? "Todavía no hay productores registrados."
              : "Sin productores registrados en este periodo."}
          </p>
        ) : filtrados.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Ningún productor supera el umbral de kg seleccionado. Prueba con un umbral menor.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">#</TableHead>
                  <TableHead>Productor</TableHead>
                  <TableHead className="text-right">Kg</TableHead>
                  <TableHead className="text-right">Nº lotes</TableHead>
                  <TableHead className="text-right">Aprovechamiento Mercadona %</TableHead>
                  <TableHead className="text-right">
                    <span className="inline-flex items-center gap-1">
                      Calidad
                      <InfoTooltip>
                        {puedeNavegarPlanta
                          ? "Pulsa el nombre para abrir la ficha del productor; pulsa el icono de esta columna para ver sus informes de calidad cruzados con el aprovechamiento Mercadona de cada día."
                          : "Pulsa una fila para ver los informes de calidad de ese productor cruzados con el aprovechamiento Mercadona de cada día."}
                      </InfoTooltip>
                    </span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtrados.map((p, i) => {
                  const nInformes = calidadPorProductor.get(normalizeNombre(p.productor))?.length ?? 0;
                  return (
                    <TableRow
                      key={p.productor}
                      role="button"
                      tabIndex={0}
                      onClick={() => handleProductorClick(p.productor)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          handleProductorClick(p.productor);
                        }
                      }}
                      className="cursor-pointer transition-colors hover:bg-[var(--glass-bg-strong)]"
                    >
                      <TableCell className="text-xs text-muted-foreground">{i + 1}</TableCell>
                      <TableCell className="max-w-[240px] truncate text-xs font-medium">
                        {puedeNavegarPlanta ? (
                          <Link
                            to={`/productores?productor=${encodeURIComponent(p.productor)}`}
                            onClick={(e) => e.stopPropagation()}
                            title="Ver ficha del productor"
                            className="text-primary hover:underline"
                          >
                            {p.productor}
                          </Link>
                        ) : (
                          p.productor
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-xs">{formatKg(p.kg)}</TableCell>
                      <TableCell className="text-right tabular-nums text-xs text-muted-foreground">{p.nLotes}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          <div className="h-1.5 w-20 shrink-0 overflow-hidden rounded-full bg-[var(--glass-bg-strong)]">
                            <div
                              className="h-full rounded-full bg-primary"
                              style={{ width: `${Math.min(100, (p.pctMdnaEstimado / maxPct) * 100)}%` }}
                            />
                          </div>
                          <span className="w-14 shrink-0 tabular-nums font-semibold text-primary">
                            {formatPct(p.pctMdnaEstimado)}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        {puedeNavegarPlanta ? (
                          <button
                            type="button"
                            title="Ver contraste de calidad"
                            onClick={(e) => {
                              e.stopPropagation();
                              abrirCalidad(p.productor);
                            }}
                            className={cn(
                              "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium transition-colors",
                              nInformes > 0
                                ? "border-primary/30 bg-primary/10 text-primary hover:bg-primary/20"
                                : "border-[var(--glass-border)] bg-[var(--glass-bg)] text-muted-foreground hover:border-primary/30",
                            )}
                          >
                            <ClipboardList className="h-3 w-3" />
                            {nInformes > 0 ? nInformes : "—"}
                          </button>
                        ) : (
                          <span
                            className={cn(
                              "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium",
                              nInformes > 0
                                ? "border-primary/30 bg-primary/10 text-primary"
                                : "border-[var(--glass-border)] bg-[var(--glass-bg)] text-muted-foreground",
                            )}
                          >
                            <ClipboardList className="h-3 w-3" />
                            {nInformes > 0 ? nInformes : "—"}
                          </span>
                        )}
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
    <MercadonaProductorCalidadDialog
      productor={productorCalidad}
      open={calidadAbierta}
      onOpenChange={setCalidadAbierta}
      porProductor={calidadPorProductor}
      pctPorDia={productoresData.pctPorDia}
    />
    </>
  );
}

// ─── 2. Lotes de la semana activa ────────────────────────────────────────────

function LotesSemanaTabla({
  lotes, isLoading, calidadSemana, onAbrirInforme,
}: {
  lotes: MercadonaLoteSemana[];
  isLoading: boolean;
  calidadSemana: MercadonaCalidadSemana[];
  onAbrirInforme: (informe: CalidadInformeLote) => void;
}) {
  const { role } = useAuth();
  // Solo admin/operario llegan a /trazabilidad (a "ventas" en
  // /comercial/mercadona, RoleRoute lo rebota a su home): para ese rol se
  // conserva el modal de calidad de siempre, sin enlaces que rebotarían.
  const puedeNavegarPlanta = role === "admin" || role === "operario";
  const navigate = useNavigate();
  const [sortKey, setSortKey] = useState<SortKey>("kg");
  const [loteSinInforme, setLoteSinInforme] = useState<MercadonaLoteSemana | null>(null);

  const calidadIndex = useMemo(() => buildCalidadIndex(calidadSemana), [calidadSemana]);

  const ordenados = useMemo(() => {
    const copia = [...lotes];
    copia.sort((a, b) => (b[sortKey] ?? -Infinity) - (a[sortKey] ?? -Infinity));
    return copia;
  }, [lotes, sortKey]);

  const handleLoteClick = (lote: MercadonaLoteSemana) => {
    // Planta (admin/operario): el lote siempre lleva a su trazabilidad
    // completa, nunca se queda en un callejón sin salida; el informe de
    // calidad queda como acción secundaria en la columna "Calidad".
    if (puedeNavegarPlanta) {
      navigate(`/trazabilidad?lote=${encodeURIComponent(lote.loteCodigo)}`);
      return;
    }
    const match = matchCalidadParaLote(lote, calidadIndex);
    if (!match) {
      setLoteSinInforme(lote);
      return;
    }
    onAbrirInforme(match.informe);
  };

  return (
    <>
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
          <div className="space-y-2 py-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
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
                  <TableHead className="text-right">
                    <span className="inline-flex items-center gap-1">
                      Calidad
                      <InfoTooltip>
                        {puedeNavegarPlanta
                          ? "El código de lote lleva a su trazabilidad completa; el icono de esta columna abre el informe de calidad si existe (cruzado por número de lote o, si no hay, por productor y fecha)."
                          : "Pulsa la fila para ver el informe de calidad de este lote (cruzado por número de lote o, si no hay, por productor y fecha)."}
                      </InfoTooltip>
                    </span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ordenados.map((l) => {
                  const color = l.tph != null ? tphColor(l.tph) : undefined;
                  const match = matchCalidadParaLote(l, calidadIndex);
                  return (
                    <TableRow
                      key={l.key}
                      role="button"
                      tabIndex={0}
                      onClick={() => handleLoteClick(l)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          handleLoteClick(l);
                        }
                      }}
                      className="cursor-pointer transition-colors hover:bg-[var(--glass-bg-strong)]"
                    >
                      <TableCell className="text-xs font-medium">
                        {puedeNavegarPlanta ? (
                          <Link
                            to={`/trazabilidad?lote=${encodeURIComponent(l.loteCodigo)}`}
                            onClick={(e) => e.stopPropagation()}
                            title="Ver trazabilidad del lote"
                            className="text-primary hover:underline"
                          >
                            {l.loteCodigo}
                          </Link>
                        ) : (
                          l.loteCodigo
                        )}
                      </TableCell>
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
                      <TableCell className="text-right">
                        {puedeNavegarPlanta && match ? (
                          <button
                            type="button"
                            title="Ver informe de calidad"
                            onClick={(e) => {
                              e.stopPropagation();
                              onAbrirInforme(match.informe);
                            }}
                            className="inline-flex items-center gap-1 rounded-md border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium text-primary transition-colors hover:bg-primary/20"
                          >
                            <FileSearch className="h-3 w-3" />
                            Ver
                          </button>
                        ) : (
                          <span
                            className={cn(
                              "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium",
                              match
                                ? "border-primary/30 bg-primary/10 text-primary"
                                : "border-[var(--glass-border)] bg-[var(--glass-bg)] text-muted-foreground",
                            )}
                          >
                            <FileSearch className="h-3 w-3" />
                            {match ? "Ver" : "—"}
                          </span>
                        )}
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
    <Dialog
      open={!!loteSinInforme}
      onOpenChange={(open) => {
        if (!open) setLoteSinInforme(null);
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Sin informe de calidad</DialogTitle>
          <DialogDescription>
            {loteSinInforme ? `Lote ${loteSinInforme.loteCodigo} · ${loteSinInforme.productor}` : ""}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <FileSearch className="h-9 w-9 text-muted-foreground/50" />
          <p className="max-w-sm text-sm text-muted-foreground">
            Este lote no tiene informe de calidad todavía. El cruce se hace por número de lote o, si no hay, por
            productor y fecha.
          </p>
        </div>
      </DialogContent>
    </Dialog>
    </>
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
  controles, isLoading, onAbrirInforme,
}: {
  controles: MercadonaCalidadSemana[];
  isLoading: boolean;
  onAbrirInforme: (informe: CalidadInformeLote) => void;
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
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : controles.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Sin controles de calidad registrados en los días de esta semana.
          </p>
        ) : (
          <ul className="space-y-2">
            {controles.map((c) => (
              <li
                key={c.id}
                role="button"
                tabIndex={0}
                onClick={() => onAbrirInforme(c.informe)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onAbrirInforme(c.informe);
                  }
                }}
                className="cursor-pointer rounded-lg border border-[var(--glass-border)] bg-[var(--glass-bg)] px-3 py-2.5 text-xs transition-colors hover:border-primary/40 hover:bg-[var(--glass-bg-strong)]"
              >
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
                    <FileSearch className="h-3.5 w-3.5 text-primary" />
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

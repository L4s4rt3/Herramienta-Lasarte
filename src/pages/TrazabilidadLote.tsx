// src/pages/TrazabilidadLote.tsx
// Trazabilidad por lote: de la finca al destino. Busca un lote (o llega con
// ?lote= desde Entradas/Análisis) y muestra la cadena completa en 4 pasos:
// Entrada (báscula) → Procesado (calibrador) → Clasificación y destino
// (Informe LOTE) → Calidad. Cada paso puede faltar y la ficha lo indica.
import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  AlertTriangle, ArrowLeft, ArrowRight, Boxes, ClipboardCheck, Factory, Leaf, Search, Truck, Warehouse, X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useEntradasBascula } from "@/hooks/useEntradasBascula";
import { useTrazabilidadLote } from "@/hooks/useTrazabilidadLote";
import { normalizarLoteCodigo, type StockLoteRow } from "@/lib/entradasBascula";
import { errorMessage } from "@/lib/errorMessage";
import { formatDate, formatKgCompact as formatKg, formatNumber, formatPct } from "@/lib/format";
import { GRUPO_COLORS } from "@/lib/destinoClasificacion";
import { barFill } from "@/lib/chartTheme";
import { cn } from "@/lib/utils";

const CALIDAD_BADGE: Record<string, string> = {
  Excelente: "border-emerald-600/35 bg-emerald-600/12 text-emerald-800 dark:text-emerald-200",
  Bueno: "border-emerald-500/30 bg-emerald-500/12 text-emerald-700 dark:text-emerald-300",
  Regular: "border-amber-500/35 bg-amber-500/14 text-amber-700 dark:text-amber-300",
  Deficiente: "border-orange-500/35 bg-orange-500/14 text-orange-700 dark:text-orange-300",
  Pésimo: "border-red-500/35 bg-red-500/12 text-red-700 dark:text-red-300",
};

function normalizeText(value: string | null | undefined): string {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

export default function TrazabilidadLote() {
  const [searchParams, setSearchParams] = useSearchParams();
  const loteParam = normalizarLoteCodigo(searchParams.get("lote"));
  const [search, setSearch] = useState("");

  const seleccionarLote = (lote: string | null) => {
    const next = new URLSearchParams(searchParams);
    if (lote) next.set("lote", lote);
    else next.delete("lote");
    setSearchParams(next, { replace: true });
  };

  return (
    <div className="page-shell">
      <header className="page-header">
        <div>
          <h1 className="page-title">Trazabilidad</h1>
          <p className="page-subtitle">
            La vida completa de cada lote: finca → entrada → calibrador → clasificación → calidad.
          </p>
        </div>
      </header>

      {loteParam ? (
        <FichaLote lote={loteParam} onBack={() => seleccionarLote(null)} />
      ) : (
        <SelectorLotes search={search} onSearchChange={setSearch} onSelect={seleccionarLote} />
      )}
    </div>
  );
}

// ─── Selector: buscador + lista de lotes conocidos ──────────────────────────

function SelectorLotes({ search, onSearchChange, onSelect }: {
  search: string;
  onSearchChange: (v: string) => void;
  onSelect: (lote: string) => void;
}) {
  const { stock, isLoading, error } = useEntradasBascula();
  const searchLower = normalizeText(search).trim();

  const filas = useMemo(() => {
    const ordenadas = [...stock.filas].sort((a, b) => {
      // Activos primero (lo que está en cámara es lo que se consulta), luego por fecha.
      const activoA = a.estado !== "procesado" ? 0 : 1;
      const activoB = b.estado !== "procesado" ? 0 : 1;
      return activoA - activoB || b.fecha_entrada.localeCompare(a.fecha_entrada);
    });
    if (!searchLower) return ordenadas.slice(0, 60);
    return ordenadas.filter((f) => (
      normalizeText(f.lote).includes(searchLower)
      || normalizeText(f.finca).includes(searchLower)
      || normalizeText(f.articulo).includes(searchLower)
      || normalizeText(f.agricultor).includes(searchLower)
    )).slice(0, 100);
  }, [stock.filas, searchLower]);

  // Si teclean un código de lote completo que no está en la lista (lote antiguo
  // sin entrada de báscula), se ofrece abrirlo igualmente.
  const loteDirecto = normalizarLoteCodigo(search);
  const loteDirectoEnLista = loteDirecto ? filas.some((f) => f.lote === loteDirecto) : false;

  return (
    <div className="space-y-4">
      <div className="glass-overlay sticky top-[calc(3.5rem+1rem)] z-10 rounded-xl p-3 sm:top-[calc(4rem+1.25rem)]">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Busca un lote (26051407), finca, variedad o agricultor…"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            className="h-10 pl-9"
            autoFocus
          />
          {search && (
            <button
              type="button"
              onClick={() => onSearchChange("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {loteDirecto && !loteDirectoEnLista && (
        <button
          type="button"
          onClick={() => onSelect(loteDirecto)}
          className="flex w-full items-center gap-2 rounded-xl border border-info/30 bg-info/10 px-4 py-3 text-left text-sm transition-colors hover:bg-info/15"
        >
          <Search className="h-4 w-4 shrink-0 text-info" />
          Abrir la trazabilidad del lote <span className="font-semibold tabular-nums">{loteDirecto}</span>
          <ArrowRight className="ml-auto h-4 w-4 text-info" />
        </button>
      )}

      {isLoading ? (
        <Skeleton className="h-96 w-full" />
      ) : error ? (
        <Card className="glass-accented border-destructive/30">
          <CardContent className="flex items-center gap-3 py-6 text-destructive">
            <AlertTriangle className="h-5 w-5 shrink-0" />
            <p className="text-sm font-semibold">{errorMessage(error)}</p>
          </CardContent>
        </Card>
      ) : filas.length === 0 ? (
        <Card className="glass-accented">
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            Sin lotes que coincidan. También puedes teclear un código de lote completo (8 dígitos).
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {filas.map((f: StockLoteRow) => (
            <button
              key={f.lote}
              type="button"
              onClick={() => onSelect(f.lote)}
              className="rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg)] px-3.5 py-2.5 text-left transition-all hover:-translate-y-0.5 hover:bg-[var(--glass-bg-strong)]"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold tabular-nums">{f.lote}</span>
                {f.estado !== "procesado" ? (
                  <Badge variant="outline" className="border-info/40 bg-info/10 px-1.5 py-0 text-[11px] text-info">
                    {formatKg(f.kg_en_camara)} en cámara
                  </Badge>
                ) : (
                  <span className="text-[11px] text-muted-foreground">procesado</span>
                )}
              </div>
              <p className="mt-1 truncate text-xs text-muted-foreground">
                {formatDate(f.fecha_entrada)} · {f.finca ?? "—"}{f.articulo ? ` · ${f.articulo}` : ""}
              </p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Ficha del lote: los 4 pasos de la cadena ────────────────────────────────

function FichaLote({ lote, onBack }: { lote: string; onBack: () => void }) {
  const { data, isLoading, error } = useTrazabilidadLote(lote);

  if (isLoading) {
    return (
      <>
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </>
    );
  }

  if (error || !data) {
    return (
      <Card className="glass-accented border-destructive/30">
        <CardContent className="flex items-center gap-3 py-6 text-destructive">
          <AlertTriangle className="h-5 w-5 shrink-0" />
          <p className="text-sm font-semibold">{error ? errorMessage(error) : "No se pudo cargar el lote."}</p>
          <Button variant="outline" size="sm" className="ml-auto" onClick={onBack}>Volver</Button>
        </CardContent>
      </Card>
    );
  }

  const { entrada, procesado, kgProcesado, clasificacion, calidad } = data;
  const kgEntrada = entrada ? Number(entrada.kg_entrada) || 0 : 0;
  const kgAjuste = entrada ? Number(entrada.kg_ajuste_stock) || 0 : 0;
  const enCamara = Math.max(0, kgEntrada - kgProcesado - kgAjuste);
  const sinNada = !entrada && procesado.length === 0 && clasificacion.kgClasificado === 0 && calidad.length === 0;

  return (
    <div className="space-y-4">
      {/* Cabecera del lote */}
      <div className="glass-accented rounded-xl px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <Button variant="ghost" size="sm" className="-ml-2 h-7 px-2" onClick={onBack}>
            <ArrowLeft className="h-3.5 w-3.5" /> Lotes
          </Button>
          <h2 className="text-base font-bold tabular-nums">Lote {data.lote}</h2>
          {entrada?.articulo && <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">{entrada.articulo}</Badge>}
          {entrada && enCamara > kgEntrada * 0.03 ? (
            <Badge variant="outline" className="border-info/40 bg-info/10 px-1.5 py-0 text-[11px] text-info">
              {formatKg(enCamara)} en cámara
            </Badge>
          ) : entrada ? (
            <Badge variant="outline" className="border-[var(--glass-border)] px-1.5 py-0 text-[11px] text-muted-foreground">
              Procesado
            </Badge>
          ) : null}
        </div>
      </div>

      {sinNada && (
        <Card className="glass-accented">
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No hay ningún registro para el lote {data.lote}: ni entrada de báscula, ni procesado, ni clasificación, ni calidad.
          </CardContent>
        </Card>
      )}

      {/* 1 · Entrada */}
      <PasoCard icon={Truck} numero={1} titulo="Entrada (báscula)" vacio={!entrada && "Sin entrada de báscula registrada para este lote."}>
        {entrada && (
          <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
            <DatoLinea label="Fecha de entrada" valor={formatDate(entrada.fecha)} />
            <DatoLinea label="Kg de entrada" valor={`${formatNumber(kgEntrada)} kg`} destacado />
            <DatoLinea label="Finca" valor={entrada.finca ?? "—"} />
            <DatoLinea label="Parcela" valor={entrada.parcela ?? "—"} />
            <DatoLinea label="Agricultor" valor={entrada.agricultor ?? "—"} />
            <DatoLinea label="Variedad" valor={entrada.articulo ?? "—"} />
            <DatoLinea label="Envases" valor={entrada.envases ? `${entrada.envases} × ${entrada.tipo_envase ?? "envase"}` : "—"} />
            <DatoLinea label="Nº entrada / albarán" valor={entrada.num_entrada ?? "—"} />
            <DatoLinea
              label="Certificación GGN"
              valor={entrada.certificado_ggn ? entrada.certificado_ggn : entrada.certificada ? "Certificada" : "—"}
            />
          </div>
        )}
        {entrada?.origen === "stock_inicial" && (
          <p className="mt-3 text-xs text-muted-foreground">
            Entrada sembrada desde el informe de stock (el registro por báscula empezó a mediados de abril de 2026).
          </p>
        )}
      </PasoCard>

      {/* 2 · Procesado */}
      <PasoCard
        icon={Factory}
        numero={2}
        titulo="Procesado (calibrador)"
        vacio={procesado.length === 0 && (enCamara > 0
          ? "Todavía sin procesar: el lote sigue en cámara."
          : "Sin registros de procesado en los partes (anterior al arranque de la herramienta).")}
      >
        {procesado.length > 0 && (
          <div className="space-y-2">
            {procesado.map((p, i) => (
              <Link
                key={`${p.part_id}-${i}`}
                to={`/partes/${p.part_id}`}
                className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-[var(--glass-border)] bg-[var(--glass-bg)] px-3 py-2 text-sm transition-colors hover:bg-[var(--glass-bg-strong)]"
              >
                <span className="w-24 shrink-0 font-medium">{p.fecha ? formatDate(p.fecha) : "—"}</span>
                <span className="tabular-nums font-semibold">{formatKg(p.kg)}</span>
                {p.toneladas_hora != null && (
                  <span className="text-xs text-muted-foreground">{p.toneladas_hora.toFixed(1)} T/h</span>
                )}
                {p.duracion_min != null && (
                  <span className="text-xs text-muted-foreground">{formatNumber(p.duracion_min)} min</span>
                )}
                {p.productor && <span className="min-w-0 truncate text-xs text-muted-foreground">{p.productor}</span>}
                <ArrowRight className="ml-auto h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              </Link>
            ))}
            <p className="text-xs text-muted-foreground">
              Total procesado: <span className="font-semibold text-foreground tabular-nums">{formatKg(kgProcesado)}</span>
              {kgEntrada > 0 && <> · {formatPct((kgProcesado / kgEntrada) * 100)} de la entrada</>}
              {" "}· clic en una fila para abrir su parte
            </p>
          </div>
        )}
      </PasoCard>

      {/* 3 · Clasificación y destino */}
      <PasoCard
        icon={Boxes}
        numero={3}
        titulo="Clasificación y destino"
        vacio={clasificacion.kgClasificado === 0 && "Sin Informe LOTE para este lote (la clasificación por calibre/clase se carga al analizar el parte)."}
      >
        {clasificacion.kgClasificado > 0 && (
          <div className="space-y-4">
            {/* Barra apilada por grupo de destino */}
            <div>
              <div className="flex h-3 w-full overflow-hidden rounded-md border border-[var(--glass-border)]">
                {clasificacion.grupos.map((g) => (
                  <div
                    key={g.grupo}
                    style={{ width: `${g.pct}%`, backgroundColor: GRUPO_COLORS[g.grupo] ?? GRUPO_COLORS.Otro }}
                    title={`${g.grupo}: ${formatKg(g.kg)} (${formatPct(g.pct)})`}
                  />
                ))}
              </div>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                {clasificacion.grupos.map((g) => (
                  <span key={g.grupo} className="flex items-center gap-1.5 text-xs">
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: GRUPO_COLORS[g.grupo] ?? GRUPO_COLORS.Otro }} />
                    <span className="font-medium">{g.grupo}</span>
                    <span className="tabular-nums text-muted-foreground">{formatKg(g.kg)} · {formatPct(g.pct)}</span>
                  </span>
                ))}
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <div>
                <p className="panel-kicker mb-1.5">Clases</p>
                <div className="space-y-1">
                  {clasificacion.clases.slice(0, 6).map((c) => (
                    <div key={c.clase} className="flex items-center gap-2.5 text-xs">
                      <span
                        className="inline-flex w-24 shrink-0 items-center justify-center rounded px-1.5 py-0.5 font-semibold"
                        style={{ backgroundColor: barFill(GRUPO_COLORS[c.grupo] ?? GRUPO_COLORS.Otro, 0.14), color: GRUPO_COLORS[c.grupo] ?? GRUPO_COLORS.Otro }}
                      >
                        {c.clase}
                      </span>
                      <span className="tabular-nums font-medium">{formatKg(c.kg)}</span>
                      <span className="tabular-nums text-muted-foreground">{formatPct(c.pct)}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <p className="panel-kicker mb-1.5">Calibres</p>
                <div className="space-y-1">
                  {clasificacion.calibres.slice(0, 6).map((c) => (
                    <div key={c.tamano} className="flex items-center gap-2.5 text-xs">
                      <span className="w-24 shrink-0 truncate font-medium">{c.tamano}</span>
                      <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-[var(--glass-bg-strong)]">
                        <div className="h-full rounded-full bg-primary" style={{ width: `${c.pct}%` }} />
                      </div>
                      <span className="w-14 shrink-0 text-right tabular-nums text-muted-foreground">{formatPct(c.pct)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </PasoCard>

      {/* 4 · Calidad */}
      <PasoCard
        icon={ClipboardCheck}
        numero={4}
        titulo="Calidad"
        vacio={calidad.length === 0 && "Sin notas de calidad para este lote."}
      >
        {calidad.length > 0 && (
          <div className="space-y-2">
            {calidad.map((nota, i) => (
              <div key={`${nota.numero_lote}-${i}`} className="rounded-lg border border-[var(--glass-border)] bg-[var(--glass-bg)] px-3 py-2">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                  <span className="text-xs text-muted-foreground">{formatDate(nota.fecha)}{nota.hora ? ` · ${nota.hora}` : ""}</span>
                  <Badge variant="outline" className={cn("px-1.5 py-0 text-[11px]", CALIDAD_BADGE[nota.calidad] ?? "")}>{nota.calidad}</Badge>
                  {nota.defectos.length > 0 && (
                    <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{nota.defectos.join(", ")}</span>
                  )}
                </div>
                {nota.observacion && <p className="mt-1 text-xs text-muted-foreground">{nota.observacion}</p>}
              </div>
            ))}
          </div>
        )}
      </PasoCard>

      {/* Origen agrícola como pie: cierre del círculo */}
      {entrada?.finca && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Leaf className="h-3.5 w-3.5 text-success" />
          Origen: {entrada.finca}{entrada.parcela ? ` · ${entrada.parcela}` : ""} — {formatDate(entrada.fecha)}.
          <Warehouse className="ml-2 h-3.5 w-3.5" />
          {enCamara > 0 ? `${formatKg(enCamara)} aún en cámara.` : "Nada en cámara."}
        </p>
      )}
    </div>
  );
}

function PasoCard({ icon: Icon, numero, titulo, vacio, children }: {
  icon: typeof Truck;
  numero: number;
  titulo: string;
  vacio?: string | false;
  children?: React.ReactNode;
}) {
  return (
    <Card className="glass-accented overflow-hidden">
      <CardContent className="p-4 sm:p-5">
        <div className="mb-3 flex items-center gap-2.5">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-[var(--glass-border)] bg-[var(--glass-bg-strong)] text-xs font-bold text-primary">
            {numero}
          </div>
          <Icon className="h-4 w-4 text-primary" />
          <p className="text-sm font-semibold">{titulo}</p>
        </div>
        {vacio ? <p className="text-sm text-muted-foreground">{vacio}</p> : children}
      </CardContent>
    </Card>
  );
}

function DatoLinea({ label, valor, destacado = false }: { label: string; valor: string; destacado?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={cn("mt-0.5 truncate text-sm", destacado ? "font-bold tabular-nums" : "font-medium")}>{valor}</p>
    </div>
  );
}

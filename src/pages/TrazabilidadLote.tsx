// src/pages/TrazabilidadLote.tsx
// Trazabilidad por lote: de la finca al destino. Busca un lote (o llega con
// ?lote= desde Entradas/Análisis) y muestra la cadena completa como una línea
// de tiempo vertical de 5 pasos: Entrada (báscula) → Procesado (calibrador) →
// Clasificación y destino (Informe LOTE) → Calidad → Expedición (palets del
// histórico importado). Cada paso puede faltar y la ficha lo indica apagando
// su nodo y cortando la línea en discontinua; Expedición además puede estar
// oculto del todo si la columna palets_dia.lote_codigo aún no existe.
//
// La búsqueda acepta además el código tal cual va impreso en el palet/la
// malla (NN+AAMMDD, formato del programa de palets) y lo voltea al canónico;
// y cuando el cruce palets↔entrada es imposible (fruta de cámara: el NN del
// palet es lote de CONFECCIÓN, no de entrada) la ficha lo avisa y ofrece los
// volcados del día como origen probable (ver src/lib/origenConfeccion.ts).
import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import {
  AlertTriangle, ArrowLeft, ArrowRight, Boxes, Calendar as CalendarIcon, CalendarDays, ChevronLeft, ChevronRight, ClipboardCheck, Factory, HelpCircle, Lock, LockOpen, Leaf, Scale, Search, Ship, StickyNote, Truck, Warehouse, X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CerrarLoteDialog } from "@/components/CerrarLoteDialog";
import { FuenteBadge, fuentePodridoAVariant } from "@/components/FuenteBadge";
import { InfoTooltip } from "@/components/InfoTooltip";
import { ProgressBarRow } from "@/components/ProgressBarRow";
import { SortableTableHead, toggleSort, type SortDir } from "@/components/SortableColumn";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthProvider";
import { useDiaTrazabilidad } from "@/hooks/useDiaTrazabilidad";
import { useEntradasBascula } from "@/hooks/useEntradasBascula";
import { useMermaLote } from "@/hooks/useMermaLote";
import { useTrazabilidadLote } from "@/hooks/useTrazabilidadLote";
import {
  DIAS_SIN_ACTIVIDAD_TERMINADO,
  esRestoEnCamaraRelevante,
  UMBRAL_PROBABLE_TERMINADO,
  type CierreModo,
  type StockLoteRow,
} from "@/lib/entradasBascula";
import { errorMessage } from "@/lib/errorMessage";
import { formatDate, formatKgCompact as formatKg, formatNumber, formatPct, today } from "@/lib/format";
import type { MermaLote } from "@/lib/mermaLote";
import { interpretarCodigoLote, type MotivoIncoherenciaExpedicion } from "@/lib/origenConfeccion";
import type { OrigenConfeccionLote } from "@/hooks/useTrazabilidadLote";
import { productorNoCoincide } from "@/lib/productoresCanonicos";
import { GRUPO_COLORS } from "@/lib/destinoClasificacion";
import {
  desplazarFecha,
  esNotaOperarioLote,
  filtrarLotesSelector,
  ordenarLotesSelector,
  variedadesDisponibles,
  type EstadoFiltroLotes,
  type LoteSortKey,
} from "@/lib/trazabilidadSelector";
import { barFill } from "@/lib/chartTheme";
import { cn } from "@/lib/utils";

const CALIDAD_BADGE: Record<string, string> = {
  Excelente: "border-emerald-600/35 bg-emerald-600/12 text-emerald-800 dark:text-emerald-200",
  Bueno: "border-emerald-500/30 bg-emerald-500/12 text-emerald-700 dark:text-emerald-300",
  Regular: "border-amber-500/35 bg-amber-500/14 text-amber-700 dark:text-amber-300",
  Deficiente: "border-orange-500/35 bg-orange-500/14 text-orange-700 dark:text-orange-300",
  Pésimo: "border-red-500/35 bg-red-500/12 text-red-700 dark:text-red-300",
};

// Orden compartido por el selector y por la navegación ←/→ de la ficha:
// activos primero (lo que sigue en cámara es lo que más se consulta), luego
// por fecha de entrada descendente.
function compararLotesActivosPrimero(a: StockLoteRow, b: StockLoteRow): number {
  const activoA = a.estado !== "procesado" ? 0 : 1;
  const activoB = b.estado !== "procesado" ? 0 : 1;
  return activoA - activoB || b.fecha_entrada.localeCompare(a.fecha_entrada);
}

export default function TrazabilidadLote() {
  const [searchParams, setSearchParams] = useSearchParams();
  // interpretarCodigoLote (no normalizarLoteCodigo): un enlace con el código
  // en formato palet (NN+AAMMDD) también debe abrir la ficha canónica.
  const loteParam = interpretarCodigoLote(searchParams.get("lote")).codigo;
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
        <FichaLote lote={loteParam} onBack={() => seleccionarLote(null)} onSelect={seleccionarLote} />
      ) : (
        <SelectorLotes search={search} onSearchChange={setSearch} onSelect={seleccionarLote} />
      )}
    </div>
  );
}

// ─── Selector (rediseño 21-jul-2026): tabla filtrable + modo "Por día" ───────
// Antes: rejilla de tarjetas (60 primeras, sin orden útil ni filtros) —
// encontrar un lote era "un infierno". Ahora: (1) tabla ordenable con filtros
// de estado/variedad y texto libre, y (2) modo "Por día de confección": eliges
// una fecha y ves los volcados del calibrador y la confección/expedición por
// cliente de ese día — el flujo real de una reclamación (compra el día X, la
// fruta lleva ≤3 días → mira los días X−1..X−3).

const ESTADO_FILTRO_LABEL: Record<EstadoFiltroLotes, string> = {
  todos: "Todos",
  camara: "En cámara",
  procesados: "Procesados",
};

const MAX_FILAS_TABLA = 300;

function SelectorLotes({ search, onSearchChange, onSelect }: {
  search: string;
  onSearchChange: (v: string) => void;
  onSelect: (lote: string) => void;
}) {
  const { stock, calidadLotes, isLoading, error } = useEntradasBascula();
  const [modo, setModo] = useState<"lotes" | "dia">("lotes");
  const [estado, setEstado] = useState<EstadoFiltroLotes>("todos");
  const [variedad, setVariedad] = useState<string>("");
  const [sortKey, setSortKey] = useState<LoteSortKey>("fecha_entrada");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [fechaDia, setFechaDia] = useState<string>(() => today());

  const variedades = useMemo(() => variedadesDisponibles(stock.filas), [stock.filas]);

  const filas = useMemo(
    () => ordenarLotesSelector(
      filtrarLotesSelector(stock.filas, { texto: search, estado, variedad }, calidadLotes.notasPorLote),
      sortKey,
      sortDir,
      calidadLotes.pctIndustriaPorLote,
    ),
    [stock.filas, search, estado, variedad, sortKey, sortDir, calidadLotes],
  );

  // Si teclean un código de lote completo que no está en la lista (lote antiguo
  // sin entrada de báscula, o el código impreso en un palet/malla en formato
  // NN+AAMMDD), se ofrece abrirlo igualmente — volteado al canónico si hace falta.
  const interpretado = interpretarCodigoLote(search);
  const loteDirecto = interpretado.codigo;
  const loteDirectoEnLista = loteDirecto ? filas.some((f) => f.lote === loteDirecto) : false;

  const lotesActivos = stock.lotesPendientes + stock.lotesParciales;
  // Al cambiar de columna: numéricas de mayor a menor (lo gordo primero),
  // fecha de entrada la más reciente primero, texto alfabético.
  const onToggleSort = (k: LoteSortKey) => toggleSort(k, sortKey, sortDir, setSortKey, setSortDir,
    (key) => (key === "lote" || key === "finca" || key === "articulo" ? "asc" : "desc"));

  return (
    <div className="space-y-4">
      <div className="glass-overlay sticky top-[calc(3.5rem+1rem)] z-10 rounded-xl p-3 sm:top-[calc(4rem+1.25rem)]">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Lote (26051407), código del palet (07260510), finca, variedad o agricultor…"
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
          className="flex w-full flex-wrap items-center gap-2 rounded-xl border border-info/30 bg-info/10 px-4 py-3 text-left text-sm transition-colors hover:bg-info/15"
        >
          <Search className="h-4 w-4 shrink-0 text-info" />
          Abrir la trazabilidad del lote <span className="font-semibold tabular-nums">{loteDirecto}</span>
          {interpretado.eraFormatoPalet && (
            <span className="text-xs text-muted-foreground">
              (leído desde el formato del palet: lote {Number(loteDirecto.slice(6))} del día {loteDirecto.slice(4, 6)}/{loteDirecto.slice(2, 4)})
            </span>
          )}
          <ArrowRight className="ml-auto h-4 w-4 text-info" />
        </button>
      )}

      <Tabs value={modo} onValueChange={(v) => setModo(v as "lotes" | "dia")} className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <TabsList>
            <TabsTrigger value="lotes"><Warehouse className="mr-1.5 h-3.5 w-3.5" /> Lotes</TabsTrigger>
            <TabsTrigger value="dia"><CalendarDays className="mr-1.5 h-3.5 w-3.5" /> Por día de confección</TabsTrigger>
          </TabsList>
          {!isLoading && !error && (
            <span className="text-xs text-muted-foreground">
              <span className="font-semibold tabular-nums text-foreground">{lotesActivos}</span> lotes activos
              {" · "}
              <span className="font-semibold tabular-nums text-foreground">{formatKg(stock.kgEnCamara)}</span> en cámara
              {" · "}
              <Link to="/entradas" className="font-medium text-info hover:underline">Gestionar entradas →</Link>
            </span>
          )}
        </div>

        <TabsContent value="lotes" className="mt-0 space-y-3">
          <div className="glass flex flex-wrap items-center gap-2 rounded-xl p-2.5">
            <div className="glass flex overflow-hidden rounded-lg">
              {(Object.keys(ESTADO_FILTRO_LABEL) as EstadoFiltroLotes[]).map((e) => (
                <button
                  key={e}
                  type="button"
                  onClick={() => setEstado(e)}
                  className={cn(
                    "px-3 py-1.5 text-xs font-medium transition-colors",
                    estado === e ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {ESTADO_FILTRO_LABEL[e]}
                </button>
              ))}
            </div>
            <Select value={variedad || "__todas__"} onValueChange={(v) => setVariedad(v === "__todas__" ? "" : v)}>
              <SelectTrigger className="glass glass-hover h-8 w-56 border-[var(--glass-border)] text-xs">
                <SelectValue placeholder="Todas las variedades" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__todas__">Todas las variedades</SelectItem>
                {variedades.map((v) => (
                  <SelectItem key={v} value={v}>{v}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="ml-auto text-xs tabular-nums text-muted-foreground">
              {formatNumber(filas.length)} lote(s)
            </span>
          </div>

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
                Sin lotes que coincidan con los filtros. También puedes teclear un código completo (8 dígitos, vale el del palet).
              </CardContent>
            </Card>
          ) : (
            <Card className="glass-accented">
              <CardContent className="max-h-[65vh] overflow-auto p-0">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-[var(--glass-bg-solid)] backdrop-blur-xl">
                  <TableRow className="text-xs">
                    <SortableTableHead label="Lote" sk="lote" sortKey={sortKey} sortDir={sortDir} onToggle={onToggleSort} />
                    <SortableTableHead label="Entrada" sk="fecha_entrada" sortKey={sortKey} sortDir={sortDir} onToggle={onToggleSort} />
                    <SortableTableHead label="Finca" sk="finca" sortKey={sortKey} sortDir={sortDir} onToggle={onToggleSort} />
                    <SortableTableHead label="Variedad" sk="articulo" sortKey={sortKey} sortDir={sortDir} onToggle={onToggleSort} />
                    <SortableTableHead label="Kg entrada" sk="kg_entrada" right sortKey={sortKey} sortDir={sortDir} onToggle={onToggleSort} />
                    <SortableTableHead label="Procesado" sk="pct_procesado" right sortKey={sortKey} sortDir={sortDir} onToggle={onToggleSort} />
                    <SortableTableHead label="En cámara" sk="kg_en_camara" right sortKey={sortKey} sortDir={sortDir} onToggle={onToggleSort} />
                    <SortableTableHead label="% Ind." sk="pct_industria" right sortKey={sortKey} sortDir={sortDir} onToggle={onToggleSort} info="Destrío a industria del lote (kg_industria de sus pasadas / kg procesados). En ámbar si supera claramente la media de su variedad — señal de fruta problemática. '—' = sin dato en el parte." />
                    <SortableTableHead label="Días" sk="dias_en_camara" right sortKey={sortKey} sortDir={sortDir} onToggle={onToggleSort} info="Días desde la entrada hasta hoy (activos) o hasta la última pasada del calibrador (procesados)." />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filas.slice(0, MAX_FILAS_TABLA).map((f, i) => {
                    const pct = f.kg_entrada > 0 ? (f.kg_procesado / f.kg_entrada) * 100 : 0;
                    const pctInd = calidadLotes.pctIndustriaPorLote.get(f.lote);
                    const mediaInd = f.articulo ? calidadLotes.mediaIndustriaPorVariedad.get(f.articulo.trim()) : undefined;
                    // "Alto" solo con margen real: 1,5× la media de su variedad Y
                    // al menos 3 puntos por encima (evita falsos ámbar con medias minúsculas).
                    const indAlta = pctInd != null && mediaInd != null && pctInd > mediaInd * 1.5 && pctInd - mediaInd > 0.03;
                    const tieneNota = calidadLotes.notasPorLote.has(f.lote);
                    return (
                      <TableRow
                        key={f.lote}
                        className={cn(
                          "cursor-pointer text-sm transition-colors hover:bg-[var(--glass-bg-strong)]",
                          i % 2 === 1 && "bg-[var(--glass-bg)]/40",
                        )}
                        onClick={() => onSelect(f.lote)}
                      >
                        <TableCell className="py-2">
                          <span className="font-semibold tabular-nums">{f.lote}</span>
                          {tieneNota && (
                            <StickyNote
                              className="ml-1 inline h-3 w-3 text-info"
                              aria-label="Con nota del operario"
                              // title nativo: el texto completo de la(s) nota(s) al pasar el ratón
                              {...{ title: calidadLotes.notasPorLote.get(f.lote) }}
                            />
                          )}
                          {f.probablementeTerminado && (
                            <HelpCircle className="ml-1 inline h-3 w-3 text-warning" aria-label="Probablemente terminado" />
                          )}
                        </TableCell>
                        <TableCell className="whitespace-nowrap py-2 tabular-nums text-muted-foreground">{formatDate(f.fecha_entrada)}</TableCell>
                        <TableCell className="max-w-44 truncate py-2">{f.finca ?? "—"}</TableCell>
                        <TableCell className="max-w-44 truncate py-2 text-xs text-muted-foreground">{f.articulo ?? "—"}</TableCell>
                        <TableCell className="py-2 text-right tabular-nums">{formatKg(f.kg_entrada)}</TableCell>
                        <TableCell className="py-2 text-right">
                          <span className={cn("tabular-nums text-xs font-medium", pct >= 99.5 ? "text-success" : "text-muted-foreground")}>
                            {formatPct(Math.min(100, pct))}
                          </span>
                        </TableCell>
                        <TableCell className="py-2 text-right">
                          {f.estado !== "procesado" ? (
                            <Badge variant="outline" className="border-info/40 bg-info/10 px-1.5 py-0 text-[11px] tabular-nums text-info">
                              {formatKg(f.kg_en_camara)}
                            </Badge>
                          ) : (
                            <span className="text-[11px] text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="py-2 text-right">
                          {pctInd != null ? (
                            <span className={cn("text-xs tabular-nums", indAlta ? "font-semibold text-warning" : "text-muted-foreground")}>
                              {indAlta && <AlertTriangle className="mr-0.5 inline h-3 w-3" />}
                              {formatPct(pctInd * 100)}
                            </span>
                          ) : (
                            <span className="text-[11px] text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="py-2 text-right tabular-nums text-muted-foreground">{f.dias_en_camara}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              </CardContent>
            </Card>
          )}
          {filas.length > MAX_FILAS_TABLA && (
            <p className="text-xs text-muted-foreground">
              Mostrando {MAX_FILAS_TABLA} de {formatNumber(filas.length)} — afina el texto o los filtros para ver el resto.
            </p>
          )}
        </TabsContent>

        <TabsContent value="dia" className="mt-0">
          <DiaConfeccionPanel fecha={fechaDia} onFecha={setFechaDia} onSelect={onSelect} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─── Modo "Por día": volcados + confección/expedición de una fecha ───────────

function DiaConfeccionPanel({ fecha, onFecha, onSelect }: {
  fecha: string;
  onFecha: (f: string) => void;
  onSelect: (lote: string) => void;
}) {
  const { data, isLoading, error } = useDiaTrazabilidad(fecha);
  // Calendario con el glass UI de la casa (mismo patrón Popover+Calendar que
  // PartesList), en vez del datepicker nativo del navegador.
  const [calendarioAbierto, setCalendarioAbierto] = useState(false);

  return (
    <div className="space-y-3">
      <div className="glass flex flex-wrap items-center gap-2 rounded-xl p-2.5">
        <Button variant="outline" size="icon" className="glass glass-hover h-8 w-8" onClick={() => onFecha(desplazarFecha(fecha, -1))} aria-label="Día anterior">
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Popover open={calendarioAbierto} onOpenChange={setCalendarioAbierto}>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="glass glass-hover h-8 w-44 justify-start gap-1.5 font-normal">
              <CalendarIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="tabular-nums text-xs">{format(parseISO(fecha), "EEEE d MMM yyyy", { locale: es })}</span>
            </Button>
          </PopoverTrigger>
          <PopoverContent className="glass-accented w-auto p-0" align="start">
            <Calendar
              mode="single"
              selected={parseISO(fecha)}
              onSelect={(d) => {
                if (d) {
                  onFecha(format(d, "yyyy-MM-dd"));
                  setCalendarioAbierto(false);
                }
              }}
              locale={es}
              initialFocus
            />
          </PopoverContent>
        </Popover>
        <Button variant="outline" size="icon" className="glass glass-hover h-8 w-8" onClick={() => onFecha(desplazarFecha(fecha, 1))} aria-label="Día siguiente">
          <ChevronRight className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="sm" className="h-8 px-2 text-xs" onClick={() => onFecha(today())}>Hoy</Button>
        {data && data.partIds.length > 0 && (
          <Link to={`/partes/${data.partIds[0]}`} className="ml-auto text-xs text-info hover:underline">
            Ver parte del día →
          </Link>
        )}
      </div>

      {isLoading ? (
        <Skeleton className="h-72 w-full" />
      ) : error ? (
        <Card className="glass-accented border-destructive/30">
          <CardContent className="flex items-center gap-3 py-6 text-destructive">
            <AlertTriangle className="h-5 w-5 shrink-0" />
            <p className="text-sm font-semibold">{errorMessage(error)}</p>
          </CardContent>
        </Card>
      ) : !data || data.partIds.length === 0 ? (
        <Card className="glass-accented">
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            Sin parte registrado el {formatDate(fecha)}: ese día no hay volcados ni confección que enseñar.
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="flex flex-wrap gap-x-5 gap-y-1 px-1 text-xs text-muted-foreground">
            <span><span className="font-semibold tabular-nums text-foreground">{formatKg(data.kgVolcados)}</span> volcados al calibrador</span>
            <span><span className="font-semibold tabular-nums text-foreground">{formatKg(data.kgExpedidos)}</span> confeccionados</span>
            <span><span className="font-semibold tabular-nums text-foreground">{formatNumber(data.paletsCount)}</span> palets</span>
            {data.paletsPrecalibrado > 0 && <span>{formatNumber(data.paletsPrecalibrado)} palets internos de precalibrado</span>}
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            {/* Volcados del día → cada uno abre la ficha de SU lote (la fruta real) */}
            <Card className="glass-accented">
              <CardContent className="space-y-1.5 p-4">
                <p className="mb-1 flex items-center gap-1.5 text-sm font-semibold">
                  <Factory className="h-4 w-4 text-primary" /> Volcados al calibrador
                </p>
                {data.volcados.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Sin volcados registrados ese día.</p>
                ) : data.volcados.map((v) => {
                  const contenido = (
                    <>
                      <span className="w-6 shrink-0 text-center text-xs font-semibold tabular-nums text-muted-foreground">{v.numero}º</span>
                      <span className="tabular-nums text-sm font-semibold">{formatKg(v.kg)}</span>
                      {v.hora_inicio && <span className="text-xs tabular-nums text-muted-foreground">{v.hora_inicio.slice(0, 5)} h</span>}
                      {v.productor && <span className="min-w-0 truncate text-xs">{v.productor}</span>}
                      {v.producto && <span className="min-w-0 truncate text-xs text-muted-foreground">{v.producto}</span>}
                      {v.esPrecalibrado && (
                        <Badge
                          variant="outline"
                          className="border-[var(--glass-border)] bg-muted px-1.5 py-0 text-[10px] font-normal text-muted-foreground"
                          title="Fruta reintroducida desde precalibrado; cuenta como procesado del lote, no como productor."
                        >
                          precalibrado
                        </Badge>
                      )}
                      {(v.kg_industria ?? 0) > 0 && (
                        <span className="text-xs tabular-nums font-medium text-warning">{formatKg(v.kg_industria as number)} ind.</span>
                      )}
                      {v.codigo && <ArrowRight className="ml-auto h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                      {esNotaOperarioLote(v.notas) && (
                        <span className="flex w-full items-start gap-1.5 text-xs text-muted-foreground">
                          <StickyNote className="mt-0.5 h-3 w-3 shrink-0 text-info" />
                          <span className="min-w-0">{v.notas}</span>
                        </span>
                      )}
                    </>
                  );
                  const clase = "flex w-full flex-wrap items-center gap-x-3 gap-y-0.5 rounded-md border border-[var(--glass-border)] bg-[var(--glass-bg)] px-2.5 py-1.5 text-left";
                  return v.codigo ? (
                    <button
                      key={`${v.codigo}-${v.numero}`}
                      type="button"
                      onClick={() => onSelect(v.codigo as string)}
                      className={cn(clase, "transition-colors hover:bg-[var(--glass-bg-strong)]")}
                      title={v.lote_codigo ?? undefined}
                    >
                      {contenido}
                    </button>
                  ) : (
                    <div key={`v-${v.numero}`} className={clase} title={v.lote_codigo ?? undefined}>{contenido}</div>
                  );
                })}
              </CardContent>
            </Card>

            {/* Confección/expedición del día, por lote de confección y cliente */}
            <Card className="glass-accented">
              <CardContent className="space-y-1.5 p-4">
                <p className="mb-1 flex items-center gap-1.5 text-sm font-semibold">
                  <Ship className="h-4 w-4 text-primary" /> Confección y expedición
                </p>
                {!data.expedicionDisponible ? (
                  <p className="text-sm text-muted-foreground">No disponible: falta la columna palets_dia.lote_codigo.</p>
                ) : data.expedicion.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Sin palets registrados ese día.</p>
                ) : data.expedicion.map((e, i) => {
                  const cuerpo = (
                    <>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
                        <span className="text-sm font-semibold tabular-nums">
                          {e.lote_codigo ?? "Sin lote"}
                        </span>
                        {e.numeroDelDia != null && (
                          <span className="text-[11px] text-muted-foreground">lote {e.numeroDelDia} del día</span>
                        )}
                        <span className="tabular-nums text-xs text-muted-foreground">
                          {formatKg(e.kg)} · {formatNumber(e.paletsCount)} palet(s)
                        </span>
                        {e.lote_codigo && <ArrowRight className="ml-auto h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                      </div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {e.clientes.slice(0, 6).map((c) => (
                          <Badge key={c.cliente} variant="outline" className="border-[var(--glass-border)] bg-[var(--glass-bg)] px-1.5 py-0 text-[10px] font-normal">
                            {c.cliente} · {formatKg(c.kg)}
                          </Badge>
                        ))}
                        {e.clientes.length > 6 && (
                          <span className="text-[10px] text-muted-foreground">+{e.clientes.length - 6} más</span>
                        )}
                      </div>
                    </>
                  );
                  const clase = "w-full rounded-md border border-[var(--glass-border)] bg-[var(--glass-bg)] px-2.5 py-1.5 text-left";
                  return e.lote_codigo ? (
                    <button
                      key={e.lote_codigo}
                      type="button"
                      onClick={() => onSelect(e.lote_codigo as string)}
                      className={cn(clase, "transition-colors hover:bg-[var(--glass-bg-strong)]")}
                    >
                      {cuerpo}
                    </button>
                  ) : (
                    <div key={`sin-lote-${i}`} className={clase}>{cuerpo}</div>
                  );
                })}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Ficha del lote: los 4 pasos de la cadena, como línea de tiempo ─────────

function FichaLote({ lote, onBack, onSelect }: { lote: string; onBack: () => void; onSelect: (lote: string) => void }) {
  const { data, isLoading, error } = useTrazabilidadLote(lote);
  const { stock, conciliacionKg, calidadLotes, cerrarLote, reabrirLote } = useEntradasBascula();

  // Navegación ←/→: mismo orden que el selector. Si el lote actual no está en
  // la lista (código antiguo tecleado a mano), se oculta la navegación.
  const ordenLotes = useMemo(() => [...stock.filas].sort(compararLotesActivosPrimero), [stock.filas]);
  const indiceActual = ordenLotes.findIndex((f) => f.lote === lote);
  const mostrarNav = indiceActual !== -1;
  const loteAnterior = mostrarNav && indiceActual > 0 ? ordenLotes[indiceActual - 1] : null;
  const loteSiguiente = mostrarNav && indiceActual < ordenLotes.length - 1 ? ordenLotes[indiceActual + 1] : null;

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

  const { entrada, procesado, kgProcesado, clasificacion, calidad, expedicion, origenConfeccion, entradaEsPrecalibrado, entradaEsCampoCit } = data;
  const kgEntrada = entrada ? Number(entrada.kg_entrada) || 0 : 0;
  const kgAjuste = entrada ? Number(entrada.kg_ajuste_stock) || 0 : 0;
  // Conciliación de kg (ver src/lib/conciliacionKg.ts): el procesado
  // conciliado del lote puede diferir de la suma cruda de sus pasadas — por
  // kg recibidos/cedidos (pasadas que mezclan lotes), reciclaje descontado o
  // exceso enviado a revisión. Para cabecera y "en cámara" se usa el
  // conciliado (mismos números que la lista de stock/Entradas); el paso 2
  // sigue listando las pasadas crudas con una nota si hay diferencia.
  const filaConciliada = conciliacionKg?.procesados.find((p) => p.lote_codigo === data.lote);
  const conciliacionCargada = (conciliacionKg?.procesados.length ?? 0) > 0;
  // Boxes de reciclaje anotados en las pasadas de ESTE lote (descontados a
  // ~30 kg/box por la conciliación: fruta que vuelve de la línea, ya contada).
  const reciclajeLote = (conciliacionKg?.reciclaje ?? []).filter((r) => r.lote === data.lote);
  const boxesLote = reciclajeLote.reduce((s, r) => s + r.nBox, 0);
  const kgBoxesLote = reciclajeLote.reduce((s, r) => s + r.kg, 0);
  const kgProcesadoConciliado = filaConciliada
    ? filaConciliada.kg_peso_total
    : conciliacionCargada && entrada
      ? 0 // entrada conocida sin ninguna asignación conciliada: nada procesado
      : kgProcesado; // conciliación aún sin cargar, o código sin entrada: se muestra el crudo
  const difConciliacion = kgProcesadoConciliado - kgProcesado;
  const enCamara = Math.max(0, kgEntrada - kgProcesadoConciliado - kgAjuste);
  const pctProcesado = kgEntrada > 0 ? (kgProcesadoConciliado / kgEntrada) * 100 : null;
  // Destrío a industria del lote como señal de calidad medible, comparado con
  // la media ponderada de su variedad (calidadLotes, useEntradasBascula).
  // "Alto" solo con margen real: 1,5× la media Y ≥3 puntos por encima.
  const kgIndustriaLote = procesado.reduce((s, p) => s + p.kg_industria, 0);
  const pctIndustriaLote = kgProcesado > 0 ? kgIndustriaLote / kgProcesado : 0;
  const mediaIndustriaVariedad = entrada?.articulo
    ? calidadLotes.mediaIndustriaPorVariedad.get(entrada.articulo.trim())
    : undefined;
  const industriaAlta = kgIndustriaLote > 0
    && mediaIndustriaVariedad != null
    && pctIndustriaLote > mediaIndustriaVariedad * 1.5
    && pctIndustriaLote - mediaIndustriaVariedad > 0.03;
  const destinoPrincipal = clasificacion.grupos.length > 0
    ? [...clasificacion.grupos].sort((a, b) => b.pct - a.pct)[0]
    : null;
  const ultimaCalidad = calidad[0];
  // "Sin nada" de verdad: tampoco hay palets ni origen de confección que
  // enseñar (un código de confección huérfano — p. ej. 26070803 tecleado como
  // 03260708 desde la etiqueta — SÍ tiene algo que contar: los volcados del día).
  const sinNada = !entrada && procesado.length === 0 && clasificacion.kgClasificado === 0 && calidad.length === 0
    && !origenConfeccion && (expedicion?.paletsCount ?? 0) === 0 && (expedicion?.paletsPrecalibrado ?? 0) === 0;

  // Aviso discreto (no bloquea nada): la báscula y el calibrador apuntan a
  // productores distintos para el mismo lote. Compara por id si ambos lo
  // tienen resuelto (catálogo), si no por texto normalizado. Las pasadas de
  // precalibrado no cuentan para este aviso: su "productor" es el
  // pseudo-productor PRECALIBRADO, no una discrepancia real.
  const procesadoNoCoincide = entrada
    ? procesado.find((p) => !p.esPrecalibrado && productorNoCoincide(
        { id: entrada.productor_id, nombre: entrada.agricultor },
        { id: p.productor_id, nombre: p.productor },
      ))
    : undefined;
  // Nombres de productor para los enlaces del aviso de discrepancia (constantes
  // locales, no accedidas por optional chaining dentro del JSX).
  const agricultorBascula = entrada?.agricultor || null;
  const agricultorCalibrador = procesadoNoCoincide?.productor || null;

  // ─── Cierre manual del lote (decisión del dueño, 2026-07-15) ───────────────
  // "No procesado" se lee del estado ya calculado por buildStockEntradas (el
  // mismo criterio de umbral que el resto de la app), no de un recálculo local.
  const cerradoManualmente = Boolean(entrada?.cerrado_at);
  const filaStock = stock.filas.find((f) => f.lote === data.lote);
  const puedeCerrar = Boolean(entrada) && !cerradoManualmente && filaStock != null && filaStock.estado !== "procesado";

  const handleCerrar = (cierreModo: CierreModo) => {
    if (!entrada) return;
    cerrarLote.mutate({ id: entrada.id, cierreModo }, {
      onSuccess: () => toast({ title: "Lote cerrado", description: `El lote ${data.lote} se ha dado por terminado.` }),
      onError: (e) => toast({ title: "No se pudo cerrar el lote", description: errorMessage(e), variant: "destructive" }),
    });
  };

  const handleReabrir = () => {
    if (!entrada) return;
    reabrirLote.mutate(entrada.id, {
      onSuccess: () => toast({ title: "Lote reabierto", description: `El lote ${data.lote} vuelve a estar activo.` }),
      onError: (e) => toast({ title: "No se pudo reabrir el lote", description: errorMessage(e), variant: "destructive" }),
    });
  };

  return (
    <div className="space-y-4">
      {/* Cabecera del lote */}
      <div className="glass-accented rounded-xl px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <Button variant="ghost" size="sm" className="-ml-2 h-7 px-2" onClick={onBack}>
            <ArrowLeft className="h-3.5 w-3.5" /> Lotes
          </Button>
          <Link to="/entradas" className="text-xs text-muted-foreground hover:text-foreground hover:underline">
            Entradas
          </Link>
          <h2 className="text-base font-bold tabular-nums">Lote {data.lote}</h2>
          {entradaEsPrecalibrado && (
            <Badge
              variant="outline"
              className="border-warning/40 bg-warning/10 px-1.5 py-0 text-[11px] text-warning"
              title="Movimiento interno de báscula al almacén de precalibrado: fruta que ya entró y se aparta para volver a pasarla, no una entrada de campo. No cuenta para el stock ni el coste de compra."
            >
              Movimiento interno de precalibrado
            </Badge>
          )}
          {entradaEsCampoCit && (
            <Badge
              variant="outline"
              className="border-amber-500/40 bg-amber-500/10 px-1.5 py-0 text-[11px] text-amber-800 dark:text-amber-200"
              title="Fruta comprada cuyo artículo lleva CAMPO/CIT: se deriva a Cítrica sin pasar por el calibrador de la central. No cuenta como stock ni como merma/forfait (no es una pérdida), pero su coste de compra sí cuenta en Económico → Fruta."
            >
              Derivado a Cítrica · no procesa en central
            </Badge>
          )}
          {entrada?.articulo && <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">{entrada.articulo}</Badge>}
          {entrada && esRestoEnCamaraRelevante(enCamara, kgEntrada) ? (
            <Badge variant="outline" className="border-info/40 bg-info/10 px-1.5 py-0 text-[11px] text-info">
              {formatKg(enCamara)} en cámara
            </Badge>
          ) : entrada ? (
            <Badge variant="outline" className="border-[var(--glass-border)] px-1.5 py-0 text-[11px] text-muted-foreground">
              Procesado
            </Badge>
          ) : null}
          {filaStock?.probablementeTerminado && (
            <Badge
              variant="outline"
              className="border-warning/40 bg-warning/10 px-1.5 py-0 text-[11px] text-warning"
              title={`Lleva el ${formatPct(UMBRAL_PROBABLE_TERMINADO * 100)} o más procesado y ${DIAS_SIN_ACTIVIDAD_TERMINADO} días o más sin ninguna pasada del calibrador — probablemente el hueco es merma/podrido, no fruta pendiente. Se desmarca solo en cuanto llegue una pasada nueva.`}
            >
              <HelpCircle className="mr-1 h-3 w-3" /> ¿Terminado?
            </Badge>
          )}

          {mostrarNav && (
            <div className="ml-auto flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                disabled={!loteAnterior}
                onClick={() => loteAnterior && onSelect(loteAnterior.lote)}
                aria-label="Lote anterior"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-[11px] tabular-nums text-muted-foreground">
                {indiceActual + 1} de {ordenLotes.length}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                disabled={!loteSiguiente}
                onClick={() => loteSiguiente && onSelect(loteSiguiente.lote)}
                aria-label="Lote siguiente"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>

        {/* Tira de flujo: Finca/Entrada → Calibrador → Destino principal → Calidad */}
        {entrada && (
          <div className="mt-2 grid grid-cols-2 gap-2 border-t border-[var(--glass-border)] pt-2 sm:flex sm:flex-nowrap sm:items-stretch sm:gap-0">
            <FlowEtapa label="Finca / Entrada" value={formatKg(kgEntrada)} sub={entrada.finca ?? undefined} />
            <FlowFlecha />
            <FlowEtapa
              label="Calibrador"
              value={formatKg(kgProcesadoConciliado)}
              valueClass={pctProcesado != null && pctProcesado >= 99.5 ? "text-success" : undefined}
              sub={pctProcesado != null ? formatPct(pctProcesado) : undefined}
              nota={esRestoEnCamaraRelevante(enCamara, kgEntrada) ? `${formatKg(enCamara)} en cámara` : undefined}
              notaClass="text-warning"
            />
            <FlowFlecha />
            <FlowEtapa
              label="Destino principal"
              value={destinoPrincipal ? destinoPrincipal.grupo : "—"}
              valueStyle={destinoPrincipal ? { color: GRUPO_COLORS[destinoPrincipal.grupo] ?? GRUPO_COLORS.Otro } : undefined}
              sub={destinoPrincipal ? formatPct(destinoPrincipal.pct) : undefined}
            />
            <FlowFlecha />
            <FlowEtapa label="Calidad">
              {ultimaCalidad ? (
                <Badge variant="outline" className={cn("mt-0.5 px-1.5 py-0.5 text-xs", CALIDAD_BADGE[ultimaCalidad.calidad] ?? "")}>
                  {ultimaCalidad.calidad}
                </Badge>
              ) : (
                <p className="mt-0.5 text-[18px] font-semibold leading-tight text-muted-foreground sm:text-[20px]">—</p>
              )}
            </FlowEtapa>
          </div>
        )}
      </div>

      {sinNada && (
        <Card className="glass-accented">
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No hay ningún registro para el lote {data.lote}: ni entrada de báscula, ni procesado, ni clasificación, ni calidad.
          </CardContent>
        </Card>
      )}

      {/* Línea de tiempo: 4 pasos conectados por nodo + línea (sólida con datos, discontinua sin ellos) */}
      <div>
        {/* 1 · Entrada */}
        <TimelinePaso
          icon={Truck}
          titulo="Entrada (báscula)"
          activo={Boolean(entrada)}
          vacio={!entrada && "Sin entrada de báscula registrada para este lote."}
          accion={entrada && (
            <div className="flex items-center gap-2">
              {cerradoManualmente ? (
                <>
                  <Badge variant="outline" className="border-[var(--glass-border)] bg-[var(--glass-bg)] px-1.5 py-0 text-[11px] text-muted-foreground">
                    <Lock className="mr-1 h-3 w-3" /> Cerrado a mano
                  </Badge>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
                    disabled={reabrirLote.isPending}
                    onClick={handleReabrir}
                  >
                    <LockOpen className="h-3 w-3" /> Reabrir
                  </Button>
                </>
              ) : puedeCerrar ? (
                <CerrarLoteDialog
                  lote={data.lote}
                  kgEntrada={kgEntrada}
                  kgProcesado={kgProcesadoConciliado + kgAjuste}
                  isPending={cerrarLote.isPending}
                  onConfirm={handleCerrar}
                  trigger={(
                    <Button variant="ghost" size="sm" className="h-6 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground">
                      <Lock className="h-3 w-3" /> Cerrar lote
                    </Button>
                  )}
                />
              ) : null}
              <Link to={`/entradas?lote=${data.lote}`} className="text-xs text-muted-foreground hover:text-foreground hover:underline">
                Ver en Entradas →
              </Link>
            </div>
          )}
        >
          {filaStock?.cerradoConActividadPosterior && (
            <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-2.5 py-1.5 text-xs text-destructive">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              <span>
                El calibrador registró una pasada DESPUÉS de cerrar este lote: la fruta volvió a línea, el cierre fue
                probablemente un error.
              </span>
              {cerradoManualmente && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="ml-auto h-6 gap-1 px-2 text-xs text-destructive hover:text-destructive"
                  disabled={reabrirLote.isPending}
                  onClick={handleReabrir}
                >
                  <LockOpen className="h-3 w-3" /> Reabrir
                </Button>
              )}
            </div>
          )}
          {entrada && (
            <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
              <DatoLinea label="Fecha de entrada" valor={formatDate(entrada.fecha)} />
              <DatoLinea label="Kg de entrada" valor={`${formatNumber(kgEntrada)} kg`} destacado />
              <DatoLinea label="Finca" valor={entrada.finca ?? "—"} />
              <DatoLinea label="Parcela" valor={entrada.parcela ?? "—"} />
              <DatoLinea
                label="Agricultor"
                valor={entrada.agricultor ? (
                  <Link to={`/productores?productor=${encodeURIComponent(entrada.agricultor)}`} className="text-info hover:underline">
                    {entrada.agricultor}
                  </Link>
                ) : "—"}
              />
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
        </TimelinePaso>

        {/* 2 · Procesado */}
        <TimelinePaso
          icon={Factory}
          titulo="Procesado (calibrador)"
          activo={procesado.length > 0}
          vacio={procesado.length === 0 && (enCamara > 0
            ? "Todavía sin procesar: el lote sigue en cámara."
            : "Sin registros de procesado en los partes (anterior al arranque de la herramienta).")}
        >
          {procesadoNoCoincide && (
            <div className="mb-3 flex flex-wrap items-center gap-1.5 rounded-lg border border-warning/40 bg-warning/10 px-2.5 py-1.5 text-xs text-warning">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              <span>
                ⚠ Productor no coincide entre báscula y calibrador:{" "}
                {agricultorBascula ? (
                  <Link to={`/productores?productor=${encodeURIComponent(agricultorBascula)}`} className="font-semibold text-info hover:underline">
                    {agricultorBascula}
                  </Link>
                ) : (
                  <span className="font-semibold">—</span>
                )} vs{" "}
                {agricultorCalibrador ? (
                  <Link to={`/productores?productor=${encodeURIComponent(agricultorCalibrador)}`} className="font-semibold text-info hover:underline">
                    {agricultorCalibrador}
                  </Link>
                ) : (
                  <span className="font-semibold">—</span>
                )}
              </span>
            </div>
          )}
          {procesado.length > 0 && (
            <div className="space-y-2">
              {procesado.map((p, i) => (
                <Link
                  key={`${p.part_id}-${i}`}
                  to={`/partes/${p.part_id}`}
                  className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-[var(--glass-border)] bg-[var(--glass-bg)] px-3 py-2 text-sm transition-colors hover:bg-[var(--glass-bg-strong)]"
                >
                  <span className="tabular-nums font-semibold">{formatKg(p.kg)}</span>
                  {p.esPrecalibrado && (
                    <Badge
                      variant="outline"
                      className="border-[var(--glass-border)] bg-muted px-1.5 py-0 text-[10px] font-normal text-muted-foreground"
                      title="Fruta reintroducida desde precalibrado; cuenta como procesado del lote, no como productor."
                    >
                      precalibrado
                    </Badge>
                  )}
                  {p.toneladas_hora != null && (
                    <span className="text-xs text-muted-foreground">{p.toneladas_hora.toFixed(1)} T/h</span>
                  )}
                  {p.duracion_min != null && (
                    <span className="text-xs text-muted-foreground">{formatNumber(p.duracion_min)} min</span>
                  )}
                  {p.productor && <span className="min-w-0 truncate text-xs text-muted-foreground">{p.productor}</span>}
                  {p.kg_industria > 0 && (
                    <span className="text-xs tabular-nums font-medium text-warning">{formatKg(p.kg_industria)} a industria</span>
                  )}
                  {p.kg_precalibrado > 0 && (
                    <span className="text-xs tabular-nums text-muted-foreground" title="Kg apartados a los almacenes de precalibrado 1+2 desde esta pasada (dato manual del parte / foto diaria).">
                      {formatKg(p.kg_precalibrado)} a PREC
                    </span>
                  )}
                  <ArrowRight className="ml-auto h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  {esNotaOperarioLote(p.notas) && (
                    <span className="flex w-full items-start gap-1.5 text-xs text-muted-foreground">
                      <StickyNote className="mt-0.5 h-3 w-3 shrink-0 text-info" />
                      <span className="min-w-0">{p.notas}</span>
                    </span>
                  )}
                </Link>
              ))}
              <p className="text-xs text-muted-foreground">
                Total procesado: <span className="font-semibold text-foreground tabular-nums">{formatKg(kgProcesado)}</span>
                {kgEntrada > 0 && <> · {formatPct((kgProcesado / kgEntrada) * 100)} de la entrada</>}
                {procesado.some((p) => p.esPrecalibrado) && <> · incluye pasadas de precalibrado</>}
                {" "}· clic en una fila para abrir su parte
              </p>
              {kgIndustriaLote > 0 && (
                <p className={cn(
                  "flex flex-wrap items-center gap-1.5 text-xs",
                  industriaAlta ? "font-medium text-warning" : "text-muted-foreground",
                )}>
                  {industriaAlta && <AlertTriangle className="h-3.5 w-3.5 shrink-0" />}
                  Destrío a industria: <span className="tabular-nums font-semibold">{formatKg(kgIndustriaLote)}</span>
                  {" "}({formatPct(pctIndustriaLote * 100)} de lo procesado)
                  {mediaIndustriaVariedad != null && (
                    <> · media de {entrada?.articulo}: <span className="tabular-nums">{formatPct(mediaIndustriaVariedad * 100)}</span></>
                  )}
                  {industriaAlta && <> — muy por encima de su variedad: señal objetiva de fruta problemática.</>}
                </p>
              )}
              {Math.abs(difConciliacion) > 1 && (
                <p
                  className="flex items-start gap-1.5 rounded-lg border border-info/30 bg-info/10 px-2.5 py-1.5 text-xs text-muted-foreground"
                  title="El calibrador atribuye cada pasada al primer código de lote de su nombre, pero en línea se mezclan lotes (varios camiones seguidos, boxes de reciclaje, precalibrado). La conciliación reparte esos kg entre los lotes implicados: primero los nombrados en la propia pasada, luego lotes con pendiente de la misma finca y variedad, luego misma variedad. Los datos crudos de las pasadas no se modifican."
                >
                  <Scale className="mt-0.5 h-3.5 w-3.5 shrink-0 text-info" />
                  <span>
                    Procesado conciliado: <span className="font-semibold text-foreground tabular-nums">{formatKg(kgProcesadoConciliado)}</span>{" "}
                    ({difConciliacion > 0 ? "recibe" : "cede"} <span className="tabular-nums">{formatKg(Math.abs(difConciliacion))}</span>{" "}
                    {difConciliacion > 0
                      ? "de pasadas del calibrador atribuidas a otros lotes"
                      : "hacia otros lotes, reciclaje o revisión: sus pasadas superan su entrada"}).
                    {boxesLote > 0 && (
                      <> Incluye <span className="font-semibold tabular-nums">{formatNumber(boxesLote)}</span> box de
                      reciclaje descontados (≈{formatKg(kgBoxesLote)}) anotados en sus pasadas.</>
                    )}
                    {" "}Cabecera, stock y "en cámara" usan este valor; la lista de arriba es el dato crudo del calibrador.
                    {" "}<Link to="/entradas?tab=conciliacion" className="text-info hover:underline">Ver conciliación completa →</Link>
                  </span>
                </p>
              )}
            </div>
          )}
        </TimelinePaso>

        {/* 3 · Clasificación y destino */}
        <TimelinePaso
          icon={Boxes}
          titulo="Clasificación y destino"
          activo={clasificacion.kgClasificado > 0}
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
                      <ProgressBarRow key={c.tamano} size="sm" label={c.tamano} pct={c.pct} value={formatPct(c.pct)} />
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
        </TimelinePaso>

        {/* 4 · Calidad */}
        <TimelinePaso
          icon={ClipboardCheck}
          titulo="Calidad"
          activo={calidad.length > 0}
          esUltimo={expedicion == null}
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
        </TimelinePaso>

        {/* 5 · Expedición (solo si palets_dia.lote_codigo existe: histórico de palets importado) */}
        {expedicion && (
          <TimelinePaso
            icon={Ship}
            titulo="Expedición"
            activo={expedicion.paletsCount > 0}
            esUltimo
            vacio={expedicion.paletsCount === 0 && expedicion.paletsPrecalibrado === 0 && !origenConfeccion
              && "Sin palets vinculados a este lote (solo disponible para lotes del histórico importado)."}
          >
            {(expedicion.paletsCount > 0 || expedicion.paletsPrecalibrado > 0 || origenConfeccion) && (
              <div className="space-y-3">
                {origenConfeccion && (
                  <OrigenConfeccionAviso
                    origen={origenConfeccion}
                    kgEntrada={kgEntrada}
                    kgExpedido={expedicion.kgNeto}
                    onSelect={onSelect}
                  />
                )}
                {expedicion.paletsCount > 0 ? (
                  <>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                      <DatoLinea label="Palets" valor={formatNumber(expedicion.paletsCount)} destacado />
                      <DatoLinea label="Kg netos" valor={formatKg(expedicion.kgNeto)} destacado />
                      <DatoLinea label="Cajas" valor={formatNumber(expedicion.cajas)} />
                    </div>
                    <div className="overflow-hidden rounded-lg border border-[var(--glass-border)]">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-[var(--glass-border)] bg-[var(--glass-bg)] text-left text-xs text-muted-foreground">
                            <th className="px-3 py-1.5 font-medium">Cliente</th>
                            <th className="px-3 py-1.5 text-right font-medium">Palets</th>
                            <th className="px-3 py-1.5 text-right font-medium">Kg</th>
                          </tr>
                        </thead>
                        <tbody>
                          {expedicion.clientes.map((c) => (
                            <tr key={c.cliente} className="border-b border-[var(--glass-border)] last:border-0">
                              <td className="min-w-0 truncate px-3 py-1.5">{c.cliente}</td>
                              <td className="px-3 py-1.5 text-right tabular-nums">{formatNumber(c.paletsCount)}</td>
                              <td className="px-3 py-1.5 text-right tabular-nums font-medium">{formatKg(c.kg)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">Sin palets de venta para este lote.</p>
                )}
                {expedicion.paletsPrecalibrado > 0 && (
                  <p
                    className="text-xs text-muted-foreground"
                    title="Palets de precalibrado: fruta apartada en almacenaje interno para volver a pasarla por línea. Es movimiento interno, no venta: no suma en los kg ni en los clientes de expedición."
                  >
                    {formatNumber(expedicion.paletsPrecalibrado)}{" "}
                    {expedicion.paletsPrecalibrado === 1 ? "palet interno" : "palets internos"} de precalibrado
                    {" "}({formatKg(expedicion.kgPrecalibrado)}) — no cuentan como expedición.
                  </p>
                )}
              </div>
            )}
          </TimelinePaso>
        )}
      </div>

      {/* Mermas y pérdidas: merma natural (medida + desglose natural/sin justificar) + podrido (real/estimado), en kg/%; el detalle en € vive solo en Económico */}
      {entrada && <MermasYPerdidasCard lote={data.lote} />}

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

// ─── Piezas de la línea de tiempo ────────────────────────────────────────────

function TimelinePaso({ icon: Icon, titulo, activo, esUltimo = false, vacio, accion, children }: {
  icon: typeof Truck;
  titulo: string;
  /** Con datos: nodo primary + línea sólida. Sin datos: nodo apagado + línea discontinua desde aquí. */
  activo: boolean;
  esUltimo?: boolean;
  vacio?: string | false;
  accion?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex gap-3 sm:gap-4">
      {/* Nodo + línea con el primary global (revertido del acento de
          Producción de fase 2 — calibración de color 2026-07-17: el
          timeline vuelve al primary estándar, azul medio desde el duotono
          2026-07-16). */}
      <div className="flex w-9 shrink-0 flex-col items-center sm:w-10">
        <div
          className={cn(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 sm:h-9 sm:w-9",
            activo
              ? "border-primary/40 bg-primary/10 text-primary"
              : "border-[var(--glass-border)] bg-muted text-muted-foreground",
          )}
        >
          <Icon className="h-4 w-4" />
        </div>
        {!esUltimo && (
          activo ? (
            <div className="w-px flex-1 bg-primary/40" />
          ) : (
            <div className="w-0 flex-1 border-l border-dashed border-muted-foreground/35" />
          )
        )}
      </div>
      <div className="min-w-0 flex-1 pb-4">
        <Card className="glass-accented overflow-hidden">
          <CardContent className="p-4 sm:p-5">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <p className="text-sm font-semibold">{titulo}</p>
              {accion && <span className="ml-auto">{accion}</span>}
            </div>
            {vacio ? <p className="text-sm text-muted-foreground">{vacio}</p> : children}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ─── Origen probable cuando el cruce palets↔entrada es imposible ─────────────
// El NN del lote del palet es el nº de ENTRADA en báscula de ese día (se
// asigna al dar entrada al camión — corrección del dueño, 21-jul-2026): con
// fruta de cámara apunta a una entrada interna (PREC) o a una ajena y NO
// identifica la fruta. El aviso lo explica y ofrece los volcados de ese día
// como candidatos, sin señalar ninguno como "el bueno" (los kg de cada
// volcado son la única pista honesta). Ver src/lib/origenConfeccion.ts.

const MOTIVO_INCOHERENCIA_TEXTO: Record<MotivoIncoherenciaExpedicion, (kgEntrada: number, kgExpedido: number) => string> = {
  sin_entrada: () =>
    "No existe ninguna entrada de báscula con este código: es el nº de lote de confección del día (numeración del programa de palets), no un lote de fruta.",
  entrada_precalibrado: (kgEntrada, kgExpedido) =>
    `La entrada con este código es un movimiento interno de precalibrado (${formatKg(kgEntrada)}), pero hay ${formatKg(kgExpedido)} expedidos: los palets no son de esa entrada.`,
  kg_superan_entrada: (kgEntrada, kgExpedido) =>
    `Los kg expedidos (${formatKg(kgExpedido)}) superan la entrada (${formatKg(kgEntrada)}): físicamente imposible, el cruce por código es falso.`,
};

function OrigenConfeccionAviso({ origen, kgEntrada, kgExpedido, onSelect }: {
  origen: OrigenConfeccionLote;
  kgEntrada: number;
  kgExpedido: number;
  onSelect: (lote: string) => void;
}) {
  return (
    <div className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2.5">
      <p className="flex items-start gap-1.5 text-xs font-medium text-warning">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          {kgExpedido > 0 && <>Estos palets NO son de la entrada de este código.{" "}</>}
          {MOTIVO_INCOHERENCIA_TEXTO[origen.motivo](kgEntrada, kgExpedido)}
        </span>
      </p>

      {origen.volcados.length > 0 ? (
        <div className="mt-2 space-y-1.5">
          <p className="text-xs text-muted-foreground">
            {origen.numeroDelDia != null && (
              <>El nº <span className="font-semibold">{origen.numeroDelDia}</span> del código es el orden de ENTRADA en
              báscula de ese día, no identifica la fruta confeccionada. </>
            )}
            La fruta salió de los volcados del {origen.fecha ? formatDate(origen.fecha) : "día de confección"}, repartida
            aproximadamente según los kg de cada uno:
          </p>
          {origen.volcados.map((v) => {
            const contenido = (
              <>
                <span className="w-6 shrink-0 text-center text-xs font-semibold tabular-nums text-muted-foreground">
                  {v.numero}º
                </span>
                <span className="tabular-nums text-sm font-semibold">{formatKg(v.kg)}</span>
                {v.hora_inicio && <span className="text-xs tabular-nums text-muted-foreground">{v.hora_inicio.slice(0, 5)} h</span>}
                {v.productor && <span className="min-w-0 truncate text-xs">{v.productor}</span>}
                {v.producto && <span className="min-w-0 truncate text-xs text-muted-foreground">{v.producto}</span>}
                {v.esPrecalibrado && (
                  <Badge
                    variant="outline"
                    className="border-[var(--glass-border)] bg-muted px-1.5 py-0 text-[10px] font-normal text-muted-foreground"
                    title="Fruta reintroducida desde precalibrado; cuenta como procesado del lote, no como productor."
                  >
                    precalibrado
                  </Badge>
                )}
                {(v.kg_industria ?? 0) > 0 && (
                  <span className="text-xs tabular-nums font-medium text-warning">{formatKg(v.kg_industria as number)} ind.</span>
                )}
                {v.codigo && <ArrowRight className="ml-auto h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                {esNotaOperarioLote(v.notas) && (
                  <span className="flex w-full items-start gap-1.5 text-xs text-muted-foreground">
                    <StickyNote className="mt-0.5 h-3 w-3 shrink-0 text-info" />
                    <span className="min-w-0">{v.notas}</span>
                  </span>
                )}
              </>
            );
            const clase = "flex w-full flex-wrap items-center gap-x-3 gap-y-0.5 rounded-md border border-[var(--glass-border)] bg-[var(--glass-bg)] px-2.5 py-1.5 text-left";
            return v.codigo ? (
              <button
                key={`${v.codigo}-${v.numero}`}
                type="button"
                onClick={() => onSelect(v.codigo as string)}
                className={cn(clase, "transition-colors hover:bg-[var(--glass-bg-strong)]")}
                title={v.lote_codigo ?? undefined}
              >
                {contenido}
              </button>
            ) : (
              <div key={`sin-codigo-${v.numero}`} className={clase} title={v.lote_codigo ?? undefined}>
                {contenido}
              </div>
            );
          })}
          <p className="text-[11px] text-muted-foreground">
            Orden por hora del calibrador. El reparto exacto fruta ↔ palet dentro del día solo lo conoce el ERP: aquí el
            volcado dominante en kg es el origen más probable de cualquier palet del día.
          </p>
        </div>
      ) : (
        <p className="mt-1.5 text-xs text-muted-foreground">
          {origen.fecha
            ? `Sin volcados registrados el ${formatDate(origen.fecha)}: importa el Informe PRODUCCION de ese día para ver el origen probable.`
            : "No se pudo determinar el día de confección de estos palets."}
        </p>
      )}
    </div>
  );
}

function DatoLinea({ label, valor, destacado = false }: { label: string; valor: React.ReactNode; destacado?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={cn("mt-0.5 truncate text-sm", destacado ? "font-bold tabular-nums" : "font-medium")}>{valor}</p>
    </div>
  );
}

// ─── Mermas y pérdidas (merma natural + podrido, real/estimado) — solo kg/% ──
// El desglose en € (coste de compra, €/kg, € perdidos) vive en Económico →
// Costes (sección "Pérdidas de fruta"), no aquí: esta ficha de producción es
// para todos los roles, así que solo muestra kg y %. El enlace de abajo lleva
// al admin al detalle económico.

/** Umbral VISUAL (no de negocio) para destacar en warning el podrido pre-calibrador: > 40% de la merma medida o > 500 kg. */
function podridoPreCalibradorDestacado(merma: MermaLote): boolean {
  const medida = Math.max(0, merma.mermaNaturalKg ?? 0);
  const preCalibrador = merma.podridoPreCalibradorKg ?? 0;
  if (preCalibrador > 500) return true;
  return medida > 0 && preCalibrador / medida > 0.4;
}

function MermasYPerdidasCard({ lote }: { lote: string }) {
  const { role } = useAuth();
  const isAdmin = role === "admin";
  const { data: merma, isLoading } = useMermaLote(lote);

  if (isLoading) return <Skeleton className="h-48 w-full" />;
  if (!merma) return null; // sin cruce posible (no debería pasar si `entrada` existe, pero no rompe la ficha)

  return (
    <Card className="glass-accented">
      <CardContent className="space-y-4 p-4 sm:p-5">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 border-primary/40 bg-primary/10 text-primary">
            <Scale className="h-4 w-4" />
          </div>
          <div>
            <p className="flex items-center gap-1.5 text-sm font-semibold">
              Mermas y pérdidas
              {merma.cerradoManualmente && (
                <Badge
                  variant="outline"
                  className="border-[var(--glass-border)] bg-[var(--glass-bg)] px-1.5 py-0 text-[10px] font-normal text-muted-foreground"
                  title={merma.cerradoSinRegistro ? "Su procesado no consta bajo este código: excluido de mermas/podrido/forfait." : "El hueco cuenta como merma natural + podrido pre-calibrador."}
                >
                  <Lock className="mr-1 h-2.5 w-2.5" /> {merma.cerradoSinRegistro ? "Cerrado sin análisis" : "Cerrado a mano"}
                </Badge>
              )}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {merma.cerradoSinRegistro
                ? "Su procesado no consta bajo este código: se excluye del análisis de merma/podrido/forfait, sin inventar una pérdida."
                : "Cuánta fruta se perdió entre la báscula y la venta."}
            </p>
          </div>
          {isAdmin && (
            <Link
              to="/economico/costes"
              className="ml-auto shrink-0 text-xs text-muted-foreground hover:text-foreground hover:underline"
            >
              Ver análisis económico →
            </Link>
          )}
        </div>

        <div className="grid gap-3 border-t border-[var(--glass-border)] pt-3 sm:grid-cols-3">
          {/* Merma natural (medida) */}
          <div className="rounded-lg border border-[var(--glass-border)] bg-[var(--glass-bg)] p-3">
            <p className="text-xs font-semibold text-muted-foreground">Merma natural</p>
            {merma.mermaNaturalKg == null ? (
              <p className="mt-1 text-sm text-muted-foreground">
                {merma.cerradoSinRegistro ? "Sin análisis (cierre sin registro)" : "Pendiente (lote sin procesar del todo)"}
              </p>
            ) : (
              <>
                <p className="mt-1 text-lg font-bold tabular-nums">
                  {formatKg(merma.mermaNaturalKg)}
                  {merma.pctMermaSobreEntrada != null && (
                    <span className="ml-1.5 text-xs font-medium text-muted-foreground">
                      ({formatPct(merma.pctMermaSobreEntrada)})
                    </span>
                  )}
                </p>
                {merma.calibradorSuperaEntrada && (
                  <p className="mt-1 flex items-center gap-1 text-[11px] font-medium text-warning">
                    <AlertTriangle className="h-3 w-3 shrink-0" /> Calibrador &gt; báscula: revisar pesajes
                  </p>
                )}
              </>
            )}
          </div>

          {/* Podrido calibrador */}
          <div className="rounded-lg border border-[var(--glass-border)] bg-[var(--glass-bg)] p-3">
            <div className="flex items-center gap-1.5">
              <p className="text-xs font-semibold text-muted-foreground">Podrido calibrador</p>
              <FuenteBadge fuente={fuentePodridoAVariant(merma.podridoCalibradorFuente)} />
            </div>
            <p className="mt-1 text-lg font-bold tabular-nums">
              {merma.podridoCalibradorKg == null ? <span className="text-muted-foreground/70">sin dato</span> : formatKg(merma.podridoCalibradorKg)}
            </p>
          </div>

          {/* Podrido manual (bolsa de basura): siempre estimado, salvo que el parte no traiga dato ("desconocido") */}
          <div className="rounded-lg border border-[var(--glass-border)] bg-[var(--glass-bg)] p-3">
            <div className="flex items-center gap-1.5">
              <p className="text-xs font-semibold text-muted-foreground">Podrido manual</p>
              <FuenteBadge fuente={fuentePodridoAVariant(merma.podridoManualKg == null ? "desconocido" : "prorrateo")} />
            </div>
            <p className="mt-1 text-lg font-bold tabular-nums">
              {merma.podridoManualKg == null ? <span className="text-muted-foreground/70">sin dato</span> : formatKg(merma.podridoManualKg)}
            </p>
          </div>
        </div>

        {/* Desglose tipo Excel: días en cámara -> natural estimada vs sin justificar */}
        {merma.mermaNaturalKg != null && (
          <div className="border-t border-[var(--glass-border)] pt-3 text-sm">
            <p className="text-muted-foreground">
              {merma.diasEnCamara != null && <>{merma.diasEnCamara} días en cámara · </>}
              merma medida <span className="font-semibold text-foreground">{formatKg(merma.mermaNaturalKg)}</span>
              {merma.pctMermaSobreEntrada != null && <> ({formatPct(merma.pctMermaSobreEntrada)})</>}
            </p>
            {merma.diasEnCamara == null ? (
              <p className="mt-1.5 text-xs text-muted-foreground">
                Desglose natural / podrido pre-calibrador no calculable (falta la fecha de procesado).
              </p>
            ) : merma.mermaNaturalEstimadaKg != null ? (
              <div className="mt-1.5 space-y-1">
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  {merma.mermaCamaraReal
                    ? <>Merma de cámara (registro real):</>
                    : <>Natural estimada (0,055%/día × {merma.diasEnCamara} días):</>}{" "}
                  <span className="font-semibold text-foreground tabular-nums">{formatKg(merma.mermaNaturalEstimadaKg)}</span>
                  <FuenteBadge fuente={merma.mermaCamaraReal ? "real" : "asumido"} />
                </p>
                <p className={cn(
                  "flex items-center gap-1.5 text-xs",
                  podridoPreCalibradorDestacado(merma) ? "font-semibold text-warning" : "text-muted-foreground",
                )}>
                  {podridoPreCalibradorDestacado(merma) && <AlertTriangle className="h-3 w-3 shrink-0" />}
                  Podrido pre-calibrador:{" "}
                  <InfoTooltip iconClassName="h-3 w-3">Podrido de fruta apartada en los almacenes de precalibrado, antes de pasar por el calibrador: estimado por prorrateo, no un peso medido lote a lote.</InfoTooltip>
                  <span className="tabular-nums">{formatKg(merma.podridoPreCalibradorKg ?? 0)}</span>
                  <FuenteBadge fuente="asumido" />
                </p>
              </div>
            ) : null}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Tira de flujo de la cabecera ────────────────────────────────────────────

function FlowEtapa({ label, value, valueClass, valueStyle, sub, nota, notaClass, children }: {
  label: string;
  value?: React.ReactNode;
  valueClass?: string;
  valueStyle?: React.CSSProperties;
  sub?: string;
  nota?: string;
  notaClass?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="min-w-0 px-1 sm:flex-1 sm:px-3">
      <p className="panel-kicker truncate">{label}</p>
      {children ?? (
        <p
          className={cn("mt-0.5 truncate text-[18px] font-semibold leading-tight tabular-nums sm:text-[20px]", valueClass)}
          style={valueStyle}
        >
          {value}
          {sub && <span className="ml-1 text-xs font-medium text-muted-foreground">({sub})</span>}
        </p>
      )}
      {nota && <p className={cn("mt-0.5 truncate text-[11px] font-medium", notaClass)}>{nota}</p>}
    </div>
  );
}

function FlowFlecha() {
  return <ArrowRight className="hidden h-4 w-4 shrink-0 self-center text-muted-foreground/40 sm:block" />;
}

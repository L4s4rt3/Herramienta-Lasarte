// src/pages/EntradasBascula.tsx
// Entradas de fruta por báscula + stock de fruta sin procesar.
//
// Cada día se importa el export del programa de báscula (Excel); el código de
// lote (AAMMDD+NN) es el mismo que llega al calibrador, así que el cruce con
// lotes_dia da el stock en cámara por lote/finca/variedad y la trazabilidad
// completa: finca → entrada → lote → procesado → clasificación → destino.
import { useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import * as XLSX from "xlsx";
import {
  AlertTriangle, ArrowRight, FileSpreadsheet, Loader2, Package, Search, Trash2, Truck, Upload, Warehouse, X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { KPICard } from "@/components/KPICard";
import { toast } from "@/hooks/use-toast";
import { useEntradasBascula } from "@/hooks/useEntradasBascula";
import {
  parseEntradasBasculaRows,
  type EntradaBasculaParsed,
  type StockEstado,
  type StockLoteRow,
} from "@/lib/entradasBascula";
import { errorMessage } from "@/lib/errorMessage";
import { formatDate, formatKgCompact as formatKg, formatNumber, today } from "@/lib/format";
import { cn } from "@/lib/utils";

const ESTADO_BADGE: Record<StockEstado, { label: string; className: string }> = {
  pendiente: { label: "En cámara", className: "border-info/40 bg-info/10 text-info" },
  parcial: { label: "Parcial", className: "border-warning/40 bg-warning/10 text-warning" },
  procesado: { label: "Procesado", className: "border-[var(--glass-border)] bg-[var(--glass-bg)] text-muted-foreground" },
};

function diasClass(dias: number, estado: StockEstado): string {
  if (estado === "procesado") return "text-muted-foreground";
  if (dias > 14) return "text-destructive font-semibold";
  if (dias > 7) return "text-warning font-semibold";
  return "text-foreground";
}

function normalizeText(value: string | null | undefined): string {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

interface ImportPreview {
  fileName: string;
  entradas: EntradaBasculaParsed[];
  descartadas: Array<{ fila: number; motivo: string }>;
}

export default function EntradasBascula() {
  const { entradas, stock, isLoading, error, importar, eliminar } = useEntradasBascula();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [parseando, setParseando] = useState(false);
  const [search, setSearch] = useState("");
  const [soloActivos, setSoloActivos] = useState(true);

  const handleFile = async (file: File | null) => {
    if (!file) return;
    setParseando(true);
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { cellDates: true });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null }) as unknown[][];
      const parsed = parseEntradasBasculaRows(rows);
      if (parsed.entradas.length === 0) {
        toast({
          title: "Archivo sin entradas",
          description: parsed.descartadas[0]?.motivo ?? "No se encontraron filas importables.",
          variant: "destructive",
        });
        setPreview(null);
        return;
      }
      setPreview({ fileName: file.name, ...parsed });
    } catch (e) {
      toast({ title: "No se pudo leer el archivo", description: errorMessage(e), variant: "destructive" });
    } finally {
      setParseando(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const lotesExistentes = useMemo(() => new Set(entradas.map((e) => e.lote)), [entradas]);
  const previewStats = useMemo(() => {
    if (!preview) return null;
    const fechas = preview.entradas.map((e) => e.fecha).sort();
    const nuevas = preview.entradas.filter((e) => !lotesExistentes.has(e.lote)).length;
    return {
      kg: preview.entradas.reduce((s, e) => s + e.kg_entrada, 0),
      desde: fechas[0],
      hasta: fechas[fechas.length - 1],
      nuevas,
      actualizadas: preview.entradas.length - nuevas,
    };
  }, [preview, lotesExistentes]);

  const confirmarImport = () => {
    if (!preview) return;
    importar.mutate(preview.entradas, {
      onSuccess: () => {
        toast({
          title: "Entradas importadas",
          description: `${preview.entradas.length} entrada(s) guardada(s) (${previewStats?.nuevas ?? 0} nueva(s)).`,
        });
        setPreview(null);
      },
      onError: (e) => toast({ title: "Error al importar", description: errorMessage(e), variant: "destructive" }),
    });
  };

  const searchLower = normalizeText(search).trim();
  const filasVisibles = useMemo(() => {
    return stock.filas.filter((fila) => {
      if (soloActivos && fila.estado === "procesado") return false;
      if (!searchLower) return true;
      return (
        normalizeText(fila.lote).includes(searchLower)
        || normalizeText(fila.finca).includes(searchLower)
        || normalizeText(fila.articulo).includes(searchLower)
        || normalizeText(fila.agricultor).includes(searchLower)
      );
    });
  }, [stock.filas, soloActivos, searchLower]);

  const entradaPorLote = useMemo(() => new Map(entradas.map((e) => [e.lote, e])), [entradas]);
  const hayEntradas = entradas.length > 0;

  return (
    <div className="page-shell">
      <header className="page-header flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="page-title">Entradas de fruta</h1>
          <p className="page-subtitle">
            Báscula → stock en cámara → calibrador: trazabilidad por lote desde la finca.
          </p>
        </div>
        <Button className="glass glass-hover" variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} disabled={parseando || importar.isPending}>
          {parseando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          Importar Excel de báscula
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls"
          className="hidden"
          onChange={(e) => void handleFile(e.target.files?.[0] ?? null)}
        />
      </header>

      {/* ─── Previsualización del import ───────────────────────────────── */}
      {preview && previewStats && (
        <Card className="glass-accented border-info/30">
          <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-3 p-4">
            <div className="flex items-center gap-2 text-sm font-medium">
              <FileSpreadsheet className="h-4 w-4 text-info" />
              {preview.fileName}
            </div>
            <p className="text-sm text-muted-foreground">
              {preview.entradas.length} entrada(s) · {formatDate(previewStats.desde)}
              {previewStats.hasta !== previewStats.desde && <> – {formatDate(previewStats.hasta)}</>} ·{" "}
              <span className="font-semibold text-foreground">{formatKg(previewStats.kg)}</span>
              {" "}· {previewStats.nuevas} nueva(s){previewStats.actualizadas > 0 && <>, {previewStats.actualizadas} ya existente(s) que se actualizarán</>}
            </p>
            {preview.descartadas.length > 0 && (
              <p className="flex items-center gap-1.5 text-xs text-warning">
                <AlertTriangle className="h-3.5 w-3.5" />
                {preview.descartadas.length} fila(s) descartada(s): {preview.descartadas.slice(0, 3).map((d) => `fila ${d.fila} (${d.motivo})`).join(", ")}{preview.descartadas.length > 3 && "…"}
              </p>
            )}
            <div className="ml-auto flex items-center gap-2">
              <Button size="sm" onClick={confirmarImport} disabled={importar.isPending}>
                {importar.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                Guardar
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setPreview(null)} disabled={importar.isPending}>
                Cancelar
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <>
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-96 w-full" />
        </>
      ) : error ? (
        <Card className="glass-accented border-destructive/30">
          <CardContent className="flex items-center gap-3 py-6 text-destructive">
            <AlertTriangle className="h-5 w-5 shrink-0" />
            <p className="text-sm font-semibold">{errorMessage(error)}</p>
          </CardContent>
        </Card>
      ) : !hayEntradas ? (
        <Card className="glass-accented">
          <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
            <Truck className="h-10 w-10 text-muted-foreground/30" />
            <div>
              <p className="font-semibold">Todavía no hay entradas de báscula</p>
              <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
                Exporta el listado de entradas del programa de báscula (Excel) e impórtalo aquí.
                Con las entradas cargadas verás el stock de fruta sin procesar y la trazabilidad por lote.
              </p>
            </div>
            <Button className="glass glass-hover mt-2" variant="outline" onClick={() => fileInputRef.current?.click()}>
              <Upload className="h-4 w-4" /> Importar Excel de báscula
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* ─── KPIs de stock ─────────────────────────────────────────── */}
          <section className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <KPICard
              className="glass-accented"
              label="Stock en cámara"
              value={formatKg(stock.kgEnCamara)}
              hint="Entradas menos lo procesado por el calibrador"
              icon={Warehouse}
              labelInfo="Kg entrados por báscula que el calibrador aún no ha procesado (cruce por código de lote). Un lote cuenta como procesado cuando el calibrador ha pasado el 97% o más de sus kg (báscula y calibrador nunca pesan exactamente igual)."
            />
            <KPICard
              className="glass-accented"
              label="Lotes en cámara"
              value={String(stock.lotesPendientes)}
              hint="Sin empezar a procesar"
              icon={Package}
            />
            <KPICard
              className="glass-accented"
              label="Lotes a medias"
              value={String(stock.lotesParciales)}
              hint="Procesados en parte"
              icon={Package}
              accent={stock.lotesParciales > 0 ? "warning" : "primary"}
            />
            <KPICard
              className="glass-accented"
              label="Antigüedad máxima"
              value={`${stock.antiguedadMaxDias} días`}
              hint="Del lote activo más antiguo"
              icon={AlertTriangle}
              accent={stock.antiguedadMaxDias > 14 ? "destructive" : stock.antiguedadMaxDias > 7 ? "warning" : "primary"}
              labelInfo="Días desde la entrada del lote activo (en cámara o parcial) más antiguo. Más de 7 días en ámbar, más de 14 en rojo."
            />
          </section>

          {/* ─── Stock / listado por lote ──────────────────────────────── */}
          <Card className="glass-accented">
            <CardHeader className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="panel-kicker">Trazabilidad</p>
                  <CardTitle className="text-base">
                    {soloActivos ? "Fruta sin procesar" : "Todas las entradas"} ({filasVisibles.length})
                  </CardTitle>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      placeholder="Lote, finca, variedad, agricultor..."
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      className="h-9 w-full pl-8 sm:w-72"
                    />
                  </div>
                  {searchLower && (
                    <Button variant="ghost" size="sm" className="h-9 text-muted-foreground" onClick={() => setSearch("")}>
                      <X className="h-3.5 w-3.5" /> Limpiar
                    </Button>
                  )}
                  <div className="flex items-center gap-1 rounded-md border border-[var(--glass-border)] bg-[var(--glass-bg)] p-0.5">
                    {([true, false] as const).map((valor) => (
                      <button
                        key={String(valor)}
                        type="button"
                        onClick={() => setSoloActivos(valor)}
                        className={cn(
                          "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                          soloActivos === valor ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground",
                        )}
                      >
                        {valor ? "Sin procesar" : "Todas"}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </CardHeader>
            <CardContent className="overflow-x-auto p-0">
              {filasVisibles.length === 0 ? (
                <p className="py-10 text-center text-sm text-muted-foreground">
                  {soloActivos ? "No queda fruta sin procesar con estos filtros. 🎉" : "Sin entradas que coincidan con la búsqueda."}
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Lote</TableHead>
                      <TableHead>Entrada</TableHead>
                      <TableHead>Finca</TableHead>
                      <TableHead>Variedad</TableHead>
                      <TableHead className="text-right">Kg entrada</TableHead>
                      <TableHead className="text-right">Procesado</TableHead>
                      <TableHead className="text-right">En cámara</TableHead>
                      <TableHead className="text-right">Días</TableHead>
                      <TableHead>Estado</TableHead>
                      <TableHead className="text-right">Acciones</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filasVisibles.map((fila: StockLoteRow, i) => {
                      const badge = ESTADO_BADGE[fila.estado];
                      const row = entradaPorLote.get(fila.lote);
                      return (
                        <TableRow key={fila.lote} className={cn(i % 2 === 1 && "bg-[var(--glass-bg)]/40")}>
                          <TableCell className="whitespace-nowrap font-medium">
                            <Link
                              to={`/analisis/diario?q=${encodeURIComponent(fila.lote)}&tab=lotes&desde=${fila.fecha_entrada}&hasta=${fila.ultima_fecha_procesado ?? today()}`}
                              className="inline-flex items-center gap-1 hover:text-primary hover:underline"
                              title="Ver el lote en Análisis diario"
                            >
                              {fila.lote} <ArrowRight className="h-3 w-3 opacity-50" />
                            </Link>
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-muted-foreground">{formatDate(fila.fecha_entrada)}</TableCell>
                          <TableCell className="max-w-[180px] truncate">{fila.finca ?? "—"}</TableCell>
                          <TableCell className="max-w-[160px] truncate text-muted-foreground">{fila.articulo ?? "—"}</TableCell>
                          <TableCell className="text-right tabular-nums font-medium">{formatKg(fila.kg_entrada)}</TableCell>
                          <TableCell className="text-right tabular-nums text-muted-foreground">
                            {fila.kg_procesado > 0 ? formatKg(fila.kg_procesado) : "—"}
                          </TableCell>
                          <TableCell className="text-right tabular-nums font-semibold">
                            {fila.estado === "procesado" ? "—" : formatKg(fila.kg_en_camara)}
                          </TableCell>
                          <TableCell className={cn("text-right tabular-nums", diasClass(fila.dias_en_camara, fila.estado))}>
                            {fila.dias_en_camara}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className={cn("px-1.5 py-0 text-[11px]", badge.className)}>{badge.label}</Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            {row && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-destructive hover:text-destructive"
                                title="Borrar esta entrada"
                                disabled={eliminar.isPending}
                                onClick={() => {
                                  eliminar.mutate(row.id, {
                                    onSuccess: () => toast({ title: "Entrada borrada", description: `Lote ${fila.lote} eliminado del registro.` }),
                                    onError: (e) => toast({ title: "Error", description: errorMessage(e), variant: "destructive" }),
                                  });
                                }}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <p className="text-xs text-muted-foreground">
            {entradas.length} entrada(s) registradas · {formatNumber(entradas.reduce((s, e) => s + (Number(e.kg_entrada) || 0), 0))} kg entrados en total ·
            el enlace de cada lote abre sus datos de procesado en Análisis diario.
          </p>
        </>
      )}
    </div>
  );
}

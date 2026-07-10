import { useState, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { Copy, Download, FileText, Search } from "lucide-react";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import type { AnalisisDia, Alerta } from "@/lib/analisis";
import { generarReporteOperativo, buscarLoteContexto } from "@/lib/reporteOperativo";
import { formatNumber, formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

function gKg(v: number): string {
  if (v >= 1000) return (v / 1000).toFixed(1).replace(".", ",") + " t";
  return Math.round(v).toLocaleString("es-ES") + " kg";
}

function gPct(v: number): string {
  return v.toFixed(1).replace(".", ",") + "%";
}

function SeccionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 mb-3 mt-6 first:mt-0">
      <div className="h-px flex-1 bg-border" />
      <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground px-2">
        {children}
      </span>
      <div className="h-px flex-1 bg-border" />
    </div>
  );
}

function ResumenEjecutivo({ kpis }: { kpis: AnalisisDia["kpis"] }) {
  const items = [
    { label: "Producción", value: gKg(kpis.kg_calibrador), sub: `${kpis.n_lotes} lotes · ${kpis.n_productores} productores` },
    { label: "% Exportación", value: gPct(kpis.pct_exportacion), sub: gKg(kpis.kg_exportacion) },
    { label: "Eficiencia T/h", value: kpis.tph_promedio ? `${kpis.tph_promedio.toFixed(1)} T/h` : "—", sub: kpis.tph_min && kpis.tph_max ? `min ${kpis.tph_min} · max ${kpis.tph_max}` : undefined },
    { label: "Top calibre", value: kpis.top_calibre ?? "—", sub: kpis.top_calibre ? `${gPct(kpis.top_calibre_pct)} del total` : undefined },
    { label: "Stock cámara", value: gKg(kpis.kg_camara), sub: `${kpis.n_palets} palets` },
  ];
  return (
    <>
      <SeccionHeader>Resumen Ejecutivo</SeccionHeader>
      <div className="grid gap-3 grid-cols-2 md:grid-cols-3 xl:grid-cols-5">
        {items.map((item) => (
          <Card key={item.label} className="border-l-4 border-l-primary">
            <CardContent className="p-4">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{item.label}</p>
              <p className="mt-1 text-2xl font-bold tabular-nums truncate">{item.value}</p>
              {item.sub && <p className="text-xs text-muted-foreground mt-0.5">{item.sub}</p>}
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  );
}

function TablaProductores({ productores }: { productores: AnalisisDia["productores"] }) {
  if (productores.length === 0) return null;
  return (
    <>
      <SeccionHeader>Recepción y Lotes</SeccionHeader>
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Productor</TableHead>
                  <TableHead className="text-right">Kg Total</TableHead>
                  <TableHead className="text-right">Lotes</TableHead>
                  <TableHead className="text-right">T/h Medio</TableHead>
                  <TableHead className="text-right">Peso Fruta</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {productores.map((p) => (
                  <TableRow key={p.productor}>
                    <TableCell className="text-xs font-medium">{p.productor}</TableCell>
                    <TableCell className="text-right tabular-nums text-xs">{gKg(p.kg_total)}</TableCell>
                    <TableCell className="text-right tabular-nums text-xs text-muted-foreground">{p.n_lotes}</TableCell>
                    <TableCell className="text-right text-xs">
                      {p.tph_avg ? (
                        <span className={cn("tabular-nums font-semibold",
                          p.tph_avg >= 14.5 ? "text-success" : p.tph_avg >= 12.5 ? "text-warning" : "text-destructive"
                        )}>{p.tph_avg.toFixed(1)} T/h</span>
                      ) : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-xs text-muted-foreground">
                      {p.peso_fruta_avg_g ? `${p.peso_fruta_avg_g.toFixed(0)} g` : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </>
  );
}

function TablaProductos({ productos }: { productos: AnalisisDia["top_productos"] }) {
  if (productos.length === 0) return null;
  return (
    <>
      <SeccionHeader>Producción y Empaque</SeccionHeader>
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>#</TableHead>
                  <TableHead>Producto</TableHead>
                  <TableHead className="text-right">Kg</TableHead>
                  <TableHead className="text-right">Empaques</TableHead>
                  <TableHead>Destino</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {productos.map((p, i) => (
                  <TableRow key={p.producto}>
                    <TableCell className="text-xs text-muted-foreground">{i + 1}</TableCell>
                    <TableCell className="text-xs font-medium">{p.producto}</TableCell>
                    <TableCell className="text-right tabular-nums text-xs">{gKg(p.kg)}</TableCell>
                    <TableCell className="text-right tabular-nums text-xs">{formatNumber(p.n_empaques)}</TableCell>
                    <TableCell className="text-xs">{p.grupo_destino ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </>
  );
}

function TablaClientes({ clientes }: { clientes: AnalisisDia["clientes"] }) {
  if (clientes.length === 0) return null;
  return (
    <>
      <SeccionHeader>Logística y Clientes</SeccionHeader>
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cliente</TableHead>
                  <TableHead className="text-right">Palets</TableHead>
                  <TableHead className="text-right">Kg Total</TableHead>
                  <TableHead>Productos</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {clientes.slice(0, 10).map((c) => (
                  <TableRow key={c.cliente}>
                    <TableCell className="text-xs font-medium">{c.cliente}</TableCell>
                    <TableCell className="text-right tabular-nums text-xs">{c.n_palets}</TableCell>
                    <TableCell className="text-right tabular-nums text-xs">{gKg(c.kg_total)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate" title={c.productos.join(", ")}>
                      {c.productos.length > 3 ? c.productos.slice(0, 3).join(", ") + ` (+${c.productos.length - 3})` : c.productos.join(", ") || "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </>
  );
}

function TablaCalibres({ calibres }: { calibres: AnalisisDia["calibres"] }) {
  if (calibres.length === 0) return null;
  const top5 = calibres.slice(0, 5);
  return (
    <>
      <SeccionHeader>Calidad — Calibres</SeccionHeader>
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Calibre</TableHead>
                  <TableHead className="text-right">Kg</TableHead>
                  <TableHead className="text-right">% Total</TableHead>
                  <TableHead className="text-right">% Export</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {top5.map((c) => (
                  <TableRow key={c.calibre}>
                    <TableCell className="text-xs font-medium">{c.calibre}</TableCell>
                    <TableCell className="text-right tabular-nums text-xs">{gKg(c.kg)}</TableCell>
                    <TableCell className="text-right tabular-nums text-xs">{gPct(c.pct_total)}</TableCell>
                    <TableCell className="text-right tabular-nums text-xs">{gPct(c.pct_export)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </>
  );
}

function AlertasList({ alertas }: { alertas: Alerta[] }) {
  if (alertas.length === 0) return null;
  return (
    <>
      <SeccionHeader>Alertas del Día</SeccionHeader>
      <div className="space-y-1.5">
        {alertas.map((a) => {
          const styles = {
            danger: "bg-destructive/10 border-destructive/30 text-destructive",
            warning: "bg-warning/10 border-warning/30 text-warning",
            info: "bg-[var(--glass-bg)] border-[var(--glass-border)] text-muted-foreground",
          }[a.severidad];
          return (
            <div key={a.id} className={cn("flex items-start gap-2 rounded-xl border px-3 py-2.5 text-xs backdrop-blur-sm", styles)}>
              <div><span className="font-semibold">{a.titulo}</span>{" — "}<span className="opacity-80">{a.detalle}</span></div>
            </div>
          );
        })}
      </div>
    </>
  );
}

interface Props {
  analisis: AnalisisDia;
  fechaParte?: string;
}

export function ReporteOperativo({ analisis, fechaParte }: Props) {
  const [busqueda, setBusqueda] = useState("");

  const reporteMd = useMemo(
    () => generarReporteOperativo(analisis, fechaParte),
    [analisis, fechaParte]
  );

  const resultadoBusqueda = useMemo(() => {
    if (!busqueda.trim()) return null;
    return buscarLoteContexto(analisis, busqueda.trim());
  }, [analisis, busqueda]);

  function copiarAlPortapapeles() {
    navigator.clipboard.writeText(reporteMd).then(() => {
      toast({ title: "Copiado", description: "Reporte copiado al portapapeles" });
    }).catch(() => {
      toast({ title: "Error", description: "No se pudo copiar", variant: "destructive" });
    });
  }

  function descargarMd() {
    const blob = new Blob([reporteMd], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const now = new Date();
    const fecha = fechaParte ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    a.download = `reporte-operativo-${fecha}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast({ title: "Descargado", description: `reporte-operativo-${fecha}.md` });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <FileText className="h-5 w-5 text-primary" />
          <h3 className="text-sm font-semibold">Reporte Operativo Ejecutivo</h3>
          <Badge variant="secondary" className="text-[10px]">Estructurado</Badge>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={copiarAlPortapapeles} className="glass glass-hover">
            <Copy className="h-3.5 w-3.5 mr-1.5" />
            Copiar Markdown
          </Button>
          <Button variant="outline" size="sm" onClick={descargarMd} className="glass glass-hover">
            <Download className="h-3.5 w-3.5 mr-1.5" />
            Descargar .md
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-3">
          <div className="flex items-center gap-2">
            <Search className="h-4 w-4 text-muted-foreground shrink-0" />
            <Input
              placeholder="Buscar lote (ej: 7700, nombre de lote...)"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              className="h-8 text-xs"
            />
          </div>
          {busqueda.trim() && !resultadoBusqueda && (
            <p className="text-[10px] text-muted-foreground mt-2 ml-6">
              No se encontró ningún lote con "{busqueda}"
            </p>
          )}
          {resultadoBusqueda && (
            <div className="mt-3 ml-6 rounded-xl border border-primary/20 bg-primary/5 p-3 text-xs">
              <pre className="whitespace-pre-wrap font-sans">{resultadoBusqueda}</pre>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="space-y-2">
        <ResumenEjecutivo kpis={analisis.kpis} />
        <AlertasList alertas={analisis.alertas} />
        <TablaProductores productores={analisis.productores} />
        <TablaProductos productos={analisis.top_productos} />
        <TablaClientes clientes={analisis.clientes} />
        <TablaCalibres calibres={analisis.calibres} />
      </div>

      <p className="text-[10px] text-muted-foreground text-right">
        Reporte generado automáticamente · {formatDateTime(analisis.fecha_analisis)}
      </p>
    </div>
  );
}

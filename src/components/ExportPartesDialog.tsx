import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/use-toast";
import {
  Download, FileSpreadsheet, FileText, Calendar,
  Factory, TrendingDown, Package, StickyNote,
} from "lucide-react";
import { exportPartesToExcel, exportPartesToPDF, ParteRow } from "@/lib/exportPartes";
import { toISODateLocal } from "@/lib/format";

function daysAgo(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return toISODateLocal(d);
}
const today = () => toISODateLocal(new Date());

interface Props {
  defaultFrom?: string;
  defaultTo?: string;
}

export function ExportPartesDialog({ defaultFrom, defaultTo }: Props) {
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(defaultFrom ?? daysAgo(30));
  const [to, setTo] = useState(defaultTo ?? today());
  const [busy, setBusy] = useState<null | "xlsx" | "pdf">(null);

  async function fetchRows(): Promise<ParteRow[]> {
    const { data, error } = await supabase
      .from("partes_diarios")
      .select("*")
      .gte("date", from)
      .lte("date", to)
      .order("date", { ascending: true });
    if (error) throw error;
    return (data ?? []) as ParteRow[];
  }

  async function doExport(kind: "xlsx" | "pdf") {
    setBusy(kind);
    try {
      const rows = await fetchRows();
      if (rows.length === 0) {
        toast({ title: "Sin datos en el rango seleccionado", variant: "destructive" });
        return;
      }
      if (kind === "xlsx") await exportPartesToExcel(rows, from, to);
      else await exportPartesToPDF(rows, from, to);
      setOpen(false);
      toast({ title: `Exportado correctamente - ${rows.length} parte(s)` });
    } catch (e: unknown) {
      const description = e instanceof Error ? e.message : String(e);
      toast({ title: "Error al exportar", description, variant: "destructive" });
    } finally {
      setBusy(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="glass glass-hover">
          <Download className="h-4 w-4" /> Exportar
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-2xl glass-accented overflow-hidden">
        <DialogHeader className="border-b border-[var(--glass-border)] pb-4">
          <DialogTitle className="flex items-center gap-3 text-xl">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg-strong)] text-primary">
              <Download className="h-5 w-5" />
            </span>
            Exportar informe de produccion
          </DialogTitle>
          <DialogDescription className="text-sm">
            PDF ejecutivo para revisar y Excel estructurado para analizar, filtrar y compartir todo el rango seleccionado.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-5 lg:grid-cols-[1fr_220px]">
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="flex items-center gap-1.5 text-xs font-medium">
                  <Calendar className="h-3.5 w-3.5" /> Desde
                </Label>
                <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label className="flex items-center gap-1.5 text-xs font-medium">
                  <Calendar className="h-3.5 w-3.5" /> Hasta
                </Label>
                <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
              </div>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {[
                { label: "Hoy", fn: () => { setFrom(today()); setTo(today()); } },
                { label: "7 dias", fn: () => { setFrom(daysAgo(6)); setTo(today()); } },
                { label: "30 dias", fn: () => { setFrom(daysAgo(30)); setTo(today()); } },
                { label: "90 dias", fn: () => { setFrom(daysAgo(90)); setTo(today()); } },
              ].map(({ label, fn }) => (
                <Button key={label} size="sm" variant="ghost" className="h-8 px-3 text-xs glass glass-hover" onClick={fn}>
                  {label}
                </Button>
              ))}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => doExport("pdf")}
                disabled={busy !== null}
                className="rounded-2xl border border-[var(--glass-border)] bg-[var(--glass-bg)] p-4 text-left shadow-sm backdrop-blur-xl transition hover:border-primary/40 hover:bg-[var(--glass-bg-strong)] disabled:opacity-60"
              >
                <span className="flex items-start gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <FileText className="h-5 w-5" />
                  </span>
                  <span>
                    <span className="block text-sm font-semibold text-foreground">{busy === "pdf" ? "Generando PDF..." : "PDF ejecutivo"}</span>
                    <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">Resumen visual, KPIs, cascada DJPMN, semaforos y pagina por parte.</span>
                  </span>
                </span>
              </button>
              <button
                type="button"
                onClick={() => doExport("xlsx")}
                disabled={busy !== null}
                className="rounded-2xl border border-[var(--glass-border)] bg-[var(--glass-bg)] p-4 text-left shadow-sm backdrop-blur-xl transition hover:border-primary/40 hover:bg-[var(--glass-bg-strong)] disabled:opacity-60"
              >
                <span className="flex items-start gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-success/10 text-success">
                    <FileSpreadsheet className="h-5 w-5" />
                  </span>
                  <span>
                    <span className="block text-sm font-semibold text-foreground">{busy === "xlsx" ? "Generando Excel..." : "Excel analitico"}</span>
                    <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">Hojas separadas, filtros, resumen, detalle, cascada y notas/IA.</span>
                  </span>
                </span>
              </button>
            </div>
          </div>

          <div className="rounded-2xl border border-[var(--glass-border)] bg-[var(--glass-bg)] p-4 shadow-sm backdrop-blur-xl">
            <p className="panel-kicker mb-3">Contenido incluido</p>
            <div className="space-y-3">
              {[
                { icon: Factory, text: "KPIs de produccion y palets" },
                { icon: TrendingDown, text: "Cascada DJPMN completa" },
                { icon: Package, text: "Detalle operativo por parte" },
                { icon: FileText, text: "Paginas de informe PDF" },
                { icon: StickyNote, text: "Notas e analisis IA" },
                { icon: Download, text: "Excel con hojas y filtros" },
              ].map(({ icon: Icon, text }) => (
                <div key={text} className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Icon className="h-3.5 w-3.5 shrink-0" />
                  </span>
                  <span>{text}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter className="border-t border-[var(--glass-border)] pt-4">
          <p className="text-xs text-muted-foreground">
            El Excel queda preparado para filtros y analisis; el PDF queda listo para revision de direccion.
          </p>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

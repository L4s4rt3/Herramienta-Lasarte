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

function daysAgo(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}
const today = () => new Date().toISOString().slice(0, 10);

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
      if (kind === "xlsx") exportPartesToExcel(rows, from, to);
      else exportPartesToPDF(rows, from, to);
      setOpen(false);
      toast({ title: `Exportado correctamente · ${rows.length} parte(s)` });
    } catch (e: any) {
      toast({ title: "Error al exportar", description: e.message, variant: "destructive" });
    } finally {
      setBusy(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Download className="h-4 w-4" /> Exportar
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Download className="h-4 w-4 text-primary" />
            Exportar partes
          </DialogTitle>
          <DialogDescription>
            Genera un informe completo con cascada DJPMN, KPIs y detalle por parte.
          </DialogDescription>
        </DialogHeader>

        {/* Rango de fechas */}
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

        {/* Accesos rápidos */}
        <div className="flex flex-wrap gap-1.5">
          {[
            { label: "Hoy",     fn: () => { setFrom(today());      setTo(today());   } },
            { label: "7 días",  fn: () => { setFrom(daysAgo(6));   setTo(today());   } },
            { label: "30 días", fn: () => { setFrom(daysAgo(30));  setTo(today());   } },
            { label: "90 días", fn: () => { setFrom(daysAgo(90));  setTo(today());   } },
          ].map(({ label, fn }) => (
            <Button key={label} size="sm" variant="ghost" className="h-7 text-xs px-2.5" onClick={fn}>
              {label}
            </Button>
          ))}
        </div>

        {/* Contenido del informe */}
        <div className="rounded-lg bg-muted/50 p-3 space-y-1.5">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
            El informe incluye
          </p>
          <div className="grid grid-cols-2 gap-1.5">
            {[
              { icon: Factory,     text: "KPIs de producción" },
              { icon: TrendingDown,text: "Cascada DJPMN completa" },
              { icon: Package,     text: "Detalle de palets" },
              { icon: FileText,    text: "Página por parte (PDF)" },
              { icon: StickyNote,  text: "Notas e análisis IA" },
              { icon: Download,    text: "4 hojas Excel" },
            ].map(({ icon: Icon, text }) => (
              <div key={text} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Icon className="h-3 w-3 text-primary shrink-0" />
                <span>{text}</span>
              </div>
            ))}
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            variant="outline"
            className="flex-1"
            onClick={() => doExport("pdf")}
            disabled={busy !== null}
          >
            <FileText className="h-4 w-4" />
            {busy === "pdf" ? "Generando PDF…" : "Exportar PDF"}
          </Button>
          <Button
            className="flex-1"
            onClick={() => doExport("xlsx")}
            disabled={busy !== null}
          >
            <FileSpreadsheet className="h-4 w-4" />
            {busy === "xlsx" ? "Generando Excel…" : "Exportar Excel"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

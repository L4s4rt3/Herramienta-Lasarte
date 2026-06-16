import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { BadgeCheck, Camera, ClipboardCheck, ExternalLink, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "@/hooks/use-toast";
import {
  attachmentCountMap,
  calidadSummary,
  formatCalidadDate,
  type CalidadAdjunto,
  type CalidadLote,
} from "@/lib/calidad";
import { cn } from "@/lib/utils";

const QUALITY_STYLE = {
  Bueno: "border-emerald-500/30 bg-emerald-500/12 text-emerald-700 dark:text-emerald-300",
  Regular: "border-amber-500/35 bg-amber-500/14 text-amber-700 dark:text-amber-300",
  Deficiente: "border-orange-500/35 bg-orange-500/14 text-orange-700 dark:text-orange-300",
  Rechazado: "border-red-500/35 bg-red-500/12 text-red-700 dark:text-red-300",
} as const;

function errorMessage(error: unknown) {
  return error && typeof error === "object" && "message" in error ? String((error as { message: unknown }).message) : String(error);
}

export default function PartDetailCalidad({ date }: { date: string }) {
  const [loading, setLoading] = useState(true);
  const [lotes, setLotes] = useState<CalidadLote[]>([]);
  const [adjuntos, setAdjuntos] = useState<CalidadAdjunto[]>([]);

  useEffect(() => {
    let alive = true;
    async function load() {
      setLoading(true);
      try {
        const { data: lotesData, error } = await supabase
          .from("calidad_lotes")
          .select("*")
          .eq("fecha", date)
          .order("created_at", { ascending: true });
        if (error) throw error;

        const loadedLotes = (lotesData ?? []) as CalidadLote[];
        let loadedAdjuntos: CalidadAdjunto[] = [];
        if (loadedLotes.length > 0) {
          const { data: adjuntosData, error: adjuntosError } = await supabase
            .from("calidad_adjuntos")
            .select("*")
            .in("lote_id", loadedLotes.map((lote) => lote.id));
          if (adjuntosError) throw adjuntosError;
          loadedAdjuntos = (adjuntosData ?? []) as CalidadAdjunto[];
        }

        if (!alive) return;
        setLotes(loadedLotes);
        setAdjuntos(loadedAdjuntos);
      } catch (error) {
        if (alive) toast({ title: "Error cargando Calidad", description: errorMessage(error), variant: "destructive" });
      } finally {
        if (alive) setLoading(false);
      }
    }

    void load();
    return () => {
      alive = false;
    };
  }, [date]);

  const counts = useMemo(() => attachmentCountMap(adjuntos), [adjuntos]);
  const summary = useMemo(() => calidadSummary(lotes, counts), [lotes, counts]);

  if (loading) {
    return (
      <Card className="glass">
        <CardContent className="flex min-h-40 items-center justify-center">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            Cargando notas de calidad...
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="glass-accented">
      <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="panel-kicker">Notas conectadas</p>
          <CardTitle>Calidad · {formatCalidadDate(date)}</CardTitle>
          <p className="mt-2 text-sm text-muted-foreground">Notas de lotes tomadas para el mismo dia del parte.</p>
        </div>
        <Button variant="outline" className="glass glass-hover" asChild>
          <Link to={`/calidad?fecha=${date}`}>
            <ExternalLink className="h-4 w-4" />
            Abrir Calidad
          </Link>
        </Button>
      </CardHeader>
      <CardContent className="space-y-5">
        {lotes.length === 0 ? (
          <div className="rounded-xl border border-dashed border-primary/25 bg-[var(--glass-bg)] p-6 text-center">
            <ClipboardCheck className="mx-auto h-8 w-8 text-primary" />
            <h3 className="mt-3 text-base font-semibold">Sin notas para este dia</h3>
            <p className="mx-auto mt-1 max-w-lg text-sm text-muted-foreground">
              Puedes crearlas en Calidad y quedaran enlazadas automaticamente por fecha.
            </p>
            <Button className="mt-4 glass glass-hover" asChild>
              <Link to={`/calidad?fecha=${date}`}>Crear notas de calidad</Link>
            </Button>
          </div>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-4">
              {[
                { label: "Lotes", value: summary.total },
                { label: "Aerobotics", value: summary.aerobotics },
                { label: "Bueno", value: summary.byQuality.Bueno },
                { label: "Fotos", value: summary.fotos },
              ].map((item) => (
                <div key={item.label} className="rounded-xl border border-primary/10 bg-[var(--glass-bg)] px-4 py-3 shadow-[var(--glass-shadow)]">
                  <p className="text-xs text-muted-foreground">{item.label}</p>
                  <p className="mt-1 text-2xl font-semibold">{item.value}</p>
                </div>
              ))}
            </div>

            <div className="space-y-3">
              {lotes.map((lote) => (
                <div key={lote.id} className="rounded-xl border border-border/70 bg-[var(--glass-bg)] p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline" className={cn(QUALITY_STYLE[lote.calidad])}>
                          {lote.calidad}
                        </Badge>
                        {lote.aerobotics_realizado && (
                          <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
                            <BadgeCheck className="mr-1 h-3 w-3" />
                            Aerobotics
                          </Badge>
                        )}
                        {(counts[lote.id] ?? 0) > 0 && (
                          <Badge variant="outline" className="border-primary/20 bg-primary/8">
                            <Camera className="mr-1 h-3 w-3" />
                            {counts[lote.id]} adjunto(s)
                          </Badge>
                        )}
                      </div>
                      <h3 className="mt-2 text-base font-semibold">
                        {lote.numero_lote || "Lote sin numero"} · {lote.productor_finca_nombre || "Productor/Finca pendiente"}
                      </h3>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {[lote.producto, lote.variedad, lote.cantidad, lote.hora].filter(Boolean).join(" · ")}
                      </p>
                    </div>
                  </div>
                  {(lote.defectos.length > 0 || lote.observacion || lote.accion_recomendada) && (
                    <div className="mt-3 grid gap-3 lg:grid-cols-3">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Defectos</p>
                        <p className="mt-1 text-sm">{lote.defectos.join(", ") || "-"}</p>
                      </div>
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Observacion</p>
                        <p className="mt-1 text-sm">{lote.observacion || "-"}</p>
                      </div>
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Accion</p>
                        <p className="mt-1 text-sm">{lote.accion_recomendada || "-"}</p>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

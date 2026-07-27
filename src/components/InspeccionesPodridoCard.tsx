/**
 * InspeccionesPodridoCard — muestreos manuales de podrido del lote (ficha de
 * Trazabilidad). El operario cuenta las naranjas podridas de N box en la
 * línea; el nº de naranjas por box se deriva del peso del box y del peso
 * medio de la naranja (cálculo determinista en src/lib/podridoInspecciones.ts).
 * Es una señal de calidad para CONTRASTAR con el podrido pesado (bateas,
 * calibrador, Informe LOTE): no suma en ninguna pérdida.
 */
import { useMemo, useState } from "react";
import { ClipboardCheck, Loader2, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthProvider";
import { useInspeccionesPodrido } from "@/hooks/useInspeccionesPodrido";
import { computeInspeccionPodrido, parsePodridasPorBox } from "@/lib/podridoInspecciones";
import { errorMessage } from "@/lib/errorMessage";
import { formatDate, formatNumber, formatPct, today } from "@/lib/format";

export function InspeccionesPodridoCard({ lote }: { lote: string }) {
  const { role } = useAuth();
  const puedeEditar = role === "admin" || role === "ventas" || role === "operario";
  const { inspecciones, isLoading, crear, eliminar } = useInspeccionesPodrido(lote);

  const [open, setOpen] = useState(false);
  const [fecha, setFecha] = useState(today());
  const [pesoNaranja, setPesoNaranja] = useState("");
  const [kgBox, setKgBox] = useState("");
  const [podridasTexto, setPodridasTexto] = useState("");
  const [notas, setNotas] = useState("");

  const calculo = useMemo(() => {
    const podridas = parsePodridasPorBox(podridasTexto);
    const peso = Number(pesoNaranja.replace(",", "."));
    const kg = Number(kgBox.replace(",", "."));
    if (!podridas || !(peso > 0) || !(kg > 0)) return null;
    return computeInspeccionPodrido({ pesoNaranjaG: peso, kgPorBox: kg, podridasPorBox: podridas });
  }, [pesoNaranja, kgBox, podridasTexto]);

  const guardar = async () => {
    if (!calculo) return;
    try {
      await crear.mutateAsync({
        fecha,
        pesoNaranjaG: Number(pesoNaranja.replace(",", ".")),
        kgPorBox: Number(kgBox.replace(",", ".")),
        calculo,
        notas: notas.trim() || null,
      });
      toast({ title: "Inspección guardada", description: `${calculo.nBox} box · ${formatPct(calculo.pctPodrido * 100)} podrido` });
      setOpen(false);
      setPesoNaranja(""); setKgBox(""); setPodridasTexto(""); setNotas("");
    } catch (e) {
      toast({ title: "No se pudo guardar", description: errorMessage(e), variant: "destructive" });
    }
  };

  if (isLoading) return null;

  return (
    <Card className="glass-accented">
      <CardContent className="space-y-3 p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 border-primary/40 bg-primary/10 text-primary">
              <ClipboardCheck className="h-4 w-4" />
            </div>
            <div>
              <p className="text-sm font-semibold">Inspecciones de podrido</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Muestreo manual en línea (naranjas podridas por box). Señal de calidad: no suma en pérdidas.
              </p>
            </div>
          </div>
          {puedeEditar && (
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm">
                  <Plus className="mr-1.5 h-3.5 w-3.5" /> Añadir inspección
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle>Inspección de podrido — lote {lote}</DialogTitle>
                  <DialogDescription>
                    Cuenta las naranjas podridas de cada box; el total de naranjas por box se deriva del peso.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-3">
                  <div className="grid grid-cols-3 gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="insp-fecha">Fecha</Label>
                      <Input id="insp-fecha" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="insp-peso">Peso/naranja (g)</Label>
                      <Input id="insp-peso" inputMode="decimal" placeholder="176,11" value={pesoNaranja} onChange={(e) => setPesoNaranja(e.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="insp-kg">Kg por box</Label>
                      <Input id="insp-kg" inputMode="decimal" placeholder="196" value={kgBox} onChange={(e) => setKgBox(e.target.value)} />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="insp-podridas">Podridas por box (separadas por comas)</Label>
                    <Input id="insp-podridas" placeholder="119, 136, 128, 144, 157, 150, 152" value={podridasTexto} onChange={(e) => setPodridasTexto(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="insp-notas">Notas (opcional)</Label>
                    <Textarea id="insp-notas" rows={2} value={notas} onChange={(e) => setNotas(e.target.value)} />
                  </div>
                  {calculo ? (
                    <p className="rounded-lg border border-[var(--glass-border)] bg-[var(--glass-bg)] p-2.5 text-xs text-muted-foreground">
                      {formatNumber(calculo.naranjasPorBox)} naranjas/box × {calculo.nBox} box = {formatNumber(calculo.naranjasInspeccionadas)} inspeccionadas ·{" "}
                      {formatNumber(calculo.naranjasPodridas)} podridas →{" "}
                      <span className="font-semibold text-foreground">{formatPct(calculo.pctPodrido * 100)} podrido</span>
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground">Rellena peso, kg y podridas para ver el cálculo.</p>
                  )}
                </div>
                <DialogFooter>
                  <Button onClick={guardar} disabled={!calculo || crear.isPending}>
                    {crear.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                    Guardar inspección
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
        </div>

        {inspecciones.length === 0 ? (
          <p className="text-xs text-muted-foreground">Sin inspecciones registradas para este lote.</p>
        ) : (
          <div className="space-y-2">
            {inspecciones.map((i) => (
              <div key={i.id} className="rounded-lg border border-[var(--glass-border)] bg-[var(--glass-bg)] p-3">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                  <span className="text-xs text-muted-foreground">{formatDate(i.fecha)}</span>
                  <Badge variant="outline" className="border-warning/40 bg-warning/10 text-warning">
                    {formatPct(i.pct_podrido * 100)} podrido
                  </Badge>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {i.podridas_por_box.length} box · {formatNumber(i.naranjas_podridas)} de {formatNumber(i.naranjas_inspeccionadas)} naranjas
                    {i.peso_naranja_g != null && <> · {String(i.peso_naranja_g).replace(".", ",")} g/naranja</>}
                  </span>
                  {puedeEditar && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="ml-auto h-6 w-6 text-muted-foreground hover:text-destructive"
                      title="Eliminar inspección"
                      onClick={() => eliminar.mutate(i.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
                {i.podridas_por_box.length > 0 && (
                  <p className="mt-1 text-[11px] tabular-nums text-muted-foreground">
                    Por box: {i.podridas_por_box.join(" · ")}
                  </p>
                )}
                {i.notas && <p className="mt-1 text-[11px] text-muted-foreground">{i.notas}</p>}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

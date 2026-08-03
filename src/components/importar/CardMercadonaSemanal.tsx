// src/components/importar/CardMercadonaSemanal.tsx
// Tarjeta "Ventas semanales Mercadona" de la Bandeja (zona B, con
// confirmación): semana/año editables (el nombre del archivo puede confundir
// al parser, ver src/components/mercadona/MercadonaImportar.tsx) y guardado
// vía useMercadonaVentas().importSemanas.
import { useState } from "react";
import { CalendarRange, Save } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { toast } from "@/hooks/use-toast";
import { useMercadonaVentas } from "@/hooks/useMercadonaVentas";
import type { ParseMercadonaWorkbookResult, ParsedSemana } from "@/lib/mercadonaVentas";
import type { ArchivoClasificado } from "@/lib/importBandeja";
import { errorMessage } from "@/lib/errorMessage";
import { formatKg, formatNumber } from "@/lib/format";

interface Props {
  archivos: ArchivoClasificado[];
}

export function CardMercadonaSemanal({ archivos }: Props) {
  const ventas = useMercadonaVentas();
  const [semanasPreview, setSemanasPreview] = useState<ParsedSemana[]>(
    () => archivos.flatMap((a) => (a.payload as ParseMercadonaWorkbookResult).semanas),
  );
  const [importando, setImportando] = useState(false);
  const [resumenTexto, setResumenTexto] = useState<string | null>(null);

  if (archivos.length === 0) return null;

  const updateSemana = (index: number, patch: Partial<Pick<ParsedSemana, "semana" | "anio">>) => {
    setSemanasPreview((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], ...patch };
      return next;
    });
  };

  const handleImportar = async () => {
    if (semanasPreview.some((s) => !s.semana || s.semana < 1 || s.semana > 53)) {
      toast({ title: "Semana inválida", description: "Revisa el nº de semana antes de guardar (debe estar entre 1 y 53).", variant: "destructive" });
      return;
    }
    setImportando(true);
    try {
      const resumen = await ventas.importSemanas.mutateAsync(semanasPreview);
      setResumenTexto(`${resumen.creadas} semana(s) creada(s), ${resumen.actualizadas} actualizada(s).`);
      toast({ title: "Semanas de Mercadona guardadas" });
    } catch (e) {
      toast({ title: "Error al guardar", description: errorMessage(e), variant: "destructive" });
    } finally {
      setImportando(false);
    }
  };

  const kgTotal = semanasPreview.reduce((s, sem) => s + (sem.vendidoKg ?? 0), 0);

  return (
    <Card className="glass-accented overflow-hidden">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base"><CalendarRange className="h-4 w-4" /> Ventas semanales Mercadona</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          {formatNumber(semanasPreview.length)} semana(s) detectada(s) · {formatKg(kgTotal)} vendidos en total.
        </p>
        {semanasPreview.length > 0 ? (
          <div className="overflow-x-auto rounded-lg border border-[var(--glass-border)]">
            <table className="w-full text-[13px]">
              <thead className="border-b border-[var(--glass-border)] text-[10px] font-semibold uppercase tracking-wider text-muted-foreground [&>th]:px-3 [&>th]:py-1.5">
                <tr>
                  <th className="text-left">Semana / año</th>
                  <th className="text-left">Formato</th>
                  <th className="text-right">Vendido</th>
                  <th className="text-right">Métodos</th>
                </tr>
              </thead>
              <tbody>
                {semanasPreview.map((s, i) => (
                  <tr key={i} className={i % 2 === 1 ? "bg-[var(--glass-bg)]/40" : undefined}>
                    <td className="px-3 py-1.5">
                      <div className="flex items-center gap-1.5">
                        <span className="text-muted-foreground">S</span>
                        <Input
                          type="number"
                          className="h-7 w-16 px-1.5 text-xs tabular-nums"
                          value={s.semana || ""}
                          onChange={(e) => updateSemana(i, { semana: Number(e.target.value) })}
                        />
                        <span className="text-muted-foreground">·</span>
                        <Input
                          type="number"
                          className="h-7 w-20 px-1.5 text-xs tabular-nums"
                          value={s.anio}
                          onChange={(e) => updateSemana(i, { anio: Number(e.target.value) })}
                        />
                      </div>
                    </td>
                    <td className="px-3 py-1.5">
                      <Badge variant="outline" className="text-[10px]">
                        {s.origen === "semanal_real" ? "Semanal real" : "Histórico"}
                      </Badge>
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums font-medium">{s.vendidoKg != null ? formatKg(s.vendidoKg) : "—"}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{s.metodos.length}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        {resumenTexto ? <p className="text-xs text-success">{resumenTexto}</p> : null}
        <Button className="gap-2" size="sm" disabled={semanasPreview.length === 0 || importando} onClick={handleImportar}>
          <Save className="h-4 w-4" /> {importando ? "Guardando..." : "Importar semanas"}
        </Button>
      </CardContent>
    </Card>
  );
}

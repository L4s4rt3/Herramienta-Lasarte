// src/components/importar/CardBasculaEntradas.tsx
// Tarjeta "Entradas de báscula" de la Bandeja (zona B, con confirmación).
import { useMemo, useState } from "react";
import { AlertTriangle, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "@/hooks/use-toast";
import type { useEntradasBascula } from "@/hooks/useEntradasBascula";
import type { EntradaBasculaParsed, ParseEntradasBasculaResult } from "@/lib/entradasBascula";
import type { ArchivoClasificado } from "@/lib/importBandeja";
import { errorMessage } from "@/lib/errorMessage";
import { formatDate, formatKg, formatNumber } from "@/lib/format";

interface Props {
  archivos: ArchivoClasificado[];
  entradasBascula: ReturnType<typeof useEntradasBascula>;
}

export function CardBasculaEntradas({ archivos, entradasBascula }: Props) {
  const [importando, setImportando] = useState(false);
  const [resumenTexto, setResumenTexto] = useState<string | null>(null);

  const entradasParsed: EntradaBasculaParsed[] = useMemo(
    () => archivos.flatMap((a) => (a.payload as ParseEntradasBasculaResult).entradas),
    [archivos],
  );
  const descartadas = useMemo(
    () => archivos.flatMap((a) => (a.payload as ParseEntradasBasculaResult).descartadas),
    [archivos],
  );

  if (archivos.length === 0) return null;

  const fechas = entradasParsed.map((e) => e.fecha).sort();
  const kg = entradasParsed.reduce((s, e) => s + e.kg_entrada, 0);

  const handleImportar = () => {
    setImportando(true);
    entradasBascula.importar.mutate(entradasParsed, {
      onSuccess: () => {
        setResumenTexto(`${formatNumber(entradasParsed.length)} entrada(s) guardada(s).`);
        toast({ title: "Entradas importadas" });
        setImportando(false);
      },
      onError: (e) => {
        toast({ title: "Error al importar", description: errorMessage(e), variant: "destructive" });
        setImportando(false);
      },
    });
  };

  return (
    <Card className="glass-accented overflow-hidden">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base"><Truck className="h-4 w-4" /> Entradas de báscula</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          {formatNumber(entradasParsed.length)} entrada(s) · {fechas[0] ? formatDate(fechas[0]) : "—"}
          {fechas.length > 0 && fechas[fechas.length - 1] !== fechas[0] ? ` – ${formatDate(fechas[fechas.length - 1])}` : ""} ·{" "}
          <span className="font-semibold text-foreground">{formatKg(kg)}</span>
        </p>
        <div className="flex items-start gap-2 rounded-lg border border-info/30 bg-info/10 px-3 py-2 text-xs text-info">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Actualiza las entradas existentes por el mismo lote (upsert): un reimport del mismo día/lote sobrescribe los datos anteriores.
        </div>
        {descartadas.length > 0 ? (
          <p className="text-xs text-warning">{formatNumber(descartadas.length)} fila(s) descartada(s) al leer el archivo.</p>
        ) : null}
        {resumenTexto ? <p className="text-xs text-success">{resumenTexto}</p> : null}
        <Button size="sm" disabled={entradasParsed.length === 0 || importando} onClick={handleImportar}>
          {importando ? "Importando..." : "Importar entradas"}
        </Button>
      </CardContent>
    </Card>
  );
}

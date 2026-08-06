// src/components/importar/CardEntradaFruta.tsx
// Tarjeta "Entradas de fruta (informe del ERP)" de la Bandeja (zona B, con
// confirmación). Encargo del dueño 06-08-2026: esos informes salían como
// "Desconocido" y son los que traen las re-entradas de precalibrado del día.
//
// A diferencia del export de báscula, el informe NO trae el código de lote:
// se reconstruye con fecha + nº de pesada (parseEntradaFrutaRows). Por eso
// esta tarjeta enseña los códigos que va a escribir ANTES de confirmar —
// sobre todo en el formato B, donde la pesada se deduce del orden.
import { useMemo, useState } from "react";
import { AlertTriangle, Sprout } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "@/hooks/use-toast";
import type { useEntradasBascula } from "@/hooks/useEntradasBascula";
import type { EntradaFrutaParsed, ParseEntradaFrutaResult } from "@/lib/entradasBascula";
import type { ArchivoClasificado } from "@/lib/importBandeja";
import { errorMessage } from "@/lib/errorMessage";
import { formatDate, formatKg, formatNumber } from "@/lib/format";

interface Props {
  archivos: ArchivoClasificado[];
  entradasBascula: ReturnType<typeof useEntradasBascula>;
}

export function CardEntradaFruta({ archivos, entradasBascula }: Props) {
  const [importando, setImportando] = useState(false);
  const [resumenTexto, setResumenTexto] = useState<string | null>(null);

  const entradas: EntradaFrutaParsed[] = useMemo(
    () => archivos.flatMap((a) => (a.payload as ParseEntradaFrutaResult).entradas),
    [archivos],
  );
  const descartadas = useMemo(
    () => archivos.flatMap((a) => (a.payload as ParseEntradaFrutaResult).descartadas),
    [archivos],
  );

  if (archivos.length === 0) return null;

  const fechas = entradas.map((e) => e.fecha).sort();
  const kg = entradas.reduce((s, e) => s + e.kg_entrada, 0);
  const deducidas = entradas.filter((e) => e.pesadaDeducida).length;

  const handleImportar = () => {
    setImportando(true);
    entradasBascula.importarEntradaFruta.mutate(entradas, {
      onSuccess: () => {
        setResumenTexto(`${formatNumber(entradas.length)} entrada(s) guardada(s).`);
        toast({ title: "Entradas de fruta importadas" });
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
        <CardTitle className="flex items-center gap-2 text-base"><Sprout className="h-4 w-4" /> Entradas de fruta (informe del ERP)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          {formatNumber(entradas.length)} entrada(s) · {fechas[0] ? formatDate(fechas[0]) : "—"}
          {fechas.length > 0 && fechas[fechas.length - 1] !== fechas[0] ? ` – ${formatDate(fechas[fechas.length - 1])}` : ""} ·{" "}
          <span className="font-semibold text-foreground">{formatKg(kg)}</span>
        </p>

        <div className="max-h-48 overflow-y-auto rounded-lg border border-[var(--glass-border)]">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-[var(--glass-bg)]">
              <tr className="text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="px-2 py-1.5 text-left">Lote</th>
                <th className="px-2 py-1.5 text-left">Fecha</th>
                <th className="px-2 py-1.5 text-left">Agricultor / finca</th>
                <th className="px-2 py-1.5 text-right">Kg</th>
              </tr>
            </thead>
            <tbody>
              {entradas.map((e) => (
                <tr key={e.lote} className="border-t border-[var(--glass-border)]">
                  <td className="px-2 py-1 font-mono">{e.lote}</td>
                  <td className="px-2 py-1 text-muted-foreground">{formatDate(e.fecha)}</td>
                  <td className="px-2 py-1 text-muted-foreground">{e.finca || e.agricultor || "—"}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{formatKg(e.kg_entrada)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex items-start gap-2 rounded-lg border border-info/30 bg-info/10 px-3 py-2 text-xs text-info">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            Este informe no trae el código de lote: se compone con la fecha y el nº de pesada
            {deducidas > 0 ? `, y en ${formatNumber(deducidas)} fila(s) la pesada se deduce del orden del nº de entrada — comprueba los códigos de arriba` : ""}.
            Tampoco trae los box: los que ya estén guardados (del informe de stock de lotes) se conservan.
          </span>
        </div>

        {descartadas.length > 0 ? (
          <p className="text-xs text-warning">{formatNumber(descartadas.length)} fila(s) descartada(s) al leer el archivo.</p>
        ) : null}
        {resumenTexto ? <p className="text-xs text-success">{resumenTexto}</p> : null}
        <Button size="sm" disabled={entradas.length === 0 || importando} onClick={handleImportar}>
          {importando ? "Importando..." : "Importar entradas de fruta"}
        </Button>
      </CardContent>
    </Card>
  );
}

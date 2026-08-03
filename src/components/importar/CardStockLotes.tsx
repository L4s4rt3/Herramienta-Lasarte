// src/components/importar/CardStockLotes.tsx
// Tarjeta "Stock de lotes (báscula)" de la Bandeja (zona B, con
// confirmación): SIEMBRA el stock inicial (ignoreDuplicates: solo crea lo
// que falta). Para CONCILIAR la cámara contra lo ya cargado se usa /entradas.
import { useMemo, useState } from "react";
import { Info, Warehouse } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "@/hooks/use-toast";
import type { useEntradasBascula } from "@/hooks/useEntradasBascula";
import { buildEntradasDesdeStock, type ParseStockLotesResult } from "@/lib/entradasBascula";
import type { ArchivoClasificado } from "@/lib/importBandeja";
import { errorMessage } from "@/lib/errorMessage";
import { formatKg, formatNumber } from "@/lib/format";

interface Props {
  archivos: ArchivoClasificado[];
  entradasBascula: ReturnType<typeof useEntradasBascula>;
}

export function CardStockLotes({ archivos, entradasBascula }: Props) {
  const [importando, setImportando] = useState(false);
  const [resumenTexto, setResumenTexto] = useState<string | null>(null);

  const lotes = useMemo(
    () => archivos.flatMap((a) => (a.payload as ParseStockLotesResult).lotes),
    [archivos],
  );
  const descartadas = useMemo(
    () => archivos.flatMap((a) => (a.payload as ParseStockLotesResult).descartadas),
    [archivos],
  );
  const entradasAConstruir = useMemo(
    () => buildEntradasDesdeStock(lotes, entradasBascula.procesados),
    [lotes, entradasBascula.procesados],
  );

  if (archivos.length === 0) return null;

  const kg = entradasAConstruir.reduce((s, e) => s + e.kg_entrada, 0);

  const handleImportar = () => {
    setImportando(true);
    entradasBascula.importarStock.mutate(entradasAConstruir, {
      onSuccess: () => {
        setResumenTexto(`${formatNumber(lotes.length)} lote(s) procesados: solo se crean los que todavía no existían.`);
        toast({ title: "Stock inicial sembrado" });
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
        <CardTitle className="flex items-center gap-2 text-base"><Warehouse className="h-4 w-4" /> Stock de lotes (báscula)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          {formatNumber(lotes.length)} lote(s) con existencias · <span className="font-semibold text-foreground">{formatKg(kg)}</span> reconstruidos
        </p>
        <div className="flex items-start gap-2 rounded-lg border border-info/30 bg-info/10 px-3 py-2 text-xs text-info">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Este import SIEMBRA el stock inicial de arranque: solo crea los lotes que todavía no existen (ignoreDuplicates), nunca
          machaca una entrada real de báscula ya cargada. Para CONCILIAR la cámara con lo que ya hay en la app usa Entradas de fruta.
        </div>
        {descartadas.length > 0 ? (
          <p className="text-xs text-warning">{formatNumber(descartadas.length)} fila(s) descartada(s) al leer el archivo.</p>
        ) : null}
        {resumenTexto ? <p className="text-xs text-success">{resumenTexto}</p> : null}
        <Button size="sm" disabled={entradasAConstruir.length === 0 || importando} onClick={handleImportar}>
          {importando ? "Importando..." : "Sembrar stock inicial"}
        </Button>
      </CardContent>
    </Card>
  );
}

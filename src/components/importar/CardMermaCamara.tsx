// src/components/importar/CardMermaCamara.tsx
// Tarjeta "Merma de cámara (manual)" de la Bandeja (zona B, con
// confirmación): replica handleImportarMermaCamara de
// src/pages/EntradasBascula.tsx — casa cada camión con su entrada de báscula
// (casarMermaCamara) y aplica los updates fila a fila, enseñando casados
// exactos/aproximados/ambiguos/sin casar ANTES de confirmar.
import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Snowflake } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import type { useEntradasBascula } from "@/hooks/useEntradasBascula";
import { casarMermaCamara, type ParseMermaCamaraResult } from "@/lib/mermaCamaraImport";
import type { ArchivoClasificado } from "@/lib/importBandeja";
import { errorMessage } from "@/lib/errorMessage";
import { formatNumber } from "@/lib/format";

interface Props {
  archivos: ArchivoClasificado[];
  entradasBascula: ReturnType<typeof useEntradasBascula>;
}

export function CardMermaCamara({ archivos, entradasBascula }: Props) {
  const queryClient = useQueryClient();
  const [importando, setImportando] = useState(false);
  const [resumenTexto, setResumenTexto] = useState<string | null>(null);

  const registros = useMemo(
    () => archivos.flatMap((a) => (a.payload as ParseMermaCamaraResult).registros),
    [archivos],
  );
  const descartadas = useMemo(
    () => archivos.flatMap((a) => (a.payload as ParseMermaCamaraResult).descartadas),
    [archivos],
  );
  const casado = useMemo(
    () => casarMermaCamara(
      registros,
      entradasBascula.entradas.map((e) => ({ id: e.id, lote: e.lote, fecha: e.fecha, kg_entrada: Number(e.kg_entrada) || 0, finca: e.finca })),
    ),
    [registros, entradasBascula.entradas],
  );

  if (archivos.length === 0) return null;

  const aproximados = casado.casados.filter((c) => c.aviso);

  const handleImportar = async () => {
    setImportando(true);
    try {
      // merma_camara_kg / fecha_salida_camara: columnas de la migración
      // 20260721150000, aún no reflejadas en los tipos generados (mismo
      // patrón de cast que EntradasBascula.tsx).
      for (const c of casado.casados) {
        const { error } = await supabase
          .from("entradas_bascula")
          .update({ merma_camara_kg: c.registro.mermaKg, fecha_salida_camara: c.registro.fechaSalida })
          .eq("id", c.id);
        if (error) throw new Error(errorMessage(error));
      }
      queryClient.invalidateQueries({ queryKey: ["entradas_bascula"] });
      queryClient.invalidateQueries({ queryKey: ["merma-lote"] });
      setResumenTexto(
        `${formatNumber(casado.casados.length)} camión(es) casado(s)${aproximados.length ? ` (${formatNumber(aproximados.length)} aproximado(s))` : ""}, ${formatNumber(casado.sinCasar.length)} sin casar, ${formatNumber(casado.ambiguos.length)} ambiguo(s).`,
      );
      toast({ title: "Mermas de cámara importadas" });
    } catch (e) {
      toast({ title: "No se pudo importar", description: errorMessage(e), variant: "destructive" });
    } finally {
      setImportando(false);
    }
  };

  return (
    <Card className="glass-accented overflow-hidden">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base"><Snowflake className="h-4 w-4" /> Merma de cámara (manual)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          {formatNumber(registros.length)} registro(s) leído(s) de la cámara.
        </p>
        <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
          <div className="rounded-lg border border-[var(--glass-border)] bg-[var(--glass-bg)] p-2">
            <p className="text-muted-foreground">Casados exactos</p>
            <p className="text-base font-semibold tabular-nums">{formatNumber(casado.casados.length - aproximados.length)}</p>
          </div>
          <div className="rounded-lg border border-warning/30 bg-warning/10 p-2">
            <p className="text-muted-foreground">Aproximados</p>
            <p className="text-base font-semibold tabular-nums text-warning">{formatNumber(aproximados.length)}</p>
          </div>
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-2">
            <p className="text-muted-foreground">Ambiguos</p>
            <p className="text-base font-semibold tabular-nums text-destructive">{formatNumber(casado.ambiguos.length)}</p>
          </div>
          <div className="rounded-lg border border-[var(--glass-border)] bg-[var(--glass-bg)] p-2">
            <p className="text-muted-foreground">Sin casar</p>
            <p className="text-base font-semibold tabular-nums">{formatNumber(casado.sinCasar.length)}</p>
          </div>
        </div>
        {aproximados.length > 0 ? (
          <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{aproximados.map((c) => `${c.lote} — ${c.aviso}`).join("; ")}</span>
          </div>
        ) : null}
        {descartadas.length > 0 ? (
          <p className="text-xs text-warning">{formatNumber(descartadas.length)} fila(s) descartada(s) al leer el archivo.</p>
        ) : null}
        {resumenTexto ? <p className="text-xs text-success">{resumenTexto}</p> : null}
        <Button size="sm" disabled={casado.casados.length === 0 || importando} onClick={handleImportar}>
          {importando ? "Importando..." : "Importar mermas de cámara"}
        </Button>
      </CardContent>
    </Card>
  );
}

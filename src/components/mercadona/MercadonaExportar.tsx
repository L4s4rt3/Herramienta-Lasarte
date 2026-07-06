// src/components/mercadona/MercadonaExportar.tsx
// Pestaña "Exportar": genera un Excel IDENTICO en disposicion a la hoja original
// de Mercadona para la semana seleccionada (misma estructura de filas/columnas),
// via buildSemanaExportRows + appendAoaSheet. Sin logo Lasarte dentro de la hoja
// para priorizar la fidelidad al original (regla del encargo).
import { useState } from "react";
import { Download, FileSpreadsheet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { appendAoaSheet, createWorkbook, saveWorkbook } from "@/lib/exportWorkbook";
import { buildSemanaExportRows } from "@/lib/mercadonaVentas";
import type { MercadonaMetodoRow, MercadonaSemanaConMetodos } from "@/hooks/useMercadonaVentas";

const COL_WIDTHS = [30, 26, 14, 14, 10, 10, 16];

interface MercadonaExportarProps {
  semanas: MercadonaSemanaConMetodos[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function MercadonaExportar({ semanas, selectedId, onSelect }: MercadonaExportarProps) {
  const [exporting, setExporting] = useState(false);
  const semana = semanas.find((s) => s.id === selectedId) ?? semanas[0] ?? null;

  const handleExport = async () => {
    if (!semana) return;
    setExporting(true);
    try {
      const rows = buildSemanaExportRows({
        anio: semana.anio,
        semana: semana.semana,
        rangoPlanificacion: semana.rango_planificacion,
        planificadoQuincenaKg: semana.planificado_quincena_kg,
        planificadoSemanaKg: semana.planificado_semana_kg,
        vendidoKg: semana.vendido_kg,
        diferenciaPct: semana.diferencia_pct,
        notas: semana.notas,
        metodos: sortMetodos(semana.metodos).map((m) => ({
          metodo: m.metodo,
          descripcion: m.descripcion ?? "",
          pct: m.pct,
          kilos: m.kilos ?? 0,
          palets: m.palets ?? 0,
          cajas: m.cajas ?? 0,
          comparativaAnteriorPct: m.comparativa_anterior_pct,
        })),
      });

      const wb = createWorkbook(
        `Ventas Mercadona S${semana.semana} ${semana.anio}`,
        "Planificacion y ventas semanales Mercadona",
      );
      appendAoaSheet(wb, `SEMANA ${semana.semana}`, rows as (string | number | boolean | null)[][], COL_WIDTHS);
      saveWorkbook(wb, `Lasarte_Mercadona_S${semana.semana}_${semana.anio}.xlsx`);
    } finally {
      setExporting(false);
    }
  };

  return (
    <Card className="glass-accented">
      <CardHeader>
        <CardTitle className="text-base">Exportar semana</CardTitle>
        <p className="text-xs text-muted-foreground">
          Genera un Excel con la misma disposición que el original de Mercadona (planificación, tabla de métodos,
          vendido/planificado/variación y notas).
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {semanas.length === 0 ? (
          <div className="rounded-lg border border-dashed border-[var(--glass-border)] p-8 text-center text-sm text-muted-foreground">
            <FileSpreadsheet className="mx-auto mb-3 h-8 w-8 opacity-50" />
            Importa al menos una semana para poder exportarla.
          </div>
        ) : (
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <label className="panel-kicker">Semana</label>
              <Select value={semana?.id} onValueChange={onSelect}>
                <SelectTrigger className="h-9 w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {semanas.map((s) => (
                    <SelectItem key={s.id} value={s.id}>S{s.semana} · {s.anio}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button className="gap-2" onClick={handleExport} disabled={!semana || exporting}>
              <Download className="h-4 w-4" />
              {exporting ? "Generando..." : "Descargar Excel"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function sortMetodos(metodos: MercadonaMetodoRow[]): MercadonaMetodoRow[] {
  const order = ["MA12KGC", "MA3KGC", "MA4KGC", "MA5KGC"];
  return [...metodos].sort((a, b) => order.indexOf(a.metodo.toUpperCase()) - order.indexOf(b.metodo.toUpperCase()));
}

// src/components/mercadona/MercadonaExportar.tsx
// Pestaña "Exportar": genera un Excel INDISTINGUIBLE de la hoja original de
// Mercadona para la semana seleccionada (mismas filas/columnas, mismos number
// formats "#,##0"/contable/porcentaje y mismos anchos de columna, sin merges
// porque el original tampoco los tiene). Construye el workbook con XLSX
// directamente (no createWorkbook/saveWorkbook de exportWorkbook.ts) para NO
// heredar el pipeline de restyle + logo Lasarte que esas funciones inyectan a
// TODAS las hojas del libro: aquí la prioridad es la fidelidad byte a byte al
// original, no la plantilla visual de Lasarte. Ver buildSemanaExportSheet en
// mercadonaVentas.ts para el detalle de la disposicion clonada.
import { useState } from "react";
import * as XLSX from "xlsx";
import { Download, FileSpreadsheet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { downloadBytes } from "@/lib/exportWorkbook";
import { buildSemanaExportSheet, completarPctYComparativa, type MetodoVenta } from "@/lib/mercadonaVentas";
import type { MercadonaMetodoRow, MercadonaSemanaConMetodos } from "@/hooks/useMercadonaVentas";

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
      const metodos: MetodoVenta[] = sortMetodos(semana.metodos).map((m) => ({
        metodo: m.metodo,
        descripcion: m.descripcion ?? "",
        pct: m.pct,
        kilos: m.kilos ?? 0,
        palets: m.palets ?? null,
        cajas: m.cajas ?? null,
        comparativaAnteriorPct: m.comparativa_anterior_pct,
      }));

      // Semana inmediatamente anterior en la lista (ordenada por anio,semana
      // ascendente): fuente de la comparativa cuando la semana actual no la
      // trae (típico del formato semanal real, que no tiene esa columna).
      const idxActual = semanas.findIndex((s) => s.id === semana.id);
      const semanaAnterior = idxActual > 0 ? semanas[idxActual - 1] : null;
      const metodosAnterior: MetodoVenta[] | null = semanaAnterior
        ? sortMetodos(semanaAnterior.metodos).map((m) => ({
          metodo: m.metodo,
          descripcion: m.descripcion ?? "",
          pct: m.pct,
          kilos: m.kilos ?? 0,
          palets: m.palets ?? null,
          cajas: m.cajas ?? null,
          comparativaAnteriorPct: m.comparativa_anterior_pct,
        }))
        : null;

      const sheet = buildSemanaExportSheet({
        anio: semana.anio,
        semana: semana.semana,
        rangoPlanificacion: semana.rango_planificacion,
        planificadoQuincenaKg: semana.planificado_quincena_kg,
        planificadoSemanaKg: semana.planificado_semana_kg,
        vendidoKg: semana.vendido_kg,
        diferenciaPct: semana.diferencia_pct,
        notas: semana.notas,
        metodos: completarPctYComparativa(metodos, metodosAnterior),
        ajustesBaseIva: semana.ajustes_base_iva,
        ajustesLineas: semana.ajustes_lineas,
        antequeraIiKg: semana.antequera_ii_kg ?? null,
        antequeraVerduraKg: semana.antequera_verdura_kg ?? null,
      });

      const ws = XLSX.utils.aoa_to_sheet(sheet.rows as (string | number | boolean | null)[][]);
      for (const { row, col, numFmt } of sheet.formats) {
        const addr = XLSX.utils.encode_cell({ r: row, c: col });
        const cell = ws[addr];
        if (cell) cell.z = numFmt;
      }
      ws["!cols"] = sheet.colWidths.map((wch) => ({ wch }));
      ws["!merges"] = sheet.merges;

      const wb = XLSX.utils.book_new();
      wb.Props = {
        Title: `Ventas Mercadona S${semana.semana} ${semana.anio}`,
        Subject: "Planificacion y ventas semanales Mercadona",
        Author: "Herramienta Lasarte SAT",
        Company: "Lasarte SAT",
      };
      XLSX.utils.book_append_sheet(wb, ws, `SEMANA ${semana.semana}`);
      const bytes = XLSX.write(wb, { bookType: "xlsx", type: "array", compression: true }) as ArrayBuffer;
      downloadBytes(new Uint8Array(bytes), `Lasarte_Mercadona_S${semana.semana}_${semana.anio}.xlsx`);
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

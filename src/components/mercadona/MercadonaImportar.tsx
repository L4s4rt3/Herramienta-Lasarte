// src/components/mercadona/MercadonaImportar.tsx
// Pestaña "Importar": lee el xlsx semanal en cliente (todas las hojas "SEMANA N"),
// muestra preview de lo parseado y hace upsert por (anio, semana). También permite
// editar a mano el planificado_semana_kg de cualquier semana ya guardada (para
// semanas futuras, antes de que llegue el excel).
import { useState, type ChangeEvent } from "react";
import * as XLSX from "xlsx";
import { CalendarRange, CheckCircle2, Save, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { errorMessage } from "@/lib/errorMessage";
import { formatKg, formatNumber } from "@/lib/format";
import { parseMercadonaWorkbook, type ParseMercadonaWorkbookResult, type SheetRows } from "@/lib/mercadonaVentas";
import type { MercadonaSemanaConMetodos, useMercadonaVentas } from "@/hooks/useMercadonaVentas";

const currentYear = new Date().getFullYear();
const YEAR_OPTIONS = [currentYear - 1, currentYear, currentYear + 1];

async function parseMercadonaExcelFile(file: File, anio: number): Promise<ParseMercadonaWorkbookResult> {
  const data = await file.arrayBuffer();
  const workbook = XLSX.read(data, { type: "array", cellDates: false });
  const sheets: Record<string, SheetRows> = {};
  workbook.SheetNames.forEach((sheetName) => {
    sheets[sheetName] = XLSX.utils.sheet_to_json<SheetRows[number]>(workbook.Sheets[sheetName], {
      header: 1,
      raw: false,
      defval: "",
    });
  });
  return parseMercadonaWorkbook(sheets, anio);
}

interface MercadonaImportarProps {
  ventas: ReturnType<typeof useMercadonaVentas>;
  onImported: () => void;
}

export function MercadonaImportar({ ventas, onImported }: MercadonaImportarProps) {
  const [anio, setAnio] = useState(currentYear);
  const [parsing, setParsing] = useState(false);
  const [parsed, setParsed] = useState<ParseMercadonaWorkbookResult | null>(null);

  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    setParsing(true);
    try {
      const result = await parseMercadonaExcelFile(file, anio);
      setParsed(result);
      if (result.semanas.length === 0) {
        toast({
          title: "Sin hojas de semana",
          description: "No se encontraron hojas con formato 'SEMANA N' en el archivo.",
          variant: "destructive",
        });
      } else {
        toast({
          title: "Excel analizado",
          description: `${result.semanas.length} semana(s) detectada(s)${result.hojasIgnoradas.length ? `, ${result.hojasIgnoradas.length} hoja(s) ignorada(s)` : ""}.`,
        });
      }
    } catch (error) {
      toast({ title: "No se pudo leer el Excel", description: errorMessage(error), variant: "destructive" });
    } finally {
      setParsing(false);
    }
  };

  const handleSave = async () => {
    if (!parsed || parsed.semanas.length === 0) return;
    try {
      const result = await ventas.importSemanas.mutateAsync(parsed.semanas);
      toast({
        title: "Semanas guardadas",
        description: `${result.creadas} creada(s), ${result.actualizadas} actualizada(s).`,
      });
      setParsed(null);
      onImported();
    } catch (error) {
      toast({ title: "Error al guardar", description: errorMessage(error), variant: "destructive" });
    }
  };

  return (
    <div className="space-y-4">
      <Card className="glass-accented">
        <CardHeader>
          <CardTitle className="text-base">Importar Excel semanal</CardTitle>
          <p className="text-xs text-muted-foreground">
            "VENTAS SEMANA X PLATAFORMA ANTEQUERA.xlsx" — una hoja por semana ("SEMANA 21", "SEMANA 22"...).
            Se procesan todas las hojas de semana que contenga el archivo en una sola importación.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <label className="panel-kicker">Año de las semanas</label>
              <Select value={String(anio)} onValueChange={(v) => setAnio(Number(v))}>
                <SelectTrigger className="h-9 w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {YEAR_OPTIONS.map((y) => (
                    <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button asChild variant="outline" size="sm" className="h-9 cursor-pointer gap-1.5 rounded-md px-3 text-xs">
              <label>
                <Input className="hidden" type="file" accept=".xlsx,.xls" onChange={handleFile} />
                <Upload className="h-3.5 w-3.5" />
                {parsing ? "Leyendo..." : "Seleccionar Excel"}
              </label>
            </Button>
          </div>

          {parsed ? (
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-3">
                <MiniStat label="Semanas detectadas" value={formatNumber(parsed.semanas.length)} />
                <MiniStat label="Hojas ignoradas" value={formatNumber(parsed.hojasIgnoradas.length)} />
                <MiniStat
                  label="Kg vendidos (total)"
                  value={formatKg(parsed.semanas.reduce((s, sem) => s + (sem.vendidoKg ?? 0), 0))}
                />
              </div>

              {parsed.semanas.length > 0 ? (
                <div className="overflow-x-auto rounded-lg border border-[var(--glass-border)]">
                  <table className="w-full text-[13px]">
                    <thead className="border-b border-[var(--glass-border)] text-[10px] font-semibold uppercase tracking-wider text-muted-foreground [&>th]:px-3 [&>th]:py-1.5">
                      <tr>
                        <th className="text-left">Semana</th>
                        <th className="text-left">Rango planificación</th>
                        <th className="text-right">Planificado sem.</th>
                        <th className="text-right">Vendido</th>
                        <th className="text-right">Diferencia</th>
                        <th className="text-right">Métodos</th>
                        <th className="text-right">Notas</th>
                      </tr>
                    </thead>
                    <tbody>
                      {parsed.semanas.map((s, i) => (
                        <tr key={s.semana} className={i % 2 === 1 ? "bg-[var(--glass-bg)]/40" : undefined}>
                          <td className="px-3 py-1.5 font-semibold">S{s.semana} · {s.anio}</td>
                          <td className="px-3 py-1.5 text-muted-foreground">{s.rangoPlanificacion ?? "—"}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{s.planificadoSemanaKg != null ? formatKg(s.planificadoSemanaKg) : "—"}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums font-medium">{s.vendidoKg != null ? formatKg(s.vendidoKg) : "—"}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{s.diferenciaPct != null ? `${formatNumber(s.diferenciaPct, 1)}%` : "—"}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{s.metodos.length}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{s.notas.length}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}

              <Button
                className="gap-2"
                disabled={parsed.semanas.length === 0 || ventas.importSemanas.isPending}
                onClick={handleSave}
              >
                <Save className="h-4 w-4" />
                {ventas.importSemanas.isPending ? "Guardando..." : "Guardar en Supabase"}
              </Button>
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-[var(--glass-border)] p-8 text-center text-sm text-muted-foreground">
              <CalendarRange className="mx-auto mb-3 h-8 w-8 opacity-50" />
              Selecciona el Excel semanal para ver el preview antes de guardar.
            </div>
          )}
        </CardContent>
      </Card>

      <MercadonaPlanificacionManual ventas={ventas} />
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[var(--glass-border)] bg-[var(--glass-bg)] p-3">
      <p className="panel-kicker">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums">{value}</p>
    </div>
  );
}

/** Edición manual de planificado_semana_kg para cualquier semana ya guardada (útil para semanas futuras). */
function MercadonaPlanificacionManual({ ventas }: { ventas: ReturnType<typeof useMercadonaVentas> }) {
  if (ventas.semanas.length === 0) return null;

  return (
    <Card className="glass-accented overflow-hidden">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Planificación manual</CardTitle>
        <p className="text-xs text-muted-foreground">
          Edita el kg planificado de una semana futura (aún sin Excel de Mercadona) o corrige una ya importada.
        </p>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead className="border-b border-[var(--glass-border)] text-[10px] font-semibold uppercase tracking-wider text-muted-foreground [&>th]:px-3 [&>th]:py-1.5">
              <tr>
                <th className="text-left">Semana</th>
                <th className="text-left">Planificado actual</th>
                <th className="w-40">Nuevo valor (kg)</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {[...ventas.semanas].reverse().map((s, i) => (
                <PlanificacionRow key={s.id} semana={s} zebra={i % 2 === 1} ventas={ventas} />
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function PlanificacionRow({
  semana, zebra, ventas,
}: {
  semana: MercadonaSemanaConMetodos;
  zebra: boolean;
  ventas: ReturnType<typeof useMercadonaVentas>;
}) {
  const [value, setValue] = useState(String(semana.planificado_semana_kg ?? ""));
  const [saved, setSaved] = useState(false);

  const handleSave = async () => {
    const kg = Number(value);
    if (!Number.isFinite(kg)) {
      toast({ title: "Valor no válido", variant: "destructive" });
      return;
    }
    try {
      await ventas.updatePlanificadoSemana.mutateAsync({ id: semana.id, planificado_semana_kg: kg });
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch (error) {
      toast({ title: "Error al guardar", description: errorMessage(error), variant: "destructive" });
    }
  };

  return (
    <tr className={zebra ? "bg-[var(--glass-bg)]/40" : undefined}>
      <td className="px-3 py-1.5 font-semibold">S{semana.semana} · {semana.anio}</td>
      <td className="px-3 py-1.5 text-muted-foreground tabular-nums">
        {semana.planificado_semana_kg != null ? formatKg(semana.planificado_semana_kg) : "Sin dato"}
      </td>
      <td className="px-2 py-1">
        <Input type="number" className="h-8 text-xs" value={value} onChange={(e) => setValue(e.target.value)} />
      </td>
      <td className="px-2 py-1">
        <Button size="icon" variant="outline" className="h-8 w-8" onClick={handleSave} disabled={ventas.updatePlanificadoSemana.isPending}>
          {saved ? <CheckCircle2 className="h-3.5 w-3.5 text-success" /> : <Save className="h-3.5 w-3.5" />}
        </Button>
      </td>
    </tr>
  );
}

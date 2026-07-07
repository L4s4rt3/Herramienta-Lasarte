// src/components/mercadona/MercadonaImportar.tsx
// Pestaña "Importar": lee el xlsx en cliente autodetectando el formato por hoja
// (historico "SEMANA N" con planificacion, o semanal real de una sola hoja con
// Método/Descripción/Líneas/KILOS/Base Iva), muestra preview editable y hace
// upsert por (anio, semana). También permite editar a mano el planificado_semana_kg
// de cualquier semana ya guardada (para semanas futuras, o cuando el formato
// semanal real no trae planificación y hay que teclearla).
import { useState, type ChangeEvent } from "react";
import * as XLSX from "xlsx";
import { CalendarRange, CheckCircle2, Save, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { errorMessage } from "@/lib/errorMessage";
import { formatKg, formatNumber } from "@/lib/format";
import { parseMercadonaWorkbook, type ParsedSemana, type ParseMercadonaWorkbookResult, type SheetRows } from "@/lib/mercadonaVentas";
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
  return parseMercadonaWorkbook(sheets, anio, file.name);
}

interface MercadonaImportarProps {
  ventas: ReturnType<typeof useMercadonaVentas>;
  onImported: () => void;
}

export function MercadonaImportar({ ventas, onImported }: MercadonaImportarProps) {
  const [anio, setAnio] = useState(currentYear);
  const [parsing, setParsing] = useState(false);
  const [hojasIgnoradas, setHojasIgnoradas] = useState<string[]>([]);
  // Preview editable: el nº de semana/año se infiere automaticamente pero puede
  // corregirse a mano antes de guardar (sobre todo en el formato semanal real,
  // donde no viene dentro del Excel sino del nombre de archivo).
  const [semanasPreview, setSemanasPreview] = useState<ParsedSemana[] | null>(null);

  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    setParsing(true);
    try {
      const result = await parseMercadonaExcelFile(file, anio);
      setSemanasPreview(result.semanas);
      setHojasIgnoradas(result.hojasIgnoradas);
      if (result.semanas.length === 0) {
        toast({
          title: "Formato no reconocido",
          description: "No se encontraron hojas 'SEMANA N' (histórico) ni una hoja con cabecera Método/Descripción/Líneas/KILOS (semanal real).",
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

  const updatePreviewSemana = (index: number, patch: Partial<Pick<ParsedSemana, "semana" | "anio">>) => {
    setSemanasPreview((prev) => {
      if (!prev) return prev;
      const next = [...prev];
      next[index] = { ...next[index], ...patch };
      return next;
    });
  };

  const handleSave = async () => {
    if (!semanasPreview || semanasPreview.length === 0) return;
    if (semanasPreview.some((s) => !s.semana || s.semana < 1 || s.semana > 53)) {
      toast({ title: "Semana inválida", description: "Revisa el nº de semana antes de guardar (debe estar entre 1 y 53).", variant: "destructive" });
      return;
    }
    try {
      const result = await ventas.importSemanas.mutateAsync(semanasPreview);
      toast({
        title: "Semanas guardadas",
        description: `${result.creadas} creada(s), ${result.actualizadas} actualizada(s).`,
      });
      setSemanasPreview(null);
      setHojasIgnoradas([]);
      onImported();
    } catch (error) {
      toast({ title: "Error al guardar", description: errorMessage(error), variant: "destructive" });
    }
  };

  return (
    <div className="space-y-4">
      <Card className="glass-accented">
        <CardHeader>
          <CardTitle className="text-base">Importar Excel</CardTitle>
          <p className="text-xs text-muted-foreground">
            Se autodetecta el formato: histórico ("VENTAS SEMANA X PLATAFORMA ANTEQUERA.xlsx", una hoja por
            semana "SEMANA N") o semanal real (una sola hoja tipo "mercadona s27.xlsx", sin planificación).
            En el formato semanal real revisa la semana/año detectados antes de guardar.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <label className="panel-kicker">Año por defecto</label>
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

          {semanasPreview ? (
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-3">
                <MiniStat label="Semanas detectadas" value={formatNumber(semanasPreview.length)} />
                <MiniStat label="Hojas ignoradas" value={formatNumber(hojasIgnoradas.length)} />
                <MiniStat
                  label="Kg vendidos (total)"
                  value={formatKg(semanasPreview.reduce((s, sem) => s + (sem.vendidoKg ?? 0), 0))}
                />
              </div>

              {semanasPreview.length > 0 ? (
                <div className="overflow-x-auto rounded-lg border border-[var(--glass-border)]">
                  <table className="w-full text-[13px]">
                    <thead className="border-b border-[var(--glass-border)] text-[10px] font-semibold uppercase tracking-wider text-muted-foreground [&>th]:px-3 [&>th]:py-1.5">
                      <tr>
                        <th className="text-left">Semana / año</th>
                        <th className="text-left">Formato</th>
                        <th className="text-right">Planificado sem.</th>
                        <th className="text-right">Vendido</th>
                        <th className="text-right">Base IVA</th>
                        <th className="text-right">Métodos</th>
                      </tr>
                    </thead>
                    <tbody>
                      {semanasPreview.map((s, i) => {
                        const facturacion = s.metodos.reduce((sum, m) => sum + (m.baseIva ?? 0), 0) + (s.ajustesBaseIva ?? 0);
                        return (
                          <tr key={i} className={i % 2 === 1 ? "bg-[var(--glass-bg)]/40" : undefined}>
                            <td className="px-3 py-1.5">
                              <div className="flex items-center gap-1.5">
                                <span className="text-muted-foreground">S</span>
                                <Input
                                  type="number"
                                  className="h-7 w-16 px-1.5 text-xs tabular-nums"
                                  value={s.semana || ""}
                                  onChange={(e) => updatePreviewSemana(i, { semana: Number(e.target.value) })}
                                />
                                <span className="text-muted-foreground">·</span>
                                <Input
                                  type="number"
                                  className="h-7 w-20 px-1.5 text-xs tabular-nums"
                                  value={s.anio}
                                  onChange={(e) => updatePreviewSemana(i, { anio: Number(e.target.value) })}
                                />
                              </div>
                            </td>
                            <td className="px-3 py-1.5">
                              <Badge variant="outline" className="text-[10px]">
                                {s.origen === "semanal_real" ? "Semanal real" : "Histórico"}
                              </Badge>
                            </td>
                            <td className="px-3 py-1.5 text-right tabular-nums">
                              {s.planificadoSemanaKg != null ? formatKg(s.planificadoSemanaKg) : (
                                <Badge variant="outline" className="border-warning/40 bg-warning/10 text-[10px] text-warning">previsto pendiente</Badge>
                              )}
                            </td>
                            <td className="px-3 py-1.5 text-right tabular-nums font-medium">{s.vendidoKg != null ? formatKg(s.vendidoKg) : "—"}</td>
                            <td className="px-3 py-1.5 text-right tabular-nums">
                              {s.origen === "semanal_real" ? `${formatNumber(facturacion, 2)} €` : "—"}
                            </td>
                            <td className="px-3 py-1.5 text-right tabular-nums">{s.metodos.length}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : null}

              <Button
                className="gap-2"
                disabled={semanasPreview.length === 0 || ventas.importSemanas.isPending}
                onClick={handleSave}
              >
                <Save className="h-4 w-4" />
                {ventas.importSemanas.isPending ? "Guardando..." : "Guardar en Supabase"}
              </Button>
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-[var(--glass-border)] p-8 text-center text-sm text-muted-foreground">
              <CalendarRange className="mx-auto mb-3 h-8 w-8 opacity-50" />
              Selecciona el Excel (histórico o semanal) para ver el preview antes de guardar.
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

/**
 * Edición manual de la planificación de cualquier semana ya guardada: kg
 * planificado semanal (para semanas futuras, o cuando el formato semanal real
 * no trae planificación) y, cuando llega el email de la quincena, los kg de
 * Antequera II / Antequera Verdura y el rango de fechas de la quincena.
 */
function MercadonaPlanificacionManual({ ventas }: { ventas: ReturnType<typeof useMercadonaVentas> }) {
  if (ventas.semanas.length === 0) return null;

  return (
    <Card className="glass-accented overflow-hidden">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Planificación manual</CardTitle>
        <p className="text-xs text-muted-foreground">
          Teclea aquí los datos del email de la quincena: Antequera II + Antequera Verdura (kg) y el rango de
          fechas. La quincena se calcula como la suma de ambos, y si el semanal aún está vacío se autorrellena
          con la mitad (sin machacar un valor ya guardado a mano).
        </p>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead className="border-b border-[var(--glass-border)] text-[10px] font-semibold uppercase tracking-wider text-muted-foreground [&>th]:px-3 [&>th]:py-1.5">
              <tr>
                <th className="text-left">Semana</th>
                <th className="w-28">Antequera II (kg)</th>
                <th className="w-28">Antequera Verdura (kg)</th>
                <th className="w-40">Rango</th>
                <th className="text-left">Planificado sem.</th>
                <th className="w-28">Nuevo valor (kg)</th>
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
  const [antequeraIi, setAntequeraIi] = useState(String(semana.antequera_ii_kg ?? ""));
  const [antequeraVerdura, setAntequeraVerdura] = useState(String(semana.antequera_verdura_kg ?? ""));
  const [rango, setRango] = useState(semana.rango_planificacion ?? "");
  const [saved, setSaved] = useState(false);

  const handleSave = async () => {
    const kg = value.trim() === "" ? null : Number(value);
    const ii = antequeraIi.trim() === "" ? null : Number(antequeraIi);
    const verdura = antequeraVerdura.trim() === "" ? null : Number(antequeraVerdura);
    if ((kg !== null && !Number.isFinite(kg)) || (ii !== null && !Number.isFinite(ii)) || (verdura !== null && !Number.isFinite(verdura))) {
      toast({ title: "Valor no válido", variant: "destructive" });
      return;
    }

    // planificado_quincena_kg = suma de Antequera II + Verdura (si hay al
    // menos uno de los dos); si el semanal está vacío se autorrellena con
    // quincena/2, sin machacar un valor manual ya existente.
    const tieneAntequera = ii !== null || verdura !== null;
    const quincena = tieneAntequera ? (ii ?? 0) + (verdura ?? 0) : null;
    const semanalYaExiste = semana.planificado_semana_kg !== null && semana.planificado_semana_kg !== undefined;
    const semanalPatch = kg !== null
      ? kg
      : (!semanalYaExiste && quincena !== null ? quincena / 2 : undefined);

    try {
      await ventas.updatePlanificacionManual.mutateAsync({
        id: semana.id,
        ...(semanalPatch !== undefined ? { planificado_semana_kg: semanalPatch } : {}),
        antequera_ii_kg: ii,
        antequera_verdura_kg: verdura,
        rango_planificacion: rango.trim() === "" ? null : rango.trim(),
      });
      if (semanalPatch !== undefined) setValue(String(semanalPatch));
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch (error) {
      toast({ title: "Error al guardar", description: errorMessage(error), variant: "destructive" });
    }
  };

  return (
    <tr className={zebra ? "bg-[var(--glass-bg)]/40" : undefined}>
      <td className="px-3 py-1.5 font-semibold">S{semana.semana} · {semana.anio}</td>
      <td className="px-2 py-1">
        <Input
          type="number"
          className="h-8 text-xs tabular-nums"
          value={antequeraIi}
          onChange={(e) => setAntequeraIi(e.target.value)}
          placeholder="kg"
        />
      </td>
      <td className="px-2 py-1">
        <Input
          type="number"
          className="h-8 text-xs tabular-nums"
          value={antequeraVerdura}
          onChange={(e) => setAntequeraVerdura(e.target.value)}
          placeholder="kg"
        />
      </td>
      <td className="px-2 py-1">
        <Input
          type="text"
          className="h-8 text-xs"
          value={rango}
          onChange={(e) => setRango(e.target.value)}
          placeholder="29 Jun - 12 Jul"
        />
      </td>
      <td className="px-3 py-1.5 text-muted-foreground tabular-nums">
        {semana.planificado_semana_kg != null ? (
          formatKg(semana.planificado_semana_kg)
        ) : (
          <Badge variant="outline" className="border-warning/40 bg-warning/10 text-[10px] text-warning">previsto pendiente</Badge>
        )}
      </td>
      <td className="px-2 py-1">
        <Input type="number" className="h-8 text-xs" value={value} onChange={(e) => setValue(e.target.value)} placeholder="auto" />
      </td>
      <td className="px-2 py-1">
        <Button size="icon" variant="outline" className="h-8 w-8" onClick={handleSave} disabled={ventas.updatePlanificacionManual.isPending}>
          {saved ? <CheckCircle2 className="h-3.5 w-3.5 text-success" /> : <Save className="h-3.5 w-3.5" />}
        </Button>
      </td>
    </tr>
  );
}

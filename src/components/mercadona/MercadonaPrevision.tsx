// src/components/mercadona/MercadonaPrevision.tsx
// Pestaña "Previsión": Mercadona pide cada semana, por adelantado, los kg que
// se van a suministrar. Aquí se apuntan esos kg previstos, se contrastan con la
// capacidad reciente de confección MDNA (para detectar compromisos poco
// realistas) y, cuando ya existe la semana real importada, con lo que
// finalmente se vendió.
import { useMemo, useState } from "react";
import { getISOWeeksInYear } from "date-fns";
import { AlertTriangle, CalendarClock, Gauge, Save, Sparkles, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { KPICard } from "@/components/KPICard";
import { toast } from "@/hooks/use-toast";
import { useMercadona } from "@/hooks/useMercadona";
import { useMercadonaPrevisiones, type MercadonaPrevisionRow } from "@/hooks/useMercadonaPrevisiones";
import type { MercadonaSemanaConMetodos } from "@/hooks/useMercadonaVentas";
import { errorMessage } from "@/lib/errorMessage";
import { formatKg, formatNumber } from "@/lib/format";
import { formatMercadonaWeekRangeLabel, mercadonaWeekDateRange } from "@/lib/mercadonaVentas";
import { cn } from "@/lib/utils";

const UMBRAL_ALERTA_PCT = 10; // % por encima de la capacidad media que dispara el aviso ámbar.
const SEMANAS_CAPACIDAD = 4; // nº de semanas Mercadona completas usadas para la capacidad de referencia.

/**
 * Siguiente semana de Mercadona (anio, semana) tras la última importada, con
 * salto correcto de año en el límite 52/53 (nº de semanas ISO variable por año).
 * Si no hay semanas importadas, sugiere la semana ISO actual.
 */
export function siguienteSemanaMercadona(
  semanas: Array<{ anio: number; semana: number }>,
  hoy: Date = new Date(),
): { anio: number; semana: number } {
  if (semanas.length === 0) {
    // Fallback sin datos previos: semana ISO de "hoy" (import dinámico evitado
    // a proposito, ver mercadonaVentas.ts para el calculo completo con date-fns).
    const anio = hoy.getFullYear();
    return { anio, semana: 1 };
  }
  const ultima = [...semanas].sort((a, b) => (a.anio - b.anio) || (a.semana - b.semana)).at(-1)!;
  const semanasEnAnio = getISOWeeksInYear(new Date(ultima.anio, 6, 1));
  if (ultima.semana >= semanasEnAnio) {
    return { anio: ultima.anio + 1, semana: 1 };
  }
  return { anio: ultima.anio, semana: ultima.semana + 1 };
}

/** true si el previsto supera la capacidad media de referencia en más de UMBRAL_ALERTA_PCT%. */
export function superaCapacidad(kgPrevistos: number, capacidadMedia: number): boolean {
  if (capacidadMedia <= 0) return false;
  return kgPrevistos > capacidadMedia * (1 + UMBRAL_ALERTA_PCT / 100);
}

export interface DeltaPrevistoReal {
  deltaKg: number;
  deltaPct: number;
}

/** Delta previsto -> real, en kg y en % (positivo = se vendió más de lo previsto). */
export function deltaPrevistoReal(kgPrevistos: number, vendidoKg: number): DeltaPrevistoReal {
  const deltaKg = vendidoKg - kgPrevistos;
  const deltaPct = kgPrevistos > 0 ? (deltaKg / kgPrevistos) * 100 : 0;
  return { deltaKg, deltaPct };
}

interface MercadonaPrevisionProps {
  semanas: MercadonaSemanaConMetodos[];
}

export function MercadonaPrevision({ semanas }: MercadonaPrevisionProps) {
  const previsionesHook = useMercadonaPrevisiones();
  const { previsiones, tablesMissing, guardarPrevision, borrarPrevision } = previsionesHook;

  const sugerida = useMemo(() => siguienteSemanaMercadona(semanas), [semanas]);

  const [anio, setAnio] = useState(sugerida.anio);
  const [semana, setSemana] = useState(sugerida.semana);
  const [kgPrevistos, setKgPrevistos] = useState("");
  const [kgQuincena, setKgQuincena] = useState("");
  const [notas, setNotas] = useState("");

  // Capacidad de referencia: kg MDNA confeccionados en las últimas SEMANAS_CAPACIDAD
  // semanas Mercadona completas (con datos importados), sobre el rango L-S de cada una.
  const semanasParaCapacidad = useMemo(
    () => [...semanas].sort((a, b) => (a.anio - b.anio) || (a.semana - b.semana)).slice(-SEMANAS_CAPACIDAD),
    [semanas],
  );
  const primeraCapacidad = semanasParaCapacidad[0] ?? null;
  const ultimaCapacidad = semanasParaCapacidad.at(-1) ?? null;
  const rangoCapacidad = primeraCapacidad && ultimaCapacidad
    ? {
      desde: mercadonaWeekDateRange(primeraCapacidad.anio, primeraCapacidad.semana).desde,
      hasta: mercadonaWeekDateRange(ultimaCapacidad.anio, ultimaCapacidad.semana).hasta,
    }
    : null;
  const capacidad = useMercadona(rangoCapacidad?.desde ?? "1970-01-01", rangoCapacidad?.hasta ?? "1970-01-01");
  const capacidadMediaSemanal = semanasParaCapacidad.length > 0
    ? capacidad.kg_mercadona / semanasParaCapacidad.length
    : 0;

  const semanasRealesPorClave = useMemo(() => {
    const map = new Map<string, MercadonaSemanaConMetodos>();
    for (const s of semanas) map.set(`${s.anio}-${s.semana}`, s);
    return map;
  }, [semanas]);

  const resetFormulario = () => {
    const next = siguienteSemanaMercadona(semanas);
    setAnio(next.anio);
    setSemana(next.semana);
    setKgPrevistos("");
    setKgQuincena("");
    setNotas("");
  };

  const handleGuardar = async () => {
    const kg = Number(kgPrevistos);
    if (!Number.isFinite(kg) || kg <= 0) {
      toast({ title: "Kg previstos no válidos", description: "Introduce un número de kg mayor que 0.", variant: "destructive" });
      return;
    }
    if (!Number.isInteger(semana) || semana < 1 || semana > 53) {
      toast({ title: "Semana inválida", description: "Debe estar entre 1 y 53.", variant: "destructive" });
      return;
    }
    const quincena = kgQuincena.trim() === "" ? null : Number(kgQuincena);
    if (quincena !== null && !Number.isFinite(quincena)) {
      toast({ title: "Kg de quincena no válidos", variant: "destructive" });
      return;
    }
    try {
      await guardarPrevision.mutateAsync({
        anio,
        semana,
        kg_previstos: kg,
        kg_previstos_quincena: quincena,
        notas: notas.trim() === "" ? null : notas.trim(),
      });
      toast({ title: "Previsión guardada", description: `Semana ${semana} · ${anio}: ${formatKg(kg)} previstos.` });
      resetFormulario();
    } catch (error) {
      toast({ title: "Error al guardar", description: errorMessage(error), variant: "destructive" });
    }
  };

  const handleBorrar = async (row: MercadonaPrevisionRow) => {
    if (!window.confirm(`¿Borrar la previsión de la semana ${row.semana} · ${row.anio}?`)) return;
    try {
      await borrarPrevision.mutateAsync(row.id);
      toast({ title: "Previsión borrada" });
    } catch (error) {
      toast({ title: "Error al borrar", description: errorMessage(error), variant: "destructive" });
    }
  };

  if (tablesMissing) {
    return (
      <Card className="glass-accented">
        <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
          <AlertTriangle className="h-10 w-10 text-warning" />
          <div>
            <h2 className="text-lg font-semibold">Sección pendiente de activar</h2>
            <p className="mt-2 max-w-md text-sm text-muted-foreground">
              La tabla de previsiones todavía no existe en la base de datos. En cuanto se aplique la
              migración correspondiente, esta sección funcionará con normalidad.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* ─── Formulario ──────────────────────────────────────────────────── */}
      <Card className="glass-accented overflow-hidden">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <CalendarClock className="h-4 w-4 text-primary" /> Apuntar previsión
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Kg que Mercadona ha pedido por adelantado para una semana (L-S). Se guarda una por semana; si ya
            existe, se actualiza.
          </p>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
            <div className="space-y-1.5">
              <Label htmlFor="prevision-anio" className="text-xs">Año</Label>
              <Input
                id="prevision-anio"
                type="number"
                className="h-9 text-sm"
                value={anio}
                onChange={(e) => setAnio(Number(e.target.value))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="prevision-semana" className="text-xs">Semana</Label>
              <Input
                id="prevision-semana"
                type="number"
                min={1}
                max={53}
                className="h-9 text-sm"
                value={semana}
                onChange={(e) => setSemana(Number(e.target.value))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="prevision-kg" className="text-xs">Kg previstos</Label>
              <Input
                id="prevision-kg"
                type="number"
                className="h-9 text-sm"
                placeholder="p. ej. 42000"
                value={kgPrevistos}
                onChange={(e) => setKgPrevistos(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="prevision-quincena" className="text-xs">Kg quincena (opcional)</Label>
              <Input
                id="prevision-quincena"
                type="number"
                className="h-9 text-sm"
                placeholder="p. ej. 84000"
                value={kgQuincena}
                onChange={(e) => setKgQuincena(e.target.value)}
              />
            </div>
            <div className="col-span-2 space-y-1.5 sm:col-span-3 xl:col-span-2">
              <Label htmlFor="prevision-notas" className="text-xs">Notas (opcional)</Label>
              <Textarea
                id="prevision-notas"
                className="min-h-9 h-9 py-2 text-sm"
                placeholder="Detalles del pedido, condiciones especiales…"
                value={notas}
                onChange={(e) => setNotas(e.target.value)}
              />
            </div>
          </div>
          <div className="mt-3 flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              {formatMercadonaWeekRangeLabel(anio, Math.min(Math.max(semana, 1), 53))}
            </p>
            <Button size="sm" className="gap-2" onClick={handleGuardar} disabled={guardarPrevision.isPending}>
              <Save className="h-4 w-4" /> Guardar previsión
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ─── Capacidad de referencia ─────────────────────────────────────── */}
      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <KPICard
          className="glass-accented"
          label="Capacidad estimada de confección MDNA"
          value={capacidadMediaSemanal > 0 ? formatKg(capacidadMediaSemanal) : "Sin datos suficientes"}
          hint={primeraCapacidad && ultimaCapacidad
            ? `Media semanal · S${primeraCapacidad.semana}-S${ultimaCapacidad.semana} · ${ultimaCapacidad.anio}`
            : "Importa semanas con producción registrada para calcularla"}
          icon={Gauge}
          labelInfo={`Media de kg MDNA confeccionados por semana en las últimas ${SEMANAS_CAPACIDAD} semanas Mercadona (L-S) con datos importados.`}
        />
        <KPICard
          className="glass-accented"
          label="Previsiones apuntadas"
          value={String(previsiones.length)}
          hint={previsiones.length > 0 ? "Semanas con kg previstos guardados" : "Todavía ninguna"}
          icon={Sparkles}
        />
      </section>

      {/* ─── Tabla de previsiones ────────────────────────────────────────── */}
      <Card className="glass-accented overflow-hidden">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Previsiones</CardTitle>
          <p className="text-xs text-muted-foreground">Previsto vs capacidad reciente y, cuando ya se importó, vs lo realmente vendido.</p>
        </CardHeader>
        <CardContent className="p-0">
          {previsiones.length === 0 ? (
            <div className="flex flex-col items-center gap-2 p-10 text-center">
              <CalendarClock className="h-10 w-10 text-muted-foreground/50" />
              <div>
                <h3 className="text-sm font-semibold">Todavía no hay previsiones</h3>
                <p className="mt-1 max-w-md text-xs text-muted-foreground">
                  Apunta aquí los kg que te pide Mercadona cada semana; cuando importes el Excel real, verás
                  previsto vs real.
                </p>
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead className="border-b border-[var(--glass-border)] text-[10px] font-semibold uppercase tracking-wider text-muted-foreground [&>th]:px-3 [&>th]:py-1.5">
                  <tr>
                    <th className="text-left">Semana</th>
                    <th className="text-left">Rango (L-S)</th>
                    <th className="text-right">Kg previstos</th>
                    <th className="text-right">Kg quincena</th>
                    <th className="text-left">Vs capacidad</th>
                    <th className="text-right">Vendido real</th>
                    <th className="text-right">Delta previsto→real</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {[...previsiones].reverse().map((p, i) => {
                    const real = semanasRealesPorClave.get(`${p.anio}-${p.semana}`);
                    const vendido = real?.vendido_kg ?? null;
                    const delta = vendido != null ? deltaPrevistoReal(p.kg_previstos, vendido) : null;
                    const alerta = superaCapacidad(p.kg_previstos, capacidadMediaSemanal);
                    return (
                      <tr key={p.id} className={i % 2 === 1 ? "bg-[var(--glass-bg)]/40" : undefined}>
                        <td className="px-3 py-1.5 font-semibold">S{p.semana} · {p.anio}</td>
                        <td className="px-3 py-1.5 text-muted-foreground">{formatMercadonaWeekRangeLabel(p.anio, p.semana)}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums font-medium">{formatKg(p.kg_previstos)}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">
                          {p.kg_previstos_quincena != null ? formatKg(p.kg_previstos_quincena) : "—"}
                        </td>
                        <td className="px-3 py-1.5">
                          {capacidadMediaSemanal > 0 ? (
                            alerta ? (
                              <Badge variant="outline" className="gap-1 border-warning/40 bg-warning/10 text-[10px] text-warning">
                                <AlertTriangle className="h-3 w-3" /> Supera capacidad reciente
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="border-success/40 bg-success/10 text-[10px] text-success">
                                Dentro de capacidad
                              </Badge>
                            )
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums">
                          {vendido != null ? formatKg(vendido) : <span className="text-muted-foreground">Pendiente</span>}
                        </td>
                        <td className={cn(
                          "px-3 py-1.5 text-right tabular-nums",
                          delta == null
                            ? "text-muted-foreground"
                            : delta.deltaKg >= 0 ? "text-success" : "text-destructive",
                        )}>
                          {delta == null ? "—" : (
                            <>
                              {delta.deltaKg >= 0 ? "+" : ""}{formatKg(delta.deltaKg)} · {delta.deltaPct >= 0 ? "+" : ""}{formatNumber(delta.deltaPct, 1)}%
                            </>
                          )}
                        </td>
                        <td className="px-2 py-1 text-right">
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8 text-muted-foreground hover:text-destructive"
                            onClick={() => handleBorrar(p)}
                            disabled={borrarPrevision.isPending}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// LecturasAguaBatch — apuntar varios días de contadores de una sola vez.
//
// Las fotos de los contadores se hacen todas las mañanas, pero no siempre se
// teclean el mismo día: cuando se acumulan (vacaciones, fotos atrasadas, o el
// arranque de campaña con el histórico en la mano) meterlas de una en una es
// inviable. Aquí se pegan tantas líneas como días y el módulo ENCADENA las
// lecturas contra lo ya guardado antes de dejar confirmar.
//
// No guarda nada hasta que el plan esté limpio: si una sola línea falla, no se
// guarda ninguna. Es a propósito — el consumo de cada día se calcula contra la
// lectura del día anterior, así que una línea mala descuadraría también la
// siguiente.
import { Fragment, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, ListPlus, Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "@/hooks/use-toast";
import { errorMessage } from "@/lib/errorMessage";
import { formatDate, formatNumber, today } from "@/lib/format";
import {
  buildLecturasAguaBatch,
  WATER_METER_LABEL,
  WATER_METER_ORDER,
  WATER_METER_UNIT,
  type ConsumoFisicoInput,
  type DailyWaterMeterConsumo,
} from "@/lib/consumosFisicos";

const EJEMPLO = [
  "# fecha  general(m3)  tratamiento(m3)  tratamiento+jabón(L)  drencher(L)",
  "2026-08-13  39259,5  3611,804  564682  -",
  "2026-08-14  39265,5  3613,442  565279  -",
].join("\n");

export function LecturasAguaBatch({
  consumos,
  onGuardar,
  guardando,
}: {
  /** Todos los consumos ya conocidos, para resolver la lectura anterior de cada contador. */
  consumos: ConsumoFisicoInput[];
  onGuardar: (filas: DailyWaterMeterConsumo[]) => Promise<void>;
  guardando: boolean;
}) {
  const [abierto, setAbierto] = useState(false);
  const [texto, setTexto] = useState("");

  const plan = useMemo(
    () => (texto.trim() ? buildLecturasAguaBatch({ texto, consumos, hoy: today() }) : null),
    [texto, consumos],
  );

  const guardar = async () => {
    if (!plan || plan.hayErrores || plan.totalLecturas === 0) return;
    const filas = plan.dias.flatMap((dia) => dia.entradas.map((entrada) => entrada.consumo));
    try {
      await onGuardar(filas);
    } catch (error) {
      toast({
        title: "No se han guardado todas las lecturas",
        description: `${errorMessage(error)} Vuelve a pegar las que falten: las ya guardadas se saltan solas.`,
        variant: "destructive",
      });
      return;
    }
    toast({
      title: "Lecturas guardadas",
      description: `${filas.length} lecturas de ${plan.dias.length} días. Revísalas en «Lecturas guardadas · corregir» si hay que retocar alguna.`,
    });
    setTexto("");
  };

  if (!abierto) {
    return (
      <Button type="button" variant="outline" onClick={() => setAbierto(true)} className="w-full">
        <ListPlus className="h-4 w-4" /> Apuntar varios días de golpe
      </Button>
    );
  }

  return (
    <Card className="glass-accented">
      <CardHeader>
        <p className="panel-kicker">Registro de agua</p>
        <CardTitle className="text-base">Varios días de golpe</CardTitle>
        <p className="text-xs text-muted-foreground">
          Una línea por día: la fecha de la foto y, detrás, la lectura de cada contador en el orden{" "}
          {WATER_METER_ORDER.map((ref) => `${WATER_METER_LABEL[ref]} (${WATER_METER_UNIT[ref]})`).join(" · ")}.
          Sirven tabuladores, punto y coma o espacios; pon «-» en el contador que no se leyera y omite
          las columnas de la derecha que no uses.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Lecturas</Label>
          <Textarea
            value={texto}
            onChange={(event) => setTexto(event.target.value)}
            placeholder={EJEMPLO}
            rows={8}
            spellCheck={false}
            className="font-mono text-xs"
          />
        </div>

        {plan && plan.filasInvalidas.length > 0 && (
          <div className="space-y-1.5 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
            <p className="flex items-center gap-2 font-semibold">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              {plan.filasInvalidas.length === 1 ? "Una línea no se entiende" : `${plan.filasInvalidas.length} líneas no se entienden`}
            </p>
            {plan.filasInvalidas.map((fila) => (
              <p key={fila.linea} className="pl-6">
                <span className="font-mono">línea {fila.linea}</span>: {fila.error}
              </p>
            ))}
          </div>
        )}

        {plan && plan.dias.length > 0 && (
          <div className="overflow-x-auto rounded-xl border border-[var(--glass-border)]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Foto</TableHead>
                  <TableHead>Contador</TableHead>
                  <TableHead className="text-right">Lectura</TableHead>
                  <TableHead className="text-right">Consumo</TableHead>
                  <TableHead>Se atribuye a</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {plan.dias.map((dia) => (
                  <Fragment key={dia.fecha}>
                    {dia.entradas.map((entrada, indice) => (
                      <TableRow key={`${dia.fecha}-${entrada.referencia}`}>
                        <TableCell className="whitespace-nowrap">{indice === 0 ? formatDate(dia.fecha) : ""}</TableCell>
                        <TableCell className="whitespace-nowrap">{WATER_METER_LABEL[entrada.referencia]}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatNumber(entrada.lectura, WATER_METER_UNIT[entrada.referencia] === "m3" ? 3 : 0)}{" "}
                          {WATER_METER_UNIT[entrada.referencia]}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {entrada.lecturaAnterior == null
                            ? <span className="text-xs text-muted-foreground">referencia inicial</span>
                            : `${formatNumber(entrada.consumoL, 0)} L`}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                          {formatDate(entrada.consumo.fecha_inicio)}
                          {entrada.consumo.fecha_fin !== entrada.consumo.fecha_inicio ? ` – ${formatDate(entrada.consumo.fecha_fin)}` : ""}
                        </TableCell>
                      </TableRow>
                    ))}
                    {[...dia.errores.map((texto) => ({ texto, grave: true })), ...dia.avisos.map((texto) => ({ texto, grave: false }))].map((nota) => (
                      <TableRow key={`${dia.fecha}-${nota.texto}`}>
                        <TableCell className="whitespace-nowrap">{dia.entradas.length === 0 ? formatDate(dia.fecha) : ""}</TableCell>
                        <TableCell colSpan={4} className={nota.grave ? "text-xs text-destructive" : "text-xs text-warning"}>
                          <span className="inline-flex items-start gap-1.5">
                            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                            {nota.texto}
                          </span>
                        </TableCell>
                      </TableRow>
                    ))}
                  </Fragment>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            {plan == null
              ? "Pega las lecturas para ver qué va a entrar."
              : plan.hayErrores
                ? "Corrige lo marcado en rojo: mientras haya un error no se guarda nada, porque el consumo de cada día se calcula contra el anterior."
                : plan.totalLecturas === 0
                  ? "Ninguna lectura nueva: todas estaban ya guardadas."
                  : `${plan.totalLecturas} lecturas en ${plan.dias.length} ${plan.dias.length === 1 ? "día" : "días"} · ${formatNumber(plan.totalConsumoL, 0)} L de consumo general.`}
          </p>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={() => { setTexto(""); setAbierto(false); }} disabled={guardando}>
              Cerrar
            </Button>
            <Button
              type="button"
              onClick={() => void guardar()}
              disabled={guardando || plan == null || plan.hayErrores || plan.totalLecturas === 0}
              className="glass glass-hover"
            >
              {guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : plan && !plan.hayErrores && plan.totalLecturas > 0 ? <CheckCircle2 className="h-4 w-4" /> : <Save className="h-4 w-4" />}
              {guardando ? "Guardando…" : `Guardar ${plan?.totalLecturas ?? 0} lecturas`}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

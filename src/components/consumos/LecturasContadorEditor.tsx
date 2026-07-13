// LecturasContadorEditor — historial editable de las lecturas de los contadores
// de agua (general, línea tratamiento, tratamiento+jabón y drencher).
//
// Editar una lectura aquí NO es editar la cantidad a mano: se corrige la LECTURA
// del contador (lo que decía la foto) y el módulo recalcula el consumo de esa
// fila contra su lectura anterior Y el consumo de la lectura siguiente del mismo
// contador (cuyo delta se calculó contra la lectura que se está corrigiendo).
import { Fragment, useMemo, useState } from "react";
import { Check, Pencil, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "@/hooks/use-toast";
import { formatDate, formatNumber } from "@/lib/format";
import {
  buildDailyWaterMeterConsumoFromReading,
  buildDrencherWaterMeterConsumoFromReading,
  buildJabonWaterMeterConsumoFromReading,
  buildTratamientoWaterMeterConsumoFromReading,
  extractFotoFecha,
  findNextWaterMeterReading,
  findPreviousWaterMeterReading,
  isWaterMeterReference,
  normalizeConsumoCantidad,
  parseConsumoNumber,
  parseWaterMeterReading,
  WATER_METER_LABEL,
  type ConsumoFisicoInput,
  type DailyWaterMeterConsumo,
  type WaterMeterReference,
} from "@/lib/consumosFisicos";
import type { ConsumoFisicoRow } from "@/lib/types";

const METROS_CUBICOS: Record<WaterMeterReference, boolean> = {
  "agua-contador-general": true,
  "agua-contador-tratamiento": true,
  "agua-contador-tratamiento-jabon": false,
  "agua-contador-drencher": false,
};

interface LecturaFila {
  row: ConsumoFisicoRow;
  referencia: WaterMeterReference;
  foto: string;
  lectura: number | null;
  consumoL: number;
}

function rebuildConsumo(
  referencia: WaterMeterReference,
  foto: string,
  lectura: number,
  lecturaAnterior: number | null,
  fechaLecturaAnterior: string | null,
): DailyWaterMeterConsumo {
  switch (referencia) {
    case "agua-contador-general":
      return buildDailyWaterMeterConsumoFromReading({
        fecha: foto,
        lecturaContadorM3: lectura,
        lecturaAnteriorM3: lecturaAnterior,
        fechaLecturaAnterior,
        lineaTratamientoL: 0,
        drencherL: 0,
      });
    case "agua-contador-tratamiento":
      return buildTratamientoWaterMeterConsumoFromReading({
        fecha: foto,
        lecturaContadorM3: lectura,
        lecturaAnteriorM3: lecturaAnterior,
        fechaLecturaAnterior,
      });
    case "agua-contador-tratamiento-jabon":
      return buildJabonWaterMeterConsumoFromReading({
        fecha: foto,
        lecturaContadorL: lectura,
        lecturaAnteriorL: lecturaAnterior,
        fechaLecturaAnterior,
      });
    case "agua-contador-drencher":
      return buildDrencherWaterMeterConsumoFromReading({
        fecha: foto,
        lecturaContadorL: lectura,
        lecturaAnteriorL: lecturaAnterior,
        fechaLecturaAnterior,
      });
  }
}

export function LecturasContadorEditor({
  registros,
  consumos,
  onUpdate,
  updating,
}: {
  /** Filas persistidas (editables) de consumos_fisicos. */
  registros: ConsumoFisicoRow[];
  /** Todos los consumos (incluidas facturas merged) para resolver lecturas anterior/siguiente. */
  consumos: ConsumoFisicoInput[];
  onUpdate: (values: ConsumoFisicoRow) => Promise<void>;
  updating: boolean;
}) {
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [valor, setValor] = useState("");

  const filas = useMemo<LecturaFila[]>(
    () => registros
      .filter((row) => row.recurso === "agua" && row.fuente === "contador" && isWaterMeterReference(row.referencia))
      .map((row) => {
        const referencia = row.referencia as WaterMeterReference;
        const { lecturaM3, lecturaL } = parseWaterMeterReading(row);
        return {
          row,
          referencia,
          foto: extractFotoFecha(row),
          lectura: METROS_CUBICOS[referencia] ? lecturaM3 : lecturaL,
          consumoL: normalizeConsumoCantidad(row).cantidadBase,
        };
      })
      .sort((a, b) => b.foto.localeCompare(a.foto) || a.referencia.localeCompare(b.referencia)),
    [registros],
  );

  if (filas.length === 0) {
    return null;
  }

  const empezarEdicion = (fila: LecturaFila) => {
    setEditandoId(fila.row.id);
    setValor(fila.lectura != null ? String(fila.lectura) : "");
  };

  const cancelar = () => {
    setEditandoId(null);
    setValor("");
  };

  const guardar = async (fila: LecturaFila) => {
    const nueva = parseConsumoNumber(valor);
    const unidad = METROS_CUBICOS[fila.referencia] ? "m3" : "L";
    if (nueva <= 0) {
      toast({ title: "Lectura no válida", description: "Introduce la lectura corregida del contador.", variant: "destructive" });
      return;
    }

    // Lecturas vecinas del MISMO contador, excluyendo la fila que se edita.
    const sinEsta = consumos.filter((c) => c.id !== fila.row.id);
    const anterior = findPreviousWaterMeterReading(sinEsta, fila.foto, fila.referencia);
    const siguiente = findNextWaterMeterReading(sinEsta, fila.foto, fila.referencia);
    const lecturaAnterior = anterior ? (METROS_CUBICOS[fila.referencia] ? anterior.lecturaM3 : anterior.lecturaL) : null;
    const lecturaSiguiente = siguiente ? (METROS_CUBICOS[fila.referencia] ? siguiente.lecturaM3 : siguiente.lecturaL) : null;

    if (lecturaAnterior != null && nueva < lecturaAnterior) {
      toast({
        title: "Lectura no válida",
        description: `Debe ser igual o superior a la lectura anterior (${formatNumber(lecturaAnterior, 2)} ${unidad}, ${formatDate(anterior!.fecha)}).`,
        variant: "destructive",
      });
      return;
    }
    if (lecturaSiguiente != null && nueva > lecturaSiguiente) {
      toast({
        title: "Lectura no válida",
        description: `Debe ser igual o inferior a la lectura siguiente (${formatNumber(lecturaSiguiente, 2)} ${unidad}, ${formatDate(siguiente!.fecha)}).`,
        variant: "destructive",
      });
      return;
    }

    const reconstruida = rebuildConsumo(fila.referencia, fila.foto, nueva, lecturaAnterior, anterior?.fecha ?? null);
    await onUpdate({ ...fila.row, ...reconstruida });

    // La lectura siguiente calculó su consumo contra la lectura recién corregida:
    // se reconstruye también con el nuevo punto de partida.
    if (siguiente?.id && lecturaSiguiente != null) {
      const rowSiguiente = registros.find((r) => r.id === siguiente.id);
      if (rowSiguiente) {
        const reconstruidaSiguiente = rebuildConsumo(fila.referencia, siguiente.fecha, lecturaSiguiente, nueva, fila.foto);
        await onUpdate({ ...rowSiguiente, ...reconstruidaSiguiente });
      }
    }

    toast({
      title: "Lectura corregida",
      description: siguiente
        ? "Se recalculó el consumo de esta lectura y el de la lectura siguiente del mismo contador."
        : "Se recalculó el consumo de esta lectura.",
    });
    cancelar();
  };

  return (
    <Card className="glass-accented">
      <CardHeader>
        <p className="panel-kicker">Registro de agua</p>
        <CardTitle className="text-base">Lecturas guardadas · corregir</CardTitle>
        <p className="text-xs text-muted-foreground">
          Corrige aquí una lectura mal apuntada: se recalcula su consumo y el de la lectura
          siguiente del mismo contador. El consumo siempre se atribuye a los días anteriores a la foto.
        </p>
      </CardHeader>
      <CardContent className="overflow-x-auto p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Contador</TableHead>
              <TableHead>Foto</TableHead>
              <TableHead className="text-right">Lectura</TableHead>
              <TableHead className="text-right">Consumo</TableHead>
              <TableHead>Días atribuidos</TableHead>
              <TableHead className="text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filas.map((fila) => {
              const unidad = METROS_CUBICOS[fila.referencia] ? "m3" : "L";
              const enEdicion = editandoId === fila.row.id;
              return (
                <Fragment key={fila.row.id}>
                  <TableRow>
                    <TableCell className="whitespace-nowrap font-medium">{WATER_METER_LABEL[fila.referencia]}</TableCell>
                    <TableCell className="whitespace-nowrap">{formatDate(fila.foto)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {enEdicion ? (
                        <Input
                          inputMode="decimal"
                          value={valor}
                          onChange={(e) => setValor(e.target.value)}
                          className="ml-auto h-8 w-32 text-right"
                          autoFocus
                        />
                      ) : fila.lectura != null ? (
                        `${formatNumber(fila.lectura, fila.lectura % 1 === 0 ? 0 : 2)} ${unidad}`
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatNumber(fila.consumoL, 0)} L</TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {formatDate(fila.row.fecha_inicio)}
                      {fila.row.fecha_fin !== fila.row.fecha_inicio ? ` – ${formatDate(fila.row.fecha_fin)}` : ""}
                    </TableCell>
                    <TableCell className="text-right">
                      {enEdicion ? (
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-success" onClick={() => void guardar(fila)} disabled={updating} title="Guardar corrección">
                            <Check className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={cancelar} disabled={updating} title="Cancelar">
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      ) : (
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => empezarEdicion(fila)} disabled={updating || fila.lectura == null} title="Corregir lectura">
                          <Pencil className="h-4 w-4" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

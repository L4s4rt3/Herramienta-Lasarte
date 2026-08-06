// src/components/importar/CardAsistenciaHoras.tsx
// Tarjeta "Fichaje de personal (horas)" de la Bandeja (zona B, con
// confirmación): detectado por src/lib/importBandejaAsistencia.ts cuando
// clasificarArchivoBandeja devolvió "desconocido" (ese archivo no es del
// dominio de fruta/lote/báscula, es el fichaje semanal de horas de RRHH).
//
// Reutiliza tal cual la MISMA mutación que usa src/pages/Asistencia.tsx para
// su importación semanal (useUpsertAsistenciaRegistros + buildAttendanceRecords
// de src/lib/asistenciaImport.ts, NINGUNO de los dos se toca ni se duplica):
// esta tarjeta solo vuelca PRESENCIA (asistencia_detalle no guarda horas, no
// existe ninguna tabla de horas en el esquema — ver el resumen que enseña
// "N h totales" a modo informativo, calculado por el propio clasificador).
//
// Los nombres del Excel que no casan con ningún trabajador (ni por nombre ni
// por alias) NO se pierden en silencio, pero esta tarjeta no repite el panel
// completo de "vincular nombre" de Asistencia.tsx (fuera del alcance de los
// ficheros que toca esta tarea): se cuentan y se enlaza a la vista semanal de
// Asistencia para resolverlos allí, donde ya vive ese flujo completo.
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Clock3, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthProvider";
import { errorMessage } from "@/lib/errorMessage";
import { formatNumber } from "@/lib/format";
import type { AsistenciaHorasClasificado } from "@/lib/importBandejaAsistencia";
import { buildAttendanceRecords, type WeeklyAttendanceDay } from "@/lib/asistenciaImport";
import { resolveTrabajadoresPorLista } from "@/lib/asistenciaTrabajadores";
import { useAsistenciaTrabajadores } from "@/hooks/useAsistencia";
import { useUpsertAsistenciaRegistros } from "@/hooks/useAsistencia";
import { useTrabajadoresAlias } from "@/hooks/useTrabajadoresAlias";

interface Props {
  archivos: AsistenciaHorasClasificado[];
}

/** Fusiona los días de varios archivos (mismo día en dos ficheros = unión de nombres presentes ese día). */
function combinarDias(archivos: AsistenciaHorasClasificado[]): WeeklyAttendanceDay[] {
  const porFecha = new Map<string, Set<string>>();
  for (const archivo of archivos) {
    for (const dia of archivo.payload.dias) {
      const set = porFecha.get(dia.date) ?? new Set<string>();
      for (const nombre of dia.names) set.add(nombre);
      porFecha.set(dia.date, set);
    }
  }
  return [...porFecha.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, names]) => ({ date, names: [...names] }));
}

export function CardAsistenciaHoras({ archivos }: Props) {
  const { user } = useAuth();
  const { trabajadores } = useAsistenciaTrabajadores();
  const { aliasPorNombre } = useTrabajadoresAlias();
  const upsertRegistros = useUpsertAsistenciaRegistros();
  const [importando, setImportando] = useState(false);
  const [resumenTexto, setResumenTexto] = useState<string | null>(null);
  const [noResueltosCount, setNoResueltosCount] = useState(0);

  const dias = useMemo(() => combinarDias(archivos), [archivos]);
  const trabajadoresUnicos = useMemo(() => {
    const set = new Set<string>();
    for (const dia of dias) for (const nombre of dia.names) set.add(nombre.trim().toUpperCase());
    return set.size;
  }, [dias]);
  const horasTotales = useMemo(
    () => Math.round(archivos.reduce((sum, a) => sum + a.payload.horasTotales, 0) * 10) / 10,
    [archivos],
  );

  if (archivos.length === 0) return null;

  const fechaInicio = dias[0]?.date;
  const fechaFin = dias[dias.length - 1]?.date;

  const handleImportar = async () => {
    if (!user) return;
    setImportando(true);
    try {
      const activos = trabajadores.filter((t) => t.activo);
      const records = dias
        .flatMap((dia) => buildAttendanceRecords(dia.names, activos, user.id, dia.date, aliasPorNombre))
        .map((record) => ({ ...record, motivo_ausencia: null }));

      if (records.length === 0) {
        toast({ title: "No hay registros para importar", variant: "destructive" });
        return;
      }

      await upsertRegistros.mutateAsync(records);

      const nombresUnicos = [...new Set(dias.flatMap((dia) => dia.names))];
      const resolucion = resolveTrabajadoresPorLista(activos, nombresUnicos, aliasPorNombre);
      setNoResueltosCount(resolucion.noResueltos.length);

      const presentes = records.filter((r) => r.presente).length;
      setResumenTexto(
        `${formatNumber(dias.length)} día(s), ${formatNumber(presentes)} presencia(s) guardada(s) sobre ${formatNumber(records.length)} registros.`,
      );
      toast({
        title: "Fichaje importado",
        description: resolucion.noResueltos.length > 0
          ? `${resolucion.noResueltos.length} nombre(s) del Excel sin vincular — resuélvelos en Asistencia (vista semanal).`
          : "Todos los nombres del Excel se resolvieron correctamente.",
        variant: resolucion.noResueltos.length > 0 ? "destructive" : undefined,
      });
    } catch (e) {
      toast({ title: "No se pudo importar el fichaje", description: errorMessage(e), variant: "destructive" });
    } finally {
      setImportando(false);
    }
  };

  return (
    <Card className="glass-accented overflow-hidden">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base"><Clock3 className="h-4 w-4" /> Fichaje de personal (horas)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          {archivos.length === 1
            ? `Detectado en "${archivos[0].fileName}".`
            : `Detectado en ${formatNumber(archivos.length)} archivo(s).`}
          {" "}Solo se puede volcar la presencia (asistencia_detalle no guarda horas): las horas se muestran a modo informativo.
        </p>
        <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
          <div className="rounded-lg border border-[var(--glass-border)] bg-[var(--glass-bg)] p-2">
            <p className="text-muted-foreground">Trabajadores</p>
            <p className="text-base font-semibold tabular-nums">{formatNumber(trabajadoresUnicos)}</p>
          </div>
          <div className="rounded-lg border border-[var(--glass-border)] bg-[var(--glass-bg)] p-2">
            <p className="text-muted-foreground">Rango de fechas</p>
            <p className="text-sm font-semibold">{fechaInicio && fechaFin ? (fechaInicio === fechaFin ? fechaInicio : `${fechaInicio} — ${fechaFin}`) : "—"}</p>
          </div>
          <div className="rounded-lg border border-[var(--glass-border)] bg-[var(--glass-bg)] p-2">
            <p className="text-muted-foreground">Días detectados</p>
            <p className="text-base font-semibold tabular-nums">{formatNumber(dias.length)}</p>
          </div>
          <div className="rounded-lg border border-[var(--glass-border)] bg-[var(--glass-bg)] p-2">
            <p className="text-muted-foreground">Horas totales</p>
            <p className="text-base font-semibold tabular-nums">{horasTotales > 0 ? horasTotales.toLocaleString("es-ES") : "—"}</p>
          </div>
        </div>
        {resumenTexto ? <p className="text-xs text-success">{resumenTexto}</p> : null}
        {noResueltosCount > 0 ? (
          <p className="text-xs text-warning">
            {formatNumber(noResueltosCount)} nombre(s) sin vincular — resuélvelos en{" "}
            <Link to="/costes/asistencia" className="inline-flex items-center gap-1 underline">
              Asistencia <ExternalLink className="h-3 w-3" />
            </Link>.
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" disabled={dias.length === 0 || importando || !user} onClick={handleImportar}>
            {importando ? "Importando..." : "Importar presencia"}
          </Button>
          <Link to="/costes/asistencia" className="text-xs text-muted-foreground underline hover:text-foreground">
            O impórtalo desde RRHH → Asistencia (vista semanal)
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

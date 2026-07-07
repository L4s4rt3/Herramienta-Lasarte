import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { InfoTooltip } from "@/components/InfoTooltip";
import { formatKg } from "@/lib/format";
import { Users, TriangleAlert } from "lucide-react";
import type { RendimientoSinZona } from "@/lib/asistenciaPlantilla";

export interface ZonaRendimientoItem {
  grupo: string;
  label: string;
  kg: number;
  porcentajeKg: number;
  personas: number;
  objetivo: number | null;
  kgPersona: number;
}

interface PartDetailZonasProps {
  loading: boolean;
  zonas: ZonaRendimientoItem[] | null;
  kgPersonaGeneral: number;
  presentesComputables: number;
  sinZona?: RendimientoSinZona | null;
}

export default function PartDetailZonas({ loading, zonas, kgPersonaGeneral, presentesComputables, sinZona }: PartDetailZonasProps) {
  const hayDatos = zonas ? zonas.some((z) => z.personas > 0) : false;
  const maxKg = zonas ? Math.max(...zonas.map((z) => z.kg), 1) : 1;

  return (
    <Card className="glass-accented">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-3">
          <div className="h-7 w-1 shrink-0 rounded-full bg-primary" />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <p className="panel-kicker">Personal</p>
              <InfoTooltip iconClassName="h-3 w-3">
                Kg clasificados de cada zona repartidos entre las personas presentes ese día. Incluye la plantilla de arranque de línea (15 personas: encargadas, tría de podrido, aéreo, carretilleros, transpaletas, producción y mantenimiento), que suma a la dotación de cada zona — igual que en Asistencia. Necesita la asistencia de ese día ya marcada.
              </InfoTooltip>
            </div>
            <CardTitle className="text-base">Rendimiento por zonas</CardTitle>
          </div>
          <Users className="ml-auto h-4 w-4 shrink-0 text-muted-foreground" />
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="grid grid-cols-2 gap-3">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28" />)}
          </div>
        ) : !hayDatos ? (
          <div className="flex flex-col items-center gap-1 py-6 text-center text-sm text-muted-foreground">
            <Users className="mb-2 h-8 w-8 text-muted-foreground/30" />
            <p className="font-medium text-foreground">Sin asistencia registrada este día</p>
            <p className="max-w-xs text-xs">Marca la asistencia de este día en Asistencia para ver el reparto por zonas.</p>
          </div>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              {zonas!.map((z) => (
                <div key={z.grupo} className="rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg)] p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{z.label}</p>
                      <p className="text-xs text-muted-foreground">
                        {z.objetivo ? `${z.personas}/${z.objetivo} presentes` : "kg del informe"}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-sm font-semibold tabular-nums text-primary">{formatKg(z.kg)}</p>
                      <p className="text-[11px] font-semibold tabular-nums text-muted-foreground">
                        {z.porcentajeKg.toFixed(1)}%
                      </p>
                    </div>
                  </div>
                  {z.objetivo ? (
                    <div className="mt-2.5">
                      <p className="text-xl font-semibold leading-none tabular-nums">{formatKg(z.kgPersona)}</p>
                      <p className="mt-1 text-[11px] text-muted-foreground">por persona</p>
                    </div>
                  ) : (
                    <p className="mt-2.5 rounded-lg border border-[var(--glass-border)] bg-background/45 px-2 py-1.5 text-xs text-muted-foreground">
                      Sin dotación propia de zona
                    </p>
                  )}
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--glass-bg-strong)]">
                    <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(5, (z.kg / maxKg) * 100)}%` }} />
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground">{z.porcentajeKg.toFixed(1)}% de los kg clasificados</p>
                </div>
              ))}
            </div>
            {sinZona && sinZona.presentes > 0 && (
              <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
                <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <p>
                  <span className="font-semibold">{sinZona.presentes} presente{sinZona.presentes === 1 ? "" : "s"} sin zona reconocida</span>
                  {" "}(no se ha podido asignar a ningún grupo de la plantilla): {sinZona.personas.join(", ")}. Revisa la zona asignada a estas personas.
                </p>
              </div>
            )}
            {presentesComputables > 0 && (
              <p className="mt-3 text-xs text-muted-foreground">
                General del día: <span className="font-semibold tabular-nums text-foreground">{formatKg(kgPersonaGeneral)}/persona</span> · {presentesComputables} presentes computables
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

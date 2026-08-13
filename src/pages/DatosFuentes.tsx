// src/pages/DatosFuentes.tsx
// "Datos → Estado de las fuentes": ¿está entrando todo lo que tiene que entrar?
//
// POR QUÉ EXISTE (13-08-2026). El registro de cámaras externas estuvo 78 días
// sin actualizarse y nadie se enteró. Una fuente que deja de llegar no da error
// en ninguna pantalla: los números se quedan quietos y quien los mira los da
// por buenos. Esta página es el sitio donde eso se ve.
//
// No inventa alarmas: cada fuente declara su propio ritmo (los palets del ERP
// llegan a diario; la asistencia, por semanas completas los lunes) y solo se
// avisa cuando tarda más de lo suyo.
import { AlertTriangle, CheckCircle2, Clock, HelpCircle, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  useDesviacionesFuentes,
  useEstadoFuentes,
  type EstadoFuente,
} from "@/hooks/useEstadoFuentes";

const PRESENTACION: Record<EstadoFuente, { texto: string; icono: typeof CheckCircle2; clase: string }> = {
  "al-dia": { texto: "Al día", icono: CheckCircle2, clase: "text-emerald-600 dark:text-emerald-400" },
  "con-retraso": { texto: "Con retraso", icono: Clock, clase: "text-amber-600 dark:text-amber-400" },
  "parada": { texto: "Parada", icono: AlertTriangle, clase: "text-red-600 dark:text-red-400" },
  "sin-datos": { texto: "Sin datos", icono: HelpCircle, clase: "text-muted-foreground" },
};

function hace(dias: number | null): string {
  if (dias === null) return "—";
  if (dias === 0) return "hoy";
  if (dias === 1) return "hace 1 día";
  return `hace ${dias} días`;
}

export default function DatosFuentes() {
  const { data: fuentes, isLoading, refetch, isFetching } = useEstadoFuentes();
  const { data: desviaciones } = useDesviacionesFuentes();

  const conProblema = (fuentes ?? []).filter((f) => f.estado === "parada" || f.estado === "con-retraso");

  return (
    <div className="page-shell">
      <header className="page-header">
        <div>
          <p className="panel-kicker">Datos</p>
          <h1 className="page-title">Estado de las fuentes</h1>
          <p className="page-subtitle">
            De dónde sale cada dato de la Herramienta y cuándo llegó lo último. Una fuente que deja
            de llegar no da error en ninguna pantalla: los números simplemente se quedan quietos.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={cn("mr-2 h-4 w-4", isFetching && "animate-spin")} />
          Comprobar ahora
        </Button>
      </header>

      {conProblema.length > 0 && (
        <Card className="glass-accented border-amber-500/40">
          <CardContent className="flex items-start gap-3 p-4">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
            <div className="min-w-0 text-sm">
              <p className="font-medium">
                {conProblema.length === 1
                  ? "Una fuente lleva más tiempo del suyo sin llegar."
                  : `${conProblema.length} fuentes llevan más tiempo del suyo sin llegar.`}
              </p>
              <p className="mt-0.5 text-muted-foreground">
                {conProblema.map((f) => `${f.nombre} (${hace(f.diasDesde)})`).join(" · ")}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="glass-accented">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Cuándo llegó lo último de cada fuente</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--glass-border)] text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-2 font-medium">Fuente</th>
                  <th className="px-4 py-2 font-medium">De dónde sale</th>
                  <th className="px-4 py-2 font-medium text-right">Lo último</th>
                  <th className="px-4 py-2 font-medium text-right">Estado</th>
                </tr>
              </thead>
              <tbody>
                {isLoading && (
                  <tr><td colSpan={4} className="px-4 py-6 text-center text-muted-foreground">Comprobando…</td></tr>
                )}
                {(fuentes ?? []).map((f) => {
                  const p = PRESENTACION[f.estado];
                  const Icono = p.icono;
                  return (
                    <tr key={f.id} className="border-b border-[var(--glass-border)]/60 last:border-0">
                      <td className="px-4 py-2 font-medium">{f.nombre}</td>
                      <td className="px-4 py-2 text-muted-foreground">{f.origen}</td>
                      <td className="px-4 py-2 text-right tabular-nums">
                        {f.ultimo ?? "nunca"}
                        <span className="ml-2 text-xs text-muted-foreground">{hace(f.diasDesde)}</span>
                      </td>
                      <td className="px-4 py-2 text-right">
                        <span className={cn("inline-flex items-center gap-1.5 text-xs font-medium", p.clase)}>
                          <Icono className="h-3.5 w-3.5" />
                          {p.texto}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card className="glass-accented">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Contradicciones entre la app y sus fuentes</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {(desviaciones ?? []).map((d) => (
            <div key={d.id} className="flex items-start gap-3">
              <Badge variant={d.problema ? "destructive" : "secondary"} className="mt-0.5 shrink-0 tabular-nums">
                {d.valor}
              </Badge>
              <div className="min-w-0 text-sm">
                <p className="font-medium">{d.titulo}</p>
                <p className="text-muted-foreground">{d.detalle}</p>
              </div>
            </div>
          ))}
          {(desviaciones ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground">Comprobando…</p>
          )}
          <p className="pt-1 text-xs text-muted-foreground">
            La comprobación completa (pasada a pasada del calibrador, palets contra el ERP y totales
            del parte) vive en <code className="rounded bg-muted px-1 py-0.5">scripts/auditar-fuentes.mjs</code>,
            que sale con error si algo se desvía y puede colgarse de una tarea programada.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { CheckCircle2, ChevronDown, ChevronUp, CircleAlert, Wrench } from "lucide-react";

/**
 * La revisión automática del parte, tal y como la dejó la tarea de la mañana
 * antes de mandar el correo (scripts/lib-revision-parte.mjs, columna `revision`).
 *
 * POR QUÉ SE ENSEÑA AQUÍ. El correo lo lee una persona a las siete y luego
 * desaparece. Quien abre el parte tres días después necesita lo mismo: si el
 * día está en orden, qué no cuadraba y qué se cree que pasó — antes de fiarse
 * de los kilos que hay debajo. Por eso va encima de los KPI.
 *
 * NO ES UNA FIRMA. "Revisado" quiere decir que la máquina lo repasó; "Validado"
 * (el estado) sigue siendo el único candado humano.
 */
export interface ParteComprobacion {
  clave: string;
  titulo: string;
  estado: "ok" | "reparo" | "n/a";
  detalle?: string;
  /** Cómo se llama la comprobación cuando falla ("el papel sin teclear"). */
  fallo?: string;
}

export interface ParteRevision {
  revisado_at?: string;
  veredicto?: "en-orden" | "con-reparos" | "sin-parte" | "sin-actividad";
  comprobaciones?: ParteComprobacion[];
  /** Lo que la propia tarea arregló antes de mandar el correo. */
  reparaciones?: string[];
  /** La valoración: qué se cree que ha pasado con lo que no se pudo cuadrar. */
  diagnostico?: string[];
  dsj?: { kg: number; pct: number } | null;
}

/** "11 sep, 07:41" — cuándo se repasó, que es lo que dice si la marca sirve. */
function cuando(iso?: string) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString("es-ES", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export default function PartDetailRevision({ revision }: { revision?: ParteRevision | null }) {
  const [abierto, setAbierto] = useState(false);
  if (!revision?.veredicto) return null;

  const comprobaciones = revision.comprobaciones ?? [];
  const cuentan = comprobaciones.filter((c) => c.estado !== "n/a");
  const fallan = comprobaciones.filter((c) => c.estado === "reparo");
  const enOrden = revision.veredicto === "en-orden";
  const fecha = cuando(revision.revisado_at);

  const tono = enOrden
    ? "border-emerald-600/35 bg-emerald-600/10"
    : "border-amber-500/40 bg-amber-500/10";

  return (
    <div className={`rounded-xl border px-4 py-3 text-sm ${tono}`}>
      <div className="flex flex-wrap items-start gap-2">
        {enOrden
          ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700 dark:text-emerald-400" />
          : <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-400" />}
        <div className="min-w-0 flex-1">
          <p className="font-medium">
            {enOrden
              ? `Revisado automáticamente: el parte está en orden (${cuentan.length} comprobaciones).`
              : `Revisado automáticamente: ${fallan.length} de ${cuentan.length} comprobaciones no pasan.`}
          </p>
          {!enOrden && fallan.length > 0 && (
            <ul className="mt-1 space-y-0.5 text-muted-foreground">
              {fallan.map((c) => (
                <li key={c.clave}>
                  <span className="font-medium text-foreground">{c.titulo}:</span> {c.detalle}
                </li>
              ))}
            </ul>
          )}
          {/* Lo que la tarea arregló sola. Sin esto, un parte que cambió de
              números de un día para otro no tiene explicación en ningún sitio. */}
          {(revision.reparaciones?.length ?? 0) > 0 && (
            <div className="mt-2">
              <p className="flex items-center gap-1.5 text-xs font-medium">
                <Wrench className="h-3.5 w-3.5" /> Se arregló solo
              </p>
              <ul className="mt-0.5 space-y-0.5 text-muted-foreground">
                {revision.reparaciones!.map((r, i) => <li key={i}>{r}</li>)}
              </ul>
            </div>
          )}
          {/* La valoración. Es lo que convierte "no cuadra" en algo accionable. */}
          {(revision.diagnostico?.length ?? 0) > 0 && (
            <div className="mt-2">
              <p className="text-xs font-medium">Qué se cree que ha pasado</p>
              <ul className="mt-0.5 space-y-1 text-muted-foreground">
                {revision.diagnostico!.map((d, i) => <li key={i}>{d}</li>)}
              </ul>
            </div>
          )}
          {abierto && (
            <ul className="mt-2 space-y-0.5 border-t pt-2 text-xs text-muted-foreground">
              {comprobaciones.map((c) => (
                <li key={c.clave}>
                  <span className={c.estado === "reparo" ? "font-medium text-foreground" : ""}>
                    {c.estado === "ok" ? "✓" : c.estado === "reparo" ? "✗" : "–"} {c.titulo}
                  </span>
                  {c.detalle ? `: ${c.detalle}` : ""}
                </li>
              ))}
            </ul>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <Button type="button" size="sm" variant="outline" onClick={() => setAbierto((v) => !v)}>
              {abierto ? <ChevronUp className="mr-1 h-3.5 w-3.5" /> : <ChevronDown className="mr-1 h-3.5 w-3.5" />}
              {abierto ? "Ocultar las comprobaciones" : "Ver las comprobaciones"}
            </Button>
            {fecha && <span className="text-xs text-muted-foreground">Repasado el {fecha}</span>}
          </div>
        </div>
      </div>
    </div>
  );
}

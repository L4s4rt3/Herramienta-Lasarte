// Tarjeta del estándar de kg/persona por régimen de plantilla: enseña el
// listón vigente (quién lo decidió, cuándo, la nota) y, SOLO para admin, lo
// deja editar. Se monta tal cual dentro de otra página (Económico →
// Rentabilidad → Por tipo de día). No habla con la base: eso es del hook
// useEstandarRendimiento.
//
// POR QUÉ. El dueño revisa el listón cada 4-6 semanas ("si se clava el
// objetivo un mes, subir suelo y objetivo"). Hasta el 04-09-2026 eso era tocar
// código en dos sitios y desplegar; ahora es este diálogo. Lo guardado lo leen
// al momento la vista por tipo de día y el vigía de negocio; el correo diario
// y los informes de la encargada lo cogen cuando corre
// scripts/sincronizar-estandar.mjs (regenera su espejo JSON).
import { useState, type ChangeEvent } from "react";
import { AlertTriangle, Loader2, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthProvider";
import { useEstandarRendimiento } from "@/hooks/useEstandarRendimiento";
import { errorMessage } from "@/lib/errorMessage";
import { formatDateTime, formatNumber } from "@/lib/format";
import {
  LABEL_REGIMEN,
  LIMITES_ESTANDAR,
  validarEstandarRendimiento,
  type EstandarRendimiento,
  type RegimenPlantilla,
} from "@/lib/estandarRendimiento";

const diaTxt = (v: string) => v.split("-").reverse().join("/");

export interface EstandarRendimientoEditorProps {
  className?: string;
}

export function EstandarRendimientoEditor({ className }: EstandarRendimientoEditorProps) {
  const { role } = useAuth();
  const esAdmin = role === "admin";
  const { estandar, fila, isLoading, esRespaldo, motivoRespaldo, guardar } = useEstandarRendimiento();
  const [editando, setEditando] = useState(false);

  return (
    <Card className={className}>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="space-y-1">
            <CardTitle className="text-base">Estándar de kg por persona</CardTitle>
            <p className="text-xs text-muted-foreground">
              Decidido por {estandar.decididoPor} el {diaTxt(estandar.fecha)}
              {fila?.updated_at ? ` · guardado ${formatDateTime(fila.updated_at)}` : ""}. Es el mismo listón para la vista por tipo de día, el vigía de negocio (día rojo), el correo diario y los informes de la encargada.
            </p>
          </div>
          {esAdmin && !isLoading && (
            <Button variant="outline" size="sm" onClick={() => setEditando(true)}>
              <Pencil className="mr-1.5 h-3.5 w-3.5" /> Editar estándar
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="grid gap-3 pt-0 sm:grid-cols-2">
        {(["completa", "reducida"] as RegimenPlantilla[]).map((r) => (
          <Regimen key={r} regimen={r} estandar={estandar} />
        ))}
        {estandar.nota && <p className="text-xs text-muted-foreground sm:col-span-2">{estandar.nota}</p>}
        {esRespaldo && (
          <p className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100 sm:col-span-2">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              No se pudo leer el estándar de la base{motivoRespaldo ? ` (${motivoRespaldo})` : ""}: se enseñan los valores por defecto del 27-08-2026. Si el dueño lo ha cambiado desde entonces, esto NO lo refleja.
            </span>
          </p>
        )}
      </CardContent>
      {esAdmin && (
        <Dialog open={editando} onOpenChange={(abierto) => !abierto && setEditando(false)}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Editar el estándar de kg por persona</DialogTitle>
              <DialogDescription>
                Se aplica al momento a la vista por tipo de día y al vigía. Queda registrado quién lo cambió, y el listón anterior pasa al historial con su tramo de vigencia.
              </DialogDescription>
            </DialogHeader>
            {/* Se monta con el diálogo: cada apertura parte del estándar vigente. */}
            <FormularioEstandar
              vigente={estandar}
              guardando={guardar.isPending}
              onGuardar={(nuevo) => guardar.mutateAsync(nuevo)}
              onCerrar={() => setEditando(false)}
            />
          </DialogContent>
        </Dialog>
      )}
    </Card>
  );
}

function Regimen({ regimen, estandar }: { regimen: RegimenPlantilla; estandar: EstandarRendimiento }) {
  const l = estandar.regimenes[regimen];
  const corte = estandar.cortePlantillaReducida;
  return (
    <div className="rounded-xl border bg-card p-3">
      <p className="text-xs text-muted-foreground">
        {LABEL_REGIMEN[regimen]} · {regimen === "reducida" ? `hasta ${corte} presentes` : `más de ${corte} presentes`}
      </p>
      <p className="text-lg font-semibold tabular-nums">
        {formatNumber(l.kgPersonaSuelo)} <span className="text-sm font-normal text-muted-foreground">suelo</span>
        {" · "}
        {formatNumber(l.kgPersonaObjetivo)} <span className="text-sm font-normal text-muted-foreground">objetivo</span>
      </p>
      <p className="text-xs text-muted-foreground">kg por persona y día: por debajo del suelo el día es malo; desde el objetivo, bueno.</p>
    </div>
  );
}

// ─── El formulario ────────────────────────────────────────────────────────────

interface Campos {
  corte: string;
  completaSuelo: string;
  completaObjetivo: string;
  reducidaSuelo: string;
  reducidaObjetivo: string;
  decididoPor: string;
  fecha: string;
  nota: string;
}

function camposDesde(est: EstandarRendimiento): Campos {
  return {
    corte: String(est.cortePlantillaReducida),
    completaSuelo: String(est.regimenes.completa.kgPersonaSuelo),
    completaObjetivo: String(est.regimenes.completa.kgPersonaObjetivo),
    reducidaSuelo: String(est.regimenes.reducida.kgPersonaSuelo),
    reducidaObjetivo: String(est.regimenes.reducida.kgPersonaObjetivo),
    decididoPor: est.decididoPor,
    fecha: est.fecha,
    nota: est.nota ?? "",
  };
}

/** Vacío → NaN (y no 0), para que la validación diga "falta" en vez de "tiene que ser mayor que 0". */
const num = (s: string) => (s.trim() === "" ? Number.NaN : Number(s.replace(",", ".")));

function FormularioEstandar({ vigente, guardando, onGuardar, onCerrar }: {
  vigente: EstandarRendimiento;
  guardando: boolean;
  onGuardar: (nuevo: EstandarRendimiento) => Promise<unknown>;
  onCerrar: () => void;
}) {
  const [c, setC] = useState<Campos>(() => camposDesde(vigente));
  const poner = (clave: keyof Campos) => (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setC((prev) => ({ ...prev, [clave]: e.target.value }));

  const enviar = async () => {
    const nuevo: EstandarRendimiento = {
      cortePlantillaReducida: num(c.corte),
      regimenes: {
        completa: { kgPersonaSuelo: num(c.completaSuelo), kgPersonaObjetivo: num(c.completaObjetivo) },
        reducida: { kgPersonaSuelo: num(c.reducidaSuelo), kgPersonaObjetivo: num(c.reducidaObjetivo) },
      },
      decididoPor: c.decididoPor.trim(),
      fecha: c.fecha,
      nota: c.nota.trim() || null,
    };
    const problemas = validarEstandarRendimiento(nuevo);
    if (problemas.length > 0) {
      toast({ title: "Revisa el estándar", description: problemas.join(" "), variant: "destructive" });
      return;
    }
    try {
      await onGuardar(nuevo);
      toast({
        title: "Estándar guardado",
        description: "La vista por tipo de día y el vigía ya lo usan. El correo diario y los informes de la encargada lo cogen al correr sincronizar-estandar.mjs.",
      });
      onCerrar();
    } catch (error) {
      toast({ title: "No se pudo guardar el estándar", description: errorMessage(error), variant: "destructive" });
    }
  };

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="est-corte">Corte de plantilla reducida (presentes)</Label>
        <Input id="est-corte" type="number" inputMode="numeric" min={LIMITES_ESTANDAR.corteMin} max={LIMITES_ESTANDAR.corteMax} step={1} value={c.corte} onChange={poner("corte")} />
        <p className="text-xs text-muted-foreground">Hasta este número de presentes el día es de plantilla reducida; con más, completa aunque haya faltas.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <fieldset className="space-y-2 rounded-xl border p-3">
          <legend className="px-1 text-xs font-medium">{LABEL_REGIMEN.completa}</legend>
          <div className="space-y-1.5">
            <Label htmlFor="est-completa-suelo">Suelo (kg/persona)</Label>
            <Input id="est-completa-suelo" type="number" inputMode="numeric" min={1} step={1} value={c.completaSuelo} onChange={poner("completaSuelo")} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="est-completa-objetivo">Objetivo (kg/persona)</Label>
            <Input id="est-completa-objetivo" type="number" inputMode="numeric" min={1} step={1} value={c.completaObjetivo} onChange={poner("completaObjetivo")} />
          </div>
        </fieldset>
        <fieldset className="space-y-2 rounded-xl border p-3">
          <legend className="px-1 text-xs font-medium">{LABEL_REGIMEN.reducida}</legend>
          <div className="space-y-1.5">
            <Label htmlFor="est-reducida-suelo">Suelo (kg/persona)</Label>
            <Input id="est-reducida-suelo" type="number" inputMode="numeric" min={1} step={1} value={c.reducidaSuelo} onChange={poner("reducidaSuelo")} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="est-reducida-objetivo">Objetivo (kg/persona)</Label>
            <Input id="est-reducida-objetivo" type="number" inputMode="numeric" min={1} step={1} value={c.reducidaObjetivo} onChange={poner("reducidaObjetivo")} />
          </div>
        </fieldset>
      </div>
      <p className="text-xs text-muted-foreground">En cada régimen el suelo tiene que quedar por debajo del objetivo; entre los dos, el día es medio.</p>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="est-decidido-por">Quién lo decide</Label>
          <Input id="est-decidido-por" value={c.decididoPor} onChange={poner("decididoPor")} placeholder="el dueño" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="est-fecha">Fecha de la decisión</Label>
          <Input id="est-fecha" type="date" value={c.fecha} onChange={poner("fecha")} />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="est-nota">Nota (por qué este listón)</Label>
        <Textarea id="est-nota" rows={3} value={c.nota} onChange={poner("nota")} placeholder="p. ej. Se clavó el objetivo todo septiembre: suben suelo y objetivo 100 kg." />
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onCerrar} disabled={guardando}>Cancelar</Button>
        <Button onClick={() => void enviar()} disabled={guardando}>
          {guardando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Guardar estándar
        </Button>
      </DialogFooter>
    </div>
  );
}

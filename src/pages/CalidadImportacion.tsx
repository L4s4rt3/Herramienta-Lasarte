// Lista de controles de calidad de fruta de IMPORTACIÓN.
//
// Pensada para el móvil de la evaluadora: botón grande de "Nuevo control",
// tarjetas de un vistazo (referencia, categoría, proveedor, fotos, estado) y
// las acciones de cada control (abrir, duplicar para la otra categoría,
// descargar el Word, borrar) sin salir de la lista.
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Camera,
  ClipboardCheck,
  Copy,
  FileText,
  Loader2,
  MoreVertical,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "@/hooks/use-toast";
import {
  generarYDescargarInforme,
  prefillDuplicado,
  useCalidadImportControles,
  useCalidadImportMutations,
  type ControlConFotos,
} from "@/hooks/useCalidadImport";
import { supabase } from "@/integrations/supabase/client";
import type { CalidadImportFoto } from "@/lib/calidadImport";
import { fechaInformeTexto } from "@/lib/calidadImportDocx";
import { cn } from "@/lib/utils";

function tituloControl(control: ControlConFotos): string {
  const referencia = [control.referencia, control.nuestra_ref].filter((p) => p.trim() !== "").join("-");
  return referencia || "Control sin referencia";
}

export default function CalidadImportacion() {
  const navigate = useNavigate();
  const { data: controles, isLoading } = useCalidadImportControles();
  const { crearControl, borrarControl } = useCalidadImportMutations();
  const [filtro, setFiltro] = useState("");
  const [aBorrar, setABorrar] = useState<ControlConFotos | null>(null);
  const [generandoId, setGenerandoId] = useState<string | null>(null);

  const filtrados = useMemo(() => {
    const texto = filtro.trim().toLowerCase();
    if (!texto) return controles ?? [];
    return (controles ?? []).filter((control) =>
      [control.referencia, control.nuestra_ref, control.proveedor, control.marca, control.tipo_producto, control.clasificacion, control.origen]
        .join(" ")
        .toLowerCase()
        .includes(texto),
    );
  }, [controles, filtro]);

  const nuevoControl = async () => {
    const id = await crearControl.mutateAsync(undefined);
    navigate(`/calidad/importacion/${id}`);
  };

  const duplicar = async (control: ControlConFotos) => {
    const id = await crearControl.mutateAsync(prefillDuplicado(control));
    toast({ title: "Control duplicado", description: "Producto e información general copiados; medidas y fotos, en blanco." });
    navigate(`/calidad/importacion/${id}`);
  };

  const descargarWord = async (control: ControlConFotos) => {
    setGenerandoId(control.id);
    try {
      const { data, error } = await supabase
        .from("calidad_import_fotos")
        .select("*")
        .eq("control_id", control.id)
        .order("orden");
      if (error) throw error;
      const filename = await generarYDescargarInforme(control, (data ?? []) as unknown as CalidadImportFoto[]);
      toast({ title: "Informe generado", description: filename });
    } catch (error) {
      toast({
        title: "No se pudo generar el informe",
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive",
      });
    } finally {
      setGenerandoId(null);
    }
  };

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 p-3 sm:p-6">
      {/* Botón principal, a tamaño de pulgar */}
      <Button
        onClick={nuevoControl}
        disabled={crearControl.isPending}
        className="h-14 w-full rounded-2xl text-base font-semibold shadow-md"
      >
        {crearControl.isPending ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <Plus className="mr-2 h-5 w-5" />}
        Nuevo control de calidad
      </Button>

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={filtro}
          onChange={(evento) => setFiltro(evento.target.value)}
          placeholder="Buscar por referencia, proveedor, marca..."
          className="h-11 rounded-xl pl-9 text-base"
        />
      </div>

      {isLoading && (
        <div className="space-y-3">
          {[1, 2, 3].map((n) => (
            <Skeleton key={n} className="h-24 w-full rounded-2xl" />
          ))}
        </div>
      )}

      {!isLoading && filtrados.length === 0 && (
        <Card className="rounded-2xl border-dashed">
          <CardContent className="flex flex-col items-center gap-2 py-10 text-center text-muted-foreground">
            <ClipboardCheck className="h-8 w-8" />
            <p className="text-sm">
              {filtro ? "Ningún control coincide con la búsqueda." : "Todavía no hay controles. Crea el primero con el botón de arriba."}
            </p>
          </CardContent>
        </Card>
      )}

      <div className="space-y-3">
        {filtrados.map((control) => (
          <Card
            key={control.id}
            className="cursor-pointer rounded-2xl transition-colors hover:border-primary/40"
            onClick={() => navigate(`/calidad/importacion/${control.id}`)}
          >
            <CardContent className="flex items-start gap-3 p-4">
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-base font-semibold">{tituloControl(control)}</span>
                  {control.clasificacion.trim() !== "" && (
                    <Badge variant="outline" className="border-primary/40 bg-primary/10 text-primary">
                      {control.clasificacion}
                    </Badge>
                  )}
                  <Badge
                    variant="outline"
                    className={cn(
                      control.estado === "completado"
                        ? "border-success/40 bg-success/10 text-success"
                        : "border-warning/40 bg-warning/10 text-warning",
                    )}
                  >
                    {control.estado === "completado" ? "Completado" : "Borrador"}
                  </Badge>
                </div>
                <p className="truncate text-sm text-muted-foreground">
                  {[control.proveedor, control.tipo_producto, control.origen].filter((p) => p.trim() !== "").join(" · ") || "Sin datos de producto"}
                </p>
                <p className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span>{fechaInformeTexto(control.fecha)}</span>
                  <span className="flex items-center gap-1">
                    <Camera className="h-3.5 w-3.5" />
                    {control.num_fotos}
                  </span>
                  {control.evaluador.trim() !== "" && <span className="truncate">{control.evaluador}</span>}
                </p>
              </div>

              <div onClick={(evento) => evento.stopPropagation()}>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-10 w-10 shrink-0 rounded-xl">
                      {generandoId === control.id ? <Loader2 className="h-5 w-5 animate-spin" /> : <MoreVertical className="h-5 w-5" />}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => void descargarWord(control)} disabled={generandoId !== null}>
                      <FileText className="mr-2 h-4 w-4" />
                      Descargar informe Word
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => void duplicar(control)} disabled={crearControl.isPending}>
                      <Copy className="mr-2 h-4 w-4" />
                      Duplicar para otra categoría
                    </DropdownMenuItem>
                    <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => setABorrar(control)}>
                      <Trash2 className="mr-2 h-4 w-4" />
                      Borrar
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <p className="pt-1 text-center text-xs text-muted-foreground">
        Los controles del día a día de la planta siguen en <Link to="/calidad" className="underline">Calidad</Link>.
      </p>

      <AlertDialog open={aBorrar !== null} onOpenChange={(abierto) => !abierto && setABorrar(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Borrar este control?</AlertDialogTitle>
            <AlertDialogDescription>
              {aBorrar ? `${tituloControl(aBorrar)} ${aBorrar.clasificacion}`.trim() : ""} se borrará con sus {aBorrar?.num_fotos ?? 0} fotos.
              Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (aBorrar) void borrarControl.mutateAsync(aBorrar);
                setABorrar(null);
              }}
            >
              Borrar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

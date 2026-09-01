// Editor de UN control de calidad de importación, pensado para rellenarse
// desde el iPhone en la nave: secciones plegables (las del informe), inputs
// a tamaño de dedo, chips de un toque para los defectos habituales, cámara
// directa o galería para las fotos, firma dibujada en un modal (sin que se
// mueva la pantalla) y autoguardado continuo con botón de Guardar explícito.
//
// Funciona también SIN conexión: los cambios se guardan en el móvil y se
// suben solos al volver la red (ver lib/calidadImportOffline).
//
// "Validar y cerrar" deja el control en solo lectura (reabrible); el botón
// de Word genera el REPORTE DE CALIDAD FRUTA IMPORTACIÓN y en el móvil abre
// la hoja de compartir para mandarlo por correo/WhatsApp.
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Camera,
  Check,
  CheckCircle2,
  FileText,
  Images,
  Loader2,
  LockKeyhole,
  Plus,
  Save,
  Trash2,
  WifiOff,
  X,
} from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import { FirmaPad } from "@/components/calidad/FirmaPad";
import {
  generarYDescargarInforme,
  useCalidadImportControl,
  useCalidadImportMutations,
  useCalidadImportSync,
} from "@/hooks/useCalidadImport";
import {
  CLASIFICACIONES_SUGERIDAS,
  DEFECTOS_EVOLUTIVOS_SUGERIDOS,
  DEFECTOS_NO_EVOLUTIVOS_SUGERIDOS,
  estadoSecciones,
  indiceMadurez,
  pctZumo,
  REF_ACIDEZ,
  REF_BRIX,
  REF_INDICE_MADUREZ,
  REF_PCT_ZUMO,
  type CalidadImportControl,
  type DefectoImport,
  type MuestraInterna,
} from "@/lib/calidadImport";
import { cn } from "@/lib/utils";

type EstadoGuardado = "guardado" | "guardando" | "pendiente" | "offline" | "error";

// ─── Piezas de formulario a tamaño de dedo ───────────────────────────────────

function CampoTexto({
  etiqueta,
  valor,
  onCambio,
  placeholder,
  modo,
}: {
  etiqueta: string;
  valor: string;
  onCambio: (valor: string) => void;
  placeholder?: string;
  modo?: "decimal";
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs font-medium text-muted-foreground">{etiqueta}</Label>
      <Input
        value={valor}
        onChange={(evento) => onCambio(evento.target.value)}
        placeholder={placeholder}
        inputMode={modo}
        className="h-11 rounded-xl text-base"
      />
    </div>
  );
}

/** Botones rápidos (OK/NO OK, SI/NO, CAT 1/CAT 2...) con texto libre opcional. */
function OpcionesRapidas({
  etiqueta,
  valor,
  opciones,
  onCambio,
  conTextoLibre = false,
}: {
  etiqueta: string;
  valor: string;
  opciones: readonly string[];
  onCambio: (valor: string) => void;
  conTextoLibre?: boolean;
}) {
  const esOpcion = opciones.includes(valor);
  return (
    <div className="space-y-1">
      <Label className="text-xs font-medium text-muted-foreground">{etiqueta}</Label>
      <div className="flex flex-wrap gap-2">
        {opciones.map((opcion) => (
          <Button
            key={opcion}
            type="button"
            variant={valor === opcion ? "default" : "outline"}
            className="h-11 min-w-[72px] rounded-xl px-4 text-base"
            onClick={() => onCambio(valor === opcion ? "" : opcion)}
          >
            {opcion}
          </Button>
        ))}
        {conTextoLibre && (
          <Input
            value={esOpcion ? "" : valor}
            onChange={(evento) => onCambio(evento.target.value)}
            placeholder="Otro..."
            className="h-11 w-28 flex-1 rounded-xl text-base"
          />
        )}
      </div>
    </div>
  );
}

/** Lista editable de defectos (tipo + %) con chips de los habituales. */
function ListaDefectos({
  etiqueta,
  defectos,
  sugerencias,
  onCambio,
}: {
  etiqueta: string;
  defectos: DefectoImport[];
  sugerencias: readonly string[];
  onCambio: (defectos: DefectoImport[]) => void;
}) {
  const actualizar = (indice: number, parcial: Partial<DefectoImport>) => {
    onCambio(defectos.map((d, i) => (i === indice ? { ...d, ...parcial } : d)));
  };
  const yaElegidos = new Set(defectos.map((d) => d.tipo.trim().toUpperCase()));
  return (
    <div className="space-y-2">
      <Label className="text-xs font-medium text-muted-foreground">{etiqueta}</Label>
      {defectos.map((defecto, indice) => (
        <div key={indice} className="flex items-center gap-2">
          <Input
            value={defecto.tipo}
            onChange={(evento) => actualizar(indice, { tipo: evento.target.value.toUpperCase() })}
            placeholder="Tipo de defecto"
            className="h-11 flex-1 rounded-xl text-base uppercase"
          />
          <Input
            value={defecto.pct}
            onChange={(evento) => actualizar(indice, { pct: evento.target.value })}
            placeholder="%"
            inputMode="decimal"
            className="h-11 w-20 rounded-xl text-center text-base"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-11 w-11 shrink-0 rounded-xl text-muted-foreground"
            onClick={() => onCambio(defectos.filter((_, i) => i !== indice))}
            aria-label="Quitar defecto"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      ))}
      <div className="flex flex-wrap gap-1.5">
        {sugerencias
          .filter((sugerencia) => !yaElegidos.has(sugerencia))
          .map((sugerencia) => (
            <button
              key={sugerencia}
              type="button"
              onClick={() => onCambio([...defectos, { tipo: sugerencia, pct: "" }])}
              className="rounded-full border border-primary/25 bg-primary/5 px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/15 disabled:opacity-40"
            >
              + {sugerencia}
            </button>
          ))}
        <button
          type="button"
          onClick={() => onCambio([...defectos, { tipo: "", pct: "" }])}
          className="rounded-full border border-dashed px-3 py-1.5 text-xs font-medium text-muted-foreground hover:border-primary/40 hover:text-primary disabled:opacity-40"
        >
          + Otro
        </button>
      </div>
    </div>
  );
}

/** Muestras de calidad interna: se teclea lo MEDIDO y el % de zumo y el
 * índice de madurez salen solos, con su referencia al lado. */
function MuestrasInternas({
  muestras,
  onCambio,
}: {
  muestras: MuestraInterna[];
  onCambio: (muestras: MuestraInterna[]) => void;
}) {
  const actualizar = (indice: number, parcial: Partial<MuestraInterna>) => {
    onCambio(muestras.map((m, i) => (i === indice ? { ...m, ...parcial } : m)));
  };
  return (
    <div className="space-y-3">
      {muestras.map((muestra, indice) => {
        const zumo = pctZumo(muestra);
        const im = indiceMadurez(muestra);
        return (
          <Card key={indice} className="rounded-xl border-primary/15">
            <CardContent className="space-y-3 p-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold">Muestra {indice + 1}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 rounded-xl text-muted-foreground"
                  onClick={() => onCambio(muestras.filter((_, i) => i !== indice))}
                  aria-label="Quitar muestra"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <CampoTexto etiqueta="Peso fruta (g)" valor={muestra.peso_fruta} onCambio={(v) => actualizar(indice, { peso_fruta: v })} modo="decimal" />
                <CampoTexto etiqueta="Peso zumo (g)" valor={muestra.peso_zumo} onCambio={(v) => actualizar(indice, { peso_zumo: v })} modo="decimal" />
                <CampoTexto etiqueta={`Brix (Ref. ${REF_BRIX})`} valor={muestra.brix} onCambio={(v) => actualizar(indice, { brix: v })} modo="decimal" />
                <CampoTexto etiqueta={`Acidez (Ref. ${REF_ACIDEZ})`} valor={muestra.acidez} onCambio={(v) => actualizar(indice, { acidez: v })} modo="decimal" />
              </div>
              <div className="flex flex-wrap gap-2 text-xs">
                <Badge variant="outline" className="rounded-lg px-2 py-1">
                  % Zumo: <span className="ml-1 font-semibold">{zumo || "—"}</span>
                  <span className="ml-1 text-muted-foreground">(Ref. {REF_PCT_ZUMO})</span>
                </Badge>
                <Badge variant="outline" className="rounded-lg px-2 py-1">
                  Í. madurez: <span className="ml-1 font-semibold">{im || "—"}</span>
                  <span className="ml-1 text-muted-foreground">(Ref. {REF_INDICE_MADUREZ})</span>
                </Badge>
              </div>
            </CardContent>
          </Card>
        );
      })}
      <Button
        type="button"
        variant="outline"
        className="h-11 w-full rounded-xl"
        onClick={() => onCambio([...muestras, { peso_fruta: "", peso_zumo: "", brix: "", acidez: "" }])}
      >
        <Plus className="mr-2 h-4 w-4" />
        Añadir muestra
      </Button>
    </div>
  );
}

// ─── La página ───────────────────────────────────────────────────────────────

export default function CalidadImportacionControl() {
  const { id } = useParams<{ id: string }>();
  const { data: bundle, isLoading } = useCalidadImportControl(id);
  const { actualizarControl, subirFotos, borrarFoto, guardarFirma } = useCalidadImportMutations();
  const { online } = useCalidadImportSync();

  const [control, setControl] = useState<CalidadImportControl | null>(null);
  const [estadoGuardado, setEstadoGuardado] = useState<EstadoGuardado>("guardado");
  const [generando, setGenerando] = useState(false);
  const [rehacerFirma, setRehacerFirma] = useState(false);
  const hidratadoPara = useRef<string | null>(null);
  const sucioRef = useRef(false);
  const camaraRef = useRef<HTMLInputElement>(null);
  const galeriaRef = useRef<HTMLInputElement>(null);

  // Hidratar el estado local UNA vez por control: a partir de ahí manda lo
  // local (autoguardado); un refetch no debe machacar lo que se teclea.
  useEffect(() => {
    if (bundle && hidratadoPara.current !== bundle.control.id) {
      setControl(bundle.control);
      hidratadoPara.current = bundle.control.id;
      sucioRef.current = false;
      setEstadoGuardado("guardado");
      setRehacerFirma(false);
    }
  }, [bundle]);

  const guardar = async (aGuardar: CalidadImportControl) => {
    sucioRef.current = false;
    setEstadoGuardado("guardando");
    try {
      const { offline } = await actualizarControl.mutateAsync(aGuardar);
      setEstadoGuardado(sucioRef.current ? "pendiente" : offline ? "offline" : "guardado");
    } catch {
      sucioRef.current = true;
      setEstadoGuardado("error");
    }
  };

  // Autoguardado con debounce corto: cada cambio local reprograma la escritura.
  useEffect(() => {
    if (!control || !sucioRef.current) return;
    const timer = window.setTimeout(() => void guardar(control), 800);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [control]);

  const cambiar = (parcial: Partial<CalidadImportControl>) => {
    sucioRef.current = true;
    setEstadoGuardado("pendiente");
    setControl((previo) => (previo ? { ...previo, ...parcial } : previo));
  };

  const secciones = useMemo(
    () => (control ? estadoSecciones(control, bundle?.fotos.length ?? 0) : []),
    [control, bundle?.fotos.length],
  );

  const generarInforme = async () => {
    if (!control) return;
    setGenerando(true);
    try {
      if (sucioRef.current) await guardar(control);
      // Cinturón extra: si la copia local no conoce la firma (p.ej. la firmó
      // otro usuario o en otra sesión), vale la del último fetch del control.
      const controlParaInforme = {
        ...control,
        firma_path: control.firma_path ?? bundle?.control.firma_path ?? null,
      };
      const filename = await generarYDescargarInforme(controlParaInforme, bundle?.fotos ?? []);
      if (filename) toast({ title: "Informe generado", description: filename });
    } catch (error) {
      toast({
        title: "No se pudo generar el informe",
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive",
      });
    } finally {
      setGenerando(false);
    }
  };

  const alElegirFotos = async (lista: FileList | null) => {
    if (!control || !lista || lista.length === 0) return;
    const files = Array.from(lista);
    const ordenDesde = (bundle?.fotos ?? []).reduce((max, foto) => Math.max(max, foto.orden + 1), 0);
    await subirFotos.mutateAsync({ controlId: control.id, files, ordenDesde });
  };

  if (isLoading || !control) {
    return (
      <div className="mx-auto w-full max-w-3xl space-y-3 p-3 sm:p-6">
        <Skeleton className="h-12 w-full rounded-2xl" />
        {[1, 2, 3, 4].map((n) => (
          <Skeleton key={n} className="h-16 w-full rounded-2xl" />
        ))}
      </div>
    );
  }

  const completas = secciones.filter((s) => s.completa).length;
  const validado = control.estado === "completado";

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 p-3 pb-28 sm:p-6 sm:pb-28">
      {/* Cabecera: volver, estado del guardado y conexión */}
      <div className="flex items-center justify-between gap-2">
        <Button asChild variant="ghost" className="h-10 rounded-xl px-2 text-muted-foreground">
          <Link to="/calidad/importacion">
            <ArrowLeft className="mr-1 h-4 w-4" />
            Controles
          </Link>
        </Button>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {!online && (
            <span className="flex items-center gap-1 rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 font-medium text-warning">
              <WifiOff className="h-3.5 w-3.5" /> Sin conexión
            </span>
          )}
          {estadoGuardado === "guardando" && (
            <span className="flex items-center gap-1"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Guardando...</span>
          )}
          {estadoGuardado === "guardado" && (
            <span className="flex items-center gap-1 text-success"><Check className="h-3.5 w-3.5" /> Guardado</span>
          )}
          {estadoGuardado === "offline" && (
            <span className="flex items-center gap-1 text-warning"><Check className="h-3.5 w-3.5" /> Guardado en el móvil</span>
          )}
          {estadoGuardado === "pendiente" && <span>Cambios sin guardar...</span>}
          {estadoGuardado === "error" && (
            <button className="text-destructive underline" onClick={() => void guardar(control)}>
              Error al guardar. Reintentar
            </button>
          )}
        </div>
      </div>

      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-lg font-bold">
            {[control.referencia, control.nuestra_ref].filter((p) => p.trim() !== "").join("-") || "Control nuevo"}
          </h1>
          {control.clasificacion.trim() !== "" && (
            <Badge variant="outline" className="border-primary/40 bg-primary/10 text-primary">{control.clasificacion}</Badge>
          )}
          {validado && (
            <Badge variant="outline" className="border-success/40 bg-success/10 text-success">
              <LockKeyhole className="mr-1 h-3 w-3" />
              Validado
            </Badge>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          {completas} de {secciones.length} secciones con datos
        </p>
      </div>

      {validado && (
        <div className="rounded-xl border border-success/30 bg-success/10 px-3 py-2 text-sm text-success">
          Control validado y cerrado: los campos están bloqueados. Pulsa «Reabrir» abajo si necesitas corregir algo.
        </div>
      )}

      <Accordion type="multiple" defaultValue={validado ? [] : ["s1"]} className="space-y-2">
        {/* ── 1. Información del producto ── */}
        <SeccionAcordeon numero={1} titulo="Información del producto" completa={secciones[0].completa} bloqueada={validado}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <CampoTexto etiqueta="Referencia proveedor" valor={control.referencia} onCambio={(v) => cambiar({ referencia: v })} placeholder="1184057" />
            <CampoTexto etiqueta="Nuestra referencia (lote)" valor={control.nuestra_ref} onCambio={(v) => cambiar({ nuestra_ref: v })} placeholder="26082701" />
            <div className="space-y-1">
              <Label className="text-xs font-medium text-muted-foreground">Fecha descarga del camión</Label>
              <Input
                type="date"
                value={control.fecha_descarga ?? ""}
                onChange={(evento) => cambiar({ fecha_descarga: evento.target.value || null })}
                className="h-11 rounded-xl text-base"
              />
            </div>
            <CampoTexto etiqueta="Proveedor" valor={control.proveedor} onCambio={(v) => cambiar({ proveedor: v })} />
            <CampoTexto etiqueta="Barco" valor={control.barco} onCambio={(v) => cambiar({ barco: v })} />
            <CampoTexto etiqueta="Marca" valor={control.marca} onCambio={(v) => cambiar({ marca: v })} />
            <CampoTexto etiqueta="Nº contenedor" valor={control.num_contenedor} onCambio={(v) => cambiar({ num_contenedor: v })} />
            <CampoTexto etiqueta="Kg total contenedor" valor={control.kg_total} onCambio={(v) => cambiar({ kg_total: v })} modo="decimal" />
            <CampoTexto etiqueta="PUC / Orchard (campo)" valor={control.puc_orchard} onCambio={(v) => cambiar({ puc_orchard: v })} />
            <CampoTexto etiqueta="GGN" valor={control.ggn} onCambio={(v) => cambiar({ ggn: v })} />
            <CampoTexto etiqueta="Tipo de producto" valor={control.tipo_producto} onCambio={(v) => cambiar({ tipo_producto: v })} placeholder="NARANJA MIDKNIGHT" />
            <CampoTexto etiqueta="Tipo confección" valor={control.tipo_confeccion} onCambio={(v) => cambiar({ tipo_confeccion: v })} placeholder="ENCAJADO 15 KG..." />
            <CampoTexto etiqueta="Origen" valor={control.origen} onCambio={(v) => cambiar({ origen: v })} placeholder="SUDÁFRICA" />
            <CampoTexto etiqueta="Calibre" valor={control.calibre} onCambio={(v) => cambiar({ calibre: v })} placeholder="4/56-5/64-6/72" />
            <div className="space-y-1">
              <Label className="text-xs font-medium text-muted-foreground">Fecha del control</Label>
              <Input type="date" value={control.fecha} onChange={(evento) => cambiar({ fecha: evento.target.value })} className="h-11 rounded-xl text-base" />
            </div>
          </div>
        </SeccionAcordeon>

        {/* ── 2. Información general ── */}
        <SeccionAcordeon numero={2} titulo="Información general" completa={secciones[1].completa} bloqueada={validado}>
          <div className="space-y-3">
            <OpcionesRapidas etiqueta="Etiquetado" valor={control.etiquetado} opciones={["OK", "NO OK"]} onCambio={(v) => cambiar({ etiquetado: v })} />
            <OpcionesRapidas etiqueta="Clasificación" valor={control.clasificacion} opciones={CLASIFICACIONES_SUGERIDAS} onCambio={(v) => cambiar({ clasificacion: v })} conTextoLibre />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <CampoTexto etiqueta="Tratamientos post-cosecha" valor={control.tratamientos} onCambio={(v) => cambiar({ tratamientos: v })} placeholder="IMAZALIL, CERAS E-903 E-904" />
              <CampoTexto etiqueta="Temperatura (ºC)" valor={control.temperatura} onCambio={(v) => cambiar({ temperatura: v })} />
              <CampoTexto etiqueta="Paletización / cajas" valor={control.paletizacion} onCambio={(v) => cambiar({ paletizacion: v })} placeholder="80 CAJAS" />
              <CampoTexto etiqueta="Peso medio de las cajas (kg)" valor={control.peso_medio_cajas} onCambio={(v) => cambiar({ peso_medio_cajas: v })} modo="decimal" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <OpcionesRapidas etiqueta="Sticker" valor={control.sticker} opciones={["SI", "NO"]} onCambio={(v) => cambiar({ sticker: v })} />
              <OpcionesRapidas etiqueta="Papel" valor={control.papel} opciones={["SI", "NO"]} onCambio={(v) => cambiar({ papel: v })} />
            </div>
          </div>
        </SeccionAcordeon>

        {/* ── 3. Defectos no evolutivos ── */}
        <SeccionAcordeon numero={3} titulo="Defectos no evolutivos" completa={secciones[2].completa} bloqueada={validado}>
          <div className="space-y-4">
            <CampoTexto etiqueta="Muestreo (piezas con defecto - muestra)" valor={control.muestreo_no_evolutivos} onCambio={(v) => cambiar({ muestreo_no_evolutivos: v })} placeholder="(11-200)" />
            <ListaDefectos etiqueta="Defectos leves" defectos={control.defectos_leves} sugerencias={DEFECTOS_NO_EVOLUTIVOS_SUGERIDOS} onCambio={(v) => cambiar({ defectos_leves: v })} />
            <ListaDefectos etiqueta="Defectos graves" defectos={control.defectos_graves} sugerencias={DEFECTOS_NO_EVOLUTIVOS_SUGERIDOS} onCambio={(v) => cambiar({ defectos_graves: v })} />
            <div className="space-y-1">
              <Label className="text-xs font-medium text-muted-foreground">Observaciones</Label>
              <Textarea value={control.obs_no_evolutivos} onChange={(evento) => cambiar({ obs_no_evolutivos: evento.target.value })} rows={3} className="rounded-xl text-base" />
            </div>
          </div>
        </SeccionAcordeon>

        {/* ── 4. Defectos evolutivos ── */}
        <SeccionAcordeon numero={4} titulo="Defectos evolutivos" completa={secciones[3].completa} bloqueada={validado}>
          <div className="space-y-4">
            <CampoTexto etiqueta="Muestreo (piezas con defecto - muestra)" valor={control.muestreo_evolutivos} onCambio={(v) => cambiar({ muestreo_evolutivos: v })} placeholder="(2-200)" />
            <ListaDefectos etiqueta="Defectos" defectos={control.defectos_evolutivos} sugerencias={DEFECTOS_EVOLUTIVOS_SUGERIDOS} onCambio={(v) => cambiar({ defectos_evolutivos: v })} />
            <div className="space-y-1">
              <Label className="text-xs font-medium text-muted-foreground">Observaciones</Label>
              <Textarea value={control.obs_evolutivos} onChange={(evento) => cambiar({ obs_evolutivos: evento.target.value })} rows={3} className="rounded-xl text-base" />
            </div>
          </div>
        </SeccionAcordeon>

        {/* ── 5. Calidad interna ── */}
        <SeccionAcordeon numero={5} titulo="Calidad interna" completa={secciones[4].completa} bloqueada={validado}>
          <div className="space-y-3">
            <MuestrasInternas muestras={control.muestras_internas} onCambio={(v) => cambiar({ muestras_internas: v })} />
            <div className="space-y-1">
              <Label className="text-xs font-medium text-muted-foreground">Observaciones (solo salen en el informe si escribes algo)</Label>
              <Textarea value={control.obs_calidad_interna} onChange={(evento) => cambiar({ obs_calidad_interna: evento.target.value })} rows={2} className="rounded-xl text-base" placeholder="P.ej. % zumo no aceptable, aspecto interior granulado..." />
            </div>
          </div>
        </SeccionAcordeon>

        {/* ── 6. Registro fotográfico ── */}
        <SeccionAcordeon numero={6} titulo={`Registro fotográfico (${bundle?.fotos.length ?? 0})`} completa={secciones[5].completa} bloqueada={validado}>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <Button type="button" variant="outline" className="h-12 rounded-xl" disabled={subirFotos.isPending} onClick={() => camaraRef.current?.click()}>
                {subirFotos.isPending ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <Camera className="mr-2 h-5 w-5" />}
                Hacer foto
              </Button>
              <Button type="button" variant="outline" className="h-12 rounded-xl" disabled={subirFotos.isPending} onClick={() => galeriaRef.current?.click()}>
                <Images className="mr-2 h-5 w-5" />
                Galería
              </Button>
            </div>
            <input
              ref={camaraRef}
              type="file"
              accept="image/*"
              capture="environment"
              hidden
              onChange={(evento) => {
                void alElegirFotos(evento.target.files);
                evento.target.value = "";
              }}
            />
            <input
              ref={galeriaRef}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(evento) => {
                void alElegirFotos(evento.target.files);
                evento.target.value = "";
              }}
            />
            {(bundle?.fotos.length ?? 0) > 0 && (
              <div className="grid grid-cols-3 gap-2">
                {(bundle?.fotos ?? []).map((foto) => (
                  <div key={foto.id} className="group relative aspect-square overflow-hidden rounded-xl border">
                    {foto.signedUrl ? (
                      <img src={foto.signedUrl} alt={foto.file_name} className="h-full w-full object-cover" loading="lazy" />
                    ) : (
                      <div className="flex h-full items-center justify-center text-xs text-muted-foreground">Sin vista previa</div>
                    )}
                    {foto.id.startsWith("pendiente-") && (
                      <span className="absolute left-1 top-1 rounded-full bg-warning/90 px-1.5 py-0.5 text-[10px] font-semibold text-warning-foreground">
                        Por subir
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => void borrarFoto.mutateAsync(foto)}
                      className="absolute right-1 top-1 rounded-full bg-black/60 p-1.5 text-white"
                      aria-label="Borrar foto"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </SeccionAcordeon>

        {/* ── 7. Realiza ── */}
        <SeccionAcordeon numero={7} titulo="Realiza" completa={secciones[6].completa} bloqueada={validado}>
          <div className="space-y-3">
            <CampoTexto etiqueta="Nombre del evaluador" valor={control.evaluador} onCambio={(v) => cambiar({ evaluador: v })} />
            <div className="space-y-1">
              <Label className="text-xs font-medium text-muted-foreground">Firma</Label>
              {bundle?.firmaUrl && !rehacerFirma ? (
                <div className="space-y-2">
                  <div className="rounded-xl border bg-white p-2 dark:bg-white">
                    <img src={bundle.firmaUrl} alt="Firma guardada" className="mx-auto h-20 object-contain" />
                  </div>
                  <Button type="button" variant="outline" size="sm" onClick={() => setRehacerFirma(true)}>
                    Rehacer firma
                  </Button>
                </div>
              ) : (
                <FirmaPad
                  guardando={guardarFirma.isPending}
                  etiqueta={bundle?.firmaUrl ? "Rehacer firma" : "Firmar"}
                  onGuardar={(blob) => {
                    void guardarFirma.mutateAsync({ control, blob }).then((resultado) => {
                      setRehacerFirma(false);
                      // La copia local del editor debe conocer la ruta nueva:
                      // el Word se genera desde ella (sin marcar sucio — la
                      // base ya está actualizada y la firma no viaja en el
                      // autoguardado).
                      if (resultado.firmaPath) {
                        setControl((previo) => (previo ? { ...previo, firma_path: resultado.firmaPath } : previo));
                      }
                    });
                  }}
                />
              )}
            </div>
            <div className="space-y-1">
              <Label className="text-xs font-medium text-muted-foreground">Conclusión (sale al pie del informe, tras la firma)</Label>
              <Textarea
                value={control.conclusion}
                onChange={(evento) => cambiar({ conclusion: evento.target.value })}
                rows={3}
                className="rounded-xl text-base"
                placeholder="P.ej. *Calibre 4/56 marca X presenta problemas internos: estos palets los consideramos no aptos según nuestras especificaciones organolépticas."
              />
            </div>
          </div>
        </SeccionAcordeon>
      </Accordion>

      {/* Barra inferior fija: guardar, validar/reabrir y el informe */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t bg-[var(--glass-bg-solid)] p-3 backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-3xl items-center gap-2">
          {!validado && (
            <Button
              type="button"
              variant="outline"
              className="h-12 flex-1 rounded-xl"
              disabled={estadoGuardado === "guardando"}
              onClick={() => void guardar(control)}
            >
              <Save className="mr-2 h-5 w-5" />
              Guardar
            </Button>
          )}
          <Button
            type="button"
            variant={validado ? "outline" : "secondary"}
            className="h-12 flex-1 rounded-xl"
            onClick={() => {
              const nuevoEstado = validado ? "borrador" : "completado";
              sucioRef.current = true;
              const actualizado = { ...control, estado: nuevoEstado as CalidadImportControl["estado"] };
              setControl(actualizado);
              void guardar(actualizado);
              toast({
                title: nuevoEstado === "completado" ? "Control validado y cerrado" : "Control reabierto",
                description: nuevoEstado === "completado" ? "Los campos quedan bloqueados. Puedes reabrirlo cuando haga falta." : undefined,
              });
            }}
          >
            <CheckCircle2 className={cn("mr-2 h-5 w-5", validado && "text-success")} />
            {validado ? "Reabrir" : "Validar"}
          </Button>
          <Button type="button" className="h-12 flex-1 rounded-xl font-semibold" disabled={generando} onClick={() => void generarInforme()}>
            {generando ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <FileText className="mr-2 h-5 w-5" />}
            Word
          </Button>
        </div>
      </div>
    </div>
  );
}

function SeccionAcordeon({
  numero,
  titulo,
  completa,
  bloqueada,
  children,
}: {
  numero: number;
  titulo: string;
  completa: boolean;
  /** Control validado: los campos de la sección quedan deshabilitados. */
  bloqueada: boolean;
  children: React.ReactNode;
}) {
  return (
    <AccordionItem value={`s${numero}`} className="overflow-hidden rounded-2xl border bg-card">
      <AccordionTrigger className="px-4 py-3 text-left hover:no-underline">
        <span className="flex items-center gap-2.5">
          <span
            className={cn(
              "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold",
              completa ? "bg-success/15 text-success" : "bg-muted text-muted-foreground",
            )}
          >
            {completa ? <Check className="h-4 w-4" /> : numero}
          </span>
          <span className="text-sm font-semibold">{titulo}</span>
        </span>
      </AccordionTrigger>
      <AccordionContent className="px-4 pb-4">
        {/* fieldset deshabilitado = TODOS los inputs y botones nativos de la
            sección quedan bloqueados de una vez cuando el control está validado. */}
        <fieldset disabled={bloqueada} className={cn(bloqueada && "opacity-60")}>
          {children}
        </fieldset>
      </AccordionContent>
    </AccordionItem>
  );
}

import { useRef, useState, type ChangeEvent } from "react";
import { AlertTriangle, Camera, CheckCircle2, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { errorMessage } from "@/lib/errorMessage";
import { formatKg } from "@/lib/format";
import type { PartDetailManualField } from "@/lib/partDetailManualFields";
import {
  normalizePartManualVisionResult,
  partManualVisionExplanations,
  preparePartManualPhoto,
  type PartManualVisionResult,
} from "@/lib/partManualVision";
import { parseParteManualOcr } from "@/lib/partOcrParser";

interface Parte {
  id: string;
  date: string;
  estado: string;
  kg_industria_manual: number;
  kg_reciclado_malla_z1: number;
  kg_reciclado_malla_z2: number;
  kg_inventario_sin_alta: number;
  kg_podrido_bolsa_basura: number;
  /** Nº de box de reciclaje del día (~30 kg/box); la conciliación de kg lo descuenta del procesado (migración 20260721140000). */
  box_reciclaje: number;
  kg_produccion_calibrador: number;
  kg_mujeres_calibrador: number;
  kg_palets_brutos: number;
  kg_palets_egipto: number;
  kg_palets_campo: number;
  kg_podrido_calibrador_auto: number;
  kg_inventario_anterior_sin_alta: number;
  notas_generales: string | null;
  notas_inventario: string | null;
}

interface PartDetailManualProps {
  parte: Parte;
  readOnly: boolean;
  update: <K extends keyof Parte>(key: K, value: Parte[K]) => void;
  manualFields: readonly PartDetailManualField[];
}

const AUTO_FIELDS: [string, keyof Parte][] = [
  ["Producción calibrador", "kg_produccion_calibrador"],
  ["Mujeres (L)", "kg_mujeres_calibrador"],
  ["Palets alta (bruto)", "kg_palets_brutos"],
  ["Podrido calibrador", "kg_podrido_calibrador_auto"],
  ["Inv. día anterior", "kg_inventario_anterior_sin_alta"],
];

const NOTAS_MAX = 2000;

const NUMBER_INPUT_CLASS =
  "pr-10 tabular-nums [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none";

export default function PartDetailManual({
  parte,
  readOnly,
  update,
  manualFields,
}: PartDetailManualProps) {
  const photoInputRef = useRef<HTMLInputElement>(null);
  const [photoLoading, setPhotoLoading] = useState(false);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [visionResult, setVisionResult] = useState<PartManualVisionResult | null>(null);
  const [visionApplied, setVisionApplied] = useState(false);

  const analizarFoto = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setPhotoLoading(true);
    setVisionResult(null);
    setVisionApplied(false);
    try {
      const image = await preparePartManualPhoto(file);
      setPhotoPreview(image.previewUrl);
      const { data, error } = await supabase.functions.invoke("analizar-parte-ocr", {
        body: { image: { mime: image.mime, b64: image.b64 } },
      });
      if (error) throw error;
      if (data?.error) throw new Error(String(data.error));

      const ocrMd = String(data?.ocr_md ?? "");
      if (!ocrMd) throw new Error("El OCR no devolvió texto del papel");
      // Parseo + validación deterministas en cliente (recalcula, checksum,
      // reconcilia). La fecha se ancla al parte abierto (el OCR falla en el mes).
      const envelope = parseParteManualOcr(ocrMd, {
        fechaEsperada: parte.date,
        modelo: data?.modelo ?? null,
      });
      const result = normalizePartManualVisionResult(envelope);
      if (Object.values(result.fields).every((value) => value === null)) {
        throw new Error("No se ha podido reconocer ningún dato útil del papel");
      }
      setVisionResult(result);
      toast({
        title: "Papel leído",
        description: "Revisa los cálculos detectados antes de aplicarlos al formulario.",
      });
    } catch (error) {
      setPhotoPreview(null);
      toast({
        title: "No se pudo leer el papel",
        description: errorMessage(error),
        variant: "destructive",
      });
    } finally {
      setPhotoLoading(false);
    }
  };

  const aplicarVision = () => {
    if (!visionResult || readOnly) return;
    const { fields } = visionResult;
    if (fields.kg_industria_manual !== null) update("kg_industria_manual", fields.kg_industria_manual);
    if (fields.kg_reciclado_malla_z1 !== null) update("kg_reciclado_malla_z1", fields.kg_reciclado_malla_z1);
    if (fields.kg_reciclado_malla_z2 !== null) update("kg_reciclado_malla_z2", fields.kg_reciclado_malla_z2);
    if (fields.kg_inventario_sin_alta !== null) update("kg_inventario_sin_alta", fields.kg_inventario_sin_alta);
    if (fields.kg_podrido_bolsa_basura !== null) update("kg_podrido_bolsa_basura", fields.kg_podrido_bolsa_basura);
    if (fields.box_reciclaje !== null) update("box_reciclaje", fields.box_reciclaje);
    setVisionApplied(true);
    toast({
      title: "Datos aplicados al formulario",
      description: "Compruébalos y pulsa Guardar cuando estén correctos.",
    });
  };

  const reviewValues = visionResult ? [
    ["Industria (Cítrica)", visionResult.fields.kg_industria_manual, "kg"],
    ["Malla Z1 neta", visionResult.fields.kg_reciclado_malla_z1, "kg"],
    ["Malla Z2 neta", visionResult.fields.kg_reciclado_malla_z2, "kg"],
    ["Palets punta", visionResult.fields.kg_inventario_sin_alta, "kg"],
    ["Podrido manual neto", visionResult.fields.kg_podrido_bolsa_basura, "kg"],
    ["Box reciclaje", visionResult.fields.box_reciclaje, "box"],
  ] as const : [];

  return (
    <>
      <Card className="glass-accented">
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="h-7 w-1 shrink-0 rounded-full bg-primary" />
              <div className="min-w-0">
                <CardTitle className="text-base">Ajustes manuales</CardTitle>
                <p className="text-xs text-muted-foreground">Escribe los valores o rellénalos con una foto del papel</p>
              </div>
            </div>
            <input
              ref={photoInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              capture="environment"
              className="hidden"
              onChange={analizarFoto}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={readOnly || photoLoading}
              onClick={() => photoInputRef.current?.click()}
            >
              {photoLoading ? <Loader2 className="animate-spin" /> : <Camera />}
              {photoLoading ? "Leyendo papel…" : "Leer foto del papel"}
            </Button>
          </div>
          {readOnly && (
            <p className="text-xs text-muted-foreground">
              Reabre el parte para poder aplicar datos desde una fotografía.
            </p>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          {visionResult && (
            <div className="rounded-xl border border-primary/25 bg-primary/5 p-3 sm:p-4">
              <div className="flex flex-col gap-4 lg:flex-row">
                {photoPreview && (
                  <img
                    src={photoPreview}
                    alt="Papel de datos manuales analizado"
                    className="h-40 w-full rounded-lg border border-[var(--glass-border)] object-cover lg:w-28"
                  />
                )}
                <div className="min-w-0 flex-1 space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold">Revisión antes de aplicar</p>
                    <Badge variant="outline">{Math.round(visionResult.confianza * 100)}% confianza</Badge>
                    {visionResult.raw.fecha && <Badge variant="secondary">{visionResult.raw.fecha}</Badge>}
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                    {reviewValues.map(([label, value, unit]) => (
                      <div key={label} className="rounded-lg border border-[var(--glass-border)] bg-background/60 px-3 py-2">
                        <p className="text-[11px] text-muted-foreground">{label}</p>
                        <p className="text-sm font-semibold tabular-nums">
                          {value === null ? "No detectado" : unit === "box" ? `${value} box` : formatKg(value)}
                        </p>
                      </div>
                    ))}
                  </div>
                  <div className="space-y-1 text-xs text-muted-foreground">
                    {partManualVisionExplanations(visionResult).map((line) => <p key={line}>{line}</p>)}
                  </div>
                  {visionResult.dudas.length > 0 && (
                    <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 p-2 text-xs">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                      <span>{visionResult.dudas.join(" · ")}</span>
                    </div>
                  )}
                  <Button type="button" size="sm" disabled={readOnly || visionApplied} onClick={aplicarVision}>
                    {visionApplied ? <CheckCircle2 /> : null}
                    {visionApplied ? "Aplicado; falta guardar" : "Aplicar al formulario"}
                  </Button>
                </div>
              </div>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            {manualFields.map((f) => (
              <div key={f.key} className="space-y-1.5">
                <Label htmlFor={f.key}>{f.label}</Label>
                <div className="relative">
                  <Input
                    id={f.key}
                    type="number"
                    step={f.unidad === "box" ? "1" : "0.01"}
                    min="0"
                    inputMode={f.unidad === "box" ? "numeric" : "decimal"}
                    disabled={readOnly}
                    value={String(parte[f.key] ?? 0)}
                    onChange={(e) => update(f.key, Number(e.target.value))}
                    className={NUMBER_INPUT_CLASS}
                  />
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium text-muted-foreground">
                    {f.unidad}
                  </span>
                </div>
              </div>
            ))}
            <div className="space-y-1.5 sm:col-span-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="notas_inventario">Notas de inventario</Label>
                <span className="text-[11px] tabular-nums text-muted-foreground">
                  {(parte.notas_inventario ?? "").length}/{NOTAS_MAX}
                </span>
              </div>
              <Textarea
                id="notas_inventario"
                rows={3}
                disabled={readOnly}
                maxLength={NOTAS_MAX}
                placeholder="Por qué no cuadra el inventario, ajustes hechos a mano..."
                value={parte.notas_inventario ?? ""}
                onChange={(e) => update("notas_inventario", e.target.value)}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="glass-accented">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-3">
            <div className="h-7 w-1 shrink-0 rounded-full bg-primary" />
            <div className="min-w-0">
              <CardTitle className="text-base">Datos automáticos</CardTitle>
              <p className="text-xs text-muted-foreground">Rellenados por IA · solo lectura</p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid gap-x-6 sm:grid-cols-2">
          {AUTO_FIELDS.map(([label, key]) => (
            <div key={label} className="flex items-center justify-between border-b border-[var(--glass-border)] py-2 text-sm">
              <span className="text-muted-foreground">{label}</span>
              <span className="tabular-nums font-medium">{formatKg(Number(parte[key]))}</span>
            </div>
          ))}
        </CardContent>
      </Card>
    </>
  );
}

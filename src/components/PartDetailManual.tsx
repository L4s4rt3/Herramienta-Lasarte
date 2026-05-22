import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatKg } from "@/lib/format";

interface Parte {
  id: string;
  date: string;
  estado: string;
  kg_industria_manual: number;
  kg_reciclado_malla_z1: number;
  kg_reciclado_malla_z2: number;
  kg_inventario_sin_alta: number;
  kg_podrido_bolsa_basura: number;
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
  MANUAL_FIELDS: { key: keyof Parte; label: string }[];
}

export default function PartDetailManual({
  parte,
  readOnly,
  update,
  MANUAL_FIELDS,
}: PartDetailManualProps) {
  return (
    <>
      <Card>
        <CardHeader><CardTitle className="text-lg">Ajustes manuales</CardTitle></CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          {MANUAL_FIELDS.map((f) => (
            <div key={f.key as string} className="space-y-1.5">
              <Label htmlFor={f.key as string}>{f.label}</Label>
              <Input
                id={f.key as string}
                type="number"
                step="0.01"
                min="0"
                disabled={readOnly}
                value={String(parte[f.key] ?? 0)}
                onChange={(e) => update(f.key, Number(e.target.value))}
              />
            </div>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-lg">Datos automáticos (IA)</CardTitle></CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 text-sm">
          {[
            ["Producción calibrador", parte.kg_produccion_calibrador],
            ["Mujeres (L)", parte.kg_mujeres_calibrador],
            ["Palets alta (bruto)", parte.kg_palets_brutos],
            ["Podrido calibrador", parte.kg_podrido_calibrador_auto],
            ["Inv. día anterior", parte.kg_inventario_anterior_sin_alta],
          ].map(([label, val]) => (
            <div key={label as string} className="flex justify-between border-b py-1">
              <span className="text-muted-foreground">{label}</span>
              <span className="tabular-nums">{formatKg(Number(val))}</span>
            </div>
          ))}
        </CardContent>
      </Card>
    </>
  );
}

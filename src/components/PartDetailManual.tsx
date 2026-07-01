import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatKg } from "@/lib/format";
import type { PartDetailManualField, PartDetailManualFieldKey } from "@/lib/partDetailManualFields";

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
  update: <K extends PartDetailManualFieldKey>(key: K, value: Parte[K]) => void;
  manualFields: readonly PartDetailManualField[];
}

const AUTO_FIELDS: [string, keyof Parte][] = [
  ["Producción calibrador", "kg_produccion_calibrador"],
  ["Mujeres (L)", "kg_mujeres_calibrador"],
  ["Palets alta (bruto)", "kg_palets_brutos"],
  ["Podrido calibrador", "kg_podrido_calibrador_auto"],
  ["Inv. día anterior", "kg_inventario_anterior_sin_alta"],
];

const NUMBER_INPUT_CLASS =
  "pr-10 tabular-nums [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none";

export default function PartDetailManual({
  parte,
  readOnly,
  update,
  manualFields,
}: PartDetailManualProps) {
  return (
    <>
      <Card className="glass-accented">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-3">
            <div className="h-7 w-1 shrink-0 rounded-full bg-primary" />
            <div className="min-w-0">
              <CardTitle className="text-base">Ajustes manuales</CardTitle>
              <p className="text-xs text-muted-foreground">Valores que introduce el operario (kg)</p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          {manualFields.map((f) => (
            <div key={f.key} className="space-y-1.5">
              <Label htmlFor={f.key}>{f.label}</Label>
              <div className="relative">
                <Input
                  id={f.key}
                  type="number"
                  step="0.01"
                  min="0"
                  inputMode="decimal"
                  disabled={readOnly}
                  value={String(parte[f.key] ?? 0)}
                  onChange={(e) => update(f.key, Number(e.target.value))}
                  className={NUMBER_INPUT_CLASS}
                />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium text-muted-foreground">
                  kg
                </span>
              </div>
            </div>
          ))}
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

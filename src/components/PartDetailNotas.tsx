import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

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

interface PartDetailNotasProps {
  parte: Parte;
  readOnly: boolean;
  update: <K extends keyof Parte>(key: K, value: Parte[K]) => void;
}

const MAX = 2000;

export default function PartDetailNotas({
  parte,
  readOnly,
  update,
}: PartDetailNotasProps) {
  const ng = parte.notas_generales ?? "";
  const ni = parte.notas_inventario ?? "";
  return (
    <Card className="glass-accented">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-3">
          <div className="h-7 w-1 shrink-0 rounded-full bg-primary" />
          <div className="min-w-0">
            <CardTitle className="text-base">Notas</CardTitle>
            <p className="text-xs text-muted-foreground">Observaciones del parte</p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="ng">Notas generales</Label>
            <span className="text-[11px] tabular-nums text-muted-foreground">{ng.length}/{MAX}</span>
          </div>
          <Textarea id="ng" rows={5} disabled={readOnly} maxLength={MAX}
            value={ng}
            onChange={(e) => update("notas_generales", e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="ni">Notas inventario</Label>
            <span className="text-[11px] tabular-nums text-muted-foreground">{ni.length}/{MAX}</span>
          </div>
          <Textarea id="ni" rows={5} disabled={readOnly} maxLength={MAX}
            value={ni}
            onChange={(e) => update("notas_inventario", e.target.value)} />
        </div>
      </CardContent>
    </Card>
  );
}

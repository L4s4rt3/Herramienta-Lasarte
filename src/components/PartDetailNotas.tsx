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

export default function PartDetailNotas({
  parte,
  readOnly,
  update,
}: PartDetailNotasProps) {
  return (
    <Card>
      <CardHeader><CardTitle className="text-lg">Notas</CardTitle></CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="ng">Notas generales</Label>
          <Textarea id="ng" rows={4} disabled={readOnly} maxLength={2000}
            value={parte.notas_generales ?? ""}
            onChange={(e) => update("notas_generales", e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ni">Notas inventario</Label>
          <Textarea id="ni" rows={4} disabled={readOnly} maxLength={2000}
            value={parte.notas_inventario ?? ""}
            onChange={(e) => update("notas_inventario", e.target.value)} />
        </div>
      </CardContent>
    </Card>
  );
}

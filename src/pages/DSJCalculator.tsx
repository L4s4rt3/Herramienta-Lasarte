import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { CascadeView } from "@/components/CascadeView";
import { computeCascade } from "@/lib/cascade";
import { RotateCcw, FastForward } from "lucide-react";

type State = {
  kg_produccion_calibrador: number;
  kg_industria_manual: number;
  kg_mujeres_calibrador: number;
  kg_reciclado_malla_z1: number;
  kg_reciclado_malla_z2: number;
  kg_palets_brutos: number;
  kg_inventario_anterior_sin_alta: number;
  kg_inventario_sin_alta: number;
  kg_podrido_calibrador: number;
  kg_podrido_bolsa_basura: number;
};

const EMPTY: State = {
  kg_produccion_calibrador: 0,
  kg_industria_manual: 0,
  kg_mujeres_calibrador: 0,
  kg_reciclado_malla_z1: 0,
  kg_reciclado_malla_z2: 0,
  kg_palets_brutos: 0,
  kg_inventario_anterior_sin_alta: 0,
  kg_inventario_sin_alta: 0,
  kg_podrido_calibrador: 0,
  kg_podrido_bolsa_basura: 0,
};

type Field = {
  key: keyof State;
  label: string;
  hint?: string;
};

const PROD: Field[] = [
  { key: "kg_produccion_calibrador", label: "Resumen Calibrador (kg)", hint: "Peso total del calibrador Spectrim" },
  { key: "kg_industria_manual", label: "+ Industria / Cítricos manual", hint: "Fruta de industria añadida manualmente" },
  { key: "kg_mujeres_calibrador", label: "- Mujeres clase L", hint: "El calibrador las cuenta doble; se restan" },
  { key: "kg_reciclado_malla_z1", label: "- Reciclado malla Z1", hint: "Box azules reprocesados Z1" },
  { key: "kg_reciclado_malla_z2", label: "- Reciclado malla Z2", hint: "Box azules reprocesados Z2" },
];

const PAL: Field[] = [
  { key: "kg_palets_brutos", label: "Palets dados de alta (bruto)", hint: "Suma de netos de palets GSTOCK" },
  { key: "kg_inventario_anterior_sin_alta", label: "- Inventario final día anterior", hint: "Inventario de ayer que se da de alta hoy" },
  { key: "kg_inventario_sin_alta", label: "- Inventario final hoy", hint: "Producido hoy sin dar de alta" },
];

const MER: Field[] = [
  { key: "kg_podrido_calibrador", label: "Podrido calibrador" },
  { key: "kg_podrido_bolsa_basura", label: "Podrido manual bolsa basura" },
];

export default function DSJCalculator() {
  const [s, setS] = useState<State>(EMPTY);
  const cascade = useMemo(() => computeCascade(s), [s]);

  const upd = (k: keyof State, v: string) =>
    setS((p) => ({ ...p, [k]: Number(v) || 0 }));

  function nextDay() {
    setS({ ...EMPTY, kg_inventario_anterior_sin_alta: s.kg_inventario_sin_alta });
  }

  function renderField(f: Field) {
    return (
      <div key={f.key} className="space-y-1.5">
        <Label htmlFor={f.key} className="text-xs font-semibold text-muted-foreground">
          {f.label}
        </Label>
        <Input
          id={f.key}
          type="number"
          step="0.01"
          min="0"
          value={String(s[f.key] ?? 0)}
          onChange={(e) => upd(f.key, e.target.value)}
          className="font-medium tabular-nums"
        />
        {f.hint && <p className="text-xs text-muted-foreground">{f.hint}</p>}
      </div>
    );
  }

  return (
    <div className="page-shell">
      <header className="page-header">
        <div>
          <h1 className="page-title">Calculadora DJPMN</h1>
          <p className="page-subtitle">
            Prueba escenarios de cascada sin afectar a los partes guardados.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={nextDay}>
            <FastForward className="h-4 w-4" /> Día siguiente
          </Button>
          <Button variant="ghost" onClick={() => setS(EMPTY)}>
            <RotateCcw className="h-4 w-4" /> Limpiar
          </Button>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-5">
        <div className="lg:col-span-3 space-y-4">
          <Card>
            <CardHeader>
              <p className="panel-kicker">Entrada</p>
              <CardTitle>Producción real</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">{PROD.map(renderField)}</CardContent>
          </Card>

          <Card>
            <CardHeader>
              <p className="panel-kicker">Salida</p>
              <CardTitle>Palets e inventario</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">{PAL.map(renderField)}</CardContent>
          </Card>

          <Card>
            <CardHeader>
              <p className="panel-kicker">Ajustes</p>
              <CardTitle>Mermas</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">{MER.map(renderField)}</CardContent>
          </Card>

          <Card className="border-dashed bg-muted/35">
            <CardContent className="grid gap-3 p-4 text-xs text-muted-foreground sm:grid-cols-2">
              <p><strong className="text-foreground">Producción real</strong><br />Calibrador + Industria - Mujeres(L) - Recic.Z1 - Recic.Z2</p>
              <p><strong className="text-foreground">Palets ajustados</strong><br />Palets brutos - Inventario del día anterior</p>
              <p><strong className="text-foreground">DJPMN</strong><br />Diferencia bruta - Podrido calibrador - Podrido manual</p>
              <p><strong className="text-foreground">Día siguiente</strong><br />Copia el inventario final como inventario anterior.</p>
            </CardContent>
          </Card>
        </div>

        <div className="lg:col-span-2 lg:sticky lg:top-24 self-start">
          <Card>
            <CardHeader>
              <p className="panel-kicker">Lectura operativa</p>
              <CardTitle>Resultado</CardTitle>
            </CardHeader>
            <CardContent><CascadeView result={cascade} /></CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

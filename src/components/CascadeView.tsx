import { CascadeResult } from "@/lib/cascade";
import { formatKg, formatPct } from "@/lib/format";
import { cn } from "@/lib/utils";

interface Row {
  label: string;
  op: "=" | "+" | "−";
  value: number;
  emphasis?: "total" | "result" | "dsj";
}

export function CascadeView({ result }: { result: CascadeResult }) {
  const rows: Row[] = [
    { label: "Producción calibrador", op: "=", value: result.produccion_calibrador },
    { label: "Industria / Cítricos manual", op: "+", value: result.industria_manual },
    { label: "Mujeres (L)", op: "−", value: result.mujeres },
    { label: "Reciclado malla Z1", op: "−", value: result.reciclado_z1 },
    { label: "Reciclado malla Z2", op: "−", value: result.reciclado_z2 },
    { label: "PRODUCCIÓN REAL", op: "=", value: result.produccion_real, emphasis: "total" },
    { label: "Palets alta (bruto)", op: "−", value: result.palets_brutos },
    { label: "Inv. día anterior (en palets)", op: "−", value: result.inventario_anterior },
    { label: "Palets alta ajustados", op: "=", value: result.palets_ajustados, emphasis: "total" },
    { label: "Inventario final (sin alta)", op: "−", value: result.inventario_final },
    { label: "DIFERENCIA BRUTA", op: "=", value: result.diferencia_bruta, emphasis: "total" },
    { label: "Podrido calibrador", op: "−", value: result.podrido_calibrador },
    { label: "Podrido manual (bolsa basura)", op: "−", value: result.podrido_manual },
    { label: "MERMAS TOTALES", op: "=", value: result.mermas_totales, emphasis: "total" },
  ];

  const semColor =
    result.semaforo === "verde"
      ? "bg-success text-success-foreground"
      : result.semaforo === "amarillo"
      ? "bg-warning text-warning-foreground"
      : "bg-destructive text-destructive-foreground";

  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="px-3 py-2 text-left font-medium text-muted-foreground">Concepto</th>
              <th className="w-10 px-2 py-2 text-center font-medium text-muted-foreground">Op.</th>
              <th className="px-3 py-2 text-right font-medium text-muted-foreground">Kg</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr
                key={i}
                className={cn(
                  "border-t",
                  r.emphasis === "total" && "bg-muted/30 font-semibold",
                )}
              >
                <td className="px-3 py-2">{r.label}</td>
                <td className="px-2 py-2 text-center text-muted-foreground">{r.op}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatKg(r.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className={cn("rounded-lg px-4 py-4 flex items-center justify-between", semColor)}>
        <div>
          <p className="text-xs opacity-80 uppercase font-semibold">DJPMN — Diferencia justificada por podrido y merma natural</p>
          <p className="text-2xl font-bold tabular-nums">{formatKg(result.dsj)}</p>
        </div>
        <div className="text-right">
          <p className="text-xs opacity-80 uppercase font-semibold">% DJPMN</p>
          <p className="text-2xl font-bold tabular-nums">{formatPct(result.dsj_pct)}</p>
          <p className="text-xs opacity-80 mt-1">
            {result.semaforo === "verde" && "< 1% · OK"}
            {result.semaforo === "amarillo" && "1–3% · Revisar"}
            {result.semaforo === "rojo" && "> 3% · Crítico"}
          </p>
        </div>
      </div>
    </div>
  );
}
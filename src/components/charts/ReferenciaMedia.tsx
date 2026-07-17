// src/components/charts/ReferenciaMedia.tsx
//
// Umbral con significado para gráficos recharts (patrón admirado en Aerobotics:
// una línea de referencia anotada que convierte el gráfico en una respuesta,
// no solo en datos). Envuelve ReferenceLine con el estilo uniforme del sistema:
// línea discontinua sutil (stroke muted) + etiqueta pequeña. Úsalo dentro de
// cualquier <ComposedChart>/<LineChart>/<BarChart> de recharts, igual que un
// <ReferenceLine> normal.
//
// Ejemplo: <ReferenciaMedia y={mediaProduccion} yAxisId="kg" label="Media del periodo" />
import { ReferenceLine } from "recharts";
import { C } from "@/lib/chartTheme";

export function ReferenciaMedia({
  y,
  label,
  yAxisId,
  color = C.muted,
  position = "insideTopRight",
}: {
  /** Valor (en el eje Y correspondiente) donde se dibuja la línea de media. */
  y: number;
  /** Texto corto de la etiqueta, p.ej. "Media del periodo". */
  label: string;
  /** yAxisId del eje al que pertenece `y`, si el chart tiene varios ejes. */
  yAxisId?: string | number;
  /** Color del trazo y la etiqueta; por defecto el neutro muted del sistema. */
  color?: string;
  position?: "insideTopRight" | "insideTopLeft" | "insideBottomRight" | "insideBottomLeft" | "top" | "right";
}) {
  return (
    <ReferenceLine
      y={y}
      yAxisId={yAxisId}
      stroke={color}
      strokeDasharray="5 4"
      strokeWidth={1.25}
      strokeOpacity={0.65}
      ifOverflow="extendDomain"
      label={{ value: label, position, fill: color, fontSize: 9.5, fontWeight: 600 }}
    />
  );
}

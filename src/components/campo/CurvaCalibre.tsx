// Cómo va creciendo la fruta de una parcela: milímetros por semana.
//
// Dos líneas: la CONTINUA es lo que Aerobotics ha medido en el árbol; la
// DISCONTINUA es lo que prevé que va a crecer. Se tocan en la última semana
// medida a propósito, para que se vea de dónde arranca la proyección y no
// parezca que son dos cosas distintas.
//
// La ventana de recolección se pinta como una banda de fondo: es la respuesta
// a "¿cuándo hay que cogerla?", que es para lo que sirve todo esto.
import {
  CartesianGrid, Legend, Line, LineChart, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { C, GlassTooltip, GRID, MARGIN, XAXIS, YAXIS } from "@/lib/chartTheme";
import type { PuntoCalibre } from "@/lib/campoParcelas";

/** "2026W37" → "S37 '26", que es como se habla de las semanas en la nave. */
export function etiquetaSemana(semana: string): string {
  const m = /^(\d{4})W(\d{1,2})$/.exec(semana);
  return m ? `S${Number(m[2])} '${m[1].slice(2)}` : semana;
}

export interface CurvaCalibreProps {
  puntos: PuntoCalibre[];
  /** Ventana de recolección recomendada, en semanas ISO ("2026W42", "2027W03"). */
  ventana?: { desde: string | null; hasta: string | null } | null;
  alto?: number;
}

export default function CurvaCalibre({ puntos, ventana, alto = 220 }: CurvaCalibreProps) {
  if (puntos.length === 0) return null;

  const datos = puntos.map((p) => ({ ...p, etiqueta: etiquetaSemana(p.semana) }));

  // La banda solo se pinta si sus dos extremos caen dentro de lo dibujado; si
  // la recolección es de aquí a medio año, el gráfico no llega y no se enseña
  // media banda que confunda.
  const semanas = puntos.map((p) => p.semana);
  const dentro = (s: string | null | undefined) => Boolean(s && semanas.includes(s));
  const banda = ventana && dentro(ventana.desde) && dentro(ventana.hasta)
    ? { desde: etiquetaSemana(ventana.desde!), hasta: etiquetaSemana(ventana.hasta!) }
    : null;

  return (
    <ResponsiveContainer width="100%" height={alto}>
      <LineChart data={datos} margin={MARGIN}>
        <CartesianGrid {...GRID} />
        <XAxis dataKey="etiqueta" {...XAXIS} />
        <YAxis {...YAXIS} domain={["dataMin - 5", "dataMax + 5"]} unit=" mm" width={56} />
        <Tooltip content={<GlassTooltip formatter={(v) => `${Number(v).toFixed(1)} mm`} />} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        {banda && (
          <ReferenceArea
            x1={banda.desde}
            x2={banda.hasta}
            fill={C.success}
            fillOpacity={0.12}
            label={{ value: "Recolección", position: "insideTop", fontSize: 10, fill: C.muted }}
          />
        )}
        <Line
          type="monotone"
          dataKey="medido"
          name="Medido en el árbol"
          stroke={C.primary}
          strokeWidth={2}
          dot={{ r: 2.5 }}
          connectNulls
        />
        <Line
          type="monotone"
          dataKey="previsto"
          name="Previsto"
          stroke={C.muted}
          strokeWidth={2}
          strokeDasharray="5 4"
          dot={false}
          connectNulls
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

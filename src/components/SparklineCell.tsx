import { Bar, BarChart, ResponsiveContainer } from "recharts";

interface SparklinePoint {
  mes: string;
  kilos: number;
}

interface SparklineCellProps {
  data: SparklinePoint[];
  maxKilos?: number;
  width?: number;
  height?: number;
}

export function SparklineCell({ data, maxKilos, width = 80, height = 24 }: SparklineCellProps) {
  if (data.length === 0) return <span className="text-xs text-muted-foreground">—</span>;

  const max = maxKilos ?? Math.max(...data.map((d) => d.kilos), 1);
  const trend = data.length >= 2 ? data[data.length - 1].kilos - data[0].kilos : 0;
  const color = trend > 0 ? "var(--color-success, #22c55e)" : trend < 0 ? "var(--color-destructive, #ef4444)" : "var(--color-muted, #64748b)";

  return (
    <div style={{ width, height }} title={`Tendencia: ${trend > 0 ? "subiendo" : trend < 0 ? "bajando" : "estable"}`}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
          <Bar dataKey="kilos" fill={color} radius={[1, 1, 0, 0]} maxBarSize={6} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

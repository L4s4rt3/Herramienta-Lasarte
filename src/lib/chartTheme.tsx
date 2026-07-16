/**
 * chartTheme.tsx - Sistema unificado de graficas Lasarte SAT.
 *
 * Reglas del sistema:
 * - Ejes sin lineas duras: axisLine={false} tickLine={false}.
 * - Grid suave con trazo discontinuo y baja opacidad.
 * - Barras con relleno translucido, borde semantico y radio consistente.
 * - Lineas con dots glass, nunca borde blanco plano.
 * - Areas con gradiente vertical limpio.
 * - Tooltips, cursores y paneles siempre glassmorphism.
 * - Colores desde variables CSS del design system.
 */

// ─── Colores usando variables CSS del design system ───────────────────────────

export const C = {
  primary:     "hsl(var(--primary))",
  info:        "hsl(var(--info))",
  success:     "hsl(var(--success))",
  warning:     "hsl(var(--warning))",
  destructive: "hsl(var(--destructive))",
  muted:       "hsl(var(--muted-foreground))",
} as const;

// Paleta para series múltiples (máx 5 series) — SIN significado semántico:
// no reutiliza success/warning/destructive (esos colores siguen atados a su
// significado allí donde se usan). Escala derivada del azul medio corporativo
// (duotono 2026-07-16, --primary): azul medio, índigo medio, azul-gris, verde
// apagado, neutro cálido — el índigo va segundo porque es el vecino más
// próximo en la familia azul del líder; el naranja NO aparece aquí (es
// --vivo, reservado al KPI puntual, nunca a series de gráfico). El primer
// tono es el token --primary (reacciona al tema) y el resto son medios tonos
// pensados para verse bien sobre glass claro y oscuro por igual.
export const SERIES_PALETTE = [
  "hsl(var(--primary))",  // azul medio
  "hsl(230 38% 58%)",     // índigo medio
  "hsl(205 20% 52%)",     // azul-gris
  "hsl(160 15% 48%)",     // verde apagado
  "hsl(30 20% 52%)",      // neutro cálido
];

// Colores de destino de producción — fuente única de verdad para toda la app
// (Dashboard, LoteDetailSheet, DailyListTable, Productores, AnalisisDiario...).
// Usan hex fijo (no tokens CSS) para que el mismo grupo se vea siempre igual,
// independientemente de la página. Ver también GRUPO_COLORS en destinoClasificacion.ts.
export const DEST_COLORS = {
  exportacion:   "#10b981", // emerald
  mercado:       "#3b82f6", // blue
  industria:     "#f59e0b", // amber (alias de noComercial, mismo concepto)
  noExportacion: "#f97316", // orange
  noComercial:   "#f59e0b", // amber
  mujeres:       "#8b5cf6", // violet
  otro:          C.muted,
} as const;

// Para charts que necesitan 7 colores (días de semana) — misma escala
// que SERIES_PALETTE (azul medio líder), sin colores semánticos.
export const WEEK_PALETTE = [
  "hsl(var(--primary))",  // azul medio
  "hsl(230 38% 58%)",     // índigo medio
  "hsl(205 20% 52%)",     // azul-gris
  "hsl(160 15% 48%)",     // verde apagado
  "hsl(30 20% 52%)",      // neutro cálido
  "hsl(245 26% 42%)",     // marino oscuro
  "hsl(210 14% 62%)",     // azul-gris claro
];

// ─── Props compartidos para recharts ─────────────────────────────────────────

export const GRID = {
  strokeDasharray: "2 4",
  stroke: "hsl(var(--border))",
  vertical: false,
  strokeOpacity: 0.5,
} as const;

export const XAXIS = {
  tick: { fill: "hsl(var(--muted-foreground))", fontSize: 10 },
  axisLine: false,
  tickLine: false,
} as const;

export const YAXIS = {
  tick: { fill: "hsl(var(--muted-foreground))", fontSize: 10 },
  axisLine: false,
  tickLine: false,
  width: 40,
} as const;

// Margin estándar para todos los charts
export const MARGIN = { top: 12, right: 16, left: 0, bottom: 0 } as const;

export const CHART_PANEL_CLASS = "chart-panel";

export const CHART_EMPTY_CLASS =
  "flex flex-col items-center justify-center text-sm text-muted-foreground";

export const CHART_CURSOR = {
  fill: "var(--glass-bg-strong)",
  stroke: "var(--glass-border-accent)",
  strokeWidth: 1,
} as const;

export const CHART_LINE_CURSOR = {
  stroke: "hsl(var(--primary))",
  strokeWidth: 1.5,
  strokeDasharray: "3 3",
} as const;

// Tratamiento visual estándar de barras
export const BAR_STYLE = {
  strokeWidth: 1.5,
  radius: [6, 6, 2, 2] as [number, number, number, number],
  maxBarSize: 34,
} as const;

// Barras con más opacidad para stacked (necesitan más contraste)
export const BAR_STYLE_STACKED = {
  strokeWidth: 1.25,
  radius: [5, 5, 1, 1] as [number, number, number, number],
} as const;

export const legendStyle = {
  fontSize: 11,
  color: "hsl(var(--muted-foreground))",
  paddingTop: 8,
} as const;

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function barFill(color: string, opacity = 0.22): string {
  if (color.startsWith("#")) {
    const r = parseInt(color.slice(1, 3), 16);
    const g = parseInt(color.slice(3, 5), 16);
    const b = parseInt(color.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${opacity})`;
  }
  const cssVarMatch = color.match(/^hsl\(var\((--[^)]+)\)\)$/);
  if (cssVarMatch) {
    return `hsl(var(${cssVarMatch[1]}) / ${opacity})`;
  }
  if (color.startsWith("hsl")) {
    return color.replace(/\)$/, ` / ${opacity})`);
  }
  return color;
}

export function tphColor(tph: number): string {
  return tph >= 14.5 ? C.success : tph >= 12.5 ? C.warning : C.destructive;
}

export function dotStyle(color: string, radius = 3.5) {
  return {
    r: radius,
    fill: color,
    stroke: "var(--glass-bg-strong)",
    strokeWidth: 2,
  };
}

export function activeDotStyle(color: string, radius = 6) {
  return {
    r: radius,
    fill: color,
    stroke: "var(--glass-bg-strong)",
    strokeWidth: 3,
  };
}

export function lineStyle(color: string) {
  return {
    type: "monotone" as const,
    stroke: color,
    strokeWidth: 2.5,
    dot: dotStyle(color),
    activeDot: activeDotStyle(color),
  };
}

export function areaStops(id: string, color: string, topOpacity = 0.28, bottomOpacity = 0.04) {
  return (
    <defs>
      <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor={color} stopOpacity={topOpacity} />
        <stop offset="100%" stopColor={color} stopOpacity={bottomOpacity} />
      </linearGradient>
    </defs>
  );
}

export const PIE_STYLE = {
  paddingAngle: 3,
  strokeWidth: 2,
} as const;

// ─── GlassTooltip ─────────────────────────────────────────────────────────────

interface TooltipEntry {
  name: string;
  value: number | string;
  color?: string;
  fill?: string;
  stroke?: string;
}

interface GlassTooltipProps {
  active?: boolean;
  payload?: TooltipEntry[];
  label?: string;
  formatter?: (value: number | string, name: string) => string;
}

export function GlassTooltip({ active, payload, label, formatter }: GlassTooltipProps) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-[var(--glass-border-accent)] bg-[var(--glass-bg-strong)] backdrop-blur-xl shadow-[var(--glass-shadow-lg)] p-3 text-xs min-w-[170px] space-y-1.5">
      {label && (
        <p className="font-semibold text-foreground border-b border-[var(--glass-border)] pb-1.5 mb-1">
          {label}
        </p>
      )}
      {payload.map((p, i) => {
        const color = p.stroke ?? p.color ?? p.fill ?? "hsl(var(--muted-foreground))";
        const val = formatter ? formatter(p.value, p.name) : String(p.value);
        return (
          <div key={i} className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-1.5 min-w-0">
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: color }}
              />
              <span className="text-muted-foreground truncate">{p.name}</span>
            </div>
            <span className="font-semibold tabular-nums text-foreground shrink-0">{val}</span>
          </div>
        );
      })}
    </div>
  );
}

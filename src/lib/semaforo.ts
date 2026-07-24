// Semáforo del DJPMN, compartido por Dashboard, Partes, etc. para mantener
// el mismo criterio y estilo en toda la app: ≤3% verde, ≤5% ámbar, resto rojo.

// Texto explicativo reutilizado en los tooltips de "?" de toda la app.
// Único sitio donde se expande el acrónimo (kg o %, según la columna/pill
// que lo muestre): el resto de la app da por hecho que "DJPMN" ya se conoce.
export const DJPMN_HELP =
  "DJPMN (Diferencia Sin Justificar): compara la producción real del calibrador con lo dado de alta en palets, tras restar mermas. Cuanto más cerca de 0%, mejor cuadra el día. Verde ≤3%, ámbar 3-5%, rojo >5%.";

export type SemaforoKey = "verde" | "amarillo" | "rojo";
export type SemaforoAccent = "success" | "warning" | "destructive";

export interface SemaforoState {
  key: SemaforoKey;
  label: string;
  accent: SemaforoAccent;
  deltaTrend: "up" | "neutral" | "down";
  /** Clases para una píldora (borde + fondo + texto). */
  pill: string;
  /** Clase de color de texto. */
  text: string;
  /** Clase de fondo para barras. */
  bar: string;
}

export function getSemaforo(dsjPct: number): SemaforoState {
  const abs = Math.abs(dsjPct);
  if (abs <= 3) {
    return { key: "verde", label: "OK", accent: "success", deltaTrend: "up", pill: "border-success/30 bg-success/12 text-success", text: "text-success", bar: "bg-success" };
  }
  if (abs <= 5) {
    return { key: "amarillo", label: "Revisar", accent: "warning", deltaTrend: "neutral", pill: "border-warning/30 bg-warning/12 text-warning", text: "text-warning", bar: "bg-warning" };
  }
  return { key: "rojo", label: "Crítico", accent: "destructive", deltaTrend: "down", pill: "border-destructive/30 bg-destructive/12 text-destructive", text: "text-destructive", bar: "bg-destructive" };
}

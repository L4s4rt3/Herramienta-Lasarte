// src/components/FuenteBadge.tsx
//
// Badge único para marcar la fuente de un dato derivado. Antes cada página
// tenía su propia copia con las mismas clases repetidas: FuenteBadgeMini /
// AsumidoBadgeMini en EntradasBascula.tsx, FuenteBadge / AsumidoBadge en
// TrazabilidadLote.tsx, y un hint de texto plano ("· del envasado") en
// EconomicoCostes.tsx. Todas migradas a este componente único.
//
// REGLA DEL SISTEMA (propuesta de diseño aprobada por el dueño, 2026-07-16):
// todo dato derivado que muestre de dónde sale (real medido / estimado por
// prorrateo / asumido por decisión del dueño / sin dato / mixto / precio
// manual / precio del envasado) lo hace con este componente — prohibido
// volver a crear badges locales para esto.
//
// Nota: la pestaña "Consumos y costes" (ConsumoCostes.tsx) tiene su propio
// sistema de confianza (real|estimado|mixto|incompleto) con OTRA paleta
// (estimado en ámbar, no gris) — es un vocabulario distinto y ese archivo
// está fuera de esta migración; queda para una fase posterior unificarlo
// (o no) con este componente.
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type FuenteBadgeVariant =
  | "real"
  | "estimado"
  | "asumido"
  | "sin_dato"
  | "mixto"
  | "manual"
  | "envasado";

export type FuenteBadgeSize = "sm" | "md";

const VARIANT_LABEL: Record<FuenteBadgeVariant, Record<FuenteBadgeSize, string>> = {
  real: { sm: "real", md: "real" },
  estimado: { sm: "≈ est.", md: "≈ estimado" },
  asumido: { sm: "asumido", md: "asumido" },
  sin_dato: { sm: "sin dato", md: "sin dato" },
  mixto: { sm: "mixto", md: "mixto" },
  manual: { sm: "Manual", md: "Manual" },
  envasado: { sm: "Del envasado", md: "Del envasado" },
};

// Colores: verde = real, gris = estimado/sin dato, ámbar = asumido — tal
// cual las copias que sustituye. "manual"/"envasado" toman el mismo azul
// primario / gris neutro que ya usaba EconomicoPrecios.tsx para ese par
// (FuentePrecioBadge, migrada a este componente con className="rounded-md
// px-2" en la llamada para igualar su aspecto exacto).
const VARIANT_CLASS: Record<FuenteBadgeVariant, string> = {
  real: "border-emerald-600/35 bg-emerald-600/12 text-emerald-800 dark:text-emerald-200",
  estimado: "border-[var(--glass-border)] text-muted-foreground",
  asumido: "border-amber-500/35 bg-amber-500/12 text-amber-800 dark:text-amber-200",
  sin_dato: "border-[var(--glass-border)] text-muted-foreground/70",
  mixto: "border-info/30 bg-info/10 text-info",
  manual: "border-muted-foreground/30 text-muted-foreground",
  envasado: "border-primary/40 bg-primary/10 text-primary",
};

const VARIANT_TITLE: Record<FuenteBadgeVariant, string> = {
  real: "Dato real medido (p.ej. informe LOTE del calibrador).",
  estimado: "Dato estimado por prorrateo, no medido directamente.",
  asumido: "Asunción del dueño del negocio (decisión 2026-07-15): ni real ni estimado por prorrateo.",
  sin_dato: "No hay dato disponible para este periodo o lote.",
  mixto: "Combina datos reales y estimados en el mismo periodo.",
  manual: "Precio introducido a mano: no hay coste de envasado configurado para este tipo.",
  envasado: "Precio calculado a partir del coste total de envasado por malla.",
};

const SIZE_CLASS: Record<FuenteBadgeSize, string> = {
  sm: "px-1 py-0 text-[10px]",
  md: "px-1.5 py-0 text-[10px]",
};

/**
 * Badge de fuente de un dato derivado. `size="sm"` para celdas de tabla
 * densas, `size="md"` (por defecto) para tarjetas y fichas. El tooltip por
 * defecto explica la variante; pásale `title` para sobreescribirlo.
 */
export function FuenteBadge({
  fuente,
  size = "md",
  title,
  className,
}: {
  fuente: FuenteBadgeVariant;
  size?: FuenteBadgeSize;
  title?: string;
  className?: string;
}) {
  return (
    <Badge
      variant="outline"
      title={title ?? VARIANT_TITLE[fuente]}
      className={cn(SIZE_CLASS[size], VARIANT_CLASS[fuente], className)}
    >
      {VARIANT_LABEL[fuente][size]}
    </Badge>
  );
}

/**
 * Traduce el vocabulario de `FuentePodrido` (src/lib/mermaLote.ts:
 * "real" | "prorrateo" | "desconocido") a una variante de este badge.
 * Evita repetir el mismo condicional en cada página que consume merma/podrido.
 */
export function fuentePodridoAVariant(fuente: "real" | "prorrateo" | "desconocido"): FuenteBadgeVariant {
  if (fuente === "real") return "real";
  if (fuente === "desconocido") return "sin_dato";
  return "estimado";
}

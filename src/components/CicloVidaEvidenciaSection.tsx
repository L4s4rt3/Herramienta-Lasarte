// src/components/CicloVidaEvidenciaSection.tsx
//
// Sección ADITIVA y de SOLO LECTURA para la ficha de lote de Trazabilidad
// (FASE 3a de la refundación, ver docs/TRAZABILIDAD_REFUNDACION.md): primer
// consumidor del motor nuevo (eventosLote.ts + cicloVidaLote.ts). No
// sustituye ningún número existente de la ficha — el motor VIEJO sigue
// mandando en stock/cierres; esto es una capa de evidencia en paralelo, para
// poder contrastar sin decidir nada por su cuenta (no escribe en BD, no
// navega a /entradas, no dispara ningún cierre).
import {
  AlertTriangle,
  Camera,
  Factory,
  History,
  Lock,
  ShieldCheck,
  Snowflake,
  StickyNote,
  Tag,
  TrendingDown,
  Truck,
  Warehouse,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useCicloVidaLoteEvidencia } from "@/hooks/useCicloVidaLoteEvidencia";
import type { ClaseEvidencia, EventoLote } from "@/lib/eventosLote";
import type { ContradiccionLote, EstadoLote, KgPorClase } from "@/lib/cicloVidaLote";
import { C } from "@/lib/chartTheme";
import { formatDate, formatKgCompact as formatKg, formatPct } from "@/lib/format";
import { cn } from "@/lib/utils";

// ─── Vocabulario visual: mismos tokens semánticos que el resto de la app ────
// (ver AsentamientoCampanaCard en AnalisisDiario.tsx: success=evidencia dura,
// warning=derivada/sugerencia, destructive=sin rastro) — no se inventa ningún
// color nuevo.

const CLASE_EVIDENCIA_LABEL: Record<ClaseEvidencia, string> = {
  nombrado: "Nombrado",
  anotado: "Anotado",
  medido: "Medido",
  derivado: "Derivado",
};

const CLASE_EVIDENCIA_BADGE: Record<ClaseEvidencia, string> = {
  nombrado: "border-success/40 bg-success/10 text-success",
  anotado: "border-info/40 bg-info/10 text-info",
  medido: "border-primary/40 bg-primary/10 text-primary",
  derivado: "border-warning/40 bg-warning/10 text-warning",
};

const KG_CLASE_SEGMENTOS: Array<{ key: keyof KgPorClase; label: string; color: string }> = [
  { key: "nombrado", label: "Nombrado (pasada del calibrador)", color: C.success },
  { key: "anotado", label: "Anotado (indicación humana)", color: C.info },
  { key: "medido", label: "Medido (foto/merma/cámara)", color: C.primary },
  { key: "derivado", label: "Derivado (derrame, sugerencia)", color: C.warning },
  { key: "sinRastro", label: "Sin rastro", color: C.destructive },
];

const ESTADO_LOTE_LABEL: Record<EstadoLote, string> = {
  cerrado: "Cerrado",
  completo_pendiente_cierre: "Completo (cierre pendiente)",
  parcial: "Parcial",
  en_camara_externa: "En cámara externa",
  en_camara_confirmada: "En cámara confirmada",
  venta_directa: "Venta directa",
  derivado_citrica: "Derivado a Cítrica",
  sin_rastro: "Sin rastro",
  sin_evidencia_suficiente: "Sin evidencia suficiente",
};

const ESTADO_LOTE_BADGE: Record<EstadoLote, string> = {
  cerrado: "border-success/40 bg-success/10 text-success",
  completo_pendiente_cierre: "border-success/40 bg-success/10 text-success",
  parcial: "border-warning/40 bg-warning/10 text-warning",
  en_camara_externa: "border-info/40 bg-info/10 text-info",
  en_camara_confirmada: "border-info/40 bg-info/10 text-info",
  venta_directa: "border-[var(--glass-border)] bg-muted text-muted-foreground",
  derivado_citrica: "border-[var(--glass-border)] bg-muted text-muted-foreground",
  sin_rastro: "border-destructive/40 bg-destructive/10 text-destructive",
  sin_evidencia_suficiente: "border-destructive/40 bg-destructive/10 text-destructive",
};

const CONTRADICCION_TITULO: Record<ContradiccionLote["tipo"], string> = {
  pasada_vs_foto_stock: "Pasada del calibrador vs. foto de stock",
  exceso_sin_dueno: "Exceso de derrame sin dueño real",
  prec_sin_indicacion: "Precalibrado sin indicación",
  sin_rastro_con_edad: "Sin rastro, con edad sospechosa",
};

function detalleContradiccion(c: ContradiccionLote): string {
  switch (c.tipo) {
    case "pasada_vs_foto_stock":
    case "exceso_sin_dueno":
      return c.detalle;
    case "prec_sin_indicacion":
      return `${formatKg(c.kgPendiente)} de precalibrado sin ninguna mención en los informes desde hace ${c.dias} día${c.dias === 1 ? "" : "s"}.`;
    case "sin_rastro_con_edad":
      return `Lleva ${c.dias} días sin ninguna evidencia (ni nombrada ni anotada ni medida) — candidato a revisar como posible stock fantasma.`;
  }
}

// ─── Eventos: icono + descripción por tipo ──────────────────────────────────

const EVENTO_ICONO: Record<EventoLote["tipo"], typeof Truck> = {
  entrada_bascula: Truck,
  foto_stock: Camera,
  merma_camara: Snowflake,
  cierre_manual: Lock,
  pasada_nombrada: Factory,
  derrame_exceso: TrendingDown,
  camara_externa: Warehouse,
  venta_directa: Tag,
  confirmacion_fisica: ShieldCheck,
  anotacion_pasada: StickyNote,
};

function describirEvento(e: EventoLote): { titulo: string; detalle: string } {
  switch (e.tipo) {
    case "entrada_bascula":
      return { titulo: "Entrada en báscula", detalle: `${formatKg(e.kg)} de entrada${e.esPrecalibrado ? " · precalibrado" : ""}${e.esCampoCit ? " · CAMPO/CIT" : ""}` };
    case "foto_stock":
      return { titulo: "Foto de stock (ajuste)", detalle: `${e.kg >= 0 ? "+" : ""}${formatKg(e.kg)} sobre lo visto en los partes` };
    case "merma_camara":
      return { titulo: "Merma real de cámara", detalle: `${formatKg(e.kg)} evaporados (peso inicial − peso final)` };
    case "cierre_manual":
      return {
        titulo: "Cierre manual",
        detalle: e.cierreModo === "sin_registro"
          ? "Sin registro: la fruta salió sin dejar rastro bajo este código"
          : "Con análisis: procesado, el hueco es merma/podrido real",
      };
    case "pasada_nombrada":
      return {
        titulo: `Pasada del calibrador (código ${e.posicion === "principal" ? "principal" : "no principal"})`,
        detalle: e.kg == null ? "Mencionado en el texto de la pasada, sin kg atribuido por el reparto" : `${formatKg(e.kg)} atribuidos por el reparto`,
      };
    case "derrame_exceso":
      return {
        titulo: "Derrame de exceso (sugerencia, no cuenta para cerrar)",
        detalle: `${formatKg(e.kg)} desde el lote ${e.loteDonante} (${e.motivo === "exceso_misma_finca" ? "misma finca" : "misma variedad"})`,
      };
    case "camara_externa":
      return {
        titulo: `Cámara externa · ${e.procedencia}`,
        detalle: `${formatKg(e.kg)} · ${e.estadoCamion === "en_camara" ? "sigue en cámara" : "recepción parcial"}`,
      };
    case "venta_directa":
      return { titulo: "Venta directa", detalle: `${formatKg(e.kg)} · ${e.detalle}` };
    case "confirmacion_fisica":
      return { titulo: `Confirmación física · ${e.nombreCamara}`, detalle: "Inventario a pie de cámara: dirección confirma que sigue dentro" };
    case "anotacion_pasada":
      return { titulo: "Anotación de pasada", detalle: e.nota ? e.nota : (e.kg != null ? `${formatKg(e.kg)} confirmados` : "Sin detalle adicional") };
  }
}

// ─── Sub-componentes ─────────────────────────────────────────────────────────

function BarraKgPorClase({ kgPorClase, kgEntrada }: { kgPorClase: KgPorClase; kgEntrada: number }) {
  const segmentos = KG_CLASE_SEGMENTOS.map((s) => {
    const kg = kgPorClase[s.key];
    const pct = kgEntrada > 0 ? (kg / kgEntrada) * 100 : 0;
    return { ...s, kg, pct };
  });
  return (
    <div className="space-y-2.5">
      <div className="flex h-5 w-full overflow-hidden rounded-md border border-[var(--glass-border)]">
        {segmentos.map((s) => {
          if (s.pct <= 0) return null;
          return (
            <div
              key={s.key}
              style={{ width: `${s.pct}%`, backgroundColor: s.color }}
              title={`${s.label}: ${formatKg(s.kg)} (${s.pct.toFixed(1)}%)`}
            />
          );
        })}
      </div>
      <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        {segmentos.map((s) => (
          <li key={s.key} className="rounded-lg border border-[var(--glass-border)] bg-[var(--glass-bg)] px-2.5 py-2">
            <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: s.color }} />
              {s.label}
            </div>
            <p className="mt-0.5 text-sm font-bold tabular-nums text-foreground">{formatKg(s.kg)}</p>
            <p className="text-[11px] text-muted-foreground">{s.pct.toFixed(1)}%</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ContradiccionesLista({ contradicciones }: { contradicciones: ContradiccionLote[] }) {
  if (contradicciones.length === 0) return null;
  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Contradicciones detectadas ({contradicciones.length})
      </p>
      {contradicciones.map((c, i) => (
        <p key={i} className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            <span className="font-semibold">{CONTRADICCION_TITULO[c.tipo]}:</span> {detalleContradiccion(c)}
          </span>
        </p>
      ))}
    </div>
  );
}

function EventosTimeline({ eventos }: { eventos: EventoLote[] }) {
  if (eventos.length === 0) {
    return <p className="text-xs text-muted-foreground">Sin eventos detectados por el motor de evidencia para este lote.</p>;
  }
  // Cronológico ascendente; los eventos sin fecha fiable (raro: alguna pasada
  // compuesta sin fecha en el parte) van al final, no se descartan.
  const ordenados = [...eventos].sort((a, b) => {
    if (a.fecha == null && b.fecha == null) return 0;
    if (a.fecha == null) return 1;
    if (b.fecha == null) return -1;
    return a.fecha.localeCompare(b.fecha);
  });
  return (
    <ul className="space-y-2">
      {ordenados.map((e, i) => {
        const { titulo, detalle } = describirEvento(e);
        const Icon = EVENTO_ICONO[e.tipo];
        return (
          <li key={i} className="flex items-start gap-2.5 rounded-lg border border-[var(--glass-border)] bg-[var(--glass-bg)] px-3 py-2">
            <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <p className="text-xs font-semibold text-foreground">{titulo}</p>
                <Badge variant="outline" className={cn("px-1.5 py-0 text-[10px]", CLASE_EVIDENCIA_BADGE[e.clase])}>
                  {CLASE_EVIDENCIA_LABEL[e.clase]}
                </Badge>
                {e.fecha && <span className="text-[11px] text-muted-foreground">{formatDate(e.fecha)}</span>}
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">{detalle}</p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

// ─── Sección principal ───────────────────────────────────────────────────────

export function CicloVidaEvidenciaSection({ lote }: { lote: string }) {
  const { ciclo, eventos, discrepancia, isLoading } = useCicloVidaLoteEvidencia(lote);

  if (isLoading) return <Skeleton className="h-56 w-full" />;
  if (!ciclo) return null; // sin entrada de báscula: el motor nuevo no tiene nada que derivar (igual que el viejo)

  return (
    <Card className="glass-accented">
      <CardContent className="space-y-4 p-4 sm:p-5">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 border-primary/40 bg-primary/10 text-primary">
            <History className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            {/* div, no <p>: Badge renderiza un <div> y <div> dentro de <p> es
                anidamiento HTML inválido (warning real de validateDOMNesting). */}
            <div className="flex flex-wrap items-center gap-1.5 text-sm font-semibold">
              Ciclo de vida (evidencia)
              <Badge variant="outline" className={cn("px-1.5 py-0 text-[10px]", ESTADO_LOTE_BADGE[ciclo.estado])}>
                {ESTADO_LOTE_LABEL[ciclo.estado]}
              </Badge>
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Derivado por el motor de evidencia nuevo (fase 3a de la refundación de trazabilidad) — solo lectura,
              no cambia stock ni cierres. {ciclo.destino}.
            </p>
          </div>
        </div>

        {discrepancia && (
          <p className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{discrepancia.nota}</span>
          </p>
        )}

        <div className="border-t border-[var(--glass-border)] pt-3">
          <p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Kg por clase de evidencia
            <span className="font-normal normal-case text-muted-foreground">
              · {formatPct(ciclo.pctConEvidenciaDura * 100)} con evidencia dura (nombrada + anotada)
            </span>
          </p>
          <BarraKgPorClase kgPorClase={ciclo.kgPorClase} kgEntrada={ciclo.kgEntrada} />
        </div>

        <div className="border-t border-[var(--glass-border)] pt-3">
          <ContradiccionesLista contradicciones={ciclo.contradicciones} />
        </div>

        <div className="border-t border-[var(--glass-border)] pt-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Línea de tiempo de eventos ({eventos.length})
          </p>
          <EventosTimeline eventos={eventos} />
        </div>
      </CardContent>
    </Card>
  );
}

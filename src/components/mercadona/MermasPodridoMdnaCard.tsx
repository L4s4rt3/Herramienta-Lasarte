/**
 * MermasPodridoMdnaCard — merma, podrido y aprovechamiento Mercadona de la
 * MISMA semana, en una sola lectura (petición del dueño, 2026-07-28, tras
 * importar los Informes LOTE de toda la campaña: el podrido ya es REAL por
 * lote en ~88% de los kg).
 *
 * HONESTIDAD del dato (importante): la merma y el podrido son de TODA la
 * fruta procesada en la semana — no existe trazabilidad merma→cliente, así
 * que NO son "la merma de la fruta de Mercadona", sino las tres lecturas del
 * mismo periodo puestas juntas: cuánta fruta se perdió (merma), cuánta salió
 * podrida (calibrador, con su fuente real/estimado) y cuánta acabó en
 * Mercadona (aprovechamiento real del informe semanal, o estimado por palets
 * mientras no llega).
 *
 * Fórmulas: reutiliza los agregados ya testeados de mermaLote.ts
 * (mermaLotesEnPeriodo + agregarMermaLotes sobre lotes "procesados", mismo
 * patrón que EconomicoPanel.tsx) — aquí solo se dividen kg entre kg.
 */
import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { FuenteBadge, type FuenteBadgeVariant } from "@/components/FuenteBadge";
import { useMermaLotes } from "@/hooks/useMermaLote";
import { agregarMermaLotes, mermaLotesProcesadosEnPeriodo, type MermaLotesAgregado } from "@/lib/mermaLote";
import { formatKg, formatPct } from "@/lib/format";

interface Props {
  desde: string;
  hasta: string;
  /** Aprovechamiento real (vendido/calibrador) de la semana; null sin informe semanal. */
  aprovechamientoRealPct: number | null;
  /** Estimación por palets mientras no llega el informe. */
  aprovechamientoEstimadoPct: number;
  /** % de kg confeccionados en formatos MDNA sobre el total confeccionado de la semana. */
  confeccionMdnaPct: number;
  cargandoAprovechamiento: boolean;
}

/** % de podrido de calibrador sobre la entrada de los lotes procesados, con su fuente. */
function podridoDeAgregado(a: MermaLotesAgregado): { pct: number | null; kg: number; fuente: FuenteBadgeVariant } {
  const kg = a.kgPodridoCalibradorReal + a.kgPodridoCalibradorEstimado;
  const pct = a.kgEntradaProcesados > 0 ? (kg / a.kgEntradaProcesados) * 100 : null;
  const fuente: FuenteBadgeVariant = a.kgPodridoCalibradorEstimado > 0
    ? (a.kgPodridoCalibradorReal > 0 ? "mixto" : "estimado")
    : a.kgPodridoCalibradorReal > 0
      ? "real"
      : a.nLotesPodridoDesconocido > 0
        ? "sin_dato"
        : "real";
  return { pct, kg, fuente };
}

export function MermasPodridoMdnaCard({
  desde, hasta, aprovechamientoRealPct, aprovechamientoEstimadoPct, confeccionMdnaPct, cargandoAprovechamiento,
}: Props) {
  const { lotes, isLoading } = useMermaLotes();

  const { semana, campana } = useMemo(() => {
    const procesados = lotes.filter((l) => l.estado === "procesado");
    return {
      // Semana por ÚLTIMA fecha de procesado (la fruta que terminó línea esta
      // semana), no por fecha de entrada: con cámaras externas un lote entra
      // en mayo y se procesa en julio (ver mermaLotesProcesadosEnPeriodo).
      semana: agregarMermaLotes(mermaLotesProcesadosEnPeriodo(procesados, desde, hasta)),
      campana: agregarMermaLotes(procesados),
    };
  }, [lotes, desde, hasta]);

  const podridoSemana = podridoDeAgregado(semana);
  const podridoCampana = podridoDeAgregado(campana);

  const mermaPct = semana.mermaMediaPonderadaPct;
  const aprovechamientoPct = aprovechamientoRealPct ?? aprovechamientoEstimadoPct;
  // Barra "de cada 100 kg de fruta entrada": merma + podrido + resto. El
  // resto NO es "lo de Mercadona" (eso es el aprovechamiento, otra base):
  // es la fruta que siguió adelante hacia confección/venta.
  const barra = mermaPct != null && podridoSemana.pct != null
    ? {
      merma: Math.max(0, mermaPct),
      podrido: Math.max(0, podridoSemana.pct),
      resto: Math.max(0, 100 - Math.max(0, mermaPct) - Math.max(0, podridoSemana.pct)),
    }
    : null;

  return (
    <Card className="glass-accented">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Mermas, podrido y aprovechamiento</CardTitle>
        <p className="text-xs text-muted-foreground">
          Las tres lecturas de la misma semana. La merma y el podrido son de TODA la fruta procesada
          (no hay trazabilidad merma→cliente); el aprovechamiento es lo que acabó en Mercadona.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-4 w-full" />
          </div>
        ) : semana.nProcesados === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            Ningún lote terminó de procesarse esta semana: la merma se mide al terminar cada lote
            (los que siguen a medias entrarán la semana en que acaben).
          </p>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg border border-[var(--glass-border)] bg-[var(--glass-bg)] p-3">
                <p className="text-xs font-semibold text-muted-foreground">Merma natural</p>
                <p className="mt-1 text-lg font-bold tabular-nums">
                  {mermaPct != null ? formatPct(mermaPct) : "—"}
                  <span className="ml-1.5 text-xs font-medium text-muted-foreground">
                    {formatKg(semana.kgMermaNaturalTotal)}
                  </span>
                </p>
                <p className="mt-0.5 text-[11px] tabular-nums text-muted-foreground">
                  Campaña: {campana.mermaMediaPonderadaPct != null ? formatPct(campana.mermaMediaPonderadaPct) : "—"}
                </p>
              </div>
              <div className="rounded-lg border border-[var(--glass-border)] bg-[var(--glass-bg)] p-3">
                <div className="flex items-center gap-1.5">
                  <p className="text-xs font-semibold text-muted-foreground">Podrido calibrador</p>
                  <FuenteBadge fuente={podridoSemana.fuente} />
                </div>
                <p className="mt-1 text-lg font-bold tabular-nums">
                  {podridoSemana.pct != null ? formatPct(podridoSemana.pct) : "—"}
                  <span className="ml-1.5 text-xs font-medium text-muted-foreground">{formatKg(podridoSemana.kg)}</span>
                </p>
                <p className="mt-0.5 text-[11px] tabular-nums text-muted-foreground">
                  Campaña: {podridoCampana.pct != null ? formatPct(podridoCampana.pct) : "—"}
                  {campana.kgPodridoCalibradorEstimado > 0 && " (mixto)"}
                </p>
              </div>
              <div className="rounded-lg border border-[var(--glass-border)] bg-[var(--glass-bg)] p-3">
                <div className="flex items-center gap-1.5">
                  <p className="text-xs font-semibold text-muted-foreground">Aprovechamiento Mercadona</p>
                  {!cargandoAprovechamiento && <FuenteBadge fuente={aprovechamientoRealPct != null ? "real" : "estimado"} />}
                </div>
                <p className="mt-1 text-lg font-bold tabular-nums">
                  {cargandoAprovechamiento ? "…" : formatPct(aprovechamientoPct)}
                </p>
                <p className="mt-0.5 text-[11px] tabular-nums text-muted-foreground">
                  Confección MDNA: {formatPct(confeccionMdnaPct)} del total confeccionado
                </p>
              </div>
            </div>

            {barra && (
              <div className="space-y-1">
                <div className="flex h-2.5 w-full overflow-hidden rounded-full border border-[var(--glass-border)]">
                  <div className="bg-amber-500/80" style={{ width: `${barra.merma}%` }} title={`Merma ${formatPct(barra.merma)}`} />
                  <div className="bg-destructive/80" style={{ width: `${barra.podrido}%` }} title={`Podrido ${formatPct(barra.podrido)}`} />
                  <div className="bg-emerald-500/70" style={{ width: `${barra.resto}%` }} title={`Sigue adelante ${formatPct(barra.resto)}`} />
                </div>
                <p className="text-[11px] text-muted-foreground">
                  De cada 100 kg de fruta entrada (lotes procesados de la semana):{" "}
                  <span className="font-medium text-amber-600 dark:text-amber-400">{formatPct(barra.merma)} merma</span> ·{" "}
                  <span className="font-medium text-destructive">{formatPct(barra.podrido)} podrido</span> ·{" "}
                  <span className="font-medium text-emerald-600 dark:text-emerald-400">{formatPct(barra.resto)} sigue adelante</span>
                  {" "}— y de lo confeccionado, {formatPct(confeccionMdnaPct)} fue a formatos MDNA.
                </p>
              </div>
            )}

            <p className="text-[11px] text-muted-foreground">
              {semana.nProcesados} lote(s) terminados de procesar esta semana ·{" "}
              {formatKg(semana.kgEntradaProcesados)} de entrada. Los lotes a medias entran la semana en que acaban.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

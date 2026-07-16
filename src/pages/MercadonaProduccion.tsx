// src/pages/MercadonaProduccion.tsx
// Mercadona desde el punto de vista de PRODUCCION (no de ventas): que
// productores/lotes/dias/formatos rinden mejor para este cliente. Nada de
// facturacion, planificacion, cumplimiento vendido/planificado ni
// expediciones — eso vive en la Mercadona "comercial" (src/pages/Mercadona.tsx).
//
// El selector de semana es propio y NO depende del Excel de ventas
// (mercadona_semanas/useMercadonaVentas): usa la semana ISO de Mercadona
// (lunes-sabado, ver mercadonaWeekDateRange) navegable libremente, con un
// valor por defecto resuelto por useSemanaProduccionEfectiva (ultima semana
// con parte diario registrado, o la semana actual si no hay ninguna todavia).
//
// El bloque "Lotes y productores" se reutiliza tal cual desde
// MercadonaLotes.tsx (ranking historico de productores por aprovechamiento
// MDNA estimado + tabla de lotes de la semana, clicable a su informe de
// calidad, + mejor dia). Ese componente solo lee `activeSemana.anio` y
// `activeSemana.semana` (para construir el rango de fechas via
// mercadonaWeekDateRange): por eso aqui se le pasa un objeto minimo que
// cumple el tipo MercadonaSemanaConMetodos con esos dos campos reales y el
// resto en null/vacio (no existe una fila en mercadona_semanas para esta
// semana "de produccion", y no hace falta: nunca se leen).
import { useState } from "react";
import { Link } from "react-router-dom";
import { BadgeCheck, PackageSearch, Percent, Scale, Timer } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { KPICard } from "@/components/KPICard";
import { PeriodoFlechas } from "@/components/SelectorPeriodo";
import { MercadonaLotes, MercadonaProductoresRanking } from "@/components/mercadona/MercadonaLotes";
import { useMercadona } from "@/hooks/useMercadona";
import { useMercadonaAprovechamiento } from "@/hooks/useMercadonaAprovechamiento";
import {
  shiftSemanaMercadona,
  useSemanaProduccionEfectiva,
  type MercadonaProduccionSemana,
} from "@/hooks/useMercadonaProduccion";
import type { MercadonaSemanaConMetodos } from "@/hooks/useMercadonaVentas";
import { formatMercadonaWeekRangeLabel, mercadonaWeekDateRange } from "@/lib/mercadonaVentas";
import { formatKg, formatPct } from "@/lib/format";

export default function MercadonaProduccion() {
  const [seleccionada, setSeleccionada] = useState<MercadonaProduccionSemana | null>(null);
  const [tab, setTab] = useState<"lotes" | "productores">("lotes");
  const { efectiva, isDefaultLoading } = useSemanaProduccionEfectiva(seleccionada);

  const rango = mercadonaWeekDateRange(efectiva.anio, efectiva.semana);
  const rangoLabel = formatMercadonaWeekRangeLabel(efectiva.anio, efectiva.semana);
  const mercadona = useMercadona(rango.desde, rango.hasta);
  const aprovechamiento = useMercadonaAprovechamiento(efectiva.anio, efectiva.semana);

  // Objeto minimo compatible con lo que MercadonaLotes/useMercadonaLotes leen
  // de verdad (anio + semana, para el rango de fechas): no hay una fila real
  // en mercadona_semanas para esta semana de produccion, y el resto de campos
  // de MercadonaSemanaConMetodos nunca se leen desde ese componente.
  const activeSemana: MercadonaSemanaConMetodos = {
    id: `produccion-${efectiva.anio}-${efectiva.semana}`,
    user_id: "",
    anio: efectiva.anio,
    semana: efectiva.semana,
    rango_planificacion: null,
    planificado_quincena_kg: null,
    planificado_semana_kg: null,
    vendido_kg: null,
    diferencia_pct: null,
    notas: [],
    created_at: "",
    updated_at: "",
    metodos: [],
  };

  const navigate = (direction: -1 | 1) => {
    setSeleccionada(shiftSemanaMercadona(efectiva.anio, efectiva.semana, direction));
  };

  const cargandoResumen = isDefaultLoading || mercadona.isLoading;
  const sinProduccion = !cargandoResumen && mercadona.kg_total === 0;

  return (
    <div className="page-shell">
      <header className="page-header">
        <div>
          {/* Kicker-enlace de vuelta al panel de producción, con el acento de
              la sección (--seccion-acento-texto, FASE 2 del rediseño). */}
          <p className="panel-kicker">
            <Link to="/produccion" className="text-seccion-texto transition-colors hover:underline">
              Producción
            </Link>
          </p>
          <h1 className="page-title">Mercadona · Producción</h1>
          <p className="page-subtitle">
            Qué productores, lotes, días y formatos rinden mejor para Mercadona en planta.
          </p>
        </div>
      </header>

      <Tabs value={tab} onValueChange={(v) => setTab(v as "lotes" | "productores")} className="space-y-4">
        <TabsList className="w-full flex-wrap sm:w-auto">
          <TabsTrigger value="lotes">Lotes y semana</TabsTrigger>
          <TabsTrigger value="productores">Aprovechamiento por productor</TabsTrigger>
        </TabsList>

        <TabsContent value="lotes" className="space-y-4">
          <div className="flex items-center gap-3 rounded-xl glass-accented p-3">
            {/* Semana Mercadona (lunes-sábado, numeración propia): NO es la
                semana ISO estándar de SelectorPeriodo, así que aquí solo se
                reutiliza el cromado de flechas — la fecha/etiqueta siguen
                calculándose con la lógica propia (shiftSemanaMercadona). */}
            <PeriodoFlechas onPrev={() => navigate(-1)} onNext={() => navigate(1)} />
            <div>
              <p className="text-sm font-semibold">Semana {efectiva.semana} · {efectiva.anio}</p>
              <p className="text-xs text-muted-foreground">{rangoLabel}</p>
            </div>
          </div>

          {sinProduccion ? (
            <Card className="glass-accented">
              <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
                <PackageSearch className="h-10 w-10 text-muted-foreground/50" />
                <div>
                  <h2 className="text-lg font-semibold">Sin producción registrada esta semana</h2>
                  <p className="mt-1 max-w-md text-sm text-muted-foreground">
                    No hay partes diarios entre el {rangoLabel}. Prueba con la semana anterior o espera a que se suba el parte del día.
                  </p>
                </div>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              <section className="grid grid-cols-2 gap-3 xl:grid-cols-5">
                <KPICard
                  className="glass-accented"
                  label="Aprovechamiento real"
                  value={
                    aprovechamiento.isLoading
                      ? "…"
                      : aprovechamiento.realPct != null
                        ? formatPct(aprovechamiento.realPct)
                        : "—"
                  }
                  accent={aprovechamiento.realPct != null ? "success" : "primary"}
                  labelInfo="Kg vendidos según el informe semanal de ventas de Mercadona entre los kg de entrada al calibrador de la misma semana (L–S). Es la cifra exacta y contractual; solo existe cuando la semana tiene informe importado en Comercial."
                  hint={
                    aprovechamiento.isLoading
                      ? undefined
                      : aprovechamiento.vendidoKg != null
                        ? `${formatKg(aprovechamiento.vendidoKg)} vendidos · informe semanal`
                        : "Aún sin informe semanal de ventas"
                  }
                  icon={BadgeCheck}
                />
                <KPICard
                  className="glass-accented"
                  label="Estimado en curso"
                  value={aprovechamiento.isLoading ? "…" : formatPct(aprovechamiento.estimadoPct)}
                  labelInfo="Estimación diaria mientras no llega el informe: palets dados de alta a Mercadona más los palets sin cliente con perfil Mercadona (menos de 500 kg/palet, sin categoría II, precalibrado ni CITRICAS), sobre los kg del calibrador. Error histórico del ±3% frente al vendido real."
                  hint={
                    aprovechamiento.isLoading
                      ? undefined
                      : aprovechamiento.fiabilidadPct != null
                        ? `${formatKg(aprovechamiento.estimadoKg)} · ${formatPct(aprovechamiento.fiabilidadPct, 1)} del vendido real`
                        : `${formatKg(aprovechamiento.estimadoKg)} en palets Mercadona`
                  }
                  icon={Timer}
                />
                <KPICard
                  className="glass-accented"
                  label="Confección MDNA"
                  value={cargandoResumen ? "…" : formatPct(mercadona.pct_kg)}
                  labelInfo="Kg confeccionados en formatos MDNA sobre el total confeccionado de la semana. Mide confección en fábrica, NO venta: parte se queda en cámara, se reprocesa o va a otro destino, así que suele quedar ~15% por encima del vendido real."
                  hint="Kg confeccionados MDNA sobre el total de la semana"
                  icon={Percent}
                />
                <KPICard
                  className="glass-accented"
                  label="Kg MDNA"
                  value={cargandoResumen ? "…" : formatKg(mercadona.kg_mercadona)}
                  hint={cargandoResumen ? undefined : `de ${formatKg(mercadona.kg_total)} confeccionados`}
                  icon={Scale}
                />
                <KPICard
                  className="glass-accented col-span-2 xl:col-span-1"
                  label="Cajas MDNA"
                  value={cargandoResumen ? "…" : String(mercadona.n_cajas_mercadona)}
                  hint="Cajas confeccionadas de formatos Mercadona"
                  icon={PackageSearch}
                />
              </section>

              <Card className="glass-accented overflow-hidden">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Categorías/formatos para Mercadona</CardTitle>
                  <p className="text-xs text-muted-foreground">Kg y % sobre el total MDNA de la semana, por formato (3 kg, 4 kg, 5 kg, granel…).</p>
                </CardHeader>
                <CardContent>
                  {cargandoResumen ? (
                    <div className="space-y-2">
                      <Skeleton className="h-10 w-full" />
                      <Skeleton className="h-10 w-full" />
                      <Skeleton className="h-10 w-full" />
                    </div>
                  ) : mercadona.por_formato.length === 0 ? (
                    <p className="py-6 text-center text-sm text-muted-foreground">Sin formatos MDNA esta semana.</p>
                  ) : (
                    <ul className="space-y-2">
                      {mercadona.por_formato.map((f) => (
                        <li key={f.formato} className="flex items-center justify-between rounded-lg border border-[var(--glass-border)] bg-[var(--glass-bg)] px-3 py-2 text-xs">
                          <span className="font-medium">{f.formato}</span>
                          <span className="tabular-nums text-muted-foreground">
                            {formatKg(f.kg)} · <span className="font-semibold text-foreground">{formatPct(f.pct)}</span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>

              <MercadonaLotes activeSemana={activeSemana} />
            </div>
          )}
        </TabsContent>

        <TabsContent value="productores" className="space-y-4">
          <MercadonaProductoresRanking />
        </TabsContent>
      </Tabs>
    </div>
  );
}

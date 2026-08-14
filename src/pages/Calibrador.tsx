// src/pages/Calibrador.tsx
// Sección "Producción → Calibrador": cuánto aprovecha la fruta de cada
// productor, según el propio Compac Sizer.
//
// La pregunta que responde: de todo lo que entró de un productor, ¿qué
// porcentaje acabó en EXPORTACIÓN y qué se fue a industria o a mujeres? Es el
// dato que decide si un productor compensa, y hasta hoy no existía en ninguna
// pantalla: el informe del calibrador llegaba en un Word por correo y solo
// cubría la última pasada de cada lote.
//
// De dónde salen los números: del volcado SQL del Sizer (864 lotes de la
// campaña, 1.309 pasadas). La agregación la hace la RPC
// calibrador_aprovechamiento_productor — ver useCalibradorAprovechamiento.ts
// para las dos reglas que importan (solo pasadas completas, y productor por
// código de lote y no por nombre).
//
// Ordenado por kilos descendente: primero los productores que mueven volumen,
// que son los que cambian la campaña. El % de exportación se colorea para que
// el que se queda corto salte a la vista sin tener que leer la columna.
import { useMemo } from "react";
import { Link } from "react-router-dom";
import { Cog, Sprout, TrendingUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { KPICard } from "@/components/KPICard";
import { useCalibradorAprovechamiento, type AprovechamientoProductor } from "@/hooks/useCalibradorAprovechamiento";
import { formatKg, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Verde por encima de la media, ámbar cerca, rojo claramente por debajo. */
function colorPct(pct: number | null, media: number): string {
  if (pct == null) return "text-muted-foreground";
  if (pct >= media + 3) return "text-emerald-600 dark:text-emerald-400";
  if (pct >= media - 3) return "text-foreground";
  return "text-amber-600 dark:text-amber-400";
}

function BarraDestino({ fila }: { fila: AprovechamientoProductor }) {
  const total = fila.kg_total || 1;
  const tramos = [
    { kg: fila.kg_exportacion, clase: "bg-emerald-500", nombre: "Exportación" },
    { kg: fila.kg_no_exportacion, clase: "bg-sky-500", nombre: "No exportación" },
    { kg: fila.kg_mujeres, clase: "bg-violet-500", nombre: "Mujeres" },
    { kg: fila.kg_industria, clase: "bg-amber-500", nombre: "Industria / no comercial" },
    { kg: fila.kg_otros, clase: "bg-muted-foreground/40", nombre: "Otros" },
  ].filter((t) => t.kg > 0);

  return (
    <div
      className="flex h-2 w-full overflow-hidden rounded-full bg-muted"
      title={tramos.map((t) => `${t.nombre}: ${formatKg(t.kg)}`).join(" · ")}
    >
      {tramos.map((t) => (
        <div key={t.nombre} className={t.clase} style={{ width: `${(t.kg / total) * 100}%` }} />
      ))}
    </div>
  );
}

export default function Calibrador() {
  const {
    productores, sinAtribuir, desgloseSinRepartir, noProductores,
    pasadasRepartidas, colaDesglose, kgProvisional, isLoading, error,
  } = useCalibradorAprovechamiento();

  // La cola, agrupada por el porqué: es lo accionable. Un listado de 111 nombres
  // sueltos no se lee; "77 esperan que se escriban los box" sí.
  const motivosCola = useMemo(() => {
    const mapa = new Map<string, { n: number; kg: number }>();
    for (const c of colaDesglose) {
      // "3 linea(s) sin box" y "1 linea(s) sin box" son el mismo problema.
      const clave = c.motivo.replace(/^\d+ /, "");
      const a = mapa.get(clave) ?? { n: 0, kg: 0 };
      a.n += 1;
      a.kg += c.kg_total;
      mapa.set(clave, a);
    }
    return [...mapa.entries()].map(([motivo, a]) => ({ motivo, ...a }))
      .sort((x, y) => y.kg - x.kg);
  }, [colaDesglose]);

  const totales = useMemo(() => {
    const suma = (f: (p: AprovechamientoProductor) => number) =>
      productores.reduce((s, p) => s + f(p), 0);
    const kg = suma((p) => p.kg_total);
    return {
      kg,
      lotes: suma((p) => p.lotes),
      exportacion: suma((p) => p.kg_exportacion),
      industria: suma((p) => p.kg_industria),
      pctExportacion: kg > 0 ? (suma((p) => p.kg_exportacion) / kg) * 100 : 0,
      // Lo que la máquina clasificó de verdad, atribuible o no. Se enseña junto
      // a lo atribuido para que la diferencia no parezca fruta que falta.
      kgClasificados: kg + (sinAtribuir?.kg_total ?? 0)
        + noProductores.reduce((s, p) => s + p.kg_total, 0),
    };
  }, [productores, sinAtribuir, noProductores]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <Cog className="h-6 w-6 text-muted-foreground" /> Calibrador
        </h1>
        <p className="text-sm text-muted-foreground">
          Aprovechamiento de la fruta por productor, según la clasificación del Compac Sizer.
        </p>
      </div>

      {error ? (
        <Card className="glass-accented border-destructive/30">
          <CardContent className="py-6 text-sm text-destructive">
            No se pudieron cargar los datos del calibrador: {String(error)}
          </CardContent>
        </Card>
      ) : isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : productores.length === 0 ? (
        <Card className="glass-accented">
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            Todavía no hay datos del calibrador. Se cargan con el export del Sizer
            (ver <span className="font-mono text-xs">scripts/README-receptor-calibrador.md</span>).
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KPICard
              label="Kg atribuidos"
              value={formatKg(totales.kg)}
              hint={sinAtribuir
                ? `de ${formatKg(totales.kgClasificados)} clasificados · ${productores.length} productores`
                : `${totales.lotes} lotes · ${productores.length} productores`}
              icon={Cog}
            />
            <KPICard
              label="A exportación"
              value={formatKg(totales.exportacion)}
              hint={`${formatNumber(totales.pctExportacion, 1)}% del total`}
              icon={TrendingUp}
              accent="success"
            />
            <KPICard
              label="A industria"
              value={formatKg(totales.industria)}
              hint={`${formatNumber(totales.kg > 0 ? (totales.industria / totales.kg) * 100 : 0, 1)}% del total`}
              icon={Sprout}
              accent="warning"
            />
            <KPICard
              label="Media de exportación"
              value={`${formatNumber(totales.pctExportacion, 1)}%`}
              hint="referencia para comparar productores"
              icon={TrendingUp}
            />
          </div>

          <Card className="glass-accented overflow-hidden">
            <CardHeader>
              <p className="panel-kicker">Detalle</p>
              <CardTitle className="flex items-center gap-1.5">
                <Sprout className="h-4 w-4 text-muted-foreground" /> Por productor
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="max-h-[600px] overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Productor</TableHead>
                      <TableHead className="text-right">Lotes</TableHead>
                      <TableHead className="text-right">Kg</TableHead>
                      <TableHead className="w-[22%]">Destino</TableHead>
                      <TableHead className="text-right">Exportación</TableHead>
                      <TableHead className="text-right">Industria</TableHead>
                      <TableHead className="text-right">% export.</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {productores.map((p) => (
                      <TableRow key={p.productor_id ?? p.productor}>
                        <TableCell className="max-w-[240px] truncate font-medium" title={p.productor}>
                          {p.productor_id ? (
                            <Link
                              to={`/productores?productor=${encodeURIComponent(p.productor)}`}
                              className="underline-offset-2 hover:underline"
                            >
                              {p.productor}
                            </Link>
                          ) : (
                            <span className="text-muted-foreground">{p.productor}</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{p.lotes}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatKg(p.kg_total)}</TableCell>
                        <TableCell><BarraDestino fila={p} /></TableCell>
                        <TableCell className="text-right tabular-nums">{formatKg(p.kg_exportacion)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatKg(p.kg_industria)}</TableCell>
                        <TableCell
                          className={cn("text-right font-semibold tabular-nums", colorPct(p.pct_exportacion, totales.pctExportacion))}
                        >
                          {p.pct_exportacion == null ? "—" : `${formatNumber(p.pct_exportacion, 1)}%`}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          {sinAtribuir || desgloseSinRepartir || noProductores.length > 0 || kgProvisional > 0 ? (
            <Card className="glass-accented border-amber-500/30">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Hasta dónde llega esta atribución</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 pb-4 text-sm text-muted-foreground">
                {kgProvisional > 0 ? (
                  <p>
                    <span className="font-semibold tabular-nums text-foreground">{formatKg(kgProvisional)}</span>{" "}
                    ({formatNumber((kgProvisional / totales.kgClasificados) * 100, 1)}%){" "}
                    <strong>provisionales</strong>: salen de los informes de lote del calibrador, no del
                    volcado completo de la máquina. Un lote que pasa dos veces el mismo día solo enseña
                    la última pasada en su informe, así que estos kilos pueden quedarse cortos —
                    nunca sobrar. Se corrigen solos en cuanto se vuelque el SQL del Sizer.
                  </p>
                ) : null}
                {noProductores.map((p) => (
                  <p key={p.productor}>
                    <span className="font-semibold tabular-nums text-foreground">{formatKg(p.kg_total)}</span>{" "}
                    ({formatNumber((p.kg_total / totales.kgClasificados) * 100, 1)}%) en{" "}
                    <strong>{p.productor}</strong>. No es una finca: es fruta de la casa volviendo a
                    pasar por línea, de la que el ERP no guarda de dónde salió. Lo que sí se sabe ya
                    está devuelto a su productor.
                  </p>
                ))}
                {sinAtribuir ? (
                  <p>
                    <span className="font-semibold tabular-nums text-foreground">{formatKg(sinAtribuir.kg_total)}</span>{" "}
                    ({formatNumber((sinAtribuir.kg_total / totales.kgClasificados) * 100, 1)}%) <strong>sin productor</strong>:
                    pasadas cuyo nombre en la máquina no lleva ningún código de lote
                    (por ejemplo «22/07 22 BOX - 23/07 43 BOX»). Los kilos son reales y cuentan para
                    la producción del día, pero no hay a quién atribuirlos.
                  </p>
                ) : null}
                {desgloseSinRepartir ? (
                  <p>
                    <span className="font-semibold tabular-nums text-foreground">{formatKg(desgloseSinRepartir.kg)}</span>{" "}
                    ({formatNumber((desgloseSinRepartir.kg / totales.kgClasificados) * 100, 1)}%) en{" "}
                    {desgloseSinRepartir.pasadas} pasadas donde el operario escribió que se echó algo más
                    («26051904 +7 BOX DE RECICLAJE»), y {desgloseSinRepartir.pasadas_varios_lotes} nombran
                    dos lotes distintos.{" "}
                    {pasadasRepartidas > 0
                      ? <>De esas, <strong>{pasadasRepartidas} ya se reparten solas</strong> por los box que escribió el operario.</>
                      : null}
                  </p>
                ) : null}

                {motivosCola.length > 0 ? (
                  <div className="space-y-1 pt-1">
                    <p className="text-foreground">
                      Quedan {colaDesglose.length} pasadas esperando que alguien diga algo. No se reparten
                      solas a propósito: hacerlo sería inventarse el dato.
                    </p>
                    <ul className="space-y-0.5">
                      {motivosCola.map((m) => (
                        <li key={m.motivo} className="flex flex-wrap gap-x-2">
                          <span className="tabular-nums font-medium text-foreground">{m.n}</span>
                          <span className="tabular-nums">({formatKg(m.kg)})</span>
                          <span>{m.motivo}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ) : null}

          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Badge variant="outline" className="text-[10px] font-normal">según el calibrador</Badge>
            <p>
              Son los kilos que la máquina clasificó, incluidas todas las pasadas de cada lote — no los kilos
              vendidos. El productor se resuelve por el código de lote contra las entradas de báscula, nunca por
              el nombre. El color del porcentaje compara cada productor con la media de la campaña.
            </p>
          </div>
        </>
      )}
    </div>
  );
}

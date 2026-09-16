// Campo → Previsión de campaña (16-09-2026).
//
// LA PREGUNTA: ¿cuántos kilos van a entrar y en qué semana?
//
// Es lo que hace falta para decidir cuánta gente se contrata, cuánta cámara se
// reserva y qué se le puede prometer a Mercadona, y hasta hoy se decidía de
// memoria. Los números los hace src/lib/previsionCampana.ts; aquí solo se
// pintan, con las dos cosas que no se pueden callar: de dónde sale el
// calendario de cada parcela y qué confianza merece todo esto.
//
// LA REGLA QUE MANDA EN ESTA PÁGINA. Los kilos son los de la campaña pasada,
// no una estimación de nadie: si una parcela dio 300 t, se prevén 300 t. Solo
// hay UNA campaña de historia y el cítrico vecea (a un año cargado le sigue
// uno flojo), así que esto es un orden de magnitud para planificar. La página
// lo dice arriba, con esas palabras, y no con letra pequeña.
import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CalendarRange, Search, TrendingUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useCampoCalibre, useCampoParcelas } from "@/hooks/useCampoParcelas";
import { useEntradasBascula } from "@/hooks/useEntradasBascula";
import {
  etiquetaSemanaCorta, fechaDeSemana, preverCampana, semanaDeHoy,
  type PrevisionParcela,
} from "@/lib/previsionCampana";
import { C, GlassTooltip, GRID, MARGIN, XAXIS, YAXIS } from "@/lib/chartTheme";
import { formatDate, formatKg, formatNumber, normalizarTexto } from "@/lib/format";
import { cn } from "@/lib/utils";

const kgTxt = (v: number | null | undefined) => (v == null ? "—" : formatKg(v));

export default function CampoPrevision() {
  const { entradas, isLoading: cargandoEntradas } = useEntradasBascula();
  const { fichas, isLoading: cargandoFichas } = useCampoParcelas();
  const { curvas, isLoading: cargandoCurvas } = useCampoCalibre();
  const [params, setParams] = useSearchParams();
  const busqueda = params.get("q") ?? "";

  const prevision = useMemo(
    () => preverCampana({ entradas, fichas, curvas }),
    [entradas, fichas, curvas],
  );

  const visibles = useMemo(() => {
    const palabras = normalizarTexto(busqueda).split(/\s+/).filter(Boolean);
    if (palabras.length === 0) return prevision.parcelas;
    return prevision.parcelas.filter((p) => {
      const heno = normalizarTexto([p.finca, p.etiqueta, p.agricultor, p.variedad].join(" "));
      return palabras.every((x) => heno.includes(x));
    });
  }, [prevision.parcelas, busqueda]);

  const semanaHoy = semanaDeHoy();
  const datosGrafica = useMemo(
    () => prevision.porSemana.map((s) => ({
      ...s,
      etiqueta: etiquetaSemanaCorta(s.semana),
      esPasada: s.semana <= semanaHoy,
    })),
    [prevision.porSemana, semanaHoy],
  );

  const cargando = cargandoEntradas || cargandoFichas || cargandoCurvas;
  const { totales } = prevision;
  const pctConVentana = totales.kgPrevisto > 0 ? (totales.kgConVentana / totales.kgPrevisto) * 100 : 0;

  return (
    <div className="mx-auto w-full max-w-6xl space-y-4 p-3 sm:p-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <TrendingUp className="h-6 w-6" /> Previsión de campaña {prevision.campanaObjetivo}
        </h1>
        <p className="text-sm text-muted-foreground">
          Cuántos kilos entran y en qué semana. Es lo que entregó cada parcela en la campaña{" "}
          {prevision.campanaBase}, colocado en las mismas semanas un año después.
        </p>
      </div>

      {cargando ? (
        <Skeleton className="h-64 w-full" />
      ) : totales.parcelas === 0 ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            No hay entradas de la campaña {prevision.campanaBase} de las que copiar, así que no hay nada que
            prever todavía.
          </CardContent>
        </Card>
      ) : (
        <>
          <Card className="border-dashed">
            <CardContent className="space-y-2 p-4 text-sm text-muted-foreground">
              <p>
                <span className="font-medium text-foreground">
                  Se esperan {formatKg(totales.kgPrevisto)} de {formatNumber(totales.parcelas)} parcelas.
                </span>{" "}
                Cada parcela va en las semanas en que entró el año pasado: la ventana de Aerobotics dice cuándo
                la fruta está LISTA, pero la historia dice cuándo la cogemos nosotros, que es lo que hay que
                planificar.
                {totales.conVentana > 0 && (
                  <>
                    {" "}{formatNumber(totales.conVentana)} parcelas ({formatNumber(pctConVentana)} % de los kilos)
                    tienen ventana de Aerobotics con la que contrastar
                    {totales.fueraDeVentana > 0
                      ? `, y ${formatNumber(totales.fueraDeVentana)} se recogieron fuera de ella.`
                      : ", y todas se recogieron dentro."}
                  </>
                )}
              </p>
              <p>
                <span className="font-medium text-amber-700 dark:text-amber-400">Esto es un orden de magnitud, no una promesa.</span>{" "}
                Solo hay una campaña de historia por parcela y el cítrico vecea: a un año cargado le sigue uno
                flojo. Sirve para saber qué semanas vienen cargadas, no para comprometer kilos exactos.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Kilos por semana</CardTitle>
              <p className="text-xs text-muted-foreground">
                En azul lo previsto; en verde lo que ya ha entrado de verdad.
                {totales.kgEntrado > 0 && ` Van ${formatKg(totales.kgEntrado)} entrados.`}
              </p>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={datosGrafica} margin={MARGIN}>
                  <CartesianGrid {...GRID} />
                  <XAxis dataKey="etiqueta" {...XAXIS} interval="preserveStartEnd" />
                  <YAxis {...YAXIS} width={64} tickFormatter={(v) => `${Math.round(Number(v) / 1000)} t`} />
                  <Tooltip content={<GlassTooltip formatter={(v) => formatKg(Number(v))} />} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="previsto" name="Previsto" fill={C.primary} fillOpacity={0.55} radius={[3, 3, 0, 0]} />
                  <Bar dataKey="entrado" name="Entrado" fill={C.success} fillOpacity={0.85} radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={busqueda}
              onChange={(e) => setParams((prev) => {
                const next = new URLSearchParams(prev);
                if (e.target.value) next.set("q", e.target.value); else next.delete("q");
                return next;
              }, { replace: true })}
              placeholder="Buscar por finca, parcela, agricultor o variedad…"
              className="pl-9"
            />
          </div>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Parcela a parcela</CardTitle>
            </CardHeader>
            <CardContent className="px-0 sm:px-6">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Finca</TableHead>
                      <TableHead>Parcela</TableHead>
                      <TableHead>Variedad</TableHead>
                      <TableHead className="text-right whitespace-nowrap">Kg previstos</TableHead>
                      <TableHead className="whitespace-nowrap">Cuándo</TableHead>
                      <TableHead>Contra la ventana de Aerobotics</TableHead>
                      <TableHead className="text-right whitespace-nowrap">Ya entrado</TableHead>
                      <TableHead className="text-right whitespace-nowrap">Pendiente</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visibles.map((p) => <FilaParcela key={p.clave} p={p} />)}
                    {visibles.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={8} className="py-8 text-center text-sm text-muted-foreground">
                          Ninguna parcela cuadra con «{busqueda}».
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

/**
 * Lo que dice Aerobotics sobre CUÁNDO se recogió esta parcela. No cambia la
 * previsión: la contrasta. Un "se cogió 3 semanas antes" es una conversación
 * que tener con el agricultor, no un error del cálculo.
 */
function AvisoDeVentana({ p }: { p: PrevisionParcela }) {
  if (!p.ventana || !p.avisoVentana) {
    return <span className="text-xs text-muted-foreground">Sin ventana</span>;
  }
  const rango = `${etiquetaSemanaCorta(p.ventana.desde)} – ${etiquetaSemanaCorta(p.ventana.hasta)}`;
  if (p.avisoVentana === "cuadra") {
    return (
      <Badge variant="outline" className="whitespace-nowrap border-transparent bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200">
        <CalendarRange className="mr-1 h-3 w-3" /> Cuadra ({rango})
      </Badge>
    );
  }
  const semanas = p.semanasDeDesfase === 1 ? "1 semana" : `${formatNumber(p.semanasDeDesfase)} semanas`;
  return (
    <span className="whitespace-nowrap text-xs">
      <Badge variant="outline" className="border-transparent bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
        {p.avisoVentana === "antes" ? `Se cogió ${semanas} antes` : `Se acabó ${semanas} después`}
      </Badge>
      <span className="mt-0.5 block text-muted-foreground">Aerobotics: {rango}</span>
    </span>
  );
}

function FilaParcela({ p }: { p: PrevisionParcela }) {
  const primera = p.semanas[0]?.semana ?? null;
  const ultima = p.semanas.at(-1)?.semana ?? null;
  const fecha = primera ? fechaDeSemana(primera) : null;

  return (
    <TableRow>
      <TableCell className="whitespace-nowrap">{p.finca}</TableCell>
      <TableCell className={cn("font-medium", !p.parcela && "italic text-muted-foreground")}>{p.etiqueta}</TableCell>
      <TableCell className="whitespace-nowrap text-muted-foreground">{p.variedad || "—"}</TableCell>
      <TableCell className="text-right font-medium">{kgTxt(p.kgBase)}</TableCell>
      <TableCell className="whitespace-nowrap">
        {primera && ultima
          ? (primera === ultima ? etiquetaSemanaCorta(primera) : `${etiquetaSemanaCorta(primera)} – ${etiquetaSemanaCorta(ultima)}`)
          : "—"}
        {fecha && <span className="block text-xs text-muted-foreground">desde el {formatDate(fecha)}</span>}
      </TableCell>
      <TableCell><AvisoDeVentana p={p} /></TableCell>
      <TableCell className="text-right">{p.kgEntrado > 0 ? kgTxt(p.kgEntrado) : "—"}</TableCell>
      <TableCell className="text-right">{p.kgEntrado > 0 ? kgTxt(p.kgPendiente) : "—"}</TableCell>
    </TableRow>
  );
}

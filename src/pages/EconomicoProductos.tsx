// src/pages/EconomicoProductos.tsx
// Sección "Económico → Coste por producto" (encargo del dueño, 07-08-2026):
// el CMV de cada producto y si en ese periodo se gana o se pierde dinero con él.
//
//   CMV €/kg = fruta + material + tratamiento     Margen = (precio − CMV) × kg
//
// Trabaja por SEMANA o por DÍA (el dueño arranca por la semana del 27-jul al
// 2-ago de 2026 y baja a día cuando algo llama la atención). Un día es el
// rango [d, d]: un único camino de cálculo para las dos vistas.
//
// La tabla va ordenada de lo que MÁS PIERDE a lo que más gana: la pregunta
// que responde la página es "¿qué me está hundiendo el periodo?".
//
// El cálculo vive en src/lib/cmvProducto.ts (puro, con tests) y los datos en
// src/hooks/useCmvProducto.ts. Nada de números mágicos: cada producto enseña
// de dónde sale su precio y qué componentes le faltan al CMV — un producto con
// el coste de material sin cargar sale marcado, NUNCA con material 0 €.
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, Banknote, Package, Pencil, Scale, TrendingDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { KPICard } from "@/components/KPICard";
import { SelectorPeriodo } from "@/components/SelectorPeriodo";
import { EconomicoSubnav } from "@/components/economico/EconomicoSubnav";
import { toast } from "@/hooks/use-toast";
import { useUltimaFechaConInformes } from "@/hooks/useRentabilidadDia";
import { useCmvProductoRango, OPCIONES_DEFECTO } from "@/hooks/useCmvProducto";
import {
  useProductosCatalogo,
  type FichaProductoPatch,
  type ProductoCatalogoRow,
} from "@/hooks/useProductosCatalogo";
import type { CmvProductoDia, FaltanteCmv } from "@/lib/cmvProducto";
import { CMV_TIPO_LABEL, type CmvTipoCosteManual } from "@/lib/cmv";
import { errorMessage } from "@/lib/errorMessage";
import { formatEuro, formatEurKg, formatKg, formatNumber, today } from "@/lib/format";
import { periodoDeFecha, type PeriodoValue } from "@/lib/selectorPeriodo";
import { cn } from "@/lib/utils";

const FALTANTE_LABEL: Record<FaltanteCmv, string> = {
  fruta: "fruta sin liquidar",
  material: "sin coste de material",
  indice: "sin índice",
  precio: "sin precio",
};

function signo(eur: number | null): string {
  if (eur == null) return "text-muted-foreground";
  return eur >= 0 ? "text-success" : "text-destructive";
}

/** Número tecleado → number | null. Vacío es null (sin dato), no 0. */
function aNumeroONull(value: string): number | null {
  const limpio = value.trim().replace(",", ".");
  if (!limpio) return null;
  const n = Number(limpio);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export default function EconomicoProductos() {
  const ultimaFecha = useUltimaFechaConInformes();
  // Arranca en la SEMANA del último día con informes (el dueño trabaja por
  // semanas y baja a día cuando algo llama la atención). Hasta que la última
  // fecha carga no hay periodo: la consulta queda deshabilitada sola.
  const [periodoSel, setPeriodoSel] = useState<PeriodoValue | null>(null);
  const periodo = useMemo<PeriodoValue | null>(() => {
    if (periodoSel) return periodoSel;
    if (!ultimaFecha.data) return null;
    return periodoDeFecha("semana", ultimaFecha.data);
  }, [periodoSel, ultimaFecha.data]);

  const [horasJornada, setHorasJornada] = useState(OPCIONES_DEFECTO.horasJornada);
  const [costeHoraMedio, setCosteHoraMedio] = useState(OPCIONES_DEFECTO.costeHoraMedio);
  const [pctSS, setPctSS] = useState(OPCIONES_DEFECTO.pctSeguridadSocial * 100);
  const [suministrosDia, setSuministrosDia] = useState(OPCIONES_DEFECTO.suministrosDiaEur);
  const [soloProblemas, setSoloProblemas] = useState(false);

  const opciones = useMemo(
    () => ({
      horasJornada,
      costeHoraMedio,
      pctSeguridadSocial: pctSS / 100,
      suministrosDiaEur: suministrosDia,
    }),
    [horasJornada, costeHoraMedio, pctSS, suministrosDia],
  );

  const dia = useCmvProductoRango(periodo?.desde ?? null, periodo?.hasta ?? null, opciones);
  const catalogo = useProductosCatalogo();
  const [editando, setEditando] = useState<CmvProductoDia | null>(null);

  const resultado = dia.resultado;

  const enPerdida = useMemo(
    () => (resultado?.productos ?? []).filter((p) => p.margenEur != null && p.margenEur < 0),
    [resultado],
  );

  /** Métodos de venta realmente aplicados en el periodo, con su €/kg y sus kg. */
  const preciosUsados = useMemo(() => {
    const acc = new Map<string, { eurKg: number; kg: number }>();
    for (const p of resultado?.productos ?? []) {
      if (!p.metodoVenta || p.precioFuente !== "metodo" || p.precioEurKg == null) continue;
      const prev = acc.get(p.metodoVenta);
      acc.set(p.metodoVenta, { eurKg: p.precioEurKg, kg: (prev?.kg ?? 0) + p.kg });
    }
    return [...acc.entries()]
      .map(([metodo, v]) => ({ metodo, ...v }))
      .sort((a, b) => b.kg - a.kg);
  }, [resultado]);

  const visibles = useMemo(() => {
    const lista = resultado?.productos ?? [];
    if (!soloProblemas) return lista;
    return lista.filter((p) => !p.completo || (p.margenEur != null && p.margenEur < 0));
  }, [resultado, soloProblemas]);

  const avisos = useMemo(() => {
    const lista: string[] = [];
    if (!resultado) return lista;
    const { diasConProduccion, diasConAsistencia, presentesSinCoste } = dia.tratamiento;
    if (diasConAsistencia === 0) {
      lista.push("Ningún día de este periodo tiene la asistencia marcada: el coste de tratamiento solo lleva suministros y el margen está inflado. Márcala en Costes → Asistencia.");
    } else if (diasConAsistencia < diasConProduccion) {
      lista.push(`${diasConProduccion - diasConAsistencia} día(s) con producción pero SIN asistencia marcada: su personal no está imputado y el margen de esos kg sale mejor de lo que es.`);
    }
    if (presentesSinCoste > 0) {
      lista.push(`${presentesSinCoste} presencia(s) de personas sin coste/hora en su ficha: se les aplica la media (${formatNumber(costeHoraMedio, 2)} €/h). Complétalo en RRHH → Personas.`);
    }
    if (dia.lotesSinEntrada.length > 0) {
      lista.push(`${dia.lotesSinEntrada.length} lote(s) del periodo sin entrada de báscula con su código: su fruta no está imputada a ningún producto.`);
    }
    // Dos avisos MUY distintos, y confundirlos hace leer un día al revés: el
    // precalibrado no es un dato que falte, es fruta ya pagada otro día.
    if (resultado.kgLoteSinLiquidar > 0) {
      lista.push(`${formatKg(resultado.kgLoteSinLiquidar)} de lotes con la fruta SIN liquidar en báscula: a esos productos les falta su coste de fruta y su CMV sale más bajo del real.`);
    }
    if (resultado.kgPrecalibrado > 0) {
      const pct = (resultado.kgPrecalibrado / resultado.kgTotal) * 100;
      lista.push(
        `${formatKg(resultado.kgPrecalibrado)} (${formatNumber(pct, 0)} %) vienen de pasadas sin código de lote: es PRECALIBRADO, fruta apartada otros días que ya pagó su coste entonces. No falta ningún dato, pero este periodo cobra su venta sin volver a pagar la fruta, así que su margen sale mejor de lo que le corresponde` +
        (pct > 40 ? " — con esta proporción, el periodo NO es comparable con uno normal." : "."),
      );
    }
    if (resultado.kgSinMaterial > 0) {
      lista.push(`${formatKg(resultado.kgSinMaterial)} en productos sin coste de material cargado en su ficha. No se les imputa 0 €: se quedan sin CMV hasta que lo rellenes.`);
    }
    if (resultado.kgSinPrecio > 0) {
      lista.push(`${formatKg(resultado.kgSinPrecio)} en productos sin precio de venta: no tienen margen calculable. Ponles el método de venta (precio real facturado) o un precio manual en su ficha.`);
    }
    if (resultado.kgSinIndice > 0) {
      lista.push(`${formatKg(resultado.kgSinIndice)} en productos sin índice de confección: NO están absorbiendo el coste de tratamiento que les toca, así que el resto lo está pagando por ellos.`);
    }
    if (resultado.tratamientoSinRepartirEur > 0) {
      lista.push(`${formatEuro(resultado.tratamientoSinRepartirEur, 0)} de tratamiento sin repartir: ningún producto del día tiene índice de confección.`);
    }
    if (dia.productosSinFicha.length > 0) {
      lista.push(`${dia.productosSinFicha.length} producto(s) del día sin ficha en el catálogo: ${dia.productosSinFicha.slice(0, 3).join(", ")}${dia.productosSinFicha.length > 3 ? "…" : ""}. Créalas desde la tabla.`);
    }
    if (resultado.sinEstructura) {
      lista.push("No hay ningún apunte de estructura ni de transporte de salida para este periodo: el margen que ves está ANTES de alquiler, seguros, amortización, gestoría y financieros. Cárgalos en Económico → CMV como apunte mensual y se prorratean solos.");
    } else if (dia.estructura.mesesSinApuntes.length > 0) {
      lista.push(`Sin apuntes de estructura en ${dia.estructura.mesesSinApuntes.join(", ")}: la parte del periodo que cae en esos meses va sin estructura.`);
    }
    if (dia.sinEmpaqueConocido) {
      lista.push("Hay productos sin empaque conocido: el Informe PRODUCTO solo cubre desde el 21-05-2026, así que sus kg por bulto hay que teclearlos en la ficha.");
    }
    return lista;
  }, [resultado, dia.tratamiento, dia.lotesSinEntrada, dia.productosSinFicha, dia.sinEmpaqueConocido, costeHoraMedio]);

  const sinDatos = !!periodo && !dia.isLoading && (resultado?.kgTotal ?? 0) === 0;

  if (dia.sinPermiso) {
    return (
      <div className="page-shell">
        <header className="page-header">
          <div>
            <p className="panel-kicker">Económico</p>
            <h1 className="page-title">Coste por producto</h1>
          </div>
        </header>
        <EconomicoSubnav />
        <Card className="glass-accented">
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            Los costes por producto son información económica reservada a administración.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="page-shell">
      <header className="page-header">
        <div>
          <p className="panel-kicker flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-seccion-texto" aria-hidden="true" />
            Económico
          </p>
          <h1 className="page-title">Coste por producto</h1>
          <p className="page-subtitle">
            CMV de cada producto (fruta + material + tratamiento) contra su precio de venta: qué producto gana y cuál pierde dinero, por semana o por día.
          </p>
        </div>
      </header>
      <EconomicoSubnav />

      <div className="section-toolbar flex flex-wrap items-end gap-3">
        {periodo && (
          <SelectorPeriodo
            value={periodo}
            onChange={setPeriodoSel}
            modos={["dia", "semana", "mes"]}
            canNavigateNext={periodo.hasta < today()}
          />
        )}
        <div className="space-y-1">
          <Label htmlFor="prod-horas" className="text-xs text-muted-foreground">Horas de jornada</Label>
          <Input id="prod-horas" type="number" min={1} max={12} step={0.5} className="w-28"
            value={horasJornada} onChange={(e) => setHorasJornada(Number(e.target.value) || 0)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="prod-media" className="text-xs text-muted-foreground">€/h bruto sin nómina</Label>
          <Input id="prod-media" type="number" min={0} step={0.01} className="w-28"
            value={costeHoraMedio} onChange={(e) => setCosteHoraMedio(Number(e.target.value) || 0)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="prod-ss" className="text-xs text-muted-foreground">Seg. Social %</Label>
          <Input id="prod-ss" type="number" min={0} max={100} step={1} className="w-24"
            value={pctSS} onChange={(e) => setPctSS(Number(e.target.value) || 0)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="prod-sum" className="text-xs text-muted-foreground">Suministros €/día prod.</Label>
          <Input id="prod-sum" type="number" min={0} step={50} className="w-28"
            value={suministrosDia} onChange={(e) => setSuministrosDia(Number(e.target.value) || 0)} />
        </div>
        <Button
          variant={soloProblemas ? "default" : "outline"}
          size="sm"
          onClick={() => setSoloProblemas((v) => !v)}
        >
          Solo pérdidas y huecos
        </Button>
      </div>

      {dia.error != null && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          No se pudieron cargar los datos: {errorMessage(dia.error)}
        </div>
      )}

      {(dia.isLoading || ultimaFecha.isLoading) && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-32 rounded-2xl" />)}
        </div>
      )}

      {sinDatos && (
        <Card className="glass-accented">
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            Este periodo no tiene Informes LOTE del calibrador cargados. Impórtalos y la página se calcula sola.
          </CardContent>
        </Card>
      )}

      {resultado && resultado.kgTotal > 0 && (
        <>
          {avisos.length > 0 && (
            <div className="space-y-1">
              {avisos.map((a, i) => (
                <div key={i} className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  {a}
                </div>
              ))}
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <KPICard
              label={resultado.incompleto ? "Margen del periodo (parcial)" : "Margen del periodo"}
              value={formatEuro(resultado.margenEur, 0)}
              hint={`${formatEuro(resultado.ingresoEur, 0)} − ${formatEuro(resultado.costeEur, 0)} de coste`}
              icon={Banknote}
              accent={resultado.margenEur >= 0 ? "success" : "destructive"}
              valueClassName={signo(resultado.margenEur)}
              labelInfo="Ingresos a precio de venta menos el CMV de todos los productos. PARCIAL si hay productos con componentes sin cargar: esos kg no suman su coste completo."
            />
            <KPICard
              label="Productos en pérdida"
              value={`${enPerdida.length}`}
              hint={enPerdida.length > 0 ? `el peor: ${enPerdida[0].nombre}` : "ninguno pierde dinero"}
              icon={TrendingDown}
              accent={enPerdida.length > 0 ? "destructive" : "success"}
              labelInfo="Productos cuyo precio de venta no cubre su CMV. Los que no tienen CMV calculable no cuentan aquí: no se sabe si pierden."
            />
            <KPICard
              label="Kilos del periodo"
              value={formatKg(resultado.kgTotal)}
              hint={`${resultado.productos.length} productos en ${dia.tratamiento.diasConProduccion} día(s)`}
              icon={Scale}
              labelInfo="Kilos del calibrador. El podrido (clase J) va a su propio producto: no infla los kg de los productos buenos."
            />
            <KPICard
              label="Coste de tratamiento"
              value={formatEuro(dia.tratamiento.totalEur, 0)}
              hint={`${formatEuro(dia.tratamiento.personalEur, 0)} personal (con SS) + ${formatEuro(dia.tratamiento.suministrosEur, 0)} suministros`}
              icon={Package}
              labelInfo="Personal de cada día del periodo (presentes × horas × su salario bruto), más la Seguridad Social a cargo de la empresa, más los suministros de los días con producción. Se reparte entre los productos por kg ponderado por su índice de confección: una malla lleva más manos que un box de industria."
            />
          </div>

          <Card className="glass-accented">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">
                Producto a producto — de lo que más pierde a lo que más gana
                {soloProblemas && (
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    filtrado: {visibles.length} de {resultado.productos.length}
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto p-4 pt-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Producto</TableHead>
                    <TableHead>Zona</TableHead>
                    <TableHead className="text-right">Kilos</TableHead>
                    <TableHead className="text-right">Fruta</TableHead>
                    <TableHead className="text-right">Material</TableHead>
                    <TableHead className="text-right">Trato.</TableHead>
                    <TableHead className="text-right">Estruct.</TableHead>
                    <TableHead className="text-right">CMV</TableHead>
                    <TableHead className="text-right">Precio</TableHead>
                    <TableHead className="text-right">Margen €/kg</TableHead>
                    <TableHead className="text-right">Margen total</TableHead>
                    <TableHead className="w-8" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibles.map((p) => (
                    <TableRow key={p.clave} className={cn(p.excluido && "opacity-70")}>
                      <TableCell className="max-w-[22rem]">
                        <div className="truncate font-medium" title={p.nombre}>{p.nombre}</div>
                        {p.faltantes.length > 0 && (
                          <div className="mt-0.5 flex flex-wrap gap-1">
                            {p.faltantes.map((f) => (
                              <Badge key={f} variant="outline" className="border-warning/40 bg-warning/10 text-[10px] text-warning">
                                {FALTANTE_LABEL[f]}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{p.zona}</TableCell>
                      <TableCell className="text-right">{formatKg(p.kg)}</TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {p.frutaEurKg != null ? formatNumber(p.frutaEurKg, 3) : "—"}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {p.materialEurKg != null ? formatNumber(p.materialEurKg, 3) : "—"}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {p.tratamientoEurKg != null ? formatNumber(p.tratamientoEurKg, 3) : "—"}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {p.estructuraEurKg != null && p.estructuraEurKg > 0 ? formatNumber(p.estructuraEurKg, 3) : "—"}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {p.cmvEurKg != null ? formatNumber(p.cmvEurKg, 3) : "—"}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {p.precioEurKg != null ? formatNumber(p.precioEurKg, 3) : "—"}
                        {p.precioFuente === "metodo" && (
                          <span className="ml-1 text-[10px] text-primary" title="Precio real facturado del método de venta">real</span>
                        )}
                      </TableCell>
                      <TableCell className={cn("text-right", signo(p.margenEurKg))}>
                        {p.margenEurKg != null ? formatNumber(p.margenEurKg, 3) : "—"}
                      </TableCell>
                      <TableCell className={cn("text-right font-semibold", signo(p.margenEur))}>
                        {p.margenEur != null ? formatEuro(p.margenEur, 0) : "—"}
                      </TableCell>
                      <TableCell>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7"
                          aria-label={`Editar ficha de ${p.nombre}`}
                          onClick={() => setEditando(p)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              <p className="mt-3 text-xs text-muted-foreground">
                Fruta: coste real de báscula del lote (compra + recolección + transporte + comisión), repartido plano entre todos los kg del lote —
                por eso la industria sale en pérdida: cuesta lo mismo que la malla y se vende a una fracción.
                Tratamiento: {formatEuro(dia.tratamiento.totalEur, 0)} del periodo repartidos por kg × índice de confección.
                {dia.semanaMdna && ` Precios Mercadona de la semana ${dia.semanaMdna.semana}/${dia.semanaMdna.anio}${dia.semanaMdna.esLaSemanaDeLaFecha ? "" : " (la de la fecha aún no tiene base facturada)"}.`}
                {" "}Sin Seguridad Social ni estructura.
              </p>
            </CardContent>
          </Card>

          {/* Precios usados, siempre a la vista: sin esto es imposible saber si
              una semana está a medio facturar (las 27-29 de 2026 salen a
              0,38-0,46 €/kg por facturación parcial + abonos, frente a los
              0,86-1,41 de la tarifa real que entró en la semana 30). */}
          <Card className="glass-accented">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">
                Precios de venta usados
                {dia.semanaMdna && (
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    Mercadona de la semana {dia.semanaMdna.semana}/{dia.semanaMdna.anio}
                    {dia.semanaMdna.esLaSemanaDeLaFecha ? "" : " (la del periodo aún no tiene base facturada)"}
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              <div className="flex flex-wrap gap-2">
                {preciosUsados.map((p) => (
                  <span
                    key={p.metodo}
                    className="rounded-full border border-[var(--glass-border)] bg-[var(--glass-bg)] px-3 py-1 text-xs"
                  >
                    <span className="font-medium">{p.metodo}</span>{" "}
                    <span className="tabular-nums">{formatEurKg(p.eurKg)}</span>{" "}
                    <span className="text-muted-foreground">· {formatKg(p.kg)}</span>
                  </span>
                ))}
                {preciosUsados.length === 0 && (
                  <span className="text-xs text-muted-foreground">
                    Ningún producto del periodo tiene método de venta con facturación: no hay ingresos que calcular.
                  </span>
                )}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Salen de la base facturada de la semana. Un €/kg de Mercadona MÁS BAJO de lo normal suele ser una semana aún a medio facturar
                (facturación parcial + abonos), no una bajada de precio: en ese caso el margen sale peor de lo real hasta que se reimporte.
                Los productos de Mercadona cogen su método solos (el nombre dice el formato); el resto lo llevan en su ficha.
              </p>
            </CardContent>
          </Card>

          {/* Desglose del tratamiento: sin esto el reparto es una caja negra y
              no se puede discutir de dónde sale el €/kg de cada producto. */}
          <Card className="glass-accented">
            <CardHeader className="pb-2"><CardTitle className="text-base">De dónde sale el coste de tratamiento</CardTitle></CardHeader>
            <CardContent className="overflow-x-auto p-4 pt-0">
              <Table>
                <TableBody>
                  <TableRow>
                    <TableCell>
                      Salario bruto
                      <span className="ml-2 text-xs text-muted-foreground">
                        {dia.tratamiento.presentesTotal} presencias × {formatNumber(horasJornada, 1)} h × su €/h
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatEuro(dia.tratamiento.personalBrutoEur, 0)}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>
                      Seguridad Social
                      <span className="ml-2 text-xs text-muted-foreground">{formatNumber(pctSS, 0)} % sobre el bruto</span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatEuro(dia.tratamiento.seguridadSocialEur, 0)}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>
                      Suministros y consumibles
                      <span className="ml-2 text-xs text-muted-foreground">
                        {dia.tratamiento.diasConProduccion} día(s) de producción × {formatEuro(suministrosDia, 0)}
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatEuro(dia.tratamiento.suministrosEur, 0)}</TableCell>
                  </TableRow>
                  <TableRow className="font-semibold">
                    <TableCell>Tratamiento · se reparte por kg ponderados</TableCell>
                    <TableCell className="text-right tabular-nums">{formatEuro(dia.tratamiento.totalEur, 0)}</TableCell>
                  </TableRow>
                  {dia.estructura.porTipo.map((t) => (
                    <TableRow key={t.tipo}>
                      <TableCell>
                        {CMV_TIPO_LABEL[t.tipo as CmvTipoCosteManual] ?? t.tipo}
                        <span className="ml-2 text-xs text-muted-foreground">apunte mensual, prorrateado por días</span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{formatEuro(t.importeEur, 0)}</TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="font-semibold">
                    <TableCell>
                      Estructura · se reparte por kg planos
                      {resultado.sinEstructura && (
                        <span className="ml-2 text-xs font-normal text-warning">sin apuntes cargados</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatEuro(resultado.estructuraEur, 0)}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
              <p className="mt-3 text-xs text-muted-foreground">
                Dos repartos distintos a propósito. El <strong>tratamiento</strong> va por kilos ponderados por el índice de confección
                (Mallas 2,5 · Mesas 2,0 · Graneleras 1,0 · Industria 0,3), porque una malla lleva más manos.
                La <strong>estructura</strong> va por kilos planos: el alquiler y el seguro no dependen de si el kilo va en malla o en box.
                Los apuntes mensuales se cargan en <Link to="/economico/cmv" className="underline">Económico → CMV</Link> y se prorratean por días naturales,
                no por días trabajados: el alquiler corre también los domingos.
              </p>
            </CardContent>
          </Card>

          <Card className="glass-accented">
            <CardHeader className="pb-2"><CardTitle className="text-base">Cobertura del catálogo</CardTitle></CardHeader>
            <CardContent className="p-4 pt-0 text-sm text-muted-foreground">
              <p>
                {catalogo.pendientes.total} fichas de producto ·{" "}
                <span className={catalogo.pendientes.sinMaterial > 0 ? "text-warning" : "text-success"}>
                  {catalogo.pendientes.sinMaterial} sin coste de material
                </span>{" "}·{" "}
                <span className={catalogo.pendientes.sinPrecio > 0 ? "text-warning" : "text-success"}>
                  {catalogo.pendientes.sinPrecio} sin precio de venta
                </span>{" "}·{" "}
                {catalogo.pendientes.sinTocar} sin revisar
              </p>
              <p className="mt-1 text-xs">
                Cada ficha que rellenes mejora el CMV de todas las semanas en las que salió ese producto, no solo la que estás mirando.
                Empieza por los de arriba de la tabla: son los que más kg mueven de los que faltan.
              </p>
            </CardContent>
          </Card>
        </>
      )}

      <FichaDialog
        producto={editando}
        ficha={editando ? catalogo.porClave.get(editando.clave) ?? null : null}
        onClose={() => setEditando(null)}
        catalogo={catalogo}
      />
    </div>
  );
}

// ─── Ficha editable de un producto ───────────────────────────────────────────

function FichaDialog({
  producto,
  ficha,
  onClose,
  catalogo,
}: {
  producto: CmvProductoDia | null;
  ficha: ProductoCatalogoRow | null;
  onClose: () => void;
  catalogo: ReturnType<typeof useProductosCatalogo>;
}) {
  // El estado del formulario se reinicia con cada producto abierto: la `key`
  // del componente interno fuerza el remount, que es más simple y menos
  // propenso a fugas que sincronizar con useEffect.
  if (!producto) return null;
  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <FichaForm
          key={producto.clave}
          producto={producto}
          ficha={ficha}
          onClose={onClose}
          catalogo={catalogo}
        />
      </DialogContent>
    </Dialog>
  );
}

function FichaForm({
  producto,
  ficha,
  onClose,
  catalogo,
}: {
  producto: CmvProductoDia;
  ficha: ProductoCatalogoRow | null;
  onClose: () => void;
  catalogo: ReturnType<typeof useProductosCatalogo>;
}) {
  const txt = (v: number | null | undefined) => (v == null ? "" : String(v));
  const [kgPorBulto, setKgPorBulto] = useState(txt(ficha?.kg_por_bulto));
  const [costeBulto, setCosteBulto] = useState(txt(ficha?.coste_material_bulto));
  const [costePieza, setCostePieza] = useState(txt(ficha?.coste_material_pieza));
  const [indice, setIndice] = useState(txt(ficha?.indice_confeccion));
  const [precio, setPrecio] = useState(txt(ficha?.precio_venta_eur_kg));
  const [metodo, setMetodo] = useState(ficha?.metodo_venta ?? "");
  const [notas, setNotas] = useState(ficha?.notas ?? "");
  const [guardando, setGuardando] = useState(false);

  const patch: FichaProductoPatch = {
    kg_por_bulto: aNumeroONull(kgPorBulto),
    coste_material_bulto: aNumeroONull(costeBulto),
    coste_material_pieza: aNumeroONull(costePieza),
    indice_confeccion: aNumeroONull(indice),
    precio_venta_eur_kg: aNumeroONull(precio),
    metodo_venta: metodo.trim().toUpperCase() || null,
    notas: notas.trim() || null,
  };

  const handleGuardar = async () => {
    setGuardando(true);
    try {
      let id = ficha?.id;
      if (!id) {
        // Producto que el calibrador tecleó y la migración no sembró: se crea
        // la ficha al vuelo con su alias, y se guarda encima lo tecleado.
        id = await catalogo.crear.mutateAsync(producto.nombre);
      }
      await catalogo.guardar.mutateAsync({ id, patch });
      toast({ title: "Ficha guardada", description: producto.nombre });
      onClose();
    } catch (error) {
      toast({ title: "No se pudo guardar", description: errorMessage(error), variant: "destructive" });
    } finally {
      setGuardando(false);
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle className="text-base">{producto.nombre}</DialogTitle>
      </DialogHeader>

      <div className="space-y-1 rounded-lg border border-[var(--glass-border)] bg-[var(--glass-bg)] p-3 text-xs text-muted-foreground">
        <p>
          Zona <span className="text-foreground">{producto.zona}</span>
          {producto.marca && <> · Marca <span className="text-foreground">{producto.marca}</span></>}
          {producto.calibre && <> · Calibre <span className="text-foreground">{producto.calibre}</span></>}
        </p>
        <p>
          En el periodo: {formatKg(producto.kg)} · fruta {producto.frutaEurKg != null ? formatEurKg(producto.frutaEurKg) : "sin liquidar"} ·
          tratamiento {producto.tratamientoEurKg != null ? formatEurKg(producto.tratamientoEurKg) : "—"}
        </p>
        <p>Lo de arriba se deduce solo del nombre y del empaque; no hace falta guardarlo.</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="f-kgbulto">Kg por bulto</Label>
          <Input id="f-kgbulto" inputMode="decimal" value={kgPorBulto}
            onChange={(e) => setKgPorBulto(e.target.value)}
            placeholder={producto.kgPorBulto != null ? `${producto.kgPorBulto} (deducido)` : "sin dato"} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="f-indice">Índice de confección</Label>
          <Input id="f-indice" inputMode="decimal" value={indice}
            onChange={(e) => setIndice(e.target.value)}
            placeholder={producto.indice != null ? `${producto.indice} (por zona)` : "no absorbe"} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="f-cbulto">Material € por bulto</Label>
          <Input id="f-cbulto" inputMode="decimal" value={costeBulto}
            onChange={(e) => setCosteBulto(e.target.value)} placeholder="caja, box, palet" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="f-cpieza">Material € por malla</Label>
          <Input id="f-cpieza" inputMode="decimal" value={costePieza}
            onChange={(e) => setCostePieza(e.target.value)} placeholder="solo girsacs" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="f-metodo">Método de venta</Label>
          <Input id="f-metodo" value={metodo} onChange={(e) => setMetodo(e.target.value)}
            placeholder={producto.metodoVenta ? `${producto.metodoVenta} (deducido)` : "MA5KGC, LN211…"} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="f-precio">Precio manual €/kg</Label>
          <Input id="f-precio" inputMode="decimal" value={precio}
            onChange={(e) => setPrecio(e.target.value)} placeholder="si no hay método" />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="f-notas">Notas</Label>
        <Textarea id="f-notas" rows={2} value={notas} onChange={(e) => setNotas(e.target.value)} />
      </div>

      <p className="text-xs text-muted-foreground">
        Deja un campo VACÍO para decir "no lo sé": el producto saldrá marcado como incompleto.
        Poner un 0 significa que de verdad cuesta cero. El método de venta manda sobre el precio manual: usa la facturación real.
      </p>

      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={guardando}>Cancelar</Button>
        <Button onClick={handleGuardar} disabled={guardando}>
          {guardando ? "Guardando…" : "Guardar ficha"}
        </Button>
      </DialogFooter>
    </>
  );
}

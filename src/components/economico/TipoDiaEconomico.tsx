// Económico → Rentabilidad → "Por tipo de día": plantilla completa/reducida ×
// día bueno/medio/malo, con la cuenta entera donde la tarifa Mercadona es real.
//
// Es la versión en pantalla del Excel que pidió el dueño el 27-08-2026 (antes
// tmp/analisis-tipo-dia.ts, fuera del repo). Mismas funciones, mismos números:
// ver useTipoDia.ts y _shared/tipoDia.ts. Aquí solo se pinta.
//
// Cómo se lee:
// - ESTRUCTURA (todos los días clasificados): kg, personas, kg/persona y el
//   coste de la gente por kg, por tipo de día. Vale para todos los días con
//   asistencia en la base.
// - CUENTA COMPLETA: ingresos, margen y beneficio medios por tipo, SOLO en los
//   días con tarifa Mercadona real (semanas con €/kg medio ≥ 0,80). Con las
//   semanas sin facturar los ingresos saldrían a 0 y el beneficio sería mentira.
// - Día a día, las semanas de tarifa, lo que se deja fuera y la metodología.
import { useMemo, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { AlertTriangle, Info } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EconomicoSubnav } from "@/components/economico/EconomicoSubnav";
import { formatDateTime, formatEuro, formatKg, formatNumber, today } from "@/lib/format";
import { errorMessage } from "@/lib/errorMessage";
import { cn } from "@/lib/utils";
import { useTipoDia } from "@/hooks/useTipoDia";
import { ESTANDAR_RENDIMIENTO, LABEL_REGIMEN, type CalidadDia } from "@/lib/estandarRendimiento";
import { EUR_KG_MINIMO_FIABLE, KG_MINIMO_DIA, type DiaTipo, type FilaTipoDia } from "@/lib/tipoDia";

/** Primer día con asistencia en la base (la campaña 2025/26 se volcó desde mayo). */
const DESDE_DEFECTO = "2026-05-01";

const kgTxt = (v: number | null | undefined) => (v == null ? "—" : formatKg(v));
const eurTxt = (v: number | null | undefined) => (v == null ? "—" : formatEuro(v, 0));
const intTxt = (v: number | null | undefined) => (v == null ? "—" : formatNumber(v, 0));
const eurKgTxt = (v: number | null | undefined) => (v == null ? "—" : `${v.toLocaleString("es-ES", { minimumFractionDigits: 4, maximumFractionDigits: 4 })} €/kg`);
const diaTxt = (v: string) => v.split("-").reverse().join("/");

const TONO_CALIDAD: Record<CalidadDia, string> = {
  bueno: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
  medio: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
  malo: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200",
};

function TipoCelda({ tipo }: { tipo: string }) {
  const calidad = (["bueno", "medio", "malo"] as CalidadDia[]).find((c) => tipo.endsWith(c));
  return (
    <span className="flex items-center gap-2 whitespace-nowrap">
      {tipo.replace(/ · día (bueno|medio|malo)$/, "")}
      {calidad && <Badge variant="outline" className={cn("border-transparent", TONO_CALIDAD[calidad])}>{calidad}</Badge>}
    </span>
  );
}

function FilaEstructura({ f, esTotal }: { f: FilaTipoDia; esTotal?: boolean }) {
  return (
    <TableRow className={cn(esTotal && "bg-muted/40 font-semibold")}>
      <TableCell>{esTotal ? f.tipo : <TipoCelda tipo={f.tipo} />}</TableCell>
      <TableCell className="text-right">{intTxt(f.dias)}</TableCell>
      <TableCell className="text-right">{kgTxt(f.kg)}</TableCell>
      <TableCell className="text-right">{intTxt(f.presentes)}</TableCell>
      <TableCell className="text-right font-medium">{kgTxt(f.kgPersona)}</TableCell>
      <TableCell className="text-right">{eurTxt(f.personal)}</TableCell>
      <TableCell className="text-right">{eurKgTxt(f.personalKg)}</TableCell>
    </TableRow>
  );
}

function FilaCuenta({ f, esTotal }: { f: FilaTipoDia; esTotal?: boolean }) {
  return (
    <TableRow className={cn(esTotal && "bg-muted/40 font-semibold")}>
      <TableCell>{esTotal ? f.tipo : <TipoCelda tipo={f.tipo} />}</TableCell>
      <TableCell className="text-right">{intTxt(f.dias)}</TableCell>
      <TableCell className="text-right">{kgTxt(f.kg)}</TableCell>
      <TableCell className="text-right">{intTxt(f.presentes)}</TableCell>
      <TableCell className="text-right">{kgTxt(f.kgPersona)}</TableCell>
      <TableCell className="text-right">{eurTxt(f.ingresos)}</TableCell>
      <TableCell className="text-right">{eurTxt(f.personal)}</TableCell>
      <TableCell className="text-right">{eurTxt(f.envase)}</TableCell>
      <TableCell className="text-right">{eurTxt(f.suministros)}</TableCell>
      <TableCell className="text-right font-medium">{eurTxt(f.margen)}</TableCell>
      <TableCell className="text-right">{eurTxt(f.fruta)}</TableCell>
      <TableCell className={cn("text-right font-semibold", f.beneficio != null && f.beneficio < 0 && "text-red-600 dark:text-red-400")}>{eurTxt(f.beneficio)}</TableCell>
      <TableCell className="text-right">{kgTxt(f.kgSinFruta)}</TableCell>
    </TableRow>
  );
}

function FilaDia({ d }: { d: DiaTipo }) {
  return (
    <TableRow>
      <TableCell className="whitespace-nowrap">{diaTxt(d.fecha)}</TableCell>
      <TableCell><TipoCelda tipo={d.tipo} /></TableCell>
      <TableCell className="text-right">{intTxt(d.presentes)}{d.presentesSinCoste > 0 && <span className="text-muted-foreground"> ({d.presentesSinCoste} a coste medio)</span>}</TableCell>
      <TableCell className="text-right">{kgTxt(d.kg)}</TableCell>
      <TableCell className="text-right font-medium">{kgTxt(d.kgPersona)}</TableCell>
      <TableCell className="text-right">{eurTxt(d.personalEur)}</TableCell>
      <TableCell className="whitespace-nowrap text-xs">{d.semanaPrecio ? `S${d.semanaPrecio.semana}/${d.semanaPrecio.anio}` : <span className="text-muted-foreground">sin tarifa real</span>}</TableCell>
      <TableCell className="text-right">{eurTxt(d.ingresos)}</TableCell>
      <TableCell className="text-right">{eurTxt(d.margen)}</TableCell>
      <TableCell className="text-right">{eurTxt(d.fruta)}</TableCell>
      <TableCell className={cn("text-right font-semibold", d.beneficio != null && d.beneficio < 0 && "text-red-600 dark:text-red-400")}>{eurTxt(d.beneficio)}{d.kgSinFruta != null && d.kgSinFruta > 0 && <span className="text-muted-foreground" title="Lotes con báscula sin liquidar: beneficio parcial"> *</span>}</TableCell>
    </TableRow>
  );
}

export default function TipoDiaEconomico() {
  const [params, setParams] = useSearchParams();
  const desde = params.get("desde") ?? DESDE_DEFECTO;
  const hasta = params.get("hasta") ?? today();
  const { data, isLoading, error, rangoValido } = useTipoDia({ desde, hasta });

  const poner = (clave: "desde" | "hasta", valor: string) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      if (valor) next.set(clave, valor); else next.delete(clave);
      return next;
    }, { replace: true });
  };

  const semanasFiables = useMemo(() => (data?.semanas ?? []).filter((s) => s.fiable), [data]);
  const est = ESTANDAR_RENDIMIENTO;

  return (
    <div className="page-shell">
      <header className="page-header">
        <div>
          <p className="panel-kicker flex items-center gap-1.5"><span className="h-1.5 w-1.5 shrink-0 rounded-full bg-seccion-texto" aria-hidden="true" />Económico</p>
          <h1 className="page-title">Por tipo de día</h1>
          <p className="page-subtitle">Plantilla completa o reducida × día bueno, medio o malo: qué estructura tiene cada tipo de día y, donde la tarifa es real, qué deja.</p>
        </div>
      </header>
      <EconomicoSubnav />

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-end gap-4">
            <div className="grid gap-1">
              <Label htmlFor="tipo-dia-desde" className="text-xs">Desde</Label>
              <Input id="tipo-dia-desde" type="date" value={desde} onChange={(e) => poner("desde", e.target.value)} className="h-9 w-40" />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="tipo-dia-hasta" className="text-xs">Hasta</Label>
              <Input id="tipo-dia-hasta" type="date" value={hasta} onChange={(e) => poner("hasta", e.target.value)} className="h-9 w-40" />
            </div>
            <p className="text-xs text-muted-foreground max-w-3xl">
              Régimen por presentes: ≤{est.cortePlantillaReducida} = <b>plantilla reducida</b> (suelo {formatNumber(est.regimenes.reducida.kgPersonaSuelo)} / objetivo {formatNumber(est.regimenes.reducida.kgPersonaObjetivo)} kg por persona); más = <b>plantilla completa</b> aunque haya faltas (suelo {formatNumber(est.regimenes.completa.kgPersonaSuelo)} / objetivo {formatNumber(est.regimenes.completa.kgPersonaObjetivo)}). Decisión del dueño del {diaTxt(est.fecha)}: con media plantilla la gente rinde más por persona, así que su listón es más alto. Es el mismo estándar que el semáforo del correo diario y los informes de la encargada.
            </p>
          </div>
        </CardHeader>
        {data && (
          <CardContent className="grid gap-3 pt-0 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl border bg-card p-3">
              <p className="text-xs text-muted-foreground">Días clasificados</p>
              <p className="text-xl font-semibold tabular-nums">{intTxt(data.dias.length)}</p>
              <p className="text-xs text-muted-foreground">{intTxt(data.dias.filter((d) => d.regimen === "completa").length)} de plantilla completa · {intTxt(data.dias.filter((d) => d.regimen === "reducida").length)} reducida</p>
            </div>
            <div className="rounded-xl border bg-card p-3">
              <p className="text-xs text-muted-foreground">Con la cuenta entera</p>
              <p className="text-xl font-semibold tabular-nums">{intTxt(data.totalCuenta?.dias ?? 0)}</p>
              <p className="text-xs text-muted-foreground">{semanasFiables.length > 0 ? `tarifa real de ${semanasFiables.map((s) => `S${s.semana}`).join(", ")}` : "ninguna semana con tarifa real"}</p>
            </div>
            <div className="rounded-xl border bg-card p-3">
              <p className="text-xs text-muted-foreground">Sin asistencia en la base</p>
              <p className={cn("text-xl font-semibold tabular-nums", data.sinAsistencia.length > 0 && "text-amber-600 dark:text-amber-400")}>{intTxt(data.sinAsistencia.length)}</p>
              <p className="text-xs text-muted-foreground">días con producción que no se pueden clasificar</p>
            </div>
            <div className="rounded-xl border bg-card p-3">
              <p className="text-xs text-muted-foreground">Kg por persona (media)</p>
              <p className="text-xl font-semibold tabular-nums">{kgTxt(data.total.kgPersona)}</p>
              <p className="text-xs text-muted-foreground">personal {eurKgTxt(data.total.personalKg)}</p>
            </div>
          </CardContent>
        )}
      </Card>

      {!rangoValido && (
        <Card><CardContent className="flex items-center gap-2 p-4 text-sm text-muted-foreground"><Info className="h-4 w-4" /> El rango no vale: «desde» tiene que ser anterior a «hasta».</CardContent></Card>
      )}
      {error && (
        <Card><CardContent className="flex items-center gap-2 p-4 text-sm text-red-600"><AlertTriangle className="h-4 w-4" /> No se pudo calcular: {errorMessage(error)}</CardContent></Card>
      )}
      {rangoValido && !error && (isLoading || !data) && <div className="space-y-3"><Skeleton className="h-48 w-full" /><Skeleton className="h-48 w-full" /></div>}

      {data && (
        <>
          {data.sinAsistencia.length > 0 && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                {data.sinAsistencia.length} día(s) con producción no tienen asistencia en la base y no se pueden clasificar (del {diaTxt(data.sinAsistencia[0])} al {diaTxt(data.sinAsistencia[data.sinAsistencia.length - 1])}). La asistencia se vuelca por semanas completas: cuando entre, esos días aparecen solos. Ver «Fuera del análisis».
              </div>
            </div>
          )}

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Estructura por tipo de día</CardTitle>
              <p className="text-xs text-muted-foreground">Medias por día de cada tipo. Personal = Σ coste/hora de los presentes (coste medio para quien no lo tiene cargado) × jornada de 7 h. Días con menos de {formatNumber(KG_MINIMO_DIA)} kg (arranques) fuera.</p>
            </CardHeader>
            <CardContent className="overflow-x-auto p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Tipo de día</TableHead><TableHead className="text-right">Días</TableHead><TableHead className="text-right">Kg/día</TableHead><TableHead className="text-right">Personas</TableHead><TableHead className="text-right">Kg/persona</TableHead><TableHead className="text-right">Personal/día</TableHead><TableHead className="text-right">Personal €/kg</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.porTipo.map((f) => <FilaEstructura key={f.tipo} f={f} />)}
                  <FilaEstructura f={data.total} esTotal />
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">La cuenta entera, solo con tarifa Mercadona real</CardTitle>
              <p className="text-xs text-muted-foreground">
                Metodología v5, la misma que «Rentabilidad del día»: ingresos = kg × precio por destino; margen = ingresos − personal − envase − suministros; beneficio = margen − fruta a su coste de báscula. Solo los días cuya semana Mercadona (o la última anterior) está facturada a ≥ {EUR_KG_MINIMO_FIABLE.toLocaleString("es-ES", { minimumFractionDigits: 2 })} €/kg de media; con las semanas a medio facturar los ingresos MDNA saldrían a 0 y el beneficio sería mentira. Sin Seguridad Social ni estructura: comparaciones entre días, sí; cuenta de resultados, no.
              </p>
            </CardHeader>
            <CardContent className="overflow-x-auto p-0">
              {data.porTipoCuenta.length === 0 ? (
                <p className="p-4 text-sm text-muted-foreground">Ningún día del rango tiene tarifa Mercadona real.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Tipo de día</TableHead><TableHead className="text-right">Días</TableHead><TableHead className="text-right">Kg/día</TableHead><TableHead className="text-right">Personas</TableHead><TableHead className="text-right">Kg/persona</TableHead>
                      <TableHead className="text-right">Ingresos/día</TableHead><TableHead className="text-right">Personal</TableHead><TableHead className="text-right">Envase</TableHead><TableHead className="text-right">Suministros</TableHead><TableHead className="text-right">Margen/día</TableHead><TableHead className="text-right">Fruta/día</TableHead><TableHead className="text-right">Beneficio/día</TableHead><TableHead className="text-right">Kg sin coste fruta</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.porTipoCuenta.map((f) => <FilaCuenta key={f.tipo} f={f} />)}
                    {data.totalCuenta && <FilaCuenta f={data.totalCuenta} esTotal />}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Tabs defaultValue="dias">
            <TabsList className="flex-wrap h-auto">
              <TabsTrigger value="dias">Día a día ({data.dias.length})</TabsTrigger>
              <TabsTrigger value="semanas">Tarifa Mercadona por semana</TabsTrigger>
              <TabsTrigger value="fuera">Fuera del análisis ({data.sinAsistencia.length + data.descartadosPorKg.length})</TabsTrigger>
              <TabsTrigger value="metodo">Metodología</TabsTrigger>
            </TabsList>

            <TabsContent value="dias">
              <Card><CardContent className="overflow-x-auto p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Fecha</TableHead><TableHead>Tipo</TableHead><TableHead className="text-right">Personas</TableHead><TableHead className="text-right">Kg</TableHead><TableHead className="text-right">Kg/persona</TableHead><TableHead className="text-right">Personal</TableHead><TableHead>Tarifa</TableHead><TableHead className="text-right">Ingresos</TableHead><TableHead className="text-right">Margen</TableHead><TableHead className="text-right">Fruta</TableHead><TableHead className="text-right">Beneficio</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {[...data.dias].reverse().map((d) => <FilaDia key={d.fecha} d={d} />)}
                  </TableBody>
                </Table>
                <p className="p-3 text-xs text-muted-foreground">* Beneficio parcial: el día tiene lotes con báscula sin liquidar (no se inventa precio, null ≠ 0).</p>
              </CardContent></Card>
            </TabsContent>

            <TabsContent value="semanas">
              <Card>
                <CardHeader className="pb-2"><p className="text-xs text-muted-foreground">Una semana fija precios cuando su €/kg medio facturado (base sin IVA / kilos) llega a {EUR_KG_MINIMO_FIABLE.toLocaleString("es-ES", { minimumFractionDigits: 2 })}. Las que están a medio facturar salen a 0,38-0,47 y no valen; las que no tienen base todavía, tampoco.</p></CardHeader>
                <CardContent className="overflow-x-auto p-0">
                  <Table>
                    <TableHeader><TableRow><TableHead>Semana</TableHead><TableHead className="text-right">Kilos</TableHead><TableHead className="text-right">Base sin IVA</TableHead><TableHead className="text-right">€/kg medio</TableHead><TableHead>¿Fija precios?</TableHead><TableHead>Precios por formato</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {data.semanas.map((s) => (
                        <TableRow key={s.orden}>
                          <TableCell className="whitespace-nowrap">S{s.semana}/{s.anio}</TableCell>
                          <TableCell className="text-right">{kgTxt(s.kilos)}</TableCell>
                          <TableCell className="text-right">{s.baseIva > 0 ? eurTxt(s.baseIva) : "—"}</TableCell>
                          <TableCell className="text-right">{s.eurKg == null ? "—" : s.eurKg.toLocaleString("es-ES", { minimumFractionDigits: 3, maximumFractionDigits: 3 })}</TableCell>
                          <TableCell><Badge variant="outline" className={cn("border-transparent", s.fiable ? TONO_CALIDAD.bueno : "bg-muted text-muted-foreground")}>{s.fiable ? "sí" : s.baseIva > 0 ? "a medio facturar" : "sin base"}</Badge></TableCell>
                          <TableCell className="text-xs">{Object.entries(s.precios).map(([k, v]) => `${k} ${(v as number).toLocaleString("es-ES", { minimumFractionDigits: 3, maximumFractionDigits: 3 })}`).join(" · ") || "—"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="fuera">
              <Card><CardContent className="space-y-3 p-4 text-sm">
                <div>
                  <p className="font-medium">Sin asistencia en la base ({data.sinAsistencia.length})</p>
                  <p className="text-muted-foreground">{data.sinAsistencia.length ? data.sinAsistencia.map(diaTxt).join(", ") : "ninguno"}</p>
                </div>
                <div>
                  <p className="font-medium">Por debajo de {formatNumber(KG_MINIMO_DIA)} kg: arranques y residuales ({data.descartadosPorKg.length})</p>
                  <p className="text-muted-foreground">{data.descartadosPorKg.length ? data.descartadosPorKg.map((d) => `${diaTxt(d.fecha)} (${kgTxt(d.kg)})`).join(", ") : "ninguno"}</p>
                </div>
                {data.refrescadoEn && <p className="text-xs text-muted-foreground">Detalle del calibrador refrescado {formatDateTime(data.refrescadoEn)}.</p>}
              </CardContent></Card>
            </TabsContent>

            <TabsContent value="metodo">
              <Card><CardContent className="space-y-3 p-4 text-sm">
                <Punto titulo="Plantilla completa / reducida">Definición del dueño ({diaTxt(est.fecha)}): reducida = el régimen de media plantilla que empezó en agosto (25-30 presentes); un día de 45 es plantilla completa CON FALTAS. Corte: ≤{est.cortePlantillaReducida} presentes. En los datos separa limpio los dos regímenes (mayo-julio 45-55; agosto 27-31).</Punto>
                <Punto titulo="Bueno / medio / malo">Kg por persona contra el estándar DE SU RÉGIMEN: {LABEL_REGIMEN.completa.toLowerCase()} suelo {formatNumber(est.regimenes.completa.kgPersonaSuelo)} / objetivo {formatNumber(est.regimenes.completa.kgPersonaObjetivo)}; {LABEL_REGIMEN.reducida.toLowerCase()} suelo {formatNumber(est.regimenes.reducida.kgPersonaSuelo)} / objetivo {formatNumber(est.regimenes.reducida.kgPersonaObjetivo)}. El kg/persona se diluye con plantilla grande, así que cada régimen tiene su listón. Es el mismo que usa el vigía de negocio (día rojo), el correo diario y los informes de la encargada.</Punto>
                <Punto titulo="De dónde salen los datos">Kg y destinos: la vista canónica del calibrador (volcado SQL, todas las pasadas; Word de respaldo). Personas: asistencia_detalle (presentes) con el coste/hora de cada trabajador; quien no lo tiene cargado, a coste medio. Fruta: importe de báscula / kg de entrada por lote. Tarifa: hoja semanal de Mercadona (base sin IVA / kilos por formato).</Punto>
                <Punto titulo="La cuenta de cada día">computeRentabilidadDia, la MISMA función que «Rentabilidad del día» y el informe semanal (v5, validada a mano el 03-08-2026). Ingresos = kg × precio por destino; margen = ingresos − personal − envase − suministros (600 €/día); beneficio = margen − fruta al coste real de báscula. Sin Seguridad Social ni estructura.</Punto>
                <Punto titulo="Por qué los euros solo van con tarifa real">Los precios MDNA por defecto están a 0 a propósito: deben venir de la semana. Con una semana sin facturar o a medio facturar, los ingresos se hunden y salen beneficios muy negativos que no son verdad (aprendido el 27-08-2026). Cargar la facturación de las semanas antiguas alarga la cuenta sola.</Punto>
                <Punto titulo="Beneficio parcial">Un día con «kg sin coste fruta» mayor que 0 tiene lotes con báscula sin liquidar: su beneficio es PARCIAL. No se inventa precio.</Punto>
              </CardContent></Card>
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
}

function Punto({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <div>
      <p className="font-medium">{titulo}</p>
      <p className="text-muted-foreground">{children}</p>
    </div>
  );
}

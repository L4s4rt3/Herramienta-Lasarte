// src/pages/EconomicoRentabilidad.tsx
// Sección "Económico → Rentabilidad del día" (encargo del dueño, 31-07-2026):
// cuánto dejó UN día en euros de verdad — ingresos a precio real de venta,
// menos gente, envases, suministros y la fruta a su coste de báscula — con el
// detalle lote a lote (el número que decide qué fruta entra a línea).
// El cálculo vive en src/lib/rentabilidadDia.ts (puro, con tests); los datos,
// en src/hooks/useRentabilidadDia.ts. Los precios se precargan de la hoja
// semanal de Mercadona y son EDITABLES: la página enseña siempre qué precio
// está usando (nada de números mágicos escondidos).
import { useMemo, useState } from "react";
import { AlertTriangle, Banknote, Euro, Package, Scale } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { KPICard } from "@/components/KPICard";
import { EconomicoSubnav } from "@/components/economico/EconomicoSubnav";
import { useRentabilidadDia, useUltimaFechaConInformes } from "@/hooks/useRentabilidadDia";
import {
  computeRentabilidadDia,
  COSTE_HORA_MEDIO_DEFECTO,
  DESTINO_LABEL,
  DESTINOS_ORDEN,
  ENVASE_EUR_KG,
  HORAS_JORNADA_DEFECTO,
  PRECIOS_RENTABILIDAD_DEFECTO,
  SUMINISTROS_DIA_DEFECTO_EUR,
  type DestinoRentabilidad,
  type PreciosRentabilidad,
} from "@/lib/rentabilidadDia";
import { errorMessage } from "@/lib/errorMessage";
import { formatEuro, formatEurKg, formatKg, formatNumber, today } from "@/lib/format";

/** Campos de precio editables, en el orden de la cuenta. */
const CAMPOS_PRECIO: Array<{ key: keyof PreciosRentabilidad; label: string }> = [
  { key: "mdnaGranel", label: "MDNA granel 12 kg" },
  { key: "mdna3", label: "MDNA malla 3 kg" },
  { key: "mdna5", label: "MDNA malla 5 kg" },
  { key: "mdna4", label: "MDNA girsac 4 kg" },
  { key: "otrosEmp", label: "Empaquetado otros" },
  { key: "otrosGranel", label: "Granel otros" },
  { key: "prec", label: "Precalibrado" },
  { key: "industria", label: "Industria" },
];

function signo(eur: number): string {
  return eur >= 0 ? "text-success" : "text-destructive";
}

export default function EconomicoRentabilidad() {
  const ultimaFecha = useUltimaFechaConInformes();
  const [fechaSel, setFechaSel] = useState<string | null>(null);
  const fecha = fechaSel ?? ultimaFecha.data ?? null;

  const datos = useRentabilidadDia(fecha);

  // Ajustes del cálculo, siempre visibles y editables (jornada de 7 h en
  // vacaciones 2026; la media se aplica a los presentes sin nómina cargada).
  const [horasJornada, setHorasJornada] = useState(HORAS_JORNADA_DEFECTO);
  const [costeHoraMedio, setCosteHoraMedio] = useState(COSTE_HORA_MEDIO_DEFECTO);
  const [suministrosDia, setSuministrosDia] = useState(SUMINISTROS_DIA_DEFECTO_EUR);
  const [preciosOverride, setPreciosOverride] = useState<Partial<Record<keyof PreciosRentabilidad, number>>>({});

  // Precio efectivo = lo que teclee el usuario > semana Mercadona > default.
  const preciosSugeridos = useMemo<PreciosRentabilidad>(
    () => ({ ...PRECIOS_RENTABILIDAD_DEFECTO, ...(datos.data?.semanaMdna?.precios ?? {}) }),
    [datos.data?.semanaMdna],
  );
  const precios = useMemo<PreciosRentabilidad>(
    () => ({ ...preciosSugeridos, ...preciosOverride }),
    [preciosSugeridos, preciosOverride],
  );

  const resultado = useMemo(
    () =>
      datos.data
        ? computeRentabilidadDia(datos.data.filas, datos.data.frutaPorLote, datos.data.personal, {
            precios,
            horasJornada,
            suministrosDiaEur: suministrosDia,
            costeHoraMedio,
          })
        : null,
    [datos.data, precios, horasJornada, suministrosDia, costeHoraMedio],
  );

  const avisos = useMemo(() => {
    const lista: string[] = [];
    if (!datos.data || !resultado) return lista;
    if (datos.data.personal.presentes === 0) {
      lista.push("La asistencia de este día no está marcada: el coste de personal sale a 0 € y el beneficio está inflado. Márcala en Costes → Asistencia.");
    } else if (datos.data.personal.presentesSinCoste > 0) {
      lista.push(`${datos.data.personal.presentesSinCoste} presente(s) sin coste/hora en su ficha: se les aplica la media (${formatNumber(costeHoraMedio, 2)} €/h). Complétalo en RRHH → Personas.`);
    }
    if (resultado.kgSinCosteFruta > 0) {
      lista.push(`${formatKg(resultado.kgSinCosteFruta)} calibrados de lotes con la fruta SIN liquidar en báscula: el beneficio mostrado es PARCIAL (le falta esa fruta por restar).`);
    }
    if (datos.data.lotesSinEntrada.length > 0) {
      lista.push(`Lote(s) sin entrada de báscula con su código: ${datos.data.lotesSinEntrada.join(", ")} — su fruta no está restada.`);
    }
    if (datos.data.semanaMdna == null) {
      lista.push("No hay ninguna semana de Mercadona con base facturada: los precios MDNA están a 0 salvo que los teclees. Importa la hoja semanal en Mercadona.");
    } else if (!datos.data.semanaMdna.esLaSemanaDeLaFecha) {
      lista.push(`La semana Mercadona de esta fecha no tiene base facturada: se usan los precios de la semana ${datos.data.semanaMdna.semana}/${datos.data.semanaMdna.anio}. Puedes corregirlos a mano.`);
    }
    if (resultado.kgMdnaSinFormato > 0) {
      lista.push(`${formatKg(resultado.kgMdnaSinFormato)} de MDNA con formato no reconocido: contados al precio del girsac 4 kg.`);
    }
    return lista;
  }, [datos.data, resultado, costeHoraMedio]);

  const sinInformes = !!fecha && !datos.isLoading && !datos.isError && (resultado?.kgTotal ?? 0) === 0;

  return (
    <div className="page-shell">
      <header className="page-header">
        <div>
          <p className="panel-kicker flex items-center gap-1.5"><span className="h-1.5 w-1.5 shrink-0 rounded-full bg-seccion-texto" aria-hidden="true" />Económico</p>
          <h1 className="page-title">Rentabilidad del día</h1>
          <p className="page-subtitle">Lo que dejó el día: ventas a precio real − gente − envases − suministros − fruta a su coste de báscula.</p>
        </div>
      </header>
      <EconomicoSubnav />

      <div className="section-toolbar flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label htmlFor="rent-fecha" className="text-xs text-muted-foreground">Día</Label>
          <Input
            id="rent-fecha"
            type="date"
            className="w-40"
            max={today()}
            value={fecha ?? ""}
            onChange={(e) => setFechaSel(e.target.value || null)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="rent-horas" className="text-xs text-muted-foreground">Horas de jornada</Label>
          <Input id="rent-horas" type="number" min={1} max={12} step={0.5} className="w-28"
            value={horasJornada} onChange={(e) => setHorasJornada(Number(e.target.value) || 0)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="rent-media" className="text-xs text-muted-foreground">€/h sin nómina</Label>
          <Input id="rent-media" type="number" min={0} step={0.01} className="w-28"
            value={costeHoraMedio} onChange={(e) => setCosteHoraMedio(Number(e.target.value) || 0)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="rent-sum" className="text-xs text-muted-foreground">Suministros €/día</Label>
          <Input id="rent-sum" type="number" min={0} step={50} className="w-28"
            value={suministrosDia} onChange={(e) => setSuministrosDia(Number(e.target.value) || 0)} />
        </div>
      </div>

      {datos.isError && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          No se pudieron cargar los datos del día: {errorMessage(datos.error)}
        </div>
      )}

      {(datos.isLoading || ultimaFecha.isLoading) && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-32 rounded-2xl" />)}
        </div>
      )}

      {sinInformes && (
        <Card className="glass-accented">
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            Este día no tiene Informes LOTE del calibrador cargados. Impórtalos en Histórico → Informes de lote y la página se calcula sola.
          </CardContent>
        </Card>
      )}

      {resultado && resultado.kgTotal > 0 && datos.data && (
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
              label={resultado.kgSinCosteFruta > 0 ? "Beneficio del día (parcial)" : "Beneficio del día"}
              value={formatEuro(resultado.beneficioEur, 0)}
              hint={`${formatEuro(resultado.frutaEur, 0)} de fruta restada`}
              icon={Banknote}
              accent={resultado.beneficioEur >= 0 ? "success" : "destructive"}
              valueClassName={signo(resultado.beneficioEur)}
              labelInfo="Margen del día menos la fruta calibrada a su coste real de báscula (compra + recogida + transporte + comisión). Sin Seguridad Social ni estructura."
            />
            <KPICard
              label="Margen (antes de fruta)"
              value={formatEuro(resultado.margenEur, 0)}
              hint={`${formatEurKg(resultado.margenEurKg)} por kg calibrado`}
              icon={Euro}
              labelInfo="Ingresos menos personal, envases y suministros: lo que deja el trabajo del almacén, la vara para comparar días."
            />
            <KPICard
              label="Ingresos del día"
              value={formatEuro(resultado.ingresosEur, 0)}
              hint={`${formatKg(resultado.kgTotal)} calibrados`}
              icon={Scale}
              labelInfo="Kilos de cada destino por su precio de venta. El podrido va a 0 € aunque viaje en el box de industria."
            />
            <KPICard
              label="Podrido real"
              value={resultado.pctPodrido != null ? `${formatNumber(resultado.pctPodrido, 1)} %` : "—"}
              hint={`${formatNumber(resultado.pctIndustria ?? 0, 1)} % a industria`}
              icon={Package}
              accent={(resultado.pctPodrido ?? 0) > 5 ? "warning" : "primary"}
              labelInfo="Clase (J) de los Informes LOTE: medido por el calibrador, no estimado."
            />
          </div>

          {/* La cuenta del día */}
          <Card className="glass-accented">
            <CardHeader className="pb-2"><CardTitle className="text-base">La cuenta del día</CardTitle></CardHeader>
            <CardContent className="overflow-x-auto p-4 pt-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Concepto</TableHead>
                    <TableHead className="text-right">€/kg</TableHead>
                    <TableHead className="text-right">Kilos</TableHead>
                    <TableHead className="text-right">Euros</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {DESTINOS_ORDEN.filter((d) => resultado.kgPorDestino[d] > 0).map((d) => (
                    <TableRow key={d}>
                      <TableCell>{DESTINO_LABEL[d]}</TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {d === "podrido" || d === "muestra" ? "0" : formatNumber(precios[d as Exclude<DestinoRentabilidad, "podrido" | "muestra">], 2)}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">{formatKg(resultado.kgPorDestino[d])}</TableCell>
                      <TableCell className="text-right">{formatEuro(resultado.ingresosPorDestino[d], 0)}</TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="font-semibold">
                    <TableCell>Ingresos</TableCell>
                    <TableCell />
                    <TableCell className="text-right text-muted-foreground">{formatKg(resultado.kgTotal)}</TableCell>
                    <TableCell className="text-right">{formatEuro(resultado.ingresosEur, 0)}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="text-muted-foreground">− Personal ({datos.data.personal.presentes} presentes × {formatNumber(horasJornada, 1)} h × su nómina)</TableCell>
                    <TableCell /><TableCell />
                    <TableCell className="text-right text-muted-foreground">−{formatEuro(resultado.personalEur, 0)}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="text-muted-foreground">− Envases (mallas, bolsas, cajas)</TableCell>
                    <TableCell /><TableCell />
                    <TableCell className="text-right text-muted-foreground">−{formatEuro(resultado.envaseEur, 0)}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="text-muted-foreground">− Suministros (luz, gasoil, agua)</TableCell>
                    <TableCell /><TableCell />
                    <TableCell className="text-right text-muted-foreground">−{formatEuro(resultado.suministrosEur, 0)}</TableCell>
                  </TableRow>
                  <TableRow className="font-semibold">
                    <TableCell>Margen del día</TableCell>
                    <TableCell /><TableCell />
                    <TableCell className="text-right">{formatEuro(resultado.margenEur, 0)} <span className="text-xs font-normal text-muted-foreground">({formatEurKg(resultado.margenEurKg)})</span></TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="text-muted-foreground">− Fruta del día (coste real de báscula{resultado.kgSinCosteFruta > 0 ? ", incompleta" : ""})</TableCell>
                    <TableCell /><TableCell />
                    <TableCell className="text-right text-muted-foreground">−{formatEuro(resultado.frutaEur, 0)}</TableCell>
                  </TableRow>
                  <TableRow className="font-semibold">
                    <TableCell>Beneficio del día{resultado.kgSinCosteFruta > 0 ? " (parcial)" : ""}</TableCell>
                    <TableCell /><TableCell />
                    <TableCell className={`text-right ${signo(resultado.beneficioEur)}`}>{formatEuro(resultado.beneficioEur, 0)}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Lote a lote */}
          <Card className="glass-accented">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Lote a lote — lo que ganó (o perdió) cada uno</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto p-4 pt-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Lote</TableHead>
                    <TableHead>Productor</TableHead>
                    <TableHead className="text-right">Kilos</TableHead>
                    <TableHead className="text-right">Podrido</TableHead>
                    <TableHead className="text-right">Industria</TableHead>
                    <TableHead className="text-right">t/h</TableHead>
                    <TableHead className="text-right">Margen</TableHead>
                    <TableHead className="text-right">€/min línea</TableHead>
                    <TableHead className="text-right">Fruta €/kg</TableHead>
                    <TableHead className="text-right">Beneficio</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {resultado.lotes.map((l) => (
                    <TableRow key={l.loteCodigo}>
                      <TableCell className="font-medium">{l.loteCodigo}</TableCell>
                      <TableCell className="text-muted-foreground">{l.productor ?? "—"}</TableCell>
                      <TableCell className="text-right">{formatKg(l.kg)}</TableCell>
                      <TableCell className={`text-right ${(l.pctPodrido ?? 0) > 5 ? "text-warning" : "text-muted-foreground"}`}>
                        {l.pctPodrido != null ? `${formatNumber(l.pctPodrido, 1)} %` : "—"}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">{l.pctIndustria != null ? `${formatNumber(l.pctIndustria, 1)} %` : "—"}</TableCell>
                      <TableCell className="text-right text-muted-foreground">{l.toneladasHora != null ? formatNumber(l.toneladasHora, 1) : "—"}</TableCell>
                      <TableCell className="text-right">{formatEuro(l.margenEur, 0)}</TableCell>
                      <TableCell className="text-right text-muted-foreground">{l.margenEurMin != null ? formatNumber(l.margenEurMin, 0) : "—"}</TableCell>
                      <TableCell className="text-right text-muted-foreground">{l.frutaEurKg != null ? formatNumber(l.frutaEurKg, 3) : "sin liquidar"}</TableCell>
                      <TableCell className={`text-right font-semibold ${l.beneficioEur != null ? signo(l.beneficioEur) : "text-muted-foreground"}`}>
                        {l.beneficioEur != null ? formatEuro(l.beneficioEur, 0) : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Precios usados, siempre a la vista y editables */}
          <Card className="glass-accented">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">
                Precios de venta usados (€/kg)
                {datos.data.semanaMdna && (
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    MDNA de la hoja semanal {datos.data.semanaMdna.semana}/{datos.data.semanaMdna.anio}; el resto, editable (proxy junio)
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {CAMPOS_PRECIO.map(({ key, label }) => (
                  <div key={key} className="space-y-1">
                    <Label htmlFor={`precio-${key}`} className="text-xs text-muted-foreground">{label}</Label>
                    <Input
                      id={`precio-${key}`}
                      type="number"
                      min={0}
                      step={0.01}
                      value={Number(precios[key].toFixed(3))}
                      onChange={(e) => setPreciosOverride((prev) => ({ ...prev, [key]: Number(e.target.value) || 0 }))}
                    />
                  </div>
                ))}
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                Envase por kg: granel MDNA {formatNumber(ENVASE_EUR_KG.mdnaGranel, 2)} · 3 kg {formatNumber(ENVASE_EUR_KG.mdna3, 3)} · 5 kg {formatNumber(ENVASE_EUR_KG.mdna5, 3)} · girsac {formatNumber(ENVASE_EUR_KG.mdna4, 3)} (de Económico → Precios).
                El beneficio no incluye Seguridad Social (~+35 % del personal) ni estructura. El precalibrado se valora a {formatNumber(precios.prec, 2)} €/kg el día que se aparta.
              </p>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

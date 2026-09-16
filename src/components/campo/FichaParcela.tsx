// Campo → Parcelas → la ficha de UNA parcela.
//
// Los números NO se calculan aquí: los da useAprovechamientoReal, el mismo hook
// que la pestaña "Aprovechamiento real por parcela" de Análisis → Por productor.
// Si algún día cambia el método, cambia en un sitio y las dos pantallas dicen lo
// mismo. Aquí se enseña el resumen, no el análisis entero: quien quiera clases,
// calibres y lote a lote tiene el enlace al análisis completo.
//
// Cada fila lleva escrito qué es y de dónde sale. La base de los porcentajes son
// los KG QUE PESÓ EL CALIBRADOR, no los de báscula: el calibrador pesa un 7,80 %
// más (tara), así que mezclar las dos bases da un aprovechamiento falso.
import { lazy, Suspense } from "react";
import { AlertTriangle, ExternalLink, Ruler, Trees } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import ContornoParcela from "@/components/campo/ContornoParcela";
import { etiquetaSemana } from "@/components/campo/CurvaCalibre";
import { useAprovechamientoReal } from "@/hooks/useAprovechamientoReal";
import { useCampoCalibre } from "@/hooks/useCampoParcelas";
import {
  calibreDeParcela, curvasDeParcela, ETIQUETA_FUENTE,
  type CampoParcelaRow, type FilaParcelaConCampo,
} from "@/lib/campoParcelas";
import { errorMessage } from "@/lib/errorMessage";
import { formatDate, formatKg, formatNumber, formatPct } from "@/lib/format";
import { cn } from "@/lib/utils";

const pctTxt = (v: number | null | undefined) => (v == null ? "—" : formatPct(v));
const kgTxt = (v: number | null | undefined) => (v == null ? "—" : formatKg(v));
const diaTxt = (v: string | null | undefined) => (v ? formatDate(v) : "—");

function Fila({ concepto, valor, nota, destacado }: { concepto: string; valor: string; nota: string; destacado?: boolean }) {
  return (
    <TableRow className={cn(destacado && "bg-muted/50")}>
      <TableCell className={cn("align-top", destacado && "font-semibold")}>
        {concepto}
        <p className="text-xs font-normal text-muted-foreground">{nota}</p>
      </TableCell>
      <TableCell className={cn("whitespace-nowrap text-right align-top tabular-nums", destacado && "font-semibold")}>
        {valor}
      </TableCell>
    </TableRow>
  );
}

/** Un trozo dibujado: su contorno, sus hectáreas y cómo se llama en Aerobotics. */
function TrozoDeCampo({ ficha }: { ficha: CampoParcelaRow }) {
  const maps = ficha.centro_lat != null && ficha.centro_lon != null
    ? `https://www.google.com/maps/search/?api=1&query=${ficha.centro_lat},${ficha.centro_lon}`
    : null;
  return (
    <div className="flex flex-col items-center gap-1 rounded-lg border border-border/60 p-2">
      <ContornoParcela anillos={ficha.contorno} alto={140} titulo={`${ficha.nombre} · ${ficha.hectareas} ha`} />
      <p className="text-center text-xs font-medium">{ficha.nombre}</p>
      <p className="text-center text-xs text-muted-foreground">
        {ficha.hectareas == null ? "sin hectáreas" : `${formatNumber(ficha.hectareas, 2)} ha`}
        {ficha.variedad ? ` · ${ficha.variedad}` : ""}
      </p>
      {maps && (
        <a
          href={maps}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
        >
          Ver en el mapa <ExternalLink className="h-3 w-3" />
        </a>
      )}
    </div>
  );
}

/**
 * La ficha de campo: hectáreas, variedad plantada, el dibujo de la parcela y
 * los kilos por hectárea. Solo cuenta lo emparejado con confianza; lo dudoso se
 * enseña aparte y no divide kilos.
 */
function FichaDeCampo({ fila }: { fila: FilaParcelaConCampo }) {
  const { campo } = fila;
  const sinNada = campo.fichas.length === 0 && campo.dudosas.length === 0;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base"><Trees className="h-4 w-4" /> La parcela en el campo</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {sinNada && (
          <p className="text-sm text-muted-foreground">
            Esta parcela no tiene ficha de campo: o no está dibujada en Aerobotics, o su nombre allí no se ha
            podido casar con este. Sin hectáreas no hay kilos por hectárea que enseñar.
          </p>
        )}

        {campo.fichas.length > 0 && (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <p className="text-xs text-muted-foreground">Hectáreas</p>
                {/* Ojo con formatNumber: a un null le pinta un 0, y aquí un 0
                    sería decir que la parcela no mide nada. */}
                <p className="text-lg font-semibold">
                  {campo.hectareas == null ? "—" : formatNumber(campo.hectareas, 2)}
                  {campo.trozos > 1 && <span className="text-sm font-normal text-muted-foreground"> en {campo.trozos} trozos</span>}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Kilos por hectárea</p>
                <p className={cn("text-lg font-semibold", campo.rendimientoIncreible && "text-red-600 dark:text-red-400")}>
                  {campo.kgPorHa == null ? "—" : formatNumber(campo.kgPorHa)}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Variedad plantada</p>
                <p className="text-lg font-semibold">{campo.fichas[0].variedad ?? "—"}</p>
              </div>
            </div>

            {campo.rendimientoIncreible && (
              <p className="flex items-start gap-2 rounded-lg bg-amber-500/10 p-2 text-sm">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                <span>
                  Esa cifra no es posible en naranja. No significa que la parcela sea rara: o el emparejamiento
                  con Aerobotics está mal, o allí solo está dibujado un trozo de lo que la báscula llama esta
                  parcela y los kilos de todo el resto caen sobre él.
                </span>
              </p>
            )}

            <div className="grid gap-2 sm:grid-cols-3">
              {campo.fichas.map((f) => <TrozoDeCampo key={f.id} ficha={f} />)}
            </div>
          </>
        )}

        {campo.dudosas.length > 0 && (
          <div className="space-y-1 rounded-lg border border-dashed border-border p-2">
            <p className="text-sm text-muted-foreground">
              {campo.dudosas.length === 1
                ? "Hay un trozo de Aerobotics que PODRÍA ser de esta parcela, pero el nombre no lo deja claro."
                : `Hay ${formatNumber(campo.dudosas.length)} trozos de Aerobotics que PODRÍAN ser de esta parcela, pero el nombre no lo deja claro.`}
              {" "}Ni suman hectáreas ni entran en el cálculo hasta que alguien lo confirme.
            </p>
            <div className="flex flex-wrap gap-1.5">
              {campo.dudosas.map((f) => (
                <Badge key={f.id} variant="outline">
                  {f.nombre} · {f.hectareas == null ? "sin ha" : `${formatNumber(f.hectareas, 2)} ha`}
                </Badge>
              ))}
            </div>
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          Hectáreas, variedad y contorno: Aerobotics. Kilos: báscula. Árboles, marras, vigor y previsión de
          calibre no entran todavía.
        </p>
      </CardContent>
    </Card>
  );
}

const Curva = lazy(() => import("@/components/campo/CurvaCalibre"));

/**
 * El calibre en el campo: cómo va creciendo la fruta y cuándo toca cogerla.
 *
 * Aquí es donde la herramienta se adelanta al calibrador. Con dos cautelas que
 * se dicen en pantalla: de dónde sale la previsión (hay curvas que son la media
 * de la comarca, no fruta de esta finca) y que hasta que no entre fruta no hay
 * con qué comprobar si acierta.
 */
function CalibreEnCampo({ fila }: { fila: FilaParcelaConCampo }) {
  const { medidas, curvas, isLoading } = useCampoCalibre();
  const fichas = [...fila.campo.fichas, ...fila.campo.dudosas];
  const calibre = calibreDeParcela(fichas, medidas);
  const misCurvas = curvasDeParcela(fichas, curvas);
  const curva = misCurvas[0] ?? null;

  if (isLoading) return <Skeleton className="h-48 w-full" />;
  if (calibre.puntos.length === 0 && !curva) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base"><Ruler className="h-4 w-4" /> El calibre en el campo</CardTitle>
        {calibre.bloques.length > 0 && (
          <p className="text-xs text-muted-foreground">
            Medido por Aerobotics en {calibre.bloques.length === 1 ? "el bloque" : "los bloques"}{" "}
            {calibre.bloques.join(", ")}.
          </p>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <p className="text-xs text-muted-foreground">Última medida</p>
            <p className="text-lg font-semibold">
              {calibre.ultimaMedida ? `${formatNumber(calibre.ultimaMedida.mm, 1)} mm` : "—"}
              {calibre.ultimaMedida && (
                <span className="text-sm font-normal text-muted-foreground"> · {etiquetaSemana(calibre.ultimaMedida.semana)}</span>
              )}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Previsto llegar a</p>
            <p className="text-lg font-semibold">
              {calibre.ultimaPrevision ? `${formatNumber(calibre.ultimaPrevision.mm, 1)} mm` : "—"}
              {calibre.ultimaPrevision && (
                <span className="text-sm font-normal text-muted-foreground"> · {etiquetaSemana(calibre.ultimaPrevision.semana)}</span>
              )}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Ventana de recolección</p>
            <p className="text-lg font-semibold">
              {curva?.ventana_desde && curva?.ventana_hasta
                ? `${etiquetaSemana(curva.ventana_desde)} – ${etiquetaSemana(curva.ventana_hasta)}`
                : "—"}
            </p>
          </div>
        </div>

        {calibre.puntos.length > 0 && (
          <Suspense fallback={<Skeleton className="h-52 w-full" />}>
            <Curva
              puntos={calibre.puntos}
              ventana={curva ? { desde: curva.ventana_desde, hasta: curva.ventana_hasta } : null}
            />
          </Suspense>
        )}

        {calibre.aciertos.length > 0 && (
          <div className="rounded-lg border border-border/60 p-2 text-sm">
            <p className="font-medium">Lo previsto contra lo que salió</p>
            <ul className="mt-1 space-y-0.5 text-muted-foreground">
              {calibre.aciertos.slice(-4).map((a) => (
                <li key={a.semana}>
                  {etiquetaSemana(a.semana)}: se preveía {formatNumber(a.previsto, 1)} mm y se midió{" "}
                  {formatNumber(a.medido, 1)} mm ({a.error >= 0 ? "+" : ""}{formatNumber(a.error, 1)} mm).
                </li>
              ))}
            </ul>
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          {curva?.floracion_semana && <>Plena floración en {etiquetaSemana(curva.floracion_semana)}. </>}
          {curva?.fuente
            ? <>La previsión sale de: <span className={cn(curva.fuente === "region_cultivar_default" && "font-medium text-amber-700 dark:text-amber-400")}>{ETIQUETA_FUENTE[curva.fuente] ?? curva.fuente}</span>.</>
            : <>Aerobotics no dice de dónde sale esta previsión.</>}
          {" "}Contra lo que saca el calibrador todavía no se puede comparar: la fruta de esta campaña no ha
          entrado. Cuando entre, se pondrán las dos cifras una al lado de la otra.
        </p>
      </CardContent>
    </Card>
  );
}

export default function FichaParcela({ fila }: { fila: FilaParcelaConCampo }) {
  const { data, isLoading, error } = useAprovechamientoReal({ finca: fila.finca, parcelas: [fila.parcela] });
  const parcela = data?.parcelas[0] ?? null;

  return (
    <div className="space-y-4">
      <FichaDeCampo fila={fila} />

      <CalibreEnCampo fila={fila} />

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Lo que ha entrado de esta parcela</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-4">
            <div>
              <p className="text-xs text-muted-foreground">Entradas de báscula</p>
              <p className="text-lg font-semibold">{formatNumber(fila.entradas)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Kg entrados</p>
              <p className="text-lg font-semibold">{formatKg(fila.kgEntrada)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Primera entrada</p>
              <p className="text-lg font-semibold">{diaTxt(fila.primera)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Última entrada</p>
              <p className="text-lg font-semibold">{diaTxt(fila.ultima)}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 text-sm">
            <span className="text-muted-foreground">Variedades:</span>
            {fila.variedades.length === 0
              ? <span className="text-muted-foreground">—</span>
              : fila.variedades.map((v) => <Badge key={v} variant="secondary">{v}</Badge>)}
          </div>
          <div className="flex flex-wrap items-center gap-1.5 text-sm">
            <span className="text-muted-foreground">
              {fila.lotes.length === 1 ? "Lote:" : `Lotes (${formatNumber(fila.lotes.length)}):`}
            </span>
            {fila.lotes.map((l) => (
              <Badge key={l} variant="outline" className="font-mono text-xs">{l}</Badge>
            ))}
          </div>
          {fila.ggn && (
            <p className="text-sm text-muted-foreground">
              GlobalG.A.P.: <span className="font-mono">{fila.ggn}</span>
              {fila.entradasCertificadas < fila.entradas
                && ` · solo ${formatNumber(fila.entradasCertificadas)} de ${formatNumber(fila.entradas)} entradas llegaron marcadas como certificadas`}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Lo que dio en el calibrador</CardTitle>
          {data && (
            <p className="text-xs text-muted-foreground">
              Volcado del calibrador hasta el {diaTxt(data.frescura.ultimaPasadaSizer)} · partes diarios hasta
              el {diaTxt(data.frescura.ultimoParte)}.
              {data.frescura.volcadoAtrasado && " El volcado va por detrás de los partes: lo procesado después entra por el Word de lote o todavía no entra."}
            </p>
          )}
        </CardHeader>
        <CardContent className="px-0 sm:px-6">
          {isLoading && <Skeleton className="h-64 w-full" />}

          {!isLoading && error && (
            <p className="flex items-center gap-2 p-4 text-sm text-red-600 dark:text-red-400">
              <AlertTriangle className="h-4 w-4" /> No se ha podido leer el desglose del calibrador: {errorMessage(error)}
            </p>
          )}

          {!isLoading && !error && !parcela && (
            <p className="p-4 text-sm text-muted-foreground">
              Ninguno de los lotes de esta parcela ha pasado todavía por la línea, o sus kg llegaron dentro de
              una pasada que mezcla varios lotes. Sin desglose del calibrador no hay aprovechamiento que
              enseñar: es un dato que falta, no un cero.
            </p>
          )}

          {!isLoading && !error && parcela && (
            <div className="overflow-x-auto">
              <Table>
                <TableBody>
                  <Fila
                    concepto="Lotes de la parcela"
                    valor={formatNumber(parcela.nLotes)}
                    nota="Todos los que entraron por báscula"
                  />
                  <Fila
                    concepto="Lotes ya analizados"
                    valor={formatNumber(parcela.nConDato)}
                    nota="Los que tienen desglose del calibrador; el resto aún no ha pasado por línea"
                  />
                  <Fila
                    concepto="Kg entrados de los lotes analizados"
                    valor={kgTxt(parcela.kgEntradaConDato)}
                    nota="La parte de la parcela sobre la que se puede hablar"
                  />
                  <Fila
                    concepto="Cobertura"
                    valor={pctTxt(parcela.cobertura)}
                    nota="Kg analizados ÷ kg entrados de la parcela"
                  />
                  <Fila
                    concepto="Kg pesados por el calibrador"
                    valor={kgTxt(parcela.resumen.kgSizer)}
                    nota="La base de todos los porcentajes de abajo. Pesa más que la báscula (tara, +7,80 % de media en la campaña)"
                    destacado
                  />
                  <Fila
                    concepto="Exportación"
                    valor={pctTxt(parcela.resumen.pctExportacion)}
                    nota="Extra 1/2, Cat1 A/B y Verde Claro, sobre lo que pesó el calibrador"
                  />
                  <Fila
                    concepto="No exportación"
                    valor={pctTxt(parcela.resumen.pctNoExportacion)}
                    nota="Cat 2, Cat 3 y Verde Oscuro"
                  />
                  <Fila
                    concepto="A repaso manual"
                    valor={pctTxt(parcela.resumen.pctMujeres)}
                    nota="Fruta que la máquina desvía a la mesa de repaso"
                  />
                  <Fila
                    concepto="No comercial"
                    valor={pctTxt(parcela.resumen.pctNoComercial)}
                    nota="Industria, podrido y densidad: fruta que no se vende en fresco"
                  />
                  <Fila
                    concepto="Podrido en el calibrador"
                    valor={`${kgTxt(parcela.resumen.kgPodrido)} · ${pctTxt(parcela.resumen.pctPodrido)}`}
                    nota="Solo el que descarta la máquina; lo que se tira a mano antes de la línea no se ve aquí"
                  />
                  <Fila
                    concepto="Fue a Mercadona"
                    valor={`${pctTxt(parcela.resumen.pctMdna)} · ${kgTxt(parcela.resumen.mdnaTotal)}`}
                    nota="Kg clasificados en un producto de Mercadona, sobre lo que pesó el calibrador"
                    destacado
                  />
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {data && data.compuestasEnCola.length > 0 && (
        <Card className="border-amber-500/40 bg-amber-500/10">
          <CardContent className="flex items-start gap-2 p-4 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <span>
              {data.compuestasEnCola.length === 1
                ? "Una pasada de esta parcela mezcló varios lotes y todavía no se ha repartido: sus kg están enteros en el primer código, así que este reparto no es exacto."
                : `${formatNumber(data.compuestasEnCola.length)} pasadas de esta parcela mezclaron varios lotes y todavía no se han repartido: sus kg están enteros en el primer código, así que este reparto no es exacto.`}
            </span>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

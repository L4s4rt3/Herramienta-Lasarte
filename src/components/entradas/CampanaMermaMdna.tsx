// Entradas → pestaña "Campaña": pérdida y Mercadona por productor y finca.
//
// Es la versión en pantalla de scripts/analisis-mermas-mercadona.ts (el Excel
// que dirección pedía cada dos por tres). Mismas funciones, mismos números:
// ver useCampanaMermaMdna.ts. Aquí solo se pinta.
//
// Cómo se lee:
// - Arriba, la cascada del año: entrada → merma de cámara → podrido de tría →
//   podrido de calibrador → pérdida total (kg, % y €), y qué parte fue a
//   Mercadona por formato.
// - Debajo, el ranking por productor o por finca, con dos juegos de columnas:
//   PÉRDIDA (peor % primero) o MERCADONA (mayor % sobre entrada primero).
// - Al pie, el contraste del podrido pre-calibrador por mes (pesado vs
//   asumido) y los lotes que se dejan fuera y por qué.
import { useMemo, useState } from "react";
import { AlertTriangle, Download, Info, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { formatDateTime, formatEuro, formatKg, formatNumber, formatPct } from "@/lib/format";
import { errorMessage } from "@/lib/errorMessage";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthProvider";
import { useCampanaMermaMdna } from "@/hooks/useCampanaMermaMdna";
import { exportarCampanaMermaMdna } from "@/lib/exportCampanaMermaMdna";
import { LABEL_MDNA, METODOS_MDNA } from "@/lib/mdnaMix";
import { metricasMdna, metricasPerdida, type GrupoMermaMdna } from "@/lib/mermaMdnaAgregado";

type Dimension = "productor" | "productor_finca";
type Bloque = "perdida" | "mdna";

const pctTxt = (v: number | null | undefined) => (v == null ? "—" : formatPct(v));
const kgTxt = (v: number | null | undefined) => (v == null ? "—" : formatKg(v));
const eurTxt = (v: number | null | undefined) => (v == null ? "—" : formatEuro(v, 0));

function Kpi({ titulo, valor, detalle, tono }: { titulo: string; valor: string; detalle?: string; tono?: "rojo" | "ambar" | "verde" }) {
  return (
    <div className="rounded-xl border bg-card p-3">
      <p className="text-xs text-muted-foreground">{titulo}</p>
      <p className={cn("text-xl font-semibold tabular-nums", tono === "rojo" && "text-red-600 dark:text-red-400", tono === "ambar" && "text-amber-600 dark:text-amber-400", tono === "verde" && "text-emerald-600 dark:text-emerald-400")}>{valor}</p>
      {detalle && <p className="text-xs text-muted-foreground">{detalle}</p>}
    </div>
  );
}

function FilaPerdida({ g, conFinca, esTotal }: { g: GrupoMermaMdna; conFinca: boolean; esTotal?: boolean }) {
  const m = metricasPerdida(g);
  const pct = m.pctPerdida;
  return (
    <TableRow className={cn(esTotal && "bg-muted/40 font-semibold")}>
      <TableCell className="whitespace-nowrap">{m.productor}</TableCell>
      {conFinca && <TableCell className="whitespace-nowrap">{m.finca ?? "—"}</TableCell>}
      <TableCell className="text-right">{formatNumber(m.nLotes)}<span className="text-muted-foreground"> / {formatNumber(m.nLotesConMerma)}</span></TableCell>
      <TableCell className="text-right">{kgTxt(m.kgEntradaTotal)}</TableCell>
      <TableCell className="text-right">{m.diasMedio == null ? "—" : formatNumber(m.diasMedio, 1)}</TableCell>
      <TableCell className="text-right">{kgTxt(m.mermaCamaraKg)}<span className="text-muted-foreground"> · {pctTxt(m.pctMermaCamara)}</span></TableCell>
      <TableCell className="text-right">{kgTxt(m.podridoPreKg)}<span className="text-muted-foreground"> · {pctTxt(m.pctPodridoPre)}</span></TableCell>
      <TableCell className="text-right">{kgTxt(m.podridoCalibradorKg)}<span className="text-muted-foreground"> · {pctTxt(m.pctPodridoCalibrador)}</span></TableCell>
      <TableCell className="text-right font-medium">{kgTxt(m.perdidaKg)}</TableCell>
      <TableCell className={cn("text-right font-semibold", pct != null && pct > 5 && "text-red-600 dark:text-red-400", pct != null && pct > 3 && pct <= 5 && "text-amber-600 dark:text-amber-400")}>{pctTxt(pct)}</TableCell>
      <TableCell className="text-right">{eurTxt(m.perdidaEur)}<span className="text-muted-foreground"> · {pctTxt(m.pctPerdidaCoste)}</span></TableCell>
    </TableRow>
  );
}

function FilaMdna({ g, conFinca, esTotal }: { g: GrupoMermaMdna; conFinca: boolean; esTotal?: boolean }) {
  const m = metricasMdna(g);
  return (
    <TableRow className={cn(esTotal && "bg-muted/40 font-semibold")}>
      <TableCell className="whitespace-nowrap">{m.productor}</TableCell>
      {conFinca && <TableCell className="whitespace-nowrap">{m.finca ?? "—"}</TableCell>}
      <TableCell className="text-right">{formatNumber(m.nLotes)}{m.nLotesSinClasificacion > 0 && <span className="text-muted-foreground"> ({m.nLotesSinClasificacion} sin informe)</span>}</TableCell>
      <TableCell className="text-right">{kgTxt(m.kgEntradaTotal)}</TableCell>
      <TableCell className="text-right">{pctTxt(m.pctExportacion)}</TableCell>
      <TableCell className="text-right">{pctTxt(m.pctClaseApta)}</TableCell>
      <TableCell className="text-right">{kgTxt(m.mdna3)}<span className="text-muted-foreground"> · {pctTxt(m.pctMdna3)}</span></TableCell>
      <TableCell className="text-right">{kgTxt(m.mdna4)}<span className="text-muted-foreground"> · {pctTxt(m.pctMdna4)}</span></TableCell>
      <TableCell className="text-right">{kgTxt(m.mdna5)}<span className="text-muted-foreground"> · {pctTxt(m.pctMdna5)}</span></TableCell>
      <TableCell className="text-right">{kgTxt(m.mdna12)}<span className="text-muted-foreground"> · {pctTxt(m.pctMdna12)}</span></TableCell>
      <TableCell className="text-right font-medium">{kgTxt(m.mdnaTotalAjustado)}</TableCell>
      <TableCell className="text-right font-semibold">{pctTxt(m.pctMdnaSobreEntrada)}</TableCell>
      <TableCell className="text-right">{kgTxt(m.kgAptoNoMdna)}</TableCell>
    </TableRow>
  );
}

export default function CampanaMermaMdna() {
  const [dimension, setDimension] = useState<Dimension>("productor");
  const [bloque, setBloque] = useState<Bloque>("perdida");
  const [incluirImportacion, setIncluirImportacion] = useState(false);
  const [exportando, setExportando] = useState(false);
  const { user } = useAuth();
  const { data, isLoading, error } = useCampanaMermaMdna({ incluirImportacion });

  const grupos = useMemo(() => {
    if (!data) return [];
    if (bloque === "perdida") return dimension === "productor" ? data.porProductor : data.porFinca;
    return dimension === "productor" ? data.porProductorMdna : data.porFincaMdna;
  }, [data, dimension, bloque]);

  // El Excel es ESTA pantalla, no un cálculo nuevo: se arma con el `data` que
  // el hook ya tiene en memoria (mismas hojas que
  // scripts/analisis-mermas-mercadona.ts), así que no vuelve a tocar la base y
  // sale al instante. El interruptor de importación viaja con él porque cambia
  // los totales; el propio fichero lo dice en la banda de marca y en
  // «Metodología», para que dos exportaciones distintas no se confundan.
  const handleExportar = async () => {
    if (!data) return;
    setExportando(true);
    try {
      await exportarCampanaMermaMdna(data, { incluirImportacion, usuario: user?.email ?? null });
      toast({
        title: "Excel generado",
        description: `${formatNumber(data.filas.length)} lotes en 9 hojas: cascada, rankings de pérdida y Mercadona, podrido por mes, cierre pendiente, detalle por lote y metodología.`,
      });
    } catch (e) {
      toast({ title: "No se pudo exportar", description: errorMessage(e), variant: "destructive" });
    } finally {
      setExportando(false);
    }
  };

  if (error) {
    return (
      <Card><CardContent className="flex items-center gap-2 p-4 text-sm text-red-600"><AlertTriangle className="h-4 w-4" /> No se pudo calcular la campaña: {errorMessage(error)}</CardContent></Card>
    );
  }
  if (isLoading || !data) {
    return <div className="space-y-3"><Skeleton className="h-24 w-full" /><Skeleton className="h-64 w-full" /></div>;
  }

  const t = metricasPerdida(data.total);
  const md = metricasMdna(data.total);
  const conFinca = dimension === "productor_finca";
  const kgImportacion = data.importacion.reduce((s, f) => s + f.kgEntrada, 0);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Kpi titulo="Entrada de campaña" valor={kgTxt(t.kgEntradaTotal)} detalle={`${formatNumber(t.nLotes)} lotes · ${formatNumber(t.nLotesConMerma)} terminados`} />
        <Kpi titulo="Merma de cámara" valor={pctTxt(t.pctMermaCamara)} detalle={`${kgTxt(t.mermaCamaraKg)} · ${t.diasMedio == null ? "—" : formatNumber(t.diasMedio, 1)} días medios`} />
        <Kpi titulo="Podrido pre-calibrador" valor={pctTxt(t.pctPodridoPre)} detalle={kgTxt(t.podridoPreKg)} />
        <Kpi titulo="Podrido calibrador" valor={pctTxt(t.pctPodridoCalibrador)} detalle={`${kgTxt(t.podridoCalibradorKg)} · ${formatNumber(t.nLotesPodridoReal)} lotes con dato real`} />
        <Kpi titulo="PÉRDIDA TOTAL" valor={pctTxt(t.pctPerdida)} detalle={`${kgTxt(t.perdidaKg)} · ${eurTxt(t.perdidaEur)} (${pctTxt(t.pctPerdidaCoste)} del coste)`} tono={t.pctPerdida == null ? undefined : t.pctPerdida > 5 ? "rojo" : t.pctPerdida > 3 ? "ambar" : "verde"} />
        <Kpi titulo="Mercadona sobre entrada" valor={pctTxt(md.pctMdnaSobreEntrada)} detalle={`${kgTxt(md.mdnaTotalAjustado)} · ${METODOS_MDNA.map((m) => `${LABEL_MDNA[m].split(" ")[0]} ${pctTxt(md[m === "MA3KGC" ? "pctMdna3" : m === "MA4KGC" ? "pctMdna4" : m === "MA5KGC" ? "pctMdna5" : "pctMdna12"])}`).join(" · ")}`} />
      </div>

      <Card>
        <CardHeader className="pb-2">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle className="text-base">Ranking de campaña</CardTitle>
            <div className="flex flex-wrap items-center gap-3">
              <ToggleGroup type="single" value={bloque} onValueChange={(v) => v && setBloque(v as Bloque)} variant="outline" size="sm">
                <ToggleGroupItem value="perdida">Pérdida</ToggleGroupItem>
                <ToggleGroupItem value="mdna">Mercadona</ToggleGroupItem>
              </ToggleGroup>
              <ToggleGroup type="single" value={dimension} onValueChange={(v) => v && setDimension(v as Dimension)} variant="outline" size="sm">
                <ToggleGroupItem value="productor">Por productor</ToggleGroupItem>
                <ToggleGroupItem value="productor_finca">Por finca</ToggleGroupItem>
              </ToggleGroup>
              <div className="flex items-center gap-2">
                <Switch id="imp" checked={incluirImportacion} onCheckedChange={setIncluirImportacion} />
                <Label htmlFor="imp" className="text-xs">Incluir importación ({kgTxt(kgImportacion)})</Label>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={handleExportar}
                disabled={exportando || data.filas.length === 0}
                title="Excel con marca Lasarte Cítricos: la cascada del kg, los rankings por productor y finca, el podrido por mes, los lotes que faltan por cerrar, el detalle por lote y la metodología. Respeta el interruptor de importación."
              >
                {exportando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                Exportar Excel
              </Button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            {bloque === "perdida"
              ? "% de merma de cámara y podrido de tría sobre la entrada de los lotes terminados; % de podrido de calibrador y de pérdida total sobre esa entrada más lo ya pasado por línea de los lotes a medias (decisión del dueño 06-08-2026). Ordenado por peor % de pérdida."
              : "Kg del informe del calibrador llevados a los kg conciliados de cada lote; % de cada formato sobre la entrada. Ordenado por mayor % a Mercadona."}
          </p>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <Table>
            <TableHeader>
              {bloque === "perdida" ? (
                <TableRow>
                  <TableHead>Productor</TableHead>{conFinca && <TableHead>Finca</TableHead>}
                  <TableHead className="text-right">Lotes / termin.</TableHead><TableHead className="text-right">Kg entrada</TableHead>
                  <TableHead className="text-right">Días cámara</TableHead><TableHead className="text-right">Merma cámara</TableHead>
                  <TableHead className="text-right">Podrido tría</TableHead><TableHead className="text-right">Podrido calibr.</TableHead>
                  <TableHead className="text-right">Pérdida kg</TableHead><TableHead className="text-right">% pérdida</TableHead><TableHead className="text-right">Pérdida € · % coste</TableHead>
                </TableRow>
              ) : (
                <TableRow>
                  <TableHead>Productor</TableHead>{conFinca && <TableHead>Finca</TableHead>}
                  <TableHead className="text-right">Lotes</TableHead><TableHead className="text-right">Kg entrada</TableHead>
                  <TableHead className="text-right">% export.</TableHead><TableHead className="text-right">% aptas A-F</TableHead>
                  {METODOS_MDNA.map((m) => <TableHead key={m} className="text-right">{LABEL_MDNA[m]}</TableHead>)}
                  <TableHead className="text-right">Total MDNA</TableHead><TableHead className="text-right">% s/ entrada</TableHead><TableHead className="text-right">Apto no MDNA</TableHead>
                </TableRow>
              )}
            </TableHeader>
            <TableBody>
              {bloque === "perdida"
                ? <FilaPerdida g={data.total} conFinca={conFinca} esTotal />
                : <FilaMdna g={data.total} conFinca={conFinca} esTotal />}
              {grupos.map((g) => bloque === "perdida"
                ? <FilaPerdida key={`${g.productorKey}::${g.finca ?? ""}`} g={g} conFinca={conFinca} />
                : <FilaMdna key={`${g.productorKey}::${g.finca ?? ""}`} g={g} conFinca={conFinca} />)}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Podrido pre-calibrador por mes: pesado vs asumido</CardTitle>
            <p className="text-xs text-muted-foreground">La bolsa se pesa a diario y las bateas al vaciarlas; ninguna se reparte por lote, así que el contraste solo vale por mes de proceso.</p>
          </CardHeader>
          <CardContent className="overflow-x-auto p-0">
            <Table>
              <TableHeader><TableRow>
                <TableHead>Mes</TableHead><TableHead className="text-right">Lotes</TableHead><TableHead className="text-right">Procesado</TableHead>
                <TableHead className="text-right">Tasa mes</TableHead><TableHead className="text-right">Asumido</TableHead><TableHead className="text-right">Esperado</TableHead>
                <TableHead className="text-right">Pesado (bolsa+bateas)</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {data.podridoPorMes.map((m) => (
                  <TableRow key={m.mes}>
                    <TableCell>{m.mes}</TableCell><TableCell className="text-right">{m.lotes}</TableCell><TableCell className="text-right">{kgTxt(m.procesado)}</TableCell>
                    <TableCell className="text-right">{formatPct(m.tasaMes)}</TableCell>
                    <TableCell className="text-right">{kgTxt(m.asumido)}<span className="text-muted-foreground"> · {pctTxt(m.pctAsumido)}</span></TableCell>
                    <TableCell className="text-right">{kgTxt(m.esperado)}</TableCell>
                    <TableCell className="text-right">{kgTxt(m.pesadoTotal)}{m.partesConDato > 0 && <span className="text-muted-foreground"> · {m.partesConDato} partes</span>}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Lo que se deja fuera, y por qué</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p><Badge variant="outline">{data.abiertos.length}</Badge> lotes <b>sin merma calculable</b>: siguen abiertos en la base. Su hueco no cuenta como pérdida hasta que se cierren (Entradas → cierre de lote). El Excel de campaña los simula cerrados; esta pantalla no, para no enseñar como hecho lo que no está decidido.
              {data.abiertos.length > 0 && <span className="block text-xs text-muted-foreground">{data.abiertos.slice(0, 12).map((f) => f.lote).join(", ")}{data.abiertos.length > 12 ? ` y ${data.abiertos.length - 12} más` : ""}</span>}
            </p>
            <p><Badge variant="outline">{data.imposibles.length}</Badge> lotes <b>imposibles</b> (perderían más de lo que entró, o tienen un ajuste de stock negativo a mano): apartados del año hasta arreglar el apunte.
              {data.imposibles.length > 0 && <span className="block text-xs text-muted-foreground">{data.imposibles.map((f) => f.lote).join(", ")}</span>}
            </p>
            <p><Badge variant="outline">{data.internas.length}</Badge> <b>movimientos internos</b> (precalibrado, confección/sobrante): no son productores.</p>
            <p><Badge variant="outline">{data.importacion.length}</Badge> lotes de <b>importación</b> ({kgTxt(kgImportacion)}): otro negocio, fuera salvo que se marque arriba.</p>
            <p className="flex items-start gap-2 text-xs text-muted-foreground"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Mix de clasificación de {formatNumber(data.lotesConMix)} lotes, de la vista canónica del calibrador (volcado + Excel + informes DOCX), agregado en servidor a las {data.mixRefrescadoEn ? formatDateTime(data.mixRefrescadoEn) : "—"} (se refresca cada hora). El resto de cifras salen de las mismas funciones que la pestaña «Mermas y coste».
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

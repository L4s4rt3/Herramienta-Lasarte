// Análisis → Por productor → "Aprovechamiento real por parcela".
//
// Es la versión en pantalla de scripts/informe-aprovechamiento-invermarmelo.ts,
// para cualquier finca y parcela. Mismas funciones, mismos números: ver
// useAprovechamientoReal.ts. Aquí solo se pinta.
//
// Cómo se lee:
// - Arriba, la finca y las parcelas que se comparan, y HASTA QUÉ DÍA llega cada
//   fuente (volcado SQL del Sizer, Word de lote, partes diarios). Si el volcado
//   va por detrás de los partes se avisa: lo procesado después entra por el
//   Word o no entra, y se dice cuánto.
// - El resumen: una columna por parcela (y el total). La BASE de todos los
//   porcentajes son los kg que pesó el calibrador; la báscula se enseña al lado.
// - Debajo, pestañas: clases y destinos, los 4 formatos de Mercadona, los
//   calibres de lo apto y a qué tornillo pueden ir, el detalle por lote y la
//   cobertura (cada lote sin dato, con su motivo), más la metodología.
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { AlertTriangle, Download, Info, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { formatDateTime, formatKg, formatNumber, formatPct } from "@/lib/format";
import { errorMessage } from "@/lib/errorMessage";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthProvider";
import { useAprovechamientoReal, type LoteReal, type ParcelaReal } from "@/hooks/useAprovechamientoReal";
import { exportarAprovechamientoReal } from "@/lib/exportAprovechamientoReal";
import { LABEL_MDNA, METODOS_MDNA } from "@/lib/mdnaMix";
import { LABEL_ESTADO_DATO, type EstadoDatoReal } from "@/lib/aprovechamientoReal";

const pctTxt = (v: number | null | undefined) => (v == null ? "—" : formatPct(v));
const kgTxt = (v: number | null | undefined) => (v == null ? "—" : formatKg(v));
const intTxt = (v: number | null | undefined) => (v == null ? "—" : formatNumber(v));
const diaTxt = (v: string | null | undefined) => (v ? v.slice(0, 10).split("-").reverse().join("/") : "—");

const TONO_ESTADO: Record<EstadoDatoReal, string> = {
  sql: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
  respaldo: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
  mixto: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
  pendiente_volcado: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200",
  sin_dato: "bg-muted text-muted-foreground",
};

function EstadoBadge({ estado }: { estado: EstadoDatoReal }) {
  return <Badge variant="outline" className={cn("border-transparent whitespace-nowrap", TONO_ESTADO[estado])}>{LABEL_ESTADO_DATO[estado]}</Badge>;
}

interface FilaResumen {
  concepto: string;
  valor: (p: ParcelaReal) => string;
  nota: string;
  destacado?: boolean;
  separador?: boolean;
}

const desfase = (p: ParcelaReal) => (p.kgEntradaConDato > 0 ? ((p.resumen.kgSizer - p.kgEntradaConDato) / p.kgEntradaConDato) * 100 : null);

const FILAS_RESUMEN: FilaResumen[] = [
  { concepto: "Lotes de la parcela", valor: (p) => intTxt(p.nLotes), nota: "Todos los lotes entrados por báscula" },
  { concepto: "Lotes con dato del calibrador", valor: (p) => intTxt(p.nConDato), nota: "Los demás no han pasado por línea: ver «Cobertura»" },
  { concepto: "Pasadas analizadas", valor: (p) => `${intTxt(p.resumen.pasadas)}${p.resumen.pasadasRespaldo > 0 ? ` (${p.resumen.pasadasRespaldo} del Word)` : ""}`, nota: "Una pasada = un código en el calibrador; el Word solo trae la última de cada día" },
  { concepto: "Kg entrada por báscula (todos los lotes)", valor: (p) => kgTxt(p.kgEntradaTotal), nota: "Referencia, NO la base de los porcentajes" },
  { concepto: "Kg entrada de los lotes analizados", valor: (p) => kgTxt(p.kgEntradaConDato), nota: "La parte de la parcela que ya ha pasado por línea" },
  { concepto: "Cobertura", valor: (p) => pctTxt(p.cobertura), nota: "Kg analizados sobre kg entrados" },
  { concepto: "KG PESADOS POR EL CALIBRADOR", valor: (p) => kgTxt(p.resumen.kgSizer), nota: "★ LA BASE de todos los porcentajes de abajo", destacado: true, separador: true },
  { concepto: "Desfase calibrador vs báscula", valor: (p) => pctTxt(desfase(p)), nota: "Sistemático en toda la campaña (+7,80 % en 904 lotes): tara, no fruta de otro sitio" },
  { concepto: "Del Word de lote (respaldo)", valor: (p) => kgTxt(p.resumen.kgRespaldo), nota: "Kg cuyo desglose viene del Word porque el volcado SQL no cubre ese día" },
  { concepto: "% exportación", valor: (p) => pctTxt(p.resumen.pctExportacion), nota: "Extra 1/2, Cat1 A/B y Verde Claro", separador: true },
  { concepto: "% no exportación", valor: (p) => pctTxt(p.resumen.pctNoExportacion), nota: "Cat 2, Cat 3 y Verde Oscuro" },
  { concepto: "% mujeres", valor: (p) => pctTxt(p.resumen.pctMujeres), nota: "Fruta desviada a repaso manual" },
  { concepto: "% no comercial", valor: (p) => pctTxt(p.resumen.pctNoComercial), nota: "Industria, podrido y densidad" },
  { concepto: "Podrido en el calibrador", valor: (p) => `${kgTxt(p.resumen.kgPodrido)} · ${pctTxt(p.resumen.pctPodrido)}`, nota: "Solo el que descarta la máquina: la tría previa no se ve aquí" },
  { concepto: "% clases aptas para Mercadona (A–F)", valor: (p) => pctTxt(p.resumen.pctApta), nota: "Techo teórico de lo que Mercadona podría aceptar", separador: true },
  ...METODOS_MDNA.map((m): FilaResumen => ({
    concepto: `Mercadona · ${LABEL_MDNA[m]}`,
    valor: (p) => `${pctTxt(p.resumen.pctMdnaFormato[m])} · ${kgTxt(p.resumen.mdna[m])}`,
    nota: "% sobre lo pesado y kg reales clasificados en ese producto",
  })),
  { concepto: "Mercadona · sin formato en el nombre", valor: (p) => `${pctTxt(p.resumen.pctMdnaSinFormato)} · ${kgTxt(p.resumen.mdnaSinFormato)}`, nota: "Dice MDNA pero no declara formato: no se reparte a ojo" },
  { concepto: "% MERCADONA TOTAL", valor: (p) => `${pctTxt(p.resumen.pctMdna)} · ${kgTxt(p.resumen.mdnaTotal)}`, nota: "★ EL APROVECHAMIENTO DE MERCADONA de la parcela", destacado: true },
  { concepto: "Apto A–F que NO fue a Mercadona", valor: (p) => `${pctTxt(p.resumen.pctAptoFuera)} · ${kgTxt(p.resumen.kgAptoFuera)}`, nota: "Fruta con calidad de Mercadona vendida a otros clientes" },
];

function FilaLote({ l }: { l: LoteReal }) {
  const r = l.resumen!;
  return (
    <TableRow>
      <TableCell className="whitespace-nowrap">{l.parcela ? l.parcela : "(sin parcela)"}</TableCell>
      <TableCell className="font-mono text-xs">{l.lote8}</TableCell>
      <TableCell className="whitespace-nowrap">{diaTxt(l.fecha)}</TableCell>
      <TableCell className="text-right">{intTxt(l.pasadas)}</TableCell>
      <TableCell className="text-right">{kgTxt(l.kgEntrada)}</TableCell>
      <TableCell className="text-right font-medium">{kgTxt(r.kgSizer)}</TableCell>
      <TableCell className="text-right">{pctTxt(l.desfase)}</TableCell>
      <TableCell className="text-right">{pctTxt(r.pctExportacion)}</TableCell>
      <TableCell className="text-right">{pctTxt(r.pctNoExportacion)}</TableCell>
      <TableCell className="text-right">{pctTxt(r.pctMujeres)}</TableCell>
      <TableCell className="text-right">{pctTxt(r.pctNoComercial)}</TableCell>
      <TableCell className="text-right">{kgTxt(r.kgPodrido)}<span className="text-muted-foreground"> · {pctTxt(r.pctPodrido)}</span></TableCell>
      {METODOS_MDNA.map((m) => <TableCell key={m} className="text-right">{kgTxt(r.mdna[m])}</TableCell>)}
      <TableCell className="text-right font-medium">{kgTxt(r.mdnaTotal)}</TableCell>
      <TableCell className="text-right font-semibold">{pctTxt(r.pctMdna)}</TableCell>
    </TableRow>
  );
}

export default function AprovechamientoRealParcela() {
  const [params, setParams] = useSearchParams();
  const [exportando, setExportando] = useState(false);
  const { user } = useAuth();
  const fincaParam = params.get("finca");
  const parcelasParam = params.get("parcelas");
  const parcelas = useMemo(() => (parcelasParam == null ? null : parcelasParam.split("|").map((p) => (p === "~" ? "" : p))), [parcelasParam]);

  const { arbol, data, isLoading, error } = useAprovechamientoReal({ finca: fincaParam, parcelas: parcelas ?? [] });
  const fincaActual = useMemo(() => arbol.find((f) => f.finca === fincaParam) ?? null, [arbol, fincaParam]);

  const elegir = (finca: string, ps: string[] | null) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("finca", finca);
      if (ps == null) next.delete("parcelas");
      else next.set("parcelas", ps.map((p) => (p === "" ? "~" : p)).join("|"));
      return next;
    }, { replace: true });
  };

  // Sin finca en la URL: la de más kg. Sin parcelas: todas las de la finca.
  useEffect(() => {
    if (arbol.length === 0) return;
    if (!fincaParam || !fincaActual) {
      elegir(arbol[0].finca, arbol[0].parcelas.map((p) => p.parcela));
    } else if (parcelas == null) {
      elegir(fincaActual.finca, fincaActual.parcelas.map((p) => p.parcela));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arbol, fincaParam, fincaActual, parcelas]);

  const columnas = useMemo(() => (data ? (data.parcelas.length > 1 ? [...data.parcelas, { ...data.total, etiqueta: "TOTAL" }] : data.parcelas) : []), [data]);
  const lotesConDato = data?.lotes.filter((l) => l.resumen) ?? [];

  // El Excel es ESTA pantalla, no un cálculo nuevo: se arma con el `data` que
  // el hook ya tiene en memoria (mismas hojas que
  // scripts/informe-aprovechamiento-invermarmelo.ts, pero para la finca y las
  // parcelas elegidas aquí), así que no vuelve a tocar la base. La finca va
  // aparte porque es la que da nombre al fichero y encabeza la banda de marca.
  const handleExportar = async () => {
    if (!data || !fincaParam) return;
    setExportando(true);
    try {
      await exportarAprovechamientoReal(data, { finca: fincaParam, usuario: user?.email ?? null });
      toast({
        title: "Excel generado",
        description: `${intTxt(data.parcelas.length)} parcela(s) · ${intTxt(lotesConDato.length)} lote(s) con dato del calibrador, en 7 hojas: resumen, clases, Mercadona, calibres, detalle, cobertura y metodología.`,
      });
    } catch (e) {
      toast({ title: "No se pudo exportar", description: errorMessage(e), variant: "destructive" });
    } finally {
      setExportando(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center gap-3">
            <CardTitle className="text-base">Aprovechamiento real por parcela</CardTitle>
            <Select value={fincaParam ?? ""} onValueChange={(v) => elegir(v, null)}>
              <SelectTrigger className="h-9 w-full sm:w-80"><SelectValue placeholder="Finca" /></SelectTrigger>
              <SelectContent>
                {arbol.map((f) => (
                  <SelectItem key={f.finca} value={f.finca}>
                    {f.finca}{f.productor && f.productor !== f.finca ? ` · ${f.productor}` : ""} ({f.lotes} lotes)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {fincaActual && (
              <ToggleGroup type="multiple" value={parcelas ?? []} onValueChange={(v) => elegir(fincaActual.finca, v)} variant="outline" size="sm" className="flex-wrap justify-start">
                {fincaActual.parcelas.map((p) => (
                  <ToggleGroupItem key={p.parcela || "~"} value={p.parcela} className="text-xs">
                    {p.etiqueta} <span className="ml-1 text-muted-foreground">({p.lotes})</span>
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            )}
            <Button
              variant="outline"
              size="sm"
              className="sm:ml-auto"
              onClick={handleExportar}
              disabled={exportando || isLoading || !data || !fincaParam || data.lotes.length === 0}
              title="Excel con marca Lasarte Cítricos: el resumen por parcela, las clases y destinos, los 4 formatos de Mercadona, los calibres, el detalle por lote, la cobertura y la metodología. Solo la finca y las parcelas elegidas aquí."
            >
              {exportando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
              Exportar Excel
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Medido, no estimado: cada kg que clasificó el calibrador se atribuye al lote de su pasada. Los porcentajes van sobre los kg que pesó la máquina, no sobre la báscula.
            {fincaActual && fincaActual.parcelas.length === 1 && fincaActual.parcelas[0].parcela === "" && " Esta finca entra sin parcela en la báscula: se analiza entera."}
          </p>
        </CardHeader>
        {data && (
          <CardContent className="space-y-2 pt-0">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>Volcado SQL del Sizer hasta <b>{diaTxt(data.frescura.ultimaPasadaSizer)}</b> (sincronizado {diaTxt(data.frescura.ultimaSincronizacion)})</span>
              <span>· Word de lote hasta <b>{diaTxt(data.frescura.ultimoInformeDocx)}</b></span>
              <span>· partes diarios hasta <b>{diaTxt(data.frescura.ultimoParte)}</b></span>
              {data.refrescadoEn && <span>· detalle refrescado {formatDateTime(data.refrescadoEn)}</span>}
            </div>
            {data.frescura.volcadoAtrasado && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  El volcado SQL del calibrador va por detrás de los partes ({diaTxt(data.frescura.ultimaPasadaSizer)} frente a {diaTxt(data.frescura.ultimoParte)}). Lo procesado después entra con el Word de lote ({kgTxt(data.total.resumen.kgRespaldo)} en total), que trae solo la última pasada de cada día.
                  {data.pendientesVolcado.length > 0
                    ? ` Quedan ${data.pendientesVolcado.length} lote(s) sin ninguna de las dos fuentes: ${data.pendientesVolcado.map((l) => l.lote8).join(", ")} (${kgTxt(data.pendientesVolcado.reduce((s, l) => s + (l.kgEnParte ?? 0), 0))} según el parte). Ver «Cobertura».`
                    : " Ningún lote de estas parcelas se queda sin desglose."}
                </div>
              </div>
            )}
            {data.compuestas.length > 0 && (
              <div className="flex items-start gap-2 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-800 dark:bg-red-950/40 dark:text-red-100">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  {data.compuestas.length} pasada(s) nombran más de un lote y sus kg NO son atribuibles a una parcela: {data.compuestas.map((c) => `«${c.nombre}» (${c.fuente})`).join(", ")}. El calibrador los ha cargado enteros al primer código; para esas parcelas esto no es "real".
                </div>
              </div>
            )}
          </CardContent>
        )}
      </Card>

      {error && (
        <Card><CardContent className="flex items-center gap-2 p-4 text-sm text-red-600"><AlertTriangle className="h-4 w-4" /> No se pudo calcular: {errorMessage(error)}</CardContent></Card>
      )}
      {!error && (isLoading || (!data && fincaParam)) && <div className="space-y-3"><Skeleton className="h-64 w-full" /><Skeleton className="h-40 w-full" /></div>}

      {data && (
        <>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Resumen</CardTitle></CardHeader>
            <CardContent className="overflow-x-auto p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-[16rem]">Concepto</TableHead>
                    {columnas.map((c) => <TableHead key={c.parcela} className="text-right whitespace-nowrap">{c.etiqueta}</TableHead>)}
                    <TableHead className="min-w-[18rem]">Qué significa</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {FILAS_RESUMEN.map((f) => (
                    <TableRow key={f.concepto} className={cn(f.destacado && "bg-muted/40 font-semibold", f.separador && "border-t-2")}>
                      <TableCell className="whitespace-nowrap">{f.concepto}</TableCell>
                      {columnas.map((c) => <TableCell key={c.parcela} className="text-right tabular-nums whitespace-nowrap">{f.valor(c)}</TableCell>)}
                      <TableCell className="text-xs text-muted-foreground">{f.nota}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Tabs defaultValue="clases">
            <TabsList className="flex-wrap h-auto">
              <TabsTrigger value="clases">Clases y destinos</TabsTrigger>
              <TabsTrigger value="mdna">Mercadona 4 formatos</TabsTrigger>
              <TabsTrigger value="calibres">Calibres</TabsTrigger>
              <TabsTrigger value="lotes">Detalle lotes ({lotesConDato.length})</TabsTrigger>
              <TabsTrigger value="cobertura">Cobertura ({data.lotes.length})</TabsTrigger>
              <TabsTrigger value="metodo">Metodología</TabsTrigger>
            </TabsList>

            <TabsContent value="clases">
              <Card><CardContent className="overflow-x-auto p-0">
                <Table>
                  <TableHeader><TableRow><TableHead>Parcela</TableHead><TableHead>Destino</TableHead><TableHead>Clase</TableHead><TableHead>Apta MDNA</TableHead><TableHead className="text-right">Kg</TableHead><TableHead className="text-right">% sobre lo pesado</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {data.parcelas.flatMap((p) => p.clases.map((c) => (
                      <TableRow key={`${p.parcela}|${c.clase}`}>
                        <TableCell className="whitespace-nowrap">{p.etiqueta}</TableCell>
                        <TableCell className="whitespace-nowrap">{c.destino}</TableCell>
                        <TableCell className="whitespace-nowrap">{c.letra ? `(${c.letra}) ` : ""}{c.clase}</TableCell>
                        <TableCell>{c.apta ? "SÍ" : "no"}</TableCell>
                        <TableCell className="text-right">{kgTxt(c.kg)}</TableCell>
                        <TableCell className="text-right">{pctTxt(c.pct)}</TableCell>
                      </TableRow>
                    )))}
                  </TableBody>
                </Table>
              </CardContent></Card>
            </TabsContent>

            <TabsContent value="mdna">
              <Card><CardContent className="overflow-x-auto p-0">
                <Table>
                  <TableHeader><TableRow><TableHead>Parcela</TableHead><TableHead>Formato</TableHead><TableHead className="text-right">Kg</TableHead><TableHead className="text-right">% sobre lo pesado</TableHead><TableHead className="text-right">% del total MDNA</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {data.parcelas.flatMap((p) => {
                      const r = p.resumen;
                      const fila = (formato: string, kg: number, pctSizer: number | null, pctMdna: number | null, destacado = false) => (
                        <TableRow key={`${p.parcela}|${formato}`} className={cn(destacado && "bg-muted/40 font-semibold")}>
                          <TableCell className="whitespace-nowrap">{p.etiqueta}</TableCell>
                          <TableCell className="whitespace-nowrap">{formato}</TableCell>
                          <TableCell className="text-right">{kgTxt(kg)}</TableCell>
                          <TableCell className="text-right">{pctTxt(pctSizer)}</TableCell>
                          <TableCell className="text-right">{pctTxt(pctMdna)}</TableCell>
                        </TableRow>
                      );
                      return [
                        ...METODOS_MDNA.map((m) => fila(`${LABEL_MDNA[m]} (${m})`, r.mdna[m], r.pctMdnaFormato[m], r.mdnaTotal > 0 ? (r.mdna[m] / r.mdnaTotal) * 100 : null)),
                        fila("Sin formato en el nombre", r.mdnaSinFormato, r.pctMdnaSinFormato, r.mdnaTotal > 0 ? (r.mdnaSinFormato / r.mdnaTotal) * 100 : null),
                        fila("TOTAL MERCADONA", r.mdnaTotal, r.pctMdna, r.mdnaTotal > 0 ? 100 : null, true),
                        fila("Apto A–F vendido a otros clientes", r.kgAptoFuera, r.pctAptoFuera, null),
                        fila("No apto para Mercadona", r.kgNoApta, r.pctNoApta, null),
                      ];
                    })}
                  </TableBody>
                </Table>
              </CardContent></Card>
            </TabsContent>

            <TabsContent value="calibres">
              <Card>
                <CardHeader className="pb-2"><p className="text-xs text-muted-foreground">Calibre de la fruta apta para Mercadona y a qué tornillo puede ir. Los rangos se solapan a propósito: esto no reparte kg, dice para qué sirve cada calibre.</p></CardHeader>
                <CardContent className="overflow-x-auto p-0">
                  <Table>
                    <TableHeader><TableRow><TableHead>Parcela</TableHead><TableHead>Calibre</TableHead><TableHead className="text-right">Kg aptos</TableHead><TableHead className="text-right">% de lo apto</TableHead><TableHead>Tornillos de Mercadona que admiten este calibre</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {data.parcelas.flatMap((p) => p.calibres.map((c) => (
                        <TableRow key={`${p.parcela}|${c.calibre}`}>
                          <TableCell className="whitespace-nowrap">{p.etiqueta}</TableCell>
                          <TableCell>{c.calibre}</TableCell>
                          <TableCell className="text-right">{kgTxt(c.kg)}</TableCell>
                          <TableCell className="text-right">{pctTxt(c.pctApta)}</TableCell>
                          <TableCell className="text-xs">{c.tornillos}</TableCell>
                        </TableRow>
                      )))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="lotes">
              <Card><CardContent className="overflow-x-auto p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Parcela</TableHead><TableHead>Lote</TableHead><TableHead>Entrada</TableHead><TableHead className="text-right">Pasadas</TableHead>
                      <TableHead className="text-right">Kg báscula</TableHead><TableHead className="text-right">Kg calibrador</TableHead><TableHead className="text-right">Desfase</TableHead>
                      <TableHead className="text-right">% export.</TableHead><TableHead className="text-right">% no export.</TableHead><TableHead className="text-right">% mujeres</TableHead><TableHead className="text-right">% no comercial</TableHead>
                      <TableHead className="text-right">Podrido</TableHead>
                      {METODOS_MDNA.map((m) => <TableHead key={m} className="text-right whitespace-nowrap">{LABEL_MDNA[m]}</TableHead>)}
                      <TableHead className="text-right">MDNA total</TableHead><TableHead className="text-right">% MDNA</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {lotesConDato.map((l) => <FilaLote key={l.lote8} l={l} />)}
                  </TableBody>
                </Table>
              </CardContent></Card>
            </TabsContent>

            <TabsContent value="cobertura">
              <Card>
                <CardHeader className="pb-2"><p className="text-xs text-muted-foreground">Cada lote de las parcelas elegidas: cuáles entran en el análisis y por qué los demás no. Nada se estima ni se rellena.</p></CardHeader>
                <CardContent className="overflow-x-auto p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Parcela</TableHead><TableHead>Lote</TableHead><TableHead>Entrada</TableHead><TableHead className="text-right">Kg báscula</TableHead><TableHead>Dato real</TableHead>
                        <TableHead className="text-right">Pasadas</TableHead><TableHead className="text-right">Kg calibrador</TableHead><TableHead className="text-right">Del Word</TableHead><TableHead className="text-right">Kg según parte (sin volcar)</TableHead><TableHead className="text-right">Desfase</TableHead><TableHead className="min-w-[24rem]">Motivo</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.lotes.map((l) => (
                        <TableRow key={l.lote8}>
                          <TableCell className="whitespace-nowrap">{l.parcela ? l.parcela : "(sin parcela)"}</TableCell>
                          <TableCell className="font-mono text-xs">{l.lote8}</TableCell>
                          <TableCell className="whitespace-nowrap">{diaTxt(l.fecha)}</TableCell>
                          <TableCell className="text-right">{kgTxt(l.kgEntrada)}</TableCell>
                          <TableCell><EstadoBadge estado={l.estado} /></TableCell>
                          <TableCell className="text-right">{intTxt(l.pasadas)}</TableCell>
                          <TableCell className="text-right">{kgTxt(l.kgSizer)}</TableCell>
                          <TableCell className="text-right">{kgTxt(l.kgRespaldo)}</TableCell>
                          <TableCell className="text-right">{kgTxt(l.kgEnParte)}</TableCell>
                          <TableCell className="text-right">{pctTxt(l.desfase)}</TableCell>
                          <TableCell className="text-xs">{l.motivo}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="metodo">
              <Card><CardContent className="space-y-3 p-4 text-sm">
                <Metodo titulo="Qué se ha medido">Las {intTxt(data.total.resumen.pasadas)} pasadas de calibrador de los {intTxt(data.total.nConDato)} lotes (de {intTxt(data.total.nLotes)}) que ya han pasado por línea. La fuente es la vista canónica del calibrador: el volcado SQL del Compac Sizer, que registra TODAS las pasadas de cada lote, y como respaldo el informe Word de lote, que solo trae la última de cada día. La regla es por lote y día: si ese lote-día está en el volcado, manda el volcado.</Metodo>
                <Metodo titulo="Por qué esto SÍ es real">Se comprueba pasada a pasada que ninguna nombra más de un lote ({data.compuestas.length} compuestas encontradas): cada kg que clasificó la máquina se atribuye directamente, sin prorrateo, sin conciliación y sin aplicar mezclas de otros lotes. Si aparece una pasada compuesta, se avisa arriba.</Metodo>
                <Metodo titulo="La base de los porcentajes">Los kg que pesó el CALIBRADOR ({kgTxt(data.total.resumen.kgSizer)} en las parcelas elegidas), no los de la báscula de entrada. Las dos básculas no coinciden (el calibrador pesa un +7,80 % de más en los 904 lotes de la campaña con volcado): como el desfase es sistemático y las pasadas son de un solo lote, es tara/calibración, no fruta de otro sitio. Calcular sobre la entrada daría cifras que suman más del 100 %.</Metodo>
                <Metodo titulo="Cobertura">{kgTxt(data.total.kgEntradaConDato)} analizados de {kgTxt(data.total.kgEntradaTotal)} entrados ({pctTxt(data.total.cobertura)}). Los lotes que faltan no se estiman ni se rellenan: cada uno tiene su motivo en «Cobertura».</Metodo>
                <Metodo titulo="Hasta qué día llega">Volcado SQL hasta {diaTxt(data.frescura.ultimaPasadaSizer)} (sincronizado {diaTxt(data.frescura.ultimaSincronizacion)}), Word de lote hasta {diaTxt(data.frescura.ultimoInformeDocx)}, partes diarios hasta {diaTxt(data.frescura.ultimoParte)}. {data.frescura.volcadoAtrasado ? `El volcado va por detrás: lo procesado después entra por el Word (${kgTxt(data.total.resumen.kgRespaldo)}). Lo que no tenga ninguna de las dos fuentes sale en «Cobertura» como pendiente de volcado, con sus kg del parte, y nunca como "en cámara".` : "Las fuentes están al mismo día."}</Metodo>
                <Metodo titulo="Qué NO dice">El podrido que se ve aquí es SOLO el que descarta la máquina. La tría que se retira antes de entrar al calibrador (bolsa y bateas) se pesa por día y no se puede repartir por lote, así que no aparece. Para la pérdida completa, con merma de cámara y podrido de tría, está Entradas → «Campaña».</Metodo>
                <Metodo titulo="Clases aptas y formatos">Aptas para Mercadona: Extra 1, Extra 2, Cat1 A, Cat1 B, Verde Claro y Cat 2 (letras A–F). El volcado del Sizer escribe la clase sin letra y el Word con ella: se casan con la misma tabla que usa la base. Los formatos ({METODOS_MDNA.map((m) => `${m} = ${LABEL_MDNA[m]}`).join(" · ")}) se leen del nombre del producto; lo que dice MDNA sin formato se cuenta aparte.</Metodo>
              </CardContent></Card>
            </TabsContent>
          </Tabs>
        </>
      )}

      {!isLoading && !error && fincaParam && parcelas && parcelas.length === 0 && (
        <Card><CardContent className="flex items-center gap-2 p-4 text-sm text-muted-foreground"><Info className="h-4 w-4" /> Elige al menos una parcela.</CardContent></Card>
      )}
    </div>
  );
}

function Metodo({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <div>
      <p className="font-medium">{titulo}</p>
      <p className="text-muted-foreground">{children}</p>
    </div>
  );
}

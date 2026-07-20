// src/pages/EconomicoCmv.tsx
// Sección "Económico → CMV": coste medio por kg VENDIDO del mes (escandallo
// completo) comparado contra el precio medio REAL de venta, con la gestión de
// los apuntes manuales mensuales (personal real de gestoría, transporte de
// salida, estructura, otros) que ningún otro módulo captura.
//
// Reglas conceptuales (NO romper, ver cabecera de src/lib/cmv.ts):
// - La merma/podrido no se suma como coste: entra sola al dividir entre kg
//   VENDIDOS. Se lee como diferencia entre €/kg comprado y CMV.
// - La comparación es contra pm_real (neto de comisión/transporte de venta),
//   nunca contra el precio bruto.
import { useMemo, useState } from "react";
import {
  AlertTriangle, Calculator, Euro, Info, Plus, Scale, ShieldAlert, Trash2, TrendingDown, TrendingUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { FuenteBadge } from "@/components/FuenteBadge";
import { KPICard } from "@/components/KPICard";
import { SelectorPeriodo } from "@/components/SelectorPeriodo";
import { EconomicoSubnav } from "@/components/economico/EconomicoSubnav";
import { toast } from "@/hooks/use-toast";
import {
  useCmvCostesMensuales,
  useCmvMes,
  type CmvCosteMensualRow,
  type CmvCostesMensuales,
} from "@/hooks/useCmv";
import {
  CMV_TIPOS_MANUALES,
  CMV_TIPO_HINT,
  CMV_TIPO_LABEL,
  formatMes,
  type CmvTipoCosteManual,
} from "@/lib/cmv";
import { errorMessage } from "@/lib/errorMessage";
import { formatEuro, formatEurKg, formatKg, formatNumber, today } from "@/lib/format";
import { periodoDeFecha, type PeriodoValue } from "@/lib/selectorPeriodo";

export default function EconomicoCmv() {
  const [periodo, setPeriodo] = useState<PeriodoValue>(() => periodoDeFecha("mes", today()));
  const mes = periodo.desde.slice(0, 7);

  // Instancia ÚNICA de useCmvCostesMensuales (antes se llamaba 3 veces: aquí,
  // dentro de useCmvMes y dentro de CostesManualesCard). Se pasa hacia abajo
  // por props para que solo exista una suscripción/mutación en memoria.
  const manuales = useCmvCostesMensuales();
  const cmv = useCmvMes(mes, manuales);
  const { resultado, avisos } = cmv;

  const [pendingDelete, setPendingDelete] = useState<CmvCosteMensualRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  const avisosLista = useMemo(() => {
    const lista: string[] = [];
    if (avisos.faltanImportesFruta) {
      lista.push("Hay kg comprados por báscula este mes SIN importe (lotes pendientes de factura): el coste de fruta está incompleto y el CMV sale más bajo de lo real.");
    }
    // Si el mes usa facturas reales de suministros, la estimación por tarifas
    // no participa en el escandallo y avisar de sus tarifas a 0 solo confunde.
    if (avisos.hayPrecioCeroTarifas && !resultado.usaSuministrosReales) {
      lista.push("Alguna tarifa de recursos (agua/luz/gasoil/químicos) está a 0 €: el coste de consumos está infravalorado. Revísalo en Económico → Precios, o registra abajo las facturas reales del mes como 'Suministros'.");
    }
    if (avisos.hayPrecioCeroEmpaque) {
      lista.push("Algún componente del envasado está a 0 €: el coste de envasado está infravalorado. Revísalo en Económico → Precios.");
    }
    if (avisos.kgEnvaseSinPrecio > 0) {
      lista.push(`${formatKg(avisos.kgEnvaseSinPrecio)} kg vendidos en formatos sin coste de envase configurado (granel 12 kg / girsac 4 kg): su material no está imputado.`);
    }
    if (avisos.personalEstimado) {
      lista.push("El personal usa la ESTIMACIÓN por asistencia (días presente × 8 h × coste/hora). Registra abajo el coste empresa real del mes (gestoría) para sustituirla.");
    }
    if (avisos.sinApuntesManuales) {
      lista.push("Este mes no tiene ningún apunte manual: sin estructura ni transporte de salida el CMV está incompleto y el margen parece mejor de lo que es.");
    }
    if (avisos.semanasMercadonaSinBaseIva > 0) {
      lista.push(`${avisos.semanasMercadonaSinBaseIva} semana(s) de Mercadona del mes sin base IVA cargada — excluidas de kg y facturación (el CMV del mes en curso está incompleto hasta que se importen).`);
    }
    return lista;
  }, [avisos, resultado.usaSuministrosReales]);

  // null cuando no hay kg vendidos (sin CMV que comparar): la card de margen
  // debe ir neutra, no "positiva" por defecto (ver KPICard más abajo).
  const margenPositivo = resultado.margenPorKg != null ? resultado.margenPorKg >= 0 : null;

  const handleDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await manuales.borrar.mutateAsync(pendingDelete.id);
      toast({ title: "Apunte eliminado" });
      setPendingDelete(null);
    } catch (error) {
      toast({ title: "Error al eliminar", description: errorMessage(error), variant: "destructive" });
    } finally {
      setDeleting(false);
    }
  };

  if (cmv.sinPermiso) {
    return (
      <div className="page-shell">
        <Header />
        <Card className="glass-accented">
          <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
            <ShieldAlert className="h-10 w-10 text-warning" />
            <div>
              <h2 className="text-xl font-semibold">Acceso restringido</h2>
              <p className="mt-2 max-w-md text-sm text-muted-foreground">
                Solo administración puede ver esta sección.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="page-shell">
      <Header />
      <EconomicoSubnav />

      {/* Selector de mes: el CMV es SIEMPRE mensual (las ventas de categoría y
          los apuntes de gestoría/estructura solo existen por meses). */}
      <div className="section-toolbar flex flex-wrap items-center gap-3">
        <SelectorPeriodo
          bare
          value={periodo}
          onChange={setPeriodo}
          modos={["mes"]}
          canNavigateNext={periodo.desde <= today()}
        />
      </div>

      {cmv.manualesTablesMissing && (
        <div className="flex items-center gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          La tabla de costes manuales del CMV todavía no existe en la base de datos (migración 20260717130000 pendiente).
          El escandallo se calcula sin personal real, transporte de salida ni estructura.
        </div>
      )}

      {cmv.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-32 rounded-2xl" />)}
        </div>
      ) : (
        <>
          {/* KPIs */}
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <KPICard
              label="CMV del mes"
              value={formatEurKg(resultado.cmvPorKg)}
              hint={`${formatEuro(resultado.costeTotal, 0)} de coste total`}
              icon={Calculator}
              labelInfo="Coste medio por kg VENDIDO: todos los costes del mes divididos entre los kg vendidos. La merma y el podrido entran solos por el denominador (kg vendidos, no comprados) — no se suman aparte."
            />
            <KPICard
              label="Precio medio real"
              value={formatEurKg(resultado.pmRealPorKg)}
              hint={`${formatEuro(resultado.facturacionReal, 0)} facturados (neto)`}
              icon={Euro}
              labelInfo="Facturación del mes neta de comisiones y transporte de VENTA (pm_real), dividida entre los kg vendidos. Es el precio contra el que hay que comparar el CMV, nunca el bruto."
            />
            <KPICard
              label="Margen por kg"
              value={formatEurKg(resultado.margenPorKg)}
              hint={
                margenPositivo == null
                  ? "Sin ventas registradas este mes"
                  : margenPositivo
                    ? "Se gana dinero por kg vendido"
                    : "Se PIERDE dinero por kg vendido"
              }
              trend={margenPositivo == null ? undefined : margenPositivo ? "up" : "down"}
              icon={margenPositivo == null ? Calculator : margenPositivo ? TrendingUp : TrendingDown}
              accent={margenPositivo == null ? undefined : margenPositivo ? "success" : "destructive"}
            />
            <KPICard
              label="Kg vendidos"
              value={`${formatKg(resultado.kgVendidos)} kg`}
              hint={`Margen total del mes: ${formatEuro(resultado.margenTotal, 0)}`}
              trend={resultado.margenTotal >= 0 ? "up" : "down"}
              icon={Scale}
              labelInfo="Mercadona (semanas prorrateadas por días del mes) + Categoría primera + Categoría segunda."
            />
          </div>

          {avisosLista.length > 0 && (
            <Card className="glass border-warning/30 bg-warning/6">
              <CardContent className="flex gap-3 pt-6">
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
                <ul className="space-y-1.5 text-sm text-muted-foreground">
                  {avisosLista.map((aviso) => <li key={aviso}>{aviso}</li>)}
                </ul>
              </CardContent>
            </Card>
          )}

          {/* Escandallo */}
          <Card className="glass">
            <CardHeader>
              <CardTitle className="text-base">Escandallo del mes — de qué se compone cada kg vendido</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Coste</TableHead>
                    <TableHead>Fuente</TableHead>
                    <TableHead className="text-right">Importe</TableHead>
                    <TableHead className="text-right">€/kg vendido</TableHead>
                    <TableHead className="text-right">% del coste</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {resultado.buckets.map((bucket) => (
                    <TableRow key={bucket.clave}>
                      <TableCell className="max-w-72 text-sm">{bucket.label}</TableCell>
                      <TableCell><FuenteBadge fuente={bucket.fuente} size="sm" /></TableCell>
                      <TableCell className="text-right tabular-nums">{formatEuro(bucket.importe)}</TableCell>
                      <TableCell className="text-right tabular-nums">{bucket.eurPorKg != null ? formatNumber(bucket.eurPorKg, 3) : "—"}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {bucket.pctCoste != null ? `${formatNumber(bucket.pctCoste, 1)} %` : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="font-semibold">
                    <TableCell>Total</TableCell>
                    <TableCell />
                    <TableCell className="text-right tabular-nums">{formatEuro(resultado.costeTotal)}</TableCell>
                    <TableCell className="text-right tabular-nums">{resultado.cmvPorKg != null ? formatNumber(resultado.cmvPorKg, 3) : "—"}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">100 %</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            {/* Ventas del mes (denominador) */}
            <Card className="glass">
              <CardHeader>
                <CardTitle className="text-base">Ventas del mes (denominador del CMV)</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Canal</TableHead>
                      <TableHead className="text-right">Kg</TableHead>
                      <TableHead className="text-right">Facturación neta</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <TableRow>
                      <TableCell className="text-sm">Mercadona <span className="text-xs text-muted-foreground">({cmv.mercadona.semanas} semanas, prorrateo por días)</span></TableCell>
                      <TableCell className="text-right tabular-nums">{formatKg(cmv.mercadona.kg)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatEuro(cmv.mercadona.facturacion, 0)}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="text-sm">Categoría primera</TableCell>
                      <TableCell className="text-right tabular-nums">{formatKg(cmv.primera.kilos)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatEuro(cmv.primera.facturacionReal, 0)}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="text-sm">Categoría segunda</TableCell>
                      <TableCell className="text-right tabular-nums">{formatKg(cmv.segunda.kilos)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatEuro(cmv.segunda.facturacionReal, 0)}</TableCell>
                    </TableRow>
                    <TableRow className="font-semibold">
                      <TableCell>Total</TableCell>
                      <TableCell className="text-right tabular-nums">{formatKg(resultado.kgVendidos)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatEuro(resultado.facturacionReal, 0)}</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
                {cmv.envasado.desglose.length > 0 && (
                  <p className="mt-3 text-xs text-muted-foreground">
                    Envasado imputado: {cmv.envasado.desglose.map((d) => `${d.metodo} ${formatNumber(d.mallas, 0)} mallas × ${formatNumber(d.costePorMalla, 4)} € = ${formatEuro(d.coste, 0)}`).join(" · ")}.
                  </p>
                )}
              </CardContent>
            </Card>

            {/* Costes manuales del mes */}
            <CostesManualesCard mes={mes} rows={cmv.manualesDelMes} manuales={manuales} onDelete={setPendingDelete} />
          </div>

          {/* Nota metodológica */}
          <Card className="glass">
            <CardContent className="flex gap-3 pt-6">
              <Info className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
              <div className="space-y-1.5 text-xs leading-relaxed text-muted-foreground">
                <p><strong className="text-foreground">La merma no se suma aparte.</strong> Los kg perdidos ya están pagados dentro de "Compra de fruta"; al dividir entre kg VENDIDOS la pérdida queda incorporada. Verla en detalle: Económico → Compra de fruta (forfait por productor).</p>
                <p><strong className="text-foreground">Comparación contra precio REAL.</strong> La facturación de categorías descuenta comisión y transporte de venta por cliente (pm_real); la de Mercadona incluye ajustes/abonos.</p>
                <p><strong className="text-foreground">La facturación del CMV es NETA</strong> (precio medio real tras comisiones/transporte) e incluye 1ª y 2ª categoría; el Panel económico muestra facturación BRUTA (base IVA) solo de Mercadona + 2ª — por eso los márgenes de esta página y los del Panel económico difieren.</p>
                <p><strong className="text-foreground">Límites de esta fase:</strong> el envasado solo se imputa a los packs 3/5 kg de Mercadona; la fruta CAMPO/CIT cuenta como coste (compra real) aunque su venta no pase por estos canales; Mercadona se prorratea por días cuando la semana cruza de mes.</p>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      <AlertDialog open={pendingDelete != null} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <AlertDialogContent className="glass-overlay">
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar este apunte?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete ? `${CMV_TIPO_LABEL[pendingDelete.tipo]} · ${formatEuro(pendingDelete.importe)}${pendingDelete.concepto ? ` · ${pendingDelete.concepto}` : ""}. Esta acción no se puede deshacer.` : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={deleting} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Header() {
  return (
    <header className="page-header">
      <div>
        <p className="panel-kicker flex items-center gap-1.5"><span className="h-1.5 w-1.5 shrink-0 rounded-full bg-seccion-texto" aria-hidden="true" />Económico</p>
        <h1 className="page-title">CMV — Coste medio por venta</h1>
        <p className="page-subtitle">Cuánto cuesta cada kg vendido y cuánto margen deja, mes a mes.</p>
      </div>
    </header>
  );
}

// ─── Gestión de apuntes manuales ─────────────────────────────────────────────

function CostesManualesCard({
  mes,
  rows,
  manuales,
  onDelete,
}: {
  mes: string;
  rows: CmvCosteMensualRow[];
  manuales: CmvCostesMensuales;
  onDelete: (row: CmvCosteMensualRow) => void;
}) {
  const [tipo, setTipo] = useState<CmvTipoCosteManual>("personal_real");
  const [concepto, setConcepto] = useState("");
  const [importe, setImporte] = useState("");
  const [notas, setNotas] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    const valor = Number(importe.replace(",", "."));
    if (!Number.isFinite(valor) || valor < 0) {
      toast({ title: "Importe no válido", description: "Introduce el importe del mes en euros (puede ser 0).", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      await manuales.crear.mutateAsync({
        mes,
        tipo,
        concepto: concepto.trim() || null,
        importe: valor,
        notas: notas.trim() || null,
      });
      toast({ title: "Apunte registrado", description: `${CMV_TIPO_LABEL[tipo]} · ${formatEuro(valor)} en ${formatMes(mes)}.` });
      setConcepto("");
      setImporte("");
      setNotas("");
    } catch (error) {
      toast({ title: "Error al guardar", description: errorMessage(error), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="glass">
      <CardHeader>
        <CardTitle className="text-base">Costes manuales de {formatMes(mes)}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {rows.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tipo</TableHead>
                <TableHead>Concepto</TableHead>
                <TableHead className="text-right">Importe</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="text-sm">{CMV_TIPO_LABEL[row.tipo]}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{row.concepto ?? "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatEuro(row.importe)}</TableCell>
                  <TableCell>
                    <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => onDelete(row)} aria-label="Eliminar apunte">
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <p className="text-sm text-muted-foreground">
            Sin apuntes este mes. Registra al menos el coste real de personal (gestoría), el transporte de salida y la estructura mensual.
          </p>
        )}

        <div className="space-y-3 rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg)] p-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="cmv-tipo">Tipo de coste</Label>
              <Select value={tipo} onValueChange={(value) => setTipo(value as CmvTipoCosteManual)}>
                <SelectTrigger id="cmv-tipo"><SelectValue /></SelectTrigger>
                <SelectContent className="glass-overlay">
                  {CMV_TIPOS_MANUALES.map((t) => (
                    <SelectItem key={t} value={t}>{CMV_TIPO_LABEL[t]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cmv-importe">Importe del mes (€)</Label>
              <Input id="cmv-importe" inputMode="decimal" placeholder="0,00" value={importe} onChange={(e) => setImporte(e.target.value)} />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">{CMV_TIPO_HINT[tipo]}</p>
          <div className="space-y-1.5">
            <Label htmlFor="cmv-concepto">Concepto (opcional)</Label>
            <Input id="cmv-concepto" placeholder="P. ej. Factura Transportes Pérez, 2ª quincena" value={concepto} onChange={(e) => setConcepto(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cmv-notas">Notas (opcional)</Label>
            <Textarea id="cmv-notas" rows={2} value={notas} onChange={(e) => setNotas(e.target.value)} />
          </div>
          <Button type="button" onClick={handleSubmit} disabled={saving} className="w-full sm:w-auto">
            <Plus className="mr-1.5 h-4 w-4" />
            Añadir a {formatMes(mes)}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// src/pages/EconomicoCostes.tsx
// Sección "Económico → Costes": cruza los consumos físicos del periodo elegido
// (Semana | Mes | Campaña) con las tarifas vigentes en cada fecha para dar un
// coste total, coste por kg producido y desglose por recurso.
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle, ArrowRight, ChevronDown, ChevronsUpDown, ChevronUp, Citrus, Download, Droplet, Euro, Fuel,
  FlaskConical, Package, Scale, ShieldAlert, Sparkles, Users, Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { FuenteBadge } from "@/components/FuenteBadge";
import { KPICard } from "@/components/KPICard";
import { ConsumoPeriodoSelector } from "@/components/consumos/ConsumoPeriodoSelector";
import { EconomicoSubnav } from "@/components/economico/EconomicoSubnav";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthProvider";
import { useCostesPeriodo, useCosteFruta } from "@/hooks/useEconomico";
import { useCostePersonal } from "@/hooks/useCostePersonal";
import { useCosteMallas } from "@/hooks/useCosteMallas";
import { useEntradasBascula } from "@/hooks/useEntradasBascula";
import { useLimpiezaBoxCostePeriodo } from "@/hooks/useLimpiezaBox";
import { useMermaLotes } from "@/hooks/useMermaLote";
import { useProductoresCatalogo } from "@/hooks/useProductoresCatalogo";
import type { CostePersonaRow, CosteZonaRow } from "@/lib/costePersonal";
import type { CostePorRecurso } from "@/lib/economico";
import type { ZonaMallaResultado } from "@/lib/costeMallas";
import {
  agregarMermaLotes,
  agruparPerdidaPorProductor,
  mermaLotesEnPeriodo,
  type ItemPerdidaProductor,
} from "@/lib/mermaLote";
import { resolveProductorGroupKey } from "@/lib/productoresCanonicos";
import {
  buildPeriodoRange,
  type ConsumoPeriodoTipo,
  type PeriodoRange,
} from "@/lib/consumoPeriodoView";
import {
  C, GRID, GlassTooltip, MARGIN, XAXIS, YAXIS, barFill, CHART_PANEL_CLASS, CHART_CURSOR,
} from "@/lib/chartTheme";
import { errorMessage } from "@/lib/errorMessage";
import { formatDate, formatKg, formatNumber, formatPct, today } from "@/lib/format";
import {
  añadirHojaTabla, crearLibroLasarte, descargarLibro, FMT_EUR, FMT_EUR_KG, FMT_INT, FMT_KG, FMT_PCT,
  type ColumnaTabla,
} from "@/lib/exportKit";
import { buildLasarteFilename } from "@/lib/reportKit";
import { cn } from "@/lib/utils";

// Formatos numéricos españoles específicos de este export, no cubiertos por las
// constantes FMT_* de exportKit.ts.
const FMT_HORAS = '#,##0" h"';
const FMT_KG_MALLA = '#,##0.00" kg"';
const FMT_MALLAS = '#,##0.0';

const RECURSO_LABEL: Record<string, string> = {
  agua: "Agua",
  electricidad: "Electricidad",
  gasoil: "Gasoil",
  quimicos: "Quimicos",
};

const RECURSO_ICON: Record<string, LucideIcon> = {
  agua: Droplet,
  electricidad: Zap,
  gasoil: Fuel,
  quimicos: FlaskConical,
};

function recursoLabel(recurso: string): string {
  return RECURSO_LABEL[recurso] ?? recurso.charAt(0).toUpperCase() + recurso.slice(1);
}

function formatEuro(value: number | null | undefined, digits = 2): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${formatNumber(value, digits)} €`;
}

// Fuente del precio de malla usado en el desglose ("envasado" es la fuente
// única real; "manual" es el respaldo de economico_mallas_config) — para que
// no haya que ir a Económico → Tarifas a comprobar de dónde sale el gasto.
function fuentePrecioMallaHint(zona: ZonaMallaResultado) {
  if (zona.precioMalla == null) return null;
  return (
    <p className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground">
      precio: {formatNumber(zona.precioMalla, 2)} €/malla
      {zona.fuentePrecio && <FuenteBadge fuente={zona.fuentePrecio} size="sm" />}
    </p>
  );
}

// ─── Tabla "por persona" ordenable (patrón ColHead/SortIcon de Productores.tsx) ─

type PersonaSortKey = "nombre" | "zona" | "costeHora" | "horas" | "coste";
type SortDir = "asc" | "desc";

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) return <ChevronsUpDown className="h-3 w-3 opacity-30" />;
  return dir === "asc"
    ? <ChevronUp className="h-3 w-3 text-primary" />
    : <ChevronDown className="h-3 w-3 text-primary" />;
}

function PersonaColHead({ label, sk, right, sortKey, sortDir, onToggle }: {
  label: string; sk: PersonaSortKey; right?: boolean;
  sortKey: PersonaSortKey; sortDir: SortDir; onToggle: (k: PersonaSortKey) => void;
}) {
  return (
    <TableHead
      className={cn("cursor-pointer select-none whitespace-nowrap transition-colors hover:text-foreground", right && "text-right")}
      onClick={() => onToggle(sk)}
    >
      <span className={cn("inline-flex items-center gap-1", right && "flex-row-reverse")}>
        {label}<SortIcon active={sortKey === sk} dir={sortDir} />
      </span>
    </TableHead>
  );
}

// ─── Mini-rankings de "Pérdidas de fruta" (enlazan a /trazabilidad?lote=…) ──

function RankingLoteRowEur({ lote, valorLabel }: { lote: string; valorLabel: string }) {
  return (
    <Link
      to={`/trazabilidad?lote=${encodeURIComponent(lote)}`}
      className="flex items-center justify-between gap-2 rounded-lg border border-[var(--glass-border)] bg-[var(--glass-bg)] px-2.5 py-1.5 text-sm transition-colors hover:bg-[var(--glass-bg-strong)]"
    >
      <span className="font-medium tabular-nums">{lote}</span>
      <Badge variant="outline" className="border-destructive/40 bg-destructive/10 px-1.5 py-0 text-[11px] font-semibold text-destructive">
        {valorLabel}
      </Badge>
    </Link>
  );
}

function RankingMiniCard({ titulo, icon: Icon, vacio, children }: {
  titulo: string;
  icon: LucideIcon;
  vacio: boolean;
  children: React.ReactNode;
}) {
  return (
    <Card className="glass-accented">
      <CardContent className="space-y-2 p-3.5">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
          <Icon className="h-3.5 w-3.5" /> {titulo}
        </div>
        {vacio ? (
          <p className="py-3 text-center text-xs text-muted-foreground">Sin datos en este periodo.</p>
        ) : (
          <div className="space-y-1.5">{children}</div>
        )}
      </CardContent>
    </Card>
  );
}

function ordenarPorPersona(filas: CostePersonaRow[], sortKey: PersonaSortKey, sortDir: SortDir): CostePersonaRow[] {
  const factor = sortDir === "asc" ? 1 : -1;
  return [...filas].sort((a, b) => {
    if (sortKey === "nombre" || sortKey === "zona") {
      return factor * a[sortKey].localeCompare(b[sortKey], "es");
    }
    const av = sortKey === "costeHora" ? (a.costeHora ?? -1) : a[sortKey];
    const bv = sortKey === "costeHora" ? (b.costeHora ?? -1) : b[sortKey];
    return factor * (av - bv);
  });
}

// ─── Export Excel (marca Lasarte, clasificación Dirección) ──────────────────
// 4 hojas: consumos, personal por zona, personal por persona y mallas rotas —
// separadas porque añadirHojaTabla renderiza una tabla por hoja (zona/persona
// tienen columnas distintas, no se pueden fusionar en una sola tabla).

const CONSUMOS_COLUMNAS: ColumnaTabla[] = [
  { header: "Recurso", key: "recurso", width: 18 },
  { header: "Consumo", key: "consumo", width: 20 },
  { header: "Tarifa vigente", key: "tarifa", width: 20 },
  { header: "Coste", key: "coste", tipo: "numero", numFmt: FMT_EUR, width: 14 },
  { header: "Kg producidos", key: "kgProducidos", tipo: "numero", numFmt: FMT_KG, width: 16 },
  { header: "Coste/kg", key: "costePorKg", tipo: "numero", numFmt: FMT_EUR_KG, width: 14 },
];

const PERSONAL_ZONA_COLUMNAS: ColumnaTabla[] = [
  { header: "Zona", key: "zona", width: 20 },
  { header: "Personas", key: "personas", tipo: "numero", numFmt: FMT_INT, width: 12 },
  { header: "Horas", key: "horas", tipo: "numero", numFmt: FMT_HORAS, width: 14 },
  { header: "Coste", key: "coste", tipo: "numero", numFmt: FMT_EUR, width: 14 },
  { header: "% del total", key: "pct", tipo: "numero", numFmt: FMT_PCT, width: 14 },
];

const PERSONAL_PERSONA_COLUMNAS: ColumnaTabla[] = [
  { header: "Nombre", key: "nombre", width: 26 },
  { header: "Zona", key: "zona", width: 20 },
  { header: "Coste/hora", key: "costeHora", width: 16 },
  { header: "Horas", key: "horas", tipo: "numero", numFmt: FMT_HORAS, width: 14 },
  { header: "Coste", key: "coste", tipo: "numero", numFmt: FMT_EUR, width: 14 },
];

const MALLAS_COLUMNAS: ColumnaTabla[] = [
  { header: "Zona", key: "zona", width: 16 },
  { header: "Kg reciclado", key: "kg", tipo: "numero", numFmt: FMT_KG_MALLA, width: 16 },
  { header: "Kg/malla", key: "kgPorMalla", width: 14 },
  { header: "Mallas rotas", key: "mallas", tipo: "numero", numFmt: FMT_MALLAS, width: 14 },
  { header: "Precio/malla", key: "precioMalla", width: 16 },
  { header: "Gasto", key: "gasto", tipo: "numero", numFmt: FMT_EUR, width: 14 },
];

interface ExportarCostesInput {
  periodoRange: PeriodoRange;
  porRecurso: CostePorRecurso[];
  costeTotal: number;
  kgProducidos: number;
  costePorKg: number | null;
  personalPorZona: CosteZonaRow[];
  personalPorPersona: CostePersonaRow[];
  personalTotal: number;
  mallasZ1: ZonaMallaResultado;
  mallasZ2: ZonaMallaResultado;
  totalMallas: number;
  gastoMallasTotal: number;
  usuario: string | undefined;
}

async function exportarCostes(input: ExportarCostesInput) {
  const {
    periodoRange, porRecurso, costeTotal, kgProducidos, costePorKg,
    personalPorZona, personalPorPersona, personalTotal,
    mallasZ1, mallasZ2, totalMallas, gastoMallasTotal, usuario,
  } = input;

  try {
    const ctx = crearLibroLasarte({
      titulo: "Costes del periodo",
      periodo: `${periodoRange.label} (${periodoRange.detail})`,
      usuario,
      clasificacion: "Dirección",
    });

    añadirHojaTabla(ctx, {
      nombreHoja: "Costes de consumos",
      columnas: CONSUMOS_COLUMNAS,
      filas: porRecurso.map((fila) => ({
        recurso: recursoLabel(fila.recurso),
        consumo: `${formatNumber(fila.cantidad, 2)} ${fila.unidad}`,
        tarifa: fila.unidadPrecio && fila.precioMedio != null
          ? `${formatNumber(fila.precioMedio, 4)} €/${fila.unidadPrecio}`
          : "Sin tarifa",
        coste: fila.coste,
        kgProducidos,
        costePorKg: kgProducidos > 0 ? fila.coste / kgProducidos : null,
      })),
      totales: {
        recurso: "TOTAL",
        consumo: "",
        tarifa: "",
        coste: costeTotal,
        kgProducidos,
        costePorKg,
      },
    });

    añadirHojaTabla(ctx, {
      nombreHoja: "Coste personal (zona)",
      titulo: "Coste de personal por zona",
      columnas: PERSONAL_ZONA_COLUMNAS,
      filas: personalPorZona.map((fila) => ({
        zona: fila.zona,
        personas: fila.personas,
        horas: fila.horas,
        coste: fila.coste,
        pct: personalTotal > 0 ? (fila.coste / personalTotal) * 100 : 0,
      })),
      totales: {
        zona: "TOTAL",
        personas: personalPorZona.reduce((s, f) => s + f.personas, 0),
        horas: personalPorZona.reduce((s, f) => s + f.horas, 0),
        coste: personalTotal,
        pct: personalTotal > 0 ? 100 : 0,
      },
    });

    añadirHojaTabla(ctx, {
      nombreHoja: "Coste personal (persona)",
      titulo: "Coste de personal por persona",
      columnas: PERSONAL_PERSONA_COLUMNAS,
      filas: personalPorPersona.map((fila) => ({
        nombre: fila.nombre,
        zona: fila.zona,
        costeHora: fila.costeHora != null ? `${formatNumber(fila.costeHora, 2)} €/h` : "Sin coste",
        horas: fila.horas,
        coste: fila.coste,
      })),
      totales: {
        nombre: "TOTAL",
        zona: "",
        costeHora: "",
        horas: personalPorPersona.reduce((s, f) => s + f.horas, 0),
        coste: personalTotal,
      },
    });

    añadirHojaTabla(ctx, {
      nombreHoja: "Coste de mallas",
      columnas: MALLAS_COLUMNAS,
      filas: [
        {
          zona: "Zona 1 (Z1)",
          kg: mallasZ1.kg,
          kgPorMalla: mallasZ1.kgPorMalla != null ? `${formatNumber(mallasZ1.kgPorMalla, 1)} kg/malla` : "—",
          mallas: mallasZ1.mallas,
          precioMalla: mallasZ1.precioMalla != null ? `${formatNumber(mallasZ1.precioMalla, 2)} €/malla` : "—",
          gasto: mallasZ1.gasto,
        },
        {
          zona: "Zona 2 (Z2)",
          kg: mallasZ2.kg,
          kgPorMalla: mallasZ2.kgPorMalla != null ? `${formatNumber(mallasZ2.kgPorMalla, 1)} kg/malla` : "—",
          mallas: mallasZ2.mallas,
          precioMalla: mallasZ2.precioMalla != null ? `${formatNumber(mallasZ2.precioMalla, 2)} €/malla` : "—",
          gasto: mallasZ2.gasto,
        },
      ],
      totales: {
        zona: "TOTAL",
        kg: mallasZ1.kg + mallasZ2.kg,
        kgPorMalla: "",
        mallas: totalMallas,
        precioMalla: "",
        gasto: gastoMallasTotal,
      },
      autofilter: false,
    });

    await descargarLibro(ctx, buildLasarteFilename("Costes", "xlsx", { from: periodoRange.start, to: periodoRange.end }));
    toast({ title: "Costes exportados" });
  } catch (err) {
    toast({ title: "Error al exportar los costes", description: errorMessage(err), variant: "destructive" });
  }
}

export default function EconomicoCostes() {
  const { user } = useAuth();
  const [periodoTipo, setPeriodoTipo] = useState<ConsumoPeriodoTipo>("semana");
  const [periodoOffset, setPeriodoOffset] = useState(0);

  const periodoRange = useMemo(() => buildPeriodoRange(periodoTipo, periodoOffset), [periodoTipo, periodoOffset]);
  const isPeriodoActual = periodoOffset === 0;
  const puedeAvanzarPeriodo = periodoRange.start <= today();

  const {
    porRecurso, costeTotal, kgProducidos, costePorKg, hayPreciosACero, serieSemanal, isLoading, sinPermiso,
  } = useCostesPeriodo(periodoRange.start, periodoRange.end);

  const {
    porZona: personalPorZona,
    porPersona: personalPorPersona,
    total: personalTotal,
    sinCoste: personalSinCoste,
    costePorKg: personalCostePorKg,
    isLoading: isLoadingPersonal,
    sinPermiso: sinPermisoPersonal,
  } = useCostePersonal(periodoRange.start, periodoRange.end);

  const {
    z1: mallasZ1, z2: mallasZ2, totalMallas, totalGasto: gastoMallasTotal,
    faltanDatos: faltanDatosMallas, isLoading: isLoadingMallas, sinPermiso: sinPermisoMallas,
  } = useCosteMallas(periodoRange.start, periodoRange.end);

  // Limpieza de box: DESGLOSE informativo del coste de personal de arriba
  // (decisión del dueño, FASE 3) — nunca se suma al total, ver KPICard de abajo.
  const limpiezaBoxCoste = useLimpiezaBoxCostePeriodo(periodoRange.start, periodoRange.end);

  const {
    totalImporte: frutaTotalImporte, desglose: frutaDesglose, kgTotales: frutaKgTotales,
    faltanImportes: frutaFaltanImportes, isLoading: isLoadingFruta,
  } = useCosteFruta(periodoRange.start, periodoRange.end);

  // ─── Pérdidas de fruta (merma + podrido): DESGLOSE del coste de compra de
  // arriba, no un gasto adicional — nunca se suma a costeTotalPeriodo/margen.
  const { lotes: mermaLotesTodos, isLoading: isLoadingMerma } = useMermaLotes();
  const { entradas: entradasBascula } = useEntradasBascula();
  const { aliasPorNombreNormalizado, nombrePorProductorId } = useProductoresCatalogo();

  const mermaLotesPeriodo = useMemo(
    () => mermaLotesEnPeriodo(mermaLotesTodos, periodoRange.start, periodoRange.end)
      .filter((l) => l.estado === "procesado"),
    [mermaLotesTodos, periodoRange],
  );
  const mermaAgregado = useMemo(() => agregarMermaLotes(mermaLotesPeriodo), [mermaLotesPeriodo]);

  // Total podrido del lote = calibrador + manual + pre-calibrador (asumido):
  // los tres cuentan como PODRIDO en este ranking de atención, aunque en las
  // demás vistas cada componente siga visible por separado con su etiqueta.
  const topPodridoEur = useMemo(
    () => mermaLotesPeriodo
      .filter((l) => l.costePorKg != null)
      .map((l) => ({ lote: l.lote, eur: l.costePorKg! * ((l.podridoCalibradorKg ?? 0) + (l.podridoManualKg ?? 0)) + (l.podridoPreCalibradorEur ?? 0) }))
      .filter((r) => r.eur > 0)
      .sort((a, b) => b.eur - a.eur)
      .slice(0, 5),
    [mermaLotesPeriodo],
  );

  const topPctPerdida = useMemo(
    () => mermaLotesPeriodo
      .filter((l) => l.pctPerdidaSobreCoste != null)
      .map((l) => ({ lote: l.lote, pct: l.pctPerdidaSobreCoste! }))
      .sort((a, b) => b.pct - a.pct)
      .slice(0, 5),
    [mermaLotesPeriodo],
  );

  const entradaPorLoteFruta = useMemo(
    () => new Map(entradasBascula.map((e) => [e.lote, e])),
    [entradasBascula],
  );

  const topAgricultorEur = useMemo(() => {
    const items: ItemPerdidaProductor[] = mermaLotesPeriodo.map((l) => {
      const fila = entradaPorLoteFruta.get(l.lote);
      const agricultor = fila?.agricultor ?? null;
      // entradas_bascula.productor_id existe en BD (migración productores_canonicos)
      // pero aún no está en los tipos generados de Supabase; mismo cast puntual
      // que useTrazabilidadLote.ts / EntradasBascula.tsx.
      const productorIdDirecto = (fila as { productor_id?: string | null } | undefined)?.productor_id ?? null;
      const { key, productorId } = resolveProductorGroupKey(agricultor ?? "", productorIdDirecto, aliasPorNombreNormalizado);
      const label = (productorId ? nombrePorProductorId.get(productorId) : null) ?? agricultor ?? "Sin agricultor";
      const kgPerdido = Math.max(0, l.mermaNaturalKg ?? 0) + (l.podridoCalibradorKg ?? 0) + (l.podridoManualKg ?? 0);
      return { productorKey: key, productorLabel: label, kgEntrada: l.kgEntrada, kgPerdido, eurPerdido: l.perdidaTotalEur };
    });
    return agruparPerdidaPorProductor(items)
      .filter((r) => (r.eurPerdido ?? 0) > 0)
      .sort((a, b) => (b.eurPerdido ?? 0) - (a.eurPerdido ?? 0))
      .slice(0, 5);
  }, [mermaLotesPeriodo, entradaPorLoteFruta, aliasPorNombreNormalizado, nombrePorProductorId]);

  const [personaSortKey, setPersonaSortKey] = useState<PersonaSortKey>("coste");
  const [personaSortDir, setPersonaSortDir] = useState<SortDir>("desc");

  function togglePersonaSort(key: PersonaSortKey) {
    if (personaSortKey === key) {
      setPersonaSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setPersonaSortKey(key);
      setPersonaSortDir(key === "nombre" || key === "zona" ? "asc" : "desc");
    }
  }

  const personalPorPersonaOrdenada = useMemo(
    () => ordenarPorPersona(personalPorPersona, personaSortKey, personaSortDir),
    [personalPorPersona, personaSortKey, personaSortDir],
  );

  const mostrarSerieSemanal = serieSemanal.length >= 3;
  const maxCosteSemanal = Math.max(...serieSemanal.map((s) => s.coste), 0);

  if (sinPermiso) {
    return (
      <div className="page-shell">
        <header className="page-header">
          <div>
            <p className="panel-kicker flex items-center gap-1.5"><span className="h-1.5 w-1.5 shrink-0 rounded-full bg-seccion-texto" aria-hidden="true" />Económico</p>
            <h1 className="page-title">Costes del periodo</h1>
            <p className="page-subtitle">Coste total y por kg producido, según las tarifas vigentes.</p>
          </div>
        </header>
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
      <header className="page-header">
        <div>
          <p className="panel-kicker flex items-center gap-1.5"><span className="h-1.5 w-1.5 shrink-0 rounded-full bg-seccion-texto" aria-hidden="true" />Económico</p>
          <h1 className="page-title">Costes del periodo</h1>
          <p className="page-subtitle">Coste total y por kg producido, según las tarifas vigentes.</p>
        </div>
        <Button
          variant="outline"
          className="glass glass-hover gap-1.5"
          onClick={() => exportarCostes({
            periodoRange,
            porRecurso,
            costeTotal,
            kgProducidos,
            costePorKg,
            personalPorZona,
            personalPorPersona,
            personalTotal,
            mallasZ1,
            mallasZ2,
            totalMallas,
            gastoMallasTotal,
            usuario: user?.email ?? undefined,
          })}
        >
          <Download className="h-4 w-4" /> Descargar Excel
        </Button>
      </header>

      <EconomicoSubnav />

      <ConsumoPeriodoSelector
        tipo={periodoTipo}
        onTipoChange={setPeriodoTipo}
        range={periodoRange}
        onNavigate={(direction) => setPeriodoOffset((prev) => prev + direction)}
        onToday={() => setPeriodoOffset(0)}
        isCurrent={isPeriodoActual}
        canNavigateNext={puedeAvanzarPeriodo}
      />

      {hayPreciosACero && (
        <Card className="glass border-warning/30 bg-warning/6">
          <CardContent className="flex items-center gap-3 pt-6">
            <ShieldAlert className="h-5 w-5 shrink-0 text-warning" />
            <p className="text-sm">
              <span className="font-semibold">Faltan tarifas reales:</span> hay consumo registrado sin tarifa (o con precio 0), así que su coste sale a 0 abajo.
            </p>
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-32" />)}
        </div>
      ) : (
        <section className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
          <KPICard
            label="Coste total"
            value={formatEuro(costeTotal)}
            icon={Euro}
            hint={`${porRecurso.length} recurso(s) con consumo`}
          />
          <KPICard
            label="Coste / kg producido"
            value={costePorKg != null ? `${formatNumber(costePorKg, 4)} €/kg` : "—"}
            icon={Scale}
            hint={kgProducidos > 0 ? undefined : "Sin kg producidos en el periodo"}
          />
          <KPICard
            label="Kg producidos"
            value={formatKg(kgProducidos)}
            icon={Package}
            accent="success"
          />
        </section>
      )}

      <Card className="glass-accented overflow-hidden">
        <CardHeader>
          <p className="panel-kicker">Desglose</p>
          <CardTitle>Coste por recurso — {periodoRange.label}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="space-y-2 py-4">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : porRecurso.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-14 text-center text-sm text-muted-foreground">
              Sin consumo registrado en este periodo.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Recurso</TableHead>
                  <TableHead className="text-right">Cantidad</TableHead>
                  <TableHead className="text-right">Precio aplicado (medio)</TableHead>
                  <TableHead className="text-right">Coste</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {porRecurso.map((fila) => {
                  const Icon = RECURSO_ICON[fila.recurso] ?? Droplet;
                  return (
                    <TableRow key={fila.recurso}>
                      <TableCell className="font-medium">
                        <span className="inline-flex items-center gap-2">
                          <Icon className="h-4 w-4 text-muted-foreground" />
                          {recursoLabel(fila.recurso)}
                        </span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatNumber(fila.cantidad, 0)} {fila.unidad}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fila.unidadPrecio && fila.precioMedio != null
                          ? `${formatNumber(fila.precioMedio, 4)} €/${fila.unidadPrecio}`
                          : (
                            <Badge variant="outline" className="border-warning/40 bg-warning/10 text-[10px] text-warning">
                              Sin tarifa
                            </Badge>
                          )}
                      </TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">
                        {formatEuro(fila.coste)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {mostrarSerieSemanal && (
        <Card className="glass-accented overflow-hidden">
          <CardHeader>
            <p className="panel-kicker">Evolución</p>
            <CardTitle>Coste total por semana</CardTitle>
          </CardHeader>
          <CardContent className={CHART_PANEL_CLASS}>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={serieSemanal} margin={MARGIN}>
                <CartesianGrid {...GRID} />
                <XAxis {...XAXIS} dataKey="semanaInicio" tickFormatter={(value: string) => formatDate(value)} />
                <YAxis {...YAXIS} domain={[0, Math.max(maxCosteSemanal * 1.15, 1)]} />
                <Tooltip
                  cursor={CHART_CURSOR}
                  content={({ active, payload, label }) => (
                    <GlassTooltip
                      active={active}
                      payload={payload as { name: string; value: number | string; color?: string; fill?: string; stroke?: string }[] | undefined}
                      label={label ? `Semana del ${formatDate(String(label))}` : undefined}
                      formatter={(value) => formatEuro(Number(value))}
                    />
                  )}
                />
                <Bar
                  dataKey="coste"
                  name="Coste total"
                  fill={barFill(C.primary, 0.4)}
                  stroke={C.primary}
                  strokeWidth={1.5}
                  radius={[6, 6, 2, 2]}
                  maxBarSize={34}
                />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      <div className="flex items-center gap-3 pt-2">
        <div className="h-7 w-1 rounded-full bg-primary" />
        <div>
          <p className="panel-kicker flex items-center gap-1.5"><span className="h-1.5 w-1.5 shrink-0 rounded-full bg-seccion-texto" aria-hidden="true" />Económico</p>
          <h2 className="text-xl font-semibold tracking-tight">Coste de mallas rotas</h2>
          <p className="text-sm text-muted-foreground">Reciclado de malla de cada zona / kg por malla = mallas rotas, × precio por malla = gasto.</p>
        </div>
      </div>

      {sinPermisoMallas ? (
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
      ) : (
        <>
          {faltanDatosMallas && (
            <Card className="glass border-warning/30 bg-warning/6">
              <CardContent className="flex items-center gap-3 pt-6">
                <AlertTriangle className="h-5 w-5 shrink-0 text-warning" />
                <p className="text-sm">
                  <span className="font-semibold">Falta config de mallas:</span>{" "}
                  hay reciclado de malla sin kg/precio por malla configurado, así que su gasto sale a 0 abajo.{" "}
                  <Link to="/economico/precios" className="font-semibold underline underline-offset-2">
                    Configura el peso y precio por malla
                  </Link>.
                </p>
              </CardContent>
            </Card>
          )}

          {isLoadingMallas ? (
            <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
              {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-32" />)}
            </div>
          ) : (
            <section className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
              <KPICard
                label="Mallas rotas Z1"
                value={formatNumber(mallasZ1.mallas, 0)}
                icon={Package}
                accent={mallasZ1.kg > 0 && mallasZ1.gasto === 0 ? "warning" : "primary"}
                hint={formatEuro(mallasZ1.gasto)}
              >
                {fuentePrecioMallaHint(mallasZ1)}
              </KPICard>
              <KPICard
                label="Mallas rotas Z2"
                value={formatNumber(mallasZ2.mallas, 0)}
                icon={Package}
                accent={mallasZ2.kg > 0 && mallasZ2.gasto === 0 ? "warning" : "primary"}
                hint={formatEuro(mallasZ2.gasto)}
              >
                {fuentePrecioMallaHint(mallasZ2)}
              </KPICard>
              <KPICard
                label="Gasto total mallas"
                value={formatEuro(gastoMallasTotal)}
                icon={Euro}
                accent="success"
                hint={`${formatNumber(totalMallas, 0)} malla(s) rotas`}
              />
            </section>
          )}
        </>
      )}

      <div className="flex items-center gap-3 pt-2">
        <div className="h-7 w-1 rounded-full bg-primary" />
        <div>
          <p className="panel-kicker flex items-center gap-1.5"><span className="h-1.5 w-1.5 shrink-0 rounded-full bg-seccion-texto" aria-hidden="true" />Económico</p>
          <h2 className="text-xl font-semibold tracking-tight">Coste de personal</h2>
          <p className="text-sm text-muted-foreground">Coste por hora × horas trabajadas, agrupado por zona — de la mano de RRHH.</p>
        </div>
      </div>

      {sinPermisoPersonal ? (
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
      ) : (
        <>
          {personalSinCoste > 0 && (
            <Card className="glass border-warning/30 bg-warning/6">
              <CardContent className="flex items-center gap-3 pt-6">
                <ShieldAlert className="h-5 w-5 shrink-0 text-warning" />
                <p className="text-sm">
                  <span className="font-semibold">{personalSinCoste} persona(s) sin coste asignado:</span>{" "}
                  se cuentan como 0 en el coste de personal.{" "}
                  <Link to="/rrhh/personas" className="font-semibold underline underline-offset-2">
                    Asigna el coste/hora en Plantilla
                  </Link>.
                </p>
              </CardContent>
            </Card>
          )}

          {isLoadingPersonal ? (
            <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
              {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-32" />)}
            </div>
          ) : (
            <section className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
              <KPICard
                label="Coste de personal"
                value={formatEuro(personalTotal)}
                icon={Users}
                hint={`${personalPorZona.length} zona(s) con personal`}
              />
              <KPICard
                label="Coste de personal / kg"
                value={personalCostePorKg != null ? `${formatNumber(personalCostePorKg, 4)} €/kg` : "—"}
                icon={Scale}
                hint={kgProducidos > 0 ? undefined : "Sin kg producidos en el periodo"}
              />
              <KPICard
                label="Sin coste asignado"
                value={String(personalSinCoste)}
                icon={ShieldAlert}
                accent={personalSinCoste > 0 ? "warning" : "primary"}
                hint={personalSinCoste > 0 ? "Asigna el coste/hora en Plantilla" : "Toda la plantilla presente tiene coste asignado"}
                to="/rrhh/personas"
              />
            </section>
          )}

          {/* ─── Limpieza de box: DESGLOSE informativo, ya incluido arriba ──── */}
          {!limpiezaBoxCoste.tablaPendiente && (limpiezaBoxCoste.isLoading || limpiezaBoxCoste.horasTotal > 0) && (
            <section className="grid grid-cols-1 gap-3 sm:gap-4 lg:grid-cols-3">
              {limpiezaBoxCoste.isLoading ? (
                <Skeleton className="h-32" />
              ) : (
                <KPICard
                  className="glass-accented"
                  label="De ello, limpieza de box"
                  value={`${formatNumber(limpiezaBoxCoste.horasTotal, 0)} h`}
                  hint={`≈ ${formatEuro(limpiezaBoxCoste.eurTotal)}`}
                  icon={Sparkles}
                  labelInfo={
                    "Desglose informativo, ya incluido en el coste de personal de arriba (no se suma otra vez): "
                    + "horas de limpieza_parte_trabajadores del periodo × coste/hora del trabajador, solo para "
                    + "trabajadores de plantilla con coste/hora asignado. "
                    + (limpiezaBoxCoste.nPersonasSinCoste > 0
                      ? `${limpiezaBoxCoste.nPersonasSinCoste} nombre(s) libre(s) o sin coste/hora asignado `
                        + `(${formatNumber(limpiezaBoxCoste.horasSinCoste, 0)} h) cuentan en las horas pero no en el importe €.`
                      : "Todas las horas del periodo tienen coste/hora asignado.")
                  }
                />
              )}
            </section>
          )}

          <Card className="glass-accented overflow-hidden">
            <CardHeader>
              <p className="panel-kicker">Desglose</p>
              <CardTitle>Coste de personal por zona/grupo — {periodoRange.label}</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {isLoadingPersonal ? (
                <div className="space-y-2 py-4">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                </div>
              ) : personalPorZona.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-14 text-center text-sm text-muted-foreground">
                  Sin trabajadores presentes en este periodo.
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Zona</TableHead>
                      <TableHead className="text-right">Personas</TableHead>
                      <TableHead className="text-right">Horas</TableHead>
                      <TableHead className="text-right">Coste</TableHead>
                      <TableHead className="w-[30%]">% del total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {personalPorZona.map((fila) => {
                      const pct = personalTotal > 0 ? (fila.coste / personalTotal) * 100 : 0;
                      return (
                        <TableRow key={fila.zona}>
                          <TableCell className="font-medium">{fila.zona}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatNumber(fila.personas, 0)}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatNumber(fila.horas, 0)} h</TableCell>
                          <TableCell className="text-right font-semibold tabular-nums">{formatEuro(fila.coste)}</TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--glass-bg-strong)]">
                                <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(2, pct)}%` }} />
                              </div>
                              <span className="w-12 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
                                {formatNumber(pct, 1)}%
                              </span>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card className="glass-accented overflow-hidden">
            <CardHeader>
              <p className="panel-kicker">Desglose</p>
              <CardTitle>Coste de personal por persona — {periodoRange.label}</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {isLoadingPersonal ? (
                <div className="space-y-2 py-4">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                </div>
              ) : personalPorPersonaOrdenada.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-14 text-center text-sm text-muted-foreground">
                  Sin trabajadores presentes en este periodo.
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <PersonaColHead label="Nombre" sk="nombre" sortKey={personaSortKey} sortDir={personaSortDir} onToggle={togglePersonaSort} />
                      <PersonaColHead label="Zona" sk="zona" sortKey={personaSortKey} sortDir={personaSortDir} onToggle={togglePersonaSort} />
                      <PersonaColHead label="Coste/hora" sk="costeHora" right sortKey={personaSortKey} sortDir={personaSortDir} onToggle={togglePersonaSort} />
                      <PersonaColHead label="Horas" sk="horas" right sortKey={personaSortKey} sortDir={personaSortDir} onToggle={togglePersonaSort} />
                      <PersonaColHead label="Coste" sk="coste" right sortKey={personaSortKey} sortDir={personaSortDir} onToggle={togglePersonaSort} />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {personalPorPersonaOrdenada.map((fila) => (
                      <TableRow key={fila.id}>
                        <TableCell className="font-medium">{fila.nombre}</TableCell>
                        <TableCell className="text-muted-foreground">{fila.zona}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {fila.costeHora != null
                            ? `${formatNumber(fila.costeHora, 2)} €/h`
                            : (
                              <Badge variant="outline" className="border-warning/40 bg-warning/10 text-[10px] text-warning">
                                Sin coste
                              </Badge>
                            )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{formatNumber(fila.horas, 0)} h</TableCell>
                        <TableCell className="text-right font-semibold tabular-nums">{formatEuro(fila.coste)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
        <div className="flex items-center gap-3">
          <div className="h-7 w-1 rounded-full bg-primary" />
          <div>
            <p className="panel-kicker flex items-center gap-1.5"><span className="h-1.5 w-1.5 shrink-0 rounded-full bg-seccion-texto" aria-hidden="true" />Económico</p>
            <h2 className="text-xl font-semibold tracking-tight">Coste de compra de fruta</h2>
            <p className="text-sm text-muted-foreground">
              Entradas de báscula del periodo: importe_total si viene relleno del export, si no la suma de
              compra + recolección + transporte + comisión.
            </p>
          </div>
        </div>
        <Link
          to="/economico/fruta"
          className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-primary hover:underline"
        >
          Detalle por lote, agricultor y forfait <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      {frutaFaltanImportes && (
        <Card className="glass border-warning/30 bg-warning/6">
          <CardContent className="flex items-center gap-3 pt-6">
            <AlertTriangle className="h-5 w-5 shrink-0 text-warning" />
            <p className="text-sm">
              <span className="font-semibold">Faltan importes en báscula:</span>{" "}
              hay kg de fruta comprados en el periodo sin precio/importe en el export, así que el coste sale a 0 abajo.
            </p>
          </CardContent>
        </Card>
      )}

      {isLoadingFruta ? (
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-32" />)}
        </div>
      ) : (
        <section className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
          <KPICard
            label="Coste de fruta"
            value={formatEuro(frutaTotalImporte)}
            icon={Citrus}
            accent={frutaFaltanImportes ? "warning" : "primary"}
            hint={`${formatKg(frutaKgTotales)} comprados`}
          />
          <KPICard
            label="Coste de fruta / kg"
            value={frutaKgTotales > 0 ? `${formatNumber(frutaTotalImporte / frutaKgTotales, 4)} €/kg` : "—"}
            icon={Scale}
            hint={frutaKgTotales > 0 ? undefined : "Sin kg de fruta comprados en el periodo"}
          />
          <KPICard
            label="Kg de fruta comprados"
            value={formatKg(frutaKgTotales)}
            icon={Package}
            accent="success"
          />
        </section>
      )}

      <Card className="glass-accented overflow-hidden">
        <CardHeader>
          <p className="panel-kicker">Desglose</p>
          <CardTitle>Coste de fruta por componente — {periodoRange.label}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoadingFruta ? (
            <div className="space-y-2 py-4">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : frutaTotalImporte === 0 && frutaKgTotales === 0 ? (
            <div className="flex flex-col items-center gap-2 py-14 text-center text-sm text-muted-foreground">
              Sin entradas de báscula en este periodo.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Componente</TableHead>
                  <TableHead className="text-right">Importe</TableHead>
                  <TableHead className="w-[40%]">% del total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {([
                  { label: "Compra", valor: frutaDesglose.compra },
                  { label: "Recolección", valor: frutaDesglose.recoleccion },
                  { label: "Transporte", valor: frutaDesglose.transporte },
                  { label: "Comisión", valor: frutaDesglose.comision },
                ] as const).map((fila) => {
                  const pct = frutaTotalImporte > 0 ? (fila.valor / frutaTotalImporte) * 100 : 0;
                  return (
                    <TableRow key={fila.label}>
                      <TableCell className="font-medium">{fila.label}</TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">{formatEuro(fila.valor)}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--glass-bg-strong)]">
                            <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(2, pct)}%` }} />
                          </div>
                          <span className="w-12 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
                            {formatNumber(pct, 1)}%
                          </span>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <div className="flex items-center gap-3 pt-2">
        <div className="h-7 w-1 rounded-full bg-primary" />
        <div>
          <p className="panel-kicker flex items-center gap-1.5"><span className="h-1.5 w-1.5 shrink-0 rounded-full bg-seccion-texto" aria-hidden="true" />Económico</p>
          <h2 className="text-xl font-semibold tracking-tight">Pérdidas de fruta (merma y podrido)</h2>
          <p className="text-sm text-muted-foreground">
            DESGLOSE del coste de compra de fruta de arriba — no es un gasto adicional, no se suma a ningún total de costes ni al margen.
          </p>
        </div>
      </div>

      {isLoadingMerma ? (
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-32" />)}
        </div>
      ) : (
        <>
          {mermaAgregado.nSinDesglosePosible > 0 && (
            <Card className="glass border-warning/30 bg-warning/6">
              <CardContent className="flex items-center gap-3 pt-6">
                <AlertTriangle className="h-5 w-5 shrink-0 text-warning" />
                <p className="text-sm">
                  <span className="font-semibold">{mermaAgregado.nSinDesglosePosible} lote(s)</span> sin fecha de
                  procesado conocida: su merma cuenta en el total pero no se puede separar en natural
                  estimada / podrido pre-calibrador.
                </p>
              </CardContent>
            </Card>
          )}

          <section className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            <KPICard
              label="Merma natural estimada"
              value={formatEuro(mermaAgregado.eurNaturalEstimadaTotal)}
              icon={Scale}
              hint={`${formatKg(mermaAgregado.kgNaturalEstimadaTotal)} · deshidratación esperada por días en cámara`}
              labelInfo="Σ mermaNaturalEstimadaKg × €/kg de compra de cada lote: la parte de la merma medida que se explica solo por el tiempo en cámara (TASA_MERMA_NATURAL_DIA = 0,0553%/día, derivada del registro manual del dueño)."
            />
            <KPICard
              label="Podrido pre-calibrador (asumido)"
              value={formatEuro(mermaAgregado.eurPodridoPreCalibradorTotal)}
              icon={AlertTriangle}
              accent={mermaAgregado.eurPodridoPreCalibradorTotal > 0 ? "warning" : "primary"}
              hint={`${formatKg(mermaAgregado.kgPodridoPreCalibradorTotal)} por encima de lo esperable por deshidratación`}
              labelInfo="Σ podridoPreCalibradorKg × €/kg: podrido de un contenedor pre-calibrador que no se pesa a diario, ASUMIDO por el dueño (decisión 2026-07-15) — antes se llamaba 'diferencia sin justificar'. Es una asunción, no una medición directa por lote."
            />
            <KPICard
              label="Podrido (calibrador + manual)"
              value={formatEuro(
                mermaAgregado.eurPerdidaPodridoCalibradorReal
                + mermaAgregado.eurPerdidaPodridoCalibradorEstimado
                + mermaAgregado.eurPerdidaPodridoManualEstimado,
              )}
              icon={Package}
              hint={`${formatEuro(mermaAgregado.eurPerdidaPodridoCalibradorReal)} real · ${formatEuro(mermaAgregado.eurPerdidaPodridoCalibradorEstimado + mermaAgregado.eurPerdidaPodridoManualEstimado)} ≈ estimado`}
              labelInfo="Podrido calibrador (real si hay Informe LOTE, si no prorrateo) + podrido manual (siempre prorrateo, no se registra por lote en origen), valorados al €/kg de compra."
            />
            <KPICard
              label="Pérdida total del periodo"
              value={formatEuro(mermaAgregado.eurPerdidaTotal)}
              icon={Euro}
              accent="warning"
              hint={mermaAgregado.pctPerdidaTotalSobreCoste != null ? `${formatPct(mermaAgregado.pctPerdidaTotalSobreCoste)} del coste de fruta comprada` : undefined}
              labelInfo="Merma + podrido (calibrador + manual), valorados al €/kg de compra de cada lote procesado del periodo. Es un DESGLOSE del coste de compra ya contabilizado arriba, no un gasto adicional: no se suma a costeTotalPeriodo ni al margen."
            />
          </section>

          <div className="grid gap-3 md:grid-cols-3">
            <RankingMiniCard titulo="Más € en podrido" icon={Package} vacio={topPodridoEur.length === 0}>
              {topPodridoEur.map((r) => <RankingLoteRowEur key={r.lote} lote={r.lote} valorLabel={formatEuro(r.eur)} />)}
            </RankingMiniCard>
            <RankingMiniCard titulo="Más % pérdida sobre coste" icon={AlertTriangle} vacio={topPctPerdida.length === 0}>
              {topPctPerdida.map((r) => <RankingLoteRowEur key={r.lote} lote={r.lote} valorLabel={formatPct(r.pct)} />)}
            </RankingMiniCard>
            <RankingMiniCard titulo="Pérdida por agricultor" icon={Users} vacio={topAgricultorEur.length === 0}>
              {topAgricultorEur.map((r) => (
                <div key={r.key} className="rounded-lg border border-[var(--glass-border)] bg-[var(--glass-bg)] px-2.5 py-1.5 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate font-medium">{r.label}</span>
                    <Badge variant="outline" className="border-destructive/40 bg-destructive/10 px-1.5 py-0 text-[11px] font-semibold text-destructive">
                      {formatEuro(r.eurPerdido)}
                    </Badge>
                  </div>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">{formatKg(r.kgEntrada)} entrados · {r.nLotes} lote{r.nLotes === 1 ? "" : "s"}</p>
                </div>
              ))}
            </RankingMiniCard>
          </div>
        </>
      )}

      <p className="text-xs text-muted-foreground">
        El agua usa la regla de contadores (subcontadores no suman); los costes usan la tarifa vigente en cada fecha.
        Las horas de personal son una estimación (días presentes × jornada base de 8h), no horas fichadas.
        El coste de fruta no incluye el stock inicial reconstruido desde el informe de stock (sin importe real).
        Las pérdidas de fruta (merma/podrido) son un desglose informativo del coste de compra: no se suman de nuevo.
      </p>
    </div>
  );
}

// src/pages/EconomicoCostes.tsx
// Sección "Económico → Costes": cruza los consumos físicos del periodo elegido
// (Semana | Mes | Campaña) con las tarifas vigentes en cada fecha para dar un
// coste total, coste por kg producido y desglose por recurso.
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle, ChevronDown, ChevronsUpDown, ChevronUp, Droplet, Euro, Fuel, FlaskConical,
  Package, Scale, ShieldAlert, Users, Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { KPICard } from "@/components/KPICard";
import { ConsumoPeriodoSelector } from "@/components/consumos/ConsumoPeriodoSelector";
import { useCostesPeriodo } from "@/hooks/useEconomico";
import { useCostePersonal } from "@/hooks/useCostePersonal";
import { useCosteMallas } from "@/hooks/useCosteMallas";
import type { CostePersonaRow } from "@/lib/costePersonal";
import {
  buildPeriodoRange,
  type ConsumoPeriodoTipo,
} from "@/lib/consumoPeriodoView";
import {
  C, GRID, GlassTooltip, MARGIN, XAXIS, YAXIS, barFill, CHART_PANEL_CLASS, CHART_CURSOR,
} from "@/lib/chartTheme";
import { formatDate, formatKg, formatNumber, today } from "@/lib/format";
import { cn } from "@/lib/utils";

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

export default function EconomicoCostes() {
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
            <p className="panel-kicker">Económico</p>
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
          <p className="panel-kicker">Económico</p>
          <h1 className="page-title">Costes del periodo</h1>
          <p className="page-subtitle">Coste total y por kg producido, según las tarifas vigentes.</p>
        </div>
      </header>

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
            <div className="flex flex-col items-center gap-2 py-14 text-sm text-muted-foreground">Cargando…</div>
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
          <p className="panel-kicker">Económico</p>
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
              />
              <KPICard
                label="Mallas rotas Z2"
                value={formatNumber(mallasZ2.mallas, 0)}
                icon={Package}
                accent={mallasZ2.kg > 0 && mallasZ2.gasto === 0 ? "warning" : "primary"}
                hint={formatEuro(mallasZ2.gasto)}
              />
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
          <p className="panel-kicker">Económico</p>
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

          <Card className="glass-accented overflow-hidden">
            <CardHeader>
              <p className="panel-kicker">Desglose</p>
              <CardTitle>Coste de personal por zona/grupo — {periodoRange.label}</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {isLoadingPersonal ? (
                <div className="flex flex-col items-center gap-2 py-14 text-sm text-muted-foreground">Cargando…</div>
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
                <div className="flex flex-col items-center gap-2 py-14 text-sm text-muted-foreground">Cargando…</div>
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

      <p className="text-xs text-muted-foreground">
        El agua usa la regla de contadores (subcontadores no suman); los costes usan la tarifa vigente en cada fecha.
        Las horas de personal son una estimación (días presentes × jornada base de 8h), no horas fichadas.
      </p>
    </div>
  );
}

import { NavLink, useLocation } from "react-router-dom";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Badge } from "@/components/ui/badge";

const ROUTE_META: Record<string, { label: string; subtitle: string; parent?: string; parentLabel?: string }> = {
  "/": {
    label: "Dashboard",
    subtitle: "Visión estratégica de producción, alertas y tendencias",
  },
  "/partes": {
    label: "Partes",
    subtitle: "Reconciliación diaria y seguimiento de descuadres",
    parent: "/",
    parentLabel: "Operaciones diarias",
  },
  "/dsj": {
    label: "Calculadora DJPMN",
    subtitle: "Simulación y validación de diferencias sin justificar",
    parent: "/",
    parentLabel: "Operaciones diarias",
  },
  "/analisis/diario": {
    label: "Análisis diario",
    subtitle: "Indicadores diarios de rendimiento y calidad",
    parent: "/",
    parentLabel: "Producción",
  },
  "/productores": {
    label: "Productores",
    subtitle: "Análisis de origen, rendimiento y comportamiento",
    parent: "/",
    parentLabel: "Producción",
  },
  "/calendario": {
    label: "Calendario",
    subtitle: "Planificación de producción y actividad",
    parent: "/",
    parentLabel: "Producción",
  },
  "/costes/consumos": {
    label: "Consumos",
    subtitle: "Control operativo de recursos y consumos físicos",
    parent: "/",
    parentLabel: "Operaciones",
  },
  "/costes/asistencia": {
    label: "Asistencia",
    subtitle: "Seguimiento de turnos, horas y equipos",
    parent: "/",
    parentLabel: "Operaciones",
  },
};

function TopBar() {
  const location = useLocation();

  const baseRoute = Object.keys(ROUTE_META)
    .filter((r) => location.pathname === r || location.pathname.startsWith(r + "/"))
    .sort((a, b) => b.length - a.length)[0];

  const meta = baseRoute ? ROUTE_META[baseRoute] : null;

  return (
    <header className="sticky top-0 z-20 flex min-h-16 shrink-0 items-center gap-3 border-b border-primary/10 bg-[var(--glass-bg-strong)] px-4 py-3 shadow-[var(--glass-shadow)] backdrop-blur-xl sm:px-6 lg:px-8">
      <SidebarTrigger className="-ml-1 size-8 rounded-xl border bg-[var(--glass-bg)] shadow-[var(--glass-shadow)]" />
      <Separator orientation="vertical" className="hidden h-6 sm:block" />

      <div className="min-w-0 flex-1">
        <Breadcrumb className="hidden sm:block">
          <BreadcrumbList>
            {meta?.parent && (
              <>
                <BreadcrumbItem>
                  <BreadcrumbLink asChild>
                    <NavLink to={meta.parent}>{meta.parentLabel}</NavLink>
                  </BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator />
              </>
            )}
            <BreadcrumbItem>
              <BreadcrumbPage>{meta?.label ?? "-"}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {meta?.subtitle ?? "Dashboard"}
        </p>
      </div>

      <Badge variant="outline" className="hidden rounded-xl border-primary/20 bg-[var(--glass-bg-strong)] px-2.5 py-1 font-medium text-primary backdrop-blur-sm md:inline-flex">
        Producción
      </Badge>
    </header>
  );
}

export { TopBar, ROUTE_META };

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
    subtitle: "Seguimiento diario de producción, DJPMN, stock, consumos y asistencia",
  },
  "/partes": {
    label: "Partes",
    subtitle: "Reconciliación diaria y seguimiento de descuadres",
    parent: "/",
    parentLabel: "Control",
  },
  "/dsj": {
    label: "Calculadora DJPMN",
    subtitle: "Simulación y validación de diferencias sin justificar",
    parent: "/",
    parentLabel: "Control",
  },
  "/costes/consumos": {
    label: "Consumos",
    subtitle: "Control operativo de recursos y consumos físicos",
    parent: "/",
    parentLabel: "Control",
  },
  "/costes/asistencia": {
    label: "Asistencia",
    subtitle: "Seguimiento de turnos, horas y equipos",
    parent: "/",
    parentLabel: "Control",
  },
  "/stock": {
    label: "Stock en cámara",
    subtitle: "Inventario disponible y trazabilidad de cámara",
    parent: "/",
    parentLabel: "Control",
  },
  "/productores": {
    label: "Productores",
    subtitle: "Análisis de origen, rendimiento y comportamiento",
    parent: "/",
    parentLabel: "Control",
  },
  "/analisis/calibres": {
    label: "Calibres",
    subtitle: "Distribución de calibre y lectura por día",
    parent: "/",
    parentLabel: "Control",
  },
  "/analisis/informes": {
    label: "Análisis informes",
    subtitle: "Revisión estructurada de informes operativos",
    parent: "/",
    parentLabel: "Control",
  },
  "/analisis/diario": {
    label: "Análisis diario",
    subtitle: "Indicadores diarios de rendimiento y calidad",
    parent: "/",
    parentLabel: "Control",
  },
  "/calendario": {
    label: "Calendario",
    subtitle: "Planificación de producción y actividad",
    parent: "/",
    parentLabel: "Control",
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
      <SidebarTrigger className="-ml-1 size-8 rounded-lg border bg-card shadow-sm" />
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

      <Badge variant="outline" className="hidden rounded-md border-primary/20 bg-card/80 px-2.5 py-1 font-medium text-primary md:inline-flex">
        Producción
      </Badge>
    </header>
  );
}

export { TopBar, ROUTE_META };

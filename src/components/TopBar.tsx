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
import { Sparkles } from "lucide-react";

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
  "/calidad": {
    label: "Calidad",
    subtitle: "Notas diarias de lotes y control de calidad",
    parent: "/",
    parentLabel: "Operaciones diarias",
  },
  "/analisis/diario": {
    label: "Análisis diario",
    subtitle: "Revisión detallada de lotes, calibres y destinos por día",
    parent: "/",
    parentLabel: "Producción",
  },
  "/productores": {
    label: "Productores",
    subtitle: "Análisis de origen, rendimiento y comportamiento",
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
    <header className="sticky top-0 z-20 flex min-h-14 shrink-0 items-center gap-2 border-b border-primary/10 bg-[var(--glass-bg-strong)] px-3 py-2.5 shadow-[var(--glass-shadow)] backdrop-blur-xl sm:min-h-16 sm:gap-3 sm:px-5 sm:py-3 lg:px-8">
      <SidebarTrigger className="-ml-1 size-9 shrink-0 rounded-xl border bg-[var(--glass-bg)] shadow-[var(--glass-shadow)] sm:size-8" />
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
        <p className="truncate text-sm font-semibold leading-tight text-foreground sm:hidden">
          {meta?.label ?? "Dashboard"}
        </p>
        <p className="mt-0.5 line-clamp-1 text-[11px] leading-snug text-muted-foreground sm:text-xs">
          {meta?.subtitle ?? "Dashboard"}
        </p>
      </div>

      <Badge variant="outline" className="hidden rounded-xl border-primary/20 bg-[var(--glass-bg-strong)] px-2.5 py-1 font-medium text-primary backdrop-blur-sm md:inline-flex">
        Producción
      </Badge>

      {/* Botón asistente */}
      <button
        onClick={() => window.dispatchEvent(new CustomEvent("lasarte:toggle-chat"))}
        title="Asistente de producción"
        className="flex h-8 w-8 items-center justify-center rounded-xl border border-[var(--glass-border-accent)] bg-primary/8 text-primary shadow-[var(--glass-shadow)] backdrop-blur-sm transition-all hover:bg-primary/15 hover:shadow-[var(--glass-shadow),var(--glass-glow)] active:scale-95"
      >
        <Sparkles className="h-4 w-4" />
      </button>
    </header>
  );
}

export { TopBar, ROUTE_META };

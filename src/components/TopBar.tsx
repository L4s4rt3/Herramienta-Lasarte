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
import { Sparkles, GraduationCap } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

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
  "/ventas/categoria-segunda": {
    label: "Categoria segunda",
    subtitle: "Ventas por cliente, producto, articulo, precio medio y ajustes reales de comision/transporte.",
    parent: "/",
    parentLabel: "Comercial",
  },
  "/ventas/categoria-primera": {
    label: "Categoria primera",
    subtitle: "Ventas del resto de productos y clientes (primera categoria).",
    parent: "/",
    parentLabel: "Comercial",
  },
  "/mercadona": {
    label: "Mercadona",
    subtitle: "Aprovechamiento, ventas semanales y planificación del cliente principal",
    parent: "/",
    parentLabel: "Comercial",
  },
  "/edeka": {
    label: "Edeka",
    subtitle: "Resumen de lo enviado al cliente Edeka a partir de los palets de los partes diarios",
    parent: "/",
    parentLabel: "Comercial",
  },
  "/cmr": {
    label: "CMR y Hojas de ruta",
    subtitle: "Archivo e histórico de CMR y hojas de ruta, y generación de nuevos documentos",
    parent: "/",
    parentLabel: "Comercial",
  },
};

function TopBar() {
  const location = useLocation();

  const baseRoute = Object.keys(ROUTE_META)
    .filter((r) => location.pathname === r || location.pathname.startsWith(r + "/"))
    .sort((a, b) => b.length - a.length)[0];

  const meta = baseRoute ? ROUTE_META[baseRoute] : null;

  return (
    <header className="sticky top-0 z-20 flex min-h-14 shrink-0 items-center gap-2 border-b border-primary/10 bg-[var(--glass-bg-solid)] px-3 py-2.5 shadow-[var(--glass-shadow)] backdrop-blur-2xl sm:min-h-16 sm:gap-3 sm:px-5 sm:py-3 lg:px-8">
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

      {/* Botón guía / tour */}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={() => window.dispatchEvent(new CustomEvent("lasarte:start-tour"))}
            aria-label="Ver el tour de la herramienta"
            className="flex h-8 w-8 items-center justify-center rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg)] text-muted-foreground shadow-[var(--glass-shadow)] backdrop-blur-sm transition-all hover:border-[var(--glass-border-accent)] hover:bg-primary/10 hover:text-primary active:scale-95"
          >
            <GraduationCap className="h-4 w-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom">Ver el tour de la herramienta</TooltipContent>
      </Tooltip>

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

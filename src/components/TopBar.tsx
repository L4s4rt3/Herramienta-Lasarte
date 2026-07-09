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
    label: "Asistencia diaria",
    subtitle: "Pase de lista, importaciones y rendimiento por zonas (RRHH)",
    parent: "/",
    parentLabel: "RRHH",
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
    subtitle: "Aprovechamiento y planificación del cliente principal (sin facturación)",
    parent: "/",
    parentLabel: "Producción",
  },
  "/direccion": {
    label: "Panel de dirección",
    subtitle: "Resumen global de Producción, Comercial, RRHH y Económico",
    parent: "/",
    parentLabel: "Dirección",
  },
  "/comercial": {
    label: "Panel comercial",
    subtitle: "Resumen de ventas: Mercadona, categorías y clientes",
    parent: "/",
    parentLabel: "Comercial",
  },
  "/comercial/ventas-mes": {
    label: "Ventas del mes",
    subtitle: "Importa los ficheros del mes y reparte a Categoría primera/segunda",
    parent: "/comercial",
    parentLabel: "Comercial",
  },
  "/comercial/mercadona": {
    label: "Mercadona",
    subtitle: "Aprovechamiento, ventas semanales, facturación y planificación del cliente principal",
    parent: "/",
    parentLabel: "Comercial",
  },
  // Edeka desconectada temporalmente (jul 2026); se reenganchara mas adelante.
  "/edeka-desactivado": {
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
  "/rrhh": {
    label: "Panel de RRHH",
    subtitle: "Resumen de plantilla, asistencia, rendimiento por grupo y comparativa semanal",
    parent: "/",
    parentLabel: "RRHH",
  },
  "/rrhh/personas": {
    label: "Plantilla",
    subtitle: "Fichas de trabajadores: categoría, antigüedad e historial individual completo",
    parent: "/",
    parentLabel: "RRHH",
  },
  "/rrhh/comunicaciones": {
    label: "Comunicaciones",
    subtitle: "Avisos automáticos y correos personalizados a la plantilla",
    parent: "/rrhh",
    parentLabel: "RRHH",
  },
  "/rrhh/mercadona": {
    label: "Mercadona",
    subtitle: "Kg, facturación y precios del cliente principal (vista RRHH)",
    parent: "/rrhh",
    parentLabel: "RRHH",
  },
  "/rrhh/ausencias": {
    label: "Ausencias y bajas",
    subtitle: "Seguimiento de faltas con justificantes y bajas laborales",
    parent: "/",
    parentLabel: "RRHH",
  },
  "/rrhh/amonestaciones": {
    label: "Amonestaciones",
    subtitle: "Registro de amonestaciones con el documento firmado",
    parent: "/",
    parentLabel: "RRHH",
  },
  "/rrhh/vacaciones": {
    label: "Vacaciones y horas",
    subtitle: "Devengo y saldo de vacaciones y bolsa de horas por trabajador",
    parent: "/",
    parentLabel: "RRHH",
  },
  "/rrhh/nominas": {
    label: "Nóminas",
    subtitle: "Archivo mensual de nóminas por persona (solo RRHH y administración)",
    parent: "/",
    parentLabel: "RRHH",
  },
  "/economico": {
    label: "Panel económico",
    subtitle: "Facturación, costes y margen bruto estimado (solo administración)",
    parent: "/",
    parentLabel: "Económico",
  },
  "/economico/facturacion": {
    label: "Facturación",
    subtitle: "Base IVA de Mercadona por semana y método, €/kg y ajustes",
    parent: "/economico",
    parentLabel: "Económico",
  },
  "/economico/costes": {
    label: "Costes",
    subtitle: "Consumos valorados con la tarifa vigente y coste por kg producido",
    parent: "/economico",
    parentLabel: "Económico",
  },
  "/economico/precios": {
    label: "Precios",
    subtitle: "Tarifas por recurso con histórico de vigencias",
    parent: "/economico",
    parentLabel: "Económico",
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

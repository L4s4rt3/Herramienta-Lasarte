import { useEffect } from "react";
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
import { Sparkles, GraduationCap, Search } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { WORKSPACES, workspaceDeRuta } from "@/lib/workspaces";

// Migas de pan: cada página cuelga del panel de su gran sección (el parent es
// clicable y te lleva a ese panel). Las 5 home de sección no tienen parent.
const ROUTE_META: Record<string, { label: string; subtitle: string; parent?: string; parentLabel?: string }> = {
  "/": {
    label: "Inicio",
    subtitle: "Cada rol entra directo en su panel",
  },
  "/produccion": {
    label: "Panel de producción",
    subtitle: "Visión estratégica de producción, alertas y tendencias",
  },
  "/mapa": {
    label: "Mapa de la herramienta",
    subtitle: "Todas las secciones y páginas, con lo que encontrarás en cada una",
  },
  "/partes": {
    label: "Partes",
    subtitle: "Reconciliación diaria y seguimiento de descuadres",
    parent: "/produccion",
    parentLabel: "Producción",
  },
  "/entradas": {
    label: "Entradas de fruta",
    subtitle: "Entradas por báscula, stock de fruta sin procesar y trazabilidad por lote",
    parent: "/produccion",
    parentLabel: "Producción",
  },
  "/trazabilidad": {
    label: "Trazabilidad",
    subtitle: "La vida completa de cada lote: finca, entrada, calibrador, clasificación y calidad",
    parent: "/produccion",
    parentLabel: "Producción",
  },
  "/calidad": {
    label: "Calidad",
    subtitle: "Notas diarias de lotes y control de calidad",
    parent: "/produccion",
    parentLabel: "Producción",
  },
  "/analisis/diario": {
    label: "Análisis diario",
    subtitle: "Revisión detallada de lotes, calibres y destinos por día",
    parent: "/produccion",
    parentLabel: "Producción",
  },
  "/productores": {
    label: "Productores",
    subtitle: "Análisis de origen, rendimiento y comportamiento",
    parent: "/produccion",
    parentLabel: "Producción",
  },
  "/costes/consumos": {
    label: "Consumos",
    subtitle: "Control operativo de recursos y consumos físicos",
    parent: "/produccion",
    parentLabel: "Producción",
  },
  "/limpieza": {
    label: "Limpieza de box",
    subtitle: "Partes diarios del grupo de limpieza: box (o pies), escaleras, trabajadores y horas",
    parent: "/produccion",
    parentLabel: "Producción",
  },
  "/historico": {
    label: "Importar histórico",
    subtitle: "Carga del histórico de producción de la campaña desde el export del calibrador",
    parent: "/produccion",
    parentLabel: "Producción",
  },
  "/costes/asistencia": {
    label: "Asistencia diaria",
    subtitle: "Pase de lista, importaciones y rendimiento por zonas (RRHH)",
    parent: "/rrhh",
    parentLabel: "RRHH",
  },
  "/ventas/categoria-segunda": {
    label: "Categoría segunda",
    subtitle: "Ventas por cliente, producto, artículo, precio medio y ajustes reales de comisión/transporte.",
    parent: "/comercial",
    parentLabel: "Comercial",
  },
  "/ventas/categoria-primera": {
    label: "Categoría primera",
    subtitle: "Ventas del resto de productos y clientes (primera categoría).",
    parent: "/comercial",
    parentLabel: "Comercial",
  },
  "/mercadona": {
    label: "Mercadona (planta)",
    subtitle: "Aprovechamiento y planificación del cliente principal, vista de planta (sin facturación)",
    parent: "/produccion",
    parentLabel: "Producción",
  },
  "/direccion": {
    label: "Panel de dirección",
    subtitle: "Resumen global de Producción, Comercial, RRHH y Económico",
  },
  "/comercial": {
    label: "Panel comercial",
    subtitle: "Resumen de ventas: Mercadona, categorías y clientes",
  },
  "/comercial/ventas-mes": {
    label: "Ventas del mes",
    subtitle: "Importa los ficheros del mes y reparte a Categoría primera/segunda",
    parent: "/comercial",
    parentLabel: "Comercial",
  },
  "/comercial/mercadona": {
    label: "Mercadona (ventas)",
    subtitle: "Aprovechamiento, ventas semanales, facturación y planificación del cliente principal",
    parent: "/comercial",
    parentLabel: "Comercial",
  },
  // Edeka desconectada temporalmente (jul 2026); se reenganchara mas adelante.
  "/edeka-desactivado": {
    label: "Edeka",
    subtitle: "Resumen de lo enviado al cliente Edeka a partir de los palets de los partes diarios",
    parent: "/comercial",
    parentLabel: "Comercial",
  },
  "/cmr": {
    label: "CMR y Hojas de ruta",
    subtitle: "Archivo e histórico de CMR y hojas de ruta, y generación de nuevos documentos",
    parent: "/comercial",
    parentLabel: "Comercial",
  },
  "/rrhh": {
    label: "Panel de RRHH",
    subtitle: "Resumen de plantilla, asistencia, rendimiento por grupo y comparativa semanal",
  },
  "/rrhh/personas": {
    label: "Plantilla",
    subtitle: "Fichas de trabajadores: categoría, antigüedad e historial individual completo",
    parent: "/rrhh",
    parentLabel: "RRHH",
  },
  "/rrhh/comunicaciones": {
    label: "Comunicaciones",
    subtitle: "Avisos automáticos y correos personalizados a la plantilla",
    parent: "/rrhh",
    parentLabel: "RRHH",
  },
  "/rrhh/mercadona": {
    label: "Mercadona (facturas)",
    subtitle: "Kg, facturación y precios del cliente principal (vista RRHH)",
    parent: "/rrhh",
    parentLabel: "RRHH",
  },
  "/rrhh/ausencias": {
    label: "Ausencias y bajas",
    subtitle: "Seguimiento de faltas con justificantes y bajas laborales",
    parent: "/rrhh",
    parentLabel: "RRHH",
  },
  "/rrhh/amonestaciones": {
    label: "Amonestaciones",
    subtitle: "Registro de amonestaciones con el documento firmado",
    parent: "/rrhh",
    parentLabel: "RRHH",
  },
  "/rrhh/vacaciones": {
    label: "Vacaciones y horas",
    subtitle: "Devengo y saldo de vacaciones y bolsa de horas por trabajador",
    parent: "/rrhh",
    parentLabel: "RRHH",
  },
  "/rrhh/nominas": {
    label: "Nóminas",
    subtitle: "Archivo mensual de nóminas por persona (solo RRHH y administración)",
    parent: "/rrhh",
    parentLabel: "RRHH",
  },
  // Económico (jul 2026): ya no es un espacio propio, es un grupo dentro de
  // Dirección — todas sus páginas cuelgan de /direccion en la miga.
  "/economico": {
    label: "Panel económico",
    subtitle: "Facturación, costes y margen bruto estimado (solo administración)",
    parent: "/direccion",
    parentLabel: "Dirección",
  },
  "/economico/facturacion": {
    label: "Facturación",
    subtitle: "Base IVA de Mercadona por semana y método, €/kg y ajustes",
    parent: "/direccion",
    parentLabel: "Dirección",
  },
  "/economico/costes": {
    label: "Costes",
    subtitle: "Consumos valorados con la tarifa vigente y coste por kg producido",
    parent: "/direccion",
    parentLabel: "Dirección",
  },
  "/economico/fruta": {
    label: "Compra de fruta",
    subtitle: "Detalle de las entradas de báscula: por lote, por agricultor y por variedad",
    parent: "/direccion",
    parentLabel: "Dirección",
  },
  "/economico/precios": {
    label: "Precios",
    subtitle: "Tarifas por recurso con histórico de vigencias",
    parent: "/direccion",
    parentLabel: "Dirección",
  },
};

function TopBar() {
  const location = useLocation();

  const baseRoute = Object.keys(ROUTE_META)
    .filter((r) => location.pathname === r || location.pathname.startsWith(r + "/"))
    .sort((a, b) => b.length - a.length)[0];

  const meta = baseRoute ? ROUTE_META[baseRoute] : null;
  // Chip de orientación: en qué gran sección estás (según la ruta actual).
  const seccion = WORKSPACES.find((w) => w.id === workspaceDeRuta(location.pathname));

  // Título de la pestaña del navegador por página (historial y pestañas legibles).
  useEffect(() => {
    document.title = meta?.label
      ? `${meta.label} · Herramienta Lasarte`
      : "Herramienta Lasarte Cítricos S.L.";
  }, [meta?.label]);

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

      <Tooltip>
        <TooltipTrigger asChild>
          <NavLink to="/mapa" className="hidden md:inline-flex">
            <Badge variant="outline" className="rounded-xl border-primary/20 bg-[var(--glass-bg-strong)] px-2.5 py-1 font-medium text-primary backdrop-blur-sm transition-colors hover:bg-primary/10">
              {location.pathname === "/mapa" ? "Mapa" : seccion?.label ?? "Producción"}
            </Badge>
          </NavLink>
        </TooltipTrigger>
        <TooltipContent side="bottom">Ver el mapa de la herramienta</TooltipContent>
      </Tooltip>

      {/* Buscador global (abre la paleta Ctrl+K) */}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={() => window.dispatchEvent(new CustomEvent("lasarte:open-search"))}
            aria-label="Buscar una sección de la herramienta"
            className="flex h-8 items-center gap-1.5 rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg)] px-2.5 text-muted-foreground shadow-[var(--glass-shadow)] backdrop-blur-sm transition-all hover:border-[var(--glass-border-accent)] hover:bg-primary/10 hover:text-primary active:scale-95"
          >
            <Search className="h-4 w-4 shrink-0" />
            <span className="hidden text-xs font-medium lg:inline">Buscar</span>
            <kbd className="hidden rounded border border-[var(--glass-border)] bg-[var(--glass-bg-strong)] px-1 py-0.5 text-[10px] font-semibold lg:inline">
              Ctrl K
            </kbd>
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom">Buscar cualquier sección (Ctrl+K)</TooltipContent>
      </Tooltip>

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

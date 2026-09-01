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
import { Sparkles, GraduationCap, Search, ChevronLeft } from "lucide-react";
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
    label: "Panel de planta",
    subtitle: "Lo que está pasando hoy en la nave: producción, alertas y tendencias",
  },
  "/datos/fuentes": {
    label: "Estado de las fuentes",
    subtitle: "De dónde sale cada dato y cuándo llegó lo último",
  },
  "/mapa": {
    label: "Mapa de la herramienta",
    subtitle: "Todas las secciones y páginas, con lo que encontrarás en cada una",
  },
  "/partes": {
    label: "Parte del día",
    subtitle: "Reconciliación diaria y seguimiento de descuadres",
    parent: "/produccion",
    parentLabel: "Planta",
  },
  "/entradas": {
    label: "Entradas y stock",
    subtitle: "Entradas por báscula, stock de fruta sin procesar y trazabilidad por lote",
    parent: "/produccion",
    parentLabel: "Planta",
  },
  "/trazabilidad": {
    label: "Análisis por lote",
    subtitle: "La vida completa de cada lote: finca, entrada, calibrador, clasificación y calidad",
    parent: "/analisis/diario",
    parentLabel: "Análisis",
  },
  "/calibrador": {
    label: "Calibrador",
    subtitle: "Cuánto aprovecha la fruta de cada productor, según el Compac Sizer",
    parent: "/analisis/diario",
    parentLabel: "Análisis",
  },
  "/calidad": {
    label: "Calidad",
    subtitle: "Notas diarias de lotes y control de calidad",
    parent: "/produccion",
    parentLabel: "Planta",
  },
  "/calidad/importacion": {
    label: "Calidad importación",
    subtitle: "Controles de la fruta de importación y su informe de calidad",
    parent: "/produccion",
    parentLabel: "Planta",
  },
  "/consumibles": {
    label: "Stock consumibles",
    subtitle: "Inventario continuo de cajas, mallas, etiquetas y postcosecha, con lista y carteles en PDF",
    parent: "/produccion",
    parentLabel: "Planta",
  },
  "/analisis/diario": {
    label: "Análisis por día",
    subtitle: "Qué pasó un día concreto: lotes, calibres y destinos",
  },
  "/productores": {
    label: "Análisis por productor",
    subtitle: "Dossier de cada productor y el aprovechamiento que mide el calibrador",
    parent: "/analisis/diario",
    parentLabel: "Análisis",
  },
  "/costes/consumos": {
    label: "Consumos",
    subtitle: "Control operativo de recursos y consumos físicos",
    parent: "/economico",
    parentLabel: "Económico",
  },
  "/limpieza": {
    label: "Limpieza de box",
    subtitle: "Partes diarios del grupo de limpieza: box (o pies), escaleras, trabajadores y horas",
    parent: "/produccion",
    parentLabel: "Planta",
  },
  "/historico": {
    label: "Importar histórico",
    subtitle: "Carga del histórico de producción de la campaña desde el export del calibrador",
    parent: "/datos/fuentes",
    parentLabel: "Datos",
  },
  "/costes/asistencia": {
    label: "Asistencia",
    subtitle: "Pase de lista, importaciones, rendimiento por zonas y comparativa entre periodos",
    parent: "/rrhh",
    parentLabel: "RRHH",
  },
  "/campo/comunicaciones": {
    label: "Comunicaciones de campaña",
    subtitle: "Comunicados a agricultores y proveedores para la campaña que entra (exclusivo de Jesús)",
    parent: "/produccion",
    parentLabel: "Planta",
  },
  "/ventas/categoria-segunda": {
    label: "Ventas por categoría",
    subtitle: "Primera y segunda por cliente, producto y artículo, con el importador mensual",
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
    subtitle: "Qué productores, lotes y formatos rinden mejor para el cliente principal",
    parent: "/analisis/diario",
    parentLabel: "Análisis",
  },
  "/direccion": {
    label: "Panel de dirección",
    subtitle: "Resumen global de Producción, Comercial, RRHH y Económico",
  },
  "/importar": {
    label: "Importar",
    subtitle: "Meter archivos en la Herramienta, sean de hoy o del histórico de campaña",
    parent: "/datos/fuentes",
    parentLabel: "Datos",
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
    subtitle: "El expediente de cada persona: ficha, ausencias, amonestaciones, vacaciones y comunicaciones",
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
  },
  "/economico/rentabilidad": {
    label: "Rentabilidad del día",
    subtitle: "Beneficio de cada día: venta real menos personal, envases, suministros y fruta (solo administración)",
    parent: "/economico",
    parentLabel: "Económico",
  },
  "/economico/cmv": {
    label: "CMV",
    subtitle: "Coste medio por kg vendido y margen del mes (solo administración)",
    parent: "/economico",
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
    subtitle: "Todo lo que responde a «cuánto cuesta»: recursos, consumos, fruta, CMV y coste por producto",
    parent: "/economico",
    parentLabel: "Económico",
  },
  "/economico/fruta": {
    label: "Compra de fruta",
    subtitle: "Detalle de las entradas de báscula: por lote, por agricultor y por variedad",
    parent: "/economico",
    parentLabel: "Económico",
  },
  "/economico/precios": {
    label: "Tarifas",
    subtitle: "Precio vigente por recurso (agua, electricidad, gasoil, químicos...) e histórico",
    parent: "/economico",
    parentLabel: "Económico",
  },
};

// Sub-detalle (p.ej. /partes/:id o /costes/asistencia/comparativa): la miga
// final no tiene un label conocido en ROUTE_META (es un id, o un segmento
// suelto), así que se deriva del propio segmento de la URL en vez de
// inventarlo aquí — "Detalle" para lo que parece un identificador opaco
// (uuid/numérico), o el segmento capitalizado si parece una palabra (p.ej.
// "comparativa" → "Comparativa").
function labelDeSegmentoDetalle(segmento: string): string {
  if (!segmento) return "Detalle";
  const esIdentificadorOpaco = /^[0-9a-f-]{8,}$/i.test(segmento) || /^\d+$/.test(segmento);
  if (esIdentificadorOpaco) return "Detalle";
  return segmento.charAt(0).toUpperCase() + segmento.slice(1).replace(/-/g, " ");
}

function TopBar() {
  const location = useLocation();

  const baseRoute = Object.keys(ROUTE_META)
    .filter((r) => location.pathname === r || location.pathname.startsWith(r + "/"))
    .sort((a, b) => b.length - a.length)[0];

  const meta = baseRoute ? ROUTE_META[baseRoute] : null;
  // Sub-detalle: la ruta actual cuelga de la página base (más profunda que
  // baseRoute) en vez de SER la página base — p.ej. /partes/:id o
  // /costes/asistencia/comparativa. En ese caso el label de la página base
  // deja de ser el final de la miga: pasa a ser un enlace de vuelta a su ruta
  // base, con una miga final para el detalle (ver JSX más abajo).
  const esSubRuta = Boolean(baseRoute) && location.pathname !== baseRoute;
  const detalleLabel = esSubRuta && baseRoute
    ? labelDeSegmentoDetalle(location.pathname.slice(baseRoute.length + 1).split("/")[0] ?? "")
    : null;
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
            {esSubRuta && baseRoute ? (
              <>
                <BreadcrumbItem>
                  <BreadcrumbLink asChild>
                    <NavLink to={baseRoute}>{meta?.label ?? "-"}</NavLink>
                  </BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                  <BreadcrumbPage>{detalleLabel}</BreadcrumbPage>
                </BreadcrumbItem>
              </>
            ) : (
              <BreadcrumbItem>
                <BreadcrumbPage>{meta?.label ?? "-"}</BreadcrumbPage>
              </BreadcrumbItem>
            )}
          </BreadcrumbList>
        </Breadcrumb>
        {/* Móvil (las migas de arriba están ocultas): título con "volver" propio
            — flecha a la sección (si hay parent) y, en sub-detalle, el propio
            título enlaza a la página base (mismo criterio que la miga de
            escritorio). Fuera de sub-detalle el comportamiento es el mismo de
            antes (texto plano, sin enlace). */}
        <div className="flex items-center gap-1 sm:hidden">
          {meta?.parent && (
            <NavLink
              to={meta.parent}
              aria-label={`Volver a ${meta.parentLabel}`}
              className="shrink-0 text-muted-foreground hover:text-foreground"
            >
              <ChevronLeft className="h-4 w-4" />
            </NavLink>
          )}
          {esSubRuta && baseRoute ? (
            <NavLink
              to={baseRoute}
              className="truncate text-sm font-semibold leading-tight text-foreground hover:underline"
            >
              {meta?.label ?? "Dashboard"}
            </NavLink>
          ) : (
            <p className="truncate text-sm font-semibold leading-tight text-foreground">
              {meta?.label ?? "Dashboard"}
            </p>
          )}
        </div>
        <p className="mt-0.5 line-clamp-1 text-[11px] leading-snug text-muted-foreground sm:text-xs">
          {meta?.subtitle ?? "Dashboard"}
        </p>
      </div>

      <Tooltip>
        <TooltipTrigger asChild>
          {/* Chip de sección: acento por workspace (--seccion-acento-texto,
              fijado por AppLayout vía data-seccion), no el primary genérico —
              FASE 2 del rediseño, ver src/index.css. */}
          <NavLink to="/mapa" className="hidden md:inline-flex">
            <Badge variant="outline" className="rounded-xl border-seccion/25 bg-seccion/10 px-2.5 py-1 font-medium text-seccion-texto backdrop-blur-sm transition-colors hover:bg-seccion/15">
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

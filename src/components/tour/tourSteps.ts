import {
  LayoutDashboard,
  ClipboardCheck,
  FileText,
  BarChart3,
  Sprout,
  FileSpreadsheet,
  Droplet,
  Users,
  Sparkles,
  type LucideIcon,
} from "lucide-react";

export interface TourStep {
  /** Identificador estable del paso (independiente de la ruta, por si se repite). */
  id: string;
  /** Ruta a la que navega el tour para mostrar la sección de fondo. */
  to: string;
  /** Icono de la sección (el mismo que en el sidebar). */
  icon: LucideIcon;
  /** Título de la tarjeta. */
  title: string;
  /** Descripción del paso. */
  description: string;
  /**
   * Si se define, solo se incluye este paso cuando la condición se cumple
   * (p.ej. acceso a Categoría segunda). Si no se define, el paso siempre se incluye.
   */
  requiresVentasCategoriaAccess?: boolean;
}

export const TOUR_STEPS: TourStep[] = [
  {
    id: "dashboard",
    to: "/",
    icon: LayoutDashboard,
    title: "Panel de producción",
    description:
      "Es la foto del día a día: producción de la semana, kg dados de alta, la Diferencia Sin Justificar (DJPMN, el cuadre entre lo que entra y lo que sale) con su semáforo, la velocidad de la planta y cuánto de lo confeccionado va a Mercadona. Si una semana aún no tiene datos, la app te enseña la anterior y te lo avisa.",
  },
  {
    id: "calidad",
    to: "/calidad",
    icon: ClipboardCheck,
    title: "Calidad",
    description:
      "Aquí el responsable de calidad anota cada lote que revisa: estado, defectos, fotos y comentarios. Puedes importar los lotes del parte del día para no teclearlos, validar cada nota y sacar el informe PDF oficial. La pestaña Histórico enseña la evolución de defectos e incidencias por productor.",
  },
  {
    id: "partes",
    to: "/partes",
    icon: FileText,
    title: "Partes",
    description:
      "El registro diario de producción. Cada día tiene su parte: se suben los Excel (GSTOCK, producción, informes de lote), se analizan y la app calcula el cuadre DJPMN. Se navega por semanas o meses, y desde cada parte se llega a todo el detalle del día.",
  },
  {
    id: "analisis-diario",
    to: "/analisis/diario",
    icon: BarChart3,
    title: "Análisis diario",
    description:
      "La lupa sobre la producción: lotes uno a uno con su ficha completa (clasificación por clase y tamaño), calibres, destino de la fruta y productores. Los filtros de arriba (buscador, productor, producto) afectan a todas las pestañas a la vez.",
  },
  {
    id: "productores",
    to: "/productores",
    icon: Sprout,
    title: "Productores",
    description:
      "El ranking de todos los productores y la ficha completa de cada uno: kg, velocidad, calibres, clases, calidad, destino y aprovechamiento. Sirve para saber cómo viene la fruta de cada finca y comparar contra la media de la planta.",
  },
  {
    id: "categoria-segunda",
    to: "/ventas/categoria-segunda",
    icon: FileSpreadsheet,
    title: "Categoría segunda",
    description:
      "Las ventas de segunda categoría: kg e importes por cliente, producto y artículo, con el precio medio bruto y el real tras comisiones y transporte.",
    requiresVentasCategoriaAccess: true,
  },
  {
    id: "consumos",
    to: "/costes/consumos",
    icon: Droplet,
    title: "Consumos",
    description:
      "El consumo de agua, electricidad, gasoil y tratamientos, con el consumo por kg de naranja de cada día y vistas por semana, mes o campaña. Apunta las lecturas de los contadores y la app calcula el consumo de cada día por ti.",
  },
  {
    id: "asistencia",
    to: "/costes/asistencia",
    icon: Users,
    title: "Asistencia",
    description:
      "El control del personal: quién ha venido cada día, los kg por persona y el rendimiento por zonas y grupos. Se puede importar la asistencia desde Excel y comparar semanas.",
  },
  {
    id: "trucos",
    to: "/",
    icon: Sparkles,
    title: "Trucos rápidos",
    description:
      "Tres cosas más: con Ctrl+K abres el buscador rápido desde cualquier pantalla; casi todas las secciones tienen botón Exportar con PDF y Excel con el formato de Lasarte; y el asistente de la esquina responde preguntas sobre tus datos de producción. ¡Listo, ya conoces la herramienta!",
  },
];

/** Filtra los pasos del tour según los accesos del usuario actual. */
export function getVisibleTourSteps(hasVentasCategoriaAccess: boolean): TourStep[] {
  return TOUR_STEPS.filter((step) => !step.requiresVentasCategoriaAccess || hasVentasCategoriaAccess);
}

export const TOUR_STORAGE_KEY = "lasarte-tour-v1-visto";

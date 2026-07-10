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
  ShoppingCart,
  Truck,
  UserRound,
  CalendarOff,
  AlertTriangle,
  Plane,
  Banknote,
  Euro,
  Receipt,
  Tags,
  type LucideIcon,
} from "lucide-react";

/**
 * Copia local del tipo de espacio de trabajo. Debe coincidir con `WorkspaceId`
 * de src/components/AppLayout.tsx. No se importa desde allí para evitar un
 * ciclo de imports (AppLayout importa este archivo).
 */
export type TourWorkspaceId = "direccion" | "produccion" | "comercial" | "rrhh" | "economico";

export interface TourStep {
  /** Identificador estable del paso (independiente de la ruta, por si se repite). */
  id: string;
  /** Espacio de trabajo al que pertenece el paso (el tour es uno por espacio). */
  workspace: TourWorkspaceId;
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
  // ─── Producción ────────────────────────────────────────────────────────
  {
    id: "dashboard",
    workspace: "produccion",
    to: "/produccion",
    icon: LayoutDashboard,
    title: "Panel de producción",
    description:
      "Es la foto del día a día: producción de la semana, kg dados de alta, la Diferencia Sin Justificar (DJPMN, el cuadre entre lo que entra y lo que sale) con su semáforo, la velocidad de la planta y cuánto de lo confeccionado va a Mercadona. Si una semana aún no tiene datos, la app te enseña la anterior y te lo avisa.",
  },
  {
    id: "calidad",
    workspace: "produccion",
    to: "/calidad",
    icon: ClipboardCheck,
    title: "Calidad",
    description:
      "Aquí el responsable de calidad anota cada lote que revisa: estado, defectos, fotos y comentarios. Puedes importar los lotes del parte del día para no teclearlos, validar cada nota y sacar el informe PDF oficial. La pestaña Histórico enseña la evolución de defectos e incidencias por productor.",
  },
  {
    id: "partes",
    workspace: "produccion",
    to: "/partes",
    icon: FileText,
    title: "Partes",
    description:
      "El registro diario de producción. Cada día tiene su parte: se suben los Excel (GSTOCK, producción, informes de lote), se analizan y la app calcula el cuadre DJPMN. Se navega por semanas o meses, y desde cada parte se llega a todo el detalle del día.",
  },
  {
    id: "analisis-diario",
    workspace: "produccion",
    to: "/analisis/diario",
    icon: BarChart3,
    title: "Análisis diario",
    description:
      "La lupa sobre la producción: lotes uno a uno con su ficha completa (clasificación por clase y tamaño), calibres, destino de la fruta y productores. Los filtros de arriba (buscador, productor, producto) afectan a todas las pestañas a la vez.",
  },
  {
    id: "productores",
    workspace: "produccion",
    to: "/productores",
    icon: Sprout,
    title: "Productores",
    description:
      "El ranking de todos los productores y la ficha completa de cada uno: kg, velocidad, calibres, clases, calidad, destino y aprovechamiento. Sirve para saber cómo viene la fruta de cada finca y comparar contra la media de la planta.",
  },
  {
    id: "mercadona-produccion",
    workspace: "produccion",
    to: "/mercadona",
    icon: ShoppingCart,
    title: "Mercadona",
    description:
      "La vista de producción del pedido a Mercadona: aprovechamiento, previsión y expediciones, sin datos de facturación (esos viven en el espacio Comercial). Sirve para seguir el día a día del pedido desde planta.",
  },
  {
    id: "consumos",
    workspace: "produccion",
    to: "/costes/consumos",
    icon: Droplet,
    title: "Consumos",
    description:
      "El consumo de agua, electricidad, gasoil y tratamientos, con el consumo por kg de naranja de cada día y vistas por semana, mes o campaña. Apunta las lecturas de los contadores y la app calcula el consumo de cada día por ti.",
  },
  {
    id: "trucos-produccion",
    workspace: "produccion",
    to: "/produccion",
    icon: Sparkles,
    title: "Trucos rápidos",
    description:
      "Tres cosas más: con Ctrl+K abres el buscador rápido desde cualquier pantalla; casi todas las secciones tienen botón Exportar con PDF y Excel con el formato de Lasarte; y el asistente de la esquina responde preguntas sobre tus datos de producción. ¡Listo, ya conoces la herramienta!",
  },

  // ─── Comercial ─────────────────────────────────────────────────────────
  {
    id: "mercadona-comercial",
    workspace: "comercial",
    to: "/comercial/mercadona",
    icon: ShoppingCart,
    title: "Mercadona",
    description:
      "La vista comercial completa del pedido a Mercadona: aquí sí está la facturación, junto con el análisis del pedido, las expediciones y la previsión. Es la versión completa de la que se ve en Producción, con los números de venta incluidos.",
  },
  {
    id: "categoria-segunda",
    workspace: "comercial",
    to: "/ventas/categoria-segunda",
    icon: FileSpreadsheet,
    title: "Categoría segunda",
    description:
      "Las ventas de segunda categoría: kg e importes por cliente, producto y artículo, con el precio medio bruto y el real tras comisiones y transporte. Se alimenta importando el Excel de ventas.",
    requiresVentasCategoriaAccess: true,
  },
  {
    id: "categoria-primera",
    workspace: "comercial",
    to: "/ventas/categoria-primera",
    icon: FileSpreadsheet,
    title: "Categoría primera",
    description:
      "Lo mismo que Categoría segunda pero para el resto de productos: ventas por cliente y producto a partir de su propio Excel, con los mismos totales de kg, importe y precio medio.",
  },
  {
    id: "cmr",
    workspace: "comercial",
    to: "/cmr",
    icon: Truck,
    title: "CMR y Hojas de ruta",
    description:
      "El archivo histórico de CMRs y hojas de ruta de todos los transportes, y el generador para sacar nuevos PDFs cuando toca preparar un envío. Todo queda guardado y buscable para cuando haya que consultarlo.",
  },

  // ─── RRHH ──────────────────────────────────────────────────────────────
  {
    id: "asistencia",
    workspace: "rrhh",
    to: "/costes/asistencia",
    icon: Users,
    title: "Asistencia diaria",
    description:
      "El control del personal: quién ha venido cada día, los kg por persona y el rendimiento por zonas y grupos. Se puede pasar lista a mano o importar la asistencia desde Excel; si algún nombre no coincide con nadie de la plantilla, aparece en un panel para asignarlo tú.",
  },
  {
    id: "plantilla",
    workspace: "rrhh",
    to: "/rrhh/personas",
    icon: UserRound,
    title: "Plantilla",
    description:
      "La ficha de cada persona de la plantilla, con su historial: datos, incorporación, y todo lo que se le haya registrado en Ausencias, Amonestaciones o Vacaciones. El punto de partida para saber quién es quién.",
  },
  {
    id: "ausencias",
    workspace: "rrhh",
    to: "/rrhh/ausencias",
    icon: CalendarOff,
    title: "Ausencias y bajas",
    description:
      "Registra faltas, bajas médicas y justificantes, con opción de adjuntar una foto del parte o el documento. Queda todo enlazado a la ficha de la persona en Plantilla.",
  },
  {
    id: "amonestaciones",
    workspace: "rrhh",
    to: "/rrhh/amonestaciones",
    icon: AlertTriangle,
    title: "Amonestaciones",
    description:
      "El historial de avisos y amonestaciones por persona: motivo, fecha y gravedad, para tener constancia si hace falta consultarlo más adelante.",
  },
  {
    id: "vacaciones",
    workspace: "rrhh",
    to: "/rrhh/vacaciones",
    icon: Plane,
    title: "Vacaciones y horas",
    description:
      "Los días de vacaciones y las horas de cada persona, con devengo automático: la app va acumulando lo que le corresponde a cada uno sin que tengas que calcularlo a mano.",
  },
  {
    id: "nominas",
    workspace: "rrhh",
    to: "/rrhh/nominas",
    icon: Banknote,
    title: "Nóminas",
    description:
      "El histórico de nóminas de la plantilla, organizado por persona y periodo, para tenerlas siempre a mano sin bucear en carpetas sueltas.",
  },
  {
    id: "trucos-rrhh",
    workspace: "rrhh",
    to: "/costes/asistencia",
    icon: Sparkles,
    title: "Trucos rápidos",
    description:
      "Con Ctrl+K abres el buscador rápido desde cualquier pantalla, y casi todas las secciones tienen botón Exportar con PDF y Excel con el formato de Lasarte. ¡Listo, ya conoces el espacio de RRHH!",
  },

  // ─── Económico ─────────────────────────────────────────────────────────
  {
    id: "panel-economico",
    workspace: "economico",
    to: "/economico",
    icon: Euro,
    title: "Panel económico",
    description:
      "La cuenta de resultados de un vistazo: facturación menos costes igual a margen, con su evolución por semana, mes o campaña. El resumen para saber cómo va el negocio sin entrar en el detalle de cada apartado.",
  },
  {
    id: "facturacion",
    workspace: "economico",
    to: "/economico/facturacion",
    icon: Receipt,
    title: "Facturación",
    description:
      "El detalle de lo facturado, cruzando los datos de ventas de todos los canales para ver de dónde viene cada euro que entra.",
  },
  {
    id: "costes-economico",
    workspace: "economico",
    to: "/economico/costes",
    icon: Droplet,
    title: "Costes",
    description:
      "Los consumos (agua, luz, gasoil, tratamientos) convertidos en coste real aplicando las tarifas de Precios. Así el consumo deja de ser solo un número y se convierte en euros.",
  },
  {
    id: "precios",
    workspace: "economico",
    to: "/economico/precios",
    icon: Tags,
    title: "Precios",
    description:
      "El histórico de tarifas usadas para calcular los costes: agua, luz, gasoil... Recuerda mantenerlas actualizadas con las reales, porque de aquí sale el cálculo de Costes.",
  },
  {
    id: "trucos-economico",
    workspace: "economico",
    to: "/economico",
    icon: Sparkles,
    title: "Trucos rápidos",
    description:
      "Con Ctrl+K abres el buscador rápido desde cualquier pantalla, y casi todas las secciones tienen botón Exportar con PDF y Excel con el formato de Lasarte. ¡Listo, ya conoces el espacio Económico!",
  },
];

/** Filtra los pasos del tour por espacio de trabajo y por los accesos del usuario actual. */
export function getVisibleTourSteps(
  workspace: TourWorkspaceId,
  opts: { hasVentasCategoriaAccess: boolean },
): TourStep[] {
  return TOUR_STEPS.filter((step) => {
    if (step.workspace !== workspace) return false;
    if (step.requiresVentasCategoriaAccess && !opts.hasVentasCategoriaAccess) return false;
    return true;
  });
}

/** Clave de localStorage para marcar el tour de un espacio como visto (v2: uno por espacio). */
export function tourStorageKey(workspace: TourWorkspaceId): string {
  return `lasarte-tour-v2-${workspace}-visto`;
}

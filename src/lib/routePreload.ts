export const pageLoaders = {
  auth: () => import("@/pages/Auth"),
  dashboard: () => import("@/pages/Dashboard"),
  calidad: () => import("@/pages/CalidadJornada"),
  partesList: () => import("@/pages/PartesList"),
  partDetail: () => import("@/pages/PartDetail"),
  consumoCostes: () => import("@/pages/ConsumoCostes"),
  asistencia: () => import("@/pages/Asistencia"),
  asistenciaComparativa: () => import("@/pages/AsistenciaComparativa"),
  notFound: () => import("@/pages/NotFound"),
  productores: () => import("@/pages/Productores"),
  analisisDiario: () => import("@/pages/AnalisisDiario"),
  ventasCategoriaSegunda: () => import("@/pages/VentasCategoriaSegunda"),
  ventasCategoriaPrimera: () => import("@/pages/VentasCategoriaPrimera"),
  mercadona: () => import("@/pages/Mercadona"),
  edeka: () => import("@/pages/Edeka"),
  cmr: () => import("@/pages/CmrHojasRuta"),
  rrhhPersonas: () => import("@/pages/RrhhPersonas"),
  rrhhAusencias: () => import("@/pages/RrhhAusencias"),
  rrhhAmonestaciones: () => import("@/pages/RrhhAmonestaciones"),
  rrhhVacaciones: () => import("@/pages/RrhhVacaciones"),
  rrhhNominas: () => import("@/pages/RrhhNominas"),
};

const preloadByPath: Record<string, () => Promise<unknown>> = {
  "/": pageLoaders.dashboard,
  "/calidad": pageLoaders.calidad,
  "/partes": pageLoaders.partesList,
  "/costes/consumos": pageLoaders.consumoCostes,
  "/costes/asistencia": pageLoaders.asistencia,
  "/costes/asistencia/comparativa": pageLoaders.asistenciaComparativa,
  "/productores": pageLoaders.productores,
  "/analisis/diario": pageLoaders.analisisDiario,
  "/ventas/categoria-segunda": pageLoaders.ventasCategoriaSegunda,
  "/ventas/categoria-primera": pageLoaders.ventasCategoriaPrimera,
  "/mercadona": pageLoaders.mercadona,
  "/edeka": pageLoaders.edeka,
  "/cmr": pageLoaders.cmr,
  "/rrhh/personas": pageLoaders.rrhhPersonas,
  "/rrhh/ausencias": pageLoaders.rrhhAusencias,
  "/rrhh/amonestaciones": pageLoaders.rrhhAmonestaciones,
  "/rrhh/vacaciones": pageLoaders.rrhhVacaciones,
  "/rrhh/nominas": pageLoaders.rrhhNominas,
};

export function preloadRoute(path: string) {
  const loader = preloadByPath[path] ?? (path.startsWith("/partes/") ? pageLoaders.partDetail : null);
  if (loader) void loader();
}

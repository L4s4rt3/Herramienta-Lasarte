export const pageLoaders = {
  auth: () => import("@/pages/Auth"),
  dashboard: () => import("@/pages/Dashboard"),
  partesList: () => import("@/pages/PartesList"),
  partDetail: () => import("@/pages/PartDetail"),
  dsjCalculator: () => import("@/pages/DSJCalculator"),
  consumoCostes: () => import("@/pages/ConsumoCostes"),
  asistencia: () => import("@/pages/Asistencia"),
  asistenciaComparativa: () => import("@/pages/AsistenciaComparativa"),
  notFound: () => import("@/pages/NotFound"),
  productores: () => import("@/pages/Productores"),
  analisisDiario: () => import("@/pages/AnalisisDiario"),
  calendario: () => import("@/pages/CalendarioProduccion"),
};

const preloadByPath: Record<string, () => Promise<unknown>> = {
  "/": pageLoaders.dashboard,
  "/partes": pageLoaders.partesList,
  "/dsj": pageLoaders.dsjCalculator,
  "/costes/consumos": pageLoaders.consumoCostes,
  "/costes/asistencia": pageLoaders.asistencia,
  "/costes/asistencia/comparativa": pageLoaders.asistenciaComparativa,
  "/productores": pageLoaders.productores,
  "/analisis/diario": pageLoaders.analisisDiario,
  "/calendario": pageLoaders.calendario,
};

export function preloadRoute(path: string) {
  const loader = preloadByPath[path] ?? (path.startsWith("/partes/") ? pageLoaders.partDetail : null);
  if (loader) void loader();
}

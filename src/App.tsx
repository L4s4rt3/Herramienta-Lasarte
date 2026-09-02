import type { ReactNode } from "react";
import { lazy, Suspense } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate, useLocation } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/contexts/AuthProvider";
import { ThemeProvider } from "@/contexts/ThemeProvider";
import { I18nProvider } from "@/lib/i18n";
import ProtectedRoute from "@/components/ProtectedRoute";
import RoleRoute, { RoleHome } from "@/components/RoleRoute";
import { ScrollToTop } from "@/components/ScrollToTop";
import AppLayout from "@/components/AppLayout";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { queryClient } from "@/lib/queryClient";
import { pageLoaders as pageLoadersCrudos } from "@/lib/routePreload";
import { envolverCargadoresConRecarga } from "@/lib/recargaTrasDeploy";

// Si el import de una página falla (un deploy invalidó los chunks de esta
// pestaña), se recarga una vez en vez de romper — ver recargaTrasDeploy.ts.
// El evento vite:preloadError de main.tsx no cubre los chunks sin
// dependencias propias: esta envoltura sí.
const pageLoaders = envolverCargadoresConRecarga(pageLoadersCrudos);

const Auth = lazy(pageLoaders.auth);
const Dashboard = lazy(pageLoaders.dashboard);
const CalidadJornada = lazy(pageLoaders.calidad);
const CalidadImportacion = lazy(pageLoaders.calidadImportacion);
const CalidadImportacionControl = lazy(pageLoaders.calidadImportacionControl);
const PartesList = lazy(pageLoaders.partesList);
const PartDetail = lazy(pageLoaders.partDetail);
const NotFound = lazy(pageLoaders.notFound);
const AnalisisDiario = lazy(pageLoaders.analisisDiario);
const Mercadona = lazy(pageLoaders.mercadona);
const Cmr = lazy(pageLoaders.cmr);
const RrhhDashboard = lazy(pageLoaders.rrhhDashboard);
const RrhhNominas = lazy(pageLoaders.rrhhNominas);
const ComercialDashboard = lazy(pageLoaders.comercialDashboard);
const DireccionDashboard = lazy(pageLoaders.direccionDashboard);
const MercadonaProduccion = lazy(pageLoaders.mercadonaProduccion);
const EconomicoPanel = lazy(pageLoaders.economicoPanel);
const EconomicoRentabilidad = lazy(pageLoaders.economicoRentabilidad);
const EconomicoFacturacion = lazy(pageLoaders.economicoFacturacion);
const EconomicoPrecios = lazy(pageLoaders.economicoPrecios);
const MapaHerramienta = lazy(pageLoaders.mapa);
const EntradasBascula = lazy(pageLoaders.entradas);
const TrazabilidadLote = lazy(pageLoaders.trazabilidad);
const LimpiezaBox = lazy(pageLoaders.limpiezaBox);
const StockConsumibles = lazy(pageLoaders.stockConsumibles);
const SafCamiones = lazy(pageLoaders.safCamiones);
const ComunicacionesCampo = lazy(pageLoaders.comunicacionesCampo);
const ExcelViewerPage = lazy(() => import("@/pages/ExcelViewerPage"));

// ─── Rediseño 13-08-2026: páginas que alojan varias vistas en pestañas ──────
// Lo que antes eran 38 entradas de menú son 25. Cada fusión junta páginas que
// contestaban a la MISMA pregunta por ejes distintos; ninguna función se ha
// eliminado, todas viven como pestaña de la superviviente.
const AnalisisPorProductor = lazy(pageLoaders.analisisPorProductor);
const EconomicoCostesPanel = lazy(pageLoaders.economicoCostesPanel);
const RrhhPlantilla = lazy(pageLoaders.rrhhPlantilla);
const RrhhAsistencia = lazy(pageLoaders.rrhhAsistencia);
const ComercialVentasCategoria = lazy(pageLoaders.comercialVentasCategoria);
const DatosImportar = lazy(pageLoaders.datosImportar);
const DatosFuentes = lazy(pageLoaders.datosFuentes);

const LoadingFallback = () => (
  <div className="flex min-h-screen items-center justify-center">
    <div className="flex items-center gap-3 rounded-xl glass-accented px-5 py-4">
      <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary/25 border-t-primary" />
      <span className="text-sm font-medium text-muted-foreground">Cargando herramienta...</span>
    </div>
  </div>
);

/**
 * El ErrorBoundary con key = ruta: un crash de render en una página se reinicia
 * solo al navegar a otra (antes el estado de error se quedaba pegado hasta
 * recargar) y el error se registra con la ruta en la que pasó.
 */
function LimiteDeErroresPorRuta({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  return <ErrorBoundary key={pathname} ruta={pathname}>{children}</ErrorBoundary>;
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <I18nProvider>
        <ThemeProvider>
          <Toaster />
          <Sonner />
          <BrowserRouter>
          <ScrollToTop />
          <AuthProvider>
            <LimiteDeErroresPorRuta>
              <Suspense fallback={<LoadingFallback />}>
                <Routes>
                  <Route path="/auth" element={<Auth />} />
                  <Route
                    element={
                      <ProtectedRoute>
                        <AppLayout />
                      </ProtectedRoute>
                    }
                  >
                    <Route element={<RoleRoute />}>
                      {/* "/" es la home por rol: cada rol aterriza en su dashboard. */}
                      <Route path="/" element={<RoleHome />} />
                      <Route path="/mapa" element={<MapaHerramienta />} />
                      <Route path="/produccion" element={<Dashboard />} />
                      <Route path="/entradas" element={<EntradasBascula />} />
                      <Route path="/trazabilidad" element={<TrazabilidadLote />} />
                      <Route path="/calidad" element={<CalidadJornada />} />
                      {/* Calidad de importación: los controles de contenedores/camiones
                          de fuera (SAF etc.), pensados para rellenarse desde el móvil. */}
                      <Route path="/calidad/importacion" element={<CalidadImportacion />} />
                      <Route path="/calidad/importacion/:id" element={<CalidadImportacionControl />} />
                      <Route path="/partes" element={<PartesList />} />
                      <Route path="/partes/:id" element={<PartDetail />} />
                      <Route path="/limpieza" element={<LimpiezaBox />} />
                      {/* Stock de consumibles: el inventario continuo del almacén,
                          pensado para editarse desde el móvil (conteo del 01-09-2026). */}
                      <Route path="/consumibles" element={<StockConsumibles />} />
                      <Route path="/datos/fuentes" element={<DatosFuentes />} />
                      {/* Importación SAF: el Laadbon de cada camión y el cuadre con el ERP
                          (02-09-2026). Admin por el prefijo /datos (ADMIN_ONLY_PATHS). */}
                      <Route path="/datos/saf" element={<SafCamiones />} />
                      <Route path="/importar" element={<DatosImportar />} />
                      <Route path="/costes/asistencia" element={<RrhhAsistencia />} />
                      <Route path="/productores" element={<AnalisisPorProductor />} />
                      {/* Comunicaciones de campaña: exclusiva de Jesús (jesus@lasartesat.es)
                          y admin — el gate real es la RPC can_access_comunicaciones_campo
                          dentro de la propia página/hook (patrón Categoría segunda). */}
                      <Route path="/campo/comunicaciones" element={<ComunicacionesCampo />} />
                      <Route path="/analisis/diario" element={<AnalisisDiario />} />
                      <Route path="/ventas/categoria-segunda" element={<ComercialVentasCategoria />} />
                      <Route path="/direccion" element={<DireccionDashboard />} />
                      <Route path="/comercial" element={<ComercialDashboard />} />
                      {/* Producción: Mercadona enfocada a fruta (productores, lotes, calidad, aprovechamiento). */}
                      <Route path="/mercadona" element={<MercadonaProduccion />} />
                      <Route path="/comercial/mercadona" element={<Mercadona />} />
                      <Route path="/cmr" element={<Cmr />} />
                      <Route path="/rrhh" element={<RrhhDashboard />} />
                      <Route path="/rrhh/personas" element={<RrhhPlantilla />} />
                      <Route path="/rrhh/nominas" element={<RrhhNominas />} />
                      <Route path="/economico" element={<EconomicoPanel />} />
                      <Route path="/economico/rentabilidad" element={<EconomicoRentabilidad />} />
                      <Route path="/economico/facturacion" element={<EconomicoFacturacion />} />
                      <Route path="/economico/costes" element={<EconomicoCostesPanel />} />
                      <Route path="/economico/precios" element={<EconomicoPrecios />} />

                      {/* ─── Páginas absorbidas por el rediseño 13-08-2026 ───
                          Ninguna se ha borrado: cada una es hoy una PESTAÑA de
                          la superviviente. Estas redirecciones existen porque
                          hay ~120 enlaces internos cableados a estas rutas (23
                          solo a /trazabilidad) más los enlaces que la gente
                          tenga guardados. `replace` para que el botón de atrás
                          no rebote entre la ruta vieja y la nueva. */}
                      <Route path="/calibrador" element={<Navigate to="/productores?vista=calibrador" replace />} />
                      <Route path="/historico" element={<Navigate to="/importar?modo=historico" replace />} />
                      <Route path="/costes/consumos" element={<Navigate to="/economico/costes?vista=consumos" replace />} />
                      <Route path="/economico/cmv" element={<Navigate to="/economico/costes?vista=cmv" replace />} />
                      <Route path="/economico/productos" element={<Navigate to="/economico/costes?vista=productos" replace />} />
                      <Route path="/economico/fruta" element={<Navigate to="/economico/costes?vista=fruta" replace />} />
                      <Route path="/costes/asistencia/comparativa" element={<Navigate to="/costes/asistencia?vista=comparativa" replace />} />
                      <Route path="/rrhh/ausencias" element={<Navigate to="/rrhh/personas?vista=ausencias" replace />} />
                      <Route path="/rrhh/amonestaciones" element={<Navigate to="/rrhh/personas?vista=amonestaciones" replace />} />
                      <Route path="/rrhh/vacaciones" element={<Navigate to="/rrhh/personas?vista=vacaciones" replace />} />
                      <Route path="/rrhh/comunicaciones" element={<Navigate to="/rrhh/personas?vista=comunicaciones" replace />} />
                      <Route path="/ventas/categoria-primera" element={<Navigate to="/ventas/categoria-segunda?categoria=primera" replace />} />
                      <Route path="/comercial/ventas-mes" element={<Navigate to="/ventas/categoria-segunda?categoria=importar" replace />} />
                      {/* /rrhh/mercadona servía el MISMO componente que
                          /comercial/mercadona: dos URLs para una página. */}
                      <Route path="/rrhh/mercadona" element={<Navigate to="/comercial/mercadona" replace />} />
                    </Route>
                  </Route>
                  <Route
                    path="/ver-excel/:fileId"
                    element={
                      <ProtectedRoute>
                        <ExcelViewerPage />
                      </ProtectedRoute>
                    }
                  />
                  <Route path="/index" element={<Navigate to="/" replace />} />
                  {/* Fuera de ProtectedRoute/RoleRoute a propósito: un usuario sin sesión
                      debe poder ver el 404 sin que se le fuerce antes por /auth, y esto
                      mantiene el comportamiento previo para todos los roles. Un "ventas"
                      autenticado que llegue aquí ve el mismo 404 que cualquier otro rol;
                      su enlace "Volver al panel" apunta a "/", la home por rol (RoleHome). */}
                  <Route path="*" element={<NotFound />} />
                </Routes>
              </Suspense>
            </LimiteDeErroresPorRuta>
          </AuthProvider>
        </BrowserRouter>
        </ThemeProvider>
      </I18nProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;

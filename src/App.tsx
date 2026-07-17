import { lazy, Suspense } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
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
import { pageLoaders } from "@/lib/routePreload";

const Auth = lazy(pageLoaders.auth);
const Dashboard = lazy(pageLoaders.dashboard);
const CalidadJornada = lazy(pageLoaders.calidad);
const PartesList = lazy(pageLoaders.partesList);
const PartDetail = lazy(pageLoaders.partDetail);
const ConsumoCostes = lazy(pageLoaders.consumoCostes);
const Asistencia = lazy(pageLoaders.asistencia);
const AsistenciaComparativa = lazy(pageLoaders.asistenciaComparativa);
const NotFound = lazy(pageLoaders.notFound);
const Productores = lazy(pageLoaders.productores);
const AnalisisDiario = lazy(pageLoaders.analisisDiario);
const VentasCategoriaSegunda = lazy(pageLoaders.ventasCategoriaSegunda);
const VentasCategoriaPrimera = lazy(pageLoaders.ventasCategoriaPrimera);
const Mercadona = lazy(pageLoaders.mercadona);
const Cmr = lazy(pageLoaders.cmr);
const RrhhDashboard = lazy(pageLoaders.rrhhDashboard);
const RrhhPersonas = lazy(pageLoaders.rrhhPersonas);
const RrhhAusencias = lazy(pageLoaders.rrhhAusencias);
const RrhhAmonestaciones = lazy(pageLoaders.rrhhAmonestaciones);
const RrhhVacaciones = lazy(pageLoaders.rrhhVacaciones);
const RrhhNominas = lazy(pageLoaders.rrhhNominas);
const RrhhComunicaciones = lazy(pageLoaders.rrhhComunicaciones);
const ComercialDashboard = lazy(pageLoaders.comercialDashboard);
const DireccionDashboard = lazy(pageLoaders.direccionDashboard);
const MercadonaProduccion = lazy(pageLoaders.mercadonaProduccion);
const VentasMensualImport = lazy(pageLoaders.ventasMensualImport);
const EconomicoPanel = lazy(pageLoaders.economicoPanel);
const EconomicoCmv = lazy(pageLoaders.economicoCmv);
const EconomicoFacturacion = lazy(pageLoaders.economicoFacturacion);
const EconomicoCostes = lazy(pageLoaders.economicoCostes);
const EconomicoFruta = lazy(pageLoaders.economicoFruta);
const EconomicoPrecios = lazy(pageLoaders.economicoPrecios);
const MapaHerramienta = lazy(pageLoaders.mapa);
const EntradasBascula = lazy(pageLoaders.entradas);
const TrazabilidadLote = lazy(pageLoaders.trazabilidad);
const LimpiezaBox = lazy(pageLoaders.limpiezaBox);
const HistoricoImport = lazy(pageLoaders.historicoImport);
const ComunicacionesCampo = lazy(pageLoaders.comunicacionesCampo);
const ExcelViewerPage = lazy(() => import("@/pages/ExcelViewerPage"));

const LoadingFallback = () => (
  <div className="flex min-h-screen items-center justify-center">
    <div className="flex items-center gap-3 rounded-xl glass-accented px-5 py-4">
      <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary/25 border-t-primary" />
      <span className="text-sm font-medium text-muted-foreground">Cargando herramienta...</span>
    </div>
  </div>
);

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
            <ErrorBoundary>
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
                      <Route path="/partes" element={<PartesList />} />
                      <Route path="/partes/:id" element={<PartDetail />} />
                      <Route path="/costes/consumos" element={<ConsumoCostes />} />
                      <Route path="/limpieza" element={<LimpiezaBox />} />
                      <Route path="/historico" element={<HistoricoImport />} />
                      <Route path="/costes/asistencia" element={<Asistencia />} />
                      <Route path="/costes/asistencia/comparativa" element={<AsistenciaComparativa />} />
                      <Route path="/productores" element={<Productores />} />
                      {/* Comunicaciones de campaña: exclusiva de Jesús (jesus@lasartesat.es)
                          y admin — el gate real es la RPC can_access_comunicaciones_campo
                          dentro de la propia página/hook (patrón Categoría segunda). */}
                      <Route path="/campo/comunicaciones" element={<ComunicacionesCampo />} />
                      <Route path="/analisis/diario" element={<AnalisisDiario />} />
                      <Route path="/ventas/categoria-segunda" element={<VentasCategoriaSegunda />} />
                      <Route path="/ventas/categoria-primera" element={<VentasCategoriaPrimera />} />
                      <Route path="/direccion" element={<DireccionDashboard />} />
                      <Route path="/comercial" element={<ComercialDashboard />} />
                      <Route path="/comercial/ventas-mes" element={<VentasMensualImport />} />
                      {/* Producción: Mercadona enfocada a fruta (productores, lotes, calidad, aprovechamiento). */}
                      <Route path="/mercadona" element={<MercadonaProduccion />} />
                      <Route path="/comercial/mercadona" element={<Mercadona />} />
                      {/* Mercadona en RRHH: completa (kg, facturas y precios), para rrhh+admin. */}
                      <Route path="/rrhh/mercadona" element={<Mercadona />} />
                      <Route path="/cmr" element={<Cmr />} />
                      <Route path="/rrhh" element={<RrhhDashboard />} />
                      <Route path="/rrhh/personas" element={<RrhhPersonas />} />
                      <Route path="/rrhh/ausencias" element={<RrhhAusencias />} />
                      <Route path="/rrhh/amonestaciones" element={<RrhhAmonestaciones />} />
                      <Route path="/rrhh/vacaciones" element={<RrhhVacaciones />} />
                      <Route path="/rrhh/nominas" element={<RrhhNominas />} />
                      <Route path="/rrhh/comunicaciones" element={<RrhhComunicaciones />} />
                      <Route path="/economico" element={<EconomicoPanel />} />
                      <Route path="/economico/cmv" element={<EconomicoCmv />} />
                      <Route path="/economico/facturacion" element={<EconomicoFacturacion />} />
                      <Route path="/economico/costes" element={<EconomicoCostes />} />
                      <Route path="/economico/fruta" element={<EconomicoFruta />} />
                      <Route path="/economico/precios" element={<EconomicoPrecios />} />
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
            </ErrorBoundary>
          </AuthProvider>
        </BrowserRouter>
        </ThemeProvider>
      </I18nProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;

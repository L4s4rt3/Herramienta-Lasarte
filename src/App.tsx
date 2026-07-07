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
import RoleRoute from "@/components/RoleRoute";
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
const Edeka = lazy(pageLoaders.edeka);
const Cmr = lazy(pageLoaders.cmr);
const RrhhPersonas = lazy(pageLoaders.rrhhPersonas);
const RrhhAusencias = lazy(pageLoaders.rrhhAusencias);
const RrhhAmonestaciones = lazy(pageLoaders.rrhhAmonestaciones);
const RrhhVacaciones = lazy(pageLoaders.rrhhVacaciones);
const RrhhNominas = lazy(pageLoaders.rrhhNominas);
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
                      <Route path="/" element={<Dashboard />} />
                      <Route path="/calidad" element={<CalidadJornada />} />
                      <Route path="/partes" element={<PartesList />} />
                      <Route path="/partes/:id" element={<PartDetail />} />
                      <Route path="/costes/consumos" element={<ConsumoCostes />} />
                      <Route path="/costes/asistencia" element={<Asistencia />} />
                      <Route path="/costes/asistencia/comparativa" element={<AsistenciaComparativa />} />
                      <Route path="/productores" element={<Productores />} />
                      <Route path="/analisis/diario" element={<AnalisisDiario />} />
                      <Route path="/ventas/categoria-segunda" element={<VentasCategoriaSegunda />} />
                      <Route path="/ventas/categoria-primera" element={<VentasCategoriaPrimera />} />
                      <Route path="/mercadona" element={<Mercadona />} />
                      <Route path="/edeka" element={<Edeka />} />
                      <Route path="/cmr" element={<Cmr />} />
                      <Route path="/rrhh/personas" element={<RrhhPersonas />} />
                      <Route path="/rrhh/ausencias" element={<RrhhAusencias />} />
                      <Route path="/rrhh/amonestaciones" element={<RrhhAmonestaciones />} />
                      <Route path="/rrhh/vacaciones" element={<RrhhVacaciones />} />
                      <Route path="/rrhh/nominas" element={<RrhhNominas />} />
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
                      su enlace "Volver al panel" apunta a "/", que RoleRoute ya redirige
                      a /ventas/categoria-segunda. */}
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

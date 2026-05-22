import { lazy, Suspense } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/contexts/AuthProvider";
import { ThemeProvider } from "@/contexts/ThemeProvider";
import { I18nProvider } from "@/lib/i18n";
import ProtectedRoute from "@/components/ProtectedRoute";
import AppLayout from "@/components/AppLayout";
import { ErrorBoundary } from "@/components/ErrorBoundary";

const Auth = lazy(() => import("./pages/Auth"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const PartesList = lazy(() => import("./pages/PartesList"));
const PartDetail = lazy(() => import("./pages/PartDetail"));
const DSJCalculator = lazy(() => import("./pages/DSJCalculator"));
const ConsumoCostes = lazy(() => import("./pages/ConsumoCostes"));
const Asistencia = lazy(() => import("./pages/Asistencia"));
const NotFound = lazy(() => import("./pages/NotFound"));
const StockCamara = lazy(() => import("./pages/StockCamara"));
const Productores = lazy(() => import("./pages/Productores"));
const CalibreAnalysis = lazy(() => import("./pages/CalibreAnalysis"));
const AnalisisInformes = lazy(() => import("./pages/AnalisisInformes"));
const AnalisisDiario = lazy(() => import("./pages/AnalisisDiario"));
const Calendario = lazy(() => import("./pages/Calendario"));

const queryClient = new QueryClient();

const LoadingFallback = () => (
  <div className="flex items-center justify-center min-h-screen">
    <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary"></div>
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
                    <Route path="/" element={<Dashboard />} />
                    <Route path="/partes" element={<PartesList />} />
                    <Route path="/partes/:id" element={<PartDetail />} />
                    <Route path="/dsj" element={<DSJCalculator />} />
                    <Route path="/costes/consumos" element={<ConsumoCostes />} />
                    <Route path="/costes/asistencia" element={<Asistencia />} />
                    <Route path="/stock" element={<StockCamara />} />
                    <Route path="/productores" element={<Productores />} />
                    <Route path="/analisis/calibres" element={<CalibreAnalysis />} />
                    <Route path="/analisis/informes" element={<AnalisisInformes />} />
                    <Route path="/analisis/diario" element={<AnalisisDiario />} />
                    <Route path="/calendario" element={<Calendario />} />
                  </Route>
                  <Route path="/index" element={<Navigate to="/" replace />} />
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

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/contexts/AuthProvider";
import { I18nProvider } from "@/lib/i18n";
import ProtectedRoute from "@/components/ProtectedRoute";
import AppLayout from "@/components/AppLayout";
import Auth from "./pages/Auth";
import Dashboard from "./pages/Dashboard";
import PartesList from "./pages/PartesList";
import PartDetail from "./pages/PartDetail";
import DSJCalculator from "./pages/DSJCalculator";
import ConsumoCostes from "./pages/ConsumoCostes";
import Asistencia from "./pages/Asistencia";
import NotFound from "./pages/NotFound";
import StockCamara from "./pages/StockCamara";
import Productores from "./pages/Productores";
import CalibreAnalysis from "./pages/CalibreAnalysis";
import AnalisisInformes from "./pages/AnalisisInformes";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <I18nProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <AuthProvider>
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
              </Route>
              <Route path="/index" element={<Navigate to="/" replace />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </AuthProvider>
        </BrowserRouter>
      </I18nProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;

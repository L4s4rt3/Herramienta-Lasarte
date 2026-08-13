// src/pages/AnalisisPorProductor.tsx
// "Análisis → Por productor": el dossier de cada productor y el aprovechamiento
// que mide la máquina, en una sola página.
//
// POR QUÉ SE FUNDIERON. /productores y /calibrador contestaban a la MISMA
// pregunta — cuánto aprovecha la fruta de cada productor — y daban respuestas
// distintas, porque cada una bebía de un sitio: la primera de la clasificación
// del Word (nombres de finca: "LA TORRECILLA", "INVERMARMELO") y la segunda del
// volcado del calibrador con el catálogo canónico ("LASARTE EXPORT SL Gesfrumed
// SL"). Quien las comparaba se llevaba dos verdades.
//
// Desde el 13-08-2026 las dos leen `clasificacion_lote`, así que ya no hay dos
// cifras que defender: son dos MIRADAS sobre la misma. Dossier = el histórico
// completo del productor; Aprovechamiento = el reparto por destino que hace la
// máquina, con las pasadas que hay que desglosar a mano.
import { lazy, Suspense } from "react";
import { PaginaConVistas } from "@/components/PaginaConVistas";

const Productores = lazy(() => import("@/pages/Productores"));
const Calibrador = lazy(() => import("@/pages/Calibrador"));

const Cargando = () => (
  <div className="flex items-center gap-3 rounded-xl glass-accented px-5 py-4">
    <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary/25 border-t-primary" />
    <span className="text-sm text-muted-foreground">Cargando…</span>
  </div>
);

export default function AnalisisPorProductor() {
  return (
    <PaginaConVistas
      vistas={[
        {
          id: "dossier",
          label: "Dossier por productor",
          render: () => <Suspense fallback={<Cargando />}><Productores /></Suspense>,
        },
        {
          id: "calibrador",
          label: "Aprovechamiento (calibrador)",
          render: () => <Suspense fallback={<Cargando />}><Calibrador /></Suspense>,
        },
      ]}
    />
  );
}

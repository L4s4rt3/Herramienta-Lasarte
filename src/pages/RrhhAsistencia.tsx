// src/pages/RrhhAsistencia.tsx
// "RRHH → Asistencia": el pase de lista del día y la comparativa entre
// periodos, que antes eran dos rutas (/costes/asistencia y su /comparativa).
//
// La comparativa no es otra pregunta: es la MISMA mirada a más días. Como
// página aparte obligaba a volver atrás para cambiar de una a otra.
import { lazy, Suspense } from "react";
import { PaginaConVistas } from "@/components/PaginaConVistas";

const Asistencia = lazy(() => import("@/pages/Asistencia"));
const AsistenciaComparativa = lazy(() => import("@/pages/AsistenciaComparativa"));

const Cargando = () => (
  <div className="flex items-center gap-3 rounded-xl glass-accented px-5 py-4">
    <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary/25 border-t-primary" />
    <span className="text-sm text-muted-foreground">Cargando…</span>
  </div>
);

export default function RrhhAsistencia() {
  return (
    <PaginaConVistas
      vistas={[
        {
          id: "diaria",
          label: "Asistencia diaria",
          render: () => <Suspense fallback={<Cargando />}><Asistencia /></Suspense>,
        },
        {
          id: "comparativa",
          label: "Comparativa",
          render: () => <Suspense fallback={<Cargando />}><AsistenciaComparativa /></Suspense>,
        },
      ]}
    />
  );
}

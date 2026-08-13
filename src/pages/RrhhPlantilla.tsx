// src/pages/RrhhPlantilla.tsx
// "RRHH → Plantilla": el expediente completo de cada persona.
//
// POR QUÉ SE FUNDIERON CINCO PÁGINAS. Personas, Ausencias, Amonestaciones,
// Vacaciones y Comunicaciones son todas el expediente de la MISMA persona.
// Separadas, contestar "¿qué pasa con Fulano?" obligaba a buscar a Fulano cinco
// veces, una por página, y a cruzar a ojo lo que salía en cada una.
import { lazy, Suspense } from "react";
import { PaginaConVistas } from "@/components/PaginaConVistas";

const RrhhPersonas = lazy(() => import("@/pages/RrhhPersonas"));
const RrhhAusencias = lazy(() => import("@/pages/RrhhAusencias"));
const RrhhAmonestaciones = lazy(() => import("@/pages/RrhhAmonestaciones"));
const RrhhVacaciones = lazy(() => import("@/pages/RrhhVacaciones"));
const RrhhComunicaciones = lazy(() => import("@/pages/RrhhComunicaciones"));

const Cargando = () => (
  <div className="flex items-center gap-3 rounded-xl glass-accented px-5 py-4">
    <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary/25 border-t-primary" />
    <span className="text-sm text-muted-foreground">Cargando…</span>
  </div>
);

const envuelto = (C: React.ComponentType) => () => (
  <Suspense fallback={<Cargando />}><C /></Suspense>
);

export default function RrhhPlantilla() {
  return (
    <PaginaConVistas
      vistas={[
        { id: "personas", label: "Personas", render: envuelto(RrhhPersonas) },
        { id: "ausencias", label: "Ausencias y bajas", render: envuelto(RrhhAusencias) },
        { id: "amonestaciones", label: "Amonestaciones", render: envuelto(RrhhAmonestaciones) },
        { id: "vacaciones", label: "Vacaciones y horas", render: envuelto(RrhhVacaciones) },
        { id: "comunicaciones", label: "Comunicaciones", render: envuelto(RrhhComunicaciones) },
      ]}
    />
  );
}

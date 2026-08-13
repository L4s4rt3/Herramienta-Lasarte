// src/pages/EconomicoCostesPanel.tsx
// "Económico → Costes": todo lo que responde a "cuánto cuesta", por sus ejes.
//
// POR QUÉ SE FUNDIERON CINCO PÁGINAS. Costes, Consumos, CMV, Coste por producto
// y Compra de fruta contestaban a la misma pregunta desde ángulos distintos, y
// estaban repartidas entre dos secciones (Consumos vivía en Producción, el
// resto en Económico). Para comparar el coste de un recurso con el CMV del
// producto que lo consume había que saltar de sección.
//
//   Recursos       — consumos físicos × tarifa vigente (era /economico/costes)
//   Consumos       — el control operativo del recurso  (era /costes/consumos)
//   Fruta          — lo que costó la fruta que entró   (era /economico/fruta)
//   CMV            — coste por kg vendido del mes      (era /economico/cmv)
//   Por producto   — CMV de cada producto y su margen  (era /economico/productos)
//
// "Por producto" ni siquiera tenía entrada en el menú: existía la ruta y no
// había forma de llegar salvo escribiendo la URL.
import { lazy, Suspense } from "react";
import { PaginaConVistas } from "@/components/PaginaConVistas";

const EconomicoCostes = lazy(() => import("@/pages/EconomicoCostes"));
const ConsumoCostes = lazy(() => import("@/pages/ConsumoCostes"));
const EconomicoFruta = lazy(() => import("@/pages/EconomicoFruta"));
const EconomicoCmv = lazy(() => import("@/pages/EconomicoCmv"));
const EconomicoProductos = lazy(() => import("@/pages/EconomicoProductos"));

const Cargando = () => (
  <div className="flex items-center gap-3 rounded-xl glass-accented px-5 py-4">
    <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary/25 border-t-primary" />
    <span className="text-sm text-muted-foreground">Cargando…</span>
  </div>
);

const envuelto = (C: React.ComponentType) => () => (
  <Suspense fallback={<Cargando />}><C /></Suspense>
);

export default function EconomicoCostesPanel() {
  return (
    <PaginaConVistas
      vistas={[
        { id: "recursos", label: "Recursos", render: envuelto(EconomicoCostes) },
        { id: "consumos", label: "Consumos", render: envuelto(ConsumoCostes) },
        { id: "fruta", label: "Compra de fruta", render: envuelto(EconomicoFruta) },
        { id: "cmv", label: "CMV", render: envuelto(EconomicoCmv) },
        { id: "productos", label: "Por producto", render: envuelto(EconomicoProductos) },
      ]}
    />
  );
}

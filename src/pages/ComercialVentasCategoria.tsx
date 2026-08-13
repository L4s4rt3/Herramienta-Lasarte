// src/pages/ComercialVentasCategoria.tsx
// "Comercial → Ventas por categoría": primera y segunda en una sola página, con
// selector, más el importador mensual.
//
// POR QUÉ SE FUNDIERON. `VentasCategoriaPrimera.tsx` eran CATORCE líneas que
// montaban el mismo componente que la segunda con otro nombre de categoría —
// literalmente la misma página con un parámetro distinto. Dos entradas de menú
// para eso obligaban a volver al menú cada vez que se quería comparar una
// categoría con la otra, que es lo que se quiere hacer casi siempre.
//
// EL PERMISO SIGUE SIENDO DE LA SEGUNDA. `VentasCategoriaPage` ya comprueba por
// dentro (useVentasCategoria → RPC can_access_ventas_categoria) si el correo
// está autorizado, y pinta su propio aviso si no lo está. Al fundirlas ese
// control NO se toca: quien no tenga acceso a la segunda ve el aviso en esa
// pestaña y sigue viendo la primera con normalidad, igual que antes.
import { lazy, Suspense } from "react";
import { PaginaConVistas } from "@/components/PaginaConVistas";
import { VentasCategoriaPage } from "@/pages/VentasCategoriaSegunda";

const VentasMensualImport = lazy(() => import("@/pages/VentasMensualImport"));

const Cargando = () => (
  <div className="flex items-center gap-3 rounded-xl glass-accented px-5 py-4">
    <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary/25 border-t-primary" />
    <span className="text-sm text-muted-foreground">Cargando…</span>
  </div>
);

export default function ComercialVentasCategoria() {
  return (
    <PaginaConVistas
      param="categoria"
      vistas={[
        {
          id: "segunda",
          label: "Categoría segunda",
          render: () => (
            <VentasCategoriaPage
              categoriaNombre="Categoria segunda"
              titulo="Categoría segunda"
              subtitulo="Sin categoría"
            />
          ),
        },
        {
          id: "primera",
          label: "Categoría primera",
          render: () => (
            <VentasCategoriaPage
              categoriaNombre="Categoria primera"
              titulo="Categoría primera"
              subtitulo="Ventas del resto de productos y clientes (primera categoría)."
            />
          ),
        },
        {
          id: "importar",
          label: "Importar ventas del mes",
          render: () => <Suspense fallback={<Cargando />}><VentasMensualImport /></Suspense>,
        },
      ]}
    />
  );
}

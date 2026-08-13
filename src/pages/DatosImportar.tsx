// src/pages/DatosImportar.tsx
// "Datos → Importar": meter archivos en la Herramienta, sean de hoy o de hace
// ocho meses.
//
// POR QUÉ SE FUNDIERON. /importar (la bandeja: suelta un montón de archivos
// mezclados y los clasifica) y /historico (la carga masiva del histórico de
// campaña) son la MISMA acción con distinta antigüedad. Tenerlas como dos
// entradas de menú obligaba a saber de antemano cuál te tocaba, que es
// exactamente lo que la herramienta debería resolver sola.
import { lazy, Suspense } from "react";
import { PaginaConVistas } from "@/components/PaginaConVistas";

const ImportarBandeja = lazy(() => import("@/pages/ImportarBandeja"));
const HistoricoImport = lazy(() => import("@/pages/HistoricoImport"));

const Cargando = () => (
  <div className="flex items-center gap-3 rounded-xl glass-accented px-5 py-4">
    <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary/25 border-t-primary" />
    <span className="text-sm text-muted-foreground">Cargando…</span>
  </div>
);

export default function DatosImportar() {
  return (
    <PaginaConVistas
      param="modo"
      vistas={[
        {
          id: "bandeja",
          label: "Bandeja de importación",
          render: () => <Suspense fallback={<Cargando />}><ImportarBandeja /></Suspense>,
        },
        {
          id: "historico",
          label: "Histórico de campaña",
          render: () => <Suspense fallback={<Cargando />}><HistoricoImport /></Suspense>,
        },
      ]}
    />
  );
}

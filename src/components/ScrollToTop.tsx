// ScrollToTop — al cambiar de página (pathname) la vista vuelve arriba.
// Sin esto, navegar desde media tabla de Partes a Calidad aterrizaba a media
// página. Solo reacciona a cambios de ruta, no de query params (los filtros
// de Análisis diario viven en la URL y no deben mover el scroll).
import { useEffect } from "react";
import { useLocation } from "react-router-dom";

export function ScrollToTop() {
  const { pathname } = useLocation();

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "instant" as ScrollBehavior });
  }, [pathname]);

  return null;
}

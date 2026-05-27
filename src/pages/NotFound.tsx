import { useLocation } from "react-router-dom";
import { useEffect } from "react";

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    console.error("404 Error: User attempted to access non-existent route:", location.pathname);
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="glass-accented max-w-md p-8 text-center">
        <p className="panel-kicker">Ruta no encontrada</p>
        <h1 className="mt-2 text-4xl font-bold">404</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Esta pantalla no existe dentro de la herramienta de control de producción.
        </p>
        <a href="/" className="mt-6 inline-flex rounded-xl border border-[var(--glass-border-accent)] bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-[var(--glass-shadow)] transition-colors hover:bg-primary/90">
          Volver al panel
        </a>
      </div>
    </div>
  );
};

export default NotFound;

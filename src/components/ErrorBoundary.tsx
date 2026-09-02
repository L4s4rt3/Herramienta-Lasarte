import { Component, type ReactNode, type ErrorInfo } from "react";
import { Button } from "@/components/ui/button";
import { AlertTriangle, RefreshCw, Undo2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  /** Ruta actual: se guarda con el error y, al cambiar, App remonta el boundary. */
  ruta?: string;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * Captura los errores de render y enseña una pantalla de aviso en vez de una
 * pantalla en blanco.
 *
 * Desde el 02-09-2026:
 * - Deja RASTRO en public.app_errores (ruta, mensaje, pila, usuario, navegador),
 *   best-effort: antes solo hacía console.error y los crashes de producción
 *   eran invisibles para quien mantiene la Herramienta.
 * - Se REINICIA al navegar: App.tsx lo monta con key = ruta, así que salir de la
 *   página rota basta para seguir usando la app. Antes el estado de error se
 *   quedaba pegado hasta recargar.
 * - Botón «Volver a intentar» (handleReset), que antes existía y no estaba
 *   cableado a nada.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error("[ErrorBoundary] Caught error:", error, errorInfo);
    void registrarErrorApp(error, errorInfo, this.props.ruta);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="flex min-h-[60vh] items-center justify-center p-8">
          <div className="text-center max-w-md space-y-4">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10">
              <AlertTriangle className="h-7 w-7 text-destructive" />
            </div>
            <h2 className="text-xl font-semibold tracking-tight">Algo salió mal</h2>
            <p className="text-sm text-muted-foreground">
              Esta pantalla ha fallado. El error ha quedado registrado para revisarlo; puedes volver a
              intentarlo, recargar o ir a otra sección desde el menú.
            </p>
            {this.state.error && (
              <details className="max-h-32 overflow-y-auto rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg)] p-3 text-left text-xs text-muted-foreground backdrop-blur-sm">
                <summary className="cursor-pointer font-medium">Detalles del error</summary>
                <pre className="mt-2 whitespace-pre-wrap">{this.state.error.message}</pre>
              </details>
            )}
            <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
              <Button onClick={this.handleReset}>
                <Undo2 className="h-4 w-4 mr-1.5" />
                Volver a intentar
              </Button>
              <Button variant="outline" onClick={() => window.location.reload()}>
                <RefreshCw className="h-4 w-4 mr-1.5" />
                Recargar página
              </Button>
              <Button variant="ghost" onClick={() => { window.location.href = "/"; }}>
                Ir al inicio
              </Button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

/** Rastro del error en la base. Nunca lanza: registrar no puede romper la pantalla de error. */
async function registrarErrorApp(error: Error, info: ErrorInfo, ruta: string | undefined): Promise<void> {
  try {
    const { data } = await supabase.auth.getUser();
    const userId = data.user?.id;
    if (!userId) return; // la política exige el propio uid; sin sesión no hay a quién atribuirlo
    await supabase.from("app_errores").insert({
      user_id: userId,
      ruta: ruta ?? (typeof window !== "undefined" ? window.location.pathname : null),
      mensaje: String(error.message ?? error).slice(0, 2000),
      pila: (error.stack ?? "").slice(0, 8000) || null,
      componente: (info.componentStack ?? "").slice(0, 4000) || null,
      agente: typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 300) : null,
      version_app: typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : null,
    });
  } catch (e) {
    console.warn("[ErrorBoundary] no se pudo registrar el error:", e);
  }
}

// Vite puede inyectar la versión del build en vite.config.ts (define). Si no
// existe, queda null: no es obligatorio.
declare const __APP_VERSION__: string | undefined;

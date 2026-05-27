import { Component, type ReactNode, type ErrorInfo } from "react";
import { Button } from "@/components/ui/button";
import { AlertTriangle, RefreshCw } from "lucide-react";

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * Generic error boundary that catches render errors and shows a fallback UI.
 * Wraps the app routes so a crash doesn't show a white screen.
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
              Ha ocurrido un error inesperado. Puedes intentar recargar la página o volver al inicio.
            </p>
            {this.state.error && (
              <details className="max-h-32 overflow-y-auto rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg)] p-3 text-left text-xs text-muted-foreground backdrop-blur-sm">
                <summary className="cursor-pointer font-medium">Detalles del error</summary>
                <pre className="mt-2 whitespace-pre-wrap">{this.state.error.message}</pre>
              </details>
            )}
            <div className="flex items-center justify-center gap-3 pt-2">
              <Button variant="outline" onClick={() => window.location.reload()}>
                <RefreshCw className="h-4 w-4 mr-1.5" />
                Recargar página
              </Button>
              <Button onClick={() => { window.location.href = "/"; }}>
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

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { partesQueryOptions } from "@/hooks/usePartes";
import { preloadRoute } from "@/lib/routePreload";

declare global {
  interface Window {
    requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number;
    cancelIdleCallback?: (handle: number) => void;
  }
}

export function useDataWarmup() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const warmup = () => {
      void queryClient.prefetchQuery(partesQueryOptions);
      ["/partes", "/analisis/diario", "/calendario", "/productores", "/costes/consumos"].forEach(preloadRoute);
    };

    if (window.requestIdleCallback) {
      const handle = window.requestIdleCallback(warmup, { timeout: 1500 });
      return () => window.cancelIdleCallback?.(handle);
    }

    const handle = window.setTimeout(warmup, 600);
    return () => window.clearTimeout(handle);
  }, [queryClient]);
}

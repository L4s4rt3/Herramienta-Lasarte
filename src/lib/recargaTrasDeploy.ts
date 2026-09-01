/**
 * Recuperación automática cuando un deploy invalida los chunks en diferido.
 *
 * EL FALLO. Tras un deploy, los chunks con hash antiguo dejan de existir; una
 * pestaña abierta de antes pide "DireccionDashboard-<hash-viejo>.js" al
 * navegar y el import dinámico revienta ("Failed to fetch dynamically
 * imported module"). Peor aún: el rewrite SPA de Vercel respondía a esa ruta
 * con el index.html (200 text/html), no con un 404.
 *
 * DOS REDES, UNA SOLA GUARDA:
 *  1. main.tsx escucha "vite:preloadError" (Vite ≥5) — pero ese evento NO se
 *   emite cuando el chunk no tiene dependencias propias (el helper de Vite
 *   devuelve el import() a pelo si deps está vacío), así que no basta.
 *  2. envolverCargadoresConRecarga() envuelve los pageLoaders: si el import de
 *   una página falla, se recarga UNA vez (la recarga trae el index nuevo).
 *
 * La guarda anti-bucle es compartida: como mucho una recarga cada 10 s por
 * pestaña. Si tras recargar sigue fallando (un error de verdad, no un deploy),
 * el error se propaga al ErrorBoundary como siempre.
 */

const RELOAD_KEY = "lasarte-chunk-reload-at";
const VENTANA_MS = 10_000;

/**
 * true si acaba de pedir la recarga; false si ya se recargó hace poco (deja
 * que el error se propague). sessionStorage puede no estar (modo privado
 * estricto): en ese caso se recarga igualmente — mejor un bucle improbable
 * que una pantalla rota segura.
 */
export function recargarUnaVezTrasDeploy(): boolean {
  let puedo = true;
  try {
    const ultima = Number(sessionStorage.getItem(RELOAD_KEY) ?? 0);
    puedo = Date.now() - ultima > VENTANA_MS;
    if (puedo) sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch {
    // sin sessionStorage no hay memoria de recargas: se intenta una igualmente
  }
  if (puedo) window.location.reload();
  return puedo;
}

type Cargador<T> = () => Promise<T>;

/** Envuelve un cargador de página: si su import falla, recarga una vez. */
export function conRecargaTrasDeploy<T>(cargador: Cargador<T>): Cargador<T> {
  return async () => {
    try {
      return await cargador();
    } catch (err) {
      if (recargarUnaVezTrasDeploy()) {
        // La página se está recargando: una promesa que no resuelve deja a
        // Suspense en su fallback en vez de pintar un error medio segundo.
        return new Promise<T>(() => {});
      }
      throw err;
    }
  };
}

/** Envuelve todos los cargadores de un mapa (los pageLoaders) de una vez. */
export function envolverCargadoresConRecarga<M extends Record<string, Cargador<unknown>>>(mapa: M): M {
  const salida: Record<string, Cargador<unknown>> = {};
  for (const clave of Object.keys(mapa)) {
    salida[clave] = conRecargaTrasDeploy(mapa[clave]);
  }
  return salida as M;
}

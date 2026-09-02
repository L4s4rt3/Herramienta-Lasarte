// Se ejecuta antes de cada fichero de test. Los tests de lógica pura (src/lib,
// _shared) corren en entorno node, sin DOM; los de componentes y hooks, en
// jsdom. jest-dom solo añade matchers a `expect` (no toca el DOM al importarse),
// así que se carga siempre; el matchMedia que jsdom no trae, solo si hay window.
import "@testing-library/jest-dom";

if (typeof window !== "undefined") {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => {},
    }),
  });
}

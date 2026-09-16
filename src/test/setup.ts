// Se ejecuta antes de cada fichero de test. Los tests de lógica pura (src/lib,
// _shared) corren en entorno node, sin DOM; los de componentes y hooks, en
// jsdom. jest-dom solo añade matchers a `expect` (no toca el DOM al importarse),
// así que se carga siempre; el matchMedia que jsdom no trae, y el scrollTo que
// trae pero no implementa, solo si hay window.
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

  // jsdom SÍ declara window.scrollTo, pero al llamarlo escupe un "Not
  // implemented: window.scrollTo" por su consola virtual — no lanza, así que
  // ni un typeof ni un try/catch en la página lo callan. La ficha de Calidad
  // sube al principio al abrir un lote (CalidadJornada.tsx), y eso ensuciaba
  // el log de cada run de la CI con errores que no lo eran.
  Object.defineProperty(window, "scrollTo", { writable: true, value: () => {} });

  // jsdom no trae ResizeObserver y el ResponsiveContainer de recharts lo llama
  // nada más montarse: sin esto, cualquier test de una página CON GRÁFICA
  // revienta entera aunque lo que se esté comprobando sea la tabla de al lado.
  // El doble no mide nada (en jsdom no hay layout), solo evita el estallido: la
  // gráfica se monta con tamaño 0 y los tests miran el texto, no los píxeles.
  if (!("ResizeObserver" in window)) {
    Object.defineProperty(window, "ResizeObserver", {
      writable: true,
      value: class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    });
  }
}

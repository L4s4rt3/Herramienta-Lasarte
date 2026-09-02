import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// Dos proyectos porque levantar jsdom cuesta ~10 s por fichero y la suite entera
// (120 ficheros) tardaba más de 10 minutos en el portátil, así que nadie la
// corría. La lógica pura (src/lib, que es casi toda) va en `node`; los
// componentes y hooks, en `jsdom`. Un test de src/lib que necesite DOM
// (localStorage, FileReader…) lo pide él mismo con `// @vitest-environment jsdom`
// en su primera línea.
const comun = {
  globals: true,
  setupFiles: ["./src/test/setup.ts"],
};

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  test: {
    ...comun,
    projects: [
      {
        extends: true,
        test: {
          ...comun,
          name: "logica",
          environment: "node",
          include: ["src/lib/**/*.{test,spec}.{ts,tsx}"],
        },
      },
      {
        extends: true,
        test: {
          ...comun,
          name: "ui",
          environment: "jsdom",
          include: ["src/**/*.{test,spec}.{ts,tsx}"],
          exclude: ["src/lib/**", "**/node_modules/**"],
        },
      },
    ],
  },
});

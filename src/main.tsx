import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

// Tras un deploy, los chunks con hash antiguo dejan de existir y la carga
// perezosa de una página falla ("Failed to fetch dynamically imported module").
// Vite emite "vite:preloadError" en ese caso: recargamos una vez para traer
// el index.html nuevo. OJO: el evento no cubre los chunks sin dependencias
// propias — esos los cubre la envoltura de pageLoaders en App.tsx. La guarda
// anti-bucle es compartida (recargaTrasDeploy.ts).
import { recargarUnaVezTrasDeploy } from "./lib/recargaTrasDeploy";

window.addEventListener("vite:preloadError", (event) => {
  if (recargarUnaVezTrasDeploy()) event.preventDefault();
});

createRoot(document.getElementById("root")!).render(<App />);

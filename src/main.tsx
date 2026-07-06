import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

// Tras un deploy, los chunks con hash antiguo dejan de existir y la carga
// perezosa de una página falla ("Failed to fetch dynamically imported module").
// Vite emite "vite:preloadError" en ese caso: recargamos una vez para traer
// el index.html nuevo (con guarda anti-bucle por si el fallo persiste).
window.addEventListener("vite:preloadError", (event) => {
  const key = "lasarte-chunk-reload-at";
  const last = Number(sessionStorage.getItem(key) ?? 0);
  if (Date.now() - last > 10_000) {
    sessionStorage.setItem(key, String(Date.now()));
    event.preventDefault();
    window.location.reload();
  }
});

createRoot(document.getElementById("root")!).render(<App />);

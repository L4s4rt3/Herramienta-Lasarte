import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { VitePWA } from "vite-plugin-pwa";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [
    react(),
    mode === "development" && componentTagger(),
    // PWA: la herramienta se instala como app en el iPhone/tablet (pantalla de
    // inicio, standalone) y el cascarón queda cacheado para abrir sin red.
    // Los datos offline del módulo de calidad van aparte (calidadImportOffline).
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: "auto",
      includeAssets: ["favicon.ico", "favicon.png", "logo.jpg", "apple-touch-icon.png", "branding/*.jpg", "branding/*.png", "branding/*.jpeg"],
      manifest: {
        name: "Herramienta Lasarte",
        short_name: "Lasarte",
        description: "Herramienta de producción de Lasarte Cítricos S.L.",
        lang: "es",
        display: "standalone",
        start_url: "/",
        scope: "/",
        theme_color: "#ffffff",
        background_color: "#ffffff",
        icons: [
          { src: "/branding/pwa-192.png", sizes: "192x192", type: "image/png" },
          { src: "/branding/pwa-512.png", sizes: "512x512", type: "image/png" },
          { src: "/branding/pwa-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // SPA: cualquier navegación cae al index (menos las rutas de Supabase).
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/rest\//, /^\/storage\//, /^\/auth\//],
        globPatterns: ["**/*.{js,css,html,ico,png,jpg,jpeg,svg,woff2}"],
        // Las llamadas a Supabase NUNCA se cachean (datos vivos + auth).
        runtimeCaching: [],
      },
    }),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime", "@tanstack/react-query", "@tanstack/query-core"],
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          "vendor-react": ["react", "react-dom", "react-router-dom"],
          "vendor-supabase": ["@supabase/supabase-js"],
          "vendor-recharts": ["recharts"],
          "vendor-xlsx": ["xlsx"],
          "vendor-pdf": ["jspdf", "jspdf-autotable"],
        },
      },
    },
  },
}));

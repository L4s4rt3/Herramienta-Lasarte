# Herramienta Lasarte — Documentación técnica

> ERP interno de Lasarte Cítricos S.L. para la gestión de una planta de clasificación y confección citrícola: producción, calidad, consumos, comercial, RRHH, logística (CMR) y análisis económico.

## 1. Stack tecnológico

| Capa | Tecnología |
|---|---|
| Frontend | React 18 + TypeScript, Vite 5 (SWC), React Router DOM 7 |
| UI | shadcn/ui sobre Radix UI, Tailwind CSS 3, lucide-react, sonner, next-themes (claro/oscuro) |
| Estado y datos | TanStack React Query, react-hook-form + zod |
| Backend | Supabase: Postgres + Auth + Storage + Edge Functions (Deno) |
| Documentos | exceljs / xlsx (Excel), jspdf + jspdf-autotable / pdf-lib (PDF), pdfjs-dist (lectura), react-dropzone |
| Gráficas | Recharts |
| IA | Edge Function `chat` con cascada multi-proveedor (OpenRouter, NVIDIA, Gemini, Groq, DeepSeek, Puter) + RAG con embeddings |
| Testing | Vitest + Testing Library + jsdom |
| Deploy | Vercel (frontend) + Supabase (backend) |

Tamaño aproximado: **~314 archivos fuente TS/TSX, ~80.000 líneas de código** en `src/`, más 8 Edge Functions y migraciones SQL.

## 2. Estructura del repositorio

```
src/
├── pages/            # 34 páginas/rutas (una por vista), lazy-loaded desde App.tsx
├── components/       # Componentes de dominio (+ calidad/, consumos/, mercadona/,
│                     #   excel-preview/, tour/) y ui/ (shadcn)
├── hooks/            # ~35 hooks de datos, uno por módulo (usePartes, useMercadona*, useRrhh*…)
├── lib/              # Lógica de negocio pura y testeable (~90 archivos):
│                     #   parsers, cálculos, exportadores, i18n, RAG
├── contexts/         # AuthProvider (sesión + rol), ThemeProvider
└── integrations/
    └── supabase/     # client.ts y types.ts (tipos generados de la BD)

supabase/
├── functions/        # 8 Edge Functions (Deno)
├── migrations/       # Esquema SQL versionado (incluye políticas RLS)
└── config.toml
```

Arranque: `index.html` → `src/main.tsx` → `src/App.tsx` (rutas) → `src/components/AppLayout.tsx` (layout y navegación). Guardas de ruta en `ProtectedRoute.tsx` y `RoleRoute.tsx`.

Principio de diseño clave: **la lógica de negocio vive en `src/lib/` como funciones puras con tests unitarios**; las páginas y hooks solo orquestan datos y UI.

## 3. Módulos funcionales

| Módulo | Ruta | Qué hace |
|---|---|---|
| Mapa de la herramienta | `/mapa` | Página de orientación con acceso a todas las secciones |
| Producción (Dashboard) | `/produccion` | KPIs semanales: producción real, kg dados de alta, diferencia sin justificar con semáforo, velocidad T/h, evolución de 6 semanas |
| Calidad | `/calidad` | Control de calidad por jornada; importador de informes diarios (.doc/.docx) |
| Partes de trabajo | `/partes`, `/partes/:id` | Partes con lotes, zonas, destinos, calidad y adjuntos |
| Consumos y costes | `/costes/consumos` | Consumos físicos de materiales (contadores de agua con desglose por subcontadores) y coste de mallas/envases |
| Asistencia | `/costes/asistencia`, `/comparativa` | Control de asistencia y rendimiento del personal |
| Productores | `/productores` | Análisis por productor: calibres, calidad, aprovechamiento |
| Análisis diario | `/analisis/diario` | Análisis de producción diaria |
| Ventas por categoría | `/ventas/categoria-*` | Ventas de primera y segunda categoría por cliente/artículo, con importador mensual |
| Comercial | `/comercial` | Dashboard comercial (rol ventas) |
| Mercadona | `/mercadona`, `/comercial/mercadona` | Aprovechamiento, lotes, expediciones, previsiones, ventas y precios del cliente principal |
| Edeka | — | Cliente de exportación alemán |
| CMR / Hojas de ruta | `/cmr` | Documentos de transporte con generación de PDF (`lib/cmrPdf.ts`) |
| RRHH | `/rrhh/*` | Personas, ausencias, amonestaciones, vacaciones, nóminas, comunicaciones (acceso restringido) |
| Económico | `/economico/*` | Facturación, costes, precios y márgenes (solo admin) |
| Dirección | `/direccion` | Panel ejecutivo (home del rol admin) |
| Visor Excel | `/ver-excel/:fileId` | Visor de archivos Excel subidos |

## 4. Sistemas transversales

### Autenticación y roles
`AuthProvider.tsx` gestiona sesión Supabase y rol. Cuatro roles con home y lista de rutas propias, aplicados en `RoleRoute.tsx`:
- **admin** → `/direccion`, acceso total (incluido Económico)
- **ventas** → `/comercial`, lista blanca de secciones comerciales
- **rrhh** → `/rrhh`, su espacio + mapa
- **operario** → `/produccion`, lo básico

Las guardas de cliente están respaldadas por **Row Level Security en Postgres** (ver migraciones).

### Motor de exportación
Familia de exportadores en `src/lib/` con tema de marca unificado (`exportKit.ts`, `exportTheme.ts`, `reportKit.ts`): Excel (`exportPartes.ts`, `exportConsumo.ts`, `exportEficiencia.ts`, `exportWorkbook.ts`) y PDF (`cmrPdf.ts`, `nominasPdf.ts`). Los documentos exportados usan la razón social oficial, nunca el nombre interno de la herramienta.

### Importadores de datos
Parsers de Excel/Word/PDF en `src/lib/` (`parsers.ts`, `asistenciaImport.ts`, `facturasConsumoImport.ts`, `ventasMensualImport.ts`, `ventasCategoriaExcel.ts`) con previsualización (`ExcelPreviewer.tsx`) y Edge Functions de parseo asistido por IA (`parse-excel`, `analizar-lote-excel`, `importar-asistencia`).

### Asistente IA "Vadim"
Chat integrado (`ChatBot.tsx`, `useChatBot.ts`) con RAG (`lib/rag.ts` + función `embeddings`), memoria de conversación persistente y cascada de proveedores con fallback automático en `supabase/functions/chat/index.ts`.

### Otros
- **i18n** (`src/lib/i18n.tsx`)
- **Command palette** con búsqueda global (`CommandPalette.tsx`, `useGlobalSearch.ts`)
- **Tour de onboarding** (`components/tour/`)
- **Rendimiento**: lazy-loading de rutas con precarga (`routePreload.ts`) y warmup de datos (`useDataWarmup.ts`)
- **Semáforos de KPIs** (`lib/semaforo.ts`)

## 5. Flujo de datos típico

```
Página (src/pages/X.tsx)
  → hook de datos (src/hooks/useX.ts, React Query)
    → cliente Supabase (src/integrations/supabase/client.ts)
      → Postgres (con RLS) / Storage / Edge Function
  → cálculos puros (src/lib/*.ts, con tests)
  → componentes de dominio (src/components/)
```

## 6. Desarrollo

```bash
npm install       # dependencias
npm run dev       # servidor de desarrollo (Vite)
npm run build     # build de producción
npx tsc --noEmit  # typecheck (se mantiene en verde)
npx vitest run    # tests unitarios
```

Variables de entorno: copiar `.env.example` a `.env` y rellenar `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`. **El `.env` real nunca se versiona.**

Precauciones conocidas:
- No ejecutar `deno check` en el repo: crea `node_modules/.deno` y rompe el build de Vite (limpiar y `npm install` si ocurre).
- El typecheck se mantiene en verde; el lint tiene ~95 `any` crónicos aceptados.

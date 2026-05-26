# Plan: Optimizar, limpiar y mejorar UI — Herramienta Lasarte

## Goal
Optimizar el código, eliminar errores/basura, mejorar la interfaz visual sin romper funcionalidad existente.

## Stack
React 18 + TypeScript + Vite 5 + shadcn/ui + Tailwind CSS + Supabase + Recharts

## Current state
- Build compila sin errores
- Warning: chunk > 500kB (2.2MB main)
- Warning: browserslist 11 months old
- App.css tiene boilerplate de Vite sin usar
- Varios `as any` casts que deberían ser tipados
- Console.logs de debug en producción
- Funciones de formato duplicadas
- index.html tiene TODOs y metadatos desactualizados

---

## FASE 1 — Limpieza de código (no toca lógica ni UI)

### 1.1 Eliminar App.css (boilerplate Vite sin usar)
- Eliminar archivo `src/App.css`
- Eliminar import en `src/App.tsx` (no existe, verificar)

### 1.2 index.html — limpiar metadatos y TODOs
- Quitar comentarios TODO
- Cambiar og:image y twitter:image a logo propio o quitarlos
- Quitar referencias a Lovable

### 1.3 Eliminar console.logs de debug (PartDetail.tsx)
- Líneas 105-116: console.log de datos
- Línea 94: console.error
- Línea 99: console.error
- Línea 123: console.error

### 1.4 Eliminar `as any` innecesarios y tipar correctamente
- `Dashboard.tsx` línea 70: `supabase as any` → tipar con tipo correcto
- `PartDetail.tsx` línea 156: `payload: any` → tipar con Partial<Parte>
- `PartDetail.tsx` línea 397: `as any` en update
- Revisar otros `as any` en el código

### 1.5 Estandarizar funciones duplicadas
- `AnalisisDiario.tsx` tiene funciones `formatKg`, `formatFecha`, `formatFechaLarga`, `daysAgo`, `todayStr` que duplican `src/lib/format.ts` — importar desde allí
- Eliminar funciones duplicadas

### 1.6 Limpiar imports no usados
- Revisar imports en todos los componentes
- Especialmente: PartesList.tsx (Factory usado en línea 234 pero no importado), Dashboard.tsx

---

## FASE 2 — Optimización de bundle y rendimiento

### 2.1 Code-splitting dinámico para páginas pesadas
- Dashboard.tsx, AnalisisDiario.tsx y páginas con recharts ya tienen lazy loading parcial
- Implementar React.lazy para todas las rutas en App.tsx
- Estimar reducción: el chunk principal pasaría de ~2.2MB a ~500-800kB

### 2.2 Recharts — lazy loading completo
- Algunas páginas ya tienen lazy de recharts vía `Suspense` + `lazy`
- Unificar patrón: todas las páginas que usan recharts deberían usar lazy loading igual

### 2.3 Browserslist — actualizar
- Ejecutar `npx update-browserslist-db@latest`

### 2.4 Configurar manualChunks en vite.config.ts
- Separar vendors (react, recharts, supabase) en chunks propios

---

## FASE 3 — Mejoras de UI

### 3.1 Tema oscuro/claro (ya hay CSS variables dark)
- El index.css ya tiene variables `:root` y `.dark`
- Falta un toggle en la UI para cambiar entre modos
- Añadir botón de tema en el sidebar footer (junto al selector de idioma)

### 3.2 Animaciones suaves entre rutas
- Añadir transiciones con Tailwind (transition-all) en el contenedor de páginas
- Mejorar micro-interacciones: hover states, focus rings, loading spinners

### 3.3 Estado vacío mejorado en todas las páginas
- Revisar y unificar los estados vacíos (ya hay buenos ejemplos en PartesList y AnalisisDiario)
- Añadir iconos descriptivos + call-to-action en todas las páginas que lo necesiten

### 3.4 Loading states con Skeleton unificados
- Ya se usa Skeleton en varios sitios
- Estandarizar: crear un componente `PageSkeleton` o similar reutilizable

### 3.5 Sidebar responsive mejorada
- Ya usa `Sidebar` de shadcn con `collapsible="icon"`
- Mejorar comportamiento mobile: drawer en móvil, sidebar normal en desktop

### 3.6 Toasts y notificaciones
- Unificar uso de toast (mezcla de sonner y toaster de shadcn)
- Elegir uno solo (sonner es más moderno)

---

## FASE 4 — Corrección de bugs y TypeScript

### 4.1 Arreglar Factory import en PartesList.tsx
- Línea 234 usa `Factory` pero no está en los imports de lucide-react

### 4.2 Tipar correctamente las queries de Supabase
- Dashboard.tsx línea 70: usar tipo correcto en lugar de `as any`
- usePartes.ts: asegurar tipos correctos en buildCascade

### 4.3 Strict mode de TypeScript
- tsconfig.app.json: verificar que strict mode está activo
- tsconfig.json: verificar noUnusedLocals, noUnusedParameters

### 4.4 Error boundary global
- Añadir ErrorBoundary en App.tsx para evitar pantallazos blancos

---

## FASE 5 — Refactorización de componentes grandes

### 5.1 PartDetail.tsx (446 líneas) — extraer subcomponentes
- Extraer FileUploadSection, ManualDataSection, NotesSection
- Extraer lógica de análisis IA a hook separado

### 5.2 Dashboard.tsx (373 líneas) — extraer subcomponentes
- ChartTooltip ya es externo
- Extraer SemaforoSection, KPIsSection, RecentPartesSection

### 5.3 AppLayout.tsx (295 líneas) — extraer navegación
- Extraer array de rutas de navegación a constante externa
- Extraer TopBar a su propio archivo

---

## Validation
1. `npm run build` debe compilar sin errores
2. `npm run lint` sin errores nuevos
3. Revisar visualmente: Dashboard, PartesList, PartDetail
4. No debe romperse ninguna funcionalidad existente

## Files likely to change
- src/App.css (eliminar)
- src/index.html
- src/App.tsx
- src/pages/*.tsx
- src/components/*.tsx
- src/index.css
- src/lib/format.ts
- vite.config.ts
- tsconfig*.json

## Risks
- Code-splitting puede causar flash de carga en páginas grandes
- Refactor de componentes grandes puede introducir bugs si no se prueba bien
- Cambios de imports pueden romper la build

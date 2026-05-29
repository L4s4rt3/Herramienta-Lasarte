# Lasarte SAT v2 — Especificación de diseño

## 1. Arquitectura de navegación

### Estructura de páginas

```
Dashboard (estratégico)          ← Landing page con visión global
├─ Panel de producción           ← KPIs en tiempo real, semáforos, tendencias
├─ Alertas activas               ← descuadres DSJ, productores pendientes
└─ Acceso rápido                 ← últimos partes, acciones frecuentes

Operaciones diarias
├─ Partes                        ← flujo optimizado, creación/edición rápida
├─ Calculadora DJPMN             ← simulación rápida desde el parte
└─ [Nuevo] Creación rápida       ← Cmd+K desde cualquier pantalla

Producción
├─ Análisis diario               ← lotes, calibres, grupos de producción
├─ Productores                   ← trazabilidad con historial visual
└─ Calendario                    ← vista mensual con semáforo de estado

Operaciones
├─ Consumos                      ← agua, energía, gasoil
└─ Asistencia                    ← trabajadores

Buscar / Cmd+K                   ← búsqueda global, accesible siempre
```

### Cambios clave
- Dashboard estratégico con KPIs, alertas, acceso rápido
- 3 grupos en la barra lateral
- Barra de comandos global (Cmd+K)
- Enlaces contextuales entre entidades

---

## 2. Sistema de diseño visual

### Paleta de color
- **Fondo base**: `oklch(98% 0.003 100)` — blanco casi puro
- **Superficies**: `oklch(96% 0.005 100)` — gris muy suave
- **Acento principal (naranja SAT)**: `oklch(65% 0.18 40)` — vibrante pero profesional
- **Acento secundario (verde campo)**: `oklch(55% 0.15 150)` — natural, fresco
- **Texto primario**: `oklch(20% 0.02 100)`
- **Texto secundario**: `oklch(45% 0.015 100)`
- **Bordes**: `oklch(88% 0.01 100)`

### Glassmorphism refinado
```css
--glass-bg: oklch(100% 0 0 / 0.6);
--glass-border: oklch(100% 0 0 / 0.2);
--glass-shadow: 0 4px 24px oklch(0% 0 0 / 0.06);
--glass-blur: 12px;
```

### Tipografía
- **Títulos página**: `text-2xl font-semibold tracking-tight`
- **Títulos tarjeta**: `text-base font-medium`
- **Cuerpo**: `text-sm leading-relaxed`
- **Monospace (números)**: `tabular-nums` en KPIs y tablas

### Animaciones
- Transiciones de página suaves (fade + slide 200ms)
- Hover sutil en tarjetas (translateY -1px + shadow)
- Micro-interacciones en botones (scale 0.97 on click)
- Skeleton loading con shimmer gradient

---

## 3. Componentes

### Barra de comandos (Cmd+K)
- Input de búsqueda global con atajos de teclado
- Resultados: páginas, partes recientes, productores, lotes
- Acciones rápidas: crear parte, ir a hoy, etc.

### Dashboard estratégico
- Grid de KPIs con tendencias (↑ ↓ →)
- Gráfico de producción semanal (área)
- Lista de alertas activas con indicadores
- Últimas acciones realizadas

### Cards refactorizadas
- Glass con hover elevación
- Header siempre con icono + título
- Contenido con padding consistente

### Tablas
- Cabecera sticky con glass
- Filas con hover suave
- Soporte para ordenación en cliente

---

## 4. Nuevas funcionalidades

### Fase 1 (inmediata)
- [ ] Barra de comandos global (Cmd+K)
- [ ] Dashboard estratégico con KPIs + tendencias
- [ ] Regrupación de navegación lateral
- [ ] Transiciones y animaciones suaves
- [ ] Enlaces contextuales entre páginas

### Fase 2 (corto plazo)
- [ ] Búsqueda global con resultados de todas las entidades
- [ ] Notificaciones de descuadres DSJ
- [ ] Vista de calendario mejorada con drag & drop
- [ ] Exportación a Excel/PDF mejorada

### Fase 3 (medio plazo)
- [ ] Alertas proactivas (productores con entregas lentas, consumos anómalos)
- [ ] Panel de tendencias semanales/mensuales
- [ ] Histórico visual por productor
- [ ] Modo comparativa entre días/semanas

---

## 5. Plan de implementación

### Fase 1 — Fundación visible (esta sesión)
1. Escribir especificación ✅
2. Barra de comandos (Cmd+K) — componente nuevo
3. Dashboard estratégico — rediseño de página
4. Navegación lateral — regrupar y mejorar iconos
5. Animaciones globales — framer-motion o transiciones CSS
6. Pulir glassmorphism existente

### Fase 2 — Mejora de flujos
7. Búsqueda global conectada a datos reales
8. Enlaces contextuales en partes, productores, lotes
9. Vista de análisis diario mejorada

### Fase 3 — Funcionalidades avanzadas
10. Panel de tendencias con gráficos
11. Alertas proactivas
12. Exportación avanzada

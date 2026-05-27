# Design System — Lasarte SAT

> **Regla de sesión:** Leer este archivo antes de tocar cualquier CSS, clase Tailwind o componente visual.
> No inventar valores nuevos. Solo usar los tokens aquí documentados.

---

## Línea visual: Glassmorphism

El sistema usa un glassmorphism cálido basado en tonos crema/ámbar con superficies
semi-transparentes y blur. El componente de referencia es el Dashboard principal
(`src/pages/Dashboard.tsx`) y las cards del KPICard.

---

## Tokens CSS — `src/index.css` (`:root`)

### Superficies glass
| Token | Valor | Uso |
|---|---|---|
| `--color-bg` | `hsl(var(--background))` — crema cálida `hsl(38 42% 93%)` | Fondo de página |
| `--color-surface` | `var(--glass-bg)` — `hsl(38 50% 99% / 0.35)` | Superficie de cards/panels |
| `--color-surface-hover` | `var(--glass-bg-strong)` — `hsl(38 50% 99% / 0.55)` | Estado hover en celdas de tabla, rows |
| `--color-border` | `var(--glass-border)` — `hsl(38 30% 75% / 0.35)` | Borde estándar glass |
| `--glass-border-accent` | `hsl(24 95% 53% / 0.22)` | Borde con tono naranja (tarjetas activas) |

### Tipografía
| Token | Valor | Uso |
|---|---|---|
| `--color-text` | `hsl(var(--foreground))` — `hsl(150 18% 14%)` | Texto principal |
| `--color-text-muted` | `hsl(var(--muted-foreground))` — `hsl(150 10% 40%)` | Texto secundario, kickers, hints |

### Acento y estado
| Token | Valor | Uso |
|---|---|---|
| `--color-accent` | `hsl(var(--primary))` — naranja `hsl(24 95% 53%)` | CTA, botones, highlights |
| `--success` | `hsl(142 55% 42%)` | Estado OK, verde semáforo |
| `--warning` | `hsl(38 92% 50%)` | Estado revisar, ámbar semáforo |
| `--destructive` | `hsl(0 75% 50%)` | Estado crítico/error, rojo semáforo |
| `--info` | `hsl(199 89% 48%)` | Estado informativo, azul datos agua |

### Efectos
| Token | Valor | Uso |
|---|---|---|
| `--blur` | `blur(24px)` (`backdrop-blur-xl`) | Blur de superficies glass |
| `--radius` | `0.625rem` | Radio de bordes (lg=radius, md=radius-2px) |
| `--shadow` / `--glass-shadow` | `0 4px 16px hsl(150 18% 14% / 0.05), ...` | Sombra estándar |
| `--glass-shadow-lg` | `0 8px 30px hsl(150 18% 14% / 0.07), ...` | Sombra elevada |
| `--glass-glow` | `0 0 24px hsl(24 95% 53% / 0.12)` | Glow naranja en hover |

---

## Clases CSS globales — `src/index.css` (`@layer components`)

| Clase | Uso |
|---|---|
| `.glass` | Superficie glass base: border + bg + shadow + backdrop-blur-xl |
| `.glass-strong` | Glass con bg más opaco (modales dentro de modales) |
| `.glass-accented` | Glass con border naranja accent (cards de datos principales) |
| `.glass-hover` | Añade glow en hover sobre .glass |
| `.glass-lift` | Glass + translateY(-2px) en hover |
| `.page-shell` | Wrapper de página: max-w-[1500px] space-y-6 |
| `.page-header` | Header de página: glass-accented p-5 rounded-xl |
| `.page-title` | Título de página: 2xl/3xl font-semibold |
| `.page-subtitle` | Subtítulo: text-sm text-muted-foreground |
| `.section-toolbar` | Barra de filtros: glass-accented p-3 rounded-xl |
| `.data-table` | Tabla de datos: headers con glass-border, rows con glass-bg-strong hover |
| `.panel-kicker` | Label tipo chip: text-[11px] uppercase tracking-wider text-muted-foreground |

---

## Tailwind — colores semánticos disponibles

Todos están configurados en `tailwind.config.ts` y admiten opacidad (`/10`, `/30`, `/40`...):

```
bg-success / text-success / border-success
bg-warning / text-warning / border-warning
bg-destructive / text-destructive / border-destructive
bg-info / text-info / border-info
bg-primary / text-primary / border-primary
bg-muted / text-muted-foreground
```

### Patrón para badges/chips de estado
```tsx
// ✅ Correcto
"border border-success/40 bg-success/10 text-success"
"border border-warning/40 bg-warning/10 text-warning"
"border border-destructive/40 bg-destructive/10 text-destructive"
"border border-info/40 bg-info/10 text-info"
"border border-[var(--glass-border)] bg-[var(--glass-bg)] text-muted-foreground"  // neutro

// ❌ Incorrecto — NO usar
"bg-emerald-50 border-emerald-200 text-emerald-700"
"bg-red-50 border-red-200 text-red-700"
"bg-blue-50 border-blue-200 text-blue-700"
"bg-slate-50 border-slate-200 text-slate-700"
```

### Patrón para dots / indicadores de color
```tsx
// ✅ Correcto
<span className="h-2 w-2 rounded-full bg-success" />    // verde OK
<span className="h-2 w-2 rounded-full bg-warning" />    // ámbar revisar
<span className="h-2 w-2 rounded-full bg-destructive" /> // rojo crítico
<span className="h-2 w-2 rounded-full bg-info" />        // azul informativo

// ❌ Incorrecto
<span className="bg-emerald-500" />
<span className="bg-red-500" />
<span className="bg-blue-500" />
```

---

## Componentes UI — estado actual

| Componente | Clase base | Estado |
|---|---|---|
| `Card` | `.glass` | ✅ |
| `Input` | `--glass-border`, `--glass-bg`, `--glass-shadow` | ✅ |
| `Button (default)` | `bg-primary shadow-[--shadow-elegant]` | ✅ |
| `Button (outline)` | `--glass-border`, `--glass-bg` | ✅ |
| `TabsList` | `--glass-border`, `--glass-bg` | ✅ |
| `SelectTrigger` | `--glass-border`, `--glass-bg` | ✅ |
| `SelectContent` | `.glass-strong` | ✅ |
| `PopoverContent` | `.glass` | ✅ |
| `Dialog` | `.glass-accented`, overlay `bg-black/10 backdrop-blur-sm` | ✅ |
| `AlertDialog` | `.glass-accented`, overlay `bg-black/10 backdrop-blur-sm` | ✅ |
| `Sheet` | `.glass`, overlay `bg-black/10 backdrop-blur-sm` | ✅ |
| `Toast` | `.glass-accented rounded-xl` | ✅ |
| `Alert (default)` | `--glass-bg backdrop-blur-xl` | ✅ |
| `Table (rows)` | `--glass-border`, `--glass-bg-strong` hover | ✅ |
| `StatusBadge` | tokens semánticos | ✅ |
| `SemaforoCard` | `bg-success/10`, `bg-warning/10`, `bg-destructive/10` | ✅ |

---

## Gráficas (recharts) — `src/lib/chartTheme.tsx`

| Elemento | Regla |
|---|---|
| Fills de barras | `barFill(color, 0.22-0.55)` + `stroke={color}` strokeWidth 1.5 |
| Fills de pie/donut | `barFill(color, 0.35)` + `stroke={color}` strokeWidth 2 |
| Líneas | `stroke="hsl(var(--primary))"` o color semántico |
| Dots en líneas | `fill=color, stroke="white", strokeWidth=1.5` |
| Tooltip | `GlassTooltip` o custom con `bg-card/95 backdrop-blur-xl border-[var(--glass-border-accent)]` |
| CartesianGrid | `vertical={false}`, `stroke="hsl(var(--border))"`, `strokeDasharray="3 3"` |
| Ejes | `fontSize={10}`, `tick={{ fill: "hsl(var(--muted-foreground))" }}` |
| Cards contenedoras | `glass-accented` |
| Leyenda | `legendStyle` (fontSize 11) |

### Paleta de gráficas — `CHART_COLORS` en `src/lib/chartTheme.tsx`
| Destino | Color |
|---|---|
| Exportación | `#10b981` (emerald) |
| Mercado | `#3b82f6` (blue) |
| Industria / No comercial | `#f59e0b` (amber) |
| No exportación | `#f97316` (orange) |
| Mujeres | `#8b5cf6` (violet) |
| T/h ≥16 | `#10b981` |
| T/h ≥12 | `#f59e0b` |
| T/h <12 | `#ef4444` |

---

## Reglas que NO romper

1. **Nunca** usar `bg-white` o `bg-background` en superficies visibles — usar `--glass-bg`
2. **Nunca** usar overlays `bg-black/80` — usar `bg-black/10 backdrop-blur-sm`
3. **Nunca** hardcodear colores Tailwind (`emerald-50`, `red-200`, `blue-50`) — usar tokens semánticos
4. **Nunca** `shadow-lg` suelto — usar `--glass-shadow` o `--glass-shadow-lg`
5. **Siempre** `rounded-xl` en panels/modales principales (no `rounded-lg` o `rounded-md`)
6. **Siempre** leer este archivo antes de crear o modificar estilos

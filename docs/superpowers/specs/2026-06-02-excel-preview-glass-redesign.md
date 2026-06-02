# Excel Preview — Glass UI Operativo

**Fecha**: 2026-06-02
**Estado**: Aprobado, en implementación
**Scope**: `src/components/ExcelPreviewer.tsx` y nueva carpeta `src/components/excel-preview/`

## Contexto

El `ExcelPreviewer` actual usa un estilo "Dribbble glass" (backdrop-blur-xl sobre thead, bordes blancos/30 casi invisibles, columna `#` como ruido, sin formato de números, sin interacción). El brief del usuario pide:

- Glass **operativo** (no decorativo): tablas sólidas, alto contraste, blur contenido, jerarquía por opacidad.
- Mantener el modelo mental de "preview de archivo" — la data viene del Excel importado, sin Supabase, sin DB.
- Componentes **reutilizables** desde ya, porque la futura ruta `/informes` con módulos Producción/Producto/Tamaños/Palets los va a necesitar.

## Decisiones de diseño

### Layout (de arriba a abajo, en `ExcelPreviewer`)

```
┌──────────────────────────────────────────────────────────────┐
│ PreviewHeader (filename, sheet tabs, título, subtítulo)      │
├──────────────────────────────────────────────────────────────┤
│ MetricsStrip (3-5 KPIs del parser, solo si hay métricas)    │
├──────────────────────────────────────────────────────────────┤
│ DataTable (sticky header sólido, scroll X+Y, badges, sort)  │
│   click fila → RowDetailDrawer                              │
└──────────────────────────────────────────────────────────────┘
```

### Glass operativo (tokens)

| Elemento | Antes (Dribbble) | Después (operativo) |
|---|---|---|
| Card raíz | `glass-bg/0.38` + `backdrop-blur-xl` | `bg-white/70` + `border-slate-200/60` + `backdrop-blur-sm` |
| Sticky thead | `glass-bg-strong/95` + `backdrop-blur-xl saturate-150` | `bg-slate-50/95` sólido + `shadow-[0_2px_6px_rgba(0,0,0,0.06)]` |
| Hover fila | `bg-glass-bg-strong` | `hover:bg-orange-50/40` |
| Selected fila | — | `bg-orange-50/70` + `border-l-2 border-l-orange-500` |
| Bordes | `glass-border` (HSL 30% / alpha 0.35) | `border-slate-200/60` |
| Altura fila | `py-1.5` (~28px) | `py-2.5` (~44px) |
| Columna `#` | sticky index con `font-mono` | **se elimina** |
| Celdas vacías | invisibles | invisibles (igual) |

### `MetricsStrip` — antes vs después

**Antes**: card "Resumen" con lista vertical `divide-y` (cada métrica en su fila con label/value). Largo si hay 20 métricas.

**Después**: grid horizontal de 3-5 cards KPI compactas. Si hay más de 5 métricas, se muestra las 4 más relevantes (heurística: prioriza métricas con `kg`, `€`, `%`, números) y el resto colapsa en un `<details>`.

```tsx
<div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
  {topMetrics.map(m => <MetricCard metric={m} />)}
</div>
```

`MetricCard`: glass sutil, label uppercase 10px muted, value 2xl mono. Si la métrica tiene keyword de estado (Activo/Cerrado), usa `StatusBadge` en lugar de número.

### `DataTable` — nuevos comportamientos

1. **Sticky thead sólido** con `bg-slate-50/95` y sombra de separación.
2. **Sort por columna**: click en `th` ordena. Indicador con `ArrowUp`/`ArrowDown` de lucide. Click de nuevo invierte. Tercer click quita el sort.
3. **Numeric detection** automático por columna (50% threshold) y por celda individual.
4. **Status badges**: si la columna es "Estado" / "Status" (case-insensitive), cada celda se renderiza como `StatusBadge` con color por keyword. Si no, valor raw.
5. **Hover**: `hover:bg-orange-50/40`, cursor-pointer.
6. **Selected**: `bg-orange-50/70` con borde izquierdo naranja. Click selecciona y abre drawer.
7. **Click en celda**: copia valor al portapapeles, toast confirma.
8. **Format helpers**:
   - Números: trim trailing zeros, separador de miles `.` (estilo ES), max 3 decimales. Negativos en rojo suave.
   - Fechas: `DD/MM/YYYY`. Si es solo hora: `HH:mm`. Si tiene ambos: `DD/MM/YYYY HH:mm`.
   - Strings: trim, sin transformación.
   - Empty: blank (sin `—`).

### `StatusBadge` — mapping de keywords

| Keyword (lowercase) | Variant | Color |
|---|---|---|
| `activo`, `validado`, `completado`, `aprobado`, `ok` | `success` | emerald |
| `cerrado`, `finalizado`, `completado`, `hecho` | `info` | sky |
| `pendiente`, `espera`, `en curso`, `procesando` | `warning` | amber |
| `error`, `rechazado`, `cancelado`, `fallo` | `destructive` | red |
| default | `muted` | slate |

Detección: match parcial de la keyword (substring). Si la celda no matchea ninguna, renderiza valor normal sin badge.

### `RowDetailDrawer`

- Shadcn `Sheet` (slide desde la derecha, ancho 420px).
- Header: "Fila N" + botón cerrar.
- Body: `<dl>` con cada columna como `<div>` con `<dt>` (label, uppercase muted 10px) y `<dd>` (value, mono si es número).
- Footer: botón "Copiar fila" (TSV al portapapeles) + "Cerrar".
- Si la fila tiene badge de estado, lo muestra destacado en la cabecera del drawer.

### `PreviewSkeleton`

Loading state con animación pulse:
- Header card skeleton (h-16, full width).
- Metrics strip: 4 cards de `h-20`.
- Table: header row + 5 filas con anchos variables (random determinístico por seed para evitar reflow).

## Componentes a implementar

```
src/components/excel-preview/
  types.ts              ← Metric, DataTable, ParsedExcel, SheetData, StatusKey
  formatters.ts         ← formatNumber, formatDate, formatCell, isNumericCell, isNumericColumn
  StatusBadge.tsx       ← detecta keyword → variant + label
  PreviewHeader.tsx     ← filename + sheet tabs + título/subtítulo
  MetricsStrip.tsx      ← grid de MetricCard
  MetricCard.tsx        ← card individual
  DataTable.tsx         ← tabla con sticky header, sort, badges, click
  RowDetailDrawer.tsx   ← Sheet con key-value list + copiar
  PreviewSkeleton.tsx   ← loading state
  index.ts              ← barrel export

src/components/ExcelPreviewer.tsx  ← refactor: solo orquestador
src/components/ExcelViewerDialog.tsx ← sin cambios funcionales (re-exporta types si hace falta)
```

## Tests (TDD en formatters)

`src/test/excel-preview/formatters.test.ts`:

- `isNumericCell`: entero, decimal, decimal con coma, negativo, miles, porcentaje, string vacío, texto, fecha.
- `isNumericColumn`: 100% números, 50% números, <50% números, columna vacía.
- `formatNumber`: `1234.5` → `"1.234,5"`, `0` → `"0"`, `-12.345` → `"-12,345"`, `null` → `""`, `1.0000001` → `"1"` (trailing zero trim).
- `formatDate`: `new Date('2026-05-22')` → `"22/05/2026"`, ISO string → `"22/05/2026"`, solo hora → `"14:30"`, datetime → `"22/05/2026 14:30"`, null → `""`.
- `formatCell`: dispatch según tipo (number/date/string/bool/null).

## Lo que NO cambia

- `ExcelViewerDialog.tsx`: 7-attempt parse flow, `repairXlsx`, `reconstructMissingEocd`, fallback HTML/CSV.
- Botón "Descargar" en `DialogHeader`.
- Tabs multi-hoja.
- Cero Supabase / DB — todo del Excel importado.
- Sin nueva ruta. El preview sigue siendo el entry point actual.

## Plan de implementación

1. Crear `src/components/excel-preview/types.ts` y `formatters.ts`.
2. Tests vitest para `formatters.ts` (RED).
3. Implementar `formatters.ts` (GREEN).
4. Implementar `StatusBadge.tsx`.
5. Implementar `PreviewHeader.tsx`.
6. Implementar `MetricsStrip.tsx` + `MetricCard.tsx`.
7. Implementar `DataTable.tsx`.
8. Implementar `RowDetailDrawer.tsx`.
9. Implementar `PreviewSkeleton.tsx`.
10. Crear `index.ts` con barrel.
11. Refactor `ExcelPreviewer.tsx` para usar los nuevos componentes.
12. `npm run build` + `npm run lint` + `npm test` (debe pasar sin warnings).
13. Commit + push.
14. Verificar deploy en Vercel (vigilar el bug de "initializing" stuck).

## Verificación

- `npm test` pasa con todos los formatters testeados.
- `npm run build` sin warnings de TypeScript.
- `npm run lint` sin errores.
- Build local genera bundle con la nueva UI.
- Vercel deploy pasa de "initializing" → "Building" → "Ready" en menos de 3 min.
- En el preview de un Excel real: header, sheet tabs, métricas (si hay), tabla con sticky header sólido, click fila abre drawer, click celda copia y muestra toast.

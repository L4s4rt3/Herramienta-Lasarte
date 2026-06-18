# Analisis Diario - Rediseno orientado al dia

Fecha: 2026-06-18
Estado: aprobado para planificacion
Scope: redisenar la pestana Analisis Diario para organizar lotes, clases y grupos por dia, con foco en la semana actual

## Objetivo

Reorganizar la pantalla **Analisis Diario** para que el eje principal sea el **dia a dia operativo**. Actualmente la pestaña Lotes muestra una tabla plana con todas las filas y 8 columnas sin agrupacion. Las pestanas Clase y Grupo son tablas estaticas sin jerarquia ni drill-down.

El rediseno debe permitir:

- Ver de un vistazo el resumen de la semana actual.
- Analizar cada dia con sus lotes, kg, T/h y clasificacion.
- Expandir un dia para ver el detalle de lotes individuales.
- Navegar entre semanas rapidamente.
- Mantener la coherencia visual entre las 3 pestanas.

## Principios de diseno

1. **El dia es la unidad minima.** Toda informacion se agrupa por fecha.
2. **Subtotales por dia.** Cada dia muestra kg totales, avg T/h ponderado, n de lotes y conteo de lotes lentos.
3. **Jerarquia colapsable.** Los dias se pueden expandir para ver detalle.
4. **Foco en semana actual.** Por defecto muestra la semana en curso, con navegacion rapida.
5. **Badges de T/h.** Indicador visual de velocidad: verde >=16, amarillo 12-16, rojo <12.

## Componentes: DailyListTable y DailyMatrixTable

Se usan **dos componentes** separados porque los dos patrones de vista son fundamentalmente distintos.

### DailyListTable (para Lotes)

Tabla colapsable por dia con filas de detalle.

```ts
interface DailyListTableProps<T> {
  data: T[];
  dateKey: keyof T;
  columns: ColumnConfig<T>[];
  groupLabel?: (row: T) => string;     // Para agrupar filas dentro del dia
  threshold?: { low: number; high: number; field: keyof T }; // Badges
}

interface ColumnConfig<T> {
  key: keyof T;
  label: string;
  formatter?: (value: unknown) => string;
  align?: "left" | "right" | "center";
  badge?: (value: unknown) => "success" | "warning" | "destructive" | null;
}
```

Comportamiento:

- Genera **una seccion por dia** (Lun 16/06, Mar 17/06, ...).
- Cada seccion tiene un **header con subtotales** (kpi badges inline).
- Click en el header del dia **expande/colapsa** las filas de detalle.
- **Footer sticky** con totales de la semana completa.

### DailyMatrixTable (para Clase y Grupo)

Matriz dia x dimension con celdas de intensidad.

```ts
interface DailyMatrixTableProps<T> {
  data: T[];
  dateKey: keyof T;
  dimensionKey: keyof T;               // 'clase' o 'grupo'
  valueKey: keyof T;                   // Campo numerico (kg)
  dimensions: string[];                // Lista ordenada de dimensiones
  colors?: Record<string, string>;     // Colores por dimension
}
```

Comportamiento:

- Filas = dias, Columnas = dimensiones (clases o grupos).
- Cada celda muestra valor + indicador de intensidad (fondo mas oscuro = mas kg).
- Columna `Total dia` sticky right.
- Fila `Total` sticky bottom.
- Sin drill-down cruzado entre pestanas (cada pestana es independiente).

## Selector de periodo

Ubicado en el header de la pagina, encima de las pestanas.

- Pills: `Esta semana` (default) | `Semana anterior` | `Ultimas 4 semanas` | `Personalizado`
- Al cambiar el periodo, todas las pestanas reaccionan.
- Personalizado muestra inputs date desde/hasta.

```ts
type Periodo = "esta_semana" | "anterior" | "ultimas_4" | "custom";
```

Logica:

- `esta_semana`: lunes de la semana actual hasta hoy.
- `anterior`: lunes hasta domingo de la semana pasada.
- `ultimas_4`: 4 semanas completas atras.
- `custom`: rango manual.

## KPIs de semana (encima de las pestanas)

Grid de 4 tarjetas que resume la semana seleccionada:

| KPI | Valor | Hint |
|-----|-------|------|
| Kg totales | Suma kg de lotes | n lotes |
| Avg T/h | Promedio ponderado | Dias operativos |
| Lotes lentos | Conteo T/h < 12 | % del total |
| Dias analizados | n fechas unicas | vs semana anterior |

## Pestana Lotes

### Estructura

```
▼ Lun 16/06  (8.500 kg · 15.2 T/h · 5 lotes)
  Lote A-01  Finca Los Olivos  Navelina    1.600 kg  16.0 T/h  60 min  180g  🟢
  Lote A-02  Finca Los Olivos  Navelina    1.500 kg  15.0 T/h  58 min  175g  🟢
  Lote B-01  Huerto El Valle   Lane Late   2.100 kg  14.5 T/h  62 min  190g  🟡
  Lote C-01  Finca La Sierra   Salustiana  1.800 kg  16.2 T/h  55 min  165g  🟢
  Lote D-01  Coop. San Juan    Navelina    1.500 kg  13.8 T/h  65 min  185g  🟡

▼ Mar 17/06  (9.200 kg · 13.8 T/h · 6 lotes) ⚠ 2 lentos
  Lote A-03  Finca Los Olivos  Navelina    2.200 kg  12.5 T/h  72 min  180g  🔴
  Lote B-02  Huerto El Valle   Lane Late   1.900 kg  14.0 T/h  68 min  188g  🟡
  Lote E-01  Finca La Sierra   Salustiana  1.700 kg  15.5 T/h  54 min  170g  🟢
  ...

───────── Total semana: 42.300 kg · 14.1 T/h · 24 lotes ─────────  ← sticky
```

### Columnas de detalle

| Columna | Formato | Alineacion |
|---------|---------|------------|
| Lote | Mono, texto | Izq |
| Productor | Texto | Izq |
| Producto | Texto | Izq |
| Kg | Formato kg (1.600 kg) | Der |
| T/h | 1 decimal + badge color | Der |
| Min | Entero | Der |
| Peso fruta | Entero + g | Der |

### Header del dia

- Boton de expandir/colapsar (chevron).
- Badge de fecha (Lun 16/06).
- Metricas inline: `8.500 kg · 15.2 T/h · 5 lotes`.
- Indicador `⚠` si hay lotes lentos (T/h < 12) con contador.

### Filtros laterales

Sidebar persistente con:

- **Productor**: checkboxes agrupados por nombre, con conteo de lotes.
- **Producto**: checkboxes agrupados por variedad, con conteo.
- **T/h**: slider o rangos predefinidos (>=16, 12-16, <12).
- **Fecha**: si el periodo es personalizado, permite filtrar fechas.

## Pestana Clase

### Estructura

Matriz: **fila = dia**, **columna = clase**.

| Dia | Exportacion | Mercado | No exportacion | No comercial | Mujeres | **Total dia** | Avg T/h |
|-----|-------------|---------|----------------|--------------|---------|---------------|---------|
| Lun 16 | 5.200 kg | 2.100 kg | 800 kg | 400 kg | — | **8.500** | 15.2 |
| Mar 17 | 5.800 kg | 2.300 kg | 700 kg | 400 kg | — | **9.200** | 13.8 |
| Mie 18 | 4.900 kg | 1.800 kg | 600 kg | 500 kg | — | **7.800** | 14.5 |
| Jue 19 | 4.100 kg | 1.500 kg | 500 kg | 400 kg | — | **6.500** | 13.2 |
| Vie 20 | 6.200 kg | 2.800 kg | 900 kg | 400 kg | — | **10.300** | 14.8 |
| **Total** | **26.200** | **10.500** | **3.500** | **2.100** | — | **42.300** | **14.1** |

### Comportamiento

- Cada celda muestra kg y un indicador de intensidad (color de fondo mas oscuro = mas kg).
- Click en celda → selecciona la celda (resalta fila y columna). No navega a otra pestana.
- Columna `Total dia` siempre visible (sticky right).
- Fila `Total` siempre visible (sticky bottom).
- Si no hay datos de una clase en un dia, muestra `—` (sin fondo).

### Colores por clase

```ts
const CLASE_COLORS: Record<string, string> = {
  Exportacion: "text-success",
  Mercado: "text-info",
  "No exportacion": "text-warning",
  "No comercial": "text-destructive",
  Mujeres: "text-info",
  Otro: "text-muted-foreground",
};
```

## Pestana Grupo

### Estructura

Espejo de Clase: **fila = dia**, **columna = grupo de destino** (Exportacion, Mercado, Mujeres, No exportacion, No comercial).

| Dia | Exportacion | Mercado | Mujeres | No exportacion | No comercial | **Total** |
|-----|-------------|---------|---------|----------------|--------------|-----------|
| Lun 16 | 5.200 | 2.100 | — | 800 | 400 | **8.500** |
| ... | ... | ... | ... | ... | ... | ... |

Mismo comportamiento que Clase: heatmap, click drill-down, sticky totals.

## Navegacion entre semanas

- Botones `←` y `→` en el header para navegar semana a semana.
- Atajos de teclado opcionales: `[` y `]`.
- La semana actual se marca con un borde o badge `Actual`.
- Al navegar, la URL cambia: `/analisis/diario?desde=2026-06-16&hasta=2026-06-22`.

## Responsive

- En movil, las pestanas se apilan verticalmente.
- La tabla colapsa a cards por dia (en vez de tabla con columnas).
- Los filtros laterales se mueven en un drawer/sheet.

## Fuentes de datos

Sin cambios. El hook `useAnalisisDiario` ya provee:

- `data.lotes`: array de `LoteResumen` con fecha, lote_codigo, productor, producto, kg, tph, duracion, peso_fruta.
- `data.clases`: array de `ClaseResumen` con clase, kg_total, n_registros, n_dias, grupos.
- `data.grupos`: array de `GrupoClasificacionResumen` con grupo, kg_total, n_registros, n_dias.

## Archivos a modificar

| Archivo | Cambio |
|---------|--------|
| `src/pages/AnalisisDiario.tsx` | Refactorizar: usar DailyListTable y DailyMatrixTable, nuevo selector de periodo, nueva estructura de pestanas |
| `src/components/DailyListTable.tsx` | **Nuevo**. Tabla colapsable por dia con filas de detalle (para Lotes) |
| `src/components/DailyMatrixTable.tsx` | **Nuevo**. Matriz dia x dimension con celdas de intensidad (para Clase/Grupo) |
| `src/components/WeekSelector.tsx` | **Nuevo**. Selector de periodo con navegacion semana |
| `src/lib/analisisDiarioView.ts` | Agregar funciones de agrupacion por dia, calculo de subtotales, deteccion de lotes lentos |
| `src/hooks/useAnalisisDiario.ts` | Sin cambios significativos (ya provee los datos necesarios) |

## Criterio de exito

1. Al abrir Analisis Diario, se muestra la semana actual por defecto.
2. Los KPIs del header reflejan los totales de la semana.
3. La pestana Lotes muestra dias colapsables con subtotales (DailyListTable).
4. Expandir un dia muestra todos sus lotes con todas las columnas.
5. Los badges de T/h muestran colores correctos (verde/amarillo/rojo).
6. Las pestanas Clase y Grupo muestran matrices dia x dimension (DailyMatrixTable).
7. Las celdas de matriz muestran intensidad de color segun kg.
8. Navegar entre semanas funciona y actualiza todas las vistas.
9. Los filtros laterales funcionan y se aplican en tiempo real.
10. El footer sticky muestra totales de semana siempre visibles.
11. Responsive: funciona en movil con layout adaptado.

## Fuera de alcance

- Cambios en el hook `useAnalisisDiario` (estructura de datos existente es suficiente).
- Exportacion Excel/PDF de esta vista (seuede en otra iteracion).
- Comparativa con semana anterior inline (ya existe en Dashboard).
- Graficos de tendencia por clase/grupo (seuede si hay demanda).

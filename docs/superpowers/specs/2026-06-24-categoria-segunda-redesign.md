# Categoria Segunda - Rediseno con filtros globales

Fecha: 2026-06-24
Estado: aprobado para planificacion
Scope: redisenar la pagina VentasCategoriaSegunda con filtros globales y agregacion cliente-side

## Objetivo

Transformar la pagina `/ventas/categoria-segunda` para que los filtros de campana, mes, cliente, producto y articulo sean globales y afecten a todas las pestanas (Dashboard, Clientes, Productos, Articulos, Base diaria). La pagina debe ser mas facil de consultar, con filtros siempre visibles y respuesta instantanea.

## Principios de diseno

1. **Filtros globales y persistentes.** Los filtros estan siempre visibles entre el header y las pestanas. Al cambiar de pestana los filtros se mantienen.
2. **Agregacion en cliente.** Dado que el dataset es ~10k lineas, se cargan todas las lineas una vez y se agregan en cliente con `useMemo`. Sin llamadas adicionales al servidor al cambiar filtros.
3. **Pestanas existentes se mantienen.** Dashboard, Clientes, Productos, Articulos, Base diaria e Importar conservan su estructura y contenido, pero las primeras 5 responden a los filtros.
4. **Sin cambios en BD ni Supabase.** No se crean nuevas vistas, RPCs ni migraciones.

## Layout

```
┌──────────────────────────────────────────────────────┐
│ HEADER (existente, sin cambios)                       │
│ [Comercial] [Base cargada/Sin datos]                  │
│ Categoria segunda                                     │
│ Ventas por cliente, producto, articulo...             │
│ [Importar Excel] [Categoria]                          │
│ ─── Lineas | Campanas | Clientes | Metodos | Estado   │
├──────────────────────────────────────────────────────┤
│ FILTROS GLOBALES (nuevo)                              │
│ [Campana ▼] [Mes ▼] [Cliente ▼] [Producto ▼]         │
│ [Articulo 🔍]  [N activos] [Limpiar ✕]               │
├──────────────────────────────────────────────────────┤
│ [Dashboard] [Clientes] [Productos] [Articulos]        │
│ [Base diaria] [Importar]                              │
│                                                        │
│ ┌──────────────────────────────────────────────────┐  │
│ │ Contenido de la pestana activa (filtrado)        │  │
│ └──────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────┘
```

## Filtros globales

Barra visible siempre, colocada entre el header y las pestanas, con glass card styling.

### Filtros

| Filtro | Tipo | Fuente de datos | Notas |
|--------|------|-----------------|-------|
| Campana | Select | `filterOptions.campanas` | Una o ninguna |
| Mes | Select | `filterOptions.meses` | Una o ninguna |
| Cliente | Select | `filterOptions.clientes` | Muestra "Nombre - Codigo" |
| Producto | Select | `filterOptions.metodos` | Label "Producto" en UI |
| Articulo | Text input | Texto libre | Busqueda `ilike` sobre `articulo` |

### Comportamiento

- Todos los filtros son opcionales. Valor vacio = sin filtro.
- Badge muestra el numero de filtros activos.
- Boton "Limpiar" resetea todos los filtros.
- Los filtros persisten al cambiar de pestana.
- Al cambiar cualquier filtro, el contenido de todas las pestanas (menos Importar) se actualiza instantaneamente via `useMemo`.

## Flujo de datos

### Carga inicial

```
Pagina carga
  ├── Queries existentes (sin cambios)
  │   ├── resumenQuery (vista pre-agregada)
  │   ├── rankingClientesQuery
  │   ├── mensualClienteQuery
  │   ├── mensualProductoQuery
  │   ├── articulosQuery
  │   ├── catalogoQuery
  │   ├── ajustesQuery
  │   ├── validacionQuery
  │   └── filterOptionsQuery
  │
  └── Nueva query: allLinesQuery
      └── SELECT columnas ligeras FROM ventas_categoria_lineas
          WHERE categoria_id = X
          → ~10k filas en memoria
```

Nota: `pm_real` (con ajustes de comision/transporte) se computa igual que ahora, combinando `pm_venta` de la agregacion con los ajustes del cliente via `calcularPrecioReal`. La funcion `aggregateVentasCategoria` produce `pm_venta`, y el componente aplica los ajustes post-agregacion.

### Con filtros activos

```
allLinesQuery.data (VentasCategoriaLinea[])
  │
  ├── applyClientFilters(lines, filters)
  │   └── Array.filter() por campana, mes, cliente_codigo,
  │       metodo_producto, articulo (ilike)
  │
  ├── aggregateVentasCategoria(filteredLines)
  │   ├── resumen (kilos, base_iva, pm_venta, clientes, productos, articulos)
  │   ├── clientes (ranking)
  │   ├── productos
  │   ├── articulos
  │   ├── mensualCliente
  │   └── mensualProducto
  │
  ├── Dashboard KPIs ← resumen
  ├── Dashboard charts ← mensualProducto, ranking clientes
  ├── Clientes rankings ← clientes
  ├── Productos monthly chart ← mensualProducto
  ├── Articulos ← articulos
  └── Base diaria detalle ← filteredLines + paginacion
```

### Sin filtros activos

Se usan las queries existentes (vistas pre-agregadas en Supabase) para evitar recalcular en cliente innecesariamente.

## Comportamiento por pestana

### Dashboard (filtrado)
- KPI cards: Kilos total, Base IVA, PM bruto, PM real, Clientes, Productos
- Grafico "Evolucion mensual total" (barra)
- Grafico "Top clientes por volumen" (barra horizontal)
- Grafico "Evolucion mensual PM" (linea)
- Los 3 graficos se actualizan con datos filtrados

### Clientes (filtrado)
- "Ranking por kilos": top 20 filtrado
- "Ranking por PM real": top 20 filtrado, ordenado por PM descendente
- "Ajustes de comision y transporte": SIN FILTRAR (son configuraciones fijas por cliente)

### Productos (filtrado)
- "Productos catalogo por mes": grafico stacked filtrado
- "Productos catalogo": tabla SIN FILTRAR (el catalogo es fijo)
- "Validacion catalogo vs lineas": SIN FILTRAR (comparativa estructural)

### Articulos (filtrado)
- "Top 25 articulos exactos por kg": filtrado
- "Todos los articulos exactos": tabla completa filtrada

### Base diaria (filtrado)
- Usa los mismos filtros globales
- Paginacion sobre el conjunto filtrado
- Igual que ahora pero con filtros movidos a la barra global

### Importar (sin cambios)
- Misma funcionalidad de importacion de Excel
- No afectada por filtros

## Archivos a modificar

### `src/pages/VentasCategoriaSegunda.tsx` (cambios mayores)
- Mover estado `filters` fuera del ambito de "base" a nivel del componente
- Extraer barra de filtros a componente `GlobalFilterBar`
- Anadir `allLinesQuery` para cargar todas las lineas
- Anadir `useMemo` para filteredLines y filteredAggregation
- Pasar filteredLines a las pestanas correspondientes
- Renombrar label "Metodo" a "Producto" en filtros
- Remover filtros locales de la pestana Base diaria
- Actualizar detalle de base diaria para usar filteredLines

### `src/hooks/useVentasCategoria.ts` (cambios menores)
- Nueva query `allLinesQuery` que carga todas las lineas de `ventas_categoria_lineas` con columnas ligeras
- La query devuelve `VentasCategoriaLineaRow[]`
- Opcional: exponer `applyClientFilters` helper

### `src/lib/ventasCategoria.ts` (opcional)
- Exportar helper `applyVentasCategoriaFilters(lines, filters)` si se necesita fuera del hook

## No se modifica

- BD / Supabase (sin migraciones, sin nuevas vistas)
- `src/lib/types.ts`
- `src/lib/chartTheme.tsx`
- Componentes reutilizables (`KPICard`, `DataTable`, etc.)
- Otras paginas
- Enrutamiento

## Riesgos y mitigaciones

| Riesgo | Mitigacion |
|--------|-----------|
| ~10k lineas en memoria puede ser lento en dispositivos debiles | Las lineas son objetos pequenos (~15 campos), ~1-2 MB total. useMemo garantiza que solo se recalcula al cambiar filtros. |
| Desincronizacion entre datos filtrados y no filtrados en Productos (catalogo fijo vs grafico filtrado) | Documentado en el diseno. El catalogo es un concepto distinto a las lineas diarias. |
| PM real requiere ajustes (comision/transporte) que no estan en las lineas | Los ajustes se cargan por separado y se aplican igual que ahora. |

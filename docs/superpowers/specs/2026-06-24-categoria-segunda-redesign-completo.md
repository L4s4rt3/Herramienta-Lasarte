# Categoria Segunda - Rediseno completo de pestanas

Fecha: 2026-06-24
Estado: aprobado para planificacion
Scope: redisenar las pestanas Clientes, Productos, Articulos y Base diaria con vistas detalle, graficas, agrupacion y datos expandibles

## Objetivo

Redisenar las 4 pestanas de la pagina VentasCategoriaSegunda (Clientes, Productos, Articulos, Base diaria) para hacer la informacion mas consultable e intuitiva. El Dashboard se mantiene como esta.

## Principios de diseno

1. **Click para detalle.** Toda entidad (cliente, producto, articulo) tiene una vista detalle al hacer clic.
2. **Mini graficas de evolucion.** Cada fila en rankings muestra una sparkline de su evolucion mensual.
3. **Dia como unidad en Base diaria.** Las lineas se agrupan por fecha con subtotales y filas expandibles.
4. **Columnas congeladas.** En tablas con scroll horizontal, cliente y articulo quedan fijos.
5. **Coherencia visual.** Mismo patron de glass cards, mismos colores, misma interaccion.

## Arquitectura de datos

Los datos ya estan disponibles via `useVentasCategoria` hook:
- `allLinesQuery` — todas las lineas (~10k) para filtrado y agregacion cliente-side
- Vistas pre-agregadas para datos sin filtrar
- Filtros globales existentes afectan a todas las pestanas

Para las vistas detalle, se usan los mismos datos ya cargados, filtrados por el id de la entidad seleccionada.

## Componentes nuevos a crear

### `ClienteDetailPanel`
Panel expandido o slide-over que muestra al hacer clic en un cliente:
- KPIs del cliente: kilos total, PM bruto, PM real, comision, transporte
- Grafica de evolucion mensual (volumen + PM en ejes duales)
- Tabla de productos que compra (metodo, kilos, % del total)
- Tabla de articulos que compra (articulo, kilos, PM)
- Ajustes de comision/transporte editables (igual que ahora)

### `ProductoDetailPanel`
Panel expandido que muestra al hacer clic en un producto/metodo:
- KPIs del producto: kilos total, PM, clientes, % de categoria
- Grafica evolucion mensual del producto
- Ranking de clientes que compran ese producto
- Comparativa del PM del producto vs PM promedio de categoria

### `ArticuloDetailPanel`
Panel expandido que muestra al hacer clic en un articulo:
- KPIs del articulo: kilos, PM, lineas
- Grafica evolucion mensual
- Clientes que compran ese articulo

### `SparklineCell`
Componente para mostrar mini grafica de evolucion dentro de una celda de tabla:
- Barra mini con 6-12 puntos (meses)
- Altura ~24px, ancho ~80px
- Color segun tendencia: verde si subiendo, rojo si bajando

### `DailyGroupTable`
Tabla agrupada por dia con filas expandibles:
- Cada dia es un `Collapsible` con subtotales en el header
- Columnas congeladas: cliente y articulo siempre visibles
- Al hacer clic en una fila, se expande informacion detallada

## Diseno por pestana

### Clientes (nuevo layout)

```
┌─────────────────────────────────────────────────────────┐
│ Ranking de clientes (tabla con sparklines)               │
│                                                          │
│ # | Cliente           | Kilos    | PM     | Evolucion  | │
│ 1 | Cliente A         | 150.5t   | 0.321  | ▁▃▆▄▂    | │
│ 2 | Cliente B         | 120.2t   | 0.453  | ▂▃▅▃▁    | │
│                                                          │
│ [Al hacer clic en fila → se abre detalle debajo]         │
│                                                          │
│ ┌────────────────────────────────────────────────────┐  │
│ │ Cliente A — Detalle                                │  │
│ │ Kilos: 150.5t | PM: 0.321 | Comision: 5% | Trans: 2%│ │
│ │ ┌─── Evolucion mensual (grafica barras + linea) ─┐ │  │
│ │ │ ██  ██  ████  ██  ██  ██  ██████  ██  ██  ██  │ │  │
│ │ │ ──────────────────────────────── PM            │ │  │
│ │ └────────────────────────────────────────────────┘ │  │
│ │ Productos que compra:                              │  │
│ │ LN211 | 80t | 53% | 0.30 EUR/kg                   │  │
│ │ LN210 | 40t | 27% | 0.35 EUR/kg                   │  │
│ │ Ajustes: [Comision %] [Trans %] [Guardar]         │  │
│ └────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

Comportamiento:
- Tabla principal con sparklines de evolucion (6 meses)
- Click en fila expande/colapsa detalle del cliente (inline, debajo de la fila)
- En detalle: KPIs, grafica mensual, productos, articulos, ajustes
- Ajustes igual que ahora (comision_pct, comision_cent_kg, transporte_pct, transporte_cent_kg)
- Los filtros globales afectan a los datos del detalle

### Productos (nuevo layout)

```
┌─────────────────────────────────────────────────────────┐
│ Ranking de productos (tabla compacta)                    │
│ Metodo | Descripcion  | Kilos  | PM    | Clientes |    │
│ LN211  | Generica...  | 150.5t | 0.321 | 12       |    │
│ LN210  | Premium...   | 120.2t | 0.453 | 8        |    │
│                                                          │
│ Grafica 1: Evolucion mensual por producto (stacked)      │
│ Grafica 2: Comparativa PM por producto (lineas)          │
│                                                          │
│ [Click en fila → detalle del producto]                   │
│ ┌──── Detalle LN211 ──────────────────────────────────┐ │
│ │ KPIs: 150.5t | 0.321 EUR/kg | 12 clientes           │ │
│ │ Grafica: evolucion mensual LN211                     │ │
│ │ Ranking: clientes que compran LN211                  │ │
│ │   Cliente A | 80t | 53% | 0.30 EUR/kg               │ │
│ │   Cliente B | 30t | 20% | 0.35 EUR/kg               │ │
│ └──────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

Cambios respecto al actual:
- Se elimina tabla "Validacion catalogo vs lineas" (no aporta valor al usuario final)
- La tabla "Productos catalogo" se fusiona con el ranking de productos: cada fila del ranking ES el producto catalogo con sus metricas filtradas (kilos, PM, clientes)
- Nueva grafica de comparativa de PM entre productos
- Catalogo (metodo, descripcion) se muestra como parte del ranking, no como tabla separada
- El ranking responde a filtros globales; el catalogo subyacente es fijo pero las metricas se recalculan

### Articulos (nuevo layout)

```
┌─────────────────────────────────────────────────────────┐
│ Agrupado por referencia (acordeones)                     │
│                                                          │
│ ▶ REF-001 (3 articulos | 45.2t | 22.3k EUR)             │
│   │ Articulo           | Kilos  | PM     | Clientes    │ │
│   │ NARANJA VALENCIA   | 20.1t  | 0.321  | 5           │ │
│   │ NARANJA NAVEL      | 15.0t  | 0.298  | 3           │ │
│                                                          │
│ [Click en articulo → detalle]                            │
│ ┌──── NARANJA VALENCIA ──────────────────────────────┐  │
│ │ KPIs: 20.1t | 0.321 EUR/kg | 5 clientes            │  │
│ │ Grafica evolucion mensual                            │  │
│ │ Clientes que lo compran: Cliente A, Cliente B...     │  │
│ └──────────────────────────────────────────────────────┘  │
│                                                          │
│ ▶ REF-002 (2 articulos | 30.0t | 15.1k EUR)             │
└─────────────────────────────────────────────────────────┘
```

Cambios respecto al actual:
- Articulos agrupados por referencia con subtotales
- Acordeones colapsables por referencia
- Click en articulo abre detalle con clientes y evolucion
- Se elimina el grafico "Top 25" (los datos estan en la tabla agrupada)

### Base diaria (nuevo layout)

```
┌─────────────────────────────────────────────────────────┐
│ [Filtros globales arriba]                                │
│                                                          │
│ ▶ Lun 16/06/2026 (12 lineas | 45.2t | 22.3k EUR)       │
│   │ Fecha│ Cliente (fijo)  │ Articulo (fijo)│ Met │ Kgs│ │
│   │ 16/06│ Cliente A       │ NARANJA...     │ LN  │ 5t │ │
│   │ 16/06│ Cliente B       │ LIMON...       │ LN  │ 3t │ │
│   │ ...                                               │ │
│   └── Subtotales dia: 45.2t | 22.3k EUR               │ │
│                                                          │
│ ▶ Dom 15/06/2026 (8 lineas | 32.1t | 15.5k EUR)        │
│   └─ ...                                                 │
│                                                          │
│ ▶ Sab 14/06/2026 (5 lineas | 18.0t | 9.2k EUR)          │
│   └─ ...                                                 │
└─────────────────────────────────────────────────────────┘
```

Cambios respecto al actual:
- Lineas agrupadas por fecha con Collapsible
- Header del dia: fecha, numero de lineas, subtotales (kilos, base IVA)
- Columnas congeladas (sticky): cliente (izquierda) y articulo (izquierda)
- Paginacion: boton "Cargar mas dias" al final (evita scroll infinito que es complejo con filas colapsables)
- Click en fila expande detalle (opcional, para futura iteracion)

## Archivos a crear/modificar

### Nuevos componentes:
- `src/components/VentasCategoriaClienteDetail.tsx` — panel detalle cliente
- `src/components/VentasCategoriaProductoDetail.tsx` — panel detalle producto
- `src/components/VentasCategoriaArticuloDetail.tsx` — panel detalle articulo
- `src/components/SparklineCell.tsx` — mini sparkline en tabla
- `src/components/DailyGroupTable.tsx` — tabla agrupada por dia

### A modificar:
- `src/pages/VentasCategoriaSegunda.tsx` — refactor de las 4 pestanas

## Lo que NO cambia

- Dashboard (se queda igual, al usuario le gusta)
- Importar (sin cambios)
- Filtros globales ya implementados (funcionan igual)
- Hook `useVentasCategoria` (ya tiene todos los datos necesarios)
- `aggregateVentasCategoria` y `applyVentasCategoriaFilters` (ya existen)

## Riesgos

| Riesgo | Mitigacion |
|--------|-----------|
| El archivo de pagina es grande (~600 lineas) | Se extraen componentes a archivos separados |
| Los paneles detalle pueden ser lentos con ~10k lineas | Los datos ya estan en memoria, solo se filtran por id |
| Agrupacion por dia puede ser pesada con scroll | Paginacion virtual o "cargar mas" boton |

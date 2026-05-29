# Diseño: Fix preview palets + Rediseño preview informes

## 1. Problema

- **Excel viewer falla** con archivos de palets: el diálogo `ExcelViewerDialog` intenta 4 estrategias de parseo secuenciales pero `isValidContent` rechaza archivos con muchas celdas vacías o formato no estándar, comunes en los informes de palets.
- **Reporte Ejecutivo usa Markdown**: el componente `ReporteOperativo` renderiza Markdown como HTML genérico, sin estructura de tablas. El usuario pide datos ordenados en filas y columnas.

## 2. Soluciones

### 2.1 Fix ExcelViewerDialog

#### 2.1.1 Relajar `isValidContent`

Actualmente requiere `< 50%` caracteres de control. Cambiar a: aceptar la hoja si **hay al menos 1 celda con texto legible** (no vacía, no solo caracteres de control). Eliminar umbral porcentual.

#### 2.1.2 Añadir 5º intento de parseo

```
Intento 5: XLSX.read(bytes, { type: "array", dense: true, cellDates: true, raw: true })
```

`dense: true` mejora el parseo de hojas con muchas celdas vacías.

#### 2.1.3 Mejorar mensaje de error

Incluir: nombre del archivo, tamaño, número de hojas detectadas, primeras filas para debug.

#### 2.1.4 Archivos afectados

- `src/components/ExcelViewerDialog.tsx`

### 2.2 Rediseño Reporte Ejecutivo

#### 2.2.1 Nueva estructura

Reemplazar renderizado Markdown por **componentes React estructurados** con tablas shadcn/ui:

| Sección | Componente | Datos |
|---------|-----------|-------|
| Resumen Ejecutivo | `KPICard` grid | kpis.kg_calibrador, pct_exportacion, tph_promedio, top_calibre, n_palets |
| Recepción y Lotes | `Table` shadcn | productores[] (tabla con columnas: Productor, Kg, Lotes, T/h, Peso Fruta) |
| Producción y Empaque | `Table` shadcn | top_productos[] (Producto, Kg, Empaques, Destino) |
| Logística y Clientes | `Table` shadcn | clientes[] (Cliente, Palets, Kg Total, Productos) |
| Calidad | `Table` shadcn | calibres[] top 5 (Calibre, Kg, % Total, % Export) |
| Alertas | Badge list | alertas[] |

Cada sección es un `<Card>` con `<CardHeader>` + `<Table>`.

Se mantiene la funcionalidad de:
- Botón "Copiar" (copia el Markdown generado)
- Botón "Descargar .md" (descarga el Markdown)
- Buscador inteligente de lotes
- Pestaña "Reporte Ejecutivo" en `AnalisisDashboard`

#### 2.2.2 Archivos afectados

- `src/components/ReporteOperativo.tsx` — reemplazar renderizado, mantener lógica de búsqueda y exportación
- `src/components/AnalisisDashboard.tsx` — se actualiza automáticamente al usar `ReporteOperativo`

### 2.3 Integración con ExcelViewerDialog

No se implementa por ahora. El `ExcelViewerDialog` se queda como visor genérico de Excel. La vista analizada del reporte se ve desde el dashboard del parte.

## 3. Criterios de éxito

- [x] Al hacer clic en un archivo Excel de palets, se abre el diálogo con los datos visibles
- [x] El Reporte Ejecutivo muestra los datos en tablas ordenadas (no Markdown genérico)
- [x] Los botones Copiar/Descargar .md/Buscador siguen funcionando
- [x] No hay errores de TypeScript al compilar

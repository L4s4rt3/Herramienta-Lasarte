# Guia para continuar la seccion Categoria segunda

Esta guia es para que DeepSeek V4 Flash, u otro asistente, continue mejorando la seccion `/ventas/categoria-segunda` con la misma linea de diseno, rendimiento y calidad.

## 1. Contexto rapido

La app es una herramienta interna de Lasarte desplegada en Vercel:

- Produccion: `https://controlproduccion.vercel.app`
- Repo local del usuario: `C:\Users\luiso\OneDrive\Escritorio\Herramienta-Lasarte-main`
- Stack: Vite, React, TypeScript, Tailwind, shadcn/radix, Recharts, React Query, Supabase.
- Seccion a mejorar: `src/pages/VentasCategoriaSegunda.tsx`
- Hook principal: `src/hooks/useVentasCategoria.ts`
- Utilidades/test de calculo: `src/lib/ventasCategoria.ts` y `src/lib/ventasCategoria.test.ts`

La seccion analiza ventas de `Categoria segunda`. No cambiar el nombre visible a "La Fea".

## 2. Reglas de diseno para esta app

La herramienta es operativa, no marketing. El usuario necesita leer, filtrar y decidir rapido.

Mantener esta linea:

- Paneles sobrios, densos y escaneables.
- Usar componentes existentes de `src/components/ui`.
- Usar `Card` para tablas, graficas y bloques concretos, pero evitar meter cards dentro de cards.
- Usar `Tabs` compactas, tablas con encabezado claro, KPIs pequenos y visualmente consistentes.
- Usar `Select` para filtros cerrados: campana, mes, cliente, metodo.
- Usar `Input` solo para busquedas libres como articulo.
- Usar iconos `lucide-react` en acciones.
- Evitar heroes, textos de marketing, gradientes decorativos, blobs/orbs o layouts vistosos sin utilidad.
- Evitar texto gigante dentro de paneles compactos.
- Mantener radios moderados, coherentes con el sistema actual.
- Cuidar responsive: desktop denso, mobile en columnas sin solapes.

En esta seccion se puede seguir usando:

- `glass-accented`
- `border-[var(--glass-border)]`
- `bg-[var(--glass-bg)]`
- `shadow-[var(--glass-shadow)]`
- `backdrop-blur-xl`
- `tabular-nums` para numeros

## 3. Reglas de rendimiento

No romper esto:

- La ruta debe seguir lazy-loaded.
- No meter la seccion en `useDataWarmup`.
- No cargar la base diaria completa para la tabla.
- El detalle diario debe ir con filtros y paginacion.
- Los dashboards deben consultar vistas agregadas o datos acotados.
- Los filtros de opciones pueden cargar columnas ligeras, pero no traer columnas innecesarias.
- Graficas:
  - Top 10 clientes por defecto.
  - 7 productos de catalogo completos.
  - Top 25 articulos exactos.
- Cualquier filtro nuevo debe invalidar o cambiar claves React Query correctamente.

## 4. Modelo de datos

Tablas:

- `ventas_categorias`
- `ventas_categoria_productos`
- `ventas_categoria_lineas`
- `ventas_categoria_clientes_ajustes`
- `ventas_categoria_autorizados`

Vistas:

- `ventas_categoria_resumen`
- `ventas_categoria_mensual_cliente`
- `ventas_categoria_mensual_producto`
- `ventas_categoria_ranking_clientes`
- `ventas_categoria_resumen_articulo`
- `ventas_categoria_validacion_catalogo`
- `ventas_categoria_lineas_con_ajustes`

RPC:

- `can_access_ventas_categoria()`

Si se cambia SQL, crear migracion en `supabase/migrations`. No cambiar produccion a mano sin dejar migracion equivalente.

## 5. Estado de datos conocido

Produccion tiene datos cargados:

- `9.735` lineas utiles.
- `64` clientes.
- `7` metodos/productos.
- `16.553.847 kg`.
- Total de kilos lineas = total de kilos catalogo.

El Excel tiene dos filas de kilos cero, descartadas por el importador. No tratarlas como perdida de importacion salvo que el usuario quiera analizar base IVA sin kg.

## 6. Flujo recomendado antes de tocar codigo

1. Leer estos archivos:
   - `docs/memoria-categoria-segunda-export.md`
   - `src/pages/VentasCategoriaSegunda.tsx`
   - `src/hooks/useVentasCategoria.ts`
   - `src/lib/ventasCategoria.ts`
   - `src/lib/ventasCategoria.test.ts`
2. Revisar `git status --short --branch`.
3. Entender la peticion exacta del usuario.
4. Hacer cambios pequenos y verificables.
5. Ejecutar tests/lint/build enfocados.

## 7. Comandos de verificacion

Desde `C:\Users\luiso\OneDrive\Escritorio\Herramienta-Lasarte-main`:

```powershell
npm.cmd test -- ventasCategoria ventasCategoriaAccess
```

```powershell
npx.cmd eslint src/pages/VentasCategoriaSegunda.tsx src/hooks/useVentasCategoria.ts src/lib/ventasCategoria.ts src/lib/ventasCategoria.test.ts
```

```powershell
npm.cmd run build
```

Para probar local:

```powershell
npm.cmd run dev -- --host 127.0.0.1 --port 5174
```

Ruta local:

`http://127.0.0.1:5174/ventas/categoria-segunda`

Puede requerir login.

## 8. Mejoras recomendadas siguientes

### 8.1 Filtros globales

Ahora los filtros completos estan en `Base diaria`. Lo mas util seria crear filtros globales arriba de la seccion para:

- Campana
- Mes
- Cliente
- Metodo

Y que afecten tambien a:

- Dashboard
- Clientes
- Productos
- Articulos
- Base diaria

Forma recomendada:

1. Crear estado `globalFilters`.
2. Crear helper para normalizar filtros y detectar filtros activos.
3. Crear nuevas queries/vistas/RPC agregadas que acepten filtros, o filtrar en cliente solo si el volumen agregado es pequeno.
4. Preferible: RPCs SQL para agregados filtrados si se quiere maximo rendimiento.
5. Mantener `Base diaria` paginada siempre.

### 8.2 Mejorar Dashboard

Cambios convenientes:

- Bloque superior con resumen claro: kilos, base IVA, PM bruto, PM real, clientes, productos.
- Mini indicador de datos cargados: lineas, campanas, meses, clientes, metodos.
- Grafica mensual total con barras.
- Grafica PM mensual con linea.
- Top clientes por volumen con barras horizontales.
- Mostrar "filtros aplicados" si hay filtros globales.

Evitar:

- Graficas con demasiadas series.
- Textos explicativos largos en pantalla.
- Cargar detalle diario para calcular KPIs.

### 8.3 Mejorar Clientes

Cambios convenientes:

- Tabla ranking por kilos.
- Tabla ranking por PM real.
- Score volumen-precio-actualidad.
- Filtros por campana/mes/metodo.
- Ajustes de comision/transporte con mejor guardado:
  - Estado "Guardando..."
  - Toast de exito/error por cliente.
  - Indicador visual si el ajuste esta modificado pero no guardado.

Formula actual del PM real:

`pm_real = pm_bruto - comision_pct - transporte_pct - comision_cent_kg - transporte_cent_kg`

En utilidades, mirar `calcularPrecioReal`.

### 8.4 Mejorar Productos

Cambios convenientes:

- Tabla de catalogo con kilos, base IVA, PM.
- Validacion catalogo vs lineas mas intuitiva:
  - Separar "total categoria cuadra" de "diferencias por metodo".
  - Mostrar diferencias positivas/negativas con color.
  - Explicar en tooltip o texto corto que el total puede cuadrar aunque haya diferencias internas entre metodos.
- Grafica por mes con los 7 metodos.
- Grafica de PM por metodo y mes.

### 8.5 Mejorar Articulos

Cambios convenientes:

- Top 25 articulos exactos en grafica.
- Tabla completa con busqueda por referencia/articulo.
- Filtro por metodo.
- Indicador "la suma de articulos exactos = total categoria".

### 8.6 Mejorar Importar

Cambios convenientes:

- Vista previa antes de guardar:
  - Lineas detectadas.
  - Lineas descartadas con motivo.
  - Kilos lineas.
  - Kilos catalogo.
  - Base IVA lineas.
  - Base IVA catalogo.
  - Clientes unicos.
  - Productos sin clasificar.
- Mostrar las 2 lineas de kilos cero como "descartadas por kilos cero" en vez de que parezca que faltan.
- Boton guardar deshabilitado si hay diferencias graves.
- Confirmacion antes de reemplazar datos existentes.

## 9. Como hacer cambios con buena calidad

Para cada mejora:

1. Si hay logica de calculo/filtros, escribir o actualizar test en `src/lib/ventasCategoria.test.ts`.
2. Implementar helper puro en `src/lib/ventasCategoria.ts`.
3. Conectar datos en `src/hooks/useVentasCategoria.ts`.
4. Pintar UI en `src/pages/VentasCategoriaSegunda.tsx`.
5. Ejecutar:
   - Tests.
   - ESLint enfocado.
   - Build.
6. Si se puede, probar la ruta en navegador con login.

## 10. Criterios para aceptar una mejora

Una mejora esta lista solo si:

- No rompe acceso restringido.
- No carga la base diaria completa por defecto.
- Los filtros son claros y visibles.
- Los numeros tienen formato estable.
- Mobile no se solapa.
- Tests relevantes pasan.
- Build pasa.
- La UI sigue la linea operativa de la app.

## 11. Notas de seguridad

- No exponer claves de Supabase.
- No usar `service_role` en frontend.
- No eliminar RLS.
- No dar acceso por correo desde frontend; debe estar en Supabase/politicas.
- Cualquier importacion o borrado de datos debe quedar limitado a usuarios autorizados.

## 12. Resumen de lo ultimo hecho

Ultimo pase:

- Se confirmo que los datos estan importados.
- Se comprobo que el total de kilos cuadra con catalogo.
- Se anadieron filtros desplegables reales en Base diaria.
- Se anadio cabecera de estado.
- Se mantuvo la tabla paginada.
- Se documentaron datos y siguientes pasos.


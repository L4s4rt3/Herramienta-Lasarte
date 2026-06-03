# Jornada de Calidad - Diseno funcional

Fecha: 2026-06-03
Estado: aprobado para planificacion
Scope: nuevo apartado de toma de notas de Calidad conectado con Partes

## Objetivo

Crear un apartado nuevo para que el departamento de Calidad pueda tomar notas diarias sobre lotes mientras se trabaja en planta. Las notas se guardan por fecha de jornada y deben poder consultarse cuando posteriormente se cree o revise el parte de esa misma fecha.

El primer alcance debe ser rapido e intuitivo, como una libreta diaria conectada. La arquitectura debe quedar preparada para evolucionar hacia un control completo de calidad con historico, defectos configurables, fotos, acciones, checklist y auditoria.

## Encaje en la app

El apartado se llamara **Calidad** o **Jornada de Calidad** y se anadira en la navegacion como un apartado propio, situado por encima de **Partes** dentro de operaciones diarias.

La pantalla debe seguir la linea visual existente de Lasarte:

- Usar `page-shell`, `page-header`, `glass`, `glass-accented`, `content-panel` y componentes shadcn existentes.
- Mantener el estilo operativo de la herramienta: claro, compacto, utilitario y facil de escanear.
- Evitar una estetica aislada o tipo app externa. La pantalla debe parecer parte natural de Lasarte SAT.
- Usar iconos de `lucide-react` de forma funcional: guardar, exportar, fotos, selector, estado, calendario.
- Mantener controles ergonomicos: toggles para valores binarios, segmented controls para calidad, selector para Productor/Finca, botones claros para guardar/exportar.

## Flujo principal

1. Calidad entra en **Jornada de Calidad**.
2. Selecciona la fecha de jornada, normalmente el dia actual.
3. Introduce o confirma el responsable.
4. Crea lotes manualmente conforme los va revisando durante el dia.
5. Para cada lote registra datos rapidos: lote, Productor/Finca, producto, variedad, cantidad, hora, Aerobotics, calidad, defectos, observacion, accion recomendada y fotos.
6. Guarda la jornada o los lotes individualmente.
7. Puede exportar las anotaciones a PDF o Excel sin depender del parte.
8. Cuando al dia siguiente se cree o revise el parte de la fecha correspondiente, las notas de Calidad de esa fecha deben aparecer conectadas.

## Campos de jornada

La jornada agrupa las notas de una fecha concreta.

- Fecha de jornada.
- Responsable.
- Usuario propietario.
- Estado: borrador, guardada, revisada.
- Fecha de creacion y ultima actualizacion.

La fecha es el punto principal de conexion con Partes. Ejemplo: las notas tomadas el 03/06/2026 deben aparecer al crear o revisar el parte del 03/06/2026, aunque el parte se cree el 04/06/2026.

## Campos de lote

Cada nota de lote debe incluir:

- Numero de lote.
- Productor/Finca.
- Producto.
- Variedad.
- Cantidad.
- Hora.
- Aerobotics realizado: si/no mediante toggle.
- Calidad: Bueno, Regular, Deficiente, Rechazado.
- Defectos observados.
- Observacion.
- Accion recomendada.
- Fotos o adjuntos opcionales.

Productor y Finca se consideran el mismo concepto en esta herramienta. Debe existir un selector reutilizable con busqueda y opcion para crear un Productor/Finca nuevo sin salir del formulario.

## Experiencia de usuario

La pantalla principal tendra dos zonas:

### Lista de lotes de la jornada

Una lista compacta con los lotes del dia, ordenados por hora o por creacion. Cada fila debe mostrar:

- Hora.
- Numero de lote.
- Productor/Finca.
- Calidad.
- Aerobotics si/no.
- Numero de fotos.
- Indicador visual si faltan campos importantes.

La fila seleccionada abre o actualiza el panel de detalle.

### Panel de detalle del lote

Un panel amplio para editar el lote seleccionado. Debe priorizar entrada rapida:

- Campos principales arriba.
- Toggle de Aerobotics muy visible.
- Segmented control para calidad.
- Defectos como chips o selector rapido.
- Observacion y accion recomendada debajo.
- Fotos como banda de miniaturas con boton para anadir.
- Boton principal Guardar.

En escritorio, lista y detalle pueden verse en dos columnas. En movil o pantallas estrechas, la lista aparece arriba y el detalle debajo o en drawer.

## Exportacion

La jornada debe poder exportarse desde el apartado de Calidad:

- PDF con cabecera, fecha, responsable, resumen y detalle de lotes.
- Excel con una hoja principal de lotes y, si es viable, hoja de resumen.

El PDF debe estar orientado a informe diario de Calidad, no a auditoria larga. Debe ser legible para enviar o archivar.

## Conexion con Partes

La conexion inicial sera por fecha:

- Parte del 03/06/2026 muestra notas de Calidad con `fecha_jornada = 2026-06-03`.

Cuando haya coincidencia de numero de lote, tambien debe poder mostrarse la nota junto al lote concreto. Si el lote no existe aun en Partes, la nota sigue siendo valida dentro de Calidad.

En la vista de detalle de Parte se anadira una seccion o tab de **Notas de Calidad** que muestre las notas conectadas de esa fecha. Esta seccion debe ser de lectura y acceso rapido, con enlace al apartado de Calidad para editar si hace falta.

## Modelo de datos propuesto

### `calidad_jornadas`

- `id`
- `user_id`
- `fecha`
- `responsable`
- `estado`
- `created_at`
- `updated_at`

### `calidad_lotes`

- `id`
- `jornada_id`
- `fecha`
- `numero_lote`
- `productor_finca_id`
- `productor_finca_nombre`
- `producto`
- `variedad`
- `cantidad`
- `hora`
- `aerobotics_realizado`
- `calidad`
- `defectos`
- `observacion`
- `accion_recomendada`
- `created_at`
- `updated_at`

### `calidad_productores`

- `id`
- `nombre`
- `created_at`
- `updated_at`

### `calidad_adjuntos`

- `id`
- `lote_id`
- `file_name`
- `file_path`
- `mime_type`
- `file_size`
- `created_at`

Los adjuntos deben guardarse en Supabase Storage, en un bucket o ruta especifica de Calidad.

## Preparacion para fase C

Aunque la fase 1 sea rapida, el diseno debe dejar espacio para:

- Catalogo configurable de defectos.
- Historico por Productor/Finca, producto, variedad y calidad.
- Tendencias por Aerobotics realizado/no realizado.
- Fotos y evidencias por lote.
- Acciones recomendadas con seguimiento.
- Checklist de control.
- Firma o revision final.
- Auditoria de cambios.

Nada de esto bloquea la fase 1, pero el modelo no debe impedirlo.

## Fuera de alcance en fase 1

- IA generando comentarios automaticamente.
- Analitica historica avanzada.
- Checklist completo de auditoria.
- Firma digital.
- Sincronizacion automatica con Aerobotics.
- Reglas complejas de calidad por variedad/producto.

## Verificacion esperada

- Crear una jornada para una fecha.
- Crear varios lotes manualmente.
- Crear y reutilizar Productor/Finca desde selector.
- Cambiar Aerobotics con toggle.
- Cambiar calidad con segmented control.
- Adjuntar fotos a un lote.
- Guardar y recargar sin perder datos.
- Exportar PDF.
- Exportar Excel.
- Abrir un parte de la misma fecha y ver las notas de Calidad conectadas.

## Criterio de exito

Calidad debe poder usar la pantalla como libreta diaria sin friccion. El usuario debe poder crear una nota de lote en menos de un minuto, con campos visibles, controles rapidos y exportacion sencilla.

La pantalla debe sentirse como parte de Lasarte SAT, no como un formulario externo.

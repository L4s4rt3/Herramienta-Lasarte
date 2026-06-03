# Jornada de Calidad - plan de implementacion

## Objetivo
Crear un nuevo apartado `/calidad` para tomar notas diarias de lotes, guardarlas, exportarlas y conectarlas con el parte del mismo dia.

## Alcance de esta primera entrega
- Nueva migracion Supabase con jornadas, lotes, catalogo de productor/finca y adjuntos.
- Pantalla "Jornada de Calidad" con seleccion de fecha, alta rapida de lotes, selector/creacion de productor-finca, toggle de Aerobotics, estado de calidad, defectos, observaciones, acciones y fotos.
- Exportacion PDF y Excel de las anotaciones.
- Nueva navegacion por encima de Partes y entrada en command palette.
- Pestaña de Calidad dentro del detalle del parte para traer las notas por fecha.

## Verificacion
- Tests de helpers de resumen/exportacion.
- Build de Vite.
- Revision visual en localhost cuando el servidor este disponible.

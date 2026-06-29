# Rediseño Calidad MVP: inspección visual asistida

## Objetivo

Rediseñar la sección de Calidad para que un responsable pueda crear informes de lote de forma rápida a partir de fotos, notas y una propuesta inicial generada por IA, manteniendo siempre revisión humana, autosave e histórico útil para comparar lotes y productores.

El MVP no intenta entrenar un modelo propio ni sustituir un calibrador industrial. Es un flujo completo y práctico:

```txt
Lote -> fotos + datos -> propuesta IA -> revisión humana -> informe PDF -> histórico
```

## Alcance del MVP

Incluye:

- Crear o seleccionar una jornada de calidad por fecha.
- Crear varios lotes dentro del día.
- Subir fotos por lote.
- Introducir datos mínimos del lote.
- Generar una propuesta de informe con IA.
- Guardar todo automáticamente como borrador.
- Revisar y corregir manualmente la propuesta.
- Validar el informe.
- Generar PDF en borrador y PDF oficial validado.
- Guardar histórico para comparar por lote, productor/finca, producto, fecha, calidad y problemas.

No incluye todavía:

- Entrenar YOLO u otro modelo propio.
- Dibujar cajas de detección sobre la imagen.
- Segmentación o cálculo exacto de área afectada.
- Reglas por cliente.
- Dashboard avanzado de tendencias.
- Control de mallas deshechas. Ese módulo irá separado en una fase posterior.

## Datos del lote

Cada lote debe guardar:

- Fecha.
- Responsable.
- Número o identificador de lote.
- Producto.
- Variedad, si aplica.
- Productor/finca.
- Cantidad o tamaño de muestra, opcional.
- Si se ha realizado Aerobotics: sí/no.
- Fotos adjuntas.
- Calidad propuesta por IA.
- Problemas propuestos por IA.
- Resumen/informe propuesto por IA.
- Calidad final revisada.
- Problemas finales revisados.
- Observaciones finales.
- Acción recomendada.
- Estado del informe.
- Datos de validación y reapertura.

## Calidades

Las calidades disponibles son:

- Excelente.
- Bueno.
- Regular.
- Deficiente.
- Pésimo.

Estas sustituyen a los estados actuales de la sección de Calidad.

## Problemas

Los problemas disponibles son:

- Rameado.
- Golpe.
- Podrido.
- Mancha.
- Calibre irregular.
- Color verde.
- Piel blanda.
- Deshidratado.
- Plaga.
- Otro.

Si se marca `Otro`, el usuario debe escribir una descripción manual.

## Estados del informe

El flujo de estados será:

```txt
Borrador
-> Informe generado
-> Validado / bloqueado
-> Reabrir edición
-> Editado pendiente de validar
-> Validado de nuevo
```

Reglas:

- Todo se guarda automáticamente como borrador.
- Navegar, recargar o cerrar el navegador no debe borrar la información introducida.
- Una propuesta generada por IA se guarda como borrador.
- El informe validado queda bloqueado en solo lectura.
- Para cambiar un informe validado hay que pulsar `Reabrir edición`.
- Al reabrir, deja de ser edición oficial hasta nueva validación.
- Se guardan fecha y usuario de validación.
- Se guardan fecha y usuario de reapertura.
- El motivo de reapertura será opcional en el MVP.

## PDF

Debe haber dos salidas:

- PDF de borrador, con marca visible `BORRADOR`.
- PDF oficial validado, sin marca de borrador.

El PDF debe contener:

- Datos generales del lote.
- Calidad final o calidad propuesta si sigue en borrador.
- Problemas seleccionados.
- Aerobotics sí/no.
- Observaciones.
- Acción recomendada.
- Fotos del lote.
- Estado del informe.
- Usuario y fecha de validación cuando exista.

## IA y revisión humana

La IA debe ayudar a redactar y sugerir, no decidir de forma definitiva.

Entrada para IA:

- Fotos del lote.
- Datos del lote.
- Notas del responsable, si existen.

Salida esperada:

- Calidad sugerida.
- Problemas sugeridos.
- Gravedad o explicación breve.
- Resumen profesional.
- Acción recomendada.

La interfaz debe mostrar claramente qué campos vienen de IA y permitir corregirlos antes de validar.

## Pantalla propuesta

La sección de Calidad se organiza en una pantalla de trabajo rápido:

1. Cabecera de jornada:
   - Fecha.
   - Responsable.
   - Resumen de lotes del día.
   - Botones de exportación o histórico.

2. Lista lateral o superior de lotes:
   - Lote.
   - Productor/finca.
   - Calidad actual.
   - Estado: borrador, generado, validado, reabierto.
   - Número de fotos.

3. Ficha del lote:
   - Datos del lote.
   - Subida de fotos.
   - Problemas.
   - Aerobotics sí/no.
   - Notas.
   - Propuesta IA.
   - Informe editable.
   - Acciones: guardar borrador, generar informe, validar, reabrir edición, PDF borrador, PDF oficial.

## Histórico

El histórico debe permitir que en siguientes usos se puedan comparar:

- Lotes de un mismo productor/finca.
- Evolución por producto/variedad.
- Frecuencia de problemas.
- Calidades por fecha.
- Diferencias entre propuesta IA y revisión humana.

Para el MVP basta con guardar los datos estructurados; las pantallas comparativas avanzadas pueden llegar después.

## Errores y casos límite

- Si se intenta validar sin fotos, mostrar aviso y pedir confirmación.
- Si `Otro` está marcado y no tiene descripción, bloquear validación.
- Si falla la IA, permitir redactar el informe manualmente y guardar borrador.
- Si falla la subida de una foto, mostrar qué archivo falló y mantener los demás.
- Si el usuario sale durante la edición, el borrador debe quedar recuperable.

## Criterios de aceptación

- Se puede crear un lote, subir fotos y no perder datos al navegar o recargar.
- Se puede generar una propuesta de informe y editarla.
- Se puede guardar PDF de borrador con marca `BORRADOR`.
- Se puede validar el informe y generar PDF oficial.
- Un informe validado queda bloqueado.
- Se puede reabrir edición y volver a validar.
- El histórico conserva lotes validados y borradores.
- Los problemas y calidades coinciden exactamente con los definidos en esta especificación.

# Consumos fisicos - Diseno funcional

Fecha: 2026-06-12
Estado: aprobado para planificacion
Scope: redisenar la seccion de consumos para medir eficiencia fisica por kg producido

## Objetivo

Convertir la seccion de **Consumos** en un control operativo de eficiencia fisica. La pantalla debe responder cuanta agua, gasoil, electricidad y quimicos se consumen por kg, usando datos reales cuando existan y estimaciones trazables cuando todavia falten partes.

El foco queda en unidades fisicas, no en euros:

- Agua: L/kg o m3/t.
- Electricidad: kWh/kg.
- Gasoil: mL/kg o L/t.
- Quimicos: mL/kg.

Los costes economicos se dejan fuera del alcance inicial. Las facturas pueden servir como documento de origen solo si incluyen consumo fisico. Si solo incluyen importe, se registraran como evidencia no utilizable para ratios fisicos hasta tener kWh, m3 o litros.

## Contexto

La campana empieza el 01/09/2025, pero los partes diarios existen desde abril de 2026. Por eso no se debe imputar todo el consumo de campana sobre los partes de abril, ya que distorsionaria los ratios por kg.

La solucion sera usar dos bases de kg:

- **Kg de partes** cuando existan datos diarios de produccion.
- **Kg vendidos** como proxy para periodos anteriores sin partes.

La app debe mostrar siempre que base se ha usado y con que nivel de confianza.

## Principios de calculo

Cada ratio se calcula como:

```text
ratio = consumo_fisico_del_periodo / kg_base_del_periodo
```

La base de kg se elige con este orden:

1. Si hay partes para todo o parte del periodo, usar kg producidos de partes.
2. Si no hay partes y hay ventas, usar kg vendidos.
3. Si no hay ni partes ni ventas, marcar el periodo como incompleto y no calcular ratio.

Cuando un periodo tenga mezcla de partes y ventas, la pantalla debe separar los tramos o marcar el resultado como mixto. No se debe ocultar la diferencia entre kg reales de produccion y kg vendidos estimados.

## Fuentes de datos

### Consumo fisico

Cada entrada de consumo representa un recurso medido en un periodo:

- Recurso: agua, electricidad, gasoil, quimicos.
- Fecha inicio.
- Fecha fin.
- Cantidad fisica.
- Unidad: L, m3, kWh.
- Fuente: contador, factura detallada, albaran, estimacion manual.
- Documento/referencia opcional.
- Notas.

Ejemplos:

- Gasoil: los listados de entradas por proveedor sirven porque incluyen litros y precio. Para esta fase se usa solo litros.
- Electricidad: se necesita kWh de factura detallada o contador. Un extracto solo con euros no permite ratio fisico.
- Agua: se necesita m3 o litros de factura detallada o contador. Un extracto solo con euros no permite ratio fisico.

### Kg base

Para el denominador:

- Partes: sumar kg producidos del periodo con la formula operativa ya usada en la app.
- Ventas: sumar kg vendidos por periodo desde la herramienta de ventas.
- Manual: permitir kg manual solo como ultima opcion, con marca de baja confianza.

## Niveles de confianza

Cada resultado debe tener una etiqueta visible:

- **Real**: consumo fisico medido y kg de partes.
- **Estimado**: consumo fisico medido y kg vendidos.
- **Mixto**: periodo parcialmente cubierto por partes y ventas.
- **Incompleto**: falta consumo fisico o kg base.

Esto permite analizar la campana completa sin hacer pasar estimaciones por datos operativos diarios.

## Experiencia de usuario

La seccion mantendra el estilo operativo actual de Lasarte: densa, clara, con componentes shadcn existentes y sin estetica de landing.

### Pestana Resumen

Vista principal para controlar la eficiencia:

- Selector de periodo: campana, mes, semana o rango manual.
- KPIs principales:
  - Agua L/kg.
  - Electricidad kWh/kg.
  - Gasoil L/t.
  - Quimicos mL/kg.
  - Kg base usados.
  - Porcentaje real vs estimado.
- Grafica mensual de ratios.
- Avisos de calidad del dato.

### Pestana Registrar

Formulario para registrar consumos por periodo:

- Recurso.
- Fechas.
- Cantidad fisica y unidad.
- Fuente.
- Documento/referencia.
- Boton para calcular kg desde partes.
- Boton para traer kg vendidos si no hay partes.
- Campo de notas.

El formulario no pedira euros en esta fase.

### Pestana Historico

Tabla por mes o periodo:

```text
Periodo | Base kg | Confianza | Kg partes | Kg vendidos | Agua | Luz | Gasoil | Quimicos | Ratios
```

La tabla debe dejar claro cuando un recurso no tiene dato fisico. Por ejemplo, una factura de luz con importe pero sin kWh no debe rellenar electricidad kWh/kg.

### Pestana Validacion

Panel de control de datos:

- Periodos sin kg base.
- Consumos sin unidad fisica.
- Facturas/extractos que no sirven para ratios fisicos.
- Periodos con solape parcial.
- Meses calculados con ventas en vez de partes.

## Modelo de datos propuesto

La tabla actual `sesiones_consumo` puede seguir soportando sesiones manuales de consumo, pero el rediseno necesita una entidad mas flexible por recurso y periodo.

### `consumos_fisicos`

Campos propuestos:

- `id`
- `user_id`
- `recurso`: `agua`, `electricidad`, `gasoil`, `quimicos`
- `fecha_inicio`
- `fecha_fin`
- `cantidad`
- `unidad`: `l`, `m3`, `kwh`
- `fuente`: `contador`, `factura_detallada`, `albaran`, `estimacion_manual`
- `referencia`
- `notas`
- `created_at`

### `consumos_periodos_calculados`

Puede ser una vista o calculo en frontend inicialmente:

- Periodo.
- Kg partes.
- Kg vendidos.
- Kg base usado.
- Tipo base: partes, ventas, mixto, manual.
- Ratios por recurso.
- Estado de confianza.

## Integracion con ventas

La herramienta de ventas aportara kg vendidos para periodos sin partes. El primer uso previsto es completar septiembre de 2025 a marzo de 2026 con ratios estimados de campana.

Cuando empiecen los partes, abril de 2026 en adelante, los ratios operativos priorizaran kg de partes. Si ventas y partes conviven en el mismo mes, la app puede mostrar ambos para comparacion, pero el KPI operativo usara partes.

## Reglas de imputacion por periodo

- Si consumo y kg base cubren el mismo rango, calcular directo.
- Si el consumo cubre un mes completo y los partes solo cubren algunos dias, calcular solo el tramo con parte o marcar como mixto.
- Si el consumo cubre varios meses, repartir por dias salvo que exista una lectura de contador mas precisa.
- Si hay kg vendidos para todo el periodo pero no partes, calcular como estimado.
- Si no hay consumo fisico, no calcular ratio aunque exista factura con euros.

## Exportacion

La exportacion Excel/PDF de consumos debe incluir:

- Resumen de ratios por periodo.
- Totales fisicos por recurso.
- Base kg usada y confianza.
- Historico mensual.
- Hoja o seccion de validacion de datos.

No se incluiran costes economicos en esta fase.

## Pruebas y validacion

La implementacion debe cubrir:

- Calculo de ratios con kg de partes.
- Calculo de ratios con kg vendidos.
- Periodos sin kg base.
- Periodos sin consumo fisico.
- Conversion de m3 de agua a litros.
- Conversion de gasoil a L/t y mL/kg.
- Marcado correcto de Real, Estimado, Mixto e Incompleto.

## Fuera de alcance inicial

- Calculo de euros por kg.
- Importacion OCR automatica de facturas.
- Conciliacion contable con proveedores.
- Asignacion por maquina mas alla de electricidad manual ya existente.
- Prediccion de consumo futuro.

## Criterio de exito

La seccion sera correcta cuando permita ver, desde inicio de campana, los consumos fisicos por kg con una etiqueta clara de confianza, usando ventas como proxy donde aun no hay partes y partes reales donde ya existen.

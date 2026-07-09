# Sistema de plantillas de exportación — Herramienta Lasarte

> Especificación de referencia para unificar TODAS las exportaciones (Excel/PDF).
> Aprobada por el dueño (jul 2026). Implementar contra este documento.
> Nota: es una especificación documental y de cumplimiento razonable; no sustituye
> validación final por asesoría fiscal/laboral/protección de datos.

## 0. Sistema de diseño común LASARTE SAT

### 0.1 Paleta
| Uso | Hex | Aplicación |
|---|---|---|
| Azul principal | `#253A70` | Títulos, bandas superiores, cabeceras de tabla |
| Verde acento | `#97C428` | Indicadores positivos, separadores, acentos |
| Naranja acento | `#F28C00` | Avisos, KPIs destacados, variaciones |
| Azul claro fondo | `#EEF3FA` | Cajas de metadatos, filas alternas |
| Verde muy claro | `#F3F8E8` | KPIs producción/calidad, totales |
| Gris texto | `#2E2E2E` | Cuerpo |
| Gris medio | `#6B7280` | Metadatos |
| Gris línea | `#D9DEE8` | Bordes 0,5 pt |
| Gris fondo | `#F7F8FA` | Filas alternas / zonas de lectura |
| Rojo alerta | `#B42318` | Incidencias, faltas, bloqueos |

Apta B/N: no depender solo del color. Etiquetas críticas con TEXTO: `ALTA`, `VALIDADO`, `PENDIENTE`, `CONFIDENCIAL`.

### 0.2 Tipografía
Aptos/Calibri/Arial. Título 16-22, subtítulo 10-11, cabecera tabla 8,5-10 bold, cuerpo 8-10, pie legal 7-8, KPI 16-24.

### 0.3 Cabecera común
Logo horizontal Lasarte arriba-izq; a la derecha título / periodo / "Exportado: fecha · usuario" / (PDF) "Página X de Y". Banda azul 3-5 mm + línea verde fina 1 mm. En Excel congelar paneles bajo la cabecera. Fondo blanco.

### 0.4 Pie común
`LASARTE SAT · CIF: {{CIF}} · {{DIRECCION_FISCAL}} · Tel. {{TELEFONO}} · {{EMAIL}} · {{WEB}}`
`Documento generado desde Herramienta Lasarte · Exportación: {{EXPORT_ID}} · {{FECHA_HORA_EXPORTACION}}`
- RRHH: "Documento confidencial. Contiene datos personales. Uso limitado a personal autorizado conforme RGPD/LOPDGDD."
- Económico/dirección: "Documento interno de dirección. No distribuir sin autorización."
- Calidad/trazabilidad: "Documento de control interno asociado a producción, calidad y trazabilidad agroalimentaria."

### 0.5 Formato numérico español
Fecha `dd/mm/aaaa`; fecha+hora `dd/mm/aaaa hh:mm`; kg `#.##0,00 "kg"`; T/h `#.##0,00 "T/h"`; L `#.##0,00 "L"`; mL/kg `#.##0,000 "mL/kg"`; L/kg `#.##0,000 "L/kg"`; kWh `#.##0,00 "kWh"`; € `#.##0,00 €`; €/kg `#.##0,0000 "€/kg"`; % `0,00 %`; enteros/cajas/palets `#.##0`.

### 0.6 Estilo de tablas
Cabecera fondo `#253A70` texto blanco negrita; subcabecera `#EEF3FA` texto `#253A70`; filas alternas blanco/`#F7F8FA`; bordes `#D9DEE8` 0,5pt; totales fondo `#F3F8E8` borde superior `#97C428` 1,5pt negrita; alertas texto `#B42318` fondo `#FFF1F0`. Excel: congelar 1ª fila de datos, filtros activos, ajustar a 1 página de ancho.

### 0.7 Bloque de metadatos común (bajo cabecera)
Centro/Planta `{{CENTRO}}`, Periodo `{{FECHA_INICIO}} - {{FECHA_FIN}}`, Exportado por `{{USUARIO}}`, Fecha exportación `{{FECHA_EXPORTACION}}`, Filtros `{{FILTROS}}`, Nº exportación `{{EXPORT_ID}}`.

### Campos técnicos en toda exportación
`{{EXPORT_ID}}`, `{{FECHA_HORA_EXPORTACION}}`, `{{USUARIO}}`, `{{CENTRO}}`, `{{PERIODO}}`, `{{FILTROS}}`, `{{VERSION_APP}}`, `{{HASH_DOCUMENTO}}` (opcional sensibles), `{{CLASIFICACION}}` (Interno/Confidencial/Dirección/RRHH).

### Reglas finales
1. Excel operativo: filtros, paneles congelados, gridlines ocultas, impresión configurada.
2. PDF oficial: cabecera/pie constantes, numeración, sin exceso de color.
3. RRHH: marca confidencial siempre.
4. Económico: marca dirección/confidencial y datos fiscales cuando sea factura o soporte económico.
5. CMR: respetar casillas oficiales, no reinterpretar.
6. Calidad/producción: conservar lote, fecha, producto y trazabilidad.
7. Comercial Mercadona: respetar la disposición del fichero oficial.

---

## Exportaciones (columnas y notas)

Ver detalle completo (mockups incluidos) en el historial de chat de la sesión. Resumen de cada una:

1. **Producción · Partes diarios (Excel)** — hojas Portada, Partes, Cascada DJPMN, Producto, Palets, Diccionario(oculta). Columnas exactas: ver §1. Trazabilidad (Reg. 178/2002).
2. **Producción · Partes diarios (PDF)** — A4 vertical: portada KPIs + tablas resumidas.
3. **Producción · Consumos (Excel)** — Portada, Sesiones, Resumen recursos, Consumos por periodo. Ratios L/kg, mL/kg, kWh/kg.
4. **Producción · Consumos (PDF)** — portada KPIs + tablas.
5. **Producción · Productores (Excel/PDF)** — Ranking, Ficha, Calibres, Clases, Calidad. Evitar datos personales del productor (usar código/finca).
6. **Calidad · Informe completo (Excel)** — 20 columnas (Fecha…Fotos). % validados, badges. Marcar campos IA vs validados.
7. **Calidad · Incidencias (Excel)** — priorizado Alta/Media/Seguimiento + responsable/fecha límite/estado acción.
8. **Calidad · Ficha por lote (PDF)** — A4 vertical: identificación, badges, defectos, observación, acción (si existe), informe en párrafos, fotos.
9. **RRHH · Plantilla trabajadores (Excel)** — Nombre, Puesto/Zona, Categoría, DNI (enmascarado `***1234**` por defecto), Email, Teléfono, Fecha alta, Antigüedad, Estado, Vacaciones/año, Computa kg/persona. Marca CONFIDENCIAL, minimización RGPD.
10. **RRHH · Asistencia diaria (Excel+PDF)** — presentes/ausentes/sin marcar, motivos genéricos (sin diagnóstico médico).
11. **RRHH · Informe semanal asistencia/operativo (Excel+PDF)** — semanas + comparativa kg/persona.
12. **RRHH · Nóminas/Vacaciones/Amonestaciones** — plantillas separadas, CONFIDENCIAL, datos mínimos, DNI enmascarado.
13. **Comercial · Mercadona Excel semanal** — réplica del oficial "PLANIFICACIÓN VENTAS RECIBIDA DE MERCADONA": NARANJAS TOTALES (Antequera II/Verdura/Total/mitad+nota), tabla métodos (MA12KGC/MA3KGC/MA4KGC/MA5KGC), bloque vendido/planificado/variación.
14. **Comercial · Ventas por categoría (Excel)** — primera/segunda por cliente/producto/artículo, precio bruto y real tras comisión/transporte.
15. **Comercial · CMR (PDF)** — casillas oficiales del Convenio CMR (1,2,3,4,5,6-9,11,13,16,17,21,22-24 + matrícula). Formato formulario B/N.
16. **Comercial · Hoja de ruta (PDF)** — cabecera (fecha/transportista/matrícula/conductor) + paradas + totales + firma.
17. **Económico · Facturación Mercadona (Excel/PDF)** — base imponible, tipo/cuota IVA, €/kg, ajustes, abonos, neto, nº/fecha factura. Requisitos AEAT de factura. DIRECCIÓN CONFIDENCIAL.
18. **Económico · Costes de consumos (Excel/PDF)** — consumo × tarifa vigente, coste, coste/kg, vigente desde, fuente tarifa.
19. **Económico · Precios/tarifas (Excel)** — recurso, unidad, €/unidad, vigente desde/hasta, proveedor, fuente, estado. Solo 1 vigente por recurso/unidad.

## Estado de implementación
- HECHO: motor común `src/lib/exportKit.ts` (Excel con marca vía exceljs) + `exportTheme.ts` (PDF rebrandeado).
- HECHO con marca: Plantilla (RRHH), CMR (formulario real) y Hoja de ruta, Partes (Excel+PDF), Consumos (Excel+PDF), Calidad (Excel+PDF).
- PENDIENTE (fase 2 restante): Asistencia diaria + Informe semanal/eficiencia (clasificación RRHH), Ventas por categoría (Excel), Productores, y los exports de Económico (facturación/costes/precios). Mercadona semanal se mantiene con su disposición oficial (no rebrandear).

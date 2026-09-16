# El ecosistema Lasarte: a qué está conectado el asistente y qué sabe

**Fecha: 11-09-2026.** Este documento lista todas las fuentes de datos y sistemas a los
que el asistente (Claude, desde el portátil de Vadim) tiene acceso, qué puede hacer en
cada uno y qué sabe de la empresa. Es la lista que hay que recorrer ANTES de dar una
cifra o decir que un dato no existe. Sin contraseñas: las credenciales viven donde se
indica, no aquí.

## 1. Conexiones activas

### 1.1 ERP de LR Informática (GSTOCKS y GVENTAS)

- **Qué es:** el programa de gestión de la empresa. Módulos GSTOCKS (almacén) y GVENTAS
  (ventas), más GCONTA y GAEAT. Programa Delphi que corre desde la carpeta compartida
  `\\192.168.1.10\lri`.
- **Datos:** MySQL 5.7 en `192.168.1.10:3306`. Empresa viva: base **gdata001** (Lasarte
  Cítricos S.L., CIF B14800304), ~1.450 tablas. Otras bases: gdata002 (Lasarte Export),
  gdatac01/gdatam01 (Lasarte S.A.T., históricas), gdatapru (pruebas).
- **Acceso:** las credenciales las guarda el propio ERP en el registro de Windows del
  portátil (`HKCU\Software\LRInformatica\GSTOCKS`). Los scripts las leen de ahí
  (`scripts/lib-palets-erp.mjs`, función `conectarErp`).
- **Regla dura:** SOLO LECTURA. Ni un INSERT, UPDATE, fichero ni configuración
  (instrucción de Vadim, 10-08-2026). Detalle en `docs/ERP_LR_INFORMATICA.md`.
- **Tablas que se saben leer:**
  - Artículos: `articulo_general` (nombre, alta, estado), `articulo_compras`
    (precio y fecha de última compra).
  - Compras: `ent_prov_lineas` + `ent_prov_cab_alb` (facturas de proveedor),
    `terceros_proveedores`.
  - Almacén: `stock_mvtos` (clave 12 = salida de producto terminado, 13 = consumo
    de material, 30 = entrada), `stock_exist`.
  - Producción: `agri_produc_cabecera` (elaboraciones, usuario Vanesa),
    `agri_produc_mp` (fruta que entra), `agri_produc_pt` (producto que sale),
    `agri_produc_ma` (material auxiliar, por fórmula), `agri_produc_mp_pt` (puente
    lote de entrada ↔ lote de confección), `agri_produc_mo` (agentes por actividad,
    SIN horas).
  - Fórmulas de confección: `agri_confeccion_cab` + `agri_confeccion_lineas`
    (código LNxxx, materiales por palet estándar).
  - Palets: `palets_cab` + `palets_lin` (+ `_hist`), con lote de confección, cajas,
    kilos, fórmula, venta enlazada.
  - Ventas: `fact_albaranes` + `fact_lin_alb` (serie C = albaranes, tipo_documento
    40; precio `precio_pvp`, `importe`, factura A25/X25), `terceros_clientes`.
  - Transporte: `transportes` (importe por albarán y agencia), `transp_fra_transporte`.
  - Entradas de fruta: `basculas_pesadas` (tipo_dcmto 25), `ent_prov_cab_alb`
    (tipo_entrada 21; 23 = precalibrado).
- **Trampas conocidas:** fechas basura (1899, 2905, 9999); tablas gemelas `_hist`;
  el reparto de fruta entre elaboraciones es NOMINAL (65 cajas a cada una) y no cuadra
  por lote; los consumos de material son por fórmula prorrateada, no recuento;
  `agri_produc_mo` no lleva horas; las tablas de comisiones (`fact_comision_*`) se
  quedaron en 2018.
- **Informes:** 1.208 ficheros Crystal Reports en `\\192.168.1.10\lri\GCONTA\listlaser`.
  No se pueden leer por dentro (cifrados); hay que exportarlos desde el visor del ERP.

### 1.2 Herramienta web (app en Supabase)

- **Proyecto:** `lhbmxmdjyrbhjcsazhqi.supabase.co`. Código en este repositorio
  (React + Vite, `src/`), migraciones en `supabase/migrations/`.
- **Tamaño (11-09-2026):** 87 tablas, 16 vistas, 3 buckets de ficheros
  (`logistics-templates` con los CMR, `partes-archivos`, `rrhh-docs`).
- **Acceso:** lectura y escritura por el MCP de Supabase y por scripts con la clave de
  servicio del `.env` (ignorado por git). Puedo aplicar migraciones y desplegar funciones.
- **Funciones en la nube (`supabase/functions/`):** analizar-contador-agua,
  analizar-datos-manuales-parte, analizar-lote-excel, analizar-parte,
  analizar-parte-ocr, backfill-campo, chat, cierre-mensual, embeddings,
  enviar-comunicacion, importar-asistencia, informe-semanal, parse-excel,
  reparto-pasadas, ventas-mercadona-semanal, vigia-negocio, vigilante. Librerías
  comunes en `_shared/`.
- **Tareas programadas en la base (pg_cron):** reparto de pasadas cada hora 5-20h
  (:10), refresco de clasificación cada hora (:20), vigilante 11:45, vigía de negocio
  12:15 (+ reintento 12:40), informe semanal lunes 10:00 (+ 10:25), ventas Mercadona
  lunes 8:00 (+ 8:25), cierre mensual día 1 a las 5:45 (+ 6:15). Horas UTC.
- **Tablas clave para costes y ventas:** `stock_consumibles` (precios, enlazados al
  ERP y actualizados los lunes), `ventas_categoria_clientes_ajustes` (comisión y
  transporte por cliente, base del precio real en Comercial), `trabajadores`
  (coste hora), `entradas_bascula`, `erp_palet` (espejo de palets del ERP),
  `productos_catalogo` (978 fichas CMV), vista `clasificacion_lote` (calibrador).

### 1.3 Tareas de Windows en el portátil (nombre "Lasarte - …")

| Hora | Tarea | Script |
|---|---|---|
| 06:00 | Foto palets ERP | `scripts/capturar-palets-erp.mjs` |
| 06:00 | Receptor calibrador (respaldo) | receptor LAN |
| 06:15 | Leer buzón | lectura IMAP del Gmail |
| 07:40 | Sincronizar ERP | `scripts/tarea-diaria-erp.cmd` (entradas + palets + aviso) |
| 08:45 | Precios consumibles | `scripts/sincronizar-precios-consumibles-erp.mjs` (lunes) |
| 09:00 | Informe rendimiento diario | |
| 09:30 | Asistencia del reloj | |
| 21:30 | Copia de seguridad | 72 tablas, restauración probada |
| 22:15 | Reiniciar receptor | |
| 22:45 | Ensayo restauración | |

Logs en `outputs/log-*.txt` (UTF-8).

### 1.4 Carpetas compartidas del servidor `\\192.168.1.10` (solo lectura)

El explorador no las lista; se entra por ruta directa.

- **CompartidaOficina:** `DEPARTAMENTO CALIDAD\SUDAFRICA 25-26` (protocolo de descarga,
  expedientes por camión, órdenes de carga Laadopdracht de Harrie Goesten),
  `SISTEMA RED` (sistema de calidad Mercadona, 13 anexos), `Pedidos\1 Transporte LST`
  (CMR por envío, hojas de ruta por cliente), REUNIONES, PODRIDO, IFS, PALETS.
- **Etiquetas:** `ESPECIFICACIONES DE PRODUCTOS\` (fichas 18-xxx por cliente: palet,
  caja, alveolo, sticker, seda, calibre, método LNxxx), `ETIQUETAS\` (Zebra .lbl y
  Word por cliente), `BD ETIQUETAS.xlsx`.
- **DptoControl:** metodología de costes 2016-2019 (FORFAIT GLOBAL CONSOLIDADO 1718,
  COSTE CONFECCIONES por producto, GASTOS FIJOS MENSUALES).
- **DatosOficina:** etiquetas, carteles de palet, plantillas, copias gdata001/gdata002.
- **Copias_dump:** volcados de la base del ERP. **lri:** el ERP.

### 1.5 Calibrador Compac Sizer

- Máquina en `192.168.1.209`. Base SizerResults leída con permiso (campaña cargada).
- Desde el 26-08 los informes de lote (Word) llegan por correo, no por red. El
  receptor LAN es respaldo. Detalle en `docs/COMO-ESCRIBIR-EL-LOTE-EN-EL-CALIBRADOR.md`.

### 1.6 Correo

- **Entrada:** buzón `lasartecitricos@gmail.com`, vía única de los informes del
  calibrador (Word, ZIP, Excel, .eml anidados). Lo lee la tarea de las 06:15.
- **Salida:** Resend desde `comunicaciones.lasartesat.com` (dominio verificado, DMARC).
  Correo diario 07:10 en HTML, informe semanal lunes 12:00 Madrid, ventas Mercadona
  lunes, vigía diario, cierre mensual.
- Los buzones `@lasartesat.es` son de Telefónica: solo ellos crean buzones.

### 1.7 Inteligencia artificial

- Chat de la app: OpenRouter (modelo gratuito) con Puter de respaldo.
- Lectura de partes en papel: Mistral OCR (~95 % de acierto).
- Descartado: cualquier API de pago para visión (decisión del dueño).

### 1.8 Repositorio y documentación

- `docs/SISTEMA_LASARTE.md` (mapa y roadmap), `docs/ERP_LR_INFORMATICA.md`,
  `docs/TRAZABILIDAD_REFUNDACION.md`, `docs/VIGIA_NEGOCIO.md`,
  `docs/CUADERNO-ENCARGADA.md`, `docs/VADIM_RAG_SYSTEM.md`, `docs/EXPORT_TEMPLATES_SPEC.md`.
- `scripts/` (85 ficheros): sincronizaciones con el ERP, informes, análisis reproducibles.
- `outputs/`: Excel y PDF entregados, CSV de correcciones, logs.
- Memoria del asistente: ~90 notas cargadas en cada sesión (reglas, decisiones, datos).

## 2. Lo que se sabe de la empresa

### Personas
- **Vadim**: construye la herramienta con IA; no es programador. Habla en términos de
  negocio.
- **José María (JM)**: el dueño; decide método y formato.
- **Juanvi**: ventas. **Raquel**: encargada (y control de calidad de importación).
- **Vanesa**: registra las elaboraciones en el ERP. **Francisco**: albaranes.
- **Jesús**: compras de material. **Eusebio**: diarios de calidad.
- Usuarios de la app: admin ve todo; ventas 5 secciones; operario lo básico.

### Campaña 2025/26 (cerrada el 28-08-2026)
- 967 lotes propios, pérdida 4,08 % (821 t / 412.617 €), Mercadona 38,22 % de la fruta.
- Mercadona: malla 3 y 5 kg en caja Logifruit 618 (52 cajas/palet); dos plataformas
  desde el 28-08 (la segunda, Madrid San Isidro: carga el día antes).
- Importación de Sudáfrica vía Uria Export y Harrie Goesten (~13,50 €/caja puesto).
  Entrada Navel SAF del 05-09-2026: 2.438 kg a 0,95 €/kg (el ERP la valora a 1,138 al
  consumirla; diferencia sin desglosar).

### Producción, medidas y reglas de datos
- Parte diario automático: nace con el primer lote, se le adjuntan los Word del
  calibrador y se analiza solo; solo "Validado" lo cierra una persona.
- Fuentes canónicas: `clasificacion_lote` (calibrador) y palets del ERP. El Word y
  las fotos de palets son respaldo.
- El calibrador pesa un 7,8 % más que la báscula (tara): no calcular aprovechamiento
  sobre la entrada.
- Reparto canónico de pasadas entre lotes en la base (desde 07-09-2026).
- Cierre automático de lotes al 97 % y dos días.
- Estándares de rendimiento por régimen de jornada; análisis por tipo de día.
- Sobrellenado de malla por pedido: tolerancias reales 200 → 100 g según el día.

### Costes y dinero
- Coste por producto (CMV): 978 fichas con coste propio; precio real Mercadona por
  semana (válido desde la semana 31/2026). Coste de personal: **9,00 €/h con Seguridad
  Social incluida** para todas las fichas de trabajador (Beatriz, 16-09-2026); antes 8 bruto
  + 35 %.
- Rentabilidad diaria por lote y destino.
- Suministros reales de facturas (luz, agua, gasoil) de dos campañas.
- Consumibles: precios actualizados los lunes desde el ERP (97 artículos enlazados);
  regla: un artículo sin precio se deja SIN PRECIO, nunca con el de otro.
- Comisión y transporte por cliente en Comercial → Ventas por categoría (Kolla 7 %).
- Hoja de costes por producto de la empresa (bloques fijos por kg: campo 0,1294,
  generales 0,0380, amortizaciones 0,0153, gasóleo/cera/postcosecha 0,0149,
  agua/energía 0,0052, media de salarios 0,0502).
- Producto nuevo "1 manto Lasarte 8 kg alveolo": ficha completa y ejemplo real Kolla
  en `outputs/Coste_Confeccion_Producto_Nuevo_8kg_45p_2026-09-09.xlsx`. Plantilla diaria
  para repetir el coste del palet: `outputs/Plantilla_Parte_Diario_Manto_8kg.xlsx`
  (se rellena Datos del día; la hoja Coste palet sale sola para JM).

### Trazabilidad
- Cadena productor → entrada → confección → palet → venta → euro, leída del ERP;
  solo el 57 % de los kilos paletizados tiene elaboración registrada.
- Productores canónicos con alias; precalibrado que vuelve a su finca.

### Vigilancia del sistema
- Rastro de ejecuciones, vigilante diario, copia diaria con restauración probada,
  13 reglas de negocio por excepción (vigía), cierre mensual.
- Toda función de correo "late" también cuando falla, y tiene reintento.

## 3. Reglas de trabajo dadas por Vadim y JM

1. **Hablar claro.** Cada fila de una hoja dice con palabras qué es y cómo se calcula,
   con la operación escrita. Nada de "neto", "queda", "… por kilo" sin decir de qué.
   No dar por hecho que se entiende.
2. **Leer todo antes de responder.** Antes de dar una cifra o decir que un dato no
   existe: ERP, app, carpetas del servidor, outputs y documentación. Nunca rellenar con
   un dato parecido; si no está, decir dónde se buscó y dejarlo SIN DATO.
3. Lo que Vadim dice que está mal desaparece de la hoja en la siguiente versión; no se
   queda "marcado en amarillo".
4. Horas de mano de obra: solo las reales que den Raquel o JM; nunca extrapoladas.
5. Cada dato se atribuye a quien lo dijo (un WhatsApp pegado con cabecera es de esa
   persona).
6. Cada cifra con su método y su fuente; si dos fuentes discrepan, se enseñan las dos
   con nombre (Resultado A / Resultado B) y por qué difieren.
7. Al ERP y al servidor solo se les lee.
8. Nada de API de pago para visión.
9. Null no es cero; todo conectado a sus consumidores; importaciones repetibles.
10. Formato para JM: la tabla de la hoja de costes de la empresa (Artículo / Q /
    Pcx ud. / Total / Fuente), vertical, con los totales al pie, sin notas largas.
11. En documentos, la razón social es Lasarte Cítricos S.L.; no se dice "Herramienta
    Lasarte".

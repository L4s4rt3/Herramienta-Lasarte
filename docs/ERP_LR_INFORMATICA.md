# El ERP de LR Informática — mapa, trampas y qué se puede aprovechar

**Estado: reconocimiento completo el 10-08-2026. Entradas de fruta ya sincronizando. Resto inventariado y sin empezar.**

## Regla dura

**Al ERP solo se le LEE.** Ni un `INSERT`, ni un `UPDATE`, ni un fichero de
`\\192.168.1.10\lri`, ni su configuración. Es software de un tercero bajo
mantenimiento: tocarlo puede costar una multa y el puesto de quien lo toque
(instrucción del usuario, 10-08-2026). Todo lo que hay documentado aquí se
obtuvo con `SELECT` y listados de carpetas.

## Qué es y dónde vive

ERP de **LR Informática** ("lri"). Módulos: **GSTOCKS** (Gestión de Almacenes) y
**GVENTAS** (Gestión de Ventas), más GCONTA y GAEAT.

- **No está instalado en local.** Se ejecuta desde el recurso compartido
  `\\192.168.1.10\lri\GCONTA\` (lanzadores `gaplicaciones.exe` /
  `gaplicaciones2.exe`, y `\lri\GMENU\menu.exe`). Es una aplicación **Delphi**,
  con los módulos como `.bpl` sueltos en `\GCONTA` y `\GCONTA\varios`.
- **Los datos están en MySQL 5.7.44**, en `192.168.1.10:3306`.
- **La conexión está en el registro de Windows**, puesta por el propio ERP:
  `HKCU\Software\LRInformatica\GSTOCKS` y `\GVENTAS` → `TipoBD=MYSQL`, `Host`,
  `Puerto`, `Usuario` (**root**), `Password`, `PathTemp=c:\gdata\`.
  Conviene pedirle a LR Informática un usuario de solo lectura en vez de usar
  root para esto.
- `C:\gdata` es solo carpeta de trabajo local (`Emp001`/`Emp002` = empresas, con
  subcarpetas por usuario, normalmente vacías).
- **Informes = Crystal Reports**: 1.208 ficheros `.rpt` en
  `\\192.168.1.10\lri\GCONTA\listlaser`, que pinta `crpeview.exe`.

### Las cinco empresas

`sistema.empresa_datos_generales` mapea empresa → base de datos:

| Base de datos | Empresa | Estado |
|---|---|---|
| **`gdata001`** | **LASARTE CÍTRICOS S.L.** (B14800304) | **la viva** — 4,8 GB, 23,6 M filas, ~1.450 tablas |
| `gdatac01` / `gdatam01` | LASARTE S.A.T. (V14800304) | ejercicio y copia de 2023, aún se escriben |
| `gdata002` | LASARTE EXPORT S.L. (B91774943) | activa, pequeña |
| `gdatapru` | empresa de prueba | — |

Todo lo de aquí se refiere a **`gdata001`**.

## Las cinco trampas

1. **Fechas basura.** Hay registros con fecha de 1899, 2501, 2905 y 9999.
   Cualquier consulta filtra por rango o los totales salen absurdos.
2. **Tablas gemelas `_hist`.** Casi todas tienen su histórico aparte
   (`fact_albaranes_hist`, `palets_cab_hist`, `ent_prov_lineas_hist`…).
   Consultar solo la principal pierde pasado.
3. **`tipo_documento` / `tipo_contable` / `tipo_entrada`.** Distinguen facturas
   de abonos, entradas de fruta de compras de material, etc. Hay que
   descodificarlos antes de sumar nada. Las entradas de fruta son
   `basculas_pesadas.tipo_dcmto = 25` y `ent_prov_cab_alb.tipo_entrada = 21`
   (el 23 es precalibrado).
4. **La identidad de una entrada es `num_entrada`, NO el lote.** Ver más abajo.
5. **Campos reutilizados.** `compras_contratos_cab.provincia_carga` guarda en
   realidad el código de **finca**. No fiarse de los nombres de columna.

## Entradas de fruta — en marcha

Es lo único ya implementado: `scripts/sincronizar-entradas-erp.mjs`. El detalle
operativo (de dónde sale cada campo, cómo se ejecuta, cómo se programa) está en
[scripts/README-sincronizacion-erp.md](../scripts/README-sincronizacion-erp.md).
Resumen:

- Tabla madre `basculas_pesadas` con `tipo_dcmto = 25`. 16.459 pesadas de 2009 a
  hoy, **cero sin lote y cero sin proveedor**.
- **`basculas_pesadas.lote` ya trae el código en el formato de la Herramienta**
  (`26081001` = AAMMDD + nº de pesada). No hay que reconstruirlo, que es lo que
  hace el importador manual del Excel y por lo que se desvía.
- Primera sincronización real el 10-08-2026: 3 altas y 23 entradas completadas
  (85 campos que estaban vacíos). Idempotente.

### Por qué `num_entrada` y no el lote

El importador manual deduce el código de lote por el **orden** del listado y
puede desviarse. Caso real: el 31-07-2026 la app guardó `26073101`/`26073102`
donde el ERP dice `26073102`/`26073103` — misma fruta, mismas entradas 16957 y
16958, mismos kilos, solo el código distinto. Deduplicando por lote, esa entrada
habría entrado otra vez y habría **duplicado 2.142 kg**.

Por eso la identidad es `num_entrada` (nº de documento del ERP, que no cambia) y
el lote queda como respaldo. Cuando el script detecta un desvío lo lista aparte
y **no toca nada**: renombrar un lote arrastra `palets_dia` (123 filas solo para
esos dos códigos), `pasada_box_lineas`, `lotes_dia`, `lote_clasificacion`,
`podrido_inspecciones` y `camara_externa_camiones`.

## El coste de recolección no está en la base de datos

Buscado a fondo y **no aparece**: ni en las 54 tablas con `num_entrada`, ni en
las 24 con `num_proveedor`, ni en las 21 con `lote`, ni en `stock_mvtos` (sus
columnas `gastos`, `costo_transporte` y `costo_comisiones` están a cero), ni en
cabecera o líneas de contrato, ni en los 1.208 informes `.rpt` (leídos en ASCII
y en UTF-16: ninguno contiene la palabra "recolec"). Lo calcula el módulo Delphi
`prepartogastosfrutalasarte.bpl` ("reparto de gastos de fruta") al imprimir.

Lo que sí está es el **contrato de recolección**:
`compras_contratos_cab.tipo_contrato = 8` (el **9** es el de compra). Su precio
es la tarifa pactada — 0,085 €/kg para casi todos —, pero lo que se imputa de
verdad va de 0,084 a 0,110 según la finca.

Pesa **1.431.884 €** en 718 de las 1.324 entradas de la campaña, así que hasta
que se resuelva se guarda como **estimación en columnas propias**
(`coste_recoleccion_estimado`, `recol_kg_estimado`,
`recol_estimacion_origen`) y `coste_recoleccion` queda a NULL, reservada al
importe real. Backtest del estimador: acierta la tarifa exacta el **93,7%** de
las veces, error acumulado del **0,47%**.

**Pendiente:** preguntar a LR Informática qué alimenta la columna
"Coste Recolec." del listado de entradas de fruta.

## Inventario: qué se puede aprovechar

### Trazabilidad palet ↔ productor — SE PUEDE

El dictamen de julio de 2026 ("imposible") se limitaba al **Excel** de palets,
que no trae lote. La base de datos sí la cierra:

- `palets_cab`: **42.184 palets** de la campaña 2025/26, **20.531 t**, con SSCC,
  cajas, kilos netos y brutos, línea de producción. Solo 60 sin lote (0,14%).
- Pero ese lote es de **CONFECCIÓN** (formato `NN+AAMMDD`, p. ej. `01260807`),
  **no** el de entrada (`AAMMDDNN`, p. ej. `26081001`). Ojo: los dos tienen 8
  dígitos, el contador está en extremos opuestos.
- El puente es **`agri_produc_mp_pt`** (12 M filas): `lote_mp` = lote de
  entrada, `lote_pt` = lote de confección, más `calibre`, `kilos_mp_en_pt` y
  `kilos_pt`. **Está indexada por `lote_mp` y por `lote_pt`**, así que la
  consulta tarda ~11 ms pese al volumen.

Verificado con un caso real — lote de confección `01260807`, 92 palets, 28.839 kg:

| Lote de entrada | Productor | Finca | Kg aportados |
|---|---|---|---|
| `22070401` | Eurotecnica Agraria | EL RINCON | 13.855 |
| `26051408` | Berrynest SAT | COLOMBO - GG | 9.419 |

#### Cómo se consulta bien (tres filtros que no son opcionales)

1. **`tipo_registro = 0`.** Es la fruta. El `1` son los conceptos de envase y
   mano de obra (`ENV`, `MOZ`, `MEC`, `SEG`, `PREPOST`, `TRI`, `ADM`…), cientos
   de filas por lote y todas con 0 kg.
2. **`lote_mp REGEXP '^[0-9]{8}$'`.** Descarta esos mismos códigos de concepto.
3. **La columna de kilos es `kilos_mp_en_pt`, NO `kilos_netos_mp_en_pt`.** Es el
   error que más cuesta ver: con la columna "netos" medio catálogo parece no
   tener origen (daba un 34,9% de cobertura) cuando en realidad lo tiene (56,9%).
   Las dos columnas conviven con valores muy distintos en la misma fila.

En `palets_cab` hay además **registros que no son palets**: 755 con estado 4 y
0 cajas (822 t) y 728 con estado 0 y 0 cajas (772 t), alguno de 67.400 kg en
"1 caja". Se filtran con `num_cajas > 0`.

#### Cobertura real — medida, no estimada

Campaña 2025/26, 1.160 lotes de confección con palets de verdad
(**18.936.016 kg** paletizados):

| Cobertura (kg de materia prima / kg paletizados) | Lotes |
|---|---|
| Sin ningún origen | **521** (8.912.340 kg) |
| Menos del 50% | 48 |
| 50–90% | 53 |
| 90–110% | 227 |
| Más del 110% (normal: hay merma, entra más de lo que sale) | 311 |

**Kilos con origen atribuido: 10.766.041 de 18.936.016 — un 56,9%.**

Los 521 sin origen **no son un problema de filtro: no existe ni una fila** en
`agri_produc_mp_pt` con ese `lote_pt`. Comprobado en tres de los más grandes.
El día 21-04-2026, por ejemplo, hay 6 elaboraciones registradas que producen los
lotes `00260421` a `04260421` y `06260421`, pero los 54 palets del lote
`05260421` (28.859 kg) no tienen elaboración detrás. Y el prefijo `NN` del lote
de confección **no** es el número de elaboración: la número 5 de ese día produjo
el lote `00260421`.

Conclusión: la cadena funciona donde el ERP registró la elaboración, y
aproximadamente la mitad de los kilos paletizados vienen de palets cuyo lote de
confección no tiene elaboración registrada. Cualquier vista que se construya con
esto tiene que decir **dos cifras** —kilos trazados y kilos totales— y no repartir
nunca lo que no se sabe.

**Pendiente de preguntar en planta** (lo registra Vanesa): por qué hay palets
cuyo lote de confección no tiene elaboración detrás.

#### El reparto por palet es proporcional, no un hecho

El ERP dice **qué lotes de entrada alimentaron un lote de confección**, no de qué
entrada salió cada palet concreto. Así que "cuántos kilos de este productor
fueron a este cliente" sale de prorratear los kilos del palet según el peso de
cada origen en su lote de confección. Es una estimación, y hay que etiquetarla
como tal: lo que sí es un hecho es **la lista de productores** que participaron
en ese palet.

#### Nunca con JOINs contra fact_albaranes

La primera versión del sincronizador unía `palets_cab` con `fact_albaranes` por
`num_dcmto` + `tipo_documento` y tardó **más de un cuarto de hora** cargando el
servidor del ERP en horario de trabajo, hasta que se abortó.
`fact_albaranes` **no tiene ningún índice que empiece por `num_dcmto`**: el útil
es `(tipo_documento, serie_dcmto, num_dcmto, tipo_contable)`, y sin la serie
MySQL recorre media tabla por cada palet. La versión buena hace tres consultas
indexadas por separado y cruza en memoria: **la campaña entera en 4 segundos**.
Regla general para este ERP: antes de unir dos tablas grandes, mirar
`information_schema.statistics` y usar el **prefijo completo** del índice.

#### Esto invalida el volteo del código de palet como origen

`src/lib/origenConfeccion.ts` (julio de 2026) diagnosticó bien el problema —el
`NN` del programa de palets es el lote de **confección** del día— y montó un
mecanismo de "candidatos probables" dejando escrito que *"el vínculo exacto
confección↔volcado solo lo tiene el ERP (no hay export hoy)"*. Ese export ya
existe: es `erp_confeccion_origen`.

Y con los 1.277 pares reales se puede medir lo que antes solo se intuía. La
librería asume que el volteo `NN+AAMMDD → AAMMDD+NN` **sí** acierta cuando la
fruta se vuelca el día que entra ("lo normal de septiembre a mayo"). Los datos
dicen que no:

| Medición sobre 639 lotes de confección con origen conocido | Resultado |
|---|---|
| El volteo coincide con un origen real | **0** (de 1.277 pares) |
| El volteo cae en una entrada que **existe** en `entradas_bascula` | 414 (**64,8%**) |
| …y de esas, cuántas **no** son origen real de esa fruta | **414, todas** |
| …de las cuales caen en una re-entrada de precalibrado | 89 |

Es decir: dos de cada tres veces el volteo produce un código que existe, la
comprobación de coherencia lo acepta y la atribución es **falsa**. El tercio
restante (225) no existe como entrada y ahí la app ya detecta la incoherencia y
ofrece candidatos.

**Conclusión: la autoridad para el origen de un palet pasa a ser
`erp_confeccion_origen`, no el volteo del código.** El volteo solo vale para
leer un código impreso, nunca para decir de quién es la fruta.

**Ya está cambiado en la app** (10-08-2026). `useTrazabilidadLote` pregunta
primero al ERP (`fetchTrazabilidadErp`, buscando el código en sus dos lecturas:
canónico de entrada y formato de palet) y solo si el ERP no sabe nada calcula los
"candidatos probables" de `origenConfeccion.ts`. La agregación vive en
`src/lib/trazabilidadErp.ts` (pura, con tests) y se pinta en
`src/components/TrazabilidadErpCard.tsx`, en las dos direcciones: si el código es
un lote de confección, de qué entradas y productores viene; si es una entrada, en
qué se confeccionó y a qué clientes fue. Los kilos y euros repartidos salen
etiquetados como estimados, y la cobertura se muestra siempre como dos cifras.

### Cómo se casa la identidad del productor (comprobado en las dos bases)

Para agrupar por productor **no se compara ni un nombre**. El puente es el
**código de lote**, que es `UNIQUE` en `entradas_bascula` y es el mismo que el
ERP guarda en `agri_produc_mp_pt.lote_mp`. Y la identidad canónica ya está
resuelta en la app: `entradas_bascula.productor_id`, que rellenan los triggers
de [productores canónicos].

Medido el 10-08-2026 sobre los datos reales:

| | |
|---|---|
| Lotes que el ERP usa como origen | 775 |
| …que están en `entradas_bascula` | **765** (98,7%) |
| …de esos, con `productor_id` resuelto | **765 — todos** |
| Kilos con productor identificado | 10.761.117 de 10.766.041 (**99,95%**) |
| Lotes que no están en la app | 10 (de campañas anteriores, como `22070401`) |

Y el contraste de identidades entre las dos bases, que es lo que hace seguro el
agrupamiento:

| | |
|---|---|
| Proveedores del ERP contrastados | 43 |
| Productores de la app contrastados | 43 |
| Un proveedor del ERP partido en varios de la app | **0** |
| Varios proveedores del ERP juntados en uno de la app | **0** |

Es una biyección: la identidad canónica de la app no contradice a la del ERP en
ningún caso. Por eso `useDestinoFrutaProductor` filtra por `productor_id`
(traducido de la `productorKey` del dossier, que es `id:<uuid>`) y cruza por
código de lote, sin tocar nombres en ningún punto.

### Estado: cargado

`scripts/sincronizar-trazabilidad-palet-erp.mjs` volcó la campaña 2025/26 el
10-08-2026: **40.641 palets** (39.629 vendidos, 1.012 sin albarán) y **1.277
pares confección-entrada**, en `erp_palet` y `erp_confeccion_origen`.

### Costes por elaboración

Esos mismos códigos `ENV`/`MOZ` más `agri_produc_mo` (1,9 M filas: agente,
horas, importe, tipo de actividad) dan envases y mano de obra por documento de
producción. Es el coste real de confección, justo lo que le falta al CMV.

### Contratos

100 de compra (tipo 9) y 100 de recolección (tipo 8) en la campaña, 47
productores. Precios pactados por productor, finca y artículo: permite
contrastar lo pactado contra lo pagado.

### Elaboraciones

`agri_produc_cabecera`: 1.162 en la campaña, con hora de inicio, hora de fin y
usuario (3 usuarios). Cruzable con las pasadas de la Herramienta.

### Ventas (GVENTAS) — mapeado, y cierra la cadena hasta el euro

**`fact_lin_fruta` NO son las ventas.** Tiene 56.192 líneas pero solo 585 t y le
falta el calibre en 55.898 de ellas: es un detalle de otra cosa. Las ventas están
en **`fact_lin_alb`** (180.601 líneas), con `fact_albaranes` (67.409) y
`fact_facturas` (31.922) como cabeceras.

Lo importante: **`palets_cab` apunta a la LÍNEA exacta de venta**, no solo al
albarán — `(tipo_documento_vta, serie_dcmto_vta, num_dcmto_vta, num_linea_vta)`.
Y esa línea de `fact_lin_alb` lleva `importe`, `num_factura`, `fecha_factura` y
`num_cliente`. Con eso la cadena queda completa:

**productor → entrada → lote de confección → palet → línea de venta → € facturados.**

Campaña 2025/26: **~14,7 M€ facturados** en 9.217 líneas, contra 8,9 M€ de compra
de fruta. Cargados **13.736.224 €** repartidos en 39.022 palets.

Tres cosas que hay que saber:

1. **El importe está a cero hasta que se factura.** Los albaranes de Mercadona se
   valoran al facturar, así que el mes en curso sale casi todo a cero. Eso es
   NULL ("todavía no"), nunca 0.
2. **Una línea de venta cubre varios palets**: su importe se reparte entre ellos
   **por kilos**. Copiarlo en cada palet inflaría las ventas.
3. **Ese reparto cuadra al kilo en el 79,4% de las líneas** (6.128 de 7.722):
   los kilos de los palets de la línea coinciden con sus `unidades_1`. En el
   resto hay desajuste y el reparto es aproximado.

Ojo con los índices: `fact_lin_alb` sí tiene
`(tipo_documento, serie_dcmto, num_dcmto, num_linea, …)`, así que hay que
consultarlo por el prefijo completo, como `fact_albaranes`.

Resultado, con la cadena entera y los kilos prorrateados (euros **estimados**):

| Productor | € | kg | €/kg |
|---|---|---|---|
| ECILIMP AGRO S.L. | 824.515 | 1.001.375 | 0,823 |
| Gesfrumed SL | 775.087 | 994.048 | 0,780 |
| EL ESPARRAGAL S.A. | 672.413 | 817.324 | 0,823 |
| Camba S.C. | 621.577 | 757.986 | 0,820 |
| Covidesa | 410.634 | 441.886 | 0,929 |

### Lo que NO sirve

- **Superficie de parcelas**: 1.177 de 1.232 la tienen a cero. Nada de
  rendimiento por hectárea.
- **Calidad de materia prima del ERP**: 537 encuestas y la última de julio de
  2025. Módulo abandonado; la fuente de calidad siguen siendo los diarios de
  Eusebio.

## Cómo consultar

Hay que estar dentro de la red de la oficina (`192.168.1.x`). Las credenciales
de MySQL se leen del registro, donde ya las guarda el ERP, así que no se copian
a ningún fichero. La clave de servicio de Supabase va en el `.env` del repo, que
está en `.gitignore`.

```bash
node scripts/sincronizar-entradas-erp.mjs --solo-erp
```

Las Edge Functions (nube) **no alcanzan** `192.168.1.10`: cualquier
automatización necesita correr en un equipo de la LAN, con el Programador de
tareas de Windows y a una hora muerta para no cargar el servidor del ERP
mientras la gente trabaja.

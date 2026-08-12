# Sincronización de entradas de fruta desde el ERP

`sincronizar-entradas-erp.mjs` trae las entradas de fruta del ERP de LR Informática
(GSTOCK/GVENTAS) a la tabla `entradas_bascula`, sin pasar por el Excel.

## Qué hace y qué no

- Contra el ERP **solo ejecuta `SELECT`**. No escribe en MySQL ni toca ningún
  fichero de `\\192.168.1.10\lri`.
- **Solo da de alta entradas nuevas.** La identidad es **`num_entrada`** (el nº
  de documento del ERP, que no cambia), con `lote` como respaldo.
- **Nunca identifica por lote a secas.** El importador manual reconstruye el
  código de lote por el orden del listado y puede desviarse: el 31-07-2026 la
  app guardó `26073101`/`26073102` donde el ERP dice `26073102`/`26073103`, con
  las mismas entradas 16957 y 16958. Identificando por lote, esa entrada habría
  entrado otra vez y habría duplicado 2.142 kg. Cuando detecta un desvío lo
  lista aparte y no toca nada: renombrar un lote es decisión humana, porque ese
  código lo referencian trazabilidad, cámaras y partes.
- **Nunca modifica una entrada existente.** Si el ERP tiene valores distintos de
  los que ya hay en la app, la diferencia se vuelca a
  `outputs/correcciones-entradas-erp-<fecha>.csv` para revisarla a mano.

## De dónde sale cada campo

| Campo en `entradas_bascula` | Origen en el ERP (`gdata001`) |
| --- | --- |
| `fecha`, `lote`, `kg_entrada` | `basculas_pesadas` (filtrando `tipo_dcmto = 25`) |
| `num_entrada` | `basculas_pesadas.num_dcmto_relacionado` |
| `agricultor` | `terceros_proveedores.razon_social` |
| `finca` | `agricultura_fincas.denominacion` (por `zona_origen` + proveedor) |
| `parcela` | `agricultura_parcelas.denominacion` |
| `articulo` | `articulo_general.denominacion` |
| `envases`, `tipo_envase` | `basculas_pesadas_envases` (+ `articulo_general`) |
| `precio_compra_kg`, `importe_compra` | `ent_prov_lin_imp` |
| `importe_transporte` | `ent_prov_cab_alb.imp_transporte` |
| `certificada` | `ent_prov_cab_alb.certificada` |
| `certificado_ggn` | `terceros_proveedores_otros.certificado_GGAP`, solo si viene certificada |

El código de lote **no se reconstruye**: `basculas_pesadas.lote` ya lo trae, en
las 16.459 pesadas y sin un solo hueco.

## Recolección: estimada, nunca inventada en el sitio del coste real

El coste real de recolección **no está almacenado en el ERP**. Se buscó a fondo:
las 54 tablas con `num_entrada`, las 24 con `num_proveedor`, las 21 con `lote`,
`stock_mvtos` (gastos, transportes y comisiones están a cero), cabecera y líneas
de contrato, y los 1.208 informes `.rpt` leídos en ASCII y UTF-16 — ninguno
contiene siquiera la palabra "recolec". Lo calcula el módulo Delphi de reparto
de gastos (`prepartogastosfrutalasarte.bpl`) al imprimir el listado.

Lo que sí está en el ERP es el **contrato de recolección**:
`compras_contratos_cab.tipo_contrato = 8` (el 9 es el de compra). Su precio es la
tarifa pactada — 0,085 €/kg para casi todos —, pero lo que se imputa de verdad
es lo que costó recolectar esa finca, y va de 0,084 a 0,110 según cuál.

Por eso el script **estima**, en columnas aparte:

| Columna | Qué es |
| --- | --- |
| `coste_recoleccion` | El coste REAL. Se queda a **NULL** hasta que se pueda leer. |
| `coste_recoleccion_estimado` | La estimación. **Nunca** se escribe en la anterior. |
| `recol_kg_estimado` | La tarifa €/kg usada. |
| `recol_estimacion_origen` | De dónde sale: `finca_articulo`, `finca`, `agricultor` o `contrato_erp`. |

La tarifa es la última observada para la misma finca y variedad; si no hay
historial se baja a finca, luego a agricultor, y como último recurso al precio
del contrato de recolección del ERP. Si no hay ninguna, se queda a NULL — nunca
a 0, que se leería como "no hubo coste".

**Fiabilidad medida.** Backtest sobre la campaña 2025/26 (718 entradas con coste
conocido, 655 con historial previo): acierta la tarifa exacta en el **93,7%** de
los casos, y el error acumulado es de **6.167 € sobre 1.310.137 €, un 0,47%**.

`comision_kg` e `importe_comision` también se quedan a NULL (aparecen en 17 de
1.324 entradas). `importe_total` se deja a NULL porque sumaría un importe real
con uno estimado.

## Uso

Requiere estar en la red de la oficina y tener en el entorno `SUPABASE_URL` y
`SUPABASE_SERVICE_ROLE_KEY` (la de servicio, no la anónima: la tabla tiene RLS y
la anónima no puede leerla). Las credenciales de MySQL se leen del registro de
Windows, donde ya las guarda el ERP, así que no hay que copiarlas a ningún sitio.

```bash
node scripts/sincronizar-entradas-erp.mjs --solo-erp     # ver el ERP, sin tocar Supabase
node scripts/sincronizar-entradas-erp.mjs                # simulación
node scripts/sincronizar-entradas-erp.mjs --aplicar      # dar de alta las nuevas
node scripts/sincronizar-entradas-erp.mjs --desde=2026-01-01 --hasta=2026-08-10 --aplicar
```

Sin `--desde` coge los últimos 30 días.

Para comprobar que la estimación de recolección se comporta (no toca el ERP ni
Supabase, va con datos de mentira):

```bash
node scripts/probar-estimacion-recoleccion.mjs
```

## El parte diario se deja hecho solo

`crear-parte-diario.mjs` rellena los campos que la máquina ya sabe, para que por
la mañana solo haya que copiar del papel lo que la máquina no puede saber.

Se rellenan tres campos:

| Campo | De dónde sale |
| --- | --- |
| `kg_produccion_calibrador` | suma de `calibrador_clasificacion` de las pasadas del día |
| `kg_mujeres_calibrador` | ídem, grupo MUJERES |
| `kg_inventario_anterior_sin_alta` | el inventario final del parte del día anterior |

Los dos primeros se comprobaron contra los partes ya cerrados del 3, 4, 5, 6 y 7
de agosto de 2026: coinciden **al kilo los cinco**.

### Los palets: se GENERA el Excel del GSTOCK y se sube

`kg_palets_brutos` no se escribe a mano en el parte. Se **genera el mismo Excel**
que se sacaba de la consulta de palets del GSTOCK (`generar-gstock-erp.mjs`), se
sube al parte, y `analizar-parte` lo lee con su lógica de siempre. Así no se
esquiva nada: el detalle de palets (cliente, producto, lote, cajas) que alimenta
`palets_dia`, los kg de Egipto y de campo, y la protección de campos manuales
siguen funcionando igual que cuando lo subía una persona.

Validado contra el Excel real del 7-ago: **225 filas, suma idéntica (87.478 kg) y
224 de 225 palets iguales** en Netos, Cajas, Cliente, Producto y Lote. La única
diferencia es un cliente que en el original estaba vacío porque el albarán se hizo
después.

Dos detalles que importan y no se ven:

- **No se filtra por `num_cajas`.** El GSTOCK no filtra; los palets a granel y los
  de campo van en box con `num_cajas = 0` (el 7-ago, 8 de 225 que valen 22.726 kg).
  `erp_palet` sí los filtra, y por eso daba 64.752 en vez de 87.478.
- **Los palets DESMONTADOS (`estado = 4`) también van.** Un palet que se desmonta
  va a industria o vuelve como precalibrado: se queda en `palets_cab` y al día
  siguiente se quita de stock. El Excel del 7-ago traía 223 normales + 2
  desmontados. Son los que llegan tarde y descuadran el día, así que el generador
  **avisa** cuando aparece uno de más de 10.000 kg (un palet físico no llega a eso).

**Lo que se intentó y salió mal, para no repetirlo**: escribir `kg_palets_brutos`
leyendo el ERP directamente empeora el |DSJ| medio de 4,66% a 13,39%, con días
imposibles (27-jul a −25,5%, más palets que producción). El Excel es una foto del
momento del cierre; el ERP sigue moviéndose después.

```bash
node scripts/probar-palets-gstock.mjs
```

**Lo que NO se rellena, a propósito.** `kg_podrido_calibrador_auto`: nuestra clase
"Podrido" suma 5.849 kg donde el parte contaba 207 el 3-ago. No entra en el DSJ
(es informativo, ver `src/lib/cascade.ts`), así que dejarlo a cero no descuadra
nada — y meter un número que no cuadra sí lo haría.

**Si no hay red de oficina** el parte se crea igual, sin los palets, y el correo
lo dice: hay que subir el Excel del GSTOCK a mano o relanzar la tarea. Nunca se
escribe un 0 como si fuera un dato.

**Nunca pisa trabajo humano.** Si el parte ya existe y no está en Borrador, no se
toca. Si está en Borrador, solo se rellenan los automáticos que sigan a cero.

**Repasa una semana, no solo ayer.** Si un día la tarea no llega a correr, ese
parte no se crearía nunca; y el arrastre del inventario solo se puede poner
cuando el día anterior está cerrado, que suele ser más tarde. Repasar los últimos
7 días arregla las dos cosas solo. En un día normal casi todo sale `sin-cambios`.

```bash
node scripts/crear-parte-diario.mjs                      # simulación, últimos 7 días
node scripts/crear-parte-diario.mjs --aplicar
node scripts/crear-parte-diario.mjs --fecha=2026-08-10 --aplicar   # un día suelto
```

## El alta de palets: la hora de cierre y lo que queda sin dar de alta

Dos números que hoy dependen de una persona, y que se pueden deducir de fotos
horarias del ERP (`erp_palets_foto`, cada hora de 06:00 a 00:00).

**La hora de cierre se deduce, no se pregunta.** Se mueve con el turno: en agosto
de 2026 terminan de dar de alta sobre las 13:00-13:10, y con horario normal serán
las 14:00 o las 15:00. Preguntarla obliga a que alguien avise cada vez que cambia;
la señal en los datos es más simple: a partir del cierre, los kilos del día dejan
de subir. Eso es lo que mira `detectarCierre` (`lib-cierre-alta.mjs`).

**El inventario sin dar de alta** hoy se pesa y se cuenta a mano. La idea es de
quienes lo hacen: si se mira el listado de palets al cerrar y otra vez a la mañana
siguiente, lo que ha crecido el día anterior es justo lo que quedó pendiente.

```
inventario sin alta (día D) = kg del día D visto al día siguiente
                            − kg del día D visto al cerrar D
```

Por eso cada pasada fotografía **ayer además de hoy**: por la mañana, lo que
interesa medir es cuánto ha crecido la víspera.

**Todavía NO se escribe en el parte.** El correo lo enseña junto al número que se
apunta a mano para poder compararlos unos días; hasta que no coincidan, el bueno
es el suyo. Mismo criterio que con la producción y las mujeres, que se validaron
contra 5 partes cerrados antes de darlas por buenas. Si falta cualquiera de las
dos fotos, se dice — no se rellena con una estimación.

```bash
node scripts/probar-cierre-alta.mjs
```

## Programarlo

Con el Programador de tareas de Windows, en un equipo de la oficina que esté
encendido, a una hora muerta (las 7:10, cuando ya llevan un rato dando de alta) para no cargar el servidor
del ERP mientras la gente trabaja.

`tarea-diaria-erp.cmd` encadena los tres pasos en este orden, que importa:
entradas → trazabilidad de palets → aviso. El aviso va el último porque cuenta lo
que han hecho los otros dos, y de paso deja el parte del día anterior listo.

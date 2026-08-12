# Receptor de informes del calibrador

`receptor-informes-calibrador.mjs` se queda escuchando en la red local y guarda
los informes que el Compac Sizer envía al cerrar cada lote.

## Por qué no se usa un servidor de correo normal

El Sizer es de 2019 y solo negocia **TLS 1.0**. Cualquier proveedor de correo
moderno exige **TLS 1.2** — comprobado contra Resend el 10-08-2026: rechaza
TLS 1.0 y 1.1, acepta solo 1.2. La conexión moría en el saludo cifrado, antes
del login, y por eso el Sizer descartaba el usuario y la contraseña cada vez que
se configuraban: guardaba lo que no podía validar.

En vez de pelear con eso, el correo no sale del edificio. Dentro de la LAN no
hace falta ni cifrado ni contraseña, así que desaparecen de un plumazo el TLS,
el login que no persistía, la API key, el proveedor de correo y el problema de
"quién lee luego ese buzón".

## Qué hace

- Guarda cada adjunto en `outputs/calibrador/<AAAA-MM-DD>/`, con la marca de
  tiempo delante del nombre para que no se pisen entre lotes.
- Escribe una línea por correo en `outputs/calibrador/registro.jsonl` con
  remitente, asunto, ficheros y tamaños.
- Si no puede interpretar un correo, lo guarda crudo en `.eml` y **lo acepta
  igual**: rechazarlo haría que el Sizer lo diese por perdido y ese informe no
  vuelve.
- Solo acepta conexiones de `192.168.1.x` (el cortafuegos ya filtra; esto es el
  segundo cinturón).
- Interpreta lo que reconoce: los **.docx** del calibrador se parsean y se suben
  (solo si cuadran consigo mismos), y los **.zip** del export SQL del Sizer se
  importan enteros.

## El buzón: cualquier Excel que llegue por correo

Desde el 12-08-2026, un **.xlsx/.csv** adjunto se clasifica con el MISMO
clasificador que usa la página `/importar` (13 tipos, 23 tests) y se importa si
es de los que la app ya importa sin preguntar.

Para qué sirve: hoy, meter un Excel en la Herramienta obliga a entrar en
`/importar` y soltarlo. Si nadie se acuerda, no entra — el registro de cámaras
externas llevaba 78 días sin actualizarse y nadie se había enterado. Ahora basta
con **reenviar el correo** a la dirección del receptor.

**Se respeta la distinción de la app**: solo se importa solo lo que la
`ZonaAutomatica` importaría sola. Lo que pide confirmación humana (ventas,
Mercadona, báscula, stock, merma) se guarda y se avisa, pero no se escribe a
espaldas de nadie.

| Estado | Qué significa |
| --- | --- |
| `importado` | Ha entrado en la Herramienta. Hoy: registros de cámara externa. |
| `esperando` | Reconocido, pero necesita que alguien lo confirme en `/importar`. |
| `no-reconocido` | El clasificador no supo qué es. Se guarda igual. |

Cada correo deja su resultado en `registro.jsonl` (campo `buzon`), y **el aviso
diario de las 6:30 lo resume**: lo que entró solo, lo que espera y lo que no se
reconoció. Un archivo esperando sube a REVISAR, porque recibirlo no sirve de
nada si nadie lo abre.

El clasificador es TypeScript y vive en `src/`, así que el receptor lo llama en
un subproceso con `vite-node` (`scripts/importar-adjunto.ts`). Cuesta un segundo
por archivo, pero evita tener aquí una copia de las reglas de reconocimiento que
se quedaría atrás a la primera.

**Los otros cuatro tipos automáticos** (informe de lote, de producción, palets de
campaña e informe de productor) se reconocen pero todavía no se importan desde
aquí: su escritura vive en hooks de React con reglas propias (reparación de
`lotes_dia`, backfill de palets) que no se pueden reutilizar desde un script sin
copiarlas. Un importador a medias haría daño en silencio, así que de momento se
avisa. Los informes de lote llegan igualmente por su vía de siempre (.docx y el
export SQL).

## Cómo se arranca

Solo hay que hacerlo a mano si se quiere ver la actividad en pantalla:

```bash
node scripts/receptor-informes-calibrador.mjs
```

Con `--puerto=2525` se puede probar sin permisos especiales, y con `--carpeta=`
se cambia dónde guarda.

### Se levanta solo

Tarea programada **"Lasarte - Receptor calibrador"**: cada 10 minutos, de 06:00
a 14:00 (el horario de la planta). Llama a `arrancar-receptor.vbs`, que a su vez
lanza `arrancar-receptor.cmd` **sin ventana** — si no, saldría una consola
parpadeando toda la mañana.

Funciona por la vía tonta y por eso es fiable: si el receptor ya está vivo, el
puerto 25 está ocupado, el intento muere solo en menos de un segundo y no pasa
nada. Si no está —ventana cerrada, portátil reiniciado, se cayó— arranca y se
queda. Además el Programador de tareas no lanza una segunda copia mientras la
anterior siga viva.

Se puede seguir abriendo la ventana a mano cuando se quiera mirar: el vigilante
no molesta si ya hay uno corriendo.

**Y el aviso diario de las 6:30 comprueba que el receptor responde.** Si está
caído, el correo lo dice. Sin eso, un receptor muerto no se notaría hasta echar
de menos los datos semanas después.

## Qué poner en el Sizer

Configuración → Imprimir/Enviar por Email Reportes de Lote:

| Campo | Valor |
|---|---|
| Dirección de Servidor | la IP del equipo que ejecuta esto (hoy `192.168.1.237`) |
| Puerto | `25` |
| Desactivar SSL/TLS | **marcado** |
| Requiere Login | **desmarcado** |
| Email de Remitente | cualquiera |

Y marcar "Enviar por email cuando termine Lote" solo en **Totales de Calidad
Clase Tamaño Por Producto**, que es el informe que se usa. Sale un correo por
lote: marcar más informes es ruido.

## Requisitos en el equipo receptor

- Red de Windows como **Privada** (en Pública se bloquea todo lo entrante).
- Regla de cortafuegos de entrada para TCP 25 desde `192.168.1.0/24`.
- IP estable: si la reparte el DHCP, conviene una reserva en el router. Si
  cambia, el Sizer seguirá enviando a la dirección vieja y no llegará nada
  **sin ningún error visible**.
- Encendido y sin suspender cuando se cierran lotes. Ojo con la tapa: en
  equipos con suspensión moderna (S0) los programas de escritorio se duermen
  aunque la red siga viva.

## El registro es la red de seguridad

Lo peor de estos montajes no es que fallen, es que fallen callados. Si un día
dejan de llegar informes, `registro.jsonl` dice cuál fue el último y cuándo.

Y la segunda red es la **conciliación del aviso de las 6:30**: cruza los lotes
de confección de ayer (según el ERP) contra los informes del calibrador que
llegaron. Si no llegó ninguno, alarma con instrucciones; si faltan algunos y el
origen está registrado, los **nombra** para recuperarlos con el botón "Reporte
por email" del visor, que está probado y tarda un clic por lote. El envío
automático del Sizer ha demostrado ser frágil (visor cerrado, casillas que se
desmarcan, envíos que no se disparan): esta conciliación hace que un informe
perdido se note a la mañana siguiente, no semanas después.

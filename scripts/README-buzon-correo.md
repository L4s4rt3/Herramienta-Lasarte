# El buzón de correo: los informes del Sizer entran solos

**Desde el 26-08-2026 el correo es la VÍA ÚNICA**: el Sizer manda cada informe
de lote por Gmail al cerrar el lote, y este lector lo mete en la Herramienta.
El receptor de la LAN (`192.168.1.237:25`) sigue escuchando **solo como
respaldo** por si algún día hubiera que volver a la vía antigua.

| | Cómo llega | Estado |
| --- | --- | --- |
| **Buzón de correo (Gmail)** | el Sizer envía desde `lasartecitricos@gmail.com` al buzón configurado en el `.env`; se lee por IMAP cada 30 min | **la vía única** |
| **Receptor de la LAN** | quien sea de la oficina manda a `192.168.1.237:25` | respaldo |

## Qué procesa cada correo

- **`.docx` de lote del Sizer** (`SizeGradeQualityTotalsByProduct.docx`): se
  parsea, se valida que cuadre consigo mismo y se sube a `calibrador_informe` +
  `calibrador_clasificacion` (batch_id NEGATIVO = provisional; el volcado SQL,
  si algún día llega, manda). Además alimenta el **parte diario EN VIVO**
  (`lib-parte-en-vivo.mjs`): el primer lote del día crea el parte, cada informe
  se adjunta al parte con su código de lote, y se regeneran GSTOCK + informes y
  se analiza — como lo haría una persona.
- **`.zip` del export SQL** (lotes.csv + clasificacion.csv): se importa entero.
- **`.xlsx`/`.csv`**: el mismo clasificador que `/importar` (13 tipos). Lo que
  la app importaría sola entra solo; lo que pide confirmación se guarda y se
  avisa en el correo diario. Nunca se escribe nada a espaldas de nadie.
- **Correos reenviados desde Outlook**: el reenvío adjunta el CORREO ORIGINAL
  entero (un `.eml` sin nombre); el lector lo detecta, entra dentro y procesa
  el informe igual. Un `.docx` sin extensión se reconoce por su firma.

## El buzón es COMPARTIDO: solo se tocan los correos del calibrador

El lector **solo mira los correos de los remitentes de `BUZON_REMITENTES`**
(por defecto, el emisor del Sizer). Los demás correos NI SE DESCARGAN, ni se
guardan, ni se marcan: el correo personal queda exactamente como estaba.

## La cola es un marcador de UID, no el "sin leer"

Gmail puede dejar como leídos los envíos de la propia cuenta, así que la cola
por "sin leer" perdería informes. El lector guarda hasta qué UID ha procesado
(`outputs/buzon/estado.json`) y sigue desde ahí. Un correo cuya subida falle
NO avanza el marcador: se reintenta solo en la siguiente pasada.

## Qué hay que poner en el `.env`

```
BUZON_IMAP_HOST=imap.gmail.com
BUZON_IMAP_PUERTO=993
BUZON_IMAP_USUARIO=...            # la cuenta que recibe los informes del Sizer
BUZON_IMAP_PASSWORD=...           # contraseña de APLICACION (16 letras)
BUZON_IMAP_CARPETA=INBOX
BUZON_REMITENTES=lasartecitricos@gmail.com,soporte@lasartesat.es
```

Gmail exige **contraseña de aplicación** (la normal no vale para IMAP desde
2025): se crea en myaccount.google.com/apppasswords con la verificación en dos
pasos activa. El `.env` no se sube al repositorio (`.gitignore`).

OJO: los buzones `@lasartesat.es` son de Telefónica (Microsoft 365) — el IMAP
básico está muerto ahí, por eso NO se lee soporte@ directamente.

## Qué hace y qué no

- Guarda cada adjunto en `outputs/buzon/<fecha>/` **antes** de procesarlo: si
  algo falla después, el fichero ya está a salvo.
- **No borra correos. No responde. No manda nada.** Solo lee, procesa y marca
  como leído lo suyo (la marca es cosmética; la cola de verdad es el UID).
- Deja una línea por correo en `outputs/buzon/registro.jsonl`, su rastro en
  `sistema_ejecuciones`/`sistema_latidos` (lo vigilan `/datos/fuentes` y el
  vigilante), y el correo de las 07:10 avisa de los informes que llegaron y no
  están en la base (mirando este registro Y el del receptor).

## Comprobarlo

```bash
node scripts/leer-buzon-correo.mjs --probar
```

Solo conecta y cuenta. Sin tocar nada.

```bash
node scripts/leer-buzon-correo.mjs --aplicar
```

Lo de verdad: es lo que ejecuta la tarea programada. Las pruebas offline del
reparto de adjuntos (eml anidado, firma DOCX) están en
`scripts/probar-leer-buzon.mjs`.

## La tarea

`Lasarte - Leer buzon`, cada 30 minutos de 06:15 a 22:15, sin ventana. Sin
credenciales deja el latido en "aviso" y no hace nada más — no rompe nada por
estar a medias.

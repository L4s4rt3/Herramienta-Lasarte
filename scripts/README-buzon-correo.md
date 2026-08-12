# El buzón: mandar un informe por correo y que entre solo

Hay **dos buzones**, y hacen lo mismo por caminos distintos.

| | Cómo llega | Para qué |
| --- | --- | --- |
| **Receptor de la LAN** | el Sizer (o cualquiera de la oficina) manda a `192.168.1.237:25` | los informes del calibrador |
| **Buzón de correo** | llega a `soporte@lasartesat.es` y se lee por IMAP | cualquier informe, desde donde sea |

Los dos usan **el mismo clasificador** que la página `/importar` (13 tipos, 23
tests). Lo que la app importaría sola, entra sola; lo que pide confirmación
humana se guarda y se avisa en el correo diario. Nunca se escribe nada a
espaldas de nadie.

## Por qué por IMAP y no reenviando

El receptor de la LAN solo escucha en `192.168.1.x`. Un correo mandado desde
casa, desde el móvil o desde un proveedor externo **no le llega**, y exponerlo a
internet no se va a hacer. Leyendo el buzón de verdad basta con que el informe
llegue a `soporte@lasartesat.es`, venga de donde venga.

## Qué hay que poner en el `.env`

```
BUZON_IMAP_HOST=imap.ionos.es
BUZON_IMAP_PUERTO=993
BUZON_IMAP_USUARIO=soporte@lasartesat.es
BUZON_IMAP_PASSWORD=...
BUZON_IMAP_CARPETA=INBOX
```

El servidor depende de quién lleve el correo:

| Proveedor | `BUZON_IMAP_HOST` |
| --- | --- |
| IONOS | `imap.ionos.es` |
| Google Workspace / Gmail | `imap.gmail.com` |
| Microsoft 365 / Outlook | `outlook.office365.com` |

**Si la cuenta tiene verificación en dos pasos**, la contraseña normal no vale:
hay que crear una *contraseña de aplicación* desde el panel del proveedor. Es una
contraseña larga que solo sirve para esto y se puede revocar sola.

El `.env` **no se sube al repositorio** (está en `.gitignore`), así que la
contraseña se queda en el portátil.

## Si prefieres no dar acceso a todo el buzón

Crea una carpeta en el correo (por ejemplo `Herramienta`), pon una regla que
mueva ahí lo que quieras importar, y cambia:

```
BUZON_IMAP_CARPETA=Herramienta
```

Así solo se lee esa carpeta y el resto del buzón no se toca.

## Qué hace y qué no

- Mira **solo los correos sin leer**. Al procesar uno lo marca como leído, así
  que nunca se importa dos veces y en el buzón se ve qué ha pasado.
- Guarda cada adjunto en `outputs/buzon/<fecha>/` **antes** de nada: si algo
  falla después, el fichero ya está a salvo.
- **No borra correos. No responde. No manda nada.** Solo lee y marca como leído.
- Deja una línea por correo en `outputs/buzon/registro.jsonl`.

## Comprobarlo

```bash
node scripts/leer-buzon-correo.mjs --probar
```

Solo conecta y dice cuántos correos sin leer hay. No baja nada ni marca nada.

```bash
node scripts/leer-buzon-correo.mjs
```

Baja los adjuntos y los clasifica, pero **no importa nada** y no marca los
correos: se puede repetir las veces que haga falta.

```bash
node scripts/leer-buzon-correo.mjs --aplicar
```

Lo de verdad. Es lo que ejecuta la tarea programada cada 30 minutos.

## La tarea

`Lasarte - Leer buzon`, cada 30 minutos de 06:15 a 22:15, sin ventana. Mientras
no estén las credenciales deja un aviso en `outputs/log-buzon.txt` y no hace nada
más — no rompe nada por estar a medias.

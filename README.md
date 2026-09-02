# Herramienta Lasarte

Sistema interno de Lasarte Cítricos S.L.: producción, trazabilidad, calidad,
comercial, RR. HH. y las automatizaciones que traen los datos del ERP y del
calibrador. Este README dice **cómo se arranca, cómo se despliega y de qué
piezas está hecho**. El *qué* y el *por qué* de cada pieza está en
[docs/SISTEMA_LASARTE.md](docs/SISTEMA_LASARTE.md) (auditoría y hoja de ruta).

## Las cuatro piezas

| Pieza | Dónde corre | Cómo se despliega |
|---|---|---|
| **App** (React + Vite + TypeScript, `src/`) | Vercel (`controlproduccion.vercel.app`) | Vercel construye solo al hacer push a `main` (`vercel.json`). |
| **Base de datos** (Postgres, `supabase/migrations/`) | Supabase, proyecto `lhbmxmdjyrbhjcsazhqi` | Ver *Migraciones*. |
| **Edge functions** (Deno, `supabase/functions/`) | Supabase | `supabase functions deploy <nombre>` (ver abajo). |
| **Tareas del portátil** (Node, `scripts/`) | El portátil de la oficina, Programador de tareas de Windows | `scripts/arreglar-tareas.ps1` (ver abajo). |

Todo lo que solo habla con Supabase corre en Supabase (pg_cron → edge). Lo que
necesita la LAN (el MySQL del ERP, el receptor del calibrador) corre en el
portátil. La regla de la casa está en `docs/SISTEMA_LASARTE.md` §6.

## Desarrollo local

```bash
npm install
```

Copia `.env.example` a `.env` y rellena al menos las `VITE_*`. Las demás
variables las usan los scripts del portátil y las edge functions: el fichero
explica cuál lee cada quién.

```bash
npm run dev
```

Verificación (es lo mismo que corre el CI en cada push, `.github/workflows/ci.yml`):

```bash
npm run lint
npm run typecheck
npm test
```

`npm test` corre en dos proyectos de vitest: la lógica pura (`src/lib`) en
node y los componentes en jsdom; la suite entera tarda unos 2-3 minutos. Las
edge functions las comprueba `deno check` en el CI (en el portátil no hay Deno;
no lo instales dentro del repo: ensucia `node_modules`).

## Migraciones (base de datos)

La base es la verdad y el repo tiene que cuadrar con ella:

1. Una migración se **aplica** con el MCP de Supabase (`apply_migration`) o con
   `supabase db push`. Nunca se crea el fichero con un número inventado.
2. El fichero del repo se nombra con la **versión que quedó registrada** en
   `supabase_migrations.schema_migrations`: `<version>_<nombre>.sql`.
3. Comprobación: `supabase migration list --linked` debe mostrar las dos
   columnas rellenas en TODAS las filas. Si no cuadra, `supabase migration
   repair`. El 02-09-2026 se descubrió con 12 descuadres; ahí está la
   explicación completa (`docs/SISTEMA_LASARTE.md`, runbook de copias).
4. Vistas nuevas: **siempre** `create view ... with (security_invoker = on)`.
   Sin eso una vista corre como su dueño y salta la RLS. Y nada de `grant ... to
   anon`: la app nunca lee datos sin sesión.

Copia de seguridad: cada noche a las 21:30 desde el portátil a
`outputs/copias/` (OneDrive la sube). Ensayo de restauración trimestral
automático. Runbook de desastre en `docs/SISTEMA_LASARTE.md`.

## Edge functions y trabajos programados en Supabase

```bash
supabase login
supabase functions deploy <nombre>      # p. ej. vigilante, vigia-negocio, informe-semanal
```

Los secretos (`supabase secrets set` o el panel) están inventariados en
`.env.example`, sección 3. Toda función de correo **late** en `sistema_latidos`
al terminar y en su catch (`_shared/latido.ts`); si añades una, dala de alta en
`_shared/saludTrabajos.ts` o nadie sabrá si murió.

Trabajos de `pg_cron` (todos con reintento 25-30 min después; horas UTC, sin
cambio de horario):

| Job | Cron | Función |
|---|---|---|
| `informe-semanal-lunes` (+ reintento) | `0 10 * * 1` | `informe-semanal` |
| `ventas-mercadona-lunes` (+ reintento) | `0 8 * * 1` | `ventas-mercadona-semanal` |
| `vigilante-diario` | `45 11 * * *` | `vigilante` |
| `vigia-negocio-diario` (+ reintento) | `15 12 * * *` | `vigia-negocio` |
| `cierre-mensual-dia1` (+ reintento) | `45 5 1 * *` | `cierre-mensual` |

Un cron en verde **no** prueba que la función corriera (`pg_net` encola y dice
`succeeded` pase lo que pase): lo que lo prueba es el latido.

## Tareas del portátil de la oficina

Corren como tareas programadas de Windows, todas lanzadas por su `.vbs` (sin
ventana) que llama a su `.cmd` (log en `outputs/`). `.cmd` y `.vbs` van
**siempre en CRLF** (`.gitattributes`); en LF, `cmd.exe` ejecuta basura.

| Tarea | Hora | Qué hace |
|---|---|---|
| Lasarte - Sincronizar ERP | 07:10, reintento cada 20 min hasta 12:10 | `tarea-diaria-erp.cmd`: entradas, trazabilidad y precalibrado del ERP, GSTOCK, parte del día, informes del calibrador, análisis, cuadre y correo. |
| Lasarte - Receptor calibrador | cada 5 min, 06:00-22:00 | Receptor SMTP LAN del Sizer (respaldo; la vía real es el buzón). |
| Lasarte - Leer buzon | cada 30 min | Importa los informes que el Sizer manda a `lasartecitricos@gmail.com`. |
| Lasarte - Foto palets ERP | cada hora | Foto del total de palets del día (hora de cierre e inventario). |
| Lasarte - Informe rendimiento diario | 09:00 | `scripts/informe-produccion/correo-diario.cmd`. |
| Lasarte - Copia de seguridad | 21:30 | Todas las tablas + espejo del storage a `outputs/copias/`. |
| Lasarte - Ensayo restauracion | día 2 de ene/abr/jul/oct, 22:45 | Restaura la última copia en un esquema aparte y comprueba que cuadra. |

Para dejarlas como tienen que estar (batería, reactivación, reintentos; crea la
del ensayo si no existe):

```bash
powershell -ExecutionPolicy Bypass -File scripts\arreglar-tareas.ps1
```

Estado de todo esto sin entrar en ningún sitio: **Datos → Estado de las
fuentes** en la app, y el vigilante avisa por correo cuando algo no late.

Documentación de cada subsistema: `scripts/README-sincronizacion-erp.md`,
`scripts/README-receptor-calibrador.md`, `scripts/README-buzon-correo.md`,
`docs/ERP_LR_INFORMATICA.md` (el ERP: **prohibido modificar nada**),
`docs/VIGIA_NEGOCIO.md`, `docs/CUADERNO-ENCARGADA.md`.

## Higiene

- `.env` no se versiona; `.env.example` es la plantilla y el inventario.
- `outputs/` y `tmp/` no se versionan: datos, logs y copias. El **código** de
  producción no vive ahí nunca (el correo de rendimiento estuvo en `tmp/` hasta
  el 02-09-2026 y casi se pierde).
- Las tablas de Supabase se leen con `fetchAllRows` (PostgREST recorta a 1.000
  filas en silencio; un `.limit(100000)` no protege).
- El cliente de Supabase es el tipado (`supabase`); `supabaseLibre` solo para
  nombres de tabla que llegan en una variable.

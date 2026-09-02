# Sistema interno de Lasarte — auditoría y hoja de ruta

> Documento vivo. Última revisión: **14 de agosto de 2026**.
> Objetivo: que todo lo construido deje de ser un conjunto de herramientas sueltas y se convierta en un sistema interno coherente, robusto y utilizable sin conocimientos técnicos — que funcione semanas sin intervención y **no dependa de ninguna persona concreta para mantenerse**.

---

## 1. Propósito

Lasarte Cítricos S.L. gestiona hoy buena parte de su operación con el ERP de LR Informática, Excel, papel y conocimiento en cabezas concretas. La herramienta interna ya centraliza producción, trazabilidad, calidad, comercial y parte de RR. HH. Este documento fija:

1. Qué hay construido y su estado **real** (no el ideal).
2. De qué depende cada pieza y dónde están los riesgos.
3. Qué sigue siendo manual y merece automatizarse.
4. En qué orden atacarlo y cómo mediremos que compensa.

El criterio de éxito no es técnico: es que **José María y el equipo puedan usarlo, entenderlo y confiar en él** sin necesitar a quien lo programó.

---

## 2. Qué hay construido y en qué estado

Leyenda: ✅ en producción y estable · 🟡 funciona pero con riesgos o cabos sueltos · 🔴 pendiente o aplazado.

### 2.1 Entradas y producción (el núcleo)

| Pieza | Estado | Notas |
|---|---|---|
| Fuentes canónicas: calibrador (`clasificacion_lote`) + ERP (vista `palets`) | ✅ | Regla del 13-08. El Word y `palets_dia` quedan como respaldo. |
| Receptor SMTP de informes del calibrador | 🟡 | **RESPALDO desde el 26-08**: el Sizer ya NO envía por LAN — los informes llegan por correo (buzón Gmail). El receptor sigue escuchando por si esa vía volviera, con reintento cada 5 min y rastro; los avisos ya no dicen "se pierden informes" cuando cae, porque no se pierde nada. |
| Parte diario automático | ✅ | Se crea solo con producción y mujeres. DSJ ~4,66 %; el 9,21 % de 138 días es trabajo por apuntar, no fruta perdida. |
| Parte diario EN VIVO | ✅ | Desde 26-08: el parte nace con el PRIMER lote del día — cada informe DOCX que llega (buzón cada 30 min, receptor al instante) se adjunta al parte con su código de lote (como hacía la persona) y se remonta GSTOCK + informes + análisis (la misma edge function del botón). La tarea de las 07:10 queda de red de seguridad. Lib: `scripts/lib-parte-en-vivo.mjs`. |
| Manuales estimados según histórico | ✅ | Desde 17-08: si nadie mete el papel en un día entero, el sistema completa el parte (inventario por las fotos del ERP — validado a 8 kg del real —, reciclado/podrido por mediana 14d, industria 0 = lo habitual, bateas jamás). Todo marcado en `campos_estimados`, contado en el correo y con banner en el parte; **el dato real gana y retira la estimación sola**. |
| OCR de partes EMBASUR (Mistral OCR ~95 %) | ✅ | Integrado 24-jul. Validación con checksum desglose↔palets. |
| Import unificado `/importar` | ✅ | Clasificador try-parse con 23 tests, zona automática, 5 tarjetas de confirmación. |
| Buzón de correo para importar | ✅ | Reenviar un Excel al receptor lo clasifica e importa si es de los automáticos. |
| Ciclo de vida del lote (cierre automático ≥97 % + 2 días) | ✅ | 785 lotes / 17.233 t cerrados en la primera pasada; cámaras conciliadas; productores auto-creados por trigger. |
| Trazabilidad (refundación 04-08) | ✅ | Regla de oro: el derrame no cierra lotes. Banco dorado de fixtures `campana2026`. Doc: `docs/TRAZABILIDAD_REFUNDACION.md`. |
| Merma y podrido | ✅ | Pérdida de campaña 3,74 % (739.936 kg / 368.585 €). Podrido manual es pre-calibrador (decisión del dueño 06-08). Tasa de cámara 0,0466 %/día. |
| Precalibrado conectado a productores | 🟡 | Vía `agri_produc_mp_pt` del ERP. Cobertura 27 % (límite físico: lo apartado no siempre se pesa). |
| Reparto de pasadas multi-lote | 🟡 | 114 pasadas (8,9 % de la campaña) atribuyen todo al primer lote; la vía para las 77 pendientes es la regla de `conciliacionKg`. |
| Parte con origen calibrador | ✅ | Migración `20260814072803_parte_origen_calibrador` aplicada y scripts commiteados (ago-2026). |

### 2.2 Calidad

| Pieza | Estado | Notas |
|---|---|---|
| Import de diarios de calidad (Eusebio) | ✅ | Formatos .doc HTML UTF-16/UTF-8 y .docx con casillas ☑. El .doc no entra por `/importar` (rechazo explícito, a propósito). |
| Generación determinista de comentarios e informes (v4) | ✅ | Sin LLM: variantes por semilla del lote, respeta observación/acción manual del técnico. |
| Contraste calidad ↔ aprovechamiento por productor | ✅ | En `/mercadona`. |

### 2.3 Comercial y económico

| Pieza | Estado | Notas |
|---|---|---|
| Rentabilidad diaria (`/economico/rentabilidad`) | ✅ | Metodología v5 validada; primer informe entregado 05-08. **Fix bandeja catálogo-vs-Mercadona sin commitear.** |
| Import mensual de ventas | ✅ | Reparte primera/segunda por método; MA→Mercadona. Sigue necesitando que alguien lo lance cada mes. |
| Precios Mercadona por semana | ✅ | Los fiables son de la semana 31/2026 en adelante (tarifa nueva). |
| Coste por producto (CMV) | 🟡 | 978 fichas con coste propio. El Informe PRODUCTO ya se genera y sube solo (14-08) y desde el 17-08 lleva el **empaque habitual relleno** (RPC `empaques_habituales`): los kg/bulto se deducen sin carga manual. Queda: catálogo del Sizer para productos NUEVOS (bloqueado por credenciales `SIZER_*`) y los costes/precios de ficha, que son del dueño. |
| Venta en consignación | ✅ | Entendida y documentada: albarán sin factura ≠ albarán olvidado. |
| Gastos varios (facturas no-fruta, ~3 M€) | 🔴 | Aplazado: duda del precio por millar de Ecoenvases sin confirmar y riesgo de doble conteo con consumos. |
| Ventas vs. facturas Mercadona | 🔴 | Son idénticas; decisión de unificar pendiente. |

### 2.4 RR. HH.

| Pieza | Estado | Notas |
|---|---|---|
| Asistencia (volcado semanal) | ✅ | Se carga los lunes por semanas completas; la semana en curso vacía es normal, no avería. |
| Páginas de plantilla, ausencias, vacaciones, amonestaciones, nóminas, comunicaciones | 🟡 | Construidas (tablas del 30-07). **Nivel de adopción real por confirmar** — es el área con más distancia entre lo construido y lo usado. |

### 2.5 Automatizaciones y comunicación

| Pieza | Estado | Notas |
|---|---|---|
| Informe semanal automático (lunes 12:00) | ✅ | pg_cron → función edge; contenido pactado con el dueño (sin euros), con merma y stock. |
| Ventas Mercadona semanales (lunes 10:00) | ✅ | Desde 19-08: correo con kg/cajas/palets de la semana ISO cerrada + comparación con la anterior. Función edge `ventas-mercadona-semanal` (pg_cron), lee `erp_palet` (cliente MERCADONA S.A.) — **corre en Supabase, no en el portátil**. Misma fuente que la pestaña Expediciones de /mercadona. Destinatarios en el secreto `VENTAS_MERCADONA_PARA` (por defecto soporte@). |
| Aviso diario del ERP | 🟡 | Detecta informes que llegaron y no entraron en la base. Desde 14-08 llega **en HTML legible** (lo urgente arriba, tablas de verdad; antes era texto plano que los clientes de correo destrozaban). **Sigue corriendo en el PC de Luis** (Fase 2). |
| Buzón del calibrador (Gmail) | ✅ | **Reactivado 18-08**: Tomra configuró el auto-envío del Sizer contra `lasartecitricos@gmail.com` (SMTP con contraseña de aplicación) y el lector IMAP importa lo que llegue — informes de lote DOCX (mismo tratamiento que el receptor: parsear, validar que cuadra, subir), exports SQL y Excel reconocidos. Un correo cuya subida falle se queda SIN marcar como leído y se reintenta solo, y el correo de las 07:10 vigila los fallos de subida de AMBOS registros (buzón y receptor). **Desde el 26-08 esta es la vía ÚNICA**: el Sizer ya no envía por LAN. |
| Correo saliente (Resend) | ✅ | Dominio comunicaciones.lasartesat.com verificado, DMARC puesto. |
| Chat con IA | 🟡 | Cadena OpenRouter (gratis) → Puter. Proveedores gratuitos = fiabilidad limitada por diseño. |
| Auto-envío del propio calibrador | 🔴 | Falla por STARTTLS y está apagado; parte de incidencia enviado a Compac, sin respuesta. |
| Vigilante (Supabase, 13:45) | ✅ | Desde 14-08: avisa por correo si los trabajos del portátil dejan de dar señales. Es la primera pieza que NO depende del portátil. |
| Copia de seguridad diaria (21:30) | ✅ | Desde 14-08: todas las tablas + espejo del storage a `outputs/copias/` (OneDrive la sube a la nube). Verificada releyéndose; restauración probada de verdad. Runbook en §Fase 1. |

### 2.6 Plataforma e infraestructura

- **Frontend**: Vite + React, 52 páginas, 7 secciones / 25 entradas de menú (rediseño 13-08, URLs estables con redirecciones).
- **Backend**: Supabase — ~95 migraciones, RLS, 12 funciones edge, pg_cron, storage (2.859 CMRs en `logistics-templates`).
- **Roles**: admin ve todo; ventas (Juanvi) 5 secciones; operario lo básico. Modo económico (ocultar €) pendiente.
- **Calidad de código**: typecheck en verde (regla: mantenerlo); ~95 `any` crónicos aceptados; 23 tests del clasificador + banco dorado de trazabilidad.
- **Reglas técnicas vigentes**: `fetchAllRows` en todo SELECT no acotado (PostgREST recorta a 1.000 en silencio); null ≠ 0; estados derivados, no guardados; imports idempotentes.

---

## 3. Dependencias y riesgos — lo que impide que esto viva solo

Ordenados por gravedad:

1. **El PC de Luis (y la LAN) es un punto único de fallo.** En él corren: el receptor SMTP del calibrador, las tareas programadas de Windows (aviso diario ERP, foto de palets, lectura del buzón) y la lectura del MySQL del ERP. Si ese equipo se apaga, se estropea o Luis no está, el flujo diario de datos **se para en silencio**.
2. **No existe un panel de salud.** Hoy solo Luis puede saber si "todo ha corrido". Nadie más tiene forma de distinguir "no hay datos porque no hubo producción" de "no hay datos porque algo se rompió".
3. **Backups sin verificar ni documentar.** Supabase tiene copias propias, pero nunca hemos probado una restauración ni existe un export periódico nuestro. El ERP es de LR Informática y está fuera de nuestro alcance (prohibido tocar).
4. **Conocimiento no transferido.** Peculiaridades del ERP (estado=4 = palets desmontados), credenciales del calibrador, reglas de negocio (consignación, podrido pre-calibrador, semanas de tarifa)… Mucho está en este repo y en docs, pero **no hay un runbook para no técnicos**.
5. **Adopción sin medir.** No sabemos qué páginas se usan y cuáles no. Construir sobre lo que nadie abre es el desperdicio más caro.
6. **Trabajo sin commitear** se acumula a veces (fix de rentabilidad, scripts de hoy): riesgo de perderlo o de que producción y repo diverjan.

---

## 4. Procesos que siguen siendo manuales

| Proceso | Quién lo hace hoy | Automatizable |
|---|---|---|
| Import mensual de ventas (Excel) | Luis | Parcial: llega por correo → buzón podría tratarlo como los diarios. |
| Informe PRODUCTO → CMV | Nadie (automático desde 14/17-08) | HECHO: se genera del calibrador, sube al parte y lleva el empaque habitual. Resto: catálogo del Sizer (credenciales) para productos nuevos. |
| Análisis ad hoc para dirección (tipo stock S33-S34) | Luis con scripts | Parcial: convertir los recurrentes en páginas o informes automáticos. |
| Revisión de partes con DSJ ~100 % (sin analizar) | Nadie de forma sistemática | Sí: lista de trabajo visible + aviso, en vez de descubrirlo tarde. |
| Contadores de agua (foto → apunte) | Operario + revisión | Ya existe OCR (`analizar-contador-agua`); falta cerrar el circuito de avisos si falta la foto. |
| Gastos varios / facturas no-fruta | Nadie (aplazado) | Sí, cuando se resuelva la duda Ecoenvases. |
| Vigilar que las automatizaciones corren | Luis | Sí: es exactamente la Fase 1. |

---

## 5. Hoja de ruta

No se trata de construir "el sistema definitivo" de golpe: cada fase entrega algo que se pone en producción, se comprueba que se usa, y se mejora. El orden responde a una idea: **primero que no se caiga, luego que no dependa de nadie, luego que cualquiera lo use, y por último que lo cuente todo.**

### Fase 1 — Observabilidad: que el sistema diga cómo está *(la piedra angular)*

- ✅ **HECHO 14-08** — Rastro central en la base: `sistema_ejecuciones` (histórico, una fila por ejecución) y `sistema_latidos` (último estado por trabajo, el receptor late cada 5 min). Escriben los 4 trabajos del portátil vía `scripts/lib-registro-ejecuciones.mjs` — que nunca rompe el trabajo si Supabase no responde.
- ✅ **HECHO 14-08** — Tarjeta **"Trabajos automáticos: ¿están corriendo?"** en `/datos/fuentes`, encima del estado de las fuentes: semáforo por trabajo con el estado contado en palabras y el "qué hacer" cuando toca. Lógica en `_shared/saludTrabajos.ts` (13 tests), compartida con el vigilante para que pantalla y correo no se contradigan.
- ✅ **HECHO 14-08** — El **vigilante**: edge function + pg_cron (`vigilante-diario`, 13:45 Madrid, después del último reintento de la tarea diaria). Corre en Supabase, FUERA del portátil: si la tarea de las 07:10 no corrió o el receptor no late, manda un correo en lenguaje llano con los pasos. Cuando todo va bien, calla (el correo del día ya es el de las 07:10). Se limpia solo el histórico (90 días).
- ✅ **HECHO 14-08** — **Copia de seguridad propia con restauración probada.** Cada noche (21:30, tarea «Lasarte - Copia de seguridad») se vuelcan TODAS las tablas a `outputs/copias/<fecha>/` (NDJSON comprimido + manifiesto con recuentos y huellas) y el espejo incremental del storage (CMRs y archivos de partes); OneDrive lo sube todo a la nube — segunda ubicación sin infraestructura. La copia **se verifica releyéndose entera** y rota sola (14 diarias + 1 mensual perpetua). Primera prueba real de restauración PASADA el 14-08: 72 tablas, 659.920 filas restauradas en el esquema de ensayo, todos los recuentos exactos. La copia también late en `/datos/fuentes` y la vigila el vigilante.

*Criterio de hecho: José María puede saber si el sistema está bien sin preguntar a nadie.*
*Nota de estreno: la tarea diaria registra desde su próxima ejecución (07:10) y el receptor desde su próximo reinicio — hasta entonces salen como "sin estrenar", que a propósito no alarma a nadie.*

- ✅ **HECHO 31-08** — **Vigía de NEGOCIO** (edge `vigia-negocio`, diario 14:15) y **cierre mensual** (edge `cierre-mensual`, día 1): el vigilante mira si los trabajos corren; el vigía mira lo que CUENTAN los datos — sobrellenado de malla, camiones SAF sin cuadrar con su Laadbon, dinero parado, fruta parada, mermas fuera de banda, papel sin meter, días rojos de rendimiento y días de calibrado sin detalle. Solo escribe cuando hay algo nuevo (lunes, resumen de pendientes). Reglas y umbrales en `_shared/vigiaNegocio.ts` (30 tests); documentación completa en `docs/VIGIA_NEGOCIO.md`. El primer día en vivo reprodujo solo los dos hallazgos que costó días encontrar a mano: los 297 kg/día de sobrellenado y los 1.790 € de más del alta del camión SAF 1.

- ✅ **HECHO 02-09** — **Auditoría de robustez y sus arreglos** (verificados en producción):
  - *Seguridad*: las vistas `palets`, `productor_lote`, `palets_dia_cerrado`, `clasificacion_lote` y los agregados se leían **sin iniciar sesión** con la anon key (corrían como su dueño y saltaban la RLS). Ahora llevan `security_invoker` y `anon` no tiene ningún privilegio en `public` (ni por defecto para lo nuevo). `saf_camiones` solo la escribe admin. Migración `20260902085430`.
  - *Historial de migraciones* cuadrado con el repo (ver el runbook de abajo).
  - *El correo diario de rendimiento* sale de `tmp/` (fuera de git) a `scripts/informe-produccion/`, entra en `arreglar-tareas.ps1` y en el catálogo de salud junto con el ensayo de restauración: antes latían y nadie los miraba.
  - *El vigilante ya no es un punto ciego*: late también cuando falla, cuenta su propio error del día anterior y el vigía de negocio comprueba a las 14:15 que haya dado señal hoy (y avisa si no). Un fallo de envío es `error`, no `aviso`.
  - *CI* (`.github/workflows/ci.yml`): lint + typecheck + los 122 ficheros de test en cada push, y `deno check` de las edge functions. La suite pasa de >10 min a ~3 en el portátil (la lógica pura corre en node, sin jsdom).
  - *Tipado real*: fuera los 48 `supabase as unknown as SupabaseClient<any>`; el cliente tipado destapó un insert de bajas laborales sin `user_id` que no podía entrar. Las tablas con nombre variable usan `supabaseLibre` (client.ts), a propósito y visible.
  - *Semana ISO única* en `_shared/semanaIso.ts` (antes tres copias iguales que decidían qué semana manda el correo del lunes), con tests del borde de año.
  - *PartDetail*: ningún `{ data }` sin `error`; el motivo de un fallo de subida va al toast, no a la consola.
- ✅ **HECHO 02-09 (tarde)** — **Automatizaciones de la auditoría**:
  - *Reintento* para los tres cron de correo que no lo tenían (ventas Mercadona 10:25, vigía 14:40, cierre mensual 08:15 del día 1; migración `20260902093957`). Los tres son idempotentes.
  - *Ensayo de restauración programado*: tarea «Lasarte - Ensayo restauracion», el día 2 de enero/abril/julio/octubre a las 22:45, con latido `prueba-restauracion` vigilado (100/130 días). `arreglar-tareas.ps1` la crea si no existe.
  - *Informes del calibrador sin subir*: la tarea de las 07:10 los reintenta ella misma (solo los pendientes, con el fichero que anotó el buzón o el receptor) antes de fabricar los informes del parte. El correo ya no le pide a nadie que ejecute `subir-informes-calibrador.mjs`.
  - *Correcciones ERP ↔ app*: de un CSV diario que nadie abría a la tabla `erp_correcciones` (foto actual, con `detectada_en`), regla `correccion-erp` del vigía (un estado por lote) y posibilidad de ACEPTAR una diferencia conocida (p. ej. importación por neto vs báscula) desde la app.
  - *Estimaciones del parte*: al guardar, un campo con otro valor deja de ser estimado al momento; y el banner tiene el botón «El papel ya está metido: quitar las marcas» para el caso valor real = valor estimado (industria 0), que la comparación no distinguía y exigía SQL.
  - *Pantalla Datos → Importación SAF* (`/datos/saf`, admin): alta y edición del Laadbon de cada camión con €/kg puesto y cuadre contra el alta del ERP (misma cuenta que el vigía), más las discrepancias ERP ↔ app con «Aceptar» / «Volver a vigilar». Era el último dato del flujo SAF que se tecleaba en SQL.

#### Copias y restauración: el runbook

- **Dónde están.** `outputs/copias/<fecha>/` (tablas, una carpeta por día) y `outputs/copias/archivos/` (espejo del storage). Como `outputs/` vive dentro de OneDrive, todo está también en la nube de OneDrive: que muera el portátil no pierde ninguna copia.
- **Cómo saber que funcionan.** Sin hacer nada: la fila "Copia de seguridad diaria" de Datos → Estado de las fuentes, y el vigilante avisa por correo si lleva 2 días sin correr.
- **Ensayo de restauración** (recomendado 1 vez por trimestre, o tras cambios grandes de esquema): `node scripts/restaurar-copia.mjs` — carga la última copia entera en un esquema aparte, compara recuentos y huellas, y lo limpia. Éxito = "todas cuadran".
- **Desastre de verdad** (proyecto de Supabase perdido): crear proyecto nuevo → aplicar las migraciones del repo (`supabase db push` o el MCP) → `node scripts/restaurar-copia.mjs --de-verdad` (se niega a escribir sobre tablas con datos) → subir el espejo de archivos al storage. Los usuarios de Auth se recrean a mano (son ~8) y las claves (`.env`, secretos de las funciones) salen del gestor de contraseñas.
- **El historial de migraciones tiene que cuadrar con el repo, o el paso anterior no funciona.** El 02-09-2026 se descubrió que NO cuadraba: la base registraba 101 versiones (las aplicadas por el MCP llevan la hora del servidor, p. ej. `20260831074325`) y el repo tenía 113 ficheros con otros números, tres de ellos con el prefijo repetido, y dos migraciones aplicadas que nunca llegaron al repo. Se arregló renombrando 40 ficheros a su versión real, reconstruyendo las 2 que faltaban desde la base y marcando como aplicadas (`supabase migration repair`) las 14 que la base no tenía apuntadas. **Comprobación**: `supabase migration list --linked` tiene que mostrar las dos columnas rellenas en TODAS las filas. **Regla desde entonces**: una migración se aplica con el MCP (`apply_migration`) y el fichero del repo se nombra con la versión que quedó registrada en `supabase_migrations.schema_migrations`, nunca con un número inventado. Falta una prueba de reconstrucción desde cero (hace falta Docker o una rama de Supabase; en el portátil no hay Docker).
- **Qué NO cubre.** Los usuarios/contraseñas de Auth (pocos y recreables) y los secretos de las funciones edge (viven en Supabase y en el `.env` del portátil). Las copias internas de Supabase siguen existiendo aparte, como primera línea.

### Fase 2 — Independencia: que el PC de Luis deje de ser imprescindible

**Decisión del 17-08-2026: no hay mudanza a otro equipo.** El portátil se queda
encendido siempre, configurado y avisado. Así que la Fase 2 deja de ser "mover
las tareas a un mini-PC" y pasa a ser otra cosa, más barata y más útil.

**Lo primero, distinguir dos problemas que no son el mismo.** Estar encendido
resuelve la disponibilidad; no resuelve que el equipo sea de una persona. Y ni
siquiera resuelve del todo la disponibilidad: el 17-08, con el portátil
encendido, la suspensión moderna se lo tragó y la tarea de las 07:10 murió sin
red. Lo que salvó el día fue el reintento, no el equipo.

**Lo que NO puede salir de la LAN, y por tanto se queda donde está:**

| pieza | por qué no puede irse |
|---|---|
| Receptor del calibrador | el Sizer solo habla TLS 1.0 y envía a una IP de la red |
| Lectura del ERP (MySQL 192.168.1.10) | está en la red local; credenciales en el registro de Windows |
| Foto horaria de palets, generación del GSTOCK | leen el ERP |

**Lo que sí puede irse ya, porque solo habla con Supabase** (`pg_cron` → edge
function, como el informe semanal de los lunes, que ya funciona así):

crear el parte del día · generar y subir los informes del calibrador ·
analizar los partes pendientes · **el cuadre diario** · la copia de seguridad ·
el correo diario.

Eso obliga a partir el aviso en dos: la parte del ERP se queda en la LAN y deja
sus datos en Supabase; la parte que crea, analiza, cuadra y envía se va fuera.
**El objetivo no es que no falle: es que falle a medias.** Hoy, si el portátil
no arranca, no pasa nada y nadie se entera. Después, seguiría llegando el correo
diciendo que falta el ERP — que es justo la señal que hoy no existe.

**Y el vigilante va primero, no último.** El 17-08 aparecieron tres cosas rotas
—la tarea diaria con saltos de línea LF, el receptor con el código viejo en
memoria, las mujeres contadas dos veces en `calibres_dia`— y las tres se vieron
porque alguien estaba mirando. Cambiar piezas de sitio sin tener quién avise solo
cambia el sitio donde ocurre el silencio.

- [x] **Desplegar el vigilante** — hecho el 17-08-2026. Ojo con lo que se
      descubrió al hacerlo: el `pg_cron` (`vigilante-diario`, 11:45 UTC) llevaba
      tres días disparando contra una función que no existía, y los registros
      salían `succeeded` porque `net.http_post` solo confirma que encoló la
      petición, no que el otro lado respondiera. Al vigilante le pasaba justo lo
      que venía a vigilar. **Un cron en verde no prueba que su función corra.**
- [ ] Partir el aviso: ERP en la LAN, el resto en `pg_cron` → edge.
      **Lectura del 02-09-2026 (antes de tocar nada):** el corte NO es limpio en
      un solo punto. Cruzan la costura CUATRO datos que hoy viajan en memoria y
      no están en Supabase, no uno: (1) los `sospechosos` del GSTOCK (palets
      > 10.000 kg, `generar-gstock-erp.mjs`); (2) `faltaban` de los GSTOCK
      rehechos (kg del ERP − kg del parte); (3) `parte.paletsErp` (n y kg de
      palets del día, `paletsDelDia`, que a propósito NO se escribe en el parte
      y alimenta la sección PRODUCCIÓN y `hayActividad`); (4) `parte.erpCaido`.
      Y "crear el parte del día" (`repasarPartes`) abre conexión MySQL por
      `paletsDelDia`, así que no es nube pura. El gancho más barato para
      persistir los cuatro es `sistema_ejecuciones.datos` (JSON; ya se usa así
      en el aviso y en el buzón). El paso 1 sigue siendo válido, pero incluye
      escribir esos cuatro datos desde la mitad ERP y leerlos desde la mitad
      nube. El reintento de informes del calibrador (02-09) pertenece a la
      mitad nube: solo habla con Supabase.

#### El corte del aviso, para no re-deducirlo

**No es un corte mecánico.** El correo RESUME el trabajo del ERP (entradas,
palets, GSTOCK, cobertura de trazabilidad), así que la mitad que se va a la nube
no puede recibir esos resultados en memoria: tiene que **leerlos de Supabase**.
Ahí está el trabajo de verdad, no en mover ficheros.

Y se puede, porque el ERP ya deja todo lo que el correo necesita en la base:
`entradas_bascula`, `erp_palet`, `erp_confeccion_origen`, `erp_palets_foto` y el
GSTOCK subido al parte. Lo único que hoy viaja en memoria y no está en la base es
el detalle de los sospechosos del GSTOCK (palets > 10.000 kg): o se guarda, o el
correo lo recalcula leyendo `erp_palet`.

    LAN (portátil)                          NUBE (pg_cron → edge)
    ─────────────────────────               ─────────────────────────
    sincronizar entradas                    crear el parte del día
    sincronizar trazabilidad                subir los informes del calibrador
    sincronizar precalibrado                analizar los partes pendientes
    generar y subir el GSTOCK               cuadrar los 7 días
    → deja todo en Supabase                 componer y enviar el correo
                                            → si falta el ERP, el correo lo dice

**Orden que no rompe nada** (cada paso deja el sistema funcionando):

1. Partir el `.mjs` en dos entradas que sigan corriendo las dos en el portátil.
   Refactor puro, mismo comportamiento, y ya se puede probar el seam.
2. Hacer que la segunda mitad lea de Supabase en vez de recibir la primera en
   memoria. Sigue en el portátil; aquí es donde se ve si el corte es correcto.
3. Portar esa segunda mitad a edge (Deno + `_shared`). Ojo: `generar-informes-parte`
   usa `xlsx`, que en Deno hay que traer por esm.sh como hacen las otras.
4. Colgarla de `pg_cron` y quitar su paso del `.cmd` — el último, no el primero.

*Mientras no esté el paso 4, el `.cmd` sigue siendo el que manda: no quitarle
pasos "por adelantar trabajo".*
- [ ] **Runbook de recuperación**: "si este portátil muere, así se monta otro en
      una hora", probado de verdad una vez. Sigue haciendo falta, encendido o no.
- [ ] Cerrar la incidencia Compac (si el auto-envío funciona, sobra una pieza).

*Criterio de hecho: Luis puede irse dos semanas y, si algo se para, el correo lo
dice el mismo día.*

### Fase 3 — Usabilidad: diseñado para José María

- Sesión de observación con José María y Juanvi: qué miran, qué no entienden, qué echan de menos. **Antes de construir nada nuevo.**
- Manual de usuario por sección, dentro de la propia herramienta; textos de error que digan qué hacer, no qué falló técnicamente.
- Revisar permisos y terminar el modo económico (€ solo para quien corresponda).
- Retirar o fusionar lo que la observación demuestre que no se usa (sobre todo en RR. HH.).

*Criterio de hecho: una persona sin perfil técnico resuelve sola las situaciones normales.*

### Fase 4 — Completar el círculo económico

- Importador del Informe PRODUCTO (CMV automático).
- Retomar gastos varios (confirmando antes el precio Ecoenvases).
- Decidir ventas vs. facturas Mercadona (unificar).
- Cuenta de resultados de campaña dentro de la herramienta: de "informes que hace Luis" a "página que consulta dirección".

### Fase 5 — Medición y mejora continua

- Registro de ahorro por automatización (ver §7).
- Revisión trimestral de la tabla de procesos manuales (§4): qué ha aparecido, qué merece la pena.
- Este documento se actualiza en cada revisión.

---

## 6. Principios de diseño

Los que ya rigen (y se mantienen):

- **Todo conectado**: cada dato cableado a todos sus consumidores; estados derivados, no guardados; deduplicación completa; null ≠ 0; imports idempotentes.
- **Fuentes canónicas**: calibrador y ERP mandan; el papel y el Excel son respaldo.
- **Cada página responde una pregunta**: Entradas=fruta/stock, Trazabilidad=lote, Productores=quién, Análisis diario=tiempo.
- **Incertidumbre con dos cifras** (probada/estimada), nunca una métrica sobre la calidad del dato.
- **Estándar kg/persona POR RÉGIMEN de plantilla** (dueño, 27-08): media plantilla (≤35 presentes, régimen de agosto) suelo 2.200 / objetivo 2.600; plantilla completa (aunque haya faltas) suelo 1.700 / objetivo 2.100. Vive en `scripts/informe-produccion/estandar.json` (hasta el 02-09-2026 vivía en `tmp/`, fuera de git) y lo usan el semáforo del correo diario de rendimiento, los informes de la encargada y el análisis por tipo de día — mismo número, misma fuente. Revisar cada 4-6 semanas.

Los nuevos, a partir de ahora, para **cada** pieza que se construya o toque:

1. **¿Quién lo va a usar?** Si la respuesta es "solo Luis", replantearlo.
2. **¿Qué pasa si falla un martes a las 7:00 y Luis no está?** Tiene que dejar rastro y avisar en lenguaje llano.
3. **¿Dónde corre?** Nada nuevo en el PC de Luis.
4. **¿Está documentado** para el siguiente (técnico) y para el usuario (no técnico)?
5. **¿Sabemos cuánto ahorra?** Aunque sea una estimación apuntada al entregarlo.

---

## 7. Cómo mediremos el ahorro

Sin inventar cifras: al entregar cada automatización se apunta (a) qué proceso manual sustituye, (b) minutos/frecuencia que costaba, (c) errores típicos que evita. Candidatas a medir ya, porque están en producción:

- Parte diario automático (antes: transcripción diaria a mano).
- OCR de partes EMBASUR (antes: teclear el desglose de cada parte).
- Informe semanal (antes: recopilación manual para dirección).
- Receptor del calibrador (antes: sin datos de clasificación utilizables — aquí el valor no es tiempo, es **información que no existía**: 19 M kg clasificados consultables).
- Cierre automático de lotes (785 lotes que nadie tuvo que cerrar a mano).
- Buzón de correo del calibrador + parte EN VIVO (26-08): antes, cada informe exigía que alguien lo reenviara/subiera y el parte se montaba a mano o a la mañana siguiente; ahora entra solo al cerrar el lote. Sustituye ~10-15 min/día de recopilación y, sobre todo, el punto único "si Luis no está, no hay parte" — probado con una semana entera de ausencia reconstruida en una mañana.
- Ventas Mercadona semanal (19-08): antes, consulta manual al ERP y correo a mano cada lunes (~15 min/semana); ahora sale de Supabase aunque el portátil esté apagado.
- Estimación de manuales del parte (17-08): antes, un parte sin papel quedaba sin DSJ ni análisis hasta que alguien volvía; ahora el día queda entero (marcado en ámbar) y el dato real lo pisa.

La medición de uso de la herramienta (qué páginas se abren) entra en la Fase 1 con la misma infraestructura de registro.

---

## 8. Pendientes concretos ya identificados (lista corta)

- [x] Committear el trabajo en curso: parte con origen calibrador + fix bandeja de rentabilidad — hecho (árbol limpio el 02-09).
- [ ] Prueba de reconstrucción de la base desde cero con las migraciones del repo (hace falta Docker o una rama de Supabase; el historial ya cuadra desde el 02-09).
- [ ] `.env.example` completo (~52 variables reales) y README con el deploy (Vercel, `supabase functions deploy`, migraciones, pg_cron, tareas del portátil): sin eso el runbook de recuperación no se puede ejecutar.
- [ ] Reparto de las 77 pasadas multi-lote vía `conciliacionKg`.
- [x] Importador del Informe PRODUCTO (CMV) — disuelto: generación automática (14-08) + empaque habitual (17-08).
- [ ] Catálogo de productos del Sizer (empaque de productos NUEVOS): bloqueado por las credenciales `SIZER_*` del visor.
- [ ] Modo económico (ocultar € por rol).
- [ ] Gastos varios (bloqueado por la duda Ecoenvases).
- [ ] Decisión ventas/facturas Mercadona.
- [x] Respuesta de Compac a la incidencia del auto-envío — CERRADA: el auto-envío funciona por Gmail desde el 18-08 y es la vía única desde el 26-08 (destino directo al buzón que lee la Herramienta).
- [ ] Store global de tiempo (aplazado en la reforma de conectividad).

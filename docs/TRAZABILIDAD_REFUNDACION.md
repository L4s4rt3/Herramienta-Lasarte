# Refundación de la trazabilidad — modelo, regla de oro y fases

**Estado: fase 1 en curso · Aprobado por el dueño el 04-08-2026** ("confirmo la regla de oro, hazlo así").

## Por qué (diagnóstico)

Tres verdades de campo seguidas (inventarios físicos del dueño: cámara Guadex,
los 4 lotes de Invermarmelo, la Cámara 5 con 26 lotes intactos) demostraron el
mismo fallo estructural: **la evidencia débil podía cambiar estados fuertes**.
El derrame de la conciliación (una suposición estadística: "el exceso de esta
pasada será de un hermano de finca/variedad") atribuía kilos a lotes que
seguían físicamente en cámara, y el cierre automático se lo creía (310.260 kg
fantasma y 8 cierres falsos solo en la Cámara 5). Cada susto se tapó con una
señal nueva (cámara externa → confirmación física → …): parches correctos por
separado, sin modelo común debajo. Además hay ~6 módulos que derivan vistas
solapadas del mismo lote (conciliacionKg, entradasBascula/stock,
stockPrecalibrado, camarasExternas, camaraConfirmada, asentamientoDia).

## El modelo

### 1. Todo es un EVENTO con clase de evidencia

Todo lo que le pasa a un lote es un evento fechado con su fuente y su clase:

| Clase | Eventos | Puede… |
|---|---|---|
| **nombrado** | pasada del calibrador con el código del lote (en cualquier posición, convención A) | todo: mover kg, completar, cerrar |
| **anotado** | anotación de dirección sobre una pasada ("qué más se echó"), confirmación física en cámara, cierre/reapertura manual | todo (equivale a nombrado: es indicación humana explícita) |
| **medido** | entrada de báscula, foto de stock (kg_ajuste_stock), merma real de cámara, registro de cámara externa, venta directa | fijar cantidades y ubicaciones; NO cerrar por sí solo |
| **derivado** | derrame (exceso misma finca/variedad), estimaciones por edad (merma natural, podrido habitual) | solo SUGERIR y explicar huecos; JAMÁS persistir estados |
| *(nada)* | — | el lote queda "sin rastro", visible, en cola manual |

### 2. REGLA DE ORO (aprobada por el dueño, innegociable)

> **Ningún estado persistido (cierre, procesado, salida) sin evidencia
> nombrada o anotada.** El derrame no cierra lotes, aunque eso signifique más
> lotes en cola manual. Las estimaciones por edad solo relajan umbrales sobre
> kilos que YA tienen evidencia dura; nunca crean kilos.

Corolarios:
- El cierre automático exige que el umbral se alcance con kg
  nombrados+anotados (propios o de compuesta). Los kg de derrame no puntúan.
- Un lote con señal vigente de cámara (externa o confirmación física) no
  recibe derrames ni candidatea a cierre (ya implementado, commit fce7a77).
- Las CONTRADICCIONES entre eventos (pasada↔foto de stock, exceso sin dueño,
  PREC sin indicación) son ciudadanos de primera: cada una con su cola
  visible y su acción de 1 clic. Nunca se absorben en silencio.
- El reciclado es INCASABLE por naturaleza (regla del dueño 04-08): se
  descuenta por día (fase 0 de la conciliación) y su resto queda visible como
  "kg incasables", sin asignación forzada ni alarma.
- null ≠ 0: "sin evidencia" ≠ "0 kg procesados".

### 3. Un solo motor, todos los consumidores

`eventosLote.ts` (construir eventos desde las fuentes) + `cicloVidaLote.ts`
(derivar por lote: estado, ubicación, kg por clase de evidencia, destino) son
la ÚNICA fuente. Stock, Trazabilidad, Análisis diario, Productores, mermas y
asentamiento consumen el mismo derivado — mismo número ⇒ misma función pura.
Los estados NUNCA se guardan (solo hechos: el cierre es un hecho anotado; el
"completo" es derivado).

## Banco de pruebas dorado

`src/lib/__fixtures__/campana2026/` — snapshot real del 04-08-2026 (extraído
de BD y validado contra sumas exactas, 975/340 cierres y los inventarios
físicos del dueño): `entradas_bascula.json` (1.315), `pasadas_calibrador.json`
(1.263), `partes_diarios.json` (221), `camara_externa_camiones.json` (144) y
`destinos_auditados.json` (lote → destino+evidencia de la auditoría aceptada).
NOTA: el snapshot es ANTERIOR a la señal de confirmación física (la columna no
existía); el banco corre con ese Set vacío salvo los 4 Guadex externos.

Regla del banco: el motor nuevo debe reproducir cada destino auditado o
discrepar A MEJOR con explicación registrada en el propio test (lista
explícita de discrepancias aceptadas, nunca un umbral de "% de acierto").

## Fases

1. **[EN CURSO] Motor en paralelo**: eventosLote.ts + cicloVidaLote.ts + banco
   dorado. Archivos nuevos; el motor viejo sigue mandando en la UI.
2. **Regla de oro en el motor viejo** (puente, mientras llega el nuevo): el
   candidato a cierre automático deja de contar kg de derrame.
3. **Consumidores uno a uno**: Stock → Trazabilidad → Análisis/asentamiento →
   Productores/mermas. Cada uno con su verificación contra el banco.
4. **Poda**: retirar las derivaciones solapadas de los módulos viejos.

## Reglas para quien toque esto

- Comentarios en español. Nunca cruzar lotes por LIKE/substring (solo
  `normalizarLoteCodigo`, convención A). Lecturas con `fetchAllRows`.
- Typecheck: `npx tsc --noEmit -p tsconfig.app.json` (a secas NO comprueba nada).
- Cargar /entradas como admin ESCRIBE (dispara cierres): verificar con tests y
  SQL, no navegando.
- No asumir NADA (dueño, literal): cada PREC/lote se usa según se indique en
  los informes; sin indicación → cola manual visible.

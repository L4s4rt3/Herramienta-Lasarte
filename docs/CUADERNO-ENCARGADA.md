# El cuaderno de la encargada y la hoja de datos manuales

Cómo se leen los dos papeles de planta y a dónde va cada número en la
Herramienta. Confirmado con el dueño el 27-08-2026, al meter la semana de
vacaciones (18–25 de agosto) desde fotos.

## 1. La hoja "FECHA:" — los datos manuales del día

Es la hoja impresa con filas CITRICA / PODRIDO / MALLA Z.1 / MALLA Z.2 /
PALETS PUNTA / 10 KG / 15 KG / MDNA…. Se mapea con la función canónica
`derivePartManualFields` (`src/lib/partManualVision.ts`) — la misma que usa el
botón de visión de la app:

| Fila del papel | Campo del parte | Regla |
| --- | --- | --- |
| CITRICA | `kg_industria_manual` | **bruto tal cual** se pesa (sin restar tara) |
| MALLA Z.1 / Z.2 | `kg_reciclado_malla_z1/z2` (+ `_bruto`, `box_reciclaje_*`) | neto = bruto − 30 kg × box; cada fracción de box cuenta como box entero |
| PALETS PUNTA | `kg_inventario_sin_alta` | directo |
| PODRIDO (y CITRICA PODRIDO) | `kg_podrido_bolsa_basura` | neto = bruto − 30 kg × box (1 box por línea si no se apunta) |

**Checksum de lectura** (obligatorio antes de dar la foto por buena):
`PALETS PUNTA = Σ(10 KG + 15 KG + MDNA granel/3/4/5)`. En las 6 hojas de la
semana 18–25 cuadró exacto. Las líneas de desglose (10 KG, 15 KG, MDNA…) NO se
guardan por separado: solo validan el total de punta.

- Con el papel delante, una **fila en blanco es un 0 real** (no "sin dato").
- El arrastre: `kg_inventario_anterior_sin_alta` del día siguiente = la punta
  de este día. Con fin de semana en medio, arrastra al siguiente día laborable.
- Tras escribir el dato real, `node scripts/estimar-manuales-parte.mjs
  --aplicar` retira las marcas ámbar de estimación. Ojo: si el valor real
  coincide con el estimado (p. ej. industria 0), la marca no se considera
  "pisada" y hay que limpiar `campos_estimados` a mano — el papel presente
  convierte ese 0 en dato confirmado.

## 2. El cuaderno "PRODUCCIÓN dd/mm/aaaa" — los lotes y sus apuntes

Página por día con las pegatinas de CONTROL DE ENTRADA de cada lote y
anotaciones a boli. La notación (confirmada por el dueño):

| Anotación | Significado | A dónde va |
| --- | --- | --- |
| `I-xxxx` | kg del lote que fueron **a industria** | `lotes_dia.kg_industria` |
| `P1-xxxx` / `P2-xxxx` | kg apartados **a precalibrado 1 / 2** | `lotes_dia.kg_precalibrado_z1/z2` |
| `X` (en P1/P2) | cero de verdad | 0, no null |
| resto (podrido, manchada, huecos fallo volcador, mujeres triando, "paro hh:mm", "resto N box") | contexto del lote | `lotes_dia.notas`, con prefijo `Cuaderno dd/mm:` |

- El código de 8 dígitos de la pegatina se casa con `codigoBaseLote` — los
  lotes del cuaderno coinciden 1:1 con los informes DOCX del calibrador.
- Una lectura dudosa se escribe con su duda **en la nota**, nunca en silencio.
- OJO al comparar: la "industria" del cuaderno parece incluir toda la segunda
  (la suma de I- del 25-08, 28.549 kg, clava la no-exportación + no-comercial
  del calibrador de ese día, 28.478). No compararla a ciegas con el grupo
  NO COMERCIAL de la clasificación.

## 3. Por qué merece la pena apuntar P1/P2

El precalibrado por lote es la pieza que faltaba para devolver la fruta del
almacén a su finca de origen: la vía del ERP (`agri_produc_mp_pt`) solo cubre
el ~27 % porque lo apartado no siempre se pesa. Si el cuaderno trae P1/P2 por
lote, esa trazabilidad mejora sin tocar nada más.

# Vigía de negocio y cierre mensual

*Creado el 31-08-2026. Encargo: «quiero formas de hacer que esto funcione solo
y nos brinde información valiosa».*

## La idea

El sistema ya tenía un **vigilante** (¿los trabajos automáticos dan señales?) y
correos periódicos (07:10 diario, informe semanal, ventas Mercadona). Lo que
faltaba era un vigilante de lo que **cuentan los datos**: las preguntas que
hasta ahora había que hacerle a Claude a mano («¿cuadra el camión?», «¿cuánto
dinero hay parado?», «¿esta merma es normal?») convertidas en reglas que corren
solas cada día y solo hablan cuando hay algo que decir.

## Las piezas

| Pieza | Dónde vive | Cuándo corre |
|---|---|---|
| Vigía de negocio | edge `vigia-negocio` + `_shared/vigiaNegocio.ts` (lib pura, 30 tests) | diario 12:15 UTC (job `vigia-negocio-diario`) |
| Cierre mensual | edge `cierre-mensual` + `_shared/cierreMensual.ts` (lib pura, 9 tests) | día 1, 05:45 UTC (job `cierre-mensual-dia1`) |
| Ensamblaje compartido | `_shared/campanaEdge.ts` (espejo de useEntradasBascula/useMermaLote) | lo importan informe-semanal, vigía y cierre |
| Hallazgos | tabla `vigia_hallazgos` (la app puede leerla) | — |
| Laadbon por camión | tabla `saf_camiones` | se teclea al llegar cada camión |

Ambos trabajos están en el catálogo de `saludTrabajos.ts`: la página
`/datos/fuentes` los enseña y el vigilante avisa si dejan de correr.

## Las reglas del vigía (umbral entre paréntesis)

**Eventos** — pasaron un día concreto, se avisan una vez:

1. **Sobrellenado de malla** (media > 12,32 kg/caja con ≥100 cajas): kg y €
   regalados sobre el 12,24 exigido, valorados con el €/kg puesto del último
   Laadbon. También avisa de **caja corta** (< 12,02: riesgo de rechazo).
2. **Merma fuera de banda** (> 5 % en lotes ≥ 3 t terminados en la semana),
   con la MISMA cuenta que «Mermas y coste». El ⚠ calibrador>báscula no cuenta.
3. **Parte con descuadre** (estado «Con descuadre»).
4. **Día rojo de rendimiento** (estándar del dueño 27-08 por régimen: ≥35
   presentes rojo < 1.700 kg/persona; < 35 presentes rojo < 2.200). Los kg
   salen del PARTE (`lotes_dia`), que sigue vivo en la era SAF.

**Estados** — siguen abiertos hasta que dejan de detectarse (recordatorio los
lunes):

5. **Camión SAF sin Laadbon** (entrada de HG sin fila en `saf_camiones`).
6. **Cuadre camión SAF** (|alta ERP − cajas × €/caja| > 200 €). El camión 1
   dio +1.790,10 € el primer día, el mismo número que el análisis manual.
7. **Dinero parado** (albarán de venta > 30 días sin factura, por cliente;
   importe 0 = «sin valorar», nunca gratis).
8. **Palets sin vender** (> 14 días y > 3 t en la ventana de 60 días).
9. **Fruta parada en cámara** (> 15 días y > 5 t, con el stock de la app).
10. **Parte en Borrador** (> 3 días).
11. **Papel sin meter** (estimaciones pasada su gracia + 2 días).
12. **Partes sin validar** (> 7 días en Analizado).
13. **Calibrado sin detalle** (día con producción en el parte y sin filas en
    `lote_clasificacion`): Rentabilidad y el informe semanal quedan ciegos ese
    día. Esta regla nació de encontrar el hueco del 11 al 31-08.

Los umbrales son constantes exportadas de `vigiaNegocio.ts` — cambiar uno es
un commit de una línea con su test.

## El flujo del camión SAF

1. Llega el camión y entra en el ERP → la sincronización lo deja en
   `entradas_bascula` (agricultor Goesten).
2. Al día siguiente el vigía reclama: «camión sin su Laadbon registrado».
3. Alguien teclea el Laadbon en `saf_camiones` (lote, cajas, €/caja, porte,
   neto). Desde SQL o desde la app cuando tenga pantalla.
4. El vigía contrasta cada día alta-vs-Laadbon y avisa si no cuadra; al
   corregir el alta en el ERP, el hallazgo se resuelve solo.

## Correos

- Destinatarios por secreto de función: `VIGIA_PARA` y `CIERRE_MENSUAL_PARA`
  (por defecto soporte@lasartesat.es). **Los correos del vigía llevan euros:
  solo admin.** Regla de la casa: refinar antes de añadir destinatarios.
- Si no hay nada nuevo, el vigía calla; los lunes manda el resumen de
  pendientes. `force: true` reenvía; `dry_run: true` evalúa sin escribir.

## Hallazgo pendiente de fondo (31-08)

`lote_clasificacion` se llena con el import MANUAL del Excel del calibrador;
los DOCX del buzón van al espejo `calibrador_*` a propósito (migración
20260811100000). Al acabar la campaña dejó de importarse el Excel y
**Rentabilidad, el informe semanal y el cierre mensual no ven la producción
SAF** (la regla 13 lo mantiene visible). El arreglo de fondo es que esos
lectores mezclen `lote_clasificacion` + `calibrador_clasificacion` con la
regla de frescura por lote-día (sin contar dos veces las pasadas repetidas) —
proyecto aparte, apuntado en la hoja de ruta.

## Lo que quedó apuntado (no construido)

- **Excel semanal del dueño** (dos libros): el motor vivía en
  `tmp/informe-semana33.ts` y ya no existe en disco; hay que reconstruirlo
  desde los Excel entregados de la semana 33 y entonces programarlo (lunes,
  portátil de la oficina).
- **Fichas de trabajadores mensuales**: el generador vive en
  `tmp/informe-produccion/` (fichas-personas.ts + build_fichas.py +
  generar-fichas.cmd); moverlo a `scripts/` y darle tarea mensual en el
  portátil de la oficina.
- **Potencia eléctrica** (¿compensa subir el escalón?): faltan los excesos de
  potencia POR FACTURA tecleados (solo se conoce el récord de feb-26:
  2.096 €). Con ellos, la cuenta es directa.
- **Ranking € neto por productor**: la pérdida por productor ya la da
  `scripts/analisis-mermas-mercadona.ts`; el € neto necesita precios de venta
  reales cargados (los defaults MDNA están a 0 a propósito).
- **Planificación de personal SAF** (pedido de mañana ÷ 8 palets/h): no hay
  fuente digital del pedido de Madrid todavía.

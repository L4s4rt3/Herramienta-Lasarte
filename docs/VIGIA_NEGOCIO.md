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
13. **Detalle del calibrador contra el parte, día a día** (tres caras): SIN
    detalle (ninguna fuente de la vista `clasificacion_lote` tiene el día:
    Rentabilidad ciega), detalle CORTO (< 85 % de los kg del parte:
    probablemente falta una pasada) y detalle LARGO (> 115 %: algo se cuenta
    dos veces — caza regresiones de la propia vista). Esta regla nació de
    encontrar el hueco del 11 al 31-08.

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

## El arreglo de fondo de las fuentes del calibrador (31-08, mismo día)

El hueco del 11 al 31-08 se cerró de raíz en la migración
`20260831120000_clasificacion_lote_rama_docx`: la vista `clasificacion_lote`
— de la que cuelgan Rentabilidad, el dossier por productor, el podrido de
mermas (`lote_clasificacion_podrido_agg`), trazabilidad, CMV y ahora también
informe semanal, cierre mensual y vigía — ganó su TERCERA rama: los informes
DOCX del buzón (`batch_id < 0`), solo para los lote-día que no cubren ni el
volcado SQL ni el import manual del Excel (la misma regla de frescura por
lote-día que ya usaba la RPC del aprovechamiento). Esas filas van marcadas
`fuente = 'docx'` y el informe semanal y el cierre lo avisan («X kg del
detalle salen del respaldo DOCX») porque un DOCX re-guardado solo trae la
última versión de su pasada.

Verificado el 31-08: +703.192 kg exactos (todo el lado DOCX), del 12-08 al
31-08, sin alterar un solo kg anterior ni duplicar nada; la semana 35 pasó de
«sin datos» a 135.393 kg y el hallazgo de ceguera del vigía se resolvió solo.
Si el import manual del Excel se retoma para un día ya cubierto por DOCX,
gana el Excel (más completo).

## Los lunes mudos (31-08, encontrado al verificar)

El informe semanal de las semanas 33 y 34 **nunca salió y nadie lo supo**: el
cron dispara por pg_net, que encola el POST y marca «succeeded» pase lo que
pase; la función murió a medias (fallo intermitente: al reintentar funcionó)
sin dejar ni fila de envío ni latido. Tres capas de arreglo, mismo día:

1. Todas las funciones de correo **laten** en `sistema_latidos` al terminar y
   también en su `catch` (helper `_shared/latido.ts`).
2. `informe-semanal` y `ventas-mercadona` entraron en el catálogo de
   `saludTrabajos.ts`: el vigilante avisa si un lunes pasa sin latido.
3. Job `informe-semanal-lunes-reintento` (12:25 Madrid): inocuo si el primero
   funcionó (responde `ya_enviado`), salva el lunes si murió.

Las semanas 33 (399.450 kg) y 34 (338.832 kg) se enviaron el 31-08 con los
datos ya completos de la vista arreglada.

## Lo que quedó apuntado (no construido)

- **Excel semanal del dueño** (dos libros): el motor vivía en
  `tmp/informe-semana33.ts` y ya no existe en disco; hay que reconstruirlo
  desde los Excel entregados de la semana 33 y entonces programarlo (lunes,
  portátil de la oficina).
- **Fichas de trabajadores mensuales**: el generador vive en
  `scripts/informe-produccion/` (fichas-personas.ts + build_fichas.py +
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

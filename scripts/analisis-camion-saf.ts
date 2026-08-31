// ANÁLISIS COMPLETO DEL CAMIÓN SAF 1 — primer día de confección (28-08-2026)
// VERSIÓN VERIFICADA: los cuatro supuestos confirmados por Vadim el 28-08:
//   1. Los pesos de fin de día son BRUTOS con box PEQUEÑO (tara 30 kg).
//   2. Los 65 kg de podrido de bolsa son de HOY y del SAF.
//   3. Los palets de malla SE PESAN de verdad (12,478 kg/caja es medido).
//   4. La base del precio es el Laadbon de HG: 13,50 €/caja + 3.200 € porte.
//
// FUENTES: Laadbon 1184057 + entrada ERP 16986 (neto 23.589, taras confirmadas)
// + control de Raquel (16,45/15,40 kg/caja) + palets_cab del ERP 28-08 (pesada
// real) + informe del calibrador lote 26082701 (17.146,5 kg, 169 líneas) +
// pesos de planta fin de día (regla de JM).
//
// Genera: outputs/Analisis_Camion_SAF_dia1.xlsx
// Ejecutar: node node_modules/vite-node/vite-node.mjs scripts/analisis-camion-saf.ts

import * as XLSX from 'xlsx'
import * as fs from 'fs'
import * as path from 'path'

// ---------- 1. El camión (papeles) ----------
const CAMION = {
  netoKg: 23589, cajas: 1440,
  cajasCat1: 1280, kgCajaCat1: 16.45,
  cajasCat2: 160, kgCajaCat2: 15.40,
  frutaEur: 19440, porteEur: 3200,
}
const COSTE_TOTAL = CAMION.frutaEur + CAMION.porteEur // 22.640
const EUR_KG_PUESTO = COSTE_TOTAL / CAMION.netoKg // 0,95977
const KG_CAT2 = Math.round(CAMION.cajasCat2 * CAMION.kgCajaCat2) // 2.464

// ---------- 2. Fin de día (planta, pesos BRUTOS, box pequeño) ----------
const TARA_BOX = 30 // CONFIRMADO: box pequeño
const sobranteNeto = 5008.5 - 22 * TARA_BOX // 4.348,5
const reciclajeNeto = 545 - 4 * TARA_BOX // 425
const pre2Neto = 492 - 3 * TARA_BOX // 402  (OJO: el ERP lo dio de alta a 492, en bruto)
const pre1Neto = 178 - 1 * TARA_BOX // 148  (el ERP dice 173)
const PODRIDO_BOLSA = 65 // de hoy, del SAF (confirmado)
const CITRICA = 6 // ERP

// ---------- 3. ERP palets (pesada real confirmada) ----------
const ERP = { malla: 15573, cajasMalla: 1248, palets: 24 }

// ---------- 4. Sizer (lote 26082701, 05:46→12:36) ----------
const SIZER = { total: 17146.5, exportacion: 16247.8, noExport: 578.3, mujeres: 233.8, noComercial: 86.5, podridoJ: 25.5 }

// ---------- 5. Balance de kilos ----------
const consumido = ERP.malla + pre2Neto + pre1Neto + CITRICA + reciclajeNeto + PODRIDO_BOLSA // 16.619
const volcado = consumido + sobranteNeto // 20.967,5
const cajasVolcadas = volcado / CAMION.kgCajaCat1 // 1.274,6 ≈ 1.280 (CAT 1 entera)
const frutaPorBox = sobranteNeto / 22 // 197,7 (el pequeño admite 200: llenos al tope)
const boxLlenados = volcado / frutaPorBox // ~106
const boxEchados = boxLlenados - 22 // ~84
const hueco = CAMION.netoKg - volcado - KG_CAT2 // 157,5 (0,67%)

// ---------- 6. Podrido, descarte, aprovechamiento ----------
const podridoReal = PODRIDO_BOLSA + SIZER.podridoJ // 90,5
const descarte = pre2Neto + pre1Neto + CITRICA + PODRIDO_BOLSA // 621 (no vendible hoy)
const aprovechamientoMalla = ERP.malla / consumido // 93,71%

// ---------- 7. Merma de venta (hierro: pesada real del ERP) ----------
const kgCajaReal = ERP.malla / ERP.cajasMalla // 12,4784
const kgMallaReal = kgCajaReal / 4 // 3,1196
const kgFacturados = ERP.cajasMalla * 12 // 14.976
const regaladoTotal = ERP.malla - kgFacturados // 597
const regaladoObligado = ERP.cajasMalla * 4 * 0.06 // 299,5 (los 3,06 exigidos)
const regaladoEvitable = regaladoTotal - regaladoObligado // 297,5

// ---------- 8. Coste real y suelo ----------
const frutaConsumidaNeta = consumido - reciclajeNeto // 16.194 (el reciclaje vuelve)
const consumoPorFacturado = frutaConsumidaNeta / kgFacturados // 1,08133
const frutaEurKgFact = consumoPorFacturado * EUR_KG_PUESTO // 1,03783
const ENVASE = 0.0378 // v5 (el componente menos medido: despiezarlo con precios actuales)
// ASISTENCIA REAL DEL 28-08 (fichero del reloj, recibido): 28 fichados,
// 176,23 horas (25 jornadas casi completas + Raquel 1,2 h, Sergio 1,7,
// Eusebio 1,6). Coste con tarifa conocida donde la hay (Eva 8,5; Manuela,
// Araceli, Pilar y Rocío Díaz a 8,0) y 8,34 €/h v5 en el resto.
const HORAS_HOY = 176.23
const COSTE_PERSONAL_HOY = 1465 // €
const personalKgFact = (8.34 * 7 / 2600) * (consumido / kgFacturados) // 0,02492 (a régimen: estándar media plantilla)
const personalHoyKgFact = COSTE_PERSONAL_HOY / kgFacturados // 0,0978 REAL de hoy (día corto)
const kgPersonaHoy = consumido / (HORAS_HOY / 7) // ~660 kg/persona-jornada
const SUM_REGIMEN = 0.010 // 600 €/día a régimen de 50-70 t
const sumHoyReal = 600 / kgFacturados // 0,0401 (día corto de 15 t)
const costeRegimen = frutaEurKgFact + ENVASE + personalKgFact + SUM_REGIMEN // 1,1106
const costeHoy = frutaEurKgFact + ENVASE + personalHoyKgFact + sumHoyReal // 1,2135 REAL del día 1
const ESTRUCTURA_HIST = 0.0213 // forfait 17-18, referencia hasta cargar cmv_costes_mensuales

const r = (n: number, d = 4) => Number(n.toFixed(d))
const pct = (a: number, b: number) => `${(100 * a / b).toFixed(2)}%`

// ---------- Excel ----------
const wb = XLSX.utils.book_new()
const aoa = (name: string, rows: (string | number | null)[][], widths: number[]) => {
  const ws = XLSX.utils.aoa_to_sheet(rows)
  ws['!cols'] = widths.map(wch => ({ wch }))
  XLSX.utils.book_append_sheet(wb, ws, name)
}

aoa('Resumen', [
  ['ANÁLISIS DEL CAMIÓN SAF 1 — DÍA 1 DE CONFECCIÓN (28-08-2026) · VERIFICADO'],
  ['Lasarte Cítricos S.L. · lote 26082701 · supuestos confirmados por Vadim (tara box 30, bolsa de hoy, palets pesados, Laadbon 13,50 €/caja)'],
  [],
  ['LO QUE PEDÍA JOSÉ MARÍA', ''],
  ['Coste MEDIO de la venta — con el día lleno de trabajo', `${costeRegimen.toFixed(3)} €/kg facturado = ${(costeRegimen * 12).toFixed(2)} €/caja = ${(costeRegimen * 3).toFixed(2)} €/malla (personal contado como si el día produjera al estándar: 2.600 kg por persona)`],
  ['Coste REAL del día 1 (asistencia del reloj: 176,2 h)', `${costeHoy.toFixed(3)} €/kg facturado — más caro porque el día fue corto: ${Math.round(kgPersonaHoy)} kg/persona (desmonte sobre la marcha, limpieza de graneleras y solo 15 t facturables). Los mismos trabajadores repartidos entre pocos kilos.`],
  ['SUELO DE COSTES (lo que cuesta el kg vendido, todo dentro)', `${costeRegimen.toFixed(2)} €/kg antes de estructura · ~${(costeRegimen + ESTRUCTURA_HIST).toFixed(2)} €/kg con la estructura histórica (0,021 del forfait 17-18) — por debajo de ese precio se vende a pérdida`],
  ['Kg echados DE MÁS (medido en pesada real)', `${Math.round(regaladoTotal)} kg hoy (${Math.round(regaladoTotal * EUR_KG_PUESTO)} €): ${Math.round(regaladoObligado)} obligados por los 3,06 + ${Math.round(regaladoEvitable)} EVITABLES (${Math.round(regaladoEvitable * EUR_KG_PUESTO)} €/día)`],
  ['% de EXCESO', `+${pct(regaladoTotal, kgFacturados)} sobre lo facturado (3.120 g/malla vs 3.000) · +${pct(kgMallaReal - 3.06, 3.06)} sobre lo EXIGIDO (3.060)`],
  ['APROVECHAMIENTO del día', `${pct(ERP.malla, consumido)} a malla sobre lo consumido · el Sizer da 94,8% de clases de exportación · el reciclaje (${reciclajeNeto} kg, 2,6%) vuelve a línea mañana`],
  ['PODRIDO real', `${podridoReal} kg = ${pct(podridoReal, consumido)} de lo consumido (bolsa 65 + máquina 25,5) — el "1,7%" era el descarte parcial de media mañana, NO podrido`],
  ['DESCARTE total (pre + cítrica + bolsa)', `${descarte} kg = ${pct(descarte, consumido)} de lo consumido — el pre (550 kg) se reaprovecha: no es pérdida completa`],
  [],
  ['LAS PALANCAS, POR DINERO', ''],
  ['1) Sobrellenado evitable', `bajar la consigna de 3.120 a ~3.070 g/malla: ${Math.round(regaladoEvitable * EUR_KG_PUESTO)} €/día (~1.500 €/sem). La enmalladora es MUY estable (palets 12,40-12,60): se puede sin riesgo de caja corta`],
  ['2) Días cortos', `hoy los 600 € de suministros cayeron sobre 15 t (0,040 €/kg vs 0,010 a régimen): llenar el día con más pedidos vale ~450 €/día`],
  ['3) CAT 2 y pre sin destino', `${KG_CAT2} kg de CAT 2 + ${pre2Neto + pre1Neto} kg de pre pagados a 0,96 esperando destino y precio`],
], [46, 135])

aoa('Balance de kilos', [
  ['EL CAMIÓN, KILO A KILO (fin de día 28-08; pesos de planta BRUTOS − 30 kg/box pequeño)'],
  [],
  ['Concepto', 'kg netos', 'Fuente / comprobación'],
  ['Camión (neto de báscula, taras confirmadas)', CAMION.netoKg, 'entrada ERP 16986'],
  ['— CAT 2 sin desmontar (160 cajas × 15,40)', KG_CAT2, 'control de Raquel'],
  ['— VOLCADO (la CAT 1 entera)', r(volcado, 1), `equivale a ${cajasVolcadas.toFixed(0)} cajas de 16,45 ≈ las 1.280 de CAT 1 (dif. ${(1280 - cajasVolcadas).toFixed(0)} cajas, 0,4%)`],
  ['— Hueco del balance', r(hueco, 1), `${pct(hueco, CAMION.netoKg)} — derrames, redondeos y dispersión de taras: un cierre muy bueno`],
  [],
  ['DEL VOLCADO (consumido hoy):', '', ''],
  ['   · a malla Mercadona (24 palets × 52 cajas, PESADA REAL)', ERP.malla, 'ERP palets_cab'],
  ['   · a pre-2 (mujeres 233,8 del Sizer + tamaño)', pre2Neto, 'planta 492 brutos − 3 box'],
  ['   · a pre-1', pre1Neto, 'planta 178 brutos − 1 box'],
  ['   · a cítrica/industria', CITRICA, 'ERP'],
  ['   · a reciclaje (VUELVE a línea)', reciclajeNeto, 'planta 545 brutos − 4 box'],
  ['   · podrido de bolsa', PODRIDO_BOLSA, 'planta (confirmado: de hoy, del SAF)'],
  ['   CONSUMIDO TOTAL', consumido, 'suma de lo anterior'],
  ['Sobrante en box (por hacer)', r(sobranteNeto, 1), `22 box × 197,7 kg de fruta (el pequeño admite 200: van al tope) — 5.008,5 brutos por pies`],
  [],
  ['BOX Y CAJAS (la pregunta del grupo):', '', ''],
  ['Cajas de cartón volcadas', '1.280 (la CAT 1 completa)', 'el volcado / 16,45 da 1.275 ± taras'],
  ['Box llenados en el desmonte', `~${Math.round(boxLlenados)}`, `a ${frutaPorBox.toFixed(1)} kg de fruta/box`],
  ['Box echados a línea', `~${Math.round(boxEchados)}`, 'llenados − 22 que quedan'],
  [],
  ['CONTRASTE CALIBRADOR', '', ''],
  ['El Sizer pesó 17.146,5', `+${pct(SIZER.total - consumido, consumido)}`, 'sesgo conocido del calibrador (pesa de más; en campaña llegó a +7,8%)'],
  [],
  ['AVISO al dar de alta los PRE', '', 'el ERP tiene PRE2=492 y PRE1=173 (≈brutos); los netos son 402/148 → hay ~115 kg de tara de box contados como fruta en el GSTOCK del parte. Corregir el alta o asumir la holgura.'],
], [52, 18, 105])

aoa('Merma de venta', [
  ['LA MERMA DE VENTA — PESADA REAL DE LOS 24 PALETS (confirmado: se pesan de verdad)'],
  ['(Mercadona factura 3,00 kg/malla y EXIGE entregar ≥3,06)'],
  [],
  ['Nivel', 'Real', 'Facturado', 'Exigido (3,06)', 'Exceso vs facturado', 'Exceso vs exigido'],
  ['Por malla', '3.120 g', '3.000 g', '3.060 g', '+120 g (+3,99%)', '+60 g (+1,95%)'],
  ['Por caja (4 mallas)', `${kgCajaReal.toFixed(3)} kg`, '12,000', '12,240', `+${(kgCajaReal - 12).toFixed(3)}`, `+${(kgCajaReal - 12.24).toFixed(3)}`],
  ['Por palet (52 cajas)', `${(kgCajaReal * 52).toFixed(1)} kg`, '624,0', '636,5', `+${((kgCajaReal - 12) * 52).toFixed(1)} kg`, `+${((kgCajaReal - 12.24) * 52).toFixed(1)} kg`],
  ['Día (1.248 cajas)', `${ERP.malla}`, `${kgFacturados}`, `${Math.round(1248 * 12.24)}`, `+${Math.round(regaladoTotal)} kg`, `+${Math.round(regaladoEvitable)} kg`],
  [],
  ['KG REGALADOS HOY', `${Math.round(regaladoTotal)} kg = ${Math.round(regaladoTotal * EUR_KG_PUESTO)} € de fruta`, '', '', '', ''],
  ['   obligados por el 3,06 de Mercadona', `${Math.round(regaladoObligado)} kg (${Math.round(regaladoObligado * EUR_KG_PUESTO)} €) — no se pueden evitar`, '', '', '', ''],
  ['   EVITABLES', `${Math.round(regaladoEvitable)} kg = ${Math.round(regaladoEvitable * EUR_KG_PUESTO)} €/día ≈ ${Math.round(regaladoEvitable * EUR_KG_PUESTO * 5.2)} €/semana con las 70-80 t`, '', '', '', ''],
  [],
  ['Dispersión palet a palet: 12,40–12,60 kg/caja (pesada real). El palet más bajo lleva +41 g/malla', '', '', '', '', ''],
  ['sobre lo exigido: se puede bajar la consigna ~40-50 g/malla sin riesgo de caja corta.', '', '', '', '', ''],
], [26, 24, 12, 14, 20, 18])

aoa('Coste y suelo', [
  ['EL COSTE REAL, ESCALÓN A ESCALÓN (por kg FACTURADO a Mercadona)'],
  [],
  ['Escalón', '€/kg', 'De dónde sale'],
  ['Fruta puesta en almacén', r(EUR_KG_PUESTO), 'Laadbon 1184057 (CONFIRMADO como base): (19.440 + 3.200) / 23.589'],
  [`× consumo real (${consumoPorFacturado.toFixed(4)} kg por kg facturado)`, r(frutaEurKgFact), `1,000 facturado + ${(regaladoTotal / kgFacturados).toFixed(4)} sobrellenado + ${(descarte / kgFacturados).toFixed(4)} descarte (el reciclaje NO se consume: vuelve)`],
  ['+ Envase (malla + caja)', ENVASE, 'metodología v5 — el componente menos medido: conviene despiezarlo con precios actuales como el Excel de 2018'],
  ['+ Trabajadores — CON EL DÍA LLENO', r(personalKgFact), 'la idea: una persona cuesta 58,38 €/día (8,34 €/h × 7 h); si el día produce al estándar (2.600 kg por persona), ese coste se reparte entre 2.600 kg → 0,022 €/kg. Es el coste de personal cuando la plantilla está bien aprovechada.'],
  ['   Trabajadores — EL DÍA 1 TAL CUAL', r(personalHoyKgFact), `asistencia del reloj: 176,2 h = ${COSTE_PERSONAL_HOY} € ÷ 14.976 kg facturados. Salió 4 veces más caro porque los mismos trabajadores se repartieron entre pocos kilos (${Math.round(kgPersonaHoy)} kg/persona: día corto de arranque)`],
  ['+ Suministros — con el día lleno (50-70 t)', SUM_REGIMEN, `600 €/día ÷ los kg de un día normal — HOY real: ${sumHoyReal.toFixed(4)} (los mismos 600 € sobre solo 15 t)`],
  ['= COSTE MEDIO DE LA VENTA (día lleno)', r(costeRegimen, 3), `${(costeRegimen * 12).toFixed(2)} €/caja · ${(costeRegimen * 3).toFixed(2)} €/malla — el número para planificar`],
  ['= COSTE REAL DEL DÍA 1 (todo real)', r(costeHoy, 3), `${(costeHoy * 12).toFixed(2)} €/caja · ${(costeHoy * 3).toFixed(2)} €/malla`],
  ['+ Estructura (referencia histórica forfait 17-18)', ESTRUCTURA_HIST, 'alquiler/seguros/amortización — hasta cargar los apuntes reales'],
  ['= SUELO DE COSTES con estructura', r(costeRegimen + ESTRUCTURA_HIST, 3), 'lo que cuesta el kg puesto en el camión de Mercadona, todo dentro'],
  [],
  ['A favor, sin cuantificar', 'valor del pre (550 kg) y de la CAT 2 (2.464 kg) cuando se vendan; el reciclaje que vuelve', ''],
  ['Regla rápida', `cada 1% de descarte o sobrellenado ≈ ${Math.round(kgFacturados * 0.01 * EUR_KG_PUESTO)} €/día de coste — la batalla del coste está en planta`, ''],
], [46, 12, 110])

aoa('Podrido y descarte', [
  ['PODRIDO Y DESCARTE — % SOBRE LO CONSUMIDO Y SOBRE EL CAMIÓN'],
  [],
  ['Concepto', 'kg', '% de lo consumido (16.619)', '% del camión (23.589)'],
  ['PODRIDO REAL (bolsa 65 + clase J máquina 25,5)', podridoReal, pct(podridoReal, consumido), pct(podridoReal, CAMION.netoKg)],
  ['Pre-2 (mujeres + tamaño)', pre2Neto, pct(pre2Neto, consumido), pct(pre2Neto, CAMION.netoKg)],
  ['Pre-1', pre1Neto, pct(pre1Neto, consumido), pct(pre1Neto, CAMION.netoKg)],
  ['Cítrica/industria', CITRICA, pct(CITRICA, consumido), ''],
  ['DESCARTE TOTAL (pre + cítrica + bolsa)', descarte, pct(descarte, consumido), pct(descarte, CAMION.netoKg)],
  ['Reciclaje (no es pérdida: vuelve)', reciclajeNeto, pct(reciclajeNeto, consumido), ''],
  [],
  ['El "1,7%" del grupo, DESMENTIDO', 'era la foto de media mañana del pre-2 (166 kg sobre ~9,8 t) y era DESCARTE, no podrido. A día cerrado: descarte 3,7%, podrido real 0,5%.', '', ''],
  ['Sizer del lote (17.146,5 kg)', 'exportación 94,8% (Extra1 12.096 + Extra2 1.085 + Cat1A 1.933 + Cat1B 1.056 + VerdeClaro 77) · no-export 578 · mujeres 233,8 · no comercial 86,5', '', ''],
  ['Nota', 'los 25,5 kg de podrido de máquina pueden solaparse en parte con los 6 de cítrica: como mucho el podrido real total varía en esos 6 kg', '', ''],
], [48, 20, 26, 22])

aoa('Metodología', [
  ['CÓMO SE HA HECHO — Y QUÉ CONFIRMÓ VADIM (28-08)'],
  [],
  ['Verificado con el usuario', '1) Pesos de planta BRUTOS con box pequeño (tara 30) — es además la hipótesis que hace cuadrar el balance: el volcado equivale a las 1.280 cajas de CAT 1 y los box quedan a 197,7 kg (su tope es 200). 2) Los 65 kg de bolsa son de hoy y del SAF. 3) Los palets de malla SE PESAN (el 12,478 es medido; dispersión 12,40-12,60). 4) La base del precio es el Laadbon (13,50 €/caja); el alta del ERP (0,90 €/kg) valora 1.790 € de más y se cotejará con la factura.'],
  ['Fuentes primarias', 'Laadbon 1184057 (HG) · entrada ERP 16986 (neto 23.589, taras cartón 0,72/palet 22 confirmadas) · control de calidad de Raquel (16,45/15,40 kg/caja) · palets_cab del ERP del 28-08 (solo lectura) · informe del calibrador del lote 26082701 (llegó solo a las 12:45; el parte del 28 se creó y analizó automáticamente) · pesos de fin de día de planta (regla de JM).'],
  ['Cierres que dan confianza', 'El balance global cierra al 0,67% (157 kg de hueco en 23.589). Las salidas netas suman lo consumido exacto. El Sizer pesa +3,2% sobre báscula (sesgo conocido, estable). Dos fuentes independientes dan el mismo peso medio de caja de entrada (Raquel 16,45 y báscula 16,38).'],
  ['Lo estimado, marcado', 'Envase 0,0378 (v5; despiezar con precios actuales). Suministros 600 €/día. Estructura con la referencia histórica del forfait 17-18 (0,0213) hasta cargar los apuntes reales. El personal del día 1 ya es REAL (fichero del reloj del 28-08: 28 fichados, 176,2 h; Raquel/Sergio/Eusebio parciales); el "a régimen" usa el estándar por régimen.'],
  ['Aviso de datos', 'El ERP tiene los PRE dados de alta en bruto (492/173; los netos son 402/148): ~115 kg de tara de box como fruta en el GSTOCK del parte. Y el pre-1 de planta (178) no coincide con el del ERP (173): 5 kg de lectura.'],
  ['Pendiente que afina', 'Asistencia real (lunes) · destino y precio del pre y la CAT 2 · factura de HG · coste de limpieza de box · gramaje: pesar 10 cajas a salida y repesarlas a 24/48 h para fijar el objetivo contra la merma en tránsito.'],
], [30, 155])

const salida = path.resolve('outputs/Analisis_Camion_SAF_dia1.xlsx')
fs.writeFileSync(salida, XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }))
console.log('Escrito:', salida)
console.log(`Consumido ${consumido} · volcado ${volcado} (${cajasVolcadas.toFixed(1)} cajas) · sobrante ${sobranteNeto} · hueco ${hueco.toFixed(1)} (${pct(hueco, CAMION.netoKg)})`)
console.log(`Malla ${kgCajaReal.toFixed(4)} kg/caja · regalado ${regaladoTotal} (evitable ${regaladoEvitable.toFixed(1)})`)
console.log(`Podrido ${podridoReal} (${pct(podridoReal, consumido)}) · descarte ${descarte} (${pct(descarte, consumido)}) · aprovechamiento ${pct(ERP.malla, consumido)}`)
console.log(`Coste día lleno ${costeRegimen.toFixed(4)} · día 1 real ${costeHoy.toFixed(4)} · suelo c/estructura ${(costeRegimen + ESTRUCTURA_HIST).toFixed(4)}`)

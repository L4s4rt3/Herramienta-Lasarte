// SUMINISTROS REALES — de las facturas fotografiadas (89 fotos leídas el 28-08)
// y los extractos contables de las carpetas FACTURAS HERRAMIENTA.
// Todo son BASES imponibles (sin IVA), que es como computan en costes.
// Genera: outputs/Suministros_Reales.xlsx
// Ejecutar: node node_modules/vite-node/vite-node.mjs scripts/suministros-reales.ts

import * as XLSX from 'xlsx'
import * as fs from 'fs'
import * as path from 'path'

// Campaña 24-25 (extractos contables XLS: cuentas 628002000/628000000 + listado Astigi)
const C2425 = {
  luz: { sep: 3195.09, oct: 2366.48, nov: 6131.09, dic: 9084.09, ene: 8402.17, feb: 9211.57, mar: 7071.39, abr: 6458.96, may: 7907.63, jun: 9522.05, jul: 14666.54, ago: 7408.22 },
  aguaBimestral: { 'sep-oct': 552.78, 'nov-dic': 931.08, 'ene-feb': 1398.95, 'mar-abr': 2998.03, 'may-jun': 1607.28, 'jul-ago': 1951.97 },
  gasoil: { nov: 1898.19, dic: 2899.80, ene: 3835.95, feb: 3109.95, mar: 2552.75, abr: 2077.12, may: 1458.51, jun: 813.50, jul: 824.25, ago: 222.00 },
}
// Campaña 25-26 (facturas fotografiadas + extracto sep25-abr26; luz de mayo fotografiada)
const C2526 = {
  luz: { sep: 2051.99, oct: 3181.73, nov: 7923.92, dic: 11028.18, ene: 9066.35, feb: 14049.48, mar: 12496.47, abr: 8152.19, may: 9596.90 },
  aguaBimestral: { 'sep-oct': 603.98, 'nov-dic': 1370.23, 'ene-feb': 1346.58, 'mar-abr': 1332.98 },
  gasoil: { oct: 750.75, nov: 2055.83, dic: 2512.90, ene: 3528.45, feb: 3673.96, mar: 6483.54, abr: 5086.92, may: 2787.47 },
}
const suma = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0)

const luz2425 = suma(C2425.luz), agua2425 = suma(C2425.aguaBimestral), gas2425 = suma(C2425.gasoil)
const luz2526 = suma(C2526.luz), agua2526 = suma(C2526.aguaBimestral), gas2526 = suma(C2526.gasoil)
// Comparable interanual: sep→may
const sepMay = ['sep', 'oct', 'nov', 'dic', 'ene', 'feb', 'mar', 'abr', 'may']
const luz2425sm = sepMay.reduce((s, m) => s + (C2425.luz[m] ?? 0), 0)
const gas2425sm = sepMay.reduce((s, m) => s + (C2425.gasoil[m] ?? 0), 0)
const agua2425sm = 552.78 + 931.08 + 1398.95 + 2998.03 // sep-abr (bimestral)
const total2425sm = luz2425sm + gas2425sm + agua2425sm
const total2526sm = luz2526 + gas2526 + agua2526

const wb = XLSX.utils.book_new()
const aoa = (name: string, rows: (string | number | null)[][], widths: number[]) => {
  const ws = XLSX.utils.aoa_to_sheet(rows)
  ws['!cols'] = widths.map(wch => ({ wch }))
  XLSX.utils.book_append_sheet(wb, ws, name)
}

aoa('Resumen', [
  ['SUMINISTROS REALES — LO QUE DICEN LAS FACTURAS (bases sin IVA)'],
  ['Fuente: 89 fotos de facturas + extractos contables (carpetas FACTURAS HERRAMIENTA), leídas y cruzadas el 28-08-2026'],
  [],
  ['', 'Campaña 24-25 (año completo)', 'Campaña 25-26 (sep→may, lo que hay)'],
  ['Electricidad (Endesa, contrato 6.1TD)', Math.round(luz2425), Math.round(luz2526)],
  ['Agua (Aqua Campiña + Ayto. Écija + ARE Retortillo)', Math.round(agua2425), Math.round(agua2526) + 0],
  ['Gasoil (Astigi/Repsol, agrodiesel)', Math.round(gas2425), Math.round(gas2526)],
  ['TOTAL', Math.round(luz2425 + agua2425 + gas2425), Math.round(total2526sm)],
  [],
  ['LA COMPARACIÓN JUSTA (mismos meses, sep→may)', Math.round(total2425sm), Math.round(total2526sm)],
  ['Subida interanual', '', `+${(100 * (total2526sm / total2425sm - 1)).toFixed(0)}% (luz +${(100 * (luz2526 / luz2425sm - 1)).toFixed(0)}%, gasoil +${(100 * (gas2526 / gas2425sm - 1)).toFixed(0)}%)`],
  [],
  ['EN €/DÍA Y €/KG', ''],
  ['Media 25-26 por día laborable (~200 días sep-may)', `${Math.round(total2526sm / 200)} €/día`],
  ['Pico de campaña (feb-26: luz 14.049 + gasoil 3.674 + agua ~673)', '~900 €/día laborable'],
  ['Valle (sep-oct)', '~150-200 €/día'],
  ['Por kg (campaña ~19 M kg)', `${(total2526sm / 19000000).toFixed(4)} €/kg`],
  [],
  ['VEREDICTO SOBRE LOS 600 €/día DE LA METODOLOGÍA v5', ''],
  ['Para luz+agua+gasoil el 600 es un buen promedio (real ~546, pico ~900, valle ~180).', ''],
  ['PERO no incluye cera/jabón/postcosecha: esas facturas (Citrosol, etc.) NO están en estas carpetas.', ''],
  ['En el forfait 17-18 la postcosecha pesaba 0,0124 €/kg — MÁS que luz+agua+gasoil juntos (0,005).', ''],
  ['Para los días SAF casi no importa (la fruta viene tratada y encerada de origen, sin drencher).', ''],
  ['Para la campaña nacional, el sumando de suministros+consumibles real es ~el doble del 600.', ''],
], [56, 34, 44])

aoa('Luz por mes', [
  ['ELECTRICIDAD ENDESA — BASE MENSUAL (€)'],
  ['Mes', 'Campaña 24-25', 'Campaña 25-26', 'Interanual'],
  ...sepMay.concat(['jun', 'jul', 'ago']).map(m => {
    const a = C2425.luz[m] ?? null, b = C2526.luz[m] ?? null
    return [m, a, b, a && b ? `${(100 * (b / a - 1)).toFixed(0)}%` : '']
  }),
  ['TOTAL', Math.round(luz2425), Math.round(luz2526), ''],
  [],
  ['La estacionalidad manda: dic-mar (cámaras + frío) cuesta 4-6 veces el valle de sep-oct.', '', '', ''],
  ['feb-26 fue el mes récord: 14.049 € de base (+53% vs feb-25), con 2.096 € solo de excesos de potencia', '', '', ''],
  ['— ese exceso de potencia es revisable con la comercializadora (ajustar potencia contratada).', '', '', ''],
  ['Rarezas detectadas: facturas cortas por cambio de contrato (nov-24 en dos tramos, jul-25 en dos', '', '', ''],
  ['quincenas); sep-24 aún a nombre de LASARTE S.A.T.; 6 facturas menores de ~30 € (196278-196292).', '', '', ''],
], [14, 16, 16, 12])

aoa('Agua y gasoil', [
  ['AGUA (recibo bimestral, tres emisores en uno: Aqua Campiña + Ayto. + ARE)'],
  ['Bimestre', '24-25', '25-26'],
  ...['sep-oct', 'nov-dic', 'ene-feb', 'mar-abr', 'may-jun', 'jul-ago'].map(b => [b, C2425.aguaBimestral[b] ?? null, C2526.aguaBimestral[b] ?? null]),
  ['TOTAL', Math.round(agua2425), Math.round(agua2526)],
  ['El titular del contrato es ECIFRUIT S.A.T. (destinatario Lasarte): herencia histórica.', '', ''],
  [],
  ['GASOIL (Astigi/Repsol, agrodiesel para carretillas)'],
  ['Mes', '24-25', '25-26'],
  ...['sep', 'oct', 'nov', 'dic', 'ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago'].map(m => [m, C2425.gasoil[m] ?? null, C2526.gasoil[m] ?? null]),
  ['TOTAL', Math.round(gas2425), Math.round(gas2526)],
  [],
  ['El gasoil 25-26 (26.880 en 9 meses) ya supera el año entero 24-25 (19.692): +51% interanual', '', ''],
  ['— más actividad de carretilla y el precio de marzo-26 a 1,21 €/L (vs 0,72-0,87 habitual).', '', ''],
  ['OJO IVA del gasoil: ene/feb-26 al 21% y mar/abr/may-26 al 10% — preguntar a la gestoría cuál', '', ''],
  ['es el bueno (si el 10% es correcto, en ene-feb se pagó IVA de más).', '', ''],
], [16, 14, 14])

aoa('Huecos y notas', [
  ['LO QUE FALTA O CHIRRÍA (para cerrar la serie)'],
  [],
  ['1', 'Agua feb-26: el extracto contable registra la factura P0018958 (1.346,58) — fotografiada ✓; falta el bimestre may-jun-26 (aún no facturado o sin foto).'],
  ['2', 'Luz: faltan las portadas de oct-24, feb-25, mar-25, jun-26+ (solo están sus páginas de consumos o el apunte contable). Los importes salen del extracto: la serie está completa igual.'],
  ['3', 'Postcosecha/cera/jabón: NINGUNA factura en estas carpetas (Citrosol, Fomesa…). Es el hueco gordo del coste de suministros de la campaña nacional.'],
  ['4', 'Envases (cartón, malla, Ecoenvases): tampoco están aquí — siguen pendientes (la duda del precio por millar de Ecoenvases viene de atrás).'],
  ['5', 'IVA del gasoil inconsistente entre meses (21% vs 10%): consultar gestoría.'],
  ['6', 'El agua va a nombre de ECIFRUIT S.A.T. y la luz de sep-24 a nombre de LASARTE S.A.T. — herencias de titularidad.'],
  [],
  ['PROPUESTA', 'cargar estas series como apuntes mensuales en la herramienta (tabla cmv_costes_mensuales) para que el CMV y el suelo de venta usen el dato real por mes en vez de la constante de 600 €/día. Se hace en cuanto lo confirmes.'],
], [10, 150])

const salida = path.resolve('outputs/Suministros_Reales.xlsx')
fs.writeFileSync(salida, XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }))
console.log('Escrito:', salida)
console.log(`24-25: luz ${Math.round(luz2425)} + agua ${Math.round(agua2425)} + gasoil ${Math.round(gas2425)} = ${Math.round(luz2425 + agua2425 + gas2425)}`)
console.log(`25-26 sep-may: luz ${Math.round(luz2526)} + agua ${Math.round(agua2526)} + gasoil ${Math.round(gas2526)} = ${Math.round(total2526sm)} (${(100 * (total2526sm / total2425sm - 1)).toFixed(1)}% vs mismos meses 24-25: ${Math.round(total2425sm)})`)

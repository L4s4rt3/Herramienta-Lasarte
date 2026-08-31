// EXCEL PARA JOSÉ MARÍA — Análisis del camión SAF 1, día 1 (28-08-2026)
// Versión SOLO COSTES (sin tarifa, sin márgenes, SIN estructura) con formato
// profesional (exceljs). Datos verificados: ver scripts/analisis-camion-saf.ts.
// Genera: outputs/Coste_Camion_SAF_JM.xlsx
// Ejecutar: node node_modules/vite-node/vite-node.mjs scripts/excel-camion-saf-jm.ts

import ExcelJS from 'exceljs'
import * as path from 'path'

// ─── Paleta ──────────────────────────────────────────────────────────────────
const VERDE = 'FF1E5B3C' // cabeceras
const VERDE_CLARO = 'FFE7F2EA' // franjas
const AMBAR = 'FFFFF3D6' // avisos
const GRIS = 'FFF5F5F5'
const BORDE = { style: 'thin' as const, color: { argb: 'FFCCCCCC' } }
const BORDES = { top: BORDE, bottom: BORDE, left: BORDE, right: BORDE }

const wb = new ExcelJS.Workbook()
wb.creator = 'Lasarte Cítricos S.L.'
wb.created = new Date('2026-08-28T18:00:00')

type Fila = (string | number | null)[]

function hoja(nombre: string, anchos: number[]) {
  const ws = wb.addWorksheet(nombre, { views: [{ showGridLines: false }] })
  ws.columns = anchos.map(w => ({ width: w }))
  return ws
}

function titulo(ws: ExcelJS.Worksheet, texto: string, sub: string, nCols: number) {
  const r1 = ws.addRow([texto])
  ws.mergeCells(r1.number, 1, r1.number, nCols)
  r1.getCell(1).font = { bold: true, size: 15, color: { argb: 'FFFFFFFF' } }
  r1.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: VERDE } }
  r1.getCell(1).alignment = { vertical: 'middle', indent: 1 }
  r1.height = 28
  const r2 = ws.addRow([sub])
  ws.mergeCells(r2.number, 1, r2.number, nCols)
  r2.getCell(1).font = { size: 10, italic: true, color: { argb: 'FF555555' } }
  r2.getCell(1).alignment = { indent: 1 }
  ws.addRow([])
}

function seccion(ws: ExcelJS.Worksheet, texto: string, nCols: number) {
  const r = ws.addRow([texto])
  ws.mergeCells(r.number, 1, r.number, nCols)
  r.getCell(1).font = { bold: true, size: 11, color: { argb: VERDE } }
  r.getCell(1).border = { bottom: { style: 'medium', color: { argb: VERDE } } }
  r.height = 20
  r.getCell(1).alignment = { vertical: 'bottom' }
}

function tabla(ws: ExcelJS.Worksheet, cab: string[], filas: Fila[], opts: {
  numFmt?: Record<number, string>, resaltar?: number[], aviso?: number[], alinDer?: number[],
} = {}) {
  const rCab = ws.addRow(cab)
  rCab.eachCell((c) => {
    c.font = { bold: true, size: 10, color: { argb: 'FFFFFFFF' } }
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: VERDE } }
    c.border = BORDES
    c.alignment = { vertical: 'middle', wrapText: true }
  })
  filas.forEach((f, i) => {
    const r = ws.addRow(f)
    const esTotal = opts.resaltar?.includes(i)
    const esAviso = opts.aviso?.includes(i)
    r.eachCell({ includeEmpty: true }, (c, col) => {
      if (col > cab.length) return
      c.border = BORDES
      c.alignment = { vertical: 'top', wrapText: true, horizontal: opts.alinDer?.includes(col) ? 'right' : 'left' }
      if (opts.numFmt?.[col] && typeof c.value === 'number') c.numFmt = opts.numFmt[col]
      if (esTotal) { c.font = { bold: true }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: VERDE_CLARO } } }
      else if (esAviso) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AMBAR } }
      else if (i % 2 === 1) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GRIS } }
    })
  })
  ws.addRow([])
}

function nota(ws: ExcelJS.Worksheet, texto: string, nCols: number) {
  const r = ws.addRow([texto])
  ws.mergeCells(r.number, 1, r.number, nCols)
  r.getCell(1).font = { size: 9, italic: true, color: { argb: 'FF666666' } }
  r.getCell(1).alignment = { wrapText: true }
}

// ═══ 1. RESUMEN ═══════════════════════════════════════════════════════════
{
  const ws = hoja('Resumen', [42, 16, 78])
  titulo(ws, 'CAMIÓN SAF 1 — COSTES DEL PRIMER DÍA DE CONFECCIÓN', 'Lasarte Cítricos S.L. · 28-08-2026 · lote 26082701 · datos verificados de ERP, calibrador, planta y documentos de compra', 3)

  seccion(ws, 'LOS NÚMEROS DEL DÍA', 3)
  tabla(ws, ['Concepto', 'Valor', 'En una frase'],
    [
      ['Fruta puesta en almacén', '0,96 €/kg', '13,50 €/caja de compra + 3.200 € de porte, entre 23.589 kg netos de báscula'],
      ['COSTE DEL KG VENDIDO (día 1)', '1,21 €/kg', '14,56 €/caja · 3,64 €/malla — con la asistencia y los kilos reales del día'],
      ['Podrido real', '90,5 kg (0,5%)', 'Bolsa 65 + máquina 25,5. El «1,7%» que circulaba era descarte de media mañana, no podrido'],
      ['Descarte (pre-1, pre-2, cítrica, bolsa)', '621 kg (3,7%)', 'Mujeres 234 + tamaño; el pre se reaprovecha, no es pérdida completa'],
      ['Kg regalados en la malla', '597 kg (573 €)', '300 obligados por los 3,06 kg exigidos + 297 EVITABLES (285 €)'],
      ['Aprovechamiento a malla', '93,7%', 'De cada 100 kg consumidos, 93,7 acabaron en malla vendible'],
      ['Producción del día', '15.573 kg de malla', '24 palets × 52 cajas, con 176,2 horas de plantilla (28 fichados)'],
    ],
    { resaltar: [1], alinDer: [2] })

  seccion(ws, 'LO QUE SE VIO EN EL DÍA', 3)
  tabla(ws, ['Observación', 'Dato', 'Detalle'],
    [
      ['Sobrellenado por encima de lo exigido', '297 kg (285 €)', 'La línea echa 3.120 g/malla y lo exigido son 3.060: bajar la consigna ~50 g. La enmalladora es muy estable (12,40–12,60 kg/caja): sin riesgo de caja corta'],
      ['Horas que no produjeron kilos', '660 kg/persona', 'El desmonte sobre la marcha, la limpieza de graneleras y la única tanda de línea (05:46-12:36) repartieron los sueldos del día entre pocos kilos'],
      ['Fruta parada', '~3.000 kg', 'CAT 2 sin desmontar (2.464 kg) + pre (550 kg), pagados a 0,96 €/kg, esperando destino'],
    ],
    { alinDer: [2] })
  nota(ws, 'No incluye estructura (alquiler, seguros, amortización): se añadirá cuando haya apuntes fiables de este año. Tampoco el valor que se recupere del pre y de la CAT 2 al venderlos.', 3)
}

// ═══ 2. COSTE POR KG ═════════════════════════════════════════════════════
{
  const ws = hoja('Coste por kg', [44, 14, 82])
  titulo(ws, 'EL COSTE DEL DÍA, ESCALÓN A ESCALÓN', 'Por kg FACTURADO a Mercadona (la caja se factura a 12 kg = 4 mallas de 3 kg) · datos reales del 28-08', 3)

  tabla(ws, ['Escalón', '€/kg', 'Cómo se calcula'],
    [
      ['Fruta puesta en almacén', 0.9598, '(19.440 € de fruta + 3.200 € de porte) ÷ 23.589 kg netos de nuestra báscula'],
      ['× consumo real: 1,0813 kg por kg facturado', 1.0378, 'Cada kg facturado consume 1 kg + 0,040 de sobrellenado + 0,041 de descarte. El reciclaje no se consume: vuelve a línea'],
      ['+ Envase (malla + caja)', 0.0378, 'Coste de material por kg de la metodología de rentabilidad de la herramienta'],
      ['+ Trabajadores del día', 0.0978, 'Las 176,2 horas del reloj = 1.465 € (tarifa conocida por trabajador, y 8,34 €/h donde no la hay) ÷ 14.976 kg facturados'],
      ['+ Suministros (luz, agua, gasoil)', 0.0401, '600 €/día (validado con las facturas del año) ÷ los kg del día'],
      ['= COSTE DEL KG VENDIDO, DÍA 1', 1.2135, ''],
      ['   … por caja de 12 kg', 14.56, ''],
      ['   … por malla de 3 kg', 3.64, ''],
    ],
    { numFmt: { 2: '#,##0.0000' }, resaltar: [5, 6, 7], alinDer: [2] })

  nota(ws, 'La estructura (alquiler, seguros, amortización) NO está incluida: los apuntes fiables de este año están pendientes. El coste de trabajadores y suministros por kg depende de los kilos que salgan cada día: este es el del 28-08 con sus 15 t.', 3)
}

// ═══ 3. BALANCE DEL CAMIÓN ═══════════════════════════════════════════════
{
  const ws = hoja('Balance del camión', [46, 14, 80])
  titulo(ws, 'EL CAMIÓN, KILO A KILO (fin de día 28-08)', 'Pesos de planta en bruto, destarados con box pequeño (30 kg/box) — la hipótesis confirmada que hace cuadrar el balance', 3)

  tabla(ws, ['Concepto', 'kg', 'Cómo se sabe'],
    [
      ['Camión completo (neto de báscula)', 23589, 'Entrada 16986 del ERP; taras confirmadas (cartón 0,72 · palet 22)'],
      ['CAT 2 sin desmontar', 2464, '160 cajas SweetSpot × 15,40 kg (control de calidad)'],
      ['VOLCADO a box — la CAT 1 entera', 20967.5, 'Equivale a 1.275 cajas de 16,45 kg ≈ las 1.280 de CAT 1 (dif. 0,4%)'],
      ['Hueco del balance', 157.5, '0,67 % — derrames, redondeos y dispersión de taras'],
      ['DEL VOLCADO — consumido por la línea:', 16619, 'Suma exacta de las seis salidas de abajo'],
      ['   · a malla Mercadona (24 palets × 52 cajas)', 15573, 'ERP palets_cab, palets PESADOS de verdad'],
      ['   · a pre-2 (mujeres 233,8 + tamaño)', 402, 'Planta: 3 box, 492 brutos − tara'],
      ['   · a pre-1', 148, 'Planta: 1 box, 178 brutos − tara'],
      ['   · a cítrica/industria', 6, 'ERP'],
      ['   · a reciclaje (VUELVE a línea)', 425, 'Planta: 4 box, 545 brutos − tara'],
      ['   · podrido de bolsa', 65, 'Planta (de hoy, del SAF)'],
      ['Sobrante en box, por hacer', 4348.5, '22 box × 197,7 kg de fruta (5.008,5 brutos pesados por pies)'],
    ],
    { numFmt: { 2: '#,##0.0' }, resaltar: [0, 4], alinDer: [2] })

  seccion(ws, 'BOX Y CAJAS ECHADOS (la pregunta del grupo)', 3)
  tabla(ws, ['', 'Cantidad', 'Detalle'],
    [
      ['Cajas de cartón volcadas', '1.280', 'La CAT 1 completa'],
      ['Box llenados en el desmonte', '~106', 'A 197,7 kg de fruta por box (llenado real medido en los 22 sobrantes)'],
      ['Box echados a línea', '~84', 'Los llenados menos los 22 que quedan'],
    ],
    { alinDer: [2] })
  nota(ws, 'Contraste con el calibrador: el Sizer midió 17.146,5 kg en el lote 26082701, un +3,0% sobre la báscula — el sesgo conocido de la máquina, las dos fuentes cuentan lo mismo. Aviso: el ERP dio de alta los pre en bruto (492/173); los netos son 402/148.', 3)
}

// ═══ 4. MERMA DE VENTA ═══════════════════════════════════════════════════
{
  const ws = hoja('Merma de venta', [22, 15, 15, 15, 19, 19])
  titulo(ws, 'LA MERMA DE VENTA, MEDIDA EN LOS 24 PALETS DEL ERP', 'Mercadona factura la malla a 3,00 kg y EXIGE entregar al menos 3,06 kg — los palets se pesan de verdad', 6)

  tabla(ws, ['Nivel', 'Real', 'Facturado', 'Exigido (3,06)', 'Exceso vs facturado', 'Exceso vs exigido'],
    [
      ['Por malla', '3.120 g', '3.000 g', '3.060 g', '+120 g  (+4,0%)', '+60 g  (+2,0%)'],
      ['Por caja (4 mallas)', '12,478 kg', '12,000 kg', '12,240 kg', '+0,478 kg', '+0,238 kg'],
      ['Por palet (52 cajas)', '648,9 kg', '624,0 kg', '636,5 kg', '+24,9 kg', '+12,4 kg'],
      ['Día completo (1.248 cajas)', '15.573 kg', '14.976 kg', '15.275 kg', '+597 kg', '+298 kg'],
    ],
    { resaltar: [3], alinDer: [2, 3, 4, 5, 6] })

  seccion(ws, 'KG REGALADOS HOY', 6)
  tabla(ws, ['', 'kg', '€ (a 0,96 €/kg)', '', '', ''],
    [
      ['Total regalado (real − facturado)', 597, 573, '', '', ''],
      ['Obligado por el mínimo de 3,06', 300, 287, '', '', ''],
      ['EVITABLE (por encima de lo exigido)', 297, 285, '', '', ''],
    ],
    { numFmt: { 2: '#,##0', 3: '#,##0' }, aviso: [2], alinDer: [2, 3] })
  nota(ws, 'La enmalladora es muy estable: los 24 palets salieron entre 12,40 y 12,60 kg/caja, y el más bajo aún lleva +41 g/malla sobre lo exigido. Se puede bajar la consigna de 3.120 a ~3.070 g/malla sin riesgo de caja corta. A 70-80 t/semana, lo evitable son ~1.500 €/semana.', 6)
}

// ═══ 5. PODRIDO Y DESCARTE ═══════════════════════════════════════════════
{
  const ws = hoja('Podrido y descarte', [44, 12, 20, 22, 18])
  titulo(ws, 'PODRIDO Y DESCARTE — TRES BASES DE CÁLCULO', 'Sobre lo consumido por la línea (16.619 kg), sobre la CAT 1 volcada (20.968 kg) y sobre el camión (23.589 kg)', 5)

  tabla(ws, ['Concepto', 'kg', '% de lo consumido', '% de la 1ª volcada', '% del camión'],
    [
      ['PODRIDO REAL (bolsa 65 + máquina 25,5)', 90.5, '0,54%', '0,43%', '0,38%'],
      ['Pre-2 (mujeres 233,8 + tamaño)', 402, '2,42%', '1,92%', '1,70%'],
      ['Pre-1', 148, '0,89%', '0,71%', '0,63%'],
      ['Cítrica / industria', 6, '0,04%', '0,03%', '0,03%'],
      ['DESCARTE TOTAL', 621, '3,74%', '2,97%', '2,63%'],
      ['Reciclaje (no es pérdida: vuelve a línea)', 425, '2,56%', '—', '—'],
    ],
    { numFmt: { 2: '#,##0.0' }, resaltar: [0, 4], alinDer: [2, 3, 4, 5] })

  seccion(ws, 'EL «1,7%», ACLARADO', 5)
  nota(ws, 'El 1,7% que circulaba era la foto de MEDIA MAÑANA del descarte a pre-2 (166 kg sobre ~9,8 t procesadas hasta ese momento), y era DESCARTE, no podrido. A día cerrado: el descarte total es el 3,7% y el podrido de verdad, el 0,5%. La fruta SAF viene muy sana — coherente con el control de calidad de la llegada (evolutivos ~1%).', 5)
  ws.addRow([])
  nota(ws, 'Según el calibrador (por clases): exportación 94,8% · no exportación 3,4% · mujeres 1,4% · no comercial 0,5%.', 5)
}

// ═══ 6. METODOLOGÍA ══════════════════════════════════════════════════════
{
  const ws = hoja('Metodología', [30, 108])
  titulo(ws, 'DE DÓNDE SALE CADA DATO', 'Nada estimado en silencio: lo medido se dice, lo supuesto está marcado', 2)

  tabla(ws, ['Fuente', 'Qué aporta'],
    [
      ['Orden de carga de HG (Laadbon 1184057)', 'El precio real de compra: 13,50 €/caja × 1.440 cajas = 19.440 € + 3.200 € de transporte. Confirmado como base (el alta provisional del ERP, a 0,90 €/kg, valora 1.790 € de más — cotejar con la factura)'],
      ['Entrada 16986 del ERP', 'El neto del camión: 23.589 kg (báscula propia menos taras confirmadas: cartón 0,72 kg y palet 22 kg)'],
      ['Palets del ERP (28-08)', '24 palets × 52 cajas de malla, PESADOS: 15.573 kg netos → 12,478 kg/caja medido. También pre-1/pre-2/cítrica'],
      ['Informe del calibrador (lote 26082701)', 'Llegó solo por correo a las 12:45 y el parte del día se creó y analizó automáticamente. 17.146,5 kg por clases; mujeres 233,8; podrido máquina 25,5'],
      ['Planta, fin de día (regla de JM)', 'Los pesos por pies del sobrante (5.008,5 brutos, 22 box), reciclaje (545), pre-2 (492), pre-1 (178) y podrido de bolsa (65). Confirmado: brutos, box pequeño (tara 30)'],
      ['Reloj de asistencia (28-08)', '28 fichados, 176,2 horas → 1.465 € de personal del día (tarifas conocidas por trabajador y 8,34 €/h donde no la hay)'],
      ['Control de calidad de la llegada (Raquel)', 'Peso medio por caja de entrada: 16,45 kg la CAT 1, 15,40 la CAT 2 — cuadra con los 16,38 de báscula'],
      ['Facturas de suministros (89 leídas)', 'El 600 €/día de luz+agua+gasoil validado contra el año real (media 546 €/día)'],
    ],
    {})

  seccion(ws, 'COMPROBACIONES QUE DAN CONFIANZA', 2)
  tabla(ws, ['Cierre', 'Resultado'],
    [
      ['Balance global del camión', 'Cierra al 0,67% (157 kg de hueco sobre 23.589)'],
      ['Suma de salidas vs consumido', 'Exacta al kilo'],
      ['Sizer vs báscula', '+3,0%, el sesgo conocido de la máquina'],
      ['Peso de caja de entrada, por dos vías', 'Raquel 16,45 vs báscula 16,38 — dos fuentes independientes'],
    ],
    {})
  nota(ws, 'NO incluido a propósito: la estructura (alquiler, seguros, amortización — sin apuntes fiables de este año todavía), el valor que se recupere del pre y de la CAT 2 al venderlos, y el porte a plataforma si lo hubiera.', 2)
}

const salida = path.resolve('outputs/Coste_Camion_SAF_JM.xlsx')
await wb.xlsx.writeFile(salida)
console.log('Escrito:', salida)

// Control de descarga del primer camión SAF (27-08-2026, lote 26082701)
// Cruza tres fuentes: la hoja manuscrita de descarga (báscula propia, palet a palet),
// las etiquetas de los palets (bruto declarado por el exportador, del SAF.md del dueño)
// y la entrada oficial del ERP (neto declarado vs neto báscula).
// Genera: outputs/Control_Descarga_SAF_2026-08-27_final.xlsx
// Ejecutar: node node_modules/vite-node/vite-node.mjs scripts/control-descarga-saf.ts
// Para el siguiente camión: copiar este archivo, cambiar OFICIAL/ERP/PALETS.

import * as XLSX from 'xlsx'
import * as fs from 'fs'
import * as path from 'path'

// ---------- Entrada oficial (ERP, 27/08/2026) ----------
const OFICIAL = {
  fecha: '27/08/2026',
  ntraRef: '16986',
  suRef: '1184057',
  lote: '26082701',
  netoDeclarado: 23589, // kg (packing / proveedor)
  netoBascula: 23607, // kg (nuestra báscula, taras descontadas)
  pesoMedioCaja: 16.38, // kg netos por caja
  cajas: 1440,
  calibres: [
    { calibre: 'Valencia C.56', cajas: 880 },
    { calibre: 'Valencia C.64', cajas: 240 },
    { calibre: 'Valencia C.72', cajas: 160 },
    { calibre: 'Valencia C.64-72', cajas: 160 },
  ],
}

// ---------- Lo que dice el ERP (consulta de solo lectura, tmp/consulta-entrada-saf.mjs) ----------
const ERP = {
  proveedor: '400001090 — LASARTE EXPORT S.L. Harrie Goesten',
  transportista: 'TRANSAYSA S.C.A. · matrículas 2040KFL / R5828BBK',
  horaEntrada: '12:52', horaSalida: '13:42',
  pedido: '1207', contrato: '1271', finca: '330', parcela: '1323',
  articulo: '10003806 — NARANJA MIDKNIGHT SAF',
  brutoCamion: 25022, // kg: carga 43.220 − tara camión 18.198 (basculas_pesadas)
  precioKg: 0.9, // €/kg sobre el neto declarado (ent_prov_lin_imp), IVA 4%
  importeFruta: 21230.10, // €
  importeTransporte: 3200, // €
}
const KG_NOMINAL_CAJA = 15 // cartón A15C
const TARA_BOX_PALET1 = 210 // 6 box grandes (35 kg) del trasvase
const TARA_CARTON_PALET1 = 127 // 80 cartones + palet que declara su etiqueta

// ---------- Palet a palet ----------
// brutoPropia = hoja manuscrita "CONTROL DESCARGA DE IMPORTACIÓN" (nuestra pesada)
// brutoEtiqueta = "Pallet Weight" de la etiqueta (SAF.md del dueño, foto por palet)
type Palet = {
  id: number
  marca: string
  cajas: number
  cat: string
  calibre: string
  brutoPropia: number
  brutoEtiqueta: number
  origen: string // pack ref / huerto confirmado en foto legible; '' = sin confirmar
  nota: string
}

const PALETS: Palet[] = [
  { id: 1, marca: 'SweetSpot', cajas: 80, cat: 'II', calibre: '6/72', brutoPropia: 1418, brutoEtiqueta: 1335, origen: '', nota: 'Llegó con las 80 cajas desmontadas: trasvasado a 6 box en descarga (la pesada propia lleva tara de box, no de cartón)' },
  { id: 2, marca: 'PrimOre', cajas: 80, cat: 'I', calibre: '4/56', brutoPropia: 1394.5, brutoEtiqueta: 1401, origen: '', nota: '' },
  { id: 3, marca: 'PrimOre', cajas: 80, cat: 'I', calibre: '4/56', brutoPropia: 1405.5, brutoEtiqueta: 1410, origen: '', nota: '' },
  { id: 4, marca: 'PrimOre', cajas: 80, cat: 'I', calibre: '4/56', brutoPropia: 1383, brutoEtiqueta: 1387, origen: '9102 / V7', nota: 'SSCC 160099005084112484' },
  { id: 5, marca: 'PrimOre', cajas: 80, cat: 'I', calibre: '4/56', brutoPropia: 1368, brutoEtiqueta: 1385, origen: '9102 / V7', nota: 'SSCC 160099005084112491' },
  { id: 6, marca: 'PrimOre', cajas: 80, cat: 'I', calibre: '4/56', brutoPropia: 1410, brutoEtiqueta: 1418, origen: '9102 / V7', nota: 'SSCC 160099005084112620; peso corregido en el papel (se lee 1410)' },
  { id: 7, marca: 'PrimOre', cajas: 80, cat: 'I', calibre: '4/56', brutoPropia: 1460.5, brutoEtiqueta: 1489.5, origen: '8602 / MMK', nota: 'SSCC 060099004344637791' },
  { id: 8, marca: 'PrimOre', cajas: 80, cat: 'I', calibre: '4/56', brutoPropia: 1381, brutoEtiqueta: 1382, origen: '', nota: '' },
  { id: 9, marca: 'PrimOre', cajas: 80, cat: 'I', calibre: '4/56', brutoPropia: 1481.5, brutoEtiqueta: 1495, origen: '', nota: '' },
  { id: 10, marca: 'PrimOre', cajas: 80, cat: 'I', calibre: '4/56', brutoPropia: 1464.5, brutoEtiqueta: 1496, origen: '', nota: '' },
  { id: 11, marca: 'PrimOre', cajas: 80, cat: 'I', calibre: '4/56', brutoPropia: 1476, brutoEtiqueta: 1498.5, origen: '8602 / MMK', nota: '' },
  { id: 12, marca: 'PrimOre', cajas: 80, cat: 'I', calibre: '5/64 y 6/72', brutoPropia: 1365, brutoEtiqueta: 1369, origen: '', nota: '' },
  { id: 13, marca: 'DOLE', cajas: 80, cat: 'I', calibre: '5/64', brutoPropia: 1335.5, brutoEtiqueta: 1367, origen: '', nota: '' },
  { id: 14, marca: 'DOLE', cajas: 80, cat: 'I', calibre: '5/64', brutoPropia: 1328.5, brutoEtiqueta: 1362, origen: '', nota: '' },
  { id: 15, marca: 'PrimOre', cajas: 80, cat: 'I', calibre: '5/64 y 6/72', brutoPropia: 1358, brutoEtiqueta: 1362, origen: '', nota: '' },
  { id: 16, marca: 'PrimOre', cajas: 80, cat: 'I', calibre: '5/64', brutoPropia: 1361.5, brutoEtiqueta: 1369, origen: '', nota: '' },
  { id: 17, marca: 'PrimOre', cajas: 80, cat: 'I', calibre: '4/56', brutoPropia: 1424, brutoEtiqueta: 1424, origen: '', nota: 'La categoría en el papel tiene el trazo dudoso (¿I o II?); calibre con tachón, se lee 4/56' },
  { id: 18, marca: 'SweetSpot', cajas: 80, cat: 'II', calibre: '6/72', brutoPropia: 1312, brutoEtiqueta: 1328, origen: '', nota: '' },
]

// ---------- Cuentas ----------
const r1 = (n: number) => Math.round(n * 10) / 10
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)

const totalPropia = sum(PALETS.map(p => p.brutoPropia))
const totalEtiqueta = sum(PALETS.map(p => p.brutoEtiqueta))
const difTotal = r1(totalPropia - totalEtiqueta)
const sinP1 = PALETS.filter(p => p.id !== 1)
const difSinP1 = r1(sum(sinP1.map(p => p.brutoPropia)) - sum(sinP1.map(p => p.brutoEtiqueta)))
const etiquetaSinP1 = sum(sinP1.map(p => p.brutoEtiqueta))

const totalCajas = sum(PALETS.map(p => p.cajas))
const difNetos = OFICIAL.netoBascula - OFICIAL.netoDeclarado
const kgExtraSobreNominal = OFICIAL.netoDeclarado - OFICIAL.cajas * KG_NOMINAL_CAJA
// Tara de envases que aplicó el ERP para pasar del bruto de camión al neto
const taraErp = r1(ERP.brutoCamion - OFICIAL.netoBascula)
// La suma de palets, corregida del trasvase del palet 1 (pesado con tara de
// box en vez de la de cartones), para poder compararla con la báscula de camión
const sumaPaletsCorregida = r1(totalPropia - (TARA_BOX_PALET1 - TARA_CARTON_PALET1))
const difBasculas = r1(sumaPaletsCorregida - ERP.brutoCamion)

// Cajas por calibre según la hoja (para casar con el desglose oficial)
const cajasHojaPorCalibre: Record<string, number> = {
  'Valencia C.56': sum(PALETS.filter(p => p.calibre === '4/56').map(p => p.cajas)),
  'Valencia C.64': sum(PALETS.filter(p => p.calibre === '5/64').map(p => p.cajas)),
  'Valencia C.72': sum(PALETS.filter(p => p.calibre === '6/72').map(p => p.cajas)),
  'Valencia C.64-72': sum(PALETS.filter(p => p.calibre === '5/64 y 6/72').map(p => p.cajas)),
}

// Coste real según el ERP
const costeTotal = ERP.importeFruta + ERP.importeTransporte
const eurKgPuesto = costeTotal / OFICIAL.netoDeclarado
const eurCajaPuesto = costeTotal / OFICIAL.cajas

// ---------- Precio REAL ----------
// VERIFICADO 28-08 contra el ERP: las taras SÍ están, como artículos del alta:
//   10003770 CAJA CARTON 15 KG TELESCOPICO GENERICO → peso_neto 0,720 (genérico, alta 2021)
//   100000698 PALET IMPORTACION → peso_neto 22,000 (CREADO el 27-08 12:56 en este alta)
// Comprobación: 25.022 − (1.440×0,72 + 18×22 = 1.432,8) = 23.589,2 → el neto
// facturable sale de NUESTRA báscula con estas taras: se paga lo que llega.
// El "Peso Neto Báscula" 23.607 usa palet 21 (25.022 − 1.036,8 − 378 = 23.607,2):
// los "+18 kg a favor" del primer análisis eran 18 palets × 1 kg de tara, no fruta.
// CONFIRMADAS por el dueño el 28-08: son los pesos reales.
const TARA_CARTON_ERP = 0.72
const TARA_PALET_ERP = 22

// ---------- Excel ----------
const wb = XLSX.utils.book_new()
const aoa = (name: string, rows: (string | number | null)[][], widths: number[]) => {
  const ws = XLSX.utils.aoa_to_sheet(rows)
  ws['!cols'] = widths.map(wch => ({ wch }))
  XLSX.utils.book_append_sheet(wb, ws, name)
}

// --- Resumen ---
aoa('Resumen', [
  ['CONTROL DE DESCARGA — PRIMER CAMIÓN SAF'],
  ['Lasarte Cítricos S.L. · 27/08/2026 · Lote 26082701 · Ntra. ref. 16986 · Su ref. 1184057'],
  [],
  ['VEREDICTO: la entrada CUADRA', ''],
  ['Cajas descargadas vs packing', `${totalCajas} de ${OFICIAL.cajas} — exacto, también calibre a calibre`],
  ['Neto facturable (23.589 kg)', 'sale de NUESTRA báscula de camión (25.022) menos las taras del ERP (cartón 0,72 × 1.440 + palet 22 × 18): se paga lo que llega'],
  ['Los "+18 kg" entre neto (23.589) y neto báscula (23.607)', 'no son fruta: el segundo campo usa palet de 21 kg en vez de 22 (18 palets × 1 kg) — detalle en la hoja "Precio real"'],
  [],
  ['LO PROBADO (dos básculas propias + etiquetas)', 'kg'],
  ['Bruto en báscula de camión (ERP: carga 43.220 − tara camión 18.198)', ERP.brutoCamion],
  ['Bruto palet a palet (hoja de descarga, 18 palets)', totalPropia],
  ['   · corregido del trasvase del palet 1 (tara de box en vez de cartones, −83 kg)', sumaPaletsCorregida],
  ['   · las dos pesadas propias cuadran entre sí', `${difBasculas > 0 ? '+' : ''}${difBasculas} kg (${(difBasculas / ERP.brutoCamion * 100).toFixed(2)}%)`],
  ['Bruto declarado en etiquetas (suma "Pallet Weight")', totalEtiqueta],
  ['Diferencia bruto propio − etiquetas (sin el palet 1)', `${difSinP1} kg (${(difSinP1 / etiquetaSinP1 * 100).toFixed(2)}%) — deshidratación del viaje + tolerancia de básculas`],
  ['Neto facturable (bruto camión − taras del ERP)', OFICIAL.netoDeclarado],
  ['Taras (CONFIRMADAS por el dueño 28-08)', 'cartón 0,72 kg (10003770) · palet importación 22 kg (100000698) → 1.432,8 kg en total'],
  [],
  ['LA CAJA VIENE LLENA DE MÁS', ''],
  ['Peso medio real por caja (oficial)', `${OFICIAL.pesoMedioCaja} kg`],
  ['Nominal del cartón A15C', `${KG_NOMINAL_CAJA} kg`],
  ['Exceso por caja', `${(OFICIAL.pesoMedioCaja - KG_NOMINAL_CAJA).toFixed(2)} kg (+${((OFICIAL.pesoMedioCaja / KG_NOMINAL_CAJA - 1) * 100).toFixed(1)}%)`],
  ['Kg extra en el camión sobre el nominal (23.589 − 1.440×15)', kgExtraSobreNominal],
  ['OJO: como la base es el kg neto, el exceso SE PAGA a 0,90 — no es fruta gratis, es más kg por camión', ''],
  ['Para la malla 3 kg importa igual: los kg por caja REALES son los que entran a confección', ''],
  [],
  ['COSTE REAL (del ERP: entrada 16986 · pedido 1207 · contrato 1271 · IVA 4%)', ''],
  [`Fruta: ${OFICIAL.netoDeclarado} kg netos × ${ERP.precioKg.toFixed(2)} €/kg`, `${ERP.importeFruta.toLocaleString('es-ES', { minimumFractionDigits: 2 })} €`],
  ['Transporte (Transaysa)', `${ERP.importeTransporte.toLocaleString('es-ES', { minimumFractionDigits: 2 })} € (${(ERP.importeTransporte / OFICIAL.netoDeclarado).toFixed(3)} €/kg)`],
  ['TOTAL puesto en almacén', `${costeTotal.toLocaleString('es-ES', { minimumFractionDigits: 2 })} € → ${eurKgPuesto.toFixed(3)} €/kg neto · ${eurCajaPuesto.toFixed(2)} €/caja`],
  ['El ~1,05 €/kg de la reunión era fruta + porte (0,90 + 0,136): confirmado', ''],
], [58, 72])

// --- Precio real ---
aoa('Precio real', [
  ['PRECIO REAL DEL CAMIÓN — CERRADO'],
  ['La regla del dueño: el coste es FIJO; si llega menos fruta de la pagada, pagamos de más por kg; si llega más, de menos.'],
  [],
  ['LAS TARAS SON LAS BUENAS (confirmadas por el dueño el 28-08)', ''],
  ['Cartón', 'artículo 10003770 — CAJA CARTON 15 KG TELESCOPICO · 0,720 kg · CONFIRMADO'],
  ['Palet', 'artículo 100000698 — PALET IMPORTACION · 22,000 kg · CONFIRMADO'],
  ['Comprobación al kilo', '25.022 bruto camión − (1.440×0,72 + 18×22 = 1.432,8) = 23.589,2 → el neto facturable (23.589) sale de NUESTRA báscula con las taras reales'],
  ['El "+18 kg a favor" del primer análisis era un espejismo', 'el campo "Peso Neto Báscula" (23.607) usa palet de 21 kg: 25.022 − 1.036,8 − 18×21 = 23.607,2. Son 18 palets × 1 kg de tara, no fruta.'],
  [],
  ['VEREDICTO', 'se paga EXACTAMENTE la fruta que llega, pesada en nuestra báscula con taras confirmadas. No hay cartón pagado como fruta.'],
  ['Pagado', `${OFICIAL.netoDeclarado} kg × ${ERP.precioKg.toFixed(2)} € = ${ERP.importeFruta.toLocaleString('es-ES', { minimumFractionDigits: 2 })} € de fruta + ${ERP.importeTransporte.toLocaleString('es-ES')} € de porte = ${costeTotal.toLocaleString('es-ES', { minimumFractionDigits: 2 })} €`],
  ['COSTE REAL DE LA FRUTA, DEFINITIVO', `${eurKgPuesto.toFixed(4)} €/kg puesto en almacén · ${(ERP.importeFruta / OFICIAL.netoDeclarado).toFixed(2)} de fruta + ${(ERP.importeTransporte / OFICIAL.netoDeclarado).toFixed(3)} de porte · ${eurCajaPuesto.toFixed(2)} €/caja de entrada`],
  [],
  ['Queda una capa más, cuando el calibrador procese el lote', 'el coste por kg VENDIBLE: al 1,0357 hay que cargarle el destrío real (~1% según el control de calidad ⇒ ~1,046 €/kg vendible) y apartar el CAT 2'],
], [62, 100])

// --- Palets ---
aoa('Palets', [
  ['Id', 'Marca', 'Cajas', 'Cat', 'Calibre', 'Bruto báscula propia (kg)', 'Bruto etiqueta (kg)', 'Dif (kg)', 'Dif %', 'Origen (pack/huerto)', 'Nota'],
  ...PALETS.map(p => [
    p.id, p.marca, p.cajas, p.cat, p.calibre, p.brutoPropia, p.brutoEtiqueta,
    r1(p.brutoPropia - p.brutoEtiqueta),
    `${((p.brutoPropia - p.brutoEtiqueta) / p.brutoEtiqueta * 100).toFixed(2)}%`,
    p.origen || 'sin confirmar', p.nota,
  ]),
  ['TOTAL', '', totalCajas, '', '', totalPropia, totalEtiqueta, difTotal, `${(difTotal / totalEtiqueta * 100).toFixed(2)}%`, '', ''],
  [],
  ['La pesada propia sale de la hoja manuscrita "Control descarga de importación"; la etiqueta es el "Pallet Weight" del exportador.'],
  ['El palet 1 pesa MÁS que su etiqueta porque se pesó ya trasvasado a 6 box (tara de box ≈ 210 kg, no de cartón): no es fruta de más.'],
  ['Los palets con más desvío a la baja: 14 (−33,5), 10 (−31,5), 13 (−31,5), 7 (−29), 11 (−22,5). Los dos DOLE y los dos MMK confirmados están entre ellos.'],
], [5, 11, 7, 5, 13, 22, 18, 9, 8, 20, 95])

// --- Calibres ---
aoa('Calibres', [
  ['Calibre', 'Cajas oficial (ERP)', 'Cajas según hoja de descarga', '¿Cuadra?', 'Palets de la hoja'],
  ...OFICIAL.calibres.map(c => {
    const hoja = cajasHojaPorCalibre[c.calibre] ?? 0
    const palets = PALETS.filter(p => ({
      'Valencia C.56': '4/56', 'Valencia C.64': '5/64', 'Valencia C.72': '6/72', 'Valencia C.64-72': '5/64 y 6/72',
    }[c.calibre] === p.calibre)).map(p => p.id).join(', ')
    return [c.calibre, c.cajas, hoja, hoja === c.cajas ? 'SÍ' : 'NO', palets]
  }),
  ['TOTAL', OFICIAL.cajas, totalCajas, totalCajas === OFICIAL.cajas ? 'SÍ' : 'NO', ''],
], [18, 18, 26, 9, 30])

// --- Trazabilidad ---
aoa('Trazabilidad', [
  ['TRAZABILIDAD DEL CAMIÓN (de las etiquetas de palet y caja)'],
  [],
  ['Variedad', 'MIDKNIGHTS (tipo Valencia), naranja'],
  ['Exportador', 'Dole South Africa (PTY) Ltd, 26 Bella Rosa Street, Bellville 7530, Sudáfrica · GLN/COC 6009644340002'],
  ['Marcas', 'PrimOre (PRMOR, cat. I), DOLE (cat. I), SweetSpot (cat. II)'],
  ['Cartón', 'A15C (nominal 15 kg) · 80 cajas/palet · GTIN 4051826586113 · mercado destino EU'],
  [],
  ['Hay DOS orígenes (huertos) en el camión, con tratamiento distinto:', ''],
  ['Pack ref 9102 — huerto V7', 'PUC D15435 · GGN 4059883430516 · PHC/depot D15869 · tratado con IMAZALIL y cera (E903, E904)'],
  ['Pack ref 8602 — huerto MMK', 'PUC D6813 · GGN 4049929470804 · PHC/depot D5026 · tratado con IMAZALIL, TIABENDAZOL y cera (E903, E904)'],
  [],
  ['Palets con origen confirmado por foto', '4, 5, 6 → 9102/V7 · 7, 11 → 8602/MMK · resto: la foto no deja leer el pack ref (se puede completar otro día con las fotos originales)'],
  ['SSCC leídos', 'palet 4: 160099005084112484 · palet 5: 160099005084112491 · palet 6: 160099005084112620 · palet 7: 060099004344637791'],
  [],
  ['OJO para el reporte de calidad y Mercadona:', 'dos recetas fitosanitarias en el mismo camión (el huerto MMK lleva además tiabendazol). Conviene saber qué palets van a malla 3 kg de cada origen.'],
  [],
  ['ENTRADA EN EL ERP (alta de JESUS, contabilizada el 27-08, certificada)', ''],
  ['Proveedor', ERP.proveedor],
  ['Transporte', `${ERP.transportista} · ${ERP.importeTransporte.toLocaleString('es-ES')} €`],
  ['Horario en fábrica', `entrada ${ERP.horaEntrada} · salida ${ERP.horaSalida} (50 min: pesada, descarga y control)`],
  ['Documentos', `entrada ${OFICIAL.ntraRef} · albarán proveedor ${OFICIAL.suRef} · pedido ${ERP.pedido} · contrato ${ERP.contrato} · lote ${OFICIAL.lote}`],
  ['Artículo y origen ERP', `${ERP.articulo} · finca ${ERP.finca} / parcela ${ERP.parcela} · 1.440 cajas · 18 palets`],
], [42, 115])

// --- Calidad a la llegada (Raquel, 27-08) ---
// Fuente: CONTROL CALIDAD 1184057-26082701 CAT 1 / CAT 2 (.docx)
aoa('Calidad', [
  ['CONTROL DE CALIDAD A LA LLEGADA — Raquel Rubio Martín, 27/08/2026'],
  ['(el control que se hará de cada camión; muestreos sobre 200 piezas)'],
  [],
  ['', 'CAT 1 (PrimOre/DSA · 4/56, 5/64, 6/72)', 'CAT 2 (SweetSpot · 6/72)'],
  ['Temperatura de llegada', '7,0 °C', '6,9 °C'],
  ['Peso medio de caja', '16,45 kg', '15,40 kg'],
  ['Etiquetado', 'OK', 'OK'],
  ['Tratamientos declarados', 'Imazalil, ceras E-903/E-904', 'Imazalil, ceras E-903/E-904'],
  ['Defectos leves', 'rameado 4% · cicatriz 1%', 'RAMEADO 45% · trip 1,5%'],
  ['Defectos graves', 'deformación 0,5%', 'saltamontes 1,5%'],
  ['Defectos EVOLUTIVOS', 'podrido 0,5% · pinchazo 0,5%', 'podrido 1,5% · rajado 1,5% · pinchazo 1% (piezas completamente podridas)'],
  ['% Zumo (ref >40-42)', '42 / 40,35', '40,7'],
  ['Brix (ref 10-16)', '12,2 / 10,4', '11,3'],
  ['Acidez (ref 0,7-1,1)', '0,97 / 0,93', '1,08'],
  ['Índice de madurez (ref 10-18)', '12,6 / 11,1', '10,5'],
  ['Observaciones', 'Piel limpia, sin daños destacables. Calibres correctos (el 4/56 con piezas en el límite superior). ALGUNAS PIEZAS CON PEPITAS (1-2).', 'Gran porcentaje de rameados de distinta intensidad. Calibres correctos.'],
  [],
  ['CRUCES CON LA DESCARGA', ''],
  ['Kg totales del control (23.589)', 'coincide con el neto facturable del ERP'],
  ['Peso medio de caja ponderado (1.280 cajas CAT 1 × 16,45 + 160 CAT 2 × 15,40)', '16,33 kg — coherente con el 16,38 oficial'],
  ['GGN apuntado en CAT 1', '4059883430516 / 4050373064518 — el segundo NO aparece en las etiquetas fotografiadas (allí el segundo huerto era GGN 4049929470804/MMK): confirmar con Raquel de qué caja lo tomó'],
  [],
  ['LO QUE ESTO CAMBIA EN LA CUENTA', ''],
  ['Destrío evolutivo a la llegada ~1% en CAT 1 y ~4% en CAT 2', 'la cuenta de la malla asumía 0: cada punto de destrío quita ~0,011 €/kg de margen (la malla 3 kg baja de +0,071 a ~+0,060 con el 1%)'],
  ['El CAT 2 (SweetSpot, 45% rameado) es cosmético con interna correcta', 'no es fruta de malla Mercadona: mejor destino nacional/industria — son 160 cajas, 2 palets'],
  ['PEPITAS en Midknight (CAT 1)', 'vigilar en el reporte de Mercadona: la malla 3 kg es Midknight/Seedless y las pepitas son motivo de queja'],
], [66, 48, 62])

// --- Notas ---
aoa('Notas', [
  ['QUÉ ES PROBADO Y QUÉ ES ESTIMADO'],
  ['Probado', 'Pesadas palet a palet de nuestra hoja; báscula de camión, netos, precio (0,90 €/kg) y porte (3.200 €) leídos del ERP (entrada 16986, solo lectura); desglose por calibre oficial; datos de etiquetas fotografiadas.'],
  ['Estimado / por confirmar', 'El origen (pack ref) de 13 de los 18 palets; la categoría del palet 17 (trazo dudoso); el GGN 4050373064518 del control de calidad. Las taras YA NO: confirmadas 0,72/22 el 28-08.'],
  [],
  ['DUDAS DE LECTURA DEL PAPEL'],
  ['Palet 6', 'peso corregido encima en el papel; se toma 1410 kg'],
  ['Palet 17', 'categoría con trazo dudoso (¿I o II?) y calibre con tachón (se lee 4/56); el peso coincide exacto con la etiqueta (1424)'],
  [],
  ['CÓMO SIGUE'],
  ['0', 'Taras: RESUELTO 28-08 — el dueño confirma cartón 0,72 y palet 22. El precio real queda cerrado en 1,0357 €/kg puesto (hoja "Precio real")'],
  ['1', 'Cotejar la factura cuando llegue: debe decir 21.230,10 € de fruta (23.589 kg × 0,90) + 3.200 € de porte, IVA 4%'],
  ['2', 'Reporte de calidad a la llegada: HECHO por Raquel el 27-08 (hoja "Calidad") — queda confirmar el GGN 4050373064518 que no casa con las etiquetas'],
  ['3', 'El lote 26082701 entra en los flujos de siempre (parte diario, trazabilidad) al procesarse en el calibrador'],
  ['4', 'Los dos camiones SAF que faltan: misma hoja de control y mismo contraste — y que la encargada rellene la columna NTRA. TZ (tara)'],
], [28, 120])

const salida = path.resolve('outputs/Control_Descarga_SAF_2026-08-27_final.xlsx')
fs.writeFileSync(salida, XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }))

console.log('Escrito:', salida)
console.log(`Palets: ${PALETS.length} · cajas ${totalCajas}/${OFICIAL.cajas}`)
console.log(`Bruto propio ${totalPropia} kg vs etiquetas ${totalEtiqueta} kg → ${difTotal} kg (sin palet 1: ${difSinP1} kg)`)
console.log(`Neto báscula ${OFICIAL.netoBascula} vs declarado ${OFICIAL.netoDeclarado} → ${difNetos > 0 ? '+' : ''}${difNetos} kg`)
console.log(`Camión ${ERP.brutoCamion} vs palets corregidos ${sumaPaletsCorregida} → ${difBasculas > 0 ? '+' : ''}${difBasculas} kg · taras ERP ${(OFICIAL.cajas * TARA_CARTON_ERP + PALETS.length * TARA_PALET_ERP).toFixed(1)} kg (cartón ${TARA_CARTON_ERP} · palet ${TARA_PALET_ERP})`)
console.log(`Coste: ${ERP.importeFruta} + ${ERP.importeTransporte} porte = ${costeTotal} € → ${eurKgPuesto.toFixed(3)} €/kg · ${eurCajaPuesto.toFixed(2)} €/caja`)

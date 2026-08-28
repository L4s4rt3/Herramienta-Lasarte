// La cuenta de la malla 3 kg SAF — ¿cuánto deja cada formato Mercadona con
// fruta de importación a 1,036 €/kg puesta en almacén?
//
// Fuentes (todas reales, nada estimado en silencio):
//   - Fruta: entrada ERP 16986 (21.230,10 € + 3.200 € porte) / 23.589 kg netos
//   - Tarifa Mercadona: mercadona_semana_metodos S30 y S31/2026 (idénticas
//     las dos semanas = tarifa, no facturación parcial)
//   - Envase €/kg por formato: ENVASE_EUR_KG de la metodología v5
//     (supabase/functions/_shared/rentabilidadDia.ts)
//   - Personal: 8,34 €/h × 7 h (COSTE_HORA_MEDIO_DEFECTO v5) sobre el
//     estándar kg/persona POR RÉGIMEN fijado el 27-08
//   - Suministros: 600 €/día (v5) repartidos por los kg del día
//   - Sobrellenado: +100 g por malla (política actual, reunión 27-08)
// NO incluye: estructura (alquiler/seguros), limpieza de box (sin coste aún)
// ni porte a plataforma Mercadona. El margen es ANTES de eso, como el v5.
//
// Genera: outputs/Cuenta_Malla_SAF.xlsx
// Ejecutar: node node_modules/vite-node/vite-node.mjs scripts/cuenta-malla-saf.ts

import * as XLSX from 'xlsx'
import * as fs from 'fs'
import * as path from 'path'

// ---------- Constantes con su fuente ----------
const FRUTA_EUR = 21230.10 + 3200 // camión 1 completo, puesto en almacén
const FRUTA_KG = 23589
const FRUTA_PUESTO = FRUTA_EUR / FRUTA_KG // 1,0357 €/kg

const COSTE_PERSONA_DIA = 8.34 * 7 // 58,38 €/persona·día (v5)
const SUMINISTROS_DIA = 600 // €/día (v5)

// Estándar por régimen (27-08) + el mejor día medido del análisis tipo-día
const RENDIMIENTOS = [
  { nombre: 'Media plantilla en OBJETIVO (2.600 kg/p)', kgP: 2600, presentes: 28 },
  { nombre: 'Media plantilla en SUELO (2.200 kg/p)', kgP: 2200, presentes: 28 },
  { nombre: 'Plantilla completa en suelo (1.700 kg/p)', kgP: 1700, presentes: 45 },
]
const RENDIMIENTO_BASE = RENDIMIENTOS[0]

// Formatos Mercadona: tarifa real + envase v5 + sobrellenado actual
type Formato = {
  metodo: string
  nombre: string
  precio: number // €/kg tarifa S30-31
  envaseKg: number // €/kg (ENVASE_EUR_KG v5)
  kgNominalMalla: number | null // formato de la pieza; null = granel en caja
  sobrellenadoKg: number // kg de más por pieza (política +100 g/malla)
}
const FORMATOS: Formato[] = [
  { metodo: 'MA3KGC', nombre: 'Malla 3 kg', precio: 1.21, envaseKg: 0.0378, kgNominalMalla: 3, sobrellenadoKg: 0.1 },
  { metodo: 'MA4KGC', nombre: 'Malla 4 kg (exprimidor)', precio: 0.86, envaseKg: 0.045, kgNominalMalla: 4, sobrellenadoKg: 0.1 },
  { metodo: 'MA5KGC', nombre: 'Malla 5 kg', precio: 0.99, envaseKg: 0.0485, kgNominalMalla: 5, sobrellenadoKg: 0.1 },
  { metodo: 'MA12KGC', nombre: 'Caja 12 kg (granel)', precio: 1.41, envaseKg: 0.02, kgNominalMalla: null, sobrellenadoKg: 0 },
]

// ---------- El modelo ----------
// Todo por KG VENDIDO (lo que factura Mercadona). El sobrellenado hace que
// cada kg vendido consuma más de un kg de fruta.
const factorFruta = (f: Formato) =>
  f.kgNominalMalla ? (f.kgNominalMalla + f.sobrellenadoKg) / f.kgNominalMalla : 1

const cuenta = (f: Formato, kgP: number, presentes: number) => {
  const fruta = FRUTA_PUESTO * factorFruta(f)
  const personal = COSTE_PERSONA_DIA / kgP
  const suministros = SUMINISTROS_DIA / (presentes * kgP)
  const coste = fruta + f.envaseKg + personal + suministros
  return { fruta, envase: f.envaseKg, personal, suministros, coste, margenKg: f.precio - coste }
}

// Fruta máxima que aguanta cada formato (margen 0) con el rendimiento base
const frutaMaxima = (f: Formato) => {
  const personal = COSTE_PERSONA_DIA / RENDIMIENTO_BASE.kgP
  const suministros = SUMINISTROS_DIA / (RENDIMIENTO_BASE.presentes * RENDIMIENTO_BASE.kgP)
  return (f.precio - f.envaseKg - personal - suministros) / factorFruta(f)
}

const r4 = (n: number) => Number(n.toFixed(4))
const r0 = (n: number) => Math.round(n)

// ---------- Excel ----------
const wb = XLSX.utils.book_new()
const aoa = (name: string, rows: (string | number | null)[][], widths: number[]) => {
  const ws = XLSX.utils.aoa_to_sheet(rows)
  ws['!cols'] = widths.map(wch => ({ wch }))
  XLSX.utils.book_append_sheet(wb, ws, name)
}

// --- Resumen: la cuenta de la malla 3 kg ---
const m3 = FORMATOS[0]
const base = cuenta(m3, RENDIMIENTO_BASE.kgP, RENDIMIENTO_BASE.presentes)
const kgVendiblesCamion = FRUTA_KG / factorFruta(m3)
const margenCamionBase = kgVendiblesCamion * base.margenKg

aoa('La cuenta', [
  ['LA CUENTA DE LA MALLA 3 KG CON FRUTA SAF (por kg vendido a Mercadona)'],
  ['Lasarte Cítricos S.L. · 28-08-2026 · fruta del camión 1 (lote 26082701)'],
  [],
  ['', '€/kg vendido'],
  ['Ingreso (tarifa Mercadona S30-31)', m3.precio],
  [`Fruta (1,0357 €/kg puesto × ${factorFruta(m3).toFixed(4)} por el sobrellenado de +100 g/malla)`, -r4(base.fruta)],
  ['Envase (malla girsac + caja, metodología v5)', -r4(base.envase)],
  [`Personal (58,38 €/persona·día ÷ ${RENDIMIENTO_BASE.kgP} kg/p — media plantilla en objetivo)`, -r4(base.personal)],
  [`Suministros (600 €/día ÷ ${RENDIMIENTO_BASE.presentes} p × ${RENDIMIENTO_BASE.kgP} kg/p)`, -r4(base.suministros)],
  ['MARGEN', r4(base.margenKg)],
  [],
  ['En cristiano', ''],
  ['Por malla de 3 kg', `${(base.margenKg * 3).toFixed(2)} €`],
  ['Por caja (4 mallas, 12 kg)', `${(base.margenKg * 12).toFixed(2)} €`],
  [`Por camión SAF entero a malla 3 kg (${r0(kgVendiblesCamion)} kg vendibles)`, `${r0(margenCamionBase).toLocaleString('es-ES')} €`],
  ['Por semana Mercadona (70-80 t de malla 3 kg)', `${r0(70000 * base.margenKg).toLocaleString('es-ES')}–${r0(80000 * base.margenKg).toLocaleString('es-ES')} €`],
  [],
  ['Y según el rendimiento del día (la palanca de planta):', ''],
  ...RENDIMIENTOS.map(r => {
    const c = cuenta(m3, r.kgP, r.presentes)
    return [r.nombre, `${r4(c.margenKg)} €/kg → ${r0(kgVendiblesCamion * c.margenKg).toLocaleString('es-ES')} € por camión`]
  }),
  [`Rendimiento de EQUILIBRIO (margen 0) con esta fruta`, `${r0(COSTE_PERSONA_DIA / (m3.precio - base.fruta - base.envase - base.suministros))} kg/persona — muy por debajo de cualquier día real: el personal NO es el cuello de la malla 3 kg`],
  [],
  ['El margen es ANTES de estructura (alquiler, seguros), limpieza de box y porte a plataforma si lo hay — igual que el v5.', ''],
], [78, 46])

// --- Por formato: dónde gana y dónde pierde la fruta SAF ---
aoa('Por formato', [
  ['LA MISMA FRUTA, LOS CUATRO FORMATOS MERCADONA — dónde aguanta el 1,036 €/kg'],
  ['(rendimiento base: media plantilla en objetivo, 2.600 kg/persona)'],
  [],
  ['Formato', 'Tarifa €/kg', 'Fruta €/kg', 'Envase', 'Personal', 'Suministros', 'MARGEN €/kg', 'Por camión SAF entero', 'Fruta máx. que aguanta (€/kg puesto)'],
  ...FORMATOS.map(f => {
    const c = cuenta(f, RENDIMIENTO_BASE.kgP, RENDIMIENTO_BASE.presentes)
    const kgVend = FRUTA_KG / factorFruta(f)
    return [f.nombre, f.precio, r4(c.fruta), r4(c.envase), r4(c.personal), r4(c.suministros), r4(c.margenKg), `${r0(kgVend * c.margenKg).toLocaleString('es-ES')} €`, r4(frutaMaxima(f))]
  }),
  [],
  ['LECTURA', 'Con fruta a 1,036 puesta, solo VIVEN la caja de 12 kg (+0,33 €/kg) y la malla 3 kg (+0,07). El 5 kg pierde ~0,15 €/kg y el 4 kg de exprimidor pierde ~0,28: cada kg de SAF que acabe ahí es dinero perdido seguro.'],
  ['Para el exprimidor (4 kg a 0,86)', `la fruta tendría que costar ≤ ${frutaMaxima(FORMATOS[1]).toFixed(2)} €/kg puesta (≈ ${(frutaMaxima(FORMATOS[1]) - 3200 / FRUTA_KG).toFixed(2)} sin porte) — la naranja de exprimidor hay que comprarla a otro precio, no usar la de 0,90`],
  ['La reunión ya lo apuntaba', '"el exprimidor con naranja de fuera": esta cuenta dice a qué precio máximo'],
], [26, 12, 11, 9, 10, 12, 12, 22, 34])

// --- Sobrellenado: ¿los +100 g valen lo que cuestan? ---
const costeSobrellenadoKg = base.fruta - FRUTA_PUESTO // €/kg vendido que cuesta el +100 g
const costeSobrellenadoCamion = kgVendiblesCamion * costeSobrellenadoKg
const mermaEquivalentePct = (costeSobrellenadoKg / m3.precio) * 100
aoa('Sobrellenado', [
  ['LOS +100 G POR MALLA: QUÉ CUESTAN Y CUÁNDO COMPENSAN'],
  [],
  ['Qué cuesta la política actual', ''],
  ['Fruta extra por kg vendido', `${r4(costeSobrellenadoKg)} €/kg (3,33% de fruta que se entrega y no se factura)`],
  ['Por camión SAF a malla 3 kg', `${r0(costeSobrellenadoCamion).toLocaleString('es-ES')} €`],
  ['Por semana Mercadona (70-80 t)', `${r0(70000 * costeSobrellenadoKg).toLocaleString('es-ES')}–${r0(80000 * costeSobrellenadoKg).toLocaleString('es-ES')} €`],
  [],
  ['Cuándo compensa', ''],
  ['La merma de venta que motiva la política es ~4% (reunión 27-08).', ''],
  [`El sobrellenado cuesta lo mismo que ${mermaEquivalentePct.toFixed(1)} puntos de merma de venta`, `si evita al menos ${mermaEquivalentePct.toFixed(1)} de los 4 puntos, COMPENSA; si la merma real con sobrellenado sigue >1%, se está pagando dos veces`],
  [],
  ['Lo que falta para cerrar esta cuenta', 'medir la merma de venta REAL de las semanas con sobrellenado (abonos de Mercadona) y el gramaje real de la malla (pesar 10 mallas a la salida de línea). Con esos dos números se ajusta el +100 a lo justo.'],
], [58, 62])

// --- Supuestos ---
aoa('Supuestos', [
  ['SUPUESTO', 'VALOR', 'FUENTE'],
  ['Fruta puesta en almacén', `${FRUTA_PUESTO.toFixed(4)} €/kg`, 'ERP entrada 16986: (21.230,10 + 3.200) / 23.589 kg'],
  ['Tarifa Mercadona', '1,21 / 0,86 / 0,99 / 1,41 €/kg', 'mercadona_semana_metodos S30 y S31/2026 (idénticas = tarifa); S29 y S32 descartadas por facturación parcial'],
  ['Envase €/kg', '0,0378 / 0,045 / 0,0485 / 0,02', 'ENVASE_EUR_KG, metodología v5 (_shared/rentabilidadDia.ts)'],
  ['Personal', '58,38 €/persona·día', '8,34 €/h × 7 h (v5); repartido por kg del día, sin índice de confección (v5 reparte plano; el CMV por producto ponderaría la malla algo peor)'],
  ['Rendimiento base', '2.600 kg/persona (media plantilla en objetivo)', 'estándar por régimen fijado el 27-08'],
  ['Suministros', '600 €/día', 'v5'],
  ['Sobrellenado', '+100 g por malla', 'política actual (reunión 27-08); en 4 y 5 kg se asume el mismo +100 g/malla'],
  ['Destrío de línea', 'NO incluido', 'SAF llega clase 1 preseleccionada; cuando el calibrador procese el lote 26082701 se mide y se mete (cada 1% de destrío quita ~0,011 €/kg de margen)'],
  ['Estructura / limpieza box / porte a plataforma', 'NO incluidos', 'igual que el v5: margen antes de estructura; la limpieza de box no tiene coste medido aún (parada desde 29-07, reactivada en la reunión)'],
  ['Kg por caja de malla 3 kg', '12 kg (4 mallas)', 'S32: 32.719 kg / 2.724 cajas = 12,01'],
], [34, 40, 105])

const salida = path.resolve('outputs/Cuenta_Malla_SAF.xlsx')
fs.writeFileSync(salida, XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }))

console.log('Escrito:', salida)
console.log(`Fruta puesta: ${FRUTA_PUESTO.toFixed(4)} €/kg`)
for (const f of FORMATOS) {
  const c = cuenta(f, RENDIMIENTO_BASE.kgP, RENDIMIENTO_BASE.presentes)
  console.log(`${f.nombre}: precio ${f.precio} − coste ${c.coste.toFixed(4)} = ${c.margenKg.toFixed(4)} €/kg · fruta máx ${frutaMaxima(f).toFixed(3)}`)
}
console.log(`Sobrellenado: ${costeSobrellenadoKg.toFixed(4)} €/kg vendido = ${r0(costeSobrellenadoCamion)} €/camión = ${mermaEquivalentePct.toFixed(1)} pts de merma equivalente`)

// El Excel de Entradas → «Campaña» (CampanaMermaMdna.tsx): las mismas hojas y
// columnas que scripts/analisis-mermas-mercadona.ts, pero a partir de lo que
// useCampanaMermaMdna YA tiene calculado. Aquí no se recalcula nada ni se toca
// la base: se proyectan las filas del hook a las columnas del informe y se
// descarga con el motor de marca (exportKit), como el resto de exports de la app.
//
// Dos diferencias con el Excel del script, dichas en la hoja «Metodología» para
// que nadie compare los dos ficheros sin saberlo:
// - El script simula la campaña CERRADA (todos los lotes abiertos cerrados en
//   memoria, regla del dueño 28-08-2026). La pantalla no lo hace, para no
//   enseñar como hecho lo que no está decidido: los lotes abiertos van como
//   «sin merma calculable» y se listan en «Cierre pendiente» con el modo de
//   cierre que les tocaría. Cuando se cierren en la base, los dos coinciden.
// - No hay hoja «Cobertura del mix» (se construye con lotes_dia × part_id, que
//   la pantalla no carga). En su lugar, «Metodología» dice cuántos lotes tienen
//   mix y de cuándo es el agregado.
import type { CampanaMermaMdna } from "@/hooks/useCampanaMermaMdna";
import {
  añadirHojaTabla,
  crearLibroLasarte,
  descargarLibro,
  FMT_EUR,
  FMT_INT,
  FMT_KG,
  FMT_PCT,
  formatearFechaHoraExportacion,
  type ColumnaTabla,
  type HojaTablaOptions,
  type LasarteExportMeta,
} from "./exportKit";
import { LABEL_MDNA, METODOS_MDNA } from "./mdnaMix";
import { TASA_MERMA_NATURAL_DIA } from "./mermaLote";
import {
  metricasMdna,
  metricasPerdida,
  pctONull,
  type FilaLoteMermaMdna,
  type GrupoMermaMdna,
} from "./mermaMdnaAgregado";

export interface OpcionesExportCampana {
  /** Lo que tenga marcado el interruptor de la pantalla: cambia las notas, no los números. */
  incluirImportacion: boolean;
  /** Correo de quien exporta, para el pie de marca. Nunca "Herramienta Lasarte": eso no va en documentos. */
  usuario?: string | null;
  /** Solo para tests deterministas (nombre del fichero y sello); por defecto ahora. */
  generadoEn?: Date;
}

// ─── Columnas (copiadas del script: mismos nombres, mismo orden) ──────────────

const kgCol = (header: string, key: string, width = 15): ColumnaTabla =>
  ({ header, key, tipo: "numero", numFmt: FMT_KG, width });
const pctCol = (header: string, key: string, width = 11): ColumnaTabla =>
  ({ header, key, tipo: "numero", numFmt: FMT_PCT, width });
const intCol = (header: string, key: string, width = 9): ColumnaTabla =>
  ({ header, key, tipo: "numero", numFmt: FMT_INT, width });

/** Columnas del ranking de PÉRDIDA (hojas «Productores» y «Fincas»); las claves son las de metricasPerdida. */
export function colsPerdida(conFinca: boolean): ColumnaTabla[] {
  return [
    { header: "Productor", key: "productor", width: 40 },
    ...(conFinca ? [{ header: "Finca", key: "finca", width: 28 } as ColumnaTabla] : []),
    intCol("Lotes", "nLotes"),
    intCol("Con merma calc.", "nLotesConMerma", 13),
    intCol("Sin merma calc.", "nLotesSinMerma", 13),
    kgCol("Kg entrada (todos)", "kgEntradaTotal", 17),
    kgCol("Kg entrada de lotes terminados", "kgEntradaBase", 22),
    intCol("Lotes sin pasada propia", "nLotesTodoAjuste", 16),
    { header: "Días cámara (medio)", key: "diasMedio", tipo: "numero", numFmt: "#,##0.0", width: 15 },
    kgCol("MERMA MEDIDA kg", "mermaMedidaKg", 16),
    kgCol("Merma cámara kg", "mermaCamaraKg"),
    pctCol("% merma cámara", "pctMermaCamara", 13),
    kgCol("Podrido pre-calibrador kg", "podridoPreKg", 20),
    pctCol("% podrido pre-cal.", "pctPodridoPre", 15),
    kgCol("Esperado por tasa del mes", "podridoPreEsperadoKg", 20),
    kgCol("No visto por la resta", "podridoPreNoVistoKg", 18),
    intCol("Lotes sin margen", "nLotesSinMargen", 13),
    kgCol("Kg procesados (conciliado)", "kgCalibrador", 21),
    kgCol("Podrido calibrador kg", "podridoCalibradorKg", 18),
    pctCol("% podrido calibrador", "pctPodridoCalibrador", 16),
    intCol("Lotes con podrido real", "nLotesPodridoReal", 16),
    kgCol("PÉRDIDA TOTAL kg", "perdidaKg", 17),
    kgCol("Base del % de pérdida", "kgBasePctPerdida", 18),
    pctCol("% PÉRDIDA TOTAL", "pctPerdida", 14),
    { header: "Pérdida €", key: "perdidaEur", tipo: "numero", numFmt: FMT_EUR, width: 15 },
    pctCol("% pérdida sobre coste", "pctPerdidaCoste", 16),
    kgCol("Podrido bolsa (prorrateo)", "podridoManualKg", 19),
  ];
}

/** Columnas del ranking de MERCADONA (hojas «Mercadona productores/fincas»); las claves son las de metricasMdna. */
export function colsMdna(conFinca: boolean): ColumnaTabla[] {
  return [
    { header: "Productor", key: "productor", width: 40 },
    ...(conFinca ? [{ header: "Finca", key: "finca", width: 28 } as ColumnaTabla] : []),
    intCol("Lotes", "nLotes"),
    intCol("Sin informe clasif.", "nLotesSinClasificacion", 14),
    kgCol("Kg entrada", "kgEntradaTotal", 16),
    kgCol("Kg procesados (conciliado)", "kgCalibrador", 21),
    kgCol("Kg clasificados (informe)", "kgClasificado", 20),
    pctCol("% exportación", "pctExportacion", 12),
    pctCol("% no exportación", "pctNoExportacion", 14),
    pctCol("% mujeres", "pctMujeres", 11),
    pctCol("% no comercial", "pctNoComercial", 13),
    pctCol("% clases aptas MDNA (A-F)", "pctClaseApta", 19),
    kgCol("MDNA malla 3 kg", "mdna3", 16),
    pctCol("% malla 3 kg", "pctMdna3", 12),
    kgCol("MDNA girsac 4 kg exprimidor", "mdna4", 22),
    pctCol("% girsac 4 kg", "pctMdna4", 12),
    kgCol("MDNA D-Pack 5 kg", "mdna5", 17),
    pctCol("% D-Pack 5 kg", "pctMdna5", 13),
    kgCol("MDNA granel", "mdna12", 14),
    pctCol("% granel", "pctMdna12", 10),
    kgCol("MDNA sin formato en el nombre", "mdnaSinFormato", 23),
    kgCol("TOTAL MDNA (sobre conciliado)", "mdnaTotalAjustado", 23),
    pctCol("% MDNA sobre entrada", "pctMdnaSobreEntrada", 17),
    pctCol("% MDNA sobre procesado", "pctMdnaSobreProcesado", 18),
    kgCol("TOTAL MDNA clasificado (papel)", "mdnaTotalClasificado", 24),
    kgCol("Apto A-F no vendido a MDNA", "kgAptoNoMdna", 21),
  ];
}

// ─── Filas ────────────────────────────────────────────────────────────────────

// Las métricas vienen tipadas de la lib compartida; añadirHojaTabla quiere
// objetos abiertos, así que se copian tal cual (mismos % que en la tabla).
const filaPerdida = (g: GrupoMermaMdna): Record<string, unknown> => ({ ...metricasPerdida(g) });
const filaMdna = (g: GrupoMermaMdna): Record<string, unknown> => ({ ...metricasMdna(g) });

/** Entero con separador de miles español, para los textos de las notas. */
const n0 = (v: number): string => Math.round(v).toLocaleString("es-ES");

/**
 * Lotes que de verdad siguen ABIERTOS en la base. `data.abiertos` es "sin merma
 * calculable", y ahí caen también los cerrados «sin registro» (su merma es null
 * a propósito): a esos no les falta nada por cerrar.
 */
export function lotesAbiertos(data: CampanaMermaMdna): FilaLoteMermaMdna[] {
  return data.abiertos.filter((f) => !f.cerradoSinRegistro);
}

function filasCascada(data: CampanaMermaMdna, incluirImportacion: boolean): Record<string, unknown>[] {
  const t = data.total;
  const abiertos = lotesAbiertos(data);
  const fuera = [
    ...(incluirImportacion ? [] : [`${data.importacion.length} de importación (Egipto y SAF)`]),
    `${data.internas.length} movimientos internos`,
    `${data.imposibles.length} con el apunte de ajuste roto`,
  ];
  const cascada: Array<[string, number | null, number | null, string]> = [
    ["Kg de entrada por báscula", t.kgEntradaTotal, 100, `${t.nLotes} lotes${incluirImportacion ? " (naranja propia e importación)" : " de naranja PROPIA"}. Fuera: ${fuera.join(", ")}. El precalibrado y los CAMPO/CIT ya vienen apartados de las entradas de báscula`],
    ["  · de ellos, con merma ya calculable", t.kgEntradaBase, pctONull(t.kgEntradaBase, t.kgEntradaTotal), `${t.nLotesConMerma} lotes terminados (cerrados en la base): la base de los % de merma y podrido de tría`],
    ["  · de ellos, aún sin merma calculable", t.kgEntradaTotal - t.kgEntradaBase, pctONull(t.kgEntradaTotal - t.kgEntradaBase, t.kgEntradaTotal), `${t.nLotesSinMerma} lotes: ${abiertos.length} siguen abiertos en la base (su hueco no cuenta como pérdida hasta que se cierren; ver «Cierre pendiente») y ${t.nLotesSinRegistro} están cerrados «sin registro» (su procesado no consta bajo su código: su hueco NO es pérdida)`],
    ["  · de ellos, sin ninguna pasada propia", t.kgAjuste, pctONull(t.kgAjuste, t.kgEntradaTotal), `${t.nLotesTodoAjuste} lotes cuya entrada entera es ajuste de stock (histórico ya contado): su merma es 0 de verdad, y baja el % de su productor`],
    ["MERMA MEDIDA (báscula − procesado)", t.mermaMedidaKg, pctONull(t.mermaMedidaKg, t.kgEntradaBase), "Lo que la báscula pesó y el calibrador nunca llegó a pesar. Se parte en las dos líneas de abajo"],
    ["  · merma de cámara (deshidratación)", t.mermaCamaraKg, pctONull(t.mermaCamaraKg, t.kgEntradaBase), `Real donde hay registro de cámara; si no, ${(TASA_MERMA_NATURAL_DIA * 100).toFixed(4)} % de la entrada por cada día en cámara`],
    ["  · podrido pre-calibrador (tría: bolsa + bateas)", t.podridoPreKg, pctONull(t.podridoPreKg, t.kgEntradaBase), "El resto de la merma medida. Deducido por resta lote a lote — las pesadas no se pueden repartir por lote"],
    ["      lo que la tasa del mes esperaría", t.podridoPreEsperadoKg, pctONull(t.podridoPreEsperadoKg, t.kgEntradaBase), "Referencia paralela: NO se suma a ninguna pérdida"],
    ["      lo que la resta NO ve", t.podridoPreNoVistoKg, pctONull(t.podridoPreNoVistoKg, t.kgEntradaBase), `${t.nLotesSinMargen} lotes «sin margen»: la resta colapsa a 0 aunque sí hubiera tría`],
    ["Kg procesados por el calibrador (conciliados)", t.kgCalibrador, pctONull(t.kgCalibrador, t.kgEntradaTotal), "Reparto conciliado de las pasadas, no la suma cruda del calibrador"],
    ["Podrido del calibrador", t.podridoCalibradorKg, pctONull(t.podridoCalibradorKg, t.kgBasePctPerdida), `Real en ${t.nLotesPodridoReal} lotes con Informe LOTE; prorrateo del parte en el resto`],
    ["PÉRDIDA TOTAL DE FRUTA", t.perdidaKg, pctONull(t.perdidaKg, t.kgBasePctPerdida), "Merma medida + podrido de calibrador. Cada kg cuenta una sola vez. El % va sobre la base de pérdida (ver Metodología)"],
    ["  · valorada al coste de compra", null, null, `${n0(t.perdidaEur)} € sobre ${n0(t.costeTotal)} € de coste de fruta (${(pctONull(t.perdidaEur, t.costeTotal) ?? 0).toFixed(2)} %)`],
    ["  · de ellos, podrido de la bolsa (prorrateo)", t.podridoManualKg, pctONull(t.podridoManualKg, t.kgEntradaBase), "DESGLOSE de la merma medida, NO un sumando: esa fruta se aparta antes del calibrador"],
    ["Kg clasificados en el Informe LOTE", t.kgClasificado, pctONull(t.kgClasificado, t.kgCalibrador), `Puede pasar del 100 % de lo conciliado porque el informe atribuye cada pasada al PRIMER código de su nombre. Por eso de aquí solo se toma el MIX, no los kg. ${t.nLotesSinClasificacion} lotes sin informe: sin mix conocido`],
    ["  · exportación", t.kgExportacion, pctONull(t.kgExportacion, t.kgClasificado), "% sobre lo clasificado"],
    ["  · no exportación", t.kgNoExportacion, pctONull(t.kgNoExportacion, t.kgClasificado), "% sobre lo clasificado"],
    ["  · mujeres", t.kgMujeres, pctONull(t.kgMujeres, t.kgClasificado), "% sobre lo clasificado"],
    ["  · no comercial (industria y podrido)", t.kgNoComercial, pctONull(t.kgNoComercial, t.kgClasificado), "% sobre lo clasificado"],
    ["  · clases aptas para Mercadona (A–F)", t.kgClaseApta, pctONull(t.kgClaseApta, t.kgClasificado), "Extra 1/2, Cat1 A/B, Verde Claro y Cat 2"],
    ...METODOS_MDNA.map((m): [string, number | null, number | null, string] => ([
      `MERCADONA · ${LABEL_MDNA[m]} (${m})`,
      t.mdnaAjustado[m],
      pctONull(t.mdnaAjustado[m], t.kgEntradaTotal),
      "% sobre los kg de entrada: el aprovechamiento real de campo a Mercadona",
    ])),
    ["MERCADONA · sin formato en el nombre", t.mdnaSinFormatoAjustado, pctONull(t.mdnaSinFormatoAjustado, t.kgEntradaTotal), "Dice MDNA pero el nombre no declara formato: no se reparte a ojo"],
    ["MERCADONA · TOTAL", t.mdnaTotalAjustado, pctONull(t.mdnaTotalAjustado, t.kgEntradaTotal), "De cada 100 kg que entran por báscula, los que acaban en Mercadona"],
    ["MERCADONA · TOTAL sobre lo YA procesado", t.mdnaTotalAjustado, pctONull(t.mdnaTotalAjustado, t.kgCalibrador), "El mismo total sin diluir con la fruta que sigue en cámara: es la cifra a comparar entre productores"],
    ["Apto A–F que NO fue a Mercadona", t.kgAptoNoMdna, pctONull(t.kgAptoNoMdna, t.kgClasificado), "Fruta con calidad de Mercadona vendida a otros clientes"],
  ];
  return cascada.map(([concepto, kg, pct, nota]) => ({ concepto, kg, pct, nota }));
}

/**
 * «Cierre pendiente»: los deberes en la base. Lotes abiertos (a los que falta
 * `cerrado_at`, con el modo que les tocaría) y lotes con el apunte de ajuste
 * roto (hay que corregirlo antes de poder cerrarlos). El script trae aquí la
 * merma que saldría al cerrar; la pantalla no simula el cierre, así que la
 * columna enseña la merma medida solo donde ya existe (null ≠ 0).
 */
function filasCierrePendiente(data: CampanaMermaMdna): Record<string, unknown>[] {
  const pendientes = [
    ...lotesAbiertos(data).map((f) => ({ f, roto: false })),
    ...data.imposibles.map((f) => ({ f, roto: true })),
  ];
  return pendientes
    .sort((a, b) => b.f.kgEntrada - a.f.kgEntrada)
    .map(({ f, roto }) => ({
      productor: f.productor, finca: f.finca, lote: f.lote, fecha: f.fecha,
      kgEntrada: f.kgEntrada, kgCalibrador: f.kgCalibrador,
      pctProcesado: pctONull(f.kgCalibrador + f.kgAjuste, f.kgEntrada),
      kgMerma: f.mermaMedidaKg,
      modo: roto ? "ARREGLAR ANTES" : f.kgCalibrador <= 0 ? "sin registro" : "con análisis",
      situacion: roto
        ? f.kgAjuste < 0
          ? `Ajuste de stock NEGATIVO (${n0(f.kgAjuste)} kg): al cerrarlo la merma saldría ${n0(f.kgEntrada - f.kgCalibrador - f.kgAjuste)} kg sobre ${n0(f.kgEntrada)} kg de entrada. Imposible: hay que corregir el apunte.`
          : `La merma medida (${n0(f.mermaMedidaKg ?? 0)} kg) supera su propia entrada (${n0(f.kgEntrada)} kg): físicamente imposible, hay que revisar el apunte.`
        : f.kgCalibrador <= 0
          ? "Ni una sola pasada bajo su código: se vendió sin procesar o pasó bajo el código de otro lote. Cerrar «sin registro» — su hueco NO es pérdida."
          : "Pasó parte y el resto no consta. Cerrar «con análisis»: el hueco es merma real.",
    }));
}

function filasDetalleLotes(data: CampanaMermaMdna): Record<string, unknown>[] {
  return data.filas
    .slice()
    .sort((a, b) => a.productor.localeCompare(b.productor, "es") || a.finca.localeCompare(b.finca, "es") || a.lote.localeCompare(b.lote))
    .map((f) => {
      // El mix del informe se lleva a los kg conciliados del lote (mismo factor
      // que usa la agregación); sin mix, vacío — nunca 0.
      const k = f.factorConciliado ?? 0;
      const mdnaTotal = f.mix ? f.mix.mdnaTotal * k : null;
      return {
        productor: f.productor, finca: f.finca, variedad: f.variedad, lote: f.lote, fecha: f.fecha,
        estado: f.cerradoSinRegistro ? "sin registro" : f.estado,
        diasEnCamara: f.diasEnCamara,
        kgEntrada: f.kgEntrada, kgCalibrador: f.kgCalibrador,
        mermaMedidaKg: f.mermaMedidaKg, mermaCamaraKg: f.mermaCamaraKg,
        camaraFuente: f.mermaCamaraKg == null ? "—" : f.mermaCamaraReal ? "real" : "estimada",
        podridoPreKg: f.podridoPreKg, podridoPreEsperadoKg: f.podridoPreEsperadoKg,
        sinMargenTxt: f.sinMargen ? "SÍ" : "",
        podridoCalibradorKg: f.podridoCalibradorKg, podridoCalibradorFuente: f.podridoCalibradorFuente,
        podridoManualKg: f.podridoManualKg,
        perdidaKg: f.perdidaKg, pctPerdida: pctONull(f.perdidaKg, f.kgEntrada),
        perdidaEur: f.perdidaEur,
        kgClasificado: f.mix?.kgClasificado ?? null,
        mdna3: f.mix ? f.mix.mdna.MA3KGC * k : null,
        mdna4: f.mix ? f.mix.mdna.MA4KGC * k : null,
        mdna5: f.mix ? f.mix.mdna.MA5KGC * k : null,
        mdna12: f.mix ? f.mix.mdna.MA12KGC * k : null,
        mdnaSinFormato: f.mix ? f.mix.mdnaSinFormato * k : null,
        mdnaTotalAjustado: mdnaTotal,
        pctMdnaEntrada: pctONull(mdnaTotal, f.kgEntrada),
      };
    });
}

function filasMetodologia(data: CampanaMermaMdna, incluirImportacion: boolean): Record<string, unknown>[] {
  const t = data.total;
  const abiertos = lotesAbiertos(data);
  const kgAbiertos = abiertos.reduce((s, f) => s + f.kgEntrada, 0);
  const kgImportacion = data.importacion.reduce((s, f) => s + f.kgEntrada, 0);
  const kgImposibles = data.imposibles.reduce((s, f) => s + f.kgEntrada, 0);
  const mesesPesados = data.podridoPorMes.filter((m) => (m.pesadoTotal ?? 0) > 0);
  const metodo: Array<[string, string]> = [
    ["Qué se cuenta como entrada", `Las ${t.nLotes} entradas de báscula${incluirImportacion ? " de naranja propia E importación (marcado en la pantalla)" : " de naranja PROPIA, la comprada a productores con finca y parcela"}. Quedan fuera: ${incluirImportacion ? "" : `${data.importacion.length} lotes de IMPORTACIÓN (${n0(kgImportacion)} kg: naranja de Egipto vía Uria Export y SAF de Harrie Goesten) — no tienen productor al que atribuir una merma de campo y su rendimiento se juzga contra el precio de compra, no contra la finca; `}${data.internas.length} movimientos internos de confección/sobrante; y ${data.imposibles.length} lotes con el apunte de ajuste roto (ver abajo). El precalibrado y los lotes CAMPO/CIT derivados a Cítrica ya vienen apartados de las entradas de báscula.`],
    ["Base de los porcentajes", `La merma (cámara y podrido de tría) va sobre los ${n0(t.kgEntradaBase)} kg de los ${t.nLotesConMerma} lotes terminados: un lote a medias todavía puede seguir vaciándose desde cámara, meterlo en el denominador bajaría el % de todo el mundo sin que nadie haya perdido menos fruta. El podrido de calibrador y la PÉRDIDA TOTAL van sobre una base algo mayor (${n0(t.kgBasePctPerdida)} kg, columna «Base del % de pérdida»): el podrido de un lote a medio procesar cuenta, así que sus kg ya pasados por línea cuentan también en el denominador. Es la misma regla que usa la pestaña «Mermas y coste».`],
    ["Lotes sin ninguna pasada propia", `${t.nLotesTodoAjuste} lotes traen toda su entrada como «ajuste de stock» del histórico importado y ni una pasada de calibrador. Su merma sale 0 y es un 0 REAL (no hay nada que restar: esa fruta ya venía contada), pero sus kg sí pesan en la base, así que hunden el % de su productor. La columna «Lotes sin pasada propia» permite localizarlos antes de comparar a nadie.`],
    ["Lotes cerrados «sin registro»", `${t.nLotesSinRegistro} lotes cerrados sin ninguna pasada bajo su código (se procesaron bajo un código compuesto o se vendieron sin pasar por línea). Se excluyen del análisis de merma: darles pérdida real metería kg ficticios.`],
    ["Merma de cámara", `Dato REAL donde el registro de cámaras lo tiene medido; donde no, ${(TASA_MERMA_NATURAL_DIA * 100).toFixed(4)} % de la entrada por cada día en cámara (media ponderada de 60 camiones re-pesados, 53-80 días). La tasa no es estable: hasta el 17-jul daba 0,0466 %/día y del 20 al 24-jul 0,0592 %/día, así que en estancias largas de verano se queda corta.`],
    ["Podrido pre-calibrador", "Es la tría que se retira ANTES de la máquina, y sale por dos sitios que sí se pesan: la bolsa (a diario) y las bateas (al vaciarlas, tras varios días). Ninguna de las dos se puede repartir por lote, así que por lote SIEMPRE se deduce por resta: entrada − merma de cámara − procesado. Nunca se suman las pesadas encima: ya están dentro de la merma medida."],
    ["El aviso «sin margen»", `Cuando la conciliación atribuye al lote casi toda su entrada, esa resta se queda sin hueco y sale 0 aunque sí hubiera tría. Hay ${t.nLotesSinMargen} lotes así. Su 0 no es físico — la columna «Esperado por tasa del mes» y la hoja «Podrido por mes» dicen cuánto falta. Consecuencia práctica: los productores cuya fruta pasó por línea a final de campaña salen artificialmente bien en el ranking de pérdida.`],
    ["Podrido del calibrador", `REAL (suma de las clases «Podrido» del Informe LOTE) en ${t.nLotesPodridoReal} de ${t.nLotes} lotes; en el resto, prorrateo del podrido del parte por los kg del lote en ese día. Las dos fuentes se separan en la columna «Lotes con podrido real» para saber cuánto del número está medido.`],
    ["Kg procesados", "Vienen del reparto CONCILIADO, no de la suma cruda del calibrador: la máquina atribuye cada pasada al primer código de su nombre, lo que infla unos lotes (merma negativa) y deja a sus hermanos con stock fantasma. La conciliación reparte multi-códigos, descuenta boxes de reciclaje, acota el precalibrado y derrama los excesos."],
    ["Aprovechamiento de Mercadona: las dos cifras", "«Kg clasificados» y «TOTAL MDNA clasificado» son lo que dice el Informe LOTE tal cual, con la misma atribución al primer código que tiene el calibrador. «TOTAL MDNA (sobre conciliado)» aplica ese mismo mix a los kg conciliados del lote, que son los que de verdad le tocan. Los % de los 4 formatos van sobre los KG DE ENTRADA: es el aprovechamiento real de campo a lineal."],
    ["Los 4 formatos", `${METODOS_MDNA.map((m) => `${m} = ${LABEL_MDNA[m]}`).join(" · ")}. Se leen del nombre del producto que teclea el calibrador. Lo que dice «MDNA» sin declarar formato va a «MDNA sin formato en el nombre» — no se reparte a ojo entre los cuatro.`],
    ["Clases aptas para Mercadona", "A–F (Extra 1, Extra 2, Cat1 A, Cat1 B, Verde Claro, Cat 2). Mujeres, Cat 3, Verde Oscuro, Industria, Podrido y Densidad no van a Mercadona nunca. La columna «Apto A-F no vendido a MDNA» es fruta con calidad de Mercadona que se vendió a otros clientes."],
    ["Qué % de Mercadona mirar", "«% MDNA sobre entrada» responde a «de cada 100 kg que compro a este productor, cuántos acaban en Mercadona», pero se diluye si el productor todavía tiene fruta en cámara sin procesar. «% MDNA sobre procesado» quita esa dilución y es la comparable entre productores. Cuando las dos se separan mucho, es que a ese productor le queda campaña por delante, no que rinda peor."],
    ["Cómo leer «Podrido por mes»", `De octubre a mayo el «asumido por la resta» y el «esperado por la tasa» coinciden casi clavados, y eso NO es una validación: la tasa de esos meses se calibró justamente con ese residuo. Lo que sí informa es junio en adelante, donde la resta se queda sin hueco. ${mesesPesados.length > 0 ? `En los meses con pesada real (${mesesPesados.map((m) => `${m.mes}: pesados ${n0(m.pesadoTotal ?? 0)} kg frente a ${n0(m.asumido ?? 0)} asumidos`).join("; ")}) se ve de un vistazo dónde el informe se queda corto.` : "Todavía no hay ningún mes con pesada real de bolsa y bateas en los partes."}`],
    ["Lotes sin informe de clasificación", `${t.nLotesSinClasificacion} lotes no tienen ninguna fila de clasificación: su mix es desconocido y sale vacío, nunca 0. Sus kg de entrada SÍ cuentan en la columna de entrada, así que su ausencia baja el % de Mercadona del grupo — está a propósito, para que se vea el hueco.`],
    ["Euros", "El coste por kg de cada lote sale del importe de compra ya contabilizado en Económico. Los lotes sin coste conocido no aportan € (quedan vacíos, no a 0) pero sí aportan kg."],
    ["Los lotes abiertos", `${abiertos.length} lotes siguen abiertos en la base (${n0(kgAbiertos)} kg de entrada): mientras puedan seguir vaciándose desde cámara no tienen merma calculable, y su hueco NO cuenta como pérdida. El Excel del script de campaña los simula cerrados (regla del dueño 28-08-2026: el almacén está vacío); esta exportación NO lo hace, para no enseñar como hecho lo que no está decidido. La hoja «Cierre pendiente» los lista con el modo de cierre que les tocaría («con análisis» convierte el hueco en pérdida; «sin registro» lo excluye porque esa fruta se procesó bajo otro código o se vendió sin pasar por línea). Cuando se cierren en la base (Entradas → cierre de lote), los dos ficheros coincidirán al kilo.`],
    ["Los lotes con ajuste negativo", `${data.imposibles.length} lotes perderían más de lo que entró: traen kg_ajuste_stock NEGATIVO (alguien reasignó sus kg a otro lote a mano) o una merma medida mayor que su entrada. Como la merma es entrada − procesado − ajuste, un ajuste negativo la SUMA, y eso es físicamente imposible. Están FUERA de todos los totales (${n0(kgImposibles)} kg de entrada) y listados en «Cierre pendiente» con el modo «ARREGLAR ANTES».`],
    ["Mix de clasificación: hasta dónde llega", `${data.lotesConMix} de los ${data.filas.length} lotes tienen desglose por lote (mix), de la vista canónica del calibrador (volcado SQL + Excel + informes Word), agregado en servidor a las ${data.mixRefrescadoEn ? formatearFechaHoraExportacion(new Date(data.mixRefrescadoEn)) : "—"} (se refresca cada hora). Los kg sin mix SÍ cuentan en la pérdida pero NO se pueden repartir entre destinos ni formatos de Mercadona. El Excel del script trae además la hoja «Cobertura del mix» por mes de línea; esta exportación no la incluye porque la pantalla no carga las pasadas del parte.`],
  ];
  return metodo.map(([punto, texto]) => ({ punto, texto }));
}

// ─── Las hojas, en el orden del script ────────────────────────────────────────

/** Las hojas del libro a partir de `data`: pura, sin tocar la base (testeable). */
export function hojasCampanaMermaMdna(data: CampanaMermaMdna, incluirImportacion: boolean): HojaTablaOptions[] {
  const total = data.total;
  return [
    {
      nombreHoja: "Resumen",
      titulo: "La cascada completa de un kg de naranja, de la báscula a la malla",
      autofilter: false,
      columnas: [
        { header: "Concepto", key: "concepto", width: 46 },
        kgCol("Kg", "kg", 18),
        pctCol("%", "pct", 12),
        { header: "Cómo se ha calculado", key: "nota", width: 95 },
      ],
      filas: filasCascada(data, incluirImportacion),
    },
    {
      nombreHoja: "Productores",
      titulo: "Pérdida de fruta por productor (ordenado por % de pérdida)",
      columnas: colsPerdida(false),
      filas: data.porProductor.map(filaPerdida),
      totales: { ...filaPerdida(total), productor: "TOTAL" },
    },
    {
      nombreHoja: "Fincas",
      titulo: "Pérdida de fruta por productor y finca (ordenado por % de pérdida)",
      columnas: colsPerdida(true),
      filas: data.porFinca.map(filaPerdida),
      totales: { ...filaPerdida(total), productor: "TOTAL" },
    },
    {
      nombreHoja: "Mercadona productores",
      titulo: "Aprovechamiento de Mercadona por productor · los 4 formatos (ordenado por % MDNA sobre entrada)",
      columnas: colsMdna(false),
      filas: data.porProductorMdna.map(filaMdna),
      totales: { ...filaMdna(total), productor: "TOTAL" },
    },
    {
      nombreHoja: "Mercadona fincas",
      titulo: "Aprovechamiento de Mercadona por finca · los 4 formatos (ordenado por % MDNA sobre entrada)",
      columnas: colsMdna(true),
      filas: data.porFincaMdna.map(filaMdna),
      totales: { ...filaMdna(total), productor: "TOTAL" },
    },
    {
      nombreHoja: "Podrido por mes",
      titulo: "Podrido de tría: lo PESADO (bolsa + bateas) frente a lo ASUMIDO por la resta, por mes de proceso",
      columnas: [
        { header: "Mes de proceso", key: "mes", width: 14 },
        intCol("Lotes", "lotes"),
        kgCol("Kg procesados", "procesado", 16),
        pctCol("Tasa esperada del mes", "tasaMes", 16),
        kgCol("Asumido por la resta", "asumido", 17),
        pctCol("% asumido s/ procesado", "pctAsumido", 17),
        kgCol("Esperado por la tasa", "esperado", 17),
        kgCol("No visto por la resta", "noVisto", 17),
        intCol("Lotes sin margen", "sinMargen", 13),
        kgCol("Pesado en bolsa", "bolsa", 15),
        kgCol("Pesado en bateas", "bateas", 15),
        kgCol("Pesado total", "pesadoTotal", 15),
        intCol("Partes del mes", "partesConDato", 12),
      ],
      filas: data.podridoPorMes.map((f) => ({ ...f })),
    },
    {
      nombreHoja: "Cierre pendiente",
      titulo: "Deberes en la base: lotes abiertos (sin merma calculable hasta que se cierren) y lotes con el apunte de ajuste roto",
      columnas: [
        { header: "Productor", key: "productor", width: 38 },
        { header: "Finca", key: "finca", width: 26 },
        { header: "Lote", key: "lote", width: 11 },
        { header: "Entrada", key: "fecha", width: 11 },
        kgCol("Kg entrada", "kgEntrada"),
        kgCol("Kg procesados (conc.)", "kgCalibrador", 18),
        pctCol("% procesado", "pctProcesado", 12),
        kgCol("Merma medida (si está cerrado)", "kgMerma", 24),
        { header: "Modo de cierre", key: "modo", width: 15 },
        { header: "Qué pasó con este lote", key: "situacion", width: 74 },
      ],
      filas: filasCierrePendiente(data),
    },
    {
      nombreHoja: "Detalle lotes",
      titulo: "Una fila por lote: merma, podrido y destino",
      columnas: [
        { header: "Productor", key: "productor", width: 36 },
        { header: "Finca", key: "finca", width: 26 },
        { header: "Variedad", key: "variedad", width: 24 },
        { header: "Lote", key: "lote", width: 11 },
        { header: "Entrada", key: "fecha", width: 11 },
        { header: "Estado", key: "estado", width: 10 },
        intCol("Días cámara", "diasEnCamara", 11),
        kgCol("Kg entrada", "kgEntrada"),
        kgCol("Kg procesados (conc.)", "kgCalibrador", 18),
        kgCol("Merma medida", "mermaMedidaKg", 15),
        kgCol("Merma cámara", "mermaCamaraKg", 15),
        { header: "Cámara medida", key: "camaraFuente", width: 13 },
        kgCol("Podrido pre-calibrador", "podridoPreKg", 19),
        kgCol("Esperado del mes", "podridoPreEsperadoKg", 16),
        { header: "Sin margen", key: "sinMargenTxt", width: 10 },
        kgCol("Podrido calibrador", "podridoCalibradorKg", 17),
        { header: "Fuente podrido", key: "podridoCalibradorFuente", width: 13 },
        kgCol("Podrido bolsa (prorr.)", "podridoManualKg", 18),
        kgCol("PÉRDIDA total", "perdidaKg", 15),
        pctCol("% pérdida", "pctPerdida", 11),
        { header: "Pérdida €", key: "perdidaEur", tipo: "numero", numFmt: FMT_EUR, width: 14 },
        kgCol("Kg clasificados", "kgClasificado", 16),
        kgCol("MDNA 3 kg", "mdna3", 13),
        kgCol("MDNA 4 kg exprimidor", "mdna4", 18),
        kgCol("MDNA 5 kg", "mdna5", 13),
        kgCol("MDNA granel", "mdna12", 13),
        kgCol("MDNA sin formato", "mdnaSinFormato", 16),
        kgCol("TOTAL MDNA (conc.)", "mdnaTotalAjustado", 18),
        pctCol("% MDNA sobre entrada", "pctMdnaEntrada", 17),
      ],
      filas: filasDetalleLotes(data),
    },
    {
      nombreHoja: "Metodología",
      titulo: "Cómo leer este informe (y qué NO dice)",
      autofilter: false,
      columnas: [
        { header: "Punto", key: "punto", width: 38 },
        { header: "Explicación", key: "texto", width: 150 },
      ],
      filas: filasMetodologia(data, incluirImportacion),
    },
  ];
}

/** Metadatos de la banda de marca: el periodo son las fechas de entrada de los lotes analizados. */
export function metaCampanaMermaMdna(data: CampanaMermaMdna, opciones: OpcionesExportCampana): LasarteExportMeta {
  const fechas = data.filas.map((f) => f.fecha).filter(Boolean).sort();
  return {
    titulo: "Mermas, podrido y aprovechamiento de Mercadona por productor y finca",
    periodo: fechas.length ? `Entradas ${fechas[0]} a ${fechas[fechas.length - 1]}` : undefined,
    usuario: opciones.usuario ?? undefined,
    filtros: opciones.incluirImportacion ? "Importación incluida (Egipto, SAF)" : "Sin importación (Egipto, SAF): solo naranja propia",
    clasificacion: "Dirección",
    generadoEn: opciones.generadoEn,
  };
}

/** Mismo nombre que el script: Mermas_Podrido_Aprovechamiento_MDNA_AAAA-MM-DD.xlsx. */
export function nombreFicheroCampanaMermaMdna(fecha: Date = new Date()): string {
  return `Mermas_Podrido_Aprovechamiento_MDNA_${fecha.toISOString().slice(0, 10)}.xlsx`;
}

/** Genera y descarga el Excel de campaña con los datos ya calculados por la pantalla. */
export async function exportarCampanaMermaMdna(data: CampanaMermaMdna, opciones: OpcionesExportCampana): Promise<void> {
  const ctx = crearLibroLasarte(metaCampanaMermaMdna(data, opciones));
  for (const hoja of hojasCampanaMermaMdna(data, opciones.incluirImportacion)) añadirHojaTabla(ctx, hoja);
  await descargarLibro(ctx, nombreFicheroCampanaMermaMdna(opciones.generadoEn));
}

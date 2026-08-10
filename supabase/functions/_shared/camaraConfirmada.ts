/**
 * camaraConfirmada.ts — confirmación FÍSICA de que un lote sigue en cámara,
 * anotada por dirección tras inventariar a pie (columnas
 * entradas_bascula.camara_confirmada_nombre / camara_confirmada_fecha,
 * migración 20260804120000_camara_confirmada.sql, ya aplicada — este módulo
 * NUNCA la vuelve a tocar).
 *
 * ORIGEN (04-ago-2026): el dueño inventarió físicamente la cámara 5 y
 * encontró 26 lotes INTACTOS a los que el derrame de la conciliación había
 * atribuido 310 t fantasma (9 de ellos llegaron a cerrarse solos como
 * "con_analisis" antes de esta protección). Ya existía protección equivalente
 * para la señal de CÁMARA EXTERNA (Guadex/Zamexfruit, ver camarasExternas.ts:
 * codigosEnCamaraExterna — excluida del derrame en conciliarKgProcesados y del
 * candidato de cierre vía StockLoteRow.enCamaraExterna/esCandidatoCierre*).
 * Este módulo generaliza esa misma protección a una segunda FUENTE de la
 * señal: la confirmación humana directa (inventario a pie), sin depender de
 * ningún registro de cámara externa.
 *
 * SEMÁNTICA — es una SEÑAL, no un movimiento: no representa que el lote haya
 * entrado o salido de ningún sitio, solo que a fecha `camara_confirmada_fecha`
 * dirección VIO el lote físicamente en `camara_confirmada_nombre`. Por eso su
 * vigencia NUNCA se persiste (se deriva en cada lectura, igual que
 * `estadoCamionExterno` en camarasExternas.ts): la señal está VIGENTE mientras
 * el lote no tenga ninguna pasada PROPIA — su código de 8 dígitos nombrado en
 * CUALQUIER posición de un código de pasada, exactamente la misma detección
 * que ya usa el motor para "nombrado" (Convención A, normalizarLoteCodigo en
 * loteCodigo.ts; ver también detectarLotesEnPasadaCompuesta en
 * conciliacionKg.ts y fechasNombradoPorLote en asentamientoDia.ts — NUNCA por
 * LIKE/substring) — con fecha POSTERIOR a la fecha de confirmación. Si
 * aparece una, la fruta empezó a salir de verdad y la señal caduca sola, sin
 * que nadie tenga que limpiarla a mano (el diálogo de administración también
 * permite limpiarla directamente, ver ConfirmarLotesEnCamaraDialog.tsx).
 */
import { normalizarLoteCodigo } from "./loteCodigo.ts";
import type { PasadaConciliacion } from "./conciliacionKg.ts";

/** Entrada con las 2 columnas de la migración 20260804120000 (el caller las lee con un cast puntual — ver useEntradasBascula.ts, mismo patrón que merma_camara_kg). */
export interface EntradaConCamaraConfirmada {
  lote: string;
  camara_confirmada_nombre: string | null;
  camara_confirmada_fecha: string | null; // ISO "YYYY-MM-DD"
}

export interface ConfirmacionCamaraVigente {
  nombre: string;
  fecha: string;
}

/**
 * Última fecha (de cualquier pasada con kg>0) en la que el PROPIO código de 8
 * dígitos del lote aparece nombrado, en cualquier posición del texto de la
 * pasada — no solo como primer código. Mismo criterio de "mención propia" que
 * usa el resto del motor, aplicado aquí para decidir la vigencia de la señal.
 */
function ultimaMencionPropiaPorLote(pasadas: PasadaConciliacion[]): Map<string, string> {
  const ultima = new Map<string, string>();
  for (const p of pasadas) {
    const kg = Number(p.kg_peso_total) || 0;
    if (kg <= 0 || !p.date) continue;
    const codes = String(p.lote_codigo ?? "").match(/\d{8}/g);
    if (!codes) continue;
    for (const code of new Set(codes)) {
      const actual = ultima.get(code);
      if (!actual || p.date > actual) ultima.set(code, p.date);
    }
  }
  return ultima;
}

/**
 * Deriva, por lote normalizado a 8 dígitos, la confirmación física VIGENTE
 * ahora mismo: solo los lotes con las 2 columnas rellenas en BD Y sin ninguna
 * pasada propia con fecha POSTERIOR a `camara_confirmada_fecha` (ver cabecera
 * del módulo). Los lotes con una pasada posterior NO aparecen en el mapa
 * devuelto: su señal caducó, así que el ciclo normal del motor (conciliación,
 * candidatos a cierre) se aplica sin ninguna excepción — exactamente como si
 * nunca se hubiera confirmado nada. Una pasada ANTERIOR o IGUAL a la fecha de
 * confirmación no caduca nada (es evidencia de antes del inventario, o del
 * mismo día).
 */
export function camaraConfirmadaVigentePorLote(
  entradas: EntradaConCamaraConfirmada[],
  pasadas: PasadaConciliacion[],
): Map<string, ConfirmacionCamaraVigente> {
  const ultimaMencion = ultimaMencionPropiaPorLote(pasadas);
  const vigentes = new Map<string, ConfirmacionCamaraVigente>();
  for (const e of entradas) {
    if (!e.camara_confirmada_nombre || !e.camara_confirmada_fecha) continue;
    const lote8 = normalizarLoteCodigo(e.lote);
    if (!lote8) continue;
    const mencion = ultimaMencion.get(lote8);
    if (mencion && mencion > e.camara_confirmada_fecha) continue; // caducada: pasada propia posterior
    vigentes.set(lote8, { nombre: e.camara_confirmada_nombre, fecha: e.camara_confirmada_fecha });
  }
  return vigentes;
}

/**
 * Unión de códigos con alguna señal de "sigue en cámara" VIGENTE ahora mismo:
 * cámara EXTERNA (`codigosEnCamaraExterna`, camarasExternas.ts) + confirmación
 * FÍSICA (`camaraConfirmadaVigentePorLote`, más arriba). Es el Set que
 * conciliarKgProcesados/buildStockEntradas reciben como `lotesConfirmadosEnCamara`
 * (antes ese parámetro solo cubría la señal externa, ver sus cabeceras en
 * conciliacionKg.ts/entradasBascula.ts) — construido en useEntradasBascula.ts.
 */
export function unirLotesConfirmadosEnCamara(
  codigosCamaraExterna: Set<string>,
  camaraConfirmadaVigente: Map<string, ConfirmacionCamaraVigente>,
): Set<string> {
  return new Set([...codigosCamaraExterna, ...camaraConfirmadaVigente.keys()]);
}

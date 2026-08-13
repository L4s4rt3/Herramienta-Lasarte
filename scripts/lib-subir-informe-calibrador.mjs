/**
 * Sube a Supabase un informe del calibrador ya interpretado.
 *
 * Va a las tablas espejo `calibrador_informe` y `calibrador_clasificacion`, NO a
 * `lote_clasificacion`: escribir allí duplicaría la clasificación si el mismo
 * lote entra también por el Excel que se importa a mano, y ademas exige un
 * part_id que puede no existir cuando llega el informe. Ver la cabecera de la
 * migración 20260811100000_calibrador_informes.sql.
 *
 * IDEMPOTENTE: reenviar un informe deja la base igual. La cabecera se actualiza
 * y el detalle se borra y se vuelve a escribir, para que un reenvio con menos
 * lineas no deje filas viejas colgando.
 *
 * CADA LOTE TIENE SU PROPIO batch_id NEGATIVO. La clave primaria de
 * `calibrador_clasificacion` es (batch_id, producto, calidad, clase, tamano) —
 * SIN el lote, porque el grano real es la pasada. Si todos los DOCX se guardaran
 * con batch_id = 0, dos lotes distintos con el mismo producto y calibre
 * chocarian: el 13-08-2026 llegaron 8 informes y solo entro el primero, los
 * otros 7 se rechazaron por clave duplicada. Con un id propio por lote no hay
 * colision posible, y el signo sigue diciendo de donde viene el dato:
 *
 *     batch_id > 0   pasada real del volcado SQL (la verdad completa)
 *     batch_id < 0   provisional de un DOCX (solo la ultima pasada del lote)
 */
import { fechaDeComienzo } from "./lib-informe-calibrador.mjs";

const TANDA = 500;

/**
 * Un id estable y negativo para la PASADA (lote + comienzo). Determinista: el
 * mismo informe da siempre el mismo, asi que reenviarlo sobreescribe en vez de
 * duplicar. Se acota a 30 bits para que quepa de sobra en un integer.
 *
 * LLEVA EL COMIENZO, no solo el lote: un lote puede entrar en linea varios dias
 * (el 26051506 se paso el 11 y el 12) y con un id por lote el segundo informe
 * borraba las lineas del primero — 8.589 kg perdidos en silencio.
 */
export function batchIdDeDocx(lote, comienzo = "") {
  let h = 0;
  for (const ch of `${lote}|${comienzo}`) h = (Math.imul(h, 31) + ch.charCodeAt(0)) | 0;
  return -(Math.abs(h) % 1_000_000_000) - 1;   // siempre <= -1, nunca 0
}

/**
 * @param supabase cliente con clave de servicio
 * @param informe  lo que devuelve parsearInformeCalibrador
 * @param fichero  ruta relativa del .docx, para poder rastrear de donde salio
 */
export async function subirInforme(supabase, informe, fichero = null) {
  const c = informe.cabecera;
  if (!c.lote) throw new Error("El informe no trae lote: no se sube.");

  const cabecera = {
    lote: c.lote,
    commodity: c.commodity,
    productor: c.productorNombre,
    productor_codigo: c.productorCodigo,
    fecha: fechaDeComienzo(c.comienzo),
    comienzo: c.comienzo,
    tiempo_maquina: c.tiempoMaquina,
    tiempo_lote: c.tiempoLote,
    utilizacion_pct: c.utilizacionPct,
    peso_fruta_media_g: c.pesoFrutaMediaG,
    conteo_fruta_medio: c.conteoFrutaMedio,
    bins_hora: c.binsHora,
    bins_ejecutados: c.binsEjecutados,
    toneladas_hora: c.toneladasHora,
    cartons: c.cartons,
    cartons_hora: c.cartonsHora,
    rechazo_pct: c.rechazoPct,
    fichero,
    recibido_at: new Date().toISOString(),
  };

  const { error: errCab } = await supabase
    .from("calibrador_informe").upsert(cabecera, { onConflict: "lote,comienzo" });
  if (errCab) throw new Error(`calibrador_informe: ${errCab.message}`);

  // Borrar y reescribir SOLO lo provisional de ESTE lote (su batch_id negativo).
  // Las filas con batch_id>0 vienen del volcado SQL del Sizer y cubren TODAS
  // las pasadas del lote (un 26% de los lotes tiene varias); el DOCX solo ve la
  // ultima, asi que jamas debe pisarlas.
  const batchId = batchIdDeDocx(c.lote, c.comienzo);
  const { error: errDel } = await supabase
    .from("calibrador_clasificacion").delete().eq("batch_id", batchId);
  if (errDel) throw new Error(`borrando clasificacion: ${errDel.message}`);

  const filas = informe.lineas.map((l) => ({
    lote: c.lote,
    batch_id: batchId,
    producto: l.producto ?? "",
    calidad: l.calidad ?? "",
    clase: l.clase ?? "",
    tamano: l.tamano ?? "",
    grupo_destino: l.grupo,
    piezas: l.piezas,
    pct_piezas: l.pctPiezas,
    peso_kg: l.kg,
    pct_peso: l.pctKg,
    cartons: l.cartons,
    pct_cartons: l.pctCartons,
  }));

  for (let i = 0; i < filas.length; i += TANDA) {
    const { error } = await supabase
      .from("calibrador_clasificacion").insert(filas.slice(i, i + TANDA));
    if (error) throw new Error(`calibrador_clasificacion: ${error.message}`);
  }

  return { lote: c.lote, fecha: cabecera.fecha, lineas: filas.length };
}

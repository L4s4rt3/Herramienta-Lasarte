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
 */
import { fechaDeComienzo } from "./lib-informe-calibrador.mjs";

const TANDA = 500;

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
    .from("calibrador_informe").upsert(cabecera, { onConflict: "lote" });
  if (errCab) throw new Error(`calibrador_informe: ${errCab.message}`);

  // Borrar y reescribir SOLO las filas batch_id=0 (las provisionales de DOCX).
  // Las filas con batch_id>0 vienen del volcado SQL del Sizer y cubren TODAS
  // las pasadas del lote (un 26% de los lotes tiene varias); el DOCX solo ve la
  // ultima, asi que jamas debe pisarlas.
  const { error: errDel } = await supabase
    .from("calibrador_clasificacion").delete().eq("lote", c.lote).eq("batch_id", 0);
  if (errDel) throw new Error(`borrando clasificacion: ${errDel.message}`);

  const filas = informe.lineas.map((l) => ({
    lote: c.lote,
    batch_id: 0,
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

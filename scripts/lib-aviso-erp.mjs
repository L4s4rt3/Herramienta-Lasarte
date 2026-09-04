/**
 * lib-aviso-erp.mjs — la MITAD ERP de la tarea diaria (Fase 2, pasos 1 y 2:
 * 02-09-2026). Todo lo que necesita la red de la oficina: el MySQL del ERP.
 *
 *   1. Crea (o completa) los partes de la ventana con los automaticos, y trae
 *      los palets del dia del ERP (repasarPartes / paletsDelDia).
 *   2. Genera y sube el GSTOCK de cada dia de la ventana (generarYSubir).
 *
 * Lo que sale de aqui y necesita la otra mitad (el correo) son CUATRO datos
 * que hasta hoy viajaban en memoria y no estaban en Supabase: los sospechosos
 * del GSTOCK, los `faltaban` de los rehechos, los palets del dia (paletsErp)
 * y erpCaido. Por eso el resultado se deja en sistema_ejecuciones (trabajo
 * "tarea-erp", columna datos) con guardarResultadoErp, y la mitad nube lo lee
 * con leerResultadoErp cuando corre por separado. El resultado va SIEMPRE
 * serializado (JSON puro, sin Maps ni ids de pasadas) para que el correo salga
 * igual corra en el mismo proceso o desde la base.
 */
import os from "node:os";
import { comoFecha } from "./lib-aviso-diario.mjs";
import { latido } from "./lib-registro-ejecuciones.mjs";
import { repasarPartes } from "./crear-parte-diario.mjs";
import { conectarErp } from "./lib-palets-erp.mjs";
import { generarYSubir } from "./generar-gstock-erp.mjs";
import { PRIMERA_SEMANA_TARIFA, sincronizarFacturacionMercadona } from "./mercadona-facturacion-erp.mjs";
import { semanaIsoAnterior } from "../supabase/functions/_shared/semanaIso.ts";

/**
 * Kilos de palets que tiene que aportar el ERP para que merezca la pena rehacer
 * el GSTOCK de un parte que sigue en Borrador. Por debajo de esto no compensa:
 * son los cuatro palets que siempre entran tarde, y en un dia de 70.000 kg
 * mueven el descuadre menos de un punto.
 */
const REFRESCAR_GSTOCK_KG = 500;
/**
 * Cuantos dias hacia atras repasa la tarea cada mañana (partes, GSTOCK,
 * informes y cuadre). Es la red que tapa los huecos: un dia que la tarea no
 * corrio, o un lote cuyo informe llego tarde, se recupera solo mientras caiga
 * dentro de esta ventana. Eran 7, pero 7 se queda JUSTO al borde de una
 * ausencia de una semana — paso en agosto de 2026: el dueño estuvo fuera 6
 * dias, los informes se reenviaron al volver y el primer dia quedaba en el
 * limite. 14 da margen para una semana entera de vacaciones sin perder ninguno.
 * El repaso es idempotente: los dias que ya estan salen "sin-cambios"/"ya-tenia".
 */
export const VENTANA_RECUPERACION = 14;

/** Los `dias` dias que acaban en `hasta`, del mas reciente al mas antiguo. */
export const ventanaDias = (hasta, dias) => {
  const fin = new Date(`${hasta}T12:00:00`);
  return Array.from({ length: dias }, (_, i) =>
    comoFecha(new Date(fin.getFullYear(), fin.getMonth(), fin.getDate() - i)));
};

/** Lo que el correo necesita del parte: sin Maps ni listas de pasadas (JSON puro). */
function parteSerializable(p) {
  if (!p) return null;
  const { fecha, id, estado, accion, motivo, origen, automaticos, dsj, anteriorPendiente, lotes,
    paletsErp, recuperados, erpCaido, pasadas, kgTotal, kgMujeres } = p;
  return { fecha, id, estado, accion, motivo, origen, automaticos, dsj, anteriorPendiente, lotes,
    paletsErp, recuperados, erpCaido, pasadas, kgTotal, kgMujeres };
}

/**
 * Corre la mitad ERP para el dia `ayer` y devuelve su resultado serializable:
 * { fecha, inicio, parte, gstock, gstockRecuperados, gstockRehechos, incidencias }.
 * Nunca lanza por el ERP: si no hay red, el parte sale con erpCaido y el GSTOCK
 * con su incidencia, y el correo lo cuenta.
 */
export async function ejecutarMitadErp(supabase, ayer) {
  const inicio = new Date().toISOString();
  const incidencias = [];
  // 1. Los partes, antes de contar nada: asi el correo puede decir como quedaron.
  //    Se repasa una semana para tapar los dias en que la tarea no llego a correr.
  let parte = null;
  try {
    const repaso = await repasarPartes(supabase, ayer, { dias: VENTANA_RECUPERACION, aplicar: true });
    parte = { ...repaso.ultimo, recuperados: repaso.recuperados, erpCaido: repaso.erpCaido };
    for (const e of repaso.errores) {
      if (e.fecha !== ayer) incidencias.push(`ERROR: parte del ${e.fecha}: ${e.motivo}`);
    }
  } catch (e) {
    parte = { accion: "error", motivo: e.message };
  }

  // El GSTOCK (consulta de palets) se genera del ERP y se sube al parte, para
  // que la app lo lea con su logica de siempre en vez de escribirle los kilos
  // por detras. Ver generar-gstock-erp.mjs.
  //
  // Se repasa la MISMA ventana que los partes, no solo ayer: un parte recuperado
  // de hace dias (porque la tarea no corrio, o porque sus informes llegaron
  // tarde) nace sin GSTOCK, y sin GSTOCK no hay palets ni analisis — se quedaria
  // esperando para siempre a un dia que ya paso. generarYSubir no repite trabajo:
  // devuelve "ya-tenia" si el parte ya tiene uno y "sin-parte" si no hay parte.
  //
  // Y SE REHACE EL DE LOS DIAS QUE SE QUEDARON CORTOS. El Excel se genera a las
  // 07:10 del dia siguiente, y a esa hora todavia no han terminado de dar de
  // alta: medido el 14-08-2026, 31 de 55 partes tenian menos palets de los que
  // el ERP dice hoy — el 11-08 le faltaban 11.662 kg y su descuadre era del 22%.
  // Mientras nadie VALIDE el parte se rehace solo (desde el 28-08 "Analizado"
  // tambien se rehace: es el estado normal del automatico). Ver generarYSubir:
  // solo toca lo que genero el mismo, solo si el ERP tiene MAS, y nunca un
  // parte Validado ni un archivo que subiera una persona.
  let gstock = null;
  let mercadona = null;
  const gstockRecuperados = [];
  const gstockRehechos = [];
  try {
    const conn = await conectarErp();
    try {
      for (const f of ventanaDias(ayer, VENTANA_RECUPERACION)) {
        const r = await generarYSubir(supabase, conn, f, { aplicar: true, refrescarSiFaltanKg: REFRESCAR_GSTOCK_KG });
        if (f === ayer) gstock = r;
        else if (r.accion === "subido") gstockRecuperados.push(r);
        if (r.accion === "rehecho") gstockRehechos.push(r);
      }
      // La tarifa REAL de Mercadona, de sus facturas. Se hace aqui, con la
      // conexion ya abierta, porque es lo unico que la saca del ERP: hasta el
      // 04-09-2026 la base_iva se metia a mano y llevaba parada desde la
      // semana 32, con lo que la cuenta de /economico/rentabilidad y la vista
      // por tipo de dia se quedaban sin euros de venta. Idempotente y barato:
      // las semanas ya cargadas salen "sin-cambios" y la recien cerrada se
      // completa sola en cuanto Mercadona termina de facturar.
      try {
        mercadona = await sincronizarFacturacionMercadona(supabase, conn, {
          desde: PRIMERA_SEMANA_TARIFA,
          hasta: semanaIsoAnterior(ayer),
          aplicar: true,
        });
        for (const i of mercadona.incidencias ?? []) incidencias.push(`ERROR: facturacion Mercadona ${i}`);
      } catch (e) {
        // Su propio try: un fallo aqui no puede tumbar el GSTOCK.
        incidencias.push(`ERROR: no se pudo sincronizar la facturacion de Mercadona: ${e.message}`);
      }
    } finally {
      await conn.end().catch(() => {});
    }
    for (const s of [...(gstock?.sospechosos ?? []), ...gstockRecuperados.flatMap((r) => r.sospechosos ?? [])]) {
      incidencias.push(`ERROR: el palet ${s.palet} del GSTOCK tiene ${Math.round(s.kg).toLocaleString("es")} kg` +
        ` ("${s.producto}")${s.desmontado ? ", y es un DESMONTADO (industria o precalibrado)" : ""}.` +
        " Un palet fisico no llega a eso: se apunto despues con la fecha del lote, asi que ese dia" +
        " sale con mas palets de los que se hicieron.");
    }
  } catch (e) {
    incidencias.push(`ERROR: no se pudo generar el GSTOCK del dia: ${e.message}`);
  }


  const resultado = {
    fecha: ayer,
    inicio,
    parte: parteSerializable(parte),
    gstock: gstock ? { fecha: gstock.fecha, accion: gstock.accion, motivo: gstock.motivo ?? null, palets: gstock.palets ?? null,
      kg: gstock.kg ?? null, faltaban: gstock.faltaban ?? null, teniaKg: gstock.teniaKg ?? null } : null,
    gstockRecuperados: gstockRecuperados.map((r) => ({ fecha: r.fecha })),
    gstockRehechos: gstockRehechos.map((r) => ({ fecha: r.fecha, faltaban: r.faltaban })),
    mercadona: mercadona
      ? { semanas: (mercadona.semanas ?? []).map((s) => ({ anio: s.anio, semana: s.semana, decision: s.decision })),
          escritas: mercadona.escritas ?? 0 }
      : null,
    incidencias,
  };
  return JSON.parse(JSON.stringify(resultado));
}

/**
 * Deja el resultado en sistema_ejecuciones (trabajo "tarea-erp"): es el puente
 * con la mitad nube. Best-effort: si la base no responde, el orquestador sigue
 * con el resultado en memoria y lo dice.
 */
export async function guardarResultadoErp(supabase, resultado) {
  const conError = resultado.incidencias.some((i) => /^ERROR/.test(i)) || resultado.parte?.accion === "error";
  const detalle = `ERP del ${resultado.fecha}: parte ${resultado.parte?.accion ?? "?"}` +
    `${resultado.parte?.erpCaido ? " (ERP caido)" : ""} · GSTOCK ${resultado.gstock?.accion ?? "sin-resultado"}` +
    (resultado.gstockRehechos.length ? ` · ${resultado.gstockRehechos.length} rehecho(s)` : "");
  const { error } = await supabase.from("sistema_ejecuciones").insert({
    trabajo: "tarea-erp", inicio: resultado.inicio, estado: conError ? "aviso" : "ok",
    detalle: detalle.slice(0, 500), equipo: os.hostname(), datos: resultado,
  });
  if (error) {
    console.warn(`[tarea-erp] no se pudo guardar el resultado del ERP en la base: ${error.message}`);
    return false;
  }
  // Y su latido: desde que la mitad nube puede correr fuera del portatil, esta
  // es la señal de que la LAN sigue viva (catalogo de saludTrabajos.ts).
  await latido("tarea-erp", { estado: conError ? "aviso" : "ok", detalle: detalle.slice(0, 500) });
  return true;
}

/** El ultimo resultado de la mitad ERP para el dia `ayer`, o null si hoy no ha corrido. */
export async function leerResultadoErp(supabase, ayer) {
  const { data, error } = await supabase.from("sistema_ejecuciones")
    .select("datos, inicio").eq("trabajo", "tarea-erp")
    .order("inicio", { ascending: false }).limit(5);
  if (error) throw new Error(`leyendo el resultado del ERP: ${error.message}`);
  return (data ?? []).map((r) => r.datos).find((d) => d?.fecha === ayer) ?? null;
}

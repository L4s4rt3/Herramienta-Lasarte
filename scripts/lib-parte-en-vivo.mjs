/**
 * El parte diario EN VIVO: nace con el primer lote del dia y crece con cada
 * informe que llega, como cuando lo montaba una persona.
 *
 * ENCARGO DEL DUEÑO (26-08-2026): "una vez llegue el primer lote se cree un
 * parte y se adjunte el lote ahi, y asi con todos los lotes de cada dia. Y una
 * vez se tengan todos, se saca la otra info y se analiza el parte, que se vea
 * como si lo analizara manualmente". Hasta hoy el parte se montaba entero a la
 * mañana siguiente (tarea de las 07:10); ahora se monta segun llegan los
 * informes y la tarea de la mañana queda de red de seguridad.
 *
 * QUE HACE CADA PIEZA
 *
 *   adjuntarLoteAlParte   se asegura de que el parte del dia existe (lo crea el
 *     primer lote) y le adjunta el .docx del informe como hacia la persona:
 *     un archivo por lote, nombrado con su codigo, tipo "InformeLote". El
 *     analisis los IGNORA a proposito (analizar-parte se salta ese tipo y
 *     cualquier no-xlsx): son para quien abra el parte, no para la maquina.
 *
 *   refrescarParteEnVivo  vuelve a dejar el parte al dia con lo que haya:
 *     GSTOCK del ERP (si hay red de oficina; si no, lo pone la manana),
 *     los tres informes Excel del dia, y el MISMO analisis que el boton de la
 *     app. Es idempotente: llamarlo tras cada lote deja el parte siempre tan
 *     completo como los datos, y cuando entra el ultimo lote del dia, el
 *     analisis que queda ES el definitivo.
 *
 * "TODOS LOS LOTES DEL DIA" NO TIENE CAMPANA DE FIN: el Sizer manda cada
 * informe al cerrar su lote y nadie avisa de cual es el ultimo. Por eso no se
 * espera a un "dia completo" que no existe: se reanaliza tras cada llegada
 * (los generadores solo reemplazan lo suyo y los cinco manuales del papel
 * estan protegidos), que es lo mismo que haria una persona aplicada.
 */
import { crearParteDiario } from "./crear-parte-diario.mjs";
import { generarYSubirInformes } from "./generar-informes-parte.mjs";
import { analizarPartesPendientes } from "./analizar-partes-pendientes.mjs";
import { codigoBaseLote } from "./lib-lotes.mjs";

const MIME_DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const num = (v) => Number(v) || 0;

/**
 * El nombre del adjunto: el codigo del lote, como los que subia la persona
 * ("26051907.xlsx" en los partes de agosto). Lo que no tiene codigo de 8
 * digitos (PREC, industria) conserva su texto, saneado para Windows/storage.
 */
export function nombreAdjuntoLote(lote) {
  const base = codigoBaseLote(lote);
  const limpio = String(base ?? "lote").replace(/[\\/:*?"<>|]/g, "_").trim().slice(0, 60);
  return `${limpio || "lote"}.docx`;
}

/**
 * Adjunta el .docx de un lote al parte de su dia, creando el parte si es el
 * primero. Idempotente por nombre: el mismo lote reenviado REEMPLAZA su
 * adjunto (el informe nuevo es mas completo), nunca lo duplica.
 *
 * Un parte que ya no este en Borrador no se toca: lo cerro una persona.
 */
export async function adjuntarLoteAlParte(supabase, { fecha, lote, contenido }) {
  if (!fecha || !contenido) return { accion: "sin-datos" };

  // El parte del dia. crearParteDiario ya sabe crearlo con los automaticos
  // puestos, respetar los cerrados y no pisar lo escrito a mano.
  const creado = await crearParteDiario(supabase, fecha, { aplicar: true, palets: null });
  if (creado.accion === "respetado") return { accion: "respetado", motivo: creado.motivo };
  if (!creado.id && creado.accion === "sin-datos") return { accion: "sin-parte", motivo: creado.motivo };

  const { data: parte, error: errP } = await supabase.from("partes_diarios")
    .select("id, user_id, estado").eq("date", fecha).maybeSingle();
  if (errP) throw new Error(`parte: ${errP.message}`);
  if (!parte) return { accion: "sin-parte" };
  if (parte.estado !== "Borrador") return { accion: "respetado", motivo: `esta en "${parte.estado}"` };

  const nombre = nombreAdjuntoLote(lote);
  const { data: yaHay, error: errA } = await supabase.from("partes_archivos")
    .select("id, file_path, file_size").eq("part_id", parte.id)
    .eq("file_type", "InformeLote").eq("file_name", nombre);
  if (errA) throw new Error(`archivos: ${errA.message}`);

  // El mismo informe reenviado tal cual no es un cambio.
  if ((yaHay ?? []).some((a) => num(a.file_size) === contenido.length)) {
    return { accion: "ya-adjuntado", nombre };
  }
  if (yaHay?.length) {
    await supabase.storage.from("partes-archivos").remove(yaHay.map((a) => a.file_path));
    const { error } = await supabase.from("partes_archivos").delete().in("id", yaHay.map((a) => a.id));
    if (error) throw new Error(`reemplazando adjunto: ${error.message}`);
  }

  // La RUTA sin caracteres raros (storage rechaza claves no-ASCII); el NOMBRE
  // visible conserva el codigo tal cual. Mismo criterio que generar-informes.
  const rutaSegura = nombre.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9._-]+/g, "_");
  const ruta = `${parte.user_id}/${parte.id}/InformeLote/${crypto.randomUUID()}-${rutaSegura}`;
  const { error: errU } = await supabase.storage.from("partes-archivos")
    .upload(ruta, contenido, { contentType: MIME_DOCX, upsert: false });
  if (errU) throw new Error(`storage ${nombre}: ${errU.message}`);
  const { error: errI } = await supabase.from("partes_archivos").insert({
    part_id: parte.id, user_id: parte.user_id, file_name: nombre, file_path: ruta,
    file_type: "InformeLote", mime_type: MIME_DOCX, file_size: contenido.length,
  });
  if (errI) throw new Error(`partes_archivos ${nombre}: ${errI.message}`);

  return { accion: yaHay?.length ? "reemplazado" : "adjuntado", nombre, parteCreado: creado.accion === "creado" };
}

/**
 * Deja el parte de un dia al nivel de sus datos: GSTOCK, informes y analisis.
 * Cada paso falla por separado y lo dice — un ERP apagado no puede impedir el
 * analisis, y viceversa. La tarea de la manana repasa la misma ventana, asi
 * que lo que aqui quede a medias se termina solo.
 */
export async function refrescarParteEnVivo(supabase, fecha, { url, key } = {}) {
  const r = { fecha };

  // Los palets del ERP (red de oficina). Import dinamico: quien solo adjunta
  // no carga el driver de MySQL.
  try {
    const [{ conectarErp }, { generarYSubir }] = await Promise.all([
      import("./lib-palets-erp.mjs"), import("./generar-gstock-erp.mjs"),
    ]);
    const conn = await conectarErp();
    try {
      r.gstock = (await generarYSubir(supabase, conn, fecha, { aplicar: true, refrescarSiFaltanKg: 500 })).accion;
    } finally {
      await conn.end().catch(() => {});
    }
  } catch (e) {
    r.gstock = `sin-erp: ${e.message}`;
  }

  try {
    r.informes = (await generarYSubirInformes(supabase, fecha, { aplicar: true })).accion;
  } catch (e) {
    r.informes = `error: ${e.message}`;
  }

  // El MISMO analisis que el boton de la app, forzado porque los informes de
  // este dia acaban de cambiar. Reabre a Borrador si faltan los manuales.
  try {
    const analisis = await analizarPartesPendientes(supabase, {
      url, key, desde: fecha, aplicar: true, forzar: [fecha],
    });
    r.analisis = analisis.find((a) => a.fecha === fecha)?.accion ?? "sin-cambios";
  } catch (e) {
    r.analisis = `error: ${e.message}`;
  }

  // Un parte con estimaciones vigentes no puede quedar en solo lectura por un
  // reanalisis: mismo criterio que estimar-manuales-parte (el operario tiene
  // que poder teclear el dato real, que gana y retira la estimacion).
  try {
    const { data: p } = await supabase.from("partes_diarios")
      .select("id, estado, campos_estimados").eq("date", fecha).maybeSingle();
    if (p?.estado === "Analizado" && p.campos_estimados && Object.keys(p.campos_estimados).length > 0) {
      const { error } = await supabase.from("partes_diarios").update({ estado: "Borrador" }).eq("id", p.id);
      if (!error) r.reabierto = true;
    }
  } catch { /* la tarea de la manana lo normaliza */ }

  return r;
}

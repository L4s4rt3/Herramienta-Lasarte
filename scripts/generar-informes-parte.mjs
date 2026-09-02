/**
 * Genera los Excel del calibrador que la persona subía al parte, y los sube.
 *
 * POR QUÉ ASÍ. Es el mismo criterio que `generar-gstock-erp.mjs`: en vez de
 * escribirle los kilos al parte por detrás, se fabrica EL MISMO fichero que se
 * subía a mano y `analizar-parte` lo procesa con su lógica de siempre. Así el
 * desglose por calibre, el detalle por producto, el destino de la fruta y la
 * protección de los campos manuales siguen funcionando igual, y no hay una vía
 * nueva que mantener.
 *
 * EL HUECO QUE TAPA. Del Sizer solo llega el .docx por lote, y `analizar-parte`
 * lee con XLSX.read: no sabe abrir un .docx. Por eso los partes automáticos se
 * quedaban con el GSTOCK y el análisis avisaba de que "no se ha encontrado la
 * tabla de calibres: este día se queda sin desglose por calibre ni por destino".
 * Los datos SÍ están en `calibrador_clasificacion`; lo que faltaba era darles la
 * forma que el análisis sabe leer.
 *
 * TRES FICHEROS, los mismos nombres que usaba la persona (el nombre importa:
 * `classify()` de la edge function decide por él):
 *
 *   Informe TAMAÑOS CLASE Y CALIDAD.xlsx  calibres, clases, mujeres y podrido
 *   Informe PRODUCTO.xlsx                 kg y cajas por producto
 *   Informe PRODUCCION.xlsx               total del día y detalle por lote
 *
 * EL FORMATO NO SE INVENTA: sale de lo que leen extractCalibresDetalle,
 * extractTamanos, extractProductoDetalle, extractProduccionTotal y
 * extractLotesDetalle. Y los datos ya vienen con la forma buena — `clase` es
 * "(A) Extra 1" y `tamano` es "(01) CITRICA" —, que es justo lo que esos
 * parsers esperan.
 *
 * LA COLUMNA DE PESO VA SIEMPRE EN LA MISMA POSICIÓN (la C). `extractTamanos`
 * busca UNA vez la cabecera "Peso (kg)" en las primeras 100 filas y luego lee
 * esa columna en la fila de "Podrido": si cada tabla la pusiera en un sitio,
 * leería la celda equivocada.
 *
 *   node scripts/generar-informes-parte.mjs --fecha=2026-08-13
 *   node scripts/generar-informes-parte.mjs --fecha=2026-08-13 --aplicar
 */
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";
import { datosCalibradorDelDia, traerTodo } from "./crear-parte-diario.mjs";

try { process.loadEnvFile(path.resolve(".env")); } catch { /* entorno */ }

const MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const num = (v) => Number(v) || 0;
const redondea = (n, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

/** Las líneas de clasificación del día, vengan del volcado o de los informes. */
async function lineasDelDia(supabase, fecha) {
  const cal = await datosCalibradorDelDia(supabase, fecha);
  if (!cal.ids?.length) return { cal, filas: [] };
  const filas = [];
  for (let i = 0; i < cal.ids.length; i += 100) {
    filas.push(...await traerTodo(() => supabase.from("calibrador_clasificacion")
      .select("lote, batch_id, producto, calidad, clase, tamano, grupo_destino, piezas, peso_kg, cartons")
      .in("batch_id", cal.ids.slice(i, i + 100))
      .order("batch_id").order("producto").order("calidad").order("clase").order("tamano")));
  }
  return { cal, filas };
}

const agrupar = (filas, clave) => {
  const m = new Map();
  for (const f of filas) {
    const k = clave(f);
    const acc = m.get(k) ?? { kg: 0, piezas: 0, cartons: 0, filas: [] };
    acc.kg += num(f.peso_kg);
    acc.piezas += num(f.piezas);
    acc.cartons += num(f.cartons);
    acc.filas.push(f);
    m.set(k, acc);
  }
  return m;
};

/**
 * LAS DOS FUENTES NO ESCRIBEN IGUAL, y el parser solo entiende una.
 *
 *   informes DOCX .... clase "(A) Extra 1"   tamaño "(01) CITRICA"
 *   volcado SQL ...... clase "Extra 1"       tamaño "1/30"
 *
 * `extractCalibresDetalle` abre sección con /^\([A-Za-z]\)\s+\w/ y corta la
 * tabla en cuanto un tamaño no empieza por "(". Con los datos del volcado tal
 * cual, el informe salía y el análisis no veía ni una fila: el 11-08 se subió
 * y seguía avisando de que faltaba la tabla de calibres.
 *
 * Aquí se les pone la etiqueta que falta. Lo que ya viene con ella no se toca.
 */
const NORM = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "")
  .toUpperCase().replace(/[^A-Z0-9]/g, "");

/** La letra que usa el propio calibrador en sus informes, para no inventarla. */
const LETRA_CLASE = new Map(Object.entries({
  EXTRA1: "A", EXTRA2: "B", CAT1A: "C", CAT1B: "D", VERDECLARO: "E", CAT2: "F",
  CAT3: "G", VERDEOSCURO: "H", INDUSTRIA: "I", PODRIDO: "J", MUJERES: "L", DENSIDAD: "M",
}));

/** Letras libres para una clase que no esté en el mapa (p. ej. "Recirculo"). */
const SOBRANTES = "KNOPQRSTUVWXYZ".split("");

function etiquetadores(filas) {
  const yaEtiquetada = (s) => /^\([A-Za-z]\)\s+\w/.test(String(s ?? ""));
  const usadas = new Set(LETRA_CLASE.values());
  const extra = new Map();
  for (const c of [...new Set(filas.map((f) => f.clase).filter(Boolean))].sort()) {
    if (yaEtiquetada(c) || LETRA_CLASE.has(NORM(c))) continue;
    const libre = SOBRANTES.find((l) => !usadas.has(l)) ?? "Z";
    usadas.add(libre);
    extra.set(NORM(c), libre);
  }
  // El número del tamaño es el mismo en todo el día, no por sección: así el
  // "(07)" de una clase y el de otra son el mismo calibre, como en el original.
  const orden = new Map([...new Set(filas.map((f) => f.tamano).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, "es", { numeric: true })).map((t, i) => [t, i + 1]));

  return {
    clase: (c) => {
      const v = String(c ?? "").trim() || "Sin clase";
      if (yaEtiquetada(v)) return v;
      return `(${LETRA_CLASE.get(NORM(v)) ?? extra.get(NORM(v)) ?? "Z"}) ${v}`;
    },
    tamano: (t) => {
      const v = String(t ?? "").trim() || "Sin tamaño";
      if (v.startsWith("(")) return v;
      return `(${String(orden.get(v) ?? 0).padStart(2, "0")}) ${v}`;
    },
  };
}

/**
 * Informe de TAMAÑOS, CLASE Y CALIDAD. Una sección por clase:
 *
 *   (A) Extra 1
 *   Grupo de Clasificación:   EXPORTACION
 *   Tamaño        Piezas   Peso (kg)   % peso
 *   (01) CITRICA  110      12,34       0,5
 *   Total                  1234,5
 *
 * Y al final, fuera de las secciones, las dos filas que `extractTamanos` busca
 * por su nombre exacto: "Podrido" (lee su peso en la fila) y "Mujeres" (abre
 * sección y suma hasta el total).
 */
export function hojaTamanos(filas) {
  const filasHoja = [["Informe TAMAÑOS, CLASE Y CALIDAD"], []];
  const total = filas.reduce((s, f) => s + num(f.peso_kg), 0);
  const eti = etiquetadores(filas);

  // EL RESUMEN VA DELANTE, y no es cosmético. `extractCalibresDetalle` cuelga
  // cada tabla de la última clase que haya visto, y no cierra la sección al
  // acabarla: puesto al final, este bloque se leía como calibres de la clase
  // anterior y las mujeres se contaban DOS VECES (el 12-08 daba 92.973 kg de
  // calibres para 85.682 de producción — justo los 7.292 de mujeres de más).
  // Delante, `currentClase` todavía es null y el parser de calibres lo ignora,
  // mientras que `extractTamanos`, que recorre la hoja entera, sí lo encuentra.
  const kgDe = (p) => filas.filter((f) => p.test(f.clase ?? "") || p.test(f.grupo_destino ?? ""));
  const podrido = kgDe(/podrido/i);
  filasHoja.push(["Podrido", redondea(podrido.reduce((s, f) => s + num(f.piezas), 0)),
    redondea(podrido.reduce((s, f) => s + num(f.peso_kg), 0), 3), ""]);
  filasHoja.push([]);

  const mujeres = kgDe(/mujeres/i);
  filasHoja.push(["Mujeres"]);
  filasHoja.push(["Tamaño", "Piezas", "Peso (kg)", "% peso"]);
  for (const [tamano, t] of [...agrupar(mujeres, (f) => eti.tamano(f.tamano))]
    .sort((a, b) => a[0].localeCompare(b[0], "es"))) {
    filasHoja.push([tamano, redondea(t.piezas), redondea(t.kg, 3), ""]);
  }
  filasHoja.push(["Total", "", redondea(mujeres.reduce((s, f) => s + num(f.peso_kg), 0), 3), ""]);
  filasHoja.push([]);

  const porClase = agrupar(filas, (f) => eti.clase(f.clase));
  for (const [clase, acc] of [...porClase].sort((a, b) => a[0].localeCompare(b[0], "es"))) {
    const grupos = [...new Set(acc.filas.map((f) => f.grupo_destino).filter(Boolean))];
    filasHoja.push([clase]);
    filasHoja.push(["Grupo de Clasificación:", grupos.join(" / ") || "SIN GRUPO"]);
    filasHoja.push(["Tamaño", "Piezas", "Peso (kg)", "% peso"]);
    const porTamano = agrupar(acc.filas, (f) => eti.tamano(f.tamano));
    for (const [tamano, t] of [...porTamano].sort((a, b) => a[0].localeCompare(b[0], "es"))) {
      filasHoja.push([tamano, redondea(t.piezas), redondea(t.kg, 3),
        total > 0 ? redondea((t.kg / total) * 100, 2) : 0]);
    }
    filasHoja.push(["Total", redondea(acc.piezas), redondea(acc.kg, 3), ""]);
    filasHoja.push([]);
  }

  return filasHoja;
}

/**
 * Informe PRODUCTO: kg y cajas por producto, con su destino y su EMPAQUE.
 *
 * El empaque no viene del calibrador (el volcado no lo trae): se rellena con el
 * habitual de cada producto (RPC empaques_habituales — el de más kg de su
 * historial en producto_dia). Sin él, este informe nacía con la columna vacía
 * y producto_dia dejó de acumular empaques desde el 11-08 — que es justo lo
 * que el CMV usa para deducir los kg por bulto. Un producto sin historial va
 * vacío, no inventado: su verdad tiene que venir del catálogo del Sizer.
 */
export function hojaProducto(filas, empaques = new Map()) {
  const filasHoja = [["Producto", "Empaque", "Cajas", "Peso (kg)", "Grupo"]];
  const porProducto = agrupar(filas, (f) => `${f.producto ?? ""}||${f.grupo_destino ?? ""}`);
  const orden = [...porProducto].sort((a, b) => b[1].kg - a[1].kg);
  for (const [clave, acc] of orden) {
    const [producto, grupo] = clave.split("||");
    if (!producto) continue;
    filasHoja.push([producto, empaques.get(producto) ?? "", redondea(acc.cartons, 2), redondea(acc.kg, 3), grupo]);
  }
  filasHoja.push(["TOTAL", "", redondea(orden.reduce((s, [, a]) => s + a.cartons, 0), 2),
    redondea(orden.reduce((s, [, a]) => s + a.kg, 0), 3), ""]);
  return filasHoja;
}

/**
 * Informe PRODUCCION: una fila por lote con sus datos de máquina y la fila
 * TOTAL, que es de donde `extractProduccionTotal` saca los kilos del día.
 */
export function hojaProduccion(filas, informes) {
  const cab = ["Lote", "Nombre Productor", "Variedad", "Peso (kg)", "Piezas", "T/h",
    "Peso fruta promedio", "Tiempo de Inicio", "Hora de la Máquina"];
  const filasHoja = [cab];
  const porLote = agrupar(filas, (f) => f.lote ?? "");
  const infoDe = new Map((informes ?? []).map((i) => [i.lote, i]));
  for (const [lote, acc] of [...porLote].sort((a, b) => a[0].localeCompare(b[0], "es"))) {
    const i = infoDe.get(lote) ?? {};
    filasHoja.push([lote, i.productor ?? "", i.commodity ?? "",
      redondea(acc.kg, 3), redondea(acc.piezas),
      i.toneladas_hora ?? "", i.peso_fruta_media_g ?? "",
      i.comienzo ?? "", i.tiempo_maquina ?? ""]);
  }
  filasHoja.push(["TOTAL", "", "", redondea(filas.reduce((s, f) => s + num(f.peso_kg), 0), 3),
    redondea(filas.reduce((s, f) => s + num(f.piezas), 0)), "", "", "", ""]);
  return filasHoja;
}

const libro = (filasHoja, nombreHoja) => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(filasHoja), nombreHoja);
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
};

/**
 * El empaque habitual de cada producto del día. Una sola llamada; si falla, el
 * informe sale igual con la columna vacía — el empaque mejora el informe, pero
 * no puede impedirlo.
 */
async function empaquesDelDia(supabase, filas) {
  const nombres = [...new Set(filas.map((f) => f.producto).filter(Boolean))];
  if (!nombres.length) return new Map();
  const { data, error } = await supabase.rpc("empaques_habituales", { nombres });
  if (error) {
    console.warn(`  (sin empaques habituales: ${error.message})`);
    return new Map();
  }
  return new Map((data ?? []).map((e) => [e.nombre, e.empaque]));
}

/** Los tres informes del día, con el nombre exacto que espera `classify()`. */
export async function informesDelParte(supabase, fecha) {
  const { cal, filas } = await lineasDelDia(supabase, fecha);
  if (filas.length === 0) return { cal, informes: [] };
  const [{ data: informes }, empaques] = await Promise.all([
    supabase.from("calibrador_informe")
      .select("lote, productor, commodity, toneladas_hora, peso_fruta_media_g, comienzo, tiempo_maquina")
      .eq("fecha", fecha),
    empaquesDelDia(supabase, filas),
  ]);
  return {
    cal,
    informes: [
      { nombre: "Informe TAMAÑOS CLASE Y CALIDAD.xlsx", buffer: libro(hojaTamanos(filas), "Tamaños") },
      { nombre: "Informe PRODUCTO.xlsx", buffer: libro(hojaProducto(filas, empaques), "Producto") },
      { nombre: "Informe PRODUCCION.xlsx", buffer: libro(hojaProduccion(filas, informes), "Producción") },
    ],
  };
}

/**
 * Sube los tres al parte del día. Como el GSTOCK: cualquier parte NO Validado
 * (el candado humano; regla del dueño 28-08-2026), y solo se reemplazan los
 * que generó este mismo script (nombre exacto). Un archivo que subió una
 * persona no se toca nunca.
 */
export async function generarYSubirInformes(supabase, fecha, { aplicar = false } = {}) {
  const { data: parte, error: errP } = await supabase.from("partes_diarios")
    .select("id, user_id, estado").eq("date", fecha).maybeSingle();
  if (errP) throw new Error(`parte: ${errP.message}`);
  if (!parte) return { fecha, accion: "sin-parte" };
  if (parte.estado === "Validado") {
    return { fecha, accion: "respetado", motivo: `el parte esta en "${parte.estado}"` };
  }

  const { cal, informes: todos } = await informesDelParte(supabase, fecha);
  if (todos.length === 0) return { fecha, accion: "sin-datos" };

  // EL PRODUCCION SE CAE SI OTRO YA PUSO LOS LOTES. `analizar-parte` limpia de
  // `lotes_dia` solo lo suyo (source = 'ia'): las filas que dejó la sincronización
  // del calibrador (source = 'calibrador') se quedan, y el informe añadiría las
  // mismas otra vez. Paso el 11-08: 10 lotes y 157.378 kg donde el día tenía 5 y
  // 78.689. Los otros dos informes sí van — calibres y producto no los escribe nadie más.
  const { data: lotesAjenos, error: errL } = await supabase.from("lotes_dia")
    .select("id").eq("part_id", parte.id).neq("source", "ia").limit(1);
  if (errL) throw new Error(`lotes_dia: ${errL.message}`);
  const informes = lotesAjenos?.length
    ? todos.filter((i) => !/PRODUCCION/i.test(i.nombre))
    : todos;

  const { data: yaHay, error: errA } = await supabase.from("partes_archivos")
    .select("id, file_name, file_path").eq("part_id", parte.id).eq("file_type", "Produccion");
  if (errA) throw new Error(`archivos: ${errA.message}`);
  // La propiedad se mira contra los TRES nombres, no contra los que toque subir
  // hoy: si un día dejamos de generar uno (el PRODUCCION cuando ya hay lotes del
  // volcado), el que subimos ayer seguiría siendo nuestro y hay que poder
  // retirarlo. Mirándolo contra la lista filtrada, el script se plantaba diciendo
  // que el parte tenía informes de otro.
  const nuestros = new Set(todos.map((i) => i.nombre));
  const ajenos = (yaHay ?? []).filter((a) => !nuestros.has(a.file_name));
  if (ajenos.length) {
    return { fecha, accion: "respetado",
      motivo: `el parte ya tiene informes que no genero este script (${ajenos.map((a) => a.file_name).join(", ")})` };
  }

  if (!aplicar) {
    return { fecha, accion: yaHay?.length ? "reharia" : "subiria", origen: cal.origen,
      ficheros: informes.map((i) => `${i.nombre} (${Math.round(i.buffer.length / 1024)} kB)`) };
  }

  // Fuera los viejos antes de subir: si se subiera primero y algo fallara en
  // medio, el parte tendria dos copias del mismo informe y el analisis leeria
  // una de las dos al azar. Sin ellos, la siguiente pasada los regenera.
  //
  // PRIMERO LAS FILAS, LUEGO LOS FICHEROS, Y CON REINTENTO (02-09-2026). El
  // analisis del parte (edge analizar-parte, que tambien lanza el buzon al
  // importar un informe a las :15) escribe lote_clasificacion, cuya FK a
  // partes_archivos hace que este DELETE espere su bloqueo; con el timeout de 8 s
  // de PostgREST moria cada mañana ("canceling statement due to statement
  // timeout"). Y como el storage se borraba ANTES, el timeout dejaba filas que
  // apuntaban a ficheros que ya no existian. Ahora: si las filas no se pueden
  // borrar, no se toca nada y el parte conserva sus informes de antes.
  if (yaHay?.length) {
    let error = null;
    for (let intento = 1; intento <= 3; intento++) {
      ({ error } = await supabase.from("partes_archivos").delete().in("id", yaHay.map((a) => a.id)));
      if (!error || !/statement timeout|57014|lock/i.test(error.message ?? "")) break;
      await new Promise((r) => setTimeout(r, 5000 * intento));
    }
    if (error) throw new Error(`borrando informes viejos: ${error.message}`);
    await supabase.storage.from("partes-archivos").remove(yaHay.map((a) => a.file_path));
  }

  for (const inf of informes) {
    // La RUTA va sin tildes ni Ñ: storage rechaza la clave ("Invalid key") en
    // cuanto lleva un carácter que no sea ASCII. El NOMBRE del archivo sí las
    // conserva, y es el que importa: `classify()` de la edge function decide
    // por él a qué parser mandar cada fichero.
    const rutaSegura = inf.nombre.normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/Ñ/g, "N").replace(/ñ/g, "n").replace(/[^A-Za-z0-9._-]+/g, "_");
    const ruta = `${parte.user_id}/${parte.id}/Produccion/${crypto.randomUUID()}-${rutaSegura}`;
    const { error: errU } = await supabase.storage.from("partes-archivos")
      .upload(ruta, inf.buffer, { contentType: MIME, upsert: false });
    if (errU) throw new Error(`storage ${inf.nombre}: ${errU.message}`);
    const { error: errI } = await supabase.from("partes_archivos").insert({
      part_id: parte.id, user_id: parte.user_id, file_name: inf.nombre, file_path: ruta,
      file_type: "Produccion", mime_type: MIME, file_size: inf.buffer.length,
    });
    if (errI) throw new Error(`partes_archivos ${inf.nombre}: ${errI.message}`);
  }

  return { fecha, accion: yaHay?.length ? "rehecho" : "subido", origen: cal.origen,
    ficheros: informes.map((i) => i.nombre) };
}

async function main() {
  const args = process.argv.slice(2);
  const aplicar = args.includes("--aplicar");
  const fecha = args.find((a) => a.startsWith("--fecha="))?.split("=")[1];
  if (!fecha) throw new Error("Hace falta --fecha=YYYY-MM-DD");

  const supabase = createClient(
    process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  const r = await generarYSubirInformes(supabase, fecha, { aplicar });
  console.log(`Informes del ${r.fecha}: ${r.accion}${r.motivo ? ` (${r.motivo})` : ""}` +
    (r.origen ? ` · fuente ${r.origen}` : ""));
  for (const f of r.ficheros ?? []) console.log(`  ${f}`);
  if (!aplicar && ["subiria", "reharia"].includes(r.accion)) {
    console.log("\n(simulacion: repite con --aplicar, y despues analiza el parte)");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
}

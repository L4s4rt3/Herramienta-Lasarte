/**
 * importar-asistencia-reloj.mjs — lleva el export del RELOJ de fichajes a
 * `asistencia_detalle`, para que la asistencia deje de teclearse en la app.
 *
 * POR QUÉ. La asistencia de la app solo entraba a mano: el volcado semanal de
 * los lunes se paró el 04-08-2026 y desde entonces todo lo que cuelga de ella
 * (kg/persona, personal €/kg, «Por tipo de día», fichas, efecto presencia) iba
 * a ciegas, aunque el reloj de presencia tenía el dato de cada día. El export
 * del reloj ya se leía para el correo diario (parsear_asistencias.py), pero se
 * quedaba en un JSON del portátil. Aquí se lleva a la base con la MISMA forma
 * que escribe la app, así las pantallas no distinguen de dónde vino.
 *
 * QUÉ HACE
 *   1. Lee los exports del reloj: asistencia*.xlsx de scripts/informe-produccion
 *      (la carpeta donde ya se dejan para el correo diario); --fichero/--carpeta
 *      para otros sitios. Si un (nombre, día) viene en dos exports gana el más
 *      nuevo. Un Excel que no sea del reloj se ignora y se dice.
 *   2. Casa cada nombre con `trabajadores` como lo hace la app (nombre exacto,
 *      conjunto de tokens, alias aprendidos en trabajadores_alias, subconjunto
 *      de tokens) y, si nada casa, por aproximación (marcado para revisar).
 *      Lo que no casa se LISTA y no se carga ni se crea: dar de alta a alguien
 *      es decisión de la app, no de un script.
 *   3. Para cada día del rango con fichajes escribe una fila por trabajador
 *      ACTIVO: presente = al menos 1 h en el reloj, motivo_ausencia null,
 *      user_id el del volcado manual (se hereda, no se inventa). Un día que YA
 *      tiene asistencia (tecleada o volcada) se salta y se compara; solo
 *      --forzar lo pisa. Un día sin ningún fichaje no se inventa.
 *   4. Por defecto SOLO INFORMA. Con --aplicar escribe (upsert por
 *      date,trabajador_id: repetirlo no duplica nada) y deja rastro en
 *      sistema_ejecuciones/latidos como los demás trabajos del portátil.
 *
 *   node scripts/importar-asistencia-reloj.mjs                        # informe: del día siguiente al último cargado hasta ayer
 *   node scripts/importar-asistencia-reloj.mjs --desde=2026-08-05 --hasta=2026-09-03
 *   node scripts/importar-asistencia-reloj.mjs --aplicar               # escribe
 *   --forzar            pisa los días que ya tienen asistencia
 *   --fichero=RUTA      añade un export concreto (repetible)
 *   --carpeta=RUTA      escanea esa carpeta en vez de scripts/informe-produccion (repetible)
 *   --solo-estrictos    sin la capa de aproximación de nombres
 *
 * Requiere SUPABASE_URL (o VITE_SUPABASE_URL) y SUPABASE_SERVICE_ROLE_KEY en .env.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as XLSX from "xlsx";
import { createClient } from "@supabase/supabase-js";
import { anotarEjecucion, salirConError } from "./lib-registro-ejecuciones.mjs";
import {
  UMBRAL_HORAS_PRESENTE,
  casarNombresReloj,
  fusionarRegistros,
  normalizarNombre,
  planificarCarga,
  registrosDeFilas,
  sumaDias,
} from "./lib-asistencia-reloj.mjs";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, "..");
try { process.loadEnvFile(path.join(RAIZ, ".env")); } catch { /* sin .env: se usan las variables del entorno */ }

const TRABAJO = "importar-asistencia-reloj";
const CARPETA_POR_DEFECTO = path.join(AQUI, "informe-produccion");
const PATRON_EXPORT = /^asistencias?\b.*\.xlsx$/i; // "asistencias.xlsx", "asistencia 280826.xlsx", "Asistencia-19082026.xlsx"
const inicio = new Date().toISOString();

// ─── Argumentos ─────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const valores = (n) => args.filter((a) => a.startsWith(`--${n}=`)).map((a) => a.slice(n.length + 3)).filter(Boolean);
const aplicar = flag("aplicar");
const forzar = flag("forzar");
const soloEstrictos = flag("solo-estrictos");
const hoyMadrid = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid" }).format(new Date());
const esIso = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s ?? "");
for (const n of ["desde", "hasta"]) {
  const v = valores(n)[0];
  if (v && !esIso(v)) { console.error(`--${n} debe ser YYYY-MM-DD (recibido: ${v})`); process.exit(2); }
}

// ─── Supabase ───────────────────────────────────────────────────────────────
const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Faltan SUPABASE_URL (o VITE_SUPABASE_URL) y SUPABASE_SERVICE_ROLE_KEY en el .env.");
  process.exit(2);
}
const db = createClient(url, key, { auth: { persistSession: false } });

// PostgREST recorta a 1.000 filas en silencio: todo SELECT no acotado se pagina
// con un orden estable (regla de la casa, ver src/lib/supabaseFetchAll).
const PAGINA = 1000;
async function fetchTodas(consulta) {
  const out = [];
  for (let desde = 0; ; desde += PAGINA) {
    const { data, error } = await consulta(desde, desde + PAGINA - 1);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if ((data ?? []).length < PAGINA) return out;
  }
}

// ─── Ficheros del reloj ─────────────────────────────────────────────────────
const avisosFicheros = [];

function localizarExports() {
  const carpetas = valores("carpeta").length ? valores("carpeta").map((c) => path.resolve(c)) : [CARPETA_POR_DEFECTO];
  const rutas = new Set();
  for (const carpeta of carpetas) {
    if (!fs.existsSync(carpeta)) { avisosFicheros.push(`la carpeta no existe: ${carpeta}`); continue; }
    for (const f of fs.readdirSync(carpeta)) {
      if (PATRON_EXPORT.test(f) && !f.startsWith("~$")) rutas.add(path.join(carpeta, f));
    }
  }
  for (const f of valores("fichero")) {
    const ruta = path.resolve(f);
    if (fs.existsSync(ruta)) rutas.add(ruta);
    else avisosFicheros.push(`el fichero no existe: ${ruta}`);
  }
  // por fecha de modificación, del más viejo al más nuevo: el nuevo pisa al viejo
  return [...rutas]
    .map((ruta) => ({ ruta, mtime: fs.statSync(ruta).mtimeMs }))
    .sort((a, b) => a.mtime - b.mtime);
}

function leerExport(ruta) {
  // XLSX.read sobre el buffer, no XLSX.readFile: importado como ESM
  // (import * as XLSX) el paquete solo expone readFile en `default`, y aquí se
  // usa el mismo estilo de import que el resto de scripts del repo.
  const wb = XLSX.read(fs.readFileSync(ruta), { type: "buffer", cellDates: false });
  const hoja = wb.Sheets[wb.SheetNames[0]];
  const filas = XLSX.utils.sheet_to_json(hoja, { header: 1, defval: null, raw: true });
  return registrosDeFilas(filas, { fichero: path.basename(ruta) });
}

// ─── Presentación ───────────────────────────────────────────────────────────
const DIAS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
const etiqueta = (iso) => `${DIAS[new Date(`${iso}T12:00:00Z`).getUTCDay()]} ${iso}`;
const lista = (items, f) => items.map((x) => `    - ${f(x)}`).join("\n");

// ─── Programa ───────────────────────────────────────────────────────────────
async function main() {
  console.log(`Importador del reloj de fichajes — modo ${aplicar ? (forzar ? "APLICAR + FORZAR" : "APLICAR") : "INFORME (no escribe; --aplicar para cargar)"}`);

  // 1. Exports
  const exports = localizarExports();
  for (const a of avisosFicheros) console.log(`  AVISO: ${a}`);
  if (exports.length === 0) {
    throw new Error(`No hay ningún export del reloj (asistencia*.xlsx) en ${CARPETA_POR_DEFECTO}. Exporta el fichero del programa del reloj a esa carpeta o pásalo con --fichero=RUTA.`);
  }
  const listas = [];
  console.log(`\nExports leídos (${exports.length}):`);
  for (const { ruta } of exports) {
    let registros = null;
    try { registros = leerExport(ruta); } catch (e) { console.log(`  x ${path.basename(ruta)}: no se pudo leer (${e.message})`); continue; }
    if (!registros) { console.log(`  x ${path.basename(ruta)}: no es un export del reloj (sin la cabecera Productor/Fecha/Total), se ignora`); continue; }
    const fechas = [...new Set(registros.map((r) => r.fecha))].sort();
    console.log(`  · ${path.basename(ruta)}: ${registros.length} fichajes, ${fechas.length} día(s) ${fechas[0] ?? "—"} → ${fechas.at(-1) ?? "—"}`);
    listas.push(registros);
  }
  const registros = fusionarRegistros(listas);
  if (registros.length === 0) throw new Error("Los exports no traen ningún fichaje legible.");
  const fechasReloj = [...new Set(registros.map((r) => r.fecha))].sort();

  // 2. Rango: por defecto, del día siguiente al último cargado hasta ayer
  const { data: ultimaFila, error: eUltima } = await db.from("asistencia_detalle").select("date, user_id").order("date", { ascending: false }).limit(1);
  if (eUltima) throw new Error(`asistencia_detalle: ${eUltima.message}`);
  const ultimoCargado = ultimaFila?.[0]?.date ?? null;
  const desde = valores("desde")[0] ?? (ultimoCargado ? sumaDias(ultimoCargado, 1) : fechasReloj[0]);
  const hasta = valores("hasta")[0] ?? sumaDias(hoyMadrid(), -1);
  console.log(`\nRango: ${desde} → ${hasta}` + (ultimoCargado ? ` (último día con asistencia en la base: ${ultimoCargado})` : " (la base no tiene asistencia todavía)"));
  console.log(`El reloj cubre ${fechasReloj[0]} → ${fechasReloj.at(-1)} (${fechasReloj.length} días con fichajes).`);
  if (desde > hasta) {
    console.log("Nada que cargar: el rango está vacío.");
    if (aplicar) await anotarEjecucion({ trabajo: TRABAJO, inicio, estado: "ok", detalle: `rango vacío ${desde} → ${hasta}`, datos: { modo: "aplicar", desde, hasta, dias_cargados: [] } });
    return;
  }

  // El user_id se hereda del volcado manual (el dueño desde la app): la fila
  // queda firmada igual que las tecleadas y no se inventa ninguna identidad.
  const userId = ultimaFila?.[0]?.user_id;
  if (!userId) throw new Error("No hay ninguna fila previa en asistencia_detalle de la que heredar el user_id: haz un primer volcado desde la app.");

  // 3. Plantilla, alias y lo que ya hay en el rango
  const [trabajadores, aliasFilas, existentes, bajas] = await Promise.all([
    fetchTodas((a, b) => db.from("trabajadores").select("id, nombre, activo").order("nombre").range(a, b)),
    fetchTodas((a, b) => db.from("trabajadores_alias").select("alias, trabajador_id").order("id").range(a, b)),
    fetchTodas((a, b) => db.from("asistencia_detalle").select("date, presente").gte("date", desde).lte("date", hasta).order("date").order("trabajador_id").range(a, b)),
    fetchTodas((a, b) => db.from("asistencia_bajas_laborales").select("trabajador_id, fecha_inicio, fecha_fin").lte("fecha_inicio", hasta).or(`fecha_fin.is.null,fecha_fin.gte.${desde}`).order("id").range(a, b)),
  ]);
  // mismo formato de clave que useTrabajadoresAlias (normalizeAlias ≡ normalizarNombre)
  const aliasPorNombre = new Map(aliasFilas.map((a) => [normalizarNombre(a.alias), a.trabajador_id]));
  const diasExistentes = new Map();
  for (const f of existentes) {
    const d = diasExistentes.get(f.date) ?? { filas: 0, presentes: 0 };
    d.filas += 1;
    if (f.presente) d.presentes += 1;
    diasExistentes.set(f.date, d);
  }
  console.log(`Plantilla: ${trabajadores.filter((t) => t.activo).length} activos de ${trabajadores.length}; ${aliasPorNombre.size} alias aprendidos en la app.`);

  // 4. Casar y planificar
  const casados = casarNombresReloj(registros.map((r) => r.nombre), trabajadores, aliasPorNombre, { aproximado: !soloEstrictos });
  const plan = planificarCarga({ registros, casados, trabajadores, diasExistentes, desde, hasta, forzar, userId });
  const porId = new Map(trabajadores.map((t) => [t.id, t]));

  const n = plan.nombres;
  console.log(`\nNombres del reloj en el rango: ${n.casados.length} casados` +
    `${n.aproximados.length ? `, ${n.aproximados.length} por aproximación` : ""}` +
    `${n.inactivos.length ? `, ${n.inactivos.length} inactivos` : ""}` +
    `${n.ambiguos.length ? `, ${n.ambiguos.length} ambiguos` : ""}` +
    `, ${n.sinCasar.length} SIN CASAR.`);
  if (n.aproximados.length) {
    console.log("  Casados por APROXIMACIÓN (se cargan; si es correcto, vincúlalos en la app para fijarlo como alias):");
    console.log(lista(n.aproximados, (x) => `"${x.nombre}" → ${x.casado.trabajador.nombre} (${x.diasConHoras} días ≥1 h)`));
  }
  if (n.inactivos.length) {
    console.log("  INACTIVOS en la app pero con fichajes (NO se cargan; si han vuelto, reactivarlos en la app):");
    console.log(lista(n.inactivos, (x) => `"${x.nombre}" → ${x.casado.trabajador.nombre} (${x.diasConHoras} días ≥1 h)`));
  }
  if (n.ambiguos.length) {
    console.log("  AMBIGUOS (casan con varios; NO se cargan; vincular en la app):");
    console.log(lista(n.ambiguos, (x) => `"${x.nombre}" ~ ${x.casado.candidatos.map((c) => c.nombre).join(" / ")}`));
  }
  if (n.sinCasar.length) {
    console.log("  SIN CASAR (NO se cargan ni se crean; vincular o dar de alta en la app):");
    console.log(lista(n.sinCasar, (x) => `"${x.nombre}" (${x.diasConHoras} días ≥1 h de ${x.dias} con fichaje, ${x.horas} h)`));
  }
  if (plan.activosNuncaEnReloj.length) {
    console.log(`  Activos en la app que NO fichan ≥1 h ningún día del rango (quedarán ausentes todos los días): ${plan.activosNuncaEnReloj.length}`);
    console.log(lista(plan.activosNuncaEnReloj, (t) => t.nombre));
  }

  // Bajas laborales abiertas con fichaje: el reloj manda (presente), pero la
  // baja no se cierra desde aquí — eso lo hace la app al marcar a mano, y es
  // una decisión que conviene mirar (¿ha vuelto o fue a llevar un papel?).
  const bajaCubre = (b, fecha) => b.fecha_inicio <= fecha && (b.fecha_fin == null || b.fecha_fin >= fecha);
  const fichanDeBaja = new Map();
  for (const d of plan.aCargar) {
    for (const f of d.filas) {
      if (!f.presente) continue;
      const b = bajas.find((x) => x.trabajador_id === f.trabajador_id && bajaCubre(x, d.fecha));
      if (b) fichanDeBaja.set(f.trabajador_id, { desde: b.fecha_inicio, dias: (fichanDeBaja.get(f.trabajador_id)?.dias ?? 0) + 1 });
    }
  }
  if (fichanDeBaja.size) {
    console.log("  Con BAJA LABORAL abierta en la app pero fichando (se cargan presentes; revisar/cerrar la baja en la app):");
    console.log(lista([...fichanDeBaja], ([id, x]) => `${porId.get(id)?.nombre ?? id}: ${x.dias} día(s), baja abierta desde ${x.desde}`));
  }

  // 5. Días
  console.log(`\nDías del rango (${plan.dias.length}): ${plan.aCargar.length} a cargar, ${plan.yaCargados.length} ya con asistencia${forzar ? " (se pisan)" : " (se saltan)"}, ${plan.sinDatos.length} sin fichajes.`);
  for (const d of plan.dias) {
    if (d.estado === "sin-datos") continue;
    const bd = d.existente ? ` | en la base: ${d.existente.presentes} presentes / ${d.existente.filas} filas` : "";
    const sinCasar = d.presentesReloj - d.presentesCasados;
    const aviso = sinCasar > 0 ? ` (${sinCasar} sin casar)` : "";
    const accion = d.estado === "cargar" ? `${aplicar ? "CARGAR" : "cargaría"} ${d.filas.length} filas` : "ya cargado, se salta";
    console.log(`  ${etiqueta(d.fecha)}  reloj ${String(d.presentesReloj).padStart(2)} presentes (≥${UMBRAL_HORAS_PRESENTE} h) → ${d.presentesCasados} en la app${aviso}  ${accion}${bd}`);
  }
  const laborablesSinDatos = plan.sinDatos.filter((d) => !d.finDeSemana).map((d) => d.fecha);
  if (plan.sinDatos.length) {
    const fines = plan.sinDatos.length - laborablesSinDatos.length;
    console.log(`  Sin fichajes en el reloj: ${laborablesSinDatos.length} laborable(s)${laborablesSinDatos.length ? ` [${laborablesSinDatos.join(", ")}]` : ""}` +
      `${fines ? ` y ${fines} de fin de semana` : ""} → no se escribe nada (falta el export de esos días o no se trabajó).`);
  }

  // 6. Escribir
  const cargados = [];
  let filasEscritas = 0;
  if (aplicar) {
    for (const d of plan.aCargar) {
      const { error } = await db.from("asistencia_detalle").upsert(d.filas, { onConflict: "date,trabajador_id" });
      if (error) throw new Error(`${d.fecha}: ${error.message} (cargados hasta ahora: ${cargados.join(", ") || "ninguno"})`);
      cargados.push(d.fecha);
      filasEscritas += d.filas.length;
    }
    console.log(`\nCargados ${cargados.length} día(s), ${filasEscritas} filas: ${cargados.join(", ") || "ninguno"}.`);
  } else {
    console.log(`\nInforme terminado: no se ha escrito nada. Repite con --aplicar para cargar ${plan.aCargar.length} día(s).`);
  }

  // 7. Rastro (solo al aplicar: una simulación no es un trabajo hecho)
  if (aplicar) {
    const pendientes = [];
    if (n.sinCasar.length) pendientes.push(`${n.sinCasar.length} nombre(s) sin casar`);
    if (n.ambiguos.length) pendientes.push(`${n.ambiguos.length} ambiguo(s)`);
    if (n.inactivos.length) pendientes.push(`${n.inactivos.length} inactivo(s) con fichajes`);
    if (n.aproximados.length) pendientes.push(`${n.aproximados.length} por aproximación`);
    if (laborablesSinDatos.length) pendientes.push(`${laborablesSinDatos.length} laborable(s) sin export`);
    if (fichanDeBaja.size) pendientes.push(`${fichanDeBaja.size} fichando de baja`);
    const detalle = `${cargados.length} día(s) cargados (${desde} → ${hasta})${pendientes.length ? " · revisar: " + pendientes.join(", ") : ""}`;
    await anotarEjecucion({
      trabajo: TRABAJO, inicio, estado: pendientes.length ? "aviso" : "ok", detalle: detalle.slice(0, 200),
      datos: {
        modo: forzar ? "aplicar+forzar" : "aplicar",
        desde, hasta,
        exports: exports.length,
        dias_cargados: cargados,
        filas: filasEscritas,
        presentes_por_dia: Object.fromEntries(plan.aCargar.map((d) => [d.fecha, d.presentesCasados])),
        dias_saltados: plan.yaCargados.map((d) => d.fecha),
        laborables_sin_export: laborablesSinDatos,
        sin_casar: n.sinCasar.map((x) => x.nombre),
        aproximados: n.aproximados.length,
        ambiguos: n.ambiguos.length,
        inactivos_con_fichajes: n.inactivos.length,
        fichando_de_baja: fichanDeBaja.size,
      },
    });
  }
}

main().catch(async (e) => {
  console.error(`\nERROR: ${e.message ?? e}`);
  if (aplicar) await anotarEjecucion({ trabajo: TRABAJO, inicio, estado: "error", detalle: String(e.message ?? e).slice(0, 200), datos: { modo: "aplicar" } });
  await salirConError(1);
});

/**
 * correo-diario.mjs — correo automático diario de RENDIMIENTO (sin euros).
 *
 * Cada mañana envía el rendimiento de AYER + el acumulado de la semana en curso,
 * con el mismo contenido que el Excel de rendimiento (el de la encargada):
 * kg, producción real, kg/persona, zonas con arranque, categorías y destinos.
 *
 * Es el gemelo diario del informe semanal del lunes, pero corre EN EL PORTÁTIL
 * (patrón del aviso de las 07:10) porque necesita cosas que solo viven aquí:
 * los DOCX del calibrador cuando el volcado no está y el export del reloj.
 * Deja rastro en sistema_ejecuciones/latidos ("informe-rendimiento-diario"):
 * el vigilante avisa si deja de correr.
 *
 * Si ayer no hubo producción (domingo, festivo) NO envía nada, solo lo anota.
 *
 *   node scripts/informe-produccion/correo-diario.mjs                  # ayer
 *   node scripts/informe-produccion/correo-diario.mjs --fecha=2026-08-14
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, "../..");
process.loadEnvFile(path.join(RAIZ, ".env"));
const { anotarEjecucion, salirConError } = await import(pathToFileURL(path.join(RAIZ, "scripts/lib-registro-ejecuciones.mjs")).href);

const TRABAJO = "informe-rendimiento-diario";
const DESTINOS = (process.env.INFORME_DIARIO_PARA ?? "soporte@lasartesat.es")
  .split(/[,;]/).map((d) => d.trim()).filter((d) => /@/.test(d));
const RESPONDER_A = "soporte@lasartesat.es";
const REMITENTE = "Informes Lasarte <informes@comunicaciones.lasartesat.com>";
const inicio = new Date().toISOString();

const hoyMadrid = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid" }).format(new Date());
const sumaDias = (iso, n) => { const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const argFecha = process.argv.find((a) => a.startsWith("--fecha="))?.split("=")[1];
const AYER = argFecha ?? sumaDias(hoyMadrid(), -1);

// Estándar acordado (estandar.json editable). Desde el 27-08 depende del
// RÉGIMEN de plantilla (decisión del dueño tras el análisis por tipo de día):
// reducida = media plantilla (presentes <= corte, el régimen de agosto);
// completa = plantilla entera aunque haya faltas. Compatible con el formato
// plano antiguo por si se restaura un estandar.json viejo.
let EST = null;
try { EST = JSON.parse(fs.readFileSync(path.join(AQUI, "estandar.json"), "utf-8")); } catch { /* sin estándar */ }
function estandarDelDia(presentes) {
  if (!EST) return null;
  if (!EST.regimenes) return { suelo: EST.kgPersonaSuelo, objetivo: EST.kgPersonaObjetivo, regimen: null };
  const corte = EST.cortePlantillaReducida ?? 35;
  const nombre = presentes != null && presentes > corte ? "completa" : "reducida";
  const r = EST.regimenes[nombre];
  return { suelo: r.kgPersonaSuelo, objetivo: r.kgPersonaObjetivo, regimen: nombre };
}
function semaforoEstandar(kgp, presentes) {
  const est = estandarDelDia(presentes);
  if (!est || kgp == null) return null;
  const sufijo = est.regimen ? (est.regimen === "reducida" ? " · listón media plantilla" : " · listón plantilla completa") : "";
  if (kgp >= est.objetivo) return { texto: `EN OBJETIVO${sufijo}`, color: "#2F8F4E", ...est };
  if (kgp >= est.suelo) return { texto: `entre suelo y objetivo${sufijo}`, color: "#B07817", ...est };
  return { texto: `BAJO EL SUELO — día a explicar${sufijo}`, color: "#93384F", ...est };
}

const DIAS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
const etq = (iso) => `${DIAS[new Date(iso + "T12:00:00Z").getUTCDay()]} ${iso.slice(8, 10)}-${iso.slice(5, 7)}`;
const n0 = (v) => (v == null ? "—" : Math.round(v).toLocaleString("es-ES"));
const n1 = (v) => (v == null ? "—" : v.toLocaleString("es-ES", { minimumFractionDigits: 1, maximumFractionDigits: 1 }));
const pct = (v) => (v == null ? "—" : (v * 100).toLocaleString("es-ES", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + " %");

async function main() {
  // 1. Reloj de presencia (si hay export nuevo, se reparsea; si no, se usa el último)
  if (fs.existsSync(path.join(AQUI, "asistencias.xlsx"))) {
    try {
      execFileSync("python", ["parsear_asistencias.py"], { cwd: AQUI, stdio: "pipe" });
    } catch (e) {
      console.warn("parsear_asistencias falló (se sigue con el último JSON):", e.message?.slice(0, 200));
    }
  }

  // 1b. Lotes exportados a Excel desde el visor del Sizer (si los hay)
  try {
    execFileSync("python", ["parsear_lotes_extra.py"], { cwd: AQUI, stdio: "pipe" });
  } catch { /* sin lotes extra */ }

  // 2. Motor (mismas funciones que la app, vía vite-node)
  execFileSync(process.execPath, ["node_modules/vite-node/vite-node.mjs", "scripts/informe-produccion/informe-produccion.ts", `--hasta=${AYER}`], { cwd: RAIZ, stdio: "pipe" });
  const d = JSON.parse(fs.readFileSync(path.join(AQUI, "salida", "informe-datos.json"), "utf-8"));
  const dia = d.dias.find((x) => x.fecha === AYER);

  // 2b. Parte diario IMPRIMIBLE (2 paginas): personas, zonas, lotes/fincas y productos.
  //     Va adjunto al correo para imprimirlo y hablarlo con la encargada.
  let pdfAdjunto = null;
  if (dia && (dia.kgCalibrador ?? 0) >= 500) {
    try {
      execFileSync("python", ["build_dia_print.py", `--fecha=${AYER}`], { cwd: AQUI, stdio: "pipe" });
      const xlsxDia = path.join(AQUI, "salida", `IMPRIMIR - dia ${AYER}.xlsx`);
      const pdfDia = path.join(AQUI, "salida", `IMPRIMIR - dia ${AYER}.pdf`);
      if (fs.existsSync(xlsxDia)) {
        execFileSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "recalc_excel.ps1", "-Ruta", xlsxDia, "-Pdf", pdfDia], { cwd: AQUI, stdio: "pipe" });
        if (fs.existsSync(pdfDia)) pdfAdjunto = pdfDia;
      }
    } catch (e) {
      console.warn("parte imprimible del dia fallo (el correo sale sin adjunto):", e.message?.slice(0, 200));
    }
  }

  // 3. Sin producción ayer → no se envía nada (domingos, festivos)
  if (!dia || (dia.kgCalibrador ?? 0) < 500) {
    console.log(`${AYER}: sin producción (${Math.round(dia?.kgCalibrador ?? 0)} kg) — no se envía correo.`);
    await anotarEjecucion({ trabajo: TRABAJO, inicio, estado: "ok", detalle: `${AYER} sin producción: no se envía`, datos: { fecha: AYER, kg: Math.round(dia?.kgCalibrador ?? 0) } });
    return;
  }

  // 4. Números de AYER
  const prods = d.productosDia.filter((p) => p.fecha === AYER);
  const kgTot = prods.reduce((s, p) => s + p.kg, 0) || 1;
  const kgDest = (claves) => prods.filter((p) => claves.includes(p.destino)).reduce((s, p) => s + p.kg, 0);
  const arranque = dia.detallePersonas.filter((p) => p.tipo === "tratamiento").length;
  const sinPersonas = dia.presentes === 0;

  const MAPA_ZONA = { Mesas: "Envasadoras", Mallas: "Mallas", Graneleras: "Graneleras", Industria: "Industria" };
  const kgZona = {};
  for (const p of prods) {
    const g = MAPA_ZONA[p.zona];
    if (g) kgZona[g] = (kgZona[g] ?? 0) + p.kg;
  }
  const filaZona = (g) => {
    const pz = g === "Industria" ? 0 : (dia.personasPorGrupo[g] ?? 0);
    const total = pz + arranque;
    const kgp = !sinPersonas && total > 0 && kgZona[g] ? kgZona[g] / total : null;
    return { g, kg: kgZona[g] ?? 0, pz, total, kgp };
  };
  const zonas = ["Mallas", "Envasadoras", "Graneleras", "Industria"].map(filaZona).filter((z) => z.kg > 0 || z.pz > 0);

  const cats = d.categoriasDia.filter((c) => c.fecha === AYER).sort((a, b) => b.kg - a.kg).slice(0, 8);

  // Semana en curso (hasta ayer) vs semana anterior completa
  const diasAct = d.dias.filter((x) => d.semanaActual.includes(x.fecha) && x.kgCalibrador > 0);
  const diasAnt = d.dias.filter((x) => d.semanaAnterior.includes(x.fecha) && x.kgCalibrador > 0);
  const resumen = (ds) => {
    const kg = ds.reduce((s, x) => s + x.kgCalibrador, 0);
    const pr = ds.reduce((s, x) => s + x.produccionReal, 0);
    const comp = ds.reduce((s, x) => s + x.computables, 0);
    return { kg, pr, dias: ds.length, kgp: comp > 0 ? pr / comp : null };
  };
  const act = resumen(diasAct);
  const ant = resumen(diasAnt);

  // Avisos SOLO en cristiano y solo los que cambian la lectura del día.
  const avisos = [];
  if (sinPersonas) avisos.push("Ayer no hay datos del reloj de personas: el kg/persona va en blanco (dejar el export del reloj en la carpeta).");
  if (dia.sinParte) avisos.push("El parte de ayer aún no está metido: la producción real es provisional.");

  const kgp = dia.kgPersona;
  const sem = semaforoEstandar(kgp, dia.presentes);

  // ─── Correo claro: veredicto grande + 5 números + barra de destinos + zonas ─
  const n = (v) => (v == null ? "—" : Math.round(v).toLocaleString("es-ES"));
  const destinos = [
    { nombre: "Mercadona", kg: kgDest(["mdna3", "mdna4", "mdna5", "mdnaGranel"]), color: "#4269D0" },
    { nombre: "Otros clientes", kg: kgDest(["otrosEmp", "otrosGranel"]), color: "#2F8F4E" },
    { nombre: "Precalibrado", kg: kgDest(["prec"]), color: "#8A63C9" },
    { nombre: "Industria", kg: kgDest(["industria"]), color: "#B07817" },
    { nombre: "Podrido", kg: kgDest(["podrido", "muestra"]), color: "#93384F" },
  ].filter((x) => x.kg > 0);
  const barra = destinos.map((x) =>
    `<td style="width:${Math.max(2, Math.round((x.kg / kgTot) * 100))}%;background:${x.color};height:16px;line-height:16px;font-size:1px">&nbsp;</td>`).join("");
  const leyenda = destinos.map((x) =>
    `<span style="white-space:nowrap"><span style="color:${x.color};font-size:16px">&#9632;</span> ${x.nombre} <b>${((x.kg / kgTot) * 100).toFixed(0)} %</b></span>`).join(" &nbsp;&nbsp; ");

  const filaGrande = (etiqueta, valor, detalle = "") =>
    `<tr><td style="padding:7px 0;border-bottom:1px solid #eceff3;color:#555;font-size:14px">${etiqueta}</td>
     <td style="padding:7px 0;border-bottom:1px solid #eceff3;text-align:right;font-size:16px;color:#1a1a2e"><b>${valor}</b> <span style="color:#888;font-size:12px">${detalle}</span></td></tr>`;

  const colorSem = sem ? sem.color : "#666";
  const html = `
<div style="font-family:Arial,Helvetica,sans-serif;color:#1a1a2e;max-width:560px;margin:0 auto">
  <p style="margin:0 0 2px;color:#888;font-size:12px">Lasarte Cítricos · rendimiento diario · sin euros</p>
  <h2 style="margin:0 0 12px;font-size:22px">Ayer, ${etq(AYER)}</h2>

  <div style="border-left:6px solid ${colorSem};background:#f6f7f9;padding:12px 16px;border-radius:0 8px 8px 0;margin-bottom:16px">
    <div style="font-size:26px;font-weight:bold;color:${colorSem}">${kgp == null ? "sin dato de personas" : n(kgp) + " kg por persona"}</div>
    <div style="font-size:14px;color:#444;margin-top:2px">${sem ? `<b style="color:${colorSem}">${sem.texto}</b> &nbsp;·&nbsp; suelo ${n(sem.suelo)} · objetivo ${n(sem.objetivo)}` : ""}</div>
  </div>

  <table style="border-collapse:collapse;width:100%">
    ${filaGrande("Fruta calibrada", n(dia.kgCalibrador) + " kg")}
    ${filaGrande("Producción real", n(dia.produccionReal) + " kg", "(quitando fruta de mujeres y reciclado)")}
    ${filaGrande("Personas", sinPersonas ? "sin reloj" : `${dia.presentes}`, sinPersonas ? "" : `(${dia.computables} cuentan para el kg/persona)`)}
    ${filaGrande("Velocidad de la línea", n1(dia.thEfectiva) + " t/h")}
    ${filaGrande("A palets", n(dia.paletsBrutos) + " kg", dia.paletsBrutos ? `(${((dia.paletsBrutos / dia.kgCalibrador) * 100).toFixed(0)} % de lo calibrado)` : "")}
  </table>

  <h3 style="margin:20px 0 6px;font-size:15px">Dónde fue la fruta</h3>
  <table style="border-collapse:collapse;width:100%;border-radius:4px;overflow:hidden"><tr>${barra}</tr></table>
  <p style="margin:6px 0 0;font-size:12px;color:#444">${leyenda}</p>

  <h3 style="margin:20px 0 6px;font-size:15px">Zonas</h3>
  <table style="border-collapse:collapse;width:100%;font-size:13px">
    <tr style="color:#888"><td style="padding:3px 0">&nbsp;</td><td style="text-align:right">Kg</td><td style="text-align:right">Personas</td><td style="text-align:right">kg/persona</td></tr>
    ${zonas.map((z) => `<tr>
      <td style="padding:5px 0;border-top:1px solid #eceff3"><b>${z.g === "Industria" ? "Industria (la hace el arranque)" : z.g}</b></td>
      <td style="padding:5px 0;border-top:1px solid #eceff3;text-align:right">${n(z.kg)}</td>
      <td style="padding:5px 0;border-top:1px solid #eceff3;text-align:right">${sinPersonas ? "—" : z.total}</td>
      <td style="padding:5px 0;border-top:1px solid #eceff3;text-align:right"><b>${z.kgp == null ? "—" : n(z.kgp)}</b></td></tr>`).join("")}
  </table>
  <p style="margin:4px 0 0;font-size:11px;color:#888">Las personas de cada zona incluyen el arranque (${arranque || "—"} ayer): sin él la línea no corre.</p>

  <p style="margin:18px 0 0;font-size:13px;color:#444;background:#f6f7f9;padding:10px 14px;border-radius:8px">
    <b>La semana ${d.numSemanaActual} hasta ayer:</b> ${n(act.kg)} kg y ${act.kgp == null ? "—" : n(act.kgp)} kg/persona
    (la semana pasada acabó en ${ant.kgp == null ? "—" : n(ant.kgp)}).
  </p>

  ${avisos.length ? `<p style="margin:14px 0 0;font-size:12px;color:#8a5a00;background:#fff4e5;padding:8px 12px;border-radius:8px">${avisos.join("<br>")}</p>` : ""}
  <p style="margin:16px 0 0;font-size:11px;color:#999">Adjunto: el parte del día para imprimir (2 páginas — personas con nombres, lotes y fincas echados, productos). Correo automático de las 09:00.</p>
</div>`;

  const texto = `Rendimiento ${etq(AYER)}: ${n(dia.kgCalibrador)} kg calibrados, produccion real ${n(dia.produccionReal)}, ` +
    (kgp == null ? "sin datos de personas" : `${n(kgp)} kg/persona${sem ? " (" + sem.texto + ")" : ""}`) +
    `, ${n1(dia.thEfectiva)} t/h. Semana ${d.numSemanaActual} hasta ayer: ${n(act.kg)} kg, ${act.kgp == null ? "-" : n(act.kgp)} kg/persona (anterior: ${ant.kgp == null ? "-" : n(ant.kgp)}).`;

  const asunto = `Rendimiento ${etq(AYER)} — ${n(dia.kgCalibrador)} kg · ${kgp == null ? "sin personas" : n(kgp) + " kg/persona" + (sem ? " · " + sem.texto : "")}`;

  fs.writeFileSync(path.join(AQUI, "salida", "correo-preview.html"), html, "utf-8");

  const cuerpoEnvio = { from: REMITENTE, to: DESTINOS, reply_to: RESPONDER_A, subject: asunto, html, text: texto };
  if (pdfAdjunto) {
    cuerpoEnvio.attachments = [{ filename: path.basename(pdfAdjunto), content: fs.readFileSync(pdfAdjunto).toString("base64") }];
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
    body: JSON.stringify(cuerpoEnvio),
  });
  if (!res.ok) {
    const cuerpo = await res.text().catch(() => "");
    throw new Error(`Resend ${res.status}: ${cuerpo.slice(0, 200)}`);
  }
  const id = (await res.json().catch(() => null))?.id ?? null;
  console.log(`Enviado ${AYER} → ${DESTINOS.join(", ")} (${id})`);
  await anotarEjecucion({
    trabajo: TRABAJO, inicio, estado: avisos.length ? "aviso" : "ok",
    detalle: avisos.length ? avisos[0].slice(0, 180) : `enviado ${AYER}`,
    datos: { fecha: AYER, kg: Math.round(dia.kgCalibrador), kg_persona: kgp == null ? null : Math.round(kgp), resend_id: id },
  });
}

main().catch(async (e) => {
  console.error("ERROR:", e.message ?? e);
  await anotarEjecucion({ trabajo: TRABAJO, inicio, estado: "error", detalle: String(e.message ?? e).slice(0, 200), datos: { fecha: AYER } });
  await salirConError(1);
});

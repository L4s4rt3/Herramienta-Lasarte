/**
 * vigilar-erp-consultas.mjs — cada hora, que el ERP no tenga consultas congeladas.
 *
 * POR QUÉ EXISTE (16-09-2026). Una consulta exploratoria nuestra se quedó colgada en el
 * servidor MySQL del ERP: el programa que la lanzó murió, MySQL siguió ejecutándola y dejó
 * sin servicio a toda la oficina hasta que Francisco (el técnico del ERP) avisó. Regla de
 * Vadim desde ese día: de 06:00 a 15:00 el ERP tiene que funcionar perfecto sin que nosotros
 * estorbemos, no se hacen consultas grandes, y cada hora se revisa que no haya nada congelado.
 *
 * QUÉ HACE (solo lectura, salvo cancelar lo NUESTRO):
 *   1. Lee la lista de procesos del servidor, las transacciones abiertas y las esperas de bloqueo.
 *   2. CANCELA (KILL) las consultas lanzadas desde ESTE equipo que lleven más de 60 s. Nunca
 *      toca sesiones de otros equipos: el ERP es de la oficina y ahí no mandamos.
 *   3. Si hay consultas ajenas de más de 120 s, bloqueos o transacciones viejas, lo deja escrito
 *      como AVISO (latido "vigilar-erp" en estado aviso ⇒ el vigilante lo enseña) para que
 *      alguien mire, sin tocarlas.
 *   4. Deja rastro en sistema_ejecuciones con lo que ha visto.
 *
 * Tarea de Windows: scripts/tarea-vigilar-erp.cmd, cada hora de 06:05 a 15:05.
 *   node scripts/vigilar-erp-consultas.mjs            # revisa y cancela lo nuestro colgado
 *   node scripts/vigilar-erp-consultas.mjs --solo-ver # no cancela nada, solo informa
 */
import os from "node:os";
import { conectarErp } from "./lib-palets-erp.mjs";
import { latido, anotarEjecucion } from "./lib-registro-ejecuciones.mjs";

process.loadEnvFile(".env");
const INICIO = new Date();
const SOLO_VER = process.argv.includes("--solo-ver");
const TOPE_NUESTRO_S = 60;      // una consulta nuestra que pase de aquí se cancela
const TOPE_AJENO_S = 120;       // una ajena que pase de aquí se avisa (no se toca)
const TRABAJO = "vigilar-erp";

const yo = os.hostname().toLowerCase();
const ips = Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === "IPv4" && !i.internal).map((i) => i.address);
const esNuestro = (host) => { const h = String(host ?? "").toLowerCase(); return h.startsWith(yo) || ips.some((ip) => h.startsWith(ip)); };

let conexion;
try {
  conexion = await conectarErp({ maxSegundos: 20 });
  const [[{ id: miId }]] = await conexion.query("SELECT CONNECTION_ID() id");
  const [procs] = await conexion.query("SHOW FULL PROCESSLIST");
  const activos = procs.filter((p) => p.Id !== miId && p.Command !== "Sleep" && p.Info);
  let trx = [], esperas = [];
  try { [trx] = await conexion.query("SELECT trx_mysql_thread_id hilo, trx_state estado, TIMESTAMPDIFF(SECOND, trx_started, NOW()) segundos, trx_rows_locked filas_bloqueadas, LEFT(trx_query, 120) consulta FROM information_schema.INNODB_TRX"); } catch { /* sin permiso: seguimos */ }
  try { [esperas] = await conexion.query("SELECT COUNT(*) n FROM information_schema.INNODB_LOCK_WAITS"); } catch { esperas = [{ n: null }]; }

  const canceladas = [], ajenasLargas = [], nuestrasCortas = [];
  for (const p of activos) {
    const linea = `#${p.Id} ${p.Host} ${p.Time}s ${p.State ?? ""}: ${String(p.Info).replace(/\s+/g, " ").slice(0, 120)}`;
    if (esNuestro(p.Host)) {
      if (p.Time >= TOPE_NUESTRO_S) {
        if (!SOLO_VER) { try { await conexion.query(`KILL ${p.Id}`); canceladas.push(linea); } catch (e) { ajenasLargas.push(`NO SE PUDO CANCELAR ${linea} (${e.message})`); } }
        else canceladas.push(`(solo ver) ${linea}`);
      } else nuestrasCortas.push(linea);
    } else if (p.Time >= TOPE_AJENO_S) ajenasLargas.push(linea);
  }
  const trxViejas = trx.filter((t) => t.segundos >= TOPE_AJENO_S).map((t) => `hilo ${t.hilo} ${t.estado} ${t.segundos}s filas bloqueadas ${t.filas_bloqueadas}: ${t.consulta ?? "(sin consulta)"}`);
  const nEsperas = Number(esperas[0]?.n ?? 0);

  const partes = [`${procs.length} conexiones, ${activos.length} consulta(s) en marcha`];
  if (canceladas.length) partes.push(`CANCELADAS ${canceladas.length} nuestra(s) de más de ${TOPE_NUESTRO_S} s: ${canceladas.join(" · ")}`);
  if (ajenasLargas.length) partes.push(`AJENAS de más de ${TOPE_AJENO_S} s (no se tocan): ${ajenasLargas.join(" · ")}`);
  if (trxViejas.length) partes.push(`transacciones abiertas viejas: ${trxViejas.join(" · ")}`);
  if (nEsperas) partes.push(`${nEsperas} espera(s) de bloqueo`);
  const hayProblema = canceladas.length || ajenasLargas.length || trxViejas.length || nEsperas;
  const estado = hayProblema ? "aviso" : "ok";
  const detalle = (hayProblema ? "" : "ERP limpio: ") + partes.join(" · ");
  console.log(`[${TRABAJO}] ${estado}: ${detalle}`);
  await anotarEjecucion({ trabajo: TRABAJO, inicio: INICIO, estado, detalle, datos: { conexiones: procs.length, activas: activos.length, canceladas, ajenasLargas, trxViejas, esperas: nEsperas, equipo: yo } });
  await latido(TRABAJO, { estado, detalle });
} catch (e) {
  const detalle = `No se pudo revisar el ERP: ${e.message}`;
  console.error(`[${TRABAJO}] error: ${detalle}`);
  await anotarEjecucion({ trabajo: TRABAJO, inicio: INICIO, estado: "error", detalle });
  await latido(TRABAJO, { estado: "error", detalle });
  process.exitCode = 1;
} finally {
  if (conexion) await conexion.end().catch(() => {});
}

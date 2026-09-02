/**
 * fichas-personas.ts — datos para la FICHA MENSUAL por trabajador y el
 * EFECTO PRESENCIA con el histórico (asistencia desde mayo + partes diarios).
 *
 * Efecto presencia: como la gente se mueve de puesto, no se mide dónde estuvo
 * cada uno — se mide la huella: cómo rinde el almacén (kg/persona del día,
 * normalizado contra la media de su semana ISO) los días que una persona está
 * frente a los días que falta. Sin señal suficiente (<3 faltas o <5 presencias
 * en días medibles) se dice, no se inventa.
 *
 *   node node_modules/vite-node/vite-node.mjs scripts/informe-produccion/fichas-personas.ts [--mes=YYYY-MM]
 */
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { cuentaTrabajadorKgPersona, grupoRendimientoTrabajador, tipoCosteTrabajador } from "@/lib/asistenciaRendimiento";

const CARPETA = path.resolve("scripts/informe-produccion");
const SALIDA_DIR = path.join(CARPETA, "salida");
const ASISTENCIAS = path.join(SALIDA_DIR, "asistencias.json");
const SALIDA = path.join(SALIDA_DIR, "fichas-personas.json");

const hoyMadrid = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid" }).format(new Date());
const argMes = process.argv.find((a) => a.startsWith("--mes="))?.split("=")[1];
const MES = argMes ?? hoyMadrid().slice(0, 7);
if (!/^\d{4}-\d{2}$/.test(MES)) throw new Error(`--mes inválido: ${MES}`);
const DESDE = "2026-05-01";

try { process.loadEnvFile(path.resolve(".env")); } catch { /* entorno */ }
const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("Faltan credenciales de Supabase en .env");
const db = createClient(url, key, { auth: { persistSession: false } });

const PAGE = 1000;
async function fetchTodas<T>(consulta: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await consulta(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const filas = data ?? [];
    out.push(...filas);
    if (filas.length < PAGE) return out;
  }
}
const num = (v: unknown): number => Number(v) || 0;
const norm = (s: unknown) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const numSemanaIso = (iso: string) => {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + 3 - ((d.getUTCDay() + 6) % 7));
  const enero1 = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return `${d.getUTCFullYear()}-${Math.ceil(((d.getTime() - enero1.getTime()) / 864e5 + 1) / 7)}`;
};
const aMin = (hhmm: string | null): number | null => {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(hhmm ?? "").trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

async function main() {
  const avisos: string[] = [];
  const [trabajadores, asistencia, partes] = await Promise.all([
    fetchTodas<{ id: string; nombre: string; zona: string | null; computa_kg_persona: boolean | null; activo: boolean }>((a, b) =>
      db.from("trabajadores").select("id, nombre, zona, computa_kg_persona, activo").order("nombre").range(a, b)),
    fetchTodas<{ date: string; trabajador_id: string; presente: boolean }>((a, b) =>
      db.from("asistencia_detalle").select("date, trabajador_id, presente").gte("date", DESDE).order("date").range(a, b)),
    fetchTodas<{ date: string; kg_produccion_calibrador: number | null; kg_mujeres_calibrador: number | null; kg_reciclado_malla_z1: number | null; kg_reciclado_malla_z2: number | null }>((a, b) =>
      db.from("partes_diarios").select("date, kg_produccion_calibrador, kg_mujeres_calibrador, kg_reciclado_malla_z1, kg_reciclado_malla_z2").gte("date", DESDE).order("date").range(a, b)),
  ]);

  const porId = new Map(trabajadores.map((t) => [t.id, t]));

  // ─── Reloj (xlsx parseado): horas y horarios, casado por nombre ─────────────
  interface RegistroReloj { nombre: string; fecha: string; horas: number | null; entrada: string | null; salida: string | null }
  let reloj: RegistroReloj[] = [];
  if (fs.existsSync(ASISTENCIAS)) reloj = JSON.parse(fs.readFileSync(ASISTENCIAS, "utf-8"));
  const STOP = new Set(["DE", "DEL", "LA", "LOS", "LAS", "Y"]);
  const tokens = (s: string) => norm(s).split(" ").filter((t) => t && !STOP.has(t));
  const prefijoComun = (a: string, b: string) => { let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++; return i; };
  const casaToken = (t: string, otros: string[]) => otros.some((o) => o === t || (t.length >= 4 && o.length >= 4 && (o.startsWith(t) || t.startsWith(o))) || prefijoComun(t, o) >= 6);
  const idPorNombreReloj = new Map<string, string | null>();
  for (const nombreXlsx of new Set(reloj.map((r) => r.nombre))) {
    const tx = tokens(nombreXlsx);
    const candidatos = trabajadores
      .map((t) => ({ t, tt: tokens(t.nombre) }))
      .filter(({ tt }) => tt.length > 0 && tt.every((tk) => casaToken(tk, tx)))
      .sort((a, b) => b.tt.length - a.tt.length);
    idPorNombreReloj.set(nombreXlsx, candidatos.length > 0 ? candidatos[0].t.id : null);
  }

  // ─── Asistencia unificada por día y persona ────────────────────────────────
  // BD (presente true/false explícito) + reloj (horas; presente = horas >= 1).
  interface Evento { presente: boolean; horas: number | null; entrada: number | null; salida: string | null }
  const porDia = new Map<string, Map<string, Evento>>();
  const pon = (fecha: string, id: string, e: Evento) => {
    const m = porDia.get(fecha) ?? new Map<string, Evento>();
    const previo = m.get(id);
    // el reloj (con horas) manda sobre el volcado (solo booleano)
    if (!previo || e.horas != null) m.set(id, e);
    porDia.set(fecha, m);
  };
  for (const a of asistencia) pon(a.date, a.trabajador_id, { presente: a.presente, horas: null, entrada: null, salida: null });
  for (const r of reloj) {
    const id = idPorNombreReloj.get(r.nombre);
    if (!id) continue;
    pon(r.fecha, id, { presente: (r.horas ?? 0) >= 1, horas: r.horas, entrada: aMin(r.entrada), salida: r.salida });
  }

  // ─── Días medibles: producción real + asistencia con cuerpo ────────────────
  const diasProduccion = new Map<string, number>(); // fecha -> producción real
  for (const p of partes) {
    const pr = Math.max(0, num(p.kg_produccion_calibrador) - num(p.kg_mujeres_calibrador) - num(p.kg_reciclado_malla_z1) - num(p.kg_reciclado_malla_z2));
    if (pr > 1000) diasProduccion.set(p.date, pr);
  }
  interface DiaMedible { fecha: string; prodReal: number; kgPersona: number; idx: number; presentes: Set<string> }
  const medibles: DiaMedible[] = [];
  for (const [fecha, prodReal] of [...diasProduccion].sort()) {
    const asis = porDia.get(fecha);
    if (!asis) continue;
    const presentes = new Set<string>();
    let computables = 0;
    for (const [id, e] of asis) {
      if (!e.presente) continue;
      presentes.add(id);
      const t = porId.get(id);
      if (t && cuentaTrabajadorKgPersona(t)) computables += 1;
    }
    if (computables < 10) continue; // día sin asistencia de verdad: no medible
    medibles.push({ fecha, prodReal, kgPersona: prodReal / computables, idx: 0, presentes });
  }
  // índice del día contra la media de su semana ISO (quita el efecto de la fruta de esa semana)
  const porSemana = new Map<string, DiaMedible[]>();
  for (const d of medibles) {
    const k = numSemanaIso(d.fecha);
    porSemana.set(k, [...(porSemana.get(k) ?? []), d]);
  }
  for (const dias of porSemana.values()) {
    const media = dias.reduce((s, x) => s + x.kgPersona, 0) / dias.length;
    for (const d of dias) d.idx = media > 0 ? d.kgPersona / media : 1;
  }
  // semanas de un solo día medible no dicen nada (idx=1 fijo): fuera del efecto
  const utiles = medibles.filter((d) => (porSemana.get(numSemanaIso(d.fecha)) ?? []).length >= 3);

  // ─── Efecto presencia por persona (histórico completo) ─────────────────────
  // ausencia = fila explícita presente=false (BD) o, en días del reloj, no fichar
  // dentro de su ventana [primer día visto, último día visto].
  const primeraVez = new Map<string, string>();
  const ultimaVez = new Map<string, string>();
  for (const [fecha, m] of [...porDia].sort()) {
    for (const [id, e] of m) {
      if (!e.presente) continue;
      if (!primeraVez.has(id)) primeraVez.set(id, fecha);
      ultimaVez.set(id, fecha);
    }
  }
  const media = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);

  // ─── Estadística del MES por persona ────────────────────────────────────────
  const diasProdMes = [...diasProduccion.keys()].filter((f) => f.startsWith(MES)).sort();
  // mediana de entrada del equipo por día (para llegadas tarde autocalibradas)
  const medianaEntradaDia = new Map<string, number>();
  for (const f of diasProdMes) {
    const entradas = [...(porDia.get(f) ?? new Map())].map(([, e]) => (e as Evento).entrada).filter((x): x is number => x != null).sort((a, b) => a - b);
    if (entradas.length >= 5) medianaEntradaDia.set(f, entradas[Math.floor(entradas.length / 2)]);
  }

  const fichas = trabajadores.map((t) => {
    const grupo = grupoRendimientoTrabajador(t);
    const tipo = tipoCosteTrabajador(t);
    const desde = primeraVez.get(t.id);
    const hasta = ultimaVez.get(t.id);

    // efecto presencia (histórico, solo días útiles dentro de su ventana)
    const idxPres: number[] = [];
    const idxAus: number[] = [];
    if (desde && hasta) {
      for (const d of utiles) {
        if (d.fecha < desde || d.fecha > hasta) continue;
        const evento = porDia.get(d.fecha)?.get(t.id);
        const presente = d.presentes.has(t.id);
        if (presente) idxPres.push(d.idx);
        else if (evento ? !evento.presente : true) idxAus.push(d.idx);
      }
    }
    const efectoMedible = idxAus.length >= 3 && idxPres.length >= 5;

    // mes: días, horas, puntualidad
    let diasPresente = 0, faltas = 0, horas = 0, horasN = 0, tarde = 0, tardeN = 0;
    const entradas: number[] = [];
    let sabados = 0;
    for (const f of diasProdMes) {
      if (!desde || f < desde || (hasta && f > hasta)) continue;
      const e = porDia.get(f)?.get(t.id);
      const presente = e?.presente ?? false;
      if (presente) {
        diasPresente += 1;
        if (e?.horas != null) { horas += e.horas; horasN += 1; }
        if (e?.entrada != null) {
          entradas.push(e.entrada);
          const ref = medianaEntradaDia.get(f);
          if (ref != null) { tardeN += 1; if (e.entrada > ref + 10) tarde += 1; }
        }
      } else {
        faltas += 1;
      }
    }
    // sábados y extras del mes (días con reloj fuera de los días de producción)
    for (const [f, m] of porDia) {
      if (!f.startsWith(MES) || diasProduccion.has(f)) continue;
      const e = m.get(t.id);
      if (e?.presente) sabados += 1;
    }
    const entradaMedia = media(entradas);

    return {
      id: t.id, nombre: t.nombre, zona: t.zona ?? "(sin zona)", activo: t.activo,
      grupo: grupo ?? (tipo === "tratamiento" ? "Arranque" : null),
      computa: cuentaTrabajadorKgPersona(t),
      desde, hasta,
      mes: {
        diasPosibles: desde ? diasProdMes.filter((f) => f >= desde && (!hasta || f <= hasta)).length : 0,
        diasPresente, faltas, sabados,
        horas: horasN ? horas : null, mediaHoras: horasN ? horas / horasN : null,
        entradaMedia, tarde, tardeN,
      },
      efecto: {
        nPresente: idxPres.length, nAusente: idxAus.length, medible: efectoMedible,
        idxPresente: media(idxPres), idxAusente: media(idxAus),
      },
    };
  }).filter((f) => f.desde); // sin ni un día visto (oficina sin fichar): fuera

  const kgPersonaMes = media(medibles.filter((d) => d.fecha.startsWith(MES)).map((d) => d.kgPersona));
  fs.mkdirSync(SALIDA_DIR, { recursive: true });
  fs.writeFileSync(SALIDA, JSON.stringify({
    generado: new Date().toISOString(), mes: MES,
    diasProduccionMes: diasProdMes.length, kgPersonaMes,
    diasMedibles: medibles.length, diasUtilesEfecto: utiles.length,
    historicoDesde: medibles[0]?.fecha ?? null, historicoHasta: medibles.at(-1)?.fecha ?? null,
    fichas, avisos,
  }, null, 1), "utf-8");

  console.log(`mes ${MES}: ${diasProdMes.length} días de producción · histórico medible ${medibles.length} días (${medibles[0]?.fecha} → ${medibles.at(-1)?.fecha}) · ${utiles.length} útiles para efecto`);
  const conEfecto = fichas.filter((f) => f.efecto.medible);
  console.log(`${fichas.length} fichas · ${conEfecto.length} con efecto presencia medible:`);
  for (const f of conEfecto.sort((a, b) => (a.efecto.idxAusente! - a.efecto.idxPresente!) - (b.efecto.idxAusente! - b.efecto.idxPresente!))) {
    console.log(`  ${f.nombre}: presente ${(f.efecto.idxPresente! * 100).toFixed(1)}% vs ausente ${(f.efecto.idxAusente! * 100).toFixed(1)}% (${f.efecto.nAusente} faltas de ${f.efecto.nAusente + f.efecto.nPresente})`);
  }
  console.log(`OK → ${SALIDA}`);
}

main().catch((e) => { console.error("ERROR:", e instanceof Error ? e.message : e); process.exit(1); });

/**
 * partOcrParser — parser + validación deterministas del parte manual diario
 * (papel EMBASUR manuscrito) a partir del TEXTO que devuelve Mistral OCR
 * (edge function `analizar-parte-ocr`). Produce el mismo envelope `{raw,
 * confianza, dudas}` que consume `normalizePartManualVisionResult`, de modo
 * que reutiliza toda la derivación de netos/tara y la UI de PartDetailManual.
 *
 * Filosofía (acordada con el dueño, jul-2026): la lectura NO se traga los
 * totales, los RECALCULA y caza incoherencias. Dos redes de seguridad:
 *   1. Conceptos "a×b = total": se recalcula el producto.
 *   2. "Palets punta" = Σ de su desglose: el gran total es el ancla que
 *      permite reconciliar líneas mal leídas (resolvedor por coherencia).
 * La regla de kg por caja de Mercadona la confirmó el dueño: 3kg→4 uds/caja=12,
 * 4kg→3 uds/caja=12, 5kg→2 uds/caja=10; Granel=12; directos 8/10/15/20.
 */
import type { PartManualVisionRaw } from "@/lib/partManualVision";

interface Concepto {
  op: [number, number] | null;
  total: number | null;
  suma?: boolean;
}
interface DesLinea {
  fmt: string;
  cajas: number | null;
  kgc: number | null;
  tot: number | null;
  esp: number | null;
}
interface ParteCrudo {
  fecha: { iso: string; ok: boolean } | null;
  conceptos: Partial<Record<
    "citrica" | "citrica_podrido" | "podrido" | "malla_z1" | "malla_z2" | "palets_punta",
    Concepto
  >>;
  desglose: DesLinea[];
}

export interface ParteOcrResultado {
  raw: PartManualVisionRaw;
  confianza: number;
  /** Banderas de la validación (correcciones, incoherencias, reconciliaciones). */
  dudas: string[];
  modelo: string | null;
}

const deacc = (s: string): string => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const MEMBRETE = /embasur|ecoenvases|vestimos|envases del futuro|delegaci|tel\.|fax|http|email|almeria|^en$|!\[img|^#?\s*$/i;

// número = primer token de dígitos/puntos (el OCR salpica puntos como ruido:
// "3.48"→348, "148.5"→1485, "1.158"→1158) pero corta en espacio ("676. 4 box"→676).
const cleanInt = (t: string): number | null => { const d = String(t).replace(/[^\d]/g, ""); return d ? parseInt(d, 10) : null; };
const firstNum = (s: string): number | null => { const m = String(s).match(/\d[\d.]*/); return m ? cleanInt(m[0]) : null; };
const allNums = (s: string): number[] | null => {
  const m = String(s).match(/\d[\d.]*/g);
  return m ? m.map(cleanInt).filter((x): x is number => x != null) : null;
};

function kgPorCaja(fmt: string): number | null {
  const f = deacc(fmt);
  if (/granel|grenel|arenel|grewal/.test(f)) return 12;
  if (/10\s*x\s*2/.test(f)) return 20;
  const mdna = /mdna|mdra|mohs|mohra|malla/.test(f);
  if (mdna && /\b3\b/.test(f)) return 12;
  if (mdna && /\b4\b/.test(f)) return 12;
  if (mdna && /\b5\b/.test(f)) return 10;
  if (/\b20\s*k/.test(f)) return 20;
  if (/\b15\s*k/.test(f)) return 15;
  if (/\b8\s*k/.test(f)) return 8;
  if (/\b10\s*k/.test(f)) return 10;
  if (/\b3\s*k/.test(f)) return 12;
  if (/\b4\s*k/.test(f)) return 12;
  if (/\b5\s*k/.test(f)) return 10;
  return null;
}

function parseFecha(txt: string): { iso: string; ok: boolean } | null {
  let m = txt.match(/(\d{1,2})\s*[/.\-]\s*(\d{1,2})\s*[/.\-]\s*(\d{2,4})/);
  if (!m) m = txt.match(/\b(\d{2})1(\d{2})1(\d{2})\b/);
  if (!m) return null;
  const d = m[1]; const mo = m[2]; let y = m[3];
  y = y.length === 2 ? "20" + y : y;
  const dd = +d, mm = +mo;
  return { iso: `${y}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`, ok: dd >= 1 && dd <= 31 && mm >= 1 && mm <= 12 };
}

function mult(s: string): [number, number] | null {
  const m = s.match(/(\d[\d.,'′]*)\s*(?:kg\.?|kp\.?|kφ|c\b)?\s*[x×X]\s*(\d[\d.,'′]*)/i);
  if (!m) return null;
  const n = (v: string): number => parseFloat(String(v).replace(/[.,]/g, ".").replace(/[′']/g, "."));
  return [n(m[1]), n(m[2])];
}

function totalTras(s: string): number | null {
  const norm = s.replace(/->|-D|-d|-p/g, "→");
  if (!/[=→]/.test(norm)) return null;
  const i = Math.max(norm.lastIndexOf("="), norm.lastIndexOf("→"));
  return firstNum(norm.slice(i + 1));
}

function parseDes(raw: string): DesLinea {
  let fmt: string, rest: string;
  if (raw.includes(":")) { fmt = raw.slice(0, raw.indexOf(":")); rest = raw.slice(raw.indexOf(":") + 1); }
  else {
    const m = raw.match(/^\s*((?:mdna|mdra|mohs|mohra|malla)?\s*(?:granel|grenel|arenel|grewal|10\s*x\s*2|\d+\s*k[gqp]\.?))/i);
    if (m) { fmt = m[1]; rest = raw.slice(m[0].length); } else { fmt = raw; rest = ""; }
  }
  const kgc = kgPorCaja(fmt);
  const norm = rest.replace(/->|-D|-d|-p/g, "→");
  let cajas: number | null = null, tot: number | null = null;
  if (/[=→]/.test(norm)) {
    const i = Math.max(norm.lastIndexOf("="), norm.lastIndexOf("→"));
    const seg = norm.slice(0, i).split(/[=→]/).pop() ?? "";
    const ln = allNums(seg);
    cajas = ln ? ln.reduce((a, b) => a + b, 0) : null;
    tot = firstNum(norm.slice(i + 1));
  } else { const ns = allNums(norm); cajas = ns ? ns.reduce((a, b) => a + b, 0) : null; }
  const esp = (cajas != null && kgc != null) ? cajas * kgc : null;
  return { fmt: fmt.trim(), cajas, kgc, tot, esp };
}

function parseParte(md: string): ParteCrudo {
  let lines = md.split("\n").map((l) => l.replace(/^[\s\-#>*]+/, "").trim()).filter((l) => l && !MEMBRETE.test(l));
  const merged: string[] = [];
  for (const l of lines) { if (merged.length && /^[+=→]/.test(l)) merged[merged.length - 1] += " " + l; else merged.push(l); }
  lines = merged;

  const P: ParteCrudo = { fecha: null, conceptos: {}, desglose: [] };
  let enDes = false;
  for (const l of lines) {
    const n = deacc(l);
    if (!P.fecha) { const f = parseFecha(l); if (f) { P.fecha = f; continue; } }
    const val = l.includes(":") ? l.slice(l.indexOf(":") + 1) : l;
    if (/^(pal[eo]ts|polets|patets)/.test(n)) { P.conceptos.palets_punta = { op: null, total: totalTras(l) ?? firstNum(val) }; enDes = true; continue; }
    if (!enDes && /cit.*(podr|ped|pact|pod)/.test(n)) { P.conceptos.citrica_podrido = { op: null, total: totalTras(val) ?? firstNum(val), suma: /\+/.test(val) }; continue; }
    if (!enDes && /^(podr|ped|pact|pod)/.test(n)) { P.conceptos.podrido = { op: null, total: totalTras(val) ?? firstNum(val), suma: /\+/.test(val) }; continue; }
    if (!enDes && /cit[ru]/.test(n)) { P.conceptos.citrica = { op: mult(val), total: totalTras(val) }; continue; }
    if (!enDes && /(mal|mol)/.test(n) && (/\b[zef]\s*1\b/.test(n) || /2\.1/.test(n) || /z\.?\s*n/.test(n))) { const op = mult(val); P.conceptos.malla_z1 = { op, total: totalTras(val) ?? (op ? null : firstNum(val)) }; continue; }
    if (!enDes && /(mal|mol)/.test(n) && (/\b[zef]\s*2\b/.test(n) || /2\.2/.test(n) || /z\.?\s*z/.test(n))) { const op = mult(val); P.conceptos.malla_z2 = { op, total: totalTras(val) ?? (op ? null : firstNum(val)) }; continue; }
    if (enDes) P.desglose.push(parseDes(l));
  }
  return P;
}

// ── Resolvedor por coherencia: el gran total (palets punta) como ancla ──────
interface Opcion { v: number; c: number; src: "escrito" | "cajas×peso" | "omitida" | "vacía"; }
function opcionesLinea(d: DesLinea): Opcion[] {
  const o: Opcion[] = [];
  if (d.tot != null) o.push({ v: d.tot, c: 0, src: "escrito" });
  if (d.esp != null && d.esp !== d.tot) o.push({ v: d.esp, c: 1, src: "cajas×peso" });
  if (d.tot != null || d.esp != null) o.push({ v: 0, c: 2, src: "omitida" });
  if (o.length === 0) o.push({ v: 0, c: 0, src: "vacía" });
  return o;
}
function resolver(det: DesLinea[], objetivo: number):
  | { pick: Array<Opcion & { fmt: string }>; cost: number }
  | { ambiguo: true }
  | null {
  const ops = det.map(opcionesLinea);
  if (ops.reduce((a, o) => a * o.length, 1) > 200000) return null;
  let best: number | null = null;
  const sols: number[][] = [];
  const rec = (i: number, sum: number, cost: number, pick: number[]): void => {
    if (i === ops.length) {
      if (sum === objetivo) {
        if (best == null || cost < best) { best = cost; sols.length = 0; }
        if (cost === best) sols.push(pick.slice());
      }
      return;
    }
    for (let j = 0; j < ops[i].length; j++) { pick.push(j); rec(i + 1, sum + ops[i][j].v, cost + ops[i][j].c, pick); pick.pop(); }
  };
  rec(0, 0, 0, []);
  if (!sols.length || best == null) return null;
  const uniq = new Map<string, number[]>();
  for (const s of sols) { const vec = s.map((j, i) => ops[i][j].v).join(","); if (!uniq.has(vec)) uniq.set(vec, s); }
  if (uniq.size !== 1) return { ambiguo: true };
  const pick = [...uniq.values()][0];
  return { pick: pick.map((j, i) => ({ ...ops[i][j], fmt: det[i].fmt })), cost: best };
}

/**
 * Parsea el texto OCR de un parte manual y devuelve el envelope compatible con
 * `normalizePartManualVisionResult`. `fechaEsperada` (la del parte abierto) se
 * usa como ancla: el OCR falla a menudo en el mes, así que si difiere se marca
 * y se propone la fecha del parte, sin rechazar.
 */
export function parseParteManualOcr(
  ocrMd: string,
  opts: { fechaEsperada?: string; modelo?: string | null } = {},
): ParteOcrResultado {
  const P = parseParte(ocrMd);
  const flags: string[] = [];
  const C = P.conceptos;

  // ── Fecha: anclada a la del parte abierto ──
  let fecha: string | null = P.fecha?.iso ?? null;
  const esperada = opts.fechaEsperada && /^\d{4}-\d{2}-\d{2}$/.test(opts.fechaEsperada) ? opts.fechaEsperada : null;
  if (esperada) {
    if (P.fecha && P.fecha.iso !== esperada) {
      const diaOcr = P.fecha.iso.slice(8, 10);
      const diaEsp = esperada.slice(8, 10);
      flags.push(diaOcr === diaEsp
        ? `⚠ el OCR leyó ${P.fecha.iso} (mes distinto); uso la fecha del parte ${esperada}`
        : `⚠ el OCR leyó ${P.fecha.iso} pero el parte es del ${esperada}; ¿es la foto correcta?`);
    }
    fecha = esperada;
  } else if (P.fecha && !P.fecha.ok) {
    flags.push(`⚠ fecha ${P.fecha.iso} fuera de rango, revisar`);
  }

  // ── Conceptos con "a×b = total": recalcular y cazar incoherencias ──
  const campos: Record<string, number | null> = {};
  const boxes: Record<string, number | null> = {};
  for (const k of ["citrica", "citrica_podrido", "podrido", "malla_z1", "malla_z2"] as const) {
    const c = C[k];
    if (!c) { campos[k] = null; boxes[k] = null; continue; }
    if (c.op) {
      const prod = Math.round(c.op[0] * c.op[1]);
      const t = c.total;
      const boxOp = Math.min(c.op[0], c.op[1]); // el operando pequeño = nº de box
      if (t == null) { campos[k] = prod; boxes[k] = boxOp; flags.push(`${k}: sin total → ${c.op.join("×")}=${prod}`); }
      else if (prod === t) { campos[k] = t; boxes[k] = boxOp; }
      else {
        const r = prod / t;
        if (r >= 0.5 && r <= 2) { campos[k] = prod; boxes[k] = boxOp; flags.push(`⚠ ${k}: ${c.op.join("×")}=${prod} ≠ escrito ${t} → corrijo a ${prod}`); }
        else { campos[k] = t; boxes[k] = 1; flags.push(`⚠ ${k}: operación ilegible (${c.op.join("×")}=${prod}); mantengo ${t}`); }
      }
    } else {
      campos[k] = c.total ?? null;
      boxes[k] = c.total != null ? 1 : null;
      if (c.suma && c.total != null) flags.push(`⚠ ${k}: anotado como suma → ${c.total}, revisar`);
    }
  }

  // ── Palets punta = Σ desglose (con reconciliación por coherencia) ──
  const det = P.desglose;
  const pp = C.palets_punta?.total ?? null;
  const sumBase = det.reduce((s, d) => s + (d.tot ?? d.esp ?? 0), 0);
  if (pp != null) {
    if (Math.round(sumBase) === Math.round(pp)) campos.palets_punta = pp;
    else {
      const sol = resolver(det, pp);
      if (sol && "pick" in sol) {
        campos.palets_punta = pp;
        const aj = sol.pick.filter((p) => p.src !== "escrito" && p.src !== "vacía")
          .map((p) => `${p.fmt.trim().slice(0, 12)}→${p.src === "omitida" ? "omitida" : p.v}`);
        flags.push(`✔ desglose reconciliado con palets ${pp}${aj.length ? ` (ajustes: ${aj.join(", ")})` : ""}`);
      } else if (sol && "ambiguo" in sol) { campos.palets_punta = pp; flags.push(`⚠ palets ${pp}: varias reconciliaciones posibles → revisar`); }
      else { campos.palets_punta = sumBase || pp; flags.push(`⚠ palets punta: escrito ${pp} vs Σdesglose ${sumBase} → revisar (uso ${sumBase || pp})`); }
    }
  } else if (sumBase) { campos.palets_punta = sumBase; flags.push(`palets punta: sin total → Σdesglose=${sumBase}`); }
  else campos.palets_punta = null;

  const raw: PartManualVisionRaw = {
    fecha,
    citrica_kg_brutos: campos.citrica,
    citrica_box: boxes.citrica,
    citrica_podrido_kg_brutos: campos.citrica_podrido,
    citrica_podrido_box: boxes.citrica_podrido,
    podrido_kg_brutos: campos.podrido,
    podrido_box: boxes.podrido,
    malla_z1_kg_brutos: campos.malla_z1,
    malla_z1_box: boxes.malla_z1,
    malla_z2_kg_brutos: campos.malla_z2,
    malla_z2_box: boxes.malla_z2,
    palets_punta_kg: campos.palets_punta,
  };

  const alertas = flags.filter((f) => f.startsWith("⚠")).length;
  const confianza = Math.max(0.35, Math.min(0.97, 0.95 - alertas * 0.12));

  return { raw, confianza, dudas: flags, modelo: opts.modelo ?? null };
}

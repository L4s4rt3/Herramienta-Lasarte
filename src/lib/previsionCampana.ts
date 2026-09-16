// Previsión de campaña: cuántos kilos van a entrar, de dónde y en qué semana.
//
// POR QUÉ EXISTE (16-09-2026). La empresa planifica gente, cámara y compromisos
// con Mercadona sin saber qué semana va a entrar la fruta. El dato para saberlo
// ya estaba, repartido en dos sitios que nunca se habían juntado.
//
// DE DÓNDE SALE CADA PIEZA — y esto es lo importante de esta previsión:
//
//   · CUÁNTOS KILOS: de lo que entregó cada parcela la campaña pasada. NO de
//     Aerobotics: sus informes miden el TAMAÑO de la fruta, no la cosecha.
//     Nuestra báscula es la única que sabe de kilos, y los sabe todos.
//
//   · CUÁNDO: de las mismas semanas en que entró el año pasado, un año después.
//
//     Y NO de la ventana de recolección de Aerobotics, aunque la tengamos. Se
//     probó y era peor: sus ventanas duran 13-15 semanas, y repartir los kilos
//     de una parcela por igual entre ellas aplasta los picos justo donde está
//     el valor de esto (saber que la semana 8 entraron 1.200 t). La ventana
//     dice cuándo la fruta ESTÁ LISTA; la historia dice cuándo la cogemos
//     NOSOTROS, que es lo que hay que planificar.
//
//     La ventana no se tira: se usa para AVISAR cuando las dos cosas no cuadran
//     ("el año pasado se empezó en la semana 42 y Aerobotics no la da por lista
//     hasta la 45"). Dos fuentes que discrepan se enseñan las dos.
//
//   · HECTÁREAS y kg/ha: de Aerobotics, solo para contrastar. No entran en el
//     cálculo: si una parcela dio 300 t el año pasado, la previsión es 300 t,
//     no lo que salga de multiplicar hectáreas por una media.
//
// LO QUE ESTA PREVISIÓN NO ES. Una promesa. Solo hay UNA campaña de historia
// por parcela (la báscula arranca en octubre de 2025) y el cítrico vecea: a un
// año cargado le sigue uno flojo. Es un orden de magnitud para planificar, y
// la pantalla tiene que decirlo con esas palabras.
//
// Funciones puras: aquí se calcula, la página pinta.
import { claveSemanaIso, lunesDeSemanaIso, semanaIsoDe } from "@/lib/semanaIso";

// ─── Campañas ───────────────────────────────────────────────────────────────

/**
 * La campaña de una fecha. Va del 1 de septiembre al 31 de agosto: la campaña
 * 2025/26 son las entradas de octubre de 2025 a agosto de 2026, que es
 * exactamente el ciclo que cerró el dueño el 28-08-2026.
 */
export function campanaDe(fechaISO: string): string {
  const [anio, mes] = fechaISO.split("-").map(Number);
  const inicio = mes >= 9 ? anio : anio - 1;
  return `${inicio}/${String((inicio + 1) % 100).padStart(2, "0")}`;
}

/** La campaña siguiente a una dada: "2025/26" → "2026/27". */
export function campanaSiguiente(campana: string): string {
  const inicio = Number(campana.split("/")[0]);
  return `${inicio + 1}/${String((inicio + 2) % 100).padStart(2, "0")}`;
}

// ─── Semanas ────────────────────────────────────────────────────────────────

/** "2026W42" (Aerobotics) → "2026-W42" (el formato del resto del proyecto). */
export function normalizarSemana(semana: string | null | undefined): string | null {
  const t = String(semana ?? "").trim();
  const m = /^(\d{4})-?W(\d{1,2})$/i.exec(t);
  return m ? `${m[1]}-W${String(Number(m[2])).padStart(2, "0")}` : null;
}

/** "2025-W47" + 1 año → "2026-W47". Para llevar el histórico a la campaña que viene. */
export function semanaMasUnAnio(semana: string): string {
  const m = /^(\d{4})-W(\d{2})$/.exec(semana);
  return m ? `${Number(m[1]) + 1}-W${m[2]}` : semana;
}

const DIA_MS = 86_400_000;

/** El lunes de una semana "2026-W42", como fecha YYYY-MM-DD. */
function lunesDe(semana: string): string | null {
  const m = /^(\d{4})-W(\d{1,2})$/.exec(semana);
  if (!m) return null;
  const anio = Number(m[1]);
  const n = Number(m[2]);
  // El 4 de enero cae siempre en la semana 1 del año ISO.
  const enero4 = new Date(Date.UTC(anio, 0, 4));
  const lunesSemana1 = new Date(enero4.getTime() - ((enero4.getUTCDay() || 7) - 1) * DIA_MS);
  return new Date(lunesSemana1.getTime() + (n - 1) * 7 * DIA_MS).toISOString().slice(0, 10);
}

/** Cuántas semanas hay de una a otra (negativo si la segunda es anterior). */
export function semanasDeDiferencia(desde: string, hasta: string): number {
  const a = lunesDe(desde);
  const b = lunesDe(hasta);
  if (!a || !b) return 0;
  return Math.round((new Date(`${b}T12:00:00Z`).getTime() - new Date(`${a}T12:00:00Z`).getTime()) / (7 * DIA_MS));
}

/** Máximo de semanas que se considera una ventana de recolección razonable. */
export const VENTANA_MAXIMA_SEMANAS = 30;

/**
 * Las semanas entre dos, las dos incluidas: ["2026-W50", "2026-W51", "2027-W01"…].
 * Devuelve [] si la ventana está del revés o es absurdamente larga — más vale
 * quedarse sin ventana que repartir los kilos de una parcela en medio año.
 */
export function semanasEntre(desde: string, hasta: string): string[] {
  const a = lunesDe(desde);
  const b = lunesDe(hasta);
  if (!a || !b) return [];
  const fin = new Date(`${b}T12:00:00Z`).getTime();
  let cursor = new Date(`${a}T12:00:00Z`).getTime();
  if (cursor > fin) return [];
  const semanas: string[] = [];
  while (cursor <= fin) {
    semanas.push(claveSemanaIso(new Date(cursor).toISOString().slice(0, 10)));
    if (semanas.length > VENTANA_MAXIMA_SEMANAS) return [];
    cursor += 7 * DIA_MS;
  }
  return semanas;
}

// ─── Entradas ───────────────────────────────────────────────────────────────

export interface EntradaPrevision {
  finca: string | null;
  parcela: string | null;
  agricultor: string | null;
  articulo: string | null;
  fecha: string;
  kg_entrada: number | null;
}

/**
 * Fincas que NO son campo: el almacén de precalibrado (la fruta ya entró una
 * vez y vuelve) y la importación (se compra puesta, no se recolecta). Meterlas
 * en una previsión de recolección sería contar dos veces o prever una cosecha
 * que no existe.
 */
export function esFincaDeCampo(finca: string): boolean {
  const f = finca.trim().toUpperCase();
  return Boolean(f) && !f.startsWith("PREC") && f !== "IMPORTACION";
}

// ─── Previsión ──────────────────────────────────────────────────────────────

export interface SemanaKg {
  semana: string;
  kg: number;
}

/** Qué dice la ventana de Aerobotics respecto a cuándo se recogió de verdad. */
export type AvisoVentana = "antes" | "despues" | "cuadra";

export interface PrevisionParcela {
  clave: string;
  finca: string;
  parcela: string;
  etiqueta: string;
  agricultor: string;
  variedad: string;
  /** Kilos que entregó en la campaña de referencia: la base de todo. */
  kgBase: number;
  /** Hectáreas de Aerobotics, solo para contrastar (no entran en el cálculo). */
  hectareas: number | null;
  kgPorHa: number | null;
  /** Ventana de recolección de Aerobotics, en semanas del proyecto. No mueve el calendario: lo contrasta. */
  ventana: { desde: string; hasta: string; fuente: string | null } | null;
  /**
   * "antes"   → el año pasado se empezó ANTES de que Aerobotics la dé por lista.
   * "despues" → se terminó DESPUÉS de que se cerrara su ventana.
   * "cuadra"  → lo que hicimos cae dentro de la ventana.
   * null      → no hay ventana con la que contrastar.
   */
  avisoVentana: AvisoVentana | null;
  /** Semanas de diferencia entre lo que hicimos y la ventana (0 si cuadra). */
  semanasDeDesfase: number;
  /** El reparto previsto, semana a semana. */
  semanas: SemanaKg[];
  /** Lo que YA ha entrado de la campaña que se prevé. */
  kgEntrado: number;
  kgPendiente: number;
}

export interface SemanaPrevision {
  semana: string;
  previsto: number;
  entrado: number;
}

export interface TotalesPrevision {
  parcelas: number;
  kgPrevisto: number;
  kgEntrado: number;
  kgPendiente: number;
  /** Parcelas que además tienen ventana de Aerobotics con la que contrastar. */
  conVentana: number;
  kgConVentana: number;
  /** De esas, las que el año pasado se recogieron fuera de su ventana. */
  fueraDeVentana: number;
  hectareas: number;
}

export interface EntradaFicha {
  finca: string | null;
  parcela: string | null;
  hectareas: number | null;
  emparejado_estado: string;
  origen_finca_nombre: string | null;
  variedad: string | null;
}

export interface EntradaCurva {
  finca_nombre: string;
  variedad: string;
  ventana_desde: string | null;
  ventana_hasta: string | null;
  fuente: string | null;
}

export interface OpcionesPrevision {
  entradas: EntradaPrevision[];
  fichas: EntradaFicha[];
  curvas: EntradaCurva[];
  /** Campaña de la que se copia (por defecto, la última completa de los datos). */
  campanaBase?: string;
  /** Campaña que se prevé (por defecto, la siguiente a la base). */
  campanaObjetivo?: string;
}

export interface Prevision {
  campanaBase: string;
  campanaObjetivo: string;
  parcelas: PrevisionParcela[];
  porSemana: SemanaPrevision[];
  totales: TotalesPrevision;
}

const txt = (v: string | null | undefined) => String(v ?? "").trim();
const normal = (v: string | null | undefined) =>
  txt(v).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/**
 * La previsión de la campaña que viene.
 *
 * El reparto por semanas se hace de una de estas dos formas, y cada parcela
 * dice cuál le ha tocado:
 *   · "ventana": Aerobotics dice entre qué semanas se recoge → los kilos del
 *     año pasado se reparten A PARTES IGUALES entre esas semanas.
 *   · "historico": no hay ventana → se repiten las MISMAS semanas del año
 *     pasado con los MISMOS kilos, un año más tarde.
 */
export function preverCampana(opciones: OpcionesPrevision): Prevision {
  const { entradas, fichas, curvas } = opciones;

  const deCampo = entradas.filter((e) => esFincaDeCampo(txt(e.finca)));
  const campanas = [...new Set(deCampo.map((e) => campanaDe(e.fecha)))].sort();
  // La base es la PENÚLTIMA campaña con datos, porque la última suele estar a
  // medias: en octubre ya hay entradas de la nueva y copiar de ella sería
  // prever el año con el año a medio hacer. Si solo hay una, esa es la base y
  // se prevé la siguiente.
  const campanaBase = opciones.campanaBase ?? campanas.at(-2) ?? campanas.at(-1) ?? campanaDe(new Date().toISOString().slice(0, 10));
  const campanaObjetivo = opciones.campanaObjetivo ?? campanaSiguiente(campanaBase);

  // Ficha de campo por parcela: hectáreas (solo emparejamientos de fiar) y
  // ventana de recolección de su finca y variedad.
  const fichaPorClave = new Map<string, { hectareas: number; finca_nombre: string | null; variedad: string | null }>();
  for (const f of fichas) {
    if (!f.finca) continue;
    if (f.emparejado_estado !== "clara" && f.emparejado_estado !== "confirmada") continue;
    const k = `${txt(f.finca)}‖${txt(f.parcela)}`;
    const previo = fichaPorClave.get(k);
    fichaPorClave.set(k, {
      hectareas: (previo?.hectareas ?? 0) + (f.hectareas ?? 0),
      finca_nombre: previo?.finca_nombre ?? f.origen_finca_nombre,
      variedad: previo?.variedad ?? f.variedad,
    });
  }

  const curvaDe = (fincaAero: string | null, variedad: string | null): EntradaCurva | null => {
    if (!fincaAero) return null;
    const mismas = curvas.filter((c) => normal(c.finca_nombre) === normal(fincaAero));
    if (mismas.length === 0) return null;
    return mismas.find((c) => normal(c.variedad) === normal(variedad)) ?? null;
  };

  // Agrupar las entradas por parcela y campaña.
  interface Acumulado {
    finca: string; parcela: string; agricultor: string; articulo: string;
    base: Map<string, number>;   // semana → kg de la campaña base
    kgBase: number;
    kgObjetivo: number;
    semanasObjetivo: Map<string, number>;
  }
  const porParcela = new Map<string, Acumulado>();
  for (const e of deCampo) {
    const finca = txt(e.finca);
    const parcela = txt(e.parcela);
    const clave = `${finca}‖${parcela}`;
    const acc = porParcela.get(clave) ?? {
      finca, parcela, agricultor: "", articulo: "",
      base: new Map<string, number>(), kgBase: 0, kgObjetivo: 0, semanasObjetivo: new Map<string, number>(),
    };
    acc.agricultor = acc.agricultor || txt(e.agricultor);
    acc.articulo = acc.articulo || txt(e.articulo);
    const kg = Number(e.kg_entrada) || 0;
    const campana = campanaDe(e.fecha);
    const semana = claveSemanaIso(e.fecha);
    if (campana === campanaBase) {
      acc.base.set(semana, (acc.base.get(semana) ?? 0) + kg);
      acc.kgBase += kg;
    } else if (campana === campanaObjetivo) {
      acc.kgObjetivo += kg;
      acc.semanasObjetivo.set(semana, (acc.semanasObjetivo.get(semana) ?? 0) + kg);
    }
    porParcela.set(clave, acc);
  }

  const parcelas: PrevisionParcela[] = [];
  for (const [clave, acc] of porParcela) {
    // Sin kilos en la campaña base no hay de dónde copiar: no se inventa.
    if (acc.kgBase <= 0) continue;

    const ficha = fichaPorClave.get(clave) ?? null;
    const curva = curvaDe(ficha?.finca_nombre ?? null, ficha?.variedad ?? null);
    const desde = normalizarSemana(curva?.ventana_desde);
    const hasta = normalizarSemana(curva?.ventana_hasta);
    const semanasVentana = desde && hasta ? semanasEntre(desde, hasta) : [];

    // El calendario es SIEMPRE el del año pasado, un año después.
    const semanas: SemanaKg[] = [...acc.base.entries()]
      .map(([semana, kg]) => ({ semana: semanaMasUnAnio(semana), kg }))
      .sort((a, b) => a.semana.localeCompare(b.semana));

    // La ventana solo contrasta: ¿cogimos la fruta fuera de cuando Aerobotics
    // dice que está lista? Se mira el grueso (la primera y la última semana con
    // kilos), no un camión suelto.
    let avisoVentana: AvisoVentana | null = null;
    let semanasDeDesfase = 0;
    if (semanasVentana.length > 0 && semanas.length > 0) {
      const primera = semanas[0].semana;
      const ultima = semanas.at(-1)!.semana;
      const ventanaDesde = semanasVentana[0];
      const ventanaHasta = semanasVentana.at(-1)!;
      if (primera < ventanaDesde) {
        avisoVentana = "antes";
        semanasDeDesfase = semanasDeDiferencia(primera, ventanaDesde);
      } else if (ultima > ventanaHasta) {
        avisoVentana = "despues";
        semanasDeDesfase = semanasDeDiferencia(ventanaHasta, ultima);
      } else {
        avisoVentana = "cuadra";
      }
    }

    parcelas.push({
      clave,
      finca: acc.finca,
      parcela: acc.parcela,
      etiqueta: acc.parcela || "(sin parcela)",
      agricultor: acc.agricultor,
      variedad: acc.articulo,
      kgBase: acc.kgBase,
      hectareas: ficha && ficha.hectareas > 0 ? ficha.hectareas : null,
      kgPorHa: ficha && ficha.hectareas > 0 ? acc.kgBase / ficha.hectareas : null,
      ventana: desde && hasta && semanasVentana.length > 0
        ? { desde, hasta, fuente: curva?.fuente ?? null }
        : null,
      avisoVentana,
      semanasDeDesfase,
      semanas,
      kgEntrado: acc.kgObjetivo,
      kgPendiente: Math.max(0, acc.kgBase - acc.kgObjetivo),
    });
  }

  parcelas.sort((a, b) => b.kgBase - a.kgBase);

  // La curva semanal de toda la campaña: lo previsto y lo que ya ha entrado.
  const semanas = new Map<string, SemanaPrevision>();
  const anota = (semana: string, campo: "previsto" | "entrado", kg: number) => {
    const s = semanas.get(semana) ?? { semana, previsto: 0, entrado: 0 };
    s[campo] += kg;
    semanas.set(semana, s);
  };
  for (const p of parcelas) {
    for (const s of p.semanas) anota(s.semana, "previsto", s.kg);
  }
  for (const [clave, acc] of porParcela) {
    if (!parcelas.some((p) => p.clave === clave)) continue;
    for (const [semana, kg] of acc.semanasObjetivo) anota(semana, "entrado", kg);
  }

  const conVentana = parcelas.filter((p) => p.ventana != null);
  return {
    campanaBase,
    campanaObjetivo,
    parcelas,
    porSemana: [...semanas.values()].sort((a, b) => a.semana.localeCompare(b.semana)),
    totales: {
      parcelas: parcelas.length,
      kgPrevisto: parcelas.reduce((s, p) => s + p.kgBase, 0),
      kgEntrado: parcelas.reduce((s, p) => s + p.kgEntrado, 0),
      kgPendiente: parcelas.reduce((s, p) => s + p.kgPendiente, 0),
      conVentana: conVentana.length,
      kgConVentana: conVentana.reduce((s, p) => s + p.kgBase, 0),
      fueraDeVentana: conVentana.filter((p) => p.avisoVentana === "antes" || p.avisoVentana === "despues").length,
      hectareas: parcelas.reduce((s, p) => s + (p.hectareas ?? 0), 0),
    },
  };
}

/** "2026-W42" → "S42 '26", como se habla de las semanas en la nave. */
export function etiquetaSemanaCorta(semana: string): string {
  const m = /^(\d{4})-W(\d{1,2})$/.exec(semana);
  return m ? `S${Number(m[2])} '${m[1].slice(2)}` : semana;
}

/** El lunes de una semana, para enseñar la fecha de verdad al lado. */
export function fechaDeSemana(semana: string): string | null {
  return lunesDe(semana);
}

/** La semana ISO de hoy, en el formato del proyecto. */
export function semanaDeHoy(hoy = new Date()): string {
  const iso = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, "0")}-${String(hoy.getDate()).padStart(2, "0")}`;
  const { anio, semana } = semanaIsoDe(iso);
  return `${anio}-W${String(semana).padStart(2, "0")}`;
}

// lunesDeSemanaIso se reexporta para los consumidores que ya lo usaban por aquí.
export { lunesDeSemanaIso };

/**
 * rentabilidadDia.ts — lib PURA (sin red) de "Económico → Rentabilidad del día".
 *
 * Responde a la pregunta del dueño (encargo del 31-07-2026): ¿cuánto dejó el
 * día, en euros de verdad? La metodología es la validada a mano con los días
 * 29–31 de julio de 2026 (informe entregado al dueño el 03-08-2026):
 *
 *   Ingresos   = Σ kg de cada DESTINO × su precio de venta
 *   Margen     = ingresos − personal − envase − suministros
 *                (lo que deja el trabajo del almacén, ANTES de la fruta)
 *   Beneficio  = margen − fruta calibrada ese día a su coste real de báscula
 *
 * Fuentes por pieza:
 * - Kg y destinos: lote_clasificacion (Informe LOTE del calibrador) — cada
 *   fila trae producto de confección + clase; la clase "(J) …" es podrido
 *   REAL midan lo que midan los productos (misma convención que mermaLote.ts).
 * - Precios Mercadona: mercadona_semana_metodos (base_iva/kilos de la semana
 *   de la fecha, con fallback a la última semana anterior con datos). El
 *   resto de precios son editables en la página con defaults documentados.
 * - Personal: asistencia_detalle (presentes) × horas de jornada × coste_hora
 *   de trabajadores (media configurable para los presentes sin coste cargado).
 * - Fruta: entradas_bascula.importe_total / kg_entrada del lote (compra +
 *   recolección + transporte + comisión). Lote sin importe (sin liquidar) =
 *   fruta desconocida: el beneficio del día queda marcado como incompleto,
 *   JAMÁS se inventa un precio (null ≠ 0, regla del repo).
 *
 * Limitaciones conocidas (documentadas también en la página):
 * - El precalibrado se valora a precio de granel el día que se aparta y sus
 *   kg vuelven a contar el día que se confecciona: entre días hay un pequeño
 *   doble conteo consciente (los kg del día siempre son los del calibrador).
 * - Sin Seguridad Social (~+35 % del personal) ni estructura: es el mismo
 *   criterio en todos los días, así que las comparaciones entre días valen.
 *
 * VIVE EN _shared (patrón fotoLotesCoherencia): lo importan la edge function
 * informe-semanal (Deno) y el frontend vía el re-export src/lib/rentabilidadDia.ts
 * — mismo número ⇒ misma función pura, sin copias que diverjan. Las pruebas
 * siguen en src/lib/rentabilidadDia.test.ts (vitest).
 */
import { normalizarLoteCodigo } from "./loteCodigo.ts";

/** Destino comercial de una fila de clasificación. */
export type DestinoRentabilidad =
  | "mdna3"
  | "mdna4"
  | "mdna5"
  | "mdnaGranel"
  | "otrosEmp"
  | "otrosGranel"
  | "prec"
  | "industria"
  | "podrido"
  | "muestra";

/** Orden de presentación (y de las filas de la cuenta) — de más a menos valor. */
export const DESTINOS_ORDEN: DestinoRentabilidad[] = [
  "mdnaGranel", "mdna3", "mdna5", "mdna4", "otrosEmp", "otrosGranel", "prec", "industria", "podrido", "muestra",
];

export const DESTINO_LABEL: Record<DestinoRentabilidad, string> = {
  mdnaGranel: "Mercadona · granel 12 kg",
  mdna3: "Mercadona · malla 3 kg",
  mdna5: "Mercadona · malla 5 kg",
  mdna4: "Mercadona · girsac 4 kg",
  otrosEmp: "Empaquetado otros clientes",
  otrosGranel: "Granel otros clientes",
  prec: "Precalibrado (volverá a línea)",
  industria: "Industria",
  podrido: "Podrido",
  muestra: "Muestras",
};

/** Clase "(J) Podrido" del calibrador: misma técnica que mermaLote.ts. */
const RE_CLASE_PODRIDO = /^\(J\)/i;

/**
 * Clasifica una fila del Informe LOTE en su destino comercial. La clase (J)
 * manda sobre el producto: un kg podrido es podrido aunque viaje en el box de
 * industria (y por eso NO se cobra a precio de industria).
 */
export function clasificarDestinoRentabilidad(producto: string | null, clase: string | null): DestinoRentabilidad {
  if (clase && RE_CLASE_PODRIDO.test(clase.trim())) return "podrido";
  const p = (producto ?? "").trim().toUpperCase();
  if (p.includes("MUESTRA")) return "muestra";
  if (p.includes("INDUSTRIA")) return "industria";
  if (p.startsWith("PREC")) return "prec";
  if (p.startsWith("MDNA")) {
    if (p.includes("GRANEL")) return "mdnaGranel";
    if (/MDNA\s*3\s*K/.test(p)) return "mdna3";
    if (/MDNA\s*4\s*K/.test(p)) return "mdna4";
    if (/MDNA\s*5\s*K/.test(p)) return "mdna5";
    // Formato MDNA no reconocido: cuenta como girsac 4 kg (el más común) y la
    // página avisa vía kgMdnaSinFormato para que no pase en silencio.
    return "mdna4";
  }
  if (p.includes("GRANEL") || p.startsWith("PROSOL")) return "otrosGranel";
  return "otrosEmp";
}

/** true si es un producto MDNA cuyo formato no se reconoce (avisar, no callar). */
export function esMdnaSinFormato(producto: string | null): boolean {
  const p = (producto ?? "").trim().toUpperCase();
  return p.startsWith("MDNA") && !p.includes("GRANEL") && !/MDNA\s*[345]\s*K/.test(p);
}

/** Precios €/kg por destino. Los MDNA vienen de la semana Mercadona; el resto son editables. */
export interface PreciosRentabilidad {
  mdna3: number;
  mdna4: number;
  mdna5: number;
  mdnaGranel: number;
  otrosEmp: number;
  otrosGranel: number;
  prec: number;
  industria: number;
}

/**
 * Defaults de los precios NO Mercadona (proxy de las ventas de junio 2026,
 * hasta que las ventas del mes estén cargadas) + industria (dato del dueño,
 * 31-07-2026). Los MDNA a 0 obligan a que vengan de la semana o del usuario.
 */
export const PRECIOS_RENTABILIDAD_DEFECTO: PreciosRentabilidad = {
  mdna3: 0,
  mdna4: 0,
  mdna5: 0,
  mdnaGranel: 0,
  otrosEmp: 0.5,
  otrosGranel: 0.33,
  prec: 0.33,
  industria: 0.14,
};

/**
 * Envase €/kg por destino. 3 y 5 kg salen de economico_mallas_config
 * (0,11342 €/malla de 3 kg y 0,2424 €/malla de 5 kg, componentes completos);
 * girsac 4 kg no tiene config: aproximado entre ambos. Granel/cajas, estimado.
 */
export const ENVASE_EUR_KG: Record<DestinoRentabilidad, number> = {
  mdna3: 0.0378,
  mdna4: 0.045,
  mdna5: 0.0485,
  mdnaGranel: 0.02,
  otrosEmp: 0.04,
  otrosGranel: 0.02,
  prec: 0,
  industria: 0,
  podrido: 0,
  muestra: 0,
};

/** Fila de lote_clasificacion con lo que necesita el cálculo. */
export interface FilaClasifRentabilidad {
  lote_codigo: string | null;
  productor: string | null;
  producto: string | null;
  clase: string | null;
  peso_kg: number | null;
  toneladas_hora: number | null;
  duracion_min: number | null;
}

/** Coste de fruta de un lote: importe_total/kg_entrada de báscula. null = sin liquidar. */
export interface FrutaLoteRentabilidad {
  eurKg: number | null;
}

export interface PersonalDiaRentabilidad {
  /** Presentes ese día (asistencia_detalle.presente). */
  presentes: number;
  /** Σ coste_hora de los presentes CON coste cargado en trabajadores. */
  sumaCosteHoraConocida: number;
  /** Presentes sin coste_hora: se les aplica costeHoraMedio. */
  presentesSinCoste: number;
}

export interface OpcionesRentabilidad {
  precios: PreciosRentabilidad;
  /** Horas de jornada (7 h en vacaciones 2026; editable en la página). */
  horasJornada: number;
  /** Suministros del día (luz+gasoil+agua). Default: estimación con facturas de mayo. */
  suministrosDiaEur: number;
  /** €/h aplicado a los presentes sin coste de nómina cargado. */
  costeHoraMedio: number;
}

export const HORAS_JORNADA_DEFECTO = 7;
export const SUMINISTROS_DIA_DEFECTO_EUR = 600;
export const COSTE_HORA_MEDIO_DEFECTO = 8.34;

export interface LoteRentabilidad {
  loteCodigo: string;
  /** Clave de 8 dígitos (convención A del repo) para enlazar con báscula/trazabilidad. */
  loteBase: string | null;
  productor: string | null;
  kg: number;
  kgPorDestino: Partial<Record<DestinoRentabilidad, number>>;
  ingresosEur: number;
  envaseEur: number;
  personalEur: number;
  suministrosEur: number;
  margenEur: number;
  margenEurKg: number | null;
  /** €/kg de fruta all-in del lote (báscula). null = sin liquidar. */
  frutaEurKg: number | null;
  frutaEur: number | null;
  /** margen − fruta. null si la fruta del lote no está liquidada. */
  beneficioEur: number | null;
  pctPodrido: number | null;
  pctIndustria: number | null;
  duracionMin: number | null;
  toneladasHora: number | null;
  /** margen/minuto de línea: la vara para ordenar la cola. null sin duración. */
  margenEurMin: number | null;
}

export interface RentabilidadDia {
  kgTotal: number;
  kgPorDestino: Record<DestinoRentabilidad, number>;
  ingresosPorDestino: Record<DestinoRentabilidad, number>;
  ingresosEur: number;
  envaseEur: number;
  personalEur: number;
  suministrosEur: number;
  margenEur: number;
  margenEurKg: number | null;
  /** Σ fruta de los lotes CON coste. */
  frutaEur: number;
  /** Kg calibrados de lotes SIN coste de fruta (báscula sin liquidar): si > 0 el beneficio está incompleto. */
  kgSinCosteFruta: number;
  /** margen − frutaEur. Con kgSinCosteFruta > 0 es un beneficio PARCIAL (le falta fruta por restar). */
  beneficioEur: number;
  pctPodrido: number | null;
  pctIndustria: number | null;
  /** Kg MDNA cuyo formato de malla no se reconoció (contados como girsac 4 kg). */
  kgMdnaSinFormato: number;
  lotes: LoteRentabilidad[];
}

function destinosVacios(): Record<DestinoRentabilidad, number> {
  const out = {} as Record<DestinoRentabilidad, number>;
  for (const d of DESTINOS_ORDEN) out[d] = 0;
  return out;
}

const PRECIO_POR_DESTINO = (precios: PreciosRentabilidad, d: DestinoRentabilidad): number => {
  if (d === "podrido" || d === "muestra") return 0;
  return precios[d];
};

/** Coste de personal del día = (Σ coste_hora conocido + sin coste × media) × horas. */
export function personalDiaEur(personal: PersonalDiaRentabilidad, horasJornada: number, costeHoraMedio: number): number {
  return (personal.sumaCosteHoraConocida + personal.presentesSinCoste * costeHoraMedio) * horasJornada;
}

/**
 * Cálculo completo del día. `frutaPorLote` va indexada por la clave de 8
 * dígitos (normalizarLoteCodigo, convención A) — la misma de báscula. JAMÁS
 * cruzar por LIKE/subcadena (lección real del repo: infla los kg).
 */
export function computeRentabilidadDia(
  filas: FilaClasifRentabilidad[],
  frutaPorLote: Map<string, FrutaLoteRentabilidad>,
  personal: PersonalDiaRentabilidad,
  opciones: OpcionesRentabilidad,
): RentabilidadDia {
  const { precios, horasJornada, suministrosDiaEur, costeHoraMedio } = opciones;

  // Agrupar por lote (código crudo del informe: un lote compuesto "A+B" es una
  // pasada única y se enseña tal cual; a báscula se va con su clave base).
  interface Acc {
    productor: string | null;
    kg: number;
    kgPorDestino: Partial<Record<DestinoRentabilidad, number>>;
    duracionMin: number | null;
    toneladasHora: number | null;
    kgMdnaSinFormato: number;
  }
  const porLote = new Map<string, Acc>();
  for (const f of filas) {
    const codigo = (f.lote_codigo ?? "(sin lote)").trim() || "(sin lote)";
    const kg = f.peso_kg ?? 0;
    if (kg <= 0) continue;
    let acc = porLote.get(codigo);
    if (!acc) {
      acc = { productor: f.productor, kg: 0, kgPorDestino: {}, duracionMin: null, toneladasHora: null, kgMdnaSinFormato: 0 };
      porLote.set(codigo, acc);
    }
    const destino = clasificarDestinoRentabilidad(f.producto, f.clase);
    acc.kg += kg;
    acc.kgPorDestino[destino] = (acc.kgPorDestino[destino] ?? 0) + kg;
    if (destino !== "podrido" && esMdnaSinFormato(f.producto)) acc.kgMdnaSinFormato += kg;
    if (f.duracion_min != null && (acc.duracionMin == null || f.duracion_min > acc.duracionMin)) acc.duracionMin = f.duracion_min;
    if (f.toneladas_hora != null && acc.toneladasHora == null) acc.toneladasHora = f.toneladas_hora;
    if (!acc.productor && f.productor) acc.productor = f.productor;
  }

  const personalEur = personalDiaEur(personal, horasJornada, costeHoraMedio);
  const kgTotal = [...porLote.values()].reduce((s, a) => s + a.kg, 0);

  // Reparto de personal+suministros entre lotes: por minutos de línea si TODOS
  // los lotes traen duración (lo normal en el Informe LOTE); si no, por kg.
  const accs = [...porLote.entries()];
  const todosConDuracion = accs.length > 0 && accs.every(([, a]) => a.duracionMin != null && a.duracionMin > 0);
  const totalPeso = todosConDuracion
    ? accs.reduce((s, [, a]) => s + (a.duracionMin ?? 0), 0)
    : kgTotal;

  const dia: RentabilidadDia = {
    kgTotal,
    kgPorDestino: destinosVacios(),
    ingresosPorDestino: destinosVacios(),
    ingresosEur: 0,
    envaseEur: 0,
    personalEur,
    suministrosEur: suministrosDiaEur,
    margenEur: 0,
    margenEurKg: null,
    frutaEur: 0,
    kgSinCosteFruta: 0,
    beneficioEur: 0,
    pctPodrido: null,
    pctIndustria: null,
    kgMdnaSinFormato: 0,
    lotes: [],
  };

  for (const [codigo, acc] of accs) {
    const peso = todosConDuracion ? (acc.duracionMin ?? 0) : acc.kg;
    const cuota = totalPeso > 0 ? peso / totalPeso : 0;

    let ingresos = 0;
    let envase = 0;
    for (const d of DESTINOS_ORDEN) {
      const kg = acc.kgPorDestino[d] ?? 0;
      if (kg <= 0) continue;
      const eur = kg * PRECIO_POR_DESTINO(precios, d);
      ingresos += eur;
      envase += kg * ENVASE_EUR_KG[d];
      dia.kgPorDestino[d] += kg;
      dia.ingresosPorDestino[d] += eur;
    }

    const personalLote = personalEur * cuota;
    const suministrosLote = suministrosDiaEur * cuota;
    const margen = ingresos - envase - personalLote - suministrosLote;

    const loteBase = normalizarLoteCodigo(codigo);
    const fruta = loteBase ? frutaPorLote.get(loteBase) : undefined;
    const frutaEurKg = fruta?.eurKg ?? null;
    const frutaEur = frutaEurKg != null ? acc.kg * frutaEurKg : null;

    const podrido = (acc.kgPorDestino.podrido ?? 0) + (acc.kgPorDestino.muestra ?? 0);
    const industria = acc.kgPorDestino.industria ?? 0;

    dia.ingresosEur += ingresos;
    dia.envaseEur += envase;
    if (frutaEur != null) dia.frutaEur += frutaEur;
    else dia.kgSinCosteFruta += acc.kg;
    dia.kgMdnaSinFormato += acc.kgMdnaSinFormato;

    dia.lotes.push({
      loteCodigo: codigo,
      loteBase,
      productor: acc.productor,
      kg: acc.kg,
      kgPorDestino: acc.kgPorDestino,
      ingresosEur: ingresos,
      envaseEur: envase,
      personalEur: personalLote,
      suministrosEur: suministrosLote,
      margenEur: margen,
      margenEurKg: acc.kg > 0 ? margen / acc.kg : null,
      frutaEurKg,
      frutaEur,
      beneficioEur: frutaEur != null ? margen - frutaEur : null,
      pctPodrido: acc.kg > 0 ? (podrido / acc.kg) * 100 : null,
      pctIndustria: acc.kg > 0 ? (industria / acc.kg) * 100 : null,
      duracionMin: acc.duracionMin,
      toneladasHora: acc.toneladasHora,
      margenEurMin: acc.duracionMin != null && acc.duracionMin > 0 ? margen / acc.duracionMin : null,
    });
  }

  // De mejor a peor lote por lo que ganó (los sin fruta, al final por margen).
  dia.lotes.sort((a, b) => (b.beneficioEur ?? b.margenEur - 1e12) - (a.beneficioEur ?? a.margenEur - 1e12));

  dia.margenEur = dia.ingresosEur - dia.envaseEur - personalEur - suministrosDiaEur;
  dia.margenEurKg = kgTotal > 0 ? dia.margenEur / kgTotal : null;
  dia.beneficioEur = dia.margenEur - dia.frutaEur;
  const podridoDia = dia.kgPorDestino.podrido + dia.kgPorDestino.muestra;
  dia.pctPodrido = kgTotal > 0 ? (podridoDia / kgTotal) * 100 : null;
  dia.pctIndustria = kgTotal > 0 ? (dia.kgPorDestino.industria / kgTotal) * 100 : null;
  return dia;
}

/** Métodos de la hoja semanal Mercadona → destino de esta página. */
export const METODO_MDNA_A_DESTINO: Record<string, "mdna3" | "mdna4" | "mdna5" | "mdnaGranel"> = {
  MA3KGC: "mdna3",
  MA4KGC: "mdna4",
  MA5KGC: "mdna5",
  MA12KGC: "mdnaGranel",
};

/**
 * €/kg por formato desde las filas (metodo, kilos, base_iva) de una semana
 * Mercadona. Devuelve solo los formatos con kilos > 0 y base_iva > 0 — una
 * semana con base_iva vacía (aún sin facturar) no debe fijar precio 0.
 */
export function preciosMdnaDesdeSemana(
  metodos: Array<{ metodo: string | null; kilos: number | null; base_iva: number | null }>,
): Partial<Pick<PreciosRentabilidad, "mdna3" | "mdna4" | "mdna5" | "mdnaGranel">> {
  const out: Partial<Pick<PreciosRentabilidad, "mdna3" | "mdna4" | "mdna5" | "mdnaGranel">> = {};
  for (const m of metodos) {
    const destino = m.metodo ? METODO_MDNA_A_DESTINO[m.metodo.trim().toUpperCase()] : undefined;
    if (!destino) continue;
    const kilos = m.kilos ?? 0;
    const base = m.base_iva ?? 0;
    if (kilos > 0 && base > 0) out[destino] = base / kilos;
  }
  return out;
}

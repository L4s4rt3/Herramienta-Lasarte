/**
 * tipoDia.ts — el análisis económico por TIPO DE DÍA que pidió el dueño en la
 * reunión del 27-08-2026: plantilla completa/reducida × día bueno/medio/malo,
 * con la cuenta del día (metodología v5) donde se puede hacer de verdad.
 *
 * POR QUÉ EXISTE (03-09-2026). Era tmp/analisis-tipo-dia.ts, un Excel fuera del
 * repo que dependía de dos ficheros locales (el estándar y un export del
 * reloj). Ahora el cálculo vive aquí y lo comparten la vista "Por tipo de día"
 * de Económico → Rentabilidad y el script scripts/analisis-tipo-dia.ts.
 *
 * ─── Las reglas ──────────────────────────────────────────────────────────────
 * - RÉGIMEN y CALIDAD del día: estandarRendimiento.ts (decisión del dueño 27-08:
 *   ≤35 presentes = media plantilla; cada régimen tiene su listón porque con
 *   media plantilla la gente rinde más por persona).
 * - LA CUENTA de cada día: computeRentabilidadDia, la MISMA función pura que
 *   /economico/rentabilidad y el informe semanal (v5, validada a mano el 03-08).
 *   Ingresos = kg × precio por destino; margen = ingresos − personal − envase −
 *   suministros; beneficio = margen − fruta al coste real de báscula. Sin
 *   Seguridad Social ni estructura: comparaciones entre días, sí; cuenta de
 *   resultados, no.
 * - LOS EUROS DE VENTA solo donde la tarifa Mercadona es REAL. Los precios MDNA
 *   por defecto están a 0 a propósito (deben venir de la semana): calcular con
 *   ellos hunde los ingresos y saca beneficios de −30.000 €/día que son
 *   mentira (aprendido el 27-08). Una semana es fiable si su €/kg medio
 *   facturado (base_iva/kilos) llega a 0,80; las semanas a medio facturar
 *   salen a 0,38-0,47 y NO valen. Un día usa su semana fiable o la última
 *   fiable anterior; sin ninguna, se enseña su estructura (kg, personas,
 *   personal) y ninguna venta.
 * - Un día con menos de 5.000 kg es arranque o residual y no cuenta.
 * - Un día sin asistencia en la base no se puede clasificar (no hay personas)
 *   y se lista aparte: la asistencia se vuelca por semanas completas; cuando
 *   entra, el día aparece solo.
 */
import { normalizarLoteCodigo } from "./loteCodigo.ts";
import { semanaIsoDe } from "./semanaIso.ts";
import {
  computeRentabilidadDia,
  COSTE_HORA_MEDIO_DEFECTO,
  HORAS_JORNADA_DEFECTO,
  PRECIOS_RENTABILIDAD_DEFECTO,
  preciosMdnaDesdeSemana,
  SUMINISTROS_DIA_DEFECTO_EUR,
  type FilaClasifRentabilidad,
  type FrutaLoteRentabilidad,
  type PreciosRentabilidad,
} from "./rentabilidadDia.ts";
import {
  calidadDia,
  ESTANDAR_RENDIMIENTO,
  ORDEN_TIPOS_DIA,
  regimenPlantilla,
  tipoDia,
  type CalidadDia,
  type EstandarRendimiento,
  type RegimenPlantilla,
} from "./estandarRendimiento.ts";

const num = (v: unknown): number => Number(v) || 0;

/** €/kg medio facturado por debajo del cual una semana Mercadona NO fija precios (a medio facturar). */
export const EUR_KG_MINIMO_FIABLE = 0.8;
/** Por debajo, el día es arranque o residual y no se clasifica. */
export const KG_MINIMO_DIA = 5000;

// ─── Tarifa Mercadona por semana ─────────────────────────────────────────────

export interface SemanaMdnaCruda {
  anio: number;
  semana: number;
  metodos: Array<{ metodo: string | null; kilos: number | string | null; base_iva: number | string | null }>;
}

export interface SemanaPrecio {
  anio: number;
  semana: number;
  /** anio*100+semana, para ordenar y comparar. */
  orden: number;
  precios: Partial<PreciosRentabilidad>;
  kilos: number;
  baseIva: number;
  eurKg: number | null;
  /** Tarifa REAL: €/kg medio ≥ EUR_KG_MINIMO_FIABLE. */
  fiable: boolean;
}

/** Todas las semanas, ordenadas, con su €/kg y si valen para poner precio. */
export function semanasPrecio(semanas: SemanaMdnaCruda[]): SemanaPrecio[] {
  return semanas
    .map((s): SemanaPrecio => {
      const metodos = (s.metodos ?? []).map((m) => ({ metodo: m.metodo, kilos: num(m.kilos), base_iva: num(m.base_iva) }));
      const kilos = metodos.reduce((x, m) => x + m.kilos, 0);
      const baseIva = metodos.reduce((x, m) => x + m.base_iva, 0);
      const eurKg = kilos > 0 && baseIva > 0 ? baseIva / kilos : null;
      const precios = preciosMdnaDesdeSemana(metodos);
      return {
        anio: s.anio, semana: s.semana, orden: s.anio * 100 + s.semana,
        precios, kilos, baseIva, eurKg,
        fiable: Object.keys(precios).length > 0 && eurKg != null && eurKg >= EUR_KG_MINIMO_FIABLE,
      };
    })
    .sort((a, b) => a.orden - b.orden);
}

/** Los precios de un día: su semana fiable o la última fiable anterior; sin ninguna, los defaults (MDNA a 0) y fiable=false. */
export function preciosDelDia(fecha: string, semanas: SemanaPrecio[]): { precios: PreciosRentabilidad; fiable: boolean; semana: SemanaPrecio | null } {
  const { anio, semana } = semanaIsoDe(fecha);
  const orden = anio * 100 + semana;
  let elegida: SemanaPrecio | null = null;
  for (const s of semanas) {
    if (s.orden <= orden && s.fiable) elegida = s;
  }
  if (!elegida) return { precios: PRECIOS_RENTABILIDAD_DEFECTO, fiable: false, semana: null };
  return { precios: { ...PRECIOS_RENTABILIDAD_DEFECTO, ...elegida.precios }, fiable: true, semana: elegida };
}

// ─── Entradas: fruta por lote y filas/presentes por día ─────────────────────

/**
 * €/kg all-in de la fruta por lote (clave de 8 dígitos) desde báscula:
 * Σ importe_total / Σ kg_entrada. Sin importe (null o 0) = sin liquidar → null,
 * jamás 0 (misma regla que /economico/rentabilidad).
 */
export function frutaPorLoteDesdeEntradas(
  entradas: Iterable<{ lote: string | null; kg_entrada: number | string | null; importe_total: number | string | null }>,
): Map<string, FrutaLoteRentabilidad> {
  const acc = new Map<string, { kg: number; importe: number; conImporte: boolean }>();
  for (const e of entradas) {
    const clave = normalizarLoteCodigo(e.lote);
    if (!clave) continue;
    const a = acc.get(clave) ?? { kg: 0, importe: 0, conImporte: false };
    a.kg += num(e.kg_entrada);
    const importe = num(e.importe_total);
    if (importe > 0) {
      a.importe += importe;
      a.conImporte = true;
    }
    acc.set(clave, a);
  }
  const out = new Map<string, FrutaLoteRentabilidad>();
  for (const [clave, a] of acc) out.set(clave, { eurKg: a.conImporte && a.kg > 0 ? a.importe / a.kg : null });
  return out;
}

export function filasPorDiaDesde(filas: Iterable<FilaClasifRentabilidad & { fecha: string | null }>): Map<string, FilaClasifRentabilidad[]> {
  const out = new Map<string, FilaClasifRentabilidad[]>();
  for (const f of filas) {
    if (!f.fecha) continue;
    const dia = f.fecha.slice(0, 10);
    const arr = out.get(dia) ?? [];
    arr.push(f);
    out.set(dia, arr);
  }
  return out;
}

/** Ids de los presentes de cada día (filas con presente=false se ignoran). */
export function presentesPorDiaDesde(asistencia: Iterable<{ date: string; trabajador_id: string; presente?: boolean | null }>): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const a of asistencia) {
    if (a.presente === false) continue;
    const arr = out.get(a.date) ?? [];
    arr.push(a.trabajador_id);
    out.set(a.date, arr);
  }
  return out;
}

// ─── Los días ────────────────────────────────────────────────────────────────

export interface DiaTipo {
  fecha: string;
  presentes: number;
  /** Presentes sin coste/hora cargado: se les aplica el coste medio. */
  presentesSinCoste: number;
  kg: number;
  kgPersona: number;
  personalEur: number;
  regimen: RegimenPlantilla;
  calidad: CalidadDia;
  tipo: string;
  /** true solo si la tarifa Mercadona del día es real: entonces hay euros de venta. */
  conCuenta: boolean;
  semanaPrecio: { anio: number; semana: number } | null;
  ingresos: number | null;
  envase: number | null;
  suministros: number | null;
  margen: number | null;
  fruta: number | null;
  beneficio: number | null;
  /** Kg de lotes con báscula sin liquidar: si > 0 el beneficio es PARCIAL. */
  kgSinFruta: number | null;
}

export interface OpcionesTipoDia {
  horasJornada?: number;
  suministrosDiaEur?: number;
  costeHoraMedio?: number;
  kgMinimoDia?: number;
  estandar?: EstandarRendimiento;
}

export interface ConstruirDiasTipoArgs {
  filasPorDia: Map<string, FilaClasifRentabilidad[]>;
  presentesPorDia: Map<string, string[]>;
  costeHoraPorTrabajador: Map<string, number | null | undefined>;
  frutaPorLote: Map<string, FrutaLoteRentabilidad>;
  semanas: SemanaPrecio[];
  opciones?: OpcionesTipoDia;
}

export interface ResultadoDiasTipo {
  dias: DiaTipo[];
  /** Días con clasificación pero sin asistencia en la base: no se pueden clasificar. */
  sinAsistencia: string[];
  /** Días por debajo del mínimo de kg (arranques, residuales). */
  descartadosPorKg: Array<{ fecha: string; kg: number }>;
}

export function construirDiasTipo(args: ConstruirDiasTipoArgs): ResultadoDiasTipo {
  const est = args.opciones?.estandar ?? ESTANDAR_RENDIMIENTO;
  const horasJornada = args.opciones?.horasJornada ?? HORAS_JORNADA_DEFECTO;
  const suministrosDiaEur = args.opciones?.suministrosDiaEur ?? SUMINISTROS_DIA_DEFECTO_EUR;
  const costeHoraMedio = args.opciones?.costeHoraMedio ?? COSTE_HORA_MEDIO_DEFECTO;
  const kgMinimo = args.opciones?.kgMinimoDia ?? KG_MINIMO_DIA;

  const dias: DiaTipo[] = [];
  const sinAsistencia: string[] = [];
  const descartadosPorKg: Array<{ fecha: string; kg: number }> = [];

  for (const fecha of [...args.filasPorDia.keys()].sort()) {
    const filas = args.filasPorDia.get(fecha) ?? [];
    const presentes = args.presentesPorDia.get(fecha) ?? [];
    if (presentes.length === 0) {
      sinAsistencia.push(fecha);
      continue;
    }
    let suma = 0;
    let sinCoste = 0;
    for (const id of presentes) {
      const c = args.costeHoraPorTrabajador.get(id);
      if (c != null && c > 0) suma += num(c);
      else sinCoste += 1;
    }
    const { precios, fiable, semana } = preciosDelDia(fecha, args.semanas);
    const r = computeRentabilidadDia(
      filas,
      args.frutaPorLote,
      { presentes: presentes.length, sumaCosteHoraConocida: suma, presentesSinCoste: sinCoste },
      { precios, horasJornada, suministrosDiaEur, costeHoraMedio },
    );
    if (r.kgTotal < kgMinimo) {
      descartadosPorKg.push({ fecha, kg: r.kgTotal });
      continue;
    }
    const kgPersona = r.kgTotal / presentes.length;
    const regimen = regimenPlantilla(presentes.length, est);
    const calidad = calidadDia(kgPersona, regimen, est);
    dias.push({
      fecha,
      presentes: presentes.length,
      presentesSinCoste: sinCoste,
      kg: r.kgTotal,
      kgPersona,
      personalEur: r.personalEur,
      regimen,
      calidad,
      tipo: tipoDia(regimen, calidad),
      conCuenta: fiable,
      semanaPrecio: semana ? { anio: semana.anio, semana: semana.semana } : null,
      ingresos: fiable ? r.ingresosEur : null,
      envase: fiable ? r.envaseEur : null,
      suministros: fiable ? r.suministrosEur : null,
      margen: fiable ? r.margenEur : null,
      fruta: fiable ? r.frutaEur : null,
      beneficio: fiable ? r.beneficioEur : null,
      kgSinFruta: fiable ? r.kgSinCosteFruta : null,
    });
  }
  return { dias, sinAsistencia, descartadosPorKg };
}

// ─── Agregados por tipo ──────────────────────────────────────────────────────

export interface FilaTipoDia {
  tipo: string;
  dias: number;
  /** Medias por día sobre los días con dato (null si ninguno lo tiene). */
  kg: number | null;
  presentes: number | null;
  kgPersona: number | null;
  personal: number | null;
  /** Personal medio / kg medio: el €/kg de la gente. */
  personalKg: number | null;
  ingresos: number | null;
  envase: number | null;
  suministros: number | null;
  margen: number | null;
  fruta: number | null;
  beneficio: number | null;
  kgSinFruta: number | null;
  /** Cuántos de los días llevan euros de venta (tarifa real). */
  diasConCuenta: number;
}

function media(lista: DiaTipo[], f: (d: DiaTipo) => number | null): number | null {
  const v = lista.map(f).filter((x): x is number => x != null);
  return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null;
}

export function agregarDias(tipo: string, lista: DiaTipo[]): FilaTipoDia {
  const kg = media(lista, (d) => d.kg);
  const personal = media(lista, (d) => d.personalEur);
  return {
    tipo,
    dias: lista.length,
    kg,
    presentes: media(lista, (d) => d.presentes),
    kgPersona: media(lista, (d) => d.kgPersona),
    personal,
    personalKg: kg && personal ? personal / kg : null,
    ingresos: media(lista, (d) => d.ingresos),
    envase: media(lista, (d) => d.envase),
    suministros: media(lista, (d) => d.suministros),
    margen: media(lista, (d) => d.margen),
    fruta: media(lista, (d) => d.fruta),
    beneficio: media(lista, (d) => d.beneficio),
    kgSinFruta: media(lista, (d) => d.kgSinFruta),
    diasConCuenta: lista.filter((d) => d.conCuenta).length,
  };
}

/** Una fila por tipo de día presente, en el orden canónico (completa primero, bueno→malo). */
export function resumenPorTipo(dias: DiaTipo[]): FilaTipoDia[] {
  const porTipo = new Map<string, DiaTipo[]>();
  for (const d of dias) {
    const arr = porTipo.get(d.tipo) ?? [];
    arr.push(d);
    porTipo.set(d.tipo, arr);
  }
  return ORDEN_TIPOS_DIA.filter((t) => porTipo.has(t)).map((t) => agregarDias(t, porTipo.get(t)!));
}

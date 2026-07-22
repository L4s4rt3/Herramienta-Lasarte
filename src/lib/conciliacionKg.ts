/**
 * conciliacionKg.ts — conciliación determinista de kg procesados por lote.
 *
 * PROBLEMA (cuantificado con la campaña 25/26 real, 1.187 pasadas / 20,25 M kg):
 * el calibrador atribuye TODA la pasada al primer código de lote de su nombre,
 * pero en línea se mezclan lotes constantemente:
 *   - 647 lotes con MÁS kg procesados que de entrada (1,87 M kg de exceso, el
 *     patrón típico es proc ≈ 2× entrada: no cambian el lote del calibrador al
 *     volcar el siguiente camión de la misma finca);
 *   - 214 lotes >3 t casi sin procesado (3,5 M kg de "stock fantasma": su
 *     fruta se procesó bajo otro código);
 *   - 69 pasadas nombran VARIOS lotes ("25111002+25111001+PREC 25111901",
 *     1,18 M kg) pero todo el kg iba al primero;
 *   - reciclaje/boxes añadidos y re-pasadas de PRECALIBRADO (fruta ya contada).
 *
 * SOLUCIÓN (reglas acordadas con el dueño, 21-jul-2026): calcular un
 * "procesado conciliado" por lote SIN tocar los datos crudos:
 *   1. Las pasadas multi-código se reparten entre TODOS los lotes nombrados,
 *      con tope en el pendiente de cada uno (en el orden del nombre).
 *   2. El exceso de un lote (proc > entrada) se derrama a lotes CON pendiente:
 *      primero misma finca + misma familia de variedad, luego misma familia en
 *      otra finca; en ambos casos por cercanía de fecha de entrada. Con tope
 *      en el pendiente del receptor.
 *   3. Las entradas de PRECALIBRADO absorben sus propias re-pasadas (fruta ya
 *      contada) pero su exceso NO se derrama a lotes reales (sería doble
 *      cuenta) ni reciben derrames.
 *   4. Lo que no encuentra receptor queda en `excesosSinColocar` (cola de
 *      revisión) — nunca se inventa un cuadre.
 * Los totales globales no cambian: solo se reatribuye entre lotes, y cada
 * movimiento queda registrado en `movimientos` para poder auditarlo.
 */
import { diffDias } from "@/lib/entradasBascula";
import { TASA_MERMA_NATURAL_DIA } from "@/lib/mermaLote";

export interface EntradaConciliacion {
  /** Código canónico AAMMDDNN. */
  lote: string;
  /** Fecha de entrada ISO "YYYY-MM-DD" (ordena los candidatos por cercanía). */
  fecha: string;
  finca: string | null;
  articulo: string | null;
  kg_entrada: number;
  /** kg ya contados fuera de los partes (kg_ajuste_stock positivo): reducen el pendiente del lote pero NO forman parte del procesado sintético devuelto (buildStockEntradas suma el ajuste por su cuenta). */
  kg_preasignado?: number;
  /** Movimiento interno de precalibrado: absorbe sus re-pasadas pero ni derrama ni recibe. */
  esPrecalibrado?: boolean;
  /** Cerrado a mano: puede recibir kg (hasta su capacidad) pero SIN actualizar su última fecha de procesado — un derrame no debe disparar el aviso "actividad posterior al cierre". */
  cerrado?: boolean;
  /**
   * Merma REAL de cámara del lote (kg): peso inicial − peso final del
   * registro de mermas de cámara (entradas_bascula.merma_camara_kg). Cuando
   * existe, la CAPACIDAD del lote (kg máximos atribuibles como procesados) es
   * entrada − esta merma: la fruta que se evaporó en cámara nunca llegó al
   * calibrador. Sin dato, la capacidad se estima con TASA_MERMA_NATURAL_DIA ×
   * días hasta la fecha de la pasada. Sin este tope, la conciliación rellenaba
   * lotes al 100 % de su entrada y las mermas salían ≈ 0 (detectado por el
   * dueño contra el registro real de cámara, 21-jul-2026: mermas del 1,1–4,7 %).
   */
  kg_merma_camara?: number | null;
}

export interface PasadaConciliacion {
  /** Texto crudo de lotes_dia.lote_codigo (puede nombrar varios lotes). */
  lote_codigo: string | null;
  kg_peso_total: number | null;
  date?: string | null;
}

export interface MovimientoKg {
  /** Lote al que el calibrador atribuyó los kg (primer código de la pasada / donante del exceso). */
  de: string;
  a: string;
  kg: number;
  motivo: "multi_codigo" | "exceso_misma_finca" | "exceso_misma_variedad";
}

export interface ProcesadoConciliado {
  lote_codigo: string;
  kg_peso_total: number;
  date: string | null;
}

/**
 * TARA de un box de reciclaje: el envase de plástico vacío pesa ~30 kg (dato
 * del dueño, 21-jul-2026, con su ejemplo: "700 kg de reciclaje en Z1 y son 3
 * box → 700 − 90 = 610 kg netos"). El parte apunta el reciclado de malla
 * Z1/Z2 en BRUTO (fruta + envases): el neto de fruta que vuelve a la línea es
 * bruto − nBox × TARA. Esa fruta ya está contada en su lote original, así que
 * el neto diario se descuenta de las pasadas del día ANTES de atribuir kg a
 * las entradas (si no, infla lotes y fabrica excesos falsos).
 */
export const TARA_BOX_RECICLAJE = 30;

export interface ReciclajePasada {
  /** Primer código de lote de la pasada a la que se le descontó, o "(parte del YYYY-MM-DD)" para el reparto proporcional del día. */
  lote: string;
  /** Boxes: los anotados en el nombre de la pasada, o los del parte en la fila de reparto del día. */
  nBox: number;
  /** kg NETOS de fruta reciclada descontados. */
  kg: number;
  fecha: string | null;
}

/** "26042712 + 7 BOX DE RECICLAJE" → 7; "…+2 BOX +5 BOX PREC" → 7. 0 si no menciona boxes. */
export function contarBoxesReciclaje(texto: string | null | undefined): number {
  let total = 0;
  for (const m of String(texto ?? "").matchAll(/(\d+)\s*BOX/gi)) total += Number(m[1]) || 0;
  return total;
}

export interface ConciliacionKg {
  /** Una fila sintética por lote con kg conciliado (SIN el kg_preasignado) y su última fecha de procesado: alimenta buildStockEntradas tal cual. */
  procesados: ProcesadoConciliado[];
  movimientos: MovimientoKg[];
  /** Exceso que no encontró receptor (cola de revisión): lote donante (o texto crudo si la pasada no traía código) y kg. */
  excesosSinColocar: Array<{ lote: string; kg: number }>;
  /** kg netos reasignados por lote: positivo = recibió, negativo = cedió. 0/ausente = sus números crudos eran coherentes. */
  deltaPorLote: Map<string, number>;
  /** Boxes de reciclaje descontados de las pasadas (fruta que vuelve de la línea, ya contada en su lote original). */
  reciclaje: ReciclajePasada[];
  /** Σ kg de `reciclaje` (estimados a KG_POR_BOX_RECICLAJE por box). */
  kgReciclajeEstimado: number;
  /**
   * Kg de re-entradas de PRECALIBRADO aún sin pasada de calibrador asignada:
   * fruta FÍSICA en la nave esperando línea. Es la única parte del almacén
   * PREC medible con fiabilidad (lo que vuelve se pesa siempre en báscula;
   * lo que se aparta, no siempre — verificado 22-jul-2026: apartado
   * registrado 506 t < reintroducido 792 t, así que un "stock PREC" completo
   * saldría negativo y NO se calcula).
   */
  precalibradoPendienteKg: number;
}

/** Tokens genéricos que no distinguen variedad ("NAR VAL DELTA SEEDLESS" y "NARANJA VALENCIA DELTA" son la misma familia). OJO: "NAVEL" es genérico pero "NAVELINA" es una variedad (se compara el token completo). */
const TOKENS_GENERICOS = new Set(["NAR", "NARANJA", "NARANJAS", "VAL", "VALENCIA", "NAVEL", "DE", "DEL", "LA", "LAS", "EL", "LOS"]);

/** Primer token distintivo del artículo ("NAR VAL DELTA SEEDLESS" → "DELTA"); "" si no hay ninguno. */
export function familiaVariedad(articulo: string | null | undefined): string {
  const tokens = String(articulo ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter(Boolean);
  return tokens.find((t) => !TOKENS_GENERICOS.has(t)) ?? "";
}

/** Misma familia si un token es prefijo del otro (cubre "POWEL"/"POWELL"). Familias vacías nunca casan. */
export function mismaFamiliaVariedad(a: string, b: string): boolean {
  return a !== "" && b !== "" && (a.startsWith(b) || b.startsWith(a));
}

function normTexto(value: string | null | undefined): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .trim();
}

interface RegistroLote {
  entrada: EntradaConciliacion;
  familia: string;
  fincaNorm: string;
  /** kg ya atribuidos (incluye kg_preasignado inicial). */
  asignado: number;
  ultimaFecha: string | null;
}

export interface ReciclajeDiaInput {
  /** Fecha ISO del parte. */
  fecha: string;
  /** Kg BRUTOS de reciclaje del parte ese día (reciclado malla Z1 + Z2: fruta + envases). */
  kgBruto: number;
  /** Nº de box de reciclaje del parte (partes_diarios.box_reciclaje): su tara (nBox × 30 kg) se resta del bruto. */
  nBox: number;
}

export function conciliarKgProcesados(
  entradas: EntradaConciliacion[],
  pasadas: PasadaConciliacion[],
  /**
   * Reciclaje DIARIO del parte. El neto de fruta reciclada del día es
   * kgBruto − nBox × TARA_BOX_RECICLAJE, y se descuenta de las pasadas de esa
   * fecha ANTES de atribuir kg a las entradas: primero a las pasadas que
   * anotan boxes en su nombre ("+7 BOX DE RECICLAJE", en proporción a sus
   * boxes — localizan por dónde volvió la fruta), y el resto proporcional a
   * los kg de todas las pasadas del día. Sin dato del parte no se descuenta
   * nada: los boxes anotados en nombres, por sí solos, no cuantifican fruta.
   */
  reciclajePorDia: ReciclajeDiaInput[] = [],
): ConciliacionKg {
  const reg = new Map<string, RegistroLote>();
  for (const e of entradas) {
    // Si un código viniera duplicado, se queda la primera aparición (los
    // exports reales no duplican lote de entrada).
    if (reg.has(e.lote)) continue;
    reg.set(e.lote, {
      entrada: e,
      familia: familiaVariedad(e.articulo),
      fincaNorm: normTexto(e.finca),
      asignado: Math.max(0, Number(e.kg_preasignado) || 0),
      ultimaFecha: null,
    });
  }
  /**
   * CAPACIDAD del lote a una fecha: kg máximos que pudieron salir de cámara
   * hacia el calibrador. Con merma de cámara REAL registrada: entrada − merma.
   * Sin dato: entrada × (1 − TASA_MERMA_NATURAL_DIA × días en cámara hasta la
   * fecha de referencia), acotada a un 15 % de descuento como salvaguarda.
   * Sin este tope la conciliación rellenaba lotes al 100 % de su entrada y la
   * merma salía ≈ 0 en todos los lotes tocados por el reparto.
   */
  const capacidad = (r: RegistroLote, fechaRef: string | null | undefined): number => {
    const mermaReal = r.entrada.kg_merma_camara;
    if (mermaReal != null) return Math.max(0, r.entrada.kg_entrada - Math.max(0, mermaReal));
    // Las re-entradas de PRECALIBRADO ya se pesan en neto al volver: sin
    // descuento estimado (su "cámara" empieza en la re-entrada).
    if (r.entrada.esPrecalibrado) return r.entrada.kg_entrada;
    const dias = fechaRef && r.entrada.fecha && fechaRef > r.entrada.fecha
      ? diffDias(r.entrada.fecha, fechaRef)
      : 0;
    return r.entrada.kg_entrada * (1 - Math.min(0.15, TASA_MERMA_NATURAL_DIA * dias));
  };
  const pendiente = (r: RegistroLote, fechaRef: string | null | undefined) =>
    Math.max(0, capacidad(r, fechaRef) - r.asignado);

  const movimientos: MovimientoKg[] = [];
  const excesosSinColocar: Array<{ lote: string; kg: number }> = [];
  // Exceso acumulado por lote donante tras la fase de asignación directa, con
  // la última fecha de sus pasadas (los receptores del derrame la heredan).
  const excesoPorLote = new Map<string, { kg: number; ultimaFecha: string | null }>();

  const tocar = (r: RegistroLote, kg: number, fecha: string | null | undefined, esDerrame: boolean) => {
    r.asignado += kg;
    // Un derrame sobre un lote cerrado no actualiza su última fecha: el
    // cierre manual no debe marcarse como "actividad posterior" por una
    // reatribución contable.
    if (esDerrame && r.entrada.cerrado) return;
    if (fecha && (!r.ultimaFecha || fecha > r.ultimaFecha)) r.ultimaFecha = fecha;
  };

  // ── Fase 0: reciclaje DIARIO del parte (neto = bruto − nBox × tara) ────────
  // El neto de fruta reciclada del día se descuenta de las pasadas de esa
  // fecha: primero a las que anotan boxes en el nombre (proporcional a sus
  // boxes: localizan por dónde volvió la fruta), el resto proporcional a los
  // kg de todas las pasadas del día. Se materializa en `descuentoPorPasada`
  // (índice original de la pasada → kg a restar) que consume la fase 1.
  const pasadasOrdenadas = pasadas
    .map((p, i) => ({ p, i }))
    .sort((a, b) => ((a.p.date ?? "").localeCompare(b.p.date ?? "")) || a.i - b.i);

  const reciclaje: ReciclajePasada[] = [];
  const descuentoPorPasada = new Map<number, number>();

  interface PasadaDia { i: number; kg: number; nBoxNombre: number; etiqueta: string }
  const pasadasPorDia = new Map<string, PasadaDia[]>();
  for (const { p, i } of pasadasOrdenadas) {
    const kg = Number(p.kg_peso_total) || 0;
    if (kg <= 0 || !p.date) continue;
    const texto = String(p.lote_codigo ?? "");
    const arr = pasadasPorDia.get(p.date) ?? [];
    arr.push({
      i,
      kg,
      nBoxNombre: contarBoxesReciclaje(texto),
      etiqueta: texto.match(/\d{8}/)?.[0] ?? (texto.trim() || "(sin código)"),
    });
    pasadasPorDia.set(p.date, arr);
  }

  const reciclajeDiaAgregado = new Map<string, { kgBruto: number; nBox: number }>();
  for (const dia of reciclajePorDia) {
    const acc = reciclajeDiaAgregado.get(dia.fecha) ?? { kgBruto: 0, nBox: 0 };
    acc.kgBruto += Math.max(0, Number(dia.kgBruto) || 0);
    acc.nBox += Math.max(0, Number(dia.nBox) || 0);
    reciclajeDiaAgregado.set(dia.fecha, acc);
  }

  for (const [fecha, dia] of reciclajeDiaAgregado) {
    // Neto de fruta: al bruto del parte se le resta la tara de sus boxes.
    let neto = Math.max(0, dia.kgBruto - dia.nBox * TARA_BOX_RECICLAJE);
    if (neto <= 0) continue;
    const grupo = pasadasPorDia.get(fecha);
    if (!grupo || grupo.length === 0) continue; // día sin pasadas: nada de lo que descontar

    const disponible = (g: PasadaDia) => g.kg - (descuentoPorPasada.get(g.i) ?? 0);
    neto = Math.min(neto, grupo.reduce((s, g) => s + disponible(g), 0));

    // 1º: pasadas que anotan boxes en su nombre, en proporción a sus boxes.
    const conNombre = grupo.filter((g) => g.nBoxNombre > 0);
    const totalBoxNombre = conNombre.reduce((s, g) => s + g.nBoxNombre, 0);
    let pendiente = neto;
    if (totalBoxNombre > 0) {
      for (const g of conNombre) {
        const cuota = Math.min(neto * (g.nBoxNombre / totalBoxNombre), disponible(g));
        if (cuota <= 0) continue;
        descuentoPorPasada.set(g.i, (descuentoPorPasada.get(g.i) ?? 0) + cuota);
        pendiente -= cuota;
        reciclaje.push({ lote: g.etiqueta, nBox: g.nBoxNombre, kg: cuota, fecha });
      }
    }

    // 2º: el resto, proporcional a los kg restantes de TODAS las pasadas del día.
    if (pendiente > 0.5) {
      const base = grupo.reduce((s, g) => s + disponible(g), 0);
      if (base > 0) {
        let aplicado = 0;
        for (const g of grupo) {
          const cuota = Math.min(pendiente * (disponible(g) / base), disponible(g));
          if (cuota <= 0) continue;
          descuentoPorPasada.set(g.i, (descuentoPorPasada.get(g.i) ?? 0) + cuota);
          aplicado += cuota;
        }
        if (aplicado > 0.5) reciclaje.push({ lote: `(parte del ${fecha})`, nBox: dia.nBox, kg: aplicado, fecha });
      }
    }
  }

  // ── Fase 1: asignación directa, pasada a pasada (orden cronológico) ────────
  for (const { p, i } of pasadasOrdenadas) {
    let kg = Number(p.kg_peso_total) || 0;
    if (kg <= 0) continue;
    const texto = String(p.lote_codigo ?? "");
    const codes = texto.match(/\d{8}/g) ?? [];

    // Reciclaje del día ya repartido en la fase 0: fruta que vuelve de la
    // línea, ya contada en su lote original — fuera antes de atribuir nada.
    const descuento = descuentoPorPasada.get(i) ?? 0;
    if (descuento > 0) {
      kg -= descuento;
      if (kg <= 0.5) continue;
    }

    if (codes.length === 0) {
      // Pasada sin código ("PREC DIA 08/11/25"): no hay lote al que atribuir.
      excesosSinColocar.push({ lote: texto.trim() || "(sin código)", kg });
      continue;
    }

    let restante = kg;
    for (const code of codes) {
      if (restante <= 0) break;
      const r = reg.get(code);
      if (!r) continue; // código desconocido (otra campaña, error de teclado): no se puede acotar
      const absorbe = Math.min(restante, pendiente(r, p.date));
      if (absorbe <= 0) continue;
      tocar(r, absorbe, p.date, false);
      restante -= absorbe;
      if (code !== codes[0]) {
        movimientos.push({ de: codes[0], a: code, kg: absorbe, motivo: "multi_codigo" });
      }
    }

    if (restante > 0.5) {
      const donante = codes[0];
      const acc = excesoPorLote.get(donante) ?? { kg: 0, ultimaFecha: null };
      acc.kg += restante;
      const fecha = p.date ?? null;
      if (fecha && (!acc.ultimaFecha || fecha > acc.ultimaFecha)) acc.ultimaFecha = fecha;
      excesoPorLote.set(donante, acc);
    }
  }

  // ── Fase 2: derrame de excesos a lotes con pendiente ───────────────────────
  const donantes = Array.from(excesoPorLote.keys()).sort();
  for (const donante of donantes) {
    const exceso = excesoPorLote.get(donante)!;
    const rDonante = reg.get(donante);

    // Exceso de un lote PREC = fruta re-procesada por encima de su re-entrada:
    // derramarla a lotes reales sería contarla dos veces. A revisión.
    // Igual que el exceso de un código que no existe como entrada.
    if (!rDonante || rDonante.entrada.esPrecalibrado) {
      excesosSinColocar.push({ lote: donante, kg: exceso.kg });
      continue;
    }

    const candidatos = Array.from(reg.values())
      .filter((r) =>
        r.entrada.lote !== donante
        && !r.entrada.esPrecalibrado
        && pendiente(r, exceso.ultimaFecha) > 0
        && mismaFamiliaVariedad(r.familia, rDonante.familia),
      )
      .sort((a, b) => {
        const fincaA = a.fincaNorm === rDonante.fincaNorm && a.fincaNorm !== "" ? 0 : 1;
        const fincaB = b.fincaNorm === rDonante.fincaNorm && b.fincaNorm !== "" ? 0 : 1;
        if (fincaA !== fincaB) return fincaA - fincaB;
        const distA = diffDias(
          a.entrada.fecha < rDonante.entrada.fecha ? a.entrada.fecha : rDonante.entrada.fecha,
          a.entrada.fecha < rDonante.entrada.fecha ? rDonante.entrada.fecha : a.entrada.fecha,
        );
        const distB = diffDias(
          b.entrada.fecha < rDonante.entrada.fecha ? b.entrada.fecha : rDonante.entrada.fecha,
          b.entrada.fecha < rDonante.entrada.fecha ? rDonante.entrada.fecha : b.entrada.fecha,
        );
        return distA - distB || a.entrada.fecha.localeCompare(b.entrada.fecha) || a.entrada.lote.localeCompare(b.entrada.lote);
      });

    let restante = exceso.kg;
    for (const r of candidatos) {
      if (restante <= 0.5) break;
      const absorbe = Math.min(restante, pendiente(r, exceso.ultimaFecha));
      if (absorbe <= 0) continue;
      const esMismaFinca = r.fincaNorm === rDonante.fincaNorm && r.fincaNorm !== "";
      tocar(r, absorbe, exceso.ultimaFecha, true);
      restante -= absorbe;
      movimientos.push({
        de: donante,
        a: r.entrada.lote,
        kg: absorbe,
        motivo: esMismaFinca ? "exceso_misma_finca" : "exceso_misma_variedad",
      });
    }

    if (restante > 0.5) excesosSinColocar.push({ lote: donante, kg: restante });
  }

  // ── Salidas ────────────────────────────────────────────────────────────────
  const procesados: ProcesadoConciliado[] = [];
  for (const r of reg.values()) {
    const kgSinteticos = r.asignado - Math.max(0, Number(r.entrada.kg_preasignado) || 0);
    if (kgSinteticos <= 0) continue;
    procesados.push({ lote_codigo: r.entrada.lote, kg_peso_total: kgSinteticos, date: r.ultimaFecha });
  }
  procesados.sort((a, b) => a.lote_codigo.localeCompare(b.lote_codigo));

  const deltaPorLote = new Map<string, number>();
  for (const m of movimientos) {
    deltaPorLote.set(m.de, (deltaPorLote.get(m.de) ?? 0) - m.kg);
    deltaPorLote.set(m.a, (deltaPorLote.get(m.a) ?? 0) + m.kg);
  }

  let precalibradoPendienteKg = 0;
  for (const r of reg.values()) {
    if (!r.entrada.esPrecalibrado) continue;
    precalibradoPendienteKg += Math.max(0, r.entrada.kg_entrada - r.asignado);
  }

  return {
    procesados,
    movimientos,
    excesosSinColocar,
    deltaPorLote,
    reciclaje,
    kgReciclajeEstimado: reciclaje.reduce((s, r) => s + r.kg, 0),
    precalibradoPendienteKg,
  };
}

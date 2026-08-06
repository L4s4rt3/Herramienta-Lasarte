// Red de seguridad aritmética para la foto de la hoja diaria de lotes.
//
// REGLA DE LA CASA (jul-2026): el sistema NO se traga la cifra leída. Recalcula
// lo que puede cruzar con datos ciertos y CAZA incoherencias. Cuando algo no
// cuadra, el kilo NO se escribe y se levanta una bandera para que lo revise una
// persona: cero datos malos colados como buenos.
//
// A diferencia del parte manual EMBASUR, aquí no hay checksum exacto (el
// desglose de palets sumaba su total), solo desigualdades. Por eso este módulo
// nunca autocorrige un kilo: retiene y sugiere.
//
// Módulo puro y sin dependencias: lo importa la edge function (Deno) y lo
// prueba vitest desde src/lib/fotoLotesCoherencia.test.ts.

export interface LoteFotoEntrada {
  kg_industria?: unknown;
  kg_prec1?: unknown;
  kg_prec2?: unknown;
  movimientos_box?: unknown;
}

export interface LoteDiaReferencia {
  id: string;
  lote_codigo?: string | null;
  /** Kilos del informe del calibrador para ese lote. 0/null = sin referencia. */
  kg_peso_total?: number | null;
}

export interface ParLoteFoto {
  item: LoteFotoEntrada;
  fila: LoteDiaReferencia;
}

/** Columnas de lotes_dia que pueden escribirse tras pasar la revisión. */
export interface KilosAceptados {
  kg_industria?: number;
  kg_precalibrado_z1?: number;
  kg_precalibrado_z2?: number;
}

export interface RevisionLote {
  kg: KilosAceptados;
  banderas: string[];
  /** true si se ha descartado algún kilo leído por incoherente. */
  retenido: boolean;
}

export interface RevisionFoto {
  /** Clave = id de lotes_dia. */
  porLote: Map<string, RevisionLote>;
  /** Avisos que no son de un lote concreto. */
  banderas: string[];
  /** Lotes sin kg_peso_total con los que cruzar: sus kilos no son verificables. */
  sinReferencia: number;
}

/** Kilos por box implícitos fuera de esta banda = lectura sospechosa. */
const KG_POR_BOX_MIN = 1;
const KG_POR_BOX_MAX = 400;

/**
 * Margen sobre el peso del calibrador antes de dar algo por incoherente. El
 * techo viene de un informe y las cifras de un papel escrito a mano: un 1% de
 * desajuste es redondeo, no un dígito mal leído.
 */
const TOLERANCIA_TECHO = 0.01;

/**
 * Convierte lo que devuelve la visión a kilos. En estas hojas el punto es
 * separador de miles ("2.566 kg" = 2566) y un valor no positivo es "sin dato".
 */
export function parseVisionKg(value: unknown): number {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value <= 0) return 0;
    const rawNumber = String(value);
    return /^\d{1,3}\.\d{3}$/.test(rawNumber) ? Math.round(value * 1000) : value;
  }
  let raw = String(value ?? "").trim().replace(/\s+/g, "");
  if (!raw) return 0;
  raw = raw.replace(/kg$/i, "");
  if (/^\d{1,3}(\.\d{3})+$/.test(raw)) raw = raw.replace(/\./g, "");
  else raw = raw.replace(",", ".");
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export function parseVisionDecimal(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) && value > 0 ? value : 0;
  const parsed = Number(String(value ?? "").trim().replace(/\s+/g, "").replace(",", "."));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function formatKg(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(".", ",");
}

function etiquetaLote(fila: LoteDiaReferencia): string {
  return String(fila.lote_codigo ?? "").trim() || fila.id.slice(0, 8);
}

interface CampoKilos {
  clave: keyof KilosAceptados;
  etiqueta: string;
  valor: number;
}

/**
 * Revisa los kilos y los movimientos de box de una foto contra los lotes del
 * parte. Devuelve, por lote, qué kilos pueden escribirse y qué banderas hay.
 *
 * El techo de cada lote es su kg_peso_total (informe del calibrador). Es una
 * cota CONTABLE, no solo de magnitud: el destrío a industria y los kg apartados
 * a PRECALIBRADO 1/2 salen los dos de dentro de la pasada (el precalibrado se
 * aparta AL pasar por el calibrador y se vuelve a pasar después — confirmado
 * por el dueño, ago-2026), así que ninguno puede superar el peso del calibrador
 * ni sumar más que él.
 */
export function revisarCoherenciaFoto(
  pares: ParLoteFoto[],
  contexto: { kgProduccionParte?: number | null } = {},
): RevisionFoto {
  const porLote = new Map<string, RevisionLote>();
  const banderas: string[] = [];
  let sinReferencia = 0;

  // Un lote leído dos veces en la misma hoja es un error de lectura (el prompt
  // pide una entrada por lote). Sus kilos no se escriben: el segundo pisaría al
  // primero en silencio.
  const vecesPorFila = new Map<string, number>();
  for (const par of pares) {
    vecesPorFila.set(par.fila.id, (vecesPorFila.get(par.fila.id) ?? 0) + 1);
  }

  let totalAceptado = 0;

  for (const { item, fila } of pares) {
    const revision: RevisionLote = porLote.get(fila.id) ?? { kg: {}, banderas: [], retenido: false };
    const etiqueta = etiquetaLote(fila);
    const techo = Number(fila.kg_peso_total) || 0;

    const campos: CampoKilos[] = [
      { clave: "kg_industria", etiqueta: "industria", valor: parseVisionKg(item.kg_industria) },
      { clave: "kg_precalibrado_z1", etiqueta: "PREC 1", valor: parseVisionKg(item.kg_prec1) },
      { clave: "kg_precalibrado_z2", etiqueta: "PREC 2", valor: parseVisionKg(item.kg_prec2) },
    ];
    const conValor = campos.filter((campo) => campo.valor > 0);

    const duplicado = (vecesPorFila.get(fila.id) ?? 0) > 1;
    if (duplicado && conValor.length > 0) {
      revision.retenido = true;
      revision.banderas.push(
        `${etiqueta}: el lote aparece más de una vez en la foto; sus kilos no se aplican hasta revisarlo a mano.`,
      );
    }

    const limite = techo > 0 ? techo * (1 + TOLERANCIA_TECHO) : 0;
    const aceptados: CampoKilos[] = [];
    for (const campo of conValor) {
      if (duplicado) continue;
      if (limite > 0 && campo.valor > limite) {
        revision.retenido = true;
        const decima = campo.valor / 10;
        const sugerencia = decima <= limite ? ` ¿Serían ${formatKg(decima)} kg?` : "";
        revision.banderas.push(
          `${etiqueta}: ${campo.etiqueta} ${formatKg(campo.valor)} kg supera los ${formatKg(techo)} kg que pasaron por el calibrador; no se aplica.${sugerencia}`,
        );
        continue;
      }
      aceptados.push(campo);
    }

    // Los dos conceptos salen de la misma pasada: si juntos pasan del peso del
    // calibrador, uno está mal leído y no se sabe cuál. Se retienen ambos.
    const sumaAceptada = aceptados.reduce((total, campo) => total + campo.valor, 0);
    if (limite > 0 && aceptados.length > 1 && sumaAceptada > limite) {
      revision.retenido = true;
      revision.banderas.push(
        `${etiqueta}: industria + precalibrado suman ${formatKg(sumaAceptada)} kg, más de los ${formatKg(techo)} kg que pasaron por el calibrador; no se aplican.`,
      );
    } else {
      for (const campo of aceptados) {
        revision.kg[campo.clave] = campo.valor;
        totalAceptado += campo.valor;
      }
    }
    if (techo <= 0 && conValor.length > 0) sinReferencia += 1;

    revision.banderas.push(...revisarMovimientosBox(item.movimientos_box, etiqueta));
    porLote.set(fila.id, revision);
  }

  const kgProduccion = Number(contexto.kgProduccionParte) || 0;
  if (kgProduccion > 0 && totalAceptado > kgProduccion) {
    banderas.push(
      `La foto suma ${formatKg(totalAceptado)} kg entre industria y precalibrado, más que los ${formatKg(kgProduccion)} kg de producción del parte.`,
    );
  }

  return { porLote, banderas, sinReferencia };
}

/**
 * Cruza cajas × peso por caja contra el total escrito. Cuando falta el peso por
 * caja, comprueba que el implícito caiga en una banda plausible: la hoja mezcla
 * cajas pequeñas (4 kg de PREC) con box de campo (200-315 kg), así que no se
 * puede fijar un peso, solo descartar lo imposible.
 */
function revisarMovimientosBox(valor: unknown, etiqueta: string): string[] {
  if (!Array.isArray(valor)) return [];
  const banderas: string[] = [];
  for (const raw of valor) {
    if (!raw || typeof raw !== "object") continue;
    const movimiento = raw as Record<string, unknown>;
    const boxes = parseVisionKg(movimiento.boxes);
    const kgTotal = parseVisionKg(movimiento.kg_total);
    const pesoPorBox = parseVisionDecimal(movimiento.peso_por_box_kg);
    if (boxes <= 0) continue;

    if (pesoPorBox > 0 && kgTotal > 0) {
      const esperado = boxes * pesoPorBox;
      const tolerancia = Math.max(1, esperado * 0.02);
      if (Math.abs(kgTotal - esperado) > tolerancia) {
        banderas.push(
          `${etiqueta}: ${boxes} box × ${formatKg(pesoPorBox)} kg son ${formatKg(esperado)} kg, no los ${formatKg(kgTotal)} kg anotados.`,
        );
      }
      continue;
    }

    if (kgTotal > 0) {
      const implicito = kgTotal / boxes;
      if (implicito < KG_POR_BOX_MIN || implicito > KG_POR_BOX_MAX) {
        banderas.push(
          `${etiqueta}: ${formatKg(kgTotal)} kg entre ${boxes} box dan ${formatKg(implicito)} kg por box, fuera de lo razonable.`,
        );
      }
    }
  }
  return banderas;
}

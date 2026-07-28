/**
 * stockPrecalibrado.ts — stock VISIBLE del precalibrado (regla del dueño,
 * 2026-07-28: "el precalibrado se ve siempre, en cualquier cosa").
 *
 * El circuito PREC es cerrado: fruta ya comprada se aparta al almacén de
 * precalibrado y la báscula registra su RE-ENTRADA como movimiento interno
 * (esEntradaPrecalibrado, una fila por re-entrada con su propio código de
 * lote); el calibrador registra sus re-pasadas. Lo único medible con
 * fiabilidad es lo REINTRODUCIDO y cuánto de ello sigue sin re-pasar por
 * línea (fruta física en la nave esperando calibrador): lo APARTADO hacia el
 * almacén no siempre se pesa (verificado 22-jul-2026: apartado registrado
 * 506 t < reintroducido 792 t), así que el "contenido del almacén PREC" NO
 * se calcula — saldría negativo (misma nota que
 * conciliacionKg.precalibradoPendienteKg).
 *
 * Pendiente por re-entrada = kg re-entrada − kg conciliado a su código
 * (conciliarKgProcesados ya acota lo asignado a la capacidad de la
 * re-entrada). El Σ de estos pendientes coincide con el
 * precalibradoPendienteKg agregado de la conciliación; aquí se desglosa por
 * re-entrada y por almacén (PREC 1 / PREC 2, de la finca de báscula).
 */
import { diffDias } from "@/lib/entradasBascula";
import { normalizarLoteCodigo } from "@/lib/loteCodigo";
import { normalizarTexto } from "@/lib/format";

export interface ReentradaPrecalibradoInput {
  lote: string;
  /** Fecha de la re-entrada por báscula (cuando la fruta apartada volvió a registrarse). */
  fecha: string;
  /** Finca de báscula del movimiento interno: "PREC 1 ALMACEN" / "PREC 2 ALMACEN". */
  finca: string | null;
  kg_entrada: number;
}

export interface ReentradaPrecalibradoPendiente {
  lote: string;
  fecha: string;
  almacen: string;
  kg: number;
  kgReprocesado: number;
  kgPendiente: number;
  /** Días desde la re-entrada hasta hoy: cuánto lleva esa fruta esperando línea. */
  dias: number;
}

export interface StockPrecalibrado {
  nReentradas: number;
  kgReintroducido: number;
  kgReprocesado: number;
  /** Fruta física en la nave esperando línea (la única parte del PREC medible con fiabilidad). */
  kgPendiente: number;
  porAlmacen: Array<{ almacen: string; nReentradas: number; kg: number; kgPendiente: number }>;
  /** Re-entradas con pendiente relevante, las más antiguas primero. */
  pendientes: ReentradaPrecalibradoPendiente[];
}

/** Pendiente mínimo por re-entrada para listarla (los residuos menores son redondeos de pesada, pero SÍ suman en los totales). */
export const UMBRAL_PENDIENTE_PREC_KG = 100;

/** "PREC 1 ALMACEN" → "PREC 1"; sin número reconocible → "PREC". */
export function extraerAlmacenPrec(finca: string | null): string {
  const m = normalizarTexto(String(finca ?? "")).match(/prec\s*(\d+)/);
  return m ? `PREC ${m[1]}` : "PREC";
}

export function buildStockPrecalibrado(
  reentradas: ReentradaPrecalibradoInput[],
  /** Filas sintéticas de la conciliación (conciliacionKg.procesados): kg atribuido por código, ya acotado a capacidad. */
  procesadosConciliados: Array<{ lote_codigo: string; kg_peso_total: number }>,
  hoy: string,
): StockPrecalibrado {
  const conciliadoPorLote = new Map<string, number>();
  for (const p of procesadosConciliados) {
    const lote = normalizarLoteCodigo(p.lote_codigo) ?? String(p.lote_codigo ?? "").trim();
    if (!lote) continue;
    conciliadoPorLote.set(lote, (conciliadoPorLote.get(lote) ?? 0) + (Number(p.kg_peso_total) || 0));
  }

  let kgReintroducido = 0;
  let kgReprocesado = 0;
  let kgPendiente = 0;
  const acc = new Map<string, { nReentradas: number; kg: number; kgPendiente: number }>();
  const pendientes: ReentradaPrecalibradoPendiente[] = [];

  for (const r of reentradas) {
    const kg = Number(r.kg_entrada) || 0;
    const lote = normalizarLoteCodigo(r.lote) ?? r.lote;
    // La conciliación acota lo asignado a la capacidad de la re-entrada, pero
    // el min defiende la invariante (reprocesado ≤ reintroducido) ante datos
    // crudos sin conciliar.
    const reprocesado = Math.min(kg, conciliadoPorLote.get(lote) ?? 0);
    const pendiente = Math.max(0, kg - reprocesado);
    const almacen = extraerAlmacenPrec(r.finca);

    kgReintroducido += kg;
    kgReprocesado += reprocesado;
    kgPendiente += pendiente;

    const a = acc.get(almacen) ?? { nReentradas: 0, kg: 0, kgPendiente: 0 };
    a.nReentradas += 1;
    a.kg += kg;
    a.kgPendiente += pendiente;
    acc.set(almacen, a);

    if (pendiente >= UMBRAL_PENDIENTE_PREC_KG) {
      pendientes.push({
        lote,
        fecha: r.fecha,
        almacen,
        kg,
        kgReprocesado: reprocesado,
        kgPendiente: pendiente,
        dias: r.fecha ? diffDias(r.fecha, hoy) : 0,
      });
    }
  }

  pendientes.sort((a, b) => a.fecha.localeCompare(b.fecha) || a.lote.localeCompare(b.lote));

  return {
    nReentradas: reentradas.length,
    kgReintroducido,
    kgReprocesado,
    kgPendiente,
    porAlmacen: [...acc.entries()]
      .map(([almacen, a]) => ({ almacen, ...a }))
      .sort((a, b) => b.kg - a.kg),
    pendientes,
  };
}

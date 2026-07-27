/**
 * mermaCamaraImport.ts — parser y casado del registro manual "Merma fruta
 * camaras.xlsx" (el Excel que llevan las cámaras externas: Guadex/Espalmex).
 * Formato real (jul-2026), una fila por camión:
 *
 *   Fecha almacenamiento | Procedencia | Su Ref. | Agricultor | Finca |
 *   Variedad | Fecha entrada LST | Días almacén | Peso inicial | Peso final |
 *   Merma | % Merma
 *
 * Semántica verificada con el dueño (21-jul-2026): "Fecha almacenamiento" y
 * "Peso inicial" coinciden con la fecha y kg de la ENTRADA de báscula (los
 * papeles de la cámara), y "Fecha entrada LST" es cuando el camión salió de
 * cámara hacia la central. La merma real = inicial − final.
 *
 * CASADO contra entradas_bascula: por (fecha de entrada, kg de entrada
 * EXACTOS) — en el archivo real ese par es único; si hubiera empate se
 * desambigua por finca (contención de texto normalizado) y si aun así hay
 * varios candidatos se reporta como ambiguo (nunca se adivina).
 *
 * Casado APROXIMADO (añadido 27-jul-2026, tras dos fallos reales del casado
 * exacto en el archivo de 39 camiones):
 *   1. El papel de la cámara puede llevar la finca mal escrita (S26/100201
 *      decía "La Torrecilla" y era "La Vega de Santa Lucia"): si (fecha, kg)
 *      exactos dan UNA sola candidata, se casa con aviso aunque la finca no
 *      coincida.
 *   2. Los kg del papel pueden diferir de los de báscula (26042812: 20.860 vs
 *      20.960; 26051905: 25.460 vs 25.480): si no hay match exacto, se admite
 *      una ÚNICA candidata del mismo día con kg dentro de la tolerancia (1 %)
 *      y finca compatible, con aviso. Con varias candidatas sigue siendo
 *      ambiguo: nunca se adivina.
 */
import { normalizarTexto } from "@/lib/format";
import { parseFechaBascula } from "@/lib/entradasBascula";

export interface RegistroMermaCamara {
  fechaAlmacenamiento: string; // ISO — debe casar con entradas_bascula.fecha
  fechaSalida: string | null;  // "Fecha entrada LST"
  ref: string | null;
  finca: string | null;
  pesoInicial: number;
  pesoFinal: number;
  mermaKg: number;
}

export interface ParseMermaCamaraResult {
  registros: RegistroMermaCamara[];
  descartadas: Array<{ fila: number; motivo: string }>;
}

function norm(value: unknown): string {
  return normalizarTexto(String(value ?? "")).trim();
}

export function parseMermaCamaraRows(rows: unknown[][]): ParseMermaCamaraResult {
  const headerIndex = rows.findIndex((row) => {
    const headers = row.map(norm);
    return headers.some((h) => h.startsWith("fecha almacen"))
      && headers.some((h) => h.startsWith("peso inicial"))
      && headers.some((h) => h.startsWith("peso final"));
  });
  if (headerIndex === -1) {
    return { registros: [], descartadas: [{ fila: 0, motivo: "No se encontró la cabecera (Fecha almacenamiento / Peso inicial / Peso final)" }] };
  }

  const headers = rows[headerIndex].map(norm);
  const col = (prefix: string) => headers.findIndex((h) => h.startsWith(prefix));
  const iFecha = col("fecha almacen");
  const iSalida = col("fecha entrada");
  const iRef = col("su ref");
  const iFinca = col("finca");
  const iInicial = col("peso inicial");
  const iFinal = col("peso final");

  const registros: RegistroMermaCamara[] = [];
  const descartadas: Array<{ fila: number; motivo: string }> = [];

  rows.slice(headerIndex + 1).forEach((row, offset) => {
    const filaNum = headerIndex + offset + 2;
    if (row.every((c) => c == null || String(c).trim() === "")) return;
    const fecha = parseFechaBascula(row[iFecha]);
    if (!fecha) { descartadas.push({ fila: filaNum, motivo: "Sin fecha de almacenamiento" }); return; }
    const pesoInicial = Number(row[iInicial]) || 0;
    const pesoFinal = Number(row[iFinal]) || 0;
    if (pesoInicial <= 0 || pesoFinal <= 0) { descartadas.push({ fila: filaNum, motivo: "Sin peso inicial/final" }); return; }
    if (pesoFinal > pesoInicial) { descartadas.push({ fila: filaNum, motivo: "Peso final mayor que el inicial (revisar)" }); return; }
    registros.push({
      fechaAlmacenamiento: fecha,
      fechaSalida: iSalida >= 0 ? parseFechaBascula(row[iSalida]) : null,
      ref: iRef >= 0 ? (String(row[iRef] ?? "").trim() || null) : null,
      finca: iFinca >= 0 ? (String(row[iFinca] ?? "").trim() || null) : null,
      pesoInicial,
      pesoFinal,
      mermaKg: pesoInicial - pesoFinal,
    });
  });

  return { registros, descartadas };
}

export interface EntradaParaCasarMerma {
  id: string;
  lote: string;
  fecha: string;
  kg_entrada: number;
  finca: string | null;
}

export interface CasadoMermaCamara {
  /** `aviso` presente = casado aproximado (finca o kg no exactos): revisable en el resumen. */
  casados: Array<{ id: string; lote: string; registro: RegistroMermaCamara; aviso?: string }>;
  /** Registros sin ninguna entrada candidata ni exacta ni dentro de la tolerancia. */
  sinCasar: RegistroMermaCamara[];
  /** Registros con VARIAS entradas candidatas incluso tras filtrar por finca. */
  ambiguos: RegistroMermaCamara[];
}

/** Tolerancia de kg para el casado aproximado, fracción del peso del papel (las discrepancias báscula↔papel reales fueron ≤0,5 %). */
export const TOLERANCIA_KG_CASADO = 0.01;

function fincaCompatible(registroFinca: string, entradaFinca: string | null): boolean {
  const fincaReg = norm(registroFinca);
  const fincaEnt = norm(entradaFinca);
  return fincaEnt.includes(fincaReg) || fincaReg.includes(fincaEnt);
}

/**
 * Casa cada registro con su entrada por (fecha, kg exactos), desempatando por
 * finca; los que queden, por aproximación (finca distinta con kg exactos, o
 * kg dentro de la tolerancia) SOLO si la candidata es única. Nunca adivina.
 */
export function casarMermaCamara(registros: RegistroMermaCamara[], entradas: EntradaParaCasarMerma[]): CasadoMermaCamara {
  const porFechaKg = new Map<string, EntradaParaCasarMerma[]>();
  const porFecha = new Map<string, EntradaParaCasarMerma[]>();
  for (const e of entradas) {
    const key = `${e.fecha}::${Math.round(e.kg_entrada)}`;
    porFechaKg.set(key, [...(porFechaKg.get(key) ?? []), e]);
    porFecha.set(e.fecha, [...(porFecha.get(e.fecha) ?? []), e]);
  }

  const casados: CasadoMermaCamara["casados"] = [];
  const sinCasar: RegistroMermaCamara[] = [];
  const ambiguos: RegistroMermaCamara[] = [];
  const yaUsadas = new Set<string>();

  // Fase 1 — casado exacto por (fecha, kg) [+ finca]. Se resuelve ENTERA antes
  // de aproximar nada: un match exacto siempre reclama su entrada primero.
  const pendientes: RegistroMermaCamara[] = [];
  for (const r of registros) {
    const candidatas = (porFechaKg.get(`${r.fechaAlmacenamiento}::${Math.round(r.pesoInicial)}`) ?? [])
      .filter((e) => !yaUsadas.has(e.id));
    // Con finca en el registro, la finca desempata; pero si (fecha, kg) exactos
    // dan UNA sola candidata, la finca del papel puede venir mal escrita (caso
    // real S26/100201) y el par exacto pesa más: se casa con aviso (fase 2).
    const elegidas = r.finca ? candidatas.filter((e) => fincaCompatible(r.finca!, e.finca)) : candidatas;
    if (elegidas.length === 1) {
      yaUsadas.add(elegidas[0].id);
      casados.push({ id: elegidas[0].id, lote: elegidas[0].lote, registro: r });
    } else if (elegidas.length > 1) {
      ambiguos.push(r);
    } else {
      pendientes.push(r);
    }
  }

  // Fase 2 — casado aproximado para los pendientes, siempre con aviso.
  for (const r of pendientes) {
    // 2a. (fecha, kg) exactos con candidata única pero finca distinta. La
    // unicidad se exige sobre TODAS las entradas con ese par, no solo las
    // libres: si el día tuvo dos camiones con kg idénticos, la "sobrante" no
    // es evidencia de nada.
    const exactas = porFechaKg.get(`${r.fechaAlmacenamiento}::${Math.round(r.pesoInicial)}`) ?? [];
    if (exactas.length === 1 && !yaUsadas.has(exactas[0].id)) {
      yaUsadas.add(exactas[0].id);
      casados.push({
        id: exactas[0].id,
        lote: exactas[0].lote,
        registro: r,
        aviso: `finca del papel ("${r.finca ?? ""}") no coincide con la de báscula ("${exactas[0].finca ?? ""}")`,
      });
      continue;
    }
    // 2b. Mismo día, kg dentro de la tolerancia y finca compatible (casos
    // reales 26042812 y 26051905: diferencia báscula↔papel de 100 y 20 kg).
    const aproximadas = (porFecha.get(r.fechaAlmacenamiento) ?? [])
      .filter((e) => !yaUsadas.has(e.id))
      .filter((e) => Math.abs(e.kg_entrada - r.pesoInicial) <= r.pesoInicial * TOLERANCIA_KG_CASADO)
      .filter((e) => !r.finca || fincaCompatible(r.finca, e.finca));
    if (aproximadas.length === 1) {
      const e = aproximadas[0];
      yaUsadas.add(e.id);
      casados.push({
        id: e.id,
        lote: e.lote,
        registro: r,
        aviso: `kg del papel (${r.pesoInicial}) difieren de los de báscula (${Math.round(e.kg_entrada)})`,
      });
    } else if (aproximadas.length === 0) {
      sinCasar.push(r);
    } else {
      ambiguos.push(r);
    }
  }

  return { casados, sinCasar, ambiguos };
}

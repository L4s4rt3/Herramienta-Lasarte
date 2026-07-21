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
  casados: Array<{ id: string; lote: string; registro: RegistroMermaCamara }>;
  /** Registros sin ninguna entrada con (fecha, kg) exactos. */
  sinCasar: RegistroMermaCamara[];
  /** Registros con VARIAS entradas candidatas incluso tras filtrar por finca. */
  ambiguos: RegistroMermaCamara[];
}

/** Casa cada registro con su entrada por (fecha, kg exactos); desempata por finca; nunca adivina. */
export function casarMermaCamara(registros: RegistroMermaCamara[], entradas: EntradaParaCasarMerma[]): CasadoMermaCamara {
  const porFechaKg = new Map<string, EntradaParaCasarMerma[]>();
  for (const e of entradas) {
    const key = `${e.fecha}::${Math.round(e.kg_entrada)}`;
    const arr = porFechaKg.get(key) ?? [];
    arr.push(e);
    porFechaKg.set(key, arr);
  }

  const casados: CasadoMermaCamara["casados"] = [];
  const sinCasar: RegistroMermaCamara[] = [];
  const ambiguos: RegistroMermaCamara[] = [];
  const yaUsadas = new Set<string>();

  for (const r of registros) {
    const candidatas = (porFechaKg.get(`${r.fechaAlmacenamiento}::${Math.round(r.pesoInicial)}`) ?? [])
      .filter((e) => !yaUsadas.has(e.id));
    // Con finca en el registro, la finca MANDA: una candidata con la misma
    // fecha y kg pero finca distinta es una coincidencia sospechosa, no un
    // match (queda "sin casar" y visible en el resumen). Sin finca en el
    // registro, vale la candidata única por (fecha, kg).
    let elegidas = candidatas;
    if (r.finca) {
      const fincaReg = norm(r.finca);
      elegidas = candidatas.filter((e) => norm(e.finca).includes(fincaReg) || fincaReg.includes(norm(e.finca)));
    }
    if (elegidas.length === 1) {
      yaUsadas.add(elegidas[0].id);
      casados.push({ id: elegidas[0].id, lote: elegidas[0].lote, registro: r });
    } else if (elegidas.length === 0) {
      sinCasar.push(r);
    } else {
      ambiguos.push(r);
    }
  }

  return { casados, sinCasar, ambiguos };
}

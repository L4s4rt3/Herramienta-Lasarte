/**
 * Confección por zona de trabajo: cuántos kg salieron en Mallas, Granel,
 * Envasado (mesas) e Industria, agregables por día/semana/mes/campaña.
 *
 * Fuente: producto_dia (informe de producto por línea). La clasificación
 * producto → zona reutiliza clasificarProductoInforme (el mismo criterio
 * validado que usa el rendimiento por zonas de RRHH): "Mesas" se muestra
 * aquí como "Envasado", y lo excluido (totales, podrido, muestras,
 * precalibrado…) no computa en ninguna zona.
 */
import { clasificarProductoInforme } from "./asistenciaProductoClasificacion";

export const ZONAS_CONFECCION = ["Mallas", "Graneleras", "Envasado", "Industria"] as const;
export type ZonaConfeccion = (typeof ZONAS_CONFECCION)[number];

export const ZONA_CONFECCION_LABEL: Record<ZonaConfeccion, string> = {
  Mallas: "Mallas",
  Graneleras: "Granel",
  Envasado: "Envasado",
  Industria: "Industria",
};

export interface ConfeccionZonaRow {
  date: string;
  producto: string | null;
  formato_caja?: string | null;
  grupo_destino?: string | null;
  linea?: string | null;
  kg: number | null;
}

export interface ConfeccionZonasAgg {
  kg: Record<ZonaConfeccion, number>;
  /** Kg reales del informe que no son de ninguna zona: podrido, precalibrado, muestras… */
  otros: number;
  /** Total del informe: 4 zonas + otros. Cuadra con los kg del calibrador del período. */
  total: number;
  /** Días distintos con confección dentro del rango. */
  nDias: number;
}

/**
 * Clasifica una fila del informe de producto:
 * - una de las 4 zonas de trabajo,
 * - "Otros" (kg reales fuera de zona: podrido, precalibrado, muestras, descartes),
 * - null si la fila NO debe contarse (filas TOTAL del informe, sin producto),
 *   porque duplicarían los kg del día.
 */
export function clasificarFilaConfeccion(row: ConfeccionZonaRow): ZonaConfeccion | "Otros" | null {
  const { zona, motivo } = clasificarProductoInforme({
    producto: row.producto,
    formato_caja: row.formato_caja,
    grupo_destino: row.grupo_destino,
    linea: row.linea,
  });
  switch (zona) {
    case "Mesas":
      return "Envasado";
    case "Mallas":
    case "Graneleras":
    case "Industria":
      return zona;
    default:
      // "Excluir" con kg reales (motivo fuera_rendimiento) computa como Otros;
      // las filas TOTAL/sin producto duplican el día y se descartan del todo.
      return motivo === "fuera_rendimiento" ? "Otros" : null;
  }
}

/** Zona de confección de una fila; null si es Otros o no computa. */
export function zonaConfeccionDe(row: ConfeccionZonaRow): ZonaConfeccion | null {
  const clasificacion = clasificarFilaConfeccion(row);
  return clasificacion === "Otros" || clasificacion === null ? null : clasificacion;
}

/** Agrega kg por zona dentro de un rango de fechas [desde, hasta] inclusive. */
export function agregarConfeccionZonas(
  rows: ConfeccionZonaRow[],
  desde: string,
  hasta: string,
): ConfeccionZonasAgg {
  const kg: Record<ZonaConfeccion, number> = { Mallas: 0, Graneleras: 0, Envasado: 0, Industria: 0 };
  let otros = 0;
  const dias = new Set<string>();

  for (const row of rows) {
    if (row.date < desde || row.date > hasta) continue;
    const clasificacion = clasificarFilaConfeccion(row);
    if (!clasificacion) continue;
    const kgValue = Number(row.kg) || 0;
    if (kgValue <= 0) continue;
    if (clasificacion === "Otros") {
      otros += kgValue;
    } else {
      kg[clasificacion] += kgValue;
    }
    dias.add(row.date);
  }

  return {
    kg,
    otros,
    total: ZONAS_CONFECCION.reduce((s, z) => s + kg[z], 0) + otros,
    nDias: dias.size,
  };
}

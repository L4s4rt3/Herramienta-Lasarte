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
  /** Suma de las 4 zonas (sin lo excluido). */
  total: number;
  /** Días distintos con confección dentro del rango. */
  nDias: number;
}

/** Zona de confección de una fila del informe de producto; null si se excluye. */
export function zonaConfeccionDe(row: ConfeccionZonaRow): ZonaConfeccion | null {
  const { zona } = clasificarProductoInforme({
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
      return null;
  }
}

/** Agrega kg por zona dentro de un rango de fechas [desde, hasta] inclusive. */
export function agregarConfeccionZonas(
  rows: ConfeccionZonaRow[],
  desde: string,
  hasta: string,
): ConfeccionZonasAgg {
  const kg: Record<ZonaConfeccion, number> = { Mallas: 0, Graneleras: 0, Envasado: 0, Industria: 0 };
  const dias = new Set<string>();

  for (const row of rows) {
    if (row.date < desde || row.date > hasta) continue;
    const zona = zonaConfeccionDe(row);
    if (!zona) continue;
    const kgValue = Number(row.kg) || 0;
    if (kgValue <= 0) continue;
    kg[zona] += kgValue;
    dias.add(row.date);
  }

  return {
    kg,
    total: ZONAS_CONFECCION.reduce((s, z) => s + kg[z], 0),
    nDias: dias.size,
  };
}
